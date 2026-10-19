// 列出建築輪廓每條邊的編號、長度、外側朝向，給 overrides/buildings.json 的 edges / parts.edge 用。
// 用法：node tools/buildings/edges.mjs osm-w251597222 osm-r7935317 ...
import fs from 'node:fs';

const world = JSON.parse(fs.readFileSync(new URL('../../public/data/world/generated.json', import.meta.url), 'utf8'));
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

for (const id of process.argv.slice(2)) {
  const b = world.buildings.find((x) => x.id === id);
  if (!b) { console.log(`${id}：找不到`); continue; }
  const r = b.outer;
  let area = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) area += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  const edges = r.map((p, i) => {
    const q = r[(i + 1) % r.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const t = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
    const n = area > 0 ? [t[1], -t[0]] : [-t[1], t[0]];
    const deg = ((Math.atan2(n[0], -n[1]) * 180) / Math.PI + 360) % 360; // 0 = 北（-z）、90 = 東
    return `${i}:${len.toFixed(1)}m${DIRS[Math.round(deg / 45) % 8]}`;
  });
  console.log(`${id} ${b.name ?? ''}（${b.levels} 層、${b.height} m）\n  ${edges.join('  ')}`);
}

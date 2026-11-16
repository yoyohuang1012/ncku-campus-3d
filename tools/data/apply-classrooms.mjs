// 把教室清單寫進 public/data/overrides/buildings.json 每棟建築的 rooms 欄位。
//
//   node tools/data/apply-classrooms.mjs          套用
//   node tools/data/apply-classrooms.mjs --check  只列出結果，不寫檔
//
// 輸入：
//   tools/data/classrooms.json      從成大課程查詢系統整理出來的教室（代碼、所在建築、樓層）
//   tools/data/building-codes.json  建築編號 → OSM 建築 id 對照表（手動維護，可在這裡修正對錯棟）
// 規則：
//   - 只處理對照表裡有 osmId 的建築；osmId 可以是字串或陣列（同一棟在 OSM 被拆成多塊時，每塊都寫同一份清單）
//   - 多個建築編號對到同一棟時（例如管理學院各系館），教室合併，名稱前面加上原本的館名
//   - 地下樓層 floor 寫負數（遊戲介面會顯示成 B1）；查不到樓層的 floor 寫 0，名稱加註（樓層不明）
//   - buildings.json 維持一棟一行，只改 rooms 欄位，其他內容不動
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const check = process.argv.includes('--check');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const classrooms = read('tools/data/classrooms.json');
const codes = read('tools/data/building-codes.json');
const overridesPath = path.join(root, 'public/data/overrides/buildings.json');
const world = read('public/data/world/generated.json');
const knownIds = new Set(world.buildings.map((b) => b.id));

const byCode = new Map(codes.buildings.map((b) => [b.code, b]));
/** osmId → Room[] */
const roomsByBuilding = new Map();
const skipped = new Map();

for (const r of classrooms.rooms) {
  const entry = byCode.get(r.location);
  const ids = entry?.osmId ? [entry.osmId].flat() : [];
  if (!ids.length) {
    skipped.set(r.location, (skipped.get(r.location) ?? 0) + 1);
    continue;
  }
  const room = { code: r.code, floor: r.floor };
  const parts = [];
  if (entry.roomPrefix) parts.push(entry.roomPrefix);
  if (r.name) parts.push(r.name);
  if (r.floorSource === '不明') parts.push('（樓層不明）');
  else if (r.floorUncertain) parts.push('（樓層待校對）');
  if (parts.length) room.name = parts.join(' ').replace(/ （/g, '（');
  for (const id of ids) {
    if (!knownIds.has(id)) throw new Error(`對照表的 ${id}（${entry.name}）不在 generated.json 裡`);
    if (!roomsByBuilding.has(id)) roomsByBuilding.set(id, []);
    const list = roomsByBuilding.get(id);
    if (!list.some((x) => x.code === room.code)) list.push(room);
  }
}

for (const list of roomsByBuilding.values()) list.sort((a, b) => a.floor - b.floor || a.code.localeCompare(b.code));

// 與現有檔案相同的寫法：{"key": value, "key2": [..]}
const dump = (v) =>
  Array.isArray(v) ? `[${v.map(dump).join(', ')}]`
  : v && typeof v === 'object' ? `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${dump(x)}`).join(', ')}}`
  : JSON.stringify(v);

const original = fs.readFileSync(overridesPath, 'utf8');
const eol = original.includes('\r\n') ? '\r\n' : '\n'; // 維持檔案原本的換行
const lines = original.split(/\r?\n/);
const lineOf = new Map();
lines.forEach((line, i) => {
  const m = line.match(/^ {4}"([^"]+)": \{.*\},?\s*$/);
  if (m) lineOf.set(m[1], i);
});
const lastBuildingLine = Math.max(...lineOf.values());
const added = [];

for (const [id, rooms] of roomsByBuilding) {
  const text = `"rooms": ${dump(rooms)}`;
  const i = lineOf.get(id);
  if (i === undefined) {
    added.push(`    ${JSON.stringify(id)}: {${text}}`);
    continue;
  }
  const line = lines[i];
  const comma = /,\s*$/.test(line) ? ',' : '';
  const body = line.replace(/,?\s*$/, '');
  const existing = body.match(/"rooms": \[(?:\{[^{}]*\}(?:, )?)*\]/);
  lines[i] = (existing
    ? body.replace(existing[0], () => text)
    : body.replace(/\}$/, () => (/\{\s*$/.test(body.slice(0, -1)) ? `${text}}` : `, ${text}}`))) + comma;
}

if (added.length) {
  if (!/,\s*$/.test(lines[lastBuildingLine])) lines[lastBuildingLine] += ',';
  lines.splice(lastBuildingLine + 1, 0, added.join(',\n'));
}

const out = lines.join('\n');
JSON.parse(out); // 確認仍是合法 JSON

const nameOf = new Map(world.buildings.map((b) => [b.id, b.name]));
const overrides = JSON.parse(out).buildings;
for (const [id, rooms] of roomsByBuilding) {
  console.log(`${id}  ${overrides[id]?.name ?? nameOf.get(id) ?? '(無名)'}  ${rooms.length} 間`);
}
console.log(`\n共 ${roomsByBuilding.size} 棟、${[...roomsByBuilding.values()].reduce((a, l) => a + l.length, 0)} 筆教室`);
if (skipped.size) {
  console.log('\n沒有對到 OSM 建築、略過的建築編號：');
  for (const [code, n] of skipped) console.log(`  ${code}  ${byCode.get(code)?.name ?? '(對照表沒有這個編號)'}  ${n} 間`);
}

if (!check) {
  fs.writeFileSync(overridesPath, eol === '\n' ? out : out.replace(/\n/g, eol));
  console.log('\n已寫入 public/data/overrides/buildings.json');
}

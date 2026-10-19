// 下載內政部國土測繪中心正射航照圖磚（WMTS PHOTO2，免申請），給地面貼圖與小地圖使用。
// 範圍讀自 public/data/config/world.json 的 bbox，存到 public/data/ortho/<zoom>/<x>_<y>.jpg。
// 用法：node tools/ortho/fetch-ortho.mjs 18 19
// 圖資來源：內政部國土測繪中心（使用時須標示來源）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'public/data/config/world.json'), 'utf8'));
const { south, west, north, east } = config.bbox;
const zooms = process.argv.slice(2).map(Number);
if (!zooms.length) zooms.push(18);

const tileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const index = fs.existsSync(path.join(root, 'public/data/ortho/index.json'))
  ? JSON.parse(fs.readFileSync(path.join(root, 'public/data/ortho/index.json'), 'utf8'))
  : { source: '內政部國土測繪中心 正射影像（WMTS PHOTO2）', levels: {} };

for (const z of zooms) {
  const x0 = tileX(west, z), x1 = tileX(east, z), y0 = tileY(north, z), y1 = tileY(south, z);
  const dir = path.join(root, 'public/data/ortho', String(z));
  fs.mkdirSync(dir, { recursive: true });
  let done = 0, skipped = 0;
  const total = (x1 - x0 + 1) * (y1 - y0 + 1);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const file = path.join(dir, `${x}_${y}.jpg`);
      if (fs.existsSync(file)) { skipped++; continue; }
      const url = `https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/${z}/${y}/${x}`;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': 'ncku-campus-sim/0.1 (personal project)' } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
          break;
        } catch (e) {
          if (attempt === 2) console.warn(`下載失敗 ${z}/${x}/${y}: ${e.message}`);
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      done++;
      await new Promise((r) => setTimeout(r, 40)); // 對伺服器友善一點
    }
  }
  index.levels[z] = { x0, x1, y0, y1 };
  console.log(`zoom ${z}: ${total} 張（新下載 ${done}，已存在 ${skipped}）`);
}
fs.writeFileSync(path.join(root, 'public/data/ortho/index.json'), JSON.stringify(index, null, 2));

// 從 OpenStreetMap (Overpass API) 下載世界範圍內的所有原始資料。
// 範圍讀自 public/data/config/world.json 的 bbox。
// 用法：node tools/osm/fetch-osm.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'public/data/config/world.json'), 'utf8'));
const { south, west, north, east } = config.bbox;

const query = `[out:json][timeout:170];(nwr(${south},${west},${north},${east}););out body geom;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: {
    'User-Agent': 'ncku-campus-sim/0.1 (personal project)',
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: 'data=' + encodeURIComponent(query),
});
if (!res.ok) {
  console.error('Overpass 回應錯誤', res.status, await res.text());
  process.exit(1);
}
const text = await res.text();
const out = path.join(root, 'tools/osm/raw/area.json');
fs.writeFileSync(out, text);
console.log(`已儲存 ${(text.length / 1e6).toFixed(1)} MB 到 ${out}`);

// 把 OSM 原始資料 (tools/osm/raw/area.json) 轉成遊戲用的世界資料：
//   public/data/world/generated.json  建築、道路、區域、樹、設施
//   public/data/world/nav.json        步行路網（給路線導航用）
// 這兩個檔案是自動產生的，不要手改；要修正請改 public/data/overrides/ 下的檔案。
// 用法：node tools/osm/build-world.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'public/data/config/world.json'), 'utf8'));
const raw = JSON.parse(fs.readFileSync(path.join(root, 'tools/osm/raw/area.json'), 'utf8'));
const elements = raw.elements;

// ---------- 座標轉換：經緯度 → 本地公尺 (x 東, z 南) ----------
const LAT0 = config.origin.lat;
const LON0 = config.origin.lon;
const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320;
const KZ = 110574;
const r2 = (v) => Math.round(v * 100) / 100;
const toXZ = (lat, lon) => [r2((lon - LON0) * KX), r2((LAT0 - lat) * KZ)];
const geomToXZ = (geom) => geom.map((p) => toXZ(p.lat, p.lon));

// ---------- 幾何工具 ----------
function pointInRing([x, z], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return a / 2;
}
function centroid(ring) {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return [r2(x / ring.length), r2(z / ring.length)];
}
function closeRing(ring) {
  // 移除重複的終點（首尾相同）
  if (ring.length > 1) {
    const a = ring[0], b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// 把多段線接成封閉環（multipolygon 的 outer/inner）
function assembleRings(segments) {
  const segs = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const rings = [];
  const same = (a, b) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;
  while (segs.length) {
    let cur = segs.shift();
    let guard = 0;
    while (!same(cur[0], cur[cur.length - 1]) && guard++ < 10000) {
      const end = cur[cur.length - 1];
      const idx = segs.findIndex((s) => same(s[0], end) || same(s[s.length - 1], end));
      if (idx < 0) break;
      let s = segs.splice(idx, 1)[0];
      if (!same(s[0], end)) s = s.slice().reverse();
      cur = cur.concat(s.slice(1));
    }
    if (same(cur[0], cur[cur.length - 1]) && cur.length >= 4) rings.push(closeRing(cur));
  }
  return rings;
}

// 取得一個元素的多邊形 {outer, holes}[]（way 或 multipolygon relation）
function polygonsOf(el) {
  if (el.type === 'way') {
    if (!el.geometry || el.geometry.length < 4) return [];
    const g = geomToXZ(el.geometry);
    if (!(g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1])) return [];
    return [{ outer: closeRing(g), holes: [] }];
  }
  if (el.type === 'relation' && el.tags?.type === 'multipolygon') {
    const outers = assembleRings(el.members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry).map((m) => geomToXZ(m.geometry)));
    const inners = assembleRings(el.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => geomToXZ(m.geometry)));
    return outers.map((outer) => ({ outer, holes: inners.filter((h) => pointInRing(h[0], outer)) }));
  }
  return [];
}

// ---------- 區域（車站、各校區） ----------
const nckuRel = elements.find((e) => e.type === 'relation' && e.id === config.nckuRelationId);
const nckuRings = nckuRel
  ? assembleRings(nckuRel.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => geomToXZ(m.geometry)))
  : [];
const regions = [];
for (const r of config.regions) {
  let polygon = null;
  if (r.kind === 'box') {
    const [x1, z1] = toXZ(r.box.north, r.box.west);
    const [x2, z2] = toXZ(r.box.south, r.box.east);
    polygon = [[x1, z1], [x2, z1], [x2, z2], [x1, z2]];
  } else {
    const a = toXZ(r.anchor.lat, r.anchor.lon);
    polygon = nckuRings.find((ring) => pointInRing(a, ring)) ?? null;
  }
  if (!polygon) { console.warn(`找不到區域 ${r.id} 的範圍`); continue; }
  regions.push({ id: r.id, nameKey: r.nameKey, detail: r.detail, polygon });
}
const regionAt = (p) => regions.find((r) => pointInRing(p, r.polygon))?.id ?? 'outside';

// ---------- 建築 ----------
const bd = config.buildingDefaults;
function parseNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
const buildings = [];
for (const el of elements) {
  const t = el.tags;
  if (!t) continue;
  const type = t.building ?? (t['building:part'] ? 'part' : null);
  if (!type || type === 'no') continue;
  if (t['building:part']) continue; // 建築分件之後精細化再處理
  const roofOnly = bd.roofTypes.includes(type);
  const levelsTag = parseNum(t['building:levels']);
  const levels = levelsTag ?? bd.levelsByType[type] ?? bd.levelsByType.yes;
  let height = parseNum(t.height) ?? (roofOnly ? bd.roofHeight : levels * bd.levelHeight);
  let minHeight = parseNum(t.min_height) ?? (parseNum(t['building:min_level']) != null ? parseNum(t['building:min_level']) * bd.levelHeight : 0);
  if (roofOnly && minHeight === 0) minHeight = height - 0.4;
  // 空橋等懸空建築：離地一段高度，下方可通行
  if (bd.elevatedTypes?.[type] != null && minHeight === 0) {
    minHeight = bd.elevatedTypes[type];
    if (parseNum(t.height) == null) height = minHeight + bd.levelHeight;
  }
  for (const [i, poly] of polygonsOf(el).entries()) {
    if (Math.abs(ringArea(poly.outer)) < 4) continue;
    const center = centroid(poly.outer);
    buildings.push({
      id: `osm-${el.type[0]}${el.id}${i ? '-' + i : ''}`,
      name: t.name ?? null,
      type,
      levels: Math.round(levels),
      height: r2(height),
      minHeight: r2(minHeight),
      roofOnly,
      region: regionAt(center),
      center,
      outer: poly.outer,
      holes: poly.holes,
    });
  }
}

// ---------- 道路 ----------
const ROAD_WIDTH = {
  trunk: 16, primary: 14, secondary: 12, tertiary: 10, unclassified: 7, residential: 6,
  living_street: 5, service: 4, pedestrian: 5, footway: 2.5, path: 2, cycleway: 2.5,
  steps: 2.5, track: 3, corridor: 2,
};
const roads = [];
const navWays = [];
for (const el of elements) {
  if (el.type !== 'way' || !el.tags?.highway || !el.geometry) continue;
  const t = el.tags;
  const kind = t.highway;
  if (['construction', 'proposed', 'platform', 'elevator', 'bus_stop', 'abandoned', 'razed'].includes(kind)) continue;
  if (t.indoor && t.indoor !== 'no') continue;
  const points = geomToXZ(el.geometry);
  const isArea = t.area === 'yes' && points.length >= 4;
  if (!isArea && ROAD_WIDTH[kind] != null) {
    roads.push({
      id: `osm-w${el.id}`,
      kind,
      name: t.name ?? null,
      width: parseNum(t.width) ?? ROAD_WIDTH[kind],
      tunnel: t.tunnel === 'yes' || t.tunnel === 'building_passage',
      bridge: t.bridge === 'yes',
      points,
    });
  }
  if (t.access !== 'no' && t.foot !== 'no' && kind !== 'motorway') navWays.push({ nodes: el.nodes, points });
}

// ---------- 從航照描的補充建築（OSM 缺漏的部分） ----------
const extraPath = path.join(root, 'public/data/overrides/extra-buildings.json');
const extraDefs = fs.existsSync(extraPath) ? JSON.parse(fs.readFileSync(extraPath, 'utf8')).buildings : [];
const osmSolid = buildings.filter((b) => !b.roofOnly);
const insideExisting = (p) => osmSolid.some((b) => Math.abs(b.center[0] - p[0]) < 150 && Math.abs(b.center[1] - p[1]) < 150 && pointInRing(p, b.outer));
const segDist = (p, a, b) => {
  const ex = b[0] - a[0], ez = b[1] - a[1];
  const l2 = ex * ex + ez * ez || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2));
  return Math.hypot(p[0] - (a[0] + ex * t), p[1] - (a[1] + ez * t));
};
const onRoad = (p) => roads.some((r) => !r.tunnel && r.points.some((q, i) => i > 0 && segDist(p, r.points[i - 1], q) < r.width / 2 + 0.5));
const hashRand = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
};
let extraCount = 0, skippedUnits = 0;
const pushExtra = (def, id, outer, levels, height) => {
  const center = centroid(outer);
  buildings.push({
    id, name: def.name ?? null, type: def.type ?? 'terrace', levels, height: r2(height), minHeight: 0, roofOnly: false,
    region: regionAt(center), center, outer: outer.map(([x, z]) => [r2(x), r2(z)]), holes: [],
    ...(def.aliases ? { aliases: def.aliases } : {}), traced: true,
  });
  extraCount++;
};
for (const def of extraDefs) {
  if (def.outline) pushExtra(def, def.id, def.outline, def.levels, def.height ?? def.levels * bd.levelHeight);
  else if (def.circle) {
    const { center: [cx, cz], radius } = def.circle;
    const ring = Array.from({ length: 24 }, (_, i) => [cx + Math.cos((i / 24) * Math.PI * 2) * radius, cz - Math.sin((i / 24) * Math.PI * 2) * radius]);
    pushExtra(def, def.id, ring, def.levels, def.height ?? def.levels * bd.levelHeight);
  } else if (def.rect && def.split) {
    // 街屋排：沿 along 方向切成一戶一戶，樓層數在範圍內隨機（以 id 為種子，結果固定）
    const [x0, z0, x1, z1] = def.rect;
    const [minL, maxL] = def.levels;
    const along = def.split.along, unit = def.split.unit;
    const from = along === 'x' ? x0 : z0, to = along === 'x' ? x1 : z1;
    let i = 0;
    for (let u = from; u < to - 1; u += unit, i++) {
      const v = Math.min(u + unit, to);
      const inset = 0.05;
      const rect = along === 'x' ? [u + inset, z0, v - inset, z1] : [x0, u + inset, x1, v - inset];
      const outer = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]];
      const c = [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2];
      if (onRoad(c) || insideExisting(c)) { skippedUnits++; continue; }
      const r = hashRand(`${def.id}-${i}`);
      const levels = minL + Math.floor(r * (maxL - minL + 1));
      pushExtra(def, `${def.id}-${i}`, outer, levels, levels * 3.3 + hashRand(`${def.id}-${i}h`) * 0.9);
    }
  }
}
console.log(`補充建築 ${extraCount} 棟（略過在道路上或與既有建築重疊的 ${skippedUnits} 戶）`);

// ---------- 地面區域（草地、水、球場、停車場…） ----------
function areaKind(t) {
  if (t.natural === 'water' || t.water || t.leisure === 'swimming_pool') return 'water';
  if (t.leisure === 'pitch') return 'pitch';
  if (t.leisure === 'track') return 'track';
  if (t.leisure === 'playground') return 'playground';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'village_green' || t.natural === 'grassland') return 'grass';
  if (t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'scrub') return 'wood';
  if (t.amenity === 'parking' || t.amenity === 'bicycle_parking' || t.amenity === 'motorcycle_parking') return 'parking';
  if (t.landuse === 'construction') return 'construction';
  if (t.railway === 'platform' || t.public_transport === 'platform') return 'platform';
  if ((t.highway === 'pedestrian' || t.highway === 'footway') && t.area === 'yes') return 'plaza';
  if (t['area:highway']) return 'plaza';
  if (t.place === 'square') return 'plaza';
  return null;
}
const areas = [];
for (const el of elements) {
  const t = el.tags;
  if (!t || t.building) continue;
  const kind = areaKind(t);
  if (!kind) continue;
  for (const [i, poly] of polygonsOf(el).entries()) {
    areas.push({ id: `osm-${el.type[0]}${el.id}${i ? '-' + i : ''}`, kind, name: t.name ?? null, sport: t.sport ?? null, outer: poly.outer, holes: poly.holes });
  }
}

// ---------- 鐵路 ----------
const rails = [];
for (const el of elements) {
  if (el.type !== 'way' || el.tags?.railway !== 'rail' || !el.geometry) continue;
  if (el.tags.tunnel === 'yes') continue;
  rails.push({ id: `osm-w${el.id}`, points: geomToXZ(el.geometry) });
}

// ---------- 圍牆、柵欄（在門與道路交會處留缺口） ----------
const nodeTags = new Map();
for (const el of elements) if (el.type === 'node' && el.tags) nodeTags.set(el.id, el.tags);
const highwayNodes = new Set();
for (const w of navWays) for (const n of w.nodes ?? []) highwayNodes.add(n);
const BARRIER_HEIGHT = { wall: 2.2, fence: 1.8, retaining_wall: 1.2, hedge: 1.2, city_wall: 4, guard_rail: 0.9, handrail: 1 };
const barriers = [];
for (const el of elements) {
  // 古城牆殘蹟（historic=citywalls）也當成城牆畫
  const kind = el.tags?.barrier ?? (el.tags?.historic === 'citywalls' ? 'city_wall' : undefined);
  if (el.type !== 'way' || !BARRIER_HEIGHT[kind] || !el.geometry) continue;
  const pts = geomToXZ(el.geometry);
  const isGap = (i) => {
    const n = el.nodes?.[i];
    const nt = n != null ? nodeTags.get(n) : null;
    return highwayNodes.has(n) || (nt && nt.barrier && nt.barrier !== kind) || nt?.entrance;
  };
  // 以缺口切成多段，每個缺口兩側各留 1.5m
  let cur = [];
  const GAP = 1.5;
  const flush = () => { if (cur.length >= 2) barriers.push({ id: `osm-w${el.id}-${barriers.length}`, kind, height: BARRIER_HEIGHT[kind], points: cur }); cur = []; };
  for (let i = 0; i < pts.length; i++) {
    if (isGap(i)) {
      if (cur.length) {
        const prev = cur[cur.length - 1];
        const d = dist(prev, pts[i]);
        if (d > GAP) cur.push([r2(pts[i][0] + ((prev[0] - pts[i][0]) * GAP) / d), r2(pts[i][1] + ((prev[1] - pts[i][1]) * GAP) / d)]);
      }
      flush();
      if (i + 1 < pts.length) {
        const nx = pts[i + 1];
        const d = dist(nx, pts[i]);
        if (d > GAP) cur.push([r2(pts[i][0] + ((nx[0] - pts[i][0]) * GAP) / d), r2(pts[i][1] + ((nx[1] - pts[i][1]) * GAP) / d)]);
      }
    } else cur.push(pts[i]);
  }
  flush();
}

// ---------- 樹木 ----------
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const trees = [];
for (const el of elements) {
  const t = el.tags;
  if (!t) continue;
  if (el.type === 'node' && t.natural === 'tree') trees.push([...toXZ(el.lat, el.lon), 1]);
  if (el.type === 'way' && t.natural === 'tree_row' && el.geometry) {
    const pts = geomToXZ(el.geometry);
    for (let i = 0; i < pts.length - 1; i++) {
      const d = dist(pts[i], pts[i + 1]);
      const n = Math.max(1, Math.floor(d / 7));
      for (let k = 0; k < n; k++) {
        const f = k / n;
        trees.push([r2(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f), r2(pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f), 0]);
      }
    }
  }
}
// 公園、綠地內補種樹（固定亂數種子，每次產生結果相同）
const buildingIndex = buildings.filter((b) => !b.roofOnly);
for (const a of areas) {
  if (a.kind !== 'park' && a.kind !== 'wood') continue;
  const area = Math.abs(ringArea(a.outer));
  const xs = a.outer.map((p) => p[0]), zs = a.outer.map((p) => p[1]);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const count = Math.min(200, Math.floor(area / (a.kind === 'wood' ? 60 : 220)));
  for (let i = 0, tries = 0; i < count && tries < count * 10; tries++) {
    const p = [r2(minX + rand() * (maxX - minX)), r2(minZ + rand() * (maxZ - minZ))];
    if (!pointInRing(p, a.outer) || a.holes.some((h) => pointInRing(p, h))) continue;
    if (buildingIndex.some((b) => Math.abs(b.center[0] - p[0]) < 80 && Math.abs(b.center[1] - p[1]) < 80 && pointInRing(p, b.outer))) continue;
    trees.push([p[0], p[1], 2]);
    i++;
  }
}

// ---------- 小設施（路燈、椅子、停車架…）與可搜尋地點 ----------
function propKind(t) {
  if (t.highway === 'street_lamp') return 'lamp';
  if (t.amenity === 'bench' || t.leisure === 'picnic_table') return 'bench';
  if (t.amenity === 'bicycle_parking') return 'bike_parking';
  if (t.amenity === 'motorcycle_parking') return 'scooter_parking';
  if (t.amenity === 'bicycle_rental') return 'youbike';
  if (t.highway === 'bus_stop') return t.shelter === 'yes' ? 'bus_shelter' : 'bus_stop';
  if (t.amenity === 'drinking_water') return 'water_fountain';
  if (t.amenity === 'vending_machine') return 'vending';
  if (t.man_made === 'flagpole') return 'flagpole';
  if (t.amenity === 'fountain') return 'fountain';
  if (t.amenity === 'waste_basket' || t.amenity === 'recycling') return 'bin';
  if (t.tourism === 'artwork' || t.historic === 'memorial') return 'artwork';
  if (t.amenity === 'telephone' || t.emergency === 'phone') return 'phone';
  if (t.highway === 'traffic_signals') return 'traffic_light';
  return null;
}
const props = [];
const pois = [];
for (const el of elements) {
  const t = el.tags;
  if (!t) continue;
  let pos = null;
  if (el.type === 'node') pos = toXZ(el.lat, el.lon);
  else if (el.type === 'way' && el.geometry) pos = centroid(geomToXZ(el.geometry));
  if (!pos) continue;
  const pk = propKind(t);
  if (pk && el.type === 'node') props.push({ kind: pk, pos, ...(t.name ? { name: t.name } : {}) });
  if (t.name && !t.highway && !t.building && !t.barrier && !t.route && t.type !== 'route' && t.type !== 'multipolygon' && el.type !== 'relation') {
    const kind = t.amenity ?? t.shop ?? t.leisure ?? t.tourism ?? t.historic ?? t.natural ?? t.place ?? t.office ?? t.landuse ?? 'place';
    pois.push({ id: `osm-${el.type[0]}${el.id}`, name: t.name, kind, pos, region: regionAt(pos) });
  }
}

// ---------- 步行路網 ----------
const nodeIndex = new Map();
const navNodes = [];
const navEdges = [];
const adj = [];
const idOf = (osmId, p) => {
  let i = nodeIndex.get(osmId);
  if (i == null) { i = navNodes.length; nodeIndex.set(osmId, i); navNodes.push(p); adj.push([]); }
  return i;
};
for (const w of navWays) {
  if (!w.nodes || w.nodes.length !== w.points.length) continue;
  for (let i = 0; i < w.nodes.length - 1; i++) {
    const a = idOf(w.nodes[i], w.points[i]);
    const b = idOf(w.nodes[i + 1], w.points[i + 1]);
    if (a === b) continue;
    navEdges.push([a, b]);
    adj[a].push(b); adj[b].push(a);
  }
}
// 只保留最大的連通區塊，避免導航到走不到的孤島
const comp = new Int32Array(navNodes.length).fill(-1);
let best = -1, bestSize = 0;
for (let s = 0, c = 0; s < navNodes.length; s++) {
  if (comp[s] >= 0) continue;
  const stack = [s]; comp[s] = c; let size = 0;
  while (stack.length) { const u = stack.pop(); size++; for (const v of adj[u]) if (comp[v] < 0) { comp[v] = c; stack.push(v); } }
  if (size > bestSize) { bestSize = size; best = c; }
  c++;
}
const remap = new Int32Array(navNodes.length).fill(-1);
const keptNodes = [];
navNodes.forEach((p, i) => { if (comp[i] === best) { remap[i] = keptNodes.length; keptNodes.push(p); } });
const keptEdges = navEdges.filter(([a, b]) => comp[a] === best && comp[b] === best).map(([a, b]) => [remap[a], remap[b]]);

// ---------- 邊界 ----------
const [minX, minZ] = toXZ(config.bbox.north, config.bbox.west);
const [maxX, maxZ] = toXZ(config.bbox.south, config.bbox.east);

const generated = {
  meta: {
    source: '© OpenStreetMap contributors, ODbL',
    origin: config.origin,
    generatedAt: new Date().toISOString(),
  },
  bounds: { minX, maxX, minZ, maxZ },
  spawn: { pos: toXZ(config.spawn.lat, config.spawn.lon), heading: config.spawn.heading },
  regions,
  buildings,
  roads,
  areas,
  rails,
  barriers,
  trees,
  props,
  pois,
};
fs.writeFileSync(path.join(root, 'public/data/world/generated.json'), JSON.stringify(generated));
fs.writeFileSync(path.join(root, 'public/data/world/nav.json'), JSON.stringify({ nodes: keptNodes, edges: keptEdges }));

const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
console.log('區域', regions.map((r) => r.id).join(', '));
console.log('建築', buildings.length, count(buildings, (b) => b.region));
console.log('道路', roads.length, '地面區域', areas.length, count(areas, (a) => a.kind));
console.log('鐵路', rails.length, '圍牆', barriers.length, '樹', trees.length, '設施', props.length, '地點', pois.length);
console.log('路網節點', keptNodes.length, '/', navNodes.length, '邊', keptEdges.length);

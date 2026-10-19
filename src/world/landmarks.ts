// 地標結構：跨路的鋼桁架天橋、水池水面與池岸、跨水的步道拱橋。
// 天橋位置在 overrides/landmarks.json；水池與步道橋直接用 OSM 的 water 區域和 bridge 步道。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Area, Canopy, Pavilion, PlazaPanel, Road, Skybridge, SunkenPlaza, Walkway, WaterStyle, XZ } from '../core/types';
import { pointInRing } from './collision';
import { FlatBuilder } from './geometry';

const FOOT = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway']);

function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g.index ? g.toNonIndexed() : g;
}

/** 沿 a→b 擺一根方料：local x 沿線、y 往上、z 往左右；slope 是沿線的仰角 */
function beam(a: XZ, b: XZ, y: number, slope: number, len: number, h: number, d: number, offY: number, offZ: number, color: THREE.ColorRepresentation) {
  const g = new THREE.BoxGeometry(len, h, d).translate(0, offY, offZ).rotateZ(slope)
    .rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0])).translate((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
  return paint(g, color);
}

const mesh = (parts: THREE.BufferGeometry[], material: THREE.Material) => {
  const m = new THREE.Mesh(mergeGeometries(parts), material);
  m.castShadow = m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
};

// ---------- 天橋 ----------

/** 有頂蓋的鋼桁架天橋：底板、頂板、玻璃側牆，兩側各一片 Warren 桁架（上下弦＋斜撐＋直柱） */
export function skybridgeMesh(list: Skybridge[]): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of list) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const y0 = s.bottom, H = s.height, w = s.width;
    const at = (offY: number, h: number, d: number, offZ: number, c: string, l = len) => beam(s.a, s.b, y0, 0, l, h, d, offY, offZ, c);
    parts.push(at(0.2, 0.4, w, 0, s.deck), at(H - 0.15, 0.3, w + 0.4, 0, s.deck));
    for (const side of [-1, 1]) {
      const z = side * (w / 2 + 0.15);
      parts.push(at(H / 2, H - 0.8, 0.06, side * (w / 2 - 0.1), s.glass));
      parts.push(at(0.3, 0.35, 0.3, z, s.color), at(H - 0.4, 0.35, 0.3, z, s.color));
      const n = Math.max(2, Math.round(len / (s.panel ?? 3)));
      const p = len / n, diag = Math.hypot(p, H - 0.7), ang = Math.atan2(H - 0.7, p);
      for (let i = 0; i <= n; i++) {
        const x = -len / 2 + i * p;
        const t = (x + len / 2) / len, px: XZ = [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
        const ux = (s.b[0] - s.a[0]) / len / 2, uz = (s.b[1] - s.a[1]) / len / 2;
        parts.push(beam([px[0] - ux, px[1] - uz], [px[0] + ux, px[1] + uz], y0, 0, 0.22, H - 0.5, 0.22, H / 2, z, s.color));
        if (i === n) continue;
        const mid: XZ = [s.a[0] + (s.b[0] - s.a[0]) * (t + p / len / 2), s.a[1] + (s.b[1] - s.a[1]) * (t + p / len / 2)];
        const g = new THREE.BoxGeometry(diag, 0.18, 0.18).rotateZ(i % 2 ? -ang : ang).translate(0, H / 2, z)
          .rotateY(-Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0])).translate(mid[0], y0, mid[1]);
        parts.push(paint(g, s.color));
      }
    }
  }
  return parts.length ? mesh(parts, new THREE.MeshLambertMaterial({ vertexColors: true })) : null;
}

// ---------- 跨水步道橋 ----------

export interface Footbridge {
  /** 橋面中心線 [x, y, z]，y 是橋面高度 */
  pts: [number, number, number][];
  width: number;
}

/** 把相接的 bridge 步道接成一條（OSM 常把一座橋切成好幾段） */
function chains(roads: Road[]): { points: XZ[]; width: number }[] {
  const left = roads.map((r) => ({ points: [...r.points], width: r.width }));
  const out: typeof left = [];
  const same = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;
  while (left.length) {
    const c = left.pop()!;
    for (let grew = true; grew;) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const o = left[i].points;
        if (same(c.points.at(-1)!, o[0])) c.points.push(...o.slice(1));
        else if (same(c.points.at(-1)!, o.at(-1)!)) c.points.push(...[...o].reverse().slice(1));
        else if (same(c.points[0], o.at(-1)!)) c.points.unshift(...o.slice(0, -1));
        else if (same(c.points[0], o[0])) c.points.unshift(...[...o].reverse().slice(0, -1));
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(c);
  }
  return out;
}

/** 每 step 公尺取一點 */
function resample(points: XZ[], step: number): { p: XZ; s: number }[] {
  const out = [{ p: points[0], s: 0 }];
  let s = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push({ p: [ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n], s: s + (L * k) / n });
    s += L;
  }
  return out;
}

/** OSM 標成 bridge 的步道，只要有一段落在水池裡，就做成中間拱起 rise 公尺的小橋 */
export function findFootbridges(roads: Road[], water: Area[], maxRise: number): Footbridge[] {
  const wet = (x: number, z: number) => water.some((a) => pointInRing(x, z, a.outer));
  return chains(roads.filter((r) => r.bridge && FOOT.has(r.kind))).flatMap((c) => {
    const samples = resample(c.points, 0.5);
    if (!samples.some(({ p }) => wet(p[0], p[1]))) return [];
    const L = samples.at(-1)!.s;
    const rise = Math.min(maxRise, L * 0.08);
    return [{ width: c.width, pts: samples.map(({ p, s }) => [p[0], rise * Math.sin((Math.PI * s) / L), p[1]] as [number, number, number]) }];
  });
}

/** 點到步道橋中心線的水平距離是否在 pad 公尺內（池岸碰撞與池岸石材在橋下斷開） */
export function nearFootbridge(bridges: Footbridge[], x: number, z: number, pad: number): boolean {
  return bridges.some((b) => b.pts.some(([px, , pz]) => Math.hypot(px - x, pz - z) < b.width / 2 + pad));
}

export function footbridgeMesh(bridges: Footbridge[], st: WaterStyle): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const b of bridges) {
    for (let i = 0; i < b.pts.length - 1; i++) {
      const [ax, ay, az] = b.pts[i], [bx, by, bz] = b.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az), slope = Math.atan2(by - ay, len);
      const a: XZ = [ax, az], c: XZ = [bx, bz], y = (ay + by) / 2;
      parts.push(beam(a, c, y, slope, len + 0.04, 0.3, b.width, -0.15, 0, st.bridgeDeck));
      for (const side of [-1, 1]) {
        parts.push(beam(a, c, y, slope, len + 0.04, 0.4, 0.08, -0.2, side * (b.width / 2), st.bridge));
        parts.push(beam(a, c, y, slope, len + 0.04, 0.1, 0.1, 1.0, side * (b.width / 2), st.bridge));
        if (i % 3 === 0) parts.push(beam(a, c, y, 0, 0.1, 1.0, 0.1, 0.5, side * (b.width / 2), st.bridge));
      }
    }
  }
  return parts.length ? mesh(parts, new THREE.MeshLambertMaterial({ vertexColors: true })) : null;
}

// ---------- 水池 ----------

/** 水面（略高於地面、有反光）與池岸石材；橋下的池岸斷開 */
export function waterMeshes(water: Area[], color: THREE.Color, st: WaterStyle, gap: (x: number, z: number) => boolean): THREE.Mesh[] {
  if (!water.length) return [];
  const fb = new FlatBuilder();
  for (const a of water) fb.add(a.outer, a.holes, st.level, color);
  const surface = new THREE.Mesh(fb.build(), new THREE.MeshPhongMaterial({ vertexColors: true, shininess: st.shininess, specular: new THREE.Color(st.specular) }));
  surface.receiveShadow = true;
  surface.matrixAutoUpdate = false;
  const rim: THREE.BufferGeometry[] = [];
  for (const a of water) for (const ring of [a.outer, ...a.holes]) {
    for (const [p, q] of shoreSegments(ring, gap)) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      rim.push(beam(p, q, 0, 0, len + 0.05, st.rimHeight, st.rimWidth, st.rimHeight / 2, 0, st.rim));
    }
  }
  return rim.length ? [surface, mesh(rim, new THREE.MeshLambertMaterial({ vertexColors: true }))] : [surface];
}

/** 池岸切成約 1 公尺的小段，丟掉 gap 為真（橋下）的那些 */
export function shoreSegments(ring: XZ[], gap: (x: number, z: number) => boolean): [XZ, XZ][] {
  const out: [XZ, XZ][] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L));
    for (let k = 0; k < n; k++) {
      const p: XZ = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      const q: XZ = [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n];
      if (!gap((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) out.push([p, q]);
    }
  }
  return out;
}

// ---------- 下沉廣場與大頂棚 ----------

/** 沿 heading 的本地座標系：u 往前、v 往右（heading 0 = 北） */
function frame(center: XZ, heading: number) {
  const h = (heading * Math.PI) / 180;
  const u: XZ = [Math.sin(h), -Math.cos(h)], v: XZ = [Math.cos(h), Math.sin(h)];
  const at = (a: number, b: number): XZ => [center[0] + u[0] * a + v[0] * b, center[1] + u[1] * a + v[1] * b];
  return { u, v, at, rotY: -h };
}

/** 本地座標的方塊：a 沿 u、b 沿 v，(ca, cb) 是中心 */
function localBox(f: ReturnType<typeof frame>, la: number, h: number, lb: number, ca: number, y: number, cb: number, color: string) {
  const [x, z] = f.at(ca, cb);
  // BoxGeometry 的 x 對 u、z 對 v：先轉成 u 朝 -z（heading 0），再繞 y 轉
  const g = new THREE.BoxGeometry(lb, h, la).translate(0, 0, 0).rotateY(f.rotY).translate(x, y, z);
  return paint(g, color);
}

export interface PlazaShape {
  /** 坑的四角（地面高度），畫遮罩用 */
  ring: XZ[];
  /** 走得到的面（地坪、階梯），給碰撞的 addDeck */
  decks: { pts: [number, number, number][]; hw: number }[];
  /** 擋路的邊（坑邊欄杆、階梯和地坪之間的欄杆） */
  walls: [XZ, XZ][];
}

const RUN_PER_DEPTH = 1.75; // 約 30 度的樓梯

/** 一面端牆上，扣掉樓梯開口後剩下的牆段（v 範圍） */
function endSegments(p: SunkenPlaza, end: number): [number, number][] {
  const W = p.width / 2;
  const holes = p.stairs.filter((s) => (s.top === 'end' ? 1 : -1) === end)
    .map((s) => (s.side === 'right' ? [W - s.width, W] : [-W, -W + s.width]) as [number, number])
    .sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let from = -W;
  for (const [lo, hi] of holes) { if (lo > from) out.push([from, lo]); from = Math.max(from, hi); }
  if (from < W) out.push([from, W]);
  return out;
}

/** 下沉廣場的形狀：地坪、階梯、擋路的邊 */
export function plazaShape(p: SunkenPlaza): PlazaShape {
  const f = frame(p.center, p.heading);
  const L = p.length / 2, W = p.width / 2, y = -p.depth, run = p.depth * RUN_PER_DEPTH;
  const pt = (a: number, b: number, h: number): [number, number, number] => { const [x, z] = f.at(a, b); return [x, h, z]; };
  const sL = p.stairs.find((s) => s.side === 'left')?.width ?? 0, sR = p.stairs.find((s) => s.side === 'right')?.width ?? 0;
  // 中間的主地坪（扣掉兩側的階梯帶）
  const decks = [{ pts: [pt(-L, (sL - sR) / 2, y), pt(L, (sL - sR) / 2, y)], hw: W - (sL + sR) / 2 }];
  const walls: [XZ, XZ][] = [[f.at(-L, -W), f.at(L, -W)], [f.at(-L, W), f.at(L, W)]];
  for (const end of [-1, 1]) for (const [lo, hi] of endSegments(p, end)) walls.push([f.at(end * L, lo), f.at(end * L, hi)]);
  for (const s of p.stairs) {
    const sv = s.side === 'right' ? 1 : -1, top = s.top === 'end' ? 1 : -1, v = sv * (W - s.width / 2);
    decks.push({ pts: [pt(top * L, v, 0), pt(top * (L - run), v, y)], hw: s.width / 2 });
    decks.push({ pts: [pt(top * (L - run), v, y), pt(-top * L, v, y)], hw: s.width / 2 });
    // 階梯和主地坪之間的欄杆（到樓梯底為止）
    walls.push([f.at(top * L, sv * (W - s.width)), f.at(top * (L - run), sv * (W - s.width))]);
  }
  return { ring: [f.at(-L, -W), f.at(L, -W), f.at(L, W), f.at(-L, W)], decks, walls };
}

/** 下沉廣場：石材內牆、地坪、整排階梯、坑邊與樓梯扶手、B1 入口玻璃門 */
export function sunkenPlazaMesh(p: SunkenPlaza): THREE.Mesh {
  const f = frame(p.center, p.heading);
  const L = p.length / 2, W = p.width / 2, D = p.depth, run = D * RUN_PER_DEPTH;
  const parts: THREE.BufferGeometry[] = [];
  // 地坪與四面牆（牆頂齊地面）
  parts.push(localBox(f, p.length, 0.2, p.width, 0, -D - 0.1, 0, p.floor));
  parts.push(localBox(f, p.length + 0.6, D, 0.3, 0, -D / 2, -W - 0.15, p.wall), localBox(f, p.length + 0.6, D, 0.3, 0, -D / 2, W + 0.15, p.wall));
  parts.push(localBox(f, 0.3, D, p.width, -L - 0.15, -D / 2, 0, p.wall), localBox(f, 0.3, D, p.width, L + 0.15, -D / 2, 0, p.wall));
  const n = Math.ceil(D / 0.16), tread = run / n;
  for (const s of p.stairs) {
    const sv = s.side === 'right' ? 1 : -1, top = s.top === 'end' ? 1 : -1;
    // 實心踏階，每階 D / n 高
    for (let i = 1; i <= n; i++) {
      const yTop = -i * (D / n);
      parts.push(localBox(f, tread + 0.02, yTop + D, s.width, top * (L - (i - 0.5) * tread), (yTop - D) / 2, sv * (W - s.width / 2), p.floor));
    }
    // 階梯側牆：擋在階梯和主地坪之間，牆頂比踏階高 1 公尺
    for (let i = 0; i < n; i++) {
      const hTop = -i * (D / n) + 1.0;
      parts.push(localBox(f, tread + 0.02, hTop + D, 0.25, top * (L - (i + 0.5) * tread), (hTop - D) / 2, sv * (W - s.width), p.wall));
    }
  }
  // 坑邊：實心石材矮牆（parapet）或金屬欄杆，樓梯頂留開口
  const edge = (la: number, lb: number, ca: number, cb: number) => {
    if (p.parapet) parts.push(localBox(f, Math.max(la, 0.35), p.parapet, Math.max(lb, 0.35), ca, p.parapet / 2, cb, p.wall));
    else parts.push(localBox(f, la, 0.08, lb, ca, 1.1, cb, p.rail));
  };
  edge(p.length, 0.08, 0, -W - 0.15);
  edge(p.length, 0.08, 0, W + 0.15);
  for (const end of [-1, 1]) for (const [lo, hi] of endSegments(p, end)) edge(0.08, hi - lo, end * (L + 0.15), (lo + hi) / 2);
  if (!p.parapet) for (let a = -L; a <= L; a += 2.5) for (const b of [-W, W]) parts.push(localBox(f, 0.06, 1.1, 0.06, a, 0.55, b, p.rail));
  // B1 入口玻璃門、牆上的螢幕與飾板（分格細縫、圓形裝飾）
  const panel = (d: PlazaPanel, color: string) => {
    const h = d.height ?? 3.2, y0 = -D + (d.bottom ?? 0), off = d.offset ?? 0.06;
    const side = d.wall === 'left' || d.wall === 'right';
    const s = d.wall === 'right' || d.wall === 'end' ? 1 : -1, wallAt = side ? W : L;
    // t：沿牆位置（從飾板中點算）、yy：高度、depth：離牆面距離、la/lb：沿牆寬與厚
    const box = (along: number, t: number, hh: number, yy: number, depth: number, thick: number, c: string) => {
      if (side) parts.push(localBox(f, along, hh, thick, d.at + t, yy, s * (wallAt - depth), c));
      else parts.push(localBox(f, thick, hh, along, s * (wallAt - depth), yy, d.at + t, c));
    };
    box(d.width, 0, h, y0 + h / 2, off, 0.1, color);
    const face = off + 0.05;
    if (d.seams) {
      for (let t = -d.width / 2 + d.seams; t < d.width / 2 - 0.01; t += d.seams) box(0.04, t, h, y0 + h / 2, face, 0.02, d.seamColor ?? p.wall);
      for (let yy = d.seams; yy < h - 0.01; yy += d.seams) box(d.width, 0, 0.04, y0 + yy, face, 0.02, d.seamColor ?? p.wall);
    }
    for (const [t, yy, r, c] of d.discs ?? []) {
      // 圓盤：軸線朝牆的法向
      const g = new THREE.CylinderGeometry(r, r, 0.04, 28).rotateX(Math.PI / 2);
      const n = side ? f.v : f.u;
      const [x, z] = side ? f.at(d.at + t, s * (wallAt - face - 0.03)) : f.at(s * (wallAt - face - 0.03), d.at + t);
      g.rotateY(Math.atan2(n[0], n[1])).translate(x, y0 + yy, z);
      parts.push(paint(g, c ?? d.discColor ?? color));
    }
  };
  for (const d of p.doors) panel(d, d.color ?? p.door);
  for (const d of p.screens ?? []) panel(d, d.color ?? p.door);
  const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.castShadow = m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}

// ---------- 棧橋與出入口亭 ----------

/** 棧橋的橋面中心線：兩端各 ramp 公尺的坡道，中間維持 height */
export function walkwayDeck(w: Walkway): [number, number, number][] {
  const samples = resample(w.points, 1);
  const L = samples.at(-1)!.s;
  return samples.map(({ p, s }) => [p[0], w.height * Math.min(1, s / w.ramp, (L - s) / w.ramp), p[1]] as [number, number, number]);
}

/** 棧橋：橋面板、兩側欄杆與立柱、底下的支撐 */
export function walkwayMesh(list: Walkway[]): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const w of list) {
    const pts = walkwayDeck(w);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az), slope = Math.atan2(by - ay, len);
      const a: XZ = [ax, az], c: XZ = [bx, bz], y = (ay + by) / 2;
      parts.push(beam(a, c, y, slope, len + 0.04, 0.25, w.width, -0.125, 0, w.deck));
      for (const side of [-1, 1]) {
        parts.push(beam(a, c, y, slope, len + 0.04, 0.08, 0.08, 1.1, side * (w.width / 2 - 0.05), w.rail));
        if (i % 2 === 0) parts.push(beam(a, c, y, 0, 0.08, 1.1, 0.08, 0.55, side * (w.width / 2 - 0.05), w.rail));
        if (y > 0.3 && i % 4 === 0) parts.push(beam(a, c, y / 2 - 0.2, 0, 0.3, y - 0.2, 0.3, 0, side * (w.width / 2 - 0.4), w.deck));
      }
    }
    // 鋼門架：兩根柱子＋橫樑，跨過橋面
    if (w.frames) {
      const fr = w.frames;
      for (let k = Math.floor(fr.spacing / 2); k < pts.length - 1; k += fr.spacing) {
        const [ax, ay, az] = pts[k], [bx, , bz] = pts[k + 1];
        const a: XZ = [ax, az], c: XZ = [bx, bz];
        for (const side of [-1, 1]) parts.push(beam(a, c, ay, 0, 0.25, fr.height, 0.25, fr.height / 2, side * (w.width / 2 + 0.2), fr.color));
        parts.push(beam(a, c, ay, 0, 0.3, 0.35, w.width + 0.9, fr.height, 0, fr.color));
      }
    }
  }
  return parts.length ? mesh(parts, new THREE.MeshLambertMaterial({ vertexColors: true })) : null;
}

/** 牆面上的字：畫在 canvas 上當貼圖（只用在少數招牌，數量不多） */
function labelMesh(text: string, color: string, size: number): THREE.Mesh {
  const lines = text.split('\n');
  const px = 128, c = document.createElement('canvas');
  const font = `bold ${px}px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif`;
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + px * 0.4;
  // 改 canvas 尺寸會把畫筆狀態清掉，字型要重設
  c.width = Math.ceil(w); c.height = Math.ceil(lines.length * px * 1.25 + px * 0.2);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, c.width / 2, px * 0.6 + i * px * 1.25 + px * 0.1));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const h = size * lines.length * 1.25 + size * 0.2, wm = (h * c.width) / c.height;
  return new THREE.Mesh(new THREE.PlaneGeometry(wm, h), new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false }));
}

/** 出入口站體、石牆、指示柱：石材方盒、玻璃帷幕、往正面出挑的平頂與細柱、出口號碼牌、牆面字 */
export function pavilionMeshes(list: Pavilion[]): THREE.Object3D[] {
  const parts: THREE.BufferGeometry[] = [];
  const out: THREE.Object3D[] = [];
  for (const p of list) {
    const f = frame(p.center, p.heading);
    const L = p.length / 2, W = p.width / 2, H = p.height, o = p.overhang ?? 1;
    parts.push(localBox(f, p.length, H, p.width, 0, H / 2, 0, p.wall));
    // 面朝 side 的方向：沿 u（start / end）或 v（left / right）
    const dirOf = (side: string) => ({ left: [0, -1], right: [0, 1], start: [-1, 0], end: [1, 0] } as Record<string, [number, number]>)[side];
    if (!p.roofless) {
      const d = p.front === 'none' ? [0, 0] : dirOf(p.front);
      parts.push(localBox(f, p.length + 1 + Math.abs(d[0]) * o, 0.45, p.width + 1 + Math.abs(d[1]) * o, d[0] * o / 2, H + 0.22, d[1] * o / 2, p.roof));
      // 出挑下的細柱
      if (p.columnSpacing && o > 2 && p.front !== 'none') {
        if (d[1]) for (let a = -L + p.columnSpacing / 2; a < L; a += p.columnSpacing) parts.push(localBox(f, 0.35, H, 0.35, a, H / 2, d[1] * (W + o - 0.6), p.roof));
        else for (let b = -W + p.columnSpacing / 2; b < W; b += p.columnSpacing) parts.push(localBox(f, 0.35, H, 0.35, d[0] * (L + o - 0.6), H / 2, b, p.roof));
      }
    }
    if (p.front !== 'none') {
      const [du, dv] = dirOf(p.front);
      // 玻璃帷幕：正面中段，兩側留石材
      if (dv) parts.push(localBox(f, p.length * 0.45, H - 0.8, 0.1, -L * 0.4, (H - 0.8) / 2, dv * (W + 0.05), p.glass));
      else parts.push(localBox(f, 0.1, H - 0.8, p.width * 0.6, du * (L + 0.05), (H - 0.8) / 2, 0, p.glass));
      if (p.sign) {
        if (dv) parts.push(localBox(f, 1.6, 1.0, 0.15, L - 1.5, H - 0.8, dv * (W + 0.1), p.sign));
        else parts.push(localBox(f, 0.15, 1.0, 1.6, du * (L + 0.1), H - 0.8, W - 1.5, p.sign));
      }
    }
    if (p.label) {
      const side = p.labelSide ?? (p.front === 'none' ? 'right' : p.front);
      const [du, dv] = dirOf(side);
      const m = labelMesh(p.label, p.labelColor ?? '#2b2f33', p.labelSize ?? 0.9);
      const [x, z] = f.at(du * (L + 0.04) + (dv ? L * 0.25 : 0), dv * (W + 0.04) + (du ? W * 0.25 : 0));
      m.position.set(x, H * 0.62, z);
      // 平面預設朝 +z；轉到面朝 side 的方向
      const nx = f.u[0] * du + f.v[0] * dv, nz = f.u[1] * du + f.v[1] * dv;
      m.rotation.y = Math.atan2(nx, nz);
      out.push(m);
    }
  }
  if (parts.length) out.unshift(mesh(parts, new THREE.MeshLambertMaterial({ vertexColors: true })));
  return out;
}

/** 大頂棚：上下兩層色的平板＋格狀細柱；柱子落在 skip 為真的地方（下沉廣場裡）就不放 */
export function canopyMesh(list: Canopy[], skip: (x: number, z: number) => boolean): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const c of list) {
    const f = frame(c.center, c.heading);
    parts.push(localBox(f, c.length, c.thickness * 0.6, c.width, 0, c.height - c.thickness * 0.3, 0, c.color));
    parts.push(localBox(f, c.length - 0.4, c.thickness * 0.4, c.width - 0.4, 0, c.height - c.thickness * 0.8, 0, c.underside));
    for (let a = -c.length / 2 + c.columnSpacing / 2; a < c.length / 2; a += c.columnSpacing) {
      for (let b = -c.width / 2 + c.columnSpacing / 2; b < c.width / 2; b += c.columnSpacing) {
        const [x, z] = f.at(a, b);
        if (skip(x, z)) continue;
        parts.push(paint(new THREE.CylinderGeometry(0.3, 0.3, c.height, 10).translate(x, c.height / 2, z), c.column));
      }
    }
  }
  if (!parts.length) return null;
  return mesh(parts, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

/** 地面遮罩：只寫深度、不畫顏色，挖掉下沉廣場的洞，讓地面下的東西只有從洞口看得到 */
export function groundMask(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, holes: XZ[][]): THREE.Mesh {
  const m = 600;
  const outer: XZ[] = [[bounds.minX - m, bounds.minZ - m], [bounds.maxX + m, bounds.minZ - m], [bounds.maxX + m, bounds.maxZ + m], [bounds.minX - m, bounds.maxZ + m]];
  const fb = new FlatBuilder();
  fb.add(outer, holes, -0.05, new THREE.Color(0));
  const mask = new THREE.Mesh(fb.build(), new THREE.MeshBasicMaterial({ colorWrite: false }));
  mask.renderOrder = -21;
  mask.matrixAutoUpdate = false;
  return mask;
}

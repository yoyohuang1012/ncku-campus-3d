// 由資料產生 3D 幾何：三角化、道路帶狀面、平面區域。
// 全部合併成少數幾個大網格，手機上也能維持流暢。
import * as THREE from 'three';
import type { XZ } from '../core/types';

/** 三角化（含洞），回傳的三角形全部朝上 (+Y) */
export function triangulate(outer: XZ[], holes: XZ[][]): { verts: XZ[]; tris: number[] } {
  const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
  const holeVecs = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
  let faces: number[][];
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, holeVecs);
  } catch {
    return { verts: [], tris: [] };
  }
  const verts: XZ[] = [...outer, ...holes.flat()];
  const tris: number[] = [];
  for (const [a, b, c] of faces) {
    const [ax, az] = verts[a], [bx, bz] = verts[b], [cx, cz] = verts[c];
    // 法向量 (b-a) x (c-a) 的 y 分量；要朝上
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny >= 0) tris.push(a, b, c);
    else tris.push(a, c, b);
  }
  return { verts, tris };
}

/** 多邊形往內縮 d 公尺（任何繞向都可），用於退縮的上層量體 */
export function insetRing(ring: XZ[], d: number): XZ[] {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  const ccw = area > 0;
  const n = ring.length;
  return ring.map((p, i) => {
    const a = ring[(i + n - 1) % n], c = ring[(i + 1) % n];
    const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [c[0] - p[0], c[1] - p[1]];
    const l1 = Math.hypot(e1[0], e1[1]) || 1, l2 = Math.hypot(e2[0], e2[1]) || 1;
    // 逆時針時內側在左手邊：(-dz, dx)
    const s = ccw ? 1 : -1;
    const n1 = [(-e1[1] / l1) * s, (e1[0] / l1) * s], n2 = [(-e2[1] / l2) * s, (e2[0] / l2) * s];
    const dot = n1[0] * n2[0] + n1[1] * n2[1];
    const k = d / Math.max(0.3, 1 + dot);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k] as XZ;
  });
}

/**
 * 掛在多邊形第 i 條邊上的矩形。a = [沿邊起點, 沿邊終點, 垂直起點, 垂直終點]（公尺）；
 * 沿邊的值為負時從邊尾倒數，null 代表邊尾；垂直方向正值朝多邊形外側。
 */
export function edgeRect(ring: XZ[], i: number, a: [number | null, number | null, number, number]): XZ[] {
  let area = 0;
  for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) area += ring[j][0] * ring[k][1] - ring[k][0] * ring[j][1];
  const p = ring[((i % ring.length) + ring.length) % ring.length], q = ring[(i + 1) % ring.length];
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  const t: XZ = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
  // 逆時針（面積 > 0）時外側在右手邊 (tz, -tx)
  const n: XZ = area > 0 ? [t[1], -t[0]] : [-t[1], t[0]];
  const along = (v: number | null) => (v == null ? len : v < 0 || Object.is(v, -0) ? len + v : v);
  const s0 = along(a[0]), s1 = along(a[1]);
  const pt = (s: number, o: number): XZ => [p[0] + t[0] * s + n[0] * o, p[1] + t[1] * s + n[1] * o];
  return [pt(s0, a[2]), pt(s1, a[2]), pt(s1, a[3]), pt(s0, a[3])];
}

/** 帶狀面（道路、鐵軌、路線），轉角做斜接 */
export class RibbonBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  add(points: XZ[], width: number, y: number, color: THREE.Color, offset = 0) {
    if (points.length < 2) return;
    const half = width / 2;
    const base = this.pos.length / 3;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const prev = points[Math.max(0, i - 1)], next = points[Math.min(n - 1, i + 1)];
      const cur = points[i];
      // 前後兩段的法向量平均 → 斜接方向
      let d1x = cur[0] - prev[0], d1z = cur[1] - prev[1];
      let d2x = next[0] - cur[0], d2z = next[1] - cur[1];
      const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
      d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
      if (i === 0) { d1x = d2x; d1z = d2z; }
      if (i === n - 1) { d2x = d1x; d2z = d1z; }
      let nx = -(d1z + d2z), nz = d1x + d2x;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      const cos = nx * -d2z + nz * d2x;
      const scale = Math.min(2.5, 1 / Math.max(0.2, Math.abs(cos)));
      const ox = cur[0] + nx * offset, oz = cur[1] + nz * offset;
      this.pos.push(ox + nx * half * scale, y, oz + nz * half * scale);
      this.pos.push(ox - nx * half * scale, y, oz - nz * half * scale);
      this.col.push(color.r, color.g, color.b, color.r, color.g, color.b);
      if (i < n - 1) {
        const a = base + i * 2;
        this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const nrm = new Float32Array(this.pos.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(this.idx);
    // 確保三角形朝上
    const p = this.pos;
    for (let i = 0; i < this.idx.length; i += 3) {
      const a = this.idx[i] * 3, b = this.idx[i + 1] * 3, c = this.idx[i + 2] * 3;
      const ny = (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]);
      if (ny < 0) { const tmp = this.idx[i + 1]; this.idx[i + 1] = this.idx[i + 2]; this.idx[i + 2] = tmp; }
    }
    g.setIndex(this.idx);
    return g;
  }
}

/** 平面多邊形（草地、水池、校區底色…） */
export class FlatBuilder {
  private pos: number[] = [];
  private col: number[] = [];

  add(outer: XZ[], holes: XZ[][], y: number, color: THREE.Color) {
    const { verts, tris } = triangulate(outer, holes);
    for (const i of tris) {
      this.pos.push(verts[i][0], y, verts[i][1]);
      this.col.push(color.r, color.g, color.b);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const nrm = new Float32Array(this.pos.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    return g;
  }
}

/** 由字串產生穩定的 0~1 亂數，讓同一棟建築每次顏色都一樣 */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

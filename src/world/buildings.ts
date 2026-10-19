// 建築網格：依外觀（牆面材質 × 窗型）分組合併成少數網格；屋頂有平屋頂＋女兒牆、四坡、弧形。
// 四坡與弧形屋頂用 straight skeleton（直骨架）演算法，任何輪廓（L 形、U 形、有中庭）都能自動產生。
import * as THREE from 'three';
import type { Building, BuildingPart, ColumnsFeature, XZ } from '../core/types';
import { facadeMaterial } from './facade';
import { triangulate } from './geometry';

type Skeleton = { vertices: [number, number, number][]; polygons: number[][] } | null;
type SkeletonBuilderT = { init(): Promise<void>; buildFromPolygon(c: number[][][]): Skeleton };

let skeletonBuilder: SkeletonBuilderT | null = null;
async function getSkeletonBuilder(): Promise<SkeletonBuilderT | null> {
  if (skeletonBuilder) return skeletonBuilder;
  try {
    const mod = (await import('straight-skeleton')) as unknown as { SkeletonBuilder: SkeletonBuilderT; default?: { SkeletonBuilder: SkeletonBuilderT } };
    const SB = mod.SkeletonBuilder ?? mod.default?.SkeletonBuilder;
    await SB.init();
    skeletonBuilder = SB;
  } catch (e) {
    console.warn('屋頂演算法載入失敗，改用平屋頂', e);
  }
  return skeletonBuilder;
}

function signedArea(ring: XZ[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

/** 去掉重複點與幾乎共線的點，讓骨架演算法穩定 */
function cleanRing(ring: XZ[]): XZ[] {
  const out: XZ[] = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.05) out.pop();
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) < 0.02) { out.splice(i, 1); changed = true; break; }
    }
  }
  return out;
}

/** 逆時針外框往外推 d 公尺（出簷） */
function offsetRing(ring: XZ[], d: number): XZ[] {
  const n = ring.length;
  return ring.map((p, i) => {
    const a = ring[(i + n - 1) % n], c = ring[(i + 1) % n];
    const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [c[0] - p[0], c[1] - p[1]];
    const l1 = Math.hypot(e1[0], e1[1]) || 1, l2 = Math.hypot(e2[0], e2[1]) || 1;
    // 逆時針時外側在右手邊：(dz, -dx)
    const n1 = [e1[1] / l1, -e1[0] / l1], n2 = [e2[1] / l2, -e2[0] / l2];
    const dot = n1[0] * n2[0] + n1[1] * n2[1];
    const k = d / Math.max(0.3, 1 + dot);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k] as XZ;
  });
}

class GeoBuilder {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  trim: number[] = [];
  glass: number[] = [];
  owner: number[] = [];

  tri(a: number[], b: number[], c: number[], color: THREE.Color, owner: number, extra?: { uv: number[][]; trim: THREE.Color; glass: THREE.Color }) {
    this.pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) {
      this.col.push(color.r, color.g, color.b);
      if (extra) {
        this.uv.push(...extra.uv[k]);
        this.trim.push(extra.trim.r, extra.trim.g, extra.trim.b);
        this.glass.push(extra.glass.r, extra.glass.g, extra.glass.b);
      }
    }
    this.owner.push(owner);
  }

  /** 朝上的三角形（屋頂），自動修正方向 */
  upTri(a: number[], b: number[], c: number[], color: THREE.Color, owner: number, down = false) {
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if ((ny >= 0) !== down) this.tri(a, b, c, color, owner);
    else this.tri(a, c, b, color, owner);
  }

  build(withFacade: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (withFacade) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('trimColor', new THREE.Float32BufferAttribute(this.trim, 3));
      g.setAttribute('glassColor', new THREE.Float32BufferAttribute(this.glass, 3));
    }
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

interface WallLook { g: GeoBuilder; bay: number; wall: THREE.Color; trim: THREE.Color; glass: THREE.Color }

/** 一圈牆面（外框或中庭），朝外；y0~y1。lookOf(i) 給第 i 面牆的網格群組與顏色 */
function addWalls(ring: XZ[], isHole: boolean, y0: number, y1: number, levelH: number, lookOf: (i: number) => WallLook, owner: number) {
  const ccw = signedArea(ring) > 0;
  // 逆時針外框的外側在右手邊；三角形 (A,B,C) 的法向量朝左，所以需要翻轉
  const flip = isHole ? !ccw : ccw;
  let u = 0;
  for (let i = 0; i < ring.length; i++) {
    const p0 = ring[i], p1 = ring[(i + 1) % ring.length];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (len < 0.01) continue;
    const { g, bay, wall, trim, glass } = lookOf(i);
    // 每面牆的窗戶從牆中央對齊，避免切在角落
    const u0 = (u - ((len % bay) / 2)) / bay, u1 = u0 + len / bay;
    const v0 = 0, v1 = (y1 - y0) / levelH;
    const A = [p0[0], y0, p0[1]], B = [p1[0], y0, p1[1]], C = [p1[0], y1, p1[1]], D = [p0[0], y1, p0[1]];
    const uA = [u0, v0], uB = [u1, v0], uC = [u1, v1], uD = [u0, v1];
    const ex = { trim, glass };
    if (flip) {
      g.tri(A, C, B, wall, owner, { ...ex, uv: [uA, uC, uB] });
      g.tri(A, D, C, wall, owner, { ...ex, uv: [uA, uD, uC] });
    } else {
      g.tri(A, B, C, wall, owner, { ...ex, uv: [uA, uB, uC] });
      g.tri(A, C, D, wall, owner, { ...ex, uv: [uA, uC, uD] });
    }
    u = 0; // 每面牆各自對齊
  }
}

/** 女兒牆：外側與內側各一面 */
function addParapet(g: GeoBuilder, ring: XZ[], y0: number, h: number, color: THREE.Color, owner: number) {
  for (let i = 0; i < ring.length; i++) {
    const p0 = ring[i], p1 = ring[(i + 1) % ring.length];
    const A = [p0[0], y0, p0[1]], B = [p1[0], y0, p1[1]], C = [p1[0], y0 + h, p1[1]], D = [p0[0], y0 + h, p0[1]];
    g.tri(A, B, C, color, owner); g.tri(A, C, D, color, owner);
    g.tri(A, C, B, color, owner); g.tri(A, D, C, color, owner);
  }
}

function addFlatCap(g: GeoBuilder, outer: XZ[], holes: XZ[][], y: number, color: THREE.Color, owner: number, down = false) {
  const { verts, tris } = triangulate(outer, holes);
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [verts[tris[i]], verts[tris[i + 1]], verts[tris[i + 2]]];
    g.upTri([a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], color, owner, down);
  }
}

/** 四坡／弧形屋頂；成功回傳 true */
function addSkeletonRoof(g: GeoBuilder, sb: SkeletonBuilderT, b: Volume, eave: number, color: THREE.Color, owner: number): boolean {
  const spec = b.look.roof;
  let outer = cleanRing(b.outer);
  if (outer.length < 3) return false;
  if (signedArea(outer) < 0) outer = outer.slice().reverse();
  const overhang = spec.overhang ?? 0;
  const eaveRing = overhang > 0 ? offsetRing(outer, overhang) : outer;
  const holes = b.holes.map(cleanRing).filter((h) => h.length >= 3).map((h) => (signedArea(h) > 0 ? h.slice().reverse() : h));
  const close = (r: XZ[]) => [...r.map((p) => [p[0], p[1]]), [r[0][0], r[0][1]]];
  let sk: Skeleton = null;
  try {
    sk = sb.buildFromPolygon([close(eaveRing), ...holes.map(close)]);
  } catch {
    sk = null;
  }
  if (!sk || !sk.polygons.length) return false;
  const tMax = Math.max(...sk.vertices.map((v) => v[2])) || 1;
  const tan = Math.tan(((spec.pitch ?? 30) * Math.PI) / 180);
  const rise = spec.rise ?? 6;
  const yOf = (t: number) => (spec.shape === 'curved' ? eave + rise * Math.sin((Math.min(t / tMax, 1) * Math.PI) / 2) : eave + Math.min(t * tan, 14));
  for (const poly of sk.polygons) {
    const pts = poly.map((i) => sk!.vertices[i]);
    if (pts.length < 3) continue;
    const flat = pts.map((p) => [p[0], p[1]] as XZ);
    let faces: number[][];
    try {
      faces = THREE.ShapeUtils.triangulateShape(flat.map(([x, z]) => new THREE.Vector2(x, z)), []);
    } catch {
      continue;
    }
    if (spec.shape === 'curved') {
      // 弧形：把每個面再細分，讓剖面是曲線
      for (const [ia, ib, ic] of faces) subdivideCurved(g, pts[ia], pts[ib], pts[ic], yOf, color, owner, 3);
    } else {
      for (const [ia, ib, ic] of faces) {
        const P = (v: [number, number, number]) => [v[0], yOf(v[2]), v[1]];
        g.upTri(P(pts[ia]), P(pts[ib]), P(pts[ic]), color, owner);
      }
    }
  }
  // 出簷底面
  if (overhang > 0) addFlatCap(g, eaveRing, [], eave - 0.02, color.clone().multiplyScalar(0.7), owner, true);
  return true;
}

function subdivideCurved(g: GeoBuilder, a: number[], b: number[], c: number[], yOf: (t: number) => number, color: THREE.Color, owner: number, depth: number) {
  if (depth === 0) {
    const P = (v: number[]) => [v[0], yOf(v[2]), v[1]];
    g.upTri(P(a), P(b), P(c), color, owner);
    return;
  }
  const m = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  const ab = m(a, b), bc = m(b, c), ca = m(c, a);
  subdivideCurved(g, a, ab, ca, yOf, color, owner, depth - 1);
  subdivideCurved(g, ab, b, bc, yOf, color, owner, depth - 1);
  subdivideCurved(g, ca, bc, c, yOf, color, owner, depth - 1);
  subdivideCurved(g, ab, bc, ca, yOf, color, owner, depth - 1);
}

/** 主體或附加量體共用的欄位 */
type Volume = Pick<BuildingPart, 'outer' | 'holes' | 'levels' | 'height' | 'minHeight' | 'roofOnly' | 'look' | 'edgeLooks'>;

/** 柱列：方柱或八角柱，沿折線等距排列（兩端各一根） */
function addColumns(g: GeoBuilder, f: ColumnsFeature, owner: number) {
  const color = new THREE.Color(f.color);
  const y0 = f.base ?? 0, y1 = f.height, r = f.size / 2;
  const sides = f.round ? 8 : 4;
  const put = (x: number, z: number, ang: number) => {
    for (let k = 0; k < sides; k++) {
      const a0 = ang + (k / sides) * Math.PI * 2 + Math.PI / sides, a1 = ang + ((k + 1) / sides) * Math.PI * 2 + Math.PI / sides;
      const rr = f.round ? r : r * Math.SQRT2;
      const p0 = [x + Math.cos(a0) * rr, z + Math.sin(a0) * rr], p1 = [x + Math.cos(a1) * rr, z + Math.sin(a1) * rr];
      const A = [p0[0], y0, p0[1]], B = [p1[0], y0, p1[1]], C = [p1[0], y1, p1[1]], D = [p0[0], y1, p0[1]];
      // 角度遞增在 xz 平面是順時針（俯視），外側法向量對應 (A, C, B)
      g.tri(A, C, B, color, owner);
      g.tri(A, D, C, color, owner);
    }
  };
  for (let i = 0; i < f.points.length - 1; i++) {
    const a = f.points[i], b = f.points[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / f.spacing));
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (let k = i === 0 ? 0 : 1; k <= n; k++) put(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, ang);
  }
}

export interface BuildingMeshResult {
  meshes: THREE.Mesh[];
}

/** 屋頂顏色：第二個參數是附加量體（沒有則為主體），auto 時從航照取樣它自己的輪廓 */
export async function buildBuildingMeshes(buildings: Building[], roofColorOf: (b: Building, part?: BuildingPart) => THREE.Color): Promise<THREE.Mesh[]> {
  const needSkeleton = buildings.some((b) => [b, ...b.parts].some((v) => v.look.roof.shape !== 'flat' && !v.roofOnly));
  const sb = needSkeleton ? await getSkeletonBuilder() : null;

  const wallGroups = new Map<string, GeoBuilder>();
  const roofs = new GeoBuilder();

  const addVolume = (b: Volume, bi: number, roofColor: THREE.Color) => {
    const look = b.look;
    const wall = new THREE.Color(look.wallColor), trim = new THREE.Color(look.trimColor), glass = new THREE.Color(look.windowColor);
    const base = b.minHeight, eave = b.height;
    const levelH = b.levels > 0 ? Math.max(2.4, (eave - base) / b.levels) : 3.6;

    if (b.roofOnly) {
      // 雨遮、車棚：只有一片屋頂板
      addFlatCap(roofs, b.outer, b.holes, eave, roofColor, bi);
      addFlatCap(roofs, b.outer, b.holes, eave - 0.3, roofColor.clone().multiplyScalar(0.7), bi, true);
      return;
    }

    const group = (wallKind: string, win: string) => {
      const key = `${wallKind}/${win}`;
      let wg = wallGroups.get(key);
      if (!wg) wallGroups.set(key, (wg = new GeoBuilder()));
      return wg;
    };
    const mainLook: WallLook = { g: group(look.wall, look.window), bay: look.bayWidth, wall, trim, glass };
    const lookOf = (i: number): WallLook => {
      const e = b.edgeLooks?.[i];
      if (!e) return mainLook;
      return {
        g: group(e.wall ?? look.wall, e.window ?? look.window),
        bay: e.bayWidth ?? look.bayWidth,
        wall: e.wallColor ? new THREE.Color(e.wallColor) : wall,
        trim: e.trimColor ? new THREE.Color(e.trimColor) : trim,
        glass: e.windowColor ? new THREE.Color(e.windowColor) : glass,
      };
    };
    addWalls(b.outer, false, base, eave, levelH, lookOf, bi);
    for (const h of b.holes) addWalls(h, true, base, eave, levelH, () => mainLook, bi);
    if (base > 0.5) addFlatCap(roofs, b.outer, b.holes, base, roofColor.clone().multiplyScalar(0.7), bi, true);

    const pitched = look.roof.shape !== 'flat' && sb && addSkeletonRoof(roofs, sb, b, eave, roofColor, bi);
    if (!pitched) {
      addFlatCap(roofs, b.outer, b.holes, eave, roofColor, bi);
      const p = look.roof.parapet ?? 0;
      if (p > 0) {
        addParapet(roofs, b.outer, eave, p, trim, bi);
        for (const h of b.holes) addParapet(roofs, h, eave, p, trim, bi);
      }
    }
  };

  const details = new GeoBuilder();
  buildings.forEach((b, bi) => {
    const roofColor = roofColorOf(b);
    addVolume(b, bi, roofColor);
    for (const part of b.parts) addVolume(part, bi, roofColorOf(b, part));
    for (const f of b.features) if (f.type === 'columns') addColumns(details, f, bi);
  });

  const meshes: THREE.Mesh[] = [];
  for (const [key, gb] of wallGroups) {
    const [wall, win] = key.split('/') as [Building['look']['wall'], Building['look']['window']];
    const mesh = new THREE.Mesh(gb.build(true), facadeMaterial(wall, win));
    mesh.userData.triangleToBuilding = Int32Array.from(gb.owner);
    meshes.push(mesh);
  }
  if (details.pos.length) {
    const detailMesh = new THREE.Mesh(details.build(false), new THREE.MeshLambertMaterial({ vertexColors: true }));
    detailMesh.userData.triangleToBuilding = Int32Array.from(details.owner);
    meshes.push(detailMesh);
  }
  const roofMesh = new THREE.Mesh(roofs.build(false), new THREE.MeshLambertMaterial({ vertexColors: true }));
  roofMesh.userData.triangleToBuilding = Int32Array.from(roofs.owner);
  meshes.push(roofMesh);
  for (const m of meshes) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    (m.geometry as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
  }
  return meshes;
}

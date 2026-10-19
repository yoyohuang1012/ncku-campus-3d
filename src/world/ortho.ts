// 正射航照：把國土測繪中心的圖磚拼成地面貼圖（3D 場景）與小地圖底圖。
// 圖磚由 tools/ortho/fetch-ortho.mjs 下載到 public/data/ortho/。
import * as THREE from 'three';
import type { XZ } from '../core/types';

export interface OrthoIndex {
  source: string;
  levels: Record<string, { x0: number; x1: number; y0: number; y1: number }>;
}

export interface OrthoTile {
  x: number;
  y: number;
  img: HTMLImageElement;
  /** 圖磚四角的本地座標：左上、右上、右下、左下 */
  corners: [XZ, XZ, XZ, XZ];
}

const BASE = import.meta.env.BASE_URL + 'data/ortho/';

export async function loadOrthoIndex(): Promise<OrthoIndex | null> {
  try {
    const res = await fetch(BASE + 'index.json');
    return res.ok ? ((await res.json()) as OrthoIndex) : null;
  } catch {
    return null;
  }
}

function tileLon(x: number, z: number) {
  return (x / 2 ** z) * 360 - 180;
}
function tileLat(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export function tileCorners(x: number, y: number, z: number, toXZ: (lat: number, lon: number) => XZ): [XZ, XZ, XZ, XZ] {
  const w = tileLon(x, z), e = tileLon(x + 1, z), n = tileLat(y, z), s = tileLat(y + 1, z);
  return [toXZ(n, w), toXZ(n, e), toXZ(s, e), toXZ(s, w)];
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** 載入某一層級的所有圖磚 */
export async function loadOrthoTiles(index: OrthoIndex, zoom: number, toXZ: (lat: number, lon: number) => XZ): Promise<OrthoTile[]> {
  const lv = index.levels[zoom];
  if (!lv) return [];
  const jobs: Promise<OrthoTile | null>[] = [];
  for (let x = lv.x0; x <= lv.x1; x++) {
    for (let y = lv.y0; y <= lv.y1; y++) {
      jobs.push(loadImage(`${BASE}${zoom}/${x}_${y}.jpg`).then((img) => (img ? { x, y, img, corners: tileCorners(x, y, zoom, toXZ) } : null)));
    }
  }
  return (await Promise.all(jobs)).filter((t): t is OrthoTile => t != null);
}

/**
 * 每 chunk×chunk 張圖磚拼成一張貼圖、一個平面。
 * 1024px 的貼圖手機也能用，繪製次數也少。
 */
export function buildOrthoGround(tiles: OrthoTile[], zoom: number, toXZ: (lat: number, lon: number) => XZ, renderOrder: number, maxAnisotropy: number): THREE.Group {
  const group = new THREE.Group();
  const CH = 4;
  const chunks = new Map<string, OrthoTile[]>();
  for (const t of tiles) {
    const k = `${Math.floor(t.x / CH)}_${Math.floor(t.y / CH)}`;
    if (!chunks.has(k)) chunks.set(k, []);
    chunks.get(k)!.push(t);
  }
  for (const list of chunks.values()) {
    // chunk 只涵蓋實際有圖磚的範圍（邊緣的 chunk 可能不滿 4×4）
    const tx0 = Math.min(...list.map((t) => t.x)), tx1 = Math.max(...list.map((t) => t.x));
    const ty0 = Math.min(...list.map((t) => t.y)), ty1 = Math.max(...list.map((t) => t.y));
    const canvas = document.createElement('canvas');
    canvas.width = (tx1 - tx0 + 1) * 256;
    canvas.height = (ty1 - ty0 + 1) * 256;
    const ctx = canvas.getContext('2d')!;
    for (const t of list) ctx.drawImage(t.img, (t.x - tx0) * 256, (t.y - ty0) * 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;

    const [tl, tr, br, bl] = [
      tileCorners(tx0, ty0, zoom, toXZ)[0],
      tileCorners(tx1, ty0, zoom, toXZ)[1],
      tileCorners(tx1, ty1, zoom, toXZ)[2],
      tileCorners(tx0, ty1, zoom, toXZ)[3],
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([tl[0], 0, tl[1], tr[0], 0, tr[1], br[0], 0, br[1], bl[0], 0, bl[1]], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    g.setIndex([0, 3, 1, 1, 3, 2]);
    const mat = new THREE.MeshLambertMaterial({ map: tex, depthWrite: false });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = renderOrder;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}

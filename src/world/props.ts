// 街道設施與雕塑的造型。顏色全部來自 style.json 的 props（會套全域色調）；
// 一般設施用 InstancedMesh，有個別造型（model）的雕塑各自組一個網格。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Prop, PropModel } from '../core/types';
import { hash01 } from './geometry';

export type PropPalette = Record<string, string | string[]>;

function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g.index ? g.toNonIndexed() : g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.ColorRepresentation) =>
  paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, c: THREE.ColorRepresentation, seg = 8) =>
  paint(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y + h / 2, z), c);
const sphere = (r: number, x: number, y: number, z: number, c: THREE.ColorRepresentation, detail = 1) =>
  paint(new THREE.IcosahedronGeometry(r, detail).translate(x, y, z), c);

/** 沿曲線的管子（雕塑的線條） */
function tube(points: [number, number, number][], r: number, c: THREE.ColorRepresentation) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return paint(new THREE.TubeGeometry(curve, 48, r, 6, false), c);
}

/** 一般設施（路燈、座椅、停車架…） */
export function propGeometry(kind: string, P: PropPalette): THREE.BufferGeometry | null {
  const s = (k: string) => P[k] as string;
  const list = (k: string) => P[k] as string[];
  const parts: THREE.BufferGeometry[] = [];
  switch (kind) {
    case 'lamp': // 校園步道燈：細桿＋燈籠
      parts.push(cyl(0.06, 0.08, 3.6, 0, 0, 0, s('metal')), cyl(0.22, 0.16, 0.45, 0, 3.6, 0, s('lampGlass'), 8), cyl(0.28, 0.05, 0.15, 0, 4.05, 0, s('metal'), 8));
      break;
    case 'street_lamp': // 道路路燈：高桿＋懸臂
      parts.push(cyl(0.09, 0.12, 8, 0, 0, 0, s('metal')), box(1.6, 0.1, 0.1, 0.8, 7.9, 0, s('metal')), box(0.6, 0.12, 0.3, 1.5, 7.8, 0, s('lampGlass')));
      break;
    case 'bench':
      parts.push(box(1.8, 0.07, 0.5, 0, 0.45, 0, s('wood')), box(1.8, 0.35, 0.06, 0, 0.75, -0.24, s('wood')),
        box(0.08, 0.45, 0.5, -0.8, 0.22, 0, s('metal')), box(0.08, 0.45, 0.5, 0.8, 0.22, 0, s('metal')));
      break;
    case 'bin':
      parts.push(cyl(0.25, 0.22, 0.85, -0.3, 0, 0, s('bin')), cyl(0.25, 0.22, 0.85, 0.3, 0, 0, s('binRecycle')));
      break;
    case 'bike_parking': {
      const c = list('bikes');
      for (let i = 0; i < 5; i++) parts.push(box(0.06, 0.9, 1.7, -1.6 + i * 0.8, 0.5, 0, c[i % c.length]));
      break;
    }
    case 'scooter_parking': {
      const c = list('scooters');
      for (let i = 0; i < 6; i++) parts.push(box(0.6, 1.0, 1.8, -2.5 + i * 1, 0.5, 0, c[i % c.length]));
      break;
    }
    case 'youbike':
      for (let i = 0; i < 4; i++) parts.push(box(0.1, 1.0, 1.7, -1.2 + i * 0.8, 0.5, 0, s('youbike')));
      parts.push(box(0.4, 1.6, 0.4, 2, 0.8, 0, s('youbike')));
      break;
    case 'bus_stop':
      parts.push(cyl(0.05, 0.05, 2.8, 0, 0, 0, s('metal')), box(0.6, 0.8, 0.05, 0, 2.5, 0, s('busSign')));
      break;
    case 'bus_shelter': // 公車候車亭：背面兩根柱撐起平頂雨遮，玻璃背板、長椅，旁邊立站牌；正面朝 +z（車道）
      parts.push(cyl(0.07, 0.07, 2.6, -1.8, 0, -0.65, s('metal')), cyl(0.07, 0.07, 2.6, 1.8, 0, -0.65, s('metal')),
        box(4.3, 0.14, 1.9, 0, 2.66, 0, s('shelterRoof')), box(4.3, 0.32, 0.06, 0, 2.45, 0.93, s('busSign')),
        box(3.5, 1.9, 0.04, 0, 1.25, -0.66, s('shelterGlass')), box(2.6, 0.07, 0.42, 0, 0.46, -0.38, s('wood')),
        box(0.07, 0.44, 0.36, -1.2, 0.22, -0.38, s('metal')), box(0.07, 0.44, 0.36, 1.2, 0.22, -0.38, s('metal')),
        cyl(0.05, 0.05, 2.9, 2.5, 0, 0.6, s('metal')), box(0.6, 0.8, 0.05, 2.5, 2.55, 0.6, s('busSign')));
      break;
    case 'floodlight': // 廣場投光燈柱：高桿頂端一排燈頭（下沉廣場、站前廣場）
      parts.push(cyl(0.14, 0.2, 12, 0, 0, 0, s('metal')), box(2.2, 0.15, 0.15, 0, 12, 0, s('metal')));
      for (const x of [-0.8, 0, 0.8]) parts.push(box(0.55, 0.45, 0.35, x, 12.35, 0.1, s('lampGlass')));
      break;
    case 'traffic_light':
      parts.push(cyl(0.08, 0.08, 4.5, 0, 0, 0, s('metal')), box(0.35, 1.0, 0.35, 0, 4.2, 0, s('signalHead')));
      break;
    case 'flagpole':
      parts.push(cyl(0.05, 0.07, 10, 0, 0, 0, s('pole')), box(1.8, 1.2, 0.03, 0.92, 9.2, 0, s('flag')));
      break;
    case 'water_fountain':
      parts.push(box(0.6, 1.0, 0.5, 0, 0.5, 0, s('steel')));
      break;
    case 'vending':
      parts.push(box(1, 1.8, 0.8, 0, 0.9, 0, s('vending')));
      break;
    case 'phone':
      parts.push(box(0.5, 2.2, 0.5, 0, 1.1, 0, s('phone')));
      break;
    case 'fountain':
      parts.push(cyl(2.2, 2.4, 0.6, 0, 0, 0, s('stone'), 16), cyl(1.9, 1.9, 0.05, 0, 0.56, 0, s('water'), 16), cyl(0.25, 0.35, 1.4, 0, 0, 0, s('stone')));
      break;
    case 'artwork':
      return artworkGeometry({ type: 'monolith' }, P, 'default');
    default:
      return null;
  }
  return mergeGeometries(parts);
}

/** 雕塑：type 決定造型，height 是總高（含底座），color / color2 覆寫材質色 */
export function artworkGeometry(m: PropModel, P: PropPalette, seed: string): THREE.BufferGeometry {
  const c1 = m.color ?? (P.bronze as string), c2 = m.color2 ?? (P.stone as string);
  const H = m.height ?? 3;
  const ped = m.pedestal ?? 0.5, pw = m.pedestalWidth ?? 1.4;
  const parts: THREE.BufferGeometry[] = [];
  if (ped > 0) parts.push(box(pw, ped, pw, 0, ped / 2, 0, c2));
  const h = H - ped, y0 = ped;
  const r = (k: string) => hash01(seed + k);
  switch (m.type) {
    case 'curve': // 細長的 S 形線條（蠕沐春風）
      parts.push(tube([[0, y0, 0], [0.4, y0 + h * 0.3, 0.2], [-0.5, y0 + h * 0.6, -0.1], [0.3, y0 + h * 0.85, 0.1], [1.2, y0 + h, 0.4]], 0.07, c1));
      break;
    case 'abstract': // 兩支腳撐起扭轉的翼片（飛撲、展翅）
      parts.push(box(0.12, h * 0.55, 0.12, -0.5, y0 + h * 0.275, 0, c1), box(0.12, h * 0.55, 0.12, 0.6, y0 + h * 0.275, 0.2, c1));
      for (let i = 0; i < 4; i++) {
        const g = new THREE.BoxGeometry(2.4 - i * 0.3, 0.08, 0.7).rotateZ(0.35 - i * 0.25).rotateY(i * 0.7 + r('a') * 0.5).translate(i * 0.15, y0 + h * (0.6 + i * 0.1), 0);
        parts.push(paint(g, c1));
      }
      break;
    case 'spiky_ball': { // 放射狀尖刺球（繭）
      const R = h * 0.35, cy = y0 + h * 0.5;
      parts.push(sphere(R * 0.75, 0, cy, 0, c2, 1));
      const n = 70;
      for (let i = 0; i < n; i++) {
        const t = Math.acos(1 - (2 * (i + 0.5)) / n), p = Math.PI * (1 + Math.sqrt(5)) * i;
        const dir = new THREE.Vector3(Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p));
        const g = new THREE.ConeGeometry(0.06, R * 0.9, 4).translate(0, R * 0.75 + R * 0.45, 0)
          .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)).translate(0, cy, 0);
        parts.push(paint(g, i % 3 === 0 ? c2 : c1));
      }
      break;
    }
    case 'figure_pair': // 兩個舞動的人形（舞動）
      for (const [dx, lean] of [[-0.45, 0.25], [0.45, -0.3]] as const) {
        parts.push(paint(new THREE.CapsuleGeometry(0.16, h * 0.42, 3, 6).rotateZ(lean).translate(dx, y0 + h * 0.45, 0), c1));
        parts.push(sphere(0.16, dx - lean * 0.6, y0 + h * 0.86, 0, c1, 1));
        parts.push(paint(new THREE.CapsuleGeometry(0.06, h * 0.32, 2, 5).rotateZ(lean * 3).translate(dx * 0.4, y0 + h * 0.7, 0), c1));
        parts.push(paint(new THREE.CapsuleGeometry(0.07, h * 0.36, 2, 5).rotateZ(-lean * 1.5).translate(dx * 1.2, y0 + h * 0.15, 0), c1));
      }
      break;
    case 'block_figure': // 方塊堆成的人形（十字手、思想者）
      parts.push(box(0.9, h * 0.5, 0.6, 0, y0 + h * 0.25, 0, c1), box(1.8, h * 0.18, 0.55, 0, y0 + h * 0.62, 0, c1), box(0.6, h * 0.25, 0.5, 0, y0 + h * 0.84, 0, c1));
      break;
    case 'seated': // 抱膝坐姿人像（思想者）：大腿、弓起的背、頭
      parts.push(paint(new THREE.CapsuleGeometry(0.22, h * 0.45, 3, 8).rotateZ(Math.PI / 2 - 0.35).translate(0.15, y0 + h * 0.3, 0), c1));
      parts.push(paint(new THREE.CapsuleGeometry(0.25, h * 0.4, 3, 8).rotateZ(-0.45).translate(-0.35, y0 + h * 0.5, 0), c1));
      parts.push(paint(new THREE.CapsuleGeometry(0.12, h * 0.35, 2, 6).rotateZ(0.9).translate(0.05, y0 + h * 0.62, 0.15), c1));
      parts.push(sphere(0.2, -0.1, y0 + h * 0.82, 0, c1, 1));
      break;
    case 'frame_disc': // 方框中嵌鏡面圓盤（東西門）
      parts.push(box(h, h, 0.3, 0, y0 + h / 2, 0, c1));
      parts.push(paint(new THREE.CylinderGeometry(h * 0.32, h * 0.32, 0.4, 24).rotateX(Math.PI / 2).translate(0, y0 + h / 2, 0), c2));
      break;
    case 'tower_loop': // 細高的不鏽鋼板＋頂端圓環（夢之塔）
      parts.push(paint(new THREE.CylinderGeometry(0.15, 0.6, h * 0.8, 4).translate(0, y0 + h * 0.4, 0), c1));
      parts.push(paint(new THREE.TorusGeometry(h * 0.12, 0.08, 6, 20).translate(0, y0 + h * 0.85, 0), c1));
      break;
    case 'rings': // 直立圓環（圓算盤）
      for (let i = 0; i < 3; i++) parts.push(paint(new THREE.TorusGeometry(h * (0.42 - i * 0.08), 0.05, 5, 24).rotateY(i * 0.5).translate(0, y0 + h / 2, 0), c1));
      break;
    case 'cube': // 立方體（傾斜立在一角）
      parts.push(paint(new THREE.BoxGeometry(h * 0.6, h * 0.6, h * 0.6).rotateX(0.62).rotateZ(0.78).translate(0, y0 + h * 0.5, 0), c1));
      break;
    case 'standing': // 站姿全身像（穿長袍）：下襬展開的袍子、軀幹、雙臂、頭，一手按在腰間的劍上（鄭成功像）
      parts.push(paint(new THREE.CylinderGeometry(h * 0.1, h * 0.17, h * 0.5, 10).translate(0, y0 + h * 0.25, 0), c1));
      parts.push(paint(new THREE.CylinderGeometry(h * 0.09, h * 0.1, h * 0.28, 10).translate(0, y0 + h * 0.64, 0), c1));
      parts.push(paint(new THREE.CapsuleGeometry(h * 0.035, h * 0.26, 2, 6).rotateZ(0.25).translate(-h * 0.13, y0 + h * 0.6, 0), c1));
      parts.push(paint(new THREE.CapsuleGeometry(h * 0.035, h * 0.22, 2, 6).rotateZ(-0.5).translate(h * 0.12, y0 + h * 0.58, h * 0.04), c1));
      parts.push(box(h * 0.03, h * 0.4, h * 0.03, h * 0.17, y0 + h * 0.35, h * 0.06, c1));
      parts.push(sphere(h * 0.075, 0, y0 + h * 0.86, 0, c1, 1), box(h * 0.16, h * 0.05, h * 0.16, 0, y0 + h * 0.95, 0, c1));
      break;
    case 'bust': // 胸像
      parts.push(box(0.5, h * 0.55, 0.5, 0, y0 + h * 0.275, 0, c2), box(0.7, h * 0.18, 0.35, 0, y0 + h * 0.64, 0, c1), sphere(0.2, 0, y0 + h * 0.85, 0, c1, 1));
      break;
    case 'gate': { // 校門：兩根門柱＋橫楣
      const w = m.width ?? 8;
      parts.push(box(1, h, 1, -w / 2, h / 2, 0, c2), box(1, h, 1, w / 2, h / 2, 0, c2), box(w + 1.6, 0.8, 1.2, 0, h - 0.4, 0, c1));
      break;
    }
    case 'paifang': { // 牌坊：兩根方柱立在黑色基座上，深橫楣上半是菱形魚鱗紋、正中嵌題字（大學路牌坊）
      const w = m.width ?? 11, pw = 1.3, base = 1.1, c3 = m.color3 ?? (P.stone as string);
      for (const sx of [-1, 1]) {
        parts.push(box(pw + 0.5, base, pw + 0.5, (sx * w) / 2, base / 2, 0, c2), box(pw, H - base, pw, (sx * w) / 2, base + (H - base) / 2, 0, c1));
      }
      const lw = w + pw + 0.6, top = H, band = 1.6, plain = 1.5;
      parts.push(box(lw, plain, 1.5, 0, top - band - plain / 2, 0, c1), box(lw, band, 1.7, 0, top - band / 2, 0, c3));
      for (const fz of [-0.86, 0.86]) {
        for (let row = 0; row < 3; row++) for (let x = -lw / 2 + 0.4 + (row % 2) * 0.25; x < lw / 2 - 0.3; x += 0.5) {
          parts.push(paint(new THREE.BoxGeometry(0.3, 0.3, 0.06).rotateZ(Math.PI / 4).translate(x, top - 0.35 - row * 0.45, fz), c1));
        }
        for (let i = 0; i < 4; i++) parts.push(box(0.55, 0.55, 0.05, (i - 1.5) * 1.6, top - band - plain / 2, fz * 0.88, c2));
      }
      break;
    }
    case 'booth': { // 警衛亭：深色玻璃方盒、平頂、紅色招牌（width 是長邊）
      const w = m.width ?? 7, d = 2.6, c3 = m.color3 ?? (P.flag as string);
      parts.push(box(w, H - 0.4, d, 0, (H - 0.4) / 2, 0, c1), box(w + 0.4, 0.4, d + 0.4, 0, H - 0.2, 0, c2));
      for (const fz of [-1, 1]) parts.push(box(1.6, 0.4, 0.05, w * 0.2, H - 1.0, fz * (d / 2 + 0.03), c3));
      break;
    }
    case 'banner_row': { // 一排旗桿掛直式長旗，顏色輪流取 colors（沒寫就用 style.json 的 props.banners）
      const n = m.count ?? 8, sp = m.spacing ?? 3.5, colors = m.colors ?? (P.banners as string[]);
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * sp;
        parts.push(cyl(0.06, 0.09, H, x, 0, 0, P.pole as string), box(0.04, H * 0.32, 0.9, x, H * 0.76, 0.5, colors[i % colors.length]));
      }
      break;
    }
    default: // monolith：抽象石碑
      parts.push(box(0.7, h, 0.35, 0, y0 + h / 2, 0, c1));
  }
  return mergeGeometries(parts);
}

/** 所有設施的網格：一般設施依種類合成 InstancedMesh，有 model 的各自一個網格 */
export function buildPropMeshes(props: Prop[], P: PropPalette): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const byKind = new Map<string, Prop[]>();
  const custom: THREE.BufferGeometry[] = [];
  for (const p of props) {
    if (p.model) {
      const g = artworkGeometry(p.model, P, p.name ?? `${p.pos}`);
      g.rotateY(((p.rot ?? hash01(`${p.pos}`) * 360) * Math.PI) / 180).translate(p.pos[0], p.y ?? 0, p.pos[1]);
      custom.push(g);
      continue;
    }
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind)!.push(p);
  }
  for (const [kind, list] of byKind) {
    const geo = propGeometry(kind, P);
    if (!geo) continue;
    const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    list.forEach((p, i) => {
      const deg = p.rot ?? hash01(`${kind}${p.pos[0]}${p.pos[1]}`) * 360;
      q.setFromAxisAngle(up, (deg * Math.PI) / 180);
      m.compose(new THREE.Vector3(p.pos[0], p.y ?? 0, p.pos[1]), q, one);
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    im.computeBoundingSphere();
    out.push(im);
  }
  if (custom.length) {
    const mesh = new THREE.Mesh(mergeGeometries(custom), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = true;
    out.push(mesh);
  }
  return out;
}


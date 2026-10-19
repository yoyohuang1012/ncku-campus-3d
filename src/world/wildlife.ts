// 水池裡的動物：鴨子在水面上隨機游、偶爾停下來；烏龜在池岸石邊曬太陽，隔一陣子下水游到另一處岸邊。
// 種類、數量、顏色、速度寫在 overrides/wildlife.json，水面與池岸高度用 style.json 的 water。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Area, WaterStyle, WildlifeGroup, XZ } from '../core/types';
import { pointInRing } from './collision';

function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color);
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** 鴨子（頭朝本地 -z，長度 1 公尺，用 size 縮放）；color 寫成「身體/頭」 */
function duckGeometry(color: string) {
  const [body, head] = color.split('/');
  return mergeGeometries([
    paint(new THREE.SphereGeometry(0.5, 10, 7).scale(0.62, 0.42, 1).translate(0, 0.12, 0), body),
    paint(new THREE.ConeGeometry(0.14, 0.32, 6).rotateX(-Math.PI / 2 - 0.5).translate(0, 0.3, 0.48), body), // 尾巴翹起
    paint(new THREE.SphereGeometry(0.2, 9, 7).translate(0, 0.52, -0.38), head ?? body),
    paint(new THREE.CylinderGeometry(0.11, 0.13, 0.32, 7).translate(0, 0.36, -0.36), head ?? body), // 脖子
    paint(new THREE.BoxGeometry(0.12, 0.06, 0.2).translate(0, 0.48, -0.6), '#f0a030'), // 嘴
  ]);
}

/** 烏龜（頭朝本地 -z，長度 1 公尺）：半球殼＋頭＋四隻腳 */
function turtleGeometry(color: string) {
  const [shell, skin] = color.split('/');
  const leg = (x: number, z: number) => paint(new THREE.BoxGeometry(0.18, 0.08, 0.22).translate(x, 0.06, z), skin ?? '#5a6b3a');
  return mergeGeometries([
    paint(new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.8, 0.45, 1).translate(0, 0.06, 0), shell),
    paint(new THREE.CylinderGeometry(0.44, 0.44, 0.06, 12).scale(0.92, 1, 1.15).translate(0, 0.06, 0), skin ?? '#5a6b3a'), // 腹甲
    paint(new THREE.SphereGeometry(0.13, 8, 6).scale(1, 0.8, 1.3).translate(0, 0.12, -0.58), skin ?? '#5a6b3a'),
    leg(-0.34, -0.3), leg(0.34, -0.3), leg(-0.34, 0.3), leg(0.34, 0.3),
  ]);
}

interface Animal {
  group: WildlifeGroup;
  mesh: THREE.Mesh;
  pos: XZ;
  target: XZ;
  heading: number;
  /** 停下來（鴨子休息、烏龜曬太陽）剩幾秒 */
  rest: number;
  /** 烏龜是否在岸上 */
  basking: boolean;
  phase: number;
}

export class Wildlife {
  private animals: Animal[] = [];
  private time = 0;
  private rand: () => number;

  constructor(groups: WildlifeGroup[], areas: Area[], scene: THREE.Scene, private water: WaterStyle | undefined) {
    let s = 1017;
    this.rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (const g of groups) {
      const area = areas.find((a) => a.kind === 'water' && (a.id === g.water || a.name === g.water));
      if (!area) { console.warn('wildlife.json 找不到水域', g.water); continue; }
      for (let i = 0; i < g.count; i++) {
        const color = g.colors[i % g.colors.length];
        const geo = g.kind === 'duck' ? duckGeometry(color) : turtleGeometry(color);
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
        mesh.scale.setScalar(g.size * (0.85 + this.rand() * 0.3));
        mesh.castShadow = true;
        scene.add(mesh);
        const a: Animal = { group: g, mesh, pos: [0, 0], target: [0, 0], heading: this.rand() * Math.PI * 2, rest: this.rand() * 8, basking: false, phase: this.rand() * 10 };
        if (g.kind === 'turtle') {
          // 烏龜一開始大多在岸邊曬太陽
          a.pos = this.shorePoint(area);
          a.basking = this.rand() < 0.75;
          a.rest = 10 + this.rand() * 40;
          if (!a.basking) a.pos = this.waterPoint(area);
        } else a.pos = this.waterPoint(area);
        a.target = a.pos;
        (a as Animal & { area: Area }).area = area;
        this.animals.push(a);
      }
    }
  }

  private inWater(area: Area, p: XZ, margin = 0) {
    if (!pointInRing(p[0], p[1], area.outer) || area.holes.some((h) => pointInRing(p[0], p[1], h))) return false;
    if (margin <= 0) return true;
    // 離岸至少 margin：往八個方向探一下
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const q: XZ = [p[0] + Math.cos(a) * margin, p[1] + Math.sin(a) * margin];
      if (!pointInRing(q[0], q[1], area.outer) || area.holes.some((h) => pointInRing(q[0], q[1], h))) return false;
    }
    return true;
  }

  private waterPoint(area: Area, near?: XZ, radius = 25): XZ {
    const xs = area.outer.map((p) => p[0]), zs = area.outer.map((p) => p[1]);
    for (let i = 0; i < 80; i++) {
      const p: XZ = near
        ? [near[0] + (this.rand() - 0.5) * 2 * radius, near[1] + (this.rand() - 0.5) * 2 * radius]
        : [Math.min(...xs) + this.rand() * (Math.max(...xs) - Math.min(...xs)), Math.min(...zs) + this.rand() * (Math.max(...zs) - Math.min(...zs))];
      if (this.inWater(area, p, 1.2) && (!near || this.clearPath(area, near, p))) return p;
    }
    return near ?? area.outer[0];
  }

  /** 直線過去不會穿過岸或島 */
  private clearPath(area: Area, a: XZ, b: XZ) {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.8);
    for (let i = 1; i < n; i++) if (!this.inWater(area, [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])) return false;
    return true;
  }

  /** 池岸（含島）上隨機一點 */
  private shorePoint(area: Area): XZ {
    const rings = [area.outer, ...area.holes];
    const ring = rings[Math.floor(this.rand() * rings.length) % rings.length];
    const i = Math.floor(this.rand() * ring.length) % ring.length, j = (i + 1) % ring.length;
    const t = this.rand();
    return [ring[i][0] + (ring[j][0] - ring[i][0]) * t, ring[i][1] + (ring[j][1] - ring[i][1]) * t];
  }

  update(dt: number, player: XZ) {
    this.time += dt;
    const level = this.water?.level ?? 0.05, rim = this.water?.rimHeight ?? 0.3;
    for (const a of this.animals) {
      const area = (a as Animal & { area: Area }).area;
      // 太遠就不更新（看不到）
      if (Math.hypot(a.pos[0] - player[0], a.pos[1] - player[1]) > 400) continue;
      const g = a.group;
      if (a.rest > 0) {
        a.rest -= dt;
        if (a.rest <= 0) {
          if (g.kind === 'turtle' && a.basking) {
            // 曬夠了：下水，游到附近另一處岸邊
            a.basking = false;
            a.pos = this.waterPoint(area, a.pos, 4);
            a.target = this.waterPoint(area, a.pos, 20);
          } else a.target = this.waterPoint(area, a.pos, g.kind === 'duck' ? 18 : 20);
        }
      } else {
        const dx = a.target[0] - a.pos[0], dz = a.target[1] - a.pos[1], d = Math.hypot(dx, dz);
        if (d < 0.3) {
          if (g.kind === 'turtle' && this.rand() < 0.6) {
            // 爬上最近的岸邊曬太陽
            const rings = [area.outer, ...area.holes];
            let best: XZ = a.pos, bd = Infinity;
            for (const r of rings) for (const p of r) { const dd = Math.hypot(p[0] - a.pos[0], p[1] - a.pos[1]); if (dd < bd) { bd = dd; best = p; } }
            if (bd < 8) { a.pos = [best[0], best[1]]; a.basking = true; a.rest = 20 + this.rand() * 60; }
            else a.rest = 2 + this.rand() * 4;
          } else a.rest = g.kind === 'duck' ? (this.rand() < 0.3 ? 3 + this.rand() * 8 : 0.2) : 2 + this.rand() * 5;
        } else {
          const want = Math.atan2(-dx, -dz);
          const diff = Math.atan2(Math.sin(want - a.heading), Math.cos(want - a.heading));
          a.heading += diff * Math.min(1, dt * 2.5);
          const step = Math.min(d, g.speed * dt * (Math.abs(diff) > 1 ? 0.4 : 1));
          a.pos = [a.pos[0] - Math.sin(a.heading) * step, a.pos[1] - Math.cos(a.heading) * step];
          if (!this.inWater(area, a.pos)) { a.pos = [a.pos[0] + Math.sin(a.heading) * step, a.pos[1] + Math.cos(a.heading) * step]; a.target = this.waterPoint(area, a.pos, 10); }
        }
      }
      // 高度：鴨子浮在水面輕輕上下；烏龜游泳時只露出殼頂，曬太陽時在池岸石上
      let y = level;
      if (g.kind === 'duck') y = level - 0.03 * g.size + Math.sin(this.time * 2 + a.phase) * 0.015;
      else y = a.basking ? rim : level - 0.16 * g.size;
      a.mesh.position.set(a.pos[0], y, a.pos[1]);
      a.mesh.rotation.y = a.heading;
    }
  }
}

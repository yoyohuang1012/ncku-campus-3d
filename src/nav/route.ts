// 路線導航：計算路徑、在地上畫箭頭、抵達時通知。
import * as THREE from 'three';
import type { XZ } from '../core/types';
import type { NavGraph } from './navgraph';

export interface RouteTarget {
  name: string;
  /** 終點候選（建築入口或中心），會挑最近的可達點 */
  points: XZ[];
}

export class RouteGuide {
  path: XZ[] | null = null;
  target: RouteTarget | null = null;
  private arrows: THREE.InstancedMesh;
  private time = 0;
  onArrive: ((t: RouteTarget) => void) | null = null;
  onChange: (() => void) | null = null;

  constructor(private nav: NavGraph, scene: THREE.Scene, color: string, private spacing: number, private arriveDistance: number, renderOrder: number) {
    // 地面上的 V 形箭頭
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.9);
    shape.lineTo(0.8, -0.1);
    shape.lineTo(0.5, -0.4);
    shape.lineTo(0, 0.3);
    shape.lineTo(-0.5, -0.4);
    shape.lineTo(-0.8, -0.1);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
    this.arrows = new THREE.InstancedMesh(geo, mat, 2000);
    this.arrows.count = 0;
    this.arrows.renderOrder = renderOrder;
    this.arrows.frustumCulled = false;
    scene.add(this.arrows);
  }

  /** 從玩家位置導航到目標，成功回傳路線長度（公尺） */
  start(from: XZ, target: RouteTarget): number | null {
    const a = this.nav.nearest(from[0], from[1]);
    let best: XZ[] | null = null, bestLen = Infinity;
    for (const p of target.points) {
      const b = this.nav.nearest(p[0], p[1]);
      const path = this.nav.findPath(a, b);
      if (!path) continue;
      const len = pathLength(path);
      if (len < bestLen) { bestLen = len; best = path; }
    }
    if (!best) return null;
    this.path = [from, ...best];
    this.target = target;
    this.layoutArrows();
    this.onChange?.();
    return bestLen;
  }

  clear() {
    this.path = null;
    this.target = null;
    this.arrows.count = 0;
    this.onChange?.();
  }

  update(dt: number, player: XZ) {
    if (!this.path || !this.target) return;
    this.time += dt;
    (this.arrows.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(this.time * 4) * 0.25;
    const end = this.path[this.path.length - 1];
    if (Math.hypot(end[0] - player[0], end[1] - player[1]) < this.arriveDistance) {
      const t = this.target;
      this.clear();
      this.onArrive?.(t);
      return;
    }
    // 走過的路段收掉：找出離玩家最近的路段，之前的刪除
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < Math.min(this.path.length - 1, 60); i++) {
      const d = distToSegment(player, this.path[i], this.path[i + 1]);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI > 0 && bestD < 8) {
      this.path = [player, ...this.path.slice(bestI + 1)];
      this.layoutArrows();
    } else if (bestD < 8) {
      this.path[0] = player;
    }
  }

  remaining(): number {
    return this.path ? pathLength(this.path) : 0;
  }

  private layoutArrows() {
    const path = this.path!;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    let count = 0;
    let carry = this.spacing * 0.5;
    for (let i = 0; i < path.length - 1 && count < 2000; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      // 箭頭的 -Z 為前方（shape 的 +y 經旋轉後朝 -z）
      q.setFromAxisAngle(up, Math.atan2(-(bx - ax), -(bz - az)));
      let d = carry;
      while (d < len && count < 2000) {
        const f = d / len;
        m.compose(new THREE.Vector3(ax + (bx - ax) * f, 0.05, az + (bz - az) * f), q, s);
        this.arrows.setMatrixAt(count++, m);
        d += this.spacing;
      }
      carry = d - len;
    }
    this.arrows.count = count;
    this.arrows.instanceMatrix.needsUpdate = true;
  }
}

export function pathLength(path: XZ[]): number {
  let len = 0;
  for (let i = 0; i < path.length - 1; i++) len += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  return len;
}

function distToSegment(p: XZ, a: XZ, b: XZ): number {
  const ex = b[0] - a[0], ez = b[1] - a[1];
  const l2 = ex * ex + ez * ez || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2));
  return Math.hypot(p[0] - (a[0] + ex * t), p[1] - (a[1] + ez * t));
}

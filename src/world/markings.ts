// 道路標線：車道中線（主要道路雙黃線、其他白色虛線）、路緣白線，以及步道穿越車道處的斑馬線。
// 粗細、虛線長度、哪些道路畫雙黃線都在 style.json 的 markings。
import * as THREE from 'three';
import type { MarkingStyle, Road, XZ } from '../core/types';
import { RibbonBuilder } from './geometry';

const FOOT = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'steps']);

/** 把折線切成虛線段 */
function dashes(points: XZ[], dash: number, gap: number): XZ[][] {
  const out: XZ[][] = [];
  let cur: XZ[] = [], on = true, left = dash;
  for (let i = 0; i < points.length - 1; i++) {
    let [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    let L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / (L || 1), uz = (bz - az) / (L || 1);
    if (on && !cur.length) cur.push([ax, az]);
    while (L > left) {
      ax += ux * left; az += uz * left; L -= left;
      if (on) { cur.push([ax, az]); out.push(cur); cur = []; } else cur = [[ax, az]];
      on = !on;
      left = on ? dash : gap;
    }
    left -= L;
    if (on) cur.push([bx, bz]);
  }
  if (on && cur.length >= 2) out.push(cur);
  return out;
}

function intersect(p: XZ, p2: XZ, q: XZ, q2: XZ): XZ | null {
  const rx = p2[0] - p[0], rz = p2[1] - p[1], sx = q2[0] - q[0], sz = q2[1] - q[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * sz - (q[1] - p[1]) * sx) / den;
  const u = ((q[0] - p[0]) * rz - (q[1] - p[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p[0] + rx * t, p[1] + rz * t] : null;
}

export function buildMarkings(roads: Road[], vehicleKinds: Set<string>, m: MarkingStyle, y: number): THREE.BufferGeometry {
  const rb = new RibbonBuilder();
  const white = new THREE.Color(m.white), yellow = new THREE.Color(m.yellow);
  const lanes = roads.filter((r) => !r.tunnel && vehicleKinds.has(r.kind));
  for (const r of lanes) {
    if (m.doubleYellow.includes(r.kind)) {
      rb.add(r.points, m.lineWidth, y, yellow, 0.15);
      rb.add(r.points, m.lineWidth, y, yellow, -0.15);
    } else if (r.width >= m.centerMinWidth) {
      for (const d of dashes(r.points, m.dash, m.gap)) rb.add(d, m.lineWidth, y, white);
    }
    if (r.width >= m.edgeMinWidth) {
      rb.add(r.points, m.lineWidth, y, white, r.width / 2 - 0.4);
      rb.add(r.points, m.lineWidth, y, white, -(r.width / 2 - 0.4));
    }
  }

  // 斑馬線：步道和車道相交的地方，橫跨整條車道畫一排平行於車道的白色條紋
  const box = (pts: XZ[]) => {
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  };
  const laneBoxes = lanes.map((r) => box(r.points));
  const done: XZ[] = [];
  for (const f of roads) {
    if (!FOOT.has(f.kind) || f.tunnel || f.bridge) continue;
    const fb = box(f.points);
    lanes.forEach((r, k) => {
      const lb = laneBoxes[k];
      if (fb[1] < lb[0] || fb[0] > lb[1] || fb[3] < lb[2] || fb[2] > lb[3]) return;
      for (let i = 0; i < f.points.length - 1; i++) for (let j = 0; j < r.points.length - 1; j++) {
        const p = intersect(f.points[i], f.points[i + 1], r.points[j], r.points[j + 1]);
        if (!p || done.some((d) => Math.hypot(d[0] - p[0], d[1] - p[1]) < m.zebra.length + 1)) continue;
        done.push(p);
        const a = r.points[j], b = r.points[j + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, vx = -uz, vz = ux;
        const half = r.width / 2 - 0.5;
        for (let s = -half; s <= half; s += m.zebra.stripe + m.zebra.gap) {
          const cx = p[0] + vx * s, cz = p[1] + vz * s;
          rb.add([[cx - (ux * m.zebra.length) / 2, cz - (uz * m.zebra.length) / 2], [cx + (ux * m.zebra.length) / 2, cz + (uz * m.zebra.length) / 2]], m.zebra.stripe, y, white);
        }
      }
    });
  }
  return rb.build();
}

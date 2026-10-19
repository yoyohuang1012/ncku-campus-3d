// 校園周邊街景：沿校區邊界自動產生紅磚圍牆（遇到出入口、建築、既有圍牆會斷開）與內外兩排樹。
// 設定在 overrides/streetscape.json，同一套規則可以套到其他校區。
import type { Barrier, Building, LocationRef, Road, StreetscapeConfig, WorldData, XZ } from '../core/types';
import { pointInRing } from './collision';
import { hash01, insetRing } from './geometry';

function segIntersect(p: XZ, p2: XZ, q: XZ, q2: XZ): number | null {
  // 回傳 p→p2 上的參數 t（0~1），沒有交點則 null
  const r = [p2[0] - p[0], p2[1] - p[1]], s = [q2[0] - q[0], q2[1] - q[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
  const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

function distToPolyline(p: XZ, pts: XZ[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t));
  }
  return best;
}

/** 校區內的路燈、座椅、垃圾桶，加進 world.props */
function applyFurniture(world: WorldData, f: NonNullable<StreetscapeConfig['furniture']>[number]) {
  const region = world.regions.find((r) => r.id === f.region);
  if (!region) return;
  const ring = region.polygon;
  const inside = (p: XZ) => pointInRing(p[0], p[1], ring);
  const buildings = world.buildings.filter((b) => b.outer.some((p) => inside(p)));
  const blocked = (p: XZ, pad: number) => buildings.some((b) => pointInRing(p[0], p[1], b.outer) || distToPolyline(p, [...b.outer, b.outer[0]]) < pad);
  const placed: XZ[] = world.props.map((p) => p.pos);
  const free = (p: XZ, gap: number) => placed.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > gap);
  const add = (kind: string, p: XZ, rot: number) => {
    placed.push(p);
    world.props.push({ kind, pos: [+p[0].toFixed(2), +p[1].toFixed(2)], rot: +rot.toFixed(1) });
  };
  const deg = (r: number) => (r * 180) / Math.PI;

  // 外圍人行道路燈：懸臂朝向街道
  const sl = f.streetLamps;
  if (sl) {
    const streets = world.roads.filter((r) => r.name && sl.streets.some((s) => r.name!.startsWith(s)));
    const row = insetRing(ring, -sl.offset);
    for (let i = 0; i < row.length; i++) {
      const a = row[i], b = row[(i + 1) % row.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1) continue;
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
      // 外法線：從校區中心往外的那一側
      let nx = tz, nz = -tx;
      const mid: XZ = [(a[0] + b[0]) / 2 + nx, (a[1] + b[1]) / 2 + nz];
      if (inside(mid)) { nx = -nx; nz = -nz; }
      for (let s = sl.spacing / 2; s < len; s += sl.spacing) {
        const p: XZ = [a[0] + tx * s, a[1] + tz * s];
        if (!streets.some((r) => distToPolyline(p, r.points) < sl.maxStreetDistance) || blocked(p, 1) || !free(p, 3)) continue;
        add('street_lamp', p, deg(Math.atan2(-nz, nx)));
      }
    }
  }

  // 校內步道：步道燈兩側交錯，座椅面向步道
  const pl = f.pathLamps, bn = f.benches;
  const kinds = new Set([...(pl?.kinds ?? []), ...(bn?.kinds ?? [])]);
  const paths = world.roads.filter((r) => kinds.has(r.kind) && !r.tunnel && r.points.some((p) => inside(p)));
  let benchCount = 0;
  for (const r of paths) {
    const lamps = pl?.kinds.includes(r.kind), benches = bn?.kinds.includes(r.kind);
    let along = 0, nextLamp = lamps ? pl!.spacing / 2 : Infinity, nextBench = benches ? bn!.spacing / 2 : Infinity, side = 1;
    for (let k = 0; k < r.points.length - 1; k++) {
      const a = r.points[k], b = r.points[k + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) continue;
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
      while (pl && nextLamp < along + len) {
        const t = nextLamp - along, off = (pl.offset + r.width / 2) * side;
        const p: XZ = [a[0] + tx * t + tz * off, a[1] + tz * t - tx * off];
        if (inside(p) && !blocked(p, 0.8) && free(p, 4)) add('lamp', p, 0);
        side = -side;
        nextLamp += pl.spacing;
      }
      while (bn && nextBench < along + len) {
        const t = nextBench - along, off = bn.offset + r.width / 2;
        const p: XZ = [a[0] + tx * t + tz * off, a[1] + tz * t - tx * off];
        if (inside(p) && !blocked(p, 1.5) && free(p, 3)) {
          add('bench', p, deg(Math.atan2(-tz, tx)));
          if (++benchCount % bn.binEvery === 0) {
            const q: XZ = [p[0] + tx * 1.6, p[1] + tz * 1.6];
            if (!blocked(q, 0.5)) add('bin', q, deg(Math.atan2(-tz, tx)));
          }
        }
        nextBench += bn.spacing;
      }
      along += len;
    }
  }
}

const NOT_CARRIAGEWAY = ['service', 'footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'corridor'];

/** 林蔭大道：沿同名道路兩側每 spacing 公尺種一棵，避開建築 */
function applyAvenue(world: WorldData, a: NonNullable<StreetscapeConfig['avenues']>[number], toXZ: (ref: LocationRef) => XZ | null) {
  const ways = world.roads.filter((r) => r.name === a.road && !r.tunnel);
  if (!ways.length) { console.warn('streetscape.json 找不到林蔭大道', a.road); return; }
  const center = a.within ? toXZ(a.within) : null;
  const inside = (p: XZ) => !center || Math.hypot(p[0] - center[0], p[1] - center[1]) <= a.within!.radius;
  if (a.replace) world.trees = world.trees.filter((t) => !inside([t[0], t[1]]) || !ways.some((r) => distToPolyline([t[0], t[1]], r.points) < a.offset + 2));
  const src = a.kind === 'palm' ? 4 : 0;
  const inBuilding = (p: XZ) => world.buildings.some((b) => !b.roofOnly && pointInRing(p[0], p[1], b.outer));
  for (const r of ways) {
    // 沿線累積距離，每 spacing 公尺取一點，兩側各種一棵
    let next = a.spacing / 2, walked = 0;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, az] = r.points[i], [bx, bz] = r.points[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (; next <= walked + L; next += a.spacing) {
        const s = next - walked;
        const cx = ax + ((bx - ax) * s) / L, cz = az + ((bz - az) * s) / L;
        for (const side of [-1, 1]) {
          const p: XZ = [+(cx + nx * side * a.offset).toFixed(2), +(cz + nz * side * a.offset).toFixed(2)];
          if (inside(p) && !inBuilding(p)) world.trees.push([p[0], p[1], src]);
        }
      }
      walked += L;
    }
  }
}

/** 沒寫朝向的候車亭、站牌：正面（local +z）轉向最近的車道 */
function alignToRoad(world: WorldData, a: NonNullable<StreetscapeConfig['alignProps']>) {
  const roads = world.roads.filter((r) => !r.tunnel && !NOT_CARRIAGEWAY.includes(r.kind));
  for (const p of world.props) {
    if (p.rot != null || !a.kinds.includes(p.kind)) continue;
    let best = a.maxDistance, dir: XZ | null = null;
    for (const r of roads) for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, az] = r.points[i], [bx, bz] = r.points[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((p.pos[0] - ax) * dx + (p.pos[1] - az) * dz) / (dx * dx + dz * dz || 1)));
      const qx = ax + dx * t - p.pos[0], qz = az + dz * t - p.pos[1], d = Math.hypot(qx, qz);
      if (d < best && d > 0.01) { best = d; dir = [qx / d, qz / d]; }
    }
    if (dir) p.rot = +((Math.atan2(dir[0], dir[1]) * 180) / Math.PI).toFixed(1);
  }
}

/** 依設定為每個校區產生圍牆與樹，直接加進 world.barriers / world.trees */
export function applyStreetscape(world: WorldData, cfg: StreetscapeConfig | null, toXZ: (ref: LocationRef) => XZ | null) {
  if (!cfg) return;
  for (const f of cfg.furniture ?? []) applyFurniture(world, f);
  if (cfg.alignProps) alignToRoad(world, cfg.alignProps);
  for (const per of cfg.perimeters) {
    const region = world.regions.find((r) => r.id === per.region);
    if (!region) continue;
    const ring = region.polygon;
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    const box = { x0: Math.min(...xs) - 60, x1: Math.max(...xs) + 60, z0: Math.min(...zs) - 60, z1: Math.max(...zs) + 60 };
    const near = (pts: XZ[]) => pts.some((p) => p[0] > box.x0 && p[0] < box.x1 && p[1] > box.z0 && p[1] < box.z1);
    const roads = world.roads.filter((r) => !r.tunnel && near(r.points));
    const streets = roads.filter((r) => r.name && per.streets.some((s) => r.name!.startsWith(s)));
    const buildings = world.buildings.filter((b) => !b.roofOnly && near(b.outer));
    const walls = world.barriers.filter((b) => near(b.points));
    const inBuilding = (p: XZ, pad = 0) => buildings.some((b: Building) => {
      if (pointInRing(p[0], p[1], b.outer)) return true;
      return pad > 0 && distToPolyline(p, [...b.outer, b.outer[0]]) < pad;
    });
    const nearStreet = (p: XZ, maxD: number) => streets.some((s) => distToPolyline(p, s.points) < maxD);
    // 只避開真正的車道；路邊停車格常被標成窄的 service 道路，行道樹就種在它和圍牆之間
    const carriageways = roads.filter((r: Road) => !['service', 'footway', 'path', 'pedestrian', 'steps', 'cycleway'].includes(r.kind));
    const onCarriageway = (p: XZ) => carriageways.some((r) => distToPolyline(p, r.points) < r.width / 2 + 0.8);

    // ---- 圍牆 ----
    const w = per.wall;
    if (w) {
      const wallRing = insetRing(ring, w.inset);
      const openings = (w.openings ?? []).flatMap((o) => {
        const p = toXZ(o);
        return p ? [{ p, r: o.width / 2 }] : [];
      });
      const out: Barrier[] = [];
      for (let i = 0; i < wallRing.length; i++) {
        const a = wallRing[i], b = wallRing[(i + 1) % wallRing.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1) continue;
        // 出入口：道路、步道穿越處
        const gates: number[] = [];
        for (const r of roads) for (let k = 0; k < r.points.length - 1; k++) {
          const t = segIntersect(a, b, r.points[k], r.points[k + 1]);
          if (t != null) gates.push(t * len);
        }
        // 以 1 公尺取樣，判斷每一小段要不要蓋牆
        const step = 1;
        let run: XZ[] = [];
        const flush = () => {
          if (run.length >= 2) out.push({ id: `perimeter-${per.region}-${out.length}`, kind: w.kind ?? 'wall', height: w.height, points: run });
          run = [];
        };
        for (let s = 0; s <= len; s += step) {
          const t = Math.min(s, len) / len;
          const p: XZ = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          const ok = gates.every((g) => Math.abs(g - s) > w.gateWidth / 2)
            && openings.every((o) => Math.hypot(p[0] - o.p[0], p[1] - o.p[1]) > o.r)
            && nearStreet(p, w.maxStreetDistance)
            && !inBuilding(p, 0.5)
            && !walls.some((bar) => distToPolyline(p, bar.points) < w.skipNearExisting);
          if (ok) run.push(p);
          else flush();
        }
        flush();
      }
      world.barriers.push(...out);
    }

    // ---- 樹 ----
    const t = per.trees;
    if (t) {
      const existing = world.trees.filter((tr) => tr[0] > box.x0 && tr[0] < box.x1 && tr[1] > box.z0 && tr[1] < box.z1).map((tr) => [tr[0], tr[1]] as XZ);
      const placeRow = (rowRing: XZ[], spacing: number, src: number, clearance: number, minGap: number) => {
        for (let i = 0; i < rowRing.length; i++) {
          const a = rowRing[i], b = rowRing[(i + 1) % rowRing.length];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let s = spacing / 2; s < len; s += spacing) {
            const j = (hash01(`${per.region}${src}${i},${s}`) - 0.5) * spacing * 0.3;
            const k = Math.max(0, Math.min(len, s + j)) / len;
            const p: XZ = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
            if (!nearStreet(p, t.maxStreetDistance) || onCarriageway(p) || inBuilding(p, clearance)) continue;
            if (existing.some((e) => Math.hypot(e[0] - p[0], e[1] - p[1]) < minGap)) continue;
            existing.push(p);
            world.trees.push([+p[0].toFixed(2), +p[1].toFixed(2), src]);
          }
        }
      };
      if (t.outside) placeRow(insetRing(ring, -t.outside.offset), t.outside.spacing, 0, 1.5, t.outside.spacing * 0.6);
      if (t.inside) placeRow(insetRing(ring, t.inside.offset), t.inside.spacing, 1, 3, t.inside.spacing * 0.6);
    }
  }
  for (const a of cfg.avenues ?? []) applyAvenue(world, a, toXZ);
}

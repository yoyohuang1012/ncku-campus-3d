// 2D 碰撞：校園地面是平的，所以用俯視的線段（牆面）與圓（樹幹）判斷即可，手機上也很省效能。
// 之後加入室內、樓梯時，可以在這個介面後面換成 3D 物理引擎，呼叫端不用改。
import type { XZ } from '../core/types';

interface Segment { ax: number; az: number; bx: number; bz: number }
interface Circle { x: number; z: number; r: number }

export class Collision {
  private cell = 16;
  private segGrid = new Map<number, Segment[]>();
  private circleGrid = new Map<number, Circle[]>();
  /** 封閉區域（建築、水池），用來判斷某點是否在裡面 */
  private solids: { ring: XZ[]; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];

  private key(cx: number, cz: number) {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  addSegment(a: XZ, b: XZ) {
    const s = { ax: a[0], az: a[1], bx: b[0], bz: b[1] };
    const c = this.cell;
    const x0 = Math.floor(Math.min(a[0], b[0]) / c), x1 = Math.floor(Math.max(a[0], b[0]) / c);
    const z0 = Math.floor(Math.min(a[1], b[1]) / c), z1 = Math.floor(Math.max(a[1], b[1]) / c);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this.key(x, z);
      let arr = this.segGrid.get(k);
      if (!arr) this.segGrid.set(k, (arr = []));
      arr.push(s);
    }
  }

  addPolyline(points: XZ[], closed: boolean) {
    for (let i = 0; i < points.length - 1; i++) this.addSegment(points[i], points[i + 1]);
    if (closed && points.length > 2) this.addSegment(points[points.length - 1], points[0]);
  }

  /** 走得上去的橋面：中心線 [x, y, z] 與半寬；heightAt 用 */
  private decks: { pts: [number, number, number][]; hw: number; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];

  /** 封閉區域；gap 為真的邊（約 1 公尺一段）不擋路，例如水池上有橋的地方 */
  addSolid(ring: XZ[], gap?: (x: number, z: number) => boolean) {
    if (!gap) this.addPolyline(ring, true);
    else for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let k = 0; k < n; k++) {
        const p: XZ = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        const q: XZ = [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n];
        if (!gap((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) this.addSegment(p, q);
      }
    }
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    this.solids.push({ ring, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
  }

  addCircle(x: number, z: number, r: number) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let arr = this.circleGrid.get(k);
    if (!arr) this.circleGrid.set(k, (arr = []));
    arr.push({ x, z, r });
  }

  addDeck(pts: [number, number, number][], halfWidth: number) {
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[2]);
    this.decks.push({ pts, hw: halfWidth, minX: Math.min(...xs) - halfWidth, maxX: Math.max(...xs) + halfWidth, minZ: Math.min(...zs) - halfWidth, maxZ: Math.max(...zs) + halfWidth });
  }

  private onDeck(x: number, z: number) {
    return this.deckHeight(x, z) != null && this.heightAt(x, z) !== 0;
  }

  /** 站在哪個橋面、樓梯、下沉廣場地坪上；兩端是平的（不會延伸到端點外），不在任何面上回傳 null */
  private deckHeight(x: number, z: number): number | null {
    let best: number | null = null;
    for (const d of this.decks) {
      if (x < d.minX || x > d.maxX || z < d.minZ || z > d.maxZ) continue;
      for (let i = 0; i < d.pts.length - 1; i++) {
        const [ax, ay, az] = d.pts[i], [bx, by, bz] = d.pts[i + 1];
        const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
        const raw = ((x - ax) * dx + (z - az) * dz) / L;
        if ((i === 0 && raw < 0) || (i === d.pts.length - 2 && raw > 1)) continue;
        const t = Math.max(0, Math.min(1, raw));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) <= d.hw) best = Math.max(best ?? -Infinity, ay + (by - ay) * t);
      }
    }
    return best;
  }

  /** 腳下的高度：站在橋面上是橋面高度、在下沉廣場裡是負的，否則 0 */
  heightAt(x: number, z: number): number {
    return this.deckHeight(x, z) ?? 0;
  }

  isInsideSolid(x: number, z: number): boolean {
    if (this.onDeck(x, z)) return false;
    for (const s of this.solids) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      if (pointInRing(x, z, s.ring)) return true;
    }
    return false;
  }

  /** 把半徑 r 的圓從 (x,z) 移動 (dx,dz)，碰到牆會沿牆滑動。回傳新位置。 */
  move(x: number, z: number, dx: number, dz: number, r: number): XZ {
    // 移動量大時分段，避免穿牆
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (r * 0.8)));
    for (let s = 0; s < steps; s++) {
      x += dx / steps;
      z += dz / steps;
      [x, z] = this.resolve(x, z, r);
    }
    return [x, z];
  }

  private resolve(x: number, z: number, r: number): XZ {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let iter = 0; iter < 3; iter++) {
      let pushed = false;
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const segs = this.segGrid.get(this.key(gx, gz));
        if (segs) for (const s of segs) {
          const ex = s.bx - s.ax, ez = s.bz - s.az;
          const len2 = ex * ex + ez * ez || 1e-9;
          let tt = ((x - s.ax) * ex + (z - s.az) * ez) / len2;
          tt = Math.max(0, Math.min(1, tt));
          const px = s.ax + ex * tt, pz = s.az + ez * tt;
          const ddx = x - px, ddz = z - pz;
          const d = Math.hypot(ddx, ddz);
          if (d < r && d > 1e-6) {
            x = px + (ddx / d) * r;
            z = pz + (ddz / d) * r;
            pushed = true;
          }
        }
        const circles = this.circleGrid.get(this.key(gx, gz));
        if (circles) for (const c of circles) {
          const ddx = x - c.x, ddz = z - c.z;
          const d = Math.hypot(ddx, ddz);
          const min = r + c.r;
          if (d < min && d > 1e-6) {
            x = c.x + (ddx / d) * min;
            z = c.z + (ddz / d) * min;
            pushed = true;
          }
        }
      }
      if (!pushed) break;
    }
    return [x, z];
  }
}

export function pointInRing(x: number, z: number, ring: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

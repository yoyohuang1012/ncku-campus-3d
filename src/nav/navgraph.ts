// 步行路網：找最近的路上節點、A* 最短路徑。資料來自 public/data/world/nav.json。
import type { NavData, XZ } from '../core/types';

export class NavGraph {
  readonly nodes: XZ[];
  private adj: { to: number; w: number }[][];
  private grid = new Map<number, number[]>();
  private cell = 25;

  constructor(data: NavData) {
    this.nodes = data.nodes;
    this.adj = this.nodes.map(() => []);
    for (const [a, b] of data.edges) {
      const w = Math.hypot(this.nodes[a][0] - this.nodes[b][0], this.nodes[a][1] - this.nodes[b][1]);
      this.adj[a].push({ to: b, w });
      this.adj[b].push({ to: a, w });
    }
    this.nodes.forEach(([x, z], i) => {
      const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(i);
    });
  }

  private key(cx: number, cz: number) {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  /** 最近的路網節點；filter 可排除不想要的點（例如在建築裡的） */
  nearest(x: number, z: number, filter?: (i: number) => boolean): number {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bestD = Infinity;
    for (let r = 0; r < 40; r++) {
      for (let gx = cx - r; gx <= cx + r; gx++) for (let gz = cz - r; gz <= cz + r; gz++) {
        if (Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) !== r) continue;
        const arr = this.grid.get(this.key(gx, gz));
        if (!arr) continue;
        for (const i of arr) {
          const d = Math.hypot(this.nodes[i][0] - x, this.nodes[i][1] - z);
          if (d < bestD && (!filter || filter(i))) { bestD = d; best = i; }
        }
      }
      // 已找到且下一圈不可能更近就停止
      if (best >= 0 && bestD < r * this.cell) break;
    }
    return best;
  }

  /** A* 最短路徑，回傳經過的座標 */
  findPath(from: number, to: number): XZ[] | null {
    if (from < 0 || to < 0) return null;
    const n = this.nodes.length;
    const g = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const h = (i: number) => Math.hypot(this.nodes[i][0] - this.nodes[to][0], this.nodes[i][1] - this.nodes[to][1]);
    const heap = new MinHeap();
    g[from] = 0;
    heap.push(from, h(from));
    while (heap.size) {
      const u = heap.pop();
      if (u === to) break;
      if (closed[u]) continue;
      closed[u] = 1;
      for (const { to: v, w } of this.adj[u]) {
        const ng = g[u] + w;
        if (ng < g[v]) { g[v] = ng; prev[v] = u; heap.push(v, ng + h(v)); }
      }
    }
    if (g[to] === Infinity) return null;
    const path: XZ[] = [];
    for (let u = to; u !== -1; u = prev[u]) path.push(this.nodes[u]);
    return path.reverse();
  }
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() { return this.items.length; }
  push(item: number, p: number) {
    this.items.push(item); this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent); i = parent;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!, lastP = this.prio.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem; this.prio[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}

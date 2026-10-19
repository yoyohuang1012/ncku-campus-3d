// 路人：沿步行路網隨機走動的人，讓校園有人來人往的感覺（不能對話）。
// 人數、速度、每小時人潮比例在 config/game.json 的 walkers；外觀清單在 npcs/crowd.json。
// 只在玩家附近放人：走太遠的路人會換到玩家附近、但不在眼前憑空出現。
import * as THREE from 'three';
import type { GameClock } from '../core/clock';
import type { CrowdPalette, GameConfig, Road, XZ } from '../core/types';
import type { NavGraph } from '../nav/navgraph';
import { animateWalk, createCharacter, type CharacterRig } from '../player/character';

type WalkerConfig = NonNullable<GameConfig['walkers']>;

interface Walker {
  rig: CharacterRig;
  from: number;
  to: number;
  prev: number;
  /** 在這條邊上走了幾公尺 */
  along: number;
  speed: number;
  /** 靠右的距離（公尺）；沿車道走時會加上半個路寬，走在人行道上 */
  side: number;
  pos: XZ;
  facing: number;
}

const PEDESTRIAN = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'living_street', 'track', 'corridor']);

export class WalkerManager {
  private walkers: Walker[] = [];
  private rand: () => number;
  /** 路網邊 → 半個車道寬（步道是 0） */
  private edgeHalfWidth = new Map<string, number>();
  private max: number;

  constructor(
    private cfg: WalkerConfig,
    private palette: CrowdPalette,
    private nav: NavGraph,
    roads: Road[],
    private scene: THREE.Scene,
    private clock: GameClock,
    private isWalkable: (x: number, z: number) => boolean,
    private heightAt: (x: number, z: number) => number,
    mobile: boolean,
  ) {
    let s = 20261019;
    this.rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    this.max = mobile ? cfg.mobileCount : cfg.count;
    // 路網的點就是 OSM 道路的點：用座標對回道路種類，車道上的路人改走路邊
    const key = (p: XZ) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    for (const r of roads) {
      const half = PEDESTRIAN.has(r.kind) ? 0 : r.width / 2;
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = key(r.points[i]), b = key(r.points[i + 1]);
        this.edgeHalfWidth.set(`${a}|${b}`, half);
        this.edgeHalfWidth.set(`${b}|${a}`, half);
      }
    }
  }

  private halfWidth(a: number, b: number) {
    const k = (p: XZ) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    return this.edgeHalfWidth.get(`${k(this.nav.nodes[a])}|${k(this.nav.nodes[b])}`) ?? 0;
  }

  private pick<T>(list: T[]): T {
    return list[Math.floor(this.rand() * list.length) % list.length];
  }

  /** 玩家附近找一條可以走的邊。在攝影機前方時 minDist 以內不放（避免在眼前憑空出現），背後可以近一點 */
  private spawn(player: XZ, minDist: number, forward: XZ | null): Walker | null {
    for (let tries = 0; tries < 12; tries++) {
      const ang = this.rand() * Math.PI * 2, r = 8 + this.rand() * (this.cfg.spawnRadius - 8);
      const from = this.nav.nearest(player[0] + Math.cos(ang) * r, player[1] + Math.sin(ang) * r);
      if (from < 0) continue;
      const nb = this.nav.neighbors(from);
      if (!nb.length) continue;
      const to = this.pick(nb);
      const a = this.nav.nodes[from];
      const dx = a[0] - player[0], dz = a[1] - player[1], d = Math.hypot(dx, dz);
      const behind = forward ? dx * forward[0] + dz * forward[1] < -0.3 * d : false;
      if (d < (behind ? 12 : minDist) || d > this.cfg.spawnRadius || !this.isWalkable(a[0], a[1])) continue;
      // 隨機放在這段路上，且不和別的路人擠在一起
      const b = this.nav.nodes[to], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const along = this.rand() * len;
      const at: XZ = [a[0] + ((b[0] - a[0]) * along) / (len || 1), a[1] + ((b[1] - a[1]) * along) / (len || 1)];
      if (this.walkers.some((o) => Math.hypot(o.pos[0] - at[0], o.pos[1] - at[1]) < 4)) continue;
      const p = this.palette;
      const rig = createCharacter({
        shirt: this.pick(p.shirts), pants: this.pick(p.pants), skin: this.pick(p.skins), hair: this.pick(p.hairs),
        bag: this.rand() < p.bagChance ? this.pick(p.bags) : undefined,
      });
      if (!this.cfg.shadows) rig.root.traverse((o) => { o.castShadow = false; });
      // 身高稍有不同
      rig.root.scale.setScalar(0.92 + this.rand() * 0.14);
      this.scene.add(rig.root);
      const [s0, s1] = this.cfg.speed;
      const w: Walker = {
        rig, from, to, prev: -1, along, speed: s0 + this.rand() * (s1 - s0),
        side: 0.4 + this.rand() * 1.4, pos: at, facing: Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])),
      };
      return w;
    }
    return null;
  }

  private remove(w: Walker) {
    this.scene.remove(w.rig.root);
  }

  /** 現在這個小時應該有幾個路人 */
  private target() {
    const d = this.cfg.density;
    const hour = this.clock.now().getHours();
    return Math.round(this.max * (d[hour] ?? 1));
  }

  private last: XZ | null = null;

  /** forward：攝影機看的水平方向（單位向量），用來判斷哪裡是玩家背後 */
  update(dt: number, player: XZ, forward: XZ | null = null) {
    const want = this.target();
    // 傳送（一幀移動很遠）時，把路人全部換到新位置附近
    const jumped = this.last != null && Math.hypot(player[0] - this.last[0], player[1] - this.last[1]) > 60;
    this.last = [player[0], player[1]];
    if (jumped) { for (const w of this.walkers) this.remove(w); this.walkers = []; }
    // 一開始或傳送後直接放滿（可以出現在近一點的地方）；之後每幀最多補 2 個
    const first = this.walkers.length === 0;
    for (let k = 0; this.walkers.length < want && (first || k < 2); k++) {
      const w = this.spawn(player, first ? 8 : this.cfg.minSpawnDistance, first ? null : forward);
      if (!w) break;
      this.walkers.push(w);
    }
    while (this.walkers.length > want) this.remove(this.walkers.pop()!);

    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i];
      if (Math.hypot(w.pos[0] - player[0], w.pos[1] - player[1]) > this.cfg.despawnRadius) {
        this.remove(w);
        const n = this.spawn(player, this.cfg.minSpawnDistance, forward);
        if (n) this.walkers[i] = n;
        else { this.walkers.splice(i, 1); i--; }
        continue;
      }
      let a = this.nav.nodes[w.from], b = this.nav.nodes[w.to];
      let len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      w.along += w.speed * dt;
      // 走到下一個路口：往相鄰的路隨機轉，盡量不回頭
      while (w.along >= len) {
        w.along -= len;
        const nb = this.nav.neighbors(w.to).filter((n) => n !== w.from);
        const next = nb.length ? this.pick(nb) : w.from;
        w.prev = w.from; w.from = w.to; w.to = next;
        a = this.nav.nodes[w.from]; b = this.nav.nodes[w.to];
        len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.01;
      }
      const t = len > 0 ? w.along / len : 0;
      const dx = (b[0] - a[0]) / (len || 1), dz = (b[1] - a[1]) / (len || 1);
      // 靠右走（右手邊是 (-dz, dx)），車道上再往外推半個路寬
      const off = w.side + this.halfWidth(w.from, w.to);
      let x = a[0] + (b[0] - a[0]) * t - dz * off, z = a[1] + (b[1] - a[1]) * t + dx * off;
      if (!this.isWalkable(x, z)) { x = a[0] + (b[0] - a[0]) * t; z = a[1] + (b[1] - a[1]) * t; }
      w.pos = [x, z];
      const facing = Math.atan2(-dx, -dz);
      const diff = Math.atan2(Math.sin(facing - w.facing), Math.cos(facing - w.facing));
      w.facing += diff * Math.min(1, dt * 6);
      w.rig.root.position.set(x, this.heightAt(x, z), z);
      w.rig.root.rotation.y = w.facing;
      animateWalk(w.rig, w.speed, dt);
    }
  }

  /** 小地圖用：路人位置 */
  get positions(): XZ[] {
    return this.walkers.map((w) => w.pos);
  }
}

// NPC 管理：依遊戲時鐘決定每個 NPC 今天幾點出現在哪裡，處理靠近提示與面向玩家。
// 新增 NPC 只要改 public/data/npcs/npcs.json，不用改程式。
import * as THREE from 'three';
import { parseHHMM, type GameClock } from '../core/clock';
import type { GameData } from '../core/data';
import type { NpcDef, NpcScheduleEntry, XZ } from '../core/types';
import type { NavGraph } from '../nav/navgraph';
import { animateIdle, createCharacter, type CharacterRig } from '../player/character';
import { hash01 } from '../world/geometry';

export interface ActiveNpc {
  def: NpcDef;
  entry: NpcScheduleEntry;
  rig: CharacterRig;
  pos: XZ;
  baseFacing: number;
  facing: number;
}

export class NpcManager {
  readonly active = new Map<string, ActiveNpc>();
  private lastCheck = -1;
  private time = 0;

  constructor(
    private data: GameData,
    private clock: GameClock,
    private nav: NavGraph,
    private scene: THREE.Scene,
    private isWalkable: (x: number, z: number) => boolean,
  ) {}

  /** 找出目前生效的排程（由上往下第一筆符合的） */
  private currentEntry(def: NpcDef): NpcScheduleEntry | null {
    const now = this.clock.now();
    const date = this.clock.dateId(now), wd = this.clock.weekdayId(now), min = this.clock.minuteOfDay(now);
    for (const e of def.schedule) {
      if (e.dates?.length) { if (!e.dates.includes(date)) continue; }
      else if (e.days && e.days !== 'all' && !e.days.includes(wd)) continue;
      const from = parseHHMM(e.from), to = parseHHMM(e.to);
      const inTime = from <= to ? min >= from && min < to : min >= from || min < to; // 支援跨午夜
      if (inTime) return e;
    }
    return null;
  }

  /** 把位置設定轉成實際站位；寫建築時會站到建築旁的路上 */
  private placeFor(def: NpcDef, e: NpcScheduleEntry): { pos: XZ; facing: number } | null {
    const p = this.data.resolveLocation(e.at);
    if (!p) { console.warn(`NPC ${def.id} 的位置找不到`, e.at); return null; }
    let pos: XZ = p;
    let facing = e.facing != null ? (-e.facing * Math.PI) / 180 : 0;
    if ('building' in e.at || !this.isWalkable(p[0], p[1])) {
      const i = this.nav.nearest(p[0], p[1], (n) => this.isWalkable(this.nav.nodes[n][0], this.nav.nodes[n][1]));
      if (i >= 0) {
        const node = this.nav.nodes[i];
        // 同一地點多個 NPC 時錯開一點
        const a = hash01(def.id) * Math.PI * 2;
        pos = [node[0] + Math.cos(a) * 1.2, node[1] + Math.sin(a) * 1.2];
        if (!this.isWalkable(pos[0], pos[1])) pos = [node[0], node[1]];
        if (e.facing == null) facing = Math.atan2(-(p[0] - pos[0]), -(p[1] - pos[1])) + Math.PI; // 背對建築、面向路
      }
    }
    return { pos, facing };
  }

  /** 重新檢查排程（每遊戲分鐘一次） */
  refresh(force = false) {
    const minute = Math.floor(this.clock.now().getTime() / 60000);
    if (!force && minute === this.lastCheck) return;
    this.lastCheck = minute;
    for (const def of this.data.npcs) {
      const entry = this.currentEntry(def);
      const cur = this.active.get(def.id);
      if (cur && cur.entry === entry) continue;
      if (cur) { this.scene.remove(cur.rig.root); this.active.delete(def.id); }
      if (!entry) continue;
      const place = this.placeFor(def, entry);
      if (!place) continue;
      const rig = createCharacter(def.appearance);
      rig.root.position.set(place.pos[0], 0, place.pos[1]);
      rig.root.rotation.y = place.facing;
      this.scene.add(rig.root);
      this.active.set(def.id, { def, entry, rig, pos: place.pos, baseFacing: place.facing, facing: place.facing });
    }
  }

  update(dt: number, player: XZ, interactDistance: number) {
    this.time += dt;
    this.refresh();
    for (const npc of this.active.values()) {
      const dx = player[0] - npc.pos[0], dz = player[1] - npc.pos[1];
      const near = Math.hypot(dx, dz) < interactDistance * 2 && npc.def.interactive;
      // 玩家靠近時轉頭面向玩家
      const target = near ? Math.atan2(-dx, -dz) : npc.baseFacing;
      const diff = Math.atan2(Math.sin(target - npc.facing), Math.cos(target - npc.facing));
      npc.facing += diff * Math.min(1, dt * 5);
      npc.rig.root.rotation.y = npc.facing;
      animateIdle(npc.rig, near && npc.entry.animation === 'dance' ? 'wave' : npc.entry.animation, this.time + hash01(npc.def.id) * 10);
    }
  }

  nearestInteractable(player: XZ, maxDist: number): ActiveNpc | null {
    let best: ActiveNpc | null = null, bestD = maxDist;
    for (const npc of this.active.values()) {
      if (!npc.def.interactive || !npc.entry.dialogue) continue;
      const d = Math.hypot(player[0] - npc.pos[0], player[1] - npc.pos[1]);
      if (d < bestD) { bestD = d; best = npc; }
    }
    return best;
  }
}

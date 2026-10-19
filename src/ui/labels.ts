// 建築名稱與 NPC 名字的浮動標籤：只顯示附近的幾個，避免畫面太亂。
import * as THREE from 'three';
import type { Building, XZ } from '../core/types';
import { el } from './dom';

interface LabelItem { key: string; text: string; sub?: string; pos: THREE.Vector3; kind: 'building' | 'npc' }

export class Labels {
  private pool: HTMLDivElement[] = [];
  private container: HTMLDivElement;
  private v = new THREE.Vector3();

  constructor(root: HTMLElement, private buildings: Building[], private regionName: (id: string) => string, private maxDistance: number, private maxCount: number) {
    this.container = el('div', 'labels', undefined, root);
  }

  update(camera: THREE.Camera, player: XZ, npcs: { name: string; pos: XZ }[]) {
    const items: (LabelItem & { d: number })[] = [];
    for (const b of this.buildings) {
      if (!b.name) continue;
      const d = Math.hypot(b.center[0] - player[0], b.center[1] - player[1]);
      if (d > this.maxDistance) continue;
      items.push({ key: b.id, text: b.name, sub: b.region !== 'outside' ? this.regionName(b.region) : undefined, pos: new THREE.Vector3(b.center[0], b.height + 2, b.center[1]), kind: 'building', d });
    }
    items.sort((a, b) => a.d - b.d);
    items.length = Math.min(items.length, this.maxCount);
    for (const n of npcs) {
      const d = Math.hypot(n.pos[0] - player[0], n.pos[1] - player[1]);
      if (d < 25) items.push({ key: 'npc:' + n.name, text: n.name, pos: new THREE.Vector3(n.pos[0], 2.15, n.pos[1]), kind: 'npc', d });
    }

    const w = window.innerWidth, h = window.innerHeight;
    let used = 0;
    for (const it of items) {
      this.v.copy(it.pos).project(camera);
      if (this.v.z > 1 || this.v.x < -1.1 || this.v.x > 1.1 || this.v.y < -1.1 || this.v.y > 1.1) continue;
      let div = this.pool[used];
      if (!div) { div = el('div', 'label', undefined, this.container); this.pool.push(div); }
      if (div.dataset.key !== it.key) {
        div.dataset.key = it.key;
        div.className = `label label-${it.kind}`;
        div.innerHTML = '';
        el('div', 'label-name', it.text, div);
        if (it.sub) el('div', 'label-sub', it.sub, div);
      }
      div.style.transform = `translate(-50%, -100%) translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px)`;
      div.style.opacity = String(Math.max(0.35, 1 - it.d / (it.kind === 'npc' ? 25 : this.maxDistance)));
      div.style.display = '';
      used++;
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].style.display = 'none';
  }
}

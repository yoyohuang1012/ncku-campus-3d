// 搜尋：建築（含別名）、地點、校區、教室代碼。選取後可導航或傳送。
import type { GameData } from '../core/data';
import { t } from '../core/i18n';
import type { Building, XZ } from '../core/types';
import { button, el } from './dom';

export interface SearchEntry {
  name: string;
  sub: string;
  keys: string[];
  points: XZ[];
  rank: number;
  building?: Building;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s()（）｜|]/g, '').replaceAll('臺', '台');

export function buildSearchIndex(data: GameData): SearchEntry[] {
  const regionName = (id: string) => t(`region.${id}`);
  const detailOf = (id: string) => data.world.regions.find((r) => r.id === id)?.detail;
  const entries = new Map<string, SearchEntry>();

  for (const b of data.world.buildings) {
    if (!b.name) continue;
    const key = `${b.name}@${b.region}`;
    const pts = b.entrances.length ? b.entrances : [b.center];
    const existing = entries.get(key);
    if (existing) { existing.points.push(...pts); continue; }
    const roomKeys = b.rooms.map((r) => r.code);
    entries.set(key, {
      name: b.name,
      sub: regionName(b.region),
      keys: [b.name, ...b.aliases, ...roomKeys].map(norm),
      points: [...pts],
      rank: detailOf(b.region) === 'full' ? 0 : b.region === 'outside' ? 2 : 1,
      building: b,
    });
  }
  for (const p of data.world.pois) {
    const key = `${p.name}@${p.region}`;
    if (entries.has(key)) continue;
    // 停車格、販賣機這類小地點排在後面
    const minor = /停車|機車|單車|腳踏車|ATM|販賣機|廁/.test(p.name);
    entries.set(key, { name: p.name, sub: regionName(p.region), keys: [norm(p.name)], points: [p.pos], rank: (p.region === 'outside' ? 3 : 1) + (minor ? 2 : 0) });
  }
  for (const r of data.world.regions) {
    let x = 0, z = 0;
    for (const p of r.polygon) { x += p[0]; z += p[1]; }
    entries.set(`region:${r.id}`, { name: t(r.nameKey), sub: '', keys: [norm(t(r.nameKey))], points: [[x / r.polygon.length, z / r.polygon.length]], rank: -1 });
  }
  return [...entries.values()];
}

export class SearchPanel {
  private root: HTMLDivElement;
  private input: HTMLInputElement;
  private list: HTMLDivElement;
  isOpen = false;

  constructor(parent: HTMLElement, private index: SearchEntry[], private handlers: { onNavigate(e: SearchEntry): void; onTeleport(e: SearchEntry): void; onOpenChange(open: boolean): void }) {
    this.root = el('div', 'search-panel hidden', undefined, parent);
    const head = el('div', 'search-head', undefined, this.root);
    this.input = el('input', 'search-input', undefined, head);
    this.input.placeholder = t('ui.search.placeholder');
    button('search-close', '✕', () => this.close(), head);
    this.list = el('div', 'search-list', undefined, this.root);
    this.input.addEventListener('input', () => this.render());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      if (e.key === 'Enter') (this.list.querySelector('.search-item-main') as HTMLButtonElement | null)?.click();
    });
  }

  open() {
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.input.value = '';
    this.render();
    setTimeout(() => this.input.focus(), 0);
    this.handlers.onOpenChange(true);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.input.blur();
    this.handlers.onOpenChange(false);
  }

  private render() {
    const q = norm(this.input.value);
    this.list.innerHTML = '';
    if (!q) return;
    const results = this.index
      .map((e) => {
        const hit = e.keys.findIndex((k) => k.includes(q));
        if (hit < 0) return null;
        const starts = e.keys.some((k) => k.startsWith(q)) ? 0 : 1;
        return { e, score: e.rank * 10 + starts * 5 + e.name.length / 100 };
      })
      .filter((x): x is { e: SearchEntry; score: number } => x != null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 25);
    if (!results.length) { el('div', 'search-empty', t('ui.search.empty'), this.list); return; }
    for (const { e } of results) {
      const row = el('div', 'search-item', undefined, this.list);
      const main = button('search-item-main', '', () => { this.close(); this.handlers.onNavigate(e); }, row);
      el('div', 'search-item-name', e.name, main);
      if (e.sub) el('div', 'search-item-sub', e.sub, main);
      button('search-item-btn', t('ui.navigate'), () => { this.close(); this.handlers.onNavigate(e); }, row);
      button('search-item-btn secondary', t('ui.teleport'), () => { this.close(); this.handlers.onTeleport(e); }, row);
    }
  }
}

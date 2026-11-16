// 點選建築時顯示的資訊面板：名稱、校區、樓層、教室清單。
import { t } from '../core/i18n';
import type { Building, Room } from '../core/types';
import { button, el } from './dom';

/** 樓層標示：地下樓層寫 B1，查不到樓層（floor = 0）另外標示 */
export function floorLabel(floor: number): string {
  if (floor < 0) return t('ui.building.floor_basement', { floor: -floor });
  if (floor === 0) return t('ui.building.floor_unknown');
  return t('ui.building.floor', { floor });
}

/** 教室排序：地下 → 地上 → 樓層不明 */
const roomOrder = (a: Room, b: Room) => Number(a.floor === 0) - Number(b.floor === 0) || a.floor - b.floor || a.code.localeCompare(b.code);

export class BuildingInfo {
  private root: HTMLDivElement;
  current: Building | null = null;

  constructor(parent: HTMLElement, private handlers: { onNavigate(b: Building): void; onTeleport(b: Building): void }) {
    this.root = el('div', 'building-info hidden', undefined, parent);
  }

  show(b: Building) {
    this.current = b;
    const r = this.root;
    r.innerHTML = '';
    const head = el('div', 'bi-head', undefined, r);
    el('div', 'bi-name', b.name ?? t('ui.building.unnamed'), head);
    button('bi-close', '✕', () => this.hide(), head);
    // 塔樓等附加量體可能比主體高，樓層數取最高的那個
    const levels = Math.max(b.levels, ...b.parts.filter((p) => !p.roofOnly).map((p) => p.levels));
    el('div', 'bi-sub', `${t(`region.${b.region}`)} · ${t('ui.building.levels', { levels })}`, r);
    if (b.region !== 'outside') {
      el('div', 'bi-section', t('ui.building.rooms'), r);
      if (b.rooms.length) {
        const list = el('div', 'bi-rooms', undefined, r);
        for (const room of [...b.rooms].sort(roomOrder)) {
          el('div', 'bi-room', `${floorLabel(room.floor)}　${room.code}${room.name ? '　' + room.name : ''}`, list);
        }
      } else el('div', 'bi-empty', t('ui.building.no_rooms'), r);
    }
    const actions = el('div', 'bi-actions', undefined, r);
    button('bi-btn', t('ui.navigate'), () => { this.hide(); this.handlers.onNavigate(b); }, actions);
    button('bi-btn secondary', t('ui.teleport'), () => { this.hide(); this.handlers.onTeleport(b); }, actions);
    r.classList.remove('hidden');
  }

  hide() {
    this.current = null;
    this.root.classList.add('hidden');
  }
}

// 點選建築時顯示的資訊面板：名稱、校區、樓層、教室清單。
import { t } from '../core/i18n';
import type { Building } from '../core/types';
import { button, el } from './dom';

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
    el('div', 'bi-sub', `${t(`region.${b.region}`)} · ${t('ui.building.levels', { levels: b.levels })}`, r);
    if (b.region !== 'outside') {
      el('div', 'bi-section', t('ui.building.rooms'), r);
      if (b.rooms.length) {
        const list = el('div', 'bi-rooms', undefined, r);
        for (const room of [...b.rooms].sort((a, c) => a.floor - c.floor || a.code.localeCompare(c.code))) {
          el('div', 'bi-room', `${room.floor}F　${room.code}${room.name ? '　' + room.name : ''}`, list);
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

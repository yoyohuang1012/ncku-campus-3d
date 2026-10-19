// 左上角狀態列（所在區域、日期時間）、導航橫幅、提示訊息、互動按鈕。
import type { GameClock } from '../core/clock';
import { isTouchDevice } from '../core/input';
import { t } from '../core/i18n';
import { button, el } from './dom';

export class Hud {
  private regionEl: HTMLDivElement;
  private timeEl: HTMLDivElement;
  private routeEl: HTMLDivElement;
  private routeText: HTMLSpanElement;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private talkHint: HTMLDivElement;
  private talkBtn: HTMLButtonElement;
  private lastRegion = '';

  constructor(root: HTMLElement, private clock: GameClock, handlers: { onSearch: () => void; onCancelRoute: () => void; onTalk: () => void }) {
    const box = el('div', 'hud-box', undefined, root);
    this.regionEl = el('div', 'hud-region', '', box);
    this.timeEl = el('div', 'hud-time', '', box);
    const row = el('div', 'hud-buttons', undefined, box);
    button('hud-btn', '🔍 ' + t('ui.search'), handlers.onSearch, row);
    if (!isTouchDevice) el('div', 'hud-help', t('ui.help'), root);

    this.routeEl = el('div', 'route-banner hidden', undefined, root);
    this.routeText = el('span', '', '', this.routeEl);
    button('route-cancel', t('ui.route.cancel'), handlers.onCancelRoute, this.routeEl);

    this.toastEl = el('div', 'toast hidden', '', root);

    this.talkHint = el('div', 'talk-hint hidden', '', root);
    this.talkBtn = button('touch-btn talk-btn hidden', t('ui.talk'), handlers.onTalk, root);

    el('div', 'osm-credit', t('app.osm_credit'), root);
  }

  update(regionId: string) {
    if (regionId !== this.lastRegion) {
      this.lastRegion = regionId;
      this.regionEl.textContent = t(`region.${regionId}`);
    }
    const d = this.clock.now();
    const p = (n: number) => String(n).padStart(2, '0');
    this.timeEl.textContent = `${t('hud.date', { month: d.getMonth() + 1, day: d.getDate(), weekday: t(`weekday.${d.getDay()}`) })} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  setRoute(name: string | null, meters = 0) {
    this.routeEl.classList.toggle('hidden', !name);
    if (name) this.routeText.textContent = `${t('ui.route.to', { name })} · ${t('ui.route.distance', { m: Math.round(meters) })}`;
  }

  toast(text: string, ms = 2500) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  setTalkTarget(name: string | null) {
    const show = !!name;
    if (isTouchDevice) {
      this.talkBtn.classList.toggle('hidden', !show);
      if (name) this.talkBtn.textContent = `💬 ${name}`;
    } else {
      this.talkHint.classList.toggle('hidden', !show);
      if (name) this.talkHint.textContent = t('ui.talk.hint', { name });
    }
  }
}

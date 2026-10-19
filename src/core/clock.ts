// 遊戲時鐘：決定今天星期幾、現在幾點，NPC 排程依此判斷。
import type { GameConfig } from './types';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export class GameClock {
  private startReal = Date.now();
  private startGame: number;

  /** 網址加 ?time=10:30 可固定時間（檢視建築用） */
  private fixed: Date | null = null;

  constructor(private cfg: GameConfig['clock']) {
    this.startGame = cfg.mode === 'real' ? Date.now() : new Date(cfg.start).getTime();
    const fixed = new URLSearchParams(location.search).get('time');
    if (fixed && /^\d{1,2}:\d{2}$/.test(fixed)) {
      const d = new Date();
      const [h, m] = fixed.split(':').map(Number);
      d.setHours(h, m, 0, 0);
      this.fixed = d;
    }
  }

  now(): Date {
    if (this.fixed) return new Date(this.fixed);
    if (this.cfg.mode === 'real') return new Date();
    return new Date(this.startGame + (Date.now() - this.startReal) * this.cfg.timeScale);
  }

  /** 例如 "mon" */
  weekdayId(d = this.now()): string {
    return WEEKDAYS[d.getDay()];
  }

  /** 例如 "2026-10-17" */
  dateId(d = this.now()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** 從午夜起算的分鐘數 */
  minuteOfDay(d = this.now()): number {
    return d.getHours() * 60 + d.getMinutes();
  }

  /** 0~24 的小時（含小數），給日夜光影用 */
  hourFloat(d = this.now()): number {
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }
}

export function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}

// 輸入：鍵盤、滑鼠、觸控（虛擬搖桿 + 右半邊拖曳轉視角 + 雙指縮放）。
// 其他模組只讀取整理好的結果，不直接接觸 DOM 事件。
import { t } from './i18n';

export const isTouchDevice = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

type ActionListener = () => void;

export class Input {
  /** 移動方向：x = 右(+)/左(-)，y = 前(+)/後(-)，長度 0~1 */
  readonly move = { x: 0, y: 0 };
  run = false;
  /** 是否有 UI 正在佔用輸入（例如對話、地圖開啟） */
  blocked = false;

  private keys = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private zoomDelta = 0;
  private actions = new Map<string, ActionListener[]>();
  private clickListeners: ((x: number, y: number) => void)[] = [];

  // 觸控
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joyVec = { x: 0, y: 0 };
  private lookTouches = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private pinchDist = 0;
  private runToggle = false;

  constructor(private canvas: HTMLCanvasElement, private uiRoot: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());

    // 滑鼠：拖曳轉視角，沒拖曳的點擊視為「點選」
    let down: { x: number; y: number; moved: boolean } | null = null;
    canvas.addEventListener('mousedown', (e) => { down = { x: e.clientX, y: e.clientY, moved: false }; });
    window.addEventListener('mousemove', (e) => {
      if (!down) return;
      if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 4) down.moved = true;
      if (down.moved && !this.blocked) { this.lookDX += e.movementX; this.lookDY += e.movementY; }
    });
    window.addEventListener('mouseup', (e) => {
      if (down && !down.moved && e.target === canvas) this.clickListeners.forEach((f) => f(e.clientX, e.clientY));
      down = null;
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomDelta += Math.sign(e.deltaY); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    if (isTouchDevice) this.setupTouch();
  }

  /** 註冊動作（interact、map…），鍵盤與觸控按鈕共用 */
  on(action: string, fn: ActionListener) {
    if (!this.actions.has(action)) this.actions.set(action, []);
    this.actions.get(action)!.push(fn);
  }
  trigger(action: string) {
    this.actions.get(action)?.forEach((f) => f());
  }
  onClick(fn: (x: number, y: number) => void) {
    this.clickListeners.push(fn);
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = this.lookDY = 0;
    return r;
  }
  consumeZoom(): number {
    const z = this.zoomDelta;
    this.zoomDelta = 0;
    return z;
  }

  /** 每幀呼叫，整理鍵盤與搖桿的移動方向 */
  update() {
    let x = 0, y = 0;
    if (!this.blocked) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
      x += this.joyVec.x;
      y += this.joyVec.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.move.x = x;
    this.move.y = y;
    this.run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.runToggle || Math.hypot(this.joyVec.x, this.joyVec.y) > 0.95;
  }

  private onKey(e: KeyboardEvent, isDown: boolean) {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (isDown) {
      if (!this.keys.has(e.code)) {
        if (e.code === 'KeyE' || e.code === 'Enter') this.trigger('interact');
        if (e.code === 'KeyM') this.trigger('map');
        if (e.code === 'Escape') this.trigger('escape');
      }
      this.keys.add(e.code);
    } else this.keys.delete(e.code);
  }

  private setupTouch() {
    const base = document.createElement('div');
    base.className = 'joystick';
    const knob = document.createElement('div');
    knob.className = 'joystick-knob';
    base.appendChild(knob);
    this.uiRoot.appendChild(base);

    const runBtn = document.createElement('button');
    runBtn.className = 'touch-btn run-btn';
    runBtn.textContent = '🏃 ' + t('ui.run');
    runBtn.addEventListener('click', () => {
      this.runToggle = !this.runToggle;
      runBtn.classList.toggle('active', this.runToggle);
    });
    this.uiRoot.appendChild(runBtn);

    const R = 55;
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const tch of Array.from(e.changedTouches)) {
        if (tch.clientX < window.innerWidth * 0.4 && this.joyId == null && !this.blocked) {
          this.joyId = tch.identifier;
          this.joyOrigin = { x: tch.clientX, y: tch.clientY };
          base.style.left = `${tch.clientX - R}px`;
          base.style.top = `${tch.clientY - R}px`;
          base.classList.add('active');
        } else {
          this.lookTouches.set(tch.identifier, { x: tch.clientX, y: tch.clientY, sx: tch.clientX, sy: tch.clientY, t: performance.now() });
          if (this.lookTouches.size === 2) this.pinchDist = this.touchDistance();
        }
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const tch of Array.from(e.changedTouches)) {
        if (tch.identifier === this.joyId) {
          let dx = tch.clientX - this.joyOrigin.x;
          let dy = tch.clientY - this.joyOrigin.y;
          const len = Math.hypot(dx, dy);
          if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
          this.joyVec = { x: dx / R, y: -dy / R };
        } else {
          const lt = this.lookTouches.get(tch.identifier);
          if (!lt) continue;
          if (this.lookTouches.size === 1 && !this.blocked) {
            this.lookDX += tch.clientX - lt.x;
            this.lookDY += tch.clientY - lt.y;
          }
          lt.x = tch.clientX;
          lt.y = tch.clientY;
        }
      }
      if (this.lookTouches.size === 2) {
        const d = this.touchDistance();
        if (this.pinchDist > 0) this.zoomDelta += (this.pinchDist - d) / 40;
        this.pinchDist = d;
      }
    }, { passive: false });

    const end = (e: TouchEvent) => {
      for (const tch of Array.from(e.changedTouches)) {
        if (tch.identifier === this.joyId) {
          this.joyId = null;
          this.joyVec = { x: 0, y: 0 };
          knob.style.transform = '';
          base.classList.remove('active');
        } else {
          const lt = this.lookTouches.get(tch.identifier);
          if (lt && Math.hypot(tch.clientX - lt.sx, tch.clientY - lt.sy) < 8 && performance.now() - lt.t < 300) {
            this.clickListeners.forEach((f) => f(tch.clientX, tch.clientY));
          }
          this.lookTouches.delete(tch.identifier);
        }
      }
      if (this.lookTouches.size < 2) this.pinchDist = 0;
    };
    this.canvas.addEventListener('touchend', end);
    this.canvas.addEventListener('touchcancel', end);
  }

  private touchDistance() {
    const [a, b] = Array.from(this.lookTouches.values());
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}

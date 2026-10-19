// 小地圖：右上角小圓圖（北方朝上），點一下展開成全螢幕地圖，可拖曳、縮放、點選地點傳送或導航。
import type { GameData } from '../core/data';
import { t } from '../core/i18n';
import type { XZ } from '../core/types';
import type { OrthoTile } from '../world/ortho';
import { button, el } from './dom';

export interface MinimapHandlers {
  onTeleport(p: XZ): void;
  onNavigate(p: XZ, name: string): void;
  describe(x: number, z: number): string | null;
  onOpenChange(open: boolean): void;
}

export class Minimap {
  private base: HTMLCanvasElement;
  private small: HTMLCanvasElement;
  private smallCtx: CanvasRenderingContext2D;
  private overlay: HTMLDivElement;
  private big: HTMLCanvasElement;
  private bigCtx: CanvasRenderingContext2D;
  private popup: HTMLDivElement;
  private ppm: number;
  private minX: number;
  private minZ: number;
  isOpen = false;
  private view = { x: 0, z: 0, scale: 1 };
  private player: XZ = [0, 0];
  private heading = 0;
  private route: XZ[] | null = null;
  private npcs: XZ[] = [];
  private dpr = Math.min(2, window.devicePixelRatio || 1);

  constructor(root: HTMLElement, private data: GameData, private handlers: MinimapHandlers, private orthoTiles?: OrthoTile[]) {
    const cfg = data.game.minimap;
    const b = data.world.bounds;
    this.ppm = cfg.pixelsPerMeter;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.base = this.renderBase();

    // 手機上縮小，最多佔螢幕寬度的 3 成
    const size = Math.round(Math.min(cfg.smallSize, window.innerWidth * 0.3));
    const wrap = el('div', 'minimap-small', undefined, root);
    wrap.style.width = wrap.style.height = `${size}px`;
    this.small = el('canvas', '', undefined, wrap);
    this.small.width = this.small.height = size * this.dpr;
    this.smallCtx = this.small.getContext('2d')!;
    el('div', 'minimap-label', t('ui.map'), wrap);
    wrap.addEventListener('click', () => this.open());

    this.overlay = el('div', 'map-overlay hidden', undefined, root);
    this.big = el('canvas', 'map-canvas', undefined, this.overlay);
    this.bigCtx = this.big.getContext('2d')!;
    el('div', 'map-hint', t('ui.map.hint'), this.overlay);
    button('map-close', '✕ ' + t('ui.close'), () => this.close(), this.overlay);
    this.popup = el('div', 'map-popup hidden', undefined, this.overlay);
    this.setupBigInput();
    window.addEventListener('resize', () => { if (this.isOpen) this.resizeBig(); });
  }

  open() {
    this.isOpen = true;
    this.overlay.classList.remove('hidden');
    this.popup.classList.add('hidden');
    this.view = { x: this.player[0], z: this.player[1], scale: 1.2 };
    this.resizeBig();
    this.handlers.onOpenChange(true);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.overlay.classList.add('hidden');
    this.handlers.onOpenChange(false);
  }

  toggle() {
    if (this.isOpen) this.close(); else this.open();
  }

  update(player: XZ, heading: number, route: XZ[] | null, npcs: XZ[]) {
    this.player = player;
    this.heading = heading;
    this.route = route;
    this.npcs = npcs;
    this.drawSmall();
    if (this.isOpen) this.drawBig();
  }

  // ---------------- 底圖（只畫一次） ----------------
  private renderBase(): HTMLCanvasElement {
    const { world, style } = this.data;
    const b = world.bounds;
    const c = document.createElement('canvas');
    c.width = Math.ceil((b.maxX - b.minX) * this.ppm);
    c.height = Math.ceil((b.maxZ - b.minZ) * this.ppm);
    const ctx = c.getContext('2d')!;
    const P = (p: XZ): XZ => [(p[0] - this.minX) * this.ppm, (p[1] - this.minZ) * this.ppm];
    const poly = (ring: XZ[], holes: XZ[][] = []) => {
      ctx.beginPath();
      for (const r of [ring, ...holes]) r.forEach((p, i) => { const [x, y] = P(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
    };
    const line = (pts: XZ[]) => {
      ctx.beginPath();
      pts.forEach((p, i) => { const [x, y] = P(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    };

    ctx.fillStyle = style.ground;
    ctx.fillRect(0, 0, c.width, c.height);

    if (this.orthoTiles?.length) {
      // 航照底圖 + 校區外框
      for (const t of this.orthoTiles) {
        const [x0, y0] = P(t.corners[0]);
        const [x1, y1] = P(t.corners[2]);
        ctx.drawImage(t.img, x0, y0, x1 - x0, y1 - y0);
      }
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 220, 120, 0.9)';
      for (const r of world.regions) {
        if (r.detail !== 'full' || r.id === 'station') continue;
        poly(r.polygon); ctx.stroke();
      }
      ctx.setLineDash([]);
      return c;
    }

    for (const r of world.regions) {
      if (r.id === 'station') continue;
      ctx.fillStyle = r.detail === 'full' ? '#c9c0a3' : style.campusGround;
      poly(r.polygon); ctx.fill();
    }
    for (const a of world.areas) {
      ctx.fillStyle = style.areas[a.kind] ?? '#999';
      poly(a.outer, a.holes); ctx.fill('evenodd');
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of world.roads) {
      if (r.tunnel) continue;
      const foot = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'corridor'].includes(r.kind);
      ctx.strokeStyle = foot ? '#efe9dc' : r.kind === 'service' ? '#dcdcdc' : '#ffffff';
      ctx.lineWidth = Math.max(1, r.width * this.ppm * (foot ? 0.8 : 1));
      line(r.points); ctx.stroke();
    }
    if (this.data.worldConfig.railway.showSurfaceTracks) {
      ctx.strokeStyle = '#6b625a';
      ctx.lineWidth = 3 * this.ppm;
      for (const r of world.rails) { line(r.points); ctx.stroke(); }
    }
    for (const bd of world.buildings) {
      if (bd.roofOnly) continue;
      const full = world.regions.find((r) => r.id === bd.region)?.detail === 'full';
      ctx.fillStyle = full ? '#a8937a' : '#b3aea4';
      poly(bd.outer, bd.holes); ctx.fill('evenodd');
      ctx.strokeStyle = full ? '#7d6a55' : '#9b968d';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    return c;
  }

  // ---------------- 小地圖 ----------------
  private drawSmall() {
    const ctx = this.smallCtx;
    const S = this.small.width;
    const R = this.data.game.minimap.smallRadius;
    const scale = S / (2 * R); // 螢幕像素 / 公尺
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = this.data.style.ground;
    ctx.fillRect(0, 0, S, S);
    const sx = (this.player[0] - R - this.minX) * this.ppm, sz = (this.player[1] - R - this.minZ) * this.ppm;
    ctx.drawImage(this.base, sx, sz, 2 * R * this.ppm, 2 * R * this.ppm, 0, 0, S, S);
    const toS = (p: XZ): XZ => [S / 2 + (p[0] - this.player[0]) * scale, S / 2 + (p[1] - this.player[1]) * scale];
    this.drawOverlays(ctx, toS, scale * 4);
    ctx.restore();
    this.drawPlayer(ctx, S / 2, S / 2, 9 * this.dpr);
  }

  // ---------------- 大地圖 ----------------
  private resizeBig() {
    this.big.width = window.innerWidth * this.dpr;
    this.big.height = window.innerHeight * this.dpr;
    this.big.style.width = `${window.innerWidth}px`;
    this.big.style.height = `${window.innerHeight}px`;
    this.drawBig();
  }

  private bigToWorld(cx: number, cy: number): XZ {
    const s = this.view.scale;
    return [this.view.x + (cx - window.innerWidth / 2) / s, this.view.z + (cy - window.innerHeight / 2) / s];
  }

  private drawBig() {
    const ctx = this.bigCtx;
    const d = this.dpr, s = this.view.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#8f8c85';
    ctx.fillRect(0, 0, this.big.width, this.big.height);
    ctx.setTransform(d * s / this.ppm, 0, 0, d * s / this.ppm, d * (window.innerWidth / 2 - (this.view.x - this.minX) * s), d * (window.innerHeight / 2 - (this.view.z - this.minZ) * s));
    ctx.imageSmoothingEnabled = s < 3;
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const toS = (p: XZ): XZ => [window.innerWidth / 2 + (p[0] - this.view.x) * s, window.innerHeight / 2 + (p[1] - this.view.z) * s];
    this.drawOverlays(ctx, toS, Math.max(3, s * 2.5));
    // 區域名稱
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px system-ui, sans-serif';
    for (const r of this.data.world.regions) {
      let x = 0, z = 0;
      for (const p of r.polygon) { x += p[0]; z += p[1]; }
      const [px, py] = toS([x / r.polygon.length, z / r.polygon.length]);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(t(r.nameKey), px, py);
      ctx.fillStyle = r.detail === 'full' ? '#7a2e10' : '#444';
      ctx.fillText(t(r.nameKey), px, py);
    }
    // 建築名稱（放大時才顯示）
    if (s > 1.6) {
      ctx.font = '12px system-ui, sans-serif';
      for (const b of this.data.world.buildings) {
        if (!b.name || b.region === 'outside') continue;
        const [px, py] = toS(b.center);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.strokeText(b.name, px, py);
        ctx.fillStyle = '#222';
        ctx.fillText(b.name, px, py);
      }
    }
    const [px, py] = toS(this.player);
    this.drawPlayer(ctx, px, py, 10);
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, toS: (p: XZ) => XZ, lineW: number) {
    if (this.route && this.route.length > 1) {
      ctx.strokeStyle = this.data.style.route;
      ctx.lineWidth = lineW;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.route.forEach((p, i) => { const [x, y] = toS(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    ctx.fillStyle = '#f59f00';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    for (const n of this.npcs) {
      const [x, y] = toS(n);
      ctx.beginPath();
      ctx.arc(x, y, 4 * (ctx === this.smallCtx ? this.dpr : 1), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
    ctx.save();
    ctx.translate(x, y);
    // heading 0 = 北（畫面上方）；heading 增加 = 逆時針（往西）
    ctx.rotate(-this.heading);
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.7, size * 0.8);
    ctx.lineTo(0, size * 0.4);
    ctx.lineTo(-size * 0.7, size * 0.8);
    ctx.closePath();
    ctx.fillStyle = '#e03131';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ---------------- 大地圖操作 ----------------
  private setupBigInput() {
    const pointers = new Map<number, { x: number; y: number }>();
    let downAt: { x: number; y: number } | null = null;
    let moved = false;
    let pinch = 0;
    this.big.addEventListener('pointerdown', (e) => {
      this.big.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) { downAt = { x: e.clientX, y: e.clientY }; moved = false; }
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); moved = true; }
    });
    this.big.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        if (downAt && Math.hypot(cur.x - downAt.x, cur.y - downAt.y) > 5) moved = true;
        if (moved) {
          this.view.x -= (cur.x - prev.x) / this.view.scale;
          this.view.z -= (cur.y - prev.y) / this.view.scale;
          this.popup.classList.add('hidden');
          this.drawBig();
        }
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dd = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dd / pinch);
        pinch = dd;
      }
    });
    const up = (e: PointerEvent) => {
      if (pointers.size === 1 && !moved && downAt) this.showPopup(e.clientX, e.clientY);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (!pointers.size) downAt = null;
    };
    this.big.addEventListener('pointerup', up);
    this.big.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); });
    this.big.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.2 : 1 / 1.2);
    }, { passive: false });
  }

  private zoomAt(cx: number, cy: number, factor: number) {
    const before = this.bigToWorld(cx, cy);
    this.view.scale = Math.min(8, Math.max(0.35, this.view.scale * factor));
    const after = this.bigToWorld(cx, cy);
    this.view.x += before[0] - after[0];
    this.view.z += before[1] - after[1];
    this.popup.classList.add('hidden');
    this.drawBig();
  }

  private showPopup(cx: number, cy: number) {
    const p = this.bigToWorld(cx, cy);
    const name = this.handlers.describe(p[0], p[1]);
    this.popup.innerHTML = '';
    el('div', 'map-popup-title', name ?? t('ui.map.here'), this.popup);
    button('map-popup-btn', t('ui.map.teleport_here'), () => { this.close(); this.handlers.onTeleport(p); }, this.popup);
    button('map-popup-btn', t('ui.map.navigate_here'), () => { this.close(); this.handlers.onNavigate(p, name ?? t('ui.map.here')); }, this.popup);
    this.popup.style.left = `${Math.min(cx, window.innerWidth - 190)}px`;
    this.popup.style.top = `${Math.min(cy, window.innerHeight - 130)}px`;
    this.popup.classList.remove('hidden');
  }
}

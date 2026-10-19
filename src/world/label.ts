import * as THREE from 'three';

/** 牆面上的字：畫在 canvas 上當貼圖（只用在少數招牌，數量不多） */
export function labelMesh(text: string, color: string, size: number): THREE.Mesh {
  const lines = text.split('\n');
  const px = 128, c = document.createElement('canvas');
  const font = `bold ${px}px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif`;
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + px * 0.4;
  // 改 canvas 尺寸會把畫筆狀態清掉，字型要重設
  c.width = Math.ceil(w); c.height = Math.ceil(lines.length * px * 1.25 + px * 0.2);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, c.width / 2, px * 0.6 + i * px * 1.25 + px * 0.1));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const h = size * lines.length * 1.25 + size * 0.2, wm = (h * c.width) / c.height;
  return new THREE.Mesh(new THREE.PlaneGeometry(wm, h), new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false }));
}

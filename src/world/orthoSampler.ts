// 從航照取樣建築屋頂的平均顏色（風格裡 roof.color = "auto" 時使用）。
import * as THREE from 'three';
import type { XZ } from '../core/types';
import { pointInRing } from './collision';
import type { OrthoTile } from './ortho';

export class OrthoSampler {
  private data: Uint8ClampedArray;
  private w: number;
  private h: number;

  constructor(tiles: OrthoTile[], private bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    this.w = Math.ceil(bounds.maxX - bounds.minX);
    this.h = Math.ceil(bounds.maxZ - bounds.minZ);
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    for (const t of tiles) {
      const [x0, y0] = [t.corners[0][0] - bounds.minX, t.corners[0][1] - bounds.minZ];
      const [x1, y1] = [t.corners[2][0] - bounds.minX, t.corners[2][1] - bounds.minZ];
      ctx.drawImage(t.img, x0, y0, x1 - x0, y1 - y0);
    }
    this.data = ctx.getImageData(0, 0, this.w, this.h).data;
  }

  /** 圓形範圍內看起來是樹冠（綠色、不太亮）的像素比例 0~1；超出航照則回傳 0 */
  greenness(x: number, z: number, r: number): number {
    let green = 0, n = 0;
    for (let dz = -r; dz <= r; dz += 1) for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dz * dz > r * r) continue;
      const px = Math.floor(x + dx - this.bounds.minX), py = Math.floor(z + dz - this.bounds.minZ);
      if (px < 0 || py < 0 || px >= this.w || py >= this.h) continue;
      const i = (py * this.w + px) * 4;
      const R = this.data[i], G = this.data[i + 1], B = this.data[i + 2];
      n++;
      // 這批航照偏藍，樹冠是暗青綠色：G 明顯高於 R、B 不比 G 高太多、不會太亮
      if (G - R >= 12 && B - G < 14 && G < 160) green++;
    }
    return n ? green / n : 0;
  }

  /** 多邊形內的平均顏色（每公尺取一點）；取不到則回傳 null */
  mean(ring: XZ[]): THREE.Color | null {
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs));
    const z0 = Math.floor(Math.min(...zs)), z1 = Math.ceil(Math.max(...zs));
    let r = 0, g = 0, b = 0, n = 0;
    const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (z1 - z0)) / 400)));
    for (let z = z0; z <= z1; z += step) for (let x = x0; x <= x1; x += step) {
      if (!pointInRing(x + 0.5, z + 0.5, ring)) continue;
      const px = Math.floor(x - this.bounds.minX), py = Math.floor(z - this.bounds.minZ);
      if (px < 0 || py < 0 || px >= this.w || py >= this.h) continue;
      const i = (py * this.w + px) * 4;
      r += this.data[i]; g += this.data[i + 1]; b += this.data[i + 2]; n++;
    }
    if (!n) return null;
    // 航照偏霧，稍微加深對比
    const c = new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, Math.min(1, hsl.s * 1.15), Math.min(0.85, hsl.l * 0.95));
    return c;
  }
}

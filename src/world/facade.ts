// 立面材質：用程式產生「遮罩貼圖」，一格 = 一個開間 × 一層樓。
//   R：牆面材質明暗（紅磚、磁磚、粉刷…）
//   G：窗戶（玻璃）
//   B：窗框、樓板帶等線腳
// 實際顏色來自每棟建築的頂點屬性（牆色、線腳色、玻璃色），所以同一種材質可以有不同顏色，材質數量很少。
import * as THREE from 'three';
import type { WallMaterial, WindowStyle } from '../core/types';

const SIZE = 512;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** 牆面材質明暗，0.5 為原色 */
function wallPattern(kind: WallMaterial, data: Float32Array) {
  const rand = rng(kind.length * 977);
  const px = SIZE / 3.6; // 每公尺像素（貼圖代表 3.6m × 3.6m 的參考尺寸）
  if (kind === 'brick' || kind === 'tile') {
    const courseH = kind === 'brick' ? 0.075 : 0.065;
    const unitW = kind === 'brick' ? 0.235 : 0.235;
    const joint = kind === 'brick' ? 0.012 : 0.008;
    const rows = Math.round(3.6 / courseH);
    const cols = Math.round(3.6 / unitW);
    const shades: number[] = [];
    for (let i = 0; i < rows * (cols + 1); i++) shades.push((rand() - 0.5) * (kind === 'brick' ? 0.12 : 0.05));
    for (let y = 0; y < SIZE; y++) {
      const fy = (y / SIZE) * rows;
      const row = Math.floor(fy);
      const inRowY = (fy - row) * (3.6 / rows);
      for (let x = 0; x < SIZE; x++) {
        const shift = row % 2 ? 0.5 : 0;
        const fx = (x / SIZE) * cols + shift;
        const col = Math.floor(fx) % cols;
        const inColX = (fx - Math.floor(fx)) * (3.6 / cols);
        const mortar = inRowY < joint || inColX < joint;
        data[y * SIZE + x] = mortar ? (kind === 'brick' ? 0.66 : 0.4) : 0.5 + shades[row * (cols + 1) + col];
      }
    }
    return;
  }
  for (let i = 0; i < SIZE * SIZE; i++) {
    const n = rand() - 0.5;
    if (kind === 'stone') data[i] = 0.5 + n * 0.18;
    else if (kind === 'concrete') data[i] = 0.5 + n * 0.05;
    else data[i] = 0.5 + n * 0.025; // plaster
  }
  if (kind === 'concrete') {
    // 模板分割線
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const mx = (x / px) % 0.9, my = (y / px) % 1.8;
      if (mx < 0.015 || my < 0.015) data[y * SIZE + x] -= 0.06;
    }
  }
}

/** 窗戶（G）與線腳（B）遮罩。fx 0~1 橫向，fy 0~1 由下往上 */
/** 回傳 [玻璃比例 0~1, 線腳 0/1] */
function windowMask(style: WindowStyle, fx: number, fy: number): [number, number] {
  const band = fy < 0.06 ? 1 : 0; // 樓板帶
  const box = (x0: number, x1: number, y0: number, y1: number) => fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1;
  switch (style) {
    case 'grid': {
      if (box(0.22, 0.78, 0.3, 0.82)) {
        const mullion = Math.abs(fx - 0.5) < 0.012 || Math.abs(fy - 0.66) < 0.01;
        return mullion ? [0, 1] : [1, 0];
      }
      if (box(0.2, 0.8, 0.28, 0.84) || box(0.17, 0.83, 0.25, 0.3)) return [0, 1];
      return [0, band];
    }
    case 'ribbon': {
      if (box(0, 1, 0.36, 0.8)) return Math.abs((fx * 4) % 1 - 0.5) > 0.485 ? [0, 1] : [1, 0];
      if (box(0, 1, 0.33, 0.36)) return [0, 1];
      return [0, band];
    }
    case 'tall': {
      if (box(0.34, 0.66, 0.18, 0.84)) {
        const mullion = Math.abs(fx - 0.5) < 0.015 || Math.abs(fy - 0.68) < 0.012;
        return mullion ? [0, 1] : [1, 0];
      }
      if (box(0.3, 0.7, 0.14, 0.88)) return [0, 1];
      return [0, fy < 0.08 ? 1 : 0];
    }
    case 'frame': {
      // 外露混凝土框架（柱＋樑，線腳色）＋磚牆填充＋窗
      if (fx < 0.07 || fx > 0.93 || fy < 0.13) return [0, 1];
      if (box(0.17, 0.83, 0.3, 0.86)) {
        const mullion = Math.abs(fx - 0.5) < 0.012 || Math.abs(fy - 0.7) < 0.01;
        return mullion ? [0, 1] : [1, 0];
      }
      return [0, 0];
    }
    case 'loggia': {
      // 磚柱拱廊：深色拱形開口、白色拱圈與欄杆、柱子是牆色（紅磚）
      const cx = 0.5, spring = 0.6, r = 0.3;
      const inOpen = (fx >= cx - r && fx <= cx + r && fy >= 0.08 && fy <= spring) || (fy > spring && Math.hypot(fx - cx, fy - spring) <= r);
      const ring = fy > spring && Math.hypot(fx - cx, fy - spring) <= r + 0.06;
      if (inOpen) return fy < 0.3 ? [0, 1] : [0.85, 0];
      if (ring || fy < 0.08 || fy > 0.94) return [0, 1];
      return [0, 0];
    }
    case 'corridor': {
      // 開放走廊：下段是欄杆矮牆（線腳色），上段是走廊陰影（深色），開間兩側是柱子（牆色）
      const col = fx < 0.07 || fx > 0.93;
      if (col) return [0, 0];
      if (fy < 0.1) return [0, 1]; // 樓板邊
      if (fy < 0.42) return [0, 1]; // 欄杆牆
      return [0.82, 0];
    }
    case 'curtain': {
      // 玻璃帷幕：細框
      const mx = Math.abs((fx * 2) % 1 - 0.5) > 0.47, my = fy < 0.05 || Math.abs(fy - 0.55) < 0.012;
      return mx || my ? [0, 1] : [1, 0];
    }
    case 'arcade': {
      // 拱廊：拱形開口（深色迴廊），周圍為白色柱與拱
      const cx = 0.5, spring = 0.58, r = 0.34;
      const inRect = fx >= cx - r && fx <= cx + r && fy >= 0 && fy <= spring;
      const inArch = fy > spring && Math.hypot(fx - cx, fy - spring) <= r;
      if (inRect || inArch) return [1, 0];
      return [0, 1];
    }
    default:
      return [0, 0];
  }
}

const cache = new Map<string, THREE.DataTexture>();

export function facadeTexture(wall: WallMaterial, win: WindowStyle): THREE.DataTexture {
  const key = `${wall}/${win}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = new Float32Array(SIZE * SIZE);
  wallPattern(wall, r);
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    const fy = y / SIZE; // DataTexture 第 0 列在底部（v=0）
    for (let x = 0; x < SIZE; x++) {
      const [g, b] = windowMask(win, x / SIZE, fy);
      const i = (y * SIZE + x) * 4;
      data[i] = Math.max(0, Math.min(255, r[y * SIZE + x] * 255));
      data[i + 1] = g * 255;
      data[i + 2] = b * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** 夜間窗戶亮燈強度（0~1），由日夜系統更新 */
export const facadeUniforms = { uNight: { value: 0 } };

/** 立面材質：顏色 = 牆色×材質明暗，再疊上線腳色與玻璃色；夜晚部分窗戶亮燈 */
export function facadeMaterial(wall: WallMaterial, win: WindowStyle): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ map: facadeTexture(wall, win), vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = facadeUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 trimColor;\nattribute vec3 glassColor;\nvarying vec3 vTrim;\nvarying vec3 vGlass;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrim = trimColor;\nvGlass = glassColor;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying vec3 vTrim;\nvarying vec3 vGlass;')
      .replace('#include <map_fragment>', 'vec4 facadeMask = texture2D( map, vMapUv );')
      .replace(
        '#include <color_fragment>',
        `vec3 facadeC = vColor.rgb * (facadeMask.r * 2.0);
        facadeC = mix(facadeC, vTrim, facadeMask.b);
        facadeC = mix(facadeC, vGlass, facadeMask.g);
        diffuseColor.rgb *= facadeC;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float winHash = fract(sin(dot(floor(vMapUv), vec2(12.9898, 78.233))) * 43758.5453);
        totalEmissiveRadiance += facadeMask.g * uNight * step(0.42, winHash) * vec3(1.0, 0.82, 0.55) * 0.85;`,
      );
  };
  mat.customProgramCacheKey = () => `facade-${wall}-${win}`;
  return mat;
}

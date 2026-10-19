// 全域色調：資料裡的顏色照實景取樣，畫面要多鮮豔只在 style.json 的 theme 調。
// 彩度乘上 saturation、亮度乘上 lightness（深色的窗玻璃仍然是深色，色相不變）。
import * as THREE from 'three';
import type { GroundGrade, ThemeConfig } from './types';

const HEX = /^#[0-9a-f]{6}$/i;
const hsl = { h: 0, s: 0, l: 0 };

export function gradeColor(c: THREE.Color, t: ThemeConfig | undefined): THREE.Color {
  if (!t) return c;
  c.getHSL(hsl);
  return c.setHSL(hsl.h, Math.min(1, hsl.s * t.saturation), Math.min(1, hsl.l * t.lightness));
}

export function gradeHex(hex: string, t: ThemeConfig | undefined): string {
  return t ? '#' + gradeColor(new THREE.Color(hex), t).getHexString() : hex;
}

/** 把物件裡所有 #rrggbb 字串套用色調（skip 裡的 key 整段不動） */
export function gradeDeep<T>(v: T, t: ThemeConfig | undefined, skip: string[] = []): T {
  if (!t) return v;
  if (typeof v === 'string') return (HEX.test(v) ? gradeHex(v, t) : v) as T;
  if (Array.isArray(v)) return v.map((x) => gradeDeep(x, t, skip)) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = skip.includes(k) ? x : gradeDeep(x, t, skip);
    return out as T;
  }
  return v;
}

/** 航照地面：在貼圖取樣後調彩度與亮度。
 *  只加強本來就有顏色的像素（草地、跑道、屋頂）；接近灰色的柏油路去掉航照的藍綠色偏。
 *  cool：偏藍、偏青又不夠綠的像素（多半是航照裡的建築陰影）再去色多少（0~1）；lift：暗部提亮多少 */
export function gradeTextureMaterial(mat: THREE.Material, g: GroundGrade | undefined) {
  if (!g) return;
  const tint = (g.tint ?? [1, 1, 1]).map((v) => v.toFixed(3)).join(', ');
  const cool = (g.cool ?? 0).toFixed(3), lift = (g.lift ?? 0).toFixed(3);
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      float gradeL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      float gradeC = (max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b)) / max(gradeL, 0.02);
      float gradeS = mix(0.75, ${g.saturation.toFixed(3)}, smoothstep(0.3, 0.7, gradeC));
      float gradeCool = smoothstep(0.0, 0.06, diffuseColor.b - diffuseColor.r) * (1.0 - smoothstep(0.02, 0.07, diffuseColor.g - diffuseColor.b));
      gradeS = mix(gradeS, 0.0, gradeCool * ${cool});
      vec3 gradeRgb = max(mix(vec3(gradeL), diffuseColor.rgb, gradeS), 0.0);
      gradeRgb += ${lift} * (1.0 - smoothstep(0.05, 0.35, gradeL));
      diffuseColor.rgb = gradeRgb * ${g.brightness.toFixed(3)} * vec3(${tint});`,
    );
  };
}

// 讀取 public/data/ 底下所有資料檔，並把 overrides 套用到自動產生的世界資料上。
import { edgeRect, insetRing } from '../world/geometry';
import { applyStreetscape } from '../world/streetscape';
import { gradeDeep } from './theme';
import type {
  Appearance, Building, BuildingFeature, EdgeLook, BuildingPart, BuildingStyles, Dialogue, GameConfig, Canopy, LandmarksConfig, LocationRef, NavData, NpcDef, Pavilion, Prop, PropOverrides, RoofSpec, Skybridge, StreetscapeConfig, StyleConfig, SunkenPlaza, Walkway,
  WorldConfig, WorldData, XZ,
} from './types';

export interface GameData {
  world: WorldData;
  nav: NavData;
  game: GameConfig;
  worldConfig: WorldConfig;
  style: StyleConfig;
  /** 航照樹冠偵測要用（要等航照載入後才種） */
  canopy: NonNullable<StreetscapeConfig['canopy']>;
  /** overrides/landmarks.json 的天橋、下沉廣場、大頂棚（已轉成本地座標） */
  skybridges: Skybridge[];
  sunkenPlazas: SunkenPlaza[];
  canopies: Canopy[];
  walkways: Walkway[];
  pavilions: Pavilion[];
  npcs: NpcDef[];
  dialogues: Record<string, Dialogue>;
  strings: Record<string, string>;
  buildingById: Map<string, Building>;
  /** 把資料檔裡的位置寫法轉成本地座標 */
  resolveLocation(ref: LocationRef): XZ | null;
  latLonToXZ(lat: number, lon: number): XZ;
}

const BASE = import.meta.env.BASE_URL + 'data/';

/** 選用的資料檔：不存在時回傳 null */
async function loadOptionalJson<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(BASE + file);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function loadJson<T>(file: string): Promise<T> {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`無法讀取 ${file}（${res.status}）`);
  return (await res.json()) as T;
}

interface BuildingOverride {
  name?: string;
  aliases?: string[];
  levels?: number;
  height?: number;
  minHeight?: number;
  color?: string;
  hidden?: boolean;
  entrances?: LocationRef[];
  rooms?: Building['rooms'];
  interior?: unknown;
  model?: string;
  style?: string;
  appearance?: AppearanceOverride;
  /** 取代 OSM 輪廓，本地座標 [x, z] */
  outer?: XZ[];
  /** 個別牆面的外觀覆寫，key 是邊的編號（第 i 點 → 下一點） */
  edges?: Record<string, EdgeLook>;
  parts?: PartOverride[];
  features?: (Omit<BuildingFeature, 'color' | 'points'> & { color?: string; points?: XZ[]; edge?: number; attach?: [number | null, number | null, number] })[];
}

type AppearanceOverride = Partial<Omit<Appearance, 'roof'>> & { roof?: Partial<RoofSpec> };

interface PartOverride {
  /** 本地座標 [x, z]；沒寫就用主體輪廓（可配合 inset 往內縮） */
  outer?: XZ[];
  /** 搭配 outer 使用的中庭（洞） */
  holes?: XZ[][];
  inset?: number;
  /** 掛在主體輪廓第 edge 條邊（第 edge 點 → 下一點）上的矩形，用 attach 指定範圍 */
  edge?: number;
  /** [沿邊起點, 沿邊終點, 垂直起點, 垂直終點]（公尺）；沿邊負值從邊尾倒數、null 代表邊尾，垂直正值往外 */
  attach?: [number | null, number | null, number, number];
  levels?: number;
  /** 量體頂部高度（公尺） */
  height?: number;
  /** 量體底部高度（公尺），預設 0；設成主體高度就是疊在屋頂上 */
  minHeight?: number;
  roofOnly?: boolean;
  /** 這個量體個別牆面的外觀覆寫 */
  edges?: Record<string, EdgeLook>;
  /** 沒寫就沿用主體的風格與覆寫 */
  style?: string;
  appearance?: AppearanceOverride;
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** 依 風格 → 單棟覆寫 的順序算出最終外觀 */
function resolveLook(b: Building, styles: BuildingStyles, regionDetail: (id: string) => string, o?: { style?: string; appearance?: AppearanceOverride }): Appearance {
  const detail = b.region === 'outside' ? 'outside' : b.region === 'station' ? 'station' : regionDetail(b.region);
  const styleName = o?.style ?? styles.defaults[detail] ?? 'city';
  const s = styles.styles[styleName] ?? styles.styles.city;
  if (!styles.styles[styleName]) console.warn(`找不到風格 ${styleName}（${b.id}）`);
  const wallColor = Array.isArray(s.wallColor) ? s.wallColor[Math.floor(hash01(b.id) * s.wallColor.length)] : s.wallColor;
  const a = o?.appearance;
  return {
    wall: a?.wall ?? s.wall,
    wallColor: a?.wallColor ?? b.color ?? wallColor,
    trimColor: a?.trimColor ?? s.trimColor,
    windowColor: a?.windowColor ?? s.windowColor,
    window: a?.window ?? s.window,
    bayWidth: a?.bayWidth ?? s.bayWidth ?? 3.6,
    roof: { ...s.roof, ...(a?.roof ?? {}) },
  };
}

export async function loadGameData(onProgress: (step: string) => void): Promise<GameData> {
  onProgress('config');
  const [game, worldConfig, rawStyle] = await Promise.all([
    loadJson<GameConfig>('config/game.json'),
    loadJson<WorldConfig>('config/world.json'),
    loadJson<StyleConfig>('config/style.json'),
  ]);
  // 全域色調套在所有資料顏色上；天空、光線、路線色本身就是畫面設定，不再調
  const theme = rawStyle.theme;
  const style = gradeDeep(rawStyle, theme, ['sky', 'lighting', 'route', 'theme', 'groundGrade']);
  const strings = await loadJson<Record<string, string>>(`i18n/${game.language}.json`);
  onProgress('world');
  const [world, nav, rawOverrides, npcFile, dlgFile, rawStyles, streetscape, rawPropOverrides, rawLandmarks] = await Promise.all([
    loadJson<WorldData>('world/generated.json'),
    loadJson<NavData>('world/nav.json'),
    loadJson<{ buildings: Record<string, BuildingOverride> }>('overrides/buildings.json'),
    loadJson<{ npcs: NpcDef[] }>('npcs/npcs.json'),
    loadJson<{ dialogues: Record<string, Dialogue> }>('dialogues/dialogues.json'),
    loadJson<BuildingStyles>('config/building-styles.json'),
    loadOptionalJson<StreetscapeConfig>('overrides/streetscape.json'),
    loadOptionalJson<PropOverrides>('overrides/props.json'),
    loadOptionalJson<LandmarksConfig>('overrides/landmarks.json'),
  ]);
  const overrides = gradeDeep(rawOverrides, theme);
  const styles = gradeDeep(rawStyles, theme);
  const regionDetail = (id: string) => world.regions.find((r) => r.id === id)?.detail ?? 'outside';

  const { lat: LAT0, lon: LON0 } = world.meta.origin;
  const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320;
  const KZ = 110574;
  const latLonToXZ = (lat: number, lon: number): XZ => [(lon - LON0) * KX, (LAT0 - lat) * KZ];
  const toXZ = (ref: LocationRef): XZ | null => {
    if ('lat' in ref) return latLonToXZ(ref.lat, ref.lon);
    if ('x' in ref) return [ref.x, ref.z];
    return null;
  };

  // 補上預設欄位並套用 overrides
  const buildingById = new Map<string, Building>();
  for (const b of world.buildings) {
    b.aliases ??= [];
    b.entrances ??= [];
    b.rooms ??= [];
    b.interior ??= null;
    b.model ??= null;
    b.parts = [];
    b.features = [];
    const o = overrides.buildings[b.id];
    if (o) {
      if (o.outer && o.outer.length >= 3) {
        b.outer = o.outer;
        b.holes = [];
        b.center = [o.outer.reduce((a, p) => a + p[0], 0) / o.outer.length, o.outer.reduce((a, p) => a + p[1], 0) / o.outer.length];
      }
      const levelHeight = b.levels > 0 ? (b.height - b.minHeight) / b.levels : 3.6;
      if (o.name !== undefined) b.name = o.name;
      if (o.aliases) b.aliases = o.aliases;
      if (o.levels !== undefined) {
        b.levels = o.levels;
        if (o.height === undefined) b.height = b.minHeight + o.levels * levelHeight;
      }
      if (o.height !== undefined) b.height = o.height;
      if (o.minHeight !== undefined) b.minHeight = o.minHeight;
      if (o.color) b.color = o.color;
      if (o.hidden) b.hidden = true;
      if (o.entrances) b.entrances = o.entrances.map(toXZ).filter((p): p is XZ => p != null);
      if (o.rooms) b.rooms = o.rooms;
      if (o.interior !== undefined) b.interior = o.interior;
      if (o.model) b.model = o.model;
    }
    b.look = resolveLook(b, styles, regionDetail, o);
    if (o?.edges) b.edgeLooks = Object.fromEntries(Object.entries(o.edges).map(([k, v]) => [Number(k), v]));
    if (o?.parts) b.parts = o.parts.map((p) => resolvePart(b, p, o));
    if (o?.features) b.features = o.features.map((f) => resolveFeature(b, f));
    buildingById.set(b.id, b);
  }
  world.buildings = world.buildings.filter((b) => !b.hidden);
  applyStreetscape(world, streetscape, toXZ);

  // 設施個別造型與新增
  const propOverrides = gradeDeep(rawPropOverrides, theme);
  for (const o of propOverrides?.models ?? []) {
    const m = o.match;
    let target: Prop | undefined;
    if ('name' in m) target = world.props.find((p) => p.name === m.name);
    else {
      const at = toXZ(m as LocationRef);
      const r = (m as { radius?: number }).radius ?? 5;
      if (at) target = world.props.filter((p) => Math.hypot(p.pos[0] - at[0], p.pos[1] - at[1]) < r)
        .sort((a, b) => Math.hypot(a.pos[0] - at[0], a.pos[1] - at[1]) - Math.hypot(b.pos[0] - at[0], b.pos[1] - at[1]))[0];
    }
    if (!target) { console.warn('props.json 找不到要套造型的設施', m); continue; }
    if (o.name) target.name = o.name;
    if (o.rot != null) target.rot = o.rot;
    if (o.model) target.model = o.model;
  }
  for (const a of propOverrides?.add ?? []) {
    const pos = toXZ(a);
    if (pos) world.props.push({ kind: a.kind, pos, y: a.y, name: a.name, rot: a.rot, model: a.model });
  }

  function resolveFeature(b: Building, f: NonNullable<BuildingOverride['features']>[number]): BuildingFeature {
    let points = f.points;
    // 柱列可以寫 edge + attach：沿主體第 edge 條邊、往外 attach[2] 公尺
    if (!points && f.edge !== undefined) {
      const [s0, s1, off] = f.attach ?? [0, null, 2];
      const r = edgeRect(b.outer, f.edge, [s0, s1, off, off]);
      points = [r[0], r[1]];
    }
    return { ...f, points: points ?? [], color: f.color ?? b.look.trimColor } as BuildingFeature;
  }

  function resolvePart(b: Building, p: PartOverride, o: BuildingOverride): BuildingPart {
    const levelH = b.levels > 0 ? (b.height - b.minHeight) / b.levels : 3.6;
    const base = p.minHeight ?? 0;
    const height = p.height ?? base + (p.levels ?? 1) * levelH;
    const outer = p.outer ?? (p.edge !== undefined ? edgeRect(b.outer, p.edge, p.attach ?? [0, null, -1, 3]) : p.inset ? insetRing(b.outer, p.inset) : b.outer);
    return {
      outer,
      holes: p.outer ? p.holes ?? [] : p.inset || p.edge !== undefined ? [] : b.holes,
      levels: p.levels ?? Math.max(1, Math.round((height - base) / levelH)),
      height,
      minHeight: base,
      roofOnly: !!p.roofOnly,
      edgeLooks: p.edges ? Object.fromEntries(Object.entries(p.edges).map(([k, v]) => [Number(k), v])) : undefined,
      look: resolveLook(b, styles, regionDetail, {
        style: p.style ?? o.style,
        appearance: p.style ? p.appearance : { ...o.appearance, ...p.appearance, roof: { ...o.appearance?.roof, ...p.appearance?.roof } },
      }),
    };
  }

  // 地標：天橋兩端轉成本地座標
  const landmarks = gradeDeep(rawLandmarks, theme);
  const skybridges: Skybridge[] = [];
  for (const { from, to, ...rest } of landmarks?.skybridges ?? []) {
    const a = toXZ(from), b = toXZ(to);
    if (a && b) skybridges.push({ ...rest, a, b });
  }
  const sunkenPlazas: SunkenPlaza[] = [];
  for (const { center, ...rest } of landmarks?.sunkenPlazas ?? []) {
    const c = toXZ(center);
    if (c) sunkenPlazas.push({ ...rest, center: c });
  }
  const walkways: Walkway[] = [];
  for (const { points, ...rest } of landmarks?.walkways ?? []) {
    const pts = points.map(toXZ).filter((q): q is XZ => q != null);
    if (pts.length >= 2) walkways.push({ ...rest, points: pts });
  }
  const pavilions: Pavilion[] = [];
  for (const { center, ...rest } of landmarks?.pavilions ?? []) {
    const c = toXZ(center);
    if (c) pavilions.push({ ...rest, center: c });
  }
  const canopies: Canopy[] = [];
  for (const { center, ...rest } of landmarks?.canopies ?? []) {
    const c = toXZ(center);
    if (c) canopies.push({ ...rest, center: c });
  }

  const resolveLocation = (ref: LocationRef): XZ | null => {
    if ('building' in ref) {
      const b = buildingById.get(ref.building);
      if (!b) return null;
      return b.entrances[0] ?? b.center;
    }
    return toXZ(ref);
  };

  onProgress('done');
  return {
    world, nav, game, worldConfig, style, canopy: streetscape?.canopy ?? [], skybridges, sunkenPlazas, canopies, walkways, pavilions, npcs: npcFile.npcs, dialogues: dlgFile.dialogues, strings,
    buildingById, resolveLocation, latLonToXZ,
  };
}

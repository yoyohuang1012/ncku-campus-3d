// 遊戲資料的型別定義，對應 public/data/ 底下的 JSON 檔。

export type XZ = [number, number];

export interface Region {
  id: string;
  nameKey: string;
  detail: 'full' | 'simple';
  polygon: XZ[];
}

export interface Room {
  code: string;
  floor: number;
  name?: string;
}

export interface Building {
  id: string;
  name: string | null;
  aliases: string[];
  type: string;
  levels: number;
  height: number;
  minHeight: number;
  roofOnly: boolean;
  region: string;
  center: XZ;
  outer: XZ[];
  holes: XZ[][];
  color?: string;
  hidden?: boolean;
  entrances: XZ[];
  rooms: Room[];
  /** 之後可走進去的室內場景設定；目前保留 */
  interior: unknown | null;
  /** 之後替換成精細模型的 GLB 路徑 */
  model: string | null;
  /** 套用風格與覆寫後的最終外觀 */
  look: Appearance;
  /** 附加量體（退縮的上層、塔樓、門廊、雨遮…），點選時視為同一棟 */
  parts: BuildingPart[];
  /** 柱列等細部 */
  features: BuildingFeature[];
  /** 個別牆面（第 i 條邊）的外觀覆寫 */
  edgeLooks?: Record<number, EdgeLook>;
}

/** 建築的一個量體；座標為本地公尺 [x, z] */
export interface BuildingPart {
  outer: XZ[];
  holes: XZ[][];
  levels: number;
  height: number;
  minHeight: number;
  roofOnly: boolean;
  look: Appearance;
  /** 個別牆面（第 i 條邊）的外觀覆寫，例如山牆不開窗 */
  edgeLooks?: Record<number, EdgeLook>;
}

export type EdgeLook = Partial<Pick<Appearance, 'wall' | 'wallColor' | 'trimColor' | 'windowColor' | 'window' | 'bayWidth'>>;

/** 柱列：沿 points 每隔 spacing 公尺立一根柱子 */
export interface ColumnsFeature {
  type: 'columns';
  points: XZ[];
  spacing: number;
  /** 柱子寬度（方柱邊長或圓柱直徑） */
  size: number;
  height: number;
  base?: number;
  round?: boolean;
  color: string;
}

export type BuildingFeature = ColumnsFeature;

export type WallMaterial = 'brick' | 'tile' | 'plaster' | 'concrete' | 'stone';
export type WindowStyle = 'grid' | 'ribbon' | 'tall' | 'frame' | 'arcade' | 'loggia' | 'corridor' | 'curtain' | 'none';

export interface RoofSpec {
  shape: 'flat' | 'hip' | 'curved';
  /** 色碼，或 auto = 從航照取樣 */
  color: string;
  pitch?: number;
  overhang?: number;
  rise?: number;
  parapet?: number;
}

export interface Appearance {
  wall: WallMaterial;
  wallColor: string;
  trimColor: string;
  windowColor: string;
  window: WindowStyle;
  bayWidth: number;
  roof: RoofSpec;
}

/** 風格檔裡的寫法：wallColor 可以是陣列（每棟隨機挑） */
export type StyleDef = Omit<Appearance, 'wallColor' | 'roof' | 'bayWidth'> & {
  wallColor: string | string[];
  bayWidth?: number;
  roof: RoofSpec;
};

export interface BuildingStyles {
  defaults: Record<string, string>;
  styles: Record<string, StyleDef>;
}

export interface Road {
  id: string;
  kind: string;
  name: string | null;
  width: number;
  tunnel: boolean;
  bridge: boolean;
  points: XZ[];
}

export interface Area {
  id: string;
  kind: string;
  name: string | null;
  sport: string | null;
  outer: XZ[];
  holes: XZ[][];
}

export interface Barrier {
  id: string;
  kind: string;
  height: number;
  points: XZ[];
}

export interface Prop {
  kind: string;
  pos: XZ;
  /** 立在哪個高度（例如下沉廣場的坑底是負的）；預設 0 */
  y?: number;
  name?: string;
  /** 朝向（度）；沒寫就隨機 */
  rot?: number;
  /** 個別造型（雕塑、校門）；沒寫就用該種類的通用造型 */
  model?: PropModel;
}

/** 雕塑、校門造型：type 見 world/props.ts（curve、abstract、seated、spiky_ball、figure_pair、block_figure、frame_disc、tower_loop、rings、cube、bust、gate、paifang、booth、banner_row、monolith） */
export interface PropModel {
  type: string;
  /** 總高（公尺，含底座） */
  height?: number;
  /** 底座高（公尺），0 為沒有底座 */
  pedestal?: number;
  /** 底座寬（公尺），預設 1.4 */
  pedestalWidth?: number;
  /** 周圍幾公尺內不種樹（預設 2.5），例如站前圓環 */
  clearTrees?: number;
  /** 主材質色、次材質色（底座、鏡面、核心） */
  color?: string;
  color2?: string;
  /** 第三個材質色（牌坊的紋飾、警衛亭的招牌） */
  color3?: string;
  /** gate、paifang 的門寬，booth 的長邊 */
  width?: number;
  /** banner_row：旗桿數、間距（公尺）、旗子顏色（輪流用） */
  count?: number;
  spacing?: number;
  colors?: string[];
}

/** overrides/props.json：雕塑個別造型、補 OSM 沒有的設施 */
export interface PropOverrides {
  /** 依名稱或位置找到 OSM 設施，換上個別造型 */
  models?: ({ match: { name?: string } | (LocationRef & { radius?: number }) } & Partial<Pick<Prop, 'name' | 'rot' | 'model'>>)[];
  /** 新增設施 */
  add?: (LocationRef & Omit<Prop, 'pos'>)[];
}

export interface Poi {
  id: string;
  name: string;
  kind: string;
  pos: XZ;
  region: string;
}

export interface WorldData {
  meta: { source: string; origin: { lat: number; lon: number }; generatedAt: string };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  spawn: { pos: XZ; heading: number };
  regions: Region[];
  buildings: Building[];
  roads: Road[];
  areas: Area[];
  rails: { id: string; points: XZ[] }[];
  barriers: Barrier[];
  /** [x, z, 來源(0 行道樹 / 1 單棵 / 2 補種 / 3 航照樹冠 / 4 椰子樹)] */
  trees: [number, number, number][];
  props: Prop[];
  pois: Poi[];
}

export interface NavData {
  nodes: XZ[];
  edges: [number, number][];
}

/** 位置寫法：經緯度、本地座標、或「某棟建築旁」 */
export type LocationRef = { lat: number; lon: number } | { x: number; z: number } | { building: string };

export interface NpcScheduleEntry {
  days?: 'all' | string[];
  dates?: string[];
  from: string;
  to: string;
  at: LocationRef;
  facing?: number;
  dialogue?: string;
  animation?: string;
}

export interface NpcDef {
  id: string;
  nameKey: string;
  interactive: boolean;
  appearance: Record<string, string>;
  schedule: NpcScheduleEntry[];
}

export interface DialogueAction {
  type: string;
  [key: string]: unknown;
}

export interface DialogueChoice {
  text: string;
  next?: string;
  action?: DialogueAction;
}

export interface DialogueNode {
  text: string;
  choices?: DialogueChoice[];
}

export interface Dialogue {
  start: string;
  nodes: Record<string, DialogueNode>;
}

export interface GameConfig {
  player: { walkSpeed: number; runSpeed: number; radius: number; turnSpeed: number; model: string | null };
  camera: {
    fov: number; distance: number; minDistance: number; maxDistance: number; height: number;
    minPitch: number; maxPitch: number; mouseSensitivity: number; touchSensitivity: number;
  };
  render: {
    far: number; fogNear: number; fogFar: number; maxPixelRatio: number; mobileMaxPixelRatio: number;
    shadows: boolean; mobileShadows: boolean; shadowRange: number;
  };
  /** drawWater：航照模式下也畫出水面與池岸（水池、跨水小橋） */
  ground: { mode: 'ortho' | 'flat'; zoom: number; mobileZoom: number; drawRoads: boolean; drawAreas: boolean; drawWater?: boolean };
  labels: { maxDistance: number; maxCount: number };
  npc: { interactDistance: number };
  navigation: { arriveDistance: number; arrowSpacing: number };
  clock: { mode: 'real' | 'scaled'; start: string; timeScale: number };
  minimap: { base: 'ortho' | 'vector'; smallSize: number; smallRadius: number; pixelsPerMeter: number };
  language: string;
}

export interface StyleConfig {
  sky: string;
  ground: string;
  campusGround: string;
  buildings: { variation: number } & Record<'full' | 'simple' | 'outside', Record<string, string>>;
  areas: Record<string, string>;
  roads: Record<string, string>;
  rail: { ballast: string; track: string };
  barriers: Record<string, string>;
  /** 各種圍牆的厚度（公尺），沒寫用 default */
  barrierThickness: Record<string, number>;
  trees: {
    trunk: string; leaves: string[]; sizes: Record<'single' | 'street' | 'filled' | 'canopy' | 'palm', { h: [number, number]; crown: [number, number] }>;
    /** 椰子樹的樹幹與葉子顏色 */
    palm: { trunk: string; fronds: string[] };
  };
  route: string;
  theme?: ThemeConfig;
  /** 航照地面的調色 */
  groundGrade?: GroundGrade;
  lighting: LightingConfig;
  /** 設施與雕塑的材質色 */
  props: Record<string, string | string[]>;
  water?: WaterStyle;
  /** 道路標線 */
  markings?: MarkingStyle;
}

/** 全域色調：所有資料顏色的彩度、亮度倍率 */
export interface ThemeConfig {
  saturation: number;
  lightness: number;
}

/** 道路標線：doubleYellow 是畫雙黃中線的道路種類；其他寬度 ≥ centerMinWidth 的車道畫白色虛線，≥ edgeMinWidth 加路緣白線 */
export interface MarkingStyle {
  white: string;
  yellow: string;
  lineWidth: number;
  dash: number;
  gap: number;
  centerMinWidth: number;
  edgeMinWidth: number;
  doubleYellow: string[];
  /** 斑馬線：每條寬 stripe、間隔 gap、沿車道方向長 length */
  zebra: { stripe: number; gap: number; length: number };
}

/** 水池：水面高度、反光、池岸石材與跨水小橋的顏色 */
export interface WaterStyle {
  level: number;
  shininess: number;
  specular: string;
  rim: string;
  rimHeight: number;
  rimWidth: number;
  /** 小橋欄杆與側板、橋面 */
  bridge: string;
  bridgeDeck: string;
  /** 小橋中央最多拱起幾公尺 */
  bridgeRise: number;
}

/** overrides/landmarks.json：OSM 沒有的地標結構 */
export interface LandmarksConfig {
  skybridges?: (Omit<Skybridge, 'a' | 'b'> & { from: LocationRef; to: LocationRef })[];
  sunkenPlazas?: (Omit<SunkenPlaza, 'center'> & { center: LocationRef })[];
  walkways?: (Omit<Walkway, 'points'> & { points: LocationRef[] })[];
  pavilions?: (Omit<Pavilion, 'center'> & { center: LocationRef })[];
  canopies?: (Omit<Canopy, 'center'> & { center: LocationRef })[];
}

/** 下沉廣場：長 length（沿 heading 方向）× 寬 width 的長方形坑，深 depth；
 *  每座階梯沿一條長邊（side：left / right，以 heading 為前方），從 top（start / end）那一端往下；
 *  doors 是 B1 入口玻璃門：wall 在哪面牆（left / right / start / end）、at 沿牆的位置（公尺，從牆中點算）、width 寬 */
export interface SunkenPlaza {
  name?: string;
  center: XZ;
  heading: number;
  length: number;
  width: number;
  depth: number;
  stairs: { side: 'left' | 'right'; top: 'start' | 'end'; width: number }[];
  doors: PlazaPanel[];
  /** 牆上的大型螢幕、裝飾板（同 doors 的寫法，可設高度與離地高） */
  screens?: PlazaPanel[];
  /** 坑邊實心石材矮牆的高度（公尺）；0 或不寫就是金屬欄杆 */
  parapet?: number;
  /** 牆面石材、地坪、欄杆、B1 入口玻璃門 */
  wall: string;
  floor: string;
  rail: string;
  door: string;
}

/** 下沉廣場牆上的門或螢幕：wall 在哪面牆、at 沿牆位置（從牆中點算）、width 寬；height 高（預設 3.2）、bottom 離坑底高（預設 0） */
export interface PlazaPanel {
  wall: 'left' | 'right' | 'start' | 'end';
  at: number;
  width: number;
  height?: number;
  bottom?: number;
  color?: string;
  /** 離牆面的距離（預設 0.06）；整面飾板放小一點，螢幕、門才會浮在它前面 */
  offset?: number;
  /** 飾板分格：每 seams 公尺一條 seamColor 的細縫（直、橫都畫） */
  seams?: number;
  seamColor?: string;
  /** 飾板上的圓形裝飾：[沿牆位置（從飾板中點算）, 離飾板底高, 半徑, 顏色？]，顏色不寫就用 discColor */
  discs?: [number, number, number, string?][];
  discColor?: string;
}

/** 步道棧橋：沿 points 的平台，高 height，兩端各 ramp 公尺的坡道，兩側欄杆；走得上去 */
export interface Walkway {
  name?: string;
  points: XZ[];
  width: number;
  height: number;
  ramp: number;
  deck: string;
  rail: string;
  /** 每隔 spacing 公尺一座跨過橋面的鋼門架 */
  frames?: { spacing: number; height: number; color: string };
}

/** 出入口站體、石牆、指示柱：石材方盒，front（left / right / start / end / none）那面是玻璃帷幕，
 *  平頂往 front 出挑 overhang 公尺（下方每 columnSpacing 公尺一根細柱），label 是寫在 labelSide 牆面上的字（\n 換行） */
export interface Pavilion {
  name?: string;
  center: XZ;
  heading: number;
  length: number;
  width: number;
  height: number;
  front: 'left' | 'right' | 'start' | 'end' | 'none';
  wall: string;
  glass: string;
  roof: string;
  /** 出口號碼牌顏色；不寫就不掛 */
  sign?: string;
  overhang?: number;
  columnSpacing?: number;
  /** 不寫就沒有屋頂板（例如獨立的石牆） */
  roofless?: boolean;
  label?: string;
  labelSide?: 'left' | 'right' | 'start' | 'end';
  labelColor?: string;
  /** 字的大小（字高，公尺） */
  labelSize?: number;
}

/** 大頂棚：平頂板＋細柱（柱子落在下沉廣場裡的不放） */
export interface Canopy {
  name?: string;
  center: XZ;
  heading: number;
  length: number;
  width: number;
  height: number;
  thickness: number;
  columnSpacing: number;
  color: string;
  underside: string;
  column: string;
}

/** 有頂蓋的鋼桁架天橋；a、b 是兩端（本地座標），bottom 是橋底離地高度 */
export interface Skybridge {
  name?: string;
  a: XZ;
  b: XZ;
  width: number;
  bottom: number;
  height: number;
  /** 桁架每格長度（公尺） */
  panel?: number;
  color: string;
  glass: string;
  deck: string;
}

/** 航照地面調色：saturation 只加強有顏色的像素；cool 是偏藍青像素（建築陰影）的去色比例、lift 是暗部提亮量 */
export interface GroundGrade {
  saturation: number;
  brightness: number;
  tint?: [number, number, number];
  cool?: number;
  lift?: number;
}

/** 天空與光線；強度是 [夜間基礎值, 白天增加量] */
export interface LightingConfig {
  skyNight: string;
  skyDusk: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: [number, number];
  sunColor: string;
  sunDusk: string;
  sunIntensity: [number, number];
}

export interface WorldConfig {
  railway: { showSurfaceTracks: boolean };
  [key: string]: unknown;
}

/** overrides/streetscape.json：沿校區邊界自動產生圍牆與樹，校區內自動擺路燈、座椅 */
export interface StreetscapeConfig {
  /** 林蔭大道：沿指定名稱的道路兩側每 spacing 公尺種一棵（kind: palm 椰子樹、tree 一般樹）；replace 會先移掉路旁原本的樹；within 只種在某點半徑內 */
  avenues?: { road: string; kind: 'palm' | 'tree'; spacing: number; offset: number; replace?: boolean; within?: LocationRef & { radius: number } }[];
  /** 這些種類的設施（候車亭、站牌）沒寫朝向時，自動面向 maxDistance 公尺內最近的車道 */
  alignProps?: { kinds: string[]; maxDistance: number };
  /** 依航照綠色比例在校區內補樹：每 spacing 公尺取樣，半徑 radius 內綠色比例 ≥ minGreen 就種一棵 */
  canopy?: { region: string; spacing: number; radius: number; minGreen: number }[];
  furniture?: {
    region: string;
    /** 校區外圍人行道的路燈（offset 從邊界往外幾公尺） */
    streetLamps?: { streets: string[]; maxStreetDistance: number; offset: number; spacing: number };
    /** 校內道路兩側交錯的步道燈；kinds 是要沿哪些道路種類（footway、service…） */
    pathLamps?: { kinds: string[]; spacing: number; offset: number };
    /** 校內步道旁的座椅，每 binEvery 張旁邊放一組垃圾桶 */
    benches?: { kinds: string[]; spacing: number; offset: number; binEvery: number };
  }[];
  perimeters: {
    /** world.json 裡的校區 id */
    region: string;
    /** 只在這些街道旁產生（名稱開頭比對，例如「大學路」也會比對到「大學路西段」） */
    streets: string[];
    /** kind 對應 style.json 的 barriers 顏色（預設 wall＝紅磚） */
    wall?: {
      kind?: string; height: number; inset: number; gateWidth: number; maxStreetDistance: number; skipNearExisting: number;
      /** OSM 沒畫到的出入口（例如校門前的廣場），width 公尺內不蓋牆 */
      openings?: (LocationRef & { width: number })[];
    };
    trees?: {
      maxStreetDistance: number;
      outside?: { offset: number; spacing: number };
      inside?: { offset: number; spacing: number };
    };
  }[];
}

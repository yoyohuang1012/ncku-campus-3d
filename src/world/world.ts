// 由資料組出整個 3D 世界：地面、校區底色、草地水池、道路、鐵軌、建築、圍牆、樹、設施，並建立碰撞。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import type { GameData } from '../core/data';
import { gradeColor, gradeTextureMaterial } from '../core/theme';
import type { Building, BuildingPart, Region, StyleConfig, XZ } from '../core/types';
import { Collision, pointInRing } from './collision';
import { buildBuildingMeshes } from './buildings';
import { buildMarkings } from './markings';
import { canopyMesh, findFootbridges, footbridgeMesh, groundMask, nearFootbridge, pavilionMeshes, plazaShape, skybridgeMesh, sunkenPlazaMesh, walkwayDeck, walkwayMesh, waterMeshes } from './landmarks';
import { buildPropMeshes } from './props';
import { FlatBuilder, hash01, RibbonBuilder } from './geometry';
import type { OrthoSampler } from './orthoSampler';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree;

const VEHICLE_ROADS = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street']);
const FOOT_ROADS = new Set(['footway', 'path', 'pedestrian', 'corridor']);

/** 平面圖層的繪製順序（越大越上層）；不寫深度，用順序避免閃爍 */
const LAYER = { ground: -20, campus: -19, green: -18, surface: -17, water: -16, road: -15, service: -14, foot: -13, marking: -12.5, rail: -12, route: -11 };

export class World {
  readonly group = new THREE.Group();
  readonly collision = new Collision();
  readonly buildings: Building[];
  buildingMeshes: THREE.Mesh[] = [];
  /** 攝影機要避開的網格（建築＋下沉廣場的牆） */
  readonly cameraObstacles: THREE.Object3D[] = [];
  /** 航照取樣器（除錯用：主控台 game.world.sampler） */
  sampler: OrthoSampler | null = null;
  private regions: Region[];

  constructor(private data: GameData) {
    this.buildings = data.world.buildings;
    this.regions = data.world.regions;
    const style = data.style;
    const ortho = data.game.ground.mode === 'ortho';
    this.buildGround(style, !ortho);
    this.buildAreas(style, !ortho || data.game.ground.drawAreas);
    if (!ortho || data.game.ground.drawRoads) this.buildRoads(style);
    if (data.worldConfig.railway.showSurfaceTracks && !ortho) this.buildRails(style);
    this.buildBarriers(style);
    this.buildTrees(style, data.world.trees);
    this.buildProps();
    const sky = skybridgeMesh(data.skybridges);
    if (sky) this.group.add(sky);
    this.buildSunkenPlazas();
  }

  /** 下沉廣場（地面挖洞、走得下去）與上方的大頂棚 */
  private buildSunkenPlazas() {
    const shapes = this.data.sunkenPlazas.map(plazaShape);
    if (shapes.length) {
      this.group.add(groundMask(this.data.world.bounds, shapes.map((s) => s.ring)));
      for (const p of this.data.sunkenPlazas) {
        const m = sunkenPlazaMesh(p);
        this.group.add(m);
        this.cameraObstacles.push(m);
      }
      for (const s of shapes) {
        for (const d of s.decks) this.collision.addDeck(d.pts, d.hw);
        for (const [a, b] of s.walls) this.collision.addSegment(a, b);
      }
    }
    // 棧橋（走得上去）與出入口亭（擋路）
    for (const w of this.data.walkways) this.collision.addDeck(walkwayDeck(w), w.width / 2);
    const walk = walkwayMesh(this.data.walkways);
    if (walk) this.group.add(walk);
    const pav = pavilionMeshes(this.data.pavilions);
    for (const m of pav) this.group.add(m);
    if (pav[0]) this.cameraObstacles.push(pav[0]);
    const pavRings = this.data.pavilions.map((p) => {
      const h = (p.heading * Math.PI) / 180, u: XZ = [Math.sin(h), -Math.cos(h)], v: XZ = [Math.cos(h), Math.sin(h)];
      const c = (a: number, b: number): XZ => [p.center[0] + u[0] * a + v[0] * b, p.center[1] + u[1] * a + v[1] * b];
      return [c(-p.length / 2, -p.width / 2), c(p.length / 2, -p.width / 2), c(p.length / 2, p.width / 2), c(-p.length / 2, p.width / 2)];
    });
    for (const r of pavRings) this.collision.addSolid(r);
    // 頂棚柱子落在坑裡或站體量體裡就不放
    const skipColumn = (x: number, z: number) => shapes.some((s) => pointInRing(x, z, s.ring)) || pavRings.some((r) => pointInRing(x, z, r));
    const canopy = canopyMesh(this.data.canopies, skipColumn);
    if (canopy) this.group.add(canopy);
  }

  /** 目前位置所在的區域 id（station / guangfu / …），都不在則為 outside */
  regionAt(x: number, z: number): string {
    for (const r of this.regions) if (pointInRing(x, z, r.polygon)) return r.id;
    return 'outside';
  }

  regionById(id: string) {
    return this.regions.find((r) => r.id === id);
  }

  get allRegions() {
    return this.regions;
  }

  /** 由射線找出點到哪一棟建築 */
  pickBuilding(raycaster: THREE.Raycaster): Building | null {
    const hit = raycaster.intersectObjects(this.buildingMeshes, false)[0];
    if (!hit || hit.faceIndex == null) return null;
    const idx = (hit.object.userData.triangleToBuilding as Int32Array)[hit.faceIndex];
    return idx != null ? this.buildings[idx] : null;
  }

  // ---------------------------------------------------------------

  private flatMesh(geometry: THREE.BufferGeometry, order: number) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false }));
    mesh.renderOrder = order;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    return mesh;
  }

  /** 加上航照地面（非同步載入完成後呼叫） */
  addOrthoGround(group: THREE.Group) {
    for (const m of group.children) {
      m.renderOrder = LAYER.campus;
      gradeTextureMaterial((m as THREE.Mesh).material as THREE.Material, this.data.style.groundGrade);
    }
    this.group.add(group);
  }

  private buildGround(style: StyleConfig, campusTint: boolean) {
    const b = this.data.world.bounds;
    const margin = 600;
    const w = b.maxX - b.minX + margin * 2, h = b.maxZ - b.minZ + margin * 2;
    const g = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    const c = new THREE.Color(style.ground);
    const colors = new Float32Array(g.attributes.position.count * 3).map((_, i) => [c.r, c.g, c.b][i % 3]);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.flatMesh(g, LAYER.ground);
    if (!campusTint) return;

    const campus = new FlatBuilder();
    const cc = new THREE.Color(style.campusGround);
    for (const r of this.regions) if (r.id !== 'station') campus.add(r.polygon, [], 0, cc);
    this.flatMesh(campus.build(), LAYER.campus);
  }

  private buildAreas(style: StyleConfig, draw: boolean) {
    const green = new FlatBuilder(), surface = new FlatBuilder(), water = new FlatBuilder();
    // 跨水的步道橋：池岸碰撞在橋下斷開，橋面走得上去
    const waterAreas = this.data.world.areas.filter((a) => a.kind === 'water');
    const ws = style.water;
    const bridges = ws ? findFootbridges(this.data.world.roads, waterAreas, ws.bridgeRise) : [];
    const underBridge = (x: number, z: number) => nearFootbridge(bridges, x, z, 0.3);
    for (const b of bridges) this.collision.addDeck(b.pts, b.width / 2);
    for (const a of this.data.world.areas) {
      let key = a.kind;
      if (a.kind === 'pitch' && a.sport) {
        if (a.sport.includes('basketball') || a.sport.includes('volleyball')) key = 'pitch_basketball';
        else if (a.sport.includes('tennis') || a.sport.includes('badminton')) key = 'pitch_tennis';
      }
      const color = new THREE.Color(style.areas[key] ?? style.areas[a.kind] ?? '#999999');
      if (a.kind === 'water') {
        water.add(a.outer, a.holes, 0, color);
        this.collision.addSolid(a.outer, underBridge);
      } else if (['grass', 'park', 'wood'].includes(a.kind)) green.add(a.outer, a.holes, 0, color);
      else surface.add(a.outer, a.holes, 0, color);
    }
    // 水面與池岸：航照模式下由 game.json 的 ground.drawWater 決定要不要畫
    if (ws && (draw || this.data.game.ground.drawWater)) {
      for (const m of waterMeshes(waterAreas, new THREE.Color(style.areas.water), ws, underBridge)) this.group.add(m);
      const fb = footbridgeMesh(bridges, ws);
      if (fb) this.group.add(fb);
    }
    if (!draw) return; // 航照模式：其他區域不畫色塊
    this.flatMesh(green.build(), LAYER.green);
    this.flatMesh(surface.build(), LAYER.surface);
    if (!ws) this.flatMesh(water.build(), LAYER.water);
  }

  private buildRoads(style: StyleConfig) {
    const vehicle = new RibbonBuilder(), service = new RibbonBuilder(), foot = new RibbonBuilder();
    const c = (k: string) => new THREE.Color(style.roads[k]);
    for (const r of this.data.world.roads) {
      if (r.tunnel) continue;
      if (VEHICLE_ROADS.has(r.kind)) vehicle.add(r.points, r.width, 0, c('vehicle'));
      else if (r.kind === 'service') service.add(r.points, r.width, 0, c('service'));
      else if (r.kind === 'cycleway') foot.add(r.points, r.width, 0, c('cycleway'));
      else if (r.kind === 'steps') foot.add(r.points, r.width, 0, c('steps'));
      else if (r.kind === 'track') service.add(r.points, r.width, 0, c('track'));
      else if (FOOT_ROADS.has(r.kind)) foot.add(r.points, r.width, 0, c('foot'));
    }
    this.flatMesh(vehicle.build(), LAYER.road);
    this.flatMesh(service.build(), LAYER.service);
    this.flatMesh(foot.build(), LAYER.foot);
    if (style.markings) this.flatMesh(buildMarkings(this.data.world.roads, VEHICLE_ROADS, style.markings, 0.01), LAYER.marking);
  }

  private buildRails(style: StyleConfig) {
    const rb = new RibbonBuilder();
    const ballast = new THREE.Color(style.rail.ballast), track = new THREE.Color(style.rail.track);
    for (const r of this.data.world.rails) {
      rb.add(r.points, 3.2, 0, ballast);
      rb.add(r.points, 0.12, 0, track, 0.72);
      rb.add(r.points, 0.12, 0, track, -0.72);
    }
    this.flatMesh(rb.build(), LAYER.rail);
  }

  /** 建築（非同步：四坡屋頂演算法需要先載入）。sampler 用來從航照取屋頂顏色 */
  async buildBuildings(sampler: OrthoSampler | null) {
    const bs = this.data.style.buildings;
    const roofColorOf = (b: Building, part?: BuildingPart) => {
      const spec = (part ?? b).look.roof.color;
      if (spec && spec !== 'auto') return new THREE.Color(spec);
      const sampled = sampler?.mean((part ?? b).outer);
      if (sampled) return gradeColor(sampled, this.data.style.theme);
      const detail = b.region === 'outside' ? 'outside' : this.regionById(b.region)?.detail === 'full' ? 'full' : 'simple';
      return new THREE.Color(bs[detail].roof ?? '#8f9499');
    };
    this.buildingMeshes = await buildBuildingMeshes(this.buildings, roofColorOf);
    for (const m of this.buildingMeshes) this.group.add(m);
    this.cameraObstacles.push(...this.buildingMeshes);

    // 碰撞：地面層的建築（懸空的空橋、雨遮不擋路）
    for (const b of this.buildings) {
      for (const v of [b, ...b.parts]) {
        if (v.roofOnly || v.minHeight > 2) continue;
        this.collision.addSolid(v.outer);
        for (const h of v.holes) this.collision.addPolyline(h, true);
      }
    }
    if (sampler) this.addCanopyTrees(sampler);
  }

  private buildBarriers(style: StyleConfig) {
    const geos: THREE.BufferGeometry[] = [];
    for (const bar of this.data.world.barriers) {
      const color = new THREE.Color(style.barriers[bar.kind] ?? style.barriers.default);
      const thick = style.barrierThickness[bar.kind] ?? style.barrierThickness.default;
      for (let i = 0; i < bar.points.length - 1; i++) {
        const [ax, az] = bar.points[i], [bx, bz] = bar.points[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const g = new THREE.BoxGeometry(len, bar.height, thick);
        g.rotateY(-Math.atan2(bz - az, bx - ax));
        g.translate((ax + bx) / 2, bar.height / 2, (az + bz) / 2);
        paint(g, color);
        geos.push(g);
      }
      this.collision.addPolyline(bar.points, false);
    }
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
  }

  /** 點在水面上（湖中島不算） */
  private inWater(x: number, z: number) {
    return this.data.world.areas.some((a) => a.kind === 'water' && pointInRing(x, z, a.outer) && !a.holes.some((h) => pointInRing(x, z, h)));
  }

  private buildTrees(style: StyleConfig, all: [number, number, number][]) {
    // 航照上樹冠會蓋到水面，OSM 的樹點偶爾落在池裡；長在水裡的不種，雕塑、校門（有個別造型的設施）旁邊 clearTrees 公尺（預設 2.5）內也不種
    const statues = this.data.world.props.filter((p) => p.model);
    const dry = all.filter(([x, z]) => !this.inWater(x, z) && !statues.some((p) => Math.hypot(p.pos[0] - x, p.pos[1] - z) < (p.model!.clearTrees ?? 2.5)));
    this.buildPalms(style, dry.filter((t) => t[2] === 4));
    const trees = dry.filter((t) => t[2] !== 4);
    if (!trees.length) return;
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1, 6).translate(0, 0.5, 0);
    const leafGeo = new THREE.IcosahedronGeometry(1, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: style.trees.trunk }), trees.length);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ flatShading: true }), trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const leafColors = style.trees.leaves.map((c) => new THREE.Color(c));
    const sizes = style.trees.sizes;
    trees.forEach(([x, z, src], i) => {
      const r = hash01(`${x},${z}`);
      // 單棵標註的樹通常是大樹（例如榕樹），行道樹較小，canopy 是依航照補的樹；尺寸在 style.json 的 trees.sizes
      const sz = sizes[src === 1 ? 'single' : src === 0 ? 'street' : src === 3 ? 'canopy' : 'filled'] ?? sizes.filled;
      const h = sz.h[0] + r * sz.h[1];
      const crown = sz.crown[0] + r * sz.crown[1];
      const trunkH = h - crown * 0.9;
      m.compose(p.set(x, 0, z), q.identity(), s.set(1 + crown * 0.06, trunkH, 1 + crown * 0.06));
      trunks.setMatrixAt(i, m);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * Math.PI * 2);
      m.compose(p.set(x, trunkH + crown * 0.6, z), q, s.set(crown, crown * 0.85, crown));
      leaves.setMatrixAt(i, m);
      leaves.setColorAt(i, leafColors[Math.floor(r * leafColors.length) % leafColors.length]);
      this.collision.addCircle(x, z, 0.3);
    });
    for (const im of [trunks, leaves]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  /** 椰子樹：細高的灰色樹幹，頂端一圈下垂的羽狀葉 */
  private buildPalms(style: StyleConfig, palms: [number, number, number][]) {
    if (!palms.length) return;
    const sz = style.trees.sizes.palm;
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1, 7).translate(0, 0.5, 0);
    const colors = style.trees.palm.fronds.map((c) => new THREE.Color(c));
    const fronds: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      // 每片葉子是壓扁的長錐，從樹頂往外伸、往下垂
      const g = new THREE.ConeGeometry(0.32, 1, 4).rotateZ(-Math.PI / 2).scale(1, 0.25, 1).translate(0.5, 0, 0)
        .rotateZ(-0.35 - (i % 3) * 0.18).rotateY((i / 9) * Math.PI * 2 + (i % 2) * 0.2).toNonIndexed();
      fronds.push(paint(g, colors[i % colors.length]));
    }
    fronds.push(paint(new THREE.SphereGeometry(0.12, 6, 4).toNonIndexed(), colors[0]));
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: style.trees.palm.trunk }), palms.length);
    const crowns = new THREE.InstancedMesh(mergeGeometries(fronds), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }), palms.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    palms.forEach(([x, z], i) => {
      const r = hash01(`palm${x},${z}`);
      const h = sz.h[0] + r * sz.h[1], crown = sz.crown[0] + r * sz.crown[1];
      m.compose(p.set(x, 0, z), q.identity(), s.set(1, h, 1));
      trunks.setMatrixAt(i, m);
      m.compose(p.set(x, h, z), q.setFromAxisAngle(up, r * Math.PI * 2), s.set(crown, crown, crown));
      crowns.setMatrixAt(i, m);
      this.collision.addCircle(x, z, 0.3);
    });
    for (const im of [trunks, crowns]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  /** 依航照綠色比例在校區內補樹（避開建築、車道與既有的樹） */
  private addCanopyTrees(sampler: OrthoSampler) {
    this.sampler = sampler;
    const added: [number, number, number][] = [];
    const cell = (x: number, z: number) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
    const occupied = new Set(this.data.world.trees.map(([x, z]) => cell(x, z)));
    const nearTree = (x: number, z: number, r: number) => {
      const k = Math.ceil(r / 4);
      for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) if (occupied.has(`${Math.floor(x / 4) + i},${Math.floor(z / 4) + j}`)) return true;
      return false;
    };
    for (const c of this.data.canopy) {
      const region = this.regionById(c.region);
      if (!region) continue;
      const ring = region.polygon;
      const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
      const roads = this.data.world.roads.filter((r) => VEHICLE_ROADS.has(r.kind) || r.kind === 'service');
      const onRoad = (x: number, z: number) => roads.some((r) => {
        for (let i = 0; i < r.points.length - 1; i++) {
          const [ax, az] = r.points[i], [bx, bz] = r.points[i + 1];
          const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
          if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r.width / 2 + 1) return true;
        }
        return false;
      });
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += c.spacing) {
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += c.spacing) {
          const jx = x + (hash01(`cx${x},${z}`) - 0.5) * c.spacing * 0.6, jz = z + (hash01(`cz${x},${z}`) - 0.5) * c.spacing * 0.6;
          if (!pointInRing(jx, jz, ring) || nearTree(jx, jz, c.spacing * 0.6)) continue;
          // 樹幹離牆至少 2.5 公尺
          if ([[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]].some(([dx, dz]) => this.collision.isInsideSolid(jx + dx, jz + dz))) continue;
          if (sampler.greenness(jx, jz, c.radius) < c.minGreen || onRoad(jx, jz)) continue;
          added.push([+jx.toFixed(2), +jz.toFixed(2), 3]);
          occupied.add(cell(jx, jz));
        }
      }
    }
    this.data.world.trees.push(...added);
    this.buildTrees(this.data.style, added);
  }

  private buildProps() {
    for (const m of buildPropMeshes(this.data.world.props, this.data.style.props)) this.group.add(m);
  }
}

function paint(g: THREE.BufferGeometry, color: THREE.Color) {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

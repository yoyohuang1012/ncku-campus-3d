// 進入點：載入資料 → 建立場景、玩家、NPC、介面 → 主迴圈。
import * as THREE from 'three';
import './style.css';
import { GameClock } from './core/clock';
import { loadGameData } from './core/data';
import { setStrings, t } from './core/i18n';
import { Input, isTouchDevice } from './core/input';
import type { DialogueAction, XZ } from './core/types';
import { NavGraph } from './nav/navgraph';
import { RouteGuide } from './nav/route';
import { NpcManager } from './npc/npcs';
import { ThirdPersonCamera } from './player/camera';
import { Player } from './player/player';
import { BuildingInfo } from './ui/buildingInfo';
import { DialogueBox } from './ui/dialogue';
import { Hud } from './ui/hud';
import { Labels } from './ui/labels';
import { Minimap } from './ui/minimap';
import { buildSearchIndex, SearchPanel } from './ui/search';
import { pointInRing } from './world/collision';
import { buildOrthoGround, loadOrthoIndex, loadOrthoTiles } from './world/ortho';
import { OrthoSampler } from './world/orthoSampler';
import { facadeUniforms } from './world/facade';
import { World } from './world/world';

const loadingEl = document.getElementById('loading')!;
const loadingText = document.getElementById('loading-text')!;

async function main() {
  const data = await loadGameData((step) => {
    loadingText.textContent = step === 'world' ? '讀取地圖資料…' : step === 'done' ? '建造校園…' : '載入中…';
  });
  setStrings(data.strings);
  document.title = t('app.title');
  await new Promise((r) => setTimeout(r, 0));

  const cfg = data.game;

  // ---------- 航照 ----------
  loadingText.textContent = '載入航照…';
  const useOrthoGround = cfg.ground.mode === 'ortho', useOrthoMap = cfg.minimap.base === 'ortho';
  const orthoIndex = useOrthoGround || useOrthoMap ? await loadOrthoIndex() : null;
  const groundZoom = isTouchDevice ? cfg.ground.mobileZoom : cfg.ground.zoom;
  const groundTiles = orthoIndex && useOrthoGround ? await loadOrthoTiles(orthoIndex, groundZoom, data.latLonToXZ) : [];
  const mapTiles = orthoIndex && useOrthoMap
    ? groundZoom === 18 && groundTiles.length ? groundTiles : await loadOrthoTiles(orthoIndex, 18, data.latLonToXZ)
    : [];
  loadingText.textContent = '建造校園…';

  // ---------- 繪圖 ----------
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouchDevice, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice ? cfg.render.mobileMaxPixelRatio : cfg.render.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const shadows = isTouchDevice ? cfg.render.mobileShadows : cfg.render.shadows;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const light = data.style.lighting;
  const skyDay = new THREE.Color(data.style.sky), skyNight = new THREE.Color(light.skyNight), skyDusk = new THREE.Color(light.skyDusk);
  const sunDay = new THREE.Color(light.sunColor), sunDusk = new THREE.Color(light.sunDusk);
  scene.background = skyDay.clone();
  scene.fog = new THREE.Fog(skyDay.clone(), cfg.render.fogNear, cfg.render.fogFar);

  const camera = new THREE.PerspectiveCamera(cfg.camera.fov, window.innerWidth / window.innerHeight, 0.3, cfg.render.far);

  const hemi = new THREE.HemisphereLight(light.hemiSky, light.hemiGround, light.hemiIntensity[0] + light.hemiIntensity[1]);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(sunDay, light.sunIntensity[0] + light.sunIntensity[1]);
  sun.castShadow = shadows;
  const R = cfg.render.shadowRange;
  Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 600 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // ---------- 世界 ----------
  const world = new World(data);
  await world.buildBuildings(mapTiles.length ? new OrthoSampler(mapTiles, data.world.bounds) : null);
  if (groundTiles.length) world.addOrthoGround(buildOrthoGround(groundTiles, groundZoom, data.latLonToXZ, 0, renderer.capabilities.getMaxAnisotropy()));
  scene.add(world.group);
  const nav = new NavGraph(data.nav);
  const isWalkable = (x: number, z: number) => !world.collision.isInsideSolid(x, z);
  const nearestWalkable = (p: XZ): XZ => {
    if (isWalkable(p[0], p[1])) return p;
    const i = nav.nearest(p[0], p[1], (n) => isWalkable(nav.nodes[n][0], nav.nodes[n][1]));
    return i >= 0 ? nav.nodes[i] : p;
  };

  // ---------- 玩家與攝影機 ----------
  const uiRoot = document.getElementById('ui')!;
  const input = new Input(canvas, uiRoot);
  const player = new Player(cfg.player, world.collision);
  scene.add(player.rig.root);
  const spawn = nearestWalkable(data.world.spawn.pos);
  const spawnHeading = (-data.world.spawn.heading * Math.PI) / 180;
  player.teleport(spawn[0], spawn[1], spawnHeading);
  const camRig = new ThirdPersonCamera(camera, cfg.camera, world.cameraObstacles);
  camRig.yaw = spawnHeading;

  const clock = new GameClock(cfg.clock);
  const npcs = new NpcManager(data, clock, nav, scene, isWalkable);
  npcs.refresh(true);
  const route = new RouteGuide(nav, scene, data.style.route, cfg.navigation.arrowSpacing, cfg.navigation.arriveDistance, -11);

  // ---------- 動作（傳送、導航） ----------
  const teleportTo = (p: XZ) => {
    const w = nearestWalkable(p);
    const heading = Math.hypot(p[0] - w[0], p[1] - w[1]) > 0.5 ? Math.atan2(-(p[0] - w[0]), -(p[1] - w[1])) : player.heading;
    player.teleport(w[0], w[1], heading);
    camRig.yaw = heading;
    buildingInfo.hide();
  };
  const navigateTo = (name: string, points: XZ[]) => {
    const len = route.start(player.xz, { name, points });
    if (len == null) hud.toast(t('ui.route.fail'));
    else hud.setRoute(name, len);
  };
  const targetPoints = (target: string): { name: string; points: XZ[] } | null => {
    if (target.startsWith('region:')) {
      const r = world.regionById(target.slice(7));
      if (!r) return null;
      let x = 0, z = 0;
      for (const p of r.polygon) { x += p[0]; z += p[1]; }
      return { name: t(r.nameKey), points: [[x / r.polygon.length, z / r.polygon.length]] };
    }
    const b = data.buildingById.get(target);
    if (!b) return null;
    return { name: b.name ?? target, points: b.entrances.length ? b.entrances : [b.center] };
  };

  // ---------- 介面 ----------
  const hud = new Hud(uiRoot, clock, {
    onSearch: () => search.open(),
    onCancelRoute: () => { route.clear(); },
    onTalk: () => input.trigger('interact'),
  });
  route.onChange = () => { if (!route.path) hud.setRoute(null); };
  route.onArrive = (tg) => hud.toast(t('ui.route.arrived', { name: tg.name }));

  const labels = new Labels(uiRoot, world.buildings, (id) => t(`region.${id}`), cfg.labels.maxDistance, cfg.labels.maxCount);
  const minimap = new Minimap(uiRoot, data, {
    onTeleport: (p) => teleportTo(p),
    onNavigate: (p, name) => navigateTo(name, [p]),
    describe: (x, z) => {
      const b = world.buildings.find((bd) => bd.name && !bd.roofOnly && Math.abs(bd.center[0] - x) < 150 && Math.abs(bd.center[1] - z) < 150 && pointInRing(x, z, bd.outer));
      return b?.name ?? null;
    },
    onOpenChange: () => {},
  }, mapTiles);
  const search = new SearchPanel(uiRoot, buildSearchIndex(data), {
    onNavigate: (e) => navigateTo(e.name, e.points),
    onTeleport: (e) => teleportTo(e.points[0]),
    onOpenChange: () => {},
  });
  const buildingInfo = new BuildingInfo(uiRoot, {
    onNavigate: (b) => navigateTo(b.name ?? '', b.entrances.length ? b.entrances : [b.center]),
    onTeleport: (b) => teleportTo(b.entrances[0] ?? b.center),
  });
  const dialogue = new DialogueBox(uiRoot);
  dialogue.actions.set('navigate', (a: DialogueAction) => {
    const tp = targetPoints(String(a.target));
    if (tp) navigateTo(tp.name, tp.points);
  });
  dialogue.actions.set('teleport', (a: DialogueAction) => {
    const tp = targetPoints(String(a.target));
    if (tp) teleportTo(tp.points[0]);
  });

  input.on('interact', () => {
    if (dialogue.isOpen || minimap.isOpen || search.isOpen) return;
    const npc = npcs.nearestInteractable(player.xz, cfg.npc.interactDistance);
    const dlg = npc?.entry.dialogue ? data.dialogues[npc.entry.dialogue] : null;
    if (npc && dlg) dialogue.open(t(npc.def.nameKey), dlg);
  });
  input.on('map', () => { if (!search.isOpen && !dialogue.isOpen) minimap.toggle(); });
  input.on('escape', () => {
    if (dialogue.isOpen) dialogue.close();
    else if (search.isOpen) search.close();
    else if (minimap.isOpen) minimap.close();
    else buildingInfo.hide();
  });
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  input.onClick((x, y) => {
    if (dialogue.isOpen || minimap.isOpen || search.isOpen) return;
    raycaster.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), camera);
    const b = world.pickBuilding(raycaster);
    if (b && !b.roofOnly) buildingInfo.show(b);
    else buildingInfo.hide();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------- 日夜 ----------
  const updateSky = () => {
    const h = clock.hourFloat();
    // 6 點日出、18 點日落
    const sunAngle = ((h - 6) / 12) * Math.PI;
    const elev = Math.sin(sunAngle);
    const day = THREE.MathUtils.clamp(elev * 2.5 + 0.15, 0, 1);
    const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev) * 4, 0, 1) * (h > 4 && h < 20 ? 1 : 0);
    const sky = skyNight.clone().lerp(skyDay, day).lerp(skyDusk, dusk * 0.45);
    (scene.background as THREE.Color).copy(sky);
    scene.fog!.color.copy(sky);
    sun.intensity = light.sunIntensity[0] + day * light.sunIntensity[1];
    sun.color.copy(sunDay).lerp(sunDusk, dusk * 0.6);
    hemi.intensity = light.hemiIntensity[0] + day * light.hemiIntensity[1];
    facadeUniforms.uNight.value = 1 - THREE.MathUtils.clamp(day * 1.6, 0, 1);
    const az = sunAngle; // 東升西落
    const dir = new THREE.Vector3(Math.cos(az) * 0.8, Math.max(0.25, Math.abs(elev)), 0.45).normalize();
    sun.position.copy(player.position).addScaledVector(dir, 300);
    sun.target.position.copy(player.position);
  };

  // ---------- 建築檢視（校對用） ----------
  // 網址 ?inspect=<建築id>&time=10:00，或在主控台呼叫 game.inspect(id, 方位角, 俯角)：攝影機繞著單棟建築
  let inspectView: { target: THREE.Vector3; dist: number; yaw: number; pitch: number } | null = null;
  /** 對照街景用：從某個經緯度、某個方向看（heading 0 = 北、90 = 東；hfov 為水平視角） */
  let eyeView: { pos: THREE.Vector3; heading: number; pitch: number; hfov: number } | null = null;
  const viewFrom = (lat: number, lon: number, heading = 0, pitchDeg = 0, hfov = 90, eye = 2.5) => {
    const [x, z] = data.latLonToXZ(lat, lon);
    eyeView = { pos: new THREE.Vector3(x, eye, z), heading: (heading * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180, hfov };
    inspectView = null;
    player.rig.root.visible = false;
    player.teleport(x, z);
  };
  const inspect = (id: string | null, yawDeg = 210, pitchDeg = 22, distScale = 1) => {
    const b = id ? data.buildingById.get(id) : null;
    eyeView = null;
    if (!b) { inspectView = null; player.rig.root.visible = true; camera.fov = cfg.camera.fov; camera.updateProjectionMatrix(); return false; }
    const all = [b.outer, ...b.parts.map((p) => p.outer)].flat();
    const xs = all.map((p) => p[0]), zs = all.map((p) => p[1]);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 12);
    const top = Math.max(b.height, ...b.parts.map((p) => p.height));
    inspectView = {
      target: new THREE.Vector3((Math.max(...xs) + Math.min(...xs)) / 2, Math.min(top * 0.45, 14), (Math.max(...zs) + Math.min(...zs)) / 2),
      dist: Math.max(size * 0.9, top * 1.7, 25) * distScale,
      yaw: (yawDeg * Math.PI) / 180,
      pitch: (pitchDeg * Math.PI) / 180,
    };
    player.teleport(inspectView.target.x, inspectView.target.z);
    player.rig.root.visible = false;
    return true;
  };
  const inspectParam = new URLSearchParams(location.search).get('inspect');
  if (inspectParam) inspect(inspectParam);

  // ---------- 主迴圈 ----------
  loadingEl.classList.add('hidden');
  let last = performance.now();
  let hudTimer = 0;
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    input.blocked = dialogue.isOpen || minimap.isOpen || search.isOpen;
    input.update();
    player.update(dt, input, camRig.yaw);
    if (eyeView) {
      const v = eyeView;
      const vfov = (2 * Math.atan(Math.tan((v.hfov * Math.PI) / 360) / camera.aspect) * 180) / Math.PI;
      if (Math.abs(camera.fov - vfov) > 0.01) { camera.fov = vfov; camera.updateProjectionMatrix(); }
      camera.position.copy(v.pos);
      camera.lookAt(v.pos.x + Math.sin(v.heading) * Math.cos(v.pitch), v.pos.y + Math.sin(v.pitch), v.pos.z - Math.cos(v.heading) * Math.cos(v.pitch));
    } else if (inspectView) {
      const v = inspectView;
      // 方位角：0 = 從北邊看、90 = 從東邊看（z 向南）
      camera.position.set(
        v.target.x + Math.sin(v.yaw) * Math.cos(v.pitch) * v.dist,
        v.target.y + Math.sin(v.pitch) * v.dist,
        v.target.z - Math.cos(v.yaw) * Math.cos(v.pitch) * v.dist,
      );
      camera.lookAt(v.target);
    } else camRig.update(dt, input, player.position);
    npcs.update(dt, player.xz, cfg.npc.interactDistance);
    route.update(dt, player.xz);
    updateSky();

    const near = dialogue.isOpen ? null : npcs.nearestInteractable(player.xz, cfg.npc.interactDistance);
    hud.setTalkTarget(near ? t(near.def.nameKey) : null);
    const activeNpcs = [...npcs.active.values()];
    labels.update(camera, player.xz, activeNpcs.filter((n) => n.def.interactive).map((n) => ({ name: t(n.def.nameKey), pos: n.pos })));
    minimap.update(player.xz, player.heading, route.path, activeNpcs.map((n) => n.pos));
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.5;
      hud.update(world.regionAt(player.position.x, player.position.z));
      if (route.target) hud.setRoute(route.target.name, route.remaining());
    }
    renderer.render(scene, camera);
  };
  const loop = () => {
    frame();
    requestAnimationFrame(loop);
  };
  loop();

  // 方便除錯：在瀏覽器主控台可以用 window.game 查看狀態
  (window as unknown as { game: unknown }).game = { data, world, player, camRig, npcs, route, nav, renderer, scene, camera, frame, teleportTo, navigateTo, inspect, viewFrom };
}

main().catch((err) => {
  console.error(err);
  loadingText.textContent = `載入失敗：${err.message}`;
});

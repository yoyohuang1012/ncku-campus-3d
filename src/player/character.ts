// 灰盒階段的人物造型（玩家、NPC、路人共用）。之後換成 GLB 模型時只要替換這個函式的輸出。
import * as THREE from 'three';

export interface Appearance {
  shirt?: string;
  pants?: string;
  skin?: string;
  hair?: string;
  bag?: string;
}

export interface CharacterRig {
  root: THREE.Group;
  /** 動畫用的關節 */
  body: THREE.Group;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  phase: number;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}
const matCache = new Map<string, THREE.Material>();
function mat(color: string) {
  let m = matCache.get(color);
  if (!m) matCache.set(color, (m = new THREE.MeshLambertMaterial({ color })));
  return m;
}

function limb(color: string, len: number, r: number) {
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(cached(`limb${len}${r}`, () => new THREE.CapsuleGeometry(r, len - r * 2, 3, 6).translate(0, -len / 2, 0)), mat(color));
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
}

export function createCharacter(a: Appearance): CharacterRig {
  const skin = a.skin ?? '#e8b98f', shirt = a.shirt ?? '#4a90d9', pants = a.pants ?? '#2d3748', hair = a.hair ?? '#2a1d14';
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = new THREE.Mesh(cached('torso', () => new THREE.CapsuleGeometry(0.2, 0.42, 3, 8).translate(0, 1.18, 0)), mat(shirt));
  torso.scale.set(1, 1, 0.75);
  const head = new THREE.Mesh(cached('head', () => new THREE.SphereGeometry(0.16, 10, 8).translate(0, 1.66, 0)), mat(skin));
  const hairMesh = new THREE.Mesh(cached('hair', () => new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.68, 0.01)), mat(hair));
  for (const m of [torso, head, hairMesh]) { m.castShadow = true; body.add(m); }
  if (a.bag) {
    const bag = new THREE.Mesh(cached('bag', () => new THREE.BoxGeometry(0.3, 0.38, 0.14).translate(0, 1.2, 0.2)), mat(a.bag));
    bag.castShadow = true;
    body.add(bag);
  }

  const armL = limb(shirt, 0.6, 0.065); armL.position.set(-0.26, 1.42, 0);
  const armR = limb(shirt, 0.6, 0.065); armR.position.set(0.26, 1.42, 0);
  const legL = limb(pants, 0.82, 0.085); legL.position.set(-0.1, 0.84, 0);
  const legR = limb(pants, 0.82, 0.085); legR.position.set(0.1, 0.84, 0);
  body.add(armL, armR, legL, legR);

  return { root, body, armL, armR, legL, legR, phase: 0 };
}

/** 依移動速度擺動手腳；speed 單位 m/s */
export function animateWalk(rig: CharacterRig, speed: number, dt: number) {
  const moving = speed > 0.1;
  rig.phase += dt * (moving ? 2.2 + speed * 1.3 : 0);
  const amp = moving ? Math.min(0.9, 0.25 + speed * 0.12) : 0;
  const s = Math.sin(rig.phase);
  const k = Math.min(1, dt * 12);
  rig.legL.rotation.x += (s * amp - rig.legL.rotation.x) * k;
  rig.legR.rotation.x += (-s * amp - rig.legR.rotation.x) * k;
  rig.armL.rotation.x += (-s * amp * 0.8 - rig.armL.rotation.x) * k;
  rig.armR.rotation.x += (s * amp * 0.8 - rig.armR.rotation.x) * k;
  rig.armL.rotation.z += (0.08 - rig.armL.rotation.z) * k;
  rig.armR.rotation.z += (-0.08 - rig.armR.rotation.z) * k;
  rig.body.position.y = moving ? Math.abs(Math.cos(rig.phase)) * 0.04 : 0;
}

/** NPC 原地動作 */
export function animateIdle(rig: CharacterRig, kind: string | undefined, time: number) {
  rig.legL.rotation.x = rig.legR.rotation.x = 0;
  rig.body.position.y = 0;
  rig.body.rotation.y = 0;
  rig.armL.rotation.set(0, 0, 0.08);
  rig.armR.rotation.set(0, 0, -0.08);
  if (kind === 'wave') {
    rig.armR.rotation.z = -2.6 + Math.sin(time * 6) * 0.35;
  } else if (kind === 'dance') {
    const s = Math.sin(time * 7);
    rig.body.position.y = Math.abs(s) * 0.12;
    rig.body.rotation.y = Math.sin(time * 3.5) * 0.6;
    rig.armL.rotation.z = 1.6 + s * 0.8;
    rig.armR.rotation.z = -1.6 + s * 0.8;
    rig.legL.rotation.x = s * 0.4;
    rig.legR.rotation.x = -s * 0.4;
  } else {
    rig.body.position.y = Math.sin(time * 1.8) * 0.008;
  }
}

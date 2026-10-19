// 第三人稱攝影機：跟在玩家後方，可拖曳旋轉、滾輪縮放，碰到建築會自動拉近避免穿牆。
import * as THREE from 'three';
import type { Input } from '../core/input';
import { isTouchDevice } from '../core/input';
import type { GameConfig } from '../core/types';

export class ThirdPersonCamera {
  yaw = 0;
  pitch = 0.35;
  private distance: number;
  private currentDistance: number;
  private raycaster = new THREE.Raycaster();

  constructor(readonly camera: THREE.PerspectiveCamera, private cfg: GameConfig['camera'], private obstacles: THREE.Object3D[]) {
    this.distance = cfg.distance;
    this.currentDistance = cfg.distance;
    this.raycaster.firstHitOnly = true;
  }

  update(dt: number, input: Input, target: THREE.Vector3) {
    const look = input.consumeLook();
    const sens = isTouchDevice ? this.cfg.touchSensitivity : this.cfg.mouseSensitivity;
    this.yaw -= look.dx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.dy * sens, this.cfg.minPitch, this.cfg.maxPitch);
    const zoom = input.consumeZoom();
    if (zoom) this.distance = THREE.MathUtils.clamp(this.distance * (1 + zoom * 0.12), this.cfg.minDistance, this.cfg.maxDistance);

    const focus = new THREE.Vector3(target.x, target.y + this.cfg.height, target.z);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));

    // 避免攝影機穿進建築
    let want = this.distance;
    this.raycaster.set(focus, dir);
    this.raycaster.far = this.distance;
    const hit = this.raycaster.intersectObjects(this.obstacles, false)[0];
    if (hit) want = Math.max(0.8, hit.distance - 0.3);
    // 拉近要快、退回要慢，看起來比較順
    const k = want < this.currentDistance ? 1 : Math.min(1, dt * 4);
    this.currentDistance += (want - this.currentDistance) * k;

    this.camera.position.copy(focus).addScaledVector(dir, this.currentDistance);
    // 不鑽到地面下；人在下沉廣場裡時可以跟著往下
    const floor = Math.min(0, target.y) + 0.3;
    if (this.camera.position.y < floor) this.camera.position.y = floor;
    this.camera.lookAt(focus);
  }
}

declare module 'three' {
  interface Raycaster {
    firstHitOnly?: boolean;
  }
}

// 玩家：依輸入與攝影機方向移動，經過碰撞處理。
import * as THREE from 'three';
import type { Input } from '../core/input';
import type { GameConfig, XZ } from '../core/types';
import type { Collision } from '../world/collision';
import { animateWalk, createCharacter, type CharacterRig } from './character';

export class Player {
  readonly rig: CharacterRig;
  readonly position = new THREE.Vector3();
  heading = 0; // 弧度，0 = 朝 -Z（北）
  speed = 0;

  constructor(private cfg: GameConfig['player'], private collision: Collision) {
    this.rig = createCharacter({ shirt: '#3b82c4', pants: '#2d3748', skin: '#e8b98f', hair: '#1f1a17', bag: '#2f4858' });
  }

  get xz(): XZ {
    return [this.position.x, this.position.z];
  }

  teleport(x: number, z: number, heading?: number) {
    this.position.set(x, this.collision.heightAt(x, z), z);
    if (heading != null) this.heading = heading;
    this.sync();
  }

  update(dt: number, input: Input, cameraYaw: number) {
    const { x, y } = input.move;
    const mag = Math.hypot(x, y);
    if (mag > 0.01) {
      // 以攝影機朝向為「前」
      const fx = -Math.sin(cameraYaw), fz = -Math.cos(cameraYaw);
      const rx = -fz, rz = fx;
      const dx = fx * y + rx * x, dz = fz * y + rz * x;
      const speed = (input.run ? this.cfg.runSpeed : this.cfg.walkSpeed) * Math.min(1, mag);
      const [nx, nz] = this.collision.move(this.position.x, this.position.z, (dx / mag) * speed * dt * Math.min(1, mag), (dz / mag) * speed * dt * Math.min(1, mag), this.cfg.radius);
      this.speed = Math.hypot(nx - this.position.x, nz - this.position.z) / dt;
      this.position.x = nx;
      this.position.z = nz;
      this.position.y = this.collision.heightAt(nx, nz);
      const target = Math.atan2(-dx, -dz);
      let diff = target - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * this.cfg.turnSpeed);
    } else {
      this.speed = 0;
    }
    animateWalk(this.rig, this.speed, dt);
    this.sync();
  }

  private sync() {
    this.rig.root.position.copy(this.position);
    // 人物模型正面朝 -Z（背包在 +Z），與 heading 定義相同
    this.rig.root.rotation.y = this.heading;
  }
}

import * as THREE from 'three';

/**
 * 04. Ammo.js — 3D 手部刚体碰撞与交互物理引擎 (Rigid-Body Physics & Finger Collider Engine)
 * 在静态开发模式下，为 3D 手模的 21 个解剖关节构建运动学刚体碰撞器 (Kinematic Colliders)，
 * 并提供物理测试小球与重力碰撞场，方便直观检验 3D 手模的碰撞包络体积与拨动物理交互。
 */
export class HandPhysicsEngine {
  constructor(scene, onCollisionImpact = null) {
    this.scene = scene;
    this.onCollisionImpact = onCollisionImpact;
    this.enabled = false;
    this.showColliders = false;

    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    // 21 个手部关节运动学刚体球 (Kinematic Joint Colliders)
    this.jointColliders = [];
    const colliderMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.32,
    });
    const sphereGeo = new THREE.SphereGeometry(1, 10, 8);

    for (let i = 0; i < 21; i++) {
      const mesh = new THREE.Mesh(sphereGeo, colliderMat);
      mesh.visible = false;
      this.group.add(mesh);
      this.jointColliders.push({
        index: i,
        position: new THREE.Vector3(),
        prevPosition: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        radius: i === 0 ? 32 : i % 4 === 0 ? 15 : 18,
        mesh,
      });
    }

    // 动态受重力物理测试球 (Dynamic Rigid Bodies)
    this.dynamicBodies = [];
    this._initDynamicBalls();
  }

  _initDynamicBalls() {
    const colors = [0x6366f1, 0x06b6d4, 0x10b981, 0xf59e0b, 0xec4899];
    const ballGeo = new THREE.IcosahedronGeometry(1, 2);

    colors.forEach((col, idx) => {
      const mat = new THREE.MeshPhysicalMaterial({
        color: col,
        roughness: 0.2,
        metalness: 0.15,
        clearcoat: 0.8,
      });
      const mesh = new THREE.Mesh(ballGeo, mat);
      const radius = 18 + (idx % 3) * 4;
      mesh.scale.set(radius, radius, radius);
      this.group.add(mesh);

      this.dynamicBodies.push({
        mesh,
        radius,
        position: new THREE.Vector3((idx - 2) * 55, -180 - idx * 25, 25 + (idx % 2) * 20),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 2, 0, 0),
        restitution: 0.76,
      });
    });
  }

  setEnabled(flag) {
    this.enabled = flag;
    this.group.visible = flag || this.showColliders;
    this.dynamicBodies.forEach((b) => {
      b.mesh.visible = flag;
    });
    if (flag) {
      this.respawnBalls();
    }
  }

  setShowColliders(flag) {
    this.showColliders = flag;
    this.group.visible = this.enabled || flag;
    this.jointColliders.forEach((c) => {
      c.mesh.visible = flag;
    });
  }

  respawnBalls() {
    this.dynamicBodies.forEach((b, idx) => {
      b.position.set((idx - 2) * 48, 175 + idx * 22, (idx % 2 === 0 ? 1 : -1) * 18);
      b.velocity.set((Math.random() - 0.5) * 1.5, -1.2, (Math.random() - 0.5) * 1.2);
      b.mesh.position.copy(b.position);
    });
  }

  /**
   * 同步 3D 手模 21 个关节点世界坐标，并步进刚体碰撞解算
   */
  step(pts3D, dt = 0.016) {
    if (!pts3D || pts3D.length < 21) return;

    // 1. 更新 21 个手部运动学刚体位置与速度
    for (let i = 0; i < 21; i++) {
      const c = this.jointColliders[i];
      c.prevPosition.copy(c.position);
      c.position.set(pts3D[i].x, pts3D[i].y, pts3D[i].z);
      c.velocity.subVectors(c.position, c.prevPosition).divideScalar(Math.max(dt, 0.004));

      if (this.showColliders) {
        c.mesh.position.copy(c.position);
        c.mesh.scale.set(c.radius, c.radius, c.radius);
      }
    }

    if (!this.enabled) return;

    // 2. 物理步进：重力、空气阻尼、边界约束与手部刚体球冲量碰撞
    const gravity = -340; // Y 轴向上坐标系下的重力加速度
    const floorY = -195;
    const wallX = 240;
    const wallZ = 160;

    this.dynamicBodies.forEach((body) => {
      body.velocity.y += gravity * dt;
      body.velocity.multiplyScalar(0.994);
      body.position.addScaledVector(body.velocity, dt * 60 * 0.25);

      // 地面与四周弹性边界
      if (body.position.y - body.radius < floorY) {
        body.position.y = floorY + body.radius;
        body.velocity.y = -body.velocity.y * body.restitution;
        if (Math.abs(body.velocity.y) < 8) {
          // 自动循环抛起，持续测试手部碰撞
          body.position.set((Math.random() - 0.5) * 190, 195, (Math.random() - 0.5) * 50);
          body.velocity.set((Math.random() - 0.5) * 12, -10, (Math.random() - 0.5) * 10);
        }
      }
      if (Math.abs(body.position.x) + body.radius > wallX) {
        body.position.x = Math.sign(body.position.x) * (wallX - body.radius);
        body.velocity.x *= -0.8;
      }
      if (Math.abs(body.position.z) + body.radius > wallZ) {
        body.position.z = Math.sign(body.position.z) * (wallZ - body.radius);
        body.velocity.z *= -0.8;
      }

      // 与 21 个手部骨骼关节刚体碰撞解算
      for (let i = 0; i < 21; i++) {
        const jc = this.jointColliders[i];
        const diff = new THREE.Vector3().subVectors(body.position, jc.position);
        const dist = diff.length();
        const minDist = body.radius + jc.radius;

        if (dist < minDist && dist > 0.001) {
          const normal = diff.divideScalar(dist);
          const penetration = minDist - dist;
          body.position.addScaledVector(normal, penetration * 1.05);

          const relVel = new THREE.Vector3().subVectors(body.velocity, jc.velocity.clone().multiplyScalar(0.04));
          const sepVel = relVel.dot(normal);
          if (sepVel < 0) {
            const impulse = -(1 + body.restitution) * sepVel;
            body.velocity.addScaledVector(normal, impulse + 6);

            if (this.onCollisionImpact && Math.abs(impulse) > 3.5) {
              this.onCollisionImpact(Math.min(3.0, Math.abs(impulse) * 0.15));
            }
          }
        }
      }

      body.mesh.position.copy(body.position);
      body.mesh.rotation.x += body.velocity.z * 0.01;
      body.mesh.rotation.z -= body.velocity.x * 0.01;
    });
  }
}

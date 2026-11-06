// Bullet pool. Every shot on the board is one of these — player shots, enemy shots, local or
// remote. A bullet flies straight, carves brick strips, ricochets nothing, and dies on the
// first thing it touches. Bullet-vs-bullet: an enemy shot and a player shot cancel out.
import * as THREE from 'three';
import { makeInkMaterial, INK } from './render.js';
import { DIRS, BOARD_MIN, BOARD_MAX, T } from './physics.js';

export class BulletManager {
  constructor(scene, grid) {
    this.scene = scene; this.grid = grid;
    this.list = [];
    this.mat = makeInkMaterial({ ink: INK.RED, shadeScale: 0.9 });
    this.geo = new THREE.SphereGeometry(0.16, 8, 6);
    this.trailGeo = new THREE.BoxGeometry(0.09, 0.06, 0.6);
    this.nextId = 1;
  }
  clear() { for (const b of this.list) this.remove(b); this.list.length = 0; }
  remove(b) {
    this.scene.remove(b.mesh);
    this.scene.remove(b.trail);
  }
  spawn({ x, z, dir, power = 1, owner = null, fromEnemy = false, speed = 10, id = null, pierce = false }) {
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.position.set(x, 0.98, z);
    this.scene.add(mesh);
    // a short ink streak trailing the shot
    const trail = new THREE.Mesh(this.trailGeo, this.mat);
    this.scene.add(trail);
    const b = { id: id ?? this.nextId++, x, z, dir, power, owner, fromEnemy, speed, pierce, mesh, trail, alive: true };
    this.place(b, x, z);
    this.list.push(b);
    return b;
  }
  place(b, x, z) {
    b.mesh.position.set(x, 0.98, z);
    const d = DIRS[b.dir];
    b.trail.position.set(x - d.x * 0.45, 0.96, z - d.z * 0.45);
    b.trail.rotation.y = d.x !== 0 ? Math.PI / 2 : 0;
  }
  // step all bullets; cb callbacks fire for game-level consequences (tile damage, tank hits...)
  update(dt, cb) {
    const dead = [];
    for (const b of this.list) {
      if (!b.alive) { dead.push(b); continue; }
      const d = DIRS[b.dir];
      let px = b.x, pz = b.z;
      let remain = b.speed * dt;
      while (remain > 0) {
        const step = Math.min(remain, 0.45);
        px += d.x * step; pz += d.z * step;
        remain -= step;
        const hit = this.grid.bulletStep(px, pz);
        if (hit) {
          cb.onTile && cb.onTile(b, hit, px, pz);
          // 穿甲弹：击碎砖墙后继续飞行（钢墙/老鹰仍然拦停）
          if (!(b.pierce && hit.type === T.BRICK)) {
            b.alive = false;
            cb.onImpact && cb.onImpact(b, px, pz, hit);
            break;
          }
        }
        if (px < BOARD_MIN - 0.3 || px > BOARD_MAX + 0.3 || pz < BOARD_MIN - 0.3 || pz > BOARD_MAX + 0.3) {
          b.alive = false;
          cb.onImpact && cb.onImpact(b, THREE.MathUtils.clamp(px, BOARD_MIN, BOARD_MAX), THREE.MathUtils.clamp(pz, BOARD_MIN, BOARD_MAX), null);
          break;
        }
        // bullet meets bullet: opposing shots cancel in mid-air
        for (const o of this.list) {
          if (o === b || !o.alive || o.fromEnemy === b.fromEnemy) continue;
          const dx = o.x - px, dz = o.z - pz;
          if (dx * dx + dz * dz < 0.16) {
            b.alive = false; o.alive = false;
            cb.onImpact && cb.onImpact(b, px, pz, null);
            cb.onImpact && cb.onImpact(o, o.x, o.z, null);
            break;
          }
        }
        if (!b.alive) break;
        // tank hits
        const hitTank = cb.onTankProbe && cb.onTankProbe(b, px, pz);
        if (hitTank) { b.alive = false; break; }
      }
      if (b.alive) { b.x = px; b.z = pz; this.place(b, px, pz); }
      else dead.push(b);
    }
    for (const b of dead) { this.remove(b); const i = this.list.indexOf(b); if (i >= 0) this.list.splice(i, 1); }
  }
  countOf(owner) { let n = 0; for (const b of this.list) if (b.alive && b.owner === owner) n++; return n; }
  serialize() {
    return this.list.filter((b) => b.alive).map((b) => ({ i: b.id, x: +b.x.toFixed(2), z: +b.z.toFixed(2), d: b.dir, e: b.fromEnemy ? 1 : 0, s: +b.speed.toFixed(1), p: b.power }));
  }
}

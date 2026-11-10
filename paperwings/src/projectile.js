// Paper balls are slow, arcing projectiles, so hitting a moving plane is about leading it.
// The orange dotted arc on screen is sampled from exactly the same equation as the ball.
import * as THREE from 'three';
import { makeInkMaterial, INK } from './render.js';
import { SEE_THROUGH } from './physics.js';
import { clamp } from './util.js';

export const BALL_SPEED = 32;
export const BALL_GRAVITY = 4.2;
const MAX = 240;
const _v = new THREE.Vector3(), _ab = new THREE.Vector3(), _ac = new THREE.Vector3();
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();

function segHitsSphere(a, b, c, r) {
  _ab.subVectors(b, a); const l2 = _ab.lengthSq();
  if (l2 < 1e-8) return a.distanceToSquared(c) < r * r;
  const t = clamp(_ac.subVectors(c, a).dot(_ab) / l2, 0, 1);
  _p.copy(a).addScaledVector(_ab, t);
  return _p.distanceToSquared(c) < r * r;
}

// lead the target, then compensate the parabolic drop with the vertical component
export function aimVelocity(from, targetPos, targetVel, speed = BALL_SPEED, out = new THREE.Vector3()) {
  _v.copy(targetPos);
  let t = from.distanceTo(targetPos) / speed;
  for (let i = 0; i < 3; i++) {
    _v.copy(targetPos).addScaledVector(targetVel, t);
    t = Math.hypot(_v.x - from.x, _v.z - from.z) / speed;
  }
  const dx = _v.x - from.x, dz = _v.z - from.z;
  const h = Math.max(0.01, Math.hypot(dx, dz));
  const flight = h / speed;
  out.set(dx / h * speed, (_v.y - from.y + 0.5 * BALL_GRAVITY * flight * flight) / flight, dz / h * speed);
  return out;
}

class AimArc {
  constructor(scene) {
    this.mat = makeInkMaterial({ ink: INK.ORANGE, fill: true });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.mat, 40);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(40 * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0; scene.add(this.mesh);
  }
  show(from, vel) {
    const n = 34; _q.identity(); _s.setScalar(0.13);
    for (let i = 0; i < n; i++) {
      const t = 0.045 + i * 0.038;
      _p.set(from.x + vel.x * t, from.y + vel.y * t - 0.5 * BALL_GRAVITY * t * t, from.z + vel.z * t);
      _m.compose(_p, _q, _s); this.mesh.setMatrixAt(i, _m);
      const c = this.mesh.instanceColor.array; c[i * 3] = INK.ORANGE; c[i * 3 + 1] = 1; c[i * 3 + 2] = 0;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
  hide() { this.mesh.count = 0; }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.parent?.remove(this.mesh); }
}

export class PaperBalls {
  constructor(ctx) {
    this.ctx = ctx; this.list = []; this.nextId = 1;
    this.mat = makeInkMaterial({ ink: INK.BLUE, fill: true });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.32, 0), this.mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0; ctx.scene.add(this.mesh);
    this.aim = new AimArc(ctx.scene);
  }
  fire({ pos, vel, dmg = 1, owner = 'local', ink = INK.BLUE, life = 3.4, id = null, mirror = false }) {
    if (this.list.length >= MAX) this.list.shift();
    const p = { id: id ?? `${owner}-${this.nextId++}`, pos: pos.clone(), prev: pos.clone(), vel: vel.clone(), dmg, owner, ink, life, mirror };
    this.list.push(p);
    if (!mirror && this.ctx.onFire) this.ctx.onFire(p);
    return p;
  }
  clear() { this.list.length = 0; this.mesh.count = 0; this.aim.hide(); }
  update(dt) {
    const ctx = this.ctx, targets = ctx.targets();
    let n = 0;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      p.life -= dt; if (p.life <= 0) continue;
      p.prev.copy(p.pos);
      p.vel.y -= BALL_GRAVITY * dt;
      p.pos.addScaledVector(p.vel, dt);
      _v.subVectors(p.pos, p.prev); const len = _v.length();
      if (len < 1e-6) { this.list[n++] = p; continue; }
      _v.divideScalar(len);
      const wall = ctx.world.raycast(p.prev, _v, len, SEE_THROUGH);
      if (wall) { ctx.effects.bulletImpact(wall.point, wall.normal, p.ink); continue; }
      let consumed = false;
      for (const t of targets) {
        if (!t.alive || t.ownerId === p.owner) continue;
        if (!segHitsSphere(p.prev, p.pos, t.pos, t.hitRadius || 1.2)) continue;
        if (t.kind === 'enemy') ctx.onEnemyHit(t, p);
        else if (t.isLocal) ctx.onLocalHit(t, p);
        else ctx.onRemoteHit(t, p);
        consumed = true; break;
      }
      if (consumed) continue;
      if (p.pos.y < 0 || Math.abs(p.pos.x) > 110 || Math.abs(p.pos.z) > 110) continue;
      this.list[n++] = p;
    }
    this.list.length = n;
    _q.identity();
    for (let i = 0; i < n; i++) {
      const p = this.list[i];
      _s.setScalar(p.mirror ? 0.85 : 1);
      _m.compose(p.pos, _q, _s); this.mesh.setMatrixAt(i, _m);
      const c = this.mesh.instanceColor.array; c[i * 3] = p.ink; c[i * 3 + 1] = 1; c[i * 3 + 2] = 0;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.parent?.remove(this.mesh); this.aim.dispose(); }
}

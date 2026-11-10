// The plane always flies itself. A click only sets a waypoint or a target: it turns at a fixed
// rate, banks into the turn, and drifts between heights so the page never looks static.
import * as THREE from 'three';
import { clamp, damp, wrapAngle, rand, TAU } from './util.js';
import { BOUNDS } from './sky.js';
import { INK } from './render.js';

const _want = new THREE.Vector3(), _d = new THREE.Vector3(), _side = new THREE.Vector3();

export class Flight {
  constructor({ isLocal = false, ink = INK.BLUE, name = '', speed = 13, hp = 3 } = {}) {
    this.isLocal = isLocal; this.ink = ink; this.name = name;
    this.pos = new THREE.Vector3(0, 18, 30);
    this.vel = new THREE.Vector3(0, 0, -speed);
    this.yaw = 0; this.roll = 0; this.pitch = 0;
    this.speed = speed; this.turnRate = 1.25; this.phase = rand(0, TAU);
    this.hp = hp; this.maxHp = hp; this.alive = true;
    this.shieldT = 0; this.deadT = 0; this.firing = false;
    this.waypoint = new THREE.Vector3(0, 18, -20);
    this.target = null;
    this.hitRadius = 1.25; this.kind = 'player'; this.ownerId = 'local';
  }
  reset(pos, yaw = 0) {
    this.pos.copy(pos); this.yaw = yaw; this.roll = 0; this.pitch = 0;
    this.hp = this.maxHp; this.alive = true; this.shieldT = 2; this.deadT = 0;
    this.target = null; this.vel.set(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(this.speed);
    this._newWaypoint();
  }
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  setWaypoint(p) {
    this.waypoint.set(clamp(p.x, -BOUNDS.x + 6, BOUNDS.x - 6), clamp(p.y, BOUNDS.minY, BOUNDS.maxY), clamp(p.z, -BOUNDS.z + 6, BOUNDS.z - 6));
  }
  setTarget(t) { if (t && t.alive) this.target = t; }
  _newWaypoint() {
    // long, shallow legs: short hops on a small page were what made the plane circle all the time
    const a = this.yaw + rand(-0.32, 0.32);
    const dist = rand(60, 115);
    let wx = this.pos.x - Math.sin(a) * dist, wz = this.pos.z - Math.cos(a) * dist;
    const lim = BOUNDS.x * 0.72;
    if (Math.abs(wx) > lim || Math.abs(wz) > lim) {
      const toCentre = Math.atan2(this.pos.x, this.pos.z) + rand(-0.35, 0.35);
      wx = this.pos.x - Math.sin(toCentre) * dist * 0.8;
      wz = this.pos.z - Math.cos(toCentre) * dist * 0.8;
    }
    this.setWaypoint(new THREE.Vector3(wx, rand(15, 42), wz));
  }
  _towardCentre() {
    const a = Math.atan2(this.pos.x, this.pos.z);
    this.setWaypoint(new THREE.Vector3(this.pos.x - Math.sin(a) * 130, clamp(this.pos.y, 16, 38), this.pos.z - Math.cos(a) * 130));
  }
  takeDamage(dmg) {
    if (!this.alive || this.shieldT > 0) return false;
    this.hp -= dmg;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.deadT = 0; return true; }
    return false;
  }
  update(dt, t) {
    if (this.shieldT > 0) this.shieldT -= dt;
    if (!this.alive) { this.deadT += dt; this.vel.set(0, 0, 0); return; }
    if (this.target && !this.target.alive) this.target = null;

    if (this.target && this.followTarget !== false) {
      _d.subVectors(this.target.pos, this.pos);
      const dist = _d.length();
      _want.copy(this.target.pos);
      if (dist < 32) { _side.set(-_d.z, 0, _d.x).normalize().multiplyScalar(28); _want.add(_side); }
      _want.y = clamp(this.target.pos.y + 1.2, BOUNDS.minY, BOUNDS.maxY);
    } else {
      _want.copy(this.waypoint);
      if (this.pos.distanceTo(this.waypoint) < 7) this._newWaypoint();
    }

    const dx = _want.x - this.pos.x, dz = _want.z - this.pos.z;
    const toYaw = Math.atan2(-dx, -dz);
    const diff = wrapAngle(toYaw - this.yaw);
    const maxTurn = this.turnRate * dt;
    const turn = clamp(diff, -maxTurn, maxTurn);
    this.yaw = wrapAngle(this.yaw + turn);
    this.roll = damp(this.roll, clamp(-turn / Math.max(maxTurn, 1e-5), -1, 1) * 0.55, 6, dt);
    this.pitch = damp(this.pitch, clamp((_want.y - this.pos.y) * 0.035, -0.3, 0.3), 4, dt);

    const f = this.forward(_side);
    const prevY = this.pos.y;
    this.pos.addScaledVector(f, this.speed * dt);
    this.pos.y = damp(this.pos.y, _want.y + Math.sin(t * 1.2 + this.phase) * 0.45, 2.6, dt);
    // turn back well before the edge, and keep the aiming lock while doing it
    if (Math.abs(this.pos.x) > BOUNDS.x * 0.82 || Math.abs(this.pos.z) > BOUNDS.z * 0.82) {
      if (this.followTarget !== false) this.target = null;
      this._towardCentre();
    }
    this.pos.x = clamp(this.pos.x, -BOUNDS.x, BOUNDS.x);
    this.pos.z = clamp(this.pos.z, -BOUNDS.z, BOUNDS.z);
    this.pos.y = clamp(this.pos.y, BOUNDS.minY, BOUNDS.maxY);
    this.vel.copy(f).multiplyScalar(this.speed);
    this.vel.y = dt > 0 ? (this.pos.y - prevY) / dt : 0;
  }
  encode() {
    return [+this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2),
      +this.yaw.toFixed(2), +this.roll.toFixed(2), Math.round(this.hp),
      (this.alive ? 1 : 0) | (this.shieldT > 0 ? 2 : 0) | (this.firing ? 4 : 0)];
  }
}

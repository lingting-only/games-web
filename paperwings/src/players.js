// Other pilots: each runs its own plane locally and sends a small state array ~20 times a second.
// Here we ease toward the last snapshot and expose the same target shape as an enemy plane.
import * as THREE from 'three';
import { PlaneVisual } from './plane.js';
import { makeInkMaterial, INK } from './render.js';
import { wrapAngle } from './util.js';

export const TEAM_INKS = [INK.BLUE, INK.RED, INK.GREEN, INK.ORANGE, INK.PINK, INK.BLACK];

export class RemotePlane {
  constructor(ctx, id, name, ink = INK.RED) {
    this.ctx = ctx; this.id = id; this.name = name || '涂鸦'; this.ink = ink;
    this.pos = new THREE.Vector3(0, -100, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.roll = 0; this.pitch = 0;
    this.hp = 3; this.maxHp = 3; this.alive = true; this.shieldT = 0;
    this.hitRadius = 1.25; this.kind = 'remote'; this.ownerId = id; this.isLocal = false;
    this.visual = new PlaneVisual(ctx.scene, { ink });
    this.snap = null; this.lastSeen = performance.now(); this.deadT = 0; this.kills = 0; this.deaths = 0;
    this.tagMat = makeInkMaterial({ ink, fill: true, side: THREE.DoubleSide });
    this.tag = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.32, 0.02), this.tagMat);
    this.tag.position.y = 2.1; this.visual.root.add(this.tag);
  }
  push(d, t) {
    if (!d || d.length < 7) return;
    this.snap = { p: new THREE.Vector3(d[0], d[1], d[2]), yaw: d[3], roll: d[4], hp: d[5], flags: d[6], t };
    this.lastSeen = t;
  }
  update(dt, now, t) {
    const s = this.snap;
    if (s) {
      const k = 1 - Math.exp(-dt * 13);
      this.pos.lerp(s.p, k);
      this.yaw += wrapAngle(s.yaw - this.yaw) * k;
      this.roll += (s.roll - this.roll) * k;
      const wasAlive = this.alive;
      this.hp = s.hp; this.alive = !!(s.flags & 1); this.shieldT = (s.flags & 2) ? 1 : 0;
      if (wasAlive && !this.alive) this.deadT = 0;
    }
    if (!this.alive) this.deadT += dt;
    this.visual.update(dt, { pos: this.pos, yaw: this.yaw, roll: this.roll, pitch: 0, alive: this.alive, shieldT: this.shieldT, t });
    this.tag.visible = this.alive;
  }
  dispose() { this.visual.dispose(); this.tagMat.dispose(); }
}

export function encodeLocal(P) { return P.encode(); }

// Tank: one class for every tank on the board — player, ally, all four enemy kinds.
// The body is a little pile of boxes (hull, treads, turret, barrel) drawn in one ink colour.
// Movement is the classic four-way: pick a direction, the body swings round, then it rolls,
// snapping its cross-axis onto a big-cell lane so it lines up with the corridors.
import * as THREE from 'three';
import { makeInkMaterial, INK, setInk } from './render.js';
import { DIRS, snapLane, clampBoard, T } from './physics.js';
import { clamp, angleLerp, wrapAngle } from './util.js';

const TANK_HW = 0.82;       // half extent of the collision square
export const LANES = true;  // lane snapping on

export class Tank {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.x = 0; this.z = 0;
    this.dir = 'up'; this.angle = DIRS.up.angle;   // visual body angle (radians)
    this.speed = opts.speed ?? 5.6;
    this.ink = opts.ink ?? INK.BLUE;
    this.baseInk = this.ink;
    this.hw = TANK_HW;
    this.alive = true;
    this.moving = false;
    this.star = 0;            // player upgrade level 0..3
    this.shield = 0;          // seconds of spawn-protection left
    this.frozen = 0;          // seconds of clock-freeze left (enemies)
    this.slide = 0;           // ice glide momentum
    this.slideDir = null;
    this.tread = 0;           // tread animation phase
    this.flashT = 0;          // hit flash
    this.id = opts.id ?? null;
    this.isEnemy = !!opts.isEnemy;
    this.kind = opts.kind ?? 'player';   // player | basic | fast | power | armor
    this.hp = opts.hp ?? 1;
    this.maxHp = this.hp;
    this.carrier = false;     // flashing power-up carrier
    this.group = this.build();
    scene.add(this.group);
  }

  build() {
    const g = new THREE.Group();
    const mat = makeInkMaterial({ ink: this.ink, shadeScale: 1.0 });
    const dark = makeInkMaterial({ ink: this.ink, shadeScale: 0.55, shadeBias: 0.1 });
    this.mat = mat; this.dark = dark;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.5, 1.5), mat);
    hull.position.y = 0.5;
    // sloped glacis at the front: a thin wedge plate reads much more "tank"
    const glacis = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.42, 0.34), mat);
    glacis.position.set(0, 0.42, -0.82); glacis.rotation.x = -0.5;
    const treadGeo = new THREE.BoxGeometry(0.34, 0.44, 1.66);
    const tl = new THREE.Mesh(treadGeo, dark); tl.position.set(-0.56, 0.24, 0);
    const tr = new THREE.Mesh(treadGeo, dark); tr.position.set(0.56, 0.24, 0);
    // road wheels peeking out of the treads
    const wheelGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.42, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheels = [];
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(wheelGeo, dark);
      w.position.set(side * 0.56, 0.17, -0.58 + i * 0.39);
      g.add(w); wheels.push(w);
    }
    // fenders over the treads
    const fenderGeo = new THREE.BoxGeometry(0.4, 0.08, 1.74);
    const fl = new THREE.Mesh(fenderGeo, mat); fl.position.set(-0.56, 0.5, 0);
    const fr = new THREE.Mesh(fenderGeo, mat); fr.position.set(0.56, 0.5, 0);
    const turretRing = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.48, 0.12, 12), dark);
    turretRing.position.y = 0.77;
    const turret = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.4, 0.8), mat);
    turret.position.y = 0.93;
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 1.05), dark);
    barrel.position.set(0, 0.98, -0.75);
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.18), mat);
    muzzle.position.set(0, 0.98, -1.24);
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.3), dark);
    hatch.position.y = 1.18;
    // antenna whipping out the back of the turret
    const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.05), dark);
    antenna.position.set(0.22, 1.35, 0.38); antenna.rotation.x = 0.35; antenna.rotation.z = -0.15;
    g.add(hull, glacis, tl, tr, turretRing, turret, barrel, muzzle, hatch, antenna, fl, fr);
    this.treads = [tl, tr];
    this.wheels = wheels;
    this.antenna = antenna;
    this.barrel = barrel;
    this.turret = turret;
    // soft contact shadow pressed into the paper
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.15, 18), makeInkMaterial({ ink: INK.BLACK, fill: true, shadeBias: 0.4 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    shadow.scale.set(1, 1.12, 1);
    g.add(shadow);
    // spawn shield: a wire-frame-ish hemisphere that blinks
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      makeInkMaterial({ ink: INK.PINK, shadeScale: 0.2, side: THREE.DoubleSide })
    );
    shield.position.y = 0.2;
    shield.visible = false;
    g.add(shield);
    this.shieldMesh = shield;
    return g;
  }

  setInk(ink) { this.ink = ink; setInk(this.mat, ink); setInk(this.dark, ink); }

  // try to face a new direction; the cross-axis lane alignment happens in move()
  face(dir) {
    if (!DIRS[dir]) return;
    this.dir = dir;
  }

  // move along facing for dt; returns true if it moved. grid may be null for ghosts (remote interp).
  move(dt, grid, tanks = []) {
    const d = DIRS[this.dir];
    // turn in place first: a tank that rolls while its body is still swinging reads as broken.
    // report "moved" so callers treat this as normal progress, not a wall hit.
    const ahead = wrapAngle(d.angle - this.angle);
    if (Math.abs(ahead) > 0.45) return true;
    let vx = d.x * this.speed, vz = d.z * this.speed;
    if (grid) {
      // settle onto the nearest big-cell lane across the direction of travel (only if free)
      const sx = d.x !== 0 ? this.x : snapLane(this.x);
      const sz = d.x !== 0 ? snapLane(this.z) : this.z;
      if ((sx !== this.x || sz !== this.z) && !grid.rectBlocked(sx, sz, this.hw)) { this.x = sx; this.z = sz; }
    }
    // ice: keep gliding in the old direction after you stop
    if (this.slide > 0 && !this.moving) { vx = d.x * this.slide; vz = d.z * this.slide; this.slide = Math.max(0, this.slide - dt * 9); }
    const nx = clampBoard(this.x + vx * dt), nz = clampBoard(this.z + vz * dt);
    let moved = false;
    if (grid) {
      const onIce = grid.tileAt(nx, nz) === T.ICE;
      if (onIce && this.moving) this.slide = Math.min(this.speed, this.slide + dt * 10); else this.slide = 0;
      // escape mode: a tank that somehow ended up inside a wall may move any way that strictly
      // reduces how much wall it overlaps (by area), so it can always wriggle back out
      const stuck = grid.overlapArea(this.x, this.z, this.hw * 0.95) > 0;
      const freer = (x, z) => grid.overlapArea(x, z, this.hw) < grid.overlapArea(this.x, this.z, this.hw) - 1e-6;
      if (!grid.rectBlocked(nx, nz, this.hw) || (stuck && freer(nx, nz))) { this.x = nx; this.z = nz; moved = true; }
      else if (d.x !== 0 && (!grid.rectBlocked(nx, this.z, this.hw) || (stuck && freer(nx, this.z)))) { this.x = nx; moved = true; }
      else if (d.z !== 0 && (!grid.rectBlocked(this.x, nz, this.hw) || (stuck && freer(this.x, nz)))) { this.z = nz; moved = true; }
      else this.slide = 0;
      // tank bodies don't overlap — but never shove each other into a wall
      for (const t of tanks) {
        if (t === this || !t.alive) continue;
        const dx = this.x - t.x, dz = this.z - t.z;
        const ox = this.hw + t.hw - Math.abs(dx), oz = this.hw + t.hw - Math.abs(dz);
        if (ox > 0 && oz > 0) {
          const px = ox < oz ? this.x + (dx > 0 ? ox : -ox) : this.x;
          const pz = ox < oz ? this.z : this.z + (dz > 0 ? oz : -oz);
          if (!grid.rectBlocked(px, pz, this.hw) || freer(px, pz)) { this.x = clampBoard(px); this.z = clampBoard(pz); }
        }
      }
    } else { this.x = nx; this.z = nz; moved = true; }
    if (moved) this.tread += dt * this.speed;
    return moved;
  }

  // bullet muzzle position
  muzzle(out = new THREE.Vector3()) {
    const d = DIRS[this.dir];
    return out.set(this.x + d.x * 1.35, 0.98, this.z + d.z * 1.35);
  }

  hitFlash() { this.flashT = 0.12; }

  update(dt, time) {
    const g = this.group;
    g.position.set(this.x, 0, this.z);
    this.angle = angleLerp(this.angle, DIRS[this.dir].angle, 1 - Math.exp(-22 * dt));
    g.rotation.y = this.angle;
    // tread crawl: notches on the treads shift and the road wheels actually roll
    const t = this.tread * 3;
    this.treads[0].position.y = 0.24 + Math.sin(t) * 0.015;
    this.treads[1].position.y = 0.24 + Math.sin(t + Math.PI) * 0.015;
    for (const w of this.wheels) w.rotation.x = -this.tread * 2.2;
    // antenna sways with the driving
    this.antenna.rotation.z = -0.15 + Math.sin(time * 6 + this.x) * 0.08 + (this.moving ? Math.sin(t) * 0.05 : 0);
    if (this.flashT > 0) { this.flashT -= dt; const on = this.flashT > 0 && Math.floor(this.flashT * 30) % 2 === 0; this.mat.uniforms.uShadeBias.value = on ? 0.55 : 0; }
    else this.mat.uniforms.uShadeBias.value = 0;
    // shield blink
    if (this.shield > 0) { this.shield -= dt; this.shieldMesh.visible = Math.floor(time * 10) % 2 === 0; }
    else this.shieldMesh.visible = false;
    // carrier blink: tint pulses toward red
    if (this.carrier) {
      const p = (Math.sin(time * 9) + 1) / 2;
      setInk(this.mat, p > 0.5 ? INK.RED : this.baseInk);
    } else if (this.armorInk) setInk(this.mat, this.armorInk);
  }

  destroy() {
    this.alive = false;
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.mat.dispose(); this.dark.dispose();
  }

  serialize() {
    return { id: this.id, x: +this.x.toFixed(2), z: +this.z.toFixed(2), dir: this.dir, m: this.moving ? 1 : 0, s: this.star, d: this.alive ? 1 : 0, k: this.kind, hp: this.hp, c: this.carrier ? 1 : 0, sh: this.shield > 0 ? 1 : 0 };
  }
  applyState(s) {
    if (!this.alive && s.d) { /* revived by respawn flow elsewhere */ }
    this.x = s.x; this.z = s.z; this.dir = s.dir; this.moving = !!s.m; this.star = s.s || 0;
    this.carrier = !!s.c; this.shield = s.sh ? Math.max(this.shield, 0.1) : 0;
  }
}

export function makeTank(scene, kind, id) {
  const base = { scene, id, isEnemy: kind !== 'player', kind };
  switch (kind) {
    case 'fast': return new Tank(scene, { ...base, speed: 7.4, hp: 1, ink: INK.BLACK });
    case 'power': return new Tank(scene, { ...base, speed: 4.6, hp: 1, ink: INK.BLACK });
    case 'armor': return new Tank(scene, { ...base, speed: 3.8, hp: 4, ink: INK.BLACK });
    default: return new Tank(scene, { ...base, speed: 4.4, hp: 1, ink: INK.BLACK });   // basic
  }
}

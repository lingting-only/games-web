// Solo waves. Every enemy is another paper plane running the same Flight model as the player,
// but told to orbit the player and throw paper balls back. Every fifth wave adds a big folded crane.
import * as THREE from 'three';
import { INK } from './render.js';
import { Flight } from './flight.js';
import { PlaneVisual } from './plane.js';
import { aimVelocity, BALL_SPEED } from './projectile.js';
import { rand, randInt, clamp } from './util.js';
import { BOUNDS } from './sky.js';
import { audio } from './audio.js';

export const TYPES = {
  crane: { name: '纸鹤', hp: 6, speed: 15, ink: INK.RED, scale: 0.85, cool: [3.0, 4.6], score: 100, shoots: false },
  eraser: { name: '橡皮擦战斗机', hp: 14, speed: 10, ink: INK.PINK, scale: 1.3, cool: [2.4, 3.6], score: 220, shoots: true },
  bomber: { name: '纸团投弹手', hp: 9, speed: 9, ink: INK.BLACK, scale: 1.05, cool: [1.9, 2.9], score: 160, shoots: true },
  boss: { name: '巨型折纸鹤', hp: 60, speed: 8, ink: INK.RED, scale: 2.7, cool: [2.2, 3.0], score: 2500, shoots: true, boss: true },
};

const _from = new THREE.Vector3(), _vel = new THREE.Vector3();
const _toE = new THREE.Vector3(), _fwd = new THREE.Vector3(), _wp = new THREE.Vector3(), _side = new THREE.Vector3();

export class EnemyManager {
  constructor(ctx) {
    this.ctx = ctx; this.list = []; this.queue = []; this.wave = 0;
    this.spawnT = 0; this.intermission = 0; this.boss = null; this.nextId = 1;
    this.onKill = null; this.onWaveClear = null; this.onBoss = null;
  }
  get alive() { return this.list.length + this.queue.length; }
  clear() {
    for (const e of this.list) e.visual.dispose();
    this.list.length = 0; this.queue.length = 0; this.boss = null; this.intermission = 0;
    if (this.onBoss) this.onBoss(null);
  }
  startWave(n) {
    this.wave = n; this.queue.length = 0; this.intermission = 0; this.spawnT = 0.4;
    const cranes = Math.min(4 + n, 9);
    for (let i = 0; i < cranes; i++) this.queue.push('crane');
    if (n >= 2) for (let i = 0; i < Math.min(1 + Math.floor(n / 3), 3); i++) this.queue.push('bomber');
    if (n >= 3) for (let i = 0; i < Math.min(Math.floor(n / 3), 3); i++) this.queue.push('eraser');
    for (let i = this.queue.length - 1; i > 0; i--) { const j = randInt(0, i); [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]]; }
    if (n % 5 === 0) this.queue.push('boss');
    if (this.onBoss) this.onBoss(null);
    audio.wave();
  }
  _spawn(type) {
    const T = TYPES[type], ctx = this.ctx;
    // spawn ahead of the player so a fresh wave is actually in view
    const fwd = ctx.player.forward(_fwd);
    _side.set(-fwd.z, 0, fwd.x);
    const dist = rand(45, 85);
    const pos = new THREE.Vector3().copy(ctx.player.pos)
      .addScaledVector(fwd, dist).addScaledVector(_side, rand(-34, 34));
    pos.y = rand(16, 38);
    pos.x = clamp(pos.x, -BOUNDS.x + 4, BOUNDS.x - 4);
    pos.z = clamp(pos.z, -BOUNDS.z + 4, BOUNDS.z - 4);
    const f = new Flight({ ink: T.ink, name: T.name, speed: T.speed, hp: T.hp });
    f.reset(pos, rand(0, Math.PI * 2));
    f.shieldT = 0;
    f.kind = 'enemy'; f.ownerId = 'enemy'; f.isLocal = false;
    f.hitRadius = 1.25 * T.scale; f.score = T.score; f.type = type; f.T = T;
    f.id = this.nextId++; f.visual = new PlaneVisual(ctx.scene, { ink: T.ink, scale: T.scale });
    f.cool = rand(T.cool[0], T.cool[1]); f.turnRate = T.boss ? 0.8 : 1.15;
    f.setTarget(ctx.player);
    this.list.push(f);
    if (T.boss) { this.boss = f; if (this.onBoss) this.onBoss(f); audio.bossRoar(f.pos); }
    ctx.effects.strokeBurst(f.pos, T.ink, 20, 6, { life: 0.5, size: 0.035 });
    audio.spawn(f.pos);
  }
  _fire(e) {
    const ctx = this.ctx, T = e.T;
    if (!T.shoots || !ctx.player.alive) return;
    _from.copy(e.pos);
    const shots = T.boss ? 7 : 1;
    for (let i = 0; i < shots; i++) {
      aimVelocity(_from, ctx.player.pos, ctx.player.vel, BALL_SPEED, _vel);
      if (T.boss) {
        const spread = (i - (shots - 1) / 2) * 0.13;
        const c = Math.cos(spread), s = Math.sin(spread);
        const vx = _vel.x * c - _vel.z * s, vz = _vel.x * s + _vel.z * c;
        _vel.set(vx, _vel.y + rand(-1, 1), vz);
      }
      ctx.balls.fire({ pos: _from, vel: _vel, dmg: 1, owner: 'enemy', ink: T.boss ? INK.RED : INK.BLACK, life: 3.6 });
    }
    audio.shot();
  }
  damage(e, dmg, ball) {
    if (!e.alive) return false;
    const dead = e.takeDamage(dmg);
    e.visual.setInk(INK.ORANGE);
    setTimeout(() => { if (e.visual) e.visual.setInk(e.T.ink); }, 70);
    this.ctx.effects.strokeBurst(e.pos, ball ? ball.ink : INK.BLUE, 8, 5, { life: 0.24, size: 0.028 });
    audio.hitEnemy(e.pos);
    if (dead) this._kill(e, ball);
    return dead;
  }
  _kill(e, ball) {
    const ctx = this.ctx;
    ctx.effects.explosion(e.pos, e.T.boss ? 6 : 2.4, e.T.boss ? INK.BLACK : e.T.ink);
    ctx.effects.strokeBurst(e.pos, e.T.ink, e.T.boss ? 70 : 26, e.T.boss ? 11 : 7, { life: 0.75, size: 0.045 });
    audio.enemyDie(e.pos);
    if (e === this.boss) { this.boss = null; if (this.onBoss) this.onBoss(null); }
    e.visual.dispose(); e.visual = null;
    const i = this.list.indexOf(e); if (i >= 0) this.list.splice(i, 1);
    if (this.onKill) this.onKill(e, ball);
  }
  update(dt, t) {
    const ctx = this.ctx;
    if (this.queue.length) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this._spawn(this.queue.shift()); this.spawnT = this.queue.length ? rand(0.55, 1.1) : 0; }
    } else if (!this.list.length) {
      if (this.wave > 0 && this.intermission === 0) this.intermission = 2.2;
      if (this.intermission > 0) {
        this.intermission -= dt;
        if (this.intermission <= 0) { this.intermission = -1; if (this.onWaveClear) this.onWaveClear(this.wave); }
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      // a plane that drifts behind the camera loops back around to the front
      _toE.subVectors(e.pos, ctx.player.pos);
      const fwd = ctx.player.forward(_fwd);
      if (_toE.dot(fwd) < -8) {
        e.target = null;
        _wp.copy(ctx.player.pos).addScaledVector(fwd, 70);
        e.setWaypoint(_wp);
      } else if (!e.target && ctx.player.alive) e.setTarget(ctx.player);
      e.update(dt, t);
      if (e.visual) e.visual.update(dt, { pos: e.pos, yaw: e.yaw, roll: e.roll, pitch: e.pitch, alive: true, shieldT: 0, t, scale: e.T.scale });
      e.cool -= dt;
      if (e.cool <= 0) {
        const dist = e.pos.distanceTo(ctx.player.pos);
        if (dist < 95 && ctx.player.alive) this._fire(e);
        e.cool = rand(e.T.cool[0], e.T.cool[1]) * (e.T.boss ? 1 : clamp(dist / 70, 0.7, 1.5));
      }
    }
  }
}

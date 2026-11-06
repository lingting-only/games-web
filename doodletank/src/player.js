// Player: the local human — a tank plus lives, upgrades, respawn protection and the trigger
// finger. Each player owns their own tank; in co-op the other one is a RemoteTank.
import * as THREE from 'three';
import { Tank } from './tank.js';
import { DIRS, cellCenter } from './physics.js';

export class Player {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.slot = opts.slot ?? 0;              // 0 = first player, 1 = ally
    this.name = opts.name ?? '玩家';
    this.lives = opts.lives ?? 3;
    this.score = 0;
    this.stars = 0;                           // upgrade level carried between lives
    this.rapidT = 0; this.spreadT = 0; this.pierceT = 0;   // timed power-up buffs
    this.spawnCell = opts.spawnCell;
    this.tank = null;
    this.alive = false;
    this.id = opts.id ?? 'me';
    this.grid = opts.grid ?? null;
    this.onDeath = opts.onDeath ?? (() => {});
    this.onChange = opts.onChange ?? (() => {});
  }

  spawn() {
    if (this.tank) { this.tank.destroy(); this.tank = null; }
    const t = new Tank(this.scene, { ink: 0, speed: 5.6, kind: 'player', id: this.id });
    const c = cellCenter(this.spawnCell.cx, this.spawnCell.cy);
    t.x = c.x; t.z = c.z;
    t.dir = 'up';
    t.star = this.stars;
    t.shield = 2.2;
    this.tank = t;
    this.alive = true;
    this.applyUpgrade();
    this.onChange();
    return t;
  }

  applyUpgrade() {
    const t = this.tank;
    if (!t) return;
    t.star = this.stars;
    t.speed = this.stars >= 2 ? 7.2 : 5.6;
    t.bulletSpeed = this.stars >= 2 ? 13 : 10;
    t.bulletPower = this.stars >= 3 ? 3 : 1;
    t.maxBullets = this.stars >= 1 ? 2 : 1;
  }

  get stats() {
    return { speed: this.stars >= 2 ? 7.2 : 5.6, bulletSpeed: this.stars >= 2 ? 13 : 10, bulletPower: this.stars >= 3 ? 3 : 1, maxBullets: this.stars >= 1 ? 2 : 1 };
  }

  // per-frame: read input, drive the tank, pull the trigger. fireBullet is the game callback.
  update(dt, time, input, bullets, effects, fireBullet, others) {
    const t = this.tank;
    if (!t || !t.alive) return;
    this.rapidT = Math.max(0, this.rapidT - dt);
    this.spreadT = Math.max(0, this.spreadT - dt);
    this.pierceT = Math.max(0, this.pierceT - dt);
    const dir = input.moveDir();
    t.moving = false;
    if (dir) {
      if (dir !== t.dir) t.face(dir);
      t.moving = t.move(dt, this.grid, others);
    }
    this._autoT = (this._autoT || 0) - dt;
    if ((input.consumeFire() || input.fireHeld) && this._autoT <= 0) {
      if (this.tryFire(bullets, fireBullet)) this._autoT = this.rapidT > 0 ? 0.13 : 0.3;
    }
    t.update(dt, time);
  }

  tryFire(bullets, fireBullet) {
    const t = this.tank;
    if (!t || !t.alive) return false;
    const speed = this.stars >= 2 ? 13 : 10;
    const maxB = this.stars >= 1 ? 2 : 1;
    // 散射：一次三发平行弹幕，中间一发照常，左右各偏移一发
    if (this.spreadT > 0) {
      if (bullets.countOf(t) >= maxB + 2) return false;
      const d = DIRS[t.dir];
      const ox = d.x !== 0 ? 0 : 0.7, oz = d.x !== 0 ? 0.7 : 0;
      fireBullet(t, speed, ox, oz);
      fireBullet(t, speed, -ox, -oz);
      return fireBullet(t, speed);
    }
    if (bullets.countOf(t) >= maxB) return false;
    return fireBullet(t, speed);
  }

  // a bullet reaches me
  takeHit() {
    const t = this.tank;
    if (!t || !t.alive || t.shield > 0) return false;
    this.die();
    return true;
  }

  die() {
    const t = this.tank;
    if (!t) return;
    t.alive = false;
    this.alive = false;
    this.stars = Math.max(0, this.stars - 1);   // classic: you drop back a star when you die
    this.lives--;
    this.onChange();
    this.onDeath();
  }

  addLife() { this.lives++; this.onChange(); }
  addStar() { this.stars = Math.min(3, this.stars + 1); this.applyUpgrade(); this.onChange(); }

  destroy() { if (this.tank) { this.tank.destroy(); this.tank = null; } this.alive = false; }
}

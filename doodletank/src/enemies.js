// EnemyManager: the classic spawn queue — 20 tanks per stage, three spawn doors across the top,
// at most four on the board at once, each new arrival scribbled in with a blinking star.
// AI is the original's simple mind: roll forward, and when something blocks the way (or the mood
// strikes) pick a new direction — mostly toward the players and the eagle, sometimes just because.
import { makeTank } from './tank.js';
import { DIRS, cellCenter } from './physics.js';
import { SPAWNS } from './level.js';
import { rand, randInt, choose, clamp } from './util.js';

export const ENEMY_STATS = {
  basic: { speed: 4.4, bullet: 9,  fireCd: [0.9, 2.2], score: 100 },
  fast:  { speed: 7.6, bullet: 9,  fireCd: [0.8, 2.0], score: 200 },
  power: { speed: 4.6, bullet: 15, fireCd: [0.7, 1.7], score: 300 },
  armor: { speed: 3.8, bullet: 9,  fireCd: [0.8, 1.9], score: 400 },
};
const ARMOR_INK = { 4: 2, 3: 4, 2: 3, 1: 2 };   // ink id per remaining hp (graphite/green/orange)

export class EnemyManager {
  constructor(scene, grid, effects) {
    this.scene = scene; this.grid = grid; this.effects = effects;
    this.list = [];
    this.queue = [];            // kinds still to spawn
    this.spawnT = 0;
    this.spawnPoint = 0;
    this.pending = null;        // { x, z, t, kind } waiting on its spawn star
    this.cb = {};               // onKill(kind, carrier, byLocal), onFire(enemy), onSpawn
    this.frozen = 0;
  }
  reset() {
    for (const e of this.list) e.destroy();
    this.list.length = 0; this.queue.length = 0;
    this.pending = null; this.spawnT = 0; this.frozen = 0;
  }
  // classic stage mix, keyed by stage number (0-based): more fast/power/armor later on
  static stageQueue(stage) {
    const q = [];
    const armorN = clamp(2 + Math.floor(stage / 2), 2, 6);
    const fastN = clamp(3 + Math.floor(stage / 3), 3, 7);
    const powerN = clamp(1 + Math.floor(stage / 2), 1, 5);
    const basicN = 20 - armorN - fastN - powerN;
    for (let i = 0; i < basicN; i++) q.push('basic');
    for (let i = 0; i < fastN; i++) q.push('fast');
    for (let i = 0; i < powerN; i++) q.push('power');
    for (let i = 0; i < armorN; i++) q.push('armor');
    // shuffle, but keep at least a few basics up front so the stage opens gently
    for (let i = q.length - 1; i > 4; i--) { const j = randInt(5, i); [q[i], q[j]] = [q[j], q[i]]; }
    return q;
  }
  beginStage(stage, carrierCount = 4) {
    this.reset();
    this.queue = EnemyManager.stageQueue(stage);
    // some tanks in the queue carry a power-up; mark them as they spawn
    this.carriersLeft = carrierCount;
    this.spawnT = 0.5;
    this.rush = stage >= MAP_SPEED_STAGE;   // later loops spawn faster
  }
  get remaining() { return this.queue.length + (this.pending ? 1 : 0) + this.list.length; }
  get aliveCount() { return this.list.length; }

  update(dt, time, players, fireBullet, onKill) {
    if (this.frozen > 0) this.frozen -= dt;
    const frozen = this.frozen > 0;
    // ---- spawning ----
    const maxAlive = 4;
    if (!this.pending && this.queue.length && this.list.length < maxAlive && !frozen) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        const cell = SPAWNS.enemies[this.spawnPoint % 3];
        this.spawnPoint++;
        // a spawn door blocked by a body just waits (classic behaviour)
        const c = cellCenter(cell.cx, cell.cy);
        if (players.some((p) => p.alive && Math.abs(p.x - c.x) < 1.6 && Math.abs(p.z - c.z) < 1.6)) {
          this.spawnT = 0.4;
        } else {
          const kind = this.queue.shift();
          const carrier = this.carriersLeft > 0 && Math.random() < 0.34;
          if (carrier) this.carriersLeft--;
          this.pending = { x: c.x, z: c.z, t: this.rush ? 0.7 : 1.0, kind, carrier };
          this.effects.spawnStar(c.x, c.z, this.pending.t);
          this.spawnT = this.rush ? rand(0.9, 1.6) : rand(1.4, 2.6);
        }
      }
    }
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) {
        const { x, z, kind, carrier } = this.pending;
        const tank = makeTank(this.scene, kind, 'e' + (this._nid = (this._nid || 0) + 1));
        tank.x = x; tank.z = z; tank.dir = 'down';
        tank.carrier = carrier;
        tank.bulletSpeed = ENEMY_STATS[kind].bullet;
        tank.fireT = rand(0.4, 1.4);
        tank.decideT = rand(1, 3);
        if (kind === 'armor') tank.armorInk = ARMOR_INK[4];
        this.list.push(tank);
        if (this.cb.onSpawn) this.cb.onSpawn(tank);
        this.pending = null;
      }
    }
    // ---- behaviour ----
    for (const e of this.list) {
      if (!e.alive) continue;
      e.moving = false;
      if (frozen || e.frozen > 0) { e.update(dt, time); continue; }
      e.decideT -= dt;
      const stats = ENEMY_STATS[e.kind];
      // choose to move: enemy tanks never stop rolling in the original
      const blocked = !e.move(dt, this.grid, [...players, ...this.list]);
      if (blocked || e.decideT <= 0) {
        e.dir = this.pickDir(e, players);
        e.decideT = rand(1.2, 3.4);
      }
      e.moving = true;
      // shooting: mostly random, a little meaner when a player is straight ahead
      e.fireT -= dt;
      if (e.fireT <= 0) {
        e.fireT = rand(stats.fireCd[0], stats.fireCd[1]);
        let want = Math.random() < 0.72;
        for (const p of players) {
          if (!p.alive) continue;
          const dx = p.x - e.x, dz = p.z - e.z;
          const ahead = DIRS[e.dir];
          if ((ahead.x !== 0 && Math.sign(dx) === ahead.x && Math.abs(dz) < 0.6) ||
              (ahead.z !== 0 && Math.sign(dz) === ahead.z && Math.abs(dx) < 0.6)) want = true;
        }
        if (want && fireBullet) fireBullet(e, stats.bullet);
      }
      e.update(dt, time);
    }
  }
  pickDir(e, players) {
    // weighted pick: down (toward the base) leads, then toward the nearest player, then random
    const weights = { down: 4, up: 1, left: 2, right: 2 };
    let target = null, best = 1e9;
    for (const p of players) {
      if (!p.alive) continue;
      const d = (p.x - e.x) ** 2 + (p.z - e.z) ** 2;
      if (d < best) { best = d; target = p; }
    }
    if (target) {
      if (Math.abs(target.x - e.x) > Math.abs(target.z - e.z)) weights[target.x > e.x ? 'right' : 'left'] += 3;
      else weights[target.z > e.z ? 'down' : 'up'] += 3;
    }
    const total = weights.down + weights.up + weights.left + weights.right;
    let r = rand(0, total);
    for (const k of ['down', 'left', 'right', 'up']) { r -= weights[k]; if (r <= 0) return k; }
    return 'down';
  }
  // a bullet connects: returns { killed, enemy } or null
  hit(enemy, dmg, byLocal) {
    if (!enemy.alive) return null;
    enemy.hp -= dmg;
    enemy.hitFlash();
    if (enemy.hp > 0) {
      if (enemy.kind === 'armor') enemy.armorInk = ARMOR_INK[enemy.hp] ?? 2;
      return { killed: false, enemy };
    }
    this.kill(enemy, byLocal);
    return { killed: true, enemy };
  }
  kill(enemy, byLocal) {
    enemy.alive = false;
    const i = this.list.indexOf(enemy);
    if (i >= 0) this.list.splice(i, 1);
    this.effects.explosion(enemy.x, enemy.z);
    if (this.cb.onKill) this.cb.onKill(enemy, byLocal);
    enemy.destroy();
  }
  // grenade power-up: every tank on the board pops at once (no score, like the original)
  killAll(byLocal) {
    for (const e of [...this.list]) this.kill(e, byLocal);
  }
  serialize() {
    return this.list.map((e) => e.serialize());
  }
  // client side: rebuild ghosts from a host snapshot
  applySnap(scene, snap, time) {
    const seen = new Set();
    for (const s of snap) {
      seen.add(s.id);
      let e = this.list.find((t) => t.id === s.id);
      if (!e) {
        e = makeTank(scene, s.k, s.id);
        e.ghost = true;
        e.x = s.x; e.z = s.z; e.dir = s.dir;
        if (s.k === 'armor') e.armorInk = ARMOR_INK[s.hp] ?? 2;
        this.list.push(e);
      }
      e.tx = s.x; e.tz = s.z; e.dir = s.dir; e.moving = !!s.m;
      e.carrier = !!s.c;
      e.hp = s.hp;
    }
    for (const e of [...this.list]) {
      if (!seen.has(e.id)) { e.destroy(); const i = this.list.indexOf(e); if (i >= 0) this.list.splice(i, 1); }
    }
  }
  // interpolated ghost movement toward the last snapshot
  interpolate(dt) {
    for (const e of this.list) {
      if (e.tx === undefined) continue;
      const k = 1 - Math.exp(-14 * dt);
      e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k;
    }
  }
}

const MAP_SPEED_STAGE = 10;   // after the first loop of stages, spawns speed up

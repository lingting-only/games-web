// RemoteTank: the other human in a co-op match. Their browser simulates their own tank and
// streams its state; this side renders it with a little interpolation so it rolls smoothly.
import { Tank } from './tank.js';
import { INK } from './render.js';

export class RemoteTank {
  constructor(scene, id, name) {
    this.id = id;
    this.name = name;
    this.tank = new Tank(scene, { ink: INK.BLUE, kind: 'player', id });
    this.tank.x = 5; this.tank.z = 11;
    this.alive = true;
    this.lastSeen = 0;
    this.lives = 3;
    this.score = 0;
  }
  applyState(s) {
    const t = this.tank;
    if (!s.d) { this.alive = false; t.alive = false; t.group.visible = false; return; }
    if (!this.alive) { this.alive = true; t.alive = true; t.group.visible = true; }
    t.x = s.x; t.z = s.z; t.dir = s.dir; t.moving = !!s.m;
    t.star = s.s || 0;
    t.shield = s.sh ? Math.max(t.shield, 0.15) : 0;
    this.lives = s.l ?? this.lives;
    this.score = s.sc ?? this.score;
    this.lastSeen = performance.now();
  }
  // applied from the host's authoritative score stream
  applyScore(sc) { this.score = sc.score; this.lives = sc.lives; }
  update(dt, time) {
    const t = this.tank;
    if (t.alive && t.moving) t.move(dt, null);
    t.update(dt, time);
  }
  destroy() { this.tank.destroy(); }
}

// what the local side broadcasts about itself, ~15 times a second
export function encodeLocal(player) {
  const t = player.tank;
  if (!t) return { d: 0, l: player.lives, sc: player.score };
  return {
    d: 1, x: +t.x.toFixed(2), z: +t.z.toFixed(2), dir: t.dir, m: t.moving ? 1 : 0,
    s: player.stars, sh: t.shield > 0 ? 1 : 0, l: player.lives, sc: player.score,
  };
}

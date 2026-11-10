// The single authoritative simulation. In solo the local browser is the authority; online only the
// host is. Clients replay the same events against their own copy of the board, so the rules file
// is shared by both modes and can never disagree.
import { Actor } from './actor.js';
import { GW, GH, cellIndex, worldToCell, cellToWorld } from './paper.js';
import { claimRegion, coverage, findPath, nearestFree } from './rules.js';

export class Authority {
  constructor(board, scene) {
    this.board = board; this.scene = scene;
    this.actors = new Map(); this.meta = new Map();
    this.events = []; this.tip = new Map();
    this.aiPids = new Set();
    this.nPlayers = 0; this.cover = { pct: [] };
  }
  addPlayer(pid, name, ink, cx, cy, opts = {}) {
    const a = new Actor(this.scene, pid, ink, cx, cy);
    const radius = opts.radius ?? 3;
    if (opts.speed) a.speed = opts.speed;
    this.actors.set(pid, a);
    this.meta.set(pid, { name, ink, cx, cy, radius, speed: a.speed });
    this.nPlayers = Math.max(this.nPlayers, pid);
    const cells = [];
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      const i = cellIndex(x, y);
      this.board.setOwner(i, pid); cells.push(i);
    }
    this.events.push({ t: 'owner', pid, cells });
    this.recomputeCover();
    return a;
  }
  intent(pid, tx, tz) {
    const a = this.actors.get(pid); if (!a) return;
    let [cx, cy] = worldToCell(tx, tz);
    [cx, cy] = nearestFree(this.board.blocked, GW, GH, cx, cy);
    const [sx, sy] = worldToCell(a.x, a.z);
    // AI loops must not cross their own unfinished ink: doing so self-cuts the whole line
    let avoid = this.board.blocked;
    if (this.aiPids.has(pid)) {
      avoid = Uint8Array.from(this.board.blocked);
      const t = this.board.trail;
      for (let i = 0; i < t.length; i++) if (t[i] === pid) avoid[i] = 1;
      avoid[cellIndex(sx, sy)] = 0;
    }
    let path = findPath(avoid, GW, GH, sx, sy, cx, cy);
    if (!path) path = findPath(this.board.blocked, GW, GH, sx, sy, cx, cy);
    if (!path || path.length < 2) return;
    // a line can only start from your own territory; once started it survives further clicks
    if (this.board.owner[cellIndex(sx, sy)] === pid && !a.drawing) {
      a.drawing = true; a.leftHome = false;
    }
    a.setPath(path);
  }
  enter(a, i) {
    const pid = a.pid, B = this.board;
    const own = B.owner[i] === pid;
    if (a.drawing && a.leftHome && own) return this.claim(a);
    if (!own) a.leftHome = true;

    const other = B.trail[i];
    if (other && other !== pid) {
      B.clearTrail(other); this.tip.delete(other);
      const victim = this.actors.get(other);
      if (victim) { victim.drawing = false; victim.leftHome = false; victim.stunT = 1.0; }
      this.events.push({ t: 'cut', pid, victim: other, cell: i });
    } else if (other === pid) {
      B.clearTrail(pid); this.tip.delete(pid);
      a.drawing = false; a.leftHome = false; a.stunT = 0.7;
      this.events.push({ t: 'cut', pid, victim: pid, cell: i, note: 'self' });
    }
    // ink only belongs outside your own territory; drawing on home tiles just creates
    // a self-crossing trap for the pen when it comes back to close the loop
    if (a.drawing && !own && !B.blocked[i]) {
      B.setTrail(i, pid); this.tip.set(pid, i);
      this.events.push({ t: 'trail', pid, cells: [i] });
    }
  }
  claim(a) {
    const pid = a.pid, B = this.board;
    const { enclosed, line } = claimRegion(B.owner, B.trail, B.blocked, GW, GH, pid);
    a.drawing = false; a.leftHome = false;
    B.clearTrail(pid); this.tip.delete(pid);
    if (enclosed.length >= 3) {
      const cells = enclosed.concat(line);
      for (const i of cells) B.setOwner(i, pid);
      this.events.push({ t: 'claim', pid, cells });
      this.events.push({ t: 'score', pid, gain: cells.length });
    } else {
      this.events.push({ t: 'cut', pid, victim: pid, cell: -1, note: 'miss' });
    }
    this.recomputeCover();
    return 'stop';
  }
  recomputeCover() { this.cover = coverage(this.board.owner, this.board.blocked, GW, GH, this.nPlayers); }
  update(dt) {
    for (const a of this.actors.values()) a.update(dt, (act, i) => this.enter(act, i));
    this.recomputeCover();
  }
  snapshot() {
    const a = [];
    for (const [pid, act] of this.actors) a.push([pid, +act.x.toFixed(2), +act.z.toFixed(2), act.drawing ? 1 : 0]);
    return { a, c: this.cover.pct.map((p) => +p.toFixed(2)), e: this.events.splice(0), time: 0 };
  }
  applySnapshot(s) {
    this.board.applyEvents(s.e || []);
    for (const [pid, x, z, d] of s.a || []) {
      const a = this.actors.get(pid); if (a) a.snap(x, z, d);
    }
    this.cover = { pct: s.c || [] };
  }
  fullSnapshot() {
    const p = [];
    for (const [pid, m] of this.meta) p.push([pid, m.name, m.ink, m.cx, m.cy, m.radius || 3, m.speed || 19]);
    return { b: this.board.encodeFull(), p, n: this.nPlayers, c: this.cover.pct, a: this.snapshot().a };
  }
  applyFull(f) {
    this.board.applyFull(f.b);
    for (const a of this.actors.values()) a.dispose();
    this.actors.clear(); this.meta.clear(); this.events.length = 0; this.tip.clear();
    for (const row of f.p) {
      const [pid, name, ink, cx, cy, radius, speed] = row;
      const a = new Actor(this.scene, pid, ink, cx, cy);
      if (speed) a.speed = speed;
      this.meta.set(pid, { name, ink, cx, cy, radius: radius || 3, speed: a.speed });
      this.actors.set(pid, a);
    }
    this.nPlayers = f.n; this.cover = { pct: f.c };
    for (const [pid, x, z, d] of f.a || []) { const a = this.actors.get(pid); if (a) a.snap(x, z, d); }
  }
  dispose() { for (const a of this.actors.values()) a.dispose(); this.actors.clear(); }
}

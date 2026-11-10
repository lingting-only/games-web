// Solo opponents with actual strategy:
//  - plan a closed rectangle by scoring every candidate (neutral paper, enemy territory, obstacles,
//    travel cost and how close the enemy is), instead of wandering in a random triangle;
//  - predict where a drawing opponent will be a second from now and intercept that point;
//  - bail home early when a rival is about to cut their own unfinished line, saving a smaller claim;
//  - specialise by role: expander / hunter / raider. Higher levels raise skill (reaction, reach,
//    loop size and aggression).
import { GW, GH, cellToWorld, cellIndex } from './paper.js';
import { clamp, rand } from './util.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class TurfAI {
  constructor(pid, authority, opts = {}) {
    this.pid = pid; this.auth = authority;
    const m = authority.meta.get(pid);
    this.cx = m ? m.cx : 12; this.cy = m ? m.cy : 12;
    this.r = (m && m.radius) || 3;
    this.skill = clamp(opts.skill ?? 0.5, 0, 1);
    this.role = opts.role || (pid === 2 ? 'expander' : pid === 3 ? 'hunter' : 'raider');
    this.route = null; this.leg = 0;
    this.cool = rand(0.3, 0.8);
    this.cutBudget = 1;
    this.plans = 0; this.cuts = 0;
  }
  get home() { return cellToWorld(this.cx, this.cy); }
  goHome() { const [x, z] = this.home; this.auth.intent(this.pid, x, z); }

  trailCount(pid) {
    const t = this.auth.board.trail; let n = 0;
    for (let i = 0; i < t.length; i++) if (t[i] === pid) n++;
    return n;
  }
  // follow the opponent's remaining path instead of chasing where they are now
  predict(other, lead) {
    if (!other.path || other.pi >= other.path.length) return [other.x, other.z];
    const k = Math.min(other.path.length - 1, other.pi + Math.floor(other.speed * lead));
    return other.path[k];
  }
  findCut(a) {
    // only hunt the human: cutting each other's loops just wastes both AIs
    const reach = 16 + this.skill * 18 + (this.role === 'hunter' ? 14 : 0);
    const other = this.auth.actors.get(1);
    if (!other || other === a || !other.drawing) return null;
    const len = this.trailCount(1);
    if (len < 3) return null;
    const p = this.predict(other, 0.8 + this.skill * 0.7);
    const d = Math.hypot(p[0] - a.x, p[1] - a.z);
    if (d > reach) return null;
    const score = len * (this.role === 'hunter' ? 2.4 : 1.3) - d * 0.7 + 8;
    return score > 7 ? p : null;
  }
  shouldBail(a) {
    if (!a.drawing || this.skill < 0.45) return false;
    const tip = this.auth.tip.get(this.pid);
    if (tip == null) return false;
    const [tx, tz] = cellToWorld(tip % GW, (tip / GW) | 0);
    const danger = 8 + this.skill * 4;
    for (const [oid, other] of this.auth.actors) {
      if (oid === 1 && oid !== this.pid && Math.hypot(other.x - tx, other.z - tz) < danger) return true;
    }
    return false;
  }

  // score axis-aligned loops that start and finish on our own border; the best one is walked as
  // four corners plus a short leg back into home territory (which triggers the claim).
  planRoute() {
    const B = this.auth.board, r = this.r;
    const sizes = this.skill > 0.65
      ? [[18, 14], [28, 20], [38, 26]]
      : [[14, 12], [22, 16], [30, 20]];
    let best = null, bestScore = -Infinity;
    for (const [dx, dy] of DIRS) {
      for (const sgn of [1, -1]) {
        const qx = -dy * sgn, qy = dx * sgn;
        const sx = this.cx + dx * r - qx * r, sy = this.cy + dy * r - qy * r;
        for (const [w, h] of sizes) {
          const corners = [[sx, sy], [sx + dx * w, sy + dy * w],
            [sx + dx * w + qx * h, sy + dy * w + qy * h], [sx + qx * h, sy + qy * h]];
          if (corners.some(([x, y]) => x < 2 || y < 2 || x >= GW - 2 || y >= GH - 2)) continue;
          let gain = 0;
          for (let u = 2; u < w; u += 3) for (let v = 2; v < h; v += 3) {
            const x = Math.round(sx + dx * u + qx * v), y = Math.round(sy + dy * u + qy * v);
            if (x < 1 || y < 1 || x >= GW - 1 || y >= GH - 1) { gain -= 2; continue; }
            const i = cellIndex(x, y);
            if (B.blocked[i]) { gain -= 2; continue; }
            const o = B.owner[i];
            if (o === 0) gain += 1;
            else if (o === this.pid) gain += 0.05;
            else gain += this.role === 'raider' ? 3.6 : 1.9 + this.skill;
          }
          let score = gain - (w + h) * 2 * 0.055;
          const [mx, mz] = cellToWorld(
            Math.round(sx + dx * w / 2 + qx * h / 2), Math.round(sy + dy * w / 2 + qy * h / 2));
          for (const [oid, other] of this.auth.actors) {
            if (oid === this.pid) continue;
            const d = Math.hypot(other.x - mx, other.z - mz);
            if (d < 20) score -= (this.role === 'hunter' ? 2 : 6) * (1 - d / 20);
          }
          if (score > bestScore) { bestScore = score; best = { sx, sy, dx, dy, qx, qy, w, h }; }
        }
      }
    }
    if (!best) return [this.home];
    const { sx, sy, dx, dy, qx, qy, w, h } = best;
    const pt = (u, v) => cellToWorld(
      clamp(Math.round(sx + dx * u + qx * v), 1, GW - 2),
      clamp(Math.round(sy + dy * u + qy * v), 1, GH - 2));
    this.plans++;
    return [pt(w, 0), pt(w, h), pt(0, h), pt(0, 2 * r), this.home];
  }

  update(dt) {
    const a = this.auth.actors.get(this.pid);
    if (!a) return;
    this.cool -= dt;
    if (a.moving || this.cool > 0) return;
    this.cool = (0.16 + (1 - this.skill) * 0.3) * rand(0.8, 1.25);
    // a loop in progress takes priority, but a high-value interception can still divert it once
    if (this.route) {
      if (this.skill > 0.5 && this.leg >= 2 && this.cutBudget > 0) {
        const hunt = this.findCut(a);
        if (hunt) {
          this.cutBudget--; this.cuts++; this.route = null;
          this.auth.intent(this.pid, hunt[0], hunt[1]);
          return;
        }
      }
      if (this.leg >= 3 && this.shouldBail(a)) { this.route = null; this.goHome(); return; }
      const p = this.route[this.leg++];
      this.auth.intent(this.pid, p[0], p[1]);
      if (this.leg >= this.route.length) this.route = null;
      return;
    }
    const cut = this.findCut(a);
    if (cut && this.cutBudget > 0 && (this.role === 'hunter' || this.skill > 0.7)) {
      this.cutBudget--; this.cuts++;
      this.auth.intent(this.pid, cut[0], cut[1]);
      return;
    }
    this.route = this.planRoute(); this.leg = 0; this.cutBudget = 1;
    if (this.route.length) {
      const p = this.route[this.leg++];
      this.auth.intent(this.pid, p[0], p[1]);
      if (this.leg >= this.route.length) this.route = null;
    }
  }
}

// Deterministic three-lane stamp battle. Only the host (or solo mode) runs step(); clients send a
// {lane, type} intent and render the 15Hz snapshot. Kept free of three.js so it can be tested.
import { UNITS, UNIT_LIST, unitAt, unitIndex } from './units.js';
import { clamp, rand, damp } from './util.js';

export const LANES = [-7, 0, 7];
export const FIELD_HALF = 30;
export const BASE_X = 27;
export const SPAWN_X = 23;
export const INK_MAX = 10;
export const BASE_HP = 100;
export const DRAW = 3;
export const DEPLOY_GAP = 0.32;

export function createState(opts = {}) {
  const blueHp = opts.blueHp ?? BASE_HP, redHp = opts.redHp ?? BASE_HP;
  return {
    t: 0, units: [], projectiles: [],
    ink: [0, opts.ink ?? 5, opts.ink ?? 5],
    inkMax: opts.inkMax ?? INK_MAX,
    inkRate: opts.inkRate ?? 1.0,
    aiRate: opts.aiRate ?? 1.0,
    hp: [0, blueHp, redHp], maxHp: [0, blueHp, redHp],
    winner: 0, nextId: 1, events: [],
    unlock: opts.unlock ?? 4,
    aiPool: (opts.aiPool || []).slice(),
    aiDelay: opts.aiDelay ?? 2.4, aiNext: opts.aiDelay ?? 2.4,
    surgeEvery: opts.surgeEvery ?? 0,
    surgeT: opts.surgeEvery ? opts.surgeEvery * 0.75 : 1e9,
    level: opts.level ?? 0,
    timeLeft: opts.timeLeft ?? 0,
    deployCd: [0, 0, 0],
  };
}

export const canDeploy = (s, team, type) =>
  !!(UNITS[type] && s.winner === 0 && s.deployCd[team] <= 0 && s.ink[team] >= UNITS[type].cost);

export function spawn(s, team, lane, type) {
  const def = UNITS[type];
  if (!def || (team !== 1 && team !== 2) || lane < 0 || lane > 2) return false;
  if (!canDeploy(s, team, type)) return false;
  s.ink[team] -= def.cost;
  s.deployCd[team] = DEPLOY_GAP;
  const dir = team === 1 ? 1 : -1;
  const u = { id: s.nextId++, team, lane, type, x: -dir * SPAWN_X, hp: def.hp, cd: rand(0, 0.18), dir };
  s.units.push(u);
  s.events.push({ t: 'spawn', team, lane, type, id: u.id, x: u.x });
  return true;
}

function findTarget(s, u) {
  let best = null, bestAhead = Infinity;
  for (const o of s.units) {
    if (o.team === u.team || o.lane !== u.lane || o.hp <= 0) continue;
    const ahead = u.dir * (o.x - u.x);
    if (ahead < -0.5 || ahead >= bestAhead) continue;
    bestAhead = ahead; best = { kind: 'unit', unit: o, team: o.team, x: o.x };
  }
  if (best) return best;
  return { kind: 'base', team: u.team === 1 ? 2 : 1, x: u.dir > 0 ? BASE_X : -BASE_X };
}

function damage(s, target, dmg, team, lane, x) {
  if (target.kind === 'unit') target.unit.hp -= dmg;
  else s.hp[target.team] = Math.max(0, s.hp[target.team] - dmg);
  s.events.push({ t: 'hit', kind: target.kind, team, lane, x, dmg });
}

function attack(s, u, def, target) {
  if (def.ranged) {
    s.projectiles.push({
      id: s.nextId++, team: u.team, lane: u.lane,
      x: u.x + u.dir * 0.9, vx: u.dir * def.projSpeed, dir: u.dir, dmg: def.dmg,
    });
    s.events.push({ t: 'shoot', team: u.team, lane: u.lane, x: u.x, type: u.type });
  } else damage(s, target, def.dmg, u.team, u.lane, target.x);
}

// Counter-pick: read the player's composition on the chosen lane and pick the stamp that beats it.
// High dps breaks erasers/blots, fast durable stamps rush archers, fast stamps exploit empty lanes.
function aiDeploy(s) {
  const pool = s.aiPool.filter((t) => UNITS[t] && UNITS[t].cost <= s.ink[2]);
  if (!pool.length || s.deployCd[2] > 0) return null;
  const pressure = [0, 0, 0];
  for (const u of s.units) {
    if (u.team !== 1) continue;
    pressure[u.lane] += UNITS[u.type].dmg * 0.35 + u.hp * 0.015 + (1 - Math.abs(u.x) / FIELD_HALF);
  }
  // Mostly reinforce the lane under pressure, but sometimes spread out. A perfectly omniscient
  // counter-pick pins the front line in the player's half forever and makes late stages unwinnable.
  let lane;
  if (Math.random() < 0.32) lane = Math.floor(rand(0, 3));
  else {
    lane = 0; let best = -Infinity;
    for (let i = 0; i < 3; i++) { const v = pressure[i] + rand(0, 2.2); if (v > best) { best = v; lane = i; } }
  }
  const foes = s.units.filter((u) => u.team === 1 && u.lane === lane);
  const tanks = foes.filter((u) => u.type === 'eraser' || u.type === 'blot').length;
  const ranged = foes.filter((u) => u.type === 'clip').length;
  let type = null, typeScore = -Infinity;
  for (const t of pool) {
    const d = UNITS[t];
    let v = rand(0, 1.4) - d.cost * 0.18;
    if (tanks) v += d.dmg / d.cd * 0.35;
    if (ranged) v += d.speed * 0.5 + d.hp * 0.012;
    if (!foes.length) v += d.speed * 0.25;
    if (v > typeScore) { typeScore = v; type = t; }
  }
  return type ? { lane, type } : null;
}

export function step(s, dt, intents = []) {
  if (s.winner) { s.events.length = 0; return s; }
  s.events.length = 0;
  s.t += dt;
  s.ink[1] = Math.min(s.inkMax, s.ink[1] + s.inkRate * dt);
  s.ink[2] = Math.min(s.inkMax, s.ink[2] + s.inkRate * s.aiRate * dt);
  for (const team of [1, 2]) s.deployCd[team] = Math.max(0, s.deployCd[team] - dt);

  for (const it of intents) spawn(s, it.team, it.lane, it.type);

  if (s.aiPool.length) {
    s.aiNext -= dt;
    if (s.aiNext <= 0) {
      const plan = aiDeploy(s);
      if (plan) { spawn(s, 2, plan.lane, plan.type); s.aiNext = s.aiDelay * rand(0.75, 1.3); }
      else s.aiNext = 0.3;
    }
    // Stage 6+: a periodic double deploy. It still pays for both stamps, but ignores the short
    // deploy cooldown so the two land together as a visible wave instead of trickling out.
    if (s.surgeEvery > 0) {
      s.surgeT -= dt;
      if (s.surgeT <= 0) {
        s.surgeT = s.surgeEvery * rand(0.85, 1.2);
        let count = 0;
        for (let k = 0; k < 2; k++) {
          s.deployCd[2] = 0;
          const plan = aiDeploy(s);
          if (plan && spawn(s, 2, plan.lane, plan.type)) count++;
        }
        if (count) s.events.push({ t: 'surge', count });
      }
    }
  }

  for (const u of s.units) {
    const def = UNITS[u.type];
    u.cd -= dt;
    const target = findTarget(s, u);
    if (Math.abs(target.x - u.x) <= def.range + 0.55) {
      if (u.cd <= 0) { attack(s, u, def, target); u.cd = def.cd; }
    } else u.x += u.dir * def.speed * dt;
  }

  for (const p of s.projectiles) {
    p.x += p.vx * dt;
    let hit = null;
    for (const o of s.units) {
      if (o.team === p.team || o.lane !== p.lane || o.hp <= 0) continue;
      if (Math.abs(o.x - p.x) < 0.9) { hit = { kind: 'unit', unit: o, team: o.team }; break; }
    }
    if (!hit && (p.dir > 0 ? p.x >= BASE_X : p.x <= -BASE_X)) hit = { kind: 'base', team: p.team === 1 ? 2 : 1 };
    if (hit) { damage(s, hit, p.dmg, p.team, p.lane, p.x); p.dead = true; }
    else if (Math.abs(p.x) > FIELD_HALF + 2) p.dead = true;
  }
  if (s.projectiles.some((p) => p.dead)) s.projectiles = s.projectiles.filter((p) => !p.dead);

  const alive = [];
  for (const u of s.units) {
    if (u.hp > 0) alive.push(u);
    else s.events.push({ t: 'die', team: u.team, lane: u.lane, x: u.x, type: u.type, id: u.id });
  }
  s.units = alive;

  if (s.hp[2] <= 0) { s.winner = 1; s.events.push({ t: 'win', team: 1 }); }
  else if (s.hp[1] <= 0) { s.winner = 2; s.events.push({ t: 'win', team: 2 }); }
  else if (s.timeLeft > 0) {
    s.timeLeft -= dt;
    if (s.timeLeft <= 0) {
      s.timeLeft = 0;
      const r1 = s.hp[1] / s.maxHp[1], r2 = s.hp[2] / s.maxHp[2];
      s.winner = Math.abs(r1 - r2) < 0.02 ? DRAW : r1 > r2 ? 1 : 2;
      s.events.push({ t: 'win', team: s.winner });
    }
  }
  return s;
}

const laneZ = (lane) => LANES[lane] || 0;
export { laneZ };

// Compact snapshot: positions only, hp integer, unit type as 1..4. Clients interpolate x.
export function encodeSnap(s) {
  return {
    t: +s.t.toFixed(2),
    u: s.units.map((u) => [u.id, u.team, u.lane, +u.x.toFixed(2), Math.round(u.hp), unitIndex(u.type)]),
    p: s.projectiles.map((p) => [p.id, p.team, p.lane, +p.x.toFixed(2)]),
    i: [+s.ink[1].toFixed(2), +s.ink[2].toFixed(2)],
    h: [Math.round(s.hp[1]), Math.round(s.hp[2])],
    l: s.timeLeft > 0 ? +s.timeLeft.toFixed(1) : 0,
    w: s.winner,
    e: s.events.slice(0, 40),
  };
}

export function applySnap(target, d, dt = 0) {
  target.t = d.t; target.winner = d.w;
  target.ink[1] = d.i[0]; target.ink[2] = d.i[1];
  target.hp[1] = d.h[0]; target.hp[2] = d.h[1];
  target.timeLeft = d.l || 0;
  const prev = new Map(target.units.map((u) => [u.id, u]));
  const next = [];
  for (const [id, team, lane, x, hp, ti] of d.u) {
    const old = prev.get(id);
    if (old) { old.x = dt > 0 ? damp(old.x, x, 16, dt) : x; old.hp = hp; next.push(old); }
    else next.push({ id, team, lane, type: unitAt(ti), x, hp, cd: 0, dir: team === 1 ? 1 : -1 });
  }
  target.units = next;
  target.projectiles = d.p.map(([id, team, lane, x]) => ({ id, team, lane, x, vx: 0, dir: team === 1 ? 1 : -1, dmg: 0 }));
  target.events = d.e || [];
  return target;
}

export const unlockedTypes = (s) => UNIT_LIST.slice(0, clamp(s.unlock, 1, UNIT_LIST.length));

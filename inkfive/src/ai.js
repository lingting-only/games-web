// Minimax with alpha-beta pruning, restricted to stones near existing ones and capped by a node
// budget so a deep search never freezes the page. Power-ups are valued when ordering candidates;
// the search itself plays pure five-in-a-row (the human keeps the道具 advantage).
import { N, N_CELLS, idx, inBoard, DIRS, findLine } from './rules.js';
import { rand } from './util.js';

const WEIGHTS = [0, 1, 12, 90, 700, 100000];
const _near = new Uint8Array(N_CELLS);

export function evalBoard(board, me) {
  const foe = me === 1 ? 2 : 1;
  let score = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const v = board[idx(c, r)];
    if (!v) continue;
    for (const [dx, dy] of DIRS) {
      const px = c - dx, py = r - dy;
      if (inBoard(px, py) && board[idx(px, py)] === v) continue; // count each run once
      let n = 0, x = c, y = r;
      while (inBoard(x, y) && board[idx(x, y)] === v) { n++; x += dx; y += dy; }
      const openA = inBoard(px, py) && board[idx(px, py)] === 0;
      const openB = inBoard(x, y) && board[idx(x, y)] === 0;
      let w = WEIGHTS[Math.min(n, 5)];
      if (n < 5) w *= (openA && openB) ? 2.2 : (openA || openB ? 1.15 : 0.3);
      score += (v === me ? 1 : -0.94) * w;
    }
  }
  return score;
}

function quick(board, c, r, team) {
  let s = 0;
  for (const [dx, dy] of DIRS) {
    let n = 1;
    for (const sign of [1, -1]) {
      let x = c + dx * sign, y = r + dy * sign;
      while (inBoard(x, y) && board[idx(x, y)] === team) { n++; x += dx * sign; y += dy * sign; }
    }
    s += WEIGHTS[Math.min(n, 5)];
  }
  return s;
}

export function candidates(board, powers, limit = 10) {
  _near.fill(0);
  let any = false;
  for (let i = 0; i < N_CELLS; i++) {
    if (!board[i]) continue;
    const c = i % N, r = (i / N) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = c + dx, y = r + dy;
      if (!inBoard(x, y)) continue;
      const j = idx(x, y);
      if (!board[j]) { _near[j] = 1; any = true; }
    }
  }
  const out = [];
  if (!any) { const i = idx(7, 7); return [{ i, c: 7, r: 7, s: 0 }]; }
  for (let i = 0; i < N_CELLS; i++) {
    if (!_near[i]) continue;
    const c = i % N, r = (i / N) | 0;
    out.push({ i, c, r, s: quick(board, c, r, 1) + quick(board, c, r, 2) + (powers[i] ? 90 : 0) });
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, limit);
}

function search(board, powers, depth, alpha, beta, me, turn, limit, budget) {
  budget.n--;
  if (depth <= 0 || budget.n <= 0) return evalBoard(board, me);
  const cand = candidates(board, powers, limit);
  if (!cand.length) return evalBoard(board, me);
  const next = turn === 1 ? 2 : 1;
  if (turn === me) {
    let best = -Infinity;
    for (const m of cand) {
      board[m.i] = turn;
      const v = findLine(board, m.c, m.r, turn)
        ? 1e7 - depth * 10
        : search(board, powers, depth - 1, alpha, beta, me, next, limit, budget);
      board[m.i] = 0;
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of cand) {
    board[m.i] = turn;
    const v = findLine(board, m.c, m.r, turn)
      ? -1e7 + depth * 10
      : search(board, powers, depth - 1, alpha, beta, me, next, limit, budget);
    board[m.i] = 0;
    if (v < best) best = v;
    if (best < beta) beta = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function chooseMove(state, opts = {}) {
  const me = state.turn, foe = me === 1 ? 2 : 1;
  const depth = opts.depth ?? 3, limit = opts.limit ?? 9;
  const board = Uint8Array.from(state.board), powers = state.powers;
  const all = candidates(board, powers, 18);
  for (const m of all) {
    board[m.i] = me; const win = findLine(board, m.c, m.r, me); board[m.i] = 0;
    if (win) return m;                       // win in one
  }
  for (const m of all) {
    board[m.i] = foe; const win = findLine(board, m.c, m.r, foe); board[m.i] = 0;
    if (win) return m;                       // block an immediate loss
  }
  const budget = { n: opts.budget ?? 12000 };
  let best = null, bestV = -Infinity, alpha = -Infinity;
  for (const m of candidates(board, powers, limit)) {
    board[m.i] = me;
    let v = findLine(board, m.c, m.r, me)
      ? 1e6
      : search(board, powers, depth - 1, alpha, Infinity, me, foe, limit, budget);
    board[m.i] = 0;
    v += rand(-3, 3);
    if (v > bestV) { bestV = v; best = m; }
    if (v > alpha) alpha = v;
  }
  return best || all[0] || null;
}

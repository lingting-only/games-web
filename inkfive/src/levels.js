// Ten solo stages: the first ones are one-move puzzles, later ones are open games against a
// deeper search, and the last one is the correction-fluid boss that wipes your latest stone.
import { N, N_CELLS, idx, inBoard, DIRS, POWER, createState, findLine } from './rules.js';
import { clamp } from './util.js';

export const LEVELS = [
  { name: '第一笔', kind: 'puzzle', stones: 5, powers: 3, depth: 2, boss: 0, hint: '找到一步连成五子的点' },
  { name: '堵住红笔', kind: 'puzzle', stones: 9, powers: 4, depth: 2, boss: 0, hint: '红笔也在凑四，小心反杀' },
  { name: '墨渍初现', kind: 'open', powers: 6, depth: 2, boss: 0, hint: '黑点是墨渍炸弹，能炸掉周围对手子' },
  { name: '荧光连击', kind: 'open', powers: 10, depth: 3, boss: 0, hint: '绿色三角是荧光笔：下完立刻再下一手' },
  { name: '橡皮擦攻防', kind: 'open', powers: 12, depth: 3, boss: 0, hint: '粉色方块会擦掉对手最近一子' },
  { name: '回形针封锁', kind: 'open', powers: 14, depth: 4, boss: 0, hint: '橙色圆环冻结对手两回合的道具' },
  { name: '快笔怪', kind: 'open', powers: 16, depth: 4, boss: 0, hint: '对手算得更深，别只顾着进攻' },
  { name: '涂改液 Boss', kind: 'open', powers: 14, depth: 4, boss: 6, hint: 'Boss 每 6 手擦掉你最近的一颗子' },
];
export const LEVEL_COUNT = LEVELS.length;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// a hand-made "win in one" position: four blue stones with one gap, plus red distractions
export function makePuzzle(seed, stones = 6) {
  const rnd = rng(seed);
  const board = new Uint8Array(N_CELLS);
  const [dx, dy] = DIRS[Math.floor(rnd() * DIRS.length)];
  let c0 = 3, r0 = 3;
  for (let k = 0; k < 80; k++) {
    const c = 2 + Math.floor(rnd() * (N - 6)), r = 2 + Math.floor(rnd() * (N - 6));
    if (inBoard(c + dx * 4, r + dy * 4)) { c0 = c; r0 = r; break; }
  }
  const gap = Math.floor(rnd() * 5);
  for (let k = 0; k < 5; k++) if (k !== gap) board[idx(c0 + dx * k, r0 + dy * k)] = 1;
  const answer = idx(c0 + dx * gap, r0 + dy * gap);
  let added = 0;
  for (let k = 0; k < 600 && added < stones; k++) {
    const c = Math.floor(rnd() * N), r = Math.floor(rnd() * N), i = idx(c, r);
    if (board[i] || i === answer) continue;
    board[i] = 2;
    if (findLine(board, c, r, 2)) { board[i] = 0; continue; }
    added++;
  }
  return { board, answer };
}

export function scatterPowers(seed, count, board = null) {
  const rnd = rng(seed + 777);
  const p = new Uint8Array(N_CELLS);
  const types = [POWER.BOMB, POWER.ERASER, POWER.FLASH, POWER.FREEZE];
  let placed = 0;
  for (let k = 0; k < 1200 && placed < count; k++) {
    const c = 1 + Math.floor(rnd() * (N - 2)), r = 1 + Math.floor(rnd() * (N - 2)), i = idx(c, r);
    if (p[i] || (board && board[i])) continue;
    p[i] = types[Math.floor(rnd() * types.length)];
    placed++;
  }
  return p;
}

export function levelState(level) {
  const lv = clamp(level, 0, LEVEL_COUNT - 1), L = LEVELS[lv];
  const seed = 3100 + lv * 7919;
  const board = L.kind === 'puzzle' ? makePuzzle(seed, L.stones).board : null;
  const s = createState({ board, bossEvery: L.boss });
  s.powers = scatterPowers(seed, L.powers, board);
  return s;
}
export function freeState(difficulty = 1) {
  const s = createState();
  s.powers = scatterPowers(9100 + difficulty * 137, 8 + difficulty * 4);
  return s;
}

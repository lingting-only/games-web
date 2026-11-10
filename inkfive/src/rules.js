// Pure rules engine. The same functions drive the single-player AI, the host's move validation
// and the clients' replay, so a move can never be legal in one mode and illegal in another.
export const N = 15;
export const N_CELLS = N * N;
export const EMPTY = 0, BLUE = 1, RED = 2, DRAW = 3;
export const POWER = { NONE: 0, BOMB: 1, ERASER: 2, FLASH: 3, FREEZE: 4 };
export const POWER_INFO = [
  { name: '', desc: '', ink: 2 },
  { name: '墨渍炸弹', desc: '炸掉周围 3×3 的对手棋子', ink: 2 },
  { name: '橡皮擦', desc: '擦掉对手最近落的一子', ink: 5 },
  { name: '荧光笔', desc: '连击：立刻再下一手', ink: 4 },
  { name: '回形针', desc: '冻结对手 2 回合的道具', ink: 3 },
];
export const idx = (c, r) => r * N + c;
export const inBoard = (c, r) => c >= 0 && r >= 0 && c < N && r < N;
export const other = (t) => (t === 1 ? 2 : 1);
export const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

// five (or more) in a row through the stone just placed
export function findLine(board, c, r, team) {
  for (const [dx, dy] of DIRS) {
    const line = [idx(c, r)];
    for (const sign of [1, -1]) {
      let x = c + dx * sign, y = r + dy * sign;
      while (inBoard(x, y) && board[idx(x, y)] === team) {
        line.push(idx(x, y)); x += dx * sign; y += dy * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return null;
}

// seats alternate teams: A1(0), B1(1), A2(2), B2(3) -> 1,2,1,2
export const teamOfSeat = (seat) => (seat % 2 === 0 ? 1 : 2);
export const seatPid = (s, seat) => s.seats[seat] || 0;
export const currentSeatPid = (s) => s.seats[s.seat] || 0;

export function createState(opts = {}) {
  return {
    board: opts.board ? Uint8Array.from(opts.board) : new Uint8Array(N_CELLS),
    powers: opts.powers ? Uint8Array.from(opts.powers) : new Uint8Array(N_CELLS),
    seats: (opts.seats || [1, 2]).slice(),
    seat: 0, turn: 1,
    moveNo: 0, last: -1, lastByTeam: [0, -1, -1],
    frozen: [0, 0, 0],
    winner: 0, winLine: [],
    bossEvery: opts.bossEvery || 0,
    history: [],
  };
}
function snapshot(s) {
  return {
    board: Uint8Array.from(s.board), powers: Uint8Array.from(s.powers),
    seat: s.seat, turn: s.turn, moveNo: s.moveNo, last: s.last,
    lastByTeam: s.lastByTeam.slice(), frozen: s.frozen.slice(),
    winner: s.winner, winLine: s.winLine.slice(),
  };
}

// Returns { state, events } or null for an illegal move. Never mutates the input.
export function applyMove(s, c, r, team) {
  if (s.winner || !inBoard(c, r) || team !== s.turn) return null;
  const i = idx(c, r);
  if (s.board[i] !== EMPTY) return null;
  const t = {
    ...s,
    board: Uint8Array.from(s.board), powers: Uint8Array.from(s.powers),
    frozen: s.frozen.slice(), lastByTeam: s.lastByTeam.slice(),
    history: s.history.slice(), winLine: s.winLine.slice(),
  };
  t.history.push(snapshot(s));
  const events = [{ t: 'place', i, c, r, team }];
  t.board[i] = team; t.last = i; t.lastByTeam[team] = i; t.moveNo++;

  const line = findLine(t.board, c, r, team);
  if (line) { t.winner = team; t.winLine = line; events.push({ t: 'win', team, line }); return { state: t, events }; }

  const p = t.powers[i];
  let flash = false;
  if (p) {
    t.powers[i] = 0;
    if (t.frozen[team] > 0) events.push({ t: 'blocked', i, p });
    else {
      events.push({ t: 'power', i, p, team });
      const foe = other(team);
      if (p === POWER.BOMB) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = c + dx, y = r + dy;
          if (!inBoard(x, y)) continue;
          const j = idx(x, y);
          if (t.board[j] === foe) { t.board[j] = 0; events.push({ t: 'erase', i: j }); }
        }
        if (t.lastByTeam[foe] >= 0 && t.board[t.lastByTeam[foe]] !== foe) t.lastByTeam[foe] = -1;
      } else if (p === POWER.ERASER) {
        const j = t.lastByTeam[foe];
        if (j >= 0 && t.board[j] === foe) { t.board[j] = 0; t.lastByTeam[foe] = -1; events.push({ t: 'erase', i: j }); }
      } else if (p === POWER.FLASH) flash = true;
      else if (p === POWER.FREEZE) t.frozen[foe] = 2;
    }
  }

  // the correction-fluid boss wipes the human's latest stone every few plies
  if (t.bossEvery && t.moveNo % t.bossEvery === 0) {
    const j = t.lastByTeam[1];
    if (j >= 0 && t.board[j] === 1) {
      t.board[j] = 0; t.lastByTeam[1] = -1; events.push({ t: 'erase', i: j, boss: true });
    }
  }

  let full = true;
  for (let k = 0; k < N_CELLS; k++) if (t.board[k] === 0) { full = false; break; }
  if (full) { t.winner = DRAW; events.push({ t: 'draw' }); return { state: t, events }; }

  if (!flash) { t.seat = (t.seat + 1) % t.seats.length; t.turn = teamOfSeat(t.seat); }
  if (t.frozen[team] > 0) t.frozen[team]--;
  return { state: t, events };
}

export function undo(s) {
  if (!s.history.length) return null;
  const h = s.history[s.history.length - 1];
  const t = { ...s, history: s.history.slice(0, -1) };
  Object.assign(t, h);
  return t;
}

export function rle(a) {
  const out = []; let v = a[0], n = 1;
  for (let i = 1; i < a.length; i++) {
    if (a[i] === v) n++; else { out.push(v, n); v = a[i]; n = 1; }
  }
  out.push(v, n); return out;
}
export function unrle(p, len) {
  const a = new Uint8Array(len); let k = 0;
  for (let i = 0; i < p.length; i += 2) for (let j = 0; j < p[i + 1]; j++) if (k < len) a[k++] = p[i];
  return a;
}
export function encodeState(s) {
  return {
    b: rle(s.board), p: rle(s.powers), g: s.seats, s: s.seat, t: s.turn,
    n: s.moveNo, l: s.last, lt: s.lastByTeam, f: s.frozen,
    w: s.winner, wl: s.winLine, boss: s.bossEvery,
  };
}
export function decodeState(d) {
  const s = createState({ seats: d.g || [1, 2], bossEvery: d.boss || 0 });
  s.board = unrle(d.b, N_CELLS); s.powers = unrle(d.p, N_CELLS);
  s.seat = d.s; s.turn = d.t; s.moveNo = d.n; s.last = d.l;
  s.lastByTeam = d.lt.slice(); s.frozen = d.f.slice();
  s.winner = d.w; s.winLine = d.wl.slice();
  return s;
}

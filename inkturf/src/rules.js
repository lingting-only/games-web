// Pure rules for Ink Turf. No three.js, no DOM: the same functions run in solo and on the host,
// so an AI, a local player and a networked player are indistinguishable to the simulation.

// A claim is a flood fill from the border of the page. Everything that cannot be reached from
// outside is enclosed by the player's own territory + their unfinished ink line, so it becomes
// theirs. Territory and the unfinished line are walls during the fill; opponent territory is not
// (that is what lets you eat someone else's area).
export function claimRegion(owner, trail, blocked, W, H, pid) {
  const N = W * H;
  const wall = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (blocked[i] || owner[i] === pid || trail[i] === pid) wall[i] = 1;
  const seen = new Uint8Array(N);
  const q = new Int32Array(N); let head = 0, tail = 0;
  const push = (i) => { if (!wall[i] && !seen[i]) { seen[i] = 1; q[tail++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (head < tail) {
    const i = q[head++], x = i % W, y = (i / W) | 0;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W);
    if (y < H - 1) push(i + W);
  }
  const enclosed = [], line = [];
  for (let i = 0; i < N; i++) {
    if (trail[i] === pid) line.push(i);
    else if (!seen[i] && !wall[i]) enclosed.push(i);
  }
  return { enclosed, line };
}

export function coverage(owner, blocked, W, H, nPlayers) {
  const counts = new Array(nPlayers + 1).fill(0);
  let total = 0;
  for (let i = 0; i < W * H; i++) {
    if (blocked[i]) continue;
    total++;
    const o = owner[i];
    if (o > 0 && o <= nPlayers) counts[o]++;
  }
  return { counts, total, pct: counts.map((c) => (total ? (c / total) * 100 : 0)) };
}

// 8-connected BFS over the cell grid. Obstacles are the only impassable cells.
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export function findPath(blocked, W, H, sx, sy, tx, ty) {
  const N = W * H;
  const s = sy * W + sx, t = ty * W + tx;
  if (s === t) return [s];
  const prev = new Int32Array(N).fill(-1), seen = new Uint8Array(N), q = new Int32Array(N);
  let head = 0, tail = 0; q[tail++] = s; seen[s] = 1;
  while (head < tail) {
    const i = q[head++];
    if (i === t) break;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (seen[ni] || blocked[ni]) continue;
      seen[ni] = 1; prev[ni] = i; q[tail++] = ni;
    }
  }
  if (!seen[t]) return null;
  const path = [];
  for (let i = t; i !== -1; i = prev[i]) { path.push(i); if (i === s) break; }
  return path.reverse();
}

// a click on an obstacle slides to the nearest free cell so the pen always has somewhere to go
export function nearestFree(blocked, W, H, tx, ty) {
  if (!blocked[ty * W + tx]) return [tx, ty];
  for (let r = 1; r < 14; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (!blocked[ny * W + nx]) return [nx, ny];
    }
  }
  return [tx, ty];
}

// RLE encode / decode of the owner grid, used when someone joins a match already in progress
export function encodeGrid(grid) {
  const out = []; let run = 1;
  for (let i = 1; i <= grid.length; i++) {
    if (i < grid.length && grid[i] === grid[i - 1]) run++;
    else { out.push(grid[i - 1], run); run = 1; }
  }
  return out;
}
export function decodeGrid(pairs, len, out = new Uint8Array(len)) {
  let k = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    const v = pairs[i], n = pairs[i + 1];
    for (let j = 0; j < n && k < len; j++) out[k++] = v;
  }
  return out;
}

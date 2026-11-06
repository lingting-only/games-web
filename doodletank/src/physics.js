// Board physics: the battlefield is a WIDESCREEN grid of big cells (2 world units each) tracked
// at half-cell resolution so brick walls break in strips like the original. 21x13 big cells
// (42x26 half cells) — with the camera's tilt this fills a 16:9 screen edge to edge.
// Tanks are axis-aligned squares (they only face four ways), bullets are small circles.
export const BIG_W = 21, BIG_H = 13;   // big cells across / down
export const HALF_N = BIG_W * 2;       // half cells across (42)
export const HALF_N_Z = BIG_H * 2;     // half cells down (26)
export const CELL = 2;                 // world units per big cell
export const BOARD_MIN = -BIG_W, BOARD_MAX = BIG_W;        // x range
export const BOARD_MIN_Z = -BIG_H, BOARD_MAX_Z = BIG_H;    // z range

export const T = { EMPTY: 0, BRICK: 1, STEEL: 2, WATER: 3, TREE: 4, ICE: 5, EAGLE: 6 };
// what blocks what
export const blocksTank = (t) => t === T.BRICK || t === T.STEEL || t === T.WATER || t === T.EAGLE;
export const blocksBullet = (t) => t === T.BRICK || t === T.STEEL || t === T.EAGLE;

export const DIRS = {
  up: { x: 0, z: -1, angle: 0 },
  down: { x: 0, z: 1, angle: Math.PI },
  left: { x: -1, z: 0, angle: Math.PI / 2 },
  right: { x: 1, z: 0, angle: -Math.PI / 2 },
};
export const DIR_NAMES = ['up', 'right', 'down', 'left'];

export function cellCenter(cx, cy) { return { x: BOARD_MIN + cx * CELL + CELL / 2, z: BOARD_MIN_Z + cy * CELL + CELL / 2 }; }
// snap a coordinate to the centre of a big cell lane (even world units — both board mins are
// odd, so every cell centre lands on an even coordinate) — tanks ride these lanes
export function snapLane(v) { return Math.round(v / 2) * 2; }
export function clampBoardX(v) { return Math.min(BOARD_MAX - 0.01, Math.max(BOARD_MIN + 0.01, v)); }
export function clampBoardZ(v) { return Math.min(BOARD_MAX_Z - 0.01, Math.max(BOARD_MIN_Z + 0.01, v)); }

export class Grid {
  constructor() {
    this.tiles = new Uint8Array(HALF_N * HALF_N_Z);
    this.onTile = null;          // (hx, hz, old, now) — used for remote sync + mesh rebuild
  }
  clear() { this.tiles.fill(T.EMPTY); }
  idx(hx, hz) { return hz * HALF_N + hx; }
  get(hx, hz) { return (hx < 0 || hz < 0 || hx >= HALF_N || hz >= HALF_N_Z) ? T.STEEL : this.tiles[this.idx(hx, hz)]; }
  set(hx, hz, t) {
    if (hx < 0 || hz < 0 || hx >= HALF_N || hz >= HALF_N_Z) return;
    const i = this.idx(hx, hz), old = this.tiles[i];
    if (old === t) return;
    this.tiles[i] = t;
    if (this.onTile) this.onTile(hx, hz, old, t);
  }
  worldToCell(x, z) { return { hx: Math.floor(x - BOARD_MIN), hz: Math.floor(z - BOARD_MIN_Z) }; }
  cellCenterW(hx, hz) { return { x: BOARD_MIN + hx + 0.5, z: BOARD_MIN_Z + hz + 0.5 }; }

  // would a square of half-extent hw centred at (x,z) overlap something tanks can't cross?
  rectBlocked(x, z, hw, skipTrees = true) {
    const a = this.worldToCell(x - hw, z - hw), b = this.worldToCell(x + hw, z + hw);
    for (let hz = a.hz; hz <= b.hz; hz++) for (let hx = a.hx; hx <= b.hx; hx++) {
      const t = this.get(hx, hz);
      if (blocksTank(t)) return true;
      if (!skipTrees && t === T.TREE) return true;
    }
    return false;
  }
  tileAt(x, z) { const c = this.worldToCell(x, z); return this.get(c.hx, c.hz); }
  // total overlap area with tank-blocking cells — a fine-grained "how stuck am I" measure that
  // decreases with every step toward freedom, unlike a plain overlapped-cell count
  overlapArea(x, z, hw) {
    const a = this.worldToCell(x - hw, z - hw), b = this.worldToCell(x + hw, z + hw);
    let s = 0;
    for (let hz = a.hz; hz <= b.hz; hz++) for (let hx = a.hx; hx <= b.hx; hx++) {
      if (!blocksTank(this.get(hx, hz))) continue;
      const cx0 = BOARD_MIN + hx, cz0 = BOARD_MIN + hz;
      const ox = Math.min(x + hw, cx0 + 1) - Math.max(x - hw, cx0);
      const oz = Math.min(z + hw, cz0 + 1) - Math.max(z - hw, cz0);
      if (ox > 0 && oz > 0) s += ox * oz;
    }
    return s;
  }

  // first blocking tile a bullet at (x,z) moving one step meets; returns { hx, hz, type } or null
  bulletStep(x, z) {
    const c = this.worldToCell(x, z);
    const t = this.get(c.hx, c.hz);
    if (blocksBullet(t)) return { hx: c.hx, hz: c.hz, type: t };
    return null;
  }
  // destroy the brick strip a bullet carves. The shell has width: every half-cell its body
  // overlaps across the line of fire is destroyed, so a shot riding a lane boundary (where
  // tank lanes sit) opens a full tank-wide gap. Depth is half a big cell per shot — the half
  // facing the shooter — so a full brick block takes two shells, exactly like the original.
  // cross = the bullet's coordinate on the axis perpendicular to its travel.
  carve(hit, dir, power, cross, out) {
    const dmgSteel = power >= 3;
    if (hit.type === T.BRICK || (hit.type === T.STEEL && dmgSteel) || hit.type === T.EAGLE) {
      const seen = new Set([hit.hz * HALF_N + hit.hx]);
      out.push({ hx: hit.hx, hz: hit.hz, type: hit.type });
      if (hit.type === T.BRICK) {
        const w = 0.45, along = dir.x !== 0;
        // cross is a z coordinate when travelling along x (and vice versa) — use that axis' origin
        const base = along ? BOARD_MIN_Z : BOARD_MIN;
        const lo = Math.floor(cross - w - base), hi = Math.floor(cross + w - base);
        for (let n = lo; n <= hi; n++) {
          const c = along ? { hx: hit.hx, hz: n } : { hx: n, hz: hit.hz };
          const key = c.hz * HALF_N + c.hx;
          if (!seen.has(key) && this.get(c.hx, c.hz) === T.BRICK) {
            seen.add(key);
            out.push({ hx: c.hx, hz: c.hz, type: T.BRICK });
          }
        }
      }
      return true;
    }
    return false;
  }
}

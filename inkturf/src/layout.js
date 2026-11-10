// Ten notebook layouts. Obstacles are real blocked cells (they stop the pen and the flood fill),
// and their decoration is merged into one mesh per ink colour so the page stays cheap to draw.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeInkMaterial, INK } from './render.js';
import { GW, GH, CELL, N_CELLS, cellToWorld, cellIndex } from './paper.js';

export const LAYOUT_COUNT = 10;
export const SPAWNS = [[12, 12], [GW - 13, GH - 13], [GW - 13, 12], [12, GH - 13]];

export function buildLayout(scene, level = 0) {
  let seed = 9100 + level * 7919;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const blocked = new Uint8Array(N_CELLS);
  const geos = {};
  const add = (g, ink = INK.BLACK) => { (geos[ink] || (geos[ink] = [])).push(g.index ? g.toNonIndexed() : g); };
  const put = (g, cx, cy, y, rot = 0) => {
    const [x, z] = cellToWorld(cx, cy);
    if (rot) g.rotateY(rot);
    g.translate(x, y, z);
    return g;
  };
  const awayFromSpawns = (cx, cy) => SPAWNS.every(([sx, sy]) => Math.abs(cx - sx) > 9 || Math.abs(cy - sy) > 9);
  let blockedCount = 0;
  const MAX_BLOCKED = 460;   // too much clutter makes BFS detour and breaks closed loops
  const mark = (cx, cy, ink) => {
    if (cx < 1 || cy < 1 || cx >= GW - 1 || cy >= GH - 1 || !awayFromSpawns(cx, cy)) return;
    const i = cellIndex(cx, cy);
    if (blocked[i] || blockedCount >= MAX_BLOCKED) return;
    blocked[i] = 1; blockedCount++;
    if (ink != null) add(put(new THREE.BoxGeometry(CELL * 0.95, 0.3, CELL * 0.95), cx, cy, 0.15), ink);
  };

  // ink blots: little flattened puddles, the classic hazard of a school notebook
  const blots = 3 + Math.ceil(level * 0.5);
  for (let i = 0; i < blots; i++) {
    const cx = ri(8, GW - 9), cy = ri(7, GH - 8), r = ri(2, 5);
    if (!awayFromSpawns(cx, cy)) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) mark(cx + dx, cy + dy, null);
    }
    add(put(new THREE.CylinderGeometry(CELL * r * 0.9, CELL * r * 0.9, 0.14, 12), cx, cy, 0.12), INK.BLACK);
    add(put(new THREE.TorusGeometry(CELL * r * 0.72, 0.1, 5, 16).rotateX(-Math.PI / 2), cx, cy, 0.22), INK.BLUE);
  }

  // staples: short bars with two little legs
  const staples = 2 + Math.floor(level / 4);
  for (let i = 0; i < staples; i++) {
    const cx = ri(8, GW - 9), cy = ri(6, GH - 7), len = ri(4, 8), horiz = rnd() > 0.5;
    if (!awayFromSpawns(cx, cy)) continue;
    for (let k = -len; k <= len; k++) mark(cx + (horiz ? k : 0), cy + (horiz ? 0 : k), null);
    const bar = new THREE.BoxGeometry(horiz ? len * 2 * CELL : CELL * 0.7, 0.34, horiz ? CELL * 0.7 : len * 2 * CELL);
    add(put(bar, cx, cy, 0.24), INK.ORANGE);
    for (const s of [-1, 1]) {
      const leg = new THREE.BoxGeometry(0.35, 0.5, 0.35);
      add(put(leg, cx + (horiz ? s * len : 0), cy + (horiz ? 0 : s * len), 0.3), INK.BLACK);
    }
  }

  // rulers: long straight bridges with red ticks
  const rulers = 2 + Math.floor(level / 5);
  for (let i = 0; i < rulers; i++) {
    const cx = ri(16, GW - 17), cy = ri(10, GH - 11), len = ri(9, 15), horiz = rnd() > 0.5;
    if (!awayFromSpawns(cx, cy)) continue;
    for (let k = -len; k <= len; k++) for (let w = 0; w <= 1; w++) {
      mark(cx + (horiz ? k : w), cy + (horiz ? w : k), null);
    }
    const body = new THREE.BoxGeometry(horiz ? len * 2 * CELL : 2 * CELL, 0.36, horiz ? 2 * CELL : len * 2 * CELL);
    add(put(body, cx, cy, 0.22), INK.BLACK);
    for (let k = -len; k <= len; k += 2) {
      const tick = new THREE.BoxGeometry(0.12, 0.1, 0.9);
      add(put(tick, cx + (horiz ? k : 0) + (horiz ? 0 : 0.6), cy + (horiz ? 0.8 : k), 0.44, horiz ? 0 : Math.PI / 2), INK.RED);
    }
  }

  // paperclip frames: only the outline blocks the pen
  const clips = 1 + Math.floor(level / 4);
  for (let i = 0; i < clips; i++) {
    const cx = ri(14, GW - 15), cy = ri(9, GH - 10), r = ri(4, 7);
    if (!awayFromSpawns(cx, cy)) continue;
    for (let k = -r; k <= r; k++) {
      mark(cx + k, cy - r, null); mark(cx + k, cy + r, null);
      mark(cx - r, cy + k, null); mark(cx + r, cy + k, null);
    }
    const mk = (w, d, ox, oz) => add(put(new THREE.BoxGeometry(w, 0.3, d), cx + ox, cy + oz, 0.2), INK.BLUE);
    mk(r * 2 * CELL, 0.4, 0, -r); mk(r * 2 * CELL, 0.4, 0, r);
    mk(0.4, r * 2 * CELL, -r, 0); mk(0.4, r * 2 * CELL, r, 0);
  }

  const group = new THREE.Group(); scene.add(group);
  const mats = [];
  for (const ink in geos) {
    const merged = mergeGeometries(geos[ink], false);
    if (!merged) continue;
    const mat = makeInkMaterial({ ink: Number(ink) }); mats.push(mat);
    const mesh = new THREE.Mesh(merged, mat); mesh.matrixAutoUpdate = false; group.add(mesh);
  }
  return {
    blocked, group,
    dispose() {
      scene.remove(group);
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of mats) m.dispose();
    },
  };
}

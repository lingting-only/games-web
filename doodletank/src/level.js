// Stages and level building. A stage is a 13x13 character map (each char = one big cell):
//   '.' empty   'B' brick   'S' steel   'W' water   'T' trees   'I' ice
// The eagle base and its brick ring, plus the two player spawn cells, are forced on every map.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeInkMaterial, INK } from './render.js';
import { Grid, T, BIG, CELL, BOARD_MIN } from './physics.js';

const MAPS = [
  [
    '...............',
    '.B.B.B.B.B.B.B.',
    '.B.B.B.B.B.B.B.',
    '.B.B.BSB.B.B.B.',
    '.B.B.B.B.B.B.B.',
    '.B.B.......B.B.',
    '......B.B......',
    'SS...........SS',
    '......B.B......',
    '.B.B.......B.B.',
    '.B.B.B.B.B.B.B.',
    '.B.B.BSB.B.B.B.',
    '.B.B.B.B.B.B.B.',
    '.B.B.B.B.B.B.B.',
    '...............',
  ],
  [
    '.......W.......',
    '.BB..W.W.W..BB.',
    '.B...W.B.W...B.',
    '.....W.B.W.....',
    'BBB..W.B.W..BBB',
    '.....W.B.W.....',
    '..B...B.B...B..',
    '..B.W.....W.B..',
    '..B.W.BBB.W.B..',
    '.....W...W.....',
    '.BB.W..S..W.BB.',
    '.B...W.W.W...B.',
    '.....W...W.....',
    '..T.T.....T.T..',
    '...............',
  ],
  [
    '.S...........S.',
    '.B.BBBBBBBBB.B.',
    '.B.B.......B.B.',
    '.B.B.SSSSS.B.B.',
    '...B.S...S.B...',
    'BB..B.S.S.B..BB',
    '..S...S.S...S..',
    'BB..B.SSS.B..BB',
    '...B.S...S.B...',
    '.B.B.SSSSS.B.B.',
    '.B.B.......B.B.',
    '.B.BBBBBBBBB.B.',
    '.S...........S.',
    '...............',
    '...............',
  ],
  [
    'TT...........TT',
    'TTT.BBBBBBB.TTT',
    'TT..B.....B..TT',
    'T..BB..S..BB..T',
    '...B.......B...',
    '.BBB..T.T..BBB.',
    '..T..BB.BB..T..',
    '.W...B.T.B...W.',
    '..T..BB.BB..T..',
    '.BBB..T.T..BBB.',
    '...B.......B...',
    'T..BB..S..BB..T',
    'TT..B.....B..TT',
    'TTT.BBBBBBB.TTT',
    'TT...........TT',
  ],
  [
    'II.....W.....II',
    'II.B...B...B.II',
    '..B.B.....B.B..',
    'II.B..BBB..B.II',
    'II.B..B.B..B.II',
    '..B..B.B.B..B..',
    'S..B..BBB..B..S',
    '...B..B.B..B...',
    'II.B..BBB..B.II',
    'II.B...B...B.II',
    '..B.B.....B.B..',
    'II.B..SSS..B.II',
    'II.B.......B.II',
    '...SS..S..SS...',
    '.B...........B.',
  ],
  [
    'B..S.......S..B',
    'B.BB.BBBBB.BB.B',
    '..B..B...B..B..',
    'WW.B..B.B..B.WW',
    'W...B.BBB.B...W',
    'W.BB..T.T..BB.W',
    '..B..TTTTT..B..',
    '.W...BB.BB...W.',
    '..B..TTTTT..B..',
    'W.BB..T.T..BB.W',
    'W...B.BBB.B...W',
    'WW.B..B.B..B.WW',
    '..B..B...B..B..',
    'B.BB.BBBBB.BB.B',
    'B..S.......S..B',
  ],
  [
    '.B..B..S..B..B.',
    '.B..B.BBB.B..B.',
    '.BB.B..B..B.BB.',
    '.....BB.BB.....',
    'BSB..B...B..BSB',
    '...BB..B..BB...',
    '.W...BB.BB...W.',
    '...BB..B..BB...',
    'BSB..B...B..BSB',
    '.....BB.BB.....',
    '.BB.B..B..B.BB.',
    '.B..B.BBB.B..B.',
    '.B..B..S..B..B.',
    '...............',
    '...............',
  ],
  [
    'WWWWW..B..WWWWW',
    'W.....B.B.....W',
    'W.BSS.B.B.SSB.W',
    '..B..BB.BB..B..',
    '..B..B...B..B..',
    'BB...B.B.B...BB',
    '.....B.B.B.....',
    'BB...B.B.B...BB',
    '..B..B...B..B..',
    '..B..BB.BB..B..',
    'W.BSS.B.B.SSB.W',
    'W.....B.B.....W',
    'WWWWW..B..WWWWW',
    '...............',
    '...............',
  ],
  [
    'S....B.B.B....S',
    '.BB..B.B.B..BB.',
    '..B..B.B.B..B..',
    '.B.BB.BBB.BB.B.',
    '.B....B.B....B.',
    '.B.BB.B.B.BB.B.',
    '..B..B.B.B..B..',
    'S.B.BB.W.BB.B.S',
    '..B..B.W.B..B..',
    '.B.BB.B.B.BB.B.',
    '.B....B.B....B.',
    '.B.BB.BBB.BB.B.',
    '..B..B.B.B..B..',
    '.BB..B.B.B..BB.',
    'S....B.B.B....S',
  ],
  [
    '.....SSSSS.....',
    '.SSB..B.B..BSS.',
    '..B.BB.B.BB.B..',
    'BB.B...B...B.BB',
    '....BB.B.BB....',
    '.SB.BS.B.SB.BS.',
    '...B..B.B..B...',
    '.SB.B.BBB.B.BS.',
    '...B..B.B..B...',
    '.SB.BS.B.SB.BS.',
    '....BB.B.BB....',
    'BB.B...B...B.BB',
    '..B.BB.B.BB.B..',
    '.SSB..B.B..BSS.',
    '.....SSSSS.....',
  ],
];

const CHAR_TO_TILE = { '.': T.EMPTY, B: T.BRICK, S: T.STEEL, W: T.WATER, T: T.TREE, I: T.ICE };
// fixed spots: eagle centre cell + brick ring + player spawns
export const EAGLE_CELL = { cx: 7, cy: 14 };
const RING_CELLS = [{ cx: 6, cy: 13 }, { cx: 7, cy: 13 }, { cx: 8, cy: 13 }, { cx: 6, cy: 14 }, { cx: 8, cy: 14 }];
export const SPAWNS = {
  players: [{ cx: 5, cy: 14 }, { cx: 9, cy: 14 }],
  enemies: [{ cx: 0, cy: 0 }, { cx: 7, cy: 0 }, { cx: 14, cy: 0 }],
};
export const MAP_COUNT = MAPS.length;
export function stageMap(i) { return MAPS[i % MAPS.length]; }

export function buildLevel(scene, grid, stageIndex) {
  const group = new THREE.Group();
  scene.add(group);
  const level = { group, stage: stageIndex, eagle: null, dispose };

  // ---- ground: one big paper sheet + a pencil frame around the battlefield ----
  const groundMat = makeInkMaterial({ ink: INK.BLACK, fill: true, shadeBias: -0.15 });
  const ground = new THREE.Mesh(new THREE.BoxGeometry(BIG * CELL + 2.4, 0.3, BIG * CELL + 2.4), groundMat);
  ground.position.y = -0.35;
  group.add(ground);
  const frameMat = makeInkMaterial({ ink: INK.BLACK, shadeScale: 0.9 });
  const S = BIG * CELL / 2;
  for (const [w, d, x, z] of [
    [BIG * CELL + 0.5, 0.35, 0, -S - 0.1], [BIG * CELL + 0.5, 0.35, 0, S + 0.1],
    [0.35, BIG * CELL + 0.5, -S - 0.1, 0], [0.35, BIG * CELL + 0.5, S + 0.1, 0],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), frameMat);
    m.position.set(x, 0.05, z);
    group.add(m);
  }

  // ---- shared tile materials ----
  const mats = {
    brick: makeInkMaterial({ ink: INK.ORANGE, shadeScale: 1.1, shadeBias: 0.05 }),
    brickDark: makeInkMaterial({ ink: INK.RED, shadeScale: 0.6, shadeBias: 0.1 }),
    steel: makeInkMaterial({ ink: INK.BLACK, shadeScale: 0.75, shadeBias: 0.2 }),
    steelDark: makeInkMaterial({ ink: INK.BLACK, shadeScale: 0.4, shadeBias: 0.15 }),
    water: makeInkMaterial({ ink: INK.BLUE, fill: true }),
    tree: makeInkMaterial({ ink: INK.GREEN, shadeScale: 0.95 }),
    treeDark: makeInkMaterial({ ink: INK.GREEN, shadeScale: 0.5, shadeBias: 0.1 }),
    ice: makeInkMaterial({ ink: INK.BLUE, fill: true, shadeBias: 0.45 }),
  };
  const bg = (w, h, d, x = 0, y = 0, z = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
  const geos = {
    brick: new THREE.BoxGeometry(0.96, 0.62, 0.96),
    steel: new THREE.BoxGeometry(0.98, 0.74, 0.98),
    water: new THREE.BoxGeometry(1.0, 0.2, 1.0),
    tree: new THREE.BoxGeometry(0.46, 0.8, 0.46),           // trunk
    ice: new THREE.BoxGeometry(0.98, 0.08, 0.98),
    // mortar courses drawn across the top of a brick (reads as laid bricks from up here)
    mortar: mergeGeometries([
      bg(1.0, 0.06, 0.24, 0, 0.315, -0.32),
      bg(1.0, 0.06, 0.24, 0, 0.315, 0.32),
      bg(0.28, 0.06, 0.24, -0.34, 0.315, 0),
    ]),
    // rivets + a brace plate on steel
    rivet: mergeGeometries([
      bg(0.7, 0.05, 0.14, 0, 0.375, 0),
      (() => { const c = new THREE.CylinderGeometry(0.075, 0.075, 0.08, 8); c.translate(-0.32, 0.38, -0.32); return c; })(),
      (() => { const c = new THREE.CylinderGeometry(0.075, 0.075, 0.08, 8); c.translate(0.32, 0.38, -0.32); return c; })(),
      (() => { const c = new THREE.CylinderGeometry(0.075, 0.075, 0.08, 8); c.translate(-0.32, 0.38, 0.32); return c; })(),
      (() => { const c = new THREE.CylinderGeometry(0.075, 0.075, 0.08, 8); c.translate(0.32, 0.38, 0.32); return c; })(),
    ]),
    // little wave strokes floating on the water
    wave: mergeGeometries([
      bg(0.55, 0.05, 0.09, -0.14, 0.13, -0.22),
      bg(0.38, 0.05, 0.09, 0.2, 0.13, 0.24),
    ]),
    // leafy crown crossed over the trunk
    crown: mergeGeometries([
      bg(1.24, 0.52, 0.44, 0, 0.62, 0),
      bg(0.44, 0.52, 1.24, 0, 0.62, 0),
      bg(0.9, 0.4, 0.9, 0, 0.92, 0),
    ]),
  };
  const tileMeshes = new Map();   // half-cell index -> mesh
  const waterAnims = [], treeAnims = [];
  const rnd = (() => { let s = 1234 + stageIndex * 999; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  function placeMesh(hx, hz, t) {
    const key = hz * BIG * 2 + hx;
    const old = tileMeshes.get(key);
    if (old) { group.remove(old); tileMeshes.delete(key); }
    let geo = null, mat = null, y = 0, detail = null;
    if (t === T.BRICK) { geo = geos.brick; mat = mats.brick; y = 0.31; detail = [geos.mortar, mats.brickDark]; }
    else if (t === T.STEEL) { geo = geos.steel; mat = mats.steel; y = 0.37; detail = [geos.rivet, mats.steelDark]; }
    else if (t === T.WATER) { geo = geos.water; mat = mats.water; y = -0.02; detail = [geos.wave, mats.water]; }
    else if (t === T.TREE) { geo = geos.tree; mat = mats.treeDark; y = 0.4; detail = [geos.crown, mats.tree]; }
    else if (t === T.ICE) { geo = geos.ice; mat = mats.ice; y = 0.02; }
    if (!geo) return;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(BOARD_MIN + hx + 0.5, y, BOARD_MIN + hz + 0.5);
    m.userData.t = t;
    if (t === T.BRICK) { m.rotation.y = (rnd() - 0.5) * 0.06; }   // hand-laid, never perfectly straight
    if (detail) { const d = new THREE.Mesh(detail[0], detail[1]); m.add(d); m.userData.detail = d; }
    if (t === T.TREE) {
      m.rotation.y = (rnd() - 0.5) * 0.6;
      m.scale.setScalar(0.92 + rnd() * 0.2);
      treeAnims.push({ mesh: m, phase: rnd() * 6.28 });
    }
    if (t === T.WATER) waterAnims.push({ mesh: m, waves: m.userData.detail, baseY: y, phase: rnd() * 6.28 });
    group.add(m);
    tileMeshes.set(key, m);
  }
  grid.onTile = (hx, hz, old, now) => placeMesh(hx, hz, now);

  // ---- fill tiles from the map ----
  grid.clear();
  const map = stageMap(stageIndex);
  for (let cy = 0; cy < BIG; cy++) for (let cx = 0; cx < BIG; cx++) {
    const t = CHAR_TO_TILE[map[cy][cx]] ?? T.EMPTY;
    if (t === T.EMPTY) continue;
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) grid.set(cx * 2 + dx, cy * 2 + dz, t);
  }
  // forced eagle ring, eagle cell, clear player + enemy spawns (spawn doors are always open,
  // whatever the map drew there — steel or water on a spawn cell would trap the tank)
  for (const { cx, cy } of RING_CELLS) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) grid.set(cx * 2 + dx, cy * 2 + dz, T.BRICK);
  for (const { cx, cy } of SPAWNS.players) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) grid.set(cx * 2 + dx, cy * 2 + dz, T.EMPTY);
  for (const { cx, cy } of SPAWNS.enemies) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) grid.set(cx * 2 + dx, cy * 2 + dz, T.EMPTY);
  for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) grid.set(EAGLE_CELL.cx * 2 + dx, EAGLE_CELL.cy * 2 + dz, T.EAGLE);

  // ---- pencil doodads on the empty paper: grass ticks, pebbles and little flowers ----
  const doodadMat = makeInkMaterial({ ink: INK.BLACK, shadeScale: 0.3, shadeBias: 0.3 });
  const flowerMat = makeInkMaterial({ ink: INK.PINK, shadeScale: 0.5, shadeBias: 0.15 });
  const grassGeo = bg(0.16, 0.035, 0.05);
  const pebbleGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.05, 7);
  const flowerGeo = mergeGeometries([bg(0.3, 0.05, 0.08), bg(0.08, 0.05, 0.3), bg(0.15, 0.14, 0.15)]);
  for (let i = 0; i < 110; i++) {
    const hx = Math.floor(rnd() * BIG * 2), hz = Math.floor(rnd() * BIG * 2);
    if (grid.get(hx, hz) !== T.EMPTY) continue;
    const roll = rnd();
    const d = new THREE.Mesh(roll < 0.62 ? grassGeo : roll < 0.82 ? pebbleGeo : flowerGeo, roll < 0.82 ? doodadMat : flowerMat);
    d.position.set(BOARD_MIN + hx + 0.2 + rnd() * 0.6, 0.02, BOARD_MIN + hz + 0.2 + rnd() * 0.6);
    d.rotation.y = rnd() * Math.PI;
    if (d.geometry === grassGeo) d.rotation.z = (rnd() - 0.5) * 0.5;
    group.add(d);
  }

  // ---- the eagle: a doodled bird on a plinth ----
  const eagle = buildEagle();
  const ec = { x: BOARD_MIN + EAGLE_CELL.cx * CELL + CELL / 2, z: BOARD_MIN + EAGLE_CELL.cy * CELL + CELL / 2 };
  eagle.position.set(ec.x, 0, ec.z);
  group.add(eagle);
  level.eagle = eagle;

  // gentle life: water bobs, trees sway
  level.update = (time) => {
    for (const w of waterAnims) {
      w.mesh.position.y = w.baseY + Math.sin(time * 1.8 + w.phase) * 0.035;
      if (w.waves) w.waves.position.x = Math.sin(time * 0.9 + w.phase) * 0.1;
    }
    for (const t of treeAnims) t.mesh.rotation.z = Math.sin(time * 1.4 + t.phase) * 0.045;
  };

  function dispose() {
    grid.onTile = null;
    scene.remove(group);
    group.traverse((o) => { if (o.geometry && !Object.values(geos).includes(o.geometry)) o.geometry.dispose(); });
    Object.values(geos).forEach((g) => g.dispose());
    grassGeo.dispose(); pebbleGeo.dispose(); doodadMat.dispose(); flowerGeo.dispose(); flowerMat.dispose();
    Object.values(mats).forEach((m) => m.dispose());
    groundMat.dispose(); frameMat.dispose();
    tileMeshes.clear();
    waterAnims.length = treeAnims.length = 0;
  }
  return level;
}

function buildEagle() {
  const g = new THREE.Group();
  const bodyMat = makeInkMaterial({ ink: INK.BLACK, shadeScale: 0.85, shadeBias: 0.1 });
  const redMat = makeInkMaterial({ ink: INK.RED, shadeScale: 1.0 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), bodyMat);
  body.position.y = 0.6;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.5), bodyMat);
  head.position.set(0, 1.1, -0.22);
  const beak = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.3), redMat);
  beak.position.set(0, 1.06, -0.55);
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.95), bodyMat);
  wingL.position.set(-0.52, 0.72, 0.05); wingL.rotation.z = 0.35;
  const wingR = wingL.clone(); wingR.position.x = 0.52; wingR.rotation.z = -0.35;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.45), bodyMat);
  tail.position.set(0, 0.75, 0.6); tail.rotation.x = -0.4;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 1.4), bodyMat);
  plinth.position.y = 0.12;
  g.add(body, head, beak, wingL, wingR, tail, plinth);
  g.userData.wings = [wingL, wingR];
  return g;
}

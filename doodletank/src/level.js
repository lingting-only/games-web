// Stages and level building. A stage is a 13x13 character map (each char = one big cell):
//   '.' empty   'B' brick   'S' steel   'W' water   'T' trees   'I' ice
// The eagle base and its brick ring, plus the two player spawn cells, are forced on every map.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeInkMaterial, INK } from './render.js';
import { Grid, T, BIG, CELL, BOARD_MIN } from './physics.js';

const MAPS = [
  [
    '.............',
    '.B.B.B.B.B.B.',
    '.B.B.B.B.B.B.',
    '.B.B.BSB.B.B.',
    '.B.B.B.B.B.B.',
    '.B.B.....B.B.',
    '......B......',
    'SS.........SS',
    '......B......',
    '.B.B.....B.B.',
    '.B.B.B.B.B.B.',
    '.B.B.B.B.B.B.',
    '.............',
  ],
  [
    '......W......',
    '.BB.W.W.W.BB.',
    '.B..W.B.W..B.',
    '....W.B.W....',
    'BBB.W.B.W.BBB',
    '....W.B.W....',
    '..B...B...B..',
    '..B.W...W.B..',
    '..B.WBBBW.B..',
    '....W...W....',
    '.BB.W...W.BB.',
    '.B.........B.',
    '.............',
  ],
  [
    '.S.........S.',
    '.B.BBBBBBB.B.',
    '.B.B.....B.B.',
    '.B.B.SSS.B.B.',
    '...B.S.S.B...',
    'BB..B.S.B..BB',
    '..S...S...S..',
    'BB..B.S.B..BB',
    '...B.S.S.B...',
    '.B.B.SSS.B.B.',
    '.B.B.....B.B.',
    '.B.BBBBBBB.B.',
    '.S.........S.',
  ],
  [
    'TT.........TT',
    'TTT.BBBBB.TTT',
    'TT..B...B..TT',
    'T..BB...BB..T',
    '...B.....B...',
    '.BBB.....BBB.',
    '..T.......T..',
    '.BBB.....BBB.',
    '...B.....B...',
    'T..BB...BB..T',
    'TT..B...B..TT',
    'TTT.BBBBB.TTT',
    'TT.........TT',
  ],
  [
    'II.......III.',
    'II.B..B..III.',
    '...B..B......',
    'II.B..B..III.',
    'II.B..B..III.',
    '...B..B......',
    'S..B..B....S.',
    '...B..B......',
    'II.BBBB..III.',
    'II.......III.',
    '...SS..SS....',
    '.B........B..',
    '.............',
  ],
  [
    'B..S.....S..B',
    'B.BB.BBB.BB.B',
    '..B..B.B..B..',
    'WW.B..B..B.WW',
    'W...B BBB...W',
    'W.BB.....BB.W',
    '..B..TTT..B..',
    'W.BB.....BB.W',
    'W...B BBB...W',
    'WW.B..B..B.WW',
    '..B..B.B..B..',
    'B.BB.BBB.BB.B',
    'B..S.....S..B',
  ],
  [
    '.B..B...B..B.',
    '.B..B.S.B..B.',
    '.BB.B...B.BB.',
    '....BB.BB....',
    'BSB.......BSB',
    '...BB...BB...',
    '.W...BBB...W.',
    '...BB...BB...',
    'BSB.......BSB',
    '....BB.BB....',
    '.BB.B...B.BB.',
    '.B..B.S.B..B.',
    '.B..B...B..B.',
  ],
  [
    'WWWW..B..WWWW',
    'W.....B.....W',
    'W.BSS.B.SSB.W',
    '..B..BBB..B..',
    '..B..B.B..B..',
    'BB...B.B...BB',
    '.....B.B.....',
    'BB...B.B...BB',
    '..B..B.B..B..',
    '..B..BBB..B..',
    'W.BSS.B.SSB.W',
    'W.....B.....W',
    'WWWW..B..WWWW',
  ],
  [
    'S....B.B....S',
    '.BB..B.B..BB.',
    '.B...B.B...B.',
    '.B.BB...BB.B.',
    '.B....W....B.',
    '..BB.WWW.BB..',
    'S...W...W...S',
    '..BB.WWW.BB..',
    '.B....W....B.',
    '.B.BB...BB.B.',
    '.B...B.B...B.',
    '.BB..B.B..BB.',
    'S....B.B....S',
  ],
  [
    '.....SSS.....',
    '.SSB.....BSS.',
    '..B.BB.BB.B..',
    'BB.B.....B.BB',
    '....BB.BB....',
    '.SB.BSBS.BS..',
    '...B.....B...',
    '.SB.BSBS.BS..',
    '....BB.BB....',
    'BB.B.....B.BB',
    '..B.BB.BB.B..',
    '.SSB.....BSS.',
    '.....SSS.....',
  ],
];

const CHAR_TO_TILE = { '.': T.EMPTY, B: T.BRICK, S: T.STEEL, W: T.WATER, T: T.TREE, I: T.ICE };
// fixed spots: eagle centre cell + brick ring + player spawns
export const EAGLE_CELL = { cx: 6, cy: 12 };
const RING_CELLS = [{ cx: 5, cy: 11 }, { cx: 6, cy: 11 }, { cx: 7, cy: 11 }, { cx: 5, cy: 12 }, { cx: 7, cy: 12 }];
export const SPAWNS = {
  players: [{ cx: 4, cy: 12 }, { cx: 8, cy: 12 }],
  enemies: [{ cx: 0, cy: 0 }, { cx: 6, cy: 0 }, { cx: 12, cy: 0 }],
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
  // forced eagle ring, eagle cell, clear player spawns
  for (const { cx, cy } of RING_CELLS) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) grid.set(cx * 2 + dx, cy * 2 + dz, T.BRICK);
  for (const { cx, cy } of SPAWNS.players) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) grid.set(cx * 2 + dx, cy * 2 + dz, T.EMPTY);
  for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) grid.set(EAGLE_CELL.cx * 2 + dx, EAGLE_CELL.cy * 2 + dz, T.EAGLE);

  // ---- pencil doodads on the empty paper: grass ticks and pebbles ----
  const doodadMat = makeInkMaterial({ ink: INK.BLACK, shadeScale: 0.3, shadeBias: 0.3 });
  const grassGeo = bg(0.16, 0.035, 0.05);
  const pebbleGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.05, 7);
  for (let i = 0; i < 46; i++) {
    const hx = Math.floor(rnd() * BIG * 2), hz = Math.floor(rnd() * BIG * 2);
    if (grid.get(hx, hz) !== T.EMPTY) continue;
    const d = new THREE.Mesh(rnd() < 0.75 ? grassGeo : pebbleGeo, doodadMat);
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
    grassGeo.dispose(); pebbleGeo.dispose(); doodadMat.dispose();
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

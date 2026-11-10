// The whole notebook is the sky now: three times wider in each direction than the first draft.
// Static decoration is collected per ink colour and merged into a handful of meshes (the same
// trick doodleshooter/level.js uses), while the moving bits live in small animated groups.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeInkMaterial, INK } from './render.js';
import { TAU } from './util.js';

export const MAP_SCALE = 3;                 // linear scale: 132 x 132 -> 396 x 396
export const BOUNDS = { x: 66 * MAP_SCALE, z: 66 * MAP_SCALE, minY: 9, maxY: 52 };
const R = BOUNDS.x;

// deterministic decoration so the page looks the same on every reload
let seed = 20261110;
const seeded = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const sr = (a, b) => a + (b - a) * seeded();
const ringPoint = (minR, maxR) => { const a = sr(0, TAU), r = sr(minR, maxR); return { x: Math.cos(a) * r, z: Math.sin(a) * r }; };

export function buildSky(scene, world) {
  seed = 20261110;
  const group = new THREE.Group(); scene.add(group);
  const geos = {}; const mats = []; const animated = [];
  const norm = (g) => (g.index ? g.toNonIndexed() : g);
  const place = (g, x, y, z, rotY = 0, rotZ = 0) => {
    if (rotZ) g.rotateZ(rotZ);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    return norm(g);
  };
  const addGeo = (g, ink = INK.BLUE) => { (geos[ink] || (geos[ink] = [])).push(g); };
  const box = (x, y, z, w, h, d, ink = INK.BLUE, rotY = 0, rotZ = 0) => addGeo(place(new THREE.BoxGeometry(w, h, d), x, y, z, rotY, rotZ), ink);
  const cyl = (x, y, z, r, h, ink = INK.BLUE, seg = 8) => addGeo(place(new THREE.CylinderGeometry(r, r, h, seg), x, y, z), ink);
  const cone = (x, y, z, r, h, ink = INK.BLUE, seg = 4) => addGeo(place(new THREE.ConeGeometry(r, h, seg), x, y, z), ink);
  const torus = (x, y, z, r, t, ink = INK.BLUE, arc = TAU) => addGeo(place(new THREE.TorusGeometry(r, t, 5, 20, arc), x, y, z), ink);
  const ball = (x, y, z, r, ink = INK.BLUE) => addGeo(place(new THREE.SphereGeometry(r, 8, 6), x, y, z), ink);
  const collider = (x, y, z, w, h, d) => world.addBox(
    { x: x - w / 2, y: y - h / 2, z: z - d / 2 },
    { x: x + w / 2, y: y + h / 2, z: z + d / 2 }, {});
  // a pen stroke between two points, drawn as a thin box
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();
  const stroke = (ax, ay, az, bx, by, bz, thick = 0.12, ink = INK.RED) => {
    _a.set(ax, ay, az); _b.set(bx, by, bz);
    _v.subVectors(_b, _a); const len = _v.length();
    if (len < 1e-4) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v.divideScalar(len));
    const g = new THREE.BoxGeometry(thick, len, thick);
    _m.compose(_a.clone().add(_b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(_m); addGeo(norm(g), ink);
  };
  // a group of geometries that all move together
  const makeGroup = (list, ink, x, y, z) => {
    if (!list.length) return null;
    const merged = mergeGeometries(list, false);
    if (!merged) return null;
    const mat = makeInkMaterial({ ink }); mats.push(mat);
    const mesh = new THREE.Mesh(merged, mat);
    const g = new THREE.Group(); g.position.set(x, y, z); g.add(mesh); group.add(g);
    return g;
  };

  // ---------------- the sheet itself ----------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(R * 2.9, R * 2.9), makeInkMaterial({ ink: INK.BLUE, shadeScale: 0.13, shadeBias: 0.87, side: THREE.DoubleSide }));
  mats.push(ground.material); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; group.add(ground);
  const edge = R * 1.18;
  box(0, 0.06, -edge, edge * 2, 0.2, 0.3); box(0, 0.06, edge, edge * 2, 0.2, 0.3);
  box(-edge, 0.06, 0, 0.3, 0.2, edge * 2); box(edge, 0.06, 0, 0.3, 0.2, edge * 2);
  // ruled lines across the page and a column of punched holes down the margin
  for (let z = -edge + 12; z < edge; z += 22) box(0, 0.02, z, edge * 2 - 8, 0.02, 0.07, INK.BLUE);
  for (let z = -edge + 14; z < edge; z += 22) {
    addGeo(place(new THREE.TorusGeometry(1.2, 0.2, 5, 14).rotateX(-Math.PI / 2), -edge + 6, 0.04, z), INK.BLUE);
    addGeo(place(new THREE.CircleGeometry(1.0, 10).rotateX(-Math.PI / 2), -edge + 6, 0.03, z), INK.BLUE);
  }

  // ---------------- loose notebook pages (solid cover) ----------------
  let pages = 0;
  for (let i = 0; i < 18; i++) {
    const p = ringPoint(38, R * 0.92), w = sr(16, 34), d = sr(12, 26), y = sr(6, 22), rot = sr(-0.5, 0.5);
    const local = [];
    const L = (g) => local.push(norm(g));
    const sheet = new THREE.BoxGeometry(w, 0.24, d); L(sheet);
    for (let k = -3; k <= 3; k++) {
      const rule = new THREE.BoxGeometry(w * 0.9, 0.02, 0.06); rule.translate(0, 0.14, k * (d / 8)); L(rule);
    }
    for (const sx of [-w * 0.36, w * 0.36]) { const s = new THREE.BoxGeometry(1.4, 0.16, 0.5); s.translate(sx, 0.2, -d * 0.42); L(s); }
    const g = makeGroup(local, INK.BLUE, p.x, y, p.z); if (g) g.rotation.y = rot;
    addGeo(place(new THREE.BoxGeometry(0.14, 3.2, 0.14), p.x + w * 0.3 * Math.cos(rot), y + 0.2, p.z - w * 0.3 * Math.sin(rot)), INK.RED);
    addGeo(place(new THREE.BoxGeometry(0.14, 1.8, 0.14), p.x + (w * 0.3 - 0.8) * Math.cos(rot), y + 0.2, p.z - (w * 0.3 - 0.8) * Math.sin(rot) + 0.9), INK.RED);
    collider(p.x, y, p.z, w + 3, 0.8, d + 3);
    pages++;
  }

  // ---------------- ruler bridges ----------------
  const RULES = [
    { x: 0, z: -80, y: 15, len: 170, rot: 0 },
    { x: 110, z: 70, y: 22, len: 130, rot: Math.PI / 2 },
    { x: -115, z: -35, y: 12, len: 110, rot: 0.42 },
  ];
  for (const rr of RULES) {
    const c = Math.cos(rr.rot), s = Math.sin(rr.rot);
    box(rr.x, rr.y, rr.z, rr.len, 0.6, 3.4, INK.BLACK, rr.rot);
    for (let i = -rr.len / 2 + 2; i < rr.len / 2; i += 3.2) {
      const long = Math.round(i) % 16 === 0;
      const lx = rr.x + i * c, lz = rr.z - i * s;
      const tick = new THREE.BoxGeometry(0.1, 0.08, long ? 2 : 1.1);
      addGeo(place(tick, lx, rr.y + 0.34, lz + 1.1 * c, rr.rot), INK.RED);
    }
    const hx = Math.abs(c) * rr.len / 2 + Math.abs(s) * 1.7;
    const hz = Math.abs(s) * rr.len / 2 + Math.abs(c) * 1.7;
    collider(rr.x, rr.y, rr.z, hx * 2, 0.9, hz * 2);
  }

  // ---------------- crumpled paper clouds, in three drifting layers ----------------
  let clouds = 0;
  for (let layer = 0; layer < 3; layer++) {
    const local = [];
    for (let i = 0; i < 18; i++) {
      const p = ringPoint(24, R * 0.95);
      const r = sr(2.6, 8.2);
      const g = new THREE.IcosahedronGeometry(r, 0);
      g.scale(1, sr(0.6, 0.95), sr(0.8, 1.3));
      g.rotateY(sr(0, TAU));
      g.translate(p.x - 0, sr(0, 2), p.z - 0);
      local.push(norm(g)); clouds++;
    }
    const g = makeGroup(local, INK.BLUE, 0, 16 + layer * 13, 0);
    if (g) animated.push({ obj: g, kind: 'cloud', base: g.position.clone(), phase: layer * 2.1, speed: 0.18 + layer * 0.05 });
  }

  // ---------------- paper pinwheels ----------------
  for (let i = 0; i < 5; i++) {
    const p = ringPoint(55, R * 0.85), h = sr(20, 34);
    const blades = [];
    for (let k = 0; k < 4; k++) {
      const b = new THREE.BoxGeometry(0.16, sr(5, 7), 2);
      b.translate(0, 3, 0); b.rotateZ(k * Math.PI / 2); blades.push(norm(b));
    }
    const g = makeGroup(blades, i % 2 ? INK.ORANGE : INK.GREEN, p.x, h, p.z);
    if (g) animated.push({ obj: g, kind: 'spin', speed: (i % 2 ? 0.6 : -0.45) });
    box(p.x, h / 2, p.z, 0.28, h, 0.28, INK.BLACK);
    ball(p.x, h, p.z, 0.5, INK.RED);
  }

  // ---------------- pencil towers ----------------
  for (let i = 0; i < 7; i++) {
    const p = ringPoint(45, R * 0.9), h = sr(12, 26);
    cyl(p.x, h / 2, p.z, 1.15, h, INK.ORANGE, 6);
    cone(p.x, h + 2, p.z, 1.15, 4, INK.BLACK, 6);
    cyl(p.x, 1.1, p.z, 1.25, 2.2, INK.PINK, 6);
    for (let k = 0; k < 3; k++) box(p.x, 1.5 + k * 2.2, p.z, 2.4, 0.12, 2.4, INK.RED);
    collider(p.x, h / 2, p.z, 2.6, h + 4, 2.6);
  }

  // ---------------- paperclip arches ----------------
  for (let i = 0; i < 5; i++) {
    const p = ringPoint(40, R * 0.85), r = sr(7, 12);
    const arc = new THREE.TorusGeometry(r, 0.45, 5, 20, Math.PI);
    arc.rotateZ(0); addGeo(place(arc, p.x, r, p.z), INK.BLUE);
    box(p.x - r, r / 2, p.z, 0.5, r, 0.5, INK.BLUE);
    box(p.x + r, r / 2, p.z, 0.5, r, 0.5, INK.BLUE);
    const inner = new THREE.TorusGeometry(r * 0.72, 0.35, 5, 20, Math.PI);
    addGeo(place(inner, p.x, r * 0.86, p.z), INK.BLACK);
  }

  // ---------------- erasers, ink bottles, folded mountains ----------------
  for (let i = 0; i < 9; i++) {
    const p = ringPoint(35, R * 0.92), w = sr(6, 11);
    box(p.x, 1.5, p.z, w, 3, w * 0.7, INK.PINK, sr(-0.6, 0.6));
    box(p.x, 3.05, p.z, w * 0.6, 0.12, w * 0.5, INK.BLUE, sr(-0.6, 0.6));
    collider(p.x, 1.5, p.z, w + 2, 3.4, w + 2);
  }
  for (let i = 0; i < 6; i++) {
    const p = ringPoint(40, R * 0.9);
    cyl(p.x, 2.6, p.z, 2.6, 5.2, INK.BLUE, 10);
    cyl(p.x, 5.4, p.z, 1.5, 1.2, INK.BLACK, 10);
    ball(p.x + 3.4, 0.4, p.z + 1.2, 0.9, INK.RED);
    collider(p.x, 2.8, p.z, 5.6, 5.8, 5.6);
  }
  for (let i = 0; i < 8; i++) {
    const p = ringPoint(60, R * 0.95), h = sr(10, 22), r = sr(8, 15);
    cone(p.x, h / 2, p.z, r, h, INK.BLACK, 4);
    cone(p.x - r * 0.6, h * 0.3, p.z + r * 0.5, r * 0.6, h * 0.65, INK.BLUE, 4);
    collider(p.x, h / 2, p.z, r * 1.6, h, r * 1.6);
  }

  // ---------------- sticky-note squares (gently swaying) ----------------
  for (let i = 0; i < 6; i++) {
    const p = ringPoint(45, R * 0.85), y = sr(12, 34);
    const local = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const g = new THREE.BoxGeometry(2.6, 0.16, 2.6);
      g.translate((c - 1) * 3.1, 0, (r - 1) * 3.1);
      local.push(norm(g));
    }
    const g = makeGroup(local, [INK.ORANGE, INK.GREEN, INK.PINK][i % 3], p.x, y, p.z);
    if (g) { g.rotation.x = Math.PI / 2; animated.push({ obj: g, kind: 'sway', phase: i * 1.3, speed: 0.7 }); }
  }

  // ---------------- red-pen annotations on the paper ----------------
  for (let i = 0; i < 14; i++) {
    const p = ringPoint(28, R * 0.9), k = i % 4;
    if (k === 0) { // a tick
      stroke(p.x - 3, 0.15, p.z + 2, p.x - 0.5, 0.15, p.z - 2, 0.24);
      stroke(p.x - 0.5, 0.15, p.z - 2, p.x + 4, 0.15, p.z + 3, 0.24);
    } else if (k === 1) { // an underlined squiggle
      for (let s = 0; s < 5; s++) stroke(p.x - 5 + s * 2.2, 0.15, p.z + Math.sin(s) * 0.8, p.x - 3.5 + s * 2.2, 0.15, p.z - Math.sin(s) * 0.8, 0.2);
    } else if (k === 2) { // a circled note
      addGeo(place(new THREE.TorusGeometry(3.2, 0.18, 5, 20).rotateX(-Math.PI / 2), p.x, 0.15, p.z), INK.RED);
      ball(p.x, 0.15, p.z, 0.5, INK.RED);
    } else { // a star
      for (let s = 0; s < 5; s++) {
        const a = (s / 5) * TAU;
        stroke(p.x, 0.15, p.z, p.x + Math.cos(a) * 4, 0.15, p.z + Math.sin(a) * 4, 0.18);
      }
    }
  }

  // ---------------- dotted flight routes and paper-crane formations ----------------
  for (let i = 0; i < 4; i++) {
    const radius = 55 + i * 32, local = [];
    for (let k = 0; k < 46; k++) {
      const a = (k / 46) * TAU;
      const g = new THREE.BoxGeometry(0.7, 0.7, 0.7);
      g.translate(Math.cos(a) * radius, Math.sin(a * 3 + i) * 2.5, Math.sin(a) * radius * 0.82);
      local.push(norm(g));
    }
    const g = makeGroup(local, INK.ORANGE, 0, 24 + i * 6, 0);
    if (g) animated.push({ obj: g, kind: 'route', speed: i % 2 ? -1 : 1 });
  }
  {
    const local = [];
    for (let f = 0; f < 4; f++) for (let k = 0; k < 5; k++) {
      const g = new THREE.ConeGeometry(1.6, 4.5, 3); g.rotateX(Math.PI / 2);
      g.translate((f - 2) * 60 + k * 7, Math.sin(k + f) * 3, (k - 2) * 9 + f * 13);
      local.push(norm(g));
    }
    const g = makeGroup(local, INK.RED, 0, 44, 0);
    if (g) animated.push({ obj: g, kind: 'formation', base: g.position.clone(), phase: 0, speed: 0.6 });
  }

  // ---------------- the sun, boundary pins and marker flags ----------------
  const sx = -R * 0.82, sz = -R * 0.82, sy = 66;
  torus(sx, sy, sz, 13, 0.4, INK.RED);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    stroke(sx + Math.cos(a) * 15, sy + Math.sin(a) * 15, sz, sx + Math.cos(a) * 18, sy + Math.sin(a) * 18, sz, 0.22, INK.RED);
  }
  for (const [x, z] of [[-R, -R], [R, -R], [-R, R], [R, R]]) {
    cyl(x, 1.2, z, 0.5, 2.4, INK.RED, 8);
    ball(x, 2.8, z, 1.1, INK.RED);
  }
  for (const [x, z] of [[0, -R], [0, R], [-R, 0], [R, 0]]) {
    box(x, 5, z, 0.3, 10, 0.3, INK.BLACK);
    box(x + 3.5, 9, z, 7, 3.5, 0.12, INK.ORANGE);
    stroke(x, 9, z, x + 7, 9, z, 0.1, INK.RED);
  }

  // ---------------- merge static geometry into one mesh per ink ----------------
  let staticMeshes = 0;
  for (const ink in geos) {
    const list = geos[ink];
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const mat = makeInkMaterial({ ink: Number(ink) }); mats.push(mat);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.matrixAutoUpdate = false; group.add(mesh); staticMeshes++;
  }
  world.finalize();

  const spawns = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    spawns.push(new THREE.Vector3(Math.cos(a) * 95, 20 + (i % 4) * 3, Math.sin(a) * 95));
  }

  return {
    group, spawns,
    stats: { bounds: BOUNDS, staticMeshes, animated: animated.length, pages, clouds, colliders: world.boxes.length },
    update(dt, t) {
      for (const a of animated) {
        if (a.kind === 'spin') a.obj.rotation.z += dt * a.speed;
        else if (a.kind === 'route') a.obj.rotation.y += dt * 0.012 * a.speed;
        else if (a.kind === 'sway') a.obj.rotation.z = Math.sin(t * a.speed + a.phase) * 0.06;
        else if (a.kind === 'formation') { a.obj.position.y = a.base.y + Math.sin(t * 0.5) * 2.5; a.obj.rotation.y += dt * 0.03; }
        else {
          a.obj.position.x = a.base.x + Math.sin(t * a.speed + a.phase) * 3.2;
          a.obj.position.y = a.base.y + Math.sin(t * a.speed * 1.7 + a.phase) * 1.1;
        }
      }
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of mats) m.dispose();
    },
  };
}

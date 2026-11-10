// The notebook board: hand-drawn grid, blue ballpoint O and red pen X as instanced meshes,
// four kinds of power-up marks, the last-move ring and a big red tick for the win.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeInkMaterial, INK } from './render.js';
import { N, N_CELLS, POWER, POWER_INFO, idx } from './rules.js';

export const CELL = 2.2;
export const HALF = (N - 1) * CELL / 2;
export const cellToWorld = (c, r) => [(c - (N - 1) / 2) * CELL, (r - (N - 1) / 2) * CELL];
export const worldToCell = (x, z) => [Math.round(x / CELL + (N - 1) / 2), Math.round(z / CELL + (N - 1) / 2)];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const jitter = (i) => { const v = Math.sin(i * 12.9898) * 43758.5453; return v - Math.floor(v); };
const flat = (g) => (g.index ? g.toNonIndexed() : g);

function put(mesh, n, i, y, scale = 1) {
  const [x, z] = cellToWorld(i % N, (i / N) | 0);
  _q.setFromAxisAngle(_up, (jitter(i) - 0.5) * 0.22);
  _p.set(x, y, z);
  const sc = scale * (0.95 + jitter(i + 91) * 0.09);
  _s.set(sc, 1, sc);
  _m.compose(_p, _q, _s);
  mesh.setMatrixAt(n, _m);
}
function hide(mesh, n) {
  _m.makeScale(0, 0, 0); mesh.setMatrixAt(n, _m);
}

export class Board {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.mats = []; this.geos = [];
    const mat = (o) => { const m = makeInkMaterial(o); this.mats.push(m); return m; };
    const mesh = (g, m) => { const o = new THREE.Mesh(g, m); o.matrixAutoUpdate = false; this.geos.push(g); this.group.add(o); return o; };

    // The ruled grid and outer frame are printed by the post-pass (see render.js) so they stay
    // crisp and complete at any viewport size. Only discrete board ornaments live in the scene.
    // binding holes down the left margin
    const holes = [];
    for (let r = 1; r < N; r += 3) {
      const [, z] = cellToWorld(0, r);
      holes.push(flat(new THREE.TorusGeometry(0.32, 0.09, 5, 12).rotateX(-Math.PI / 2).translate(-HALF - 2.1, 0.04, z)));
    }
    mesh(mergeGeometries(holes, false), mat({ ink: INK.BLACK }));
    const stars = [];
    for (const [c, r] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) {
      const [x, z] = cellToWorld(c, r);
      stars.push(flat(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 8).translate(x, 0.05, z)));
    }
    mesh(mergeGeometries(stars, false), mat({ ink: INK.BLACK }));

    // O: two slightly offset rings, like a ballpoint circle drawn twice
    const o1 = flat(new THREE.TorusGeometry(0.70, 0.072, 5, 20).rotateX(-Math.PI / 2));
    const o2 = flat(new THREE.TorusGeometry(0.77, 0.042, 5, 20).rotateX(-Math.PI / 2).translate(0.035, 0.02, 0.02));
    this.oGeo = mergeGeometries([o1, o2], false);
    this.x1 = flat(new THREE.BoxGeometry(1.85, 0.14, 0.15).rotateY(Math.PI / 4));
    this.x2 = flat(new THREE.BoxGeometry(1.85, 0.14, 0.15).rotateY(-Math.PI / 4).translate(0.03, 0.015, 0));
    this.xGeo = mergeGeometries([this.x1, this.x2], false);
    this.o = new THREE.InstancedMesh(this.oGeo, mat({ ink: INK.BLUE }), N_CELLS);
    this.x = new THREE.InstancedMesh(this.xGeo, mat({ ink: INK.RED }), N_CELLS);
    for (const m of [this.o, this.x]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false;
      this.group.add(m); this.geos.push(m.geometry);
    }

    // power-up marks: one instanced mesh per kind (colour is a uniform on the ink shader)
    const powerGeo = {
      [POWER.BOMB]: flat(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 8)),
      [POWER.ERASER]: flat(new THREE.BoxGeometry(0.42, 0.05, 0.42)),
      [POWER.FLASH]: flat(new THREE.ConeGeometry(0.3, 0.08, 3)),
      [POWER.FREEZE]: flat(new THREE.TorusGeometry(0.27, 0.055, 4, 12).rotateX(-Math.PI / 2)),
    };
    this.power = {};
    for (const p of [POWER.BOMB, POWER.ERASER, POWER.FLASH, POWER.FREEZE]) {
      const m = new THREE.InstancedMesh(powerGeo[p], mat({ ink: POWER_INFO[p].ink }), 64);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false;
      this.group.add(m); this.geos.push(m.geometry);
      this.power[p] = m;
    }

    this.lastRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.055, 4, 22).rotateX(-Math.PI / 2), mat({ ink: INK.ORANGE }));
    this.group.add(this.lastRing); this.geos.push(this.lastRing.geometry);
    this.lastRing.visible = false;
    this.winRing = new THREE.InstancedMesh(
      new THREE.TorusGeometry(0.9, 0.075, 4, 20).rotateX(-Math.PI / 2), mat({ ink: INK.ORANGE }), 8);
    this.winRing.frustumCulled = false; this.winRing.visible = false;
    this.group.add(this.winRing); this.geos.push(this.winRing.geometry);

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-9, 1.5, 5), new THREE.Vector3(-3, 1.5, 9),
      new THREE.Vector3(1, 1.5, 1), new THREE.Vector3(10, 1.5, -8),
    ]);
    this.tick = mesh(new THREE.TubeGeometry(curve, 40, 0.42, 6, false), mat({ ink: INK.RED }));
    this.tick.visible = false;
  }

  sync(state) {
    let no = 0, nx = 0;
    const counts = { [POWER.BOMB]: 0, [POWER.ERASER]: 0, [POWER.FLASH]: 0, [POWER.FREEZE]: 0 };
    for (let i = 0; i < N_CELLS; i++) {
      const v = state.board[i], p = state.powers[i];
      if (v === 1) put(this.o, no++, i, 0.12);
      if (v === 2) put(this.x, nx++, i, 0.12);
      if (p && counts[p] < 64) put(this.power[p], counts[p]++, i, 0.055);
    }
    for (let i = no; i < N_CELLS; i++) hide(this.o, i);
    for (let i = nx; i < N_CELLS; i++) hide(this.x, i);
    for (const p of [POWER.BOMB, POWER.ERASER, POWER.FLASH, POWER.FREEZE]) {
      for (let i = counts[p]; i < 64; i++) hide(this.power[p], i);
      this.power[p].instanceMatrix.needsUpdate = true;
    }
    this.o.instanceMatrix.needsUpdate = true; this.x.instanceMatrix.needsUpdate = true;

    if (state.last >= 0 && !state.winner) {
      const [x, z] = cellToWorld(state.last % N, (state.last / N) | 0);
      this.lastRing.position.set(x, 0.09, z); this.lastRing.visible = true;
    } else this.lastRing.visible = false;

    if (state.winner === 1 || state.winner === 2) {
      this.tick.visible = true; this.winRing.visible = true;
      state.winLine.slice(0, 8).forEach((i, k) => put(this.winRing, k, i, 0.16));
      for (let k = state.winLine.length; k < 8; k++) hide(this.winRing, k);
      this.winRing.instanceMatrix.needsUpdate = true;
    } else { this.tick.visible = false; this.winRing.visible = false; }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

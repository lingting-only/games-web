// The notebook page as a cell grid, plus its ink rendering. Territory and unfinished lines are
// two InstancedMeshes (one instance per cell), so a claim only has to touch the cells it changed.
import * as THREE from 'three';
import { makeInkMaterial, INK } from './render.js';
import { clamp } from './util.js';
import { encodeGrid, decodeGrid } from './rules.js';

export const GW = 96, GH = 64, CELL = 1;
export const HALF_W = (GW * CELL) / 2, HALF_H = (GH * CELL) / 2;
export const N_CELLS = GW * GH;
export const PLAYER_INKS = [INK.BLUE, INK.BLUE, INK.RED, INK.GREEN, INK.ORANGE];
export const colorHex = (pid) => ['#1a30c0', '#1a30c0', '#d02030', '#2b8a4b', '#e8801a'][pid] || '#1a30c0';

export const cellIndex = (cx, cy) => cy * GW + cx;
export const worldToCell = (x, z) => [clamp(Math.floor((x + HALF_W) / CELL), 0, GW - 1), clamp(Math.floor((z + HALF_H) / CELL), 0, GH - 1)];
export const cellToWorld = (cx, cy) => [(cx + 0.5) * CELL - HALF_W, (cy + 0.5) * CELL - HALF_H];

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();

class BoardView {
  constructor(scene) {
    this.mats = [];
    const terrMat = makeInkMaterial({ fill: true, side: THREE.DoubleSide }); this.mats.push(terrMat);
    const lineMat = makeInkMaterial({ ink: INK.BLUE, side: THREE.DoubleSide }); this.mats.push(lineMat);
    const tg = new THREE.PlaneGeometry(CELL * 0.99, CELL * 0.99); tg.rotateX(-Math.PI / 2);
    const lg = new THREE.BoxGeometry(CELL * 0.6, 0.16, CELL * 0.6);
    this.terr = new THREE.InstancedMesh(tg, terrMat, N_CELLS);
    this.line = new THREE.InstancedMesh(lg, lineMat, N_CELLS);
    for (const mesh of [this.terr, this.line]) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N_CELLS * 3), 3);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    // a blue pen rectangle marks the edge of the playable page
    const edgeMat = makeInkMaterial({ ink: INK.BLUE }); this.mats.push(edgeMat);
    const edges = new THREE.Group();
    for (const [x, z, w, d] of [[0, -HALF_H, GW * CELL, 0.2], [0, HALF_H, GW * CELL, 0.2], [-HALF_W, 0, 0.2, GH * CELL], [HALF_W, 0, 0.2, GH * CELL]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), edgeMat);
      b.position.set(x, 0.1, z); edges.add(b);
    }
    scene.add(edges); this.edges = edges;
    this.initMatrices();
  }
  initMatrices() {
    _s.setScalar(0);
    for (let i = 0; i < N_CELLS; i++) {
      const [x, z] = cellToWorld(i % GW, (i / GW) | 0);
      _m.compose(_p.set(x, 0, z), _q, _s);
      this.terr.setMatrixAt(i, _m); this.line.setMatrixAt(i, _m);
    }
    this.terr.count = N_CELLS; this.line.count = N_CELLS;
    this.terr.instanceMatrix.needsUpdate = true; this.line.instanceMatrix.needsUpdate = true;
  }
  flush(board, dirty) {
    const tc = this.terr.instanceColor.array, lc = this.line.instanceColor.array;
    for (const i of dirty) {
      const [x, z] = cellToWorld(i % GW, (i / GW) | 0);
      const o = board.owner[i], t = board.trail[i];
      _m.compose(_p.set(x, 0.02, z), _q, _s.set(o ? 1 : 0, o ? 1 : 0, o ? 1 : 0));
      this.terr.setMatrixAt(i, _m);
      tc[i * 3] = PLAYER_INKS[o] ?? INK.BLUE; tc[i * 3 + 1] = 1; tc[i * 3 + 2] = 0;
      _m.compose(_p.set(x, 0.16, z), _q, _s.set(t ? 1 : 0, t ? 1 : 0, t ? 1 : 0));
      this.line.setMatrixAt(i, _m);
      lc[i * 3] = PLAYER_INKS[t] ?? INK.BLUE; lc[i * 3 + 1] = t ? 1 : 0; lc[i * 3 + 2] = 0;
    }
    this.terr.instanceMatrix.needsUpdate = true; this.line.instanceMatrix.needsUpdate = true;
    this.terr.instanceColor.needsUpdate = true; this.line.instanceColor.needsUpdate = true;
  }
  dispose() {
    this.terr.geometry.dispose(); this.line.geometry.dispose();
    for (const m of this.mats) m.dispose();
    for (const mesh of [this.terr, this.line, this.edges]) mesh.parent?.remove(mesh);
  }
}

export class Board {
  constructor(scene) {
    this.owner = new Uint8Array(N_CELLS);
    this.trail = new Uint8Array(N_CELLS);
    this.blocked = new Uint8Array(N_CELLS);
    this.players = 0;
    this.dirty = new Set();
    this.view = new BoardView(scene);
  }
  reset(players, blocked = null) {
    this.owner.fill(0); this.trail.fill(0);
    if (blocked) this.blocked.set(blocked); else this.blocked.fill(0);
    this.players = players;
    for (let i = 0; i < N_CELLS; i++) this.dirty.add(i);
    this.flush();
  }
  setOwner(i, pid) { if (this.owner[i] !== pid) { this.owner[i] = pid; this.dirty.add(i); } }
  setTrail(i, pid) { if (this.trail[i] !== pid) { this.trail[i] = pid; this.dirty.add(i); } }
  clearTrail(pid) {
    for (let i = 0; i < N_CELLS; i++) if (this.trail[i] === pid) this.setTrail(i, 0);
  }
  paintTerritory(pid, cx, cy, radius = 3) {
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      this.setOwner(cellIndex(x, y), pid);
    }
  }
  applyEvents(events) {
    for (const e of events) {
      if (e.t === 'trail') for (const i of e.cells) this.setTrail(i, e.pid);
      else if (e.t === 'claim') for (const i of e.cells) { this.setOwner(i, e.pid); if (this.trail[i] === e.pid) this.setTrail(i, 0); }
      else if (e.t === 'cut') this.clearTrail(e.victim);
      else if (e.t === 'owner') for (const i of e.cells) this.setOwner(i, e.pid);
    }
  }
  encodeFull() {
    return { o: encodeGrid(this.owner), t: encodeGrid(this.trail), b: encodeGrid(this.blocked) };
  }
  applyFull(f) {
    decodeGrid(f.o, N_CELLS, this.owner);
    decodeGrid(f.t, N_CELLS, this.trail);
    decodeGrid(f.b, N_CELLS, this.blocked);
    for (let i = 0; i < N_CELLS; i++) this.dirty.add(i);
    this.flush();
  }
  flush() { this.view.flush(this, this.dirty); this.dirty.clear(); }
  dispose() { this.view.dispose(); }
}

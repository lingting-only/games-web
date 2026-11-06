// Power-ups: the six classic drops, drawn as little floating ink doodles. When a flashing
// carrier is destroyed one of these appears somewhere on the board and blinks until picked
// up (or until it fades). Grenade/shovel/timer affect the whole board; star/helmet/tank the taker.
import * as THREE from 'three';
import { makeInkMaterial, INK } from './render.js';
import { T, BOARD_MIN, HALF_N } from './physics.js';
import { rand } from './util.js';

export const POWERS = ['star', 'grenade', 'helmet', 'shovel', 'tank', 'timer', 'rapid', 'spread', 'pierce'];
const LIFE = 14;

function buildMesh(kind) {
  const g = new THREE.Group();
  const mat = makeInkMaterial({ ink: INK.ORANGE, shadeScale: 1.0 });
  const dark = makeInkMaterial({ ink: INK.BLACK, shadeScale: 0.6 });
  const add = (geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; };
  switch (kind) {
    case 'star': {
      // star = two crossed bars plus a top spike
      add(new THREE.BoxGeometry(1.0, 0.22, 0.22), mat, 0, 0.5);
      add(new THREE.BoxGeometry(0.22, 1.0, 0.22), mat, 0, 0.5);
      add(new THREE.BoxGeometry(0.22, 0.22, 0.22), mat, 0, 1.0);
      break;
    }
    case 'grenade': {
      add(new THREE.SphereGeometry(0.42, 10, 8), dark, 0, 0.5);
      add(new THREE.BoxGeometry(0.18, 0.3, 0.18), mat, 0.15, 0.95);
      break;
    }
    case 'helmet': {
      add(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat, 0, 0.35);
      add(new THREE.BoxGeometry(1.0, 0.12, 1.0), dark, 0, 0.35);
      break;
    }
    case 'shovel': {
      add(new THREE.BoxGeometry(0.14, 1.0, 0.14), dark, 0, 0.5);
      add(new THREE.BoxGeometry(0.5, 0.55, 0.1), mat, 0, 0.9, 0, 0.2);
      break;
    }
    case 'tank': {
      add(new THREE.BoxGeometry(0.7, 0.3, 0.8), mat, 0, 0.4);
      add(new THREE.BoxGeometry(0.16, 0.16, 0.6), dark, 0, 0.55, -0.3);
      break;
    }
    case 'timer': {
      add(new THREE.CylinderGeometry(0.45, 0.45, 0.16, 14), mat, 0, 0.55, 0, Math.PI / 2);
      add(new THREE.BoxGeometry(0.08, 0.3, 0.06), dark, 0, 0.55, 0.1, 0, 0, 0.6);
      break;
    }
    case 'rapid': {   // 闪电：速射
      add(new THREE.BoxGeometry(0.5, 0.16, 0.16), mat, -0.12, 0.5, 0, 0, 0.4, 0);
      add(new THREE.BoxGeometry(0.5, 0.16, 0.16), mat, 0.12, 0.66, 0, 0, 0, -0.4);
      break;
    }
    case 'spread': {  // 三道散射弹幕
      add(new THREE.BoxGeometry(0.7, 0.15, 0.13), mat, 0, 0.42, -0.22, 0, 0.5, 0);
      add(new THREE.BoxGeometry(0.85, 0.15, 0.13), mat, 0, 0.45, 0);
      add(new THREE.BoxGeometry(0.7, 0.15, 0.13), mat, 0, 0.42, 0.22, 0, -0.5, 0);
      break;
    }
    case 'pierce': {  // 穿甲箭头
      add(new THREE.BoxGeometry(0.14, 0.14, 0.9), dark, 0, 0.5, 0.1);
      add(new THREE.BoxGeometry(0.42, 0.16, 0.32), mat, 0, 0.5, -0.4);
      break;
    }
  }
  g.userData.mat = mat;
  return g;
}

export class PowerupManager {
  constructor(scene, grid) {
    this.scene = scene; this.grid = grid;
    this.list = [];
    this.shovelT = 0;
    this._saved = null;
  }
  reset() {
    for (const p of this.list) this.remove(p);
    this.list.length = 0;
    this.shovelT = 0;
  }
  remove(p) {
    this.scene.remove(p.mesh);
    p.mesh.userData.mat.dispose();
  }
  spawn(kind = null, at = null) {
    kind = kind || POWERS[Math.floor(rand(0, POWERS.length))];
    let x = at?.x, z = at?.z;
    if (x === undefined) {
      for (let tries = 0; tries < 40; tries++) {
        const hx = Math.floor(rand(1, HALF_N - 1)), hz = Math.floor(rand(1, HALF_N - 3));
        const t = this.grid.get(hx, hz);
        if (t === T.EMPTY || t === T.TREE || t === T.ICE) { x = BOARD_MIN + hx + 0.5; z = BOARD_MIN + hz + 0.5; break; }
      }
      if (x === undefined) return;
    }
    const mesh = buildMesh(kind);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    const p = { kind, x, z, t: 0, mesh, id: 'p' + (this._nid = (this._nid || 0) + 1) };
    this.list.push(p);
    return p;
  }
  update(dt, time, tanks, onPickup) {
    if (this.shovelT > 0) {
      this.shovelT -= dt;
      if (this.shovelT <= 0) this.restoreBase();
    }
    for (const p of [...this.list]) {
      p.t += dt;
      p.mesh.rotation.y = time * 2.4;
      p.mesh.position.y = 0.08 + Math.sin(time * 4 + p.x) * 0.07;
      p.mesh.visible = p.t > LIFE - 3 ? Math.floor(time * 8) % 2 === 0 : true;
      if (p.t >= LIFE) { this.remove(p); this.list.splice(this.list.indexOf(p), 1); continue; }
      for (const t of tanks) {
        if (!t.alive) continue;
        if (Math.abs(t.x - p.x) < 1.1 && Math.abs(t.z - p.z) < 1.1) {
          this.remove(p);
          this.list.splice(this.list.indexOf(p), 1);
          onPickup && onPickup(p, t);
          break;
        }
      }
    }
  }
  // shovel: base ring turns to steel for a while, then crumbles back to brick
  fortifyBase(ringCells, setCell) {
    this.shovelT = 14;
    if (!this._saved) this._saved = ringCells;
    for (const c of ringCells) setCell(c.hx, c.hz, T.STEEL);
  }
  restoreBase() {
    if (!this._saved) return;
    for (const c of this._saved) if (this.grid.get(c.hx, c.hz) === T.STEEL) this.grid.set(c.hx, c.hz, T.BRICK);
    this._saved = null;
    this.shovelT = 0;
  }
  serialize() { return this.list.map((p) => ({ i: p.id, k: p.kind, x: +p.x.toFixed(2), z: +p.z.toFixed(2), t: +p.t.toFixed(1) })); }
  applySnap(scene, snap) {
    const seen = new Set();
    for (const s of snap) {
      seen.add(s.i);
      let p = this.list.find((q) => q.id === s.i);
      if (!p) {
        const mesh = buildMesh(s.k);
        mesh.position.set(s.x, 0, s.z);
        this.scene.add(mesh);
        p = { kind: s.k, x: s.x, z: s.z, t: s.t, mesh, id: s.i };
        this.list.push(p);
      } else { p.t = s.t; }
    }
    for (const p of [...this.list]) if (!seen.has(p.id)) { this.remove(p); this.list.splice(this.list.indexOf(p), 1); }
  }
}

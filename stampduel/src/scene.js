// Hand-drawn paper battlefield: three ruled lanes, two inkwell forts, and one InstancedMesh per
// stamp type. Instance colours carry the team ink id, so a single mesh can draw both armies.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeInkMaterial, INK } from './render.js';
import { LANES, BASE_X, FIELD_HALF } from './rules.js';
import { UNIT_LIST, UNITS } from './units.js';

const MAX_UNITS = 96, MAX_SHOTS = 128;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const jitter = (i) => { const v = Math.sin(i * 12.9898) * 43758.5453; return v - Math.floor(v); };
const flat = (g) => (g.index ? g.toNonIndexed() : g);
const hide = (mesh, n) => { _m.makeScale(0, 0, 0); mesh.setMatrixAt(n, _m); };

function unitGeometry(type) {
  if (type === 'pencil') {
    const shaft = flat(new THREE.BoxGeometry(1.35, 0.32, 0.32));
    const tip = flat(new THREE.ConeGeometry(0.23, 0.55, 5).rotateZ(-Math.PI / 2).translate(0.92, 0, 0));
    return mergeGeometries([shaft, tip], false);
  }
  if (type === 'clip') {
    const ring = flat(new THREE.TorusGeometry(0.52, 0.13, 4, 12).rotateX(-Math.PI / 2));
    const bar = flat(new THREE.BoxGeometry(0.9, 0.12, 0.16).translate(0, 0.12, 0));
    return mergeGeometries([ring, bar], false);
  }
  if (type === 'eraser') {
    const body = flat(new THREE.BoxGeometry(1.35, 0.52, 1.0));
    const band = flat(new THREE.BoxGeometry(0.5, 0.56, 1.04).translate(0.3, 0, 0));
    return mergeGeometries([body, band], false);
  }
  const body = flat(new THREE.CylinderGeometry(0.82, 0.95, 1.15, 9));
  const neck = flat(new THREE.CylinderGeometry(0.38, 0.38, 0.5, 8).translate(0, 0.8, 0));
  const cap = flat(new THREE.CylinderGeometry(0.52, 0.52, 0.22, 8).translate(0, 1.15, 0));
  return mergeGeometries([body, neck, cap], false);
}

export class Scene {
  constructor(threeScene) {
    this.root = new THREE.Group(); threeScene.add(this.root);
    this.mats = []; this.geos = [];
    const mat = (o) => { const m = makeInkMaterial(o); this.mats.push(m); return m; };
    const add = (g, m) => { const o = new THREE.Mesh(g, m); o.matrixAutoUpdate = false; this.geos.push(g); this.root.add(o); return o; };

    // Lane dividers are deliberately thick: thin bars disappear on wide viewports (see Ink Five).
    const lines = [];
    for (const z of [-10.5, -3.5, 3.5, 10.5]) {
      lines.push(flat(new THREE.BoxGeometry(FIELD_HALF * 2 + 4, 0.09, 0.22).translate(0, 0.05, z)));
    }
    // centre line: red pen margin split between the two halves
    lines.push(flat(new THREE.BoxGeometry(0.28, 0.09, 22).translate(0, 0.06, 0)));
    add(mergeGeometries(lines.slice(0, 4), false), mat({ ink: INK.BLUE }));
    add(lines[4], mat({ ink: INK.RED }));

    // binding holes down the left margin
    const holes = [];
    for (let i = 0; i < 5; i++) {
      holes.push(flat(new THREE.TorusGeometry(0.42, 0.12, 5, 12).rotateX(-Math.PI / 2)
        .translate(-FIELD_HALF - 2.2, 0.05, (i - 2) * 6)));
    }
    add(mergeGeometries(holes, false), mat({ ink: INK.BLACK }));

    // the two inkwell forts: a wall across all three lanes with a bottle in the middle
    this.forts = {};
    for (const team of [1, 2]) {
      const x = team === 1 ? -BASE_X : BASE_X;
      const wall = new THREE.BoxGeometry(0.55, 1.1, 22).translate(x, 0.55, 0);
      const bottle = new THREE.CylinderGeometry(2.2, 2.6, 3.2, 10).translate(x, 1.6, 0);
      const neck = new THREE.CylinderGeometry(0.9, 0.9, 1.0, 8).translate(x, 3.6, 0);
      const cap = new THREE.CylinderGeometry(1.15, 1.15, 0.45, 8).translate(x, 4.3, 0);
      const mesh = new THREE.Mesh(mergeGeometries([flat(wall), flat(bottle), flat(neck), flat(cap)], false),
        mat({ ink: team === 1 ? INK.BLUE : INK.RED }));
      this.geos.push(mesh.geometry); this.root.add(mesh);
      this.forts[team] = mesh;
    }

    this.unit = {};
    for (const type of UNIT_LIST) {
      const g = unitGeometry(type);
      const m = new THREE.InstancedMesh(g, mat({ ink: UNITS[type].ink }), MAX_UNITS);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false;
      this.root.add(m); this.geos.push(g);
      this.unit[type] = m;
    }
    // paper pellet with a tapered ink trail behind it; mirrored per team so the trail follows motion
    const shotGeo = mergeGeometries([
      flat(new THREE.SphereGeometry(0.26, 6, 5)),
      flat(new THREE.ConeGeometry(0.16, 0.8, 5).rotateZ(Math.PI / 2).translate(-0.5, 0, 0)),
    ], false);
    this.shots = new THREE.InstancedMesh(shotGeo, mat({ ink: INK.BLACK }), MAX_SHOTS);
    this.shots.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.shots.frustumCulled = false;
    this.root.add(this.shots); this.geos.push(this.shots.geometry);

    this.hpBars = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.1, 0.14), mat({ ink: INK.GREEN }), MAX_UNITS * 2);
    this.hpBars.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.hpBars.frustumCulled = false;
    this.root.add(this.hpBars); this.geos.push(this.hpBars.geometry);
  }

  _place(mesh, n, x, y, z, inkId, sc = 1, yaw = 0) {
    _q.setFromAxisAngle(_up, yaw);
    _p.set(x, y, z); _s.set(sc, sc, sc);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(n, _m);
    if (inkId != null) { _c.setRGB(inkId, 0, 0); mesh.setColorAt(n, _c); }
  }

  sync(s) {
    const counts = Object.fromEntries(UNIT_LIST.map((t) => [t, 0]));
    let bars = 0;
    for (const u of s.units) {
      const mesh = this.unit[u.type];
      const n = counts[u.type];
      if (n >= MAX_UNITS) continue;
      counts[u.type]++;
      const ink = u.team === 1 ? INK.BLUE : INK.RED;
      const sc = UNITS[u.type].size * 1.9;
      const y = 0.3 * sc;
      // Stamps are modelled facing +X (the pencil tip points that way). The red army marches
      // towards -X, so mirror the whole instance instead of letting it walk backwards.
      const yaw = (u.dir === 1 ? 0 : Math.PI) + (jitter(u.id) - 0.5) * 0.22;
      this._place(mesh, n, u.x, y, LANES[u.lane], ink, sc, yaw);
      if (bars < MAX_UNITS * 2) {
        const frac = Math.max(0.04, u.hp / UNITS[u.type].hp);
        _q.identity(); _p.set(u.x, y + 1.15 * sc, LANES[u.lane]); _s.set(frac * 1.7, 1, 1);
        _m.compose(_p, _q, _s); this.hpBars.setMatrixAt(bars, _m);
        _c.setRGB(frac < 0.35 ? INK.RED : INK.GREEN, 0, 0); this.hpBars.setColorAt(bars, _c);
        bars++;
      }
    }
    for (const type of UNIT_LIST) {
      const mesh = this.unit[type];
      for (let i = counts[type]; i < MAX_UNITS; i++) hide(mesh, i);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (let i = bars; i < MAX_UNITS * 2; i++) hide(this.hpBars, i);
    this.hpBars.instanceMatrix.needsUpdate = true;
    if (this.hpBars.instanceColor) this.hpBars.instanceColor.needsUpdate = true;

    const shots = Math.min(s.projectiles.length, MAX_SHOTS);
    for (let i = 0; i < shots; i++) {
      const p = s.projectiles[i];
      this._place(this.shots, i, p.x, 0.85, LANES[p.lane], p.team === 1 ? INK.BLUE : INK.RED, 0.9,
        p.dir === 1 ? 0 : Math.PI);
    }
    for (let i = shots; i < MAX_SHOTS; i++) hide(this.shots, i);
    this.shots.instanceMatrix.needsUpdate = true;
    if (this.shots.instanceColor) this.shots.instanceColor.needsUpdate = true;

    for (const team of [1, 2]) {
      const hp = Math.max(0.18, s.hp[team] / s.maxHp[team]);
      this.forts[team].scale.y = 0.4 + hp * 0.6;
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

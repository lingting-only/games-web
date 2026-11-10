// A paper plane folded out of a handful of triangles. Everything is drawn with the same ink
// material as the world, so the notebook post pass gives it outlines, hatching and wobble.
import * as THREE from 'three';
import { makeInkMaterial, setInk, INK } from './render.js';
import { damp, rand } from './util.js';

const _up = new THREE.Vector3(0, 1, 0);

function triangle(a, b, c, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

function crease(from, to, thick, mat) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const dir = b.clone().sub(a), len = dir.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(thick, len, thick), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, dir.divideScalar(len));
  return m;
}

export function buildPlane({ ink = INK.BLUE, scale = 1, accent = INK.BLACK } = {}) {
  const root = new THREE.Group();
  const mat = makeInkMaterial({ ink, side: THREE.DoubleSide });
  const dark = makeInkMaterial({ ink: accent, fill: true, side: THREE.DoubleSide });
  const nose = [0, 0, -2.3];
  const wingL = triangle(nose, [-1.7, -0.06, 1.5], [0, 0.14, 1.05], mat);
  const wingR = triangle(nose, [0, 0.14, 1.05], [1.7, -0.06, 1.5], mat);
  const keel = triangle(nose, [0, 0.66, 1.28], [0, 0.02, 1.5], mat);
  root.add(wingL, wingR, keel);
  root.add(crease([0, 0.04, -2.1], [0, 0.17, 1.05], 0.045, dark));
  root.add(crease([-1.7, -0.06, 1.5], [0, 0.14, 1.05], 0.035, dark));
  root.add(crease([0, 0.14, 1.05], [1.7, -0.06, 1.5], 0.035, dark));
  // two little pen strokes at the tail, like a hand-drawn registration mark
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.035, 0.035), dark);
  tail.position.set(0, 0.03, 1.15); root.add(tail);
  root.scale.setScalar(scale);
  return {
    root, wingL, wingR, keel, mat,
    setInk(i) { setInk(mat, i); },
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      mat.dispose(); dark.dispose();
    },
  };
}

export class PlaneVisual {
  constructor(scene, opts = {}) {
    this.model = buildPlane(opts);
    this.root = this.model.root;
    this.scene = scene;
    scene.add(this.root);
    this.phase = rand(0, 6.28);
    this.pos = new THREE.Vector3(0, -100, 0);
    this.hitRadius = 1.25 * (opts.scale || 1);
  }
  setInk(i) { this.model.setInk(i); }
  update(dt, st) {
    const r = this.root;
    if (st.pos) this.pos.copy(st.pos);
    r.position.copy(this.pos);
    r.rotation.set(st.pitch || 0, st.yaw || 0, st.roll || 0);
    this.phase += dt * 9;
    const flap = Math.sin(this.phase) * 0.07;
    this.model.wingL.rotation.z = flap;
    this.model.wingR.rotation.z = -flap;
    this.model.keel.rotation.x = flap * 0.35;
    const shield = st.shieldT > 0;
    r.visible = st.alive !== false && (!shield || Math.floor((st.t || 0) * 9) % 2 === 0);
    r.scale.setScalar((st.scale || 1) * (st.alive === false ? 0.001 : 1));
  }
  dispose() { this.scene.remove(this.root); this.model.dispose(); }
}

export const SKINS = [
  { key: 'blue', name: '圆珠笔蓝', ink: INK.BLUE, need: 0 },
  { key: 'orange', name: '荧光橙', ink: INK.ORANGE, need: 15 },
  { key: 'green', name: '草稿绿', ink: INK.GREEN, need: 40 },
  { key: 'pink', name: '橡皮粉', ink: INK.PINK, need: 80 },
];

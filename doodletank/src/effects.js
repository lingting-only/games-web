// Ink effects: stroke bursts (a spray of little pen strokes), scorch marks that stay on the
// paper, expanding blast rings, the spawn-in star that scribbles a new tank onto the page,
// and floating brick crumbs. Everything is generated in code, nothing is a texture.
import * as THREE from 'three';
import { makeInkMaterial, INK } from './render.js';
import { rand } from './util.js';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.parts = [];     // flying strokes
    this.marks = [];     // scorch decals that fade
    this.rings = [];     // blast rings
    this.stars = [];     // spawn scribbles
    this.crumbGeo = new THREE.BoxGeometry(0.16, 0.1, 0.16);
    this.mats = new Map();
    this.time = 0;
  }
  clear() {
    for (const p of this.parts) this.scene.remove(p.mesh);
    for (const m of this.marks) this.scene.remove(m.mesh);
    for (const r of this.rings) this.scene.remove(r.mesh);
    for (const s of this.stars) this.scene.remove(s.mesh);
    this.parts.length = this.marks.length = this.rings.length = this.stars.length = 0;
  }
  mat(ink) {
    if (!this.mats.has(ink)) this.mats.set(ink, makeInkMaterial({ ink, shadeScale: 0.3 }));
    return this.mats.get(ink);
  }
  strokeBurst(x, z, ink, n = 10, spread = 4, opts = {}) {
    const mat = this.mat(ink);
    const life = opts.life ?? 0.5;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(spread * 0.4, spread);
      const mesh = new THREE.Mesh(this.crumbGeo, mat);
      mesh.position.set(x, opts.y ?? 0.5, z);
      mesh.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      const s = rand(0.5, opts.size ?? 1.2);
      mesh.scale.setScalar(s);
      this.scene.add(mesh);
      this.parts.push({ mesh, vx: Math.cos(a) * sp, vy: rand(1.5, 4.5), vz: Math.sin(a) * sp, life, t: 0, spin: rand(-9, 9) });
    }
  }
  // a dark scorch the explosion leaves on the paper
  scorch(x, z, size = 1.6) {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(size, 14), makeInkMaterial({ ink: INK.BLACK, fill: true }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.02, z);
    this.scene.add(mesh);
    this.marks.push({ mesh, t: 0, life: 7 });
  }
  brickCrumbs(x, z, ink = INK.ORANGE) { this.strokeBurst(x, z, ink, 7, 3.2, { y: 0.4, size: 1.0, life: 0.45 }); }
  ring(x, z, ink = INK.RED, size = 2.2, life = 0.35) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.34, 20), makeInkMaterial({ ink, fill: true, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.06, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, t: 0, life, size });
  }
  explosion(x, z, big = false) {
    this.strokeBurst(x, z, INK.RED, big ? 22 : 13, big ? 6.5 : 4.5, { y: 0.6, life: 0.55, size: big ? 1.5 : 1.1 });
    this.strokeBurst(x, z, INK.ORANGE, big ? 12 : 7, big ? 5 : 3.4, { y: 0.8, life: 0.4, size: 0.9 });
    this.ring(x, z, INK.RED, big ? 3.2 : 2.0, 0.38);
    this.scorch(x, z, big ? 2.1 : 1.4);
  }
  // the scribbled star that doodles a tank into existence at a spawn point
  spawnStar(x, z, dur = 0.9) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.3), this.mat(INK.ORANGE));
    mesh.position.set(x, 0.1, z);
    this.scene.add(mesh);
    this.stars.push({ mesh, t: 0, life: dur, x, z });
  }
  update(dt) {
    this.time += dt;
    const dead = (arr) => { const out = []; for (const p of arr) { p.t += dt; if (p.t >= p.life) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); } else out.push(p); } return out; };
    for (const p of this.parts) {
      p.vy -= 9.5 * dt;
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < 0.05) { p.mesh.position.y = 0.05; p.vy *= -0.3; p.vx *= 0.7; p.vz *= 0.7; }
      p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.z += p.spin * 0.7 * dt;
      const f = 1 - p.t / p.life;
      p.mesh.scale.setScalar(Math.max(0.05, f));
    }
    this.parts = dead(this.parts);
    for (const m of this.marks) {
      const f = m.t / m.life;
      m.mesh.material.uniforms.uShadeScale.value = 0.3;
      m.mesh.scale.setScalar(Math.max(0.4, 1 - f * 0.6));
      m.mesh.visible = f < 0.85;
    }
    this.marks = dead(this.marks);
    for (const r of this.rings) {
      const f = r.t / r.life;
      r.mesh.scale.setScalar(0.3 + f * r.size);
    }
    this.rings = dead(this.rings);
    for (const s of this.stars) {
      const f = s.t / s.life;
      const arms = 4;
      s.mesh.rotation.y = this.time * 7;
      s.mesh.position.y = 0.1 + Math.abs(Math.sin(this.time * 9)) * 0.12 * (1 - f);
      s.mesh.scale.setScalar(1 + Math.sin(this.time * 20) * 0.3);
      s.mesh.visible = Math.floor(this.time * 14) % 2 === 0;
      if (f > 0.7) s.mesh.scale.setScalar(Math.max(0.05, (1 - f) / 0.3));
    }
    this.stars = dead(this.stars);
  }
}

// The pen nib: a little tilted ballpoint that walks to the cell the player clicked, leaving ink
// behind it. Movement is in world units; every time it crosses into a new cell the authority gets
// a callback so rules stay in one place.
import * as THREE from 'three';
import { makeInkMaterial, INK } from './render.js';
import { GW, CELL, cellToWorld, cellIndex, worldToCell } from './paper.js';

export class Actor {
  constructor(scene, pid, ink, cx, cy) {
    this.pid = pid; this.ink = ink;
    [this.x, this.z] = cellToWorld(cx, cy);
    [this.cx, this.cy] = [cx, cy];
    this.path = null; this.pi = 0;
    this.drawing = false; this.speed = 19; this.stunT = 0;
    this.mats = [];
    const bodyMat = makeInkMaterial({ ink }); this.mats.push(bodyMat);
    const dotMat = makeInkMaterial({ ink, fill: true }); this.mats.push(dotMat);
    this.group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 2.1, 6), bodyMat);
    body.position.set(0.22, 1.25, 0); body.rotation.z = 0.3; this.group.add(body);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.85, 6), bodyMat);
    tip.position.set(-0.1, 0.42, 0); tip.rotation.z = Math.PI + 0.3; this.group.add(tip);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.28, 0.72), bodyMat);
    cap.position.set(0.52, 2.3, 0); cap.rotation.z = 0.3; this.group.add(cap);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 6), dotMat);
    dot.scale.y = 0.1; dot.position.y = 0.05; this.group.add(dot);
    this.group.position.set(this.x, 0, this.z);
    scene.add(this.group);
  }
  setPath(cells) {
    this.path = cells.map((i) => cellToWorld(i % GW, (i / GW) | 0));
    this.pi = 0;
  }
  get moving() { return !!(this.path && this.pi < this.path.length); }
  // returns 'stop' when the authority wants the pen to halt (it just closed a region)
  update(dt, onEnterCell) {
    if (this.stunT > 0) this.stunT = Math.max(0, this.stunT - dt);
    let budget = this.speed * CELL * dt * (this.stunT > 0 ? 0.45 : 1);
    while (budget > 0 && this.path && this.pi < this.path.length) {
      const [tx, tz] = this.path[this.pi];
      const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
      if (d <= budget) {
        this.x = tx; this.z = tz; budget -= d; this.pi++;
        const [cx, cy] = worldToCell(tx, tz);
        if (cx !== this.cx || cy !== this.cy) {
          this.cx = cx; this.cy = cy;
          if (onEnterCell(this, cellIndex(cx, cy)) === 'stop') { this.path = null; break; }
        }
      } else {
        this.x += (dx / d) * budget; this.z += (dz / d) * budget; budget = 0;
        this.group.rotation.y = Math.atan2(dx, dz);
      }
    }
    this.group.position.set(this.x, Math.sin(performance.now() * 0.006 + this.pid) * 0.06, this.z);
  }
  snap(x, z, drawing) {
    this.x = x; this.z = z;
    [this.cx, this.cy] = worldToCell(x, z);
    this.drawing = !!drawing;
    this.path = null; this.pi = 0;
    this.group.position.set(x, 0, z);
  }
  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
  }
}

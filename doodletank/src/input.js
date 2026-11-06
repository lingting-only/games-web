// Input: keyboard + gamepad, distilled to what a tank needs — one of four directions, fire,
// and menu buttons. The most recently touched direction wins (classic tank feel), and hints
// follow whichever device you touched last.
const DIR_KEYS = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

export class Input {
  constructor(canvas) {
    this.dir = null;
    this.fireHeld = false;
    this.firePressed = false;     // edge, consumed by the game
    this.confirmPressed = false;  // edge: Enter / gamepad A
    this.usingPad = false;
    this._held = new Map();       // dir -> timestamp of press (last-pressed wins)
    this._fireKeys = new Set();
    this.onAny = null;
    const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    addEventListener('keydown', (e) => {
      if (typing(e.target)) return;
      if (e.repeat) return;
      const d = DIR_KEYS[e.code];
      if (d) { this._held.set(d, performance.now()); this._recompute(); e.preventDefault(); }
      if (e.code === 'Space' || e.code === 'KeyJ') { if (!this._fireKeys.has(e.code)) { this.firePressed = true; } this._fireKeys.add(e.code); this.fireHeld = true; e.preventDefault(); }
      if (e.code === 'Enter') this.confirmPressed = true;
      if (this.onAny) this.onAny();
    });
    addEventListener('keyup', (e) => {
      const d = DIR_KEYS[e.code];
      if (d) { this._held.delete(d); this._recompute(); }
      if (e.code === 'Space' || e.code === 'KeyJ') { this._fireKeys.delete(e.code); this.fireHeld = this._fireKeys.size > 0; }
    });
    // click on the canvas also fires (mouse players)
    canvas.addEventListener('mousedown', () => { this.firePressed = true; this.fireHeld = true; this.usingPad = false; if (this.onAny) this.onAny(); });
    addEventListener('mouseup', () => { if (!this._fireKeys.size) this.fireHeld = false; });
    addEventListener('blur', () => { this._held.clear(); this._fireKeys.clear(); this.fireHeld = false; this._recompute(); });
  }
  _recompute() {
    let best = null, bt = -1;
    for (const [d, t] of this._held) if (t > bt) { bt = t; best = d; }
    this.dir = best;
    if (best) this.usingPad = false;
  }
  // gamepad: left stick / d-pad to move, A / R2 to fire
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      let d = null;
      if (p.buttons[12]?.pressed) d = 'up';
      else if (p.buttons[13]?.pressed) d = 'down';
      else if (p.buttons[14]?.pressed) d = 'left';
      else if (p.buttons[15]?.pressed) d = 'right';
      else if (Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5) d = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : (ay > 0 ? 'down' : 'up');
      if (d) { this._padDir = d; this.usingPad = true; }
      else if (this.usingPad) this._padDir = null;
      if (p.buttons[0]?.pressed || (p.buttons[7]?.value ?? 0) > 0.4) {
        if (!this._padFire) this.firePressed = true;
        this._padFire = true; this.fireHeld = true; this.usingPad = true;
      } else { this._padFire = false; if (!this._fireKeys.size) this.fireHeld = this.fireHeld && !!this._padDir; }
      if (p.buttons[0]?.pressed && !this._padA) this.confirmPressed = true;
      this._padA = !!p.buttons[0]?.pressed;
      if (d || this._padFire) { if (this.onAny) this.onAny(); }
    }
    if (this.usingPad && this._padDir) this.dir = this._padDir;
  }
  // per-frame entry point: returns the movement direction for this frame
  moveDir() {
    this.pollPad();
    return this.dir;
  }
  consumeFire() { const f = this.firePressed; this.firePressed = false; return f; }
  consumeConfirm() { const c = this.confirmPressed; this.confirmPressed = false; return c; }
}

// One input to rule the whole game: a click/tap. The pointer position becomes a ray in main.js,
// which decides whether it hit a plane (lock + throw) or empty paper (a waypoint).
export class PointerInput {
  constructor(canvas) {
    this.canvas = canvas;
    this.ndc = { x: 0, y: 0 };
    this.onClick = null; this.onKey = null; this.onAnyInput = null;
    this.keys = {}; this.padPrev = {};
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
      if (this.onAnyInput) this.onAnyInput();
      if (this.onClick) this.onClick(this.ndc);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.keys[e.code] = true;
      if (this.onAnyInput) this.onAnyInput();
      if (e.repeat) return;
      const action = { Escape: 'pause', KeyP: 'pause', KeyM: 'music', Enter: 'confirm', Space: 'confirm', KeyR: 'respawn', KeyF: 'lock' }[e.code];
      if (action && this.onKey) this.onKey(action);
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    window.addEventListener('gamepadconnected', () => { this.hasPad = true; });
  }
  get scoreHeld() { return !!this.keys.Tab || !!this._padScore; }
  update() {
    let pad = null;
    if (navigator.getGamepads) {
      const pads = navigator.getGamepads();
      for (const p of pads) if (p && p.connected) { pad = p; break; }
    }
    if (!pad) { this._padScore = false; return; }
    this._padScore = !!(pad.buttons[8] && pad.buttons[8].pressed);
    const press = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    for (const [i, action] of [[0, 'padFire'], [9, 'pause'], [3, 'music']]) {
      if (press(i) && !this.padPrev[i]) { if (this.onAnyInput) this.onAnyInput(); if (this.onKey) this.onKey(action); }
      this.padPrev[i] = press(i);
    }
  }
}

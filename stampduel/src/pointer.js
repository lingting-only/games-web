// One click is the whole control scheme: a pointer position becomes a ray onto the paper plane.
export class PointerInput {
  constructor(canvas) {
    this.ndc = { x: 0, y: 0 };
    this.onClick = null; this.onKey = null; this.onAnyInput = null;
    this.keys = {};
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
      if (this.onAnyInput) this.onAnyInput();
      if (this.onClick) this.onClick(this.ndc);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space'].includes(e.code)) e.preventDefault();
      this.keys[e.code] = true;
      if (this.onAnyInput) this.onAnyInput();
      if (e.repeat) return;
      const action = { Escape: 'pause', KeyP: 'pause', KeyM: 'music', Enter: 'confirm', Space: 'confirm', KeyR: 'restart',
        Digit1: 'unit1', Digit2: 'unit2', Digit3: 'unit3', Digit4: 'unit4' }[e.code];
      if (action && this.onKey) this.onKey(action);
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
  }
}

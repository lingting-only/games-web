// Procedural 8-bit audio, in the spirit of the original tank game: a little square-wave
// march loops under the stage, and every action has a blip. No audio files — the WebAudio
// graph is the instrument. M toggles the music.
export class Audio {
  constructor() {
    this.ctx = null;
    this.musicWanted = localStorage.getItem('tank_music') !== '0';
    this.sfxWanted = localStorage.getItem('tank_sfx') !== '0';
    this.tune = null;
    this._engine = null;
  }
  _ac() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._master = this.ctx.createGain(); this._master.gain.value = 0.5; this._master.connect(this.ctx.destination);
      this._musicBus = this.ctx.createGain(); this._musicBus.gain.value = 0.16; this._musicBus.connect(this._master);
      this._sfxBus = this.ctx.createGain(); this._sfxBus.gain.value = 0.5; this._sfxBus.connect(this._master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  unlock() { this._ac(); }

  // ---- tiny sequencer ----
  setTune(name) {
    this.tune = name;
    this._stopMusic();
    if (this.musicWanted && name) this._startMusic(name);
  }
  setMusic(on) {
    this.musicWanted = on;
    localStorage.setItem('tank_music', on ? '1' : '0');
    if (on) this._startMusic(this.tune); else this._stopMusic();
  }
  _startMusic(name) {
    const ac = this._ac(); this._stopMusic();
    const theme = THEMES[name] || THEMES.stage;
    let step = 0;
    const beat = 60 / theme.bpm / 2;
    const play = () => {
      if (!this.musicWanted) return;
      const bass = theme.bass[step % theme.bass.length];
      const lead = theme.lead[step % theme.lead.length];
      if (bass) this._note(bass, beat * 0.9, 'triangle', this._musicBus, 0.5);
      if (lead > 0) this._note(lead, beat * 0.55, 'square', this._musicBus, 0.28);
      if (step % 2 === 0) this._noise(0.03, 0.05, this._musicBus, 0.12);
      step++;
      this._musicTimer = setTimeout(play, beat * 1000);
    };
    play();
  }
  _stopMusic() { if (this._musicTimer) { clearTimeout(this._musicTimer); this._musicTimer = null; } }
  _note(freq, dur, type, bus, gain) {
    const ac = this._ac();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g); g.connect(bus);
    o.start(); o.stop(ac.currentTime + dur + 0.02);
  }
  _noise(dur, gain, bus, hp = 0) {
    const ac = this._ac();
    const n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ac.createBufferSource(); src.buffer = buf;
    const g = ac.createGain(); g.gain.value = gain;
    let node = src;
    if (hp > 0) { const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp * ac.sampleRate; src.connect(f); node = f; }
    node.connect(g); g.connect(bus);
    src.start();
  }
  _sweep(f0, f1, dur, type, gain) {
    const ac = this._ac();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), ac.currentTime + dur);
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g); g.connect(this._sfxBus);
    o.start(); o.stop(ac.currentTime + dur + 0.02);
  }

  // ---- sfx ----
  setSfx(on) { this.sfxWanted = on; localStorage.setItem('tank_sfx', on ? '1' : '0'); }
  fire() { if (this.sfxWanted) this._sweep(880, 220, 0.09, 'square', 0.35); }
  explode(big = false) {
    if (!this.sfxWanted) return;
    this._noise(big ? 0.5 : 0.3, big ? 0.6 : 0.4, this._sfxBus);
    this._sweep(big ? 200 : 160, 40, big ? 0.4 : 0.25, 'triangle', 0.5);
  }
  brick() { if (this.sfxWanted) this._noise(0.08, 0.3, this._sfxBus, 0.3); }
  steel() { if (this.sfxWanted) this._sweep(1600, 1200, 0.06, 'square', 0.25); }
  pickup() {
    if (!this.sfxWanted) return;
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._note(f, 0.09, 'square', this._sfxBus, 0.3), i * 60));
  }
  life() {
    if (!this.sfxWanted) return;
    [392, 523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._note(f, 0.12, 'square', this._sfxBus, 0.3), i * 80));
  }
  stageStart() {
    if (!this.sfxWanted) return;
    [262, 330, 392, 523].forEach((f, i) => setTimeout(() => this._note(f, 0.14, 'square', this._sfxBus, 0.32), i * 110));
  }
  gameOver() {
    if (!this.sfxWanted) return;
    [392, 330, 262, 196, 131].forEach((f, i) => setTimeout(() => this._note(f, 0.22, 'triangle', this._sfxBus, 0.4), i * 160));
  }
  clear() {
    if (!this.sfxWanted) return;
    [523, 523, 523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._note(f, 0.12, 'square', this._sfxBus, 0.32), i * 100));
  }
  engine(on) {
    // a low idle hum while a tank rolls: one shared oscillator
    const ac = this._ac();
    if (on && !this._engine) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = 55;
      g.gain.value = 0.03;
      o.connect(g); g.connect(this._sfxBus);
      o.start();
      this._engine = { o, g };
    } else if (!on && this._engine) {
      this._engine.o.stop(); this._engine = null;
    }
  }
}

// little square-wave march: i-iv-v feels, in numbers (Hz)
const G3 = 196, C4 = 262, D4 = 294, E4 = 330, F4 = 349, G4 = 392, A4 = 440, B4 = 494, C5 = 523, D5 = 587, E5 = 659;
const THEMES = {
  stage: {
    bpm: 132,
    bass: [G3, 0, G3, 0, F4, 0, F4, 0, E4, 0, E4, 0, D4, 0, D4, 0],
    lead: [G4, 0, B4, 0, D5, 0, B4, 0, C5, 0, E4, 0, G4, 0, 0, 0],
  },
  march: {
    bpm: 148,
    bass: [C4, 0, C4, 0, F4, 0, F4, 0, G3, 0, G3, 0, C4, 0, 0, 0],
    lead: [E5, 0, D5, 0, C5, 0, G4, A4, B4, 0, C5, 0, 0, 0, 0, 0],
  },
};

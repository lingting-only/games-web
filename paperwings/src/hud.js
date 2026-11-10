// DOM heads-up display: pen-style text multiplied over the paper canvas, plus the menu / lobby /
// pause / result panels. All panels are plain HTML handed in by main.js.
export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="nametags" id="nametags"></div>
      <div class="hud-tl"><div class="score">分数 <b id="score">0</b></div><div class="combo" id="combo"></div></div>
      <div class="hud-tr">
        <div class="wave">波次 <b id="wave">1</b></div>
        <div class="left"><b id="left">0</b> 架待击落</div>
        <div class="timer" id="timer"></div>
        <div class="pvpscore" id="pvpscore" hidden></div>
      </div>
      <div class="board" id="board" hidden></div>
      <div class="bossbar" id="bossbar"><div class="bossname" id="bossname"></div><div class="bar big"><div class="fill red" id="bossfill"></div></div></div>
      <div class="hud-bl">
        <div class="health"><span>折痕</span><div class="bar"><div class="fill" id="hpfill"></div></div><span id="hpnum">3</span></div>
        <div class="paper" id="ammo">纸团 ∞</div>
        <div class="tally" id="tally"></div>
      </div>
      <div class="hud-br"><div class="weapon" id="weapon">纸飞机</div><div class="hint" id="hint">点敌机投纸团 · 点空处设航点</div></div>
      <div class="reticle" id="reticle"><i></i></div>
      <div class="lockmark" id="lockmark"><i></i><i></i><i></i><i></i></div>
      <div class="tip" id="tip"></div>
      <div class="message"><div class="msg-main" id="msg"></div><div class="msg-sub" id="msgsub"></div></div>
      <div class="killfeed" id="killfeed"></div>
      <div class="screen" id="screen"><div class="panel" id="panel"></div></div>`;
    const q = (id) => root.querySelector('#' + id);
    this.el = {
      score: q('score'), combo: q('combo'), wave: q('wave'), left: q('left'), timer: q('timer'), pvp: q('pvpscore'),
      board: q('board'), bossbar: q('bossbar'), bossname: q('bossname'), bossfill: q('bossfill'),
      hpfill: q('hpfill'), hpnum: q('hpnum'), ammo: q('ammo'), tally: q('tally'),
      weapon: q('weapon'), hint: q('hint'), reticle: q('reticle'), lockmark: q('lockmark'),
      tip: q('tip'), msg: q('msg'), msgsub: q('msgsub'), killfeed: q('killfeed'),
      screen: q('screen'), panel: q('panel'), nametags: q('nametags'),
    };
    this._msgT = 0; this._tipT = 0; this._tally = -1; this._tags = '';
    this.onScreenClick = null;
    this.el.screen.addEventListener('click', () => { if (this.onScreenClick) this.onScreenClick(); });
  }
  setScore(n, combo = 0) { this.el.score.textContent = n; this.el.combo.textContent = combo > 1 ? `连击 x${combo}` : ''; }
  setWave(n, left) { this.el.wave.textContent = n; this.el.left.textContent = left; }
  setTimer(s) { this.el.timer.textContent = s || ''; }
  setPvpScore(s) { const on = !!s; this.el.pvp.hidden = !on; if (on) this.el.pvp.textContent = s; }
  setWaveVisible(on) {
    const d = on ? '' : 'none';
    this.el.wave.parentElement.style.display = d;
    this.el.left.parentElement.style.display = d;
  }
  setBoard(html) { const on = !!html; this.el.board.hidden = !on; if (on) this.el.board.innerHTML = html; }
  setBoss(name, frac) {
    if (frac == null) { this.el.bossbar.classList.remove('show'); return; }
    this.el.bossbar.classList.add('show'); this.el.bossname.textContent = name;
    this.el.bossfill.style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%';
  }
  setHealth(hp, max) {
    const f = clamp(hp / max, 0, 1);
    this.el.hpfill.style.width = (f * 100).toFixed(1) + '%';
    this.el.hpnum.textContent = Math.ceil(hp);
    this.root.classList.toggle('low', f < 0.34);
  }
  setAmmo(text) { this.el.ammo.textContent = text; }
  setTally(n) {
    if (n === this._tally) return; this._tally = n;
    let h = ''; for (let i = 0; i < Math.min(n, 40); i++) h += '<i></i>';
    this.el.tally.innerHTML = h;
  }
  setWeapon(name, hint) { this.el.weapon.textContent = name; this.el.hint.textContent = hint; }
  reticle(firing) { this.el.reticle.classList.toggle('firing', !!firing); }
  setLock(x, y, on) {
    const m = this.el.lockmark;
    m.classList.toggle('on', !!on);
    if (on) m.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }
  setNameTags(list) {
    const key = list.map((t) => `${t.name}|${t.x.toFixed(0)}|${t.y.toFixed(0)}|${t.ink}`).join(';');
    if (key === this._tags) return; this._tags = key;
    this.el.nametags.innerHTML = list.map((t) => `<div class="nametag" style="left:${t.x.toFixed(0)}px;top:${t.y.toFixed(0)}px;color:${t.color || '#1a30c0'}">${esc(t.name)}</div>`).join('');
  }
  tip(text, dur = 5) { this.el.tip.innerHTML = text; this.el.tip.classList.add('show'); this._tipT = dur; }
  message(main, sub = '', dur = 2.2) {
    const m = this.el.msg; m.textContent = main; m.classList.remove('show'); void m.offsetWidth; m.classList.add('show');
    this.el.msgsub.textContent = sub; this._msgT = dur;
  }
  kill(text, pts = 0) {
    const d = document.createElement('div');
    d.innerHTML = pts > 0 ? `${text} <span class="pts">+${pts}</span>` : text;
    this.el.killfeed.appendChild(d);
    setTimeout(() => d.remove(), 1800);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
  }
  showScreen(html) { this.el.panel.innerHTML = html; this.el.screen.classList.add('show'); }
  hideScreen() { this.el.screen.classList.remove('show'); }
  setGameplayVisible(v) { this.root.classList.toggle('nogame', !v); }
  update(dt) {
    if (this._msgT > 0) { this._msgT -= dt; if (this._msgT <= 0) { this.el.msg.classList.remove('show'); this.el.msgsub.textContent = ''; } }
    if (this._tipT > 0) { this._tipT -= dt; if (this._tipT <= 0) this.el.tip.classList.remove('show'); }
  }
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

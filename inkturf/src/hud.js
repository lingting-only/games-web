// Pen-style DOM HUD: coverage, clock, live standings, and the menu / lobby / pause / result panels.
export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-tl">
        <div class="cover-label">我的覆盖率</div>
        <div class="cover"><b id="cover">0.0</b><span>%</span></div>
        <div class="target" id="target"></div>
        <div class="bar"><div class="fill" id="coverfill"></div></div>
      </div>
      <div class="hud-tr">
        <div class="timer" id="timer">1:30</div>
        <div class="mode" id="mode"></div>
        <div class="board-mini" id="boardmini"></div>
      </div>
      <div class="status" id="status"></div>
      <div class="hud-br"><div class="hint">点纸面 = 跑过去并画线 · 回到自己颜色闭合圈地</div></div>
      <div class="tip" id="tip"></div>
      <div class="message"><div class="msg-main" id="msg"></div><div class="msg-sub" id="msgsub"></div></div>
      <div class="screen" id="screen"><div class="panel" id="panel"></div></div>`;
    const q = (id) => root.querySelector('#' + id);
    this.el = {
      cover: q('cover'), target: q('target'), coverfill: q('coverfill'), timer: q('timer'),
      mode: q('mode'), boardmini: q('boardmini'), status: q('status'), tip: q('tip'),
      msg: q('msg'), msgsub: q('msgsub'), screen: q('screen'), panel: q('panel'),
    };
    this._tipT = 0; this._msgT = 0; this._boardKey = '';
    this.onScreenClick = null;
    this.el.screen.addEventListener('click', () => { if (this.onScreenClick) this.onScreenClick(); });
  }
  setCoverage(pct, target = 0) {
    this.el.cover.textContent = pct.toFixed(1);
    this.el.coverfill.style.width = Math.min(100, Math.max(0, pct)).toFixed(1) + '%';
    this.el.target.textContent = target > 0 ? `目标 ${target}%` : '';
  }
  setTimer(sec) {
    const s = Math.max(0, Math.ceil(sec));
    this.el.timer.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    this.root.classList.toggle('urgent', s <= 10);
  }
  setMode(text) { this.el.mode.textContent = text; }
  setStatus(text) { this.el.status.textContent = text; }
  setBoard(rows) {
    const key = rows.map((r) => `${r.name}|${r.pct.toFixed(1)}|${r.me ? 1 : 0}`).join(';');
    if (key === this._boardKey) return; this._boardKey = key;
    this.el.boardmini.innerHTML = rows.map((r) =>
      `<div class="row ${r.me ? 'me' : ''}"><i style="background:${r.color}"></i><span>${esc(r.name)}</span><b>${r.pct.toFixed(1)}%</b></div>`).join('');
  }
  tip(text, dur = 3) { this.el.tip.innerHTML = text; this.el.tip.classList.add('show'); this._tipT = dur; }
  message(main, sub = '', dur = 2.2) {
    const m = this.el.msg; m.textContent = main; m.classList.remove('show'); void m.offsetWidth; m.classList.add('show');
    this.el.msgsub.textContent = sub; this._msgT = dur;
  }
  showScreen(html) { this.el.panel.innerHTML = html; this.el.screen.classList.add('show'); }
  hideScreen() { this.el.screen.classList.remove('show'); }
  setGameplayVisible(v) { this.root.classList.toggle('nogame', !v); }
  update(dt) {
    if (this._tipT > 0) { this._tipT -= dt; if (this._tipT <= 0) this.el.tip.classList.remove('show'); }
    if (this._msgT > 0) { this._msgT -= dt; if (this._msgT <= 0) { this.el.msg.classList.remove('show'); this.el.msgsub.textContent = ''; } }
  }
}
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

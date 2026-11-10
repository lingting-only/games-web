// Pen-style DOM HUD: whose turn, the four power-up legend, seats/standings and all menu panels.
export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-tl">
        <div class="turn-label">轮到</div>
        <div class="turn blue" id="turn"><b>蓝笔 ○</b></div>
        <div class="mode" id="mode"></div>
        <div class="movenum" id="movenum"></div>
      </div>
      <div class="hud-tr">
        <div class="powers" id="powers">
          <div class="pw"><i class="p1"></i><span>墨渍炸弹</span><small>炸 3×3</small></div>
          <div class="pw"><i class="p2"></i><span>橡皮擦</span><small>擦一子</small></div>
          <div class="pw"><i class="p3"></i><span>荧光笔</span><small>连下两手</small></div>
          <div class="pw"><i class="p4"></i><span>回形针</span><small>冻道具</small></div>
        </div>
        <div class="board-mini" id="boardmini"></div>
      </div>
      <div class="status" id="status"></div>
      <div class="undo-box" id="undobox"></div>
      <div class="tip" id="tip"></div>
      <div class="message"><div class="msg-main" id="msg"></div><div class="msg-sub" id="msgsub"></div></div>
      <div class="hud-br"><div class="hint">点格点落子 · 抢荧光格触发道具 · 连成五子获胜</div></div>
      <div class="screen" id="screen"><div class="panel" id="panel"></div></div>`;
    const q = (id) => root.querySelector('#' + id);
    this.el = {
      turn: q('turn'), mode: q('mode'), movenum: q('movenum'), boardmini: q('boardmini'),
      status: q('status'), undobox: q('undobox'), tip: q('tip'), msg: q('msg'),
      msgsub: q('msgsub'), screen: q('screen'), panel: q('panel'),
    };
    this._tipT = 0; this._msgT = 0; this._boardKey = '';
    this.onScreenClick = null;
    this.el.screen.addEventListener('click', () => { if (this.onScreenClick) this.onScreenClick(); });
  }
  setTurn(team, myTeam, thinking = false) {
    const e = this.el.turn;
    e.className = 'turn ' + (team === 1 ? 'blue' : 'red');
    e.innerHTML = team === 1 ? '<b>蓝笔 ○</b>' : '<b>红笔 ✗</b>';
    this.el.status.textContent = thinking ? '对手正在思考…' : team === myTeam ? '轮到你，点一个格点' : '等待对手落子';
  }
  setMode(text) { this.el.mode.textContent = text; }
  setMove(n) { this.el.movenum.textContent = `第 ${n + 1} 手`; }
  setBoard(rows) {
    const key = rows.map((r) => `${r.name}|${r.tag}|${r.me ? 1 : 0}`).join(';');
    if (key === this._boardKey) return; this._boardKey = key;
    this.el.boardmini.innerHTML = rows.map((r) =>
      `<div class="row ${r.me ? 'me' : ''}"><i style="background:${r.color}"></i><span>${esc(r.name)}</span><b>${esc(r.tag)}</b></div>`).join('');
  }
  setUndo(html) { this.el.undobox.innerHTML = html || ''; this.el.undobox.classList.toggle('show', !!html); }
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

// Pen-style DOM HUD: fort health, ink meter, the stamp palette and all menu / result panels.
import { UNITS } from './units.js';

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-tl">
        <div class="mode" id="mode"></div>
        <div class="wavenum" id="wave"></div>
        <div class="timer" id="timer"></div>
      </div>
      <div class="hud-tr">
        <div class="fort blue"><span>蓝墨水瓶</span><div class="bar"><div class="fill" id="hpBlue"></div></div><b id="hpBlueTxt"></b></div>
        <div class="fort red"><span>红墨水瓶</span><div class="bar"><div class="fill red" id="hpRed"></div></div><b id="hpRedTxt"></b></div>
        <div class="board-mini" id="boardmini"></div>
      </div>
      <div class="inkbar">
        <div class="ink-label">墨水</div>
        <div class="ink-track"><div class="ink-fill" id="inkFill"></div></div>
        <b id="inkTxt"></b>
      </div>
      <div class="stamps" id="stamps"></div>
      <div class="status" id="status"></div>
      <div class="tip" id="tip"></div>
      <div class="message"><div class="msg-main" id="msg"></div><div class="msg-sub" id="msgsub"></div></div>
      <div class="hud-br"><div class="hint">点己方半页的车道盖印章 · 1–4 切换单位</div></div>
      <div class="floaters" id="floaters"></div>
      <div class="screen" id="screen"><div class="panel" id="panel"></div></div>`;
    const q = (id) => root.querySelector('#' + id);
    this.el = {
      mode: q('mode'), wave: q('wave'), timer: q('timer'),
      hpBlue: q('hpBlue'), hpRed: q('hpRed'), hpBlueTxt: q('hpBlueTxt'), hpRedTxt: q('hpRedTxt'),
      inkFill: q('inkFill'), inkTxt: q('inkTxt'), boardmini: q('boardmini'), stamps: q('stamps'),
      status: q('status'), tip: q('tip'), msg: q('msg'), msgsub: q('msgsub'),
      floaters: q('floaters'), screen: q('screen'), panel: q('panel'),
    };
    this._tipT = 0; this._msgT = 0; this._boardKey = ''; this._stampKey = '';
    this.onScreenClick = null; this.onStampClick = null;
    this.el.screen.addEventListener('click', () => { if (this.onScreenClick) this.onScreenClick(); });
    this.el.stamps.addEventListener('click', (e) => {
      const b = e.target.closest('[data-type]'); if (!b || b.disabled) return;
      e.stopPropagation(); if (this.onStampClick) this.onStampClick(b.dataset.type);
    });
  }
  setMode(text) { this.el.mode.textContent = text; }
  setWave(text) { this.el.wave.textContent = text; }
  setTimer(text) { this.el.timer.textContent = text; }
  setStatus(text) { this.el.status.textContent = text; }
  setHp(b, r, mb, mr) {
    this.el.hpBlue.style.width = `${Math.max(0, b / mb * 100)}%`;
    this.el.hpRed.style.width = `${Math.max(0, r / mr * 100)}%`;
    this.el.hpBlueTxt.textContent = `${Math.ceil(b)}`; this.el.hpRedTxt.textContent = `${Math.ceil(r)}`;
  }
  setInk(v, max) {
    this.el.inkFill.style.width = `${Math.max(0, Math.min(100, v / max * 100))}%`;
    this.el.inkTxt.textContent = `${Math.floor(v)} / ${max}`;
  }
  setBoard(rows) {
    const key = rows.map((r) => `${r.name}|${r.tag}|${r.me ? 1 : 0}`).join(';');
    if (key === this._boardKey) return; this._boardKey = key;
    this.el.boardmini.innerHTML = rows.map((r) =>
      `<div class="row ${r.me ? 'me' : ''}"><i style="background:${r.color}"></i><span>${esc(r.name)}</span><b>${esc(r.tag)}</b></div>`).join('');
  }
  setStamps(types, selected, ink, unlocked) {
    const key = `${types.join(',')}|${selected}|${Math.floor(ink)}|${unlocked}`;
    if (key === this._stampKey) return; this._stampKey = key;
    this.el.stamps.innerHTML = types.map((t, i) => {
      const u = UNITS[t];
      const locked = i >= unlocked, poor = ink < u.cost;
      return `<button class="stamp ${t === selected ? 'on' : ''} ${locked || poor ? 'dim' : ''}" data-type="${t}" ${locked ? 'disabled' : ''}>
        <b>${esc(u.short)}</b><span>${esc(u.name)}</span><small>${u.cost} 墨 · ${esc(u.desc)}</small><kbd>${i + 1}</kbd></button>`;
    }).join('');
  }
  // short-lived damage number projected from a world position
  floater(px, py, text, cls = '') {
    const el = document.createElement('div');
    el.className = 'floater ' + cls;
    el.textContent = text;
    el.style.left = `${px}px`; el.style.top = `${py}px`;
    this.el.floaters.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
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

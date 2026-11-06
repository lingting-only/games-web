// HUD + menus: everything the player reads lives in DOM overlays styled like margin notes on
// the paper — the main menu, the online lobby panels, the in-game tally (stage flag, enemy
// icons left, lives, scores), and the stage intro / clear / game-over cards. main.js wires
// the callbacks; this module just draws and takes clicks.
const enc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class HUD {
  constructor(container) {
    this.root = container;
    this.cb = {};                      // action callbacks, wired by main.js
    this.root.innerHTML = `
      <div id="ui">
        <div class="panel" id="p-main">
          <div class="title-card">
            <div class="kicker">BATTLE CITY · 作业本版</div>
            <h1 class="game-title">涂鸦坦克</h1>
            <div class="sub">守住老鹰，画掉每一辆敌军坦克。</div>
          </div>
          <div class="menu">
            <button class="btn big" data-a="solo">单人闯关</button>
            <div class="row stage-pick">
              <span class="lbl">起始关卡</span>
              <button class="btn tiny" data-a="stage-prev">◀</button>
              <b class="stage-num" id="menu-stage">1</b>
              <button class="btn tiny" data-a="stage-next">▶</button>
            </div>
            <button class="btn big" data-a="online">联机合作</button>
            <div class="row">
              <button class="btn small" data-a="music">音乐：开</button>
              <button class="btn small" data-a="name">改名</button>
            </div>
            <fieldset class="appearance" id="appearance">
              <legend>视觉风格</legend>
              <div class="appearance-options">
                <label>
                  <input type="radio" name="appearance" value="notebook" checked>
                  <span class="appearance-card">
                    <span class="appearance-swatch notebook" aria-hidden="true"></span>
                    <strong>横线笔记本</strong>
                    <small>原版墨水与纸张</small>
                  </span>
                </label>
                <label>
                  <input type="radio" name="appearance" value="solid">
                  <span class="appearance-card">
                    <span class="appearance-swatch solid" aria-hidden="true"></span>
                    <strong>纯色</strong>
                    <small>平滑表面，无纸张线条</small>
                  </span>
                </label>
              </div>
              <p>仅影响你的画面 · 其他玩家可自行选择</p>
            </fieldset>
            <div class="best" id="best"></div>
          </div>
          <div class="hint">移动：方向键 / WASD　·　开火：空格 / J / 鼠标　·　支持手柄</div>
        </div>

        <div class="panel hidden" id="p-online">
          <h2 class="panel-title">联机合作 · 双人守家</h2>
          <div class="menu">
            <button class="btn big" data-a="quick">快速匹配</button>
            <button class="btn big" data-a="hostPublic">创建公开房</button>
            <button class="btn big" data-a="hostPrivate">创建私人房</button>
            <div class="row">
              <input id="join-code" class="input" maxlength="8" placeholder="房间码">
              <button class="btn" data-a="join">加入</button>
            </div>
          </div>
          <div class="status" id="online-status"></div>
          <button class="btn small back" data-a="back-main">返回</button>
        </div>

        <div class="panel hidden" id="p-lobby">
          <h2 class="panel-title">等待玩家</h2>
          <div class="lobby-code">房间码 <b id="lobby-code">—</b><button class="btn tiny" data-a="copy">复制</button></div>
          <div class="lobby-players" id="lobby-players"></div>
          <div class="row" id="lobby-host-tools">
            <span class="lbl">起始关卡</span>
            <button class="btn tiny" data-a="map-prev">◀</button>
            <b id="lobby-map">1</b>
            <button class="btn tiny" data-a="map-next">▶</button>
          </div>
          <div class="menu">
            <button class="btn big" data-a="start">开始战斗</button>
            <button class="btn small" data-a="leave">离开房间</button>
          </div>
          <div class="status" id="lobby-status"></div>
        </div>

        <div class="panel hidden" id="p-gameover">
          <h2 class="panel-title big" id="over-title">GAME OVER</h2>
          <div class="over-reason" id="over-reason"></div>
          <div class="score-table" id="over-scores"></div>
          <div class="menu">
            <button class="btn big" data-a="retry">再来一局</button>
            <button class="btn small" data-a="back-main">回主菜单</button>
          </div>
        </div>

        <div class="tally hidden" id="tally">
          <div class="t-row"><span class="t-lbl">STAGE</span><b id="t-stage">1</b></div>
          <div class="t-row enemies" id="t-enemies"></div>
          <div class="t-row"><span class="t-lbl" id="t-p1name">P1</span><span class="t-lives" id="t-lives">★★</span></div>
          <div class="t-row" id="t-p2row"><span class="t-lbl" id="t-p2name">P2</span><span class="t-lives" id="t-lives2"></span></div>
          <div class="t-row"><span class="t-lbl">SCORE</span><b id="t-score">0</b></div>
          <div class="t-row"><span class="t-lbl">最高</span><b id="t-best">0</b></div>
        </div>

        <div class="banner hidden" id="banner"></div>
        <div class="tips hidden" id="tips"></div>
      </div>`;
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'name') {
        const v = prompt('你的名字（最多 8 个字）', localStorage.getItem('tank_name') || '');
        if (v && v.trim()) { localStorage.setItem('tank_name', v.trim().slice(0, 8)); this.cb.rename && this.cb.rename(); }
        return;
      }
      if (a === 'copy') { navigator.clipboard && navigator.clipboard.writeText(this.code || ''); this.status('lobby', '已复制'); return; }
      this.cb[a] && this.cb[a]();
    });
    this.root.addEventListener('change', (e) => {
      if (e.target.name === 'appearance') this.cb.style && this.cb.style(e.target.value);
    });
    this.el = {};
    for (const id of ['p-main', 'p-online', 'p-lobby', 'p-gameover', 'tally', 'banner', 'tips', 'best', 'online-status', 'lobby-status', 'lobby-code', 'lobby-players', 'lobby-map', 'lobby-host-tools', 't-stage', 't-enemies', 't-lives', 't-lives2', 't-score', 't-best', 't-p1name', 't-p2name', 't-p2row', 'over-title', 'over-reason', 'over-scores', 'join-code', 'menu-stage']) this.el[id] = this.root.querySelector('#' + id);
    this.showPanel('main');
    this.refreshBest();
    this._tipT = null;
  }
  on(action, fn) { this.cb[action] = fn; }

  showPanel(name) {
    this.panel = name;
    for (const p of ['p-main', 'p-online', 'p-lobby', 'p-gameover']) this.el[p].classList.toggle('hidden', !({ main: 'p-main', online: 'p-online', lobby: 'p-lobby', over: 'p-gameover' }[name] === p));
    this.el.tally.classList.toggle('hidden', name !== null && name !== 'game');
  }
  hideAll() { this.showPanel(null); for (const p of ['p-main', 'p-online', 'p-lobby', 'p-gameover']) this.el[p].classList.add('hidden'); this.el.tally.classList.remove('hidden'); }
  refreshBest() { this.el.best.textContent = localStorage.getItem('tank_best') ? `最高分 ${localStorage.getItem('tank_best')}` : ''; }

  status(which, text) { (which === 'lobby' ? this.el['lobby-status'] : this.el['online-status']).textContent = text || ''; }

  renderLobby({ code, names, isHost, map, inMatch }) {
    this.code = code;
    this.el['lobby-code'].textContent = code || '—';
    this.el['lobby-map'].textContent = (map ?? 0) + 1;
    this.el['lobby-host-tools'].style.display = isHost ? '' : 'none';
    const slots = [names[0] || '房主', names[1] || '等待加入…'];
    this.el['lobby-players'].innerHTML = slots.map((n, i) => `<div class="lp ${names[i] ? 'full' : ''}">${i === 0 ? 'P1' : 'P2'} · ${enc(n)}</div>`).join('');
  }
  setMusicLabel(on) { const b = this.root.querySelector('[data-a="music"]'); if (b) b.textContent = `音乐：${on ? '开' : '关'}`; }
  setStage(n) { this.el['menu-stage'].textContent = n + 1; }
  setStyle(mode) { const r = this.root.querySelector(`input[name="appearance"][value="${mode}"]`); if (r) r.checked = true; }

  // ---- in-game tally ----
  setGame(info) {
    this.el['t-stage'].textContent = info.stage + 1;
    this.el['t-p1name'].textContent = info.p1;
    this.el['t-p2name'].textContent = info.p2 || 'P2';
    this.el['t-p2row'].style.display = info.coop ? '' : 'none';
    this.el['t-best'].textContent = info.best ?? '';
    this.updateTally(info);
  }
  updateTally({ enemiesLeft, lives, lives2, score, coop }) {
    const n = Math.max(0, Math.min(24, enemiesLeft));
    let icons = '';
    for (let i = 0; i < n; i++) icons += '<svg viewBox="0 0 20 20" class="tank-ico"><rect x="6" y="6" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2"/><rect x="9" y="1" width="2" height="5" fill="currentColor"/></svg>';
    this.el['t-enemies'].innerHTML = icons || '<span class="dim">场上无敌</span>';
    this.el['t-lives'].textContent = '★'.repeat(Math.max(0, lives));
    if (coop) this.el['t-lives2'].textContent = '★'.repeat(Math.max(0, lives2 ?? 0));
    this.el['t-score'].textContent = score;
  }

  // ---- overlays ----
  banner(text, sub = '', dur = 1600) {
    const b = this.el.banner;
    b.innerHTML = `<div class="banner-main">${enc(text)}</div>${sub ? `<div class="banner-sub">${enc(sub)}</div>` : ''}`;
    b.classList.remove('hidden');
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    clearTimeout(this._bT);
    if (dur > 0) this._bT = setTimeout(() => b.classList.add('hidden'), dur);
  }
  tip(text, dur = 1400) {
    const t = this.el.tips;
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(this._tipT);
    this._tipT = setTimeout(() => t.classList.add('hidden'), dur);
  }
  gameOver({ title, reason, scores }) {
    this.el['over-title'].textContent = title;
    this.el['over-reason'].textContent = reason || '';
    this.el['over-scores'].innerHTML = scores.map((s) => `<div class="sc-row"><span>${enc(s.name)}</span><b>${s.score}</b></div>`).join('');
    this.showPanel('over');
  }
}

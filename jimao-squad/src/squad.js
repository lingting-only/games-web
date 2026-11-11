// 几猫港区 · 突击小队
// 在《几猫国产3A大作》单文件本体的外面加一层联机玩法。本体把调试入口挂在 window.__G，
// 里面是完整的 THREE / scene / camera / player / enemies / level / hud / game / events，
// 因此这里不需要改动任何一行压缩过的原代码：所有接入都通过公开对象、事件总线与少量包装完成。
import { Net } from './net.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (s) => { const n = Math.max(0, Math.floor(s)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
const COLORS = [0xffb347, 0x7fd6c2, 0xd39ae8, 0x94b9f2];
const CSS_COLORS = ['#ffb347', '#7fd6c2', '#d39ae8', '#94b9f2'];
const CMDS = ['集合，向我靠拢', '掩护我，我去切中继', '敌情密集，注意回血', '需要救援！'];
const MAX_PLAYERS = 4;
const DOWN_SECONDS = 25;
const REVIVE_SECONDS = 2.6;
const POSE_INTERVAL = 66;

class Squad {
  constructor() {
    this.G = null;
    this.net = new Net({ maxPlayers: MAX_PLAYERS });
    this.phase = 'idle';                 // idle | lobby | playing | over
    this.rosterList = [];
    this.members = new Map();            // id -> { ...state, avatar, label, pose }
    this.relays = [];                    // 权威中继 id 列表
    this.cutMap = {};
    this.cut = 0; this.total = 3; this.allCut = false;
    this.startedAt = 0;
    this.me = { down: false, out: false, ready: false, kills: 0, revives: 0, health: 100 };
    this.auth = null;                    // 仅房主使用
    this.downAt = 0; this.reviveTarget = null; this.reviveT = 0;
    this.lastPose = 0; this.lastState = 0; this.lastFrame = 0;
    this.pendingStart = 0; this.finishInfo = null;
    this.hooks = false;
  }

  // ---------------------------------------------------------------- 启动
  async init() {
    const G = await waitForGame();
    this.G = G;
    this.buildUI();
    this.bindUI();
    this.bindNet();
    this.hookGame();
    this.requestAnimationFrameLoop();
    const room = new URLSearchParams(location.search).get('room');
    if (room) {
      $('#sq-join-code', this.ui).value = room.toUpperCase();
      this.openLobby();
      this.joinRoom(room);
    }
    window.__SQUAD = this;
  }

  get myName() { return ($('#sq-name', this.ui)?.value || '几猫队员').trim().slice(0, 12) || '几猫队员'; }
  get myId() { return this.net.id; }
  get playing() { return this.phase === 'playing' && this.net.active; }
  get isHost() { return this.net.isHost; }
  get seat() { const p = this.rosterList.find((x) => x.id === this.myId); return p ? p.seat : 0; }

  // ---------------------------------------------------------------- UI
  buildUI() {
    const ui = document.createElement('div');
    ui.id = 'sq';
    ui.className = 'sq-root';
    ui.innerHTML = `
      <div class="sq-lobby" id="sq-lobby" hidden>
        <div class="sq-card">
          <div class="sq-card-h">
            <div>
              <div class="k">PORT AUTHORITY · CO-OP CHANNEL</div>
              <h2>突击小队</h2>
              <p>2–4 人协同切断三处中继，全队登船撤离。房主的浏览器负责裁决。</p>
            </div>
            <div class="sq-badge" id="sq-room-info">未连接</div>
          </div>
          <div class="sq-body">
            <div class="sq-col">
              <div class="sq-sec">
                <span class="k">队员代号</span>
                <input class="sq-field" id="sq-name" maxlength="12" placeholder="输入你的代号" value="${esc(this.savedName())}">
              </div>
              <div class="sq-sec">
                <span class="k">建立小队</span>
                <div class="sq-btn-row">
                  <button class="sq-btn" id="sq-host">私人房 · 房间码</button>
                  <button class="sq-btn" id="sq-host-public">公开房 · 可被匹配</button>
                </div>
                <div class="sq-code" id="sq-code-box" hidden>
                  <div><div class="k">房间码 · 发给队友</div><b id="sq-code-text">-----</b></div>
                  <button class="sq-btn ghost" id="sq-copy">复制</button>
                </div>
              </div>
              <div class="sq-sec">
                <span class="k">加入小队</span>
                <div class="sq-row">
                  <input class="sq-field mono" id="sq-join-code" maxlength="8" placeholder="5 位房间码">
                  <button class="sq-btn" id="sq-join">加入</button>
                </div>
                <div class="sq-quick"><button class="sq-btn ghost wide" id="sq-quick">快速匹配公开小队</button></div>
              </div>
              <p class="sq-hint" id="sq-hint">联机使用 WebRTC 点对点，需要能访问 PeerJS 公共信令服务。</p>
            </div>
            <div class="sq-col">
              <div class="sq-sec">
                <span class="k">席位 · <span id="sq-seat-count">0/${MAX_PLAYERS}</span></span>
                <div class="sq-seats" id="sq-seats"></div>
              </div>
              <button class="sq-btn primary wide sq-start" id="sq-start" hidden>开始行动 · 全队出击</button>
              <p class="sq-hint" id="sq-wait" hidden>等待房主开始行动。所有人准备好后由房主发起。</p>
              <div class="sq-sec">
                <span class="k">行动简报</span>
                <p class="sq-hint" style="margin-top:0">
                  · 任意队员切断中继，全队共享进度；三处断完撤离艇才接应。<br>
                  · 倒地不会被直接淘汰，靠近队友按住 <b>E</b> 可救援。<br>
                  · 所有存活队员进入撤离圈才算完成任务。<br>
                  · 游戏内按 <b>1–4</b> 发送战术指令，<b>Esc</b> 暂停本机。
                </p>
              </div>
            </div>
          </div>
          <div class="sq-foot">
            <span id="sq-net-state">P2P · 无需游戏服务器 · 房间码即地址</span>
            <button class="sq-btn ghost" id="sq-back">返回单人任务</button>
          </div>
        </div>
      </div>

      <div class="sq-hud" id="sq-hud" hidden>
        <div class="sq-team"><span class="k">SQUAD · 小队状态</span><div id="sq-team-list"></div></div>
        <div class="sq-mission">
          <span class="k">OBJECTIVE · 共享任务</span>
          <div class="pips" id="sq-pips"></div>
          <div class="phase" id="sq-phase">切断三处上行中继</div>
        </div>
        <div class="sq-labels" id="sq-labels"></div>
        <div class="sq-toast" id="sq-toast"></div>
        <div class="sq-down" id="sq-down" hidden>
          <b>信号中断 · 等待救援</b>
          <span>靠近队友并让他按住 E 即可救起你 · <span id="sq-down-time">25</span>s 后失联</span>
        </div>
        <div class="sq-cmd" id="sq-cmd"></div>
      </div>

      <div class="sq-result" id="sq-result" hidden>
        <div class="sq-card">
          <div class="sq-card-h" style="justify-content:center;text-align:center;border-bottom:0">
            <div><div class="k">AFTER ACTION REPORT · 四号泊位</div>
              <h2 id="sq-result-title">行动结束</h2>
              <p class="sub" id="sq-result-sub"></p></div>
          </div>
          <dl class="sq-stats" id="sq-result-stats"></dl>
          <div class="sq-actions">
            <button class="sq-btn primary" id="sq-again" hidden>再来一次</button>
            <button class="sq-btn" id="sq-exit">离开小队</button>
          </div>
        </div>
      </div>`;
    $('#ui').appendChild(ui);
    this.ui = ui;
    $('#sq-cmd', ui).innerHTML = CMDS.map((c, i) => `<button data-cmd="${i}"><kbd>${i + 1}</kbd>${esc(c)}</button>`).join('');
    this.renderSeats();
    this.renderTeam();
    this.renderMission();

    // 标题页：在原菜单的按钮组里插入组队入口，宽度对齐上面一排按钮的总长
    const actions = $('.m-title .m-actions');
    if (actions) {
      const originals = [...actions.children].filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0);
      const btn = document.createElement('button');
      btn.className = 'sq-inline';
      btn.innerHTML = '联机组队 · 突击小队<small>2–4 人 CO-OP / 房间码 / 快速匹配</small>';
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.openLobby(); });
      actions.appendChild(btn);
      const fit = () => {
        const visible = originals.filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0);
        if (!visible.length) return;
        const left = Math.min(...visible.map((el) => el.offsetLeft));
        const right = Math.max(...visible.map((el) => el.offsetLeft + el.offsetWidth));
        const w = Math.round(right - left);
        btn.style.width = w > 140 ? `${w}px` : '';
      };
      fit();
      addEventListener('resize', fit);
    }
  }

  savedName() {
    try { return localStorage.getItem('jimao-squad-name') || '几猫队员'; } catch (e) { return '几猫队员'; }
  }
  saveName() { try { localStorage.setItem('jimao-squad-name', this.myName); } catch (e) { /* ignore */ } }

  bindUI() {
    const on = (id, ev, fn) => { const el = $('#' + id, this.ui); if (el) el.addEventListener(ev, fn); };
    on('sq-name', 'change', () => this.saveName());
    on('sq-host', 'click', () => this.createRoom(false));
    on('sq-host-public', 'click', () => this.createRoom(true));
    on('sq-join', 'click', () => this.joinRoom($('#sq-join-code', this.ui).value));
    on('sq-quick', 'click', () => this.quickJoin());
    on('sq-join-code', 'keydown', (e) => { if (e.key === 'Enter') this.joinRoom(e.target.value); });
    on('sq-copy', 'click', () => {
      const code = this.net.code || '';
      const url = `${location.origin}${location.pathname}?room=${code}`;
      const copy = navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject();
      copy.then(() => this.setHint(`邀请链接已复制：${url}`, 'ok')).catch(() => this.setHint(`房间码：${code}（请手动发给队友）`, 'ok'));
    });
    on('sq-start', 'click', () => this.startMission());
    on('sq-back', 'click', () => this.leaveRoom());
    on('sq-again', 'click', () => {
      if (this.isHost) { this.net.broadcast('reset', {}); this.backToLobby(); }
      else this.setHint('等待房主重新发起行动');
    });
    on('sq-exit', 'click', () => this.leaveRoom());
    $('#sq-cmd', this.ui).addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]'); if (b) this.sendCmd(+b.dataset.cmd);
    });
    addEventListener('keydown', (e) => {
      if (!this.playing || e.repeat) return;
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA/.test(tag)) return;
      if (/^[1-4]$/.test(e.key)) this.sendCmd(+e.key - 1);
    });
  }

  setHint(text, kind = '') {
    const el = $('#sq-hint', this.ui); if (!el) return;
    el.textContent = text; el.className = 'sq-hint' + (kind ? ' ' + kind : '');
  }
  busy(on) {
    for (const id of ['sq-host', 'sq-host-public', 'sq-join', 'sq-quick']) {
      const el = $('#' + id, this.ui); if (el) el.disabled = on;
    }
  }
  openLobby() {
    if (this.phase === 'playing') return;
    this.phase = 'lobby';
    $('#sq-lobby', this.ui).hidden = false;
    $('#sq-hud', this.ui).hidden = true;
    $('#sq-result', this.ui).hidden = true;
    this.renderSeats();
  }
  closeLobby() { $('#sq-lobby', this.ui).hidden = true; }

  renderSeats() {
    const box = $('#sq-seats', this.ui); if (!box) return;
    const list = this.rosterList;
    $('#sq-seat-count', this.ui).textContent = `${list.length}/${MAX_PLAYERS}`;
    box.innerHTML = Array.from({ length: MAX_PLAYERS }, (_, i) => {
      const p = list.find((x) => x.seat === i);
      if (!p) return `<div class="sq-seat empty"><span class="num">0${i + 1}</span><span class="dot" style="color:var(--steel)"></span><span class="who">等待队员</span><span class="tag">空位</span></div>`;
      const isMe = p.id === this.myId;
      return `<div class="sq-seat"><span class="num">0${i + 1}</span><span class="dot" style="color:${CSS_COLORS[i % 4]}"></span>
        <span class="who">${esc(p.name)}</span><span class="tag ${p.host ? 'host' : ''}">${p.host ? '房主' : isMe ? '你' : '队员'}</span></div>`;
    }).join('');
    const start = $('#sq-start', this.ui), wait = $('#sq-wait', this.ui);
    if (start) { start.hidden = !this.isHost || this.phase !== 'lobby'; start.textContent = list.length > 1 ? `开始行动 · ${list.length} 人出击` : '开始行动 · 独自出击'; }
    if (wait) wait.hidden = this.isHost || this.phase !== 'lobby';
    const badge = $('#sq-room-info', this.ui);
    if (badge) badge.textContent = this.net.code ? `${this.net.isPublic ? '公开' : '私人'} · ${this.net.code}` : '未连接';
    const codeBox = $('#sq-code-box', this.ui);
    if (codeBox) codeBox.hidden = !this.net.code;
    $('#sq-code-text', this.ui).textContent = this.net.code || '-----';
    $('#sq-net-state', this.ui).textContent = this.net.active
      ? `已连接 · ${this.net.isHost ? '你是房主（裁决端）' : '队员'} · 发送 ${this.net.stats.sent} / 接收 ${this.net.stats.recv}`
      : 'P2P · 无需游戏服务器 · 房间码即地址';
  }

  renderTeam() {
    const box = $('#sq-team-list', this.ui); if (!box) return;
    const list = this.rosterList.length ? this.rosterList : [{ id: this.myId, name: this.myName, seat: 0, host: true }];
    box.innerHTML = list.map((p) => {
      const m = this.members.get(p.id) || {};
      const down = !!m.down, out = !!m.out;
      const hp = clamp(Math.round(m.health == null ? 100 : m.health), 0, 100);
      const state = out ? '失联' : down ? '倒地' : m.ready ? '已到撤离点' : `${m.kills || 0} 击毁`;
      return `<div class="sq-member ${down ? 'down' : ''} ${out ? 'out' : ''}" data-id="${esc(p.id)}">
        <i class="dot" style="color:${CSS_COLORS[p.seat % 4]}"></i>
        <div class="info"><div class="nm"><b>${esc(p.name)}${p.id === this.myId ? ' · 你' : ''}</b><span class="${down || out ? 'state' : ''}">${state}</span></div>
        <div class="sq-bar"><i style="width:${out ? 0 : hp}%"></i></div></div></div>`;
    }).join('');
  }

  renderMission() {
    const pips = $('#sq-pips', this.ui), phase = $('#sq-phase', this.ui);
    if (!pips || !phase) return;
    pips.innerHTML = Array.from({ length: this.total }, (_, i) => `<i class="${i < this.cut ? 'cut' : ''}"></i>`).join('');
    const arrived = this.rosterList.filter((p) => (this.members.get(p.id) || {}).ready).length;
    phase.innerHTML = this.allCut
      ? `撤离艇已接应 · <b>${arrived}/${this.rosterList.length}</b> 到位`
      : `切断上行中继 · <b>${this.cut}/${this.total}</b> · 全队共享`;
  }

  toast(text, kind = '') {
    const box = $('#sq-toast', this.ui); if (!box) return;
    const el = document.createElement('div');
    el.innerHTML = kind === 'cmd' ? `<b>无线电</b> ${esc(text)}` : esc(text);
    box.appendChild(el);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .5s'; setTimeout(() => el.remove(), 520); }, 3400);
  }

  // ---------------------------------------------------------------- 房间
  bindNet() {
    const n = this.net;
    n.onRoster = (list) => { this.syncRoster(list); };
    n.onDisconnect = () => {
      this.setHint('与房主的连接中断，请重新加入小队', 'err');
      this.toast('与小队失去连接', 'cmd');
      this.phase = 'lobby';
      n.leave(); this.syncRoster([]);
      this.clearAvatars();
      $('#sq-hud', this.ui).hidden = true;
      this.openLobby();
    };
    n.on('welcome', (d) => { if (d && d.list) this.syncRoster(d.list); });
    n.on('roster', (d) => { if (d && d.list) this.syncRoster(d.list); });
    n.on('leave', (d) => { if (d && d.id) { this.toast('一名队员离开了小队'); this.members.delete(d.id); if (this.auth) delete this.auth.members[d.id]; } });
    n.on('hello', (d, from) => { if (this.isHost) this.pushState(); });
    n.on('start', (d) => this.scheduleStart(d));
    n.on('reset', () => this.backToLobby());
    n.on('finish', (d) => this.finishLocal(d));
    n.on('state', (d) => this.applyState(d));
    n.on('event', (d) => this.toast(d.text, d.kind));
    n.on('pose', (d, from) => this.applyPose(from, d));
    n.on('fire', (d, from) => { const m = this.members.get(from); if (m && m.avatar) m.avatar.flash = 0.09; });
    n.on('cmd', (d, from) => {
      const p = this.rosterList.find((x) => x.id === from);
      const text = `${p ? p.name : '队员'}：${CMDS[d.i] || ''}`;
      this.toast(text, 'cmd');
      try { this.G.hud.radio?.(text, 2.4); } catch (e) { /* ignore */ }
    });
    for (const type of ['relay', 'kill', 'down', 'out', 'revive', 'arrive', 'unarrive']) {
      n.on(type, (d, from) => { if (this.isHost) this.onHostMessage(type, d, from); });
    }
  }

  syncRoster(list) {
    const prev = new Set(this.rosterList.map((p) => p.id));
    this.rosterList = (list || []).slice(0, MAX_PLAYERS);
    const now = new Set(this.rosterList.map((p) => p.id));
    for (const p of this.rosterList) {
      if (!this.members.has(p.id)) this.members.set(p.id, { id: p.id, name: p.name, seat: p.seat, health: 100, down: false, out: false, kills: 0, revives: 0, ready: false, pose: null });
      else Object.assign(this.members.get(p.id), { name: p.name, seat: p.seat });
      if (!prev.has(p.id) && prev.size) this.toast(`${p.name} 加入了小队`);
    }
    for (const id of [...this.members.keys()]) if (!now.has(id) && id !== this.myId) {
      this.removeAvatar(this.members.get(id)); this.members.delete(id);
    }
    if (this.isHost) this.syncAuth();
    if (this.phase === 'playing') this.ensureAvatars();
    this.renderSeats(); this.renderTeam();
  }

  syncAuth() {
    if (!this.auth) return;
    for (const p of this.rosterList) {
      if (!this.auth.members[p.id]) this.auth.members[p.id] = { id: p.id, name: p.name, seat: p.seat, health: 100, down: false, out: false, kills: 0, revives: 0, ready: false };
      else Object.assign(this.auth.members[p.id], { name: p.name, seat: p.seat });
    }
    for (const id of Object.keys(this.auth.members)) if (!this.rosterList.some((p) => p.id === id)) delete this.auth.members[id];
  }

  async createRoom(isPublic) {
    this.saveName(); this.busy(true); this.setHint('正在向信令服务注册房间…');
    try {
      const code = await this.net.host({ isPublic, name: this.myName });
      this.phase = 'lobby';
      this.auth = this.freshAuth();
      this.syncRoster(this.net.roster);
      this.setHint(`房间 ${code} 已就绪，把房间码或邀请链接发给队友。`, 'ok');
    } catch (e) { this.setHint(`建立失败：${e.message || e}`, 'err'); }
    this.busy(false); this.renderSeats();
  }

  async joinRoom(code) {
    this.saveName(); this.busy(true); this.setHint('正在呼叫小队…');
    try {
      const welcome = await this.net.join(code, this.myName);
      this.phase = 'lobby';
      this.syncRoster((welcome && welcome.list) || []);
      this.net.send('hello', { name: this.myName });
      this.setHint(`已加入房间 ${this.net.code}，等待房主开始行动。`, 'ok');
    } catch (e) { this.setHint(`加入失败：${e.message || e}`, 'err'); }
    this.busy(false); this.renderSeats();
  }

  async quickJoin() {
    this.saveName(); this.busy(true);
    try {
      // 快速匹配拿到的是探测阶段的名单，正式 welcome 会随后补齐自己的席位
      const welcome = await this.net.quickJoin(this.myName, (s) => this.setHint(s));
      this.phase = 'lobby';
      this.syncRoster((welcome && welcome.list) || []);
      this.net.send('hello', { name: this.myName });
      this.setHint(`已加入公开小队 ${this.net.code}。`, 'ok');
    } catch (e) { this.setHint(`匹配失败：${e.message || e}`, 'err'); }
    this.busy(false); this.renderSeats();
  }

  leaveRoom() {
    clearTimeout(this.pendingStart);
    this.net.leave();
    this.auth = null;
    this.phase = 'idle';
    this.rosterList = [];
    this.members.clear();
    this.clearAvatars();
    this.cut = 0; this.allCut = false; this.cutMap = {};
    this.me = { down: false, out: false, ready: false, kills: 0, revives: 0, health: 100 };
    $('#sq-hud', this.ui).hidden = true;
    $('#sq-result', this.ui).hidden = true;
    $('#sq-down', this.ui).hidden = true;
    this.closeLobby();
    try {
      const G = this.G;
      G.enemies.clear?.(); G.player.enabled = false; G.player.alive = true;
      G.weapon.setVisible?.(false); G.hud.show?.(false);
      G.game.state = 'title'; G.game.menus?.show('title');
    } catch (e) { /* ignore */ }
    this.setHint('联机使用 WebRTC 点对点，需要能访问 PeerJS 公共信令服务。');
    this.renderSeats(); this.renderTeam(); this.renderMission();
  }

  freshAuth() {
    return {
      members: {}, relays: {}, cut: 0, allCut: false,
      startedAt: Date.now(), finished: false
    };
  }

  // ---------------------------------------------------------------- 开局
  startMission() {
    if (!this.isHost || this.phase !== 'lobby') return;
    this.auth = this.freshAuth();
    // 与本体 mM 的中继 id 规则一致：没有 id 时就是 relay_0 / relay_1 / …
    this.relays = (this.G.level?.objectives || []).map((o, i) => o.id || `relay_${i}`);
    const at = Date.now() + 1400;
    this.net.broadcast('start', { at, relays: this.relays, total: this.relays.length || 3 });
    this.scheduleStart({ at, relays: this.relays, total: this.relays.length || 3 });
  }

  scheduleStart(d) {
    clearTimeout(this.pendingStart);
    this.relays = d.relays || [];
    this.total = d.total || this.relays.length || 3;
    this.setHint('行动即将开始…', 'ok');
    this.toast('突击小队，action！');
    this.pendingStart = setTimeout(() => this.beginPlay(), Math.max(0, (d.at || Date.now()) - Date.now()));
  }

  beginPlay() {
    if (this.phase === 'playing') return;
    const G = this.G;
    this.phase = 'playing';
    this.cut = 0; this.allCut = false; this.cutMap = {};
    this.startedAt = Date.now();
    this.me = { down: false, out: false, ready: false, kills: 0, revives: 0, health: 100 };
    this.downAt = 0; this.reviveTarget = null; this.reviveT = 0;
    this.finishInfo = null;
    for (const m of this.members.values()) { m.down = false; m.out = false; m.ready = false; m.kills = 0; m.revives = 0; m.health = 100; m.pose = null; }
    if (this.isHost) this.auth = this.freshAuth(), this.syncAuth();
    this.closeLobby();
    $('#sq-result', this.ui).hidden = true;
    $('#sq-hud', this.ui).hidden = false;
    $('#sq-down', this.ui).hidden = true;
    try {
      G.audio?.resume?.();
      G.game.start({ skipIntro: true });
      const seat = this.seat, a = seat * Math.PI / 2;
      G.player.pos.x += Math.cos(a) * 0.8;
      G.player.pos.z += Math.sin(a) * 0.8;
      G.player.lastSafe?.copy(G.player.pos);
      G.player.enabled = true;
      G.hud.show?.(true);
      G.hud.setObjective?.('切断三处上行中继 · 全队共享');
      G.hud.setRelays?.(0, this.total);
      this.updateMarkers();
      G.hud.message?.('小队频道已接通 · 点击画面可锁定鼠标', 3.5);
    } catch (e) { console.error('[squad] beginPlay', e); }
    this.ensureAvatars();
    this.renderTeam(); this.renderMission();
    this.toast('切断三处中继，然后全队登船撤离');
    if (this.isHost) this.pushState();
  }

  backToLobby() {
    clearTimeout(this.pendingStart);
    this.phase = 'lobby';
    this.finishInfo = null;
    this.clearAvatars();
    this.cut = 0; this.allCut = false; this.cutMap = {};
    this.me = { down: false, out: false, ready: false, kills: 0, revives: 0, health: 100 };
    for (const m of this.members.values()) { m.down = false; m.out = false; m.ready = false; m.kills = 0; m.revives = 0; m.health = 100; m.pose = null; }
    if (this.isHost) this.auth = this.freshAuth(), this.syncAuth();
    $('#sq-hud', this.ui).hidden = true;
    $('#sq-result', this.ui).hidden = true;
    $('#sq-down', this.ui).hidden = true;
    try {
      const G = this.G;
      G.enemies.clear?.(); G.player.enabled = false; G.player.alive = true; G.player.health = 100;
      G.weapon.setVisible?.(false); G.hud.show?.(false); G.hud.clearRadio?.();
      G.game.state = 'title'; G.game.menus?.show('title');
    } catch (e) { /* ignore */ }
    this.openLobby();
    this.setHint('小队已回到大厅，房主可以再次发起行动。', 'ok');
    this.renderSeats(); this.renderTeam(); this.renderMission();
  }

  // ---------------------------------------------------------------- 接入本体
  hookGame() {
    if (this.hooks) return;
    this.hooks = true;
    const G = this.G, self = this;

    // 致命伤改为「倒地待救援」，而不是单机版的直接失败
    const origDamage = G.player.damage;
    G.player.damage = function (amount, from, ...rest) {
      if (!self.playing || self.me.down || self.me.out) return origDamage.call(G.player, amount, from, ...rest);
      if (G.player.health - (amount || 0) <= 0) { self.goDown(); return; }
      return origDamage.call(G.player, amount, from, ...rest);
    };

    // 单机的「撤离成功」改写成全队撤离进度；「死亡」界面在联机中不应出现
    const origUpdate = G.game.update;
    G.game.update = function (dt) {
      const r = origUpdate(dt);
      if (self.playing) {
        if (G.game.state === 'complete') { self.onLocalExtract(); self.restorePlaying(); }
        else if (G.game.state === 'dead') self.restorePlaying();
        if (self.reviveTarget) {
          const m = self.members.get(self.reviveTarget);
          try { G.hud.setPrompt?.('救援 ' + (m ? m.name : '队友'), clamp(self.reviveT / REVIVE_SECONDS, 0, 1)); } catch (e) { /* ignore */ }
        }
        if (self.me.down) G.player.health = 0;
      }
      return r;
    };

    G.events.on('objective:done', (d) => { if (self.playing) self.toHost('relay', { id: d && d.id }); });
    G.events.on('enemy:killed', () => { if (self.playing) self.toHost('kill', {}); });
    G.events.on('weapon:fire', () => { if (self.playing) self.net.send('fire', {}, true); });
    G.events.on('objective:all', () => { if (self.playing) self.toast('三处中继全部断开 · 全队前往撤离艇'); });
  }

  restorePlaying() {
    const G = this.G;
    try {
      G.game.state = 'playing';
      G.game.menus?.show('none');
      G.game.menus?.locationCard?.(false);
      G.hud.clearRadio?.();
      G.hud.show?.(true);
      G.player.invulnerable = false;
      G.player.enabled = !this.me.down && !this.me.out;
      G.weapon.setVisible?.(!this.me.down && !this.me.out);
      G.input.setGameplay?.(!this.me.down && !this.me.out);
      if (G.render?.post) G.render.post.fade = 0;
    } catch (e) { console.error('[squad] restorePlaying', e); }
  }

  toHost(type, data) {
    if (this.isHost) this.onHostMessage(type, data, this.myId);
    else this.net.send(type, data);
  }

  onHostMessage(type, d = {}, from = this.myId) {
    if (!this.isHost || !this.auth) return;
    const a = this.auth, m = a.members[from], name = m ? m.name : '队员';
    switch (type) {
      case 'relay': {
        const id = String(d.id || '');
        if (!id || (a.relays[id] && a.relays[id].cut)) break;
        a.relays[id] = { cut: true, by: from };
        a.cut++;
        const idx = this.relays.indexOf(id);
        this.event(`${name} 切断了中继 ${idx >= 0 ? String.fromCharCode(65 + idx) : ''}`, 'relay');
        if (a.cut >= this.total && !a.allCut) { a.allCut = true; this.event('三处中继全部断开！全队前往撤离艇', 'relay'); }
        this.pushState();
        this.checkFinish();
        break;
      }
      case 'kill': if (m) { m.kills++; this.pushState(); } break;
      case 'down': if (m) { m.down = true; m.out = false; m.ready = false; this.event(`${name} 倒地，需要队友救援！`, 'down'); this.pushState(); } break;
      case 'out': if (m) { m.down = false; m.out = true; m.ready = false; this.event(`${name} 失去联络`, 'down'); this.pushState(); this.checkFinish(); } break;
      case 'revive': {
        const t = a.members[d.target];
        if (t && t.down && !t.out) {
          t.down = false; t.health = 45;
          if (m) m.revives++;
          this.event(`${name} 救起了 ${t.name}`, 'revive');
          this.pushState();
        }
        break;
      }
      case 'arrive': if (m) { m.ready = true; this.pushState(); this.checkFinish(); } break;
      case 'unarrive': if (m) { m.ready = false; this.pushState(); } break;
      default: break;
    }
  }

  event(text, kind) {
    this.toast(text, kind);
    this.net.broadcast('event', { text, kind });
    try { if (kind === 'relay' || kind === 'down') this.G.hud.radio?.(text, 2.8); } catch (e) { /* ignore */ }
  }

  statePayload() {
    const list = Object.values(this.auth.members).map((m) => ({ ...m }));
    return {
      phase: 'playing', at: this.auth.startedAt,
      total: this.total, cut: this.auth.cut, allCut: this.auth.allCut,
      relays: this.auth.relays, members: list
    };
  }

  pushState() {
    if (!this.isHost || !this.auth) return;
    this.lastState = performance.now();
    const d = this.statePayload();
    this.net.broadcast('state', d);
    this.applyState(d);
  }

  applyState(d) {
    if (!d) return;
    const wasDown = this.me.down;
    this.total = d.total || this.total;
    this.cut = d.cut || 0;
    this.allCut = !!d.allCut;
    this.cutMap = d.relays || {};
    for (const s of d.members || []) {
      let m = this.members.get(s.id);
      if (!m) { m = { id: s.id, pose: null }; this.members.set(s.id, m); }
      Object.assign(m, s);
      if (s.id === this.myId) {
        this.me.down = !!s.down; this.me.out = !!s.out;
        this.me.ready = !!s.ready; this.me.kills = s.kills || 0;
        this.me.revives = s.revives || 0; this.me.health = s.health == null ? 100 : s.health;
      }
    }
    if (this.phase === 'playing') {
      this.applyRelays();
      if (wasDown && !this.me.down && !this.me.out) this.reviveMe();
      if (this.me.out) this.showDownUI(true);
      else if (this.me.down) this.showDownUI(false);
    }
    this.renderTeam(); this.renderMission();
  }

  applyRelays() {
    const G = this.G, run = G.game.run;
    if (!run || !run.relays) return;
    let changed = false;
    for (const r of run.relays) {
      const cut = !!(this.cutMap[r.id] && this.cutMap[r.id].cut);
      if (cut && !r.cut) {
        r.cut = true; r.cutting = false; r.t = 1;
        try { r.o?.object?.userData?.setState?.('cut'); } catch (e) { /* ignore */ }
        try { G.enemies.alert?.(r.o.pos, 60); } catch (e) { /* ignore */ }
        changed = true;
      }
    }
    run.cut = this.cut;
    run.allCut = this.allCut;
    if (changed || this.allCut) {
      try {
        G.hud.setRelays?.(this.cut, this.total);
        G.hud.setObjective?.(this.allCut ? '全队前往撤离艇集合' : `切断剩余 ${Math.max(0, this.total - this.cut)} 处中继 · 全队共享`);
        this.updateMarkers();
      } catch (e) { /* ignore */ }
    }
  }

  updateMarkers() {
    const G = this.G, run = G.game.run;
    if (!G.hud.setMarkers || !run || !run.relays) return;
    const list = run.relays.filter((r) => !r.cut).map((r) => ({ id: r.id, short: r.short, label: r.o?.label || '中继 ' + r.short, pos: r.o?.pos, kind: 'relay' }));
    if (this.allCut && G.level.extraction) list.push({ id: 'extract', short: '撤离', label: '撤离艇', pos: G.level.extraction.pos, kind: 'extract' });
    try { G.hud.setMarkers(list); } catch (e) { /* ignore */ }
  }

  goDown() {
    if (this.me.down || this.me.out) return;
    const G = this.G;
    this.me.down = true; this.me.health = 0; this.downAt = performance.now();
    this.reviveTarget = null; this.reviveT = 0;
    try {
      G.player.health = 0; G.player.alive = false; G.player.enabled = false;
      G.weapon.setVisible?.(false); G.input.setGameplay?.(false);
      G.hud.message?.('你已倒地 · 等待队友救援', 4);
      G.hud.setPrompt?.(null);
    } catch (e) { /* ignore */ }
    this.showDownUI(false);
    this.toHost('down', {});
  }

  showDownUI(out) {
    const box = $('#sq-down', this.ui); if (!box) return;
    box.hidden = !this.me.down && !this.me.out;
    box.querySelector('b').textContent = out ? '信号丢失 · 观战中' : '信号中断 · 等待救援';
    box.querySelector('span').innerHTML = out
      ? '队友仍在行动，等待本次任务结束。'
      : `靠近队友并让他按住 E 即可救起你 · <span id="sq-down-time">${DOWN_SECONDS}</span>s 后失联`;
  }

  reviveMe() {
    const G = this.G;
    this.me.down = false; this.me.out = false; this.me.health = 45;
    this.downAt = 0; this.reviveT = 0;
    try {
      G.player.alive = true; G.player.health = 45; G.player.enabled = true;
      G.weapon.setVisible?.(true); G.input.setGameplay?.(true);
      G.hud.message?.('已被队友救起，返回战斗', 3);
      G.hud.setPrompt?.(null);
    } catch (e) { /* ignore */ }
    $('#sq-down', this.ui).hidden = true;
    this.toast('你已被队友救起');
  }

  onLocalExtract() {
    if (this.me.ready || !this.playing || this.me.down || this.me.out) return;
    this.me.ready = true;
    this.toHost('arrive', {});
    this.toast('你已到达撤离点，等待队友集合');
    try { this.G.hud.message?.('已到撤离点 · 等待全队集合', 3); } catch (e) { /* ignore */ }
  }

  sendCmd(i) {
    if (!this.playing || !CMDS[i]) return;
    this.net.send('cmd', { i }, true);
    this.toast(`${this.myName}：${CMDS[i]}`, 'cmd');
    try { this.G.hud.radio?.(CMDS[i], 2.2); } catch (e) { /* ignore */ }
  }

  checkFinish() {
    if (!this.isHost || !this.auth || this.auth.finished) return;
    const list = Object.values(this.auth.members);
    if (!list.length) return;
    const alive = list.filter((m) => !m.out);
    if (!alive.length) { this.finish(false); return; }
    // 倒地的队员由队友救起或超时失联后才不阻塞撤离；全队倒地不算完成
    const standing = alive.filter((m) => !m.down);
    if (this.auth.allCut && standing.length && standing.every((m) => m.ready)) this.finish(true);
  }

  finish(win) {
    if (!this.isHost || !this.auth || this.auth.finished) return;
    this.auth.finished = true;
    const list = Object.values(this.auth.members);
    const d = {
      win, at: Date.now(), start: this.auth.startedAt,
      kills: list.reduce((s, m) => s + m.kills, 0),
      revives: list.reduce((s, m) => s + m.revives, 0),
      cut: this.auth.cut, total: this.total,
      members: list.length
    };
    this.net.broadcast('finish', d);
    this.finishLocal(d);
  }

  finishLocal(d) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.finishInfo = d;
    clearTimeout(this.pendingStart);
    const G = this.G;
    try {
      G.player.enabled = false; G.game.state = 'paused';
      G.game.menus?.show('none'); G.hud.show?.(false); G.hud.clearRadio?.();
      G.weapon.setVisible?.(false); G.hud.setPrompt?.(null);
    } catch (e) { /* ignore */ }
    $('#sq-down', this.ui).hidden = true;
    $('#sq-hud', this.ui).hidden = true;
    const title = $('#sq-result-title', this.ui);
    title.textContent = d.win ? '全队撤离成功' : '行动失败';
    title.className = d.win ? 'win' : 'lose';
    const secs = Math.max(0, ((d.at || Date.now()) - (d.start || Date.now())) / 1000);
    const rate = d.win ? (secs < 240 ? '干净利落' : secs < 400 ? '稳扎稳打' : '险象环生') : '小队失联';
    $('#sq-result-sub', this.ui).textContent = d.win
      ? `几猫港区已解除封锁 · 行动评级 ${rate}`
      : '所有队员失去联络，港区封锁仍在。';
    $('#sq-result-stats', this.ui).innerHTML = `
      <div><dt>行动用时</dt><dd>${fmtTime(secs)}</dd></div>
      <div><dt>队伍击毁</dt><dd>${d.kills || 0}</dd></div>
      <div><dt>救援次数</dt><dd>${d.revives || 0}</dd></div>
      <div><dt>切断中继</dt><dd>${d.cut || 0}/${d.total || 3}</dd></div>
      <div><dt>出动人数</dt><dd>${d.members || 1}</dd></div>
      <div><dt>结果</dt><dd>${d.win ? '成功' : '失败'}</dd></div>`;
    $('#sq-again', this.ui).hidden = !this.isHost;
    $('#sq-result', this.ui).hidden = false;
  }

  // ---------------------------------------------------------------- 队友化身
  ensureAvatars() {
    for (const p of this.rosterList) {
      if (p.id === this.myId) continue;
      const m = this.members.get(p.id); if (!m) continue;
      if (!m.avatar) m.avatar = this.makeAvatar(p.seat);
      if (!m.label) {
        const el = document.createElement('div');
        el.className = 'sq-label';
        el.style.color = CSS_COLORS[p.seat % 4];
        $('#sq-labels', this.ui).appendChild(el);
        m.label = el;
      }
    }
  }

  makeAvatar(seat) {
    const G = this.G, T = G.THREE;
    if (!T || !T.Group || !T.Mesh || !T.MeshStandardMaterial) return null;
    try {
      const color = COLORS[seat % 4];
      const g = new T.Group();
      const mat = new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .22, roughness: .62, metalness: .22 });
      const dark = new T.MeshStandardMaterial({ color: 0x1b2024, roughness: .8, metalness: .3 });
      const glow = new T.MeshBasicMaterial({ color, transparent: true, opacity: .95 });
      const body = new T.Mesh(T.CapsuleGeometry ? new T.CapsuleGeometry(.29, .82, 4, 10) : new T.BoxGeometry(.58, 1.15, .38), mat);
      body.position.y = 1.02; body.castShadow = true; g.add(body);
      const head = new T.Mesh(new T.SphereGeometry(.23, 12, 10), dark); head.position.y = 1.82; g.add(head);
      const visor = new T.Mesh(new T.BoxGeometry(.3, .09, .07), glow); visor.position.set(0, 1.84, -.21); g.add(visor);
      const pack = new T.Mesh(new T.BoxGeometry(.42, .5, .2), dark); pack.position.set(0, 1.12, .3); g.add(pack);
      const gun = new T.Mesh(new T.BoxGeometry(.1, .12, .74), dark); gun.position.set(.34, 1.24, -.34); g.add(gun);
      const flash = new T.Mesh(new T.SphereGeometry(.13, 8, 6), new T.MeshBasicMaterial({ color: 0xffe0a0 }));
      flash.position.set(.34, 1.24, -.76); flash.visible = false; g.add(flash);
      const ring = new T.Mesh(new T.RingGeometry(.42, .52, 24), new T.MeshBasicMaterial({ color, transparent: true, opacity: .55, side: T.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = .04; g.add(ring);
      g.visible = false;
      G.scene.add(g);
      return { group: g, flash, ring, flashTime: 0, target: null, has: true };
    } catch (e) { console.error('[squad] avatar', e); return null; }
  }

  removeAvatar(m) {
    if (!m) return;
    if (m.label) { m.label.remove(); m.label = null; }
    if (m.avatar && m.avatar.group) {
      try {
        this.G.scene.remove(m.avatar.group);
        m.avatar.group.traverse((o) => {
          if (o.geometry) o.geometry.dispose?.();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((x) => x.dispose?.());
        });
      } catch (e) { /* ignore */ }
      m.avatar = null;
    }
  }

  clearAvatars() { for (const m of this.members.values()) this.removeAvatar(m); }

  applyPose(from, d) {
    if (!d || !d.p || from === this.myId) return;
    const m = this.members.get(from); if (!m) return;
    m.pose = { p: d.p, y: d.y || 0, q: d.q || 0, h: d.h == null ? 100 : d.h, down: !!d.d, out: !!d.o, s: !!d.s, ads: !!d.a };
    m.health = m.pose.h;
    if (!this.isHost) { m.down = m.pose.down; m.out = m.pose.out; }
    if (!m.avatar && this.phase === 'playing') { this.ensureAvatars(); }
  }

  // ---------------------------------------------------------------- 每帧
  requestAnimationFrameLoop() {
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.min(.05, (now - (this.lastFrame || now)) / 1000); this.lastFrame = now;
      try { this.tick(now, dt); } catch (e) { console.error('[squad] tick', e); }
    };
    requestAnimationFrame(loop);
  }

  tick(now, dt) {
    if (this.playing) {
      const G = this.G;
      if (now - this.lastPose > POSE_INTERVAL) {
        this.lastPose = now;
        const p = G.player.pos;
        this.net.send('pose', {
          p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
          y: +G.player.yaw.toFixed(3), q: +G.player.pitch.toFixed(3),
          h: Math.round(G.player.health), d: this.me.down ? 1 : 0, o: this.me.out ? 1 : 0,
          s: !!G.player.sprinting, a: !!G.player.ads
        }, true);
      }
      this.tickDown(now);
      this.tickRevive(dt);
      this.tickExtraction();
      if (this.isHost && this.auth && now - this.lastState > 1000) this.pushState();
      this.renderTeamThrottled(now);
    }
    this.tickAvatars(dt);
    if (now - (this._lastNet || 0) > 1000) {
      this._lastNet = now;
      $('#sq-net-state', this.ui).textContent = this.net.active
        ? `已连接 · ${this.net.isHost ? '你是房主（裁决端）' : '队员'} · 发送 ${this.net.stats.sent} / 接收 ${this.net.stats.recv}`
        : 'P2P · 无需游戏服务器 · 房间码即地址';
    }
  }

  renderTeamThrottled(now) {
    if (now - (this._lastTeamRender || 0) < 180) return;
    this._lastTeamRender = now;
    this.renderTeam(); this.renderMission();
  }

  tickDown(now) {
    if (!this.me.down || this.me.out) return;
    const left = DOWN_SECONDS - (now - this.downAt) / 1000;
    const el = $('#sq-down-time', this.ui); if (el) el.textContent = String(Math.max(0, Math.ceil(left)));
    if (left <= 0) {
      this.me.down = false; this.me.out = true; this.me.health = 0;
      this.showDownUI(true);
      this.toast('你已失去联络，进入观战');
      this.toHost('out', {});
    }
  }

  tickRevive(dt) {
    if (this.me.down || this.me.out || !this.G.input?.down) return;
    let target = null, best = 2.6;
    for (const [id, m] of this.members) {
      if (id === this.myId || m.out || !m.down || !m.pose) continue;
      const p = m.pose.p, q = this.G.player.pos;
      const d = Math.hypot(p[0] - q.x, p[1] - q.y, p[2] - q.z);
      if (d < best) { best = d; target = id; }
    }
    this.reviveTarget = target;
    if (!target) { this.reviveT = 0; return; }
    if (!this.G.input.down('interact')) { this.reviveT = 0; return; }
    this.reviveT += dt;
    if (this.reviveT >= REVIVE_SECONDS) {
      this.reviveT = 0;
      this.toHost('revive', { target });
      this.toast('救援完成');
      try { this.G.hud.setPrompt?.(null); } catch (e) { /* ignore */ }
    }
  }

  tickExtraction() {
    const G = this.G, ex = G.level?.extraction;
    if (!ex || !ex.pos || !this.me.ready || this.me.down || this.me.out) return;
    const p = G.player.pos, r = (ex.radius || 2.5) + 1.2;
    if (Math.hypot(p.x - ex.pos.x, p.z - ex.pos.z) > r) {
      this.me.ready = false;
      this.toHost('unarrive', {});
      this.toast('你离开了撤离圈');
    }
  }

  tickAvatars(dt) {
    if (this.phase !== 'playing') return;
    const G = this.G, T = G.THREE;
    const w = innerWidth, h = innerHeight;
    const camDir = T && T.Vector3 ? new T.Vector3() : null;
    if (camDir) G.camera.getWorldDirection(camDir);
    const tmp = T && T.Vector3 ? new T.Vector3() : null;
    for (const [id, m] of this.members) {
      if (id === this.myId || !m.avatar || !m.label) continue;
      const a = m.avatar, pose = m.pose;
      if (!pose || m.out) { a.group.visible = false; m.label.style.display = 'none'; continue; }
      const p = pose.p;
      a.target = p;
      const k = 1 - Math.exp(-13 * dt);
      a.group.position.x += (p[0] - a.group.position.x) * k;
      a.group.position.y += (p[1] - a.group.position.y) * k;
      a.group.position.z += (p[2] - a.group.position.z) * k;
      let dy = pose.y - a.group.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      a.group.rotation.y += dy * k;
      a.group.rotation.z += ((m.down ? -1.15 : 0) - a.group.rotation.z) * k;
      a.group.visible = true;
      a.ring.material.opacity = m.down ? .9 : .45;
      if (a.flash) { a.flash.visible = a.flashTime > 0; if (a.flashTime > 0) a.flashTime -= dt; }
      a.flashTime = Math.max(a.flashTime || 0, m.avatar.flash || 0);
      m.avatar.flash = 0;

      // 屏幕空间名牌
      if (tmp && camDir) {
        tmp.set(p[0], p[1] + (m.down ? .7 : 2.25), p[2]);
        const to = tmp.clone().sub(G.camera.position);
        if (camDir.dot(to) <= .2) { m.label.style.display = 'none'; }
        else {
          tmp.project(G.camera);
          if (tmp.z > 1 || tmp.z < -1) { m.label.style.display = 'none'; }
          else {
            m.label.style.display = '';
            m.label.style.left = `${(tmp.x * .5 + .5) * w}px`;
            m.label.style.top = `${(-tmp.y * .5 + .5) * h}px`;
            m.label.classList.toggle('down', !!m.down);
            m.label.innerHTML = `<span class="box">${esc(m.name)}${m.down ? ' · 倒地' : ''} · ${Math.round(to.length())}m</span><span class="hp"><i style="width:${clamp(m.health || 0, 0, 100)}%"></i></span>`;
          }
        }
      }
    }
  }
}

function waitForGame() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const G = window.__G;
      if (window.__fatal) return reject(new Error(window.__fatal));
      if (window.__ready && G && G.game && G.player && G.scene && G.level) return resolve(G);
      if (Date.now() - started > 45000) return reject(new Error('本体游戏启动超时，请刷新页面'));
      setTimeout(check, 120);
    };
    check();
  });
}

const squad = new Squad();
squad.init().catch((e) => {
  console.error('[squad] init failed', e);
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:16px;bottom:16px;z-index:95;padding:10px 14px;background:rgba(40,8,4,.9);color:#ffb4a8;font:12px/1.5 monospace;pointer-events:auto';
  box.textContent = `联机模块启动失败：${e.message || e}（单人任务仍可正常游玩）`;
  (document.getElementById('ui') || document.body).appendChild(box);
});

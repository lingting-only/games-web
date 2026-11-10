// Ink Turf bootstrap: menu / solo stages / online lobby / result, the fixed loop and the one
// authoritative simulation. Solo and host run the same Authority; clients replay its event stream.
import * as THREE from 'three';
import { InkRenderer, INK } from './render.js';
import { Board, GW, HALF_W, HALF_H, PLAYER_INKS, colorHex, cellToWorld } from './paper.js';
import { Authority } from './authority.js';
import { TurfAI } from './ai.js';
import { buildLayout, SPAWNS, LAYOUT_COUNT } from './layout.js';
import { Effects } from './effects.js';
import { audio } from './audio.js';
import { Net } from './net.js';
import { HUD, esc } from './hud.js';
import { PointerInput } from './pointer.js';
import { clamp } from './util.js';

const ROUND_TIME = 90;
const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

const canvas = document.getElementById('c');
const R = new InkRenderer(canvas);
R.tilt = 0.22;
R.frame(HALF_W + 2, HALF_H + 2);
const effects = new Effects(R.scene);
const hud = new HUD(document.getElementById('hud'));
const net = new Net();
const input = new PointerInput(canvas);
const board = new Board(R.scene);
let auth = new Authority(board, R.scene);
let layout = null;
const ais = [];
const lobby = { players: new Map(), code: '', isPublic: true, status: '' };
const peerToPid = new Map();
const game = {
  state: 'start', screen: 'main', mode: 'solo', menu: false, pausedFrom: 'play',
  level: 0, myPid: 1, target: 30, timeLeft: ROUND_TIME, netT: 0,
  cover: [], names: [], over: null, pending: [],
};

// ---------------- saved bits ----------------
let myName = (localStorage.getItem('it_name') || '').slice(0, 12) || '蓝笔' + Math.floor(Math.random() * 90 + 10);
let unlocked = clamp(Number(localStorage.getItem('it_level') || 1), 1, LAYOUT_COUNT);
let bests = {};
try { bests = JSON.parse(localStorage.getItem('it_best') || '{}'); } catch { bests = {}; }
let musicWanted = localStorage.getItem('it_music') !== '0';
let chosenLevel = Math.min(unlocked - 1, 9);
const applyMusic = () => { audio.init(); audio.setTune('district'); audio.musicOn(musicWanted && game.state === 'play'); };

// ---------------- match setup ----------------
function resetMatch(nPlayers, level, names, opts = {}) {
  auth.dispose(); ais.length = 0;
  if (layout) layout.dispose();
  layout = buildLayout(R.scene, level);
  board.reset(nPlayers, layout.blocked);
  auth = new Authority(board, R.scene);
  for (let pid = 1; pid <= nPlayers; pid++) {
    const [cx, cy] = SPAWNS[pid - 1];
    const boost = opts.solo && pid > 1 ? { radius: 4, speed: 19 + (opts.skill || 0) * 4 } : {};
    auth.addPlayer(pid, names[pid - 1] || '涂鸦', PLAYER_INKS[pid], cx, cy, boost);
  }
  board.flush();
  effects.clear();
  return names.slice(0, nPlayers);
}
function isAuth() { return game.mode === 'solo' || net.isHost; }
function standings() {
  const rows = [];
  for (let pid = 1; pid <= Math.max(game.names.length, game.cover.length - 1, 1); pid++) {
    rows.push({ name: game.names[pid - 1] || '涂鸦', pct: game.cover[pid] || 0, color: colorHex(pid), me: pid === game.myPid });
  }
  return rows.sort((a, b) => b.pct - a.pct);
}

function beginSolo(level) {
  net.leave();
  game.mode = 'solo'; game.state = 'play'; game.menu = false; game.myPid = 1;
  game.level = level; chosenLevel = level;
  const skill = clamp(0.34 + level * 0.075, 0.34, 1);
  const nAI = Math.min(3, 2 + Math.floor(level / 4));
  const roundTime = Math.max(70, ROUND_TIME - level * 2);
  game.target = 34 + Math.round(level * 2.6);
  game.timeLeft = roundTime; game.netT = 0;
  const names = [myName, '红笔怪', '绿笔怪', '橙笔怪'];
  game.names = resetMatch(1 + nAI, level, names, { solo: true, skill });
  for (let pid = 2; pid <= game.names.length; pid++) {
    auth.aiPids.add(pid);
    ais.push(new TurfAI(pid, auth, { skill, role: pid === 2 ? 'expander' : pid === 3 ? 'hunter' : 'raider' }));
  }
  game.cover = auth.cover.pct;
  hud.setGameplayVisible(true); hud.hideScreen();
  hud.message('圈地为王', `目标 ${game.target}% · ${mmss(roundTime)} · ${nAI} 个对手`, 2.2);
  hud.tip('在<b>蓝色领地</b>里点击开始画线 · 画回蓝色区域即圈地', 5);
  applyMusic();
}
function enterPlay() {
  game.state = 'play'; game.menu = false;
  game.pending.length = 0; game.netT = 0;
  hud.setGameplayVisible(true); hud.hideScreen();
  hud.message('圈地为王', '90 秒 · 覆盖率最高者获胜', 2.2);
  applyMusic();
}
function resetMenu() {
  net.leave();
  auth.dispose(); ais.length = 0;
  game.mode = 'solo'; game.myPid = 1; game.cover = []; game.names = [];
  game.names = resetMatch(4, 0, ['蓝笔', '红笔', '绿笔', '橙笔']);
  game.cover = auth.cover.pct;
  hud.setGameplayVisible(false);
}

// ---------------- effects / event stream ----------------
function consumeEvents(events) {
  for (const e of events) {
    if (e.t === 'claim') {
      const i = e.cells[Math.floor(e.cells.length / 2)];
      const [x, z] = cellToWorld(i % GW, (i / GW) | 0);
      effects.strokeBurst(x, z, PLAYER_INKS[e.pid], 20, 6, { life: 0.6 });
      if (e.pid === game.myPid) { audio.pickup(); hud.tip(`圈住 <b>+${e.cells.length}</b> 格`, 2); }
    } else if (e.t === 'cut') {
      if (e.cell >= 0) {
        const [x, z] = cellToWorld(e.cell % GW, (e.cell / GW) | 0);
        effects.strokeBurst(x, z, INK.BLACK, 14, 5, { life: 0.5 });
      }
      if (e.victim === game.myPid) {
        audio.hurt();
        hud.tip(e.note === 'self' ? '墨线自己打了个结' : e.note === 'miss' ? '没圈住地，墨线作废' : '墨线被擦断了！<b>笔尖卡顿 1 秒</b>', 2);
      }
    }
  }
}

// ---------------- click ----------------
const _ray = new THREE.Raycaster(), _v2 = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), _hit = new THREE.Vector3();
input.onClick = (ndc) => {
  if (game.state !== 'play' || game.menu) return;
  audio.init(); audio.resume();
  _ray.setFromCamera(_v2.set(ndc.x, ndc.y), R.camera);
  if (!_ray.ray.intersectPlane(_plane, _hit)) return;
  if (Math.abs(_hit.x) > HALF_W || Math.abs(_hit.z) > HALF_H) return;
  if (isAuth()) auth.intent(game.myPid, _hit.x, _hit.z);
  else net.broadcast('intent', { x: +_hit.x.toFixed(2), z: +_hit.z.toFixed(2) });
  effects.ring(_hit.x, _hit.z, PLAYER_INKS[game.myPid], 1.3, 0.3);
};
input.onAnyInput = () => { audio.init(); audio.resume(); };
input.onKey = (action) => {
  if (action === 'pause') { if (game.state === 'pause') resume(); else pause(); }
  else if (action === 'music') { musicWanted = !musicWanted; localStorage.setItem('it_music', musicWanted ? '1' : '0'); applyMusic(); hud.tip(musicWanted ? '音乐：开' : '音乐：关', 1.5); }
  else if (action === 'confirm') { if (game.state === 'over') { game.screen = 'main'; game.state = 'start'; showStart(); } else if (game.state === 'pause') resume(); }
  else if (action === 'restart') { if (game.mode === 'solo' && (game.state === 'play' || game.state === 'over')) beginSolo(game.level); }
};

// ---------------- online ----------------
function broadcastLobby() {
  if (!net.isHost) return;
  net.send('lobby', {
    players: [...lobby.players].map(([id, p]) => ({ id, name: p.name })),
    hostId: net.id, code: net.aliasCode || net.code, isPublic: lobby.isPublic,
  });
}
function renderLobby() { if (game.state === 'lobby') showStart(); }
function leaveOnline(reason = '') {
  net.leave(); lobby.players.clear(); lobby.code = ''; peerToPid.clear();
  game.state = 'start'; game.screen = 'main'; game.menu = false; game.over = null;
  lobby.status = reason; resetMenu(); showStart();
}
async function createLobby(pub) {
  lobby.status = '正在建房…'; showStart();
  try {
    net.hostName = myName;
    const code = await net.host({ isPublic: pub });
    lobby.players.clear(); lobby.players.set(net.id, { name: myName });
    lobby.code = code; lobby.isPublic = pub; lobby.status = '';
    peerToPid.clear(); peerToPid.set(net.id, 1);
    net.inMatch = false; net.accepting = true;
    game.state = 'lobby'; game.screen = 'lobby';
    broadcastLobby(); renderLobby();
  } catch (e) { lobby.status = '建房失败：' + (e.message || e); showStart(); }
}
async function joinLobby(code) {
  lobby.status = '正在加入…'; showStart();
  try {
    await net.join(code, { name: myName });
    lobby.code = net.code; lobby.status = '';
    game.state = 'lobby'; game.screen = 'lobby';
    lobby.players.set(net.id, { name: myName });
    renderLobby();
  } catch (e) { lobby.status = '加入失败：' + (e.message || e); showStart(); }
}
async function quickPlay() {
  lobby.status = '正在寻找开放的大厅…'; showStart();
  try {
    await net.quickJoin({ name: myName }, (s) => { lobby.status = s; const el = document.getElementById('status'); if (el) el.textContent = s; });
    lobby.code = net.code; lobby.status = '';
    game.state = 'lobby'; game.screen = 'lobby';
    lobby.players.set(net.id, { name: myName });
    renderLobby();
  } catch (e) {
    lobby.status = '没找到公开房，正在自己开一间…'; showStart();
    await createLobby(true);
  }
}
function hostStart() {
  if (!net.isHost || game.state !== 'lobby') return;
  const ids = [...lobby.players.keys()];
  const names = ids.map((id) => (lobby.players.get(id) || {}).name || '涂鸦');
  game.names = resetMatch(ids.length, 0, names);
  ids.forEach((id, i) => peerToPid.set(id, i + 1));
  game.myPid = 1; game.mode = 'ffa'; game.level = 0; game.target = 0;
  game.timeLeft = ROUND_TIME; game.netT = 0; game.cover = auth.cover.pct;
  net.inMatch = true; net.accepting = true;
  const d = { full: auth.fullSnapshot(), names: game.names, peers: [...peerToPid], level: 0, timeLeft: ROUND_TIME };
  net.send('start', d);
  enterPlay();
}
function startOnline(d) {
  game.mode = 'ffa'; game.level = d.level || 0; game.target = 0;
  game.timeLeft = d.timeLeft || ROUND_TIME; game.names = d.names || [];
  game.myPid = (d.peers || []).find(([id]) => id === net.id)?.[1] || 1;
  auth.dispose(); ais.length = 0;
  if (layout) layout.dispose();
  layout = buildLayout(R.scene, game.level);
  board.reset(0, layout.blocked);
  auth = new Authority(board, R.scene);
  auth.applyFull(d.full);
  game.cover = auth.cover.pct;
  for (const [id, pid] of d.peers || []) peerToPid.set(id, pid);
  enterPlay();
}
net.onPeerJoin = (id, meta) => {
  const name = String((meta && meta.name) || '涂鸦').slice(0, 12);
  lobby.players.set(id, { name });
  if (!net.isHost) return;
  if (game.state === 'play') {
    const pid = auth.nPlayers + 1;
    if (pid <= net.maxPlayers) {
      auth.addPlayer(pid, name, PLAYER_INKS[pid], SPAWNS[pid - 1][0], SPAWNS[pid - 1][1]);
      peerToPid.set(id, pid); game.names[pid - 1] = name;
      const full = auth.fullSnapshot();
      net.send('full', full);
      net.send('names', { names: game.names, peers: [...peerToPid] });
      // the newcomer needs its own start message to leave the lobby and learn its player id
      net.sendTo(id, 'start', { full, names: game.names, peers: [...peerToPid], level: game.level, timeLeft: game.timeLeft });
      hud.tip(`${esc(name)} 加入了对局`, 2);
    }
  } else { broadcastLobby(); renderLobby(); }
};
net.onPeerLeave = (id) => {
  lobby.players.delete(id); peerToPid.delete(id);
  if (net.isHost) { broadcastLobby(); renderLobby(); }
};
net.onDisconnect = () => leaveOnline('房主离开了大厅');
net.on('refused', (d) => leaveOnline(d.reason || '房间已满'));
net.on('lobby', (d) => {
  lobby.players.clear();
  for (const p of d.players) lobby.players.set(p.id, { name: p.name });
  lobby.code = d.code; lobby.isPublic = !!d.isPublic;
  renderLobby();
});
net.on('start', (d) => startOnline(d));
net.on('intent', (d, from) => {
  if (!net.isHost || game.state !== 'play') return;
  const pid = peerToPid.get(from);
  if (pid) auth.intent(pid, d.x, d.z);
});
net.on('snap', (s) => {
  if (game.state !== 'play' || net.isHost) return;
  auth.applySnapshot(s); game.cover = s.c || []; game.timeLeft = s.time ?? game.timeLeft;
  consumeEvents(s.e || []);
});
net.on('full', (f) => { if (game.state === 'play' && !net.isHost) auth.applyFull(f); });
net.on('names', (d) => {
  game.names = d.names || [];
  for (const [id, pid] of d.peers || []) peerToPid.set(id, pid);
  game.myPid = (d.peers || []).find(([id]) => id === net.id)?.[1] || game.myPid;
});
net.on('end', (d) => { game.cover = d.cover || game.cover; endMatch('时间到', d.winner); });
net.on('backtolobby', () => { game.state = 'lobby'; game.screen = 'lobby'; hud.setGameplayVisible(false); showStart(); });

// ---------------- panels ----------------
function settingsHTML() {
  return `<div class="settings">
    <label>名字 <input type="text" id="nameInput" maxlength="12" value="${esc(myName)}" style="width:170px;font-size:18px;letter-spacing:0"></label>
    <label><input type="checkbox" id="musicBox" ${musicWanted ? 'checked' : ''}> 8-bit 音乐 <span class="k">M 键切换</span></label>
  </div>`;
}
function mainHTML() {
  const levels = Array.from({ length: LAYOUT_COUNT }, (_, i) =>
    `<button data-level="${i}" class="${chosenLevel === i ? 'on' : ''}" ${i >= unlocked ? 'disabled' : ''}>${i + 1}</button>`).join('');
  return `<h1>涂鸦圈地战</h1><h2>Ink Turf · 把作业本圈成自己的地盘</h2>
    <div class="tags"><span class="tag">单击操作</span><span class="tag">3D 涂鸦</span><span class="tag">单人 / 联机</span></div>
    <p>点一下纸面，笔尖小人就跑过去留下一道墨线；把线画回自己的领地，圈住的地方就用排线涂满、归你。<br>对手撞上你没闭合的线，墨线会被擦断，只留一地橡皮屑。</p>
    <div class="cols">
      <div><div class="colhead">怎么玩</div>只有站在自己颜色的领地里点击才会开始画线<br>画线途中再点击只改去向，回到领地自动结算<br>被切线会卡顿 1 秒，障碍也会挡路</div>
      <div><div class="colhead">对手不好惹</div>涂鸦怪会挑收益最高的路线圈地、抢你的地盘<br>还会预判你的走位来切线，并躲开你的反切<br>关卡越高：目标越大、时间越短、对手越多越快</div>
    </div>
    <div class="row" style="margin-top:14px">
      <button class="primary" id="soloBtn">开始挑战</button>
      <button id="onlineBtn">联机对战</button>
    </div>
    <div class="levels" id="levels">${levels}</div>
    <div class="row"><span class="status">已解锁 ${unlocked} / ${LAYOUT_COUNT} 关 · 第 ${chosenLevel + 1} 关最好 ${(bests[chosenLevel] || 0).toFixed(1)}%</span></div>
    ${settingsHTML()}
    <div class="go">挑一个按钮，开始圈地 →</div>`;
}
function onlineHTML() {
  return `<h1>联机对战</h1><h2>房主的浏览器当裁判 · 不需要游戏服务器</h2>
    <p>2–4 人同纸竞技，90 秒结束时覆盖率最高者获胜。快速匹配会先找公开房，找不到就自动开一间。</p>
    <div class="row"><button class="primary" id="quickBtn">快速匹配</button><button id="pubBtn">创建公开房</button><button id="privBtn">创建私房</button></div>
    <div class="row"><input type="text" id="codeInput" maxlength="5" placeholder="房间码"><button id="joinBtn">加入</button></div>
    <div class="row"><button class="alt" id="backBtn">返回主菜单</button></div>
    <div class="status" id="status">${esc(lobby.status || '')}</div>`;
}
function lobbyHTML() {
  const shown = String(net.aliasCode || lobby.code || '').replace(/-\d+$/, '');
  const rows = [...lobby.players].map(([id, p]) =>
    `<div class="row ${id === net.id ? 'me' : ''}"><span>${esc(p.name)}</span><span>${id === net.id && net.isHost ? '房主' : '飞行员'}</span></div>`).join('');
  return `<h1>候机厅</h1><h2>${lobby.isPublic ? '公开房' : '私人房'} · ${lobby.players.size}/${net.maxPlayers} 人</h2>
    <div class="code">${esc(shown)}</div>
    <p>把这个码告诉朋友，就能一起圈地。</p>
    <div class="scoreboard">${rows || '<div class="row"><span>还没有人加入</span></div>'}</div>
    <div class="row">${net.isHost ? '<button class="primary" id="startBtn">开始对战</button>' : '<span class="status">等房主开始…</span>'}<button class="alt" id="leaveBtn">离开</button></div>
    <div class="status" id="status">${esc(lobby.status || '')}</div>`;
}
function pauseHTML() {
  return `<h1>暂停</h1><h2>${game.mode === 'solo' ? `第 ${game.level + 1} 关` : '自由混战'} · ${mmss(game.timeLeft)}</h2>
    <div class="scoreboard">${standings().map((r) => `<div class="row ${r.me ? 'me' : ''}"><span>${esc(r.name)}</span><span>${r.pct.toFixed(1)}%</span></div>`).join('')}</div>
    ${settingsHTML()}
    <div class="row"><button class="alt" id="leaveBtn">退出到主菜单</button></div>
    <div class="go">点击任意位置继续</div>`;
}
function overHTML(win, reason) {
  const rows = standings().map((r) => `<div class="row ${r.me ? 'me' : ''}"><span>${esc(r.name)}</span><span>${r.pct.toFixed(1)}%</span></div>`).join('');
  return `<h1>${win ? '圈地成功' : '再画一次'}</h1>
    <h2>${esc(reason)} · 我的覆盖率 <b>${(game.cover[game.myPid] || 0).toFixed(1)}%</b>${game.target ? ` / 目标 ${game.target}%` : ''}</h2>
    <div class="scoreboard">${rows}</div>
    <div class="row"><button class="primary" id="againBtn">再来一局</button>${net.active && net.isHost ? '<button id="lobbyBtn">返回大厅</button>' : ''}<button class="alt" id="menuBtn">主菜单</button></div>
    <div class="go">点击空白处继续</div>`;
}
function wire(id, fn) {
  const el = hud.el.panel.querySelector('#' + id);
  if (el) el.addEventListener('click', (e) => { e.stopPropagation(); fn(e); });
  return el;
}
function wireSettings() {
  const name = hud.el.panel.querySelector('#nameInput');
  if (name) {
    name.addEventListener('click', (e) => e.stopPropagation());
    name.addEventListener('change', (e) => { e.stopPropagation(); myName = String(name.value || '涂鸦').slice(0, 12); localStorage.setItem('it_name', myName); net.hostName = myName; });
  }
  const music = hud.el.panel.querySelector('#musicBox');
  if (music) music.addEventListener('change', (e) => { e.stopPropagation(); musicWanted = !!music.checked; localStorage.setItem('it_music', musicWanted ? '1' : '0'); applyMusic(); });
  for (const b of hud.el.panel.querySelectorAll('[data-level]')) {
    b.addEventListener('click', (e) => { e.stopPropagation(); chosenLevel = Number(b.dataset.level); showStart(); });
  }
}
function showStart() {
  hud.setGameplayVisible(false);
  const html = game.screen === 'lobby' ? lobbyHTML() : game.screen === 'online' ? onlineHTML() : mainHTML();
  hud.showScreen(html);
  wireSettings();
  if (game.screen === 'main') {
    wire('soloBtn', () => beginSolo(chosenLevel));
    wire('onlineBtn', () => { game.screen = 'online'; showStart(); });
  } else if (game.screen === 'online') {
    wire('quickBtn', quickPlay);
    wire('pubBtn', () => createLobby(true));
    wire('privBtn', () => createLobby(false));
    wire('joinBtn', () => joinLobby(hud.el.panel.querySelector('#codeInput').value));
    wire('backBtn', () => { game.screen = 'main'; showStart(); });
  } else {
    wire('startBtn', hostStart);
    wire('leaveBtn', () => leaveOnline());
  }
}
function pause() {
  if (game.state !== 'play' || game.menu) return;
  game.menu = true; game.pausedFrom = game.state; game.state = 'pause';
  hud.showScreen(pauseHTML()); wireSettings(); wire('leaveBtn', () => leaveOnline());
}
function resume() {
  if (game.state !== 'pause') return;
  game.state = game.pausedFrom || 'play'; game.menu = false;
  hud.hideScreen(); hud.setGameplayVisible(true);
}
hud.onScreenClick = () => {
  if (game.state === 'pause') { resume(); return; }
  if (game.state === 'over') {
    if (net.active) { if (net.isHost) net.send('backtolobby', {}); game.state = 'lobby'; game.screen = 'lobby'; showStart(); }
    else { game.screen = 'main'; game.state = 'start'; resetMenu(); showStart(); }
  }
};

function endMatch(reason, winnerPid) {
  game.state = 'over'; game.menu = false; game.over = { reason, winnerPid };
  const mine = game.cover[game.myPid] || 0;
  const win = game.mode === 'solo' ? mine >= game.target : winnerPid === game.myPid;
  if (game.mode === 'solo') {
    bests[game.level] = Math.max(bests[game.level] || 0, mine);
    localStorage.setItem('it_best', JSON.stringify(bests));
    if (win && game.level + 2 > unlocked) { unlocked = Math.min(LAYOUT_COUNT, game.level + 2); localStorage.setItem('it_level', String(unlocked)); }
    if (win) audio.waveClear(); else audio.death();
  } else audio.kill(win);
  hud.setGameplayVisible(false);
  hud.showScreen(overHTML(win, reason));
  wire('againBtn', () => (game.mode === 'solo' ? beginSolo(game.level) : net.isHost ? hostStart() : null));
  wire('lobbyBtn', () => { if (net.isHost) net.send('backtolobby', {}); game.state = 'lobby'; game.screen = 'lobby'; showStart(); });
  wire('menuBtn', () => leaveOnline());
}

// ---------------- loop ----------------
function updateHud() {
  hud.setCoverage(game.cover[game.myPid] || 0, game.target);
  hud.setTimer(game.timeLeft);
  hud.setMode(game.mode === 'solo' ? `第 ${game.level + 1} 关 · 单人` : `自由混战 · ${game.names.filter(Boolean).length} 人`);
  hud.setBoard(standings());
  const a = auth.actors.get(game.myPid);
  hud.setStatus(!a ? '同步中…' : a.drawing ? '画线中…回到自己颜色即可圈地' : '在自己领地里点击，开始画线');
}
let last = performance.now();
function step(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  if (game.state === 'play' && !game.menu) {
    if (isAuth()) {
      auth.update(dt);
      for (const ai of ais) ai.update(dt);
      // events are consumed locally every frame but accumulated for the 15Hz network batch,
      // otherwise everything between two snapshots would be lost to the clients
      const events = auth.events.splice(0);
      game.cover = auth.cover.pct.map((p) => +p.toFixed(2));
      consumeEvents(events);
      if (net.isHost && game.mode === 'ffa') game.pending.push(...events);
      game.timeLeft -= dt;
      if (net.isHost && game.mode === 'ffa') {
        game.netT -= dt;
        if (game.netT <= 0) {
          game.netT = 1 / 15;
          const a = [];
          for (const [pid, act] of auth.actors) a.push([pid, +act.x.toFixed(2), +act.z.toFixed(2), act.drawing ? 1 : 0]);
          net.send('snap', { a, c: game.cover, e: game.pending.splice(0), time: game.timeLeft });
        }
      }
      if (game.mode === 'solo' && (game.cover[1] || 0) >= game.target) endMatch('达标！', 1);
      else if (game.timeLeft <= 0) {
        let best = 1;
        for (let pid = 2; pid < (game.cover || []).length; pid++) if ((game.cover[pid] || 0) > (game.cover[best] || 0)) best = pid;
        if (net.isHost && game.mode === 'ffa') net.send('end', { winner: best, cover: game.cover });
        endMatch('时间到', best);
      }
    }
    board.flush();
    updateHud();
  }
  effects.update(dt);
  hud.update(dt);
  R.render(t, {});
}
function tick(now) { requestAnimationFrame(tick); step(now); }
window.addEventListener('pagehide', () => { if (net.active) net.leave(); });

resetMenu();
showStart();
window.__inkturf = { R, board, auth: () => auth, ais, game, net, hud, effects, layout: () => layout, beginSolo, hostStart, resetMatch, standings };
requestAnimationFrame(tick);

// Stamp Duel bootstrap: menu / solo stages / online 2v2. The host owns the authoritative
// simulation; clients send {lane, type} and interpolate 15Hz snapshots.
import * as THREE from 'three';
import { InkRenderer, INK } from './render.js';
import { Scene } from './scene.js';
import {
  createState, step, canDeploy, encodeSnap, applySnap, unlockedTypes,
  LANES, FIELD_HALF, DRAW,
} from './rules.js';
import { LEVELS, LEVEL_COUNT, levelState, onlineState } from './waves.js';
import { UNIT_LIST, UNITS } from './units.js';
import { Effects } from './effects.js';
import { audio } from './audio.js';
import { Net } from './net.js';
import { HUD, esc } from './hud.js';
import { PointerInput } from './pointer.js';
import { clamp } from './util.js';

const canvas = document.getElementById('c');
const R = new InkRenderer(canvas);
R.tilt = 0.35;
R.frame(FIELD_HALF + 4, 14);
const effects = new Effects(R.scene);
const hud = new HUD(document.getElementById('hud'));
const net = new Net();
const input = new PointerInput(canvas);
const scene = new Scene(R.scene);

let state = levelState(0);
let pendingIntents = [], lastSnap = null, selected = 'pencil';
const lobby = { players: new Map(), code: '', isPublic: true, status: '' };
const game = {
  state: 'start', screen: 'main', mode: 'solo', menu: false,
  level: 0, myTeam: 1, spectator: false,
  seats: [], names: [], display: onlineState(),
  netT: 0, pending: [], over: null,
};

// ---------------- saved bits ----------------
let myName = (localStorage.getItem('sd_name') || '').slice(0, 12) || '蓝笔' + Math.floor(Math.random() * 90 + 10);
let unlocked = clamp(Number(localStorage.getItem('sd_level') || 1), 1, LEVEL_COUNT);
let wins = Number(localStorage.getItem('sd_wins') || 0);
let musicWanted = localStorage.getItem('sd_music') !== '0';
let chosenLevel = unlocked - 1;
const applyMusic = () => { audio.init(); audio.musicOn(musicWanted && game.state === 'play'); };
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const cur = () => (game.mode !== 'solo' && !net.isHost) ? game.display : state;

// ---------------- effects ----------------
// Dozens of attacks can land in one frame; cap the visual budget and rate-limit every cue.
const _sfxAt = { shoot: 0, hit: 0, fort: 0, die: 0, surge: 0 };
function sfx(key, gap, fn) {
  const now = performance.now();
  if (now - _sfxAt[key] < gap * 1000) return;
  _sfxAt[key] = now; fn();
}
let hurtFlash = 0;
const _fproj = new THREE.Vector3();
function floater(text, x, z, cls) {
  _fproj.set(x, 1.5, z).project(R.camera);
  hud.floater((_fproj.x * 0.5 + 0.5) * window.innerWidth,
    (-_fproj.y * 0.5 + 0.5) * window.innerHeight, text, cls);
}
function playEvents(events) {
  let hitFx = 0, shotFx = 0;
  for (const e of events || []) {
    const ink = e.team === 1 ? INK.BLUE : INK.RED;
    if (e.t === 'spawn') {
      const z = LANES[e.lane];
      effects.ring(e.x, z, ink, 1.9, 0.4);
      effects.strokeBurst(e.x, z, INK.BLACK, 5, 1.7, { life: 0.35 });
      audio.tick();
    } else if (e.t === 'shoot') {
      const muzzle = e.x + (e.team === 1 ? 0.9 : -0.9);
      if (shotFx++ < 6) {
        effects.ring(muzzle, LANES[e.lane], ink, 1.1, 0.2);
        effects.strokeBurst(muzzle, LANES[e.lane], INK.BLACK, 4, 1.8, { life: 0.24, size: 0.7, y: 0.85 });
      }
      sfx('shoot', 0.07, () => audio.stampShoot());
    } else if (e.t === 'hit' && e.kind === 'unit') {
      if (hitFx++ < 12) {
        effects.strokeBurst(e.x, LANES[e.lane], ink, 6, 2.8, { life: 0.32, size: 0.9, y: 0.9 });
        effects.ring(e.x, LANES[e.lane], ink, 1.0, 0.2);
      }
      if (e.dmg >= 15) floater(`-${e.dmg}`, e.x, LANES[e.lane], 'heavy');
      sfx('hit', 0.055, () => audio.stampHit());
    } else if (e.t === 'hit' && e.kind === 'base') {
      effects.ring(e.x, 0, ink, 3.0, 0.45);
      effects.strokeBurst(e.x, 0, INK.BLACK, 12, 4.2, { life: 0.55, y: 0.9, size: 1.0 });
      floater(`-${e.dmg}`, e.x, 0, 'fort');
      R.shakeKick(e.team === 2 ? 0.2 : 0.12);
      if (e.team === 2) hurtFlash = 0.18;
      sfx('fort', 0.16, () => audio.fortHit());
    } else if (e.t === 'die') {
      effects.strokeBurst(e.x, LANES[e.lane], INK.BLACK, 9, 2.4, { life: 0.45 });
      effects.ring(e.x, LANES[e.lane], ink, 1.5, 0.3);
      sfx('die', 0.05, () => audio.kill(e.type === 'blot'));
    } else if (e.t === 'surge') {
      hud.tip('<b>涂改液怪潮爆发！</b>', 2.2);
      hud.message('怪潮爆发', `敌方一次连出 ${e.count} 枚印章`, 1.6);
      effects.ring(FIELD_HALF - 4, 0, INK.RED, 6, 0.6);
      sfx('surge', 0.4, () => audio.surge());
    }
  }
}

function refreshHud() {
  const s = cur();
  hud.setHp(s.hp[1], s.hp[2], s.maxHp[1], s.maxHp[2]);
  hud.setInk(s.ink[game.myTeam] || 0, s.inkMax);
  hud.setStamps(UNIT_LIST, selected, s.ink[game.myTeam] || 0, s.unlock);
  hud.setTimer(s.timeLeft > 0 ? mmss(s.timeLeft) : '');
  const mine = s.units.filter((u) => u.team === 1).length, foe = s.units.length - mine;
  hud.setWave(`场上 ${mine} : ${foe}`);
  const rows = [];
  if (game.mode === 'solo') {
    rows.push({ name: myName, tag: '蓝队', me: true, color: '#1a30c0' });
    rows.push({ name: '涂改液怪', tag: '红队', me: false, color: '#d02030' });
    hud.setMode(`第 ${game.level + 1} 关 · ${LEVELS[game.level].name}`);
    hud.setStatus(game.spectator ? '' : '点己方半页的车道盖印章');
  } else {
    game.seats.forEach((pid, i) => {
      const team = i % 2 === 0 ? 1 : 2;
      rows.push({ name: game.names[i] || '涂鸦', tag: team === 1 ? '蓝队' : '红队', me: pid === net.id, color: team === 1 ? '#1a30c0' : '#d02030' });
    });
    if (game.spectator) rows.push({ name: myName, tag: '观战', me: true, color: '#8a8a8a' });
    hud.setMode(`联机 · ${game.seats.length} 人${game.spectator ? '（观战）' : ''}`);
    hud.setStatus(game.spectator ? '观战中，不能部署' : '点己方半页的车道盖印章');
  }
  hud.setBoard(rows);
}

function soloNextLevel(winner) {
  if (game.mode !== 'solo' || winner !== game.myTeam) return -1;
  const next = game.level + 1;
  return next < LEVEL_COUNT && next < unlocked ? next : -1;
}

// ---------------- match setup ----------------
function beginSolo(level) {
  net.leave();
  game.mode = 'solo'; game.state = 'play'; game.menu = false;
  game.level = level; chosenLevel = level;
  game.myTeam = 1; game.spectator = false; game.over = null;
  game.seats = []; game.names = []; game.netT = 0; game.pending.length = 0;
  pendingIntents = []; lastSnap = null;
  state = levelState(level);
  const open = unlockedTypes(state);
  if (!open.includes(selected)) selected = open[0];
  scene.sync(state); effects.clear();
  hud.setGameplayVisible(true); hud.hideScreen();
  hud.message(LEVELS[level].name, LEVELS[level].hint, 2.4);
  refreshHud(); applyMusic();
}
function enterPlay() {
  game.state = 'play'; game.menu = false; game.over = null;
  game.netT = 0; game.pending.length = 0; pendingIntents = []; lastSnap = null;
  hud.setGameplayVisible(true); hud.hideScreen();
  hud.message('盖章开战', '先打爆对面的墨水瓶', 2);
  refreshHud(); applyMusic();
}
function resetMenu() {
  net.leave();
  game.mode = 'solo'; game.state = 'start'; game.menu = false;
  game.spectator = false; game.seats = []; game.names = []; game.over = null;
  state = levelState(2);
  state.units = [
    { id: 1, team: 1, lane: 0, type: 'pencil', x: -9, hp: 26, cd: 0, dir: 1 },
    { id: 2, team: 1, lane: 1, type: 'clip', x: -14, hp: 17, cd: 0, dir: 1 },
    { id: 3, team: 2, lane: 2, type: 'eraser', x: 8, hp: 78, cd: 0, dir: -1 },
    { id: 4, team: 2, lane: 0, type: 'blot', x: 13, hp: 120, cd: 0, dir: -1 },
  ];
  scene.sync(state);
  hud.setGameplayVisible(false);
}

// ---------------- input ----------------
const _ray = new THREE.Raycaster(), _v2 = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), _hit = new THREE.Vector3();
function deployAt(ndc) {
  if (game.state !== 'play' || game.menu || state.winner || game.spectator) return;
  _ray.setFromCamera(_v2.set(ndc.x, ndc.y), R.camera);
  if (!_ray.ray.intersectPlane(_plane, _hit)) return;
  let lane = 0, best = Infinity;
  for (let i = 0; i < LANES.length; i++) { const d = Math.abs(_hit.z - LANES[i]); if (d < best) { best = d; lane = i; } }
  if (best > 3.6 || Math.abs(_hit.x) > FIELD_HALF + 3) return;
  const mine = game.myTeam === 1 ? _hit.x < -1 : _hit.x > 1;
  if (!mine) { hud.tip('只能盖在<b>己方半页</b>', 1.6); return; }
  const s = cur();
  if (!unlockedTypes(s).includes(selected)) { hud.tip('这枚印章还没解锁', 1.5); return; }
  if (!canDeploy(s, game.myTeam, selected)) { hud.tip(s.ink[game.myTeam] < UNITS[selected].cost ? '墨水不够' : '手慢一点，刚盖过一枚', 1.4); return; }
  if (game.mode === 'solo' || net.isHost) pendingIntents.push({ team: game.myTeam, lane, type: selected });
  else net.send('intent', { lane, type: selected });
}
input.onClick = (ndc) => { audio.init(); audio.resume(); deployAt(ndc); };
input.onAnyInput = () => { audio.init(); audio.resume(); };
function selectUnit(type) {
  if (!unlockedTypes(cur()).includes(type)) { hud.tip('这枚印章还没解锁', 1.5); return; }
  selected = type; refreshHud();
}
input.onKey = (action) => {
  if (action === 'pause') { if (game.state === 'pause') resume(); else pause(); }
  else if (action === 'music') { musicWanted = !musicWanted; localStorage.setItem('sd_music', musicWanted ? '1' : '0'); applyMusic(); hud.tip(musicWanted ? '音乐：开' : '音乐：关', 1.5); }
  else if (/^unit[1-4]$/.test(action)) selectUnit(UNIT_LIST[Number(action.slice(-1)) - 1]);
  else if (action === 'restart') { if (game.mode === 'solo' && (game.state === 'play' || game.state === 'over')) beginSolo(game.level); }
  else if (action === 'confirm') {
    if (game.state === 'over') {
      const next = soloNextLevel(game.over);
      if (next >= 0) beginSolo(next);
      else { game.screen = 'main'; game.state = 'start'; showStart(); }
    } else if (game.state === 'pause') resume();
  }
};
hud.onStampClick = selectUnit;

// ---------------- online ----------------
const teamOfPid = (pid) => { const i = game.seats.indexOf(pid); return i < 0 ? 0 : i % 2 === 0 ? 1 : 2; };
function broadcastLobby() {
  if (!net.isHost) return;
  net.send('lobby', { players: [...lobby.players].map(([id, p]) => ({ id, name: p.name })), code: net.aliasCode || net.code, isPublic: lobby.isPublic });
}
function renderLobby() { if (game.state === 'lobby') showStart(); }
function leaveOnline(reason = '') {
  net.leave(); lobby.players.clear(); lobby.code = '';
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
    lobby.players.set(net.id, { name: myName }); renderLobby();
  } catch (e) { lobby.status = '加入失败：' + (e.message || e); showStart(); }
}
async function quickPlay() {
  lobby.status = '正在寻找开放的大厅…'; showStart();
  try {
    await net.quickJoin({ name: myName }, (s) => { lobby.status = s; const el = document.getElementById('status'); if (el) el.textContent = s; });
    lobby.code = net.code; lobby.status = '';
    game.state = 'lobby'; game.screen = 'lobby';
    lobby.players.set(net.id, { name: myName }); renderLobby();
  } catch (e) { lobby.status = '没找到公开房，正在自己开一间…'; showStart(); await createLobby(true); }
}
function hostStart() {
  if (!net.isHost || game.state !== 'lobby') return;
  const ids = [...lobby.players.keys()];
  const seats = ids.slice(0, 4);
  const names = seats.map((id) => (lobby.players.get(id) || {}).name || '涂鸦');
  state = onlineState();
  game.seats = seats.slice(); game.names = names;
  game.mode = 'ffa'; game.myTeam = 1; game.spectator = false;
  game.display = onlineState();
  net.inMatch = true; net.accepting = true;
  const start = { seats, names, snap: encodeSnap(state) };
  game.lastStart = start;
  net.send('start', start);
  scene.sync(state); enterPlay();
}
function startOnline(d) {
  state = onlineState();
  game.display = onlineState();
  applySnap(game.display, d.snap, 0);
  game.seats = (d.seats || []).slice(); game.names = (d.names || []).slice();
  const i = game.seats.indexOf(net.id);
  game.spectator = i < 0; game.myTeam = i >= 0 ? (i % 2 === 0 ? 1 : 2) : 1;
  game.mode = 'ffa'; game.level = -1;
  scene.sync(game.display); enterPlay();
}
net.onPeerJoin = (id, meta) => {
  const name = String((meta && meta.name) || '涂鸦').slice(0, 12);
  lobby.players.set(id, { name });
  if (!net.isHost) return;
  if (game.state === 'play') {
    net.sendTo(id, 'start', { seats: game.seats, names: game.names, snap: encodeSnap(state) });
    hud.tip(`${esc(name)} 加入观战`, 2);
  } else { broadcastLobby(); renderLobby(); }
};
net.onPeerLeave = (id) => { lobby.players.delete(id); if (net.isHost) { broadcastLobby(); renderLobby(); } };
net.onDisconnect = () => leaveOnline('房主离开了大厅');
net.on('refused', (d) => leaveOnline(d.reason || '房间已满'));
net.on('lobby', (d) => {
  lobby.players.clear();
  for (const p of d.players) lobby.players.set(p.id, { name: p.name });
  lobby.code = d.code; lobby.isPublic = !!d.isPublic; renderLobby();
});
net.on('start', (d) => startOnline(d));
net.on('intent', (d, from) => {
  if (!net.isHost || game.state !== 'play') return;
  const team = teamOfPid(from);
  if (team && d && Number.isInteger(d.lane) && UNITS[d.type]) pendingIntents.push({ team, lane: d.lane, type: d.type });
});
net.on('snap', (d) => {
  if (net.isHost || game.state !== 'play') return;
  lastSnap = d;
  applySnap(game.display, d, 0);
  playEvents(d.e || []);
  if (d.w) endMatch(d.w);
});
net.on('end', (d) => { if (!net.isHost && game.state === 'play') endMatch(d.w); });
net.on('backtolobby', () => { game.state = 'lobby'; game.screen = 'lobby'; hud.setGameplayVisible(false); showStart(); });

// ---------------- panels ----------------
function settingsHTML() {
  return `<div class="settings">
    <label>名字 <input type="text" id="nameInput" maxlength="12" value="${esc(myName)}" style="width:170px;font-size:18px;letter-spacing:0"></label>
    <label><input type="checkbox" id="musicBox" ${musicWanted ? 'checked' : ''}> 8-bit 音乐 <span class="k">M 键切换</span></label>
  </div>`;
}
function mainHTML() {
  const levels = Array.from({ length: LEVEL_COUNT }, (_, i) =>
    `<button data-level="${i}" class="${chosenLevel === i ? 'on' : ''}" ${i >= unlocked ? 'disabled' : ''}>${i + 1}</button>`).join('');
  return `<h1>盖章大战</h1><h2>Stamp Duel · 作业本上的三车道印章塔防</h2>
    <div class="tags"><span class="tag">单击操作</span><span class="tag">三车道推塔</span><span class="tag">单机 / 联机</span></div>
    <p>墨水会自己回满，攒够了就<b>点己方半页的车道盖下一枚印章</b>。单位自动沿车道推进，遇敌停下互射；谁先把对面的墨水瓶打爆谁赢。<br>四种印章各有所长，1–4 数字键随时切换。</p>
    <div class="cols">
      <div><div class="colhead">四种印章</div>${UNIT_LIST.map((t) => `${UNITS[t].name}（${UNITS[t].cost} 墨）：${UNITS[t].desc}`).join('<br>')}</div>
      <div><div class="colhead">模式</div><b>闯关</b>：10 关涂改液怪潮，逐关解锁印章、敌方节奏越来越快<br><b>联机</b>：1v1 / 2v2 共享一座墨水瓶与本队墨水，3 分钟定胜负<br>胜利后可一键续下一关</div>
    </div>
    <div class="row" style="margin-top:14px"><button class="primary" id="soloBtn">开始闯关</button><button id="onlineBtn">联机对战</button></div>
    <div class="levels" id="levels">${levels}</div>
    <div class="row"><span class="status">已解锁 ${unlocked} / ${LEVEL_COUNT} 关 · 累计胜场 ${wins}</span></div>
    ${settingsHTML()}
    <div class="go">挑一个按钮，开始盖章 →</div>`;
}
function onlineHTML() {
  return `<h1>联机对战</h1><h2>房主权威模拟 · 不需要游戏服务器</h2>
    <p>前 4 人按座位交替分队（蓝 / 红 / 蓝 / 红），同队共享一座墨水瓶与一条墨水条，谁都能在己方半页部署。第 5 人起自动观战。</p>
    <div class="row"><button class="primary" id="quickBtn">快速匹配</button><button id="pubBtn">创建公开房</button><button id="privBtn">创建私房</button></div>
    <div class="row"><input type="text" id="codeInput" maxlength="5" placeholder="房间码"><button id="joinBtn">加入</button></div>
    <div class="row"><button class="alt" id="backBtn">返回主菜单</button></div>
    <div class="status" id="status">${esc(lobby.status || '')}</div>`;
}
function lobbyHTML() {
  const shown = String(net.aliasCode || lobby.code || '').replace(/-\d+$/, '');
  const rows = [...lobby.players].map(([id, p], i) =>
    `<div class="row ${id === net.id ? 'me' : ''}"><span>${esc(p.name)}</span><span>${id === net.id && net.isHost ? '房主' : i % 2 === 0 ? '蓝队' : '红队'}</span></div>`).join('');
  return `<h1>候机厅</h1><h2>${lobby.isPublic ? '公开房' : '私人房'} · ${lobby.players.size}/${net.maxPlayers} 人</h2>
    <div class="code">${esc(shown)}</div>
    <p>前 4 人上场，第 5 人起观战。同队共享墨水，商量好谁盖肉盾谁盖弓手。</p>
    <div class="scoreboard">${rows || '<div class="row"><span>还没有人加入</span></div>'}</div>
    <div class="row">${net.isHost ? '<button class="primary" id="startBtn">开始对局</button>' : '<span class="status">等房主开始…</span>'}<button class="alt" id="leaveBtn">离开</button></div>
    <div class="status" id="status">${esc(lobby.status || '')}</div>`;
}
function pauseHTML() {
  return `<h1>暂停</h1><h2>${game.mode === 'solo' ? LEVELS[game.level].name : '联机对战'}</h2>
    <p>点车道部署 · <b>1–4</b> 切换印章 · <b>M</b> 音乐 · <b>R</b> 重开</p>
    ${settingsHTML()}
    <div class="row"><button class="alt" id="leaveBtn">退出到主菜单</button></div>
    <div class="go">点击任意位置继续</div>`;
}
function overHTML(winner) {
  const win = winner === game.myTeam, draw = winner === DRAW;
  const next = soloNextLevel(winner);
  const cleared = win && game.mode === 'solo' && game.level === LEVEL_COUNT - 1;
  const title = cleared ? '全部通关！' : draw ? '平局' : win ? '墨水瓶打爆了！' : '己方墨水瓶碎了';
  const sub = cleared ? '十张纸面都归你了'
    : next >= 0 ? `第 ${game.level + 1} 关通过 · 下一关：${LEVELS[next].name}`
      : draw ? '两边都没墨了' : win ? '红笔给你画了个大勾' : '留点墨水给巨兽，再来一盘';
  const buttons = next >= 0
    ? `<button class="primary" id="nextBtn">下一关 · ${esc(LEVELS[next].name)}</button><button id="againBtn">重玩本关</button>`
    : '<button class="primary" id="againBtn">再来一局</button>';
  return `<h1>${title}</h1><h2>${sub}</h2>
    <div class="row">${buttons}${net.active && net.isHost ? '<button id="lobbyBtn">返回大厅</button>' : ''}<button class="alt" id="menuBtn">主菜单</button></div>
    <div class="go">${next >= 0 ? '点空白处或按 Enter 直接进下一关' : '点击空白处继续'}</div>`;
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
    name.addEventListener('change', (e) => { e.stopPropagation(); myName = String(name.value || '涂鸦').slice(0, 12); localStorage.setItem('sd_name', myName); net.hostName = myName; });
  }
  const music = hud.el.panel.querySelector('#musicBox');
  if (music) music.addEventListener('change', (e) => { e.stopPropagation(); musicWanted = !!music.checked; localStorage.setItem('sd_music', musicWanted ? '1' : '0'); applyMusic(); });
  for (const b of hud.el.panel.querySelectorAll('[data-level]')) {
    b.addEventListener('click', (e) => { e.stopPropagation(); chosenLevel = Number(b.dataset.level); showStart(); });
  }
}
function showStart() {
  hud.setGameplayVisible(false);
  const html = game.screen === 'lobby' ? lobbyHTML() : game.screen === 'online' ? onlineHTML() : mainHTML();
  hud.showScreen(html); wireSettings();
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
  game.menu = true; game.state = 'pause';
  hud.showScreen(pauseHTML()); wireSettings(); wire('leaveBtn', () => leaveOnline());
}
function resume() { if (game.state === 'pause') { game.state = 'play'; game.menu = false; hud.hideScreen(); hud.setGameplayVisible(true); } }
hud.onScreenClick = () => {
  if (game.state === 'pause') { resume(); return; }
  if (game.state === 'over') {
    const next = soloNextLevel(game.over);
    if (next >= 0) { beginSolo(next); return; }
    if (net.active) { if (net.isHost) net.send('backtolobby', {}); game.state = 'lobby'; game.screen = 'lobby'; showStart(); }
    else { game.screen = 'main'; game.state = 'start'; resetMenu(); showStart(); }
  }
};
function endMatch(winner) {
  if (game.state === 'over') return;   // both the snapshot and the explicit end message can arrive
  game.state = 'over'; game.menu = false; game.over = winner;
  const win = winner === game.myTeam, draw = winner === DRAW;
  if (game.mode === 'solo' && win) {
    wins++; localStorage.setItem('sd_wins', String(wins));
    if (game.level + 2 > unlocked) { unlocked = Math.min(LEVEL_COUNT, game.level + 2); localStorage.setItem('sd_level', String(unlocked)); }
    audio.waveClear();
    effects.fireworks(6);
  } else if (!draw) audio.death();
  hud.setGameplayVisible(false);
  hud.showScreen(overHTML(winner));
  const next = soloNextLevel(winner);
  wire('nextBtn', () => beginSolo(next));
  wire('againBtn', () => {
    if (game.mode === 'solo') beginSolo(game.level);
    else if (net.isHost) hostStart();
  });
  wire('lobbyBtn', () => { if (net.isHost) net.send('backtolobby', {}); game.state = 'lobby'; game.screen = 'lobby'; showStart(); });
  wire('menuBtn', () => leaveOnline());
}

// ---------------- loop ----------------
let last = performance.now();
function stepFrame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (game.state === 'play' && !game.menu) {
    if (game.mode === 'solo' || net.isHost) {
      step(state, dt, pendingIntents.splice(0));
      const events = state.events.splice(0);
      playEvents(events);
      scene.sync(state); refreshHud();
      if (net.isHost && game.mode !== 'solo') {
        game.pending.push(...events);
        game.netT -= dt;
        if (game.netT <= 0) {
          game.netT = 1 / 15;
          const snap = encodeSnap(state); snap.e = game.pending.splice(0);
          net.send('snap', snap);
        }
      }
      if (state.winner) {
        if (net.isHost && game.mode !== 'solo') net.send('end', { w: state.winner });
        endMatch(state.winner);
      }
    } else {
      if (lastSnap) { applySnap(game.display, lastSnap, dt); scene.sync(game.display); refreshHud(); }
    }
  }
  hurtFlash = Math.max(0, hurtFlash - dt * 2.2);
  effects.update(dt); hud.update(dt);
  R.render(now / 1000, { hurt: hurtFlash });
}
function tick(now) { requestAnimationFrame(tick); stepFrame(now); }
window.addEventListener('pagehide', () => { if (net.active) net.leave(); });

resetMenu(); showStart();
window.__stampduel = {
  R, scene, state: () => state, display: () => game.display, game, net, hud, effects,
  beginSolo, hostStart, endMatch, step, createState, levelState, onlineState,
  encodeSnap, applySnap, LANES, FIELD_HALF, UNIT_LIST, UNITS, LEVELS,
  playEvents, floater, audio,
};
requestAnimationFrame(tick);

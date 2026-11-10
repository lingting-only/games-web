// Ink Five bootstrap: menu / solo stages / free play / online lobby / result. Only the host owns
// the authoritative board; clients send a coordinate and replay the resulting state + events.
import * as THREE from 'three';
import { InkRenderer, INK } from './render.js';
import { Board, CELL, HALF, cellToWorld, worldToCell } from './board.js';
import {
  N, idx, inBoard, applyMove, createState, encodeState, decodeState,
  undo, teamOfSeat, currentSeatPid, POWER_INFO, POWER, findLine, DRAW, BLUE, RED,
} from './rules.js';
import { LEVELS, LEVEL_COUNT, levelState, freeState, scatterPowers } from './levels.js';
import { chooseMove } from './ai.js';
import { Effects } from './effects.js';
import { audio } from './audio.js';
import { Net } from './net.js';
import { HUD, esc } from './hud.js';
import { PointerInput } from './pointer.js';
import { clamp } from './util.js';

const canvas = document.getElementById('c');
const R = new InkRenderer(canvas);
R.tilt = 0;   // straight top-down: a tilted camera projects the thin grid bars as double lines
R.frame(HALF + 3.5, HALF + 3.5);
R.post.uniforms.uGridOn.value = 1;
R.post.uniforms.uGridCell.value = CELL;
R.post.uniforms.uGridHalf.value = HALF;
const effects = new Effects(R.scene);
const hud = new HUD(document.getElementById('hud'));
const net = new Net();
const input = new PointerInput(canvas);
const board = new Board(R.scene);

let state = createState();
const lobby = { players: new Map(), code: '', isPublic: true, status: '' };
const game = {
  state: 'start', screen: 'main', mode: 'solo', menu: false,
  level: 0, diff: 1, myTeam: BLUE, mySeat: 0, spectator: false,
  aiDepth: 3, aiPending: false, aiTimer: 0,
  seats: [], names: [], undoReq: null, over: null,
};

// ---------------- saved bits ----------------
let myName = (localStorage.getItem('if_name') || '').slice(0, 12) || '蓝笔' + Math.floor(Math.random() * 90 + 10);
let unlocked = clamp(Number(localStorage.getItem('if_level') || 1), 1, LEVEL_COUNT);
let wins = Number(localStorage.getItem('if_wins') || 0);
let musicWanted = localStorage.getItem('if_music') !== '0';
let chosenLevel = unlocked - 1;
let chosenDiff = 1;
const applyMusic = () => { audio.init(); audio.musicOn(musicWanted && game.state === 'play'); };

// ---------------- effects & result ----------------
function playEvents(events) {
  for (const e of events || []) {
    if (e.t === 'place') {
      const [x, z] = cellToWorld(e.c, e.r);
      effects.ring(x, z, e.team === BLUE ? INK.BLUE : INK.RED, 1.0, 0.28);
      audio.tick();
    } else if (e.t === 'power') {
      const info = POWER_INFO[e.p];
      const [x, z] = cellToWorld(e.i % N, (e.i / N) | 0);
      effects.strokeBurst(x, z, info.ink, 14, 3, { life: 0.5 });
      audio.pickup();
      hud.tip(`<b>${esc(info.name)}</b> · ${esc(info.desc)}`, 2.2);
    } else if (e.t === 'blocked') {
      hud.tip('道具被回形针冻住了！', 1.8);
    } else if (e.t === 'erase') {
      const [x, z] = cellToWorld(e.i % N, (e.i / N) | 0);
      effects.strokeBurst(x, z, INK.BLACK, 8, 2, { life: 0.4 });
      if (e.boss) hud.tip('涂改液怪擦掉了你的一颗子', 1.8);
    }
  }
}
function applyResult(res) {
  if (!res) return false;
  state = res.state;
  board.sync(state);
  playEvents(res.events);
  refreshHud();
  if (state.winner) { endMatch(state.winner); return true; }
  if (game.mode === 'solo' && state.turn === RED) scheduleAI();
  return true;
}
function play(move, team) { return applyResult(applyMove(state, move.c, move.r, team)); }

function scheduleAI() {
  if (game.mode !== 'solo' || state.winner || state.turn !== RED) return;
  game.aiPending = true;
  refreshHud();
  clearTimeout(game.aiTimer);
  game.aiTimer = setTimeout(() => {
    game.aiPending = false;
    if (game.state !== 'play' || game.menu || state.winner || state.turn !== RED) return;
    const m = chooseMove(state, { depth: game.aiDepth });
    if (m) play({ c: m.c, r: m.r }, RED);
  }, 340);
}

// ---------------- match setup ----------------
function refreshHud() {
  hud.setTurn(state.turn, game.myTeam, game.aiPending);
  hud.setMove(state.moveNo);
  const rows = [];
  if (game.mode === 'solo') {
    rows.push({ name: myName, tag: '蓝 ○', me: true, color: '#1a30c0' });
    rows.push({ name: '红笔怪', tag: '红 ✗', me: false, color: '#d02030' });
    hud.setMode(game.level >= 0
      ? `第 ${game.level + 1} 关 · ${LEVELS[game.level].name}`
      : `自由对局 · ${['简单', '普通', '困难'][game.diff]}`);
  } else {
    game.seats.forEach((pid, i) => rows.push({
      name: game.names[i] || '涂鸦',
      tag: teamOfSeat(i) === BLUE ? '蓝 ○' : '红 ✗',
      me: pid === net.id, color: teamOfSeat(i) === BLUE ? '#1a30c0' : '#d02030',
    }));
    if (game.spectator) rows.push({ name: myName, tag: '观战', me: true, color: '#8a8a8a' });
    hud.setMode(`联机 · ${game.seats.length} 人${game.spectator ? '（观战）' : ''}`);
  }
  hud.setBoard(rows);
}
function beginSolo(level) {
  net.leave();
  game.mode = 'solo'; game.state = 'play'; game.menu = false;
  game.level = level; chosenLevel = level;
  game.myTeam = BLUE; game.spectator = false; game.seats = [1, 2];
  game.names = [myName, '红笔怪'];
  state = levelState(level);
  game.aiDepth = LEVELS[level].depth;
  game.aiPending = false; clearTimeout(game.aiTimer);
  game.undoReq = null; game.over = null;
  board.sync(state); effects.clear();
  hud.setGameplayVisible(true); hud.hideScreen(); hud.setUndo('');
  hud.message(LEVELS[level].name, LEVELS[level].hint, 2.4);
  refreshHud(); applyMusic();
}
function beginFree(diff) {
  beginSolo(chosenLevel);
  game.level = -1; game.diff = diff; chosenDiff = diff;
  state = freeState(diff);
  game.aiDepth = 1 + diff;
  board.sync(state);
  hud.message('自由对局', ['简单', '普通', '困难'][diff] + ' · 空盘开局', 2);
  refreshHud();
}
function enterPlay() {
  game.state = 'play'; game.menu = false; game.over = null;
  hud.setGameplayVisible(true); hud.hideScreen(); hud.setUndo('');
  hud.message('五子连线', '先连成五子者获胜', 2);
  refreshHud(); applyMusic();
}
function resetMenu() {
  net.leave();
  game.mode = 'solo'; game.state = 'start'; game.menu = false;
  game.spectator = false; game.seats = []; game.names = []; game.undoReq = null;
  game.aiPending = false; clearTimeout(game.aiTimer);
  state = createState();
  state.powers = scatterPowers(4242, 8);
  for (const [c, r, t] of [[7, 7, 1], [6, 6, 2], [8, 8, 1], [6, 8, 2], [8, 6, 1]]) state.board[idx(c, r)] = t;
  board.sync(state);
  hud.setGameplayVisible(false); hud.setUndo('');
}

// ---------------- input ----------------
const _ray = new THREE.Raycaster(), _v2 = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), _hit = new THREE.Vector3();
input.onClick = (ndc) => {
  if (game.state !== 'play' || game.menu || game.aiPending || state.winner) return;
  audio.init(); audio.resume();
  _ray.setFromCamera(_v2.set(ndc.x, ndc.y), R.camera);
  if (!_ray.ray.intersectPlane(_plane, _hit)) return;
  const [c, r] = worldToCell(_hit.x, _hit.z);
  if (!inBoard(c, r)) return;
  const [wx, wz] = cellToWorld(c, r);
  if (Math.hypot(_hit.x - wx, _hit.z - wz) > CELL * 0.56) return;
  if (game.spectator) { hud.tip('观战中，不能落子', 1.6); return; }
  if (game.mode === 'solo') {
    if (state.turn !== game.myTeam) return;
    play({ c, r }, game.myTeam);
  } else {
    if (currentSeatPid(state) !== net.id) return;
    if (net.isHost) hostMove({ c, r }, net.id);
    else net.broadcast('intent', { c, r });
  }
};
input.onAnyInput = () => { audio.init(); audio.resume(); };
input.onKey = (action) => {
  if (action === 'pause') { if (game.state === 'pause') resume(); else pause(); }
  else if (action === 'music') { musicWanted = !musicWanted; localStorage.setItem('if_music', musicWanted ? '1' : '0'); applyMusic(); hud.tip(musicWanted ? '音乐：开' : '音乐：关', 1.5); }
  else if (action === 'undo') requestUndo();
  else if (action === 'confirm') {
    if (game.state === 'over') {
      const next = soloNextLevel(game.over);
      if (next >= 0) beginSolo(next);
      else { game.screen = 'main'; game.state = 'start'; showStart(); }
    } else if (game.state === 'pause') resume();
  }
  else if (action === 'restart') { if (game.mode === 'solo' && (game.state === 'play' || game.state === 'over')) { if (game.level >= 0) beginSolo(game.level); else beginFree(game.diff); } }
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
  net.leave(); lobby.players.clear(); lobby.code = '';
  game.state = 'start'; game.screen = 'main'; game.menu = false;
  game.over = null; game.undoReq = null; lobby.status = reason;
  resetMenu(); showStart();
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
  } catch (e) { lobby.status = '没找到公开房，正在自己开一间…'; showStart(); await createLobby(true); }
}
function hostStart() {
  if (!net.isHost || game.state !== 'lobby') return;
  const ids = [...lobby.players.keys()];
  const seats = ids.slice(0, 4);
  const names = seats.map((id) => (lobby.players.get(id) || {}).name || '涂鸦');
  state = createState({ seats });
  state.powers = scatterPowers(7301, 10);
  game.seats = seats.slice(); game.names = names;
  game.mySeat = 0; game.myTeam = teamOfSeat(0); game.spectator = false;
  game.mode = 'ffa'; game.level = -1; game.undoReq = null;
  net.inMatch = true; net.accepting = true;
  net.send('start', { s: encodeState(state), seats, names });
  board.sync(state);
  enterPlay();
}
function startOnline(d) {
  state = decodeState(d.s);
  game.seats = (d.seats || []).slice(); game.names = (d.names || []).slice();
  const i = game.seats.indexOf(net.id);
  game.mySeat = i; game.spectator = i < 0; game.myTeam = i >= 0 ? teamOfSeat(i) : 0;
  game.mode = 'ffa'; game.level = -1; game.undoReq = null;
  board.sync(state);
  enterPlay();
}
function hostMove(move, from) {
  if (!net.isHost || game.state !== 'play' || state.winner) return;
  if (currentSeatPid(state) !== from) return;
  const res = applyMove(state, move.c, move.r, teamOfSeat(state.seat));
  if (!res) return;
  state = res.state;
  board.sync(state); playEvents(res.events); refreshHud();
  net.send('state', { s: encodeState(state), e: res.events });
  if (state.winner) { net.send('end', { w: state.winner }); endMatch(state.winner); }
}
net.onPeerJoin = (id, meta) => {
  const name = String((meta && meta.name) || '涂鸦').slice(0, 12);
  lobby.players.set(id, { name });
  if (!net.isHost) return;
  if (game.state === 'play') {
    net.sendTo(id, 'start', { s: encodeState(state), seats: game.seats, names: game.names });
    hud.tip(`${esc(name)} 加入观战`, 2);
  } else { broadcastLobby(); renderLobby(); }
};
net.onPeerLeave = (id) => { lobby.players.delete(id); if (net.isHost) { broadcastLobby(); renderLobby(); } };
net.onDisconnect = () => leaveOnline('房主离开了大厅');
net.on('refused', (d) => leaveOnline(d.reason || '房间已满'));
net.on('lobby', (d) => {
  lobby.players.clear();
  for (const p of d.players) lobby.players.set(p.id, { name: p.name });
  lobby.code = d.code; lobby.isPublic = !!d.isPublic;
  renderLobby();
});
net.on('start', (d) => startOnline(d));
net.on('intent', (d, from) => hostMove(d, from));
net.on('state', (d) => {
  if (game.state !== 'play' || net.isHost) return;
  state = decodeState(d.s); board.sync(state); playEvents(d.e || []); refreshHud();
  if (state.winner) endMatch(state.winner);
});
net.on('end', (d) => { if (!net.isHost && game.state === 'play') endMatch(d.w); });
net.on('backtolobby', () => { game.state = 'lobby'; game.screen = 'lobby'; hud.setGameplayVisible(false); hud.setUndo(''); showStart(); });

// ---------------- undo negotiation ----------------
function requestUndo() {
  if (game.state !== 'play' || game.spectator || state.winner) return;
  if (game.mode === 'solo') {
    let t = undo(state); if (t) t = undo(t);
    if (t) { state = t; board.sync(state); refreshHud(); hud.tip('已悔棋', 1.5); }
    return;
  }
  if (!net.active || game.undoReq) return;
  if (net.isHost) startUndo(net.id); else net.broadcast('undoreq', {});
}
function playerName(pid) {
  const i = game.seats.indexOf(pid);
  return (i >= 0 && game.names[i]) || (lobby.players.get(pid) || {}).name || '对手';
}
function startUndo(from) {
  if (game.undoReq) return;
  game.undoReq = { from, votes: new Set(), need: Math.max(1, game.seats.length - 1) };
  net.send('askundo', { from });
  showUndoBox(from);
}
function showUndoBox(from) {
  hud.setUndo(`${esc(playerName(from))} 请求悔棋 <button id="undoYes">同意</button><button id="undoNo">拒绝</button>`);
  const yes = hud.el.undobox.querySelector('#undoYes'), no = hud.el.undobox.querySelector('#undoNo');
  if (yes) yes.addEventListener('click', (e) => { e.stopPropagation(); voteUndo(true); });
  if (no) no.addEventListener('click', (e) => { e.stopPropagation(); voteUndo(false); });
}
function voteUndo(ok) {
  if (!game.undoReq) return;
  if (net.isHost) tallyUndo(net.id, ok); else net.broadcast('undovote', { ok });
  hud.setUndo('');
}
function tallyUndo(from, ok) {
  const u = game.undoReq; if (!u) return;
  if (!ok) { net.send('undocancel', {}); game.undoReq = null; hud.setUndo(''); hud.tip('悔棋被拒绝', 1.5); return; }
  u.votes.add(from);
  if (u.votes.size < u.need) return;
  let t = undo(state);
  if (t && game.seats.length === 2) t = undo(t);
  if (t) {
    state = t; board.sync(state); refreshHud();
    net.send('state', { s: encodeState(state), e: [] });
    net.send('undodone', {}); hud.tip('悔棋成功', 1.5);
  }
  game.undoReq = null; hud.setUndo('');
}
net.on('undoreq', (d, from) => { if (net.isHost) startUndo(from); });
net.on('askundo', (d) => { if (game.state === 'play') showUndoBox(d.from); });
net.on('undovote', (d, from) => { if (net.isHost) tallyUndo(from, d.ok); });
net.on('undocancel', () => { game.undoReq = null; hud.setUndo(''); hud.tip('悔棋被拒绝', 1.5); });
net.on('undodone', () => { game.undoReq = null; hud.setUndo(''); });

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
  const diffs = ['简单', '普通', '困难'].map((n, i) =>
    `<button data-diff="${i}" class="${chosenDiff === i ? 'on' : ''}">${n}</button>`).join('');
  return `<h1>墨水连珠</h1><h2>Ink Five · 作业本上的五子棋，还带四种道具</h2>
    <div class="tags"><span class="tag">单击操作</span><span class="tag">回合制</span><span class="tag">单机 / 联机</span></div>
    <p>点格点落一枚手绘棋子：蓝圆珠笔画 ○，红笔画 ✗，先连成五子者胜。<br>落在荧光格上会触发道具 —— 炸墨渍、擦棋子、连下两手、冻住对手的道具。</p>
    <div class="cols">
      <div><div class="colhead">怎么赢</div>横、竖、斜任意方向连成五子<br>抢道具格能一次扭转局面<br>对手的四连必须先堵住</div>
      <div><div class="colhead">模式</div><b>闯关</b>：8 关，前两关是一步必胜残局，末关是涂改液 Boss<br><b>自由对局</b>：空盘开局，三档 AI 深度<br><b>联机</b>：1v1 / 2v2 轮流，可悔棋、可观战</div>
    </div>
    <div class="row" style="margin-top:14px"><button class="primary" id="soloBtn">开始闯关</button><button id="freeBtn">自由对局</button><button id="onlineBtn">联机对战</button></div>
    <div class="levels" id="levels">${levels}</div>
    <div class="difficulty" id="diffs">${diffs}</div>
    <div class="row"><span class="status">已解锁 ${unlocked} / ${LEVEL_COUNT} 关 · 累计胜场 ${wins}</span></div>
    ${settingsHTML()}
    <div class="go">挑一个按钮，开始落子 →</div>`;
}
function onlineHTML() {
  return `<h1>联机对战</h1><h2>房主校验每一步 · 不需要游戏服务器</h2>
    <p>1v1 或 2v2 轮流落子（A1 → B1 → A2 → B2）。后来的人自动观战，悔棋需要所有对手同意。</p>
    <div class="row"><button class="primary" id="quickBtn">快速匹配</button><button id="pubBtn">创建公开房</button><button id="privBtn">创建私房</button></div>
    <div class="row"><input type="text" id="codeInput" maxlength="5" placeholder="房间码"><button id="joinBtn">加入</button></div>
    <div class="row"><button class="alt" id="backBtn">返回主菜单</button></div>
    <div class="status" id="status">${esc(lobby.status || '')}</div>`;
}
function lobbyHTML() {
  const shown = String(net.aliasCode || lobby.code || '').replace(/-\d+$/, '');
  const rows = [...lobby.players].map(([id, p]) =>
    `<div class="row ${id === net.id ? 'me' : ''}"><span>${esc(p.name)}</span><span>${id === net.id && net.isHost ? '房主' : '棋手'}</span></div>`).join('');
  return `<h1>候机厅</h1><h2>${lobby.isPublic ? '公开房' : '私人房'} · ${lobby.players.size}/${net.maxPlayers} 人</h2>
    <div class="code">${esc(shown)}</div>
    <p>前 4 人按座位轮流落子，第 5 人起观战。</p>
    <div class="scoreboard">${rows || '<div class="row"><span>还没有人加入</span></div>'}</div>
    <div class="row">${net.isHost ? '<button class="primary" id="startBtn">开始对局</button>' : '<span class="status">等房主开始…</span>'}<button class="alt" id="leaveBtn">离开</button></div>
    <div class="status" id="status">${esc(lobby.status || '')}</div>`;
}
function pauseHTML() {
  return `<h1>暂停</h1><h2>${game.level >= 0 ? LEVELS[game.level].name : '自由对局 / 联机'}</h2>
    <p>点格点落子 · <b>U</b> 请求悔棋 · <b>R</b> 重开 · <b>M</b> 音乐</p>
    ${settingsHTML()}
    <div class="row"><button class="alt" id="leaveBtn">退出到主菜单</button></div>
    <div class="go">点击任意位置继续</div>`;
}
// a won stage unlocks the next one in endMatch(), so the result panel can offer a direct continue
function soloNextLevel(winner) {
  if (game.mode !== 'solo' || game.level < 0 || winner !== game.myTeam) return -1;
  const next = game.level + 1;
  return next < LEVEL_COUNT && next < unlocked ? next : -1;
}
function overHTML(winner) {
  const draw = winner === DRAW, win = winner === game.myTeam;
  const next = soloNextLevel(winner);
  const cleared = win && game.mode === 'solo' && game.level === LEVEL_COUNT - 1;
  const title = cleared ? '全部通关！' : draw ? '平局' : win ? '五子连成！' : '被反将一军';
  const sub = cleared ? '八张纸面都归你了'
    : next >= 0 ? `第 ${game.level + 1} 关通过 · 下一关：${LEVELS[next].name}`
      : draw ? '纸面写满了' : win ? '红笔给你画了个大勾' : '再来一盘，先堵住对手的四连';
  const buttons = next >= 0
    ? `<button class="primary" id="nextBtn">下一关 · ${esc(LEVELS[next].name)}</button><button id="againBtn">重玩本关</button>`
    : '<button class="primary" id="againBtn">再来一局</button>';
  return `<h1>${title}</h1><h2>${sub} · 共 ${state.moveNo} 手</h2>
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
    name.addEventListener('change', (e) => { e.stopPropagation(); myName = String(name.value || '涂鸦').slice(0, 12); localStorage.setItem('if_name', myName); net.hostName = myName; });
  }
  const music = hud.el.panel.querySelector('#musicBox');
  if (music) music.addEventListener('change', (e) => { e.stopPropagation(); musicWanted = !!music.checked; localStorage.setItem('if_music', musicWanted ? '1' : '0'); applyMusic(); });
  for (const b of hud.el.panel.querySelectorAll('[data-level]')) {
    b.addEventListener('click', (e) => { e.stopPropagation(); chosenLevel = Number(b.dataset.level); showStart(); });
  }
  for (const b of hud.el.panel.querySelectorAll('[data-diff]')) {
    b.addEventListener('click', (e) => { e.stopPropagation(); chosenDiff = Number(b.dataset.diff); showStart(); });
  }
}
function showStart() {
  hud.setGameplayVisible(false);
  const html = game.screen === 'lobby' ? lobbyHTML() : game.screen === 'online' ? onlineHTML() : mainHTML();
  hud.showScreen(html);
  wireSettings();
  if (game.screen === 'main') {
    wire('soloBtn', () => beginSolo(chosenLevel));
    wire('freeBtn', () => beginFree(chosenDiff));
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
  clearTimeout(game.aiTimer); game.aiPending = false;
  game.state = 'over'; game.menu = false; game.over = winner;
  const win = winner === game.myTeam, draw = winner === DRAW;
  if (game.mode === 'solo' && win) {
    wins++; localStorage.setItem('if_wins', String(wins));
    if (game.level >= 0 && game.level + 2 > unlocked) { unlocked = Math.min(LEVEL_COUNT, game.level + 2); localStorage.setItem('if_level', String(unlocked)); }
    audio.waveClear();
  } else if (!draw) audio.death();
  hud.setGameplayVisible(false); hud.setUndo('');
  hud.showScreen(overHTML(winner));
  const next = soloNextLevel(winner);
  wire('nextBtn', () => beginSolo(next));
  wire('againBtn', () => {
    if (game.mode === 'solo') { if (game.level >= 0) beginSolo(game.level); else beginFree(game.diff); }
    else if (net.isHost) hostStart();
  });
  wire('lobbyBtn', () => { if (net.isHost) net.send('backtolobby', {}); game.state = 'lobby'; game.screen = 'lobby'; showStart(); });
  wire('menuBtn', () => leaveOnline());
}

// ---------------- loop ----------------
let last = performance.now();
function step(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  effects.update(dt); hud.update(dt);
  R.render(now / 1000, {});
}
function tick(now) { requestAnimationFrame(tick); step(now); }
window.addEventListener('pagehide', () => { if (net.active) net.leave(); });

resetMenu();
showStart();
window.__inkfive = {
  R, board, state: () => state, game, net, hud, effects,
  beginSolo, beginFree, hostStart, chooseMove, applyMove, undo, play, endMatch, soloNextLevel,
  encodeState, decodeState, levelState, freeState, refreshHud,
  cellToWorld, worldToCell, CELL, HALF, idx, createState,
  findLine, POWER, N, LEVELS,
};
requestAnimationFrame(tick);

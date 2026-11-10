// Bootstrap: the state machine (menu / solo waves / online lobby / match / result), the loop,
// click resolution, scoring and persistence. Everything else lives in its own small module.
import * as THREE from 'three';
import { InkRenderer, INK } from './render.js';
import { World } from './physics.js';
import { Effects } from './effects.js';
import { audio } from './audio.js';
import { buildSky } from './sky.js';
import { Flight } from './flight.js';
import { PlaneVisual, SKINS } from './plane.js';
import { PointerInput } from './pointer.js';
import { PaperBalls, aimVelocity, BALL_SPEED } from './projectile.js';
import { EnemyManager } from './enemies.js';
import { RemotePlane, TEAM_INKS, encodeLocal } from './players.js';
import { Net } from './net.js';
import { HUD, esc } from './hud.js';
import { rand, choose } from './util.js';

const FFA_TARGET = 10, FFA_TIME = 480, RESPAWN = 2;
const mmss = (t) => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

const canvas = document.getElementById('c');
const R = new InkRenderer(canvas);
const world = new World();
const effects = new Effects(R.scene, world);
const sky = buildSky(R.scene, world);
const input = new PointerInput(canvas);
const hud = new HUD(document.getElementById('hud'));
const net = new Net();

const player = new Flight({ isLocal: true, name: '我' });
player.isLocal = true; player.kind = 'player'; player.ownerId = 'local';
player.followTarget = false; // locking aims the paper balls; waypoints still steer the plane
player.visual = new PlaneVisual(R.scene, { ink: INK.BLUE });

const ctx = {
  scene: R.scene, camera: R.camera, world, effects, audio,
  player, balls: null, enemies: null,
  targets: () => {
    const out = [];
    for (const e of enemies.list) if (e.alive) out.push(e);
    if (player.alive) out.push(player);
    for (const r of remote.values()) if (r.alive) out.push(r);
    return out;
  },
};
const balls = ctx.balls = new PaperBalls(ctx);
const enemies = ctx.enemies = new EnemyManager(ctx);
const remote = new Map();
const scores = new Map();
const lobby = { players: new Map(), hostId: null, code: '', isPublic: true, status: '' };
const game = {
  state: 'start', screen: 'main', mode: 'solo', menu: false, pausedFrom: 'play',
  time: 0, wave: 0, score: 0, kills: 0, combo: 0, comboT: 0,
  fireT: 0, locked: null, respawnT: 0, matchLeft: 0, clockRunning: false, netT: 0, over: null,
};

// ---------------- saved bits ----------------
let best = Number(localStorage.getItem('pw_best') || 0);
let checkpoint = Number(localStorage.getItem('pw_checkpoint') || 0);
let totalKills = Number(localStorage.getItem('pw_kills') || 0);
let myName = (localStorage.getItem('pw_name') || '').slice(0, 14) || '涂鸦' + Math.floor(rand(10, 99));
let skinKey = localStorage.getItem('pw_skin') || 'blue';
let musicWanted = localStorage.getItem('pw_music') !== '0';
const skinInk = () => (SKINS.find((s) => s.key === skinKey) || SKINS[0]).ink;
const teamInk = (id) => TEAM_INKS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % TEAM_INKS.length];

function applyMusic() {
  audio.init(); audio.setTune('district');
  audio.musicOn(musicWanted && (game.state === 'play' || game.state === 'pause'));
}

// ---------------- clicking ----------------
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
const _skyPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hitPoint = new THREE.Vector3(), _tmp = new THREE.Vector3(), _from = new THREE.Vector3(), _vel = new THREE.Vector3();
const _zero = new THREE.Vector3();

function handleClick(ndc) {
  if (game.state !== 'play' || game.menu || !player.alive) return;
  audio.init(); audio.resume();
  _ndc.set(ndc.x, ndc.y); _ray.setFromCamera(_ndc, R.camera);
  let best = null, bestT = Infinity;
  for (const t of ctx.targets()) {
    if (!t.alive || t.ownerId === player.ownerId) continue;
    _tmp.subVectors(t.pos, _ray.ray.origin);
    const tc = _tmp.dot(_ray.ray.direction);
    if (tc < 0 || tc > 220) continue;
    const r = (t.hitRadius || 1.2) * 2.6;
    if (_tmp.lengthSq() - tc * tc > r * r) continue;
    if (tc < bestT) { bestT = tc; best = t; }
  }
  // a forgiving second pass in screen space: clicking near a visible plane still locks it
  if (!best) {
    const cx = (ndc.x * 0.5 + 0.5) * window.innerWidth, cy = (-ndc.y * 0.5 + 0.5) * window.innerHeight;
    let bd = 115 * 115;
    for (const t of ctx.targets()) {
      if (!t.alive || t.ownerId === player.ownerId) continue;
      _lock.copy(t.pos).project(R.camera);
      if (_lock.z >= 1 || Math.abs(_lock.x) > 1.2 || Math.abs(_lock.y) > 1.2) continue;
      const dx = (_lock.x * 0.5 + 0.5) * window.innerWidth - cx;
      const dy = (-_lock.y * 0.5 + 0.5) * window.innerHeight - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = t; }
    }
  }
  if (best) {
    game.locked = best; player.setTarget(best);
    throwBall();
    hud.tip(`已锁定 <b>${esc(best.name || '敌机')}</b> · 橙色虚线是纸团落点`, 2.6);
  } else {
    _skyPlane.constant = -player.pos.y;
    if (_ray.ray.intersectPlane(_skyPlane, _hitPoint)) player.setWaypoint(_hitPoint);
    else player.setWaypoint(_ray.ray.origin.clone().addScaledVector(_ray.ray.direction, 45));
    effects.strokeBurst(player.waypoint, INK.ORANGE, 8, 3, { life: 0.4, size: 0.05 });
  }
}

function throwBall() {
  if (game.fireT > 0 || !player.alive) return;
  game.fireT = 0.42;
  const f = player.forward(_tmp);
  _from.copy(player.pos).addScaledVector(f, 2.2);
  const t = game.locked && game.locked.alive ? game.locked : null;
  if (t) aimVelocity(_from, t.pos, t.vel || _zero, BALL_SPEED, _vel);
  else _vel.copy(f).multiplyScalar(BALL_SPEED);
  balls.fire({ pos: _from, vel: _vel, dmg: 2, owner: player.ownerId, ink: skinInk() });
  audio.shot();
  hud.reticle(true); setTimeout(() => hud.reticle(false), 130);
}

function nearestTarget() {
  let best = null, bd = Infinity;
  for (const t of ctx.targets()) {
    if (!t.alive || t.ownerId === player.ownerId) continue;
    const d = t.pos.distanceToSquared(player.pos);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

// ---------------- damage plumbing ----------------
ctx.onFire = (p) => {
  if (net.active && p.owner === player.ownerId) relay('fire', {
    id: p.id, pos: p.pos.toArray(), vel: p.vel.toArray(), dmg: p.dmg, owner: p.owner, ink: p.ink, life: p.life,
  });
};
ctx.onEnemyHit = (e, p) => {
  enemies.damage(e, p.dmg, p);
  if (p.owner === player.ownerId) { audio.hitEnemy(e.pos); hud.reticle(true); setTimeout(() => hud.reticle(false), 130); }
};
ctx.onLocalHit = (t, p) => {
  if (!player.alive || player.shieldT > 0) return;
  effects.strokeBurst(player.pos, INK.RED, 12, 6, { life: 0.45, size: 0.04 });
  audio.hurt();
  const dead = player.takeDamage(p.dmg);
  hud.setHealth(player.hp, player.maxHp);
  game.combo = 0; hud.setScore(game.score, 0);
  if (dead) onLocalDeath(p.owner);
};
ctx.onRemoteHit = (t, p) => {
  effects.strokeBurst(t.pos, p.ink, 9, 4, { life: 0.3, size: 0.035 });
  if (p.owner === player.ownerId) { audio.hitEnemy(t.pos); hud.kill('命中 ' + t.name, 0); }
};

enemies.onKill = (e) => {
  game.kills++; totalKills++;
  game.combo++; game.comboT = 3.2;
  const pts = Math.round(e.score * (1 + Math.min(game.combo, 9) * 0.25));
  game.score += pts;
  localStorage.setItem('pw_kills', String(totalKills));
  if (game.score > best) { best = game.score; localStorage.setItem('pw_best', String(best)); }
  hud.setScore(game.score, game.combo);
  hud.kill('击落 ' + e.T.name, pts);
  audio.kill(!!e.T.boss);
  checkSkinUnlock();
};
enemies.onWaveClear = (n) => {
  hud.message('清空！', '下一波马上画上来', 1.8); audio.waveClear();
  if (n % 5 === 0 && n > checkpoint) { checkpoint = n; localStorage.setItem('pw_checkpoint', String(n)); }
  startWave(n + 1);
};
enemies.onBoss = (e) => hud.setBoss(e ? e.T.name : null, e ? e.hp / e.maxHp : null);

function checkSkinUnlock() {
  for (const s of SKINS) {
    if (s.need > 0 && totalKills >= s.need && !localStorage.getItem('pw_skin_' + s.key)) {
      localStorage.setItem('pw_skin_' + s.key, '1');
      hud.kill('解锁涂装：' + s.name, 0);
    }
  }
}
const skinUnlocked = (s) => s.need === 0 || totalKills >= s.need;

function onLocalDeath(killer) {
  effects.explosion(player.pos, 3.2, INK.BLUE);
  effects.strokeBurst(player.pos, INK.BLUE, 40, 9, { life: 0.8, size: 0.05 });
  audio.death();
  player.visual.update(0, { pos: player.pos, alive: false, t: game.time });
  if (game.mode === 'ffa') {
    relay('pdead', { killer, dir: player.forward(_tmp).toArray() });
    game.respawnT = RESPAWN;
    hud.message('折成纸屑', '2 秒后重新起飞', 1.8);
    const k = scores.get(killer);
    hud.kill(k ? '被 ' + k.name + ' 击落' : '被击落', 0);
  } else {
    game.state = 'dead';
    hud.setGameplayVisible(false);
    hud.showScreen(deadHTML());
    wire('againBtn', () => beginSolo(checkpoint));
    wire('menuBtn', () => { game.screen = 'main'; game.state = 'start'; showStart(); });
  }
}

function respawn() {
  player.reset(choose(sky.spawns), rand(0, Math.PI * 2));
  player.ownerId = net.active ? net.id : 'local';
  player.shieldT = 2;
  hud.setHealth(player.hp, player.maxHp);
  hud.message('重新起飞', '2 秒护盾', 1.4);
}

// ---------------- solo ----------------
function startWave(n) {
  game.wave = n;
  enemies.startWave(n);
  hud.setWave(n, enemies.alive);
  hud.message(n === 1 ? '起飞！' : `第 ${n} 波`, n % 5 === 0 ? '大纸鹤来了' : '把纸鹤都折下来', 2);
  hud.setTimer('');
}
function beginSolo(fromWave = 0) {
  net.leave(); clearRemote();
  game.mode = 'solo'; game.state = 'play'; game.menu = false; game.over = null;
  game.score = 0; game.kills = 0; game.combo = 0; game.comboT = 0; game.fireT = 0;
  game.locked = null; game.time = 0;
  player.ownerId = 'local'; player.visual.setInk(skinInk());
  player.reset(new THREE.Vector3(0, 18, 30), Math.PI);
  enemies.clear(); balls.clear(); effects.clear();
  for (const r of remote.values()) r.dispose(); remote.clear();
  hud.setScore(0, 0); hud.setHealth(player.hp, player.maxHp);
  hud.setWaveVisible(true); hud.setPvpScore(null); hud.setGameplayVisible(true); hud.hideScreen();
  hud.setWeapon('纸飞机', '点敌机投纸团 · 锁定后自动投弹 · 点空处设航点');
  applyMusic();
  startWave(fromWave + 1);
}

// ---------------- online ----------------
function relay(type, data) { if (net.isHost) net.send(type, data); else net.broadcast(type, data); }
function clearRemote() { for (const r of remote.values()) r.dispose(); remote.clear(); }
function addRemote(id, name) {
  if (remote.has(id) || id === net.id) return;
  const r = new RemotePlane(ctx, id, name, teamInk(id));
  remote.set(id, r);
}
function removeRemote(id) { const r = remote.get(id); if (r) { r.dispose(); remote.delete(id); } }
function lobbyRows() { return [...lobby.players.entries()].map(([id, p]) => ({ id, name: p.name })); }
function broadcastLobby() {
  if (!net.isHost) return;
  net.send('lobby', { players: lobbyRows(), hostId: net.id, code: net.aliasCode || net.code, isPublic: lobby.isPublic, inMatch: game.state === 'play' });
}
function scoreboardHTML() {
  const rows = [...scores.entries()].sort((a, b) => b[1].kills - a[1].kills || a[1].deaths - b[1].deaths);
  return `<div class="scoreboard">${rows.map(([id, s]) => `<div class="row ${id === net.id ? 'me' : ''}"><span>${esc(s.name)}</span><span>${s.kills} 分 · ${s.deaths} 次被击落</span></div>`).join('') || '<div class="row"><span>还没有人加入</span></div>'}</div>`;
}
function refreshScoreHud() {
  const me = scores.get(net.id);
  hud.setPvpScore(`我 ${me ? me.kills : 0} / ${FFA_TARGET} 分`);
  const rows = [...scores.values()].sort((a, b) => b.kills - a.kills);
  if (rows.length) hud.setScore(me ? me.kills : 0, 0);
}
function sendScores() { const rows = [...scores.entries()].map(([id, s]) => ({ id, ...s })); net.send('score', rows); applyScores(rows); }
function applyScores(rows) {
  scores.clear();
  for (const r of rows) scores.set(r.id, { name: r.name, kills: r.kills, deaths: r.deaths });
  refreshScoreHud();
}
function tallyDeath(victim, killer) {
  if (!net.isHost) return;
  const v = scores.get(victim); if (v) v.deaths++;
  if (killer && killer !== victim && scores.has(killer)) scores.get(killer).kills++;
  sendScores();
  let winner = null;
  for (const [id, s] of scores) if (s.kills >= FFA_TARGET) winner = { id, name: s.name };
  if (winner) { net.send('end', winner); endMatch(winner); }
}
function checkTimeUp() {
  if (!net.isHost || game.state !== 'play') return;
  let winner = null;
  for (const [id, s] of scores) if (!winner || s.kills > winner.kills) winner = { id, ...s };
  const w = winner ? { id: winner.id, name: winner.name } : { id: null, name: '平局' };
  net.send('end', w); endMatch(w);
}

function hostStart() {
  if (!net.isHost || game.state !== 'lobby') return;
  scores.clear();
  for (const [id, p] of lobby.players) scores.set(id, { name: p.name, kills: 0, deaths: 0 });
  net.send('start', { late: false });
  startMatch(false);
  sendScores();
}
function startMatch(late) {
  net.inMatch = true; net.accepting = true;
  game.mode = 'ffa'; game.state = 'play'; game.menu = false; game.over = null;
  game.score = 0; game.kills = 0; game.combo = 0; game.locked = null; game.fireT = 0; game.time = 0;
  game.matchLeft = FFA_TIME; game.clockRunning = lobby.players.size > 1;
  player.ownerId = net.active ? net.id : 'local';
  player.visual.setInk(teamInk(net.id || 'local'));
  player.reset(choose(sky.spawns), rand(0, Math.PI * 2));
  enemies.clear(); balls.clear(); effects.clear();
  for (const r of remote.values()) r.snap = null;
  hud.setHealth(player.hp, player.maxHp); hud.setWaveVisible(false);
  hud.setPvpScore('我 0 / ' + FFA_TARGET + ' 分');
  hud.setGameplayVisible(true); hud.hideScreen();
  hud.setWeapon('纸飞机', '点对手投纸团 · 锁定后自动投弹 · 点空处设航点');
  applyMusic();
  hud.message('自由混战', late ? '你加入了一场进行中的对战' : `先到 ${FFA_TARGET} 分 · 8 分钟`, 2.6);
  hud.tip('按住 <b>Tab</b> 查看计分板', 5);
}
function endMatch(winner) {
  net.inMatch = false;
  game.over = winner; game.state = 'over'; game.menu = false;
  hud.setGameplayVisible(false); hud.setBoard(null);
  hud.showScreen(overHTML(winner));
  wire('menuBtn', () => { leaveOnline(); });
}
function toLobby() {
  game.state = 'lobby'; game.screen = 'lobby'; game.menu = false; game.over = null;
  hud.setGameplayVisible(false); hud.setBoard(null);
  showStart(); broadcastLobby();
}
function leaveOnline(reason = '') {
  net.leave(); clearRemote(); scores.clear(); lobby.players.clear(); lobby.code = '';
  game.state = 'start'; game.screen = 'main'; game.menu = false; game.over = null;
  lobby.status = reason;
  hud.setGameplayVisible(false); hud.setBoard(null);
  showStart();
}

async function createLobby(isPublic) {
  lobby.status = '正在建房…'; showStart();
  try {
    net.hostName = myName;
    const code = await net.host({ isPublic });
    lobby.players.clear(); lobby.players.set(net.id, { name: myName });
    lobby.hostId = net.id; lobby.code = code; lobby.isPublic = isPublic; lobby.status = '';
    game.state = 'lobby'; game.screen = 'lobby';
    net.inMatch = false; net.accepting = true;
    broadcastLobby(); renderLobby();
  } catch (e) { lobby.status = '建房失败：' + (e.message || e); showStart(); }
}
async function joinLobby(code) {
  lobby.status = '正在加入…'; showStart();
  try {
    await net.join(code, { name: myName });
    lobby.code = net.code; lobby.hostId = net.hostId; lobby.status = '';
    game.state = 'lobby'; game.screen = 'lobby';
    lobby.players.set(net.id, { name: myName });
    renderLobby();
  } catch (e) { lobby.status = '加入失败：' + (e.message || e); showStart(); }
}
async function quickPlay() {
  lobby.status = '正在寻找开放的大厅…'; showStart();
  try {
    await net.quickJoin({ name: myName }, (s) => { lobby.status = s; const el = document.getElementById('status'); if (el) el.textContent = s; });
    lobby.code = net.code; lobby.hostId = net.hostId; lobby.status = '';
    game.state = 'lobby'; game.screen = 'lobby';
    lobby.players.set(net.id, { name: myName });
    renderLobby();
  } catch (e) {
    lobby.status = '没找到公开房，正在自己开一间…'; showStart();
    await createLobby(true);
  }
}

net.onPeerJoin = (id, meta) => {
  const name = String((meta && meta.name) || '涂鸦').slice(0, 14);
  lobby.players.set(id, { name });
  addRemote(id, name);
  broadcastLobby();
  if (game.state === 'play') {
    if (!scores.has(id) && net.isHost) scores.set(id, { name, kills: 0, deaths: 0 });
    if (net.isHost) { net.sendTo(id, 'start', { late: true }); sendScores(); }
    hud.kill(name + ' 加入了空域', 0);
  }
};
net.onPeerLeave = (id) => {
  const nm = (lobby.players.get(id) || {}).name || '某人';
  removeRemote(id); lobby.players.delete(id); scores.delete(id);
  broadcastLobby();
  if (game.state === 'play') { hud.kill(nm + ' 离开了', 0); refreshScoreHud(); }
};
net.onDisconnect = () => leaveOnline('房主离开了大厅');
net.on('refused', (d) => leaveOnline(d.reason || '房间已满'));
net.on('lobby', (d) => {
  lobby.hostId = d.hostId; lobby.isPublic = !!d.isPublic; lobby.shown = d.code;
  lobby.players.clear();
  for (const p of d.players) { lobby.players.set(p.id, { name: p.name }); if (p.id !== net.id) addRemote(p.id, p.name); }
  for (const id of [...remote.keys()]) if (!lobby.players.has(id)) removeRemote(id);
  renderLobby();
});
net.on('leave', (d) => {
  if (d && d.id) { removeRemote(d.id); lobby.players.delete(d.id); scores.delete(d.id); }
  if (game.state === 'lobby') renderLobby(); else if (game.state === 'play') refreshScoreHud();
});
net.on('startreq', () => { if (net.isHost && game.state === 'lobby') hostStart(); });
net.on('start', (d) => startMatch(!!d.late));
net.on('ps', (d, from) => { const r = remote.get(from); if (r) r.push(d, performance.now() / 1000); });
net.on('fire', (d) => {
  if (!net.active) return;
  balls.fire({
    pos: new THREE.Vector3().fromArray(d.pos), vel: new THREE.Vector3().fromArray(d.vel),
    dmg: d.dmg, owner: d.owner, ink: d.ink, life: d.life, id: d.id, mirror: true,
  });
});
net.on('pdead', (d, from) => {
  const r = remote.get(from);
  if (r) {
    effects.explosion(r.pos, 2.4, r.ink);
    effects.strokeBurst(r.pos, r.ink, 26, 7, { life: 0.6, size: 0.04 });
    audio.enemyDie(r.pos);
  }
  if (net.isHost) tallyDeath(from, d.killer);
});
net.on('score', (rows) => applyScores(rows));
net.on('end', (d) => endMatch(d));
net.on('backtolobby', () => toLobby());

// ---------------- screens ----------------
function settingsHTML() {
  return `<div class="settings">
    <label>名字 <input type="text" id="nameInput" maxlength="14" value="${esc(myName)}" style="width:170px;font-size:18px;letter-spacing:0"></label>
    <label><input type="checkbox" id="musicBox" ${musicWanted ? 'checked' : ''}> 8-bit 音乐 <span class="k">M 键切换</span></label>
  </div>`;
}
function skinsHTML() {
  return `<div class="skins"><span style="font-size:18px;opacity:.7">涂装</span>${SKINS.map((s) =>
    `<button class="skinbtn ${skinKey === s.key ? 'on' : ''} ${skinUnlocked(s) ? '' : 'locked'}" data-skin="${s.key}" ${skinUnlocked(s) ? '' : 'disabled'}>${s.name}<i>${s.need ? `击落 ${s.need} 架解锁` : '默认'}</i></button>`).join('')}</div>`;
}
function mainHTML() {
  return `<h1>折纸空战</h1><h2>Paper Wings · 画在作业本上的空战</h2>
    <div class="tags"><span class="tag">单击操作</span><span class="tag">3D 涂鸦</span><span class="tag">单机 / 联机</span></div>
    <p>点一下敌机 → 锁定并自动连续投弹；点一下空白天空 → 设个航点，飞机自己飞过去。<br>不用 WASD，不用鼠标锁定，触屏也能玩；按 <b>F</b> 可锁定最近目标。</p>
    <div class="cols">
      <div><div class="colhead">怎么玩</div>纸团会下坠，打移动目标要留提前量<br><b>橙色虚线</b>是预判弧线，方框是锁定目标<br>每 5 波来一只巨型折纸鹤 Boss</div>
      <div><div class="colhead">模式</div><b>单人飞行</b>：无尽波次 · 每 5 波检查点<br><b>联机对战</b>：2–6 人自由混战<br>先到 ${FFA_TARGET} 分或 8 分钟结束</div>
    </div>
    <div class="row" style="margin-top:16px">
      <button class="primary" id="soloBtn">开始飞行</button>
      <button id="onlineBtn">联机对战</button>
      ${checkpoint > 0 ? `<button class="alt" id="cpBtn">从第 ${checkpoint + 1} 波继续</button>` : ''}
    </div>
    <div class="row"><span class="status">最高分 ${best} · 累计击落 ${totalKills}</span></div>
    ${skinsHTML()}${settingsHTML()}
    <div class="go">挑一个按钮，起飞 →</div>`;
}
function onlineHTML() {
  return `<h1>联机对战</h1><h2>房主的浏览器当裁判 · 不需要游戏服务器</h2>
    <p>快速匹配会先找公开房；找不到就自动帮你开一间。私房用 5 位房间码邀请朋友。</p>
    <div class="row"><button class="primary" id="quickBtn">快速匹配</button><button id="pubBtn">创建公开房</button><button id="privBtn">创建私房</button></div>
    <div class="row"><input type="text" id="codeInput" maxlength="5" placeholder="房间码"><button id="joinBtn">加入</button></div>
    <div class="row"><button class="alt" id="backBtn">返回主菜单</button></div>
    <div class="status" id="status">${esc(lobby.status || '')}</div>`;
}
function lobbyHTML() {
  const shown = String(net.aliasCode || lobby.shown || lobby.code || '').replace(/-\d+$/, '');
  const rows = [...lobby.players.entries()].map(([id, p]) => `<div class="row ${id === net.id ? 'me' : ''}"><span>${esc(p.name)}</span><span>${id === lobby.hostId ? '房主' : '飞行员'}</span></div>`).join('');
  return `<h1>候机厅</h1><h2>${lobby.isPublic ? '公开房' : '私人房'} · ${lobby.players.size}/${net.maxPlayers} 人</h2>
    <div class="code">${esc(shown)}</div>
    <p>把这个码告诉朋友，就能一起飞。</p>
    <div class="scoreboard">${rows || '<div class="row"><span>还没有人加入</span></div>'}</div>
    <div class="row">
      ${net.isHost ? '<button class="primary" id="startBtn">开始对战</button>' : '<span class="status">等房主开始…</span>'}
      <button class="alt" id="leaveBtn">离开</button>
    </div>
    <div class="status" id="status">${esc(lobby.status || '')}</div>`;
}
function pauseHTML() {
  return `<h1>暂停</h1><h2>${game.mode === 'solo' ? `第 ${game.wave} 波 · ${game.score} 分` : '自由混战'}</h2>
    ${game.mode === 'ffa' ? scoreboardHTML() : ''}
    <div class="cols"><div><div class="colhead">操作</div>单击敌机 = 锁定 + 投纸团<br>单击空处 = 设航点<br><b>M</b> 音乐 · <b>Esc</b> 暂停</div></div>
    ${settingsHTML()}
    <div class="row"><button class="alt" id="leaveBtn">退出到主菜单</button></div>
    <div class="go">点击任意位置继续飞行</div>`;
}
function deadHTML() {
  const nb = game.score >= best && game.score > 0;
  return `<h1>折成纸屑了</h1>
    <div class="stats">撑过 <b>${game.wave}</b> 波 · 击落 <b>${game.kills}</b> 架 · 得分 <b>${game.score}</b>${nb ? ' · <b>新纪录</b>' : ''}</div>
    <p>${checkpoint > 0 ? `可以从第 ${checkpoint + 1} 波重新起飞。` : '每 5 波会记下一个检查点。'}</p>
    <div class="row"><button class="primary" id="againBtn">再画一次</button><button class="alt" id="menuBtn">主菜单</button></div>
    <div class="go">点击（或按 Enter）再画一次</div>`;
}
function overHTML(winner) {
  return `<h1>${winner && winner.id ? esc(winner.name) + ' 获胜' : '时间到'}</h1>
    <h2>自由混战 · 先到 ${FFA_TARGET} 分</h2>
    ${scoreboardHTML()}
    <div class="row"><button class="alt" id="menuBtn">回主菜单</button></div>
    <div class="go">点击返回候机厅</div>`;
}
function wire(id, fn) {
  const el = hud.el.panel.querySelector('#' + id);
  if (el) el.addEventListener('click', (e) => { e.stopPropagation(); fn(e); });
  return el;
}
function wireSettings() {
  const name = hud.el.panel.querySelector('#nameInput');
  if (name) name.addEventListener('change', (e) => { e.stopPropagation(); myName = String(name.value || '涂鸦').slice(0, 14); localStorage.setItem('pw_name', myName); net.hostName = myName; });
  if (name) name.addEventListener('click', (e) => e.stopPropagation());
  const music = hud.el.panel.querySelector('#musicBox');
  if (music) music.addEventListener('change', (e) => { e.stopPropagation(); musicWanted = !!music.checked; localStorage.setItem('pw_music', musicWanted ? '1' : '0'); applyMusic(); });
  for (const b of hud.el.panel.querySelectorAll('[data-skin]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      skinKey = b.dataset.skin; localStorage.setItem('pw_skin', skinKey);
      player.visual.setInk(skinInk()); showStart();
    });
  }
}
function showStart() {
  hud.setGameplayVisible(false);
  const html = game.screen === 'lobby' ? lobbyHTML() : game.screen === 'online' ? onlineHTML() : mainHTML();
  hud.showScreen(html);
  wireSettings();
  if (game.screen === 'main') {
    wire('soloBtn', () => beginSolo(0));
    wire('cpBtn', () => beginSolo(checkpoint));
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
function renderLobby() { if (game.state === 'lobby') showStart(); }
function showPause() { hud.showScreen(pauseHTML()); wireSettings(); wire('leaveBtn', () => leaveOnline()); }

function pause() {
  if (game.state !== 'play' || game.menu) return;
  game.menu = true; game.pausedFrom = game.state; game.state = 'pause';
  showPause();
}
function resume() {
  if (game.state !== 'pause') return;
  game.state = game.pausedFrom || 'play'; game.menu = false;
  hud.hideScreen(); hud.setGameplayVisible(true);
}
hud.onScreenClick = () => {
  if (game.state === 'pause') { resume(); return; }
  if (game.state === 'dead') { beginSolo(checkpoint); return; }
  if (game.state === 'over') {
    if (net.active) { if (net.isHost) net.send('backtolobby', {}); toLobby(); }
    else { game.screen = 'main'; game.state = 'start'; showStart(); }
  }
};
input.onClick = handleClick;
input.onAnyInput = () => { audio.init(); audio.resume(); };
input.onKey = (action) => {
  if (action === 'pause') { if (game.state === 'pause') resume(); else pause(); }
  else if (action === 'music') { musicWanted = !musicWanted; localStorage.setItem('pw_music', musicWanted ? '1' : '0'); applyMusic(); hud.tip(musicWanted ? '音乐：开' : '音乐：关', 1.5); }
  else if (action === 'confirm') { if (game.state === 'dead') beginSolo(checkpoint); else if (game.state === 'pause') resume(); }
  else if (action === 'padFire' || action === 'lock') {
    if (game.state === 'play' && !game.menu) {
      const t = nearestTarget();
      if (t) { game.locked = t; player.setTarget(t); throwBall(); hud.tip(`已锁定 <b>${esc(t.name || '敌机')}</b> · 自动连续投弹`, 2.2); }
    }
  }
};

// ---------------- camera & loop ----------------
const _camF = new THREE.Vector3(), _camP = new THREE.Vector3(), _lock = new THREE.Vector3();
function updateCamera(dt, t) {
  if (game.state === 'start' || game.state === 'lobby' || game.state === 'over') {
    const a = t * 0.06;
    _camP.set(Math.cos(a) * 125, 62, Math.sin(a) * 125);
    R.camera.position.lerp(_camP, 1 - Math.exp(-dt * 2));
    R.camera.lookAt(0, 18, 0);
  } else {
    const f = player.forward(_camF);
    _camP.copy(player.pos).addScaledVector(f, -16); _camP.y += 6;
    R.camera.position.lerp(_camP, 1 - Math.exp(-dt * 7));
    R.camera.lookAt(player.pos.x + f.x * 13, player.pos.y + 0.6, player.pos.z + f.z * 13);
  }
  R.camera.updateMatrixWorld();
}
function updateLock(t) {
  const L = game.locked;
  if (!L || !L.alive || L.pos.distanceTo(player.pos) > 95 || !player.alive) {
    if (game.locked) { game.locked = null; player.target = null; balls.aim.hide(); hud.setLock(0, 0, false); }
    return;
  }
  const f = player.forward(_tmp);
  _from.copy(player.pos).addScaledVector(f, 2.2);
  aimVelocity(_from, L.pos, L.vel || _zero, BALL_SPEED, _vel);
  balls.aim.show(_from, _vel);
  if (game.fireT <= 0) throwBall();
  _lock.copy(L.pos).project(R.camera);
  if (_lock.z < 1 && Math.abs(_lock.x) < 1 && Math.abs(_lock.y) < 1) {
    hud.setLock((_lock.x * 0.5 + 0.5) * window.innerWidth, (-_lock.y * 0.5 + 0.5) * window.innerHeight, true);
  } else hud.setLock(0, 0, false);
}
function updateNameTags() {
  if (game.mode !== 'ffa' || game.state !== 'play') { hud.setNameTags([]); return; }
  const list = [];
  for (const r of remote.values()) {
    if (!r.alive) continue;
    _lock.copy(r.pos).project(R.camera);
    if (_lock.z >= 1 || Math.abs(_lock.x) > 1 || Math.abs(_lock.y) > 1) continue;
    if (r.pos.distanceTo(player.pos) > 85) continue;
    list.push({ name: r.name, x: (_lock.x * 0.5 + 0.5) * window.innerWidth, y: (-_lock.y * 0.5 + 0.5) * window.innerHeight - 24 });
  }
  hud.setNameTags(list);
}

let last = performance.now();
function step(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  game.time += dt;
  input.update();
  sky.update(dt, t);
  const running = game.state === 'play';
  if (running) {
    if (game.fireT > 0) game.fireT -= dt;
    if (game.comboT > 0) { game.comboT -= dt; if (game.comboT <= 0) { game.combo = 0; hud.setScore(game.score, 0); } }
    player.update(dt, t);
    player.visual.update(dt, { pos: player.pos, yaw: player.yaw, roll: player.roll, pitch: player.pitch, alive: player.alive, shieldT: player.shieldT, t });
    if (game.mode === 'solo') {
      enemies.update(dt, t);
      if (game.wave > 0) hud.setWave(game.wave, enemies.alive);
    }
    balls.update(dt);
    for (const r of remote.values()) r.update(dt, performance.now() / 1000, t);
    updateLock(t);
    if (game.mode === 'ffa' && !player.alive) {
      game.respawnT -= dt;
      if (game.respawnT <= 0) respawn();
    }
    if (game.mode === 'ffa') {
      if (game.clockRunning && lobby.players.size > 1) game.matchLeft -= dt;
      else if (lobby.players.size > 1 && !game.clockRunning) game.clockRunning = true;
      hud.setTimer(mmss(game.matchLeft));
      if (net.isHost && game.matchLeft <= 0) checkTimeUp();
      if (net.active) {
        game.netT -= dt;
        if (game.netT <= 0) { game.netT = 0.05; relay('ps', encodeLocal(player)); }
      }
      hud.setBoard(input.scoreHeld ? scoreboardHTML() : null);
    }
  }
  effects.update(dt);
  hud.update(dt);
  updateCamera(dt, t);
  updateNameTags();
  R.render(t, { lowHp: player.alive && player.hp <= 1 ? 0.6 : 0 });
}
function tick(now) { requestAnimationFrame(tick); step(now); }
setInterval(() => { if (net.active && performance.now() - last > 300) step(performance.now()); }, 250);
window.addEventListener('pagehide', () => { if (net.active) net.leave(); });
window.addEventListener('resize', () => { /* InkRenderer listens for this itself */ });

player.visual.setInk(skinInk());
player.reset(new THREE.Vector3(0, 18, 30), Math.PI);
hud.setHealth(player.hp, player.maxHp);
hud.setScore(0, 0);
showStart();
window.__game = { ctx, game, player, enemies, balls, effects, hud, net, remote, lobby, scores, sky, beginSolo, startMatch, createLobby, joinLobby, quickPlay, hostStart, leaveOnline };
requestAnimationFrame(tick);

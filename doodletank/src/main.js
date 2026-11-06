// Game bootstrap: menu flow, solo classic stages, two-player online co-op, scoring, the
// fixed-step game loop and the camera. Architecture mirrors doodleshooter: one renderer, one
// authoritative simulation (yours in solo, the host's in co-op), PeerJS for the lobby and
// state streaming, DOM HUD over an ink-drawn three.js board.
import * as THREE from 'three';
import { InkRenderer, INK } from './render.js';
import { Grid, T, DIRS, BOARD_MIN, cellCenter } from './physics.js';
import { Input } from './input.js';
import { buildLevel, SPAWNS, MAP_COUNT } from './level.js';
import { EnemyManager } from './enemies.js';
import { BulletManager } from './bullets.js';
import { PowerupManager } from './powerups.js';
import { Effects } from './effects.js';
import { Player } from './player.js';
import { RemoteTank, encodeLocal } from './players.js';
import { Net } from './net.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';
import { appearanceFor, saveAppearance } from './appearance.js';
import { clamp } from './util.js';

const canvas = document.getElementById('c');
const R = new InkRenderer(canvas);
R.frame(13);
const grid = new Grid();
const input = new Input(canvas);
const hud = new HUD(document.getElementById('hud'));
const audio = new Audio();
const effects = new Effects(R.scene);
const bullets = new BulletManager(R.scene, grid);
const powerups = new PowerupManager(R.scene, grid);
const enemies = new EnemyManager(R.scene, grid, effects);
const net = new Net();

const myName = (localStorage.getItem('tank_name') || '').slice(0, 8) || '坦克' + Math.floor(Math.random() * 90 + 10);
localStorage.setItem('tank_name', myName);

// the base's brick ring (half-cells), used by the shovel power-up
const RING_CELLS = [];
for (const c of [{ cx: 5, cy: 11 }, { cx: 6, cy: 11 }, { cx: 7, cy: 11 }, { cx: 5, cy: 12 }, { cx: 7, cy: 12 }]) {
  for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) RING_CELLS.push({ hx: c.cx * 2 + dx, hz: c.cy * 2 + dz });
}

// ---------------- game state ----------------
const game = {
  phase: 'menu',        // menu | intro | play | clear | over
  phaseT: 0,
  mode: 'solo',         // solo | host | client
  stage: 0,
  eagleAlive: true,
  time: 0,
  hurt: 0, flash: 0,
  sendT: 0,
};
let level = null;
let me = null;
let remote = null;      // RemoteTank in co-op
let menuLevelBuilt = false;
const ghostBullets = new Map();   // client-side enemy-bullet ghosts: id -> {x,z,dir,speed,mesh}

const isAuth = () => game.mode !== 'client';   // solo + host simulate the world
const coop = () => game.mode !== 'solo';

// ---------------- stage lifecycle ----------------
function buildLevelFor(stage) {
  if (level) level.dispose();
  level = buildLevel(R.scene, grid, stage);
  menuLevelBuilt = true;
}
function loadStage(n) {
  game.stage = n;
  buildLevelFor(n);
  bullets.clear(); powerups.reset(); effects.clear();
  for (const [, g] of ghostBullets) R.scene.remove(g.mesh);
  ghostBullets.clear();
  enemies.reset();
  enemies.cb.onKill = onEnemyKill;
  enemies.beginStage(n);
  game.eagleAlive = true;
  clientLeft = 20;
  me.spawnCell = SPAWNS.players[game.mode === 'client' ? 1 : 0];
  me.spawn();
  if (remote) {
    const c = SPAWNS.players[1];
    remote.tank.x = -13 + c.cx * 2 + 1; remote.tank.z = -13 + c.cy * 2 + 1;
    remote.tank.dir = 'up'; remote.alive = true; remote.tank.alive = true; remote.tank.group.visible = true;
  }
  hud.hideAll();
  hud.setGame({ stage: n, p1: me.name, p2: remote ? remote.name : '', coop: coop(), best: localStorage.getItem('tank_best') || 0 });
  setPhase('intro', 1.6);
  audio.setTune('stage');
  audio.stageStart();
  hud.banner(`第 ${n + 1} 关`, coop() ? '双人合作 · 守住老鹰' : '守住老鹰', 1500);
}
function setPhase(p, t = 0) { game.phase = p; game.phaseT = t; }

function startGame(mode, stage = 0) {
  game.mode = mode;
  cleanupMatch();
  me = new Player(R.scene, {
    grid, name: myName,
    id: mode === 'client' ? 'me2' : 'me1',
    spawnCell: SPAWNS.players[mode === 'client' ? 1 : 0],
    onDeath: onLocalDeath,
    onChange: () => pushTally(),
  });
  if (coop()) {
    const theirName = lobbyNames.get(net.isHost ? [...net.conns.keys()][0] : net.hostId) || (net.isHost ? '队友' : '房主');
    remote = new RemoteTank(R.scene, net.isHost ? ([...net.conns.keys()][0] || 'them') : net.hostId, theirName);
  }
  loadStage(stage);
}
function cleanupMatch() {
  if (me) { me.destroy(); me = null; }
  if (remote) { remote.destroy(); remote = null; }
  enemies.reset(); bullets.clear(); powerups.reset(); effects.clear();
  for (const [, g] of ghostBullets) R.scene.remove(g.mesh);
  ghostBullets.clear();
}
function backToMenu(msg) {
  cleanupMatch();
  game.mode = 'solo';
  setPhase('menu');
  hud.showPanel('main');
  hud.refreshBest();
  if (msg) hud.status('online', msg);
  if (!menuLevelBuilt) buildLevelFor(0);
  audio.setTune('march');
}

// ---------------- scoring / events ----------------
function addScore(pts, who) {
  if (who === 'remote' && remote) remote.score += pts;
  else if (me) me.score += pts;
  pushTally();
}
function saveBest() {
  const best = Number(localStorage.getItem('tank_best') || 0);
  const s = Math.max(me ? me.score : 0, remote ? remote.score : 0);
  if (s > best) { localStorage.setItem('tank_best', String(s)); hud.refreshBest(); }
  const reached = Number(localStorage.getItem('tank_stage') || 0);
  if (me && game.stage + 1 > reached && isAuth()) localStorage.setItem('tank_stage', String(game.stage + 1));
}
function onEnemyKill(enemy, byLocal) {
  const pts = { basic: 100, fast: 200, power: 300, armor: 400 }[enemy.kind] || 100;
  addScore(pts, byLocal === 'remote' ? 'remote' : 'me');
  audio.explode();
  R.shakeKick(0.12);
  hud.tip(pts + ' 分', 700);
  // a flashing carrier drops a power-up where it died
  if (enemy.carrier && isAuth()) powerups.spawn();
  pushTally();
}
function onLocalDeath() {
  const t = me.tank;
  effects.explosion(t.x, t.z, true);
  audio.explode(true);
  R.shakeKick(0.3);
  game.hurt = 1;
  pushTally();
  if (me.lives >= 0) me.respawnT = 1.2;
  else checkAllDead();
}
function checkAllDead() {
  if (!isAuth() || game.phase !== 'play') return;
  const meOut = me.lives < 0 && !me.alive;
  const themOut = !coop() || (remote && remote.lives < 0 && !remote.alive);
  if (meOut && themOut) endGame('全军覆没', '坦克打光了，老鹰还在，但你们没了。');
}
function baseDestroyed(byLocal) {
  if (!game.eagleAlive) return;
  game.eagleAlive = false;
  const e = level.eagle;
  if (e) { e.rotation.z = 0.5; e.scale.set(1, 0.4, 1); e.position.y = 0.1; }
  effects.explosion(0, 11, true);
  effects.scorch(0, 11, 2.6);
  audio.explode(true);
  R.shakeKick(0.5);
  saveBest();
  endGame('GAME OVER', '老鹰被击毁了。');
}
function endGame(title, reason) {
  if (game.phase === 'over') return;
  saveBest();
  setPhase('over', 1.4);
  audio.setTune(null);
  audio.gameOver();
  if (net.isHost) net.broadcast('gameover', { reason, scores: scoreTable() });
  setTimeout(() => {
    if (game.phase !== 'over') return;
    hud.gameOver({ title, reason, scores: scoreTable() });
  }, 1200);
}
function scoreTable() {
  const rows = [];
  if (me) rows.push({ name: me.name + (coop() ? ' (P1)' : ''), score: me.score });
  if (coop() && remote) rows.push({ name: remote.name + ' (P2)', score: remote.score });
  return rows;
}
function pushTally() {
  if (!me) return;
  hud.updateTally({
    enemiesLeft: isAuth() ? enemies.remaining : clientLeft,
    lives: me.lives + (me.alive ? 1 : 0),
    lives2: remote ? remote.lives + (remote.alive ? 1 : 0) : 0,
    score: Math.max(me.score, remote ? remote.score : 0),
    coop: coop(),
  });
}
function stageCleared() {
  if (game.phase !== 'play') return;
  saveBest();
  setPhase('clear', 2.8);
  audio.setTune(null);
  audio.clear();
  hud.banner('关卡完成！', '准备下一关…', 2400);
}
function nextStage() {
  const n = game.stage + 1;
  if (isAuth()) { if (net.isHost) net.broadcast('nextstage', { stage: n }); loadStage(n); }
}

// ---------------- firing ----------------
// called by players and enemies; the shooter simulates their own shells and reports hits
function fireBullet(tank, speed) {
  if (!tank || !tank.alive) return false;
  const d = DIRS[tank.dir];
  const x = tank.x + d.x * 1.35, z = tank.z + d.z * 1.35;
  if (grid.bulletStep(x, z)) { /* muzzle inside a wall: still fire, it dies instantly */ }
  bullets.spawn({ x, z, dir: tank.dir, power: tank.bulletPower ?? 1, owner: tank, fromEnemy: tank.isEnemy, speed });
  effects.strokeBurst(x, z, INK.ORANGE, 4, 2.6, { y: 1.0, life: 0.16, size: 0.65 });
  audio.fire();
  return true;
}

// ---------------- bullet consequences (runs where the bullet is simulated) ----------------
const bulletCbs = {
  onTile(b, hit, px, pz) {
    if (hit.type === T.EAGLE) {
      effects.explosion(px, pz, true);
      if (isAuth()) baseDestroyed(b.owner === (me && me.tank) ? 'me' : 'them');
      else net.sendTo(net.hostId, 'basehit', { x: +px.toFixed(1), z: +pz.toFixed(1) });
      return;
    }
    const power = b.power ?? 1;
    const cells = [];
    if (hit.type === T.BRICK || (hit.type === T.STEEL && power >= 3)) {
      const cross = DIRS[b.dir].x !== 0 ? pz : px;
      grid.carve(hit, DIRS[b.dir], power, cross, cells);
      for (const c of cells) grid.set(c.hx, c.hz, T.EMPTY);
      effects.brickCrumbs(px, pz, hit.type === T.STEEL ? INK.BLACK : INK.ORANGE);
      audio.brick();
      if (!isAuth() && cells.length) net.sendTo(net.hostId, 'tile', { cells });
    } else if (hit.type === T.STEEL) {
      effects.strokeBurst(px, pz, INK.BLACK, 5, 3, { y: 0.6, life: 0.3 });
      audio.steel();
    }
  },
  onImpact(b, x, z) { effects.strokeBurst(x, z, INK.RED, 4, 2.5, { y: 0.9, life: 0.25, size: 0.7 }); },
  onTankProbe(b, px, pz) {
    // my shell vs enemies (or, on the host, enemy shells vs both players)
    if (!b.fromEnemy) {
      for (const e of enemies.list) {
        if (!e.alive) continue;
        if (Math.abs(e.x - px) < 1.05 && Math.abs(e.z - pz) < 1.05) {
          const by = b.owner === (me && me.tank) ? 'me' : 'remote';
          if (isAuth()) enemies.hit(e, b.power ?? 1, by);
          else { net.sendTo(net.hostId, 'ehit', { id: e.id, dmg: b.power ?? 1 }); e.hitFlash(); }
          effects.strokeBurst(px, pz, INK.RED, 6, 3, { y: 0.8, life: 0.3 });
          return true;
        }
      }
      return false;
    }
    // enemy shell vs players — only the host referees damage
    if (isAuth()) {
      if (me && me.alive && me.tank.shield <= 0 && Math.abs(me.tank.x - px) < 1.0 && Math.abs(me.tank.z - pz) < 1.0) {
        if (me.takeHit()) return true;
      }
      if (remote && remote.alive && !remote.tank.shield && Math.abs(remote.tank.x - px) < 1.0 && Math.abs(remote.tank.z - pz) < 1.0) {
        net.sendTo(remote.id, 'pdmg', { x: px, z: pz });
        return true;
      }
    }
    return false;
  },
};

// ---------------- power-up effects ----------------
function applyPowerup(p, mine) {
  audio.pickup();
  const names = { star: '星星升级！', grenade: '手雷！全灭敌军！', helmet: '头盔！无敌护罩', shovel: '铁锹！基地加固', tank: '额外生命！', timer: '时钟！敌军冻结' };
  hud.tip(names[p.kind] || p.kind, 1500);
  effects.ring(p.x, p.z, INK.ORANGE, 2.4, 0.4);
  if (p.kind === 'star') mine.addStar();
  else if (p.kind === 'helmet') mine.tank && (mine.tank.shield = 8);
  else if (p.kind === 'tank') mine.addLife(), audio.life();
  else if (isAuth()) {
    if (p.kind === 'grenade') { enemies.killAll('powerup'); }
    else if (p.kind === 'shovel') { powerups.fortifyBase(RING_CELLS, (hx, hz) => grid.set(hx, hz, T.STEEL)); }
    else if (p.kind === 'timer') { enemies.frozen = 8; }
  } else {
    if (p.kind === 'grenade') net.sendTo(net.hostId, 'grenade', {});
    else if (p.kind === 'shovel') net.sendTo(net.hostId, 'shovel', {});
    else if (p.kind === 'timer') net.sendTo(net.hostId, 'timer', {});
  }
}

// ---------------- networking ----------------
const lobbyNames = new Map();   // peerId -> name
let clientLeft = 20;
hud.on('rename', () => location.reload());
hud.on('style', (mode) => { if (saveAppearance(mode)) R.setAppearance(mode); });

net.onPeerJoin = (pid) => {
  if (net.isHost) {
    net.sendTo(pid, 'roster', { names: [...lobbyNames.entries()] });
    if (game.phase === 'play' || game.phase === 'intro') {
      // someone joined mid-match: tell them the stage and let them in
      net.sendTo(pid, 'start', { stage: game.stage });
    }
  }
  refreshLobby();
};
net.onPeerLeave = () => { refreshLobby(); if (game.phase !== 'menu' && coop() && !net.conns.size) backToMenu('对方离开了房间'); };
net.onDisconnect = () => backToMenu('与房主的连接断开了');

net.on('roster', (d) => { lobbyNames.clear(); for (const [k, v] of d.names || []) lobbyNames.set(k, v); refreshLobby(); });
net.on('hello', (d, from) => { lobbyNames.set(from, d.name || '玩家'); net.broadcast('roster', { names: [...lobbyNames.entries()] }); refreshLobby(); });
net.on('start', (d) => { if (!net.isHost) startGame('client', d.stage || 0); });
net.on('nextstage', (d) => { if (!net.isHost && game.phase !== 'menu') loadStage(d.stage); });
net.on('gameover', (d) => { if (!net.isHost) { saveBest(); setPhase('over', 1.4); audio.gameOver(); hud.gameOver({ title: 'GAME OVER', reason: d.reason, scores: d.scores }); } });
net.on('state', (d, from) => { if (net.isHost && remote && from === remote.id) remote.applyState(d); });
net.on('ehit', (d) => { if (isAuth()) { const e = enemies.list.find((t) => t.id === d.id); if (e) enemies.hit(e, d.dmg || 1, 'remote'); } });
net.on('tile', (d) => {
  if (!isAuth()) return;
  for (const c of d.cells || []) {
    if (grid.get(c.hx, c.hz) === T.BRICK || grid.get(c.hx, c.hz) === T.STEEL) {
      grid.set(c.hx, c.hz, T.EMPTY);
      const w = grid.cellCenterW(c.hx, c.hz);
      effects.brickCrumbs(w.x, w.z, INK.ORANGE);
    }
  }
});
net.on('basehit', () => { if (isAuth()) baseDestroyed('them'); });
net.on('grenade', () => { if (isAuth()) enemies.killAll('powerup'); });
net.on('shovel', () => { if (isAuth()) powerups.fortifyBase(RING_CELLS, (hx, hz) => grid.set(hx, hz, T.STEEL)); });
net.on('timer', () => { if (isAuth()) enemies.frozen = 8; });
net.on('pickup', (d) => {
  if (!isAuth()) return;
  const p = powerups.list.find((q) => q.id === d.id);
  if (p) { powerups.remove(p); powerups.list.splice(powerups.list.indexOf(p), 1); }
});
net.on('pdmg', () => { if (me && me.alive) me.takeHit(); });
net.on('snap', (d) => {
  if (net.isHost || game.phase === 'menu') return;
  enemies.applySnap(R.scene, d.en || [], game.time);
  clientLeft = d.left ?? clientLeft;
  // enemy bullet ghosts
  const seen = new Set();
  for (const b of d.bu || []) {
    seen.add(b.i);
    let g = ghostBullets.get(b.i);
    if (!g) {
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(bullets.geo, bullets.mat));
      const tail = new THREE.Mesh(bullets.trailGeo, bullets.mat);
      mesh.add(tail);
      mesh.position.set(b.x, 0.98, b.z);
      R.scene.add(mesh);
      ghostBullets.set(b.i, g = { x: b.x, z: b.z, dir: b.d, speed: b.s, mesh, tail });
    } else { g.x = b.x; g.z = b.z; g.dir = b.d; g.speed = b.s; }
  }
  for (const [id, g] of [...ghostBullets]) {
    if (!seen.has(id)) { R.scene.remove(g.mesh); ghostBullets.delete(id); }
  }
  powerups.applySnap(R.scene, d.pw || []);
  // tiles stream
  if (d.ti) for (let i = 0; i < d.ti.length && i < grid.tiles.length; i++) {
    if (grid.tiles[i] !== d.ti[i]) grid.set(i % 26, Math.floor(i / 26), d.ti[i]);
  }
  if (d.sc) {
    if (remote && d.sc.me) remote.applyScore({ score: d.sc.me.score, lives: d.sc.me.lives });
    if (me && d.sc.them) me.score = d.sc.them.score;
  }
  if (d.eagle === 0 && game.eagleAlive) { game.eagleAlive = false; const e = level.eagle; if (e) { e.rotation.z = 0.5; e.scale.set(1, 0.4, 1); } effects.explosion(0, 11, true); }
  pushTally();
});

function refreshLobby() {
  if (hud.panel !== 'lobby') return;
  const names = [];
  if (net.isHost) { names.push(myName); names.push(lobbyNames.get(net.peerIds[0]) || (net.conns.size ? '玩家' : '')); }
  else { names.push(lobbyNames.get(net.hostId) || '房主'); names.push(myName); }
  hud.renderLobby({ code: net.code, names, isHost: net.isHost, map: lobbyStage });
}

// ---------------- menu wiring ----------------
let lobbyStage = Number(localStorage.getItem('tank_lobby_stage') || 0);
hud.setStage(lobbyStage);
hud.on('stage-prev', () => { lobbyStage = (lobbyStage + MAP_COUNT - 1) % MAP_COUNT; localStorage.setItem('tank_lobby_stage', lobbyStage); hud.setStage(lobbyStage); });
hud.on('stage-next', () => { lobbyStage = (lobbyStage + 1) % MAP_COUNT; localStorage.setItem('tank_lobby_stage', lobbyStage); hud.setStage(lobbyStage); });
hud.on('solo', () => { audio.unlock(); startGame('solo', lobbyStage); });
hud.on('online', () => { audio.unlock(); hud.showPanel('online'); hud.status('online', ''); });
hud.on('back-main', () => { net.leave(); hud.showPanel('main'); });
hud.on('music', () => { audio.unlock(); audio.setMusic(!audio.musicWanted); hud.setMusicLabel(audio.musicWanted); });
hud.on('quick', async () => {
  hud.status('online', '正在寻找公开房间…');
  try { await net.quickJoin({ name: myName }); afterJoin(); } catch (e) { hud.status('online', '没有找到公开房间，试试创建一个。'); }
});
hud.on('hostPublic', async () => {
  hud.status('online', '正在创建公开房间…');
  try { await net.host({ isPublic: true }); afterHost(); } catch (e) { hud.status('online', '创建失败：' + e.message); }
});
hud.on('hostPrivate', async () => {
  hud.status('online', '正在创建私人房间…');
  try { await net.host({}); afterHost(); } catch (e) { hud.status('online', '创建失败：' + e.message); }
});
hud.on('join', async () => {
  const code = hud.el['join-code'].value.trim();
  if (!code) return hud.status('online', '先输入房间码。');
  hud.status('online', '正在加入 ' + code.toUpperCase() + ' …');
  try { await net.join(code, { name: myName }); afterJoin(); } catch (e) { hud.status('online', '加入失败：' + e.message); }
});
hud.on('map-prev', () => { if (net.isHost) { lobbyStage = (lobbyStage + MAP_COUNT - 1) % MAP_COUNT; localStorage.setItem('tank_lobby_stage', lobbyStage); refreshLobby(); hud.setStage(lobbyStage); } });
hud.on('map-next', () => { if (net.isHost) { lobbyStage = (lobbyStage + 1) % MAP_COUNT; localStorage.setItem('tank_lobby_stage', lobbyStage); refreshLobby(); hud.setStage(lobbyStage); } });
hud.on('start', () => {
  if (!net.isHost) return;
  if (!net.conns.size) return hud.status('lobby', '还没有玩家加入。');
  net.accepting = false;
  net.broadcast('start', { stage: lobbyStage });
  startGame('host', lobbyStage);
});
hud.on('leave', () => { net.leave(); hud.showPanel('online'); });
hud.on('retry', () => {
  if (coop()) {
    if (net.isHost) { net.accepting = true; net.broadcast('start', { stage: game.stage }); startGame('host', game.stage); }
    else hud.showPanel('main');
  } else startGame('solo', Math.min(game.stage, MAP_COUNT - 1));
});

function afterHost() {
  lobbyNames.set(net.id, myName);
  hud.showPanel('lobby');
  refreshLobby();
}
function afterJoin() {
  net.sendTo(net.hostId, 'hello', { name: myName });
  hud.showPanel('lobby');
  refreshLobby();
  hud.status('lobby', '已加入，等待房主开始。');
}

// ---------------- input extras ----------------
input.onAny = () => audio.unlock();
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') { audio.unlock(); audio.setMusic(!audio.musicWanted); hud.setMusicLabel(audio.musicWanted); }
  if (e.code === 'Escape' && game.phase !== 'menu') { net.leave(); backToMenu(); }
});

// ---------------- main loop ----------------
buildLevelFor(0);
hud.setMusicLabel(audio.musicWanted);
hud.setStyle(appearanceFor());
R.setAppearance(appearanceFor());
pushTally();
window.__tank = {
  game, enemies, bullets, powerups, grid, net,
  get me() { return me; }, get remote() { return remote; },
  debug: {
    fire: () => (me && me.tank ? fireBullet(me.tank, 11) : false),
    killFirst: () => (enemies.list[0] ? enemies.hit(enemies.list[0], 99, 'me') : null),
    eagleDown: () => baseDestroyed('me'),
  },
};

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.time += dt;
  game.hurt = Math.max(0, game.hurt - dt * 2);
  game.flash = Math.max(0, game.flash - dt * 2.5);
  effects.update(dt);

  if (game.phase === 'intro') {
    game.phaseT -= dt;
    if (game.phaseT <= 0) setPhase('play');
  } else if (game.phase === 'clear') {
    game.phaseT -= dt;
    if (game.phaseT <= 0) nextStage();
  } else if (game.phase === 'play') {
    updatePlay(dt);
  }

  // visuals that run in every phase
  if (me && me.tank) { /* tank.update called in updatePlay */ }
  if (remote) remote.update(dt, game.time);
  for (const [, g] of ghostBullets) {
    const d = DIRS[g.dir];
    g.x += d.x * g.speed * dt; g.z += d.z * g.speed * dt;
    g.mesh.position.set(g.x, 0.98, g.z);
    g.tail.position.set(-d.x * 0.45, -0.02, -d.z * 0.45);
    g.tail.rotation.y = d.x !== 0 ? Math.PI / 2 : 0;
  }
  if (level && level.update) level.update(game.time);
  if (level && level.eagle && game.eagleAlive) {
    level.eagle.userData.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (0.35 + Math.sin(game.time * 2.3) * 0.08); });
  }
  R.render(game.time, { hurt: game.hurt, flash: game.flash });
}
requestAnimationFrame(frame);

function updatePlay(dt) {
  const others = [];
  if (me && me.alive && me.tank) others.push(me.tank);
  if (remote && remote.alive && remote.tank.alive) others.push(remote.tank);
  others.push(...enemies.list);

  if (me) me.update(dt, game.time, input, bullets, effects, fireBullet, others);

  if (isAuth()) {
    // the host (or solo player) runs the world
    const playersForAI = [me && me.tank, remote && remote.tank].filter(Boolean);
    const enemyFire = (e, speed) => (bullets.countOf(e) >= 1 ? false : fireBullet(e, speed));
    enemies.update(dt, game.time, playersForAI, enemyFire, null);
    bullets.update(dt, bulletCbs);
    powerups.update(dt, game.time, me && me.tank.alive ? [me.tank] : [], (p, t) => {
      applyPowerup(p, me);
    });
    // stage flow
    if (enemies.remaining === 0) stageCleared();
    // host streams the world out
    if (net.isHost) {
      game.sendT -= dt;
      if (game.sendT <= 0) {
        game.sendT = 1 / 15;
        net.broadcast('snap', {
          en: enemies.serialize(), bu: bullets.serialize().filter((b) => b.e), pw: powerups.serialize(),
          ti: Array.from(grid.tiles), left: enemies.remaining, eagle: game.eagleAlive ? 1 : 0,
          sc: { me: { score: me ? me.score : 0, lives: me ? me.lives : 0 }, them: remote ? { score: remote.score, lives: remote.lives } : {} },
        });
      }
    }
  } else {
    // client: local shells only; the world arrives as snapshots
    bullets.update(dt, bulletCbs);
    enemies.interpolate(dt);
    for (const e of enemies.list) e.update(dt, game.time);
    powerups.update(dt, game.time, me && me.tank.alive ? [me.tank] : [], (p, t) => {
      applyPowerup(p, me);
      net.sendTo(net.hostId, 'pickup', { id: p.id });
    });
    // stream my tank up
    game.sendT -= dt;
    if (game.sendT <= 0) {
      game.sendT = 1 / 15;
      net.sendTo(net.hostId, 'state', encodeLocal(me));
    }
    pushTally();
  }
  // respawn (both roles: every player owns their own tank)
  if (me && !me.alive && me.lives >= 0 && me.respawnT !== undefined) {
    me.respawnT -= dt;
    if (me.respawnT <= 0) { me.spawn(); pushTally(); }
  }
}

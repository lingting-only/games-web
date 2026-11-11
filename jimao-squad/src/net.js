// 点对点房间层：只借用 PeerJS 的公共信令服务交换 WebRTC 握手信息，
// 连上之后所有游戏消息都在玩家浏览器之间直连，房主的浏览器负责裁决。
// 对上层只暴露 on/send/broadcast/sendTo/host/join/quickJoin/leave。

const LOCAL = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const PREFIX = LOCAL ? 'jimao-squad-dev-' : 'jimao-squad-';
const PUBLIC_SLOTS = 8;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SIGNAL_TIMEOUT = 12000;
const JOIN_TIMEOUT = 12000;
const QUICK_TIMEOUT = 9000;
const PEER_OPTS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ]
  }
};

export const makeCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const peerAvailable = () => typeof window !== 'undefined' && typeof window.Peer === 'function';
const idFromError = (err) => { const m = /peer\s+(\S+)/.exec(String((err && err.message) || '')); return m ? m[1] : null; };

export class Net {
  constructor({ maxPlayers = 4 } = {}) {
    this.maxPlayers = maxPlayers;
    this.peer = null; this.conns = new Map(); this.seats = new Map();
    this.isHost = false; this.id = null; this.code = null; this.hostId = null;
    this.connected = false; this.accepting = true; this.isPublic = false;
    this.meta = { name: '几猫队员' };
    this.handlers = new Map();
    this.onJoin = null; this.onLeave = null; this.onDisconnect = null;
    this.onRoster = null;
    this.stats = { sent: 0, recv: 0 };
  }

  get active() { return !!this.peer && this.connected; }
  get count() { return this.conns.size + (this.isHost ? 1 : 0); }
  get roster() {
    const list = [];
    if (this.isHost && this.id) list.push({ id: this.id, name: this.meta.name, seat: 0, host: true });
    for (const [id, info] of this.seats) list.push({ id, name: info.name, seat: info.seat, host: false });
    return list.sort((a, b) => a.seat - b.seat);
  }

  on(type, fn) { this.handlers.set(type, fn); return this; }
  _emit(type, data, from) { const fn = this.handlers.get(type); if (fn) fn(data, from); }

  _newPeer(id) {
    return new Promise((resolve, reject) => {
      if (!peerAvailable()) return reject(new Error('联机组件未加载，请检查网络或刷新页面'));
      const peer = new window.Peer(id, PEER_OPTS);
      let done = false;
      const timer = setTimeout(() => {
        if (done) return; done = true;
        try { peer.destroy(); } catch (e) { /* ignore */ }
        reject(new Error('信令服务没有响应，请检查网络'));
      }, SIGNAL_TIMEOUT);
      peer.on('open', () => { if (done) return; done = true; clearTimeout(timer); resolve(peer); });
      peer.on('error', (err) => {
        if (done) return; done = true; clearTimeout(timer);
        try { peer.destroy(); } catch (e) { /* ignore */ }
        reject(err);
      });
    });
  }

  _keepAlive(peer) {
    peer.on('disconnected', () => { if (this.peer === peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* ignore */ } } });
  }

  _wire(conn) {
    conn.on('data', (msg) => { this.stats.recv++; if (msg && typeof msg === 'object') this._route(msg, conn.peer); });
    conn.on('close', () => this._drop(conn.peer));
    conn.on('error', () => this._drop(conn.peer));
  }

  _route(msg, from) {
    if (this.isHost && msg.to && msg.to !== this.id) {
      const c = this.conns.get(msg.to); if (c && c.open) c.send(msg); return;
    }
    if (this.isHost && msg.relay) {
      for (const [pid, c] of this.conns) if (pid !== from && c.open) c.send({ t: msg.t, d: msg.d, from: msg.from || from });
    }
    this._emit(msg.t, msg.d, msg.from || from);
  }

  _drop(pid) {
    if (this.leaving || !this.conns.has(pid)) return;
    this.conns.delete(pid); this.seats.delete(pid);
    if (this.isHost) {
      this.broadcast('leave', { id: pid });
      this._pushRoster();
      if (this.onLeave) this.onLeave(pid);
      if (this.onRoster) this.onRoster(this.roster);
    } else if (pid === this.hostId) {
      this.connected = false;
      if (this.onDisconnect) this.onDisconnect();
    }
  }

  _pushRoster() { this.broadcast('roster', { list: this.roster, code: this.code }); }

  _welcome() {
    return {
      hostId: this.id, code: this.code, isPublic: this.isPublic,
      list: this.roster, max: this.maxPlayers
    };
  }

  _seat(conn, meta = {}) {
    const pid = conn.peer;
    if (this.conns.has(pid)) { conn.send({ t: 'welcome', d: this._welcome(), from: this.id }); return; }
    if (!this.accepting || this.count >= this.maxPlayers) {
      conn.send({ t: 'refused', d: { reason: this.accepting ? '小队已满员' : '行动已开始，小队暂时封闭' }, code: this.code, from: this.id });
      setTimeout(() => { try { conn.close(); } catch (e) { /* ignore */ } }, 500);
      return;
    }
    const used = new Set(this.roster.map((p) => p.seat));
    let seat = 1; while (used.has(seat)) seat++;
    const name = String(meta.name || '几猫队员').slice(0, 12);
    this.conns.set(pid, conn);
    this.seats.set(pid, { name, seat });
    this._wire(conn);
    conn.send({ t: 'welcome', d: { ...this._welcome(), seat, you: pid }, from: this.id });
    this._pushRoster();
    if (this.onJoin) this.onJoin(pid, { name, seat });
    if (this.onRoster) this.onRoster(this.roster);
  }

  _incoming(conn) {
    const meta = conn.metadata || {};
    const onOpen = () => {
      if (meta.probe) {
        // 快速匹配只问一句「还有位置吗」，不占座位；确认留下才真正入队。
        conn.send({ t: 'welcome', d: { ...this._welcome(), probe: true }, from: this.id });
        const onData = (msg) => {
          if (msg && msg.t === 'stay') {
            conn.off('data', onData);
            if (this.accepting && this.count < this.maxPlayers) this._seat(conn, meta);
            else { conn.send({ t: 'refused', d: { reason: '小队刚好满员' }, from: this.id }); try { conn.close(); } catch (e) { /* ignore */ } }
          }
        };
        conn.on('data', onData);
        setTimeout(() => { if (!this.conns.has(conn.peer)) { try { conn.close(); } catch (e) { /* ignore */ } } }, 7000);
        return;
      }
      this._seat(conn, meta);
    };
    if (conn.open) onOpen(); else conn.on('open', onOpen);
  }

  // ---- 房间 ----
  async host({ isPublic = false, code = null, name = '几猫队员' } = {}) {
    this.leave();
    this.isHost = true; this.isPublic = isPublic; this.meta = { name };
    if (code) {
      this.code = String(code).toUpperCase();
      this.peer = await this._newPeer(PREFIX + this.code);
    } else if (isPublic) {
      for (let slot = 0; slot < PUBLIC_SLOTS; slot++) {
        try {
          this.peer = await this._newPeer(PREFIX + 'PUB' + slot);
          this.code = 'PUB' + slot; break;
        } catch (err) {
          if (!(err && err.type === 'unavailable-id')) throw err;
        }
      }
      if (!this.peer) throw new Error('公开小队都满了，改开私人房吧');
    } else {
      for (let tries = 0; tries < 4 && !this.peer; tries++) {
        this.code = makeCode();
        try { this.peer = await this._newPeer(PREFIX + this.code); }
        catch (err) { if (!(err && err.type === 'unavailable-id') || tries === 3) throw err; }
      }
    }
    this.id = this.peer.id; this.hostId = this.id; this.connected = true; this.accepting = true;
    this.peer.on('connection', (conn) => this._incoming(conn));
    this._keepAlive(this.peer);
    return this.code;
  }

  _knock(hostIds, meta, timeout, onStatus = null) {
    const peer = this.peer;
    return new Promise((resolve, reject) => {
      let pending = hostIds.length, settled = false, offers = [], gather = null;
      const attempts = [];
      const close = (keep) => { for (const a of attempts) if (a.conn !== keep) { try { a.conn.close(); } catch (e) { /* ignore */ } } };
      const finish = (err, winner, probe) => {
        if (settled) return; settled = true;
        clearTimeout(timer); clearTimeout(gather);
        try { peer.off('error', onErr); } catch (e) { /* ignore */ }
        close(winner ? winner.conn : null);
        if (err) { if (this.peer === peer) this.leave(); reject(err); }
        else {
          if (probe) winner.conn.send({ t: 'stay' });
          this._adopt(winner.hostId, winner.conn, winner.welcome);
          resolve(winner.welcome);
        }
      };
      const failOne = (a) => {
        if (a.done || settled) return; a.done = true; pending--;
        if (pending <= 0 && !offers.length) finish(new Error('没有找到这个房间，或对方已开始行动'), null, false);
        else if (offers.length && !gather) gather = setTimeout(() => {
          offers.sort((x, y) => (y.welcome.list || []).length - (x.welcome.list || []).length);
          finish(null, offers[0], !!offers[0].welcome.probe);
        }, 900);
      };
      const onErr = (err) => {
        if (err && err.type === 'peer-unavailable') {
          const a = attempts.find((x) => x.hostId === idFromError(err)); if (a) failOne(a);
        }
      };
      peer.on('error', onErr);
      const timer = setTimeout(() => {
        if (offers.length) { offers.sort((x, y) => (y.welcome.list || []).length - (x.welcome.list || []).length); finish(null, offers[0], !!offers[0].welcome.probe); }
        else finish(new Error('房间没有回应，可能网络不通或房间码有误'), null, false);
      }, timeout);
      for (const hostId of hostIds) {
        let conn;
        try { conn = peer.connect(hostId, { reliable: true, serialization: 'json', metadata: meta }); }
        catch (e) { pending--; continue; }
        const a = { conn, hostId, done: false }; attempts.push(a);
        conn.on('data', (msg) => {
          if (!msg || a.done || settled) return;
          if (msg.t === 'welcome') {
            a.done = true; offers.push({ conn, hostId, welcome: msg.d || {} });
            if (onStatus) onStatus(`发现小队 ${offers.length} 个…`);
            if (!meta.probe) finish(null, offers[0], false);
            else if (!gather) gather = setTimeout(() => {
              offers.sort((x, y) => (y.welcome.list || []).length - (x.welcome.list || []).length);
              finish(null, offers[0], true);
            }, 1200);
          }
          else if (msg.t === 'refused') failOne(a);
        });
        conn.on('error', () => failOne(a));
        conn.on('close', () => failOne(a));
      }
      if (pending <= 0) finish(new Error('没有找到这个房间'), null, false);
    });
  }

  _adopt(hostId, conn, welcome) {
    this.hostId = hostId; this.conns.set(hostId, conn);
    this.connected = true; this.code = (welcome && welcome.code) || this.code;
    this.isPublic = !!(welcome && welcome.isPublic);
    this.seats.clear();
    for (const p of (welcome && welcome.list) || []) if (p.id !== this.id) this.seats.set(p.id, { name: p.name, seat: p.seat });
    this._wire(conn);
  }

  async join(code, name = '几猫队员') {
    this.leave();
    code = String(code || '').trim().toUpperCase();
    if (!code) throw new Error('先输入 5 位房间码');
    this.meta = { name };
    this.peer = await this._newPeer(null);
    this.id = this.peer.id; this._keepAlive(this.peer);
    const base = code.replace(/-\d+$/, '');
    const ids = [code, ...['-1', '-2', '-3'].map((s) => base + s).filter((s) => s !== code)].map((c) => PREFIX + c);
    return this._knock(ids, { name }, JOIN_TIMEOUT);
  }

  async quickJoin(name = '几猫队员', onStatus = null) {
    this.leave();
    this.meta = { name };
    this.peer = await this._newPeer(null);
    this.id = this.peer.id; this._keepAlive(this.peer);
    if (onStatus) onStatus('正在扫描公开小队…');
    const ids = [];
    for (let i = 0; i < PUBLIC_SLOTS; i++) for (const s of ['', '-1', '-2', '-3']) ids.push(PREFIX + 'PUB' + i + s);
    return this._knock(ids, { name, probe: true }, QUICK_TIMEOUT, onStatus);
  }

  leave() {
    this.leaving = true;
    for (const c of this.conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
    this.conns.clear(); this.seats.clear();
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* ignore */ } }
    this.peer = null; this.connected = false; this.isHost = false;
    this.id = null; this.code = null; this.hostId = null; this.accepting = true;
    this.leaving = false;
  }

  // ---- 消息 ----
  send(type, data, relay = false) {
    this.stats.sent++;
    const msg = { t: type, d: data, from: this.id };
    if (this.isHost) { for (const c of this.conns.values()) if (c.open) c.send(msg); }
    else { const c = this.conns.get(this.hostId); if (c && c.open) c.send({ ...msg, relay }); }
  }
  broadcast(type, data) { this.send(type, data, true); }
  sendTo(pid, type, data) {
    this.stats.sent++;
    if (this.isHost) { const c = this.conns.get(pid); if (c && c.open) c.send({ t: type, d: data, from: this.id }); }
    else { const c = this.conns.get(this.hostId); if (c && c.open) c.send({ t: type, d: data, to: pid, from: this.id }); }
  }
}

// Ten solo stages plus the online preset. Each stage tunes ink income, enemy tempo and which
// stamps both sides have unlocked; the enemy never cheats — it spends the same ink pool as you.
import { createState, BASE_HP } from './rules.js';
import { clamp } from './util.js';

const P = ['pencil'], PC = ['pencil', 'clip'], PCE = ['pencil', 'clip', 'eraser'];
const ALL = ['pencil', 'clip', 'eraser', 'blot'];

// Player ink income only creeps up; difficulty rises monotonically from enemy tempo, a thicker
// inkwell, a wider unit pool and (from stage 6) a periodic double-deploy "surge".
export const LEVELS = [
  { name: '第一枚印章', hint: '点车道盖下铅笔兵 · 先打爆红墨水瓶', unlock: 1, inkRate: 1.15, aiRate: 0.75, aiDelay: 3.2, aiPool: P, redHp: 55 },
  { name: '回形针齐射', hint: '解锁回形针弓手 · 站远处压制', unlock: 2, inkRate: 1.15, aiRate: 0.80, aiDelay: 3.0, aiPool: PC, redHp: 65 },
  { name: '上下夹击', hint: '敌人开始分路 · 别只守中间', unlock: 2, inkRate: 1.18, aiRate: 0.85, aiDelay: 2.8, aiPool: PC, redHp: 75 },
  { name: '橡皮墙', hint: '解锁橡皮盾 · 用肉盾护住弓手', unlock: 3, inkRate: 1.20, aiRate: 0.90, aiDelay: 2.6, aiPool: PCE, redHp: 85 },
  { name: '三路并进', hint: '三车道同时施压 · 攒墨水再一波推', unlock: 3, inkRate: 1.22, aiRate: 0.95, aiDelay: 2.4, aiPool: PCE, redHp: 95 },
  { name: '巨兽登场', hint: '解锁墨水瓶巨兽 · 但它很贵', unlock: 4, inkRate: 1.25, aiRate: 1.05, aiDelay: 2.3, aiPool: ALL, redHp: 108, surgeEvery: 26 },
  { name: '墨水告急', hint: '墨水回复变慢 · 别乱盖便宜兵', unlock: 4, inkRate: 1.15, aiRate: 1.10, aiDelay: 2.2, aiPool: ALL, redHp: 115, surgeEvery: 24 },
  { name: '涂改液潮', hint: '怪潮爆发 · 别让对面一次连出两枚', unlock: 4, inkRate: 1.28, aiRate: 1.18, aiDelay: 2.0, aiPool: ALL, redHp: 122, surgeEvery: 22 },
  { name: '最后一道横格', hint: '对面基地很厚 · 记得留墨给巨兽', unlock: 4, inkRate: 1.30, aiRate: 1.22, aiDelay: 1.9, aiPool: ALL, redHp: 132, surgeEvery: 20 },
  { name: '涂改液总攻', hint: 'Boss 关 · 又快又厚，怪潮一波接一波', unlock: 4, inkRate: 1.35, aiRate: 1.28, aiDelay: 1.8, aiPool: ALL, redHp: 145, surgeEvery: 18 },
];
export const LEVEL_COUNT = LEVELS.length;

export function levelState(level) {
  const n = clamp(level, 0, LEVEL_COUNT - 1);
  const L = LEVELS[n];
  return createState({
    level: n, unlock: L.unlock, inkRate: L.inkRate, aiRate: L.aiRate, aiDelay: L.aiDelay,
    aiPool: L.aiPool, blueHp: L.blueHp ?? BASE_HP, redHp: L.redHp, ink: 5,
    surgeEvery: L.surgeEvery ?? 0,
  });
}

// no scripted enemy: both teams spend real ink, 3 minutes then the healthier inkwell wins
export function onlineState() {
  return createState({ unlock: 4, inkRate: 1.15, aiRate: 1, aiDelay: 99, aiPool: [], timeLeft: 180, ink: 5 });
}

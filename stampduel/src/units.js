// The four rubber stamps. Colours are ink-buffer ids (see INK in render.js), kept as plain numbers
// so the pure simulation never has to import three.js.
// Roughly balanced on damage-per-ink so spamming the cheapest stamp is not automatically best:
// pencil is quick chaff, clip out-damages it from range, eraser soaks, blot breaks a stalemate.
export const UNIT_LIST = ['pencil', 'clip', 'eraser', 'blot'];
export const unitAt = (n) => UNIT_LIST[n - 1] || 'pencil';
export const unitIndex = (t) => UNIT_LIST.indexOf(t) + 1;

export const UNITS = {
  pencil: {
    name: '铅笔兵', short: '铅', cost: 2, hp: 26, speed: 5.2, range: 1.7,
    dmg: 5, cd: 0.80, ranged: false, ink: 2, size: 0.95,
    desc: '便宜又快，成群往前戳',
  },
  clip: {
    name: '回形针弓手', short: '夹', cost: 3, hp: 17, speed: 3.6, range: 9.5,
    dmg: 9, cd: 0.90, ranged: true, projSpeed: 24, ink: 0, size: 0.85,
    desc: '站远处放纸团，别让它落单',
  },
  eraser: {
    name: '橡皮盾', short: '橡', cost: 4, hp: 95, speed: 2.7, range: 1.7,
    dmg: 6, cd: 1.10, ranged: false, ink: 5, size: 1.25,
    desc: '厚实肉盾，替后排挡刀',
  },
  blot: {
    name: '墨水瓶巨兽', short: '墨', cost: 6, hp: 120, speed: 2.2, range: 2.1,
    dmg: 22, cd: 1.30, ranged: false, ink: 3, size: 1.45,
    desc: '又慢又贵，一巴掌拍碎基地',
  },
};

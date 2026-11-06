// 视觉风格是纯本地偏好：横线笔记本（原版墨水纸面）或纯色（平滑表面，无纸张线条）。
// 只切换自己屏幕上的后处理，不改变任何共享的游戏状态，联机时其他玩家各选各的。
const modes = new Set(['notebook', 'solid']);
export function appearanceFor() {
  let saved;
  try { saved = localStorage.getItem('tank_appearance'); } catch { /* 用默认 */ }
  return modes.has(saved) ? saved : 'notebook';
}
export function saveAppearance(mode) {
  if (!modes.has(mode)) return false;
  try { localStorage.setItem('tank_appearance', mode); } catch { /* 保留会话内选择 */ }
  return true;
}

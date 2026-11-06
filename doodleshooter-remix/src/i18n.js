import turkish from './locales/tr.js';
import chinese from './locales/zh.js';

const STORAGE_KEY = 'doodle_language';
export const LANGUAGES = ['zh', 'en', 'tr'];
const dictionaries = { zh: chinese, tr: turkish };
function savedLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return LANGUAGES.includes(saved) ? saved : 'zh';
  }
  catch { return 'zh'; }
}
export const language = savedLanguage();
document.documentElement.lang = language;

// Translate only developer-authored literals, never names, room codes or HTML
// produced by interpolations. Supports ui('Text') and ui`Text ${value}`.
const text = value => language === 'en' ? value : (dictionaries[language]?.[value] ?? value);
const templates = new WeakMap();
export function ui(parts, ...values) {
  if (typeof parts === 'string') return text(parts);
  let translated = templates.get(parts);
  if (!translated) {
    const key = parts.map((part, i) => part + (i < values.length ? `{${i}}` : '')).join('');
    translated = text(key).split(/\{(\d+)\}/);
    templates.set(parts, translated);
  }
  return translated.map((part, i) => i % 2 ? values[Number(part)] : part).join('');
}

// Called only from the main menu. Reload refreshes module-level map/weapon names
// and HUD labels together; changing language never interrupts an active match.
export function selectLanguage(value) {
  if (!LANGUAGES.includes(value) || value === language) return;
  try { localStorage.setItem(STORAGE_KEY, value); }
  catch { return; }
  location.reload();
}

// 页面风格：默认石墨（styles.css 的 :root），别的在 themes.css。课件 front matter 写 theme: 选，中英文名都认
export const THEMES = { chalk: 'chalk', 墨绿黑板: 'chalk', 黑板: 'chalk', paper: 'paper', 纸本: 'paper', midnight: 'midnight', 深蓝: 'midnight', white: 'white', 白板: 'white', celadon: 'celadon', 青瓷: 'celadon', 护眼: 'celadon', candle: 'candle', 烛光: 'candle', dusk: 'dusk', 暮色: 'dusk', ink: 'ink', 水墨: 'ink', inknight: 'inknight', 墨夜: 'inknight', xuan: 'xuan', 玄: 'xuan', 粉笔: 'chalk', graphite: '', 石墨: '', 夜读: '' };

/** front matter 里 theme 的值 → <html data-theme> 的值（'' 是默认石墨；不认识的返回 null） */
export function themeOf(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  return Object.prototype.hasOwnProperty.call(THEMES, v) ? THEMES[v] : null;
}

// 这台设备上选的风格（学习台「管理」里选；课件自己写了 theme: 的照课件）。存 localStorage，无痕模式读不到就是默认石墨
const KEY = 'la-theme';
// 学习台只有一种样子：紫藤（2026-11-04 我定的：iOS 的版式，青绿山水的底加南大紫）。白天是 ink、晚上是 inknight
// （沿用原来水墨那一对的名字：板上、书桌上 [data-theme^="ink"] 的那一套 iOS 组件都是它们的，换颜色不用改选择器）。
// 别的风格（纸本、青瓷、黑板、玄、夜读……）不再给我选；themes.css 里的样式留着，以前写了 theme: 的课件照旧打得开
export const PICKS = [
  { id: 'ink', name: '紫藤 · 白天' },
  { id: 'inknight', name: '紫藤 · 晚上', dark: true },
];
export const MORE = [];
export const DAY_DEFAULT = 'ink';
export const NIGHT_DEFAULT = 'inknight';

// 2026-11-04 只留紫藤：这台设备以前选过什么都换成「跟着 iPad」的紫藤这一对（白天 ink、晚上 inknight），只换一次
const PAIR_FLAG = `${KEY}-wist-1104`;
function migratePair() {
  try {
    if (localStorage.getItem(PAIR_FLAG)) return;
    localStorage.setItem(PAIR_FLAG, '1');
    localStorage.setItem(KEY, 'auto'); localStorage.setItem(`${KEY}-day`, 'ink'); localStorage.setItem(`${KEY}-night`, 'inknight');
  } catch { /* 无痕模式 */ }
}
const DESK_IDS = ['ink', 'inknight'];
export function storedTheme(fallback = '') {
  if (fallback === DESK_DEFAULT) migratePair();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return fallback;
    if (raw === 'auto') return 'auto';
    const t = themeOf(raw);
    // 学习台只认紫藤那两种：别的（以前选过的、坏掉的值）都退回跟着 iPad
    if (fallback === DESK_DEFAULT && !DESK_IDS.includes(t)) return 'auto';
    return t === null ? fallback : t;
  } catch { return fallback; }
}

// 「跟着 iPad 白天晚上」：系统是浅色用白天那种，深色用晚上那种
const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 无痕模式 */ } };
// 白天、晚上就是紫藤那一对（以前存过别的也不认）
export const dayNight = () => ({ day: DAY_DEFAULT, night: NIGHT_DEFAULT });
export function setDayNight(which, id) { set(`${KEY}-${which}`, id); }
const darkMq = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);
let autoWired = false;
/** 现在该用哪一种（auto 时按系统深浅色） */
export function resolveTheme(t) {
  if (t !== 'auto') return t;
  const { day, night } = dayNight();
  return darkMq()?.matches ? night : day;
}
export const isAuto = () => get(KEY, '') === 'auto';
// 学习台没选过样子：跟着 iPad，白天紫藤、晚上紫藤的夜色
export const DESK_DEFAULT = 'auto';
/** 换风格：写在 <html data-theme>（'' 是默认石墨），save 时记在这台设备上 */
export function applyTheme(t, { save = false } = {}) {
  if (t === 'auto') {
    if (save) set(KEY, 'auto');
    // 系统深浅色一变就跟着换（iPad 设了自动深色时，傍晚自己切过去）
    if (!autoWired && darkMq()) { autoWired = true; darkMq().addEventListener?.('change', () => { if (isAuto()) applyTheme('auto'); }); }
    return applyTheme(resolveTheme('auto'));
  }
  const v = themeOf(t) ?? '';
  const el = document.documentElement;
  if (v) el.dataset.theme = v; else delete el.dataset.theme;
  if (save) { try { localStorage.setItem(KEY, v || 'graphite'); } catch { /* 无痕模式 */ } }
  return v;
}

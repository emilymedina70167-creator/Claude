// 页面风格：默认石墨（styles.css 的 :root），别的在 themes.css。课件 front matter 写 theme: 选，中英文名都认
export const THEMES = { chalk: 'chalk', 墨绿黑板: 'chalk', 黑板: 'chalk', paper: 'paper', 纸本: 'paper', midnight: 'midnight', 深蓝: 'midnight', white: 'white', 白板: 'white', graphite: '', 石墨: '' };

/** front matter 里 theme 的值 → <html data-theme> 的值（'' 是默认石墨；不认识的返回 null） */
export function themeOf(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  return Object.prototype.hasOwnProperty.call(THEMES, v) ? THEMES[v] : null;
}

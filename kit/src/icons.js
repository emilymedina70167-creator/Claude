// 控制条上的小图标：SVG 线条，颜色跟着按钮的字（currentColor）。
// 原来写的是 ◀ ▶ ⏮ 这些字符，iPad 上有的落到 emoji 字体、有的是系统符号，粗细、大小、基线都对不上
const svg = (d, { fill = false } = {}) => `<svg class="ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false"${fill ? ' fill="currentColor" stroke="none"' : ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${d}</svg>`;

export const ICONS = {
  prev: svg('<path d="M12.5 4.5 7 10l5.5 5.5"/>'),
  next: svg('<path d="M7.5 4.5 13 10l-5.5 5.5"/>'),
  first: svg('<path d="M5 4.5v11"/><path d="M14.5 4.5 9 10l5.5 5.5"/>'),
  play: svg('<path d="M6.5 4.2v11.6a.6.6 0 0 0 .9.5l9-5.8a.6.6 0 0 0 0-1L7.4 3.7a.6.6 0 0 0-.9.5Z"/>', { fill: true }),
  pause: svg('<rect x="5.2" y="4" width="3.4" height="12" rx="1"/><rect x="11.4" y="4" width="3.4" height="12" rx="1"/>', { fill: true }),
};

// 播放 / 暂停按钮的内容（图标 + 字）
export const playLabel = (on, word = '播放') => (on ? `${ICONS.pause}<span>暂停</span>` : `${ICONS.play}<span>${word}</span>`);

// 进度条走过的那一段（--pct）：webkit 的滑块轨道不能分两色，用渐变画，值变了跟着改
export function trackFill(range) {
  const min = Number(range.min) || 0, max = Number(range.max) || 0, v = Number(range.value) || 0;
  range.style.setProperty('--pct', `${max > min ? ((v - min) / (max - min)) * 100 : 0}%`);
}

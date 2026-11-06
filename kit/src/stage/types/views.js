// 舞台上几种东西的画法（types/index.js 那几种的画面那一半）：只在浏览器里用
import { arrayView } from './array.view.js';

export const VIEWS = { array: arrayView };

/** 各种东西自己的样式（舞台的 stage.css 之外的） */
export const viewCss = () => Object.values(VIEWS).map((v) => v.css || '').filter(Boolean).join('\n');

// 舞台上能放的几种东西（docs/stage-plan.md）：每一种一个模块（数据和指令，不碰 DOM），画法在 views.js 里配对的那一个。
// 加一种：照 array.js 的样子写 types/xxx.js + types/xxx.view.js，在这里和 views.js 各加一行
import { array } from './array.js';
import { matrix } from './matrix.js';
import { plane } from './plane.js';

export const TYPES = { array, matrix, plane };

/** 造东西的指令 → 那种东西（array → 一排格子、tree → 树……） */
export const CREATE = {};
for (const t of Object.values(TYPES)) for (const c of t.create) CREATE[c] = t;

export function typeOf(o) {
  const t = o && TYPES[o.type];
  if (!t) throw new Error(`不认得「${o?.type}」这种东西`);
  return t;
}

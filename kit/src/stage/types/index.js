// 舞台上能放的几种东西（docs/stage-plan.md）：每一种一个模块（数据和指令，不碰 DOM），画法在 views.js 里配对的那一个。
// 加一种：照 array.js 的样子写 types/xxx.js + types/xxx.view.js，在这里和 views.js 各加一行
import { array } from './array.js';
import { card } from './card.js';
import { tree } from './tree.js';
import { graph } from './graph.js';
import { matrix } from './matrix.js';
import { plane } from './plane.js';
import { sentence } from './sentence.js';
import { tex } from './tex.js';
import { registerRules } from '../rules.js';
import { treeRules } from './tree.rules.js';
import { matrixRules } from './matrix.rules.js';
import { sentenceRules } from './sentence.rules.js';
import { arrayRules } from './array.rules.js';

export const TYPES = { array, tree, graph, matrix, plane, sentence, tex, card };

// 每种东西的规则（rules.js：下一步、判一下、判断式、事实、手势表）：舞台一加载就登记好；没交规则的东西照旧能用，只是不判
registerRules('tree', treeRules);
registerRules('matrix', matrixRules);
registerRules('sentence', sentenceRules);
registerRules('array', arrayRules);

/** 造东西的指令 → 那种东西（array → 一排格子、tree → 树……） */
export const CREATE = {};
for (const t of Object.values(TYPES)) for (const c of t.create) CREATE[c] = t;

export function typeOf(o) {
  const t = o && TYPES[o.type];
  if (!t) throw new Error(`不认得「${o?.type}」这种东西`);
  return t;
}

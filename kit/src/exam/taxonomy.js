// 题型和考法的固定词表（docs/exam-plan.md 1.2「真题的标签」）：标签只能取表里的，统计才算得了。
// 第 0 批照常见的考法先定（rulings 第 0 批第 2 条），第 2 批打完第一批标签再看要不要改。存的是键，给人看的是中文。
// 纯函数，有测试（tests/exam-structure.test.js）。

/** 题型：键 → 中文（键和 schema.js 的 questions.enums.type 一致） */
export const TYPES = {
  single: '单选', multi: '多选', fill: '填空', answer: '解答', comp: '综合',
  cloze: '完形', reading: '阅读', newtype: '新题型', translate: '翻译', essay: '作文', analysis: '分析',
};
const TYPE_BY_ZH = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v, k]));
/** 中文的题型 → 键（认不得返回 ''）；本来就写的键也认 */
export const typeKey = (s) => { const t = String(s || '').trim(); return TYPE_BY_ZH[t] || (TYPES[t] ? t : ''); };

/** 每门课的考法：门课 → { 键: 中文 } */
export const HOW = {
  DS: { concept: '概念辨析', process: '手算过程', result: '写结果序列', property: '判性质', complexity: '算复杂度', code: '写代码', design: '设计算法' },
  CO: { concept: '概念辨析', calc: '算数值', process: '手算过程', timing: '分析时序和流水线', datapath: '设计和分析通路' },
  OS: { concept: '概念辨析', calc: '算数值', process: '手算过程', sync: '同步互斥（PV）', analyze: '分析' },
  CN: { concept: '概念辨析', calc: '算数值', process: '手算过程', protocol: '分析协议过程' },
  LA: { concept: '概念辨析', calc: '算', rank: '判秩和相关性', proof: '证明', param: '含参讨论', abstract: '抽象矩阵' },
  HM: { concept: '概念辨析', calc: '算', proof: '证明', apply: '应用' },
  PS: { concept: '概念辨析', calc: '算', proof: '证明', estimate: '估计和检验' },
  EN: { structure: '成分和结构', vocab: '词义', detail: '细节', infer: '推断', main: '主旨', attitude: '态度', logic: '逻辑衔接', translate: '翻译要点', write: '写作' },
  PO: { concept: '概念辨析', apply: '运用', material: '材料分析' },
};

/**
 * 一道题的标签守不守词表：syl 1～3 个、都在这门课的考点树里；how 在这门课的表里；难度 1～5 的整数。
 * 返回问题的列表（空的就是没问题）
 */
export function checkTags(tags = {}, { course = '', syllabusIds = new Set() } = {}) {
  const out = [];
  const syl = Array.isArray(tags.syl) ? tags.syl.map(String) : [];
  if (!syl.length) out.push('要挂至少一个考点（syl）');
  if (syl.length > 3) out.push(`考点最多 3 个，现在是 ${syl.length} 个`);
  for (const id of syl) if (!syllabusIds.has(id)) out.push(`考点 ${id} 在考点树里没有`);
  const table = HOW[course] || {};
  if (tags.how !== undefined && !table[tags.how]) out.push(`考法「${tags.how}」不在${course}的表里（${Object.keys(table).join(' / ')}）`);
  const est = tags.difficulty?.est;
  if (est !== undefined && !(Number.isInteger(est) && est >= 1 && est <= 5)) out.push(`难度要写 1～5 的整数，现在是「${est}」`);
  return out;
}

// 一份守规矩的示例记忆：本地试用学习台（?dev 的「填入示例记忆」）和测试用（自检应该一处错都没有）。
// 内容是虚构的，写法照 schema.js。today：YYYY-MM-DD，复现组的日期跟着它排，好看出到期
import { addDays } from './schema.js';

export function sampleMemory(today) {
  const d = (n) => addDays(today, n);
  return {
    rules: [
      { id: 'rule-01', cat: '红线', text: '课堂不能宣布我「掌握了」：掌握由页面按证据算、我确认。', since: d(-30), source: `我 ${d(-30)} 在对话里定的`, status: 'active' },
      { id: 'rule-02', cat: '教法', text: '交互优先：能拖、能猜的先让我动手，再讲结论。', since: d(-20), source: `我 ${d(-20)} 说的`, status: 'active' },
    ],
    profile: [
      { id: 'p-goal', topic: '目标', text: '考研数学一 + 408。', since: d(-30) },
      { id: 'p-lang', topic: '术语', text: '在美国读大学：术语第一次出现时附英文。', since: d(-30) },
    ],
    curriculum: [
      { id: 'L2', level: 'lecture', title: '第2讲 矩阵' },
      { id: 'L2.2', level: 'section', title: '§2 秩一方阵', parent: 'L2' },
      { id: 'L2.2.1', level: 'block', title: '行成比例 → 秩一', parent: 'L2.2', scope: '认出秩一方阵，写成 αβᵀ', exam: '小题：直接写出 Aⁿ', points: ['先看行成比例', '拆成 αβᵀ'] },
      { id: 'L2.2.2', level: 'block', title: 'Aⁿ = tr(A)ⁿ⁻¹A', parent: 'L2.2', requires: ['L2.2.1'], scope: '用结合律推出 Aⁿ' },
    ],
    errors: [
      { id: 'L2-07', source: '第2讲例2.1', q: '求 A²，A = αβᵀ', mine: '写成 ααᵀββᵀ', step: '第 1 步：换括号', cause: '没看出 βᵀα 是一个数', weakness: 'W19', block: 'L2.2.2', date: d(-6) },
    ],
    weaknesses: [
      {
        id: 'W19', title: '内积和外积分不清', scope: '链条', level: 'L1', last: d(-6), errors: ['L2-07'], blocks: ['L2.2.2'], status: 'active',
        log: [{ date: d(-6), by: 'chat', field: 'level', from: null, to: 'L1', basis: ['L2-07'] }],
      },
    ],
    mastery: [
      {
        id: 'L2.2.1', state: '基础题过', basis: ['L2-T01'],
        log: [{ date: d(-6), by: 'chat', field: 'state', from: '讲过', to: '基础题过', basis: ['L2-T01'] }],
      },
      { id: 'L2.2.2', state: '讲过', basis: ['课堂 c-1020'], log: [{ date: d(-6), by: 'chat', field: 'state', from: '未学', to: '讲过', basis: ['课堂 c-1020'] }] },
    ],
    reviews: [
      { id: 'R3', title: '秩一：拆 αβᵀ、求 Aⁿ', family: '结合律换括号', weaknesses: ['W19'], tier: 3, last: d(-4), result: '过', log: [{ date: d(-4), by: 'chat', field: 'tier', from: 1, to: 3, basis: ['L2-T02'] }] },
      { id: 'R4', title: '分块矩阵乘法', family: '按块乘', tier: 1, last: d(-1), result: '没过', log: [] },
      { id: 'R5', title: '内积是数、外积是矩阵', family: '形状', weaknesses: ['W19'], tier: 7, last: d(-2), result: '过', log: [] },
    ],
    position: [
      { id: 'now', block: 'L2.2.2', next: '先收 L2-07 的同类题，再推 Aⁿ', debts: ['§2 的检验题第 3 题没做'], first: ['L2-07 同类题'] },
    ],
    slips: [
      { id: 'S-1-1', by: 'chat', date: d(-6), text: '一次写了五块板，没等我答就往下讲。', lesson: '一块板一件事，等作答再写下一块。' },
    ],
    lessons: [
      { id: 'T-1', text: '出一组练习之前，逐题列出要用到的规则，没讲过的先讲完；讲不了的那题不出。', why: '边讲边出题，学生撞墙后才补规则', topic: '出题', slips: [], hits: 2, since: d(-6), last: d(-2), status: 'active', log: [] },
    ],
  };
}

/** 分科的示例（?dev 的「填入示例记忆」一起填）：408 和英语各一点课程地图、位置、错题，看切换科目 */
export function sampleSpaces(today) {
  const d = (n) => addDays(today, n);
  return {
    curriculum: [
      { id: 'DS-L2', level: 'lecture', title: '第2章 线性表' },
      { id: 'DS-L2.1', level: 'section', title: '§1 顺序表', parent: 'DS-L2' },
      { id: 'DS-L2.1.1', level: 'block', title: '顺序表的插入删除', parent: 'DS-L2.1', scope: '插入、删除时元素移动的次数' },
      { id: 'EN-L1', level: 'lecture', title: '第1章 句子成分' },
      { id: 'EN-L1.1', level: 'section', title: '§1 简单句的主干', parent: 'EN-L1' },
      { id: 'EN-L1.1.1', level: 'block', title: '找主谓宾', parent: 'EN-L1.1', scope: '五种基本句型，先找谓语动词' },
    ],
    errors: [
      { id: 'EN-L1-01', source: '语法书 1.1 练习', q: 'Neither of the answers ___ correct.', mine: 'are', step: '主谓一致', cause: '把 answers 当主语', block: 'EN-L1.1.1', date: d(-2) },
    ],
    // 要记的（recall.js）：各科几条，有到期的、有没想起过的
    recall: [
      { id: 'K1', q: '外积 $\\alpha\\beta^T$（$\\alpha,\\beta$ 都不是零向量）的秩是多少？', a: '1：每一列都是 $\\alpha$ 的倍数', block: 'L2.2.2', space: 'math', tier: 1, last: d(-1), lapses: 1, result: 'miss', status: 'active', log: [] },
      { id: 'K2', q: '$(AB)^T$ 等于什么？', a: '$B^TA^T$（顺序反过来）', block: 'L2.2.2', space: 'math', tier: 3, last: d(-5), result: 'got', status: 'active', log: [] },
      { id: 'K3', q: '顺序表在第 i 个位置插入，要移动几个元素（表长 n）？', a: 'n − i + 1 个', block: 'DS-L2.1.1', space: 'cs', tier: 1, last: d(-2), status: 'active', log: [] },
      { id: 'K4', q: '五种基本句型是哪五种？', a: '主谓、主谓宾、主系表、主谓双宾、主谓宾补', block: 'EN-L1.1.1', space: 'en', tier: 7, last: d(-1), result: 'got', status: 'active', log: [] },
    ],
    position: [
      { id: 'now-cs', block: 'DS-L2.1.1', next: '顺序表插入删除的平均移动次数' },
      { id: 'now-en', block: 'EN-L1.1.1', next: '五种基本句型，从找谓语开始' },
    ],
  };
}

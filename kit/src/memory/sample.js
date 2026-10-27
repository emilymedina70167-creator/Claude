// 一份守规矩的示例记忆：本地试用学习台（?dev 的「填入示例记忆」）和测试用（自检应该一处错都没有）。
// 内容是虚构的，写法和 CLAUDE-PROJECT.md 第七节一致。today：YYYY-MM-DD，复现组的日期跟着它排，好看出到期
import { addDays } from './schema.js';

export function sampleMemory(today) {
  const d = (n) => addDays(today, n);
  return {
    rules: [
      { id: 'rule-01', cat: '红线', text: '课堂不能宣布我「掌握了」：掌握只由对话里的 Claude 按证据判断。', since: d(-30), source: `我 ${d(-30)} 在对话里定的`, status: 'active' },
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
  };
}

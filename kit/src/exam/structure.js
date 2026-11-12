// 卷面结构表（docs/exam-plan.md 第二节第 2 步）：每门课每个年份段几道题、哪几题是哪种题型、每道几分、合计多少。
// 切出来的题和它对不上整卷不收（tools/exam.mjs check、收件箱 inbox.js）。
// **现在是草稿**（rulings 第 0 批第 1 条）：还没有真卷可核，每一段带 checked: false，checkPaper 会提醒一句；
// 第 2 批每核过一年的真卷改成 true，核出来不一样的改这里、记进 rulings。不凭记忆当成定论。
// 纯函数，有测试（tests/exam-structure.test.js）。
import { TYPES } from './taxonomy.js';

/**
 * subject → [{ from, to（年份段，含两头；to 不写是到现在）, checked, total, minutes, sections: [{ from, to（题号）, type, points（每题几分；null 是不固定）, sum（这一段合计，points 不固定时写）}] }]
 */
export const STRUCTURE = {
  408: [{
    from: 2009, checked: false, total: 150, minutes: 180,
    sections: [{ from: 1, to: 40, type: 'single', points: 2 }, { from: 41, to: 47, type: 'comp', points: null, sum: 70 }],
    // 408 一卷四门课：题号 → 门课（切题时先填，打了标签以后以主考点的门课为准）。也是草稿
    courses: [[1, 11, 'DS'], [12, 22, 'CO'], [23, 32, 'OS'], [33, 40, 'CN'], [41, 42, 'DS'], [43, 44, 'CO'], [45, 46, 'OS'], [47, 47, 'CN']],
  }],
  301: [
    {
      from: 2009, to: 2020, checked: false, total: 150, minutes: 180,
      sections: [{ from: 1, to: 8, type: 'single', points: 4 }, { from: 9, to: 14, type: 'fill', points: 4 }, { from: 15, to: 23, type: 'answer', points: null, sum: 94 }],
    },
    {
      from: 2021, checked: false, total: 150, minutes: 180,
      sections: [{ from: 1, to: 10, type: 'single', points: 5 }, { from: 11, to: 16, type: 'fill', points: 5 }, { from: 17, to: 22, type: 'answer', points: null, sum: 70 }],
    },
  ],
  201: [{
    from: 2010, checked: false, total: 100, minutes: 180,
    sections: [
      { from: 1, to: 20, type: 'cloze', points: 0.5 }, { from: 21, to: 40, type: 'reading', points: 2 }, { from: 41, to: 45, type: 'newtype', points: 2 },
      { from: 46, to: 50, type: 'translate', points: 2 }, { from: 51, to: 51, type: 'essay', points: 10 }, { from: 52, to: 52, type: 'essay', points: 20 },
    ],
  }],
  101: [{
    from: 2010, checked: false, total: 100, minutes: 180,
    sections: [{ from: 1, to: 16, type: 'single', points: 1 }, { from: 17, to: 33, type: 'multi', points: 2 }, { from: 34, to: 38, type: 'analysis', points: 10 }],
  }],
};
const ONE_COURSE = { 201: 'EN', 101: 'PO' };
// 数学一一卷三门课，题号认不出门课：先写高数（分量最大），打了标签以后照主考点改（inbox.js 的 courseOfTags）。
// 不先写的话门课是必填，整卷进不了库，标签又要题先在库里——两边互相等（整支审查第 4 条）
const GUESS = { 301: 'HM' };

/** 某一科某一年的结构（没有就是 null） */
export function structureOf(subject, year) {
  const y = Number(year);
  return (STRUCTURE[String(subject)] || []).find((s) => y >= s.from && (s.to === undefined || y <= s.to)) || null;
}

/** 题号 → 门课的草稿：408 照表，英语、政治只有一门，数学一先猜高数 */
export function courseHint(subject, year, n) {
  if (ONE_COURSE[subject]) return ONE_COURSE[subject];
  const s = structureOf(subject, year);
  const hit = (s?.courses || []).find(([a, b]) => n >= a && n <= b);
  return hit ? hit[2] : GUESS[subject] || '';
}

const range = (a, b) => (a === b ? `第 ${a} 题` : `${a}～${b}`);
const near = (a, b) => Math.abs(a - b) < 1e-9;

/**
 * 一卷切出来的题和结构表对不对得上：题数、每题题型、固定分值、不固定那一段的合计、卷面总分、卷上写的题数。
 * paper：{ subject, year, total, count }；questions：[{ n, type, points }]。返回 { problems, notes }（notes 是提醒，不挡）
 */
export function checkPaper(paper = {}, questions = []) {
  const problems = [];
  const notes = [];
  const s = structureOf(paper.subject, paper.year);
  if (!s) return { problems: [`结构表里没有 ${paper.subject} 的 ${paper.year} 年`], notes };
  if (!s.checked) notes.push(`${paper.subject} 的结构表（${s.from} 年起）还没照真卷核过`);
  const byN = new Map();
  for (const q of questions) {
    const n = Number(q.n);
    if (byN.has(n)) problems.push(`第 ${n} 题出现了两次`);
    byN.set(n, q);
  }
  const last = s.sections.at(-1).to;
  for (let n = 1; n <= last; n++) if (!byN.has(n)) problems.push(`少了第 ${n} 题`);
  for (const n of byN.keys()) if (n < 1 || n > last) problems.push(`多了第 ${n} 题（这一年只到第 ${last} 题）`);
  for (const sec of s.sections) {
    let sum = 0;
    for (let n = sec.from; n <= sec.to; n++) {
      const q = byN.get(n);
      if (!q) continue;
      const p = Number(q.points);
      sum += p;
      if (q.type !== sec.type) problems.push(`第 ${n} 题的题型是「${TYPES[q.type] || q.type}」，结构表里是「${TYPES[sec.type]}」`);
      if (sec.points !== null && !near(p, sec.points)) problems.push(`第 ${n} 题是 ${p} 分，结构表里每道 ${sec.points} 分`);
    }
    if (sec.points === null && sec.sum !== undefined && !near(sum, sec.sum)) problems.push(`${range(sec.from, sec.to)}合计 ${sum} 分，结构表里是 ${sec.sum} 分`);
  }
  const total = questions.reduce((n, q) => n + Number(q.points || 0), 0);
  if (Number(paper.total) !== s.total) problems.push(`卷面总分写的是 ${paper.total}，结构表里是 ${s.total}`);
  else if (!near(total, s.total) && !problems.length) problems.push(`各题加起来 ${total} 分，卷面总分是 ${s.total}`);
  if (paper.count !== undefined && Number(paper.count) !== last) problems.push(`卷上写的题数是 ${paper.count}，结构表里是 ${last}`);
  return { problems, notes };
}

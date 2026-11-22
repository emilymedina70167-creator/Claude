// 考情一节装得下：四门课十五年的全量假数据，任何一块的舞台说明里一定有档案、这一块的考点、
// 统计（和页面算的一样）、至少两道代表题、学生的情况、用法；整份不超 STAGE_SYSTEM_MAX；教材原文至少留 32 KiB；留着的卷一个字都没有
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examForClass } from '../kit/src/exam/context.js';
import { examForBlock } from '../kit/src/exam/block.js';
import { blockStats, spanOf } from '../kit/src/exam/stats.js';
import { DEFAULT_TARGET } from '../kit/src/exam/target.js';
import { HOW } from '../kit/src/exam/taxonomy.js';
import { sampleMemory } from '../kit/src/memory/sample.js';

const COURSES = { DS: '408', OS: '408', LA: '301', EN: '201' };
const bytes = (s) => new TextEncoder().encode(s).length;
function world(course) {
  const pre = course === 'LA' ? '' : `${course}-`;
  const syllabus = [...Array(20)].map((_, i) => ({ id: `G-${course}-${i + 1}`, course, title: `考点${i + 1}`, level: '掌握', text: `大纲原文 ${i + 1}：`.repeat(6), blocks: [`${pre}L${1 + (i % 6)}.1.${1 + (i % 3)}`] }));
  const questions = [];
  for (let y = 2012; y <= 2026; y++) for (let k = 1; k <= 12; k++) {
    const n = k + (course === 'OS' ? 20 : 0);
    const hows = Object.keys(HOW[course]);
    questions.push({ id: `Q-${COURSES[course]}-${y}-${n}`, paper: `X-${COURSES[course]}-${y}`, year: y, n, type: k <= 9 ? 'single' : 'comp', points: k <= 9 ? 2 : 10, course,
      stem: `${y} 年第 ${n} 题的题面`.repeat(30) + (y >= 2024 ? ` RESERVED-${y}-${n}` : ''), options: k <= 9 ? { A: 'a', B: 'b', C: 'c', D: 'd' } : undefined, answer: 'B',
      analysis: `解析 ${y}-${n} `.repeat(60), tags: { syl: [`G-${course}-${1 + ((y + k) % 20)}`, `G-${course}-${1 + ((y * k) % 20)}`], how: hows[(y + k) % hows.length] } });
  }
  return { course, syllabus, questions, profiles: syllabus.slice(0, 10).map((n) => ({ id: n.id, how: '怎么考的归纳'.repeat(40), traps: [{ id: `${n.id}#t1`, text: '一个坑'.repeat(10), qs: questions.slice(0, 3).map((q) => q.id) }] })) };
}


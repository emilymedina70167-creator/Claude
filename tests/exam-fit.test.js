// 考情一节装得下（docs/exam-plan.md 第七节）：四门课十五年的全量假数据，任何一块的舞台说明里一定有档案、这一块的考点、
// 统计（和页面算的一样）、至少两道代表题、学生的情况、用法；整份不超 STAGE_SYSTEM_MAX；教材原文至少留 32 KiB；留着的卷一个字都没有
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examForClass } from '../kit/src/exam/context.js';
import { examForBlock } from '../kit/src/exam/block.js';
import { blockStats, spanOf } from '../kit/src/exam/stats.js';
import { DEFAULT_TARGET } from '../kit/src/exam/target.js';
import { buildStageSystem, STAGE_SYSTEM_MAX, TEXTBOOK_FLOOR } from '../kit/src/stage/doc.js';
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

test('四门课的每一块：该有的都在、数字和页面算的一样、整份不超、教材原文留够、留着的卷没有', () => {
  const years = [2024, 2025, 2026];
  const textbook = '教材原文的一段。'.repeat(6000); // 约 120 KiB
  for (const course of Object.keys(COURSES)) {
    const ex = world(course);
    const blocks = [...new Set(ex.syllabus.flatMap((n) => n.blocks))];
    for (const block of blocks) {
      const info = examForBlock({ block, exam: ex, years });
      const text = examForClass({ target: DEFAULT_TARGET, info, today: '2026-11-12' });
      const want = blockStats(ex.syllabus.filter((n) => n.blocks.includes(block)).map((n) => n.id), ex.questions, { years: spanOf(ex.questions) });
      for (const s of ['目标：', '## 这一块挂的考点', `考了 ${want.n} 次`, '## 学生在这一块真题上的情况', '## 这一节怎么用']) assert.ok(text.includes(s), `${block}：${s}`);
      assert.ok((text.match(/^### Q-/gm) || []).length >= 2, `${block}：至少两道代表题`);
      assert.ok(!/RESERVED-/.test(text), `${block}：留着的卷`);
      const sys = buildStageSystem({ pack: { main: { goal: '这一节的目标', textbook, extra1: 'x'.repeat(60000), extra2: 'y'.repeat(60000), extra3: 'z'.repeat(60000) } }, subject: '', exam: text, memory: { mem: sampleMemory('2026-11-12'), block, space: 'math' } });
      assert.ok(bytes(sys) <= STAGE_SYSTEM_MAX, `${block}：整份 ${bytes(sys)}`);
      const tb = sys.slice(sys.indexOf('【教材原文'), sys.indexOf('\n【', sys.indexOf('【教材原文') + 2) > 0 ? sys.indexOf('\n【', sys.indexOf('【教材原文') + 2) : undefined);
      assert.ok(bytes(tb) >= TEXTBOOK_FLOOR, `${block}：教材原文只剩 ${bytes(tb)}`);
    }
  }
});

// 真题用在备课、复现课、练一练、教研室出题（考情第 4 批 4.4）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepPrompt, parsePrep, lessonPlanText } from '../kit/src/books/plan.js';
import { reviewPack } from '../kit/src/memory/views.js';
import { markFresh, isOriginal } from '../kit/src/memory/mastery.js';
import { problemLint } from '../kit/src/memory/lab.js';
import { packText } from '../kit/src/class/prompt.js';

test('备课：带考情一节、要一个 examBar；读回只收能用的真题，不能用的报进备课检查；写成给老师的一行', () => {
  const p = prepPrompt({ block: { id: 'OS-L3.2.1', title: '页面置换' }, exam: '## 统计\n- 考了 5 次' });
  assert.match(p, /## 这一块在考试里[\s\S]*考了 5 次/);
  assert.match(p, /"examBar"/);
  const raw = JSON.stringify({ goal: 'g', sequence: [{ step: 1, point: 'p' }], examBar: { id: 'Q-408-2019-26', why: '最典型的 LRU 缺页次数' } });
  const r = parsePrep(raw, { block: { id: 'OS-L3.2.1' }, examIds: new Set(['Q-408-2019-26']) });
  assert.deepEqual(r.main.examBar, { id: 'Q-408-2019-26', why: '最典型的 LRU 缺页次数' });
  assert.match(lessonPlanText(r.main).examBar, /Q-408-2019-26.*最典型/);
  assert.match(packText({ main: r.main }).text, /这节课结束时学生要能做的真题/);
  const bad = parsePrep(JSON.stringify({ goal: 'g', sequence: [{ step: 1, point: 'p' }], examBar: { id: 'Q-408-2025-3', why: 'x' } }), { block: { id: 'OS-L3.2.1' }, examIds: new Set(['Q-408-2019-26']) });
  assert.equal(bad.main.examBar, undefined);
  assert.match(bad.main.prepCheck.join(), /Q-408-2025-3.*不是这一块能用的真题/);
});

test('复现课：这一块没做过的、能用的真题放进题（最多两道）', () => {
  const mem = { reviews: [{ id: 'R1', title: '置换', tier: 3, blocks: ['OS-L3.2.1'], last: '2026-11-01' }], curriculum: [{ id: 'OS-L3.2.1', level: 'block', title: '页面置换' }] };
  const exam = [{ id: 'Q-408-2019-26', stem: '题A', answer: '9', block: 'OS-L3.2.1' }, { id: 'Q-408-2021-26', stem: '题B', answer: 'C', block: 'OS-L3.2.1' }, { id: 'Q-408-2023-26', stem: '题C', answer: 'D', block: 'OS-L3.2.1' }];
  const r = reviewPack(mem, ['R1'], { exam, done: new Set(['Q-408-2021-26']), today: '2026-11-12' });
  const qs = r.problems.items.filter((x) => x.exam);
  assert.deepEqual(qs.map((x) => x.exam), ['Q-408-2019-26', 'Q-408-2023-26']);
  assert.match(qs[0].source, /真题/);
});

test('练一练：真题做的题（d-q-…）第一次做算新题，第二次是原题', () => {
  const items = markFresh([{ comp: 'd-q-408-2019-26', session: 'c-1', first: 5 }, { comp: 'd-q-408-2019-26', session: 'c-2', first: 9 }]);
  assert.equal(items[0].fresh, true);
  assert.equal(items[1].fresh, undefined);
  assert.equal(isOriginal(items[0]), false);
  assert.equal(isOriginal(items[1]), true);
});

test('教研室出的新题：要写 like= 对标哪一道真题、难易；对标的要真有、能用、同一块', () => {
  const md = (extra) => `\`\`\`answer\nq: 一道新题\nanswer: \\calc{1+1}\n${extra}\n\`\`\``;
  const exam = { ids: new Set(['Q-408-2019-26']), reserved: new Set(['Q-408-2025-26']), blockOf: { 'Q-408-2019-26': 'OS-L3.2.1', 'Q-408-2025-26': 'OS-L3.2.1' }, block: 'OS-L3.2.1' };
  assert.deepEqual(problemLint({ kind: 'answer', doc: { md: md('like: Q-408-2019-26\nharder: 相当') } }, { subject: '操作系统', exam }), []);
  assert.match(problemLint({ kind: 'answer', doc: { md: md('') } }, { subject: '操作系统', exam }).join(), /like:/);
  assert.match(problemLint({ kind: 'answer', doc: { md: md('like: Q-408-2025-26\nharder: 相当') } }, { subject: '操作系统', exam }).join(), /留作模考/);
  assert.match(problemLint({ kind: 'answer', doc: { md: md('like: Q-408-2019-99\nharder: 难') } }, { subject: '操作系统', exam }).join(), /没有/);
  assert.match(problemLint({ kind: 'answer', doc: { md: md('like: Q-408-2019-26') } }, { subject: '操作系统', exam }).join(), /harder/);
  assert.deepEqual(problemLint({ kind: 'answer', doc: { md: md('') } }, { subject: '操作系统' }), [], '没有考试资料时照旧不查');
});

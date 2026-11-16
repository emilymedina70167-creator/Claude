// 要拿下的事在老师说明里的三处：学习台那一节的写法说明、黑板现状最前面的一节、下课时对照它。
import test from 'node:test';
import assert from 'node:assert/strict';
import { AIMS_DOC, DESK_DOC, boardStateText, closingPrompt, buildSystem } from '../kit/src/class/prompt.js';
import { aimsSummary, aimsText, parseAims } from '../kit/src/class/aims.js';

const aims = parseAims('a1 ｜ 给一个引用串，手算 LRU 的缺页次数 ｜ 独立做一道没见过的同类题 ｜ exam=Q-408-2023-45\na2 ｜ 说出 LRU 和 FIFO 各在什么时候吃亏').aims;
const sum = aimsSummary(aims, [{ aim: 'a1', kind: 'answer', outcome: 'first' }]);
const board = { segs: [], pages: [], cur: 0 };
const bytes = (s) => Buffer.byteLength(s);

test('写法说明：board aims、aim=、状态由页面算；只在学习台里上课时带，一问一答不带', () => {
  for (const s of ['board aims', 'aim=a1', '｜', 'exam=', '独立做到', '带着做到', '不上板']) assert.ok(AIMS_DOC.includes(s), s);
  assert.ok(!/[他她]/.test(AIMS_DOC));
  assert.ok(bytes(AIMS_DOC) <= 1500, `${bytes(AIMS_DOC)}`);
  assert.ok(DESK_DOC.includes(AIMS_DOC));
  const on = { ...board, aims: [] };
  assert.ok(buildSystem({ componentDocs: '', pack: {}, board: on, subject: '操作系统', memory: { mem: {} } }).includes(AIMS_DOC));
  assert.ok(buildSystem({ componentDocs: '', pack: {}, board: on, subject: '操作系统', memory: { mem: {} }, tools: false }).includes(AIMS_DOC));
  // 这节课不提这回事（黑板现状里没有 aims：以前开的课、复现课）：整套说明里不出现 board aims，带了老师会照着写、页面又不收
  assert.ok(!buildSystem({ componentDocs: '', pack: {}, board, subject: '操作系统', memory: { mem: {} } }).includes('board aims'));
  assert.ok(!buildSystem({ componentDocs: '', pack: {}, board, subject: '操作系统', memory: { mem: {} }, tools: false }).includes('board aims'));
  assert.ok(!buildSystem({ componentDocs: '', pack: {}, board: on, subject: '操作系统' }).includes(AIMS_DOC));
  assert.ok(!buildSystem({ componentDocs: '', pack: {}, board: '', subject: '操作系统', talk: true, memory: { mem: {} } }).includes('board aims'));
});
test('说明里的例子照抄就能用', () => {
  const body = AIMS_DOC.match(/board aims\n([\s\S]*?)\n\s*````/)[1];
  const r = parseAims(body);
  assert.deepEqual(r.errors, []); assert.equal(r.aims.length, 2); assert.ok(r.aims[0].exam);
});
test('黑板现状：有要拿下的事就在最前面列出来，带页面算的状态', () => {
  const t = boardStateText({ ...board, aims: sum });
  assert.ok(t.startsWith('这节课要拿下的事（状态是页面按学生的作答算的）'));
  assert.ok(t.includes(aimsText(sum)));
  assert.ok(t.includes('独立做到') && t.includes('还没证据'));
  assert.ok(t.includes('黑板是空的') || t.includes('新的一段用 id'));
  assert.ok(!/[他她]/.test(t));
});
test('黑板现状：定了要有但还没写（空数组）提醒先写；没传（旧课、复现课、别的调用的人）两句都没有', () => {
  const t = boardStateText({ ...board, aims: [] });
  assert.ok(t.includes('这节课还没定要拿下的事') && t.includes('board aims'));
  const u = boardStateText(board);
  assert.ok(!u.includes('要拿下的事'));
  assert.equal(boardStateText({ ...board, aims: undefined }), u);
});
test('下课：对每件事写一行，到了没有、还差什么；报告里已经列着的不重复列', () => {
  const t = closingPrompt({ report: '', aims: sum });
  assert.ok(t.includes('到了没有、还差什么') && t.includes(aimsText(sum)));
  assert.ok(!/[他她]/.test(t.replace('不用「他」「她」', '')));
  const section = `这节课要拿下的事（状态是页面按学生的作答算的）：\n${aimsText(sum)}`;
  const u = closingPrompt({ report: `课后报告\n${section}\n每道题：…`, aims: sum, noForm: true });
  assert.ok(u.includes('到了没有、还差什么'));
  assert.equal(u.split(aimsText(sum)).length - 1, 1, '报告里有了就只出现一次');
  assert.ok(!closingPrompt({ report: '', aims: [] }).includes('到了没有、还差什么'));
  assert.ok(!closingPrompt({ report: '' }).includes('到了没有、还差什么'));
  // 不传 aims 时一字不变（舞台课、一问一答走这里）
  assert.equal(closingPrompt({ report: 'x', aims: undefined }), closingPrompt({ report: 'x' }));
});

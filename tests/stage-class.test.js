// 学习台里的舞台课（kit/src/stage/classroom.js）不碰 DOM 的部分：老师这一轮哪些行上舞台、填的答案怎么判、
// 学生做了什么写给老师的那一句、每一轮的整份说明、开课用哪种形态
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageLines, sameAnswer, actText } from '../kit/src/stage/stage.js';
import { buildStageSystem, STAGE_MEMO_DOC, STAGE_SYSTEM_MAX } from '../kit/src/stage/doc.js';
import { classForm, setClassForm, SESSION_KINDS, isTeach } from '../kit/src/memory/session.js';
import { sampleMemory } from '../kit/src/memory/sample.js';

test('老师这一轮：代码块记号不演，board memo 块里的行不上舞台（行号不变）', () => {
  const lines = stageLines('say "看"\n```\nglow a.1\n```\n````board memo\nnote text="x" basis=S1\n````\nask next "好"');
  assert.deepEqual(lines, ['say "看"', null, 'glow a.1', null, null, null, null, 'ask next "好"']);
  // 写到一半（memo 块还没收尾）：块里的照样不演
  assert.deepEqual(stageLines('````board memo\nnote text="x"'), [null, null]);
});

test('填的答案：数按数比（0.50 = .5 = 1/2），别的去掉空格、不分大小写', () => {
  assert.ok(sameAnswer('0.50', '1/2'));
  assert.ok(sameAnswer(' 5 ', '5'));
  assert.ok(sameAnswer('O(N^2)', 'o(n^2)'));
  assert.ok(!sameAnswer('4', '5'));
  assert.ok(!sameAnswer('1/0', '0'));
});

test('写给老师的那一句：点了哪一格、对没对；拖；填的答案；打的字；中间拨过的数', () => {
  assert.equal(actText({ type: 'tap', ref: 'a.4', value: '97', key: 4, slot: 4, expected: 'a.7', right: false }), '学生点了 a.4（97）——你预期的是 a.7，点的不是它');
  assert.match(actText({ type: 'tap', ref: 'a.3', value: '49′', key: 8, slot: 3 }), /a\.3（49′，#8）/);
  assert.match(actText({ type: 'value', text: '5', answer: '5', right: true }), /填了「5」——正确答案是 5，填对了/);
  assert.equal(actText({ type: 'say', text: '不懂' }), '学生说：「不懂」');
  assert.match(actText({ type: 'next', button: '看出来了', tries: [{ type: 'dial', name: 'd', path: [5, 3, 2] }] }), /学生拨了 d：5 → 3 → 2（停在 2）\n学生点了「看出来了」/);
});

test('每一轮的整份说明：怎么教、舞台的写法、资料包、记忆；不用「他」「她」；不超过上限', () => {
  const mem = sampleMemory('2026-11-05');
  const t = buildStageSystem({ pack: { main: { unit: '希尔排序', textbook: '王道原文：希尔排序……' } }, memory: { mem, block: 'L2.1.4', space: 'math', session: 'c-20261106-1' }, title: '希尔排序' });
  assert.match(t, /# 一、怎么教/);
  assert.match(t, /# 二、舞台的写法/);
  assert.match(t, /# 三、这节课：希尔排序/);
  assert.match(t, /王道原文：希尔排序/);
  assert.match(t, /# 四、你对学生的了解/);
  assert.match(t, /board memo/);
  assert.doesNotMatch(t, /[他她]/);
  assert.ok(Buffer.byteLength(t) < STAGE_SYSTEM_MAX);
  // 记忆的依据写舞台上那一问的编号
  assert.match(STAGE_MEMO_DOC, /basis=S5/);
  assert.doesNotMatch(STAGE_MEMO_DOC, /q-b5/);
  // 没有记忆（不在学习台里）：没有那一节
  assert.doesNotMatch(buildStageSystem({}), /你对学生的了解/);
});

test('开课的形态多了舞台；舞台课算讲课的课（报告、复盘、掌握照黑板课那样算）', () => {
  const box = new Map();
  const st = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => box.set(k, v) };
  assert.equal(classForm(st), 'class');
  assert.equal(setClassForm('stage', st), 'stage');
  assert.equal(classForm(st), 'stage');
  assert.equal(setClassForm('瞎写', st), 'class');
  assert.equal(SESSION_KINDS.stage, '舞台');
  assert.ok(isTeach({ kind: 'stage' }));
});

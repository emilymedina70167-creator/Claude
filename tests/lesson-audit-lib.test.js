import test from 'node:test';
import assert from 'node:assert/strict';
import { teacherChars, isClosedEv, isProduceEv, isSelfAsk, auditLesson } from '../tools/lesson-audit-lib.mjs';

const T0 = 1_800_000_000_000, min = 60_000;
const turns = [
  { seq: 1, role: 'claude', at: T0, text: '先看定义。\n\n```board new id=b1\n秩是极大无关组里向量的个数。\n```\n\n```board memo\nnote text="x"\n```', cost: { first: 7000, ms: 9000 } },
  { seq: 2, role: 'student', at: T0 + 2 * min, text: '[作答] …' },
  { seq: 3, role: 'claude', at: T0 + 3 * min, text: '对。', cost: { first: 5000, ms: 6000 } },
];
const evidence = [
  { id: 'e1', session: 'c-1', src: 'record', kind: 'answer', type: 'quiz', comp: 'q1', ok: true, attempts: 1, at: T0 + 10_000 },           // 10 秒就选对：白停
  { id: 'e2', session: 'c-1', src: 'record', kind: 'answer', type: 'quiz', comp: 'q2', ok: true, attempts: 1, at: T0 + 2 * min },          // 想了很久才选对：不算白停
  { id: 'e3', session: 'c-1', src: 'record', kind: 'answer', type: 'conjecture', comp: 'cj1', text: '因为列向量都能被 A 的列表示', at: T0 + 4 * min },
  { id: 'e4', session: 'c-1', src: 'say', text: '这一步为什么？', at: T0 + 5 * min },
  { id: 'e9', session: 'c-2', src: 'say', text: '别的课的', at: T0 },
];
const a = auditLesson({ session: { id: 'c-1', kind: 'class', title: '秩', space: 'math' }, turns, evidence });

test('老师的字不数 memo 块和空白', () => assert.equal(teacherChars(turns[0], 'class'), '先看定义。秩是极大无关组里向量的个数。'.length));
test('只数这节课的证据；10 秒选对的才是白停', () => assert.deepEqual([a.stops.total, a.stops.wasted], [2, 1]));
test('第一次要想的产出在第 4 分钟；自己问了一次；自由作答一次', () => assert.deepEqual([a.produce.firstMin, a.asks.self, a.open.count], [4, 1, 1]));
test('等老师的平均秒数', () => assert.deepEqual([a.teacher.firstS, a.teacher.writeS], [6, 7.5]));
test('没有证据、没记花费的课不出 NaN', () => {
  const b = auditLesson({ session: { id: 'c-3', kind: 'stage' }, turns: [{ seq: 1, role: 'claude', at: T0, text: 'say "你好"' }], evidence: [] });
  assert.equal(JSON.stringify(b).includes('NaN'), false);
  assert.deepEqual([b.teacher.firstS, b.produce.firstMin, b.stops.total], [null, null, 0]);
});
test('舞台课老师的字数引号里的', () => assert.equal(teacherChars({ text: 'say "从 {a.1} 往后数"\nopen a\nask tap a "哪个？"' }, 'stage'), '从□往后数'.length + '哪个？'.length));
test('分类', () => {
  assert.equal(isClosedEv({ type: 'tap' }), true);
  assert.equal(isProduceEv({ src: 'say', text: '短' }), false);
  assert.equal(isSelfAsk({ src: 'say', text: '[指着问] 第二步——为什么？' }), true);
});
test('真数据的写法：类型放在 kind 里也认', () => {
  assert.equal(isClosedEv({ src: 'record', kind: 'quiz' }), true);
  assert.equal(isClosedEv({ src: 'event', kind: 'stage-pick' }), true);
  assert.equal(isClosedEv({ src: 'record', kind: 'steps', value: 'x', text: null }), true);
  assert.equal(isClosedEv({ src: 'record', kind: 'steps', value: 'x', text: '写了一段' }), false);
  assert.equal(isProduceEv({ src: 'record', kind: 'parse', ok: false }), true);
  assert.equal(isProduceEv({ src: 'event', kind: 'stage-dial' }), false);
});

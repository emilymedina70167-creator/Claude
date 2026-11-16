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

// ---- 第二轮：对着真证据的样子改的 ----
test('舞台记录分三种：挑战和点一下是封闭的停、不算产出；填的答案又是停又是产出', () => {
  const goal = { src: 'record', kind: 'stage', ok: true, text: 'g1', value: 'goal' };
  const tap = { src: 'record', kind: 'stage', ok: true, text: 'r.7', value: 'for' };
  const typed = { src: 'record', kind: 'stage', ok: true, text: 'has been', value: 'has been' };
  assert.deepEqual([goal, tap, typed].map(isClosedEv), [true, true, false]);
  assert.deepEqual([goal, tap, typed].map(isProduceEv), [false, false, true]);
  const ev = (x, i) => ({ id: `s${i}`, session: 'c-5', at: T0 + i * 20_000, ...x });
  const b = auditLesson({ session: { id: 'c-5', kind: 'stage' }, turns: [{ seq: 1, role: 'claude', at: T0, text: 'say "好"' }], evidence: [goal, tap, typed].map(ev) });
  assert.deepEqual(b.stops.byKind, { goal: 1, tap: 1, value: 1 });
  assert.equal(b.stops.total, 3);
  assert.equal(b.produce.count, 1);
  assert.equal(b.produce.firstMin, 0.7);
});
test('拨盘、接着、标注不算停也不算产出；同一轮已有舞台记录时 tap / pick 动作不另算', () => {
  const evs = [
    { id: 'a', session: 'c-6', src: 'event', kind: 'stage-dial', at: T0 + 1000 },
    { id: 'b', session: 'c-6', src: 'event', kind: 'stage-next', at: T0 + 2000 },
    { id: 'c', session: 'c-6', src: 'event', kind: 'stage-mark', at: T0 + 3000 },
    { id: 'd', session: 'c-6', src: 'event', kind: 'stage-tap', turn: 4, at: T0 + 40_000 },
    { id: 'e', session: 'c-6', src: 'record', kind: 'stage', text: 'r.7', value: 'x', ok: true, turn: 4, at: T0 + 40_001 },
    { id: 'f', session: 'c-6', src: 'event', kind: 'stage-pick', turn: 9, at: T0 + 90_000 },
  ];
  const b = auditLesson({ session: { id: 'c-6', kind: 'stage' }, turns: [], evidence: evs });
  assert.deepEqual([b.stops.total, b.produce.count], [2, 0]);
});
test('没有 kind 的课按黑板课量，talk 也量', () => {
  const t = [{ seq: 1, role: 'claude', at: T0, text: '你好啊同学' }, { seq: 2, role: 'claude', at: T0 + min, text: '再见' }];
  assert.equal(auditLesson({ session: { id: 'c-7' }, turns: t, evidence: [] }).kind, 'class');
  const k = auditLesson({ session: { id: 'c-8', kind: 'talk' }, turns: t, evidence: [] });
  assert.deepEqual([k.kind, k.teacher.chars], ['talk', 7]);
});
test('黑板课有 ms 时白停看 ms，不看离上一件事多久', () => {
  const mk = (id, ms, at) => ({ id, session: 'c-9', src: 'record', kind: 'quiz', ok: true, attempts: 1, wrong: [], ms, at });
  const b = auditLesson({ session: { id: 'c-9', kind: 'class' }, turns: [{ seq: 1, role: 'claude', at: T0, text: 'x' }],
    evidence: [mk('q1', 8000, T0 + 10 * 60_000 / 60 * 6), mk('q2', 90_000, T0 + 2 * min), mk('q3', 5000, T0 + 2 * min + 5000)] });
  assert.deepEqual([b.stops.total, b.stops.wasted], [3, 2]);
});
test('产出花的时间用 ms 合计', () => {
  const b = auditLesson({ session: { id: 'c-10', kind: 'class' }, turns: [], evidence: [
    { id: 'p1', session: 'c-10', src: 'record', kind: 'conjecture', ok: null, ms: 60_000, text: '想了', at: T0 },
    { id: 'p2', session: 'c-10', src: 'record', kind: 'parse', ok: false, ms: 30_000, at: T0 + min }] });
  assert.equal(b.produce.minutes, 1.5);
});

test('课后目标和测验结果来自报告与课文档', () => {
 const aims = [{ id: 'a1', can: '计算缺页次数' }], later = { n: 2, right: 1, days: 1, far: { n: 1, right: 0 } };
 assert.deepEqual(auditLesson({ session: { aims, later } }).aims, aims);
 assert.deepEqual(auditLesson({ session: { aims, later } }).later, later);
 const report = { aims: [{ ...aims[0], status: 'solo', n: 2 }] };
 assert.deepEqual(auditLesson({ session: { aims }, report }).aims, report.aims);
});

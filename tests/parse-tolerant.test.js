// 句子成分标注的可选写法（第三批）：标不标都行的段、另一种也算对的范围、给主讲看的「错在哪」、带成分名的反馈档、生词表全展开
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBrackets, judgeSpans, spansHint, spansDiff, parseAlso, spansMarkup, parseGloss, roleName } from '../kit/src/entext.js';

const A = () => parseBrackets('After the meeting, [S the manager] [A? quickly] [V changed] [O the plan].');
const idx = (ans, w) => ans.tokens.findIndex((t) => t.w === w);
const sp = (ans, role, a, b) => ({ role, from: idx(ans, a), to: idx(ans, b ?? a) });

test('[A? …]：这一段标不标都行；标了范围、成分要对', () => {
  const ans = A();
  assert.equal(ans.spans.find((s) => s.role === 'A').opt, true);
  assert.equal(ans.text, 'After the meeting, the manager quickly changed the plan.');
  const base = [{ role: 'S', from: idx(ans, 'manager') - 1, to: idx(ans, 'manager') }, sp(ans, 'V', 'changed'), { role: 'O', from: idx(ans, 'plan') - 1, to: idx(ans, 'plan') }];
  assert.equal(judgeSpans(base, ans.spans).ok, true, '没标 quickly 也对');
  assert.equal(judgeSpans([...base, sp(ans, 'A', 'quickly')], ans.spans).ok, true, '标了也对');
  const r = judgeSpans([...base, sp(ans, 'P', 'quickly')], ans.spans);
  assert.equal(r.ok, false); assert.equal(r.wrongRole.length, 1);
  assert.match(spansMarkup(ans.tokens, ans.spans), /\[A\? quickly\]/, '写回括号时带着 ?');
});

test('不写 ? 的照旧：少标一段算少', () => {
  const ans = parseBrackets('[S Tom] [V runs] [A fast].');
  const r = judgeSpans([{ role: 'S', from: 0, to: 0 }, { role: 'V', from: 1, to: 1 }], ans.spans);
  assert.equal(r.ok, false); assert.equal(r.missing.length, 1);
});

test('also：另一种范围也算对', () => {
  const ans = parseBrackets('[S It] [V is] [P still a difficult task].');
  parseAlso('[P a difficult task]', ans);
  const head = [{ role: 'S', from: 0, to: 0 }, { role: 'V', from: 1, to: 1 }];
  assert.equal(judgeSpans([...head, { role: 'P', from: 2, to: 5 }], ans.spans).ok, true);
  assert.equal(judgeSpans([...head, { role: 'P', from: 3, to: 5 }], ans.spans).ok, true);
  assert.equal(judgeSpans([...head, { role: 'P', from: 4, to: 5 }], ans.spans).ok, false);
  assert.equal(judgeSpans([...head, { role: 'O', from: 3, to: 5 }], ans.spans).wrongRole.length, 1, '范围是另一种、成分标错');
});

test('also 写错了报出来', () => {
  const ans = parseBrackets('[S It] [V is] [P still a difficult task].');
  assert.throws(() => parseAlso('[P an easy task]', ans), /also.*找不到/);
  assert.throws(() => parseAlso('[O a difficult task]', ans), /also.*没有.*宾语/);
  assert.throws(() => parseAlso('a difficult task', ans), /also.*\[成分 词…\]/);
});

test('给主讲看的「错在哪」：多圈、少圈、没标、标错成分', () => {
  const ans = A();
  const mine = [{ role: 'S', from: idx(ans, 'manager') - 1, to: idx(ans, 'quickly') }, sp(ans, 'P', 'changed'), { role: 'O', from: idx(ans, 'plan'), to: idx(ans, 'plan') }, sp(ans, 'A', 'After', 'meeting')];
  const d = spansDiff(judgeSpans(mine, ans.spans), ans.tokens, ans.spans);
  assert.match(d, /「changed」标成了表语，应是谓语/);
  assert.match(d, /主语：标了「the manager quickly」，多圈了 quickly/);
  assert.match(d, /宾语：标了「plan」，少圈了 the/);
  assert.match(d, /多标了一段：状语「After the meeting」/);
  assert.doesNotMatch(d, /没标：(主语|宾语)/, '已经说过多圈少圈的不再说没标');
  const d2 = spansDiff(judgeSpans([sp(ans, 'V', 'changed')], ans.spans), ans.tokens, ans.spans);
  assert.match(d2, /没标：主语「the manager」/); assert.doesNotMatch(d2, /quickly/, '标不标都行的不算没标');
  assert.equal(spansDiff(judgeSpans([], []), [], []), '');
});

test('反馈档 role：给学生的话带上是哪个成分，不给范围、不给答案；不写档位和原来一字不差', () => {
  const ans = parseBrackets('[S Tom] [V runs] [A fast].');
  const r = judgeSpans([{ role: 'S', from: 0, to: 1 }, { role: 'V', from: 1, to: 1 }], ans.spans);
  assert.equal(spansHint(r, []), '对了 1 处；1 处范围不对；还少 2 处');
  assert.equal(spansHint(r, [], { level: 'role' }), '对了 1 处；1 处范围不对（主语）；还少 2 处（主语、状语）');
  assert.doesNotMatch(spansHint(r, [], { level: 'role' }), /Tom|fast/);
});

test('划掉：成分 X', () => {
  assert.equal(roleName('X'), '划掉');
  const ans = parseBrackets('[S The idea] [X of freedom] [V spread].');
  assert.equal(ans.spans.find((s) => s.role === 'X').from, 2);
});

test('生词表：show: all 是全展开的开关，不当成词条；别的行照旧', () => {
  const g = parseGloss('show: all\nmeeting = 会议\nshow = 展示');
  assert.equal(g.showAll, true);
  assert.deepEqual(g.items.map((x) => x.word), ['meeting', 'show']);
  assert.deepEqual(g.problems, []);
  assert.equal(!!parseGloss('meeting = 会议').showAll, false);
  assert.deepEqual(parseGloss('show: 展示').items, [{ word: 'show', gloss: '展示' }], '只有 show: all 才是开关');
});

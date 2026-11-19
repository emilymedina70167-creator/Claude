// 检验画面那一批的复查修正（计划 4 Task 9）：构造题的 notes 存在流程的结果上（交了的要点的 why 不当 notes）、
// trace 表下面那几格单独放（JSON 存一遍判得一样）、parse 范围不对的那一段不再算「多标了」
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck, parseProbe, traceTable } from '../kit/src/check/spec.js';
import { createFlow, step } from '../kit/src/check/flow.js';
import { judgeMachine } from '../kit/src/check/judge.js';
import { answerSummary } from '../kit/src/check/record.js';

const F = '```';
const P = (type, src) => { const r = parseProbe(type, src.trim()); if (r.error) throw new Error(r.error); return r.probe; };
let t = 0;
const go = (s, ev) => step(s, { at: (t += 1000), ...ev });

const SHELL = (id, retry = []) => `${F}construct
id: ${id}
q: 造 8 个数，希尔（4 2 1）不稳定${id}
target: 希尔排序不稳定
level: 核心
slots: A=seq(8) P=seq(2)
run r: sort algo=shell gaps="4 2 1" array=A
if: r.unstable >= 1 => 还是稳定的
if: P in r.flipped => 这一对没换先后
example: A=4 7 4 1 2 5 7 8 P=4 4'
teach if1: 分在不同的组。
${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const REC = (id, retry = []) => `${F}recall\nid: ${id}\nq: 写${id}\ntarget: T-p2\nlevel: 核心\nmust m1: 要点\nteach default: 先想。\n${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;

test('构造题机器判的 notes 存在这道题的结果上；交给页面里的 Claude 判、对了的要点带着 why 也不成 notes', () => {
  const { check, errors } = parseCheck('check id=k1', ['block DS-L8.2.3 must=p1,p2', SHELL('p1', ['p1a', 'p1b']), SHELL('p1a'), SHELL('p1b'), REC('p2', ['p2a', 'p2b']), REC('p2a'), REC('p2b')].join('\n'));
  assert.deepEqual(errors, []);
  let s = go(createFlow(check), { type: 'start' });
  const m = judgeMachine(check.probes.p1, { slots: { A: '49 38 65 97 76 13 27 49', P: '49 49' } });
  assert.deepEqual(m.notes, ['页面把第二个 49 记成 49′']);
  s = go(s, { type: 'submit', id: 'p1', answer: {}, sure: 'sure', ms: 1000, machine: m });
  assert.deepEqual(s.results.p1.notes, ['页面把第二个 49 记成 49′']);
  // 存进 JSON 再读回来也在（接着做、刷新以后的教一屏照样写）
  assert.deepEqual(JSON.parse(JSON.stringify(s)).results.p1.notes, ['页面把第二个 49 记成 49′']);
  // 先把 p1 的补讲、同类题走完：同类题都做对
  s = go(s, { type: 'teachSeen', id: 'p1' });
  const ok = judgeMachine(check.probes.p1a, { slots: { A: '4 7 4 1 2 5 7 8', P: '4 4' } });
  s = go(s, { type: 'submit', id: 'p1a', answer: {}, sure: 'sure', ms: 1000, machine: ok });
  if (s.results.p1b && !s.results.p1b.submitted && s.cur?.id === 'p1b') s = go(s, { type: 'submit', id: 'p1b', answer: {}, sure: 'sure', ms: 1000, machine: ok });
  // recall：要点交给 Claude 判，回来一条对了还带着 why 的
  for (let i = 0; i < 4 && s.cur?.id !== 'p2'; i++) s = go(s, { type: 'teachSeen', id: s.teaching?.id });
  assert.equal(s.cur?.id, 'p2');
  s = go(s, { type: 'submit', id: 'p2', answer: { text: '写了' }, sure: 'sure', ms: 1000, machine: { items: [], needsClaude: true, stop: false } });
  s = go(s, { type: 'verdict', id: 'p2', items: [{ id: 'm1', ok: true, why: '写到了 AB 和 BA 分开' }], judgedBy: 'claude' });
  assert.equal(s.results.p2.notes, undefined);
});

test('trace：表下面那几格写在 answer.extra，存进 JSON 再读回来判得一样；以前挂在 cells 上的照旧认', () => {
  const h = P('trace', 'id: h1\ntarget: 线性探测\nlevel: 基础\nuse: hash\nhash: 1 12 23\nsize: 11\np: 11');
  const { table } = traceTable(h);
  const cells = table.rows.map((r) => r.cells.map((c) => String([].concat(c.v)[0] ?? '')));
  const answer = { cells, extra: ['2', '1.5'] };
  const before = judgeMachine(h, answer);
  const after = judgeMachine(h, JSON.parse(JSON.stringify(answer)));
  assert.deepEqual(after, before);
  assert.deepEqual(after.items.filter((x) => /^x/.test(x.id)).map((x) => [x.id, x.ok]), [['x1', true], ['x2', false]]);
  // 以前的样子（extra 挂在数组上）
  const old = judgeMachine(h, { cells: Object.assign(cells.map((x) => x.slice()), { extra: ['2', '1.5'] }) });
  assert.deepEqual(old.items.map((x) => [x.id, x.ok]), before.items.map((x) => [x.id, x.ok]));
  assert.match(answerSummary(h, answer), /表下面：2 \| 1\.5/);
});

test('parse：谓语只标了 were → 只有一项 V「谓语的范围不对」，没有「多标了」', () => {
  const p = P('parse', 'id: p1\nq: 标主语、谓语\nkey: [S The houses] [V were painted] in 1990.\ntarget: 被动谓语\nlevel: 方法\nteach V: be + 过去分词一起标。');
  const r = judgeMachine(p, { spans: [{ role: 'S', from: 0, to: 1 }, { role: 'V', from: 2, to: 2 }] });
  assert.deepEqual(r.items.map((x) => [x.id, x.ok]), [['S', true], ['V', 'missing']]);
  assert.match(r.items[1].why, /^谓语的范围不对：标了「were」/);
  assert.equal(r.stop, true);
  // 另外真多标了一段的照旧列
  const r2 = judgeMachine(p, { spans: [{ role: 'S', from: 0, to: 1 }, { role: 'V', from: 2, to: 2 }, { role: 'O', from: 4, to: 5 }] });
  assert.match(r2.items.find((x) => x.id === 'extra').why, /多标了：「in 1990」/);
  assert.doesNotMatch(r2.items.find((x) => x.id === 'extra').why, /were/);
});

// dr-plan4-fix 复查以后的修正：
//   1 trace 靠并列定的那一步：写了的格不说「应该是」、不标红，只说空着的
//   2 predict 的诊断一份实现（spec.js 的 diagnosesOf）：自检报撞车的、判的时候记 tags 的是同一批
//   5 trace 的 disk：algorithm: 写的 C-SCAN 也要写 jump
//   6 round# 用在没写 algo 的 sort 上：自检报出来，不是判的时候待核
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProbe, probeIssues, traceTable, diagnosesOf } from '../kit/src/check/spec.js';
import * as judge from '../kit/src/check/judge.js';
import { ENGINES } from '../kit/src/engines/registry.js';

const { judgeMachine, traceReview } = judge;
const P = (type, src) => { const r = parseProbe(type, src.trim()); assert.equal(r.error, undefined, r.error); return r.probe; };
const item = (r, id) => r.items.find((x) => x.id === id);

// —— 1 ——

test('OPT 第 4 次访问有并列、块 2 空着：不说「你写的 3，应该是 2」，只标空着的那格；照样没过', () => {
  const o = P('trace', 'id: o\ntarget: OPT\nlevel: 方法\nuse: paging\nalgo: opt\nrefs: 1 2 3 4 5 1\nframes: 3');
  const T = traceTable(o);
  assert.ok(T.ties.includes(3), JSON.stringify(T.ties));
  const rows = T.table.rows.map((r) => r.cells.map((c) => String([].concat(c.v)[0] ?? '')));
  rows[3] = ['1', '', '4', '√', '3'];
  const r = judgeMachine(o, { cells: rows });
  const it = item(r, 'r4');
  assert.equal(it.ok, false);
  assert.match(it.why, /^这一步有并列；/);
  assert.match(it.why, /还空着/);
  assert.doesNotMatch(it.why, /应该是/);
  assert.doesNotMatch(it.why, /你写的/);
  assert.deepEqual([...traceReview(o, { cells: rows }).bad], ['3:1']);
  // 没有并列的行照旧说「应该是」
  const ok = T.table.rows.map((x) => x.cells.map((c) => String([].concat(c.v)[0] ?? '')));
  ok[1] = ['1', '3', '', '√', ''];
  assert.match(item(judgeMachine(o, { cells: ok }), 'r2').why, /应该是/);
});

// —— 2 ——

const LRU = '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1';
const COLLIDE = () => P('predict', `
id: p2
q: 缺页几次
target: LRU
level: 方法
run r: paging algo=lru frames=3 refs="${LRU}"
expect 缺页次数: r.faults
wrong w1: r.faults - 3 => 一开始调入的 3 次没算缺页
teach default: 往前数最久没用的。`);

test('诊断一份实现：judge.js 不再自己有一份；自检报撞车的和判 9 时记的 tags 是同一批', () => {
  assert.equal(judge.predictDiagnoses, undefined);
  assert.equal(judge.diagnosesOf, undefined);
  const src = readFileSync(new URL('../kit/src/check/judge.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /function (diagnosesOf|variantVars)\b/);
  const p = COLLIDE();
  const tags = item(judgeMachine(p, { expects: { x1: '9' } }), 'x1').tags;
  assert.ok(tags.length >= 2, JSON.stringify(tags));
  const msg = probeIssues(p).redraw.find((m) => /^x1 上 .* 的答案一样/.test(m));
  assert.ok(msg, JSON.stringify(probeIssues(p)));
  const keys = /^x1 上 (.*?) 的答案一样/.exec(msg)[1].split(/、| 和 /);
  assert.deepEqual([...keys].sort(), [...tags].sort());
  assert.equal(keys[0], 'w1'); // 话里外部写的在前
  // 共用的那一份直接调：和判的时候一样，答案 9 的就是 tags 那几个
  const nine = diagnosesOf(p, p.expects[0], 12, { r__faults: 12 }).filter((d) => d.value === 9).map((d) => d.key);
  assert.deepEqual(nine.sort(), [...tags].sort());
});

// —— 5 ——

test('trace 的 disk：写成 algorithm: cscan 也要写 jump（和 run 行的检查一样认两种写法）', () => {
  const src = (k) => `id: d1\ntarget: C-SCAN\nlevel: 方法\nuse: disk\n${k}: cscan\nhead: 50\nrequests: 40 60 100`;
  const msgs = (k) => { const r = parseProbe('trace', src(k)); return r.error ? [r.error] : [...probeIssues(r.probe).hard, ...probeIssues(r.probe).redraw]; };
  assert.ok(msgs('algo').some((m) => /jump/.test(m)), msgs('algo').join('\n'));
  // 现在的 disk 引擎只读 algo:（algorithm 只写会先报字段读不懂）：换一个也认 algorithm 的引擎，看检查本身读不读它
  const orig = ENGINES.disk;
  ENGINES.disk = { ...orig, parse: (f, ...rest) => orig.parse({ ...f, algo: f.algo ?? f.algorithm }, ...rest) };
  try {
    assert.ok(msgs('algorithm').some((m) => /jump/.test(m) && /cscan/.test(m)), msgs('algorithm').join('\n'));
  } finally { ENGINES.disk = orig; }
});

// —— 6 ——

test('round# 用在没写 algo 的 sort 上：自检说要写 algo: quick', () => {
  const p = P('predict', 'id: p1\ntarget: x\nlevel: 方法\nrun r: sort array="5 3 1 4 2"\nexpect 第一趟: r.round1\nteach default: x');
  const { hard } = probeIssues(p);
  assert.ok(hard.some((m) => /round# 只有快排有：写 algo: quick/.test(m)), hard.join('\n'));
  // 写了快排不报；写了别的排序照旧报
  assert.deepEqual(probeIssues(P('predict', 'id: p1\ntarget: x\nlevel: 方法\nrun r: sort algo=quick array="5 3 1 4 2"\nexpect 第一趟: r.round1\nteach default: x')).hard, []);
  assert.ok(probeIssues(P('predict', 'id: p1\ntarget: x\nlevel: 方法\nrun r: sort algo=bubble array="5 3 1 4 2"\nexpect 第一趟: r.round1\nteach default: x')).hard.some((m) => /只有快排有/.test(m)));
});

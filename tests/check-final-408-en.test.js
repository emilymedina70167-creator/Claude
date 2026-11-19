// 计划 4（408、英语的检验题）整条分支最后一次审查查出来的几处（一处一条）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProbe, parseCheck, probeProblems, runVars } from '../kit/src/check/spec.js';
import { judgeMachine } from '../kit/src/check/judge.js';
import { errorEntries } from '../kit/src/check/record.js';
import { measure, sortPass } from '../kit/src/engines/measures.js';

const P = (type, src) => { const r = parseProbe(type, src.trim()); if (r.error) throw new Error(r.error); return r.probe; };
const E = (type, src) => parseProbe(type, src.trim()).error;
const item = (r, id) => r.items.find((x) => x.id === id);
const row = (s) => s.split(' ');

// —— 1. construct 408 的 expr 用到 run 的量：照学生这组数跑出来的值判 ——
test('审 1：construct 408 的 expr 写 r.cmp：自检过、学生写对是 true、写错是 false', () => {
  const p = P('construct', `
id: p1
q: 造 4 个数，直接插入排序比较次数不少于 3，再写出比较次数
target: 比较次数
level: 核心
slots: A=seq(4)
run r: sort algo=insert array=A
if: r.cmp >= 3
expr 比较次数: r.cmp
example: A=4 3 2 1`);
  assert.deepEqual(probeProblems(p), []);
  const cmp = measure('sort', { algo: 'insert', array: '4 3 2 1' }).values.cmp;
  assert.equal(cmp, 9);
  const ok = judgeMachine(p, { slots: { A: '4 3 2 1' }, exprs: { e1: String(cmp) } });
  assert.deepEqual(ok.items.map((x) => [x.id, x.ok]), [['if1', true], ['e1', true]]);
  const bad = judgeMachine(p, { slots: { A: '4 3 2 1' }, exprs: { e1: '0' } });
  assert.equal(item(bad, 'e1').ok, false);
  assert.equal(item(bad, 'e1').why, '比较次数不对');
  // 换一组数，对的值跟着变
  const c2 = measure('sort', { algo: 'insert', array: '1 2 4 3' }).values.cmp;
  assert.notEqual(c2, cmp);
  assert.equal(item(judgeMachine(p, { slots: { A: '1 2 4 3' }, exprs: { e1: String(c2) } }), 'e1').ok, true);
  assert.equal(item(judgeMachine(p, { slots: { A: '1 2 4 3' }, exprs: { e1: '' } }), 'e1').ok, false);
});

// —— 2. rewrite 只写 not: ——
test('审 2：rewrite 只写 not: 没有 must 不收；写了 must 收下，乱写的不算过（交页面里的 Claude）', () => {
  const head = 'id: p1\nq: 改成被动语态\ntarget: 被动\nlevel: 基础\ntext: They wrote the letter.\nnot: wrote => 被动语态的谓语是 be + 过去分词\nexample: The letter was written.';
  assert.equal(E('rewrite', head), 'p1：rewrite 至少写一条 has:（要出现的写法）；只写 not: 时要写 must');
  const p = P('rewrite', `${head}\nmust: 用了 be + 过去分词`);
  const r = judgeMachine(p, { text: 'asdf' });
  assert.equal(r.needsClaude, true);
  assert.ok(r.items.every((x) => x.ok !== false));
  // 写了 has: 的照旧收
  assert.equal(E('rewrite', `${head}\nhas: was written => 要用 was written`), undefined);
});

// —— 3. trace：两个数写反不当成错法 ——
const SH = P('trace', `
id: p1
q: 希尔排序
target: 希尔排序分组
level: 方法
use: sort
algo: shell
array: 49 38 65 97 76 13 27 50
gaps: 4 2 1`);
const g = { gaps: [4, 2, 1] };
const carry = (r1) => { const c2 = sortPass('shell', r1.map(Number), 2, g); return [r1, c2.map(String), sortPass('shell', c2, 3, g).map(String)]; };
const R1 = '49 13 27 50 76 38 65 97';

test('审 3：第 1 趟两个数写反、后面按它推都对：tag 是 slip，不是 shellBlock', () => {
  for (const [i, j] of [[0, 1], [2, 6], [3, 7]]) {
    const r1 = row(R1);
    [r1[i], r1[j]] = [r1[j], r1[i]];
    const e = item(judgeMachine(SH, { cells: carry(r1) }), 'r1');
    assert.equal(e.ok, false);
    assert.equal(e.tag, 'slip', `换 ${i} ${j}`);
  }
  // 只填了第 1 趟（两个数写反）：也不说成 shellBlock
  const r1 = row(R1);
  [r1[0], r1[1]] = [r1[1], r1[0]];
  assert.equal(item(judgeMachine(SH, { cells: [r1, [], []] }), 'r1').tag, undefined);
});

test('审 3：真的照 shellBlock 做的照旧认出来（整行一样、或者这一行大半像错法）', () => {
  const full = judgeMachine(SH, { cells: [row('38 49 65 97 13 76 27 50'), row('38 49 65 97 13 27 50 76'), row('13 27 38 49 50 65 76 97')] });
  assert.equal(item(full, 'r1').tag, 'shellBlock');
  // 照错法做、中间又抄错一个数
  const near = judgeMachine(SH, { cells: [row('38 49 65 97 13 76 27 51'), [], []] });
  assert.equal(item(near, 'r1').tag, 'shellBlock');
});

// —— 4. translate 的 must 最多 3 条 ——
test('审 4：translate 的 must 最多 3 条', () => {
  const tr = 'id: p1\nq: 翻译\ntarget: 定语从句\nlevel: 基础\ntext: The man who called is here.';
  assert.equal(E('translate', `${tr}\nmust: 一\nmust: 二\nmust: 三`), undefined);
  assert.match(E('translate', `${tr}\nmust: 一\nmust: 二\nmust: 三\nmust: 四`), /must 最多 3 条（现在 4 条）/);
});

// —— 5. 接着核的行在错题本、ext_out 里写明是按上一行 ——
test('审 5：carried 的项写「（按你写的上一行）」', () => {
  const { check, errors } = parseCheck('check id=k1', ['block DS-L1.1 must=p1', '```trace', 'id: p1\nq: 希尔排序\ntarget: 希尔排序分组\nlevel: 方法\nuse: sort\nalgo: shell\narray: 49 38 65 97 76 13 27 50\ngaps: 4 2 1\nteach default: 一组一组做。', '```'].join('\n'));
  assert.ok(check, String(errors));
  const items = [{ id: 'r1', ok: false, why: '第 1 趟（d = 4）第 1 格不对' }, { id: 'r2', ok: false, carried: true, why: '第 2 趟（d = 2）按你写的上一行推也不对' }];
  const s = { check, results: { p1: { id: 'p1', submitted: true, final: 'fail', outcome: 'fail', items, answer: { cells: [] } } } };
  const [e] = errorEntries(s, check);
  assert.match(e.attrs.step, /r1 不对：第 1 趟/);
  assert.match(e.attrs.step, /r2 不对：（按你写的上一行）第 2 趟/);
});

// —— 6. 复杂度写法页面读不懂：自检报 ——
test('审 6：predict 的 expect / wrong、construct 的 expr 写成读不懂的 O(…)：自检报', () => {
  const pr = (v) => probeProblems(P('predict', `id: p1\nq: x\ntarget: t\nlevel: 核心\nrun r: sort algo=insert array="4 3 2 1"\nexpect 复杂度: ${v}\nwrong: O(n/2) => 少算了`));
  const msgs = pr('O(nlogn/2)');
  assert.ok(msgs.some((m) => /expect x1（复杂度）「O\(nlogn\/2\)」：复杂度写法页面读不懂/.test(m)));
  assert.ok(msgs.some((m) => /wrong w1「O\(n\/2\)」：复杂度写法页面读不懂/.test(m)));
  assert.ok(!pr('O(n log n)').some((m) => /expect x1/.test(m)));
  const c = P('construct', `id: p1\nq: x\ntarget: t\nlevel: 核心\nslots: A=seq(4)\nrun r: sort algo=insert array=A\nif: r.cmp >= 3\nexpr 复杂度: O(n/2)\nexample: A=4 3 2 1`);
  assert.ok(probeProblems(c).some((m) => /expr「复杂度」「O\(n\/2\)」：复杂度写法页面读不懂/.test(m)));
});

// —— 7. 不是引擎的原话的异常：待核，不判没过 ——
test('审 7：引擎不收照旧判没过；页面这边抛的 TypeError 每一条都待核', () => {
  const avl = P('construct', `id: q\ntarget: x\nlevel: 基础\nslots: S=seq(4)\nrun t: avl avl=S\nif: t.LR >= 1 => 没有 LR\nexample: S=3 1 2 4`);
  assert.equal(judgeMachine(avl, { slots: { S: '3 1 3 4' } }).items[0].ok, false);
  const broken = { ...avl, runs: [{ ...avl.runs[0], fields: Object.defineProperty({}, 'avl', { enumerable: true, get() { throw new TypeError('x is undefined'); } }) }] };
  const rv = runVars(broken, { S: '3 1 2 4' });
  assert.equal(rv.error.page, true);
  const r = judgeMachine(broken, { slots: { S: '3 1 2 4' } });
  assert.deepEqual(r.items, [{ id: 'if1', ok: null, why: '页面算不了：x is undefined' }]);
  assert.ok(r.items.every((x) => x.ok !== true && x.ok !== false));
});

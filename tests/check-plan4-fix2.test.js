// 计划 4 验收以后的修正（dr-plan4-fix 第 2、6 条和两条小的）：
// trace 没过的那一屏写清哪几格、写的什么、该是什么，并把交的表重画（traceReview 给出错的格、画淡的行）；
// 两份样板每一道 retry 的 must / teach 是这一道自己的；填表的数字键盘按整张表定
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProbe, parseCheck, selfCheck, traceTable } from '../kit/src/check/spec.js';
import { judgeMachine, traceReview } from '../kit/src/check/judge.js';
import { numericTable } from '../kit/src/check/spec.js';
import { sortPass } from '../kit/src/engines/measures.js';
import { DEV_CHECK_408_HEAD, DEV_CHECK_408_BODY, DEV_CHECK_EN_HEAD, DEV_CHECK_EN_BODY } from '../kit/src/check/devsample.js';

const P = (src) => { const r = parseProbe('trace', src.trim()); if (r.error) throw new Error(r.error); return r.probe; };
const row = (s) => s.split(' ');
const item = (r, id) => r.items.find((x) => x.id === id);
const SHELL = P('id: p1\ntarget: 希尔排序分组\nlevel: 方法\nuse: sort\nalgo: shell\narray: 49 38 65 97 76 13 27 49′\ngaps: 4 2 1');
const R1 = '49 13 27 49 76 38 65 97';
const R2 = '27 13 49 38 65 49 76 97';
const R3 = '13 27 38 49 49 65 76 97';
const OPT = P('id: o1\ntarget: OPT\nlevel: 方法\nuse: paging\nalgo: opt\nrefs: 1 2 3 4 1 2 5 1 2 3 4 5\nframes: 3\nrows: 9');
const OPT_ROWS = [
  ['1', '', '', '√', ''], ['1', '2', '', '√', ''], ['1', '2', '3', '√', ''], ['1', '2', '4', '√', '3'],
  ['1', '2', '4', '', ''], ['1', '2', '4', '', ''], ['1', '2', '5', '√', '4'], ['1', '2', '5', '', ''], ['1', '2', '5', '', ''],
];
const opt4 = (r4) => { const b = OPT_ROWS.map((r) => r.slice()); b[3] = r4; return judgeMachine(OPT, { cells: b }); };

test('笔误：哪几格、写的、该是的都说，再接「（后面按你自己的上一行推都对）」', () => {
  const bad1 = '49 13 27 49 76 38 97 65';
  const g = { gaps: [4, 2, 1] };
  const c2 = sortPass('shell', bad1.split(' ').map(Number), 2, g);
  const c3 = sortPass('shell', c2, 3, g);
  const r = judgeMachine(SHELL, { cells: [row(bad1), c2.map(String), c3.map(String)] });
  assert.equal(item(r, 'r1').tag, 'slip');
  assert.equal(item(r, 'r1').why, '第 1 趟（d = 4）第 7、8 格：你写的 97 65，应该是 65 97（后面按你自己的上一行推都对）');
});

test('不是笔误、只错一格：也写写的和该是的；空着的格另说「还空着」；整行空着「还空着」', () => {
  const one = judgeMachine(SHELL, { cells: [row('50 13 27 49 76 38 65 97'), row(R2), row(R3)] });
  assert.match(item(one, 'r1').why, /^第 1 趟（d = 4）第 1 格：你写的 50，应该是 49/);
  const mixed = judgeMachine(SHELL, { cells: [['49', '13', '27', '49′', '76', '38', '', '65'], row(R2), row(R3)] });
  assert.equal(item(mixed, 'r1').why, '第 1 趟（d = 4）第 8 格：你写的 65，应该是 97；第 7 格还空着');
  const empty = judgeMachine(SHELL, { cells: [row(R1), Array(8).fill(''), row(R3)] });
  assert.match(item(empty, 'r2').why, /^第 2 趟（d = 2）还空着/);
});

test('页框（一组不论先后）、打勾的格、横着的表：按格的名字说；打勾的说该不该打勾', () => {
  assert.equal(opt4(['1', '2', '3', '√', '4']).items.at(-1).why, '第 4 列「4」的「块 3」、「换出」：你写的 3 4，应该是 4 3');
  assert.equal(opt4(['1', '2', '4', '', '3']).items.at(-1).why, '第 4 列「4」的「缺页」该打勾');
  assert.equal(opt4(['1', '', '4', '√', '3']).items.at(-1).why, '第 4 列「4」的「块 2」还空着');
  // 页框里的数换了位置不算错
  assert.equal(opt4(['4', '1', '2', '√', '3']).items.every((x) => x.ok === true), true);
});

test('错法的标签（tag、tags、tagFit、「可能」）照旧接在写清了的话后面', () => {
  const r = judgeMachine(SHELL, { cells: [row('38 49 65 97 13 76 27 49'), row('38 49 65 97 13 27 49 76'), row(R3)] });
  const e = item(r, 'r1');
  assert.equal(e.tag, 'shellBlock');
  assert.match(e.why, /^第 1 趟（d = 4）第 1、2、3、4、5、6、7、8 格：你写的 38 49 65 97 13 76 27 49，应该是 49 13 27 49 76 38 65 97；像是把相邻的元素分成了一组/);
});

test('traceReview：错的格、按自己的上一行推对了的行（画淡）、按上一行推也不对的格；表下面错的格', () => {
  const bad1 = '49 13 27 49 76 38 97 65';
  const g = { gaps: [4, 2, 1] };
  const c2 = sortPass('shell', bad1.split(' ').map(Number), 2, g).map(String);
  const rv = traceReview(SHELL, { cells: [row(bad1), c2, row(R3)] });
  assert.deepEqual([...rv.bad], ['0:6', '0:7']);
  assert.deepEqual([...rv.faint], [1, 2]);
  assert.equal(rv.table.rows.length, 3);
  assert.deepEqual(rv.cells[0], row(bad1));
  // 第 2 趟按学生的第 1 趟推也不对：标出和「照上一行推」不一样的格，不画淡
  const c2bad = c2.slice(); [c2bad[0], c2bad[1]] = [c2bad[1], c2bad[0]];
  const rv2 = traceReview(SHELL, { cells: [row(bad1), c2bad, row(R3)] });
  assert.deepEqual([...rv2.bad], ['0:6', '0:7', '1:0', '1:1']);
  assert.equal(rv2.faint.has(1), false);
  // 新旧两种作答的样子：{ cells, extra } 和 cells.extra
  const h = P('id: h1\ntarget: 线性探测\nlevel: 基础\nuse: hash\nhash: 1 12 23\nsize: 11\np: 11');
  const right = traceTable(h).table.rows.map((r) => r.cells.map((c) => String([].concat(c.v)[0] ?? '')));
  assert.deepEqual([...traceReview(h, { cells: right, extra: ['2', '1.5'] }).badExtra], [1]);
  assert.deepEqual([...traceReview(h, { cells: Object.assign(right.map((x) => x.slice()), { extra: ['2', '1.5'] }) }).badExtra], [1]);
  assert.match(judgeMachine(h, { cells: right, extra: ['2', '1.5'] }).items.find((x) => x.id === 'x2').why, /^「ASL失败」不对：你写的 1\.5，应该是 /);
  // 不是 trace：null
  assert.equal(traceReview({ type: 'recall' }, {}), null);
});

test('数字键盘按整张表定：要填的格全是不带符号的整数才给；有 49′ 的排序、表下面那几格不算', () => {
  assert.equal(numericTable(traceTable(SHELL).table), false, '有 49′：整张表用默认键盘（一格一格定会露出 49′ 在哪）');
  assert.equal(numericTable(traceTable(P('id: s2\ntarget: x\nlevel: 方法\nuse: sort\nalgo: insert\narray: 3 1 2')).table), true);
  assert.equal(numericTable(traceTable(OPT).table), true);
  assert.equal(numericTable({ rows: [{ cells: [{ v: '-3' }, { v: '4' }] }] }), false, '负数打不出');
  assert.equal(numericTable({ rows: [{ cells: [{ v: 'A' }] }] }), false);
});

// —— 第 6 条：样板的内容 ——
const load = (head, body) => { const r = parseCheck(head, body); assert.deepEqual(r.errors, []); return r.check; };
const C408 = load(DEV_CHECK_408_HEAD, DEV_CHECK_408_BODY);
const CEN = load(DEV_CHECK_EN_HEAD, DEV_CHECK_EN_BODY);

test('样板改过以后照旧 parseCheck、selfCheck 干净', () => {
  assert.deepEqual(selfCheck(C408), []);
  assert.deepEqual(selfCheck(CEN), []);
});

test('英语样板钉住三处：p3b 的要点和补讲说的是 collected 是谓语；p4a、p4b 的 teach fix 是 write → written、break → broken', () => {
  const p3b = CEN.probes.p3b;
  assert.equal(p3b.answer, '谓语');
  assert.equal(p3b.must[0].text, '句中没有别的谓语，collected 是主语 students 的谓语（一般过去时）');
  assert.doesNotMatch(p3b.must[0].text, /另一个动词|后置定语/);
  assert.match(p3b.teach.pick, /collected/);
  assert.doesNotMatch(p3b.teach.pick, /定语/);
  assert.match(CEN.probes.p4a.teach.fix, /write 的过去分词是 written/);
  assert.match(CEN.probes.p4b.teach.fix, /break 的过去分词是 broken/);
  for (const id of ['p4a', 'p4b']) assert.doesNotMatch(CEN.probes[id].teach.fix, /know/);
});

// 照抄的毛病：一道题的要点、补讲、错说法里提到的英文词，都要在这道题自己的题面、句子、答案里出现（照抄别的题会带进别的句子的词）。
// 语法的虚词（be、was、which…）不算：它们是讲法里的话，不是哪一句的内容
const FUNC = new Set(['be', 'is', 'are', 'was', 'were', 'been', 'being', 'by', 'which', 'who', 'that', 'the', 'ed', 'not', 'to']);
const ownText = (p) => [p.q, p.text, p.claim, p.key, p.word, p.fix, p.answer, p.example, p.src?.match(/^(?:text|key|fix|word|example|has|not):.*$/gm)?.join('\n')].filter(Boolean).join('\n').toLowerCase();
const talk = (p) => [...(p.must || []), ...(p.may || []), ...(p.wrong || [])].map((x) => x.text).concat(Object.values(p.teach || {})).join('\n');

test('英语样板每一道（本题和 retry）：要点、补讲里的英文词都在这道题自己的句子里', () => {
  for (const [id, p] of Object.entries(CEN.probes)) {
    const own = ownText(p);
    for (const w of talk(p).match(/[A-Za-z]{2,}/g) || []) {
      if (FUNC.has(w.toLowerCase())) continue;
      assert.ok(new RegExp(`\\b${w.toLowerCase()}`).test(own), `${id} 的要点 / 补讲提到 ${w}，这道题里没有`);
    }
  }
});

test('408 样板每一道：要点、补讲里写的 d = N 是这道题自己的增量', () => {
  for (const [id, p] of Object.entries(C408.probes)) {
    const gaps = new Set(String(p.fields?.gaps ?? p.src?.match(/gaps="?([\d ]+)"?/)?.[1] ?? '').trim().split(/\s+/).filter(Boolean));
    const ds = [...talk(p).matchAll(/d = (\d+)/g)].map((m) => m[1]);
    // 讲希尔排序的道理时说「最后 d = 1」是通用的话：只要求不是 1 的增量是这道题的
    for (const d of ds.filter((x) => x !== '1')) assert.ok(gaps.has(d), `${id} 的补讲写了 d = ${d}，这道题的增量是 ${[...gaps].join(' ') || '（没有）'}`);
  }
});

test('点词的按钮（errfind、parse 的词）至少 44px 宽、44px 高', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../kit/src/styles.css', import.meta.url), 'utf8');
  const rule = css.match(/^\.en-word, \.pz-w \{([^}]*)\}/m)?.[1] || '';
  assert.match(rule, /min-width: 44px/);
  assert.match(rule, /min-height: 44px/);
});

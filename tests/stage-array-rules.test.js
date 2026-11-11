// 一排格子懂排序（kit/src/stage/types/array.sort.js、array.rules.js、array.js 的 sort 指令）：
// 每一趟的结果、常见错法和黑板那边的排序引擎（engines/sort.js）对拍；一下的粒度（直接插入、希尔、冒泡、简单选择）照 next 一路做到底
// 正好走过引擎的每一趟；判一下、事实、量、判断式、手势表；空格子；没写明排序的一排行为照旧；D1 那张「页面的毛病」单子里的几条
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript, parseRich } from '../kit/src/stage/script.js';
import { arrayRules as R, actSrc } from '../kit/src/stage/types/array.rules.js';
import { planOf, sortStatus, applyAct, rowOf, textsOf, inversions, badPairs, chainsText } from '../kit/src/stage/types/array.sort.js';
import { rulesOf, evalMeasure, measureShown, done } from '../kit/src/stage/rules.js';
import { gestureAct } from '../kit/src/stage/gestures.js';
import { hasWork, undoneOf } from '../kit/src/stage/events.js';
import { TYPES } from '../kit/src/stage/types/index.js';
import { parse, run as engineRun, variants, ALGOS } from '../kit/src/engines/sort.js';

const run = (s, src) => { for (const c of parseScript(src)) s.apply(c); return s; };
const make = (src) => run(new Scene(), src);
const one = (src) => parseScript(src)[0];
const A = (s, id = 'a') => s.objects.get(id);
const row = (s, id = 'a') => textsOf(A(s, id)).join(' ');
// 学生的一下（和 stage.js 的 exec 一样：先过裁判，被拦的不演）
function student(s, src, open = 'move') {
  const c = one(src);
  const j = s.judgeLine(c, { by: 'student', open });
  if (j && !j.apply) return { j, fx: { blocked: true } };
  const fx = s.apply(c, { by: 'student', judged: j ?? null, open });
  return { j, fx };
}
const WD = '49 38 65 97 76 13 27 49′ 55 04'; // 王道的例子
const eng = (algo, arr, gaps) => engineRun(parse({ algo, array: arr, ...(gaps ? { gaps } : {}) })).passes.map((p) => p.join(' '));
const nums = (texts) => texts.map((t) => String(Number(String(t).replace(/′/g, '')))).join(' ');

// —— 一趟的粒度：和引擎对拍 ——

test('七种排序：每一趟的结果和引擎一样（王道的例子），格子上的字照原样（49′ 和 49 分得开）', () => {
  const start = WD.split(' ');
  for (const algo of Object.keys(ALGOS)) {
    const p = planOf(algo, start, algo === 'shell' ? 5 : null);
    assert.deepEqual(p.passes.map(nums), eng(algo, WD.replace('′', "'"), algo === 'shell' ? '5' : undefined), algo);
    for (const x of p.passes) assert.deepEqual([...x].sort(), [...start].sort(), `${algo} 每一趟都是同一批牌`);
  }
  // 希尔 d = 5、3、1 三趟（每一趟从上一趟的结果起）：教材图 8.2
  const p5 = planOf('shell', start, 5).passes[0];
  assert.equal(p5.join(' '), '13 27 49′ 55 04 49 38 65 97 76');
  const p3 = planOf('shell', p5, 3).passes[0];
  assert.equal(p3.join(' '), '13 04 49′ 38 27 49 55 65 97 76');
  assert.equal(planOf('shell', p3, 1).passes[0].join(' '), '04 13 27 38 49′ 49 55 65 76 97');
  // 稳定的几种：49 一直在 49′ 前面；直接插入最后一趟
  assert.equal(planOf('insert', start).passes.at(-1).join(' '), '04 13 27 38 49 49′ 55 65 76 97');
  assert.equal(planOf('bubble', start).passes.at(-1).join(' '), '04 13 27 38 49 49′ 55 65 76 97');
  assert.equal(planOf('merge', start).passes.at(-1).join(' '), '04 13 27 38 49 49′ 55 65 76 97');
  // 快排第一次划分（王道：枢轴取第一个，填坑）
  assert.equal(planOf('quick', '49 38 65 97 76 13 27 49′'.split(' ')).passes[0].join(' '), '27 38 13 49 76 97 65 49′');
});

test('随机的一排（带重复的数）：七种排序每一趟的数和引擎一样，认得出每一趟结束时是哪几张牌', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let k = 0; k < 60; k++) {
    const n = 3 + rnd(8);
    const vals = Array.from({ length: n }, () => rnd(9) + 1);
    const seen = new Map();
    const texts = vals.map((v) => { const c = seen.get(v) || 0; seen.set(v, c + 1); return `${v}${'′'.repeat(c)}`; });
    for (const algo of Object.keys(ALGOS)) {
      const d = algo === 'shell' ? 1 + rnd(n - 1) : null;
      const p = planOf(algo, texts, d);
      const want = eng(algo, texts.join(' '), d ? String(d) : undefined);
      assert.deepEqual(p.passes.map(nums), want, `${algo} ${texts.join(' ')} d=${d}`);
      for (const x of p.passes) assert.deepEqual([...x].sort(), [...texts].sort());
    }
  }
});

test('计数照王道的代码数：直接插入 27 次后移（带哨兵比较 43 次），希尔 d=5 一趟比较 10 次、后移 5 次；5、3、1 三趟一共后移 12 次、比较 37 次', () => {
  const start = WD.split(' ');
  const ins = planOf('insert', start).counts;
  assert.equal(ins.length, 9);
  assert.equal(ins.reduce((n, c) => n + c.moves, 0), 27);
  assert.deepEqual(ins.map((c) => c.moves), [1, 0, 0, 1, 5, 5, 3, 3, 9]);
  assert.equal(ins.reduce((n, c) => n + c.cmp, 0), 43);
  let cur = start, moves = 0, cmp = 0;
  for (const d of [5, 3, 1]) { const p = planOf('shell', cur, d); moves += p.counts[0].moves; cmp += p.counts[0].cmp; cur = p.passes[0]; }
  assert.deepEqual([moves, cmp], [12, 37]);
  assert.deepEqual(planOf('shell', start, 5).counts, [{ cmp: 10, moves: 5 }]);
  assert.equal(planOf('bubble', start).counts, null, '数不准的不写');
});

// —— 一下的粒度：照 next 做到底 ——

// 照 next 给的第 pick 种做法一路做（0 是插过去 / 页面挑的那一下，1 是对调着往前换），返回走过的每一排
function follow(s, pick = 0, max = 300) {
  const seen = [row(s)];
  for (let i = 0; i < max; i++) {
    const o = A(s);
    const nx = R.next(o, s);
    if (nx === null) return seen;
    assert.ok(nx.acts.length, `算得出下一步：${nx.why}`);
    for (const a of nx.acts) assert.equal(R.check(o, a, s, { by: 'student' }).right, true, `next 给的 ${actSrc(o, a)} 要判对`);
    const act = nx.acts[Math.min(pick, nx.acts.length - 1)];
    const { j } = student(s, actSrc(o, act));
    assert.equal(j.verdict.right, true);
    seen.push(row(s));
  }
  throw new Error('没走到头');
}

test('直接插入：照 next 一张一张插，正好走过引擎的每一趟；对调着往前换也走得到同一个结果；做完了 next 是 null', () => {
  const s = make(`array a = ${WD}\nsort a insert\nopen a move`);
  const p = planOf('insert', WD.split(' '));
  const seen = follow(s, 0);
  // 每插一张就是一趟（不用动的那几趟引擎的结果和上一趟一样）
  assert.deepEqual(seen.slice(1), [...new Set(p.passes.map((x) => x.join(' ')))]);
  assert.equal(seen.at(-1), '04 13 27 38 49 49′ 55 65 76 97');
  assert.equal(done(s, 'a'), true);
  assert.equal(A(s).sort.moved, 27, '一共让了 27 格（正好是 27 对前大后小）');
  const t = make(`array a = ${WD}\nsort a insert\nopen a move`);
  const swaps = follow(t, 1);
  assert.equal(swaps.at(-1), seen.at(-1));
  assert.equal(swaps.length - 1, 27, '一步一格地换，27 下');
});

test('希尔的一趟（d = 5、3、1）：照 next 做完和引擎一样；各条链谁先谁后都算对；这一趟做完 next 是 null', () => {
  const s = make(`array a = ${WD}\nsort a shell d=5\nopen a move`);
  assert.equal(follow(s).at(-1), '13 27 49′ 55 04 49 38 65 97 76');
  run(s, 'sort a shell d=3');
  assert.equal(follow(s).at(-1), '13 04 49′ 38 27 49 55 65 97 76');
  run(s, 'sort a shell d=1');
  assert.equal(follow(s).at(-1), '04 13 27 38 49′ 49 55 65 76 97');
  // 先做最后一条链也对（王道的代码是交错着走的，学生一条链一条链做、倒着做都对）
  const t = make(`array a = ${WD}\nsort a shell d=5\nopen a move`);
  for (const src of ['swap a#10 a#5', 'swap a#9 a#4', 'move a#8 -> a.3 d=5', 'swap a#7 a#2']) assert.equal(student(t, src).j.verdict.right, true, src);
  assert.equal(R.next(A(t), t).acts.length, 2, '只剩第 1 条链');
  assert.equal(student(t, 'swap a#6 a#1').fx.done?.[0], 'a', '这一趟做完了');
  assert.equal(R.next(A(t), t), null);
  // 做完了再动：不是正确的下一步
  const again = R.check(A(t), { type: 'swap', a: 6, b: 1 }, t, { by: 'student' });
  assert.equal(again.right, false);
  assert.match(again.misread, /每条链都排好了/);
});

test('希尔 d = 3：链上要越过两张时，插过去（链上中间的各跳 3 格）和一步步对调都对', () => {
  const s = make('array a = 9 1 2 5 3 4 3′ 6 7\nsort a shell d=3\nopen a move');
  // 第 1 条链（第 1、4、7 格）：9 5 3′ → 5 先插到 9 前面
  const nx = R.next(A(s), s);
  assert.deepEqual(nx.acts.slice(0, 2), [{ type: 'move', key: 4, to: 1, d: 3 }, { type: 'swap', a: 4, b: 1 }]);
  student(s, 'swap a#4 a#1');
  assert.equal(row(s), '5 1 2 9 3 4 3′ 6 7');
  // 3′ 要越过 9、5：一下插过去
  const r = student(s, 'move a#7 -> a.1 d=3');
  assert.equal(r.j.verdict.right, true);
  assert.match(r.j.verdict.why, /3′ 从第 7 格挪到第 1 格，5、9 各往后跳 3 格/);
  assert.equal(row(s), '3′ 1 2 5 3 4 9 6 7');
  assert.equal(R.next(A(s), s), null);
});

test('冒泡（王道：从后往前，小的往前冒）：照 next 做到底，路上依次经过引擎的每一趟；从前往后沉的那一下认得出', () => {
  const s = make(`array a = ${WD}\nsort a bubble\nopen a`);
  const p = planOf('bubble', WD.split(' '));
  const seen = follow(s);
  let at = 0;
  for (const x of p.passes) { const k = seen.indexOf(x.join(' '), at); assert.ok(k >= at, `经过 ${x.join(' ')}`); at = k; }
  assert.equal(seen.at(-1), '04 13 27 38 49 49′ 55 65 76 97');
  // 第一下：第 9、10 格 55 > 04
  const t = make(`array a = ${WD}\nsort a bubble\nopen a`);
  assert.match(R.next(A(t), t).why, /第 9、10 格的 55 和 04 交换/);
  // 从前往后：第 1、2 格 49 > 38 先换
  const w = R.check(A(t), { type: 'swap', a: 1, b: 2 }, t, { by: 'student' });
  assert.equal(w.right, false);
  assert.match(w.misread, /从前往后冒泡/);
  assert.doesNotMatch(w.misread, /^像是/);
  // 隔着换：不对，认不出是哪种错
  assert.equal(R.check(A(t), { type: 'swap', a: 1, b: 6 }, t, { by: 'student' }).misread, null);
});

test('冒泡走到一半：照引擎的顺序接着带那一张往前冒（不是重新从最后扫）；被带着的那一张往前换都算对', () => {
  const s = make('array a = 4 3 1 2\nsort a bubble\nopen a');
  // 动作里 a 是前面那一张、b 是后面那一张（key：4 是 #1、3 是 #2、1 是 #3、2 是 #4）
  assert.deepEqual(R.next(A(s), s).acts[0], { type: 'swap', a: 2, b: 3 }, '3 和 1');
  student(s, 'swap a#3 a#2', 'drag');
  assert.equal(row(s), '4 1 3 2');
  const nx = R.next(A(s), s);
  assert.deepEqual(nx.acts[0], { type: 'swap', a: 1, b: 3 }, '接着把 1 冒到最前：4 和 1');
  assert.deepEqual(nx.acts.slice(1), [{ type: 'swap', a: 2, b: 4 }], '从后面重新扫（3 和 2）也算对');
});

test('简单选择：每一下是一趟（最小的和第 i 个交换），和引擎一趟一趟对得上；选最大的、把最小的插到前面认得出', () => {
  const s = make(`array a = ${WD}\nsort a select\nopen a`);
  const p = planOf('select', WD.split(' '));
  const seen = follow(s);
  assert.deepEqual(seen.slice(1), [...new Set(p.passes.map((x) => x.join(' ')))]);
  const t = make(`array a = ${WD}\nsort a select\nopen a move`);
  assert.match(R.next(A(t), t).why, /把最小的 04（第 10 格）和第 1 格的 49 交换（第 1 趟/);
  // 选最大的放到最后：97（第 4 格）和第 10 格换
  const mx = R.check(A(t), { type: 'swap', a: 4, b: 10 }, t, { by: 'student' });
  assert.equal(mx.right, false);
  assert.match(mx.misread, /每趟选最大的放到最后/);
  // 把最小的插到最前、别的往后让
  const sh = R.check(A(t), { type: 'move', key: 10, to: 1, d: 1 }, t, { by: 'student' });
  assert.equal(sh.right, false);
  assert.match(sh.misread, /依次往后挪了一格/);
});

// —— 判一下 ——

test('希尔：把不在一条链上的两张换了——挨着的（在引擎那种错法切出来的同一段里）说像是把相邻的当成一组，别的只写事实', () => {
  const s = make(`array a = ${WD}\nsort a shell d=5\nopen a move wrong=mark`);
  const near = student(s, 'swap a#2 a#1');
  assert.equal(near.j.verdict.right, false);
  assert.match(near.j.verdict.misread, /相邻的元素分成了一组/);
  assert.match(near.j.verdict.next.why, /第 1 条链（第 1、6 格）上的 38（第 6 格）插到第 1 格|第 \d 条链/);
  assert.equal(near.j.mark, true);
  assert.ok(near.j.after.some((f) => /出了自己那条链（第 2 条 → 第 1 条）/.test(f)), near.j.after.join('|'));
  const far = student(s, 'swap a#3 a#9');
  assert.equal(far.j.verdict.right, false);
  assert.equal(far.j.verdict.misread, null, '认不准的不说');
});

test('直接插入：越过了相等的那一张认得出（相等的不越过）；没轮到的先动了不算对', () => {
  const s = make('array a = 13 49 65 49′ 20\nsort a insert\nopen a move');
  // 该插的是 49′：停在 49 后面（第 3 格）
  assert.deepEqual(R.next(A(s), s).acts[0], { type: 'move', key: 4, to: 3, d: 1 });
  const over = R.check(A(s), { type: 'move', key: 4, to: 2, d: 1 }, s, { by: 'student' });
  assert.equal(over.right, false);
  assert.match(over.misread, /插到了和它相等的 49 前面/);
  // 20 还没轮到
  const early = R.check(A(s), { type: 'move', key: 5, to: 2, d: 1 }, s, { by: 'student' });
  assert.equal(early.right, false);
  assert.equal(early.misread, null);
  assert.match(early.next.why, /把 49′（第 4 格）插到第 3 格/);
});

test('老师自己的一步也核：不是正确的下一步写进事实（照演不拦）', () => {
  const s = make(`array a = ${WD}\nsort a shell d=5`);
  const fx = s.apply(one('swap a.2 a.3'), { by: 'teacher' });
  assert.equal(row(s), '49 65 38 97 76 13 27 49′ 55 04');
  assert.match(fx.judged.facts[0], /^你在 38 和 65 对调，第 2 格 ↔ 第 3 格，不在隔 5 的同一条链上，现在正确的是把第 1 条链/);
});

// —— 没写明排序：页面不猜 ——

test('没写 sort 的一排：不判对错、不多写事实，现状只多一行逆序对；next 说不出下一步，@a.done 写不进去', () => {
  const s = make(`array a = ${WD}\nopen a`);
  const r = student(s, 'swap a#6 a#1', 'drag');
  assert.equal(r.j.verdict.right, null);
  assert.equal(r.j.verdict.legal, true);
  assert.deepEqual(r.j.after, []);
  assert.equal(r.fx.done, undefined);
  assert.deepEqual(R.next(A(s), s).acts, []);
  assert.equal(done(s, 'a'), false);
  assert.match(s.check(one('@a.done say "x"')), /判不了 a：没写 a 在做哪种排序/);
  assert.match(s.check(one('@a.right say "x"')), /判不了 a/);
  assert.deepEqual(undoneOf(s), []);
  const st = s.stateText();
  assert.ok(st.includes('页面算的：inv(a) = 24'), st);
  assert.doesNotMatch(st, /在做|下一步/);
  // wrong= / call= 永远不生效：当场报，话里说怎么改
  assert.match(make(`array a = ${WD}`).check(one('open a wrong=block')), /没写在做哪种排序，页面判不了对错.*sort a insert/);
  assert.match(make(`array a = ${WD}`).check(one('open a move call=done')), /没写在做哪种排序/);
  assert.equal(make(`array a = ${WD}`).check(one('open a undo=on')), null);
});

test('只判到一趟的三种（快排、归并、基数）：学生的每一下不判对错；wrong=、@a.right 当场报，call=done、@a.done 能写；排好了算做完', () => {
  const s = make('array a = 3 1 2\nsort a quick\nopen a');
  assert.match(s.check(one('open a wrong=mark')), /快速排序，页面只判到一趟、不判学生的每一下，wrong= 用不上/);
  assert.equal(s.check(one('open a call=done')), null);
  assert.match(s.check(one('@a.right say "对"')), /每一下页面不判对错.*@a.right 的行不会演/);
  assert.equal(s.check(one('@a.done say "排好了"')), null);
  run(s, '@a.done say "排好了"');
  const r = student(s, 'swap a#1 a#3', 'drag');
  assert.equal(r.j.verdict.right, null);
  assert.equal(row(s), '2 1 3');
  // 学生手上还有事（规则交的是不判的动作，可学生做得了）
  assert.deepEqual(undoneOf(s), ['a']);
  // 等于第 1 次划分结束后的样子：写进事实
  assert.ok(r.j.after.some((f) => /现在等于第 1 次划分结束后的样子（一共 2 次划分）/.test(f)), r.j.after.join('|'));
  const fin = student(s, 'swap a#3 a#2', 'drag');
  assert.deepEqual(fin.fx.done, ['a']);
  assert.deepEqual(fin.fx.reactions.map((x) => x.src), ['say "排好了"']);
});

// —— 事实、现状 ——

test('学生每一下以后的事实：链排好几条、坏在哪几对、这一趟做完没有、一共让了几格；现状里写在做什么、下一步', () => {
  const s = make(`array a = ${WD}\nsort a shell d=5\nopen a move`);
  assert.match(s.stateText(), /页面算的：inv\(a\) = 27，bad\(a\) = 5，chains\(a\) = 0，moves\(a\) = 0；在做希尔排序 d = 5，从 49 38 65 97 76 13 27 49′ 55 04 起：这一趟还没做完；下一步：把第 1 条链（第 1、6 格）上的 13（第 6 格）插到第 1 格，49 往后跳 5 格（就是这两张对调）：它比同链前一张 49 小；另外还有 4 条链没排好，先做哪条都行/);
  const r = student(s, 'swap a#6 a#1');
  assert.deepEqual(r.j.after, ['隔 5 的 5 条链排好 1 条，没排好的：第 2 条 38>27；第 3 条 65>49′；第 4 条 97>55；第 5 条 76>04', '一共让了 1 格']);
  for (const src of ['swap a#7 a#2', 'swap a#8 a#3', 'swap a#9 a#4']) student(s, src);
  const fin = student(s, 'move a#10 -> a.5 d=5');
  assert.deepEqual(fin.j.after, ['隔 5 的 5 条链都递增', '这一趟做完了（和照王道的代码做一趟的结果一样：那样做比较 10 次、后移 5 次）', '一共让了 5 格']);
  assert.match(s.stateText(), /在做希尔排序 d = 5，从 [^：]+起：这一趟做完了/);
  // 直接插入：等于第几趟、照王道的代码这一趟比较 / 后移几次
  const t = make(`array a = ${WD}\nsort a insert\nopen a move`);
  const f = student(t, 'move a#2 -> a.1').j.after;
  assert.deepEqual(f, ['现在前大后小 26 对', '现在等于第 1～3 趟结束后的样子（后面这几趟不用动；一共 9 趟；照王道的代码这 3 趟一共比较 5 次、后移 1 次）', '一共让了 1 格']);
});

test('每条链都递增了、可有牌出了自己的链：照实说和照王道做一趟的结果不一样；相等的牌先后不一样也照实说', () => {
  // 13 和 27 换到对方的链上，各条链还是递增的
  const s = make('array a = 13 27 49′ 55 04 49 38 65 97 76\nsort a shell d=5\nopen a move');
  assert.equal(R.next(A(s), s), null);
  const t = make(`array a = ${WD}\nsort a shell d=5\nopen a move`);
  for (const src of ['swap a#6 a#1', 'swap a#7 a#2', 'swap a#8 a#3', 'swap a#9 a#4', 'swap a#10 a#5', 'swap a#6 a#7']) student(t, src);
  assert.equal(row(t), '27 13 49′ 55 04 49 38 65 97 76');
  const st = sortStatus(A(t), t);
  assert.equal(st.done, true);
  assert.equal(st.exact, false);
  assert.match(t.stateText(), /隔 5 的每条链都递增了，可和照王道的代码从 49 38 [^（]+做一趟的结果不一样（那是 13 27 49′ 55 04 49 38 65 97 76）/);
  // 直接插入排好了，可 49′ 跑到了 49 前面
  const u = make('array a = 49′ 49 65\nsort a insert');
  run(u, 'write a.1 49\nwrite a.2 49′');
  assert.equal(sortStatus(A(u), u).exact, true, '写过数以后起点从改完的这一排算');
  const v = make('array a = 65 49 49′\nsort a insert\nopen a');
  student(v, 'swap a#1 a#3', 'drag');
  assert.equal(row(v), '49′ 49 65');
  assert.match(v.stateText(), /排成从小到大了，可和照王道的代码排出来的不一样（那是 49 49′ 65：相等的牌先后不同）/);
});

// —— 量、判断式 ——

test('量：inv 前大后小几对、bad 链上坏几对、chains 排好几条、moves 让了几格；空格子判不了、不全是数的没有这个量', () => {
  const s = make(`array a = ${WD}\ngroup a stride=5`);
  assert.equal(evalMeasure(s, 'inv(a)').value, 27);
  assert.equal(evalMeasure(s, 'inv(a.1-3)').value, 1);
  assert.equal(evalMeasure(s, 'bad(a)').value, 5);
  assert.equal(evalMeasure(s, 'chains(a)').value, 0);
  assert.equal(evalMeasure(s, 'moves(a)').never, true);
  assert.equal(inversions([9, 1, 4, 13, 7, 8, 20, 23, 15]), 8);
  // 没定隔几个：本来就没有，现状里不列；写下时当场报
  const n = make(`array a = ${WD}`);
  assert.match(n.check(one('goal g1 "x" when="bad(a) = 0"')), /以后也数不了.*sort a shell d=5 或 group a stride=5/);
  assert.match(n.check(one('label c a "挪了 {moves(a)} 格"')), /先写明在做哪种排序：sort a insert/);
  assert.equal(n.check(one('label c a "前大后小 {inv(a)} 对"')), null);
  assert.equal(measureShown(n, 'inv(a)'), '27');
  assert.equal(n.check(one('goal g1 "x" when="inv(a) = 0"')), null);
  assert.equal(n.check(one('ask value "几对？" answer={inv(a)}')), null);
  // 空格子：现在数不了（写满了就有）；不全是数：没有这个量
  const b = make('array h = _ 49 38');
  assert.deepEqual(evalMeasure(b, 'inv(h)'), { value: null, why: 'h 还有空着的格' });
  assert.match(b.stateText(), /页面数不了：h 还有空着的格/);
  assert.equal(b.check(one('goal g1 "x" when="inv(h) = 0"')), null, '之后数得了：照收');
  assert.equal(evalMeasure(make('array w = A B C'), 'inv(w)').never, true);
  // 矩阵没有 inv 这个量：引号里新写的当场报，引号外面 {inv(A)} 照旧是逆矩阵
  const m = make('matrix M = 1 2 / 3 4');
  assert.match(m.check(one('say "{inv(M)}"')), /矩阵「M」没有量「inv」/);
  assert.equal(m.check(one('matrix N = {inv(M)}')), null);
  // 写明了排序：moves 跟着数
  const t = make(`array a = ${WD}\nsort a insert\nopen a move`);
  student(t, 'move a#6 -> a.1');
  assert.equal(evalMeasure(t, 'moves(a)').value, 5);
});

test('判断式：a pass=k 等于第 k 趟结束后的样子、a chains=d 隔 d 的每条链都递增、a mates 两格同链挨着；写错当场报', () => {
  const s = make(`array a = ${WD}\nsort a insert`);
  assert.equal(R.predicates.pass(A(s), ['1'], s), false);
  run(s, 'move a#2 -> a.1');
  assert.equal(R.predicates.pass(A(s), ['1'], s), true);
  assert.equal(R.predicates.pass(A(s), ['2'], s), true, '第 2 趟没动：也等于第 2 趟结束后的样子');
  assert.equal(R.predicates.pass(A(s), ['4'], s), false);
  assert.match(s.check(one('goal g1 "x" when="a pass"')), /pass 要写第几趟：a pass=2/);
  assert.match(s.check(one('goal g1 "x" when="a pass=12"')), /一共 9 趟，没有第 12 趟/);
  assert.equal(s.check(one('goal g1 "x" when="a pass=4"')), null);
  assert.match(make('array a = 3 1 2').check(one('goal g1 "x" when="a pass=1"')), /没写 a 在做哪种排序/);
  // 2014 真题：9 1 4 13 7 8 20 23 15，d = 3 每条链都递增，d = 2 不是
  const q = make('array p = 9 1 4 13 7 8 20 23 15\ndial d = 2 range=1-8 at=p\ngroup p stride=d');
  assert.equal(R.predicates.chains(A(q, 'p'), ['3'], q), true);
  assert.equal(R.predicates.chains(A(q, 'p'), ['2'], q), false);
  assert.equal(R.predicates.chains(A(q, 'p'), [], q), false, '不写就照分的组');
  assert.equal(R.predicates.chains(A(q, 'p'), ['d'], q), false, '能写拨数的名字');
  assert.equal(chainsText(rowOf(A(q, 'p')), 2), '隔 2 的 2 条链排好 0 条，没排好的：第 1 条 9>4、20>15；第 2 条 13>8');
  assert.equal(q.check(one('goal g1 "x" when="p chains=2"')), null);
  assert.match(q.check(one('goal g1 "x" when="p chains=3"')), /现在就已经成立了/);
  assert.match(make('array p = 3 1 2').check(one('goal g1 "x" when="p chains"')), /chains 要写隔几个：p chains=5/);
  assert.equal(R.predicates.mates(A(q, 'p'), ['p.1', 'p.3'], q), true);
  assert.equal(R.predicates.mates(A(q, 'p'), ['p.1', 'p.2'], q), false);
  assert.match(q.check(one('goal g1 "x" when="p mates p.1"')), /mates 后面写 p 的两格/);
  // 有空格子：现在判不了
  const b = make('array h = _ 2 1\ngroup h stride=1');
  assert.equal(R.predicates.chains(A(b, 'h'), [], b), null);
  // 希尔：a pass 就是这一趟
  const sh = make('array a = 13 27 49′ 55 04 49 38 65 97 76\nsort a shell d=3');
  assert.equal(R.predicates.pass(A(sh), [], sh), false);
  run(sh, 'swap a.4 a.7\nswap a.2 a.5');
  assert.equal(R.predicates.pass(A(sh), [], sh), true);
});

test('d 写拨数的名字：跟着拨，这一趟从现在这一排起算；现状里把每个能拨到的 d 扫一遍（哪个 d 每条链都递增、坏在哪几对）', () => {
  const s = make('array p = 9 1 4 13 7 8 20 23 15\ndial d = 2 range=1-8 at=p\nsort p shell d=d');
  assert.equal(A(s, 'p').sort.d, 2);
  assert.equal(R.brief(A(s, 'p')), '链上坏 3 对：9>4、20>15、13>8');
  const st = s.stateText();
  assert.match(st, /拨 d（1～8）时 p：/);
  // 2014 真题的事实：d = 2 坏三对、d = 4 坏在 9 > 7、d = 5 坏在 9 > 8，d = 3（和 6、7、8）每条链都递增
  assert.ok(st.includes('拨 d（1～8）时 p：d = 1 链上坏 3 对：9>1、13>7、23>15；d = 2 链上坏 3 对：9>4、20>15、13>8；d = 4 链上坏 1 对：9>7；d = 5 链上坏 1 对：9>8；别的每条链都递增'), st);
  run(s, 'set d 3');
  assert.equal(A(s, 'p').sort.d, 3);
  assert.equal(evalMeasure(s, 'bad(p)').value, 0);
  assert.equal(R.next(A(s, 'p'), s), null, 'd = 3 时每条链都排好了');
  assert.match(s.stateText(), /在做希尔排序 d = 3（跟着 d 拨）/);
  // 没有这个拨数：当场报
  assert.match(make('array a = 3 1 2').check(one('sort a shell d=k')), /没有叫「k」的数/);
});

// —— sort 指令 ——

test('sort 指令：写错当场报，话里说怎么改；sort a off 收掉；只是写明、不动那一排', () => {
  const s = make(`array a = ${WD}`);
  assert.match(s.check(one('sort a')), /sort a 后面写在做哪种排序：insert 直接插入排序.*页面不替你排/);
  assert.match(s.check(one('sort a heap')), /sort a 后面写在做哪种排序/);
  assert.match(s.check(one('sort a shell')), /希尔排序要写这一趟的增量：sort a shell d=5/);
  assert.match(s.check(one('sort a shell d=10')), /增量 d = 10 要是比格数（10）小的正整数/);
  assert.match(s.check(one('sort a insert d=5')), /d= 只有希尔排序用/);
  assert.match(s.check(one('sort a insert dd=5')), /不是 sort 认的写法：是不是 d=5/);
  assert.match(s.check(one('sort b insert')), /舞台上没有叫「b」的一排格子/);
  assert.match(s.check(one('sort a insert pass=2')), /pass= 跟着 from= 写/);
  assert.match(make('array w = A B C').check(one('sort w insert')), /格子里要都是数（「A」不是/);
  assert.match(make('array w = 3 -1 2').check(one('sort w radix')), /基数排序只排非负整数/);
  run(s, 'sort a shell d=5');
  assert.equal(row(s), WD);
  assert.deepEqual(A(s).sort, { algo: 'shell', d: 5, dv: null, from: WD.split(' '), moved: 0 });
  run(s, 'sort a off');
  assert.equal(A(s).sort, undefined);
  // 存档、回去带着写明的排序（让了几格也回去）
  const k = make(`array a = ${WD}\nsort a insert\nkeep a "一开始"\nmove a#2 -> a.1`);
  assert.equal(A(k).sort.moved, 1);
  run(k, 'back a "一开始"');
  assert.equal(A(k).sort.moved, 0);
  assert.equal(row(k), WD);
});

test('sort r … from=a：另一排该等于 a 做完那一趟的样子——学生一格一格写，写满了页面照引擎比；像哪种常见错法也说', () => {
  const s = make(`array a = ${WD}\narray r = _ _ _ _ _ _ _ _ _ _\nsort r shell d=5 from=a\nopen r edit\ngoal g1 "写出 d=5 这一趟的结果" when="r pass"`);
  assert.equal(R.next(A(s, 'r'), s).blank, true);
  assert.match(s.stateText(), /该等于 a 做希尔排序 d = 5第 1 趟结束后的样子：还有空着的格，页面判不了/);
  assert.equal(s.check(one('@r.done say "对。"')), null, '还空着：写满了照算，收下');
  run(s, '@r.done say "对。"');
  // 学生把相邻的两个当成一组各自排了（引擎那种常见错法：切成 5 段连续的）：38 49 | 65 97 | 13 76 | 27 49′ | 04 55
  const wrong = '38 49 65 97 13 76 27 49′ 04 55'.split(' ');
  let last;
  wrong.forEach((v, i) => { last = student(s, `write r.${i + 1} ${v}`, 'edit'); });
  assert.deepEqual(last.fx.filled, ['r']);
  assert.equal(last.fx.ruled, undefined, '写满了，可不是那一趟的样子：规则没判做完');
  assert.match(last.j.after[0], /^r 写满了：和 a 做完第 1 趟的样子不一样：第 1、2、3、4、5、6、7、8、9、10 格（该是 13、27、49′、55、04、49、38、65、97、76）$/, last.j.after[0]);
  assert.match(last.j.after[1], /^像是：把相邻的元素分成了一组，每组是连续的一段/);
  assert.equal(s.goals.get('g1').met, false);
  // 改对：最后一格改上时做完了，演预写的那一句
  const right = '13 27 49′ 55 04 49 38 65 97 76'.split(' ');
  right.forEach((v, i) => { last = student(s, `write r.${i + 1} ${v}`, 'edit'); });
  assert.deepEqual(last.j.after, ['r 写满了：和 a 做完第 1 趟的样子一样']);
  assert.deepEqual(last.fx.goalsMet, ['g1']);
  assert.deepEqual(last.fx.done, ['r']);
  assert.ok(last.fx.reactions.some((x) => x.src === 'say "对。"'));
  // 写错的话当场报
  assert.match(s.check(one('sort r insert from=zz')), /from= 写另一排格子的名字.*舞台上没有「zz」/);
  assert.match(s.check(one('sort r insert from=a pass=12')), /一共 9 趟，没有第 12 趟/);
  assert.match(make('array a = 3 1 2\narray r = _ _').check(one('sort r insert from=a')), /a 是 3 格，r 是 2 格，对不上/);
  // 直接插入把第 1 个也算成一趟：写的第 1 趟就是原样
  const t = make('array a = 49 38 65\narray r = 49 38 65\nsort r insert from=a pass=1');
  assert.match(t.stateText(), /和 a 做完第 1 趟的样子不一样：第 1、2 格（该是 38、49）；像是：把第 1 个元素自己也算成了一趟/);
});

// —— 学生的手：手势表 ——

test('open a move：放到另一张上是对调，放到两张之间是插入（中间的各让一格）；写明了希尔沿自己那条链挪；说明里写的就是页面真交出的', () => {
  const said = (src) => assert.ok(TYPES.array.doc.includes(src), `说明里要写「${src}」（页面真交出的）`);
  const s = make(`array a = ${WD}\nopen a move`);
  const e = s.opens.get('a:move');
  const cell = (ref) => s.parts(ref)[0];
  const sw = gestureAct(s, e, { from: cell('a.6'), to: cell('a.1') });
  assert.equal(sw.src, 'swap a#6 a#1');
  said(sw.src);
  // 第 6 格拖到第 2 格前面的空隙：落在第 2 格
  const mv = gestureAct(s, e, { from: cell('a.6'), to: { gap: { row: 0, before: 2 } } });
  assert.equal(mv.src, 'move a#6 -> a.2');
  said(mv.src);
  assert.deepEqual(mv.act, { type: 'move', key: 6, to: 2, d: 1 });
  // 往后拖：落在空隙前面那一格
  assert.equal(gestureAct(s, e, { from: cell('a.1'), to: { gap: { row: 0, before: 4 } } }).src, 'move a#1 -> a.3');
  assert.equal(gestureAct(s, e, { from: cell('a.1'), to: { gap: { row: 0, before: null } } }).src, 'move a#1 -> a.10');
  assert.match(gestureAct(s, e, { from: cell('a.6'), to: { gap: { row: 0, before: 6 } } }).error, /还在原处/);
  assert.match(gestureAct(s, e, { from: cell('a.6'), to: { gap: { row: 0, before: 7 } } }).error, /还在原处/);
  // 写明了希尔 d = 3：一排里的空隙照「链上排第几」算，落不到别的链上
  const h = make('array a = 13 27 49′ 55 04 49 38 65 97 76\nsort a shell d=3\nopen a move');
  const eh = h.opens.get('a:move');
  const g = gestureAct(h, eh, { from: h.parts('a.10')[0], to: { gap: { row: 0, before: 3 } } });
  assert.equal(g.src, 'move a#10 -> a.4 d=3');
  said(g.src);
  assert.equal(gestureAct(h, eh, { from: h.parts('a.7')[0], to: { gap: { row: 0, before: 2 } } }).src, 'move a#7 -> a.4 d=3', '第 7 格（38）到 13 和 55 之间');
  assert.match(gestureAct(h, eh, { from: h.parts('a.7')[0], to: { gap: { row: 0, before: 6 } } }).error, /还在原处：38 只沿隔 3 的那条链（第 1、4、7、10 格）挪/);
  // 分开排着：只在自己那条泳道里；空隙是泳道里两张之间
  run(h, 'group a stride=3\nsplit a');
  assert.equal(gestureAct(h, eh, { from: h.parts('a.7')[0], to: { gap: { row: 1, before: 4 } } }).src, 'move a#7 -> a.4 d=3');
  assert.match(gestureAct(h, eh, { from: h.parts('a.7')[0], to: { gap: { row: 2, before: 5 } } }).error, /只能在自己那一排里拖/);
  assert.match(gestureAct(h, eh, { from: h.parts('a.7')[0], to: h.parts('a.5')[0] }).error, /只能在自己那一排里拖/);
  // 两项都要按住再拖：第二项当场报
  assert.match(make(`array a = ${WD}\nopen a`).check(one('open a move')), /a 已经开着 drag（拖），move 也要在同样的部件上按住再拖/);
  assert.match(s.stateText(), /学生能直接动的：a move（按住拖：放到另一张上对调，放到两张之间插进去）/);
});

test('学生的 move（插入）照指令演：中间的各让一格；d= 只动链上的；不在一条链上报错说它的链是哪几格', () => {
  const s = make(`array a = ${WD}`);
  run(s, 'move a#6 -> a.2');
  assert.equal(row(s), '49 13 38 65 97 76 27 49′ 55 04');
  const t = make('array a = 13 27 49′ 55 04 49 38 65 97 76');
  run(t, 'move a#10 -> a.1 d=3');
  assert.equal(row(t), '76 27 49′ 13 04 49 55 65 97 38');
  assert.match(t.check(one('move a.1 -> a.5 d=3')), /隔 3 的链上，第 1 格那一张挪不到第 5 格：它的链是第 1、4、7、10 格/);
  assert.match(t.check(one('move a.1 -> a.4 dd=3')), /不是 move 认的写法：是不是 d=3/);
});

// —— 空格子 ——

test('空格子：array h = _ 49 38 的 _ 是空位（现状写 □）；老师 write 填上、write _ 空出来；学生键盘写、把牌拖进去', () => {
  const s = make('array h = _ 49 38');
  assert.deepEqual(A(s, 'h').cells.map((c) => c.value), ['', '49', '38']);
  assert.match(s.stateText(), /第 1～3 格：□ 49 38/);
  assert.equal(s.blankLeft('h'), true);
  // 有空格子：排好了、比大小都不成立（还空着的规矩）
  assert.equal(s.check(one('goal g1 "x" when="h sorted"')), null);
  run(s, 'goal g1 "x" when="h sorted"');
  assert.equal(s.goals.get('g1').met, false);
  run(s, 'write h.1 20\nwrite h.3 _');
  assert.match(s.stateText(), /第 1～3 格：20 49 □/);
  // 学生：键盘写一格（不用写 input=keypad：一排格子只有这一种写法），写满了算做完这一件
  const k = make('array h = _ 49 _\nopen h edit');
  const e = k.opens.get('h:edit');
  const w = gestureAct(k, e, { to: k.parts('h.1')[0], value: '38' });
  assert.equal(w.src, 'write h.1 38');
  assert.ok(TYPES.array.doc.includes(w.src));
  assert.match(gestureAct(k, e, { to: k.parts('h.1')[0], value: 'abc' }).error, /不是数/);
  assert.deepEqual(hasWork(k), ['h 还没做完']);
  student(k, 'write h.1 38', 'edit');
  const fin = student(k, 'write h.3 65', 'edit');
  assert.deepEqual(fin.fx.filled, ['h']);
  assert.deepEqual(hasWork(k), []);
  // 学生：把牌拖进空格子（和空格子对调）；空格子自己拖不动
  const d = make('array h = _ 49 38\nopen h move');
  const em = d.opens.get('h:move');
  const into = gestureAct(d, em, { from: d.parts('h.3')[0], to: d.parts('h.1')[0] });
  assert.equal(into.src, 'swap h#3 h#1');
  assert.match(gestureAct(d, em, { from: d.parts('h.1')[0], to: d.parts('h.2')[0] }).error, /空格子拖不动/);
  const r = student(d, into.src);
  assert.match(r.j.verdict.why, /38 从第 3 格挪进第 1 格的空格子/);
  assert.deepEqual(A(d, 'h').cells.slice().sort((a, b) => a.slot - b.slot).map((c) => c.value), ['38', '49', '']);
  // 写明了排序、还有空格子：页面算不了下一步，不判这一下
  const b = make('array h = _ 49 38\nsort h insert\nopen h move');
  assert.equal(R.next(A(b, 'h'), b).blank, true);
  assert.equal(student(b, 'swap h#3 h#1').j.verdict.right, null);
});

// —— D1 那张「页面的毛病」单子 ——

test('毛病 1：分开排以后学生把牌拖到别的泳道——这个世界做不到，舞台不动，挑战不会被凑成', () => {
  const s = make(`array a = ${WD}\ngroup a stride=5\nsplit a\nopen a\ngoal g2 "第 2 条" when="a.2 <= a.7"`);
  const r = student(s, 'swap a#6 a#2', 'drag');
  assert.equal(r.j.verdict.legal, false);
  assert.match(r.j.verdict.why, /分开排着的时候只能在自己那一排里拖（13 在第 1 条泳道，38 在第 2 条）/);
  assert.equal(r.fx.blocked, true);
  assert.equal(row(s), WD);
  assert.equal(s.goals.get('g2').met, false);
  // 自己那条泳道里照旧能换
  assert.equal(student(s, 'swap a#6 a#1', 'drag').j.verdict.legal, true);
  // 老师自己演的照演不拦
  assert.equal(s.check(one('swap a#7 a#3')), null);
});

test('毛病 8：没分过组就 split 当场报（重放旧课照旧、现状照实说）；跨泳道换乱、重新分组以后现状照实写每条泳道', () => {
  const s = make(`array a = ${WD}`);
  assert.match(s.check(one('split a')), /a 还没分组，没有组可分开：先 group a stride=5/);
  s.apply({ ...one('split a'), lenient: true });
  assert.match(s.stateText(), /一排格子 a（10 格，整排下到了下面一排（没分过组））/);
  assert.doesNotMatch(s.stateText(), /每组下到自己的一排/);
  const t = make(`array a = ${WD}\ngroup a stride=5\nsplit a`);
  assert.match(t.stateText(), /一排格子 a（10 格，按隔 5 个分了 5 组，每组下到自己的一排）/);
  run(t, 'swap a#6 a#2');
  assert.match(t.stateText(), /按隔 5 个分了 5 组，分开排着 5 条泳道，可泳道里已经不是隔 5 个的那几组了：第 1 条是第 1、2 格，第 2 条是第 6、7 格/);
  run(t, 'swap a#6 a#2\ngroup a stride=3');
  assert.match(t.stateText(), /按隔 3 个分了 3 组，分开排着 5 条泳道，可泳道里已经不是隔 3 个的那几组了/);
  run(t, 'merge a');
  assert.doesNotMatch(t.stateText(), /泳道/);
});

test('毛病 4：题卡、话、贴字里代码的方括号照原样画（A[j+dk]=A[j];、A[____]、A[−4]）；[词] 照旧能飞', () => {
  const texts = (t) => parseRich(t).map((p) => `${p.k}:${p.v}`);
  assert.deepEqual(texts('A[j+dk]=A[j];'), ['text:A[j+dk]=A[j];']);
  assert.deepEqual(texts('再填：A[____]=A[j]'), ['text:再填：A[____]=A[j]']);
  assert.deepEqual(texts('j = −4：A[−4]？'), ['text:j = −4：A[−4]？']);
  assert.deepEqual(texts('a[i][j] 是[稳定]的'), ['text:a[i][j] 是', 'word:稳定', 'text:的']);
  assert.deepEqual(texts('this is a [relative clause]'), ['text:this is a ', 'word:relative clause']);
  assert.deepEqual(texts('if(A[i]<A[i-dk]) 比 {a.1}'), ['text:if(A[i]<A[i-dk]) 比 ', 'ref:a.1']);
  const s = make('array a = 3 1 2\ncard c3 = "A[j+dk]=A[j];"\nsay "A[0] 只是暂存，这叫[希尔排序]"');
  assert.deepEqual(s.words, ['希尔排序']);
  assert.equal(s.check(one('fly say.1 -> nm a')), null);
  // 重放（刷新以后照 log 放回，带 lenient）读法一样：第几个 [词] 和当场数的一样
  const again = new Scene();
  again.apply({ ...one('array a = 3 1 2'), lenient: true });
  again.apply({ ...one('say "A[0] 只是暂存，这叫[希尔排序]"'), lenient: true });
  assert.deepEqual(again.words, ['希尔排序']);
});

test('毛病 6：{inv(a)} 是量（画成现在的数、跟着变）；不认得的量名照旧当场报', () => {
  const s = make('array a = 49 38 65 97\nopen a');
  run(s, 'label c a "前大后小 {inv(a)} 对" side=right');
  assert.equal(measureShown(s, 'inv(a)'), '1');
  student(s, 'swap a#1 a#2', 'drag');
  assert.equal(measureShown(s, 'inv(a)'), '0');
  assert.match(s.check(one('label c2 a "挪了 {steps(a)} 格"')), /一排格子「a」没有量「steps」，能写：inv、bad、chains、moves/);
});

// —— 预写、重放、课堂循环 ——

test('@a.done、@a.right 写得进去、照演；学生手上还有没做完的一排（open a 的拖交的是 swap）', () => {
  const s = make(`array a = 3 1 2\nsort a bubble\nopen a wrong=mark\n@a.right say "对。"\n@a.done say "排好了。"`);
  assert.deepEqual(undoneOf(s), ['a']);
  assert.deepEqual(hasWork(s), ['a 还没做完']);
  const r1 = student(s, 'swap a#1 a#2', 'drag');
  assert.deepEqual(r1.fx.reactions.map((x) => x.src), ['say "对。"']);
  const r2 = student(s, 'swap a#1 a#3', 'drag');
  assert.deepEqual(r2.fx.done, ['a']);
  assert.deepEqual(r2.fx.reactions.map((x) => x.src), ['say "排好了。"']);
  assert.deepEqual(undoneOf(s), []);
  // 现在就排好了的一排：@a.done 不会演，当场报
  assert.match(make('array a = 1 2 3\nsort a insert\nopen a').check(one('@a.done say "x"')), /现在就已经做完了/);
});

test('重放（刷新、撤一步）：带 lenient 照 log 放回，舞台现状和当场一字不差；wrong=block 拦下的那一下没进 log', () => {
  const log = [];
  const s = new Scene();
  const t = (src) => { for (const c of parseScript(src)) { s.apply(c, { by: 'teacher' }); log.push(['t', c.src.trim()]); } };
  const st = (src, open) => { const r = student(s, src, open); if (!r.fx.blocked) log.push(['s', src, open]); return r; };
  t(`array a = ${WD}\ndial d = 5 range=1-9 at=a\ngroup a stride=d\nsort a shell d=d\nopen a move wrong=block\n@a.done say "这一趟做完了。"\narray h = _ _ 3\nopen h edit`);
  assert.equal(st('swap a#2 a#1', 'move').fx.blocked, true);
  st('swap a#6 a#1', 'move');
  st('move a#7 -> a.2 d=5', 'move');
  st('write h.1 9', 'edit');
  t('sort a shell d=3\nsplit a');
  st('swap a#4 a#3', 'move');
  const again = new Scene();
  for (const [by, src, open] of log) for (const c of parseScript(src)) again.apply({ ...c, lenient: true, replay: true }, { by: by === 's' ? 'student' : null, open: open || null });
  assert.equal(again.stateText(), s.stateText());
  assert.deepEqual(A(again).sort, A(s).sort);
});

test('ask pick 以后哪几格变了：换了位置、写了数的', () => {
  const before = A(make(`array a = ${WD}`));
  const s = make(`array a = ${WD}\nmove a#6 -> a.4\nwrite a.1 50`);
  assert.deepEqual(R.changed(before, A(s)), [1, 6, 4, 5]);
});

test('规则照接口交全：登记了、手势表两项、判断式、量、doneBy / judges、借引擎的标准过程', () => {
  const r = rulesOf({ type: 'array' });
  assert.equal(r.hasNext, true);
  assert.deepEqual(Object.keys(r.gestures), ['move', 'edit']);
  assert.deepEqual(Object.keys(r.predicates), ['pass', 'chains', 'mates']);
  assert.deepEqual(Object.keys(r.measures), ['inv', 'bad', 'chains', 'moves']);
  assert.deepEqual(r.judges, ['drag', 'move']);
  assert.deepEqual(r.doneBy, ['drag', 'move', 'edit']);
  const s = make(`array a = ${WD}\nsort a shell d=5`);
  const std = r.standard(A(s), s);
  assert.equal(std.passes[0].join(' '), '13 27 49′ 55 04 49 38 65 97 76');
  assert.ok(std.variants.some((v) => v.id === 'shellBlock'));
  assert.deepEqual(variants(parse({ algo: 'shell', array: WD.replace('′', "'"), gaps: '5' })).map((v) => v.input.mistake), std.variants.map((v) => v.id));
  assert.equal(r.standard(A(make('array a = 1 2')), null), null);
  // 说明里的例子、docSetup 照抄能演
  assert.deepEqual(dryRun(new Scene(), TYPES.array.docSetup), []);
  // applyAct：做不了的是 null
  assert.equal(applyAct(rowOf(A(s)), { type: 'move', key: 1, to: 5, d: 3 }), null);
  assert.equal(badPairs(rowOf(A(s)), 5).length, 5);
});

test('open h edit 不限范围（没有拨数器，默认就是键盘）；写了 range= 才限', async () => {
  const { writeRange } = await import('../kit/src/stage/gestures.js');
  const s = make('array h = _ _ _\nopen h edit');
  assert.equal(s.opens.get('h:edit').lo, null);
  assert.equal(writeRange(s.opens.get('h:edit'), '27'), null);
  const r = make('array h = _ _ _\nopen h edit range=0..9');
  assert.match(writeRange(r.opens.get('h:edit'), '27'), /只能写 0～9/);
});

test('写给老师的那一句：open a 拖着对调的照旧；没让做的那一下不说「舞台已经照做了」；open a move 的写那一行和这一下做了什么', async () => {
  const { actText } = await import('../kit/src/stage/stage.js');
  const { verdictText } = await import('../kit/src/stage/events.js');
  const drag = { type: 'drag', a: { key: 6, value: '13', slot: 6 }, b: { key: 1, value: '49', slot: 1 } };
  assert.equal(actText(drag), '学生把 13（#6）拖到 49（#1）那一格，两格换了位置（舞台已经照做了）');
  const blocked = { ...drag, blocked: true, src: 'swap a#6 a#1', verdict: { legal: true, right: false, misread: null, why: '13 和 49 对调，第 6 格 ↔ 第 1 格', next: '把……' } };
  assert.equal(actText(blocked), '学生想把 13（#6）拖到 49（#1）那一格、两格对调');
  assert.match(verdictText(blocked), /不是正确的下一步；正确的是把……；照你写的 wrong=block 没让做，弹回去了/);
  const moved = { type: 'move', src: 'move a#10 -> a.5 d=5', verdict: { legal: true, right: true, misread: null, why: '04 从第 10 格挪到第 5 格，76 往后跳 5 格', next: null } };
  assert.equal(actText(moved) + verdictText(moved), '学生 move a#10 -> a.5 d=5（04 从第 10 格挪到第 5 格，76 往后跳 5 格）——是正确的下一步');
});

test('只判到一趟的排序（快排）：原地排的一排正好是某种常见错法某一趟的样子，事实、现状里写「像是：……」；正确的一趟不说', () => {
  const start = '49 38 65 97 76 13 27 49′';
  // 把这一排换成 want 的样子（一下一下对调；最后一下是学生做的）
  const reach = (s, want) => {
    let last = null;
    want.split(' ').forEach((v, i) => {
      const cur = textsOf(A(s));
      if (cur[i] === v) return;
      last = student(s, `swap a.${i + 1} a.${cur.indexOf(v, i) + 1}`, 'drag');
    });
    return last;
  };
  // 交换法划分（引擎那种错法第 1 次划分的结果：13 38 27 49 76 97 65 49′）
  const s = make(`array a = ${start}\nsort a quick\nopen a`);
  const r = reach(s, '13 38 27 49 76 97 65 49′');
  assert.equal(r.j.verdict.right, null, '每一下不判对错');
  assert.ok(r.j.after.some((f) => /^像是：用交换法划分的.*（和这种做法第 1 次划分的结果一样）$/.test(f)), r.j.after.join('|'));
  assert.match(s.stateText(), /不是哪一次划分结束后的样子；像是：用交换法划分的/);
  // 王道的填坑法第 1 次划分：27 38 13 49 76 97 65 49′
  const t = make(`array a = ${start}\nsort a quick\nopen a`);
  const ok = reach(t, '27 38 13 49 76 97 65 49′');
  assert.ok(!ok.j.after.some((f) => /像是/.test(f)), ok.j.after.join('|'));
  assert.ok(ok.j.after.some((f) => /现在等于第 1 次划分结束后的样子/.test(f)), ok.j.after.join('|'));
});

test('页面判每一下的四种：照 next 做（哪种做法都行），一趟做到一半碰巧和哪种错法的结果一样也不说「像是」', () => {
  // 3 1 2 5 4 冒泡先换前面一对成 1 3 2 5 4，正好是「只把最小的挪到最前」那种做法第 1 趟的结果：这一下判的是对，不能又说像那种错
  for (const [algo, arr, open] of [['bubble', '3 1 2 5 4', 'drag'], ['bubble', WD, 'drag'], ['insert', WD, 'move'], ['insert', '2 1 3 5 4', 'move'], ['select', '3 1 2 5 4', 'drag']]) {
    for (const pick of [0, 1]) {
      const s = make(`array a = ${arr}\nsort a ${algo}\nopen a${open === 'move' ? ' move' : ''}`);
      for (let i = 0; i < 200; i++) {
        const nx = R.next(A(s), s);
        if (nx === null) break;
        const r = student(s, actSrc(A(s), nx.acts[Math.min(pick, nx.acts.length - 1)]), open);
        assert.ok(!r.j.after.some((f) => /像是/.test(f)), `${algo} ${arr}：${r.j.after.join('|')}`);
      }
      assert.equal(sortStatus(A(s), s).exact, true);
    }
  }
});

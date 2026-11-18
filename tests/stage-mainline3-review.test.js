// 舞台主线第三轮：最后一审抓到的（表、时间轴），一条一个最小的重现
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { gestureOf, evalMeasure } from '../kit/src/stage/rules.js';
import { sameValue } from '../kit/src/stage/types/table.js';
import { hasWork } from '../kit/src/stage/events.js';

const run = (s, src, extra = {}) => { for (const c of parseScript(src)) s.apply({ ...c, ...extra }); return s; };
const make = (src) => run(new Scene(), src);
const cell = (s, r, c, id = 'T') => s.objects.get(id).cells.find((x) => x.r === r && x.c === c);
const wordsOf = (s, id) => [...s.objects.get(id).words].sort((a, b) => a.slot - b.slot).map((w) => w.value).join(' ');

test('严重 1：学生往表里写的字原样写进去、原样读回（箭头、花括号、引号、和舞台上东西同名的字）；老师写多了词当场报', () => {
  const s = make('matrix A = 1 2 / 3 4\ntable T rows="r1 r2" cols="c1 c2 c3"\nopen T edit input=text');
  const o = () => s.objects.get('T');
  const g = gestureOf(o(), 'edit');
  const e = s.opens.get('T:edit');
  const put = (r, c, v) => { const a = g.toAct(o(), { to: cell(s, r, c), value: v, open: e }); assert.ok(a.src, `${v}：${a.error || ''}`); const fx = s.apply(parseScript(a.src)[0], { by: 'student', open: 'edit' }); return { src: a.src, fx }; };
  for (const [r, c, v] of [[1, 1, 'A→B'], [1, 2, 'a->b'], [1, 3, 'A'], [2, 1, 'x{y'], [2, 2, 'T'], [2, 3, '「能」']]) {
    const { fx } = put(r, c, v);
    assert.equal(cell(s, r, c).value, v, v);
    assert.equal(fx.judged.verdict.legal, true, v);
  }
  // 纯数、∞ 照旧不加引号
  const k = make('table T rows="a" cols="x y"\nopen T edit');
  assert.equal(gestureOf(k.objects.get('T'), 'edit').toAct(k.objects.get('T'), { to: cell(k, 1, 1), value: '7', open: k.opens.get('T:edit') }).src, 'write T.1,1 7');
  assert.equal(gestureOf(k.objects.get('T'), 'edit').toAct(k.objects.get('T'), { to: cell(k, 1, 2), value: '∞', open: k.opens.get('T:edit') }).src, 'write T.1,2 ∞');
  // 选项里有和表同名的字
  const p = make('table T = P _ / Q _ cols="命题 真假"\nopen T edit choices="T F"');
  const a = gestureOf(p.objects.get('T'), 'edit').toAct(p.objects.get('T'), { to: cell(p, 1, 2), role: 'T', open: p.opens.get('T:edit') });
  p.apply(parseScript(a.src)[0], { by: 'student', open: 'edit' });
  assert.equal(cell(p, 1, 2).value, 'T');
  // 老师写：格后面只能有一个词或一对引号
  assert.match(dryRun(s, 'write T.1,1 7 8')[0].error, /短语写在引号里/);
  assert.match(dryRun(s, 'write T.1,1 A→B')[0].error, /短语写在引号里/);
  assert.equal(dryRun(s, 'write T.1,1 "A→B"').length, 0);
  assert.equal(dryRun(s, 'write T.1,1 A').length, 0);
  // 格里、答案里不能写 {式子}（表的格不跟着算）
  assert.match(dryRun(new Scene(), 'dial k = 1 range=1..3\ntable T = {k} 2 rows="a" cols="x y"')[0].error, /表的格不跟着算/);
});

test('严重 2：时间轴拿掉、同名重造以后，跟着它的拨盘的句子不露模板原文——不再跟、现状写明；小人重新站好、段数对得上就接着跟', () => {
  const s = make('timeline tl = 1800 1830 1900 现在 将来\nstand tl me = 1830\nsentence s = "It {me: was | had been | is | has been | will be} free."');
  run(s, 'timeline tl = 1800 1830 1900 1950 现在 将来');
  assert.equal(wordsOf(s, 's'), 'It had been free');
  assert.match(s.stateText(), /不再跟着拨盘 me 变（拨盘没了/);
  // 小人重新站上去，可句子是 5 段、停靠点 6 个：对不上，照旧不跟（不露模板）
  run(s, 'stand tl me = 1950\nset me 将来');
  assert.equal(wordsOf(s, 's'), 'It had been free');
  assert.doesNotMatch(s.stateText(), /\{me: was\| had/);
  // 段数对得上的：小人站回去就接着跟
  const t = make('timeline tl = 过去 现在 将来\nstand tl me = 现在\nsentence s = "It {me: was | is | will be} free."\nremove tl');
  assert.match(t.stateText(), /不再跟着拨盘 me 变/);
  run(t, 'timeline tl = 过去 现在 将来\nstand tl me = 将来');
  assert.equal(wordsOf(t, 's'), 'It will be free');
  // 回到存档点：拨盘没了的句子不照模板重排
  const b = make('timeline tl = 过去 现在 将来\nstand tl me = 现在\nsentence s = "It {me: was | is | will be} free."\nkeep s "k"\nremove tl\nback s "k"');
  assert.equal(wordsOf(b, 's'), 'It is free');
  // 还跟着别的句子、贴的字时站一个段数对不上的小人：当场报是谁
  const c = make('timeline tl = 过去 现在 将来\nstand tl me = 现在\narray a = 1 2\nlabel n a "{me: 甲 | 乙 | 丙}"\nremove tl\ntimeline tl = a b');
  assert.match(dryRun(c, 'stand tl me = a')[0].error, /贴的字 n[^\n]*写了 3 段/);
});

test('严重 3：两个词表不一样的拨词拨盘比 = / != 照旧（照词比）；只有比先后才要同一串词', () => {
  const s = make('dial t = 现在 options="过去 现在 将来"\ndial u = 过去 options="过去 现在"\ngoal g1 "一样" when="t = u"');
  const fx = s.apply(parseScript('set u 现在')[0], { by: 'student' });
  assert.deepEqual(fx.goalsMet, ['g1']);
  assert.match(dryRun(s, 'goal g2 "x" when="t < u"')[0].error, /不是同一条轴/);
});

test('要紧 1：时间轴不能存档（keep / back / after=）：它的小人、条的一头是拨盘，存不进去——当场报，不存一半', () => {
  const s = make('timeline tl = 过去 现在 将来\nstand tl me = 现在\nopen tl.me move');
  assert.match(dryRun(s, 'keep tl "站好"')[0].error, /时间轴存不了档/);
  assert.match(dryRun(s, 'keep tl "动过" after=move')[0].error, /时间轴存不了档/);
  assert.match(dryRun(s, 'open tl back="站好"')[0].error, /时间轴存不了档/);
});

test('要紧 2：造的时候有值、老师又空出来的格照比；一格都不比时写满不说「都和答案一样」', () => {
  const s = make('table T = 10 5 / 3 7 rows="a b" cols="x y" key="10 5 / 3 7"\nwrite T.2,2 _\nopen T edit\ngoal g1 "对" when="T right"');
  const fx = s.apply(parseScript('write T.2,2 99')[0], { by: 'student', open: 'edit' });
  assert.match(fx.judged.after.join('；'), /比的 1 格里 1 格和答案不一样/);
  assert.equal(s.goals.get('g1').met, false);
  const n = make('table T = 1 _ rows="a" cols="x y" key="1 _"\nopen T edit');
  const f2 = n.apply(parseScript('write T.1,2 5')[0], { by: 'student', open: 'edit' });
  assert.doesNotMatch(f2.judged.after.join('；'), /都和答案一样/);
});

test('要紧 3：和答案比——前导 0、上标不吃掉；弯撇号、破折号两边一起规整', () => {
  for (const [a, b] of [['0011', '11'], ['02', '2'], ['O(2ⁿ)', 'O(2n)'], ['n²', 'n2'], ['10⁻³', '10-3']]) assert.equal(sameValue(a, b), false, `${a} / ${b}`);
  for (const [a, b] of [['2', '2.0'], ['1/2', '0.5'], ['O(n²)', 'o(n^2)'], ['don’t', "don't"], ['well—known', 'well-known'], [' Will  Have ', 'will have'], ['∞', '∞'], ['０１', '01']]) assert.equal(sameValue(a, b), true, `${a} / ${b}`);
});

test('要紧 4、5：只开一列时，写满这一列就算做完（@T.done、学生手上没事了）；wrong(T.c1) 只数这一列', () => {
  const s = make('table T rows="v2 v3" cols="第1轮 第2轮" key="10 9 / ∞ 5"\nopen T.c1 edit\n@T.done say "好"');
  s.apply(parseScript('write T.1,1 10')[0], { by: 'student', open: 'edit' });
  assert.ok(hasWork(s).some((x) => /T/.test(x)));
  const fx = s.apply(parseScript('write T.2,1 3')[0], { by: 'student', open: 'edit' });
  assert.deepEqual(fx.done, ['T']);
  assert.deepEqual(fx.reactions.map((r) => r.src), ['say "好"']);
  assert.equal(hasWork(s).some((x) => /T/.test(x)), false);
  assert.match(fx.judged.after.join('；'), /开着的格写满了/);
  assert.deepEqual([evalMeasure(s, 'wrong(T.c1)').value, evalMeasure(s, 'wrong(T.c2)').value, evalMeasure(s, 'wrong(T)').value], [1, 0, 1]);
});

test('要紧 6：没有行名 / 列名的表给一行一列打勾打叉当场报（画面上没处画）；小的：小人不带字、多的词当场报；式子里写时间轴上的名字说清楚', () => {
  const s = make('table T = P _ / Q _ cols="命题 真假"');
  assert.match(dryRun(s, 'cross T.r1')[0].error, /没有行名/);
  assert.equal(dryRun(s, 'cross T.c2\ntick T.1,2').length, 0);
  const t = make('timeline tl = 过去 现在 将来');
  assert.match(dryRun(t, 'stand tl me = 现在 "小人"')[0].error, /小人不带字/);
  assert.match(dryRun(t, 'stand tl me = 过去 现在')[0].error, /站在一个停靠点/);
  run(t, 'bar tl b = 过去..现在 "x" end=e1');
  assert.match(dryRun(t, 'matrix M = {e1} 2')[0].error, /拨词的拨盘/);
});

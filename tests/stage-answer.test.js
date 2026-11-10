// 舞台 ask value 的判答案（kit/src/stage/answer.js）：type= 接现成的判法，answer 可以是 {式子}、可以不写，常见错答只给老师
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { judgeAnswer, checkSpec, formulaRows, gridAnswerText, autoWrongs, gridShape, answerInput } from '../kit/src/stage/answer.js';
import { sameAnswer } from '../kit/src/stage/stage.js';
import { actText } from '../kit/src/stage/stage.js';

const run = (scene, src) => { for (const c of parseScript(src)) scene.apply(c); return scene; };

test('分数：0.5 和 1/2 一样', () => {
  assert.equal(judgeAnswer('0.5', { type: 'num', answer: '1/2' }).ok, true);
  assert.equal(judgeAnswer('1/3', { type: 'num', answer: '1/2' }).ok, false);
});

test('式子：2^n 对，2n 不对', () => {
  const spec = { type: 'formula', answer: '2^n', free: 'n' };
  assert.equal(judgeAnswer('2^n', spec).ok, true);
  assert.equal(judgeAnswer('2n', spec).ok, false);
  // 没写 free=：写下这一行时当场报；万一到了判的时候才发现，页面没判成（ok 是 null），不当学生答错
  assert.throws(() => checkSpec({ type: 'formula', answer: '2^n' }), /free=/);
  const r = judgeAnswer('2^n', { type: 'formula', answer: '2^n' });
  assert.equal(r.ok, null);
  assert.match(r.failed, /页面没判成.*free=/);
});

test('矩阵：一格不一样就不对', () => {
  const spec = { type: 'matrix', answer: '1 2 / 3 4' };
  assert.equal(judgeAnswer('1 2 / 3 4', spec).ok, true);
  assert.equal(judgeAnswer('1 2 / 3 5', spec).ok, false);
});

test('{A^2}：答案照舞台现在的矩阵现算', () => {
  const sc = run(new Scene(), 'matrix A = 1 1 / 0 1');
  const spec = { type: 'matrix', answer: '{A^2}' };
  const r = judgeAnswer('1 2 / 0 1', spec, sc);
  assert.equal(r.ok, true);
  assert.equal(r.shown, '1 2 / 0 1');
  assert.equal(judgeAnswer('1 1 / 0 1', spec, sc).ok, false);
});

test('没写 answer：只收不判', () => {
  assert.equal(judgeAnswer('随便', {}).ok, null);
  assert.equal(judgeAnswer('随便', { type: 'num' }).ok, null);
});

test('常见错答：不对，misread 是说明；对上的不带 misread，没对上的也没有', () => {
  const spec = { type: 'num', answer: '2', wrongs: '3=漏了 E; 0=当成数 0' };
  const r = judgeAnswer('3', spec);
  assert.equal(r.ok, false);
  assert.equal(r.misread, '漏了 E');
  assert.equal(judgeAnswer('0', spec).misread, '当成数 0');
  assert.equal(judgeAnswer('5', spec).misread, null);
  assert.equal(judgeAnswer('2', spec).misread, null);
});

test('别的 type：数集、方程、序列、英文', () => {
  assert.equal(judgeAnswer('x>1', { type: 'set', answer: '(1, +∞)' }).ok, true);
  assert.equal(judgeAnswer('x=2', { type: 'equation', answer: 'x = 2' }).ok, true);
  assert.equal(judgeAnswer('A C B', { type: 'seq', answer: 'A C B' }).ok, true);
  assert.equal(judgeAnswer('B A C', { type: 'seq', answer: 'A C B' }).ok, false);
  assert.equal(judgeAnswer('Had Started', { type: 'en', answer: 'had started' }).ok, true);
});

test('不认得的 type：报错并列出能写的', () => {
  assert.throws(() => judgeAnswer('1', { type: 'foo', answer: '1' }), /num formula matrix set equation seq en/);
});

test('ask value 不写 answer 不再报错；写错 type 当场报', () => {
  const sc = run(new Scene(), 'matrix A = 1 1 / 0 1');
  assert.doesNotThrow(() => sc.apply(parseScript('ask value "猜一个"')[0]));
  const s2 = new Scene();
  assert.match(s2.check(parseScript('ask value "?" answer=2 type=foo')[0]), /num formula matrix/);
  assert.doesNotThrow(() => sc.apply(parseScript('ask value "A 的平方" answer={A^2} type=matrix wrong="1 1 / 0 1=忘了乘"')[0]));
  assert.equal(sc.waiting.type, 'matrix');
});

test('actText：只收不判、错答说明只进给老师的话', () => {
  assert.match(actText({ type: 'value', text: '7', answer: '', right: null, misread: null }), /学生填了「7」（这一问只收不判）/);
  const t = actText({ type: 'value', text: '3', answer: '2', right: false, misread: '漏了 E' });
  assert.match(t, /填错了/);
  assert.match(t, /漏了 E/);
});

test('旧写法（没写 type）：答案不是数、填法带空格，对错和 sameAnswer 一样', () => {
  const pairs = [['1, 2', '1,2'], ['(1,2)', '(1, 2)'], ['x = 2', 'x=2'], ['A B', 'AB'], ['x^2', 'x ^ 2'], ['x+1', 'x + 1'], ['X+1', 'x + 1'], ['x+1', 'x+2'], ['0.50', '1/2']];
  for (const [given, answer] of pairs) {
    assert.equal(judgeAnswer(given, { answer }).ok, sameAnswer(given, answer), `${given} / ${answer}`);
    assert.equal(judgeAnswer(answer, { answer: given }).ok, sameAnswer(answer, given), `${answer} / ${given}`);
  }
  assert.equal(judgeAnswer('1, 2', { answer: '1,2' }).ok, true);
});

// —— 整条分支的最终审查（C1、I1、M3）——

test('C1 矩阵里的分数：1/3 是一格，行按「 / 」、; 、换行分（和造矩阵的写法一样）', () => {
  const sc = run(new Scene(), 'dial k = 3 range=1..5\nmatrix P = 1 0 / 0 {k}');
  const spec = { type: 'matrix', answer: '{P^-1}' };
  const r = judgeAnswer('1 0 / 0 1/3', spec, sc);
  assert.equal(r.ok, true);
  assert.equal(r.shown, '1 0 / 0 1/3');
  assert.equal(judgeAnswer('1 0; 0 1/3', spec, sc).ok, true);
  assert.equal(judgeAnswer('1 0\n0 1/3', spec, sc).ok, true);
  assert.equal(judgeAnswer('1 0 / 0 1/2', spec, sc).ok, false);
  // 字面写的答案也一样（以前是当场报「每一行的格数要一样」，写不了）
  const lit = { type: 'matrix', answer: '1 0 / 0 -1/3' };
  assert.equal(judgeAnswer('1 0 / 0 -1/3', lit).ok, true);
  // 斜线只贴着一边（2/ 3）和造矩阵时一样当分行
  assert.equal(judgeAnswer('1 0/ 0 -1/3', lit).ok, true);
});

test('C1 学生写的矩阵页面读不懂（2/0）：判不对，告诉老师是写法读不懂；1/3 读成分数格数对不上也说一声', () => {
  const spec = { type: 'matrix', answer: '1 2 / 0 1' };
  const a = judgeAnswer('1 2/0 1', spec);
  assert.equal(a.ok, false);
  assert.match(a.misread, /读不懂/);
  assert.match(a.misread, /2\/0/);
  const b = judgeAnswer('1 2/3 4', { type: 'matrix', answer: '1 2 / 3 4' });
  assert.equal(b.ok, false);
  assert.match(b.misread, /2\/3.*分数/);
});

test('I1 {式子} 答案写下时就照 type 验一遍：和 type 对不上当场报', () => {
  const sc = run(new Scene(), 'dial k = 3 range=1..5\nmatrix A = 1 1 / 0 1');
  assert.match(sc.check(parseScript('ask value "k 是几" type=formula answer={k}')[0]) || '', /free=/);
  assert.match(sc.check(parseScript('ask value "A²" type=num answer={A^2}')[0]) || '', /type=num/);
  assert.match(sc.check(parseScript('ask value "A²" type=equation answer={A^2}')[0]) || '', /type=equation/);
  assert.equal(sc.check(parseScript('ask value "A²" type=matrix answer={A^2}')[0]), null);
  assert.equal(sc.check(parseScript('ask value "k" type=num answer={k}')[0]), null);
});

test('I1 判的时候算不出来（学生把 P 拨成不可逆）：ok 是 null，告诉老师「页面没判成」，不当学生答错', () => {
  const sc = run(new Scene(), 'dial k = 3 range=0..5\nmatrix P = 1 0 / 0 {k}');
  const spec = { type: 'matrix', answer: '{P^-1}' };
  run(sc, 'set k 0');
  const r = judgeAnswer('1 0 / 0 1', spec, sc);
  assert.equal(r.ok, null);
  assert.ok(r.failed, '带着出错的原因（stage.js 记进出错记录）');
  const t = actText({ type: 'value', text: '1 0 / 0 1', answer: r.shown, right: r.ok, misread: r.misread, failed: r.failed });
  assert.match(t, /页面没判成/);
  assert.doesNotMatch(t, /填错了|只收不判/);
});

test('M3 wrong= 每条照 type 验：方程的错答带 =、矩阵的错答用 ; 分行都当场报或者对得上', () => {
  // 方程：错答本身带 =，照 type 找到能读成方程的那一处切开
  const eq = { type: 'equation', answer: 'x + y = 3', wrongs: 'x + y = 5=把常数抄错了' };
  assert.doesNotThrow(() => checkSpec(eq));
  const r = judgeAnswer('x + y = 5', eq);
  assert.equal(r.ok, false);
  assert.equal(r.misread, '把常数抄错了');
  // 矩阵：错答里用 ; 分行（; 是隔开几条错答的）：拆出来的格数和答案对不上，当场报
  assert.throws(() => checkSpec({ type: 'matrix', answer: '1 2 / 3 4', wrongs: '1 2; 3 5=抄错了' }), /wrong=.*「 \/ 」/);
  // 错答照 type 读不成（type=num 写了一个矩阵）当场报
  assert.throws(() => checkSpec({ type: 'num', answer: '2', wrongs: '1 2 / 3 4=写成矩阵了' }), /wrong=/);
  // {式子} 的错答在舞台上照 type 验
  const sc = run(new Scene(), 'matrix A = 1 1 / 0 1');
  assert.equal(sc.check(parseScript('ask value "A²" type=matrix answer={A^2} wrong="{A}=只乘了一次"')[0]), null);
  assert.equal(judgeAnswer('1 1 / 0 1', { type: 'matrix', answer: '{A^2}', wrongs: '{A}=只乘了一次' }, sc).misread, '只乘了一次');
});

test('复核 答案矩阵不受舞台上矩阵的 6×8 上限管：{A\'} 是 8×2 也判得了', () => {
  const sc = run(new Scene(), 'matrix A = 1 2 3 4 5 6 7 8 / 1 1 1 1 1 1 1 1');
  assert.equal(sc.check(parseScript('ask value "Aᵀ" type=matrix answer={A\'}')[0]), null);
  const spec = { type: 'matrix', answer: "{A'}" };
  assert.equal(judgeAnswer('1 1 / 2 1 / 3 1 / 4 1 / 5 1 / 6 1 / 7 1 / 8 1', spec, sc).ok, true);
  assert.equal(judgeAnswer('1 1 / 2 1 / 3 1 / 4 1 / 5 1 / 6 1 / 7 1 / 8 2', spec, sc).ok, false);
});

test('量判不了不当答错：answer={verbs(s2)} 在 s2 没写 key 时页面没判成', () => {
  const sc = run(new Scene(), 'sentence s2 = "The man is a doctor."\ntree t = 50 30 70');
  const r = judgeAnswer('1', { answer: '{verbs(s2)}' }, sc);
  assert.equal(r.ok, null);
  assert.match(r.failed, /页面没判成/);
  assert.equal(judgeAnswer('3', { answer: '{count(t)}' }, sc).ok, true);
  assert.equal(judgeAnswer('2', { answer: '{height(t)}' }, sc).ok, true);
  assert.equal(judgeAnswer('3', { answer: '{height(t)}' }, sc).ok, false);
  assert.equal(sc.check(parseScript('ask value "几个结点？" answer={count(t)}')[0]), null);
});

// —— 第二轮 Task 13：按格的含 n 矩阵、省乘号、[[…]]、五条现算的常见错答、数集的大括号、重放旧课照字面 ——

const AN = { type: 'matrix', free: 'n', answer: '1 n n(n-1)/2 / 0 1 n / 0 0 1' };
const AN_CELLS = [['1', 'n', 'n(n-1)/2'], ['0', '1', 'n'], ['0', '0', '1']];

test('按格的 Aⁿ：一格一个式子，逐格代 n 判', () => {
  assert.equal(judgeAnswer(AN_CELLS, AN).ok, true);
  // 写法不同、等价的都对（展开的、带乘号的、换了先后的、小数系数、带空格的）
  for (const c13 of ['(n^2-n)/2', 'n*(n-1)/2', '(n-1)n/2', 'n (n-1) / 2', '0.5n(n-1)', '(1/2)(n^2 - n)', 'n²/2 - n/2']) {
    const g = AN_CELLS.map((r) => [...r]);
    g[0][2] = c13;
    const r = judgeAnswer(g, AN);
    assert.equal(r.ok, true, c13);
    assert.equal(r.misread, null, c13);
  }
  // 一行字交（和老师写 answer= 一样的写法）、[[…]] 交也认
  assert.equal(judgeAnswer('1 n n(n-1)/2 / 0 1 n / 0 0 1', AN).ok, true);
  assert.equal(judgeAnswer('[[1, n, (n^2-n)/2], [0, 1, n], [0, 0, 1]]', AN).ok, true);
  // 一格不对：说第几行第几格、学生写的、代哪个 n、两边各是几
  const g = AN_CELLS.map((r) => [...r]);
  g[0][2] = 'n^2/2';
  const r = judgeAnswer(g, AN);
  assert.equal(r.ok, false);
  const m = r.misread.match(/^第 1 行第 3 格不对：学生写 n²\/2，代 n = (\d+) 是 ([\d.]+)，该是 ([\d.]+)$/);
  assert.ok(m, r.misread);
  const n = Number(m[1]);
  assert.equal(Number(m[2]), n * n / 2);
  assert.equal(Number(m[3]), n * (n - 1) / 2);
  // 几格都错写第一格
  const two = AN_CELLS.map((r) => [...r]);
  two[1][2] = '2n';
  two[0][1] = 'n+1';
  assert.match(judgeAnswer(two, AN).misread, /^第 1 行第 2 格不对：学生写 n\+1，/);
  // 大小对不上：不对，说一声（按格的式子框交不出这种，一行字交得出）
  const sh = judgeAnswer('1 n / 0 1', AN);
  assert.equal(sh.ok, false);
  assert.match(sh.misread, /2×2.*3×3/);
  // 负号、分数：−n 和 -n、(-1)n 一样；1/2 和 0.5 一样
  const neg = { type: 'matrix', free: 'n', answer: '1 -n / 0 1/2' };
  for (const x of ['−n', '(-1)n', '-1*n', '0-n']) assert.equal(judgeAnswer([['1', x], ['0', '0.5']], neg).ok, true, x);
  assert.equal(judgeAnswer([['1', 'n'], ['0', '1/2']], neg).ok, false);
  // 学生那一格页面读不懂：不对，告诉老师读不懂哪一格
  const bad = judgeAnswer([['1', 'm'], ['0', '1/2']], neg);
  assert.equal(bad.ok, false);
  assert.match(bad.misread, /第 1 行第 2 格.*读不懂/);
});

test('按格的 Aⁿ：写下时就查（每行一样多、只用 free= 的变量），写错照真的原因说', () => {
  assert.doesNotThrow(() => checkSpec(AN));
  assert.throws(() => checkSpec({ ...AN, answer: '1 n / 0' }), /第 2 行/);
  assert.throws(() => checkSpec({ ...AN, answer: '1 m / 0 1' }), /「m」/);
  assert.throws(() => checkSpec({ ...AN, answer: '1 m / 0 1' }), /free=/);
  // wrong= 也照按格的式子读：大小要和答案一样
  const w = { ...AN, wrongs: '1 n n^2/2 / 0 1 n / 0 0 1=当成了 n²/2' };
  assert.doesNotThrow(() => checkSpec(w));
  const g = AN_CELLS.map((r) => [...r]);
  g[0][2] = 'n*n/2';
  assert.equal(judgeAnswer(g, w).misread, '当成了 n²/2');
  assert.throws(() => checkSpec({ ...AN, wrongs: '1 n / 0 1=错的' }), /wrong=.*2×2.*3×3/);
  // 舞台上：ask value 收下这一行，等着的那一问带着 free；学生那边按格画的大小页面先算好
  const sc = new Scene();
  assert.equal(sc.check(parseScript('ask value "Aⁿ = ？" type=matrix free=n answer="1 n n(n-1)/2 / 0 1 n / 0 0 1"')[0]), null);
  sc.apply(parseScript('ask value "Aⁿ = ？" type=matrix free=n answer="1 n n(n-1)/2 / 0 1 n / 0 0 1"')[0]);
  assert.equal(sc.waiting.free, 'n');
  assert.deepEqual(gridShape(sc.waiting, sc), { rows: 3, cols: 3, names: ['n'] });
  assert.equal(gridShape({ type: 'matrix', answer: '1 2 / 3 4' }, sc), null, '没写 free= 照旧一个输入框');
});

test('两种 /：两边空着的分行，贴着的是一格分数（不写 free= 照旧按数比）', () => {
  const spec = { type: 'matrix', answer: '1 1/2 / 0 1' };
  assert.equal(judgeAnswer('1 0.5 / 0 1', spec).ok, true);
  assert.equal(judgeAnswer('1 1/3 / 0 1', spec).ok, false);
  assert.deepEqual(formulaRows('1 n n(n-1)/2 / 0 1 n / 0 0 1'), AN_CELLS);
  assert.deepEqual(formulaRows('2^n n/2 / 0 1'), [['2^n', 'n/2'], ['0', '1']]);
});

test('省乘号：answer、wrong=、学生写的都照同一种读法（2n = 2*n = 2 n）', () => {
  const spec = { type: 'formula', free: 'n', answer: '2n' };
  assert.equal(judgeAnswer('2*n', spec).ok, true);
  assert.equal(judgeAnswer('2 n', spec).ok, true);
  assert.equal(judgeAnswer('n+n', spec).ok, true);
  assert.equal(judgeAnswer('n n', { ...spec, wrongs: 'n^2=写成了平方' }).misread, '写成了平方');
  // 以前 n(n-1)/2 当成了函数 n(…)，写下就报「算不出来」
  const tri = { type: 'formula', free: 'n', answer: 'n(n-1)/2' };
  assert.doesNotThrow(() => checkSpec(tri));
  for (const g of ['(n^2-n)/2', 'n*(n-1)/2', 'n(n-1)/2', '(n-1)n/2']) assert.equal(judgeAnswer(g, tri).ok, true, g);
  assert.equal(judgeAnswer('n^2/2', tri).ok, false);
  // 写错的原因照舞台的写法说（free=，不说黑板的 formula: / let）
  assert.throws(() => checkSpec({ type: 'formula', free: 'n', answer: '2m' }), (e) => /「m」/.test(e.message) && !/let|formula:/.test(e.message));
});

test('[[…]] 写得一样也判对（以前格里的 n 2^(n-1) 读不了，一字不差也判错）', () => {
  const spec = { type: 'matrix', free: 'n', answer: '[[2^n, n 2^(n-1)], [0, 2^n]]' };
  assert.doesNotThrow(() => checkSpec(spec));
  assert.equal(judgeAnswer('[[2^n, n 2^(n-1)], [0, 2^n]]', spec).ok, true);
  assert.equal(judgeAnswer([['2^n', 'n*2^(n-1)'], ['0', '2^n']], spec).ok, true);
  assert.equal(judgeAnswer([['2^n', 'n*2^n'], ['0', '2^n']], spec).ok, false);
});

test('按格交的写成一行字：一行里的格用空格隔开，行之间「 / 」；读回来一样', () => {
  const text = gridAnswerText(AN_CELLS);
  assert.equal(text, '1 n n(n-1)/2 / 0 1 n / 0 0 1');
  assert.deepEqual(formulaRows(text), AN_CELLS);
  assert.match(actText({ type: 'value', text, answer: AN.answer, right: true, misread: null }), /学生填了「1 n n\(n-1\)\/2 \/ 0 1 n \/ 0 0 1」/);
  // 格里带空格的（学生写 n (n-1)/2、2 n）：去掉不改意思的空格，读回来还是一格、判起来一样
  const spaced = [['1', '2 n'], ['n (n - 1) / 2', '-1']];
  const t2 = gridAnswerText(spaced);
  const back = formulaRows(t2);
  assert.equal(back.length, 2);
  assert.equal(back[0].length, 2);
  assert.equal(back[1].length, 2);
  const s2 = { type: 'matrix', free: 'n', answer: '1 2n / n(n-1)/2 -1' };
  assert.equal(judgeAnswer(spaced, s2).ok, true);
  assert.equal(judgeAnswer(t2, s2).ok, true);
  assert.equal(judgeAnswer(back, s2).ok, true);
});

const AB = () => run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 1 1');
const mx = (answer, wrongs) => ({ type: 'matrix', answer, ...(wrongs ? { wrongs } : {}) });

test('五条现算的常见错答：对上了告诉老师「像是……」', () => {
  const sc = AB();
  const say = (given, answer) => judgeAnswer(given, mx(answer), sc);
  // A B 交成 B A
  const ba = say('1 2 / 4 6', '{A B}');
  assert.equal(ba.ok, false);
  assert.equal(ba.misread, '像是乘反了（算成了 B A）');
  assert.match(say('1 4 / 9 16', '{A^2}').misread, /各自 2 次方/);
  assert.match(say('3 6 / 3 4', '{3 A}').misread, /只乘了第一行/);
  assert.match(say('3 2 / 3 4', '{3 A}').misread, /只乘了一格/);
  assert.match(say('1 1/2 / 1/3 1/4', '{A^-1}').misread, /取了倒数/);
  assert.match(say('4 -2 / -3 1', '{A^-1}').misread, /没除以行列式/);
  assert.match(say('1 2 / 3 4', "{A'}").misread, /没转置/);
  // 对的照样对、别的错答没有说明（页面只认这五种，不猜）
  assert.equal(say('3 2 / 7 4', '{A B}').ok, true);
  assert.equal(say('3 2 / 7 4', '{A B}').misread, null);
  assert.equal(say('9 9 / 9 9', '{A B}').misread, null);
  // 不是方阵的转置：没转置的那张大小都不一样，照样认得出
  const wide = run(new Scene(), 'matrix C = 1 2 3 / 4 5 6');
  assert.match(judgeAnswer('1 2 3 / 4 5 6', mx("{C'}"), wide).misread, /没转置/);
  // 写法：k 是拨数、乘号写出来、上标也认
  const k = run(new Scene(), 'dial k = 3 range=1..5\nmatrix A = 1 2 / 3 4');
  assert.match(judgeAnswer('3 6 / 3 4', mx('{k A}'), k).misread, /只乘了第一行/);
  assert.match(judgeAnswer('1 4 / 9 16', mx('{A²}'), k).misread, /各自 2 次方/);
  assert.match(judgeAnswer('1 1/2 / 1/3 1/4', mx('{A⁻¹}'), k).misread, /取了倒数/);
  assert.match(judgeAnswer('1 2 / 4 6', mx('{A*B}'), sc).misread, /乘反了/);
});

test('现算出来和正确答案一样的那条不要；算不出来的那条跳过', () => {
  // 对称矩阵：没转置和转置了一样
  const sym = run(new Scene(), 'matrix A = 1 2 / 2 1');
  assert.ok(!autoWrongs("{A'}", sym).some((w) => /没转置/.test(w.why)));
  // 学生写 A 本身就是对的，不说「没转置」
  const r = judgeAnswer('1 2 / 2 1', mx("{A'}"), sym);
  assert.equal(r.ok, true);
  assert.equal(r.misread, null);
  // 对角矩阵：每格各自平方和真的平方一样；1 倍：只乘第一行和乘了整张一样
  const diag = run(new Scene(), 'matrix D = 2 0 / 0 3');
  assert.deepEqual(autoWrongs('{D^2}', diag), []);
  assert.ok(!autoWrongs('{1 D}', diag).some((w) => /第一行/.test(w.why)));
  // 行列式是 1：伴随矩阵就是逆，不说「没除以行列式」；有一格是 0，取不了倒数，那条跳过
  const u = run(new Scene(), 'matrix U = 1 1 / 0 1');
  assert.deepEqual(autoWrongs('{U^-1}', u), []);
  const p = run(new Scene(), 'matrix P = 2 1 / 0 1');
  const ws = autoWrongs('{P^-1}', p);
  assert.deepEqual(ws.map((w) => w.why), ['像是伴随矩阵没除以行列式']);
  assert.equal(ws[0].text, '1 -1 / 0 2');
  // 乘反了算不出来（A 是 2×3、B 是 3×4，B A 乘不了）：跳过
  const nm = run(new Scene(), 'matrix A = 1 2 3 / 4 5 6\nmatrix B = 1 0 0 1 / 0 1 0 1 / 0 0 1 1');
  assert.deepEqual(autoWrongs('{A B}', nm), []);
  // 不是这五种、不是 {…}：没有
  const sc = AB();
  assert.deepEqual(autoWrongs('{A + B}', sc), []);
  assert.deepEqual(autoWrongs('1 2 / 3 4', sc), []);
  assert.deepEqual(autoWrongs('{A B}', null), []);
});

test('老师的 wrong= 先比', () => {
  const sc = AB();
  const r = judgeAnswer('1 2 / 3 4', mx("{A'}", '1 2 / 3 4=老师写的'), sc);
  assert.equal(r.ok, false);
  assert.equal(r.misread, '老师写的');
});

test('type=set 的大括号：{1, 5} 只有数和逗号就当数集；学生写 {1,5}、1, 5 都对', () => {
  const sc = AB();
  const spec = { type: 'set', answer: '{1, 5}' };
  assert.doesNotThrow(() => checkSpec(spec, sc));
  assert.doesNotThrow(() => checkSpec(spec));
  for (const g of ['{1,5}', '1, 5', '{5, 1}', '1，5', '1、5', '{1、5}', 'x=1 或 x=5']) assert.equal(judgeAnswer(g, spec, sc).ok, true, g);
  assert.equal(judgeAnswer('1、5', { type: 'set', answer: '{1、5}' }, sc).ok, true);
  // 不等式里的逗号照旧是「且」
  assert.equal(judgeAnswer('x > 1, x < 3', { type: 'set', answer: '(1, 3)' }, sc).ok, true);
  assert.equal(judgeAnswer('{1}', spec, sc).ok, false);
  assert.equal(judgeAnswer('[1, 5]', spec, sc).ok, false);
  assert.equal(judgeAnswer('{-1, 1/2}', { type: 'set', answer: '{-1, 1/2}' }, sc).ok, true);
  assert.equal(sc.check(parseScript('ask value "解是？" type=set answer={1, 5}')[0]), null);
  // 还读不懂（里面有别的）：照实说被当成了式子
  assert.throws(() => checkSpec({ type: 'set', answer: '{1, a}' }, sc), /「\{1, a\}」被当成了式子/);
  // 别的 type 的 {…} 照旧是式子
  assert.throws(() => checkSpec({ type: 'num', answer: '{1, 5}' }, sc));
});

test('重放旧课（lenient）：{…} 算不出来照字面比，不报；新演的照旧报', () => {
  const sc = AB();
  assert.doesNotThrow(() => checkSpec({ answer: '{x y}' }, sc, { strict: false, lenient: true }));
  assert.doesNotThrow(() => checkSpec({ answer: '{x y}', type: 'num' }, sc, { strict: false, lenient: true }));
  assert.equal(judgeAnswer('{x y}', { answer: '{x y}', lenient: true }, sc).ok, true);
  assert.equal(judgeAnswer('{x  Y}', { answer: '{x y}', lenient: true }, sc).ok, true);
  assert.equal(judgeAnswer('x y', { answer: '{x y}', lenient: true }, sc).ok, false);
  // 算得出来的照旧现算
  assert.equal(judgeAnswer('3 2 / 7 4', { type: 'matrix', answer: '{A B}', lenient: true }, sc).ok, true);
  // 不是 lenient：照旧报、照旧没判成
  assert.throws(() => checkSpec({ answer: '{x y}' }, sc, { strict: false }));
  assert.throws(() => checkSpec({ answer: '{x y}' }, sc));
  assert.equal(judgeAnswer('{x y}', { answer: '{x y}' }, sc).ok, null);
  // 舞台上：重放旧课的 ask（lenient）收下，等着的那一问带着 lenient；预写的行（lenient + prewrite）写下时验过了，不照字面
  const s = AB();
  assert.doesNotThrow(() => s.apply({ ...parseScript('ask value "?" answer={x y}')[0], lenient: true }));
  assert.equal(s.waiting.lenient, true);
  assert.equal(judgeAnswer('{x y}', s.waiting, s).ok, true);
  const p = AB();
  p.apply({ ...parseScript('ask value "?" type=matrix answer={A B}')[0], lenient: true, prewrite: true });
  assert.ok(!p.waiting.lenient);
  assert.throws(() => AB().apply(parseScript('ask value "?" answer={x y}')[0]));
});

test('学生那边用什么写：全是数的数字键盘，要打字母、括号、= 的普通键盘，式子配符号小键盘（复核：以前全是数字键盘）', () => {
  const sc = run(new Scene(), 'matrix A = 1 2 / 3 4\narray a = 49 38 65');
  const kind = (spec) => answerInput(spec, sc).kind;
  assert.equal(kind({ type: 'num', answer: '3/4' }), 'decimal');
  assert.equal(kind({ type: 'matrix', answer: '{A^2}' }), 'decimal');
  assert.equal(kind({ answer: '4' }), 'decimal', '不写 type、答案是一个数：数按数比');
  assert.equal(kind({ answer: '{a.3-a.1}' }), 'decimal');
  for (const spec of [{ type: 'en', answer: 'had started' }, { type: 'seq', answer: 'A C B' }, { type: 'equation', answer: 'x + y = 3' }, { type: 'set', answer: '{1, 5}' }, { answer: 'x + 1' }, {}, { type: 'matrix', free: 'n', answer: '1 n 1 1 1 / 0 1 1 1 1 / 0 0 1 1 1 / 0 0 0 1 1 / 0 0 0 0 1' }]) assert.equal(kind(spec), 'text', JSON.stringify(spec));
  assert.deepEqual(answerInput({ type: 'formula', free: 'n', answer: '2n' }, sc), { kind: 'formula', names: ['n'] });
  assert.deepEqual(answerInput({ type: 'matrix', free: 'n', answer: '1 n / 0 1' }, sc), { kind: 'grid', rows: 2, cols: 2, names: ['n'] });
});

test('页面替老师挂的那一问（helpLine）：不带 ""，不动最后说的话', async () => {
  const { helpLine } = await import('../kit/src/stage/stage.js');
  assert.equal(helpLine('', true), 'ask next button="给个提示"');
  assert.doesNotMatch(helpLine('', true), /""/);
  assert.equal(helpLine('', false), 'ask next');
  assert.equal(helpLine('那一问', true), 'ask say "那一问"');
  assert.equal(helpLine('说 "对" 吗', false), 'ask say 「说 "对" 吗」', '照 quoteText 挑引号');
  // 演一遍：最后说的话还在
  const s = run(new Scene(), `array a = 3 1 2\nsay "先看左边"\n${helpLine('', true)}`);
  assert.equal(s.say, '先看左边');
  assert.equal(s.waiting.button, '给个提示');
});

// —— 第三次量（L2 第 6 幕）：按格写的通解（一列、是 free= 变量的一次式）按集合判，不逐格比式子 ——
const LINE = { type: 'matrix', free: 'k=-3..3', answer: '-2+4k / 1-k / k' };

test('复核（第三次量）：按格写的通解换了参数、换了特解的同一条线判对；不在线上的判错并说为什么；页面判不了的不判错', () => {
  // 照答案写：对
  assert.equal(judgeAnswer([['-2+4k'], ['1-k'], ['k']], LINE).ok, true);
  // 报告里理想的那一种：(2, 0, 1) + k(−4, 1, −1)——同一条线，特解换成 x3 = 1 那一点、方向反过来
  const same = judgeAnswer([['2-4k'], ['k'], ['1-k']], LINE);
  assert.equal(same.ok, true, JSON.stringify(same));
  assert.equal(same.misread, null);
  // 方向乘 2、特解换一个点、参数换个名字（t）：都是同一条线
  for (const g of [[['-2+8k'], ['1-2k'], ['2k']], [['6+4k'], ['-1-k'], ['2+k']], [['2-4t'], ['t'], ['1-t']]]) assert.equal(judgeAnswer(g, LINE).ok, true, JSON.stringify(g));
  // 试演里学生打的「2-4k / -k / 1-k」：方向 (−4, −1, −1) 不和 (4, −1, 1) 平行，不在 L 上，判错，告诉老师为什么（不再说「第 1 格代 k = 2 不对」）
  const off = judgeAnswer([['2-4k'], ['-k'], ['1-k']], LINE);
  assert.equal(off.ok, false);
  assert.match(off.misread, /方向/);
  assert.doesNotMatch(off.misread, /第 1 行第 1 格/);
  // 方向对、点不在线上
  const shifted = judgeAnswer([['4k'], ['1-k'], ['k']], LINE);
  assert.equal(shifted.ok, false);
  assert.match(shifted.misread, /方向对/);
  // 只写了一个点（不含参数）：不是整条线
  const pt = judgeAnswer([['2'], ['0'], ['1']], LINE);
  assert.equal(pt.ok, false);
  assert.match(pt.misread, /一个点|不含参数/);
  // 学生写的不是一次式（k²）：页面判不了，不判错（ok 是 null，告诉老师判不了）
  const sq = judgeAnswer([['-2+4k^2'], ['1-k^2'], ['k^2']], LINE);
  assert.equal(sq.ok, null, JSON.stringify(sq));
  assert.match(sq.failed, /页面判不了/);
  // 两个参数的平面：换了基、换了点也对
  const PLANE = { type: 'matrix', free: 'a, b', answer: 'a / b / a+b' };
  assert.equal(judgeAnswer([['a+b'], ['a-b'], ['2a']], PLANE).ok, true);
  assert.equal(judgeAnswer([['a'], ['b'], ['a-b']], PLANE).ok, false);
  assert.match(judgeAnswer([['a'], ['a'], ['2a']], PLANE).misread, /1 维|一条线|维/);
  // 一行的（行向量）也一样
  assert.equal(judgeAnswer([['2-4k', 'k', '1-k']], { type: 'matrix', free: 'k', answer: '-2+4k 1-k k' }).ok, true);
});

test('复核（第三次量）：Aⁿ 这种方阵、不是一次式的列照旧逐格比（n 是有意思的，不是随便取的参数）', () => {
  // 方阵里每格是 n 的一次式（剪切矩阵的 n 次方）：换了参数就是错的
  const SHEAR = { type: 'matrix', free: 'n', answer: '1 n / 0 1' };
  assert.equal(judgeAnswer([['1', '2n'], ['0', '1']], SHEAR).ok, false);
  // 一列、不是一次式（2^n）：照旧逐格比
  const POW = { type: 'matrix', free: 'n', answer: '2^n / n' };
  const r = judgeAnswer([['2^(n+1)'], ['n+1']], POW);
  assert.equal(r.ok, false);
  assert.match(r.misread, /第 1 行第 1 格不对/);
});

test('复核（第三次量）：页面判不了的答案，写给老师「页面判不了」，不进出错记录（不是页面出错）', () => {
  const act = { type: 'value', text: '-2+4k^2 / 1-k^2 / k^2', answer: '-2+4k / 1-k / k', right: null, failed: '页面判不了：x' };
  assert.match(actText(act), /页面判不了：x（不知道对不对，你看着判）/);
  assert.equal(judgeAnswer([['-2+4k^2'], ['1-k^2'], ['k^2']], LINE).undecided, true);
});

test('复核（第三次量，倒退）：矩阵答案的 wrong= 能列一个数的错答（「0=写成数字 0」，第一轮能写）；学生写 0 对上它', () => {
  const sc = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix E = 1 0 / 0 1');
  const spec = { type: 'matrix', answer: '{A^2 - 5 A + 3 E}', wrongs: '0 3 / 3 0=每格加了 3（常数当成数）; 0=写成数字 0' };
  assert.doesNotThrow(() => checkSpec(spec, sc));
  assert.equal(sc.check(parseScript('ask value "f(A) = ？" type=matrix answer={A^2 - 5 A + 3 E} wrong="0=写成数字 0"')[0]), null);
  const r = judgeAnswer('0', spec, sc);
  assert.equal(r.ok, false);
  assert.equal(r.misread, '写成数字 0');
  // 写死的矩阵答案、按格的答案也能列
  assert.doesNotThrow(() => checkSpec({ type: 'matrix', answer: '1 2 / 3 4', wrongs: '0=写成数字 0' }));
  assert.doesNotThrow(() => checkSpec({ type: 'matrix', free: 'n', answer: '1 n / 0 1', wrongs: '0=写成数字 0; 1=当成 1' }));
  assert.equal(judgeAnswer('0', { type: 'matrix', answer: '1 2 / 3 4', wrongs: '0=写成数字 0' }).misread, '写成数字 0');
  // 方程组的答案：学生只写了一个数（x = 3 写成 3）也能列
  assert.doesNotThrow(() => checkSpec({ type: 'equation', answer: 'x = 3', wrongs: '3=只写了数' }));
  assert.equal(judgeAnswer('3', { type: 'equation', answer: 'x = 3', wrongs: '3=只写了数' }).misread, '只写了数');
  // 别的写错的矩阵错答照旧当场报（; 把一条切成了两条）
  assert.throws(() => checkSpec({ type: 'matrix', answer: '1 2 / 3 4', wrongs: '1 2; 3 5=抄错了' }), /2×2|1×2/);
});

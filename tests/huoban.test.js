// 活板的内核（kit/src/huoban/，docs/talk-plan.md）：写法、精确的值、演示过程当对象、句子、替老师找例子、追问
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, parseExpr, applyOps, parseProse } from '../kit/src/huoban/lang.js';
import { Runtime } from '../kit/src/huoban/runtime.js';
import { text, checkAnswer, readAnswer } from '../kit/src/huoban/values.js';

const BELADY = `let refs = 1 2 3 4 1 2 5 1 2 3 4 5
let f = 3 拨 1..6
let r = paging(refs=refs, frames=f, algo=fifo)
FIFO 分 {f} 块，缺页 {r.faults?} 次
draw r at k
let k = r.steps
goal faults(refs, f, fifo) > faults(refs, f - 1, fifo) => "多给一块反而多缺页"`;

test('读写法：let 的手势、一串数、draw 的标签和 at、正文里的四种 {…}', () => {
  const b = parseBoard(BELADY);
  assert.equal(b.errors.length, 0);
  const f = b.cells.get('f');
  assert.deepEqual(f.input, { type: 'scrub', lo: 1, hi: 6, step: 1 });
  assert.equal(b.cells.get('refs').src, '[1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]');
  const draw = b.lines.find((l) => l.kind === 'draw');
  assert.equal(draw.items[0].src, 'r');
  assert.equal(draw.items[0].atSrc, 'k');
  const segs = parseProse('A 把 {x} 送到 {A*x}，几倍？{lam(A, x)?} 对吗 {? 对 | *不对}');
  assert.deepEqual(segs.filter((s) => s.k !== 'text').map((s) => s.k), ['value', 'value', 'blank', 'choice']);
  assert.equal(segs[1].bare, 'x');
  assert.equal(parseBoard('draw A*x "Ax"').lines[0].items[0].label, 'Ax');
  // 演示用字段名写：paging(refs=v, frames=3)
  const call = parseExpr('paging(refs=v, frames=3, algo=fifo)');
  assert.deepEqual(Object.keys(call.named), ['refs', 'frames', 'algo']);
});

test('写错的一行在那一行报出来，不连累别的行', () => {
  const rt = new Runtime();
  const b = rt.load(`let a = 1
let b = foo(a)
draw zz
{? 甲 | 乙}
goal a >
{paging(refs)}
let s = sort(v=1)
看看 {a}`);
  const at = Object.fromEntries(b.errors.map((e) => [e.n, e.msg]));
  assert.match(at[2], /没有函数「foo」/);
  assert.match(at[3], /不认识「zz」/);
  assert.match(at[4], /对的选项前面打 \*/);
  assert.match(at[5], /没写完/);
  assert.match(at[6], /是演示：用字段名写/);
  assert.equal(b.errors.length, 5);
  assert.equal(b.lines.at(-1).kind, 'prose');
  assert.equal(text(rt.value('a + 1')), '2');
});

test('值是精确的：分数、矩阵乘法、逆、特征值；开方算不出精确值时退回小数', () => {
  const rt = new Runtime();
  rt.load(`let A = [[2, 1], [1, 2]]
let x = [1, 0] 拖 吸附 0.5`);
  assert.equal(text(rt.value('A*x')), '(2, 1)');
  assert.equal(text(rt.value('inv(A)')), '[2/3 −1/3; −1/3 2/3]');
  assert.equal(text(rt.value('1/3 + 1/6')), '1/2');
  assert.equal(text(rt.value('eigs(A)')), '(1, 3)');
  assert.equal(rt.value('par(A*x, x)'), false);
  rt.setInput('x', [1, 1]);
  assert.equal(rt.value('par(A*x, x)'), true);
  assert.equal(text(rt.value('lam(A, x)')), '3');
  assert.equal(text(rt.value('A^3')), '[14 13; 13 14]');
  assert.equal(text(rt.value('det(A)')), '3');
  assert.equal(text(rt.value('sqrt(2)')), '1.414');
  assert.equal(text(rt.value('eigs([[0, -1], [1, 0]])')), '');
});

test('演示过程当对象：61 个引擎一个适配器；字段名和组件一样；成员是引擎自己的问题', () => {
  const rt = new Runtime();
  rt.load(BELADY);
  assert.equal(rt.load(BELADY).errors.length, 0);
  assert.equal(text(rt.value('r.faults')), '9');
  assert.equal(rt.value('faults(refs, f, fifo) > faults(refs, f - 1, fifo)'), false);
  rt.setInput('f', 4);
  assert.equal(text(rt.value('r.faults')), '10');
  assert.equal(rt.value('faults(refs, f, fifo) > faults(refs, f - 1, fifo)'), true);
  // 一共几步、第几次换出谁
  assert.equal(text(rt.value('r.steps')), '13');
  assert.ok(Array.isArray(rt.value('r.victim')) || rt.value('r.victim'));
  // 字段写错了，报引擎自己的话
  rt.load('let p = paging(refs=[1, 2], algo=fifo)\n{p.faults}');
  assert.throws(() => rt.value('p'), /paging：.*frames/);
  // 别的门课的演示也一样接
  rt.load('let s = sched(procs="P1 0 5, P2 2 4, P3 4 1", algo=fcfs)');
  assert.ok(rt.value('s.steps'));
  rt.load('let d = disk(requests=[98, 183, 37, 122], head=53, algo=sstf)');
  assert.equal(text(rt.value('d.total')), '162');
});

test('判空：演示的成员用引擎的判法，错了看出像哪种常见错法', () => {
  const rt = new Runtime();
  rt.load(BELADY);
  assert.equal(rt.judge(parseExpr('r.faults'), '9').ok, true);
  const bad = rt.judge(parseExpr('r.faults'), '10');
  assert.equal(bad.ok, false);
  assert.match(bad.misread, /LRU|lru|最近/);
  // 普通的量：分数、两位小数
  rt.load('let a = 1/3');
  assert.equal(rt.judge(parseExpr('a'), '1/3').ok, true);
  assert.equal(rt.judge(parseExpr('a'), '0.33').ok, true);
  assert.equal(rt.judge(parseExpr('a'), '0.3').ok, false);
});

test('学生写的答案：整数、分数、向量、文字', () => {
  assert.equal(text(readAnswer('(1, -2)')), '(1, −2)');
  assert.equal(checkAnswer('2 1', readAnswer('(2,1)')), true);
  assert.equal(checkAnswer('the man is my teacher', 'The man is my teacher.'), true);
  assert.equal(checkAnswer('4', readAnswer('4.0')), true);
});

test('句子：折起几段，剩下的跟着变', () => {
  const rt = new Runtime();
  rt.load('let s = 句子("My brother [, who lives in Nanjing,] is a doctor.")');
  assert.equal(rt.value('s.rest'), 'My brother, who lives in Nanjing, is a doctor.');
  rt.toggleFold('s', 0);
  assert.equal(rt.value('s.rest'), 'My brother is a doctor.');
  assert.equal(rt.value('s.rest == "my brother is a doctor"'), true);
  assert.equal(text(rt.value('s.folded')), '1');
  assert.throws(() => rt.load('let t = 句子("no brackets")') && rt.value('t'), /方括号|\[ \]/);
});

test('find：替老师找一个满足条件的例子（随机里百万分之一的也找得到），找不到说清楚', () => {
  const rt = new Runtime();
  rt.load('let v = find s in 序列(15, 1..6) where faults(s, 4, fifo) > faults(s, 3, fifo)');
  const v = rt.value('v');
  assert.equal(v.length, 15);
  rt.load(`let w = [${v.map(text).join(', ')}]`);
  assert.equal(rt.value('faults(w, 4, fifo) > faults(w, 3, fifo)'), true);
  assert.equal(rt.found.length, 1); // 页面拿它记一笔「页面替老师找了例子」
  assert.ok(rt.found[0].ms < 1500);
  // 矩阵：特征值都是整数、不对称
  rt.load('let M = find m in 矩阵(2, -3..3) where allint(eigs(m)) and len(eigs(m)) == 2 and m != T(m)');
  const M = rt.value('M');
  assert.equal(rt.value('allint(eigs(M))'), true);
  assert.equal(rt.value('M != T(M)'), true);
  // 找不到
  rt.load('let z = find s in 整数(1..3) where s > 5');
  assert.throws(() => rt.value('z'), /找了 \d+ 个都不满足/);
});

test('追问：set 改量、留着原来的手势；别的行接在最后', () => {
  const src = 'let f = 3 拨 1..6\nlet x = [1, 0] 拖\nlet r = paging(refs=refs, frames=f, algo=fifo)';
  const out = applyOps(src, 'set f = 4\nset x = [0, 1]\nset alg = lru\n多给一块？');
  assert.equal(out, 'let f = 4 拨 1..6\nlet x = [0, 1] 拖\nlet r = paging(refs=refs, frames=f, algo=fifo)\nlet alg = lru\n多给一块？');
  assert.equal(applyOps('', '你好'), '你好');
  // 学生拨过的值：set 改了初值就按新的；没改的留着
  const rt = new Runtime();
  rt.load('let f = 3 拨 1..6\nlet g = 1 拨 1..6');
  rt.setInput('f', 5); rt.setInput('g', 2);
  rt.load(applyOps(rt.src, 'set f = 4'));
  assert.equal(text(rt.value('f')), '4');
  assert.equal(text(rt.value('g')), '2');
});

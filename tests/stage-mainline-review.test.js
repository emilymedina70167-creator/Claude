// 舞台主线第一轮：整条分支最后一审找到的（docs/superpowers/specs/2026-11-11-stage-mainline-1-rulings.md「最后一审」）。
// 多数是「重放」的事：刷新、撤一步、再看一遍、作废一轮都照 log 重放，每一行带 lenient + replay。新加的当场报不能让旧课翻不开，
// 新加的收拾（同名重造收字）重放时也要照做，不然刷新前后不一样
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript, parseRich } from '../kit/src/stage/script.js';
import { treeRules } from '../kit/src/stage/types/tree.rules.js';

const REPLAY = { lenient: true, replay: true };
const run = (s, src, extra = {}, opt) => parseScript(src).map((c) => { try { s.apply({ ...c, ...extra }, opt); return null; } catch (e) { return `${c.src.trim()} → ${e.message}`; } }).filter(Boolean);
const values = (s, id) => [...s.objects.get(id).cells].sort((x, y) => x.slot - y.slot).map((c) => c.value);

test('S1：重放旧课，dial … at= 写的部件不在：照旧收下（当成还没造），后面跟着它算的照演', () => {
  const s = new Scene();
  assert.deepEqual(run(s, 'array a = 1 2 3\ndial d = 1 range=1..5 at=a.9\narray b = {d} 3', REPLAY), []);
  assert.ok(s.vars.has('d') && s.objects.has('b'));
  // 新写的照旧当场报
  assert.equal(run(new Scene(), 'array a = 1 2 3\ndial d = 1 range=1..5 at=a.9').length, 1);
});

test('S2：一排格子里同时有 _（空格子，主线第二轮 A）和 {…}：造得出来；之后跟着拨数重算也不报；重放一样', () => {
  const s = new Scene();
  assert.deepEqual(run(s, 'dial k = 1 range=1..5\narray h = _ {k} 38', REPLAY), []);
  assert.deepEqual(values(s, 'h'), ['', '1', '38']);
  assert.deepEqual(run(s, 'set k 4', REPLAY), []);
  assert.deepEqual(values(s, 'h'), ['', '4', '38']);
  // 新写的一样
  const n = new Scene();
  assert.deepEqual(run(n, 'dial k = 1 range=1..5\narray h = _ {k} 38\nset k 4'), []);
  assert.deepEqual(values(n, 'h'), ['', '4', '38']);
});

test('Y1：原样取部件的字只用在一排格子上——图的边权、树的结点照旧按数写（1/2 → 0.5、49′ → 49、09 → 9）', () => {
  const s = new Scene();
  assert.deepEqual(run(s, 'matrix M = 2 1 / 0 1\ngraph g = A-B:{M.1,1} B-C:3\nwrite M.1,1 1/2'), []);
  assert.equal(String(s.objects.get('g').edges.find((e) => e.a === 'A' && e.b === 'B').w), '0.5');
  assert.deepEqual(run(new Scene(), 'array a = 3 49′\ngraph g = A-B:{a.1} B-C:{a.2}'), []);
  const t = new Scene();
  assert.deepEqual(run(t, 'array a = 09 5\ntree t = {a.1} {a.2}\nglow t.9'), []);
  // 一排格子照这一轮改的：照原来的字
  const b = new Scene();
  run(b, 'array b = 49′ 09\narray c = {b.1} {b.2}');
  assert.deepEqual(values(b, 'c'), ['49′', '09']);
  // 重放旧课的一排格子：照旧按数写（当时画的就是 49、9）
  const o = new Scene();
  run(o, 'array b = 49′ 09\narray c = {b.1} {b.2}', REPLAY);
  assert.deepEqual(values(o, 'c'), ['49', '9']);
});

test('Y2：新课重放（刷新、撤一步）以后 fly say.N 飞的还是那个词；旧课里数不到的词照旧的读法找', () => {
  const src = 'array a = 49 38 65\nsay "比较 A[j] 和 A[j+dk]，这种排序叫 [希尔排序]"\nfly say.1 -> key a.1';
  const live = new Scene(); run(live, src);
  const again = new Scene(); assert.deepEqual(run(again, src, REPLAY), []);
  assert.equal(live.labels.get('key').text, '希尔排序');
  assert.equal(again.labels.get('key').text, '希尔排序');
  // 旧课：那时 [i] 也算一个词，fly say.2 指的是 [哨兵]
  const old = new Scene();
  assert.deepEqual(run(old, 'array a = 1 2\nsay "A[i] 和 [哨兵]"\nfly say.2 -> k a.1', REPLAY), []);
  assert.equal(old.labels.get('k').text, '哨兵');
});

test('Y3：同名重造收掉贴在旧部件上的字，重放时一样收（刷新前后一样）；重放不再告诉老师一遍', () => {
  const src = 'array a = 49 38 65\nlabel st a.1 "站定"\narray a = 13 27 49';
  const live = new Scene(); run(live, src);
  const again = new Scene(); run(again, src, REPLAY);
  assert.deepEqual([...live.labels.keys()], []);
  assert.deepEqual([...again.labels.keys()], []);
  assert.equal(live.looseProblems().length, 1);
  assert.equal(again.looseProblems().length, 0);
});

test('Y4：老师造的是排序树（或空树）：学生摆错一个以后照旧每一下都判；老师造的就不是排序树（堆）才不判', () => {
  const s = new Scene();
  run(s, 'tree t = 50 30 70 tray="40 60 20"\nopen t place wrong=mark');
  const o = () => s.objects.get('t');
  const key = (v) => o().nodes.find((n) => n.value === String(v)).key;
  const put = (v, at, side) => { const c = parseScript(`insert t#${key(at)} ${side} ${v}`)[0]; const j = treeRules.check(o(), { type: 'insert', value: String(v), parent: key(at), side }, s, { open: 'place' }); s.apply(c, { by: 'student', open: 'place' }); return j; };
  assert.equal(put(40, 70, 'right').right, false);
  assert.equal(put(60, 70, 'left').right, true, '摆错一个以后，摆对的还是判对');
  assert.equal(put(20, 30, 'right').right, false, '摆错的还是判错');
  // 堆：老师造出来就不是排序树
  const h = new Scene();
  run(h, 'tree t = 87 45 78 32 17 65 53 09 tray="63"\nopen t place');
  const ho = h.objects.get('t');
  assert.equal(treeRules.check(ho, { type: 'insert', value: '63', parent: ho.nodes.find((n) => n.value === '32').key, side: 'right' }, h, { open: 'place' }).right, null);
});

test('Y5：beside= 重写一次留在原处，只在挨着的那样东西也还在原处时；它挪了就照新的地方摆', () => {
  const s = new Scene();
  run(s, 'matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1 beside=A\narray z = 1 2 3\nremove A\nmatrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1 beside=A');
  const A = s.objectBox('A'), B = s.objectBox('B');
  assert.ok(Math.abs((A.y + A.h / 2) - (B.y + B.h / 2)) < 30, `B 在 A 旁边（A.y=${A.y} B.y=${B.y}）`);
});

test('Y6：整张一个 {} 算出来是数的报错，不再教一个不管用的写法（引号里的 {带运算的式子} 页面不算）', () => {
  const s = new Scene();
  run(s, 'matrix A = 1 2 / 3 4');
  const m = dryRun(s, 'matrix S = {det(A) - 2}')[0].error;
  assert.doesNotMatch(m, /贴一行字就行/);
  assert.match(m, /要矩阵里的一格跟着算，写 matrix M = 1 \{k\} \/ 0 1/);
  assert.match(m, /话和贴的字里的 \{…\} 只认拨数、部件和量/);
});

test('X2：挑战跟着的全是藏着的矩阵的乘积：学生动不了，照旧拦', () => {
  const s = new Scene();
  run(s, 'matrix A = 1 2 / 3 4 hide=on\nmatrix B = 1 0 / 0 1 hide=on\nproduct C = A B');
  assert.match(dryRun(s, 'goal g1 "让左上角变成 7" when="C.1,1 = 7"')[0].error, /藏着，学生看不见/);
});

test('X3：重放旧课，span … stay 钉到第 7 条不抛错（换掉最早的一条）；新写的照旧报', () => {
  const s = new Scene();
  run(s, 'plane p range=-3..3');
  const lines = Array.from({ length: 7 }, (_, i) => `vec p u = ${i + 1} 1\nspan p u stay`).join('\n');
  assert.deepEqual(run(s, lines, REPLAY), []);
  assert.equal(s.objects.get('p').spans.filter((x) => x.at).length, 6);
  const t = new Scene();
  run(t, 'plane p range=-3..3');
  assert.equal(run(t, lines).length, 1);
});

test('X6：unlabel 一行字，贴在它上面的字一起收', () => {
  const s = new Scene();
  run(s, 'array a = 1 2\nlabel n a "计数"\nlabel m n "贴在 n 上"\nlabel k a "别的"\nunlabel n');
  assert.deepEqual([...s.labels.keys()], ['k']);
});

test('X8：方括号的新读法不吃掉挨着的词——挨着写的两个词、贴在数字和右括号后面的中文词都还是能飞的词', () => {
  const words = (t) => parseRich(t).filter((p) => p.k === 'word').map((p) => p.v);
  assert.deepEqual(words('[稳定][不稳定]'), ['稳定', '不稳定']);
  assert.deepEqual(words('步骤1[分组]'), ['分组']);
  assert.deepEqual(words('复杂度 O(n)[线性]'), ['线性']);
  // 代码的下标照旧原样画
  assert.deepEqual(words('a[1][2] 和 A[j+dk]、A[i]、f(x)[0]、A[____]'), []);
});

test('X12：compare 两样不同种的东西，报错不说「矩阵不能整样比」', () => {
  const s = new Scene();
  run(s, 'matrix A = 1 2 / 3 4\narray a = 1 2');
  const m = dryRun(s, 'compare A a')[0].error;
  assert.doesNotMatch(m, /矩阵不能整/);
  assert.match(m, /compare 比的是两个部件.*或者两张矩阵/);
});

test('页面自己定边的字（hop 的字）换了边，不说成「写的是上面，放不下」；老师写了 side= 的才说', () => {
  const s = new Scene();
  run(s, 'array a = 1 2 3 4 5 6\nhop a.1 -> a.6 label="隔 5 个"\nlabel r a "规则" side=above');
  for (const l of s.labels.values()) l.placed = 'below';
  const st = s.stateText();
  assert.match(st, /r「规则」（贴在 a；写的是上面，放不下，在下面）/);
  assert.doesNotMatch(st, /隔 5 个」（[^）]*写的是/);
});

test('同名重造以后同一轮里又 open 了：不再说「交给学生的动作收了」（只说收了的字；都没有就不说）', () => {
  const s = new Scene();
  run(s, 'tree t = 50 30 70 tray="60"\nopen t insert\nlabel q t.30 "这个"');
  s.looseProblems();
  run(s, 'tree t = 23 15 34 tray="98"\nopen t insert wrong=block');
  const told = s.looseProblems();
  assert.equal(told.length, 1);
  assert.match(told[0].error, /重造了 t：贴在旧部件上的字（q）都收了/);
  assert.doesNotMatch(told[0].error, /交给学生的动作|再写一次 open/);
  // 没有字、又重新 open 了：什么都不说
  run(s, 'tree t = 1 2 3\nopen t insert');
  assert.deepEqual(s.looseProblems(), []);
  // 没重新 open 的照旧说
  run(s, 'tree t = 4 5 6');
  assert.match(s.looseProblems()[0].error, /交给学生的动作（open t insert）都收了。要学生接着动，再写一次 open/);
});

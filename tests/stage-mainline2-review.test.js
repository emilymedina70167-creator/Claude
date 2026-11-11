// 舞台主线第二轮：最后一审抓到的（严重 3、要紧 5、小的几条），一条一个最小的重现
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript, parseRich } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { gestureOf } from '../kit/src/stage/rules.js';

const run = (s, src, extra = {}) => { for (const c of parseScript(src)) s.apply({ ...c, ...extra }); return s; };
const make = (src) => run(new Scene(), src);
const stu = (s, src, open) => s.apply(parseScript(src)[0], { by: 'student', open });
const wordsOf = (s, id) => [...s.objects.get(id).words].sort((a, b) => a.slot - b.slot).map((w) => w.value).join(' ');
const T = 'dial t = 现在 options="过去 现在 将来"\nsentence s = "I {t: was holding | am holding | will be holding} it steady."';

test('严重 1：回到存档点以后，跟着拨盘的句子照现在的拨盘重排（不留一句和拨盘对不上、现状还说跟着的）', () => {
  const s = make(`${T}\nkeep s "起"\nset t 将来`);
  const fx = s.apply(parseScript('back s "起"')[0]);
  assert.equal(wordsOf(s, 's'), 'I will be holding it steady');
  assert.match(s.stateText(), /现在是「will be holding」/);
  // 画面照 rewrite 演（交出那一份）
  assert.ok((fx.binds || []).some((b) => b.id === 's' && b.choreo === 'rewrite'));
  // 拨盘没变过：回去就是存的样子，不多演
  const same = make(`${T}\nkeep s "起"\nopen s mark`);
  stu(same, 'mark s.2-3 V', 'mark');
  assert.equal(same.apply(parseScript('back s "起"')[0]).binds, undefined);
});

test('严重 2：有向图上选边的事实不说「是一棵生成树」，成圈写明是不看箭头', () => {
  const s = make('graph g = A>B A>C B>C\nopen g choose');
  stu(s, 'choose g.A~B', 'choose');
  const b = stu(s, 'choose g.A~C', 'choose');
  assert.doesNotMatch(b.judged.after.join('；'), /生成树/);
  const c = stu(s, 'choose g.B~C', 'choose');
  assert.match(c.judged.after.join('；'), /不看箭头的话成圈了/);
  assert.doesNotMatch(c.judged.after.join('；'), /^成圈了|；成圈了/);
  // 无向图照旧
  const u = make('graph g = A-B A-C B-C\nopen g choose\nchoose g.A~B g.A~C');
  assert.match(stu(u, 'choose g.B~C', 'choose').judged.after.join('；'), /^成圈了：/);
});

test('严重 3：compare 碰到空格子当场报，不画大于小于号；重放照旧', () => {
  const s = make('array a = 3 _ 2 0');
  assert.match(dryRun(s, 'compare a.1 a.2')[0].error, /a\.2 还空着/);
  assert.match(dryRun(s, 'compare a.2 a.3')[0].error, /a\.2 还空着/);
  assert.equal(dryRun(s, 'compare a.1 a.3').length, 0);
  assert.doesNotThrow(() => run(s.clone(), 'compare a.1 a.2', { lenient: true, replay: true }));
});

test('要紧 4：拨词的拨盘当平面上的系数：当场报，不默默当成第几个', () => {
  const s = make('dial t = 现在 options="过去 现在 将来"\nplane p\nvec p u = 1 2');
  assert.match(dryRun(s, 'vec p w = t u')[0].error, /拨词的拨盘/);
  assert.equal(dryRun(make('dial k = 2 range=1..3\nplane p\nvec p u = 1 2'), 'vec p w = k u').length, 0);
});

test('要紧 5：open h edit（一排格子只有键盘）写满了算做完，不用另写 input=keypad', () => {
  const s = make('array h = _ _ 5\nopen h edit');
  assert.equal(s.fillOpen('h'), true);
  stu(s, 'write h.1 3', 'edit');
  const fx = stu(s, 'write h.2 4', 'edit');
  assert.deepEqual(fx.done, ['h']);
  // 矩阵的 ± 拨数器照旧不算（没有「写满」这回事）
  assert.equal(make('matrix M = _ 2 / 3 4\nopen M edit').fillOpen('M'), false);
});

test('要紧 6：边权跟着拨数算的图也能交给学生选边、编访问号、写旁边的数', () => {
  const s = make('dial w = 4 range=1-9\ngraph g = A-B:{w} A-C:2 B-C:1');
  for (const a of ['choose', 'visit', 'tag']) assert.equal(dryRun(s, `open g ${a}`).length, 0, a);
});

test('要紧 7：指着 {…} 那一整段的箭头跟着那一段走（和括号、折一样）；只指着半段的收掉', () => {
  const s = make(`${T}\nmark s.2-3 V\nrefer s.5 -> s.2-3`);
  run(s, 'set t 将来');
  const o = s.objects.get('s');
  const val = (k) => o.words.find((w) => w.key === k)?.value;
  assert.equal(o.refers.length, 1);
  assert.deepEqual(o.refers[0].toKeys.map(val), ['will', 'be', 'holding']);
  // 指着一个被换掉的词（am）：这个词没了，箭头收掉
  const h = make(`${T}\nrefer s.5 -> s.2`);
  run(h, 'set t 将来');
  assert.equal(h.objects.get('s').refers.length, 0);
});

test('要紧 8：options= 的词里有 =、引号当场报（学生一拨交的 set c k=1 读不成）', () => {
  assert.match(dryRun(new Scene(), 'dial c options="k=0 k=1"')[0].error, /词里不能有 =/);
  assert.equal(dryRun(new Scene(), 'dial c options="k是0 k是1"').length, 0);
});

test('小：公式 $…$ 里的 {x: … | …} 不当「挑一段」；拨盘同名重造也查题卡；键盘写 1/0 不收；只开一个结点 / 一条边照部件的种类报', () => {
  assert.deepEqual(parseRich('解集 $\\{x: Ax = 0 | x \\ne 0\\}$ 非空').map((p) => p.k), ['text', 'math', 'text']);
  assert.deepEqual(parseRich('{t: a | b} 和 $y$').map((p) => p.k), ['pick', 'text', 'math']);
  const s = make('dial t = 现在 options="过去 现在 将来"\ncard c = "时间：{t: 甲 | 乙 | 丙}"');
  assert.match(dryRun(s, 'dial t = a options="a b"')[0].error, /题卡 c[^\n]*写了 3 段/);
  const a = make('array h = _ 2\nopen h edit');
  const h = a.objects.get('h');
  assert.match(gestureOf(h, 'edit').toAct(h, { to: h.cells[0], value: '1/0' }).error, /不是数/);
  const g = make('graph g = A-B:4 B-C:1');
  assert.match(dryRun(g, 'open g.A choose')[0].error, /choose 点的是边/);
  assert.match(dryRun(g, 'open g.A~B tag')[0].error, /tag 点的是结点/);
  assert.equal(dryRun(g, 'open g.A~B choose').length, 0);
});

test('旧课重放量出来的：矩阵的格跟着一排格子里的空格子（挖坑：write a.1 _）先空着、填上了跟着算出来，不整行报错', () => {
  const s = make('array a = 46 79 56\nwrite a.1 _\nmatrix R = {a.1} {a.2} {a.3}');
  assert.match(s.stateText(), /第 1 行：□ +79 +56/);
  assert.match(s.stateText(), /还空着：R\.1,1（跟着算的/);
  run(s, 'write a.1 38');
  assert.match(s.stateText(), /第 1 行：38 +79 +56/);
});

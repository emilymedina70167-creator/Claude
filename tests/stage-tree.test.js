// 舞台上的树（kit/src/stage/types/tree.js）：造、排版、部件的写法、每个指令改了什么、给老师看的现状、说明里的写法照抄能演
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { tree, layoutTree, buildLevel, serialize, levelOrder, traversal, treePath, imbalance, NODE, SEP, LEVEL } from '../kit/src/stage/types/tree.js';

const run = (scene, src) => { for (const c of parseScript(src)) scene.apply(c); return scene; };
const make = (src) => run(new Scene(), src);
const T = (s, id = 't') => s.objects.get(id);
const at = (o, v) => o.nodes.find((n) => n.value === String(v));
const kid = (o, v, side) => { const k = at(o, v)[side]; return k == null ? null : o.nodes.find((n) => n.key === k).value; };
const err = (s, line) => dryRun(s, line)[0]?.error;
const BASE = 'tree t = 50 30 70 20 40 _ 80';

test('造：按层序，_ 是空、空的下面不用再写；结点按层序编号；写回层序和原来一样', () => {
  const s = make(BASE);
  const o = T(s);
  assert.equal(o.nodes.find((n) => n.key === o.root).value, '50');
  assert.deepEqual([kid(o, 50, 'left'), kid(o, 50, 'right'), kid(o, 30, 'left'), kid(o, 30, 'right'), kid(o, 70, 'left'), kid(o, 70, 'right')], ['30', '70', '20', '40', null, '80']);
  assert.deepEqual(levelOrder(o).map((n) => n.key), [1, 2, 3, 4, 5, 6], '#k 是层序第 k 个');
  assert.equal(serialize(o), '50 30 70 20 40 _ 80');
  // 空的下面不用再写：70 的左边空着，80 的孩子直接接着写
  const t2 = T(make('tree t = 1 2 3 _ 4 _ 5 6'));
  assert.equal(kid(t2, 2, 'left'), null);
  assert.equal(kid(t2, 4, 'left'), '6', '6 挂在下一个结点 4 下面，不用给 2 的空左孩子写 _ _');
  // 照顺序存储写（空位的孩子也写 _）也认
  const t3 = T(make('tree t = 1 _ 2 _ _ 3'));
  assert.equal(kid(t3, 2, 'left'), '3');
  // 空树
  const e = T(make('tree t = _'));
  assert.equal(e.root, null);
  assert.equal(serialize(e), '_');
});

test('造写错了说清楚怎么写', () => {
  const s = new Scene();
  assert.match(err(s, 'tree t 50 30'), /要写成 tree 名字 = 按层序的值/);
  assert.match(err(s, 'tree t ='), /tree 后面要有值/);
  assert.match(err(s, 'tree t = _ 1 2'), /第一个是根，不能是 _/);
  assert.match(err(s, 'tree t = 1 _ _ 2'), /有的值没地方挂/);
  assert.match(err(s, `tree t = ${Array.from({ length: 32 }, (_, i) => i).join(' ')}`), /最多 31 个结点/);
  assert.match(err(s, 'tree t = 1 _ 2 _ 3 _ 4 _ 5 _ 6 _ 7 _ 8 _ 9'), /最多 8 层/);
  assert.throws(() => buildLevel(['_', '1']), /不能是 _/);
});

test('排版：同一层隔开至少 SEP，左子树整个在左边、右子树整个在右边（二叉排序树从左到右就是从小到大）', () => {
  const rnd = ((a) => () => { a = (a * 1103515245 + 12345) % 2 ** 31; return a / 2 ** 31; })(7);
  for (let k = 0; k < 40; k++) {
    const s = make('tree t = 50');
    const used = new Set([50]);
    for (let i = 0; i < 14; i++) {
      const v = Math.floor(rnd() * 100);
      if (used.has(v)) continue;
      used.add(v);
      if (dryRun(s, `insert t ${v}`).length) continue; // 太深的跳过
      run(s, `insert t ${v}`);
    }
    const o = T(s);
    const pos = layoutTree(o);
    const nodes = [...o.nodes].sort((a, b) => Number(a.value) - Number(b.value));
    for (let i = 1; i < nodes.length; i++) assert.ok(pos.get(nodes[i].key).x > pos.get(nodes[i - 1].key).x, '从左到右从小到大');
    const rows = new Map();
    for (const n of o.nodes) { const p = pos.get(n.key); if (!rows.has(p.y)) rows.set(p.y, []); rows.get(p.y).push(p.x); }
    for (const xs of rows.values()) { xs.sort((a, b) => a - b); for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= SEP - 1e-9, '同一层不挤'); }
    for (const n of o.nodes) for (const side of ['left', 'right']) if (n[side] != null) {
      const p = pos.get(n.key), c = pos.get(n[side]);
      assert.equal(c.y, p.y + LEVEL);
      assert.ok(side === 'left' ? c.x < p.x : c.x > p.x);
      assert.equal(c.side, side);
    }
  }
  // 完全二叉树对称、紧凑：最下面一层正好隔 SEP
  const full = layoutTree(T(make('tree t = 1 2 3 4 5 6 7')));
  assert.deepEqual([4, 5, 6, 7].map((k) => full.get(k).x), [-1.5, -0.5, 0.5, 1.5].map((v) => v * SEP));
  // 两棵树上下摆开不重叠
  const s2 = make(`${BASE}\ntree u = 1 2 3`);
  const A = tree.objectBox(T(s2)), B = tree.objectBox(T(s2, 'u'));
  assert.ok(B.y > A.y + A.h);
  assert.equal(tree.partBox(T(s2), at(T(s2), 50)).w, NODE);
});

test('部件的写法：t.40 按值、t#3 按层序、t.30* 整棵子树；写错了说清楚', () => {
  const s = make(BASE);
  assert.deepEqual(s.parts('t.40').map((p) => p.value), ['40']);
  assert.deepEqual(s.parts('t#3').map((p) => p.value), ['70']);
  assert.deepEqual(s.parts('t.30*').map((p) => p.value), ['30', '20', '40']);
  assert.deepEqual(s.parts('t#3*').map((p) => p.value), ['70', '80']);
  assert.equal(s.parts('t').length, 6);
  assert.throws(() => s.parts('t.99'), /t 里没有值是 99 的结点（有：50 30 70 20 40 80）/);
  assert.throws(() => s.parts('t.3'), /要层序第 3 个写 t#3/);
  assert.throws(() => s.parts('t#9'), /t 没有 #9 这个结点/);
  assert.throws(() => s.parts('t#x'), /树的结点写 t\.40/);
  // 值有重复：要写 t#k；话里、记录里也写 t#k
  const d = make('tree t = 5 3 5');
  assert.throws(() => d.parts('t.5'), /t 里有 2 个 5（#1、#3），写 t#1/);
  assert.equal(d.refOf(d.parts('t#3')[0]), 't#3');
  assert.equal(s.refOf(s.parts('t#3')[0]), 't.70');
  // 话里指着不存在的结点挡下
  assert.match(err(s, 'say "看 {t.99}"'), /没有值是 99/);
  // 别的东西没有树的指令；树也没有一排格子的指令
  const m = make(`${BASE}\narray a = 1 2 3`);
  assert.match(err(m, 'tag a.1 x'), /一排格子没有「tag」（树、图才有）/);
  assert.match(err(m, 'hop t.50 -> t.30'), /树没有「hop」/);
  assert.match(err(new Scene(), 'insert t 35'), /舞台上没有「t」/);
});

test('二叉排序树插入：从根比下去，记下走过的路和每一步比出来的大小，长在空位；一样的值、指定位置写错都挡下', () => {
  const s = make(BASE);
  const fx = s.apply(parseScript('insert t 35')[0]);
  const o = T(s);
  assert.deepEqual(fx.path.map((k) => o.nodes.find((n) => n.key === k).value), ['50', '30', '40']);
  assert.deepEqual(fx.cmps, [-1, 1, -1]);
  assert.equal(fx.key, 7, '新结点接着编号');
  assert.equal(kid(o, 40, 'left'), '35');
  assert.match(err(s, 'insert t 35'), /35 已经在树里了/);
  assert.match(err(s, 'insert t'), /要写成 insert t 35/);
  assert.match(err(s, 'insert t 1 2'), /一次一个值/);
  assert.match(err(s, 'insert t 36 left'), /要指定位置写 insert t\.某个结点 left 36/);
  // 直接长在某个结点的哪一边
  run(s, 'insert t.80 left 75');
  assert.equal(kid(o, 80, 'left'), '75');
  assert.match(err(s, 'insert t.80 left 76'), /80 的左边已经有 75 了/);
  assert.match(err(s, 'insert t.80 77'), /要写长在哪边/);
  // 空树插第一个就是根
  const e = make('tree t = _\ninsert t 8');
  assert.equal(T(e).nodes[0].value, '8');
  assert.equal(T(e).root, T(e).nodes[0].key);
});

test('append：接在层序最后（堆的插入）；swap 换值（结点不动）；write 改值', () => {
  const s = make('tree h = 10 20 30 40');
  run(s, 'append h 5');
  const o = T(s, 'h');
  assert.equal(serialize(o), '10 20 30 40 5');
  run(s, 'append h 6');
  assert.equal(serialize(o), '10 20 30 40 5 6');
  const before = o.nodes.map((n) => [n.key, n.left, n.right]);
  const fx = s.apply(parseScript('swap h.5 h.20')[0]);
  assert.equal(fx.a.value, '20');
  assert.equal(serialize(o), '10 5 30 40 20 6');
  assert.deepEqual(o.nodes.map((n) => [n.key, n.left, n.right]), before, '结构不动，只换值');
  assert.equal(s.refOf(s.parts('h#2')[0]), 'h.5', '#2 还是第 2 个位置，值换成了 5');
  run(s, 'write h#1 99');
  assert.equal(serialize(o), '99 5 30 40 20 6');
  assert.match(err(s, 'swap h.5'), /swap 要正好两个结点（写了 1 个）/);
  assert.match(err(s, 'swap h.5 h.5'), /同一个结点/);
  assert.match(err(s, 'write h.5'), /要写成 write t\.40 45/);
});

test('删除：叶子直接拿掉、一个孩子顶上来、两个孩子用中序后继（或前驱）的值顶上；连着它的线、贴着它的字收掉', () => {
  let s = make(`${BASE}\nlink t.20 t.80\nlabel x t.20 "叶子"`);
  let fx = s.apply(parseScript('delete t.20')[0]);
  assert.equal(fx.case, 'leaf');
  assert.equal(serialize(T(s)), '50 30 70 _ 40 _ 80');
  assert.equal(s.links.size, 0);
  assert.equal(s.labels.has('x'), false);
  fx = s.apply(parseScript('delete t.70')[0]);
  assert.equal(fx.case, 'one');
  assert.equal(serialize(T(s)), '50 30 80 _ 40');
  s = make('tree t = 50 30 70 20 40 60 80 _ _ 35 45 _ 65');
  fx = s.apply(parseScript('delete t.50')[0]);
  assert.equal(fx.case, 'two');
  assert.equal(fx.value, '60');
  assert.equal(fx.key, 1, '根这个结点留着，换成后继的值');
  assert.deepEqual(fx.path.map((k) => k), [3, 6], '先往右一步，再一路往左');
  assert.equal(serialize(T(s)), '60 30 70 20 40 65 80 _ _ 35 45');
  s = make('tree t = 50 30 70 20 40 60 80 _ _ 35 45');
  run(s, 'delete t.50 by=pred');
  assert.equal(serialize(T(s)), '45 30 70 20 40 60 80 _ _ 35');
  assert.match(err(s, 'delete t.30 by=x'), /by 写 succ/);
  assert.match(err(s, 'delete t.30*'), /一次删一个结点/);
  // 只剩一个结点再删就是空树
  const one = make('tree t = 1\ndelete t.1');
  assert.equal(T(one).root, null);
});

test('查找：找到了停在那个结点，找不到记下停在谁的哪一边', () => {
  const s = make(BASE);
  let fx = s.apply(parseScript('search t 40')[0]);
  assert.equal(fx.found, 5);
  assert.deepEqual(fx.cmps, [-1, 1, 0]);
  fx = s.apply(parseScript('search t 65')[0]);
  assert.equal(fx.found, null);
  assert.equal(fx.parent, 3);
  assert.equal(fx.side, 'left');
  assert.match(err(s, 'search t.50 40'), /search 写整棵树/);
  assert.match(err(make('tree t = _'), 'search t 1'), /空树/);
});

test('旋转：右旋、左旋，王道的 LL / RR / LR / RL；没有孩子转不了', () => {
  // LL：右旋 A
  let s = make('tree t = 30 20 _ 10');
  run(s, 'rotate t.30 LL');
  assert.equal(serialize(T(s)), '20 10 30');
  // RR：左旋 A
  s = make('tree t = 10 _ 20 _ 30');
  run(s, 'rotate t.10 RR');
  assert.equal(serialize(T(s)), '20 10 30');
  // LR：先左旋 A 的左孩子，再右旋 A
  s = make('tree t = 30 10 _ _ 20');
  const fx = s.apply(parseScript('rotate t.30 LR')[0]);
  assert.equal(serialize(T(s)), '20 10 30');
  assert.equal(fx.steps.length, 2);
  assert.deepEqual(fx.steps.map((x) => x.dir), ['left', 'right']);
  // RL
  s = make('tree t = 10 _ 30 20');
  run(s, 'rotate t.10 RL');
  assert.equal(serialize(T(s)), '20 10 30');
  // 中间那棵子树换父结点：右旋 50，30 的右子树 40 挂到 50 的左边
  s = make(`${BASE}\nrotate t.50 right`);
  assert.equal(serialize(T(s)), '30 20 50 _ _ 40 70 _ _ _ 80');
  assert.match(err(s, 'rotate t.20 right'), /20 没有左孩子，右旋转不了/);
  assert.match(err(s, 'rotate t.50 LR'), /LR 型：50 的左孩子 40 没有右孩子/);
  assert.match(err(s, 'rotate t.50 up'), /rotate 后面写 right/);
  assert.equal(err(s, 'rotate t.50 Left'), undefined, '大小写都认');
});

test('平衡因子：bf 打开以后现状里写出每个结点的平衡因子、最小不平衡子树的根和它是哪一型', () => {
  const s = make(`${BASE}\nbf t\ninsert t 35\ninsert t 33`);
  const o = T(s);
  assert.deepEqual(imbalance(o), { key: 5, bf: 2, kind: 'LL' });
  assert.match(s.stateText(), /平衡因子：50 \+2，30 −2，70 −1/);
  assert.match(s.stateText(), /失衡：最小不平衡子树的根是 40，LL 型/);
  run(s, 'rotate t.40 LL');
  assert.match(s.stateText(), /（都平衡）/);
  run(s, 'unbf t');
  assert.doesNotMatch(s.stateText(), /平衡因子/);
  assert.deepEqual(imbalance(T(make('tree t = 30 10 _ _ 20'))), { key: 1, bf: 2, kind: 'LR' });
});

test('沿着走：两个不相邻的结点之间经过最近的公共祖先', () => {
  const s = make(BASE);
  const o = T(s);
  assert.deepEqual(treePath(o, 4, 6), [4, 2, 1, 3, 6]);
  const fx = s.apply(parseScript('walk t.20 t.40 t.80')[0]);
  assert.deepEqual(fx.path, [4, 2, 5, 2, 1, 3, 6]);
  assert.deepEqual(fx.stops, [4, 5, 6]);
  assert.match(err(s, 'walk t.20 t.99'), /没有值是 99/);
});

test('访问号：visit 按顺序编号、记着上一个访问的；访问过的再访问挡下；unvisit 清掉', () => {
  const s = make(BASE);
  let fx = s.apply(parseScript('visit t.50 t.30')[0]);
  assert.deepEqual(fx.keys, [1, 2]);
  assert.equal(fx.from, null);
  fx = s.apply(parseScript('visit t.20')[0]);
  assert.equal(fx.from, 2);
  assert.equal(at(T(s), 20).order, 3);
  assert.match(err(s, 'visit t.30'), /30 已经访问过了（第 2 个）；重来先写 unvisit t/);
  assert.match(err(s, 'visit t.40 t.40'), /40 写了两次/);
  assert.match(s.stateText(), /访问顺序：50 30 20/);
  run(s, 'unvisit t');
  assert.ok(T(s).nodes.every((n) => n.order == null));
  assert.equal(T(s).visits, 0);
});

test('整趟遍历：先序、中序、后序、层序的顺序对；圈走的路一步一个父子；upto 停在第几个', () => {
  const s = make('tree t = A B C D E _ F _ _ G');
  const o = T(s);
  const name = (ks) => ks.map((k) => o.nodes.find((n) => n.key === k).value).join('');
  assert.equal(name(traversal(o, o.root, 'pre').order), 'ABDEGCF');
  assert.equal(name(traversal(o, o.root, 'in').order), 'DBGEACF');
  assert.equal(name(traversal(o, o.root, 'post').order), 'DGEBFCA');
  assert.equal(name(traversal(o, o.root, 'level').order), 'ABCDEFG');
  for (const kind of ['pre', 'in', 'post']) {
    const t = traversal(o, o.root, kind);
    for (let i = 1; i < t.tour.length; i++) {
      const [a, b] = [t.tour[i - 1], t.tour[i]];
      assert.ok(o.nodes.some((n) => (n.key === a && (n.left === b || n.right === b)) || (n.key === b && (n.left === a || n.right === a))), '圈沿着树枝走');
    }
  }
  const fx = s.apply(parseScript('traverse t in upto=3')[0]);
  assert.equal(name(fx.order), 'DBG');
  assert.equal(fx.tour.at(-1), fx.order.at(-1), '圈停在记下的第 3 个上');
  assert.match(s.stateText(), /访问顺序：D B G/);
  // 接着一步一步来
  run(s, 'visit t.E');
  assert.equal(at(o, 'E').order, 4);
  // 只走一棵子树
  run(s, 'traverse t.C pre');
  assert.match(s.stateText(), /访问顺序：C F/);
  assert.match(err(s, 'traverse t'), /traverse 后面写 pre/);
  assert.match(err(s, 'traverse t in upto=9'), /upto 写 1～7/);
  assert.equal(err(s, 'traverse t 中序'), undefined, '中文也认');
});

test('角上的小字：tag 写、untag 收；整棵写就每个都写；太长挡下', () => {
  const s = make(`${BASE}\ntag t.50 "h=3"\ntag t.20 t.40 0`);
  const o = T(s);
  assert.equal(at(o, 50).tag, 'h=3');
  assert.equal(at(o, 40).tag, '0');
  assert.match(s.stateText(), /角上的小字：50「h=3」 20「0」 40「0」/);
  run(s, 'untag t.20');
  assert.equal(at(o, 20).tag, null);
  run(s, 'tag t 1');
  assert.ok(o.nodes.every((n) => n.tag === '1'));
  run(s, 'untag t');
  assert.ok(o.nodes.every((n) => n.tag == null));
  assert.match(err(s, 'tag t.50 "一二三四五六七八九"'), /要短/);
  assert.match(err(s, 'tag t.50'), /要写成 tag t\.50/);
});

test('给老师看的现状：层序（照抄能再造）、谁是谁的孩子、颜色、灰掉、扣着', () => {
  const s = make(`${BASE}\npaint t.30* g2\nglow t.80\ndim t.70\ncover t.40`);
  const t = s.stateText();
  assert.match(t, /树：名字\.40 是值为 40 的结点/);
  assert.match(t, /树 t（6 个结点，3 层）：层序 50 30 70 20 40 _ 80/);
  assert.match(t, /50：左 30，右 70；30：左 20，右 40；70：右 80/);
  assert.match(t, /粉：30 20 40；灰：70；扣着：40；亮：80/);
  const d = make('tree t = 5 3 5');
  assert.match(d.stateText(), /5（#1）：左 3，右 5（#3）/);
  assert.match(make('tree t = _').stateText(), /树 t（空树）：层序 _/);
});

test('学生点结点：话里的小块和回答都按值写；ask tap t 能点每一个结点', () => {
  const s = make(`${BASE}\nsay "看 {t.40}"\nask tap t "点一下" expect=t.40`);
  assert.equal(s.waiting.kind, 'tap');
  assert.equal(s.parts('t').length, 6);
  assert.equal(s.refOf(s.parts(s.waiting.expect)[0]), 't.40');
});

test('说明里的例子照抄就能演（一行不错）；说明里每一条写法在摆好这棵树的舞台上都能演', () => {
  assert.deepEqual(dryRun(new Scene(), tree.example), []);
  assert.match(tree.example.split('\n')[0], /^tree t = /);
  const lines = tree.doc.split('\n').flatMap((l) => l.split(/\s{2,}/)[0].split(/\s\/\s/)).map((l) => l.trim()).filter((l) => /^[a-z]+ /.test(l));
  assert.ok(lines.length >= 16, `说明里的写法 ${lines.length} 条`);
  const bad = [];
  for (const l of lines) {
    const base = make(BASE);
    const e = dryRun(base, l);
    if (e.length) bad.push(`${l} → ${e[0].error}`);
  }
  assert.deepEqual(bad, []);
  assert.doesNotMatch(tree.doc + tree.hint + tree.example, /[他她]/);
});

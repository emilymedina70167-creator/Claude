// 树（平衡二叉树）的规则（kit/src/stage/types/tree.rules.js）：下一步、判型和几种错法、判断式、写给老师的事实、手势表，
// 和 engines/balanced.js 的平衡二叉树引擎对拍（引擎和规则各算各的，结果要一样）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { levelOrder, imbalance, serialize } from '../kit/src/stage/types/tree.js';
import { treeRules as R, actSrc } from '../kit/src/stage/types/tree.rules.js';
import { rulesOf, predicateOf, gestureOf, done, evalMeasure, changedKeys } from '../kit/src/stage/rules.js';
import { avlEngine } from '../kit/src/engines/balanced.js';
import { levelOrder as engineLevel } from '../kit/src/engines/treeview.js';

const run = (s, src) => { for (const c of parseScript(src)) s.apply(c); return s; };
const make = (src) => run(new Scene(), src);
const T = (s) => s.objects.get('t');
const keyOf = (o, v) => o.nodes.find((n) => n.value === String(v)).key;
const valOf = (o, k) => o.nodes.find((n) => n.key === k).value;
const vals = (o) => levelOrder(o).map((n) => n.value).join(' ');
const rot = (o, v, dir) => ({ type: 'rotate', at: keyOf(o, v), dir });
const LR3 = 'tree t = _\ninsert t 50\ninsert t 30\ninsert t 40';
// 平衡二叉树的课：老师 open 了 rotate（open 的写法 T8 才接进场景，这里直接记上）
const avlLesson = (s) => { s.opens.set('t:rotate', { obj: 't', action: 'rotate', refs: [], lo: null, hi: null }); return s; };
// next 给的每一个动作照做都判对
const allRight = (o, nx, scene) => { for (const a of nx.acts) assert.equal(R.check(o, a, scene).right, true, `next 给的 ${actSrc(o, a)} 要判对`); };

// 引擎从空树依次插：每插一个转了几下（最小不平衡子树的根、型），最后的层序
function engineRef(seq) {
  const r = avlEngine.run(avlEngine.parse({ avl: seq }));
  return {
    fixes: r.log.map((row) => row.zs.map((z, i) => ({ root: z, kind: row.types[i] }))),
    level: engineLevel(r.final).map((id) => r.final.nodes[id].key).join(' '),
  };
}

// 照 next 一路做到没有下一步：每插一个记下转了哪几型（双旋的第二下不另记，但要查它正是在原来的根那里转）
function follow(s, max = 400) {
  const fixes = [];
  for (let i = 0; i < max; i++) {
    const o = T(s);
    const nx = R.next(o);
    if (!nx) return fixes;
    const a = nx.acts[0];
    assert.equal(R.check(o, a).right, true, `next 给的这一下（${actSrc(o, a)}）check 要判对`);
    run(s, actSrc(o, a));
    if (a.type === 'insert') { fixes.push([]); continue; }
    fixes.at(-1).push({ root: valOf(o, a.root), kind: a.kind });
    if (a.kind === 'LR' || a.kind === 'RL') {
      const o2 = T(s);
      const b = R.next(o2).acts[0];
      assert.equal(b.at, a.root, `${a.kind} 转完第一下，第二下在原来的根 ${valOf(o, a.root)} 那里转（不是把刚才那下转回去）`);
      assert.equal(b.dir, a.kind === 'LR' ? 'right' : 'left');
      run(s, actSrc(o2, b));
    }
  }
  return assert.fail('照 next 走了好多步还没走完');
}

function sameAsEngine(seq) {
  const s = make(`tree t = _ tray="${seq}"`);
  const fixes = follow(s);
  const ref = engineRef(seq);
  assert.deepEqual(fixes, ref.fixes, `依次插 ${seq}：每次的型`);
  assert.equal(vals(T(s)), ref.level, `依次插 ${seq}：最后的层序`);
  assert.equal(R.predicates.avl(T(s)), true);
  assert.deepEqual(T(s).tray, []);
}

test('王道综合题 03：从空树依次插 34 23 15 98 115 28 107，照 next 一路做，每次的型、最后的层序都和平衡二叉树引擎一样', () => {
  sameAsEngine('34 23 15 98 115 28 107');
});

test('对拍：几组例子（含 LR 新结点在 x 左子树、转完第一下 x 自己也失衡的那种）和随机的一百多组', () => {
  for (const seq of ['15 3 7 10 9 8', '1 2 3 4 5 6 7', '50 30 70 20 40 35', '50 30 70 60 80 65', '50 30 70 60 80 75', '24 13 53 37 90 48']) sameAsEngine(seq);
  let a = 20261106;
  const rnd = () => { a = (a * 1103515245 + 12345) % 2 ** 31; return a / 2 ** 31; };
  for (let k = 0; k < 150; k++) {
    const seen = new Set();
    const n = 6 + Math.floor(rnd() * 10);
    while (seen.size < n) seen.add(1 + Math.floor(rnd() * 99));
    sameAsEngine([...seen].join(' '));
  }
});

test('LR 的第一步：50、30、40 插完，next 给出在 30 左旋；转完再算一次是在 50 右旋', () => {
  const s = make(LR3);
  const o = T(s);
  const nx = R.next(o);
  const a = nx.acts[0];
  assert.deepEqual([a.type, valOf(o, a.at), a.dir, a.kind, valOf(o, a.root)], ['rotate', '30', 'left', 'LR', '50']);
  assert.match(nx.why, /最小不平衡子树的根是 50，LR 型/);
  run(s, 'rotate t.30 left');
  const b = R.next(T(s)).acts[0];
  assert.deepEqual([valOf(T(s), b.at), b.dir], ['50', 'right']);
});

test('型读反：同一棵树，学生在 50 左旋，像是型从下往上读了', () => {
  const o = T(make(LR3));
  const v = R.check(o, rot(o, 50, 'left'));
  assert.equal(v.right, false);
  assert.match(v.misread, /从下往上读/);
  assert.equal(v.legal, false, '这棵树里 50 没有右孩子，左旋转不了（物理上做不到，但看得出想法）');
  // 大一点的树里转得了：在 50 左旋、在 30 右旋（照 RL 先转孩子）都是读反了
  const big = T(make('tree t = 50 30 70 20 40\ninsert t 45'));
  for (const [v2, dir] of [[50, 'left'], [30, 'right']]) {
    const w = R.check(big, rot(big, v2, dir));
    assert.equal(w.legal, true);
    assert.equal(w.right, false);
    assert.match(w.misread, /从下往上读/, `${v2} ${dir}`);
  }
});

test('只看两步：学生在 50 右旋（LR 型该先在 30 左旋）', () => {
  const o = T(make(LR3));
  const v = R.check(o, rot(o, 50, 'right'));
  assert.equal(v.legal, true);
  assert.equal(v.right, false);
  assert.match(v.misread, /最近的两步/);
  assert.equal(v.why, '50 右旋', 'why 是这一下做了什么');
  assert.match(v.next.why, /^先在 30 左旋/, 'next 是现在正确的是什么');
});

test('走偏以后接着判：先在 50 右旋（错），之后照 next 每一下都判对，最后平衡', () => {
  const s = make(LR3);
  run(s, 'rotate t.50 right');
  let steps = 0;
  for (let nx = R.next(T(s)); nx; nx = R.next(T(s))) {
    const o = T(s);
    assert.equal(R.check(o, nx.acts[0]).right, true);
    run(s, actSrc(o, nx.acts[0]));
    assert.ok(++steps < 10);
  }
  assert.ok(steps > 0);
  assert.equal(R.predicates.avl(T(s)), true);
  assert.equal(R.predicates.bst(T(s)), true);
  assert.equal(vals(T(s)), '40 30 50');
});

test('走偏随便几下以后照 next 都能转平、插完（随机）', () => {
  let a = 7;
  const rnd = () => { a = (a * 1103515245 + 12345) % 2 ** 31; return a / 2 ** 31; };
  for (let k = 0; k < 120; k++) {
    const seen = new Set();
    const n = 5 + Math.floor(rnd() * 9);
    while (seen.size < n) seen.add(1 + Math.floor(rnd() * 99));
    const s = make(`tree t = _ tray="${[...seen].join(' ')}"`);
    let wrong = 0, steps = 0;
    for (let nx = R.next(T(s)); nx; nx = R.next(T(s))) {
      const o = T(s);
      assert.ok(++steps < 300, `第 ${k} 组走不完`);
      allRight(o, nx, s);
      if (wrong < 3 && o.nodes.length > 2 && rnd() < 0.3) {
        // 随便找一个转得了的结点转一下
        const tries = o.nodes.flatMap((x) => ['left', 'right'].map((dir) => ({ type: 'rotate', at: x.key, dir })));
        const ok = tries.filter((t) => R.check(o, t).legal);
        const t = ok[Math.floor(rnd() * ok.length)];
        if (t) { run(s, actSrc(o, t)); wrong++; continue; }
      }
      run(s, actSrc(o, nx.acts[0]));
    }
    assert.equal(R.predicates.avl(T(s)), true, `第 ${k} 组`);
    assert.equal(R.predicates.bst(T(s)), true);
    assert.deepEqual(T(s).tray, []);
  }
});

// 照 next 一直做：每一下判对、转得了、不回到转过的样子，最后平衡；返回走过的 why
function settle(s, max = 80) {
  const seen = new Set(), whys = [];
  for (let nx = R.next(T(s)); nx; nx = R.next(T(s))) {
    const o = T(s);
    assert.ok(!seen.has(vals(o)), `又回到了 ${vals(o)}`);
    seen.add(vals(o));
    assert.equal(R.check(o, nx.acts[0]).right, true);
    whys.push(nx.why);
    run(s, actSrc(o, nx.acts[0]));
    assert.ok(seen.size < max);
  }
  assert.equal(R.predicates.avl(T(s)), true);
  assert.equal(R.predicates.bst(T(s)), true);
  return whys;
}

test('离平衡很远的树（老师用二叉排序树的插法造的长链）：照课本的转法会转回去，改成一层一层摆，也走得完', () => {
  const whys = settle(make('tree t = 2 _ 24 12 57 _ 23 27 58 _ _ _ 29 _ 82 _ 32 71 99 _ 44 60'));
  assert.ok(whys.some((w) => /一层一层摆/.test(w)));
  settle(make('tree t = 10 _ 20 _ 30 _ 40 _ 50 _ 60 _ 70 _ 80'));
  // 随机造的二叉排序树（不转平地插），到 8 层为止
  let a = 3;
  const rnd = () => { a = (a * 1103515245 + 12345) % 2 ** 31; return a / 2 ** 31; };
  for (let k = 0; k < 150; k++) {
    const s = make('tree t = _');
    const seen = new Set();
    const n = 3 + Math.floor(rnd() * 20);
    while (seen.size < n) seen.add(1 + Math.floor(rnd() * 300));
    const vs = [...seen];
    if (k % 4 === 0) vs.sort((x, y) => x - y);
    for (const v of vs) if (!dryRun(s, `insert t ${v}`).length) run(s, `insert t ${v}`);
    settle(s);
  }
});

// 王道的做法（不经过规则）：最小不平衡子树的根和型 → 第一下
function textbookFirst(o) {
  const b = imbalance(o);
  const n = o.nodes.find((x) => x.key === b.key);
  const [at, dir] = { LL: [b.key, 'right'], RR: [b.key, 'left'], LR: [n.left, 'left'], RL: [n.right, 'right'] }[b.kind];
  return { type: 'rotate', at, dir };
}
// 照这一下转完，再照 next 往下转：转得平、不回到转之前、不绕圈
function noLoopAfter(s, act) {
  const c = s.clone();
  const seen = new Set([serialize(T(s))]);
  run(c, actSrc(T(s), act));
  for (let i = 0; i < 60; i++) {
    const o = c.objects.get('t');
    const nx = R.next(o);
    if (!nx || nx.acts[0].type !== 'rotate') return true;
    if (seen.has(serialize(o))) return false;
    seen.add(serialize(o));
    run(c, actSrc(o, nx.acts[0]));
  }
  return false;
}

test('走偏以后照王道转最小不平衡子树：转完不绕回去就判对（页面挑的不是它也一样）；绕回去的不算', () => {
  let a = 20261107;
  const rnd = () => { a = (a * 1103515245 + 12345) % 2 ** 31; return a / 2 ** 31; };
  let differs = 0, refused = 0;
  for (let k = 0; k < 300; k++) {
    const seen = new Set();
    const n = 5 + Math.floor(rnd() * 10);
    while (seen.size < n) seen.add(1 + Math.floor(rnd() * 99));
    const s = make(`tree t = _ tray="${[...seen].join(' ')}"`);
    let wrong = 0, steps = 0;
    for (let nx = R.next(T(s)); nx; nx = R.next(T(s))) {
      const o = T(s);
      assert.ok(++steps < 300);
      allRight(o, nx, s);
      if (nx.acts[0].type === 'rotate' && wrong) {
        const tb = textbookFirst(o);
        const first = nx.acts[0];
        if (tb.at !== first.at || tb.dir !== first.dir) {
          const ok = noLoopAfter(s, tb);
          const v = R.check(o, tb, s);
          assert.equal(v.right, ok, `${vals(o)}：照课本 ${actSrc(o, tb)}${ok ? '转完不绕回去，该判对' : '会绕回去，不该判对'}`);
          if (ok) differs++; else refused++;
        }
      }
      if (wrong < 3 && o.nodes.length > 2 && rnd() < 0.3) {
        const ok = o.nodes.flatMap((x) => ['left', 'right'].map((dir) => ({ type: 'rotate', at: x.key, dir }))).filter((t) => R.check(o, t).legal);
        const t = ok[Math.floor(rnd() * ok.length)];
        if (t) { run(s, actSrc(o, t)); wrong++; continue; }
      }
      run(s, actSrc(o, nx.acts[0]));
    }
    assert.equal(R.predicates.avl(T(s)), true);
  }
  assert.ok(differs > 20, `页面挑的不是最小不平衡子树、照课本转也判对的状态要量到一些（${differs}）`);
  assert.ok(refused > 0, `也要量到照课本会转回去的（LR 转完第一下孙子 +2）（${refused}）`);
});

test('LR 转完第一下孙子自己也失衡：照课本转孙子就转回去了，不算对；next 只给在根那里转', () => {
  const s = make('tree t = 50 30 70 20 40\ninsert t 35\nrotate t.30 left');
  const o = T(s);
  const nx = R.next(o);
  assert.deepEqual(nx.acts.map((x) => `${valOf(o, x.at)} ${x.dir}`), ['50 right']);
  assert.equal(R.check(o, rot(o, 40, 'right')).right, false, '40 右旋是把刚才那一下转回去');
});

test('换值弄坏 bst：swap t.30 t.50 以后 bst 是 false', () => {
  const s = make('tree t = 50 30 70');
  assert.equal(R.predicates.bst(T(s)), true);
  run(s, 'swap t.30 t.50');
  assert.equal(R.predicates.bst(T(s)), false);
  assert.equal(R.predicates.avl(T(s)), true, '形状没变，还是平衡的');
  // 49′ 和 49 一样大，算递增
  assert.equal(R.predicates.bst(T(make('tree t = 49 13 49′'))), true);
});

test('插错位置：47 摆到 50 的左边，说它该在哪；摆对了、不给位置都对', () => {
  const o = T(make('tree t = 49 45 50 tray="47"'));
  const v = R.check(o, { type: 'insert', value: '47', parent: keyOf(o, 50), side: 'left' });
  assert.equal(v.legal, true);
  assert.equal(v.right, false);
  assert.match(v.misread, /该在/);
  assert.match(v.misread, /该在 45 的右边/);
  assert.equal(R.check(o, { type: 'insert', value: '47', parent: keyOf(o, 45), side: 'right' }).right, true);
  assert.equal(R.check(o, { type: 'insert', value: '47' }).right, true);
  // 那边已经有结点、值已经在树里：做不到
  assert.equal(R.check(o, { type: 'insert', value: '47', parent: keyOf(o, 49), side: 'left' }).legal, false);
  assert.equal(R.check(o, { type: 'insert', value: '45' }).legal, false);
});

test('修了离根近的那个：20、40 都失衡，学生在 40 右旋', () => {
  const o = T(make('tree t = 40 20 50 10\ninsert t 5'));
  const nx = R.next(o).acts[0];
  assert.deepEqual([valOf(o, nx.at), nx.dir, nx.kind], ['20', 'right', 'LL'], '课本：最小不平衡子树是离新结点最近的 20');
  const v = R.check(o, rot(o, 40, 'right'));
  assert.equal(v.right, false);
  assert.match(v.misread, /离根近/);
});

test('LL 型转反了方向：像是把型的名字当成了转的方向', () => {
  const o = T(make('tree t = 30 20 40 10 25\ninsert t 5'));
  assert.equal(R.next(o).acts[0].kind, 'LL');
  const v = R.check(o, rot(o, 30, 'left'));
  assert.equal(v.legal, true);
  assert.equal(v.right, false);
  assert.match(v.misread, /名字当成了转的方向/);
});

test('没有失衡时还在转：树已经平衡了，不用转', () => {
  const o = T(make('tree t = 50 30 70 tray="20"'));
  const v = R.check(o, rot(o, 50, 'right'));
  assert.equal(v.legal, true);
  assert.equal(v.right, false);
  assert.match(v.misread, /已经平衡了，不用转/);
  assert.match(v.next.why, /插入 20/);
});

test('转不了的是 legal: false（没有那一边的孩子、没有这个结点）', () => {
  const o = T(make('tree t = 50 30 70'));
  const v = R.check(o, rot(o, 30, 'right'));
  assert.equal(v.legal, false);
  assert.match(v.why, /30 没有左孩子，右旋转不了/);
  assert.equal(R.check(o, { type: 'rotate', at: 99, dir: 'left' }).legal, false);
});

test('老师一行写整个型（rotate t.50 LR）也判：对的、当成单旋、读反', () => {
  const o = T(make(LR3));
  const z = keyOf(o, 50);
  assert.equal(R.check(o, { type: 'rotate', at: z, kind: 'LR' }).right, true);
  assert.match(R.check(o, { type: 'rotate', at: z, kind: 'LL' }).misread, /最近的两步/);
  const rl = R.check(o, { type: 'rotate', at: z, kind: 'RL' });
  assert.equal(rl.legal, false, '50 没有右孩子，RL 转不了');
  assert.match(rl.misread, /从下往上读/);
});

test('插入：平衡二叉树的课上还没转平就插、托盘不按顺序插，都不是正确的下一步；别的动作不判', () => {
  const s = avlLesson(make(`${LR3}\nwrite t.50 50`));
  T(s).tray = ['60'];
  const v = R.check(T(s), { type: 'insert', value: '60' }, s);
  assert.equal(v.right, false);
  assert.match(v.misread, /还没转平/);
  assert.match(v.next.why, /^先在 30 左旋/);
  const o = T(make('tree t = 50 30 70 tray="20 80"'));
  assert.match(R.check(o, { type: 'insert', value: '80' }).misread, /按顺序/);
  assert.equal(R.check(o, { type: 'insert', value: '20' }).right, true);
  assert.equal(R.check(o, { type: 'swap', a: 1, b: 2 }).right, null);
});

test('二叉排序树的课（没 open rotate）：没平衡的树上摆对了就对，不说还没转平；open 了 rotate 才说', () => {
  const s = make('tree t = 10 _ 20 _ 30 tray="40"');
  const o = T(s);
  const at30 = { type: 'insert', value: '40', parent: keyOf(o, 30), side: 'right' };
  assert.equal(R.check(o, at30, s).right, true);
  assert.equal(R.check(o, { type: 'insert', value: '40' }, s).right, true);
  const left = R.check(o, { ...at30, side: 'left' }, s);
  assert.equal(left.right, false);
  assert.match(left.misread, /该在 30 的右边/);
  assert.match(left.next.why, /插入 40/);
  assert.equal(R.check(o, at30).right, true, '不给场景时也按二叉排序树判');
  avlLesson(s);
  const v = R.check(o, at30, s);
  assert.equal(v.right, false);
  assert.match(v.misread, /还没转平/);
});

test('托盘：tree t = … tray="…" 存进 o.tray，插进去一个就拿掉一个；写错了说清楚', () => {
  const s = make('tree t = 50 30 70 tray="47 10"');
  assert.deepEqual(T(s).tray, ['47', '10']);
  assert.deepEqual(R.next(T(s)).acts, [{ type: 'insert', value: '47' }]);
  assert.match(R.next(T(s)).why, /落在 30 的右边/);
  run(s, 'insert t 47');
  assert.deepEqual(T(s).tray, ['10']);
  run(s, 'insert t.30 left 10');
  assert.deepEqual(T(s).tray, []);
  assert.equal(R.next(T(s)), null, '平衡了、托盘空了：做完');
  assert.equal(T(make('tree t = 50')).tray, undefined, '没写托盘的树照旧');
  const err = (line) => dryRun(new Scene(), line)[0]?.error;
  assert.match(err('tree t = 50 30 tray="30"'), /30 已经在树里了/);
  assert.match(err('tree t = 50 tray="7 7"'), /7 写了两次/);
  assert.match(err('tree t = 50 tray="7 _"'), /托盘里不能有 _/);
  assert.match(err('tree t = 50 tray=""'), /tray=/);
});

test('给老师的现状里写出托盘', () => {
  const s = make('tree t = 50 30 tray="47 10"');
  assert.match(s.stateText(), /托盘（待插）：47 10/);
});

test('判断式：avl、bst、height；登记在树上，挑战能写', () => {
  const s = make(LR3);
  assert.equal(rulesOf(T(s)).hasNext, true, 'types/index.js 登记了树的规则');
  assert.equal(predicateOf(s, 't', 'avl')(), false);
  assert.equal(predicateOf(s, 't', 'height')(['3']), true);
  assert.equal(predicateOf(s, 't', 'height')(['2']), false);
  assert.throws(() => predicateOf(s, 't', 'height')([]), /height=4/);
  assert.equal(R.predicates.avl(T(make('tree t = _'))), true);
  assert.equal(done(s, 't'), false);
  // 挑战：转平了就做到
  run(s, 'goal g1 "转平它" when="t avl, t bst, t height=2"');
  const fx1 = s.apply(parseScript('rotate t.30 left')[0]);
  assert.equal(fx1.goalsMet, undefined);
  const fx2 = s.apply(parseScript('rotate t.50 right')[0]);
  assert.deepEqual(fx2.goalsMet, ['g1']);
  assert.equal(done(s, 't'), true);
});

test('事实：旋转以后谁升谁降、哪棵子树换了父亲、还有没有失衡；插入以后的路径', () => {
  const s = make('tree t = 50 30 70 20 40\ninsert t 45');
  const before = structuredClone(T(s));
  run(s, 'rotate t.30 left');
  const f1 = R.facts(before, T(s), rot(before, 30, 'left')).join('\n');
  assert.match(f1, /30 左旋：40 转上来，30 降下去当 40 的左孩子/);
  assert.match(f1, /还失衡/);
  const mid = structuredClone(T(s));
  run(s, 'rotate t.50 right');
  const f2 = R.facts(mid, T(s), rot(mid, 50, 'right')).join('\n');
  assert.match(f2, /45 那棵子树从 40 下面改挂到 50 的左边/);
  assert.match(f2, /40 成了整棵树的根/);
  assert.match(f2, /都平衡了/);
  const b2 = structuredClone(T(s));
  run(s, 'insert t 35');
  const f3 = R.facts(b2, T(s), { type: 'insert', value: '35' }).join('\n');
  assert.match(f3, /插入 35：40 → 30，落在 30 的右边/);
  const e = make('tree t = _');
  const b3 = structuredClone(T(e));
  run(e, 'insert t 8');
  assert.match(R.facts(b3, T(e), { type: 'insert', value: '8' }).join('\n'), /树是空的，8 当根/);
  assert.match(R.facts(structuredClone(T(make(LR3.split('\n').slice(0, 3).join('\n')))), T(make(LR3)), { type: 'insert', value: '40' }).join('\n'), /插完失衡：最小不平衡子树的根是 50（\+2），LR 型/);
});

test('手势表：结点拖到父亲上是在父亲那里转；托盘的数拖进树、拖到空位是插入', () => {
  const o = T(make('tree t = 50 30 70 20 40'));
  const node = (v) => o.nodes.find((n) => n.value === String(v));
  const g = gestureOf(o, 'rotate');
  assert.equal(g.gesture, 'drop-on');
  assert.deepEqual(g.toAct(o, { from: node(30), to: node(50) }), { act: { type: 'rotate', at: keyOf(o, 50), dir: 'right' }, src: `rotate t#${keyOf(o, 50)} right` });
  assert.deepEqual(g.toAct(o, { from: node(70), to: node(50) }).act, { type: 'rotate', at: keyOf(o, 50), dir: 'left' });
  assert.ok(g.toAct(o, { from: node(20), to: node(50) }).error, '拖到不是父亲的结点上');
  const ins = gestureOf(o, 'insert');
  assert.equal(ins.gesture, 'drop-at');
  assert.deepEqual(ins.toAct(o, { value: '47' }), { act: { type: 'insert', value: '47' }, src: 'insert t 47' });
  const place = gestureOf(o, 'place');
  assert.equal(place.gesture, 'drop-at');
  assert.deepEqual(place.toAct(o, { value: '47', to: { slot: { parent: keyOf(o, 40), side: 'right' } } }), { act: { type: 'insert', value: '47', parent: keyOf(o, 40), side: 'right' }, src: `insert t#${keyOf(o, 40)} right 47` });
  assert.ok(place.toAct(o, { value: '47', to: { slot: { parent: keyOf(o, 30), side: 'left' } } }).error, '那边已经有结点了');
  // 翻出来的指令照抄能演
  for (const src of [g.toAct(o, { from: node(30), to: node(50) }).src, ins.toAct(o, { value: '47' }).src]) assert.deepEqual(dryRun(make('tree t = 50 30 70 20 40'), src), []);
});

test('standard：借平衡二叉树引擎从现在的样子跑出整段旋转序列；引擎接不住的给 null', () => {
  const std = R.standard(T(make('tree t = _ tray="34 23 15 98 115 28 107"')));
  assert.deepEqual(std.rotations.map((r) => `${r.root} ${r.kind}`), ['34 LL', '34 RR', '23 RL', '98 RL']);
  assert.equal(std.final.join(' '), engineRef('34 23 15 98 115 28 107').level);
  assert.ok(std.steps.length > 0);
  assert.ok(std.variants.length > 0, '常见错法');
  // 已经有一棵平衡的树、托盘里还有：从现在的树接着插
  const s = make('tree t = 24 13 53 _ _ 37 90 tray="48"');
  const s2 = R.standard(T(s));
  assert.deepEqual(s2.rotations.map((r) => `${r.op} ${r.root} ${r.kind}`), ['插入 48 24 RL']);
  follow(s);
  assert.equal(vals(T(s)), s2.final.join(' '));
  assert.equal(R.standard(T(make(LR3))), null, '还失衡的树引擎接不住');
  assert.equal(R.standard(T(make('tree t = 50 30'))), null, '托盘空的');
});

test('量对王道的例子：从空树依次插 34 23 15 98 115 28 107 转平以后数一数；托盘还剩几个', () => {
  const s = make('tree t = _ tray="34 23 15 98 115 28 107"');
  assert.equal(evalMeasure(s, 'tray(t)').value, 7);
  follow(s);
  assert.equal(evalMeasure(s, 'count(t)').value, 7);
  assert.equal(evalMeasure(s, 'height(t)').value, 3);
  assert.equal(evalMeasure(s, 'height(t.107)').value, 2, '写部件是那棵子树的高');
  assert.equal(evalMeasure(s, 'count(t.107)').value, 3, '写部件是那棵子树的结点数');
  assert.equal(evalMeasure(s, 'tray(t)').value, 0);
  assert.equal(evalMeasure(make('tree t = 50 30 tray="47 10"'), 'tray(t)').value, 2);
  assert.equal(evalMeasure(make('tree t = _'), 'height(t)').value, 0);
  assert.match(evalMeasure(s, 'tray(t.107)').why, /没有 tray/, '托盘是整棵树的');
});

test('旧判断式照旧：t height=4 里面改用量算，写法不变', () => {
  const s = make('tree t = 50 30 60 20 40 _ _ 10');
  assert.equal(predicateOf(s, 't', 'height')(['4']), true);
  assert.equal(predicateOf(s, 't', 'height')(['3']), false);
});

test('子树高、结点数：heights t 以后现状里写每个结点的子树高（层序）；插、转以后的事实写现在几个结点、几层', () => {
  const s = make('tree t = 50 30 60 20 40 _ _ 10 tray="70"');
  assert.doesNotMatch(s.stateText(), /子树高/, '老师没写 heights t 不写');
  run(s, 'heights t');
  assert.equal(T(s).heights, true);
  assert.ok(s.stateText().includes('  子树高：50 4，30 3，60 1，20 2，40 1，10 1'), s.stateText());
  run(s, 'unheights t');
  assert.doesNotMatch(s.stateText(), /子树高/);
  run(s, 'open t insert');
  const fx = s.apply(parseScript('insert t 70')[0], { by: 'student', open: 'insert' });
  assert.ok(fx.judged.after.includes('现在 7 个结点、4 层'), fx.judged.after.join('\n'));
  // 旋转以后也写
  const r = make(LR3);
  const before = structuredClone(T(r));
  run(r, 'rotate t.30 left');
  assert.equal(R.facts(before, T(r), rot(before, 30, 'left')).at(-1), '现在 3 个结点、3 层');
  // 跟着算重新造的树带着 heights
  const d = make('dial k = 5 range=1..9\ntree t = 50 {k} 60\nheights t');
  run(d, 'set k 7');
  assert.equal(T(d).heights, true);
});

test('changed：这一下改了哪些结点（ask pick 交了以后和真变了的比）——前后都在、平衡因子 / 父亲 / 哪一边 / 第几层变了的，新长出来的不算', () => {
  const s = make('tree t = 30 20 40 10 25 _ 45');
  const before = structuredClone(T(s));
  run(s, 'insert t 47');
  const o = T(s);
  const vs = (keys) => keys.map((k) => valOf(o, k)).sort();
  assert.deepEqual(vs(R.changed(before, o)), ['30', '40', '45']);
  assert.deepEqual(vs(changedKeys(o, before, o)), ['30', '40', '45']);
  // 转一下：转上来的、降下去的、整棵挪了层的都变了；别的不动
  const r = make('tree t = 50 30 70 20 40\ninsert t 10');
  const b2 = structuredClone(T(r));
  run(r, `rotate t#${keyOf(T(r), 50)} right`);
  assert.deepEqual(R.changed(b2, T(r)).map((k) => valOf(T(r), k)).sort(), ['10', '20', '30', '40', '50', '70']);
  // 只是染色：没变
  const p = make('tree t = 30 20 40');
  const b3 = structuredClone(T(p));
  run(p, 'paint t.20 g2');
  assert.deepEqual(R.changed(b3, T(p)), []);
});

test('复核（第三次量）：学生往空位上摆（open w place）不按托盘的先后判——摆对了（还是二叉排序树）就对，不圈；摆错了位置才错', () => {
  const s = make('tree w = _ tray="15 23 28 34 98 115"\nopen w place wrong=mark undo=on');
  const W = () => s.objects.get('w');
  const key = (v) => keyOf(W(), v);
  const put = (line) => s.apply(parseScript(line)[0], { by: 'student', open: 'place' });
  // 34 当根：托盘第一个是 15，以前判「托盘里的数按顺序插：该先插 15」、淡淡圈了 34
  let fx = put('insert w 34');
  assert.equal(fx.judged.verdict.right, true, fx.judged.facts.join('；'));
  assert.ok(!fx.judged.mark && !s.slips.has('w'), '摆对的不圈');
  assert.ok(!fx.judged.facts.some((f) => /按顺序/.test(f)), fx.judged.facts.join('；'));
  fx = put(`insert w#${key(34)} right 98`);
  assert.equal(fx.judged.verdict.right, true);
  // 28 摆到 98 的左边：不是二叉排序树了，照旧错、圈一下
  fx = put(`insert w#${key(98)} left 28`);
  assert.equal(fx.judged.verdict.right, false);
  assert.match(fx.judged.verdict.misread, /该在 34 的左边/);
  assert.ok(fx.judged.mark);
  // 开着 rotate 的课上摆：也只看是不是二叉排序树，不说「还没转平就插」
  const a = make('tree t = 10 _ 20 _ 30 tray="40 5"\nopen t place\nopen t rotate');
  const at30 = { type: 'insert', value: '40', parent: keyOf(T(a), 30), side: 'right' };
  assert.equal(R.check(T(a), at30, a, { open: 'place' }).right, true);
  assert.match(R.check(T(a), at30, a).misread || '', /还没转平/, '不是从 place 来的：照旧');
  // 拖进树（open t insert）照旧按托盘的先后（第一轮的规矩）
  const i = make('tree t = 50 30 70 tray="20 80"\nopen t insert');
  const v = i.apply(parseScript('insert t 80')[0], { by: 'student', open: 'insert' });
  assert.equal(v.judged.verdict.right, false);
  assert.match(v.judged.verdict.misread, /按顺序/);
});

test('复核（第三次量）：学生摘叶子、删结点写给老师删了哪个、删完的样子（几个结点、几层、失衡没有），不再是光秃秃的「学生 delete s#7」', async () => {
  const { actText } = await import('../kit/src/stage/stage.js');
  const say = (fx) => actText({ type: 'delete', src: fx.judged.src, verdict: { legal: true, right: null, misread: null, why: fx.judged.verdict.why, next: null } });
  // 摘叶子（open t pluck）
  const s = make('tree t = 20 10 30 5 15 _ 40\nopen t pluck');
  let fx = s.apply(parseScript('delete t.5')[0], { by: 'student', open: 'pluck' });
  assert.ok(fx.judged, '摘叶子也过裁判（不判对错，只写做了什么）');
  assert.equal(fx.judged.verdict.right, null);
  assert.equal(say(fx), '学生摘了叶子 5');
  assert.deepEqual(fx.judged.after, ['现在 5 个结点、3 层']);
  // 删完失衡：写最小不平衡子树的根
  fx = s.apply(parseScript('delete t.40')[0], { by: 'student', open: 'pluck' });
  fx = s.apply(parseScript('delete t.30')[0], { by: 'student', open: 'pluck' });
  assert.equal(say(fx), '学生摘了叶子 30');
  assert.ok(fx.judged.after.some((f) => /^删完失衡：最小不平衡子树的根是 20（\+2），L[LR] 型$/.test(f)), fx.judged.after.join('；'));
  assert.ok(fx.judged.after.includes('现在 3 个结点、3 层'));
  // 只看形状的树（值都是 ·）：写编号
  const d = make('tree s = · · · · · · ·\nopen s pluck');
  const k = d.objects.get('s').nodes.find((n) => n.left == null && n.right == null).key;
  fx = d.apply(parseScript(`delete s#${k}`)[0], { by: 'student', open: 'pluck' });
  assert.equal(say(fx), `学生摘了叶子 ·（#${k}）`);
  assert.ok(fx.judged.after.includes('现在 6 个结点、3 层'));
  // 点哪个删哪个（open t delete）：一个孩子的顶上来、两个孩子的中序后继顶上来
  const t = make('tree t = 20 10 30 5 15 _ 40\nopen t delete');
  fx = t.apply(parseScript('delete t.30')[0], { by: 'student', open: 'delete' });
  assert.equal(say(fx), '学生删了 30（只有一个孩子：40 顶上来）');
  fx = t.apply(parseScript('delete t.20')[0], { by: 'student', open: 'delete' });
  assert.equal(say(fx), '学生删了 20（两个孩子：中序后继 40 的值顶上来）');
  assert.ok(fx.judged.after.includes('现在 4 个结点、3 层'));
  // 老师自己删：不写事实（老师的一下只在走偏时核）
  const u = make('tree t = 20 10 30');
  fx = u.apply(parseScript('delete t.10')[0], { by: 'teacher' });
  assert.deepEqual(fx.judged?.facts || [], []);
});

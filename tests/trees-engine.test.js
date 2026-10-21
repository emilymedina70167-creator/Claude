// 平衡树的演示引擎：平衡二叉树 avl、红黑树 rbt（engines/balanced.js），B 树 / B+ 树 btree（engines/btree.js）。
// 每个组件对几道王道 / 408 的题（答案写在注释里），常见错法各查一个：错法那一遍的答案和对的不一样、学生照错法答能认出来
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { avlEngine, rbtEngine } from '../kit/src/engines/balanced.js';
import { btreeEngine } from '../kit/src/engines/btree.js';
import { checkAsk, fillSpec, checkFill, resolveAsks, commonSpec, trackFields } from '../kit/src/stepperspec.js';
import { parseFields } from '../kit/src/parse.js';

const go = (E, f) => { const input = E.parse(f); return { input, r: E.run(input) }; };
const asks = (r, tag) => r.steps.filter((s) => s.ask?.tag === tag).map((s) => s.ask);
// 填表：把标准答案（每格第一种写法）填进去，应该全对
const fillAll = (t) => t.rows.map((row) => row.cells.map((c) => [].concat(c.v)[0]));
const ENGINES = { avl: avlEngine, rbt: rbtEngine, btree: btreeEngine };

test('共同约定：第 0 步不挂问题；每一步都画得出来；表的格子数和表头一样、照答案填全对', () => {
  const cases = [
    [avlEngine, { avl: '15 3 7 10 9 8' }], [avlEngine, { avl: '44 17 78 32 50 88 48 62', ops: 'delete 32, insert 70' }],
    [rbtEngine, { rbt: '1 2 3 4 5 6 7 8' }], [rbtEngine, { rbt: '10 20 30', ops: 'insert 15, insert 25' }],
    [btreeEngine, { btree: '5 6 9 13 8 2 12 15', order: '4' }], [btreeEngine, { nodes: '[30]([10]([5], [20]), [40]([35], [50]))', ops: 'delete 50' }],
    [btreeEngine, { btree: '10 20 30 40 50 60 70', plus: 'true' }],
  ];
  for (const [E, f] of cases) {
    const { input, r } = go(E, f);
    assert.ok(!r.steps[0].ask, `${E.name}：第 0 步挂了问题`);
    for (const s of r.steps) assert.match(E.view(s.view, input), /<svg class="sv-(tree|mway)|（空树）/);
    const t = E.table(input, r, f);
    for (const row of t.rows) assert.equal(row.cells.length, t.head.length);
    const spec = fillSpec(t, {});
    assert.deepEqual(spec.errors, []);
    assert.ok(checkFill(spec.table, fillAll(spec.table)).ok, `${E.name}：照答案填的表判成错`);
    assert.equal(E.quiz(input, r).type, 'seq');
  }
});

test('平衡二叉树：王道 15 3 7 10 9 8；408 真题；删除往上转两次', () => {
  // 王道 7.3.2 的例子：依次插入 15, 3, 7, 10, 9, 8。插 7 时 15 失衡（LR），插 9 时 15 失衡（LL），插 8 时 7 失衡（RL）；
  // 最后：根 9，左 7（3, 8），右 10（右孩子 15）
  let { input, r } = go(avlEngine, { avl: '15 3 7 10 9 8' });
  assert.equal(avlEngine.quiz(input, r).answer, '9 7 10 3 8 15');
  assert.deepEqual(r.log.map((x) => x.types.join('')), ['', '', 'LR', '', 'LL', 'RL']);
  assert.deepEqual(asks(r, 'root').map((a) => a.answer), ['15', '15', '7']);
  assert.deepEqual(asks(r, 'bf').map((a) => a.answer), ['+1', '+2', '−1', '+2', '−2'], '失衡时问最小不平衡子树的根，没失衡问根');
  assert.ok(checkAsk(asks(r, 'rotate')[0], 'LR（先左后右双旋转）').ok);
  // 2013 年 408：1～7 依次插入，平衡因子为 0 的分支结点有 3 个（4、2、6）
  ({ input, r } = go(avlEngine, { avl: '1 2 3 4 5 6 7' }));
  assert.equal(avlEngine.quiz(input, r).answer, '4 2 6 1 3 5 7');
  // 2010 年 408：在 24(13, 53(37, 90)) 里插入 48（RL），37 的左、右孩子是 24、53
  ({ input, r } = go(avlEngine, { avl: '24 13 53 37 90', ops: 'insert 48' }));
  assert.equal(avlEngine.quiz(input, r).answer, '37 24 53 13 48 90');
  // 王道 7.3.2 删除的例子：删 32 以后 44 失衡，y = 78、x = 50（RL），50 当根
  ({ input, r } = go(avlEngine, { avl: '44 17 78 32 50 88 48 62', ops: 'delete 32' }));
  assert.equal(avlEngine.quiz(input, r).answer, '50 44 78 17 48 62 88');
  assert.deepEqual(r.log[0].types, ['RL']);
  assert.equal(asks(r, 'case')[0].answer, '叶结点：直接删');
  // 删除转完子树矮了 1，再往上又失衡：11 先 LL，8 再 LL，5 当根
  ({ input, r } = go(avlEngine, { avl: '8 5 11 3 7 10 12 2 4 6 9 1', ops: 'delete 12' }));
  assert.deepEqual(r.log[0].zs, ['11', '8']);
  assert.equal(avlEngine.quiz(input, r).answer, '5 3 8 2 4 7 10 1 6 9 11');
  // 两棵子树都有：默认直接后继，replace: pred 用直接前驱
  assert.equal(avlEngine.quiz(...Object.values(go(avlEngine, { avl: '15 3 7 10 9 8', ops: 'delete 7' }))).answer, '9 8 10 3 15');
  assert.equal(avlEngine.quiz(...Object.values(go(avlEngine, { avl: '15 3 7 10 9 8', ops: 'delete 7', replace: 'pred' }))).answer, '9 3 10 8 15');
  assert.throws(() => avlEngine.parse({ avl: '3 5 3' }), /写了两次/);
  assert.throws(() => avlEngine.parse({ avl: '3 5', ops: 'rotate 3' }), /不认识/);
});

test('平衡二叉树的错法：LR 当成 LL 转、平衡因子算成右减左', () => {
  const { input, r } = go(avlEngine, { avl: '15 3 7 10 9 8' });
  const vs = avlEngine.variants(input);
  const lr = vs.find((v) => v.input.mistake === 'lr2ll');
  const sign = vs.find((v) => v.input.mistake === 'bfsign');
  assert.match(lr.label, /^像是.*（王道：/);
  // 插 7 时选「LL」：照错法那一遍答案就是 LL，认得出来；而且最后的树也不一样
  const lrRun = avlEngine.run(lr.input);
  const q = asks(r, 'rotate')[0];
  assert.ok(!checkAsk(q, 'LL（右单旋转）').ok);
  assert.ok(checkAsk(asks(lrRun, 'rotate').find((a) => a.q === q.q), 'LL（右单旋转）').ok);
  assert.notEqual(avlEngine.quiz(lr.input, lrRun).answer, avlEngine.quiz(input, r).answer);
  // 平衡因子右减左：插 7 时 15 的平衡因子答成 −2
  const b = asks(r, 'bf')[1];
  assert.equal(b.answer, '+2');
  assert.equal(asks(avlEngine.run(sign.input), 'bf').find((a) => a.q === b.q).answer, '−2');
  // 1～7 都是 RR，没有双旋：LR 当 LL 这种错法不列
  assert.ok(!avlEngine.variants(avlEngine.parse({ avl: '1 2 3 4 5 6 7' })).some((v) => v.input.mistake === 'lr2ll'));
});

// 红黑树的性质：根黑、没有红红相连、每条路黑结点一样多、中序有序
function rbOk(t) {
  if (t.root === null) return true;
  assert.equal(t.nodes[t.root].red, false, '根是黑的');
  const keys = [];
  const bh = (id, parentRed) => {
    if (id === null) return 1;
    const n = t.nodes[id];
    assert.ok(!(parentRed && n.red), `${n.key} 和双亲都是红的`);
    const l = bh(n.left, n.red);
    keys.push(n.item.v);
    const r = bh(n.right, n.red);
    assert.equal(l, r, `${n.key} 左右黑高不一样`);
    return l + (n.red ? 0 : 1);
  };
  bh(t.root, false);
  assert.deepEqual(keys, [...keys].sort((a, b) => a - b));
  return true;
}

test('红黑树：1～8 依次插入；王道的例子；情况题、颜色题', () => {
  // 1～8 依次插入：根 4（黑），2、6、8 红，其余黑
  let { input, r } = go(rbtEngine, { rbt: '1 2 3 4 5 6 7 8' });
  assert.equal(rbtEngine.quiz(input, r).answer, '4 2 6 1 3 5 7 8');
  assert.equal(rbtEngine.quiz({ ...input, quizWalk: 'red' }, r).answer, '2 6 8');
  assert.ok(rbOk(r.final));
  // 插 3：父 2 红、叔叔空（黑），RR 左旋；插 4：叔叔 1 红，变色，爷爷 2 是根再染黑
  assert.deepEqual(asks(r, 'case').slice(0, 5).map((a) => a.answer), ['是根：染黑', '父黑：不用调', 'RR：左旋', '叔红：变色', '是根：染黑']);
  // 插 8 时变色变到 6，6 和父 4 又红红相连、叔叔 3 黑：RR，4 转上来当根
  assert.deepEqual(r.log[7].acts, ['变色', 'RR']);
  assert.equal(asks(r, 'color')[0].answer, '黑', '第一个结点当根，染黑');
  // 王道 7.3.4 的例子：依次插入 20 10 5 30 40 57 3 2 4 35 25 18 22 23 24 19。
  // 最后：根 10；3(2, 5(4))；23(20(18(, 19), 22), 30(25(24), 40(35, 57)))；红结点 4 19 20 24 30 35 57，黑高 3
  ({ input, r } = go(rbtEngine, { rbt: '20 10 5 30 40 57 3 2 4 35 25 18 22 23 24 19' }));
  assert.ok(rbOk(r.final));
  assert.equal(rbtEngine.quiz(input, r).answer, '10 3 23 2 5 20 30 4 18 22 25 40 19 24 35 57');
  assert.equal(rbtEngine.quiz({ ...input, quizWalk: 'red' }, r).answer, '4 19 20 24 30 35 57');
  assert.deepEqual(r.log.find((x) => x.label === '插入 24').acts, ['变色', 'LR'], '24：叔叔红变色，20 当新结点以后是 LR');
  assert.throws(() => rbtEngine.parse({ rbt: '1 2', ops: 'delete 1' }), /只演示插入/);
});

test('红黑树的错法：叔叔红也去旋转、根没染黑', () => {
  const { input, r } = go(rbtEngine, { rbt: '1 2 3 4 5 6 7 8' });
  const vs = rbtEngine.variants(input);
  assert.deepEqual(vs.map((v) => v.input.mistake), ['redrotate', 'rootred']);
  // 插 4（叔叔 1 红）选了「RR：左旋」：照错法那一遍认得出
  const q = asks(r, 'case').find((a) => a.answer === '叔红：变色');
  const wrong = asks(rbtEngine.run(vs[0].input), 'case').find((a) => a.q === q.q);
  assert.ok(checkAsk(wrong, 'RR：左旋').ok);
  // 根没染黑：第一个结点 1 最后答「红」
  const c = asks(r, 'color')[0];
  assert.ok(checkAsk(asks(rbtEngine.run(vs[1].input), 'color').find((a) => a.q === c.q), '红').ok);
});

test('B 树：2020 年 408 的插入；2012 年 408 的删除（向左兄弟借）；合并到根变矮；内部结点借', () => {
  // 2020 年 408：5, 6, 9, 13, 8, 2, 12, 15 依次插入空的 4 阶 B 树，根结点里是 6、9
  let { input, r } = go(btreeEngine, { btree: '5 6 9 13 8 2 12 15', order: '4' });
  assert.equal(btreeEngine.quiz({ ...input, quizWalk: 'root' }, r).answer, '6 9');
  assert.deepEqual(asks(r, 'up').map((a) => a.answer), ['6', '9'], '4 阶：满 4 个从第 ⌈4/2⌉ = 2 个分开');
  assert.equal(asks(r, 'split').filter((a) => a.answer === '要分裂').length, 2);
  // 2012 年 408：3 阶 B 树删 78，没有右兄弟，左兄弟 [60 62] 够借：65 下来、62 上去，最右的叶结点是 [65]
  ({ input, r } = go(btreeEngine, { nodes: '[45]([17 35]([10 15], [20 30], [40 42]), [55 65]([50 53], [60 62], [78]))', ops: 'delete 78' }));
  assert.equal(btreeEngine.quiz({ ...input, quizWalk: 'leaf' }, r).answer.split(' ').at(-1), '65');
  assert.equal(asks(r, 'case')[0].answer, '兄弟够借：父子换位');
  // 删 50：叶结点合并，父结点空了，再合并，根空了：树高 3 → 2
  ({ input, r } = go(btreeEngine, { nodes: '[30]([10]([5], [20]), [40]([35], [50]))', ops: 'delete 50' }));
  assert.equal(btreeEngine.quiz(input, r).answer, '10 30 5 20 35 40');
  assert.deepEqual(r.log[0].acts, ['合并', '合并']);
  // 合并以后父结点空了，向它的左兄弟借（孩子跟着挪）；再删非终端结点里的 45：用前驱 42 替代
  ({ input, r } = go(btreeEngine, { nodes: '[45]([17 35]([10 15], [20 30], [40 42]), [55]([50], [60]))', ops: 'delete 60, delete 45' }));
  assert.deepEqual(r.log.map((x) => x.acts), [['合并', '借'], ['替代', '直接删']]);
  assert.equal(btreeEngine.quiz(input, r).answer, '35 17 42 10 15 20 30 40 50 55');
  assert.equal(btreeEngine.quiz(...Object.values(go(btreeEngine, { nodes: '[45]([17 35]([10 15], [20 30], [40 42]), [55]([50], [60]))', ops: 'delete 45', replace: 'succ' }))).answer, '35 17 50 10 15 20 30 40 42 55 60', '用后继 50 替代，[50] 空了和右兄弟合并，父结点再向左兄弟借');
  // 写错的树报出来
  assert.throws(() => btreeEngine.parse({ nodes: '[30]([10 20])', ops: 'delete 10' }), /要有 2 个孩子/);
  assert.throws(() => btreeEngine.parse({ nodes: '[30]([10 20 25], [40])', ops: 'delete 10' }), /最多 m − 1 = 2 个/);
  assert.throws(() => btreeEngine.parse({ nodes: '[30]([40], [50])', ops: 'delete 40' }), /放错了地方/);
  assert.throws(() => btreeEngine.parse({ nodes: '[30]([10]([5], [20]), [40])', ops: 'delete 5' }), /同一层/);
  assert.throws(() => btreeEngine.parse({ btree: '1 2', order: '2' }), /order/);
  assert.throws(() => btreeEngine.parse({ btree: '1 2', plus: 'true', ops: 'delete 1' }), /只演示插入/);
});

test('B+ 树（王道的定义）：关键字和子树一样多，分支结点里是子树最大的关键字', () => {
  // 3 阶 B+ 树依次插入 10 20 … 70：叶结点 [10 20] [30 40] [50 60 70]，根 [20 40 70]
  const { input, r } = go(btreeEngine, { btree: '10 20 30 40 50 60 70', order: '3', plus: 'true' });
  assert.equal(btreeEngine.quiz(input, r).answer, '20 40 70 10 20 30 40 50 60 70');
  assert.deepEqual(asks(r, 'up').map((a) => a.answer), ['20', '40'], '父结点里添的是左半边最大的');
  assert.match(btreeEngine.view(r.steps.at(-1).view, input), /class="sv-blink"/, '叶结点链起来');
  // 错法：右半边最小的当成新添的关键字
  const v = btreeEngine.variants(input).find((x) => x.input.mistake === 'minright');
  const q = asks(r, 'up')[0];
  assert.ok(checkAsk(asks(btreeEngine.run(v.input), 'up').find((a) => a.q === q.q), '30').ok);
});

test('B 树的错法：上限算成 m、分裂时上移错了', () => {
  const { input, r } = go(btreeEngine, { btree: '5 6 9 13 8 2 12 15', order: '4' });
  const vs = btreeEngine.variants(input);
  assert.deepEqual(vs.map((v) => v.input.mistake), ['cap', 'mid']);
  // 上限算成 m = 4：插 13 时 [5 6 9 13] 答「不用分裂」
  const s = asks(r, 'split').find((a) => a.answer === '要分裂');
  assert.ok(checkAsk(asks(btreeEngine.run(vs[0].input), 'split').find((a) => a.q === s.q), '不用分裂').ok);
  // 4 阶（偶数）上移了中间偏右的 9
  const u = asks(r, 'up')[0];
  assert.ok(checkAsk(asks(btreeEngine.run(vs[1].input), 'up').find((a) => a.q === u.q), '9').ok);
  // 填表照错法填，认得出
  assert.notEqual(btreeEngine.quiz(vs[0].input, btreeEngine.run(vs[0].input)).answer, btreeEngine.quiz(input, r).answer);
});

// 说明草稿里的例子：照抄就能用（解析得了、ask 的种类都问得到、没有用不上的字段）
test('说明草稿（docs/drafts/trees.md）里的例子照抄就能用', { skip: !existsSync(new URL('../docs/drafts/trees.md', import.meta.url)) }, () => {
  const md = readFileSync(new URL('../docs/drafts/trees.md', import.meta.url), 'utf8');
  const found = [...md.matchAll(/^(`{3,})(\w+)\n([\s\S]*?)^\1\s*$/gm)].filter((m) => ENGINES[m[2]]);
  assert.ok(found.length >= 3);
  for (const [, , name, src] of found) {
    const e = ENGINES[name];
    const tracked = trackFields(parseFields(src).fields);
    const input = e.parse(tracked.fields);
    const run = e.run(input);
    const spec = commonSpec(tracked.fields);
    assert.deepEqual(resolveAsks(spec.ask, run.steps).errors, [], `${name}：ask 写的问不到`);
    if (spec.mode === 'fill') assert.deepEqual(fillSpec(e.table(input, run, tracked.fields), tracked.fields).errors, []);
    if (spec.mode === 'quiz') assert.ok(e.quiz(input, run, tracked.fields).answer);
    assert.deepEqual(e.problems?.(input, run) || [], []);
    assert.deepEqual(tracked.unknown(), [], `${name}：例子里有用不上的字段`);
  }
});

// 树（二）的演示引擎：huffman、uf、buildtree、thread、forest。和王道的例子对答案，每种错法查一个
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFields } from '../kit/src/parse.js';
import { trackFields, commonSpec, resolveAsks, checkAsk, fillSpec, fillOrder, checkFill } from '../kit/src/stepperspec.js';
import { huffmanEngine } from '../kit/src/engines/huffman.js';
import { ufEngine } from '../kit/src/engines/uf.js';
import { buildtreeEngine, build } from '../kit/src/engines/buildtree.js';
import { threadEngine } from '../kit/src/engines/thread.js';
import { forestEngine, forestOrder } from '../kit/src/engines/forest.js';
import { binOrder, parseForest } from '../kit/src/engines/forestview.js';

const ENGINES = Object.fromEntries([huffmanEngine, ufEngine, buildtreeEngine, threadEngine, forestEngine].map((e) => [e.name, e]));
const go = (e, f) => { const input = e.parse(f); return { input, r: e.run(input) }; };
// 外壳（stepper.js）认错法的办法：错法那一遍里题面、种类一样的问题，学生的答案按它判是对的
const misread = (e, input, ask, given) => {
  for (const v of e.variants(input) || []) {
    const r = e.run(v.input);
    const a = r.steps.flatMap((x) => [x.ask, ...(x.asks || [])]).find((y) => y && y.q === ask.q && y.kind === ask.kind);
    if (a && checkAsk(a, given).ok) return v.label;
  }
  return '';
};
const askOf = (r, tag, i = 0) => r.steps.filter((s) => s.ask?.tag === tag)[i].ask;

test('huffman：王道图 5.24（7 5 2 4，WPL = 35）、2021 统考第 6 题、k 叉补虚结点；错法', () => {
  let { input, r } = go(huffmanEngine, { weights: 'a:7 b:5 c:2 d:4' });
  assert.equal(r.wpl, 35);
  const code = (x) => Object.fromEntries(x.real.map((id) => [x.all[id].name, x.code[id]]));
  assert.deepEqual(code(r), { a: '0', b: '10', c: '110', d: '111' }, '小的在左：18(7, 11(5, 6(2, 4)))');
  assert.deepEqual(askOf(r, 'pick').answer, ['c', 'd']);
  assert.equal(askOf(r, 'wpl').answer, '35');
  assert.ok(checkAsk(askOf(r, 'code'), '1 1 0').ok && checkAsk(askOf(r, 'code'), '110').ok, 'c 的编码 110，空格隔开也认');
  // 错法：所有结点权值加起来 = 35 + 18 = 53
  assert.match(misread(huffmanEngine, input, askOf(r, 'wpl'), '53'), /所有结点的权值/);
  assert.equal(misread(huffmanEngine, input, askOf(r, 'wpl'), '36'), '');
  // 2021 统考：6 3 8 2 10 4，选项 A 的编码（a 00、b 1011、c 01、d 1010、e 11、f 100）
  ({ r } = go(huffmanEngine, { weights: 'a:6 b:3 c:8 d:2 e:10 f:4' }));
  assert.deepEqual(code(r), { a: '00', b: '1011', c: '01', d: '1010', e: '11', f: '100' });
  assert.equal(r.wpl, 80);
  // 王道哈夫曼编码的例子：45 13 12 16 9 5，WPL = 224（编码 a 0、b 101、c 100、d 111、e 1101、f 1100）
  ({ r } = go(huffmanEngine, { weights: 'a:45 b:13 c:12 d:16 e:9 f:5' }));
  assert.equal(r.wpl, 224);
  assert.equal(code(r).e, '1101');
  // 三叉：8 个叶子，(8 − 1) mod 2 = 1，补 1 个虚结点；WPL = 3 + 10 + 18 + 36 = 67；不补是 6 + 15 + 21 + 36 = 78
  ({ input, r } = go(huffmanEngine, { weights: '1 2 3 4 5 6 7 8', k: '3' }));
  assert.equal(r.pad, 1);
  assert.equal(r.wpl, 67);
  assert.equal(askOf(r, 'dummy').answer, '1');
  assert.match(misread(huffmanEngine, input, askOf(r, 'wpl'), '78'), /没补虚结点/);
  assert.match(misread(huffmanEngine, input, askOf(r, 'dummy'), '0'), /没补虚结点/);
  // 权值一样：点哪两个 2 都对
  ({ r } = go(huffmanEngine, { weights: '2 2 2 2' }));
  assert.equal(askOf(r, 'pick').alts.length, 6);
  assert.ok(checkAsk(askOf(r, 'pick'), ['2′′', '2′′′']).ok);
  assert.throws(() => huffmanEngine.parse({ weights: 'a:7 5' }), /混着写/);
  assert.throws(() => huffmanEngine.parse({ weights: '7 -5' }), /非负/);
});

test('uf：王道的 S 数组（根存 −结点数）、Union 的方向、路径压缩、小树并到大树；错法', () => {
  // 王道：S1 = {0, 6, 7, 8}、S2 = {1, 4, 9}、S3 = {2, 3, 5}，S = −4 −3 −3 2 1 2 0 0 0 1；S1 ∪ S2 后 S[0] = −7、S[1] = 0
  const base = 'union 0 6, union 0 7, union 0 8, union 1 4, union 1 9, union 2 3, union 2 5';
  let { input, r } = go(ufEngine, { n: '10', size: 'true', ops: base });
  assert.equal(r.S.join(' '), '-4 -3 -3 2 1 2 0 0 0 1');
  ({ r } = go(ufEngine, { n: '10', size: 'true', ops: `${base}, union 0 1` }));
  assert.equal(r.S.join(' '), '-7 0 -3 2 1 2 0 0 0 1');
  // Union(S, Root1, Root2)：S[Root2] = Root1
  ({ input, r } = go(ufEngine, { n: '8', ops: 'union 1 2, union 3 4, union 2 4, find 4' }));
  assert.equal(r.S.join(' '), '-1 -1 1 1 3 -1 -1 -1');
  assert.deepEqual(r.finds, [1]);
  assert.equal(askOf(r, 'root').answer, '1');
  const p3 = askOf(r, 'parent', 2);
  assert.equal(p3.q, 'Union(2, 4) 以后，S[3] 是多少？');
  assert.match(misread(ufEngine, input, askOf(r, 'parent', 0), '-1'), /根接反/);
  // 路径压缩：4 → 3 → 2 → 1 → 0，Find(4) 以后 4、3、2 都直接挂到 0 下
  ({ input, r } = go(ufEngine, { n: '6', compress: 'true', ops: 'union 3 4, union 2 3, union 1 2, union 0 1, find 4' }));
  assert.equal(r.S.join(' '), '-1 0 0 0 0 -1');
  const pc = r.steps.find((s) => s.ask?.tag === 'parent' && /路径压缩/.test(s.ask.q)).ask;
  assert.equal(pc.q, 'Find(4) 做完路径压缩以后，S[2] 是多少？');
  assert.match(misread(ufEngine, input, pc, '1'), /只改了第一个/);
  // 小树并到大树，一样大时照王道代码的 else：Root1 挂到 Root2 下
  ({ input, r } = go(ufEngine, { n: '8', rank: 'true', ops: 'union 1 2, union 3 4, union 2 4, union 5 1' }));
  assert.equal(r.S.join(' '), '-1 2 4 4 -5 4 -1 -1');
  assert.equal(input.size, true, 'rank: true 时根默认存 −结点数');
  const t = ufEngine.table(input, r, {});
  assert.equal(t.rows[0].cells.map((c) => c.v).join(' '), '-1 2 -2 -1 -1 -1 -1 -1');
  assert.throws(() => ufEngine.parse({ n: '8', ops: 'union 1 8' }), /from: 1/);
  assert.deepEqual(ufEngine.parse({ n: '8', ops: 'Union(1, 2), Find(2)' }).ops.map((o) => o.text), ['union 1 2', 'find 2']);
});

test('buildtree：王道 先序 ABCDEFGHI + 中序 BCAEDGHFI；后序、层序 + 中序；先序 + 后序定不下来；错法', () => {
  const IN = 'B C A E D G H F I';
  let { input, r } = go(buildtreeEngine, { pre: 'ABCDEFGHI', in: IN });
  // 树：A(B(, C), D(E, F(G(, H), I)))
  assert.equal(binOrder(r.tree, 'post').join(''), 'CBEHGIFDA');
  assert.equal(buildtreeEngine.quiz(input, r).answer, 'C B E H G I F D A', '先序 + 中序默认问后序');
  assert.equal(askOf(r, 'split').answer, '2', 'A 的左子树 B C 两个');
  assert.match(misread(buildtreeEngine, input, askOf(r, 'split'), '6'), /左右子树切反/);
  ({ input, r } = go(buildtreeEngine, { post: 'CBEHGIFDA', in: IN }));
  assert.equal(binOrder(r.tree, 'pre').join(''), 'ABCDEFGHI');
  assert.equal(askOf(r, 'root').answer, 'A');
  assert.match(misread(buildtreeEngine, input, askOf(r, 'root'), 'C'), /后序的第一个当成了根/);
  ({ r } = go(buildtreeEngine, { level: 'A B D C E F G I H', in: IN }));
  assert.equal(binOrder(r.tree, 'pre').join(''), 'ABCDEFGHI');
  // 先序 + 后序：每个结点 0 或 2 个孩子能建；只有一个孩子时报出来
  ({ r } = go(buildtreeEngine, { pre: 'ABDEC', post: 'DEBCA' }));
  assert.equal(binOrder(r.tree, 'in').join(''), 'DBEAC');
  assert.throws(() => buildtreeEngine.parse({ pre: 'ABC', post: 'CBA' }), /定不下来：A 只有一个孩子 B/);
  assert.throws(() => buildtreeEngine.parse({ pre: 'ABC', in: 'CAB' }), /对不上/);
  assert.throws(() => buildtreeEngine.parse({ pre: 'ABC', in: 'ABD' }), /没有/);
  assert.throws(() => buildtreeEngine.parse({ in: 'ABC' }), /只有中序/);
  // 错法走不下去时不报错，建出一部分
  assert.doesNotThrow(() => build({ ...buildtreeEngine.parse({ post: 'CBEHGIFDA', in: IN }), mistake: 'firstroot' }));
});

test('thread：A(B(D, E), C) 的中序、先序、后序线索；错法', () => {
  const show = (input, r) => {
    const K = (x) => (x === null ? 'NULL' : input.tree.nodes[x].key);
    return Object.entries(r.threads).filter(([, v]) => Object.keys(v).length).map(([id, v]) => `${K(id)}:${'l' in v ? K(v.l) : '-'}/${'r' in v ? K(v.r) : '-'}`).sort().join(' ');
  };
  // 中序 D B E A C：D 左→NULL、右→B；E 左→B、右→A；C 左→A、右→NULL
  let { input, r } = go(threadEngine, { nodes: 'A(B(D, E), C)' });
  assert.equal(show(input, r), 'C:A/NULL D:NULL/B E:B/A');
  assert.deepEqual(r.steps.filter((s) => s.ask).map((s) => `${s.ask.tag}=${s.ask.answer}`), ['pred=NULL', 'succ=B', 'pred=B', 'succ=A', 'pred=A', 'succ=NULL']);
  assert.equal(threadEngine.quiz(input, r).answer, 'NULL B A', '右指针空着的 C、D、E');
  const eL = r.steps.find((s) => s.ask?.q.startsWith('E 的左指针')).ask;
  assert.match(misread(threadEngine, input, eL, 'A'), /前驱、后继弄反/);
  assert.match(misread(threadEngine, input, eL, 'D'), /按先序线索化/);
  // 先序 A B D E C；后序 D E B C A
  ({ input, r } = go(threadEngine, { nodes: 'A(B(D, E), C)', order: 'pre' }));
  assert.equal(show(input, r), 'C:E/NULL D:B/E E:D/C');
  ({ input, r } = go(threadEngine, { nodes: 'A(B(D, E), C)', order: 'post' }));
  assert.equal(show(input, r), 'C:B/A D:NULL/E E:D/B');
  // 填表：有孩子的直接给出，线索指向 NULL 的写 NULL 或空着都对
  const t = fillSpec(threadEngine.table(input, r, {}), {}).table;
  const values = t.rows.map((row) => row.cells.map((c) => (c.given ? '' : [].concat(c.v)[0])));
  assert.ok(checkFill(t, values).ok);
  assert.throws(() => threadEngine.parse({ nodes: 'A(B)', order: 'zigzag' }), /order:/);
});

test('forest：A(B, C, D) E(F, G) ↔ 二叉树；王道 树 A(B(E, F), C, D(G))；先根 = 先序、后根 = 中序；错法', () => {
  let { input, r } = go(forestEngine, { forest: 'A(B, C, D) E(F, G)' });
  // 二叉树 A(B(, C(, D)), E(F(, G)))
  assert.equal(binOrder(r.B, 'pre').join(''), 'ABCDEFG');
  assert.equal(binOrder(r.B, 'in').join(''), 'BCDAFGE');
  assert.equal(forestOrder(input.F, 'post').join(''), 'BCDAFGE', '森林的中序（后根）= 二叉树的中序');
  assert.equal(forestEngine.quiz(input, r).answer, 'D C B G F E A', '默认问二叉树的后序');
  const cAsk = r.steps.find((s) => s.ask?.q.startsWith('C ')).ask;
  assert.equal(cAsk.answer, 'B 的右孩子');
  assert.ok(cAsk.choices.includes('B 的左孩子'));
  assert.match(misread(forestEngine, input, cAsk, 'B 的左孩子'), /第一个孩子放到了右边/);
  ({ r } = go(forestEngine, { forest: 'A(B(E, F), C, D(G))' }));
  assert.equal(Object.values(r.B.nodes).map((n) => `${n.key}:${n.left ?? '-'}/${n.right ?? '-'}`).sort().join(' '), 'A:B/- B:E/C C:-/D D:G/- E:-/F F:-/- G:-/-');
  // 反过来：二叉树根的右链 A → F → H 断开是三棵树
  ({ input, r } = go(forestEngine, { binary: 'A(B(E, C(, D)), F(G, H))' }));
  assert.deepEqual(input.F.roots, ['A', 'F', 'H']);
  assert.deepEqual(input.F.nodes.A.kids, ['B', 'C', 'D']);
  assert.equal(forestEngine.quiz(input, r).answer, 'A B C D E F G H');
  const dAsk = r.steps.find((s) => s.ask?.q.startsWith('D ')).ask;
  assert.equal(dAsk.answer, 'A');
  assert.match(misread(forestEngine, input, dAsk, 'C'), /右孩子也当成了孩子/);
  assert.throws(() => parseForest('A(B, C'), /右括号/);
  assert.throws(() => parseForest('A(B) B'), /写了两次/);
});

// 示例页里的每个例子：照抄就能用（解析、走完、ask 都问得到、字段都用上、每一步都画得出来、填表的表对得上）
test('示例页 ds-trees2-demo.html：第 0 步不问；ask 都问得到；字段都用上；每一步画得出来', () => {
  const src = readFileSync(new URL('../kit/examples/ds-trees2-demo.html', import.meta.url), 'utf8');
  const blocks = [...src.matchAll(/```(\w+)\n([\s\S]*?)```/g)].filter((m) => ENGINES[m[1]]);
  assert.equal(new Set(blocks.map((m) => m[1])).size, 5, '五个组件都有例子');
  for (const [, name, body] of blocks) {
    const e = ENGINES[name];
    const tracked = trackFields(parseFields(body).fields);
    const { fields } = tracked;
    const where = `${name}（${body.split('\n')[0]}）`;
    const input = e.parse(fields, body);
    const r = e.run(input);
    const spec = commonSpec(fields);
    assert.ok(r.steps.length >= 2, `${where}：至少两步`);
    assert.ok(!r.steps[0].ask && !r.steps[0].asks, `${where}：第 0 步挂了问题`);
    assert.deepEqual(resolveAsks(spec.ask, r.steps).errors, [], `${where}：ask 问不到`);
    for (const [k, s] of r.steps.entries()) assert.match(e.view(s.view, input, { k, picking: true }), /<svg/, `${where}：第 ${k} 步画不出来`);
    const t = e.table(input, r, fields);
    for (const row of t.rows) assert.equal(row.cells.length, t.head.length, `${where}：表的一行和表头格数不一样`);
    assert.ok(fillOrder(fillSpec(t, fields).table).length > 0, `${where}：表里没有要填的`);
    assert.ok(e.quiz(input, r, fields).answer, `${where}：没有 quiz 答案`);
    for (const v of e.variants(input)) assert.doesNotThrow(() => e.run(v.input), `${where}：错法「${v.label}」跑不了`);
    if (e.problems) assert.deepEqual(e.problems(input, r), [], `${where}：自检有提醒`);
    assert.deepEqual(tracked.unknown(), [], `${where}：有用不上的字段`);
  }
});

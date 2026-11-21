// 视觉交互第 5 批 Task 1：成分的括号排成树、排成一层层的行；分裂结构的记号（kit/src/entext.js，纯函数）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBrackets, nestSpans, layerRows, joinsOf, judgeJoins, ROLES, CLAUSE_ROLES, roleName, parseRoles } from '../kit/src/entext.js';

const words = (p, piece) => p.tokens.slice(piece.from, piece.to + 1).map((t) => t.w).join(' ');
const show = (p, rows) => rows.map((r) => `${'  '.repeat(r.depth)}${r.clause === null ? '' : `<${p.spans[r.clause].role}> `}${r.pieces.map((x) => (x.folded !== undefined ? `…(${x.role})` : `${x.role ? `${x.role}:` : ''}${words(p, x)}`)).join(' | ')}`);

test('老写法读出来和以前逐字段一样', () => {
  for (const { src, out } of JSON.parse(readFileSync('tests/fixtures/brackets-before.json', 'utf8'))) assert.deepEqual(JSON.parse(JSON.stringify(parseBrackets(src))), out, src);
});

test('新的成分：插入语 Par、被强调的部分 Emp；从句和插入语算「另起一层」的', () => {
  assert.equal(roleName('Par'), '插入语'); assert.equal(roleName('Emp'), '被强调的部分'); assert.equal(roleName('RC'), '定语从句');
  assert.equal(ROLES.Par, undefined, '不进 ROLES：舞台的句子拿它当认得的成分名');
  assert.deepEqual(parseRoles('S V Par'), [{ key: 'S', name: '主语' }, { key: 'V', name: '谓语' }, { key: 'Par', name: '插入语' }]);
  for (const k of ['RC', 'SC', 'ObC', 'PC', 'AppC', 'AdvC', 'Par']) assert.ok(CLAUSE_ROLES.has(k), k);
  assert.ok(!CLAUSE_ROLES.has('S') && !CLAUSE_ROLES.has('NF'));
});

test('排成树：按包含关系，同一层按位置', () => {
  const p = parseBrackets('[S The man [RC who [V lives] [A next door]]] [V gave] [IO me] [DO a book].');
  const tree = nestSpans(p.spans);
  assert.deepEqual(tree.map((n) => p.spans[n.index].role), ['S', 'V', 'IO', 'DO']);
  assert.deepEqual(tree[0].children.map((n) => p.spans[n.index].role), ['RC']);
  assert.deepEqual(tree[0].children[0].children.map((n) => p.spans[n.index].role), ['V', 'A']);
  // 范围一样的两个（[S [NF To see]]）：外面的在上
  const q = parseBrackets('[S [NF To see]] [V is] [P [NF to believe]].');
  assert.deepEqual(nestSpans(q.spans)[0].children.map((n) => q.spans[n.index].role), ['NF']);
  // 学生标出来的范围交叉了：说是哪两个
  assert.throws(() => nestSpans([{ role: 'S', from: 0, to: 3 }, { role: 'RC', from: 2, to: 5 }]), /交叉/);
});

test('排成一层层的行：主干在最外面，每个从句另起缩进的一行', () => {
  const p = parseBrackets('[S The man [RC who lives next door]] [V gave] [IO me] [DO a book].');
  assert.deepEqual(show(p, layerRows(p)), ['S:The man', '  <RC> who lives next door', 'V:gave | IO:me | DO:a book | .']);
  // 一层的句子：就一行
  const one = parseBrackets('[S Tom] [V likes] [O apples].');
  assert.deepEqual(show(one, layerRows(one)), ['S:Tom | V:likes | O:apples | .']);
  // 套三层：同位语从句里的宾语从句
  const three = parseBrackets('[S The fact [AppC that [S he] [V said] [ObC that [S she] [V left]]]] [V surprised] [O us].');
  assert.deepEqual(show(three, layerRows(three)), ['S:The fact', '  <AppC> that | S:he | V:said', '    <ObC> that | S:she | V:left', 'V:surprised | O:us | .']);
  // 状语从句在句首：后面的逗号跟着它收尾（2026-11-21 改：以前逗号起了主干那一行）；没括的词（by then）照原样留在那一行
  const adv = parseBrackets('[AdvC When [S he] [V arrived]], [S we] [V had left] by then.');
  assert.deepEqual(show(adv, layerRows(adv)), ['  <AdvC> When | S:he | V:arrived | ,', 'S:we | V:had left | by then .']);
  // 插入语
  const par = parseBrackets('[S The plan], [Par I think], [V will work].');
  assert.deepEqual(show(par, layerRows(par)), ['S:The plan | ,', '  <Par> I think | ,', 'V:will work | .']);
});

test('句末只剩标点的一行回到主干那一行（2026-11-21 改：以前挪进了最后一个从句）；一个从句被里面的从句隔开时，后一截标「接着」', () => {
  const p = parseBrackets('[S He] [V said] [ObC that [S she] [V left]].');
  const rows = layerRows(p);
  assert.equal(rows.length, 2, '句号不单独占一行');
  assert.deepEqual(show(p, rows), ['S:He | V:said | .', '  <ObC> that | S:she | V:left']);
  assert.equal(rows[0].pieces.at(-1).tail, true);
  const q = parseBrackets('[S We] [V know] [ObC that [S the plan [RC which [S they] [V made]]] [V failed]].');
  const r = layerRows(q);
  assert.deepEqual(show(q, r), ['S:We | V:know | .', '  <ObC> that | S:the plan', '    <RC> which | S:they | V:made', '  <ObC> V:failed']);
  assert.deepEqual(r.map((x) => !!x.cont), [false, false, false, true]);
});

test('折起一个从句：那一处变成「…」，前后的主干接成一行', () => {
  const p = parseBrackets('[S The man [RC who lives next door]] [V gave] [IO me] [DO a book].');
  const rc = p.spans.findIndex((s) => s.role === 'RC');
  assert.deepEqual(show(p, layerRows(p, { fold: [rc] })), ['S:The man | …(RC) | V:gave | IO:me | DO:a book | .']);
  // 折外面的那一层，里面的跟着收起来；只折里面的，外面的还在
  const three = parseBrackets('[S The fact [AppC that [S he] [V said] [ObC that [S she] [V left]]]] [V surprised] [O us].');
  const app = three.spans.findIndex((s) => s.role === 'AppC'), obc = three.spans.findIndex((s) => s.role === 'ObC');
  assert.deepEqual(show(three, layerRows(three, { fold: [app] })), ['S:The fact | …(AppC) | V:surprised | O:us | .']);
  assert.deepEqual(show(three, layerRows(three, { fold: [obc] })), ['S:The fact', '  <AppC> that | S:he | V:said | …(ObC)', 'V:surprised | O:us | .']);
});

test('分裂结构：~n 一样的两段是一家', () => {
  const p = parseBrackets('[S~1 The rumor] [V spread] [AppC~1 that [S he] [V had resigned]].');
  assert.deepEqual(p.spans.filter((s) => s.join).map((s) => [s.role, s.join]), [['S', 1], ['AppC', 1]]);
  assert.equal(p.text, 'The rumor spread that he had resigned.');
  const joins = joinsOf(p.spans);
  assert.deepEqual(joins.map((j) => j.parts.map((i) => p.spans[i].role)), [['S', 'AppC']]);
  assert.throws(() => parseBrackets('[S~1 The rumor] [V spread] quickly.'), /~1.*只有一段/);
  assert.throws(() => parseBrackets('[S~1 A] [V~1 b] [O~1 c].'), /~1.*两段/);
  assert.deepEqual(joinsOf(parseBrackets('[S Tom] [V runs].').spans), []);
  // 学生连的：对、连错、没连
  const [s, v, app] = [0, 1, 2].map((k) => p.spans.findIndex((x) => x.role === ['S', 'V', 'AppC'][k]));
  assert.equal(judgeJoins([[app, s]], joins).ok, true, '先点哪一段都行');
  const bad = judgeJoins([[s, v]], joins);
  assert.equal(bad.ok, false); assert.match(bad.text, /不是一家/);
  assert.equal(judgeJoins([], joins).ok, null);
});

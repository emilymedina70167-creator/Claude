// 舞台的场景（kit/src/stage/scene.js）：一行指令先检查再改场景；写错的挡下、说清楚错在哪；给老师看的现状照场景写
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun, compareValues, SWEEP_MAX, sweepLine, expectHit, pickAnswer, pickText, pickDiffText, KEEP_MAX, snapOf, restoreSnap } from '../kit/src/stage/scene.js';
import { parseScript, parseRich } from '../kit/src/stage/script.js';
import { serialize } from '../kit/src/stage/types/tree.js';
import { undoPlan } from '../kit/src/stage/gestures.js';
import { actText } from '../kit/src/stage/stage.js';
import { linkGeom } from '../kit/src/stage/layout.js';
import { cellBox, array as arrayType } from '../kit/src/stage/types/array.js';
import { goalStatus } from '../kit/src/stage/goal.js';
const objectBox = (o) => arrayType.objectBox(o);

const run = (scene, src) => { for (const c of parseScript(src)) scene.apply(c); return scene; };
const values = (s, id = 'a') => [...s.objects.get(id).cells].sort((x, y) => x.slot - y.slot).map((c) => c.value);

test('希尔排序那一段（样子页的剧本）在场景上整段走得通，一行不错', () => {
  const s = new Scene();
  const src = `
    array a = 49 38 65 97 76 13 27 49′ 55 04
    say "这一排数要排成从小到大。先留意这两个：{a.1} 和 {a.8}，一样大。"
    glow a.1 a.8
    unglow a.1 a.8
    lift a.1
    hop a.1 -> a.6 color=g1 label="隔 5 个"
    drop a.1
    paint a.1 a.6 g1
    ask tap a "那 {a.2} 和谁一组？点一下。"
    link a.2 a.7 g2
    & paint a.2 a.7 g2
    unlabel hop:a1
    link a.3 a.8 g3
    link a.4 a.9 g4
    link a.5 a.10 g5
    dial d = 5 range=1-5 at=a
    label n dial:d "{d} 组" side=right tone=note
    group a stride=d
    ask next "拨一下 $d$" button="看出来了"
    set d 5
    unlabel n
    unlabel dial:d
    split a
    ask tap a#1 a#8 "点你觉得会在前面的那个。"
    ask drag a#1 a#6
    swap a#1 a#6
    swap a#2 a#7
    swap a#3 a#8
    swap a#4 a#9
    swap a#5 a#10
    merge a
    unlink a
    say "两个一样大的数，排完以后先后对调了。这样的排序，就叫 [不稳定]。"
    fly say.1 -> key a#8 a#1
  `;
  assert.deepEqual(dryRun(s, src), []);
  run(s, src);
  assert.deepEqual(values(s), ['13', '27', '49′', '55', '04', '49', '38', '65', '97', '76']);
  assert.equal(s.objects.get('a').cells.find((c) => c.key === 8).slot, 3, '49′ 跟着走到了第 3 格');
  assert.equal(s.links.size, 0);
  assert.equal(s.labels.get('key').text, '不稳定');
});

test('写错的行挡下来，说清楚错在哪；别的行不受影响', () => {
  const s = run(new Scene(), 'array a = 3 1 2');
  const errs = dryRun(s, `
    swap a.1 a.4
    swap a.1
    paint a.1 g9
    hop a.1 -> b.2
    glow x.1
    retext nope "字"
    fly say.1 -> k a.1
    ask poke a
    set d 3
    array b = ${Array.from({ length: 17 }, (_, i) => i).join(' ')}
    zoom a
    swap a.1 a.2
  `);
  const msg = errs.map((e) => e.error);
  assert.match(msg[0], /a 只有 3 格，没有第 4 格/);
  assert.match(msg[1], /swap 要正好两格（写了 1 格）/);
  assert.match(msg[2], /颜色只有 g1～g6/);
  assert.match(msg[3], /舞台上没有「b」|hop 要两头都是格子|不是舞台上的东西/);
  assert.match(msg[4], /不是舞台上的东西/);
  assert.match(msg[5], /没有叫「nope」的字/);
  assert.match(msg[6], /上一句话里没有第 1 个 \[词\]/);
  assert.match(msg[7], /ask 后面写 tap \/ drag \/ next \/ say/);
  assert.match(msg[8], /没有叫「d」的数/);
  assert.match(msg[9], /一排最多 16 格/);
  assert.match(msg[10], /没有「zoom」这个指令/);
  assert.equal(errs.length, 11, '最后一行没错');
  assert.deepEqual(values(s), ['3', '1', '2'], 'dryRun 不动真的场景');
  // 话里指着不存在的格子也挡下
  assert.match(new Scene().check(parseScript('say "{a.1}"')[0]), /舞台上没有「a」/);
});

test('插入：挪到前面，中间的格子各往后让一格；挪到后面，各往前让一格', () => {
  const s = run(new Scene(), 'array a = 1 2 3 4 5');
  s.apply(parseScript('move a.4 -> a.2')[0]);
  assert.deepEqual(values(s), ['1', '4', '2', '3', '5']);
  s.apply(parseScript('move a#4 -> a.5')[0]);
  assert.deepEqual(values(s), ['1', '2', '3', '5', '4']);
  s.apply(parseScript('write a.1 9')[0]);
  assert.equal(values(s)[0], '9');
});

test('分组跟着拨的数走：拨了 d，旧的连线收掉、按新的 d 重新染色连线；只有一组就不染', () => {
  const s = run(new Scene(), 'array a = 1 2 3 4 5 6\ndial d = 3 range=1-6\ngroup a stride=d');
  assert.equal(s.links.size, 3); // 1-4, 2-5, 3-6
  assert.deepEqual([...s.objects.get('a').cells].map((c) => c.paint), ['g1', 'g2', 'g3', 'g1', 'g2', 'g3']);
  s.apply(parseScript('set d 2')[0]);
  assert.equal(s.links.size, 4); // 1-3-5, 2-4-6
  s.apply(parseScript('set d 1')[0]);
  assert.equal(s.links.size, 0);
  assert.ok(s.objects.get('a').cells.every((c) => c.paint === null));
  // 拨不出范围
  s.apply(parseScript('set d 99')[0]);
  assert.equal(s.vars.get('d').v, 6);
});

test('指针、比较、灰掉：折半查找要用的几样', () => {
  const s = run(new Scene(), 'array a = 5 13 19 21 37 56 64 75 80 88\nptr low a.1\nptr high a.10\nptr mid a.5\ndim a.1-5');
  assert.deepEqual([...s.objects.get('a').ptrs], [['low', 1], ['high', 10], ['mid', 5]]);
  s.apply(parseScript('ptr low a.6')[0]);
  assert.equal(s.objects.get('a').ptrs.get('low'), 6, '同名的指针挪过去');
  assert.equal(s.apply(parseScript('compare a.5 a.6')[0]).sign, -1);
  assert.equal(compareValues('49′', '49'), 0);
  assert.equal(compareValues('b', 'a'), 1);
  assert.equal(s.objects.get('a').cells.filter((c) => c.dim).length, 5);
});

test('给老师看的现状：值、颜色、谁跟着走到了哪、连线、字、拨数、在等什么', () => {
  const s = run(new Scene(), 'array a = 49 38 65\nswap a.1 a.3\npaint a.1 g1\nlink a.1 a.3 g1\nlabel t a.1 "看这里"\ndial d = 2 range=1-3\nask tap a "点一下"');
  const t = s.stateText();
  assert.match(t, /第 1～3 格：65（#3、蓝） 38 49（#1）/);
  assert.match(t, /连线：a#3–a#1 蓝|连线：a#1–a#3 蓝/);
  assert.match(t, /t「看这里」/);
  assert.match(t, /d = 2（1～3）/);
  assert.match(t, /在等学生：点/);
  assert.match(new Scene().stateText(), /舞台上还是空的/);
});

test('副本和原来的互不影响（检查一行时在副本上试）', () => {
  const s = run(new Scene(), 'array a = 1 2\ndial d = 1 range=1-2');
  const c = s.clone();
  c.apply(parseScript('swap a.1 a.2')[0]);
  c.apply(parseScript('set d 2')[0]);
  assert.deepEqual(values(s), ['1', '2']);
  assert.equal(s.vars.get('d').v, 1);
});

test('排版：分开排时格子下到第几排；两排格子上下摆开；连线的弧算出占的地方', () => {
  const s = run(new Scene(), 'array a = 1 2 3 4\narray b = 9 9');
  const a = s.objects.get('a'), b = s.objects.get('b');
  assert.ok(b.origin.y > objectBox(a).y + objectBox(a).h, '第二排在第一排下面');
  s.apply(parseScript('group a stride=2')[0]);
  s.apply(parseScript('split a')[0]);
  const c3 = a.cells.find((c) => c.slot === 3);
  assert.equal(c3.row, 1);
  assert.ok(cellBox(a, c3).y > 64);
  const g = linkGeom({ x: 0, y: 0, w: 64, h: 64 }, { x: 304, y: 0, w: 64, h: 64 });
  assert.ok(g.box.y < -20 && g.box.w === 304 && /^M32 -6 Q/.test(g.d));
});

test('扣过去 / 翻开：查找时「只能翻开看」（子代理当老师上折半查找时要的）', () => {
  const s = run(new Scene(), 'array a = 7 10 13 16 19\ncover a\nuncover a.3');
  assert.deepEqual(s.objects.get('a').cells.map((c) => c.covered), [true, true, false, true, true]);
  assert.match(s.stateText(), /7（扣着） 10（扣着） 13 16（扣着）/);
  // 并着写也一样：先扣上、再翻开一格
  const t = run(new Scene(), 'array a = 1 2 3\ncover a\n& uncover a.2');
  assert.deepEqual(t.objects.get('a').cells.map((c) => c.covered), [true, false, true]);
});

test('子代理当老师上的折半查找四轮：一行不错', () => {
  const s = new Scene();
  const turns = [
    `array a = 7 10 13 16 19 29 32 33 37 41 43
array k = 33
label kt k.1 "要找的" side=left tone=note
say "在这排里找 {k.1}。不从头一格格翻，先翻正中间那一格。"
ptr mid a.6
glow a.6
wait 600
compare k.1 a.6
say "{k.1} 比 {a.6} 大，这一格不是。"
ask tap a "{k.1} 还可能藏在哪一边？点那一边的任意一格。"`,
    `say "对，在右边。{a.6} 左边的都比它小，更不可能是 {k.1}。"
unglow a.6
dim a.1-6
paint a.7-11 g1
unptr mid
ask tap a "只剩这 5 格了。下一次先翻哪一格？" expect=a.9`,
    `say "对，就是 {a.9}。现在像电脑一样，没翻开的都扣上。"
cover a
& uncover a.6
uncover a.9
ptr mid a.9
compare k.1 a.9
ask tap a "{k.1} 比它小。现在还可能藏在哪几格？点其中一格。"`,
  ];
  for (const src of turns) { assert.deepEqual(dryRun(s, src), []); run(s, src); }
  const k = s.objects.get('k');
  assert.equal(k.origin.x, Math.round((0 + 11 * 76 - 12) / 2 - 64 / 2), '一格的「要找的」放在正下方');
});

test('拨数的范围能写负数（-3..3），比大小认分数', async () => {
  const { parseRange } = await import('../kit/src/stage/scene.js');
  assert.deepEqual(parseRange('-3..3'), [-3, 3]);
  assert.deepEqual(parseRange('1-5'), [1, 5]);
  assert.deepEqual(parseRange('0.5..2'), [0.5, 2]);
  assert.ok(Number.isNaN(parseRange('abc')[0]));
  const s = run(new Scene(), 'array a = 1 2\ndial k = 0 range=-3..3');
  assert.deepEqual([s.vars.get('k').lo, s.vars.get('k').hi], [-3, 3]);
  s.apply(parseScript('set k -2')[0]);
  assert.equal(s.vars.get('k').v, -2);
  assert.equal(compareValues('1/2', '0.4'), 1);
  assert.equal(compareValues('−3/4', '-0.75'), 0);
});


test('排版的根：量出来多出去的（o.ext）算进占的地方；后造的东西让开先造的东西和贴在它上面的字；乘积写算式那一条跟着乘积走', async () => {
  const { parseScript } = await import('../kit/src/stage/script.js');
  const run = (sc, src) => { for (const c of parseScript(src)) sc.apply(c); };
  const sc = new Scene();
  run(sc, 'array a = 1 2 3\narray b = 4 5 6');
  const a0 = sc.objectBox('a'), b0 = sc.objectBox('b');
  // 画出来比估的高（比如题卡的字折了行）：占的地方跟着变大，下面的往下让
  sc.objects.get('a').ext = { l: 0, t: 0, r: 0, b: 120 };
  assert.equal(sc.objectBox('a').h, a0.h + 120);
  sc.reflow();
  assert.ok(sc.objectBox('b').y >= a0.y + a0.h + 120, '下面的东西没让开量出来多出去的那一块');
  // 贴在 a 上的字占了 b 的地方：b 往下让；贴在 a、b 两个上面的字不推 b
  const sc2 = new Scene();
  run(sc2, 'array a = 1 2 3\narray b = 4 5 6');
  const bb = sc2.objectBox('b');
  sc2.labelRects = [{ x: bb.x, y: bb.y - 10, w: 80, h: 40, objs: ['a', 'b'] }];
  sc2.reflow();
  assert.equal(sc2.objectBox('b').y, bb.y);
  sc2.labelRects = [{ x: bb.x, y: bb.y - 10, w: 80, h: 40, objs: ['a'] }];
  sc2.reflow();
  assert.ok(sc2.objectBox('b').y >= bb.y + 30, '贴在先造的东西上的字没让后造的东西让开');
  // 乘积被推下去：写算式那一条跟着走（存的是相对位置），乘积占的地方不会被拉长
  const sc3 = new Scene();
  run(sc3, 'matrix A = 1 1 / -1 -1\nmatrix B = 1 -1 / -1 1 beside=A\nproduct C = A B\nproduct D = B A');
  const d0 = sc3.objectBox('D');
  sc3.objects.get('D').origin.y += 200;
  const d1 = sc3.objectBox('D');
  assert.equal(d1.h, d0.h);
  assert.equal(d1.y, d0.y + 200);
});

// —— 裁判接进场景（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 2 节）——
const one = (src) => parseScript(src)[0];
const stu = (s, src, open) => s.apply(one(src), { by: 'student', open });

test('open 的写法：wrong= / call= / undo= 存进 policy；手势表里的动作名也认；写错了说能写什么', () => {
  const s = run(new Scene(), 'tree t = 30 20 _ 10\nopen t rotate wrong=mark call=wrong undo=on');
  const e = s.opens.get('t:rotate');
  assert.deepEqual(e.policy, { wrong: 'mark', call: 'wrong', undo: true });
  assert.equal(e.gesture.gesture, 'drop-on', '存手势表那一项');
  assert.deepEqual(e.refs, []);
  // 没写就是默认：照做、只记下，照现在的规矩叫老师，不能撤
  run(s, 'open t insert');
  assert.deepEqual(s.opens.get('t:insert').policy, { wrong: 'quiet', call: null, undo: false });
  assert.match(s.check(one('open t rotate wrong=maybe')), /quiet mark block/);
  assert.match(s.check(one('open t rotate call=sometimes')), /wrong done/);
  assert.match(s.check(one('open t rotate undo=yes')), /on off/);
  assert.match(s.check(one('open t fly')), /rotate.*insert.*place|drag/);
  // 给老师看的现状：不是默认的写出来
  assert.match(s.stateText(), /t rotate（[^）]*wrong=mark[^）]*call=wrong[^）]*undo=on/);
  assert.doesNotMatch(s.stateText(), /t insert（[^）]*wrong=/);
  // 矩阵、句子的手势
  const m = run(new Scene(), 'matrix M = 1 2 / 3 4\nopen M rowop wrong=block');
  assert.deepEqual(m.opens.get('M:rowop').policy, { wrong: 'block', call: null, undo: false });
  const sn = run(new Scene(), 'sentence s = "He is running." key="[S He] [V is running]."\nopen s mark call=done');
  assert.equal(sn.opens.get('s:mark').gesture.gesture, 'span');
  // 旧写法意思不变；判不了对错的东西写 wrong= / call= 说清楚
  const b = run(new Scene(), 'matrix B = 1 2 / 3 4\nopen B edit range=-3..3');
  assert.deepEqual([b.opens.get('B:edit').lo, b.opens.get('B:edit').hi], [-3, 3]);
  assert.match(run(new Scene(), 'array a = 3 1 2').check(one('open a wrong=mark')), /判不了/);
  assert.equal(run(new Scene(), 'array a = 3 1 2').check(one('open a undo=on')), null);
});

test('@t.wrong 报错；@名字. 后面只认 done / right；@名字.done 要先交给学生做', () => {
  const s = run(new Scene(), 'tree t = 30 20 _ 10\nopen t rotate');
  assert.equal(s.check(one('@t.wrong say "不对"')), '走偏以后怎么讲要等你看着学生写，不能预写');
  assert.match(s.check(one('@t.maybe say "x"')), /done.*right/);
  assert.match(s.check(one('@zz.done say "x"')), /舞台上没有/);
  assert.match(run(new Scene(), 'tree t = 30 20 _ 10').check(one('@t.done say "x"')), /open t rotate/);
  assert.match(run(new Scene(), 'array a = 1 2').check(one('@a.done say "x"')), /判不了/);
  // 预写的行写错了当场说
  assert.match(s.check(one('@t.done swap t.30')), /swap/);
  run(s, '@t.done say "平了。"\n@t.right say "对。"');
  assert.deepEqual(s.reactions.get('t.done'), ['say "平了。"']);
  assert.match(s.stateText(), /t 做完了页面马上演你预写的 1 行/);
});

test('@t.done：插完、转平以后交出预写的行；没 open 的树、本来就平衡的树不算学生做完', () => {
  const s = run(new Scene(), 'tree t = 30 20 tray="10"\nopen t insert\nopen t rotate\n@t.done say "平了。"');
  let fx = stu(s, 'insert t 10', 'insert');
  assert.equal(fx.done, undefined, '插完 30 失衡了，还没做完');
  assert.equal(fx.judged.verdict.right, true);
  fx = stu(s, 'rotate t.30 right', 'rotate');
  assert.deepEqual(fx.done, ['t']);
  assert.deepEqual(fx.reactions, [{ done: 't', src: 'say "平了。"' }]);
  assert.equal(s.reactions.has('t.done'), false, '预写的只演一次');
  // 没 open 的树：转平了也不算学生做完
  const n = run(new Scene(), 'tree t = 30 20 _ 10');
  assert.equal(n.apply(one('rotate t.30 right'), { by: 'student' }).done, undefined);
  // 一 open 就已经平衡、托盘空的树：不算做完（学生还没动）
  const b = run(new Scene(), 'tree t = 20 10 30');
  assert.equal(b.apply(one('open t rotate')).done, undefined);
  assert.equal(stu(b, 'swap t.10 t.30', 'drag').done, undefined);
  // 乘积不能交给学生做行变换（数跟着 A、B 算，做了也会被算回去）
  const p = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1\nproduct C = A B');
  assert.match(p.check(one('open C rowop')), /是乘积.*算回去/);
  // 没写 key 的句子：永远不算做完
  const q = run(new Scene(), 'sentence s = "He is running."\nopen s mark');
  assert.equal(stu(q, 'mark s.1 S', 'mark').done, undefined);
  // 矩阵消成阶梯形
  const m = run(new Scene(), 'matrix M = 1 2 / 2 5\nopen M rowop');
  assert.deepEqual(stu(m, 'rowop M r2 - 2r1', 'rowop').done, ['M']);
});

test('学生的一下过裁判：quiet 照做只记；mark 照做、淡淡圈着，那样东西下一次变了就收掉；block 不让做；不合规则的永远不做', () => {
  const base = 'tree t = 50 30 70 20 40 _ _ _ _ 35';
  // LR 型（50 失衡，从 50 往下是 L、R）：正确的下一步是先在 30 左旋
  const quiet = run(new Scene(), `${base}\nopen t rotate`);
  let fx = stu(quiet, 'rotate t.50 right', 'rotate');
  assert.equal(fx.blocked, undefined);
  assert.equal(fx.judged.verdict.right, false);
  assert.match(fx.judged.verdict.misread, /只看了离新结点最近的两步/);
  assert.equal(fx.judged.call, null);
  assert.equal(quiet.objects.get('t').root !== undefined, true);
  const marked = run(new Scene(), `${base}\nopen t rotate wrong=mark call=wrong`);
  fx = stu(marked, 'rotate t.50 right', 'rotate');
  assert.equal(fx.judged.mark, true);
  assert.equal(fx.judged.call, 'now');
  assert.ok(marked.parts('t.50')[0].slip, '那一处淡淡圈着');
  assert.match(marked.stateText(), /淡淡圈着[^\n]*t\.50/);
  // 那样东西下一次变了：收掉（又走偏了就圈新的那一处）
  fx = stu(marked, 'rotate t.30 right', 'rotate');
  assert.equal(fx.judged.verdict.right, false);
  assert.deepEqual(marked.allParts().filter((p) => p.slip).map((p) => p.value), ['30']);
  stu(marked, 'write t.70 71', 'drag');
  assert.ok(!marked.allParts().some((p) => p.slip));
  assert.doesNotMatch(marked.stateText(), /淡淡圈着/);
  // 别的东西变了不收
  const two = run(new Scene(), `${base}\nopen t rotate wrong=mark\narray a = 1 2`);
  stu(two, 'rotate t.50 right', 'rotate');
  two.apply(one('swap a.1 a.2'), { by: 'teacher' });
  assert.ok(two.parts('t.50')[0].slip);
  const blocked = run(new Scene(), `${base}\nopen t rotate wrong=block`);
  const before = blocked.stateText();
  fx = stu(blocked, 'rotate t.50 right', 'rotate');
  assert.equal(fx.blocked, true);
  assert.equal(blocked.stateText(), before, '不让做：舞台不动');
  // 这个世界的物理：35 没有左孩子，右旋转不了——quiet 也不做
  fx = stu(quiet, 'rotate t.35 right', 'rotate');
  assert.equal(fx.blocked, true);
  assert.equal(fx.judged.verdict.legal, false);
  // 做对一步：有 @t.right 就交出预写的行（只演一次）
  const right = run(new Scene(), `${base}\nopen t rotate\n@t.right say "对，先转孩子。"`);
  fx = stu(right, 'rotate t.30 left', 'rotate');
  assert.equal(fx.judged.verdict.right, true);
  assert.deepEqual(fx.reactions, [{ right: 't', src: 'say "对，先转孩子。"' }]);
  assert.equal(stu(right, 'rotate t.50 right', 'rotate').reactions, undefined);
  // 不给 by（老写法、检查一行、重放老师的行）：不过裁判
  const plain = run(new Scene(), `${base}\nopen t rotate wrong=block`);
  assert.equal(plain.apply(one('rotate t.50 right')).judged, undefined);
});

test('老师的一下也过裁判：照演不拦，不是正确的下一步写进事实', () => {
  const s = run(new Scene(), 'tree t = 50 30 70 20 40 _ _ _ _ 35\nopen t rotate wrong=block');
  const fx = s.apply(one('rotate t.50 right'), { by: 'teacher' });
  assert.equal(fx.blocked, undefined);
  assert.equal(fx.judged.call, null);
  assert.match(fx.judged.facts.join('\n'), /你在 50 右旋，现在正确的是先在 30 左旋/);
  // 没有规则、不是动作的行：不判
  assert.equal(s.apply(one('say "看"'), { by: 'teacher' }).judged, undefined);
});

test('规则自己出错（check 抛了）：当没判，照做、不拦学生，记下没判成', async () => {
  const { registerRules } = await import('../kit/src/stage/rules.js');
  const { treeRules } = await import('../kit/src/stage/types/tree.rules.js');
  registerRules('tree', { ...treeRules, check: () => { throw new Error('规则坏了'); } });
  try {
    const s = run(new Scene(), 'tree t = 50 30 70 20 40 _ _ _ _ 35\nopen t rotate wrong=block');
    const fx = stu(s, 'rotate t.50 right', 'rotate');
    assert.equal(fx.blocked, undefined);
    assert.equal(fx.judged.verdict.right, null);
    assert.equal(fx.judged.failed, '规则坏了');
  } finally { registerRules('tree', treeRules); }
});

test('学生、老师写的一行读成规则认的动作：rotate（一下 / 整个型）、insert（从根比下去 / 自己摆）、rowop（几步）、mark；别的指令不判', () => {
  const t = run(new Scene(), 'tree t = 50 30 70 20 40 _ _ _ _ 35\nopen t rotate\nopen t place');
  const act = (s, src) => s.judgeLine(one(src), { by: 'student' })?.act ?? null;
  assert.deepEqual(act(t, 'rotate t#2 left'), { type: 'rotate', at: 2, dir: 'left' });
  assert.deepEqual(act(t, 'rotate t.50 LR'), { type: 'rotate', at: 1, kind: 'LR' });
  assert.deepEqual(act(t, 'insert t 65'), { type: 'insert', value: '65' });
  assert.deepEqual(act(t, 'insert t.70 left 65'), { type: 'insert', value: '65', parent: 3, side: 'left' });
  assert.equal(act(t, 'swap t.20 t.40'), null);
  assert.equal(t.judgeLine(one('say "看"'), { by: 'student' }), null);
  const m = run(new Scene(), 'matrix M = 1 2 3 / 2 4 7 / 1 3 5\nopen M rowop');
  assert.deepEqual(act(m, 'rowop M r2 - 2r1, r3 - r1'), { type: 'rowop', op: 'r2 - 2r1, r3 - r1' });
  // 改一格也读成动作（check 不判对错，right 是 null）：学生写满一行时 from= 的矩阵要拿它和原来那一张比
  assert.deepEqual(act(m, 'write M.1,1 5'), { type: 'write', r: 1, c: 1, value: '5' });
  assert.equal(m.judgeLine(one('write M.1,1 5'), { by: 'student' }).verdict.right, null);
  // 漏乘倍数：不是正确的下一步，说像哪种错
  assert.match(m.judgeLine(one('rowop M r2 - r1'), { by: 'student' }).verdict.misread, /倍数不对/);
  const s = run(new Scene(), 'sentence s = "He is running." key="[S He] [V is running]."\nopen s mark');
  assert.deepEqual(act(s, 'mark s.2-3 V'), { type: 'mark', from: 2, to: 3, role: 'V' });
  assert.equal(act(s, 'mark s.1 s.3 V'), null, '不连着的几个词不是一段');
  assert.match(s.judgeLine(one('mark s.2 V'), { by: 'student' }).verdict.misread, /谓语只圈了一半/);
});

test('二叉排序树的课（只交了 insert / place）：托盘插完就是做完，插完失衡也演 @t.done', () => {
  const s = run(new Scene(), 'tree t = 50 tray="30 20 10"\nopen t insert\n@t.done say "插完了。"');
  assert.equal(stu(s, 'insert t 30', 'insert').done, undefined);
  assert.equal(stu(s, 'insert t 20', 'insert').judged.verdict.right, true, '二叉排序树的课不说还没转平');
  const fx = stu(s, 'insert t 10', 'insert');
  assert.deepEqual(fx.done, ['t'], '托盘空了就做完（树不平衡也一样）');
  assert.deepEqual(fx.reactions, [{ done: 't', src: 'say "插完了。"' }]);
  assert.doesNotMatch(s.stateText(), /预写的/);
  const p = run(new Scene(), 'tree t = 50 tray="30 20"\nopen t place\n@t.done say "摆完了。"');
  stu(p, 'insert t#1 left 30', 'place');
  assert.deepEqual(stu(p, 'insert t.30 left 20', 'place').done, ['t']);
  // 交了 rotate 的还是平衡二叉树的课：插完失衡没做完
  const a = run(new Scene(), 'tree t = 50 tray="30 20"\nopen t insert\nopen t rotate');
  stu(a, 'insert t 30', 'insert');
  assert.equal(stu(a, 'insert t 20', 'insert').done, undefined);
});

test('写了不会生效的 wrong= / call= / 预写，当场报错说清为什么', () => {
  const m = run(new Scene(), 'matrix B = 1 2 / 3 4');
  assert.match(m.check(one('open B edit wrong=mark')), /B 的 edit|edit 页面判不了对错.*open B rowop/);
  assert.match(run(new Scene(), 'tree t = 30 20 _ 10').check(one('open t drag wrong=block')), /drag 页面判不了对错.*open t rotate/);
  assert.match(run(new Scene(), 'sentence s = "He is running." key="[S He] [V is running]."').check(one('open s fold call=wrong')), /fold 页面判不了对错/);
  assert.equal(m.check(one('open B rowop wrong=mark')), null);
  // @t.right：只交了拖的树，没有一下会被判对
  const d = run(new Scene(), 'tree t = 30 20 _ 10\nopen t drag');
  assert.match(d.check(one('@t.right say "对"')), /open t rotate/);
  // @s.done：没写 key 的句子永远判不出做完
  const k = run(new Scene(), 'sentence s = "He is running."\nopen s mark');
  assert.match(k.check(one('@s.done say "好"')), /判不了 s.*没写 key/);
  assert.match(k.check(one('@s.right say "好"')), /没写 key/);
  // 现在就已经做完了（平衡、没托盘的树；已经是阶梯形的矩阵）
  assert.match(run(new Scene(), 'tree t = 20 10 30\nopen t rotate').check(one('@t.done say "x"')), /现在就已经做完了/);
  assert.match(run(new Scene(), 'matrix M = 1 2 / 0 1\nopen M rowop').check(one('@M.right say "x"')), /现在就已经做完了/);
});

test('规则的 next、facts 自己出错：不拦这一行，交出 ruleErrors（画面写进出错记录）', async () => {
  const { registerRules } = await import('../kit/src/stage/rules.js');
  const { treeRules } = await import('../kit/src/stage/types/tree.rules.js');
  const s = run(new Scene(), 'tree t = 50 30 70 20 40 _ _ _ _ 35\nopen t rotate');
  registerRules('tree', { ...treeRules, next: () => { throw new Error('下一步坏了'); }, facts: () => { throw new Error('事实坏了'); } });
  try {
    const fx = stu(s, 'rotate t.30 left', 'rotate');
    assert.equal(fx.blocked, undefined);
    assert.ok(fx.ruleErrors.some((e) => /下一步坏了/.test(e)) && fx.ruleErrors.some((e) => /事实坏了/.test(e)), JSON.stringify(fx.ruleErrors));
  } finally { registerRules('tree', treeRules); }
});

// 手势那边（第 9 个任务）走 act → actSrc → 一行指令 → actOf → act：两头要对得上，判的才是学生做的那一下
const core = (a) => (a.type === 'rotate' ? { type: a.type, at: a.at, ...(a.dir ? { dir: a.dir } : { kind: a.kind }) }
  : a.type === 'insert' ? { type: a.type, value: String(a.value), ...(a.parent != null ? { parent: a.parent, side: a.side } : {}) }
    : a.type === 'mark' ? { type: a.type, from: a.from, to: a.to, role: a.role } : a);
const back = (s, id, src) => s.judgeLine(one(src), { by: 'student' })?.act;

test('来回：树的动作写成一行再读回来，一样', async () => {
  const { treeRules, actSrc } = await import('../kit/src/stage/types/tree.rules.js');
  const s = run(new Scene(), 'tree t = 50 30 70 20 40 _ _ _ _ 35 tray="80 60"\nopen t rotate\nopen t place');
  const o = s.objects.get('t');
  const acts = [...treeRules.next(o, s).acts, { type: 'rotate', at: 1, dir: 'right' }, { type: 'rotate', at: 1, kind: 'LR' }, { type: 'rotate', at: 2, kind: 'RL' },
    { type: 'insert', value: '80' }, { type: 'insert', value: '60', parent: 3, side: 'left' }, { type: 'insert', value: '49′' }];
  for (const a of acts) assert.deepEqual(core(back(s, 't', actSrc(o, a))), core(a), actSrc(o, a));
});

test('来回：矩阵的行变换写成一行再读回来，一样（换行、倍乘、倍加、分数倍、两行都乘、几步）', async () => {
  const { matrixRules, actSrc } = await import('../kit/src/stage/types/matrix.rules.js');
  const s = run(new Scene(), 'matrix M = 2 4 1 / 3 5 2 / 1 1 7\nopen M rowop');
  const o = s.objects.get('M');
  const ops = (op) => ({ type: 'rowop', op });
  const acts = [...matrixRules.next(o, s).acts, ops('r1 <-> r3'), ops('-r2'), ops('r2 / 2'), ops('(-1/2)r2'), ops('r3 - 2r1'), ops('2r2 - 3r1'), ops('r2 + (3/2)r1'), ops('r2 - r1, r3 - r1')];
  for (const a of acts) {
    const src = actSrc(o, a);
    const b = back(s, 'M', src);
    assert.equal(actSrc(o, b), src, src);
    const [x, y] = [matrixRules.check(o, a), matrixRules.check(o, b)];
    assert.deepEqual([y.legal, y.right, y.misread], [x.legal, x.right, x.misread], src);
  }
});

test('来回：句子拉一段写成一行再读回来，一样（一个词、一段、带空格的成分名）', async () => {
  const { sentenceRules, actSrc } = await import('../kit/src/stage/types/sentence.rules.js');
  const s = run(new Scene(), 'sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] a doctor."\nopen s mark');
  const o = s.objects.get('s');
  const acts = [...sentenceRules.next(o, s).acts, { type: 'mark', from: 7, to: 7, role: 'V' }, { type: 'mark', from: 3, to: 6, role: '定语从句' }, { type: 'mark', from: 1, to: 2, role: 'to do' }, { type: 'mark', from: 8, to: 9, role: 'O' }];
  for (const a of acts) assert.deepEqual(core(back(s, 's', actSrc(o, a))), core(a), actSrc(o, a));
});

test('话里的量：{count(t)} 是页面数的；写下时查量名', () => {
  assert.ok(parseRich('结点 {count(t)}').some((p) => p.k === 'measure' && p.v === 'count(t)'));
  assert.ok(parseRich('{height( t.50 )}').some((p) => p.k === 'measure'));
  assert.deepEqual(parseRich('{d}').map((p) => p.k), ['var'], '拨的数照旧');
  assert.deepEqual(parseRich('{a.2}').map((p) => p.k), ['ref'], '部件照旧');
  const sc = run(new Scene(), 'tree t = 50 30 70');
  assert.equal(sc.check(parseScript('label n t "结点 {count(t)}"')[0]), null);
  assert.match(sc.check(parseScript('label n t "{size(t)}"')[0]) || '', /没有量「size」/);
  assert.match(sc.check(parseScript('say "一共 {size(t)} 个"')[0]) || '', /没有量「size」/);
  assert.match(sc.check(parseScript('goal g1 "长到 {size(t)} 层" when="t height=4"')[0]) || '', /没有量「size」/);
  assert.match(sc.check(parseScript('ask next "现在 {count(q)} 个"')[0]) || '', /舞台上没有「q」/);
  // 重放旧课不加新的检查
  assert.doesNotThrow(() => sc.apply({ ...parseScript('say "一共 {size(t)} 个"')[0], lenient: true }));
});

test('现状里页面算的：每样东西 describe 后面一行；数不了的写「页面数不了」', () => {
  const sc = run(new Scene(), 'tree t = 50 30 60 20 40 _ _ 10');
  assert.ok(sc.stateText().includes('页面算的：count(t) = 6，height(t) = 4，tray(t) = 0；avl 否（最小不平衡子树的根是 50，LL 型），bst 是'));
  const ok = run(new Scene(), 'tree t = 50 30 70');
  assert.ok(ok.stateText().includes('页面算的：count(t) = 3，height(t) = 2，tray(t) = 0；avl 是，bst 是'));
  const s = run(new Scene(), 'sentence s2 = "The man is a doctor."');
  assert.ok(s.stateText().includes('页面数不了：s2 没写 key'));
  // 没交量的东西没有这一行
  assert.doesNotMatch(run(new Scene(), 'array a = 3 1 2').stateText(), /页面算的|页面数不了/);
});

test('题卡里的量：和话里一样写下时查、画成现在的数', () => {
  const sc = run(new Scene(), 'tree t = 50 30 70');
  assert.equal(sc.check(parseScript('card q = "一共 {count(t)} 个结点"')[0]), null);
  assert.match(sc.check(parseScript('card q = "一共 {size(t)} 个结点"')[0]) || '', /没有量「size」/);
  run(sc, 'card q = "第一行"');
  assert.match(sc.check(parseScript('addline q "{size(t)}"')[0]) || '', /没有量「size」/);
});

test('改字也查量（retext、题卡的 rewrite）；以后也数不了的写下时报；旧课照收、{f(x)} 照原样写', async () => {
  const { measureShown } = await import('../kit/src/stage/rules.js');
  const sc = run(new Scene(), 'tree t = 50 30 70\nsentence s2 = "The man is a doctor."\nlabel n t "结点"\ncard q = "第一行"');
  const chk = (line) => sc.check(parseScript(line)[0]);
  assert.match(chk('retext n "{size(t)}"') || '', /没有量「size」/);
  assert.equal(chk('retext n "结点 {count(t)}"'), null);
  assert.match(chk('rewrite q.1 "{size(t)}"') || '', /没有量「size」/);
  assert.equal(chk('rewrite q.1 "一共 {count(t)} 个"'), null);
  // 没写 key：以后也数不了，贴的字、话、改字都当场报
  assert.match(chk('label m s2 "谓语 {verbs(s2)}"') || '', /以后也数不了：s2 没写 key/);
  assert.match(chk('say "谓语有 {verbs(s2)} 个"') || '', /以后也数不了/);
  assert.match(chk('retext n "{verbs(s2)}"') || '', /以后也数不了/);
  assert.match(chk('label m t "{tray(t.50)}"') || '', /以后也数不了：t\.50 没有 tray/);
  // 重放旧课：照收；旧课的 {f(x)}（x 不在舞台上）、{size(t)} 照原样写，和以前一样；数不了的画「?」
  const old = (line) => sc.apply({ ...parseScript(line)[0], lenient: true });
  assert.doesNotThrow(() => old('label a t "看 {f( x )} 和 {size(t)}"'));
  assert.doesNotThrow(() => old('retext n "{verbs(s2)}"'));
  assert.doesNotThrow(() => old('rewrite q.1 "{size(t)}"'));
  const shown = (text) => parseRich(text).map((p) => (p.k === 'measure' ? measureShown(sc, p.v) : p.k === 'var' ? String(sc.vars.get(p.v)?.v ?? p.v) : p.v)).join('');
  assert.equal(shown('看 {f( x )} 和 {size(t)}'), '看 f( x ) 和 size(t)', '和以前 {f(x)} 当成拨数写原样一样');
  assert.equal(shown('{verbs(s2)}'), '?');
  assert.equal(shown('{tray(t.50)}'), '?', '本来就没有');
  assert.equal(shown('{count(t)} 个'), '3 个');
  // 旧课以前也不查 retext 里的 {a.3}：重放时照旧不查；新写的查
  assert.doesNotThrow(() => old('retext n "{t.99}"'));
  assert.match(chk('retext n "{t.99}"') || '', /没有值是 99 的结点/);
});

test('同名重造留在原处：objects 的先后不变、位置不变，后面的东西照旧摆在它下面', () => {
  const s = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 0 1 / 1 0\nmatrix P = 1 0 / 0 1');
  const before = { ...s.objects.get('P').origin };
  run(s, 'matrix P = {B A}');
  assert.deepEqual([...s.objects.keys()], ['A', 'B', 'P']);
  assert.deepEqual(s.objects.get('P').origin, before);
  // 不在最后的那一样重造：照旧夹在中间（以前掉到最底下，reflow 照先后把它推到所有东西下面）
  const t = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix P = 1 0 / 0 1\nmatrix B = 0 1 / 1 0');
  const p0 = { ...t.objects.get('P').origin }, b0 = { ...t.objects.get('B').origin };
  run(t, 'matrix P = {A A}');
  assert.deepEqual([...t.objects.keys()], ['A', 'P', 'B']);
  assert.deepEqual(t.objects.get('P').origin, p0);
  assert.deepEqual(t.objects.get('B').origin, b0);
  // 重造得更大：摆在下面的往下让
  run(t, 'matrix P = 1 0 / 0 1 / 1 1');
  assert.deepEqual([...t.objects.keys()], ['A', 'P', 'B']);
  assert.ok(t.objects.get('B').origin.y > b0.y, '长高了一行，B 往下让');
  assert.match(t.stateText(), /矩阵 A[\s\S]*矩阵 P[\s\S]*矩阵 B/);
});

test('整张连线：两头是整样东西连一道弧；跟着算重新造以后还在；unlink X 收掉连着 X 和 X 里部件的线', () => {
  const s = run(new Scene(), 'matrix AB = 1 2 / 3 4\nmatrix BA = 5 6 / 7 8 beside=AB\nlink AB BA');
  assert.equal(s.links.size, 1);
  const [l] = s.links.values();
  assert.equal(l.whole, true);
  assert.deepEqual([l.a, l.b], [{ obj: 'AB', key: null }, { obj: 'BA', key: null }]);
  assert.match(s.stateText(), /连线：AB–BA 蓝/);
  // 副本照样带着
  assert.equal([...s.clone().links.values()][0].whole, true);
  run(s, 'unlink AB');
  assert.equal(s.links.size, 0);
  run(s, 'link AB.1,1 BA.2,2');
  assert.equal(s.links.size, 1);
  run(s, 'unlink AB');
  assert.equal(s.links.size, 0, '连着 AB 里一格的线也收掉');
  // 只写部件的 unlink 不收整张的
  run(s, 'link AB BA g2');
  run(s, 'unlink AB.1,1');
  assert.equal(s.links.size, 1);
  assert.match(dryRun(s, 'link AB AB')[0]?.error || '', /两头是同一样东西/);
  assert.deepEqual(dryRun(s, 'link AB AB.1,1'), [], '一格连到它自己那张：照连（见下面 link a.1 a 那一条）');
  // 一头是部件、一头是整张（缺口单里的方块图：link f.l1 AA f.r1）：连到整张上，不把 AA 连成一串格；unlink f 收得干净
  const m = run(new Scene(), 'tex f = "(\\hl{l1}{A}+\\hl{l2}{B})(\\hl{r1}{A}+\\hl{r2}{B})"\nmatrix AA = 1 2 / 3 4\nlink f.l1 AA f.r1 g1');
  assert.equal(m.links.size, 2);
  assert.ok([...m.links.values()].every((x) => x.whole && [x.a, x.b].some((e) => e.obj === 'AA' && e.key == null)));
  assert.match(m.stateText(), /连线：f\.l1–AA 蓝，AA–f\.r1 蓝|连线：AA–f\.l1 蓝，AA–f\.r1 蓝|连线：f\.l1–AA 蓝，f\.r1–AA 蓝|连线：AA–f\.l1 蓝，f\.r1–AA 蓝/);
  run(m, 'unlink f');
  assert.equal(m.links.size, 0);
  // 只写一样东西：照旧把它的部件依次连起来
  assert.equal(run(new Scene(), 'array a = 1 2 3\nlink a').links.size, 2);
  // 跟着拨数照新的数重新造（remake）：整样东西的线没有部件，不当成部件没了剪掉
  const t = run(new Scene(), 'dial d = 2 range=1..5\narray p = {d} 1\narray q = 3 4\nlink p q');
  assert.equal(t.links.size, 1);
  run(t, 'set d 3');
  assert.equal(t.objects.get('p').cells[0].value, '3');
  assert.equal(t.links.size, 1);
  // 分组只收这一排自己的线
  run(t, 'group p stride=1');
  assert.equal([...t.links.values()].filter((x) => x.whole).length, 1);
});

test('藏起来：hide=on 造的、hide 的东西照样算、现状照样写，画面上不摆；show 摆回来；哪种东西都能藏', () => {
  const s = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix R = 1 2 hide=on');
  assert.equal(s.objects.get('R').hidden, true);
  assert.deepEqual(s.shownIds(), ['A']);
  const st = s.stateText();
  assert.match(st, /（藏着，画面上不摆）矩阵 R（1×2）：\n  第 1 行：1  2/);
  run(s, 'show R');
  assert.deepEqual(s.shownIds(), ['A', 'R']);
  assert.doesNotMatch(s.stateText(), /藏着/);
  // 不是矩阵也认
  run(s, 'array k = 1 2 hide=on');
  assert.ok(!s.shownIds().includes('k'));
  run(s, 'array a = 5 6\nhide a');
  assert.ok(!s.shownIds().includes('a'));
  run(s, 'hide A R');
  assert.deepEqual(s.shownIds(), []);
  // 藏着的照样算：跟着它算的照样变
  run(s, 'matrix S = {A + A} hide=on\nwrite A.1,1 5');
  assert.equal(s.parts('S.1,1')[0].value, '10');
  // 摆东西、往下推不算藏着的：新造的摆在看得见的下面
  const t = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix H = 1 0 / 0 1 / 1 1 hide=on\nmatrix B = 0 1 / 1 0');
  const hb = t.objectBox('H'), bb = t.objectBox('B'), ab = t.objectBox('A');
  assert.ok(bb.y < ab.y + ab.h + 100, 'B 紧挨着 A，没给藏着的 H 留地方');
  // show：原来的地方压着看得见的东西，照摆新东西的规矩摆到下面、排到最后；没压着就留在原处
  run(t, 'show H');
  assert.deepEqual([...t.objects.keys()], ['A', 'B', 'H']);
  assert.ok(t.objectBox('H').y > bb.y + bb.h, `H 摆到 B 下面（原来在 ${hb.y}）`);
  // 摆过又藏起来的：不占地方（下面的往上收），show 照摆新东西的规矩摆回来（原来的地方被占了：摆到下面、排到最后）
  const a1 = { ...t.objects.get('A').origin };
  run(t, 'hide A');
  assert.equal(t.objectBox('B').y, ab.y, 'A 藏起来：B 收到 A 原来的地方');
  run(t, 'show A');
  assert.ok(t.objectBox('A').y > t.objectBox('H').y, `A 摆到最下面（原来在 ${a1.y}）`);
  assert.deepEqual([...t.objects.keys()], ['B', 'H', 'A']);
  // 同名重造照旧藏着（留在原处）；hide=off 摆出来
  run(t, 'matrix R = 1 2 hide=on\nmatrix R = 3 4');
  assert.ok(t.objects.get('R').hidden);
  run(t, 'matrix R = 3 4 hide=off');
  assert.ok(!t.objects.get('R').hidden);
  // 写错了说清楚
  assert.match(dryRun(t, 'hide Z')[0]?.error || '', /舞台上没有「Z」/);
  assert.match(dryRun(t, 'hide A.1,1')[0]?.error || '', /整样东西/);
  assert.match(dryRun(t, 'matrix Q = 1 hide=yes')[0]?.error || '', /hide= 只能写 on/);
  assert.match(dryRun(t, 'hide')[0]?.error || '', /hide 后面写/);
});

test('藏起来的东西不占地方：它那一行没别的了，这一列下面的整体往上收；那一行还有别的（beside）不收；show 照摆新东西的规矩摆回来', () => {
  const box = (s, id) => s.objectBox(id);
  // 一列往下摆的三张：藏中间那张，下面的收上来，和它不在时一样
  const s = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1 / 1 1\nmatrix C = 5 6 / 7 8\nmatrix D = 1 1 / 2 2');
  const want = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix C = 5 6 / 7 8\nmatrix D = 1 1 / 2 2');
  const [b0, c0] = [box(s, 'B'), box(s, 'C')];
  run(s, 'hide B');
  assert.equal(box(s, 'C').y, b0.y, 'C 收到 B 原来的上沿');
  assert.equal(box(s, 'C').y, box(want, 'C').y, '和 B 不在时摆的一样');
  assert.equal(box(s, 'D').y - box(s, 'C').y, box(want, 'D').y - box(want, 'C').y, '下面的整体一起收、间距不变');
  assert.ok(box(s, 'C').y < c0.y);
  // show：原来的地方被占了，摆到最下面、排到最后
  run(s, 'show B');
  assert.ok(box(s, 'B').y > box(s, 'D').y + box(s, 'D').h - 1, 'B 摆回最下面');
  assert.deepEqual([...s.objects.keys()], ['A', 'C', 'D', 'B']);
  // 藏的是最下面那张：没有要收的，show 回来留在原处
  const t = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1');
  const tb = { ...t.objects.get('B').origin };
  run(t, 'hide B\nshow B');
  assert.deepEqual(t.objects.get('B').origin, tb);
  // 那一行还有别的（Q 摆在 P 旁边）：藏 Q 不收，下面的 R 不动
  const u = run(new Scene(), 'matrix P = 1 2 / 3 4\nmatrix Q = 1 0 / 0 1 beside=P\nmatrix R = 5 6 / 7 8');
  const r0 = box(u, 'R').y;
  run(u, 'hide Q');
  assert.equal(box(u, 'R').y, r0, 'P 还在那一行：R 不动');
  // 那一行两张都藏了：R 收上去
  run(u, 'hide P');
  assert.equal(box(u, 'R').y, box(run(new Scene(), 'matrix P = 1 2 / 3 4'), 'P').y, 'P、Q 都藏了：R 收到那一行的上沿');
  // 照 log 重放一样（撤一步、刷新）：同样几行，同样的位置
  const again = run(new Scene(), 'matrix P = 1 2 / 3 4\nmatrix Q = 1 0 / 0 1 beside=P\nmatrix R = 5 6 / 7 8\nhide Q\nhide P');
  assert.deepEqual(again.objects.get('R').origin, u.objects.get('R').origin);
});

test('clone 带着这一轮的新状态（检查、试演、抢跑都在副本上跑）', () => {
  const s = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix X = 1 0 / 0 1\narray a = 1 2 3\nlink A X');
  s.view = { w: 1180, h: 820 };
  s.clipped = ['X'];
  const c = s.clone();
  assert.equal(c.stateText(), s.stateText());
  assert.deepEqual(c.view, s.view);
  assert.deepEqual(c.clipped, s.clipped);
  c.clipped.push('a');
  c.view.w = 1;
  assert.deepEqual(s.clipped, ['X']);
  assert.equal(s.view.w, 1180);
  assert.deepEqual(new Scene().clone().clipped, []);
  assert.equal(new Scene().clone().view, null);
  // Task 6：学生一次点的几样（picked）、ask pick 等着的（refs、expect 是数组：各拷一份，改克隆的不动原来的）
  const p = run(new Scene(), 'tree t = 30 20 40 10 25 _ 45\npick t.45 t.40 t.20 reveal=on\nask pick t "哪几个会变？" expect="t.45 t.40"');
  const pc = p.clone();
  assert.deepEqual(pc.picked, p.picked);
  assert.equal(pc.stateText(), p.stateText());
  assert.match(p.stateText(), /圈着学生点的：t\.45、t\.40、t\.20/);
  pc.picked.keys.push(99);
  pc.waiting.refs.push('t.10');
  pc.waiting.expect.push('t.10');
  assert.equal(p.picked.keys.length, 3);
  assert.deepEqual(p.waiting.refs, ['t']);
  assert.deepEqual(p.waiting.expect, ['t.45', 't.40']);
  assert.equal(new Scene().clone().picked, null);
  // Task 7：存档（keeps）、页面替老师存的（autoKeep）、学生每一下之前的样子（lastBefore）。学生按的 back 先过 check（在克隆上试）：
  // 克隆上没有存档就报「没存过」
  const k = run(new Scene(), 'tree t = 30 20 40 10 25 _ 45 tray="47"\nopen t insert\nkeep t "开始"\nkeep t "插入后" after=insert');
  stu(k, 'insert t 47', 'insert');
  const kc = k.clone();
  assert.deepEqual(kc.keeps, k.keeps);
  assert.deepEqual(kc.autoKeep, k.autoKeep);
  assert.deepEqual(kc.lastBefore, k.lastBefore);
  assert.equal(kc.stateText(), k.stateText());
  assert.equal(kc.check(one('back t "插入后"')), null);
  assert.equal(k.check(one('back t "开始"')), null);
  assert.equal(k.check(one('back t')), null);
  // 深拷：改克隆的不动原来的
  kc.keeps.get('t').delete('开始');
  kc.autoKeep.get('t').set('别的', 'rotate');
  kc.lastBefore.get('t').root = 99;
  assert.ok(k.keeps.get('t').has('开始'));
  assert.equal(k.autoKeep.get('t').has('别的'), false);
  assert.equal(k.lastBefore.get('t').root, 1);
  assert.equal(new Scene().clone().keeps.size, 0);
  // Task 8：套着的预写（ahead：g2 还没有）、还没被 ask 拿走的 @ask.right。@g2 先过 check、预写试演都在克隆上跑
  const a = run(new Scene(), 'array k = 3 1 2\nopen k\ngoal g1 "排好" when="k sorted"\n@g1 goal g2 "倒过来" when="k sorted desc"\n@g2 say "倒好了"\n@ask.right say "对"');
  const ac = a.clone();
  assert.deepEqual(ac.ahead, a.ahead);
  assert.deepEqual(ac.askRight, a.askRight);
  assert.equal(ac.stateText(), a.stateText());
  assert.equal(ac.check(one('@g2 say "再来"')), null, '克隆上也认得 g2 是套着的预写');
  ac.ahead.get('g2').lines.push('say "x"');
  ac.askRight.push('say "y"');
  assert.deepEqual(a.ahead.get('g2').lines, ['say "倒好了"']);
  assert.deepEqual(a.askRight, ['say "对"']);
  assert.equal(new Scene().clone().askRight, null);
  assert.equal(new Scene().clone().ahead.size, 0);
  // Task 14：拨数要挂在还没造的东西上（dialAt：先记着，造出来再挂）。克隆上造 M 也挂得上，改克隆的不动原来的
  const d = run(new Scene(), 'dial k = 1 range=0..3 at=M');
  const dc = d.clone();
  assert.deepEqual(dc.dialAt, d.dialAt);
  assert.equal(dc.stateText(), d.stateText());
  run(dc, 'matrix M = 1 {k}');
  assert.deepEqual(dc.labels.get('dial:k').refs, ['M']);
  assert.equal(d.dialAt.get('k'), 'M');
  assert.equal(new Scene().clone().dialAt.size, 0);
  // Task 15 复核：这一轮话里还没着落的名字（loose：一轮演完再看）。改克隆的不动原来的
  const l = run(new Scene(), 'say "看 {Xi}"');
  const lc = l.clone();
  assert.deepEqual(lc.loose, l.loose);
  assert.equal(l.loose.length, 1);
  lc.loose.push({ name: 'x', line: 0, src: '' });
  lc.loose[0].name = 'y';
  assert.deepEqual(l.loose.map((x) => x.name), ['Xi']);
  assert.deepEqual(new Scene().clone().loose, []);
});

test('看不全：画面写回的 clipped 写进现状（藏着的、已经拿下舞台的不写）', () => {
  const s = run(new Scene(), 'matrix X = 1 2 / 3 4\nmatrix Rk = 1 0 / 0 1\nmatrix H = 1 hide=on');
  assert.doesNotMatch(s.stateText(), /看不全/);
  s.clipped = ['X', 'Rk'];
  assert.match(s.stateText(), /画面上看不全：X、Rk/);
  s.clipped = ['X', 'H', 'Gone'];
  assert.match(s.stateText(), /画面上看不全：X$/m);
});

test('横屏另起一列：往下摆会缩得太小、右边有地方就摆右边，和最上面那样东西顶齐；竖屏照旧往下', () => {
  // 四行的矩阵 220 高：横屏镜头能用的那块（去掉话、底下一条、留白）摆三张就满了
  const src = 'matrix A = 1 2 / 3 4 / 5 6 / 7 8\nmatrix B = 1 2 / 3 4 / 5 6 / 7 8\nmatrix C = 1 2 / 3 4 / 5 6 / 7 8\nmatrix D = 1 2 / 3 4 / 5 6 / 7 8\nmatrix E = 1 2 / 3 4 / 5 6 / 7 8\nmatrix F = 1 2 / 3 4\nmatrix G = 1 2 / 3 4 / 5 6 / 7 8';
  const wide = new Scene();
  wide.view = { w: 1180, h: 820 };
  run(wide, src);
  const box = (id) => wide.objectBox(id);
  assert.ok(box('B').y > box('A').y && box('C').y > box('B').y && box('B').x === box('A').x, '前三张照旧往下摆');
  assert.equal(box('D').y, box('A').y, '第四张另起一列，和最上面那张顶齐');
  assert.ok(box('D').x >= box('A').x + box('A').w, '摆在右边');
  assert.ok(wide.objects.get('D').colStart);
  assert.ok(box('E').y > box('D').y && box('E').x === box('D').x, '再下一张接着摆在这一列下面');
  assert.ok(box('F').y > box('E').y && box('F').x === box('D').x);
  assert.equal(box('G').y, box('A').y, '这一列也满了：再另起一列');
  // 左边那一列长高了：往下让的只有左边那一列
  const d0 = box('D').y, b0 = box('B').y;
  run(wide, 'matrix A = 1 2 / 3 4 / 5 6 / 7 8 / 9 10');
  assert.ok(box('B').y > b0);
  assert.equal(box('D').y, d0);
  // 照 log 放回（同一个屏幕）一模一样
  const again = new Scene();
  again.view = { w: 1180, h: 820 };
  run(again, `${src}\nmatrix A = 1 2 / 3 4 / 5 6 / 7 8 / 9 10`);
  for (const id of wide.objects.keys()) assert.deepEqual(again.objectBox(id), wide.objectBox(id), id);
  const tall = new Scene();
  tall.view = { w: 820, h: 1180 };
  run(tall, src);
  assert.ok(tall.objectBox('E').y > tall.objectBox('D').y && tall.objectBox('E').x === tall.objectBox('D').x, '竖屏照旧往下摆');
  // 不知道屏幕多大（测试、旧课的纯场景）：照旧往下摆
  const none = run(new Scene(), src);
  assert.ok(none.objectBox('G').y > none.objectBox('F').y);
  assert.ok(![...none.objects.values()].some((o) => o.colStart));
});

test('藏着的东西学生看不见：open、ask 点它、要学生动它的挑战写下就报；后来才藏的，现状里补一句学生点不到；旧课照收', () => {
  const s = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix R = 1 2 / 2 4 hide=on\nmatrix S = {A + A} hide=on');
  const chk = (line) => s.check(parseScript(line)[0]);
  for (const line of ['open R edit', 'open R.1,1 edit', 'ask tap R.1,1 "点一格"', 'ask drag R "拖"', 'ask tap A "点" expect=R.1,1', 'goal g1 "化成阶梯形" when="R stairs"', 'goal g1 "x" when="rank(R) = 1"']) {
    assert.match(chk(line) || '', /R 藏着，学生看不见：先 show R/, line);
  }
  // 藏着的是参照（答案）、跟着看得见的东西算的：学生动的是看得见的那样，照收
  assert.equal(chk('goal g1 "化成和 R 一样" when="A same R"'), null);
  assert.equal(chk('goal g1 "让 S 全是 0" when="S = O"'), null);
  assert.equal(chk('ask tap A "点"'), null);
  // 预写里先 show 再 open 照收；只 open 报
  run(s, 'goal g0 "改 A" when="A.1,1 = 9"');
  assert.match(chk('@g0 open R edit') || '', /R 藏着/);
  assert.equal(dryRun(s, '@g0 show R\n@g0 open R edit').length, 0);
  // 旧课照 log 放回：照收
  assert.doesNotThrow(() => s.apply({ ...parseScript('open R edit')[0], lenient: true }));
  // show 以后照常
  const t = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix R = 1 2 / 3 4 hide=on\nshow R\nopen R edit\ngoal g1 "化成阶梯形" when="R stairs"\nask tap R.1,1 "点一格"');
  assert.doesNotMatch(t.stateText(), /学生点不到/);
  // 开着、问着、挑战要动的时候藏起来：照写，补一句
  run(t, 'hide R');
  const st = t.stateText();
  assert.match(st, /在等学生：点 R\.1,1（R 藏着，学生点不到）/);
  assert.match(st, /学生能直接动的：R edit（[^\n]*）（R 藏着，学生点不到）/);
  assert.match(st, /挑战 g1「化成阶梯形」[^\n]*（R 藏着，学生点不到）/);
  run(t, 'show R');
  assert.doesNotMatch(t.stateText(), /学生点不到/);
});

test('link 一格和它自己那样东西（link a.1 a）：照连一道弧，不报错（旧课照样演）；两头是同一整样东西：新写的报，旧课跳过', () => {
  const s = run(new Scene(), 'array a = 1 2 3\nlink a.1 a');
  assert.equal(s.links.size, 1);
  const [l] = s.links.values();
  assert.ok(l.whole);
  assert.deepEqual([l.a, l.b].map((e) => e.key), [1, null]);
  assert.match(s.stateText(), /连线：a#1–a 蓝/);
  assert.equal(run(new Scene(), 'array a = 1 2 3\nlink a a.2').links.size, 1);
  assert.match(dryRun(s, 'link a a')[0]?.error || '', /两头是同一样东西 a/);
  const old = new Scene();
  run(old, 'array a = 1 2 3\narray b = 4 5');
  assert.doesNotThrow(() => old.apply({ ...parseScript('link a a b')[0], lenient: true }));
  assert.equal(old.links.size, 1, '跳过 a–a 那一对，a–b 照连');
});

// —— 扫一遍拨数（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 3.3）——

test('扫一遍拨数：跟着拨数算的矩阵，每个能拨到的值算一遍解的样子写进现状；真的舞台不动', () => {
  const s = run(new Scene(), 'dial l = 0 range=-3..3\nmatrix M = 1 {l} | 1 / {l} 1 | 1');
  const before = JSON.stringify(s.objects.get('M').cells);
  const st = s.stateText();
  assert.ok(st.includes('拨 l（−3～3）时 M：l = −1 无解（r(A) = 1，r(A | b) = 2）；l = 1 无穷多解（1 个自由变量）；别的唯一解'), st);
  // 写在能拨的数那一行后面
  const lines = st.split('\n');
  assert.equal(lines.findIndex((x) => x.startsWith('拨 l')), lines.findIndex((x) => x.startsWith('能拨的数')) + 1);
  assert.equal(s.vars.get('l').v, 0);
  assert.equal(JSON.stringify(s.objects.get('M').cells), before, 'M 的格一个没变');
  // sweep 交每个值的要点；只取跟着它算的、交了 brief 的
  run(s, 'matrix A = 1 2 / 3 4\narray a = 1 {l} 3');
  const sw = s.sweep('l');
  assert.deepEqual(sw.map((x) => x.id), ['M']);
  assert.deepEqual(sw[0].list.map((x) => x.v), [-3, -2, -1, 0, 1, 2, 3]);
  assert.equal(sw[0].list[2].brief, '无解（r(A) = 1，r(A | b) = 2）');
  // 间接跟着算：S 跟着 l，T 跟着 S
  const t = run(new Scene(), 'dial k = 1 range=0..2\nmatrix A = 1 2 / 2 4\nmatrix S = {k A}\nmatrix T = {S + A}');
  assert.deepEqual(t.sweep('k').map((x) => x.id), ['S', 'T']);
  assert.ok(t.stateText().includes('拨 k（0～2）时 S：k = 0 r = 0；别的 r = 1'), t.stateText());
  assert.ok(t.stateText().includes('拨 k（0～2）时 T 都是 r = 1'), t.stateText());
});

test('扫一遍拨数：能拨的值太多不扫；只有一种时写「都是」；算不出来的值照说', () => {
  const s = run(new Scene(), 'dial l = 0 range=-20..20\nmatrix M = 1 {l} | 1 / {l} 1 | 1');
  assert.ok(s.stateText().includes('l 能拨的值太多，页面没扫'));
  assert.equal(SWEEP_MAX, 25);
  assert.equal(sweepLine('l', { lo: -3, hi: 3 }, 'M', [-3, -2, -1].map((v) => ({ v, brief: '唯一解' }))), '拨 l（−3～3）时 M 都是唯一解');
  assert.equal(sweepLine('l', { lo: -20, hi: 20 }, 'M', null), 'l 能拨的值太多，页面没扫');
  assert.equal(sweepLine('l', { lo: 0, hi: 4 }, 'M', [0, 1, 2, 3, 4].map((v) => ({ v, brief: v >= 2 && v <= 3 ? '无解' : '唯一解' }))), '拨 l（0～4）时 M：l = 2～3 无解；别的唯一解');
  // 求逆在 k = 0 时算不出来：那个值不能拿上一次的数顶上
  const inv = run(new Scene(), 'dial k = 1 range=0..2\nmatrix A = {k} 0 / 0 1\nmatrix B = {A^-1}');
  const b = inv.sweep('k').find((x) => x.id === 'B');
  assert.equal(b.list[0].brief, null, 'k = 0 时 A 不可逆，B 算不出来');
  assert.ok(inv.stateText().includes('拨 k（0～2）时 B：k = 0 算不出来；别的 r = 2'), inv.stateText());
  // 没有跟着拨数算的东西：不写
  assert.doesNotMatch(run(new Scene(), 'dial d = 1 range=1..3\narray a = 1 2 3').stateText(), /^拨 d/m);
});

test('clauseMarks 照给的挑战判：做到了也照判（✓）；判不了是 null；没有的挑战不写', () => {
  const s = run(new Scene(), 'dial t = 1 range=-2..2\ngoal g1 "拨到 −1" when="t = -1"');
  assert.deepEqual(s.clauseMarks(['g1']), [{ goal: 'g1', clause: 't = -1', ok: false }]);
  s.apply(parseScript('set t 0')[0], { by: 'student' });
  s.apply(parseScript('set t -1')[0], { by: 'student' });
  assert.equal(s.goals.get('g1').met, true);
  assert.deepEqual(s.clauseMarks(['g1']), [{ goal: 'g1', clause: 't = -1', ok: true }], '做到了也照判');
  // 量数不了（s2 没写 key，重放旧课收下的）：null，不是 false
  run(s, 'sentence s2 = "The man is a doctor."');
  s.apply({ ...parseScript('goal g2 "找出谓语" when="verbs(s2) = 1"')[0], lenient: true });
  assert.deepEqual(s.clauseMarks(['g2']).map((x) => [x.clause, x.ok]), [['verbs(s2) = 1', null]]);
  assert.deepEqual(s.clauseMarks(['nope']), []);
  // 几句条件各一条
  const m = run(new Scene(), 'matrix A = 1 0 / 0 1\ndial k = 1 range=0..3\ngoal g3 "…" when="k > 1, A = I"');
  assert.deepEqual(m.clauseMarks(['g3']).map((x) => [x.goal, x.clause, x.ok]), [['g3', 'k > 1', false], ['g3', 'A = I', true]]);
});

// —— 一次点几样（ask pick）；expect 写整样东西或一段（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 2.5、第 9 节）——
const AVL = 'tree t = 30 20 40 10 25 _ 45';
const pickOf = (s, v) => s.objects.get('t').nodes.find((n) => n.value === String(v)).pick;

test('ask pick 的写法：只写东西名哪个都能点、写部件只能点这几个；expect 写好几个，不在能点的里面当场报', () => {
  const s = run(new Scene(), `${AVL}\nask pick t "插进 47 以后，哪几个结点的平衡因子会变？都点出来" button="猜好了" expect="t.45 t.40 t.30"`);
  assert.equal(s.waiting.kind, 'pick');
  assert.deepEqual(s.waiting.refs, ['t']);
  assert.equal(s.waiting.button, '猜好了');
  assert.deepEqual(s.waiting.expect, ['t.45', 't.40', 't.30']);
  assert.equal(s.waiting.reveal, false);
  assert.match(s.stateText(), /在等学生：点几样 t/);
  assert.equal(run(new Scene(), `${AVL}\nask pick t "…" reveal=on`).waiting.reveal, true);
  assert.equal(run(new Scene(), `${AVL}\nask pick t "…"`).waiting.expect, null);
  const base = run(new Scene(), AVL);
  assert.match(dryRun(base, 'ask pick t "…" expect="t.45 t.99"')[0].error, /不在能点的里面|没有/);
  const only = run(new Scene(), `${AVL}\nask pick t#1 t#3 "…"`);
  assert.deepEqual(only.waiting.refs, ['t#1', 't#3']);
  assert.match(dryRun(base, 'ask pick t#1 t#3 "…" expect="t.20"')[0].error, /expect 里的 t\.20 不在能点的里面/);
  assert.equal(dryRun(base, 'ask pick t#1 t#3 "…" expect="t.30 t.40"').length, 0);
  assert.match(dryRun(base, 'ask pick t "…" reveal=yes')[0].error, /reveal= 只能写 on/);
  assert.match(dryRun(base, 'ask pick "…"')[0].error, /ask pick 后面写/);
  // 一次只点一样东西里的（交的那一行、圈都是按一样东西记的）
  assert.match(dryRun(run(new Scene(), `${AVL}\narray a = 1 2 3`), 'ask pick t a "…"')[0].error, /一样东西/);
});

test('交了和预期比：一样；多点了、漏了；没写 expect 只说点了哪几个；预期的不在了说比不了', () => {
  const s = run(new Scene(), `${AVL}\nask pick t "…" expect="t.45 t.40 t.30"`);
  const ok = pickAnswer(s, ['t.45', 't.40', 't.30'], s.waiting.expect);
  assert.deepEqual({ ...ok }, { type: 'pick', refs: ['t.45', 't.40', 't.30'], expected: 't.45 t.40 t.30', same: true, extra: [], missing: [] });
  assert.match(pickText(ok), /：一样$/);
  const off = pickAnswer(s, ['t.45', 't.40', 't.20'], s.waiting.expect);
  assert.equal(off.same, false);
  assert.equal(pickText(off), '学生点了 3 个：t.45、t.40、t.20——你预期的是 t.45 t.40 t.30：多点了 t.20，漏了 t.30');
  // 点的先后照学生点的，预期照老师写的
  assert.match(pickText(pickAnswer(s, ['t.30', 't.45', 't.40'], s.waiting.expect)), /^学生点了 3 个：t\.30、t\.45、t\.40——你预期的是 t\.45 t\.40 t\.30：一样$/);
  assert.equal(pickText(pickAnswer(s, ['t.45'], null)), '学生点了 1 个：t.45');
  // 预期写一段、写整样东西也认（点到里面的每一个才算一样）
  const a = run(new Scene(), 'array a = 5 6 7 8');
  assert.match(pickText(pickAnswer(a, ['a#1', 'a#2'], ['a.1-2'])), /：一样$/);
  assert.match(pickText(pickAnswer(a, ['a#1'], ['a.1-2'])), /：漏了 a\.2$/);
  // 交的那一刻预期的部件已经不在（学生动过）：说比不了，不说错
  const gone = pickAnswer(s, ['t.45'], ['t.99']);
  assert.equal(gone.same, null);
  assert.match(pickText(gone), /页面比不了/);
});

test('之后那一下和真变了的比：只在点了以后第一次变时说一次；学生的、老师的都算', () => {
  const s = run(new Scene(), AVL);
  const fx0 = s.apply(parseScript('pick t.45 t.40 t.20')[0], { by: 'student' });
  assert.equal(fx0.pickDiff, undefined);
  assert.deepEqual(s.picked, { obj: 't', keys: [6, 3, 2], refs: ['t.45', 't.40', 't.20'], reveal: false, diffDone: false });
  // 只是点亮、染色：东西没变，不算
  assert.equal(s.apply(parseScript('paint t.45 g2')[0]).pickDiff, undefined);
  const fx = s.apply(parseScript('insert t 47')[0], { by: 'student' });
  assert.equal(fx.pickDiff, '学生先点的 3 个里，这一下以后变了的：t.45、t.40；没变的：t.20；变了却没点的：t.30');
  assert.equal(s.picked.diffDone, true);
  assert.equal(s.apply(parseScript('insert t 50')[0]).pickDiff, undefined);
  // 空的写「没有」；点过的那个这一下没了，算变了
  const t = run(new Scene(), 'tree t = 30 20 40\npick t.20');
  assert.equal(t.apply(parseScript('insert t 50')[0]).pickDiff, '学生先点的 1 个里，这一下以后变了的：没有；没变的：t.20；变了却没点的：t.30、t.40');
  assert.equal(pickDiffText(t, { obj: 't', keys: [2], refs: ['t.20'] }, [2]), '学生先点的 1 个里，这一下以后变了的：t.20；没变的：没有；变了却没点的：没有');
});

test('reveal=on 才画虚实：变了的 changed、没变的 same；不写 reveal 一直是 on；unpick 收掉', () => {
  const s = run(new Scene(), `${AVL}\npick t.45 t.40 t.20 reveal=on`);
  assert.equal(pickOf(s, 45), 'on');
  assert.equal(pickOf(s, 30), undefined);
  run(s, 'insert t 47');
  assert.deepEqual([45, 40, 20, 30].map((v) => pickOf(s, v)), ['changed', 'changed', 'same', undefined]);
  assert.match(s.stateText(), /reveal=on：变了的实线 t\.45、t\.40，没变的虚线 t\.20/);
  const n = run(new Scene(), `${AVL}\npick t.45 t.40 t.20\ninsert t 47`);
  assert.deepEqual([45, 40, 20].map((v) => pickOf(n, v)), ['on', 'on', 'on']);
  run(n, 'unpick');
  assert.equal(n.picked, null);
  assert.ok(n.objects.get('t').nodes.every((x) => x.pick === undefined));
  assert.doesNotMatch(n.stateText(), /圈着/);
  // unpick 写了东西名：只收那一样的；那一样上没有点着的当场报；什么都没点着的 unpick 不报（页面自动写的那一行）
  assert.match(dryRun(run(new Scene(), `${AVL}\narray a = 1 2\npick t.45`), 'unpick a')[0].error, /a 上没有学生点着的/);
  assert.equal(dryRun(run(new Scene(), AVL), 'unpick').length, 0);
  // 新点的一次换掉上一次的
  const again = run(new Scene(), `${AVL}\npick t.45 t.40\npick t.20`);
  assert.deepEqual([45, 40, 20].map((v) => pickOf(again, v)), [undefined, undefined, 'on']);
  // pick 写部件、写一样东西里的、写得出来的
  assert.match(dryRun(run(new Scene(), AVL), 'pick t')[0].error, /不写整样东西/);
  assert.match(dryRun(run(new Scene(), AVL), 'pick')[0].error, /pick 后面写/);
});

test('句子上点几样：挪了的词才算变了（给它让位的不算）；reveal=on 只有挪了的画实线；名字后面带上那个词（挪过以后位置变了）', () => {
  const s = run(new Scene(), 'sentence s = "one two three four five six"\nask pick s "把 three 挪到 five 后面，哪几个词挪了？" reveal=on');
  assert.equal(pickText(pickAnswer(s, ['s#3', 's#4'], null)), '学生点了 2 个：s.3、s.4');
  run(s, 'pick s#3 s#4 reveal=on');
  const fx = s.apply(parseScript('move s.3 after s.5')[0], { by: 'student' });
  // three 挪到第 5 个、four 让到第 3 个：写现在的位置，带上词，不会把「没变的 s.3」读成学生点的那个 three
  assert.equal(fx.pickDiff, '学生先点的 2 个里，这一下以后变了的：s.5（three）；没变的：s.3（four）；变了却没点的：没有');
  const pickOfWord = (v) => s.objects.get('s').words.find((w) => w.value === v).pick;
  assert.deepEqual(['three', 'four', 'five'].map(pickOfWord), ['changed', 'same', undefined]);
  assert.match(s.stateText(), /reveal=on：变了的实线 s\.5（three），没变的虚线 s\.3（four）/);
  // 只点了 four：它只是让位，算没变；挪了的 three 是「变了却没点的」
  const t = run(new Scene(), 'sentence s = "one two three four five six"\npick s#4 reveal=on');
  assert.equal(t.apply(parseScript('move s.3 after s.5')[0]).pickDiff, '学生先点的 1 个里，这一下以后变了的：没有；没变的：s.3（four）；变了却没点的：s.5（three）');
  assert.equal(t.objects.get('s').words.find((w) => w.value === 'four').pick, 'same');
});

test('刷新照放：ask 不重放、行带 lenient，pick 那一行自己带着 reveal，虚实和当场演的一样', () => {
  const log = [
    { src: AVL, by: 'teacher' },
    { src: 'ask pick t "插进 47 以后，哪几个结点的平衡因子会变？" button="猜好了" expect="t.45 t.40 t.30" reveal=on', by: 'teacher' },
    { src: 'pick t.45 t.40 t.20 reveal=on', by: 'student' },
    { src: 'insert t 47', by: 'student' },
  ];
  const live = new Scene();
  for (const r of log) live.apply(parseScript(r.src)[0], r.by === 'student' ? { by: 'student' } : {});
  const back = new Scene();
  for (const r of log) {
    const c = parseScript(r.src)[0];
    if (c.cmd === 'ask') continue; // stage.js 的 replay：ask 不重放
    back.apply({ ...c, lenient: true }, r.by === 'student' ? { by: 'student' } : {});
  }
  assert.equal(back.waiting, null);
  assert.deepEqual(back.picked.keys, live.picked.keys);
  assert.equal(back.picked.reveal, true);
  assert.deepEqual([45, 40, 20].map((v) => pickOf(back, v)), ['changed', 'changed', 'same']);
  assert.deepEqual([45, 40, 20].map((v) => pickOf(back, v)), [45, 40, 20].map((v) => pickOf(live, v)));
  run(back, 'unpick');
  assert.equal(back.picked, null);
  // 拿下舞台、同名重造：点着的不算了
  const gone = run(new Scene(), `${AVL}\npick t.45`);
  run(gone, 'tree t = 1 2 3');
  assert.equal(gone.picked, null);
});

test('expect 写整样东西或一段：点到里面哪一个都算；哪种东西都一样；比不了是 null', () => {
  const s = run(new Scene(), 'matrix AB = 1 2 / 3 4\narray a = 1 2 3 4 5');
  assert.equal(expectHit(s, 'AB', s.parts('AB.2,1')[0]), true);
  assert.equal(expectHit(s, 'AB.1,1', s.parts('AB.2,1')[0]), false);
  assert.equal(expectHit(s, 'a.1-3', s.parts('a.2')[0]), true);
  assert.equal(expectHit(s, 'a.1-3', s.parts('a.4')[0]), false);
  assert.equal(expectHit(s, 'a', s.parts('a.5')[0]), true);
  assert.equal(expectHit(s, 'a.1-3', s.parts('AB.1,1')[0]), false);
  assert.equal(expectHit(s, 'q.3', s.parts('a.3')[0]), null);
  // ask tap 的 expect 写一段、整样东西照收
  assert.equal(dryRun(s, 'ask tap a "…" expect=a.1-3').length, 0);
  assert.equal(dryRun(s, 'ask tap AB "…" expect=AB').length, 0);
});

// —— 存档点 keep / back（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 7 节）——
const T47 = 'tree t = 30 20 40 10 25 _ 45 tray="47"';
const ser = (s, id = 't') => serialize(s.objects.get(id));

test('存了再回去：只换这样东西的数据；位置、open、贴的字不动；avl、做完照回去以后的样子重判', () => {
  const s = run(new Scene(), `${T47}\nopen t insert\nopen t rotate\n@t.done say "平了。"\nlabel n t.30 "根"\narray a = 3 1 2`);
  stu(s, 'insert t 47', 'insert');
  run(s, 'keep t "插入后"');
  const kept = ser(s);
  assert.match(s.stateText(), /avl 否/);
  assert.deepEqual(stu(s, 'rotate t.40 left', 'rotate').done, ['t']);
  assert.notEqual(ser(s), kept);
  run(s, 'swap a.1 a.2');
  const t0 = s.objects.get('t');
  const origin = { ...t0.origin };
  const opens = JSON.stringify([...s.opens]);
  const labels = JSON.stringify([...s.labels]);
  const a = JSON.stringify(s.objects.get('a'));
  run(s, 'back t "插入后"');
  assert.equal(ser(s), kept);
  assert.equal(s.objects.get('t'), t0, '还是同一样东西（画面照 id 找它）');
  assert.deepEqual(s.objects.get('t').origin, origin);
  assert.equal(JSON.stringify([...s.opens]), opens);
  assert.equal(JSON.stringify([...s.labels]), labels);
  assert.equal(JSON.stringify(s.objects.get('a')), a, '别的东西不动');
  assert.deepEqual(s.objects.get('t').tray, [], '托盘也是数据：插入后托盘是空的');
  // 照回去以后的样子重判：又失衡了；学生再转平，规则从那里接着算（又算一次做完了）
  assert.match(s.stateText(), /avl 否（最小不平衡子树的根是 40，RR 型）/);
  assert.deepEqual(stu(s, 'rotate t.40 left', 'rotate').done, ['t']);
});

test('回到学生最后那一下之前：隔着老师的一轮也行；老师自己动的不算学生动过', () => {
  const s = run(new Scene(), `${T47}\nopen t insert\nopen t rotate`);
  stu(s, 'insert t 47', 'insert');
  const before = ser(s);
  stu(s, 'rotate t.40 left', 'rotate');
  run(s, 'say "你转了 40，再看看。"');
  run(s, 'back t');
  assert.equal(ser(s), before);
  // 托盘跟着回来
  const u = run(new Scene(), `${T47}\nopen t insert`);
  stu(u, 'insert t 47', 'insert');
  run(u, 'back t');
  assert.equal(ser(u), '30 20 40 10 25 _ 45');
  assert.deepEqual(u.objects.get('t').tray, ['47']);
  assert.equal(dryRun(run(new Scene(), T47), 'back t')[0].error, 't 上学生还没动过');
  assert.equal(dryRun(run(new Scene(), `${T47}\ninsert t 47`), 'back t')[0].error, 't 上学生还没动过');
});

test('隔着一轮、刷新：整段 log 放回来现状一字不差；学生按的 back 撤得了（撤的是 back 那一行）', () => {
  const log = [
    { src: T47, by: 'teacher', turn: 1 },
    { src: 'keep t "插入后" after=insert', by: 'teacher', turn: 1 },
    { src: 'open t insert', by: 'teacher', turn: 1 },
    { src: 'open t rotate undo=on', by: 'teacher', turn: 1 },
    { src: 'open t back="插入后"', by: 'teacher', turn: 1 },
    { src: 'insert t 47', by: 'student', turn: 1, open: 'insert' },
    { src: 'rotate t.40 left', by: 'student', turn: 1, open: 'rotate' },
    { src: 'say "转得对。回到你转之前，再想想。"', by: 'teacher', turn: 2 },
    { src: 'back t', by: 'teacher', turn: 2 },
    { src: 'rotate t.30 left', by: 'student', turn: 2, open: 'rotate' },
    { src: 'back t "插入后"', by: 'student', turn: 2, open: 'back' },
  ];
  const go = (rows, lenient) => {
    const s = new Scene();
    for (const r of rows) for (const c of parseScript(r.src)) s.apply(lenient ? { ...c, lenient: true } : c, r.by === 'student' ? { by: 'student', open: r.open } : {});
    return s;
  };
  const live = go(log, false);
  const afterInsert = go(log.slice(0, 6), false);
  assert.equal(ser(live), ser(afterInsert));
  const again = go(log, true);
  assert.equal(again.stateText(), live.stateText());
  assert.match(live.stateText(), /t 存着：插入后/);
  // 撤一步：这一回合（老师第二轮以后）学生的最后一行是按的 back
  const plan = undoPlan(log, { from: 9, undoable: (r) => live.undoable(r) });
  assert.equal(plan.gone?.src, 'back t "插入后"');
  assert.equal(plan.index, 10);
  assert.equal(go(plan.lines, true).stateText(), go(log.slice(0, 10), false).stateText());
  // back 不是从写了 undo=on 的那一项来的也撤得了；别的照旧只认 undo=on
  assert.equal(live.undoable({ src: 'back t "插入后"', by: 'student', open: 'back' }), true);
  assert.equal(live.undoable({ src: 'insert t 50', by: 'student', open: 'insert' }), false);
  assert.equal(live.undoable({ src: 'rotate t.30 left', by: 'student', open: 'rotate' }), true);
});

test('after=：学生每做完一次那个动作页面替老师存；老师做的不存；写错了说能写什么', () => {
  const s = run(new Scene(), `${T47}\nopen t insert\nkeep t "插入后" after=insert`);
  assert.equal(s.keeps.get('t')?.has('插入后') ?? false, false, '只是登记：学生还没插');
  assert.deepEqual([...s.autoKeep.get('t')], [['插入后', 'insert']]);
  stu(s, 'insert t 47', 'insert');
  const after47 = ser(s);
  assert.equal(serialize(s.keeps.get('t').get('插入后')), after47);
  run(s, 'insert t 50');
  assert.equal(serialize(s.keeps.get('t').get('插入后')), after47, '老师插的不存');
  // after=off：不再替老师存；已经存下的照留着
  run(s, 'keep t "插入后" after=off');
  assert.equal(s.autoKeep.has('t'), false);
  assert.doesNotMatch(s.stateText(), /学生每做完一次/);
  assert.match(s.stateText(), /^t 存着：插入后$/m);
  stu(s, 'insert t 60', 'insert');
  assert.equal(serialize(s.keeps.get('t').get('插入后')), after47, '停了以后学生插的也不存');
  assert.equal(dryRun(s, 'keep t "插入后" after=off')[0].error, 't 的「插入后」没写过 after=，用不着 off');
  assert.match(dryRun(run(new Scene(), `${T47}\nkeep t "转平后" after=rotate`), 'keep t "插入后" after=off')[0].error, /页面替你存的：「转平后」after=rotate/);
  // 学生从「摆到空位」那一项插的（open t place 交的是 insert t#2 right 47）：指令是 insert，也算
  const p = run(new Scene(), `${T47}\nopen t place\nkeep t "摆好了" after=place`);
  stu(p, 'insert t#6 right 47', 'place');
  assert.equal(serialize(p.keeps.get('t').get('摆好了')), ser(p));
  assert.match(dryRun(s, 'keep t "x" after=fly')[0].error, /after= 写学生的一种动作.*没有「fly」/);
  assert.match(dryRun(s, 'keep t 插入后')[0].error, /名字写在引号里/);
  assert.match(dryRun(s, 'keep t')[0].error, /keep t "名字"/);
  assert.match(dryRun(s, 'keep t.30 "x"')[0].error, /整样东西/);
  assert.match(dryRun(s, 'keep zz "x"')[0].error, /舞台上没有「zz」/);
});

test('存不了的：跟着算的报错；一样东西最多存 6 个，同名的换掉；没存过的名字说存着哪些', () => {
  assert.equal(dryRun(run(new Scene(), 'dial k = 1 range=0..3\narray a = 1 {k} 3'), 'keep a "开始"')[0].error, 'a 是跟着算的，不能存');
  assert.equal(dryRun(run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1\nproduct C = A B'), 'keep C "开始"')[0].error, 'C 是跟着算的，不能存');
  const s = run(new Scene(), T47);
  assert.equal(KEEP_MAX, 6);
  for (let i = 1; i <= KEEP_MAX; i++) run(s, `keep t "第${i}步"`);
  assert.equal(dryRun(s, 'keep t "第7步"')[0].error, 't 最多存 6 个：同名的会换掉，先换掉一个');
  assert.equal(dryRun(s, 'keep t "第7步" after=insert')[0].error, 't 最多存 6 个：同名的会换掉，先换掉一个');
  run(s, 'insert t 47\nkeep t "第1步"');
  assert.equal(s.keeps.get('t').size, 6, '同名第二次是换掉');
  assert.equal(serialize(s.keeps.get('t').get('第1步')), ser(s));
  assert.equal(dryRun(s, 'back t "插入后"')[0].error, 't 没存过「插入后」（存着：第1步、第2步、第3步、第4步、第5步、第6步）');
  assert.equal(dryRun(run(new Scene(), T47), 'back t "插入后"')[0].error, 't 没存过「插入后」（存着：没有）');
  assert.match(dryRun(run(new Scene(), `${T47}\nkeep t "插入后" after=insert`), 'back t "插入后"')[0].error, /^t 没存过「插入后」（存着：没有；学生做完一次 insert 才存）$/);
});

test('告诉老师：学生点了「回到插入后」，写回到以后的样子', () => {
  const s = run(new Scene(), `${T47}\nopen t insert\nopen t rotate`);
  stu(s, 'insert t 47', 'insert');
  run(s, 'keep t "插入后"');
  const kept = ser(s);
  stu(s, 'rotate t.40 left', 'rotate');
  const fx = stu(s, 'back t "插入后"', 'back');
  assert.deepEqual(fx.back, { id: 't', name: '插入后', summary: `层序 ${kept}` });
  assert.equal(actText({ type: 'back', obj: 't', name: '插入后', open: 'back', line: 'back t "插入后"', summary: fx.back.summary }), `学生点了「回到插入后」：t 回到了插入后的样子（层序 ${kept}）`);
  // 每种东西交一句 summary：矩阵写 gridText，句子写那一句，一排格子写那一排数
  const m = run(new Scene(), 'matrix M = 1 -2 / 3 4\nopen M rowop\nkeep M "开始"');
  stu(m, 'rowop M r2 - 3r1', 'rowop');
  assert.equal(m.apply(one('back M "开始"')).back.summary, '(1 −2; 3 4)');
  const q = run(new Scene(), 'sentence s = "one two three four"\nkeep s "开始"\nmove s.3 after s.4');
  assert.equal(q.apply(one('back s "开始"')).back.summary, 'one two three four');
  const a = run(new Scene(), 'array a = 3 1 2\nkeep a "开始"\nswap a.1 a.3');
  assert.equal(a.apply(one('back a "开始"')).back.summary, '3 1 2');
});

test('现状：存着哪些、页面替老师存的；开着的「回到……」按钮', () => {
  const s = run(new Scene(), `${T47}\nkeep t "插入后"\nkeep t "转平后"`);
  assert.match(s.stateText(), /^t 存着：插入后、转平后$/m);
  run(s, 'open t back="插入后"');
  assert.match(s.stateText(), /学生能直接动的：[^\n]*t back（按钮「回到插入后」）/);
  const a = run(new Scene(), `${T47}\nopen t insert\nkeep t "插入后" after=insert\nopen t back="插入后"`);
  assert.match(a.stateText(), /^t 存着：没有；学生每做完一次 insert 页面存成「插入后」$/m);
  assert.match(a.stateText(), /t back（按钮「回到插入后」；还没存，按不了）/);
  assert.doesNotMatch(run(new Scene(), T47).stateText(), /存着/);
});

test('回去不动显示的：开着的子树高、平衡因子，学生点着的圈照 key 留着；藏着的照旧藏着', () => {
  const s = run(new Scene(), `${T47}\nopen t insert\nopen t rotate`);
  stu(s, 'insert t 47', 'insert');
  run(s, 'keep t "插入后"\nheights t\nbf t');
  run(s, 'pick t.45 t.40');
  stu(s, 'rotate t.40 left', 'rotate');
  const o = s.objects.get('t');
  o.ext = { l: 1, r: 2, t: 3, b: 4 };
  run(s, 'back t "插入后"');
  assert.equal(o.heights, true);
  assert.equal(o.bf, true);
  assert.deepEqual(o.ext, { l: 1, r: 2, t: 3, b: 4 });
  assert.deepEqual([45, 40, 30].map((v) => pickOf(s, v)), ['on', 'on', undefined]);
  run(s, 'hide t\nback t');
  assert.equal(o.hidden, true);
  // 纯函数：snapOf 不带位置；restoreSnap 不倒回显示的状态
  const t = run(new Scene(), T47).objects.get('t');
  const snap = snapOf(t);
  assert.equal('origin' in snap, false);
  t.heights = true;
  t.nodes[0].pick = 'on';
  t.tray = [];
  restoreSnap(t, snap);
  assert.deepEqual(t.tray, ['47']);
  assert.equal(t.heights, true);
  assert.equal(t.nodes[0].pick, 'on');
});

test('拿下舞台清掉存档；同名重造不清存档（换了一种东西才清），学生最后那一下之前的样子清掉', () => {
  const s = run(new Scene(), `${T47}\nopen t insert\nkeep t "开始"\nkeep t "插入后" after=insert`);
  stu(s, 'insert t 47', 'insert');
  run(s, 'remove t');
  assert.equal(s.keeps.has('t'), false);
  assert.equal(s.autoKeep.has('t'), false);
  assert.equal(s.lastBefore.has('t'), false);
  const r = run(new Scene(), `${T47}\nopen t insert\nkeep t "开始"`);
  stu(r, 'insert t 47', 'insert');
  run(r, 'tree t = 1 2 3');
  assert.equal(r.keeps.get('t').has('开始'), true);
  // 学生最后那一下之前的样子重造了就不算了：back t 不能把老师的重造悄悄抹掉
  assert.equal(r.lastBefore.has('t'), false);
  assert.equal(dryRun(r, 'back t')[0].error, 't 上学生还没动过');
  run(r, 'back t "开始"');
  assert.equal(ser(r), '30 20 40 10 25 _ 45');
  // 换了一种东西：存的是树的样子，回不到一排格子上
  run(r, 'array t = 1 2 3');
  assert.equal(r.keeps.has('t'), false);
});

test('open 的 back=：学生那边一个「回到……」按钮（不是默认的拖）；能开好几个；没存过的名字报', () => {
  const s = run(new Scene(), `${T47}\nkeep t "插入后"\nopen t back="插入后"`);
  assert.deepEqual(s.opens.get('t:back:插入后'), { obj: 't', action: 'back', name: '插入后', refs: [] });
  assert.equal(s.opens.has('t:drag'), false);
  run(s, 'keep t "开始"\nopen t back="开始"');
  assert.ok(s.opens.has('t:back:插入后') && s.opens.has('t:back:开始'));
  run(s, 'close t back');
  assert.equal([...s.opens.keys()].length, 0);
  assert.match(dryRun(run(new Scene(), T47), 'open t back="插入后"')[0].error, /^t 没存过「插入后」（存着：没有）/);
  assert.equal(dryRun(run(new Scene(), `${T47}\nkeep t "插入后" after=insert`), 'open t back="插入后"').length, 0, '页面以后替老师存的照收');
  assert.match(dryRun(s, 'open t rotate back="插入后"')[0].error, /back=/);
  assert.match(dryRun(s, 'open t.30 back="插入后"')[0].error, /整样东西/);
  assert.match(dryRun(s, 'open t back="插入后" undo=on')[0].error, /back=/);
});

test('back 以后挑战照实写：做到过的现在不成立写「做到过；现在不成立」；又做到时写做到了，不再庆祝、不再演预写的', () => {
  const s = run(new Scene(), `${T47}\nopen t insert\nkeep t "开始"\ngoal g1 "把 47 插进去" when="t height=4"\n@g1 say "对。"`);
  const fx = stu(s, 'insert t 47', 'insert');
  assert.deepEqual(fx.goalsMet, ['g1']);
  assert.deepEqual(fx.reactions, [{ goal: 'g1', src: 'say "对。"' }]);
  assert.match(s.stateText(), /^挑战 g1「把 47 插进去」when="t height=4"：做到了$/m);
  run(s, 'back t "开始"');
  assert.equal(s.goals.get('g1').met, true, '做到过就一直算做到（预写的已经演了、也告诉了老师）');
  assert.match(s.stateText(), /^挑战 g1「把 47 插进去」when="t height=4"：做到过；现在不成立（t height 4 ✗）$/m);
  const again = stu(s, 'insert t 47', 'insert');
  assert.equal(again.goalsMet, undefined, '不再庆祝一次');
  assert.equal(again.reactions, undefined, '预写的只演一次');
  assert.match(s.stateText(), /^挑战 g1「把 47 插进去」when="t height=4"：做到了$/m);
});

// —— 预写和挑战（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 6.1）——
const K312 = 'array k = 3 1 2\nopen k\ngoal g1 "排好" when="k sorted"';
// 舞台演预写的行：照老师的行（带 lenient，prewrite：不算学生的一下）
const playPre = (s, fx) => { for (const r of fx.reactions || []) for (const c of parseScript(r.src)) s.apply({ ...c, lenient: true, prewrite: true }, { by: 'teacher' }); };

test('预写能套三层：@g1 里写出的 goal g2 接着写 @g2、@g3；第四层报', async () => {
  const { PREWRITE_DEPTH } = await import('../kit/src/stage/scene.js');
  assert.equal(PREWRITE_DEPTH, 3);
  const s = run(new Scene(), `${K312}\n@g1 goal g2 "倒过来" when="k sorted desc"\n@g2 goal g3 "第一格是 2" when="k.1 = 2"\n@g3 say "好"`);
  assert.deepEqual(s.ahead.get('g2'), { lines: ['goal g3 "第一格是 2" when="k.1 = 2"'], depth: 2, from: 'g1' });
  assert.deepEqual(s.ahead.get('g3'), { lines: ['say "好"'], depth: 3, from: 'g2' });
  assert.match(s.stateText(), /挑战 g2 还没出（g1 做到时才出），做到了页面马上演你预写的 1 行（第 2 层）/);
  run(s, '@g3 goal g4 "第一格是 1" when="k.1 = 1"');
  assert.throws(() => run(s, '@g4 say "x"'), /^Error: 预写最多三层：@g4 已经是第 4 层（再往下要等你看着学生写）$/);
  assert.match(s.check(one('@g4 say "x"')), /最多三层/);
  // 前面哪一层都没写出 goal g9：照旧报先写 goal
  assert.match(s.check(one('@g9 say "x"')), /先写 goal g9/);
  // 套着的预写也在今天的舞台上照先后试：g1、g2 算做到、演它们的行，再演 @g3 这一行（写错照样当场报）
  assert.match(s.check(one('@g3 swap k.1')), /两格/);
  assert.equal(s.check(one('@g3 swap k.9 k.1')), null, '指着还没有的部件（k.9）只查写法');
  assert.equal(s.check(one('@g3 say "{k.1}"')), null);
});

test('套着的预写演出来：学生做到 g1，g2 出来、@g2 的行挪过去；学生再做到 g2 演 @g2 的行', () => {
  const s = run(new Scene(), `${K312}\n@g1 say "排好了"\n@g1 goal g2 "倒过来" when="k sorted desc"\n@g2 say "倒好了"`);
  stu(s, 'swap k.1 k.2', 'drag'); // 1 3 2
  const fx = stu(s, 'swap k.2 k.3', 'drag'); // 1 2 3
  assert.deepEqual(fx.goalsMet, ['g1']);
  assert.deepEqual(fx.reactions.map((r) => r.src), ['say "排好了"', 'goal g2 "倒过来" when="k sorted desc"']);
  playPre(s, fx);
  assert.ok(s.goals.has('g2'));
  assert.deepEqual(s.reactions.get('g2'), ['say "倒好了"'], 'goal 那一句不再把挪过来的行删掉');
  assert.equal(s.ahead.has('g2'), false);
  const fx2 = stu(s, 'swap k.1 k.3', 'drag'); // 3 2 1
  assert.deepEqual(fx2.goalsMet, ['g2']);
  assert.deepEqual(fx2.reactions, [{ goal: 'g2', src: 'say "倒好了"' }]);
});

test('@ask.right：下一个 ask 拿走；跟着的那一问页面判不了对错、没有那一问都报；@ask.wrong 报', () => {
  const a = run(new Scene(), 'array a = 3 1 2\n@ask.right say "对"\nask next "看一眼"');
  assert.equal(a.askRightProblem(), '@ask.right 要跟着一个页面判得了对错的 ask');
  const b = run(new Scene(), 'array a = 3 1 2\n@ask.right say "对"\nask tap a "最大的是哪个？" expect=a.1');
  assert.equal(b.askRightProblem(), null);
  assert.deepEqual(b.waiting.right, ['say "对"']);
  assert.equal(b.askRight, null);
  assert.match(b.stateText(), /学生答对这一问时页面马上演你预写的 1 行/);
  assert.equal(run(new Scene(), 'array a = 3 1 2\n@ask.right say "对"').askRightProblem(), '@ask.right 要跟着一个页面判得了对错的 ask', '还没被拿走');
  assert.equal(run(new Scene(), 'array a = 3 1 2\n@ask.right say "对"\nask value "几格" answer=3').askRightProblem(), null);
  assert.equal(run(new Scene(), 'array a = 3 1 2\n@ask.right say "对"\nask value "几格"').askRightProblem(), '@ask.right 要跟着一个页面判得了对错的 ask', '只收不判');
  assert.equal(run(new Scene(), 'tree t = 30 20 40\n@ask.right say "对"\nask pick t "哪几个"').askRightProblem(), '@ask.right 要跟着一个页面判得了对错的 ask');
  assert.equal(run(new Scene(), 'tree t = 30 20 40\n@ask.right say "对"\nask pick t "哪几个" expect="t.20 t.40"').askRightProblem(), null);
  assert.equal(b.check(one('@ask.wrong say "x"')), '走偏以后怎么讲要等你看着学生写，不能预写');
  assert.match(b.check(one('@ask.maybe say "x"')), /只能写 right/);
  assert.match(b.check(one('@ask.right swap a.1')), /两格/, '写错了照样当场报');
  assert.match(b.check(one('array ask = 1 2')), /留着别的用/);
});

test('「或」的挑战真的会做到：有一组都成立就算；写下时有一组已经成立就报；clauseMarks 每一组的每一句都标', () => {
  const s = run(new Scene(), 'array k = 1 2 3 4\nopen k\ngoal g1 "换两格" when="k.1 = 4, k.2 = 2 | k.1 = 3, k.2 = 1"');
  assert.match(s.stateText(), /还没做到（k\.1 = 4 ✗，k\.2 = 2 ✓ \| k\.1 = 3 ✗，k\.2 = 1 ✗）/);
  const fx = stu(s, 'swap k.1 k.4', 'drag'); // 4 2 3 1
  assert.ok(fx.goalsMet.includes('g1'));
  assert.equal(s.goals.get('g1').met, true);
  assert.match(s.stateText(), /挑战 g1「换两格」when="k\.1 = 4, k\.2 = 2 \| k\.1 = 3, k\.2 = 1"：做到了/);
  assert.match(s.check(one('goal g2 "x" when="k.1 = 4 | k.1 = 9"')), /现在就已经成立了/);
  assert.equal(s.check(one('goal g2 "x" when="k.1 = 8 | k.1 = 9"')), null);
  assert.deepEqual(s.clauseMarks(['g1']).map((m) => `${m.clause} ${m.ok}`), ['k.1 = 4 true', 'k.2 = 2 true', 'k.1 = 3 false', 'k.2 = 1 false']);
  assert.match(s.check(one('goal g3 "x" when="k.1 = 8 | "')), /\| 两边都要写条件/);
});

test('按了按钮才判（on=）：条件成立也不自己算做到；只在学生按那个按钮时判；press 那一行交出做到的和预写的行', () => {
  const s = run(new Scene(), 'array a = 1 2 3\nopen a\ngoal g1 "排好了就点「就这样」" when="a sorted" on="就这样"');
  assert.deepEqual(s.checkGoals(), []);
  assert.equal(s.goals.get('g1').met, false);
  assert.match(s.stateText(), /学生按「就这样」时才判/);
  assert.deepEqual(s.judgeOn('接着'), []);
  assert.deepEqual(s.judgeOn('就这样').map(({ id, met }) => ({ id, met })), [{ id: 'g1', met: true }]);
  assert.equal(s.goals.get('g1').met, true);
  // 学生按按钮时舞台记的一行 press：判了、做到了交出预写的行（和别的挑战一样）；没成立照实交 met: false
  const p = run(new Scene(), 'array a = 2 1 3\nopen a\ngoal g1 "…" when="a sorted" on="就这样"\n@g1 say "对"');
  const no = p.apply(one('press "就这样"'), { by: 'student' });
  assert.equal(no.goalsMet, undefined);
  assert.deepEqual(no.onGoals.map(({ id, met }) => ({ id, met })), [{ id: 'g1', met: false }]);
  assert.match(no.onGoals[0].status, /还没做到（a sorted ✗）/);
  stu(p, 'swap a.1 a.2', 'drag');
  assert.equal(p.goals.get('g1').met, false, '成立了也要等按钮');
  const yes = p.apply(one('press "就这样"'), { by: 'student' });
  assert.deepEqual(yes.goalsMet, ['g1']);
  assert.deepEqual(yes.reactions, [{ goal: 'g1', src: 'say "对"' }]);
  assert.ok(p.hasOn('就这样') === false && s.hasOn('就这样') === false);
  assert.match(run(new Scene(), 'array a = 2 1 3').check(one('goal g1 "x" when="a sorted" on=""')), /on= 写按钮上的字/);
});

test('收集型挑战（collect= n=）：收不一样的才收、每收一张演一次 @g1；拨回收过的那张记 dup 不收；收齐了算做到', () => {
  const s = run(new Scene(), 'matrix A = 1 1 / 0 1\nmatrix B = 1 0 / 1 0\nopen B edit range=-3..3\nmatrix Dd = {A B - B A}\ngoal g1 "再找一张不一样的 B，让 AB = BA" when="Dd = O" collect=B n=3\n@g1 say "又一张"');
  const g = s.goals.get('g1');
  const ed = (line) => stu(s, line, 'edit');
  ed('write B.2,1 0');
  let fx = ed('write B.2,2 1'); // B = I
  assert.equal(fx.goalsMet, undefined);
  assert.deepEqual(fx.reactions, [{ goal: 'g1', src: 'say "又一张"', collect: true, keepGoals: true }], '每收一张都演（只看不拿）');
  assert.deepEqual(s.reactions.get('g1'), ['say "又一张"']);
  for (const l of ['write B.1,1 2', 'write B.1,2 1']) ed(l);
  fx = ed('write B.2,2 2'); // (2 1; 0 2)
  assert.equal(fx.reactions.length, 1);
  assert.equal(g.collect.got.length, 2);
  assert.match(goalStatus(s, g), /收了 2 \/ 3/);
  assert.match(s.stateText(), /还没做到（收了 2 \/ 3；Dd = O ✓）；做到了页面马上演你预写的 1 行（每收一张演一次）/);
  // 拨回第一张（I）：和收过的一样，不收、不演
  for (const l of ['write B.1,1 1', 'write B.1,2 0']) ed(l);
  fx = ed('write B.2,2 1');
  assert.equal(g.collect.dup, 1);
  assert.equal(g.collect.got.length, 2);
  assert.ok(!fx.reactions?.length);
  // 第三张不一样的：收齐了
  for (const l of ['write B.1,1 0', 'write B.1,2 1']) ed(l);
  fx = ed('write B.2,2 0'); // (0 1; 0 0)
  assert.deepEqual(fx.goalsMet, ['g1']);
  assert.equal(g.met, true);
  assert.equal(g.collect.got.length, 3);
  assert.deepEqual(fx.reactions, [{ goal: 'g1', src: 'say "又一张"', keepGoals: true }]);
  // 老师的一下不替学生收
  const t = run(new Scene(), 'matrix A = 1 1 / 0 1\nmatrix B = 1 0 / 1 0\nopen B edit range=-3..3\nmatrix Dd = {A B - B A}\ngoal g1 "x" when="Dd = O" collect=B n=2');
  t.apply(one('write B.2,1 0'), { by: 'teacher' });
  t.apply(one('write B.2,2 1'), { by: 'teacher' });
  assert.equal(t.goals.get('g1').collect.got.length, 0);
  // 写法：collect 要跟着 n=；n 要写
  const base = run(new Scene(), 'matrix B = 1 0 / 1 0\narray a = 2 1');
  assert.match(base.check(one('goal g1 "x" when="a sorted" collect=B')), /n= 写收几张/);
  assert.match(base.check(one('goal g1 "x" when="a sorted" n=3')), /跟着 collect= 写/);
  assert.match(base.check(one('goal g1 "x" when="a sorted" collect=Q n=3')), /舞台上没有「Q」/);
  assert.match(base.check(one('goal g1 "x" when="a sorted" call=later')), /call= 只能写 now/);
});

test('预写里指着还没有的部件：写下时只查写法、照收；演的时候还没有，舞台告诉老师那一行没演上', () => {
  const s = run(new Scene(), 'tree t = _ tray="34"\nopen t insert\n@t.done ask tap t "点刚插进来的" expect=t.34');
  assert.deepEqual(s.reactions.get('t.done'), ['ask tap t "点刚插进来的" expect=t.34']);
  assert.match(s.check(one('@t.done ask tapp t "x" expect=t.34')), /ask 后面写 tap/, '写法错了照样报');
  const fx = stu(s, 'insert t 34', 'insert');
  assert.deepEqual(fx.done, ['t']);
  const [c] = parseScript(fx.reactions[0].src);
  assert.equal(s.missedPrewrite({ ...c, lenient: true, prewrite: true }), null, '插进来以后就有了，照演');
  const m = run(new Scene(), 'tree t = _ tray="34"\nopen t insert\n@t.done ask tap t "点刚插进来的" expect=t.99');
  const fm = stu(m, 'insert t 34', 'insert');
  const [cm] = parseScript(fm.reactions[0].src);
  assert.match(m.missedPrewrite({ ...cm, lenient: true, prewrite: true }), /^预写的这一行没演上：「ask tap t "点刚插进来的" expect=t\.99」——.*99/);
});

test('预写只在学生的一下演：老师的行让挑战成立、做完，预写的行拿掉不演（fx.unplayed）；刷新重放照样拿掉、不说；演预写的行（lenient）不算学生的一下', async () => {
  const { unplayedText } = await import('../kit/src/stage/scene.js');
  const src = 'array k = 2 1 3\nopen k\ngoal g1 "排好" when="k sorted"\n@g1 say "排好了"\ngoal g2 "倒过来" when="k sorted desc"\n@g2 say "倒好了"';
  const s = run(new Scene(), src);
  const fx = s.apply(one('swap k.1 k.2'), { by: 'teacher' });
  assert.deepEqual(fx.goalsMet, ['g1']);
  assert.deepEqual(fx.reactions, []);
  assert.deepEqual(fx.unplayed, ['g1']);
  assert.equal(s.reactions.has('g1'), false, '拿掉了');
  assert.equal(unplayedText('g1'), '你这一轮让挑战 g1 成立了，@g1 的行没演');
  assert.equal(unplayedText('t.done'), '你这一轮把 t 做完了，@t.done 的行没演');
  // 同一段 log 照 stage.js 的 replay 放（行带 lenient、replay，老师的行不给 by）：一样拿掉，不出 unplayed，现状一样
  const r = new Scene();
  let last;
  for (const c of parseScript(`${src}\nswap k.1 k.2`)) last = r.apply({ ...c, lenient: true, replay: true }, { by: null });
  assert.deepEqual(last.goalsMet, ['g1']);
  assert.equal(last.unplayed, undefined);
  assert.equal(r.reactions.has('g1'), false);
  assert.equal(r.stateText(), s.stateText());
  // 只带 lenient、不带 replay 的老师的行（舞台演预写的行就是这样）让 g2 成立：照老师的行办，不触发 @g2
  const p = s.apply({ ...one('swap k.1 k.3'), lenient: true, prewrite: true }, { by: 'teacher' });
  assert.deepEqual(p.goalsMet, ['g2']);
  assert.deepEqual(p.reactions, []);
  assert.deepEqual(p.unplayed, ['g2']);
  // 老师做完：@t.done 也拿掉
  const t = run(new Scene(), 'tree t = 30 20 tray="10"\nopen t insert\nopen t rotate\n@t.done say "平了"');
  stu(t, 'insert t 10', 'insert');
  const td = t.apply(one('rotate t.30 right'), { by: 'teacher' });
  assert.deepEqual(td.done, ['t']);
  assert.deepEqual(td.unplayed, ['t.done']);
  assert.equal(t.reactions.has('t.done'), false);
  // 学生做到的照旧演
  const u = run(new Scene(), src);
  assert.deepEqual(stu(u, 'swap k.1 k.2', 'drag').reactions, [{ goal: 'g1', src: 'say "排好了"' }]);
});

// —— Task 8 复核修正 ——
// 舞台演预写的行（stage.js 的 react 本身，拿假的舞台跑：exec 交给场景，onNote 记下来）
async function reactOn(s, list) {
  const { Stage } = await import('../kit/src/stage/stage.js');
  const { unplayedNotes } = await import('../kit/src/stage/scene.js');
  // exec 照 stage.js 的 exec 交场景、把「预写的行没演」交 onNote（同一个 unplayedNotes）
  const fake = { scene: s, studentChain: null, reacting: null, armedFor: null, errors: [], notes: [], onNote(t) { this.notes.push(t); }, async exec(c, { by }) { const fx = s.apply(c, { by: by === 'teacher' ? 'teacher' : null }); for (const t of unplayedNotes(fx)) this.onNote(t); return fx; }, cancelWait() {}, armWait() {} };
  await Stage.prototype.react.call(fake, list, 1);
  return fake;
}

test('@ask.right 里套着的预写：那一问没答对、被换掉、这一轮演完没着落、刷新跳过，整组拿掉；老师直接写的同名挑战不捡旧行', () => {
  const base = 'array a = 3 1 2\nopen a\n@ask.right say "对"\n@ask.right goal g2 "排好" when="a sorted"\n@g2 say "（旧的预写）好极了"';
  // 答错（舞台照 endAsk 收尾）
  const s = run(new Scene(), `${base}\nask tap a "最大的是哪个？" expect=a.1`);
  assert.equal(s.ahead.get('g2').from, s.waiting.rightKey);
  s.endAsk(s.waiting);
  s.waiting = null;
  assert.doesNotMatch(s.stateText(), /还没出/);
  run(s, 'goal g2 "把最小的拖到最前面" when="a.1 = 1"');
  assert.equal(s.reactions.get('g2'), undefined, '不捡旧的预写行');
  const fx = stu(s, 'swap a.1 a.2', 'drag');
  assert.deepEqual(fx.goalsMet, ['g2']);
  assert.deepEqual(fx.reactions, []);
  // 被下一问换掉
  const r = run(new Scene(), `${base}\nask tap a "最大的是哪个？" expect=a.1`);
  run(r, 'ask tap a "最小的是哪个？" expect=a.2');
  assert.equal(r.ahead.size, 0);
  assert.doesNotMatch(r.stateText(), /还没出/);
  // 这一轮演完没着落（没有 ask、跟着的一问判不了对错）
  const p = run(new Scene(), base);
  assert.equal(p.askRightProblem(), '@ask.right 要跟着一个页面判得了对错的 ask');
  p.dropAskRight();
  assert.equal(p.askRight, null);
  assert.equal(p.ahead.size, 0);
  const q = run(new Scene(), `${base}\nask next "看一眼"`);
  q.dropAskRight();
  assert.equal(q.waiting.right, undefined);
  assert.equal(q.ahead.size, 0);
  // 刷新重放跳过 ask
  const f = run(new Scene(), base);
  f.skipAsk();
  assert.equal(f.askRight, null);
  assert.equal(f.ahead.size, 0);
  // 答对：照常演出 goal g2，@g2 的行挪过去
  const ok = run(new Scene(), `${base}\nask tap a "最大的是哪个？" expect=a.1`);
  const lines = ok.waiting.right;
  delete ok.waiting.right;
  ok.waiting = null;
  for (const src of lines) for (const c of parseScript(src)) ok.apply({ ...c, lenient: true, prewrite: true }, { by: 'teacher' });
  assert.deepEqual(ok.reactions.get('g2'), ['say "（旧的预写）好极了"']);
  // 老师直接写的同名挑战不捡还在等着的那一组的行（@g1 里写出的 goal g2 演出来时才捡）
  const d = run(new Scene(), `${K312}\n@g1 goal g2 "倒过来" when="k sorted desc"\n@g2 say "倒好了"`);
  assert.match(d.check(one('goal g2 "第一格是 1" when="k.1 = 1"')), /^g2 是你预写的挑战（g1 做到时才出），直接写会和它撞名：换一个名字$/);
  assert.ok(d.ahead.has('g2'), '还是 g1 那一组的');
  assert.equal(d.check(one('goal g9 "第一格是 1" when="k.1 = 1"')), null);
});

test('收集型的 @g1 里写了 goal g2：每收一张不重写 g2（@g2 的行留着）', async () => {
  const s = run(new Scene(), 'matrix A = 1 1 / 0 1\nmatrix B = 1 0 / 1 0\nopen B edit range=-3..3\nmatrix Dd = {A B - B A}\narray k = 2 1\nopen k\ngoal g1 "x" when="Dd = O" collect=B n=3\n@g1 goal g2 "排" when="k sorted"\n@g2 say "排好了"');
  stu(s, 'write B.2,1 0', 'edit');
  await reactOn(s, stu(s, 'write B.2,2 1', 'edit').reactions);
  assert.deepEqual(s.reactions.get('g2'), ['say "排好了"']);
  for (const l of ['write B.1,1 2', 'write B.1,2 1']) stu(s, l, 'edit');
  await reactOn(s, stu(s, 'write B.2,2 2', 'edit').reactions);
  assert.deepEqual(s.reactions.get('g2'), ['say "排好了"'], '第二张时 goal g2 不再演一遍');
});

test('舞台演预写的行：演不上的不演，交 onNote；预写出的挑战一出来就成立照实说', async () => {
  const s = run(new Scene(), 'tree t = _ tray="34"\nopen t insert\n@t.done ask tap t "点刚插进来的" expect=t.99\n@t.done say "插好了"');
  const fx = stu(s, 'insert t 34', 'insert');
  const st = await reactOn(s, fx.reactions);
  assert.equal(st.notes.length, 1);
  assert.match(st.notes[0], /^预写的这一行没演上：「ask tap t "点刚插进来的" expect=t\.99」——/);
  assert.equal(fx.reactions[0].missed, true);
  assert.equal(fx.reactions[1].missed, undefined);
  assert.equal(s.say, '插好了');
  // 学生一下同时满足 g1 和预写出的 g2 的条件：g2 是预写的行造出来的、一出来就成立
  const g = run(new Scene(), 'array k = 2 1 3\nopen k\ngoal g1 "第一格是 1" when="k.1 = 1"\n@g1 goal g2 "第二格是 2" when="k.2 = 2"\n@g2 say "好"');
  const r = await reactOn(g, stu(g, 'swap k.1 k.2', 'drag').reactions);
  assert.deepEqual(r.notes, ['预写出的挑战 g2 一出来就已经成立了，@g2 的行没演']);
  const { unplayedText } = await import('../kit/src/stage/scene.js');
  assert.equal(unplayedText('g3', { prewrite: true }), '你预写的行让挑战 g3 成立了，@g3 的行没演');
  assert.equal(unplayedText('t.done', { prewrite: true }), '你预写的行把 t 做完了，@t.done 的行没演');
  assert.equal(unplayedText('g3'), '你这一轮让挑战 g3 成立了，@g3 的行没演');
});

test('on= 写的按钮这一轮没有：一轮演完报一句；有这个按钮不报', () => {
  const s = run(new Scene(), 'array a = 2 1 3\nopen a\ngoal g1 "排好就按" when="a sorted" on="就这样"\nask next "排好了按一下" button="好了"');
  assert.deepEqual(s.onProblems(), ['挑战 g1 写了 on="就这样"，可学生手上的这一问没有「就这样」这个按钮：学生按不到，这个挑战判不了（ask next 写 button="就这样"）']);
  assert.deepEqual(run(new Scene(), 'array a = 2 1 3\nopen a\ngoal g1 "x" when="a sorted" on="就这样"\nask next "排好了按一下" button="就这样"').onProblems(), []);
  assert.deepEqual(run(new Scene(), 'array a = 2 1 3\nopen a\ngoal g1 "x" when="a sorted" on="接着"\nask next "排好了点接着"').onProblems(), [], 'ask next 不写 button 就是「接着」');
  assert.equal(run(new Scene(), 'array a = 2 1 3\nopen a\ngoal g1 "x" when="a sorted" on="就这样"').onProblems().length, 1, '没有一问');
});

test('撞名两头都报：先直接写 goal g2 再预写 goal g2；先预写 goal g2（没套 @g2）再直接写；预写出的挑战照旧能在收集型里跳过；旧课照收', async () => {
  // 先直接写，再在 @g1 里预写同名的
  const a = run(new Scene(), `${K312}\ngoal g2 "老师的 g2" when="k sorted desc"`);
  assert.equal(a.check(one('@g1 goal g2 "预写同名" when="k.1 = 2"')), 'g2 是你直接写的挑战（已经在舞台上），预写里再写会和它撞名：换一个名字');
  assert.match(a.check(one('@t.done goal g2 "x" when="k.1 = 2"')) || '', /./);
  assert.match(run(new Scene(), 'array a = 3 1 2\ngoal g2 "x" when="a.1 = 9"').check(one('@ask.right goal g2 "预写同名" when="a.1 = 1"')), /^g2 是你直接写的挑战/);
  // 先预写（没套 @g2，所以 ahead 里没有），再直接写
  const b = run(new Scene(), `${K312}\n@g1 goal g2 "预写的 g2" when="k sorted desc"`);
  assert.equal(b.ahead.size, 0);
  assert.equal(b.check(one('goal g2 "老师的 g2" when="k.1 = 2"')), 'g2 是你预写的挑战（g1 做到时才出），直接写会和它撞名：换一个名字');
  // 预写出的挑战（舞台演预写的行造的）：收集型每收一张照旧跳过它，写下时也不算撞名
  const c = run(new Scene(), 'matrix A = 1 1 / 0 1\nmatrix B = 1 0 / 1 0\nopen B edit range=-3..3\nmatrix Dd = {A B - B A}\narray k = 2 1\nopen k\ngoal g1 "x" when="Dd = O" collect=B n=3\n@g1 goal g2 "排" when="k sorted"\n@g2 say "排好了"');
  stu(c, 'write B.2,1 0', 'edit');
  await reactOn(c, stu(c, 'write B.2,2 1', 'edit').reactions);
  assert.equal(c.goals.get('g2').pre, true);
  assert.equal(c.check(one('@g1 say "又一张"')), null, '再写 @g1 的行：里面的 goal g2 是预写出的，不算撞名');
  for (const l of ['write B.1,1 2', 'write B.1,2 1']) stu(c, l, 'edit');
  await reactOn(c, stu(c, 'write B.2,2 2', 'edit').reactions);
  assert.deepEqual(c.reactions.get('g2'), ['say "排好了"']);
  // 重放旧课（lenient）：两种顺序都照收
  const r = run(new Scene(), `${K312}\ngoal g2 "老师的 g2" when="k sorted desc"`);
  assert.doesNotThrow(() => r.apply({ ...one('@g1 goal g2 "预写同名" when="k.1 = 2"'), lenient: true, replay: true }));
  const r2 = run(new Scene(), `${K312}\n@g1 goal g2 "预写的 g2" when="k sorted desc"`);
  assert.doesNotThrow(() => r2.apply({ ...one('goal g2 "老师的 g2" when="k.1 = 2"'), lenient: true, replay: true }));
});

// —— 同一处的三种按法（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 2.1 节）——
test('三种按法能一起开：同一句上 mark（滑）、fold（点）、move（按住再拖）都开得了；现状里这样东西合成自己一行写怎么按', async () => {
  const { ARMED_GRIPS, ARMED_PRESS } = await import('../kit/src/stage/gestures.js');
  const s = run(new Scene(), 'sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] [P a doctor]."');
  for (const l of ['open s mark', 'open s fold', 'open s move']) assert.deepEqual(dryRun(s, l), [], l);
  run(s, 'open s mark\nopen s fold\nopen s move');
  assert.deepEqual([...s.opens.keys()], ['s:mark', 's:fold', 's:move']);
  assert.deepEqual([...s.opens.values()].map((e) => e.seq), [1, 2, 3], '第几个开的');
  // 画面做好了（Task 11：空隙能放、同一处分得清按法）：自己一行写全（开着就是学生能直接动的），没有两个冒号
  assert.ok(ARMED_GRIPS.has('gap') && ARMED_PRESS.mixed, 'Task 11 交了空隙、接上了 choosePress');
  const t = s.stateText();
  assert.match(t, /\ns 开着：mark（滑）、fold（点）、move（按住再拖）(\n|$)/);
  assert.doesNotMatch(t, /学生能直接动的/, '别的东西没开');
  assert.doesNotMatch(t, /页面还分不清|页面还画不了/);
  // 画面没做好的那一种（以后再加手势时）：不说学生能拖一段；同一处只按得出先开的那一项，点名是哪一项（不说假话）
  ARMED_GRIPS.delete('gap');
  ARMED_PRESS.mixed = false;
  try {
    const t0 = s.stateText();
    assert.match(t0, /\ns 开着：mark（滑）、fold（点）；页面还分不清同一处的几种按法，那一处现在只按得出先开的 mark\n/);
    assert.match(t0, /\n开着、页面还画不了的（学生现在动不了）：s move（拖到空处）/);
  } finally { ARMED_GRIPS.add('gap'); ARMED_PRESS.mixed = true; }
  // 写了 wrong= / undo= 的照旧写在后面；写了部件的写部件。再开一次的 mark 算后开的（画面重挂、挂在后面）
  run(s, 'open s mark wrong=mark undo=on');
  assert.deepEqual([...s.opens.values()].map((e) => e.seq), [4, 2, 3]);
  assert.match(s.stateText(), /\ns 开着：mark（滑；wrong=mark、undo=on）、fold（点）、move（按住再拖）(\n|$)/);
  ARMED_PRESS.mixed = false;
  try { assert.match(s.stateText(), /\ns 开着：mark（滑；wrong=mark、undo=on）、fold（点）、move（按住再拖）；[^\n]*只按得出先开的 fold(\n|$)/); } finally { ARMED_PRESS.mixed = true; }
  // 树：拖（按住再拖）和摘叶子（点）；别的东西照旧写在「学生能直接动的」那一行，合成的那一行跟在后面
  const tr = run(new Scene(), 'tree t = 50 30 60 20 40\narray a = 3 1 2\nopen a\nopen t\nopen t pluck');
  assert.match(tr.stateText(), /\n学生能直接动的：a drag（拖）\nt 开着：drag（按住再拖）、pluck（点）(\n|$)/);
  ARMED_PRESS.mixed = false;
  try { assert.match(tr.stateText(), /\nt 开着：drag（按住再拖）、pluck（点）；页面还分不清同一处的几种按法，那一处现在只按得出先开的 drag(\n|$)/); } finally { ARMED_PRESS.mixed = true; }
  // 只开一种、同一处没有别的按法：照旧一项一项写（旧课的现状一字不变）
  assert.match(run(new Scene(), 'tree t = 50 30 70 tray="47"\nopen t rotate\nopen t insert').stateText(), /学生能直接动的：t rotate（拖到上面）；t insert（拖到空处）/);
  assert.match(run(new Scene(), 'tree t = 50 30\nopen t pluck').stateText(), /学生能直接动的：t pluck（点）/);
  // 克隆出来的现状一样
  assert.equal(s.clone().stateText(), s.stateText());
});

test('按法一样的照旧报：两项都是点、都是按住再拖；按法不一样的不报（拖结点和摘叶子以前算抢同一个部件）', () => {
  const T = 'tree t = 50 30 60 20 40';
  assert.match(dryRun(run(new Scene(), `${T}\nopen t pluck`), 'open t delete')[0]?.error || '', /都是点/);
  assert.deepEqual(dryRun(run(new Scene(), `${T}\nopen t rotate`), 'open t pluck'), []);
  assert.match(dryRun(run(new Scene(), `${T}\nopen t`), 'open t rotate')[0]?.error || '', /都是按住再拖/);
  assert.deepEqual(dryRun(run(new Scene(), `${T}\nopen t`), 'open t pluck'), []);
  // 写的部件不重叠的：照旧不抢
  assert.deepEqual(dryRun(run(new Scene(), `${T}\nopen t.20 pluck`), 'open t.30 delete'), []);
  // 同一项再开一次是换掉它
  assert.deepEqual(dryRun(run(new Scene(), `${T}\nopen t pluck`), 'open t pluck'), []);
  // 句子：mark 和拖词、move 和拖词
  const S = 'sentence s = "The man is a doctor."';
  assert.deepEqual(dryRun(run(new Scene(), `${S}\nopen s`), 'open s mark'), []);
  assert.match(dryRun(run(new Scene(), `${S}\nopen s`), 'open s move')[0]?.error || '', /都是按住再拖/);
});

test('给个提示不动说的话：不带话的 ask next 不清掉最后说的那一句', () => {
  const s = run(new Scene(), 'array a = 3 1 2\nsay "先看左边"\nask next button="给个提示"');
  assert.equal(s.say, '先看左边');
  assert.match(s.stateText(), /最后说的话：先看左边/);
  // 带 "" 的才清（老师自己写的照旧）
  run(s, 'ask next "" button="接着"');
  assert.equal(s.say, '');
});

test('拨数先写、东西后造：dial k … at=M 写在 M 之前先记着，M 第一次造出来时挂上（同名重造不再挂）', () => {
  const s = run(new Scene(), 'dial k = 1 range=0..3 at=M');
  assert.deepEqual(s.labels.get('dial:k').refs, []);
  assert.match(s.stateText(), /k 要挂在 M 上，M 还没造/);
  // 先记着的进了克隆（检查、试演都在克隆上跑）
  assert.match(s.clone().stateText(), /k 要挂在 M 上，M 还没造/);
  const c = s.clone();
  assert.equal(dryRun(c, 'matrix M = 1 {k}').length, 0);
  run(c, 'matrix M = 1 {k}');
  assert.match(s.stateText(), /k 要挂在 M 上，M 还没造/, '改克隆的不动原来的');
  run(s, 'matrix M = 1 {k}');
  assert.deepEqual(s.labels.get('dial:k').refs, ['M']);
  assert.doesNotMatch(s.stateText(), /还没造/);
  // 同名重造：不再挂一遍（老师之后自己挪过的不被拉回去）
  s.labels.get('dial:k').refs = [];
  run(s, 'matrix M = 2 {k}');
  assert.deepEqual(s.labels.get('dial:k').refs, []);
  // 收起拨数（unlabel dial:k）以后 M 才造：不挂，也不再说要挂
  const u = run(new Scene(), 'dial k = 1 range=0..3 at=M\nunlabel dial:k');
  assert.doesNotMatch(u.stateText(), /还没造/);
  run(u, 'matrix M = 1 {k}');
  assert.equal(u.labels.has('dial:k'), false);
  // 同名的拨数重写、挂到已有的东西上：先记着的那一项作废
  const r = run(new Scene(), 'array a = 1 2\ndial k = 1 range=0..3 at=M\ndial k = 1 range=0..3 at=a');
  assert.deepEqual(r.labels.get('dial:k').refs, ['a']);
  assert.doesNotMatch(r.stateText(), /还没造/);
  run(r, 'matrix M = 1 {k}');
  assert.deepEqual(r.labels.get('dial:k').refs, ['a']);
  // 东西在的照旧当场挂
  assert.deepEqual(run(new Scene(), 'array a = 1 2\ndial k = 1 at=a').labels.get('dial:k').refs, ['a']);
});

test('乘积上照旧不能写一格：open C explain 照收，open C edit 报「是乘积」（两项碰不到一起，不加 openKeys）', () => {
  const s = run(new Scene(), 'matrix A = 1 1 / -1 -1\nmatrix B = 1 -1 / -1 1 beside=A\nproduct C = A B\nmul C.1,1');
  assert.deepEqual(dryRun(s, 'open C explain'), []);
  run(s, 'open C explain');
  assert.ok(s.opens.has('C:explain'));
  const [err] = dryRun(s, 'open C edit');
  assert.match(err.error, /乘积/);
  assert.equal(s.opens.has('C:edit'), false);
});

test('比大小（compareValues）和挑战判数用同一个 numOf：分数、小数、真的减号、带撇', async () => {
  const { numOf } = await import('../kit/src/stage/goal.js');
  assert.equal(compareValues('1/2', '0.5'), 0);
  assert.equal(compareValues('−3', '-3'), 0, '真的减号');
  assert.equal(compareValues('49′', '49'), 0);
  assert.equal(compareValues('9', '10'), -1, '按数比，不按字');
  assert.equal(compareValues('b', 'a'), 1, '不是数的按字');
  assert.deepEqual(['1/2', '0.5', '−3', '49′', 'x', '', null, '3/0'].map(numOf), [0.5, 0.5, -3, 49, null, null, null, null]);
});

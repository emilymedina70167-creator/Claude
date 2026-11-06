// 舞台的场景（kit/src/stage/scene.js）：一行指令先检查再改场景；写错的挡下、说清楚错在哪；给老师看的现状照场景写
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun, compareValues } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { linkGeom } from '../kit/src/stage/layout.js';
import { cellBox, array as arrayType } from '../kit/src/stage/types/array.js';
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
  // 空着的乘积 open 了 rowop：一开始就没有下一步，不算做完
  const p = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 1 0 / 0 1\nproduct C = A B');
  assert.equal(p.apply(one('open C rowop')).done, undefined);
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
  assert.equal(act(m, 'write M.1,1 5'), null);
  // 漏乘倍数：不是正确的下一步，说像哪种错
  assert.match(m.judgeLine(one('rowop M r2 - r1'), { by: 'student' }).verdict.misread, /倍数不对/);
  const s = run(new Scene(), 'sentence s = "He is running." key="[S He] [V is running]."\nopen s mark');
  assert.deepEqual(act(s, 'mark s.2-3 V'), { type: 'mark', from: 2, to: 3, role: 'V' });
  assert.equal(act(s, 'mark s.1 s.3 V'), null, '不连着的几个词不是一段');
  assert.match(s.judgeLine(one('mark s.2 V'), { by: 'student' }).verdict.misread, /谓语只圈了一半/);
});

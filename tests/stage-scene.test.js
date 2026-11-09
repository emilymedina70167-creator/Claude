// 舞台的场景（kit/src/stage/scene.js）：一行指令先检查再改场景；写错的挡下、说清楚错在哪；给老师看的现状照场景写
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun, compareValues } from '../kit/src/stage/scene.js';
import { parseScript, parseRich } from '../kit/src/stage/script.js';
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
  assert.equal(act(m, 'write M.1,1 5'), null);
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
  // 摆过又藏起来、夹在中间没压着东西的：留在原处，先后也不变
  const a1 = { ...t.objects.get('A').origin };
  run(t, 'hide A\nshow A');
  assert.deepEqual(t.objects.get('A').origin, a1, '没压着东西：留在原处');
  assert.deepEqual([...t.objects.keys()], ['A', 'B', 'H']);
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

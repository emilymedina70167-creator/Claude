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


// 舞台的通用手势（kit/src/stage/gestures.js）：按下的部件、松手处的部件或空位 + 手势表 → 一行学生指令；撤一步去掉最后一行学生的。
// 画面那一半（gesturedom.js、keypad.js 的画面、三个样板的画法）靠浏览器里真的触摸检查，这里只测纯函数
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { gestureAct, dropVerdict, BLOCK_HINT, askFor, undoLines, undoPlan, kindsOf, normValue, writeRange, UNDO_TOLD, UNDO_NO, ARMED_GESTURES, ARMED_GRIPS, ARMED_PRESS, armable, kindArmed, PRESS_OF, HOLD_MS, PRESS_TEXT, choosePress, gestureGrabs, openGrabs, AFFORD_PRESS, closeAct, idleOf } from '../kit/src/stage/gestures.js';
import { gestureOf } from '../kit/src/stage/rules.js';
import { TYPES } from '../kit/src/stage/types/index.js';
import { affordsOf } from '../kit/src/stage/scene.js';
import { eventOf, tryCount } from '../kit/src/stage/events.js';
import { padKey, keyOf } from '../kit/src/stage/keypad.js';
import { trayBoxes, slotSpots, tree as treeType, NODE } from '../kit/src/stage/types/tree.js';
import { actText } from '../kit/src/stage/stage.js';

const run = (src, scene = new Scene()) => { for (const c of parseScript(src)) scene.apply(c); return scene; };
const part = (s, ref) => s.parts(ref)[0];
const open = (s, key) => s.opens.get(key);

test('树：结点拖到它的父亲上是在父亲那里转（左孩子转上来是右旋）；拖到别的结点上说清楚', () => {
  // 50 的左孩子 30 后插进来，编号是 #4（造的时候 50 #1、70 #2，插 60 是 #3）
  const s = run('tree t = 50 _ 70\ninsert t 60\ninsert t 30\nopen t rotate');
  assert.equal(part(s, 't.30').key, 4);
  assert.equal(part(s, 't.50').key, 1);
  const e = open(s, 't:rotate');
  assert.deepEqual(kindsOf(e.gesture), ['drop-on']);
  const r = gestureAct(s, e, { from: part(s, 't#4'), to: part(s, 't#1') });
  assert.equal(r.src, 'rotate t#1 right');
  assert.deepEqual(r.act, { type: 'rotate', at: 1, dir: 'right' });
  // 70（#2）是 50 的右孩子：拖上去是左旋
  assert.equal(gestureAct(s, e, { from: part(s, 't.70'), to: part(s, 't.50') }).src, 'rotate t#1 left');
  const bad = gestureAct(s, e, { from: part(s, 't#4'), to: part(s, 't.70') });
  assert.ok(bad.error && !bad.src, '拖到不是父亲的结点上：{ error }');
  assert.match(bad.error, /不是 70 的孩子/);
});

test('树：托盘的数拖进树是插入（页面从根比下去），拖到空位上是学生自己摆', () => {
  const s = run('tree t = 50 30 70 tray="47 10"\nopen t insert');
  assert.equal(gestureAct(s, open(s, 't:insert'), { value: '47', to: { tree: 't' } }).src, 'insert t 47');
  const p = run('tree t = 50 30 70 tray="47 10"\nopen t place');
  const spot = slotSpots(p.objects.get('t')).find((x) => x.parent === 2 && x.side === 'right');
  assert.ok(spot, '30 的右边是一个空位');
  assert.equal(gestureAct(p, open(p, 't:place'), { value: '47', to: { slot: { parent: spot.parent, side: spot.side } } }).src, 'insert t#2 right 47');
  assert.ok(gestureAct(p, open(p, 't:place'), { value: '47', to: { slot: { parent: 1, side: 'left' } } }).error, '50 的左边已经有 30 了');
});

test('树：托盘画在树下面一排、算进树占的地方；空位在缺孩子的那一边、太深的不给', () => {
  const s = run('tree t = 50 30 70 tray="47 10"');
  const o = s.objects.get('t');
  const tb = trayBoxes(o);
  assert.deepEqual(tb.map((b) => b.value), ['47', '10']);
  const nodesBottom = Math.max(...o.nodes.map((n) => treeType.partBox(o, n).y + NODE));
  assert.ok(tb.every((b) => b.y > nodesBottom && b.w === NODE), '托盘在结点下面，一个和结点一样大');
  const box = treeType.objectBox(o);
  assert.ok(tb.every((b) => b.y + b.h <= box.y + box.h && b.x >= box.x && b.x + b.w <= box.x + box.w), '树占的地方把托盘框进去（别的东西、贴字让开）');
  assert.deepEqual(trayBoxes(run('tree t = 50 30').objects.get('t')), [], '没有托盘就没有');
  // 空位：30、70 都是叶子，各两个；空树只有根的位置
  const spots = slotSpots(o);
  assert.deepEqual(spots.map((x) => `${x.parent}${x.side}`).sort(), ['2left', '2right', '3left', '3right']);
  const L = spots.find((x) => x.parent === 2 && x.side === 'left'), R = spots.find((x) => x.parent === 2 && x.side === 'right');
  assert.ok(L.box.x < R.box.x && L.box.y > treeType.partBox(o, o.nodes[1]).y, '左边的空位在左、都在下一层');
  assert.deepEqual(slotSpots(run('tree t = _').objects.get('t')).map((x) => x.parent), [null]);
});

test('矩阵：一行的把手拖到另一行上是倍加（倍数框里的 k），拖到行号上是两行对调，点行号是倍乘', () => {
  const s = run('matrix M = 1 2 3 / 2 1 0 / 2 4 1\nopen M rowop');
  const e = open(s, 'M:rowop');
  assert.deepEqual(kindsOf(e.gesture), ['drop-on', 'tap']);
  // 键盘上的减号是真的减号（−）：照样认
  assert.equal(gestureAct(s, e, { from: { row: 1 }, to: { row: 3 }, value: '−2' }).src, 'rowop M r3 - 2r1');
  assert.equal(gestureAct(s, e, { from: { row: 1 }, to: { label: 3 } }).src, 'rowop M r1 <-> r3');
  assert.equal(gestureAct(s, e, { from: { label: 2 }, value: '3' }).src, 'rowop M 3r2');
  assert.ok(gestureAct(s, e, { from: { row: 1 }, to: { row: 3 } }).error, '倍加没写倍数');
});

test('句子：从一个词拉到另一个词、再点成分标签是 mark；倒着拉一样', () => {
  const s = run('sentence s = "The man who lives next door is a doctor."\nopen s mark');
  const e = open(s, 's:mark');
  assert.deepEqual(kindsOf(e.gesture), ['span']);
  assert.equal(gestureAct(s, e, { from: part(s, 's.2'), to: part(s, 's.4'), role: 'V' }).src, 'mark s.2-4 V');
  assert.equal(gestureAct(s, e, { from: part(s, 's.4'), to: part(s, 's.2'), role: 'V' }).src, 'mark s.2-4 V');
  assert.ok(gestureAct(s, e, { from: part(s, 's.2'), to: part(s, 's.4') }).error, '没点成分');
});

test('写一格：open M edit input=keypad 是数字键盘写一个值（分数、负数）；不写 input= 照旧是拨数器', () => {
  const s = run('matrix M = 1 2 3 / 4 5 6\nopen M edit input=keypad');
  const e = open(s, 'M:edit');
  assert.equal(e.input, 'keypad');
  assert.deepEqual(kindsOf(e.gesture), ['write']);
  assert.equal(gestureAct(s, e, { to: { r: 2, c: 3 }, value: '-3/2' }).src, 'write M.2,3 -3/2');
  assert.equal(gestureAct(s, e, { to: part(s, 'M.2,3'), value: '−3/2' }).src, 'write M.2,3 -3/2');
  assert.match(gestureAct(s, e, { to: { r: 2, c: 3 }, value: '3/' }).error, /不是数/);
  assert.equal(open(run('matrix M = 1 2 / 3 4\nopen M edit'), 'M:edit').input, undefined);
  // 键盘只给写一个值的动作：写在别的上面当场报
  assert.throws(() => run('matrix M = 1 2 / 3 4\nopen M rowop input=keypad'), /input=keypad/);
  assert.throws(() => run('matrix M = 1 2 / 3 4\nopen M edit input=pen'), /input=/);
  assert.match(run('matrix M = 1 2 / 3 4\nopen M edit input=keypad').stateText(), /M edit（[^）]*input=keypad/);
});

test('手势要不要先问一个值：倍加、倍乘弹倍数框，对调不用；写一格总是键盘；拉一段要点成分', () => {
  const m = run('matrix M = 1 2 / 3 4\nopen M rowop\nopen B edit input=keypad', run('matrix B = 1 / 2'));
  const o = m.objects.get('M'), g = open(m, 'M:rowop').gesture;
  assert.equal(askFor(g, o, 'drop-on', { from: { row: 1 }, to: { row: 2 } })?.input, 'keypad');
  assert.equal(askFor(g, o, 'drop-on', { from: { row: 1 }, to: { label: 2 } }), null);
  assert.equal(askFor(g, o, 'drop-on', { from: { row: 1 }, to: { row: 1 } }), null, '拖回自己身上不问');
  assert.equal(askFor(g, o, 'tap', { from: { label: 2 } })?.input, 'keypad');
  assert.equal(askFor(open(m, 'B:edit').gesture, m.objects.get('B'), 'write', { to: { r: 1, c: 1 } })?.input, 'keypad');
  const s = run('sentence s = "The man is a doctor." key="[S The man] [V is] [P a doctor]."\nopen s mark');
  const pick = askFor(open(s, 's:mark').gesture, s.objects.get('s'), 'span', { from: part(s, 's.1'), to: part(s, 's.2') });
  assert.equal(pick.pick, 'role');
  // 按钮上写中文、小字是缩写；点了交中文（学生点「定语」括号上就画「定语」）
  const subs = pick.choices.map((c) => c.sub);
  for (const r of ['S', 'V', 'O', 'P', 'RC']) assert.ok(subs.includes(r), `成分按钮里有 ${r}`);
  const vals = pick.choices.map((c) => c.value);
  for (const r of ['主语', '谓语', '宾语', '表语', '定语从句']) assert.ok(vals.includes(r), `点了交「${r}」`);
  assert.ok(pick.choices.every((c) => c.value === c.text), '交的就是按钮上写的中文');
  assert.equal(new Set(vals).size, vals.length, '不重复');
  assert.ok(pick.choices.every((c) => c.text && c.value), '每个按钮有字');
  assert.equal(pick.choices.find((c) => c.sub === 'V').paint, 'g2', '颜色和括号一样（roleColor）');
  // key 里有常用的那几个以外的成分：也给按钮（不然拉对了也点不出来）
  const s2 = run('sentence s = "What he said is true." key="[SC What he said] [V is] [P true]."\nopen s mark');
  assert.ok(askFor(open(s2, 's:mark').gesture, s2.objects.get('s'), 'span', {}).choices.some((c) => c.sub === 'SC' && c.value === '主语从句'));
  // key 里一段写了几种的（Attr/NF）：每一种都有按钮
  const s3 = run('sentence s = "A fund designed to help grew." key="[S A fund [Attr/NF designed to help]] [V grew]."\nopen s mark');
  assert.ok(askFor(open(s3, 's:mark').gesture, s3.objects.get('s'), 'span', {}).choices.some((c) => c.sub === 'NF'));
});

test('句子：从 that 的钩拉一条线，松在词、括号、句子外框上 = refer s.6 -> s.5 / s.4-5 / s', () => {
  const s = run('sentence s = "The books on the shelf that I bought yesterday are new." links="that -> books; !that -> shelf=就近连了名词"\nopen s.6 refer');
  const e = open(s, 's:refer');
  assert.deepEqual(kindsOf(e.gesture), ['line']);
  assert.equal(e.gesture.from, 'hook');
  assert.deepEqual(e.gesture.to, ['word', 'bracket', 'sentence']);
  assert.deepEqual(e.refs, ['s.6']);
  const r = gestureAct(s, e, { from: part(s, 's.6'), to: part(s, 's.5') });
  assert.equal(r.src, 'refer s.6 -> s.5');
  assert.deepEqual(r.act, { type: 'refer', from: 6, to: { from: 5, to: 5 } });
  // 先拉出一道括号，线松在这道括号上：连到这一段
  run('mark s.4-5 O', s);
  const m = s.objects.get('s').marks[0];
  assert.equal(gestureAct(s, e, { from: part(s, 's.6'), to: { mark: m.id } }).src, 'refer s.6 -> s.4-5');
  // 松在句子外框上：连到整句
  assert.equal(gestureAct(s, e, { from: part(s, 's.6'), to: { whole: true } }).src, 'refer s.6 -> s');
  assert.ok(gestureAct(s, e, { from: part(s, 's.6'), to: part(s, 's.6') }).error, '连回自己');
  assert.ok(gestureAct(s, e, { from: part(s, 's.6') }).error, '没松在哪儿');
  assert.ok(gestureAct(s, e, { from: part(s, 's.6'), to: { mark: 'm99' } }).error, '没有这道括号');
  // 翻出来的那一行照演
  run('refer s.6 -> s.4-5', s);
  assert.deepEqual(s.objects.get('s').refers.map((x) => [x.from, x.toKeys, x.whole]), [[6, [4, 5], false]]);
  // 钩和拉括号抓的地方不一样，能一起开
  assert.doesNotThrow(() => run('open s mark', s));
  // 学生拉的线写给老师（裁判的结论 events.js 接着写）
  assert.equal(actText({ type: 'refer', src: 'refer s.6 -> s.5', verdict: { legal: true, right: false, why: 'that 连到 shelf' } }), '学生 refer s.6 -> s.5（that 连到 shelf）');
});

test('拉线的手势画面挂得上（Task 11 做了钩、拉线）：写进「学生能直接动的」；手势或钩任一样画面还没有时照实写「页面还画不了」', () => {
  const s = run('sentence s = "The books on the shelf that I bought yesterday are new." links="that -> books"\nopen s mark\nopen s.6 refer wrong=mark');
  assert.ok(ARMED_GESTURES.has('line') && ARMED_GRIPS.has('hook'), '画面做了拉线、交了钩');
  assert.equal(armable(open(s, 's:refer').gesture), true);
  assert.equal(armable(open(s, 's:mark').gesture), true);
  assert.equal(armable(null), true, '拖、点开看（不是手势表里的）照旧动得了');
  const t = s.stateText();
  assert.match(t, /学生能直接动的：s mark（拉一段）；s\.6 refer（拉一条线；wrong=mark）/);
  assert.doesNotMatch(t, /页面还画不了/);
  // 画面没有这种手势时（以后再加的手势照这个办）：现状不说学生能动，单独写一句
  ARMED_GESTURES.delete('line');
  try {
    assert.equal(armable(open(s, 's:refer').gesture), false);
    const t0 = s.stateText();
    assert.match(t0, /\n学生能直接动的：s mark（拉一段）\n/);
    assert.doesNotMatch(t0, /学生能直接动的：[^\n]*refer/);
    assert.match(t0, /\n开着、页面还画不了的（学生现在动不了）：s\.6 refer（拉一条线；wrong=mark）/);
    // 只开了拉线：没有「学生能直接动的」那一行
    assert.doesNotMatch(run('sentence s = "The books are new."\nopen s.1 refer').stateText(), /学生能直接动的/);
  } finally { ARMED_GESTURES.add('line'); }
  // 只有拉线的手势、没有钩也不行（钩是画法交的把手）
  ARMED_GRIPS.delete('hook');
  try { assert.equal(armable(open(s, 's:refer').gesture), false); } finally { ARMED_GRIPS.add('hook'); }
});

test('钩挂在折起来的词上：画面不挂钩，现状照实说——点了名的钩都折着时写进「页面还画不了的」、带「s.6 折着，展开以后才能拉」；折着一部分写在后面；展开以后照旧', () => {
  const K = 'sentence s = "The books on the shelf that I bought yesterday are new." key="[S The books on the shelf [RC that I [V bought] yesterday]] [V are] [P new]."';
  const s = run(`${K}\nmark s.6-9 RC\nopen s mark\nopen s.6 refer`);
  assert.equal(idleOf(s, open(s, 's:refer')), null, '没折：照旧');
  assert.match(s.stateText(), /学生能直接动的：s mark（拉一段）；s\.6 refer（拉一条线）(\n|$)/);
  run('fold s.6-9', s);
  assert.deepEqual(idleOf(s, open(s, 's:refer')), { all: true, text: 's.6 折着，展开以后才能拉' });
  const t = s.stateText();
  assert.match(t, /\n学生能直接动的：s mark（拉一段）(\n|$)/);
  assert.match(t, /\n开着、页面还画不了的（学生现在动不了）：s\.6 refer（拉一条线）（s\.6 折着，展开以后才能拉）/);
  assert.equal(s.clone().stateText(), t);
  run('unfold s.6', s);
  assert.match(s.stateText(), /学生能直接动的：s mark（拉一段）；s\.6 refer（拉一条线）(\n|$)/);
  // links= 的起头一个折着、一个没折：照旧能拉（从没折的那个），后面带一句哪个折着
  const l = run(`${K} links="that -> s.1-2; are -> s.1-2"\nmark s.6-9 RC\nfold s.6-9\nopen s refer`);
  assert.deepEqual(idleOf(l, open(l, 's:refer')), { all: false, text: 's.6 折着，展开以后才能拉' });
  assert.match(l.stateText(), /学生能直接动的：s refer（拉一条线）（s\.6 折着，展开以后才能拉）/);
  // 没写部件、没写 links=：每个没折的词都有钩，折着的不说
  assert.equal(idleOf(run(`${K}\nmark s.6-9 RC\nfold s.6-9\nopen s refer`), { obj: 's', action: 'refer', refs: [], gesture: gestureOf(s.objects.get('s'), 'refer') }), null);
});

test('写的值：键盘上的减号、全角斜线规整成指令里的写法', () => {
  assert.equal(normValue(' −3／2 '), '-3/2');
  assert.equal(normValue(null), null);
});

test('数字键盘：数字往后接、减号只在最前面（再按一下去掉）、斜线一个、退格', () => {
  let t = '';
  for (const k of ['3', '/', '/', '2']) t = padKey(t, k);
  assert.equal(t, '3/2');
  assert.equal(padKey(t, '−'), '-3/2');
  assert.equal(padKey(padKey(t, '−'), '−'), '3/2');
  assert.equal(padKey('', '/'), '', '没数字时不能先写斜线');
  assert.equal(padKey('-', '/'), '-');
  assert.equal(padKey('3/2', '⌫'), '3/');
  assert.equal(padKey('', '⌫'), '');
  assert.equal(padKey('12345678', '9'), '12345678', '最多 8 个字');
});

test('撤一步：去掉最后一行学生的（老师的、页面的不动）；from 以前的不撤', () => {
  const lines = [
    { src: 'tree t = 50 30', by: 'teacher', turn: 1 },
    { src: 'rotate t#1 right', by: 'student', turn: 1, open: 'rotate' },
    { src: 'say "嗯"', by: 'teacher', turn: 1 },
    { src: 'insert t 20', by: 'student', turn: 1, open: 'insert' },
    { src: 'ask next', by: 'page', turn: 1 },
  ];
  const out = undoLines(lines);
  assert.deepEqual(out.map((r) => r.src), ['tree t = 50 30', 'rotate t#1 right', 'say "嗯"', 'ask next']);
  assert.equal(lines.length, 5, '不改原来的');
  assert.deepEqual(undoLines(out).map((r) => r.src), ['tree t = 50 30', 'say "嗯"', 'ask next']);
  assert.equal(undoLines(lines, { from: 4 }).length, 5, 'from 以后没有学生的行：不撤');
  assert.equal(undoLines(lines, { from: 2 }).length, 4);
  assert.deepEqual(undoLines([]), []);
});

test('撤一步告诉老师是一行：学生撤回了哪一下', () => {
  assert.equal(actText({ type: 'undo', src: 'rotate t#1 right', open: 'rotate' }), '学生撤回了自己的上一下：rotate t#1 right（舞台已经退回去了）');
  // 页面不判的手势（写一格、折起来）：照那一行写
  assert.equal(actText({ type: 'write', src: 'write M.2,3 -3/2', open: 'edit' }), '学生 write M.2,3 -3/2');
});

test('矩阵：学生走偏的那一步（wrong=mark）只淡淡圈着改了的那一行，不是整张', () => {
  const s = run('matrix M = 1 2 / 3 4 / 5 6\nopen M rowop wrong=mark');
  const [c] = parseScript('rowop M r3 - r2');
  const j = s.judgeLine(c, { by: 'student', open: 'rowop' });
  assert.equal(j.verdict.right, false);
  s.apply(c, { judged: j });
  const M = s.objects.get('M');
  assert.deepEqual(M.cells.filter((x) => x.slip).map((x) => `${x.r},${x.c}`), ['3,1', '3,2']);
});

test('撤一步只撤一下的那一行：别的行一行不少（课堂循环存的那一段照旧对得上）', () => {
  // 第 1 轮老师的行（含页面补的 ask），学生做了两下；撤第二下：长度只少一，学生那一段从 S.logFrom 起还是第一下
  const log = [
    { src: 'matrix M = 1 2 / 3 4', by: 'teacher', turn: 1 },
    { src: 'open M rowop undo=on', by: 'teacher', turn: 1 },
    { src: 'ask next "" button="给个提示"', by: 'page', turn: 1 },
    { src: 'rowop M r2 - 3r1', by: 'student', turn: 1, open: 'rowop' },
    { src: 'rowop M r1 <-> r2', by: 'student', turn: 1, open: 'rowop' },
  ];
  const logFrom = 3;
  const plan = undoPlan(log, { from: logFrom });
  assert.equal(plan.gone, log[4]);
  assert.equal(plan.lines.length, log.length - 1);
  assert.deepEqual(plan.lines.slice(logFrom).map((r) => r.src), ['rowop M r2 - 3r1']);
  assert.deepEqual(plan.lines.slice(0, logFrom), log.slice(0, logFrom), 'ask 那一行照样在');
});

test('撤一步：引出过预写、做到挑战、做完了的那一下撤不了；没写 undo=on 的那一项（拨数）也撤不了，都不往前跳', () => {
  const base = [{ src: 'tree t = 50 30 _ 20', by: 'teacher', turn: 1 }];
  const told = [...base, { src: 'rotate t#1 right', by: 'student', turn: 1, open: 'rotate', reacted: true }];
  const p = undoPlan(told);
  assert.equal(p.gone, null);
  assert.equal(p.why, UNDO_TOLD);
  assert.equal(UNDO_TOLD, '这一下已经记下了，撤不了', '中性：不说对错，也不说给谁看（样子页没有老师）');
  assert.equal(undoLines(told).length, told.length, '不撤');
  // 最后一下是拨数（那一项没写 undo=on）：前面能撤的也不跳过去撤（不然先后乱了）
  const opens = new Map([['t:rotate', { obj: 't', action: 'rotate', policy: { undo: true } }], ['k', { obj: 'k', action: 'dial' }]]);
  const undoable = (row) => [...opens.values()].some((e) => e.action === row.open && e.policy?.undo);
  const dial = [...base, { src: 'rotate t#1 right', by: 'student', turn: 1, open: 'rotate' }, { src: 'set k 2', by: 'student', turn: 1 }];
  const q = undoPlan(dial, { undoable });
  assert.equal(q.gone, null);
  assert.equal(q.why, UNDO_NO);
  assert.equal(undoPlan(dial.slice(0, 2), { undoable }).gone?.src, 'rotate t#1 right');
  // 还没做过：没有可说的
  assert.deepEqual(undoPlan(base), { lines: base, gone: null, why: null, index: -1 });
});

test('同一样东西开两项、同一处按法也一样的：第二项当场报，说两项都是哪种按法、先 close 哪一项', () => {
  const tree = 'tree t = 50 30 70 tray="47 10"';
  assert.throws(() => run(`${tree}\nopen t\nopen t rotate`), /t 已经开着 drag[\s\S]*都是按住再拖[\s\S]*close t drag/);
  assert.throws(() => run(`${tree}\nopen t insert\nopen t place`), /都是按住再拖[\s\S]*close t insert/);
  assert.throws(() => run(`${tree}\nopen t pluck\nopen t delete`), /都是点[\s\S]*close t pluck/);
  assert.throws(() => run('sentence s = "The man is a doctor."\nopen s\nopen s move'), /都是按住再拖[\s\S]*close s drag/);
  // 报错不再说「一次开一种」（按法不一样的能一起开）
  assert.throws(() => run(`${tree}\nopen t\nopen t rotate`), (err) => !/一次开一种/.test(err.message));
});

test('抢不到同一处的可以一起开：树的转和插、矩阵的行变换和拨格子；同一项再开一次是换掉它；部件不重的也行', () => {
  assert.doesNotThrow(() => run('tree t = 50 30 70 tray="47"\nopen t rotate\nopen t insert'));
  // 同一处按法不一样（点、滑、按住再拖）的也能一起开（以前算抢同一个部件，报「一次开一种」）
  assert.doesNotThrow(() => run('sentence s = "The man is a doctor."\nopen s mark\nopen s fold'));
  assert.doesNotThrow(() => run('sentence s = "The man is a doctor."\nopen s\nopen s mark'), '拖词是按住再拖、拉括号是滑');
  assert.doesNotThrow(() => run('tree t = 50 30 70\nopen t\nopen t pluck'), '拖是按住再拖、摘叶子是点');
  assert.doesNotThrow(() => run('matrix M = 1 2 / 3 4\nopen M rowop\nopen M edit'));
  assert.doesNotThrow(() => run('matrix M = 1 2 / 3 4\nopen M edit\nopen M edit input=keypad'));
  assert.doesNotThrow(() => run('tree t = 50 30 70\nopen t rotate\nclose t rotate\nopen t'));
  assert.doesNotThrow(() => run('array a = 3 1 2 5\nopen a.1-2\nopen a.3-4'), '同一项（drag）再开一次是换掉它');
});

test('键盘写一格：写了 range= 照它收，不写不限（舞台现状也就不写范围）', () => {
  const s = run('matrix M = 1 2 / 3 4\nopen M edit input=keypad range=-3..3');
  const e = open(s, 'M:edit');
  assert.equal(writeRange(e, '5/2'), null);
  assert.match(writeRange(e, '7/2'), /-3～3/);
  assert.match(writeRange(e, '−4'), /-3～3/);
  const free = open(run('matrix M = 1 2 / 3 4\nopen M edit input=keypad'), 'M:edit');
  assert.equal(free.lo, null);
  assert.equal(writeRange(free, '99'), null);
  assert.doesNotMatch(run('matrix M = 1 2 / 3 4\nopen M edit input=keypad').stateText(), /～/);
  assert.match(s.stateText(), /M edit（[^）]*-3～3/);
  // 拨数器照旧默认 -9～9
  assert.equal(open(run('matrix M = 1 2 / 3 4\nopen M edit'), 'M:edit').lo, -9);
});

test('撤一步不算「试」的次数（不会撤几下就凑出「试了好多下」去叫老师）', () => {
  const ev = [eventOf({ type: 'undo', src: 'rotate t#1 right', open: 'rotate' }), eventOf({ type: 'rowop', src: 'rowop M r2 - r1', open: 'rowop' })];
  assert.equal(ev[0].kind, 'try');
  assert.equal(tryCount(ev), 1);
});

// —— 同一处的三种按法、✕、摘叶子 / 删、拖一段（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 2.1、2.4、2.6 节）——

test('每一下只认成一种：同一处开着几种按法时照 choosePress 定（null 是还在等，none 是作罢）；只有一种照旧按下就拖', () => {
  assert.deepEqual(PRESS_OF, { tap: 'tap', write: 'tap', span: 'slide', line: 'slide', 'drop-on': 'hold', 'drop-at': 'hold' });
  assert.equal(HOLD_MS, 350);
  assert.deepEqual(PRESS_TEXT, { tap: '点', slide: '滑', hold: '按住再拖' });
  const all = ['tap', 'slide', 'hold'];
  assert.equal(choosePress(all, { up: true, moved: false, ms: 100 }), 'tap', '没挪、不到 0.35 秒就松手：点');
  assert.equal(choosePress(all, { moved: true, ms: 120 }), 'slide', '不到 0.35 秒就挪了：滑');
  assert.equal(choosePress(all, { moved: false, ms: 360 }), 'hold', '按住 0.35 秒没挪：托起来');
  assert.equal(choosePress(all, { moved: false, ms: 100 }), null, '还没松手、没挪、不到 0.35 秒：接着等');
  assert.equal(choosePress(['hold'], { moved: true, ms: 10 }), 'hold', '只有一种：照第一轮，按下就拖');
  assert.equal(choosePress(['hold'], { moved: false, ms: 0 }), 'hold');
  assert.equal(choosePress(['slide'], { moved: false, ms: 0 }), 'slide', '只开了拉括号：按下就开始拉（点一下松手是拉一个词）');
  assert.equal(choosePress(['tap'], { moved: true, ms: 50 }), 'none', '只有点：挪了就作罢');
  assert.equal(choosePress(['tap'], { moved: false, ms: 900 }), null, '点要等松手');
  assert.equal(choosePress(['tap'], { up: true, moved: false, ms: 900 }), 'tap');
  assert.equal(choosePress(['tap', 'hold'], { moved: true, ms: 100 }), 'none', '没有滑：不到 0.35 秒挪了是作罢（不留半截的拖）');
  assert.equal(choosePress(['tap', 'hold'], { moved: false, ms: 100 }), null);
  assert.equal(choosePress(['tap', 'hold'], { moved: true, ms: 400 }), 'hold', '按够了再挪：拖它');
  assert.equal(choosePress(['tap', 'slide'], { moved: false, ms: 500 }), null, '没有按住再拖：到了 0.35 秒照旧等松手');
  assert.equal(choosePress(['tap', 'slide'], { moved: false, ms: 500, up: true }), 'tap', '照点算');
  assert.equal(choosePress(['tap', 'slide'], { moved: true, ms: 500 }), 'none', '照点算：挪了就作罢');
  assert.equal(choosePress(['slide', 'hold'], { up: true, moved: false, ms: 100 }), 'none', '没有点：没挪就松手是作罢');
  // 手势的名字也认（规则文件写的 tap / span / drop-at）
  assert.equal(choosePress(['span', 'drop-at', 'tap'], { moved: true, ms: 50 }), 'slide');
  assert.equal(choosePress([], { up: true }), 'none');
});

test('gestureGrabs 带按法：每一项是「地方|按法」，词、结点、格照旧都叫 part；不走手势表的拖是按住再拖、拨格子和点开看是点', () => {
  const s = run('sentence s = "The man is a doctor."\nopen s mark\nopen s fold\nopen s move');
  assert.deepEqual(gestureGrabs(open(s, 's:mark').gesture), new Set(['part|slide']));
  const fold = gestureGrabs(open(s, 's:fold').gesture);
  assert.ok(fold.has('part|tap') && fold.has('bracket|tap') && fold.has('pill|tap'), [...fold].join(' '));
  const move = gestureGrabs(open(s, 's:move').gesture);
  assert.ok(move.has('part|hold') && move.has('bracket|hold'), [...move].join(' '));
  assert.deepEqual(gestureGrabs(gestureOf(s.objects.get('s'), 'refer')), new Set(['hook|slide']), '钩上拉线：滑');
  const t = run('tree t = 50 30 70 tray="47"\nopen t rotate\nopen t insert');
  assert.deepEqual(gestureGrabs(open(t, 't:rotate').gesture), new Set(['part|hold']));
  assert.deepEqual(gestureGrabs(open(t, 't:insert').gesture), new Set(['tray|hold']));
  assert.deepEqual(gestureGrabs(gestureOf(t.objects.get('t'), 'pluck')), new Set(['part|tap']));
  const m = run('matrix M = 1 2 / 3 4\nopen M rowop');
  assert.deepEqual(gestureGrabs(open(m, 'M:rowop').gesture), new Set(['row|hold', 'label|tap']));
  assert.deepEqual(gestureGrabs(null), new Set());
  // 不走手势表的（affords）：拖、拨格子、点开看
  assert.deepEqual(openGrabs({ action: 'drag' }, affordsOf(TYPES.tree)), new Set(['part|hold']));
  const mx = affordsOf(TYPES.matrix);
  assert.deepEqual(openGrabs({ action: 'edit' }, mx), new Set(['part|tap']));
  assert.deepEqual(openGrabs({ action: 'explain' }, mx), new Set(['part|tap']));
  assert.deepEqual(openGrabs(open(run('matrix M = 1 2 / 3 4\nopen M edit input=keypad'), 'M:edit'), mx), new Set(['part|tap']), '键盘写一格走手势表的 write：点');
  assert.deepEqual(openGrabs({ action: 'back', name: '插入后' }, {}), new Set(), '「回到……」按钮不抓舞台上的东西');
  // 每种东西能开的、不走手势表的动作都定了按法
  for (const ty of Object.values(TYPES)) for (const a of Object.keys(affordsOf(ty))) assert.ok(AFFORD_PRESS[a], `${ty.label}的 ${a} 要定按法`);
});

test('树：open t pluck 点一片叶子 = delete t#4（点里面的结点：只能摘叶子）；open t delete 点哪个删哪个 = delete t.30', () => {
  const s = run('tree t = 50 30 60 20 40\nopen t pluck');
  const e = open(s, 't:pluck');
  assert.deepEqual(kindsOf(e.gesture), ['tap']);
  assert.equal(e.gesture.on, 'node');
  const r = gestureAct(s, e, { from: part(s, 't.20') });
  assert.equal(r.src, 'delete t#4');
  assert.match(gestureAct(s, e, { from: part(s, 't.30') }).error, /只能摘叶子/);
  assert.ok(gestureAct(s, e, {}).error, '没点到结点');
  // 翻出来的那一行照演：20 摘掉了
  run(r.src, s);
  assert.deepEqual(s.parts('t').map((n) => n.value), ['50', '30', '60', '40']);
  const d = run('tree t = 50 30 60 20 40\nopen t delete');
  const de = open(d, 't:delete');
  assert.deepEqual(kindsOf(de.gesture), ['tap']);
  assert.equal(gestureAct(d, de, { from: part(d, 't.30') }).src, 'delete t.30');
  assert.equal(gestureAct(d, de, { from: part(d, 't.20') }).src, 'delete t.20');
  run('delete t.30', d);
  assert.deepEqual(d.parts('t').map((n) => n.value), ['50', '40', '60', '20'], '两个孩子：中序后继 40 顶上来');
  // 值重复的结点写 #k（和 t#3 这种写法一样跟着结点走）
  const dup = run('tree t = 50 30 30\nopen t delete');
  assert.match(gestureAct(dup, open(dup, 't:delete'), { from: part(dup, 't#3') }).src, /^delete t#3$/);
  // 不判对错：wrong= 写不上
  assert.throws(() => run('tree t = 50 30\nopen t pluck wrong=mark'), /判不了对错/);
});

test('句子：open s move 按住一道括号拖到两个词之间 = move s.1-6 after s.11（按住一个词挪一个；挪到第一个词前面写 before s.1）', () => {
  const s = run('sentence s = "The man who lives next door to my parents is a very good doctor."\nmark s.1-6 主语\nopen s move');
  const e = open(s, 's:move');
  assert.deepEqual(kindsOf(e.gesture), ['drop-at']);
  assert.deepEqual(e.gesture.from, ['bracket', 'word']);
  assert.equal(e.gesture.to, 'gap');
  const m = s.objects.get('s').marks[0];
  assert.equal(gestureAct(s, e, { from: { mark: m.id }, to: { gap: { after: 11 } } }).src, 'move s.1-6 after s.11');
  assert.equal(gestureAct(s, e, { from: part(s, 's.3'), to: { gap: { after: 11 } } }).src, 'move s.3 after s.11');
  assert.equal(gestureAct(s, e, { from: part(s, 's.3'), to: { gap: { after: 0 } } }).src, 'move s.3 before s.1');
  assert.equal(gestureAct(s, e, { from: part(s, 's.10'), to: { gap: { after: 1 } } }).src, 'move s.10 after s.1');
  // 落回原处、落在要挪的那一段里面、没落在空隙上：说为什么
  assert.match(gestureAct(s, e, { from: part(s, 's.3'), to: { gap: { after: 2 } } }).error, /原处/);
  assert.match(gestureAct(s, e, { from: part(s, 's.3'), to: { gap: { after: 3 } } }).error, /原处/);
  assert.match(gestureAct(s, e, { from: { mark: m.id }, to: { gap: { after: 3 } } }).error, /里面/);
  assert.ok(gestureAct(s, e, { from: part(s, 's.3') }).error);
  assert.ok(gestureAct(s, e, { from: { mark: 'm99' }, to: { gap: { after: 11 } } }).error);
  // 翻出来的那一行照演：整段挪到 a 后面，括号跟着那几个词
  run(gestureAct(s, e, { from: { mark: m.id }, to: { gap: { after: 11 } } }).src, s);
  const ws = [...s.objects.get('s').words].sort((a, b) => a.slot - b.slot).map((w) => w.value);
  assert.deepEqual(ws, ['to', 'my', 'parents', 'is', 'a', 'The', 'man', 'who', 'lives', 'next', 'door', 'very', 'good', 'doctor']);
  // 折起来的词不能挪、不能挪进折起来的那一段
  const f = run('sentence s = "The man who lives next door is a doctor."\nfold s.3-6\nopen s move');
  assert.match(gestureAct(f, open(f, 's:move'), { from: part(f, 's.7'), to: { gap: { after: 4 } } }).error, /折起来/);
});

test('✕：学生拉的括号点 ✕ = unmark s.2-5，学生连的线点 ✕ = unrefer s.23；老师画的收不了', () => {
  // s.2-5 是主语 many child language researchers；s.23 是 this（指前面说的 children learn grammar by listening）；s.16 them 指 s.2-5
  const S = 'sentence s = "Today, many child language researchers believe that children learn grammar by listening, but few of them agree on the evidence that supports this view."';
  const s = run(`${S}\nopen s mark\nopen s refer\nmark s.20 宾语`);
  s.apply(parseScript('mark s.2-5 主语')[0], { by: 'student', open: 'mark' });
  const o = s.objects.get('s');
  const mine = o.marks.find((x) => x.by === 'student'), theirs = o.marks.find((x) => x.by === 'teacher');
  const em = open(s, 's:mark');
  assert.equal(em.gesture.close.on, 'xmark');
  const r = closeAct(s, em, { from: { mark: mine.id } });
  assert.equal(r.src, 'unmark s.2-5');
  assert.equal(r.act.type, 'unmark');
  assert.match(closeAct(s, em, { from: { mark: theirs.id } }).error, /老师画的括号收不了/);
  assert.ok(closeAct(s, em, { from: { mark: 'm99' } }).error);
  // 线
  s.apply(parseScript('refer s.23 -> s.8-12')[0], { by: 'student', open: 'refer' });
  run('refer s.16 -> s.2-5', s);
  const er = open(s, 's:refer');
  assert.equal(er.gesture.close.on, 'xrefer');
  assert.equal(closeAct(s, er, { from: { refer: 23 } }).src, 'unrefer s.23');
  assert.match(closeAct(s, er, { from: { refer: 16 } }).error, /老师画的线收不了/);
  assert.ok(closeAct(s, er, { from: { refer: 9 } }).error, '这个词上没有线');
  // 别的项（折、挪）没有 ✕
  run('open s fold', s);
  assert.ok(closeAct(s, open(s, 's:fold'), { from: { mark: mine.id } }).error);
  // 翻出来的那一行照演：只收学生那一道 / 那一条
  run('unmark s.2-5\nunrefer s.23', s);
  assert.deepEqual(o.marks.map((x) => x.id), [theirs.id]);
  assert.deepEqual(o.refers.map((x) => x.from), [16]);
});

test('✕ 收线：别的线也指着这个词时写成 unrefer s.4 -> s.1，只收这一条', () => {
  // which（s.6）指前面整句话 s.1-5，里面有 they（s.4）；学生把 they 连到 Kids
  const S = 'sentence s = "Kids imitate what they hear, which explains why accents spread."';
  const s = run(`${S}\nopen s refer\nrefer s.6 -> s.1-5`);
  s.apply(parseScript('refer s.4 -> s.1')[0], { by: 'student', open: 'refer' });
  const r = closeAct(s, open(s, 's:refer'), { from: { refer: 4 } });
  assert.equal(r.src, 'unrefer s.4 -> s.1');
  run(r.src, s);
  assert.deepEqual(s.objects.get('s').refers.map((x) => x.from), [6], '老师那一条（指到的一段里有 s.4）还在');
  // unrefer s.4 照旧收掉两头有 s.4 的每一条（老师写的旧写法意思不变）
  const t = run(`${S}\nrefer s.6 -> s.1-5\nrefer s.4 -> s.1\nunrefer s.4`);
  assert.deepEqual(t.objects.get('s').refers, []);
  // 没有正好这一条的：照以前的意思（箭头两边写的词都算，收掉两头有这些词的每一条），不报错
  const u = run(`${S}\nrefer s.6 -> s.1-5\nrefer s.4 -> s.1\nunrefer s.4 -> s.2`);
  assert.deepEqual(u.objects.get('s').refers, [], 's.6 那一条指的一段里有 s.4、s.2，s.4 那一条从 s.4 起：都收掉');
  // 两边的词都没有线：照以前报「没有箭头」
  assert.match(dryRun(run(`${S}\nrefer s.6 -> s.1-5`), 'unrefer s.8 -> s.9')[0]?.error || '', /没有箭头/);
  // 旧课照 log 放回（lenient）：一样照以前的意思
  const w = run(`${S}\nrefer s.6 -> s.1-5\nrefer s.4 -> s.1`);
  // 收的不只这一条时，不说「收掉了…」（规则的 check 不给这一句）
  assert.equal(w.judgeLine(parseScript('unrefer s.4 -> s.3')[0], { by: 'student', open: 'refer' })?.verdict?.why ?? null, null);
  assert.equal(w.judgeLine(parseScript('unrefer s.4')[0], { by: 'student', open: 'refer' })?.verdict?.why ?? null, null);
  assert.match(w.judgeLine(parseScript('unrefer s.4 -> s.1')[0], { by: 'student', open: 'refer' })?.verdict?.why || '', /收掉了老师连的 s\.4 → s\.1/);
  w.apply({ ...parseScript('unrefer s.4 -> s.3')[0], lenient: true });
  assert.deepEqual(w.objects.get('s').refers, []);
});

test('画面交得出的把手（Task 11 交了空隙、小方块、✕、钩、句子外框、整张矩阵）、同一处分得清按法：现状照写学生能动；哪一样画法交不出时照实写「页面还画不了」', () => {
  for (const g of ['gap', 'pill', 'xmark', 'xrefer', 'hook', 'sentence', 'whole', 'node', 'parent', 'tray', 'tree', 'slot', 'row', 'label', 'cell', 'word', 'bracket']) assert.ok(ARMED_GRIPS.has(g), g);
  assert.equal(ARMED_PRESS.mixed, true);
  const s = run('sentence s = "The man who lives next door is a doctor."\nopen s move');
  assert.equal(armable(open(s, 's:move').gesture), true, '空隙能放');
  assert.match(s.stateText(), /\n学生能直接动的：s move（拖到空处）/);
  assert.doesNotMatch(s.stateText(), /页面还画不了/);
  assert.equal(armable(gestureOf(s.objects.get('s'), 'fold')), true);
  // gesturedom.js 照 kindArmed 挂：挪一段的拖挂得上；矩阵行变换的两种都挂
  assert.equal(kindArmed(open(s, 's:move').gesture, 'drop-at'), true);
  const rg = open(run('matrix M = 1 2 / 3 4\nopen M rowop'), 'M:rowop').gesture;
  assert.deepEqual(kindsOf(rg).filter((k) => kindArmed(rg, k)), ['drop-on', 'tap']);
  // 落点画法交不出（以后再加的把手照这个办）：拎得起来放不下，不挂、现状不说学生能动
  ARMED_GRIPS.delete('gap');
  try {
    assert.equal(armable(open(s, 's:move').gesture), false, '没有空隙可放');
    assert.equal(kindArmed(open(s, 's:move').gesture, 'drop-at'), false);
    assert.match(s.stateText(), /\n开着、页面还画不了的（学生现在动不了）：s move（拖到空处）/);
    assert.doesNotMatch(s.stateText(), /学生能直接动的/);
  } finally { ARMED_GRIPS.add('gap'); }
});

test('整张的手势：open AB compare / put、open X merge 按住整张拖到另一张上；落点都是 { obj, whole: true }', () => {
  const W = (id) => ({ obj: id, whole: true });
  const s = run('matrix A = 1 2 / 3 4\nmatrix B = 0 1 / 1 0\nmatrix AB = {A B}\nmatrix BA = {B A}\nmatrix Sum = collect\nmatrix X = {-2 A}\nmatrix Y = {-A}\nopen AB compare\nopen X merge');
  const cmp = open(s, 'AB:compare');
  assert.deepEqual(kindsOf(cmp.gesture), ['drop-on']);
  assert.deepEqual([...gestureGrabs(cmp.gesture)], ['whole|hold']);
  const r = gestureAct(s, cmp, { from: W('AB'), to: W('BA') });
  assert.equal(r.src, 'compare AB BA');
  assert.deepEqual(r.act, { type: 'compare', a: 'AB', b: 'BA' });
  assert.ok(gestureAct(s, cmp, { from: W('AB'), to: W('AB') }).error, '拖回自己身上');
  assert.ok(gestureAct(s, cmp, { from: W('AB'), to: null }).error);
  run('close AB compare\nopen AB put', s);
  const put = open(s, 'AB:put');
  assert.equal(gestureAct(s, put, { from: W('AB'), to: W('Sum') }).src, 'put AB Sum');
  assert.match(gestureAct(s, put, { from: W('AB'), to: W('BA') }).error, /BA 不是收集用的矩阵/);
  assert.equal(gestureAct(s, open(s, 'X:merge'), { from: W('X'), to: W('Y') }).src, 'merge X Y');
  // 同一张开两种整张拖：同一处、同一种按法，当场报
  assert.match(s.check(parseScript('open AB compare')[0]), /都是按住再拖/);
  // 整张的把手画面交得出（Task 11 做了）：现状写学生能动；画法交不出时照实写「页面还画不了」
  assert.equal(armable(put.gesture), true);
  assert.match(s.stateText(), /\n学生能直接动的：X merge（拖到上面）；AB put（拖到上面）/);
  ARMED_GRIPS.delete('whole');
  try {
    assert.equal(armable(put.gesture), false);
    assert.match(s.stateText(), /开着、页面还画不了的（学生现在动不了）：X merge（拖到上面）；AB put（拖到上面）/);
  } finally { ARMED_GRIPS.add('whole'); }
  // 学生这一下写给老师：那一行，后面接页面算的事实
  const fx = s.apply(parseScript('put AB Sum')[0], { by: 'student', open: 'put' });
  assert.equal(actText({ type: 'put', into: 'Sum', open: 'put', src: 'put AB Sum', verdict: { legal: true, right: null } }), '学生 put AB Sum');
  assert.ok(!fx.blocked);
});

test('现状里跟着算的那一行：开着整张拖（compare / put / merge）的那几样另起一行写「学生拨不了，只能拖整张」；别的、没开的照旧「学生动不了」', () => {
  const HEAD = '跟着算的（依赖一变，页面当场重算；学生动不了）：';
  const DRAG = '跟着算的（依赖一变，页面当场重算；学生拨不了，只能拖整张（compare / put / merge））：';
  const src = 'matrix A = 1 2 / 3 4\nmatrix B = 0 1 / 1 0\nmatrix AB = {A B}\nmatrix BA = {B A}';
  // 没开：一字不变（旧课的现状照旧）
  const s = run(src);
  assert.ok(s.stateText().includes(`${HEAD}AB = {A B}；BA = {B A}`));
  assert.ok(!s.stateText().includes('只能拖整张'));
  // 开着 AB compare：AB 另起一行，BA 照旧
  run('open AB compare', s);
  assert.ok(s.stateText().includes(`${HEAD}BA = {B A}\n${DRAG}AB = {A B}`), s.stateText());
  // 画面交得出整张的把手（Task 11）：照旧这样写，学生能直接动的里有 AB compare
  assert.ok(ARMED_GRIPS.has('whole'));
  const t = s.stateText();
  assert.ok(t.includes(`${DRAG}AB = {A B}`));
  assert.match(t, /\n学生能直接动的：AB compare（拖到上面）/);
  assert.doesNotMatch(t, /学生动不了）：[^\n]*AB = \{A B\}/);
  // 都开着：只剩拖的那一行；收起来又回到原样
  run('open BA put', s);
  assert.ok(s.stateText().includes(`${DRAG}AB = {A B}；BA = {B A}`));
  assert.ok(!s.stateText().includes(HEAD));
  run('close', s);
  assert.ok(s.stateText().includes(`${HEAD}AB = {A B}；BA = {B A}`));
});

test('拖着悬在落点上：拿现在的舞台问会不会被拦（不是拖起来那一刻的）；翻不成指令的说为什么；要先问倍数的不问', () => {
  // 50 只有左孩子 30：树是平衡的，30 拖到 50 上（50 右旋）不是正确的下一步，wrong=block 会拦下
  const s = run('tree t = 50 30\nopen t rotate wrong=block');
  const e = open(s, 't:rotate');
  const ctx = () => ({ from: part(s, 't.30'), to: part(s, 't.50') });
  const v1 = dropVerdict(s, e, ctx(), 'drop-on');
  assert.equal(v1.r.src, 'rotate t#1 right');
  assert.equal(v1.blocked, true);
  assert.equal(v1.why, BLOCK_HINT);
  assert.doesNotMatch(v1.why, /平衡|不是正确/, '说得中性：不替老师说对错');
  // 拖着的这一会儿舞台变了（老师插了 20，成了 LL 型）：同一处现在不拦了
  run('insert t 20', s);
  const v2 = dropVerdict(s, e, ctx(), 'drop-on');
  assert.equal(v2.blocked, false);
  assert.equal(v2.why, '');
  // 翻不成指令的（拖到不是父亲的结点上）：why 是手势的那一句，不算拦
  const v3 = dropVerdict(s, e, { from: part(s, 't.20'), to: part(s, 't.50') }, 'drop-on');
  assert.ok(v3.r.error && v3.why === v3.r.error);
  assert.equal(v3.blocked, false);
  // 放下以后要先问倍数的（矩阵倍加）：现在判不了，照旧能放
  const m = run('matrix M = 1 2 / 3 4\nopen M rowop wrong=block');
  const v4 = dropVerdict(m, open(m, 'M:rowop'), { from: { row: 1 }, to: { row: 2 } }, 'drop-on');
  assert.ok(v4.ask);
  assert.equal(v4.blocked, false);
});

test('数字键盘收实体键：数字、- / .、退格、回车；别的不收', () => {
  for (const k of ['0', '7', '9', '-', '/', '.']) assert.equal(keyOf({ key: k }), k);
  assert.equal(keyOf({ key: 'Backspace' }), '⌫');
  assert.equal(keyOf({ key: 'Enter' }), 'ok');
  assert.equal(keyOf({ key: 'a' }), null);
  assert.equal(keyOf({ key: 'Escape' }), null);
  assert.equal(keyOf({ key: '7', metaKey: true }), null, '带 ⌘ 的是系统的快捷键，不收');
  assert.equal(keyOf({ key: 'r', ctrlKey: true }), null);
  assert.equal(keyOf({}), null);
  // 小数点：前面是数字、还没有小数点、不在分数线后面才接上
  assert.equal(padKey('3', '.'), '3.');
  assert.equal(padKey('3.', '.'), '3.');
  assert.equal(padKey('3/', '.'), '3/');
  assert.equal(padKey('3/4', '.'), '3/4');
  assert.equal(padKey('', '.'), '');
  assert.equal(padKey('-', '.'), '-');
  assert.equal(padKey('3.5', '.'), '3.5');
  assert.equal(padKey('3.', '5'), '3.5');
  assert.equal(padKey('3.', '/'), '3.', '小数点后面没数字不能写分数线');
});

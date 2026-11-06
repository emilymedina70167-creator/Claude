// 舞台的通用手势（kit/src/stage/gestures.js）：按下的部件、松手处的部件或空位 + 手势表 → 一行学生指令；撤一步去掉最后一行学生的。
// 画面那一半（gesturedom.js、keypad.js 的画面、三个样板的画法）靠浏览器里真的触摸检查，这里只测纯函数
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { gestureAct, askFor, undoLines, kindsOf, normValue } from '../kit/src/stage/gestures.js';
import { padKey } from '../kit/src/stage/keypad.js';
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
  const s = run('tree t = 50 30 70 tray="47 10"\nopen t insert\nopen t place');
  assert.equal(gestureAct(s, open(s, 't:insert'), { value: '47', to: { tree: 't' } }).src, 'insert t 47');
  const spot = slotSpots(s.objects.get('t')).find((x) => x.parent === 2 && x.side === 'right');
  assert.ok(spot, '30 的右边是一个空位');
  assert.equal(gestureAct(s, open(s, 't:place'), { value: '47', to: { slot: { parent: spot.parent, side: spot.side } } }).src, 'insert t#2 right 47');
  assert.ok(gestureAct(s, open(s, 't:place'), { value: '47', to: { slot: { parent: 1, side: 'left' } } }).error, '50 的左边已经有 30 了');
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
  const vals = pick.choices.map((c) => c.value);
  for (const r of ['S', 'V', 'O', 'P', 'RC']) assert.ok(vals.includes(r), `成分按钮里有 ${r}`);
  assert.equal(new Set(vals).size, vals.length, '不重复');
  assert.ok(pick.choices.every((c) => c.text && c.value), '每个按钮有字');
  assert.equal(pick.choices.find((c) => c.value === 'V').paint, 'g2', '颜色和括号一样（roleColor）');
  // key 里有常用的那几个以外的成分：也给按钮（不然拉对了也点不出来）
  const s2 = run('sentence s = "What he said is true." key="[SC What he said] [V is] [P true]."\nopen s mark');
  assert.ok(askFor(open(s2, 's:mark').gesture, s2.objects.get('s'), 'span', {}).choices.some((c) => c.value === 'SC'));
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

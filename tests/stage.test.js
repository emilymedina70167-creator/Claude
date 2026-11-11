// 舞台（kit/src/stage/，docs/stage-plan.md）不碰 DOM 的部分：动作、排版和镜头、镜头指令的读法
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arcPoints, arcPath, moveDuration, stagger, revealDelays, readHold, labelHold } from '../kit/src/stage/motion.js';
import { rowSlots, bbox, fitCamera, toScreen, placeLabel, overlaps, strideGroups } from '../kit/src/stage/layout.js';
import '../kit/src/stage/scene.js'; // 各种东西自己的指令（array、swap……）由它注册进来
import { tokenize, parseScript, parseRef, parseRich, richLength, COMMANDS } from '../kit/src/stage/script.js';

test('弧线：两头对得上，dir=-1 往屏幕上方拱（左往右、右往左都是）', () => {
  for (const [a, b] of [[{ x: 0, y: 0 }, { x: 300, y: 0 }], [{ x: 300, y: 0 }, { x: 0, y: 0 }]]) {
    const pts = arcPoints(a, b, { dir: -1 });
    assert.deepEqual([pts[0].x, pts[0].y], [a.x, a.y]);
    assert.ok(Math.abs(pts.at(-1).x - b.x) < 1e-9 && Math.abs(pts.at(-1).y - b.y) < 1e-9);
    const mid = pts[Math.floor(pts.length / 2)];
    assert.ok(mid.y < -20, `弧顶应在上方，实际 y=${mid.y}`);
  }
  assert.ok(arcPoints({ x: 0, y: 0 }, { x: 300, y: 0 }, { dir: 1 })[8].y > 20, 'dir=1 往下拱');
  // 近的弧低、远的弧高，都有上下限
  const h = (d) => -Math.min(...arcPoints({ x: 0, y: 0 }, { x: d, y: 0 }).map((p) => p.y));
  assert.ok(h(40) >= 21 && h(40) < h(400) && h(4000) <= 150.01);
  assert.match(arcPath({ x: 0, y: 0 }, { x: 100, y: 0 }), /^M0 0 Q50 -\d+(\.\d)? 100 0$/);
});

test('时长和错开：远的慢一点但有上限；一组东西依次出发', () => {
  assert.ok(moveDuration(10) < moveDuration(500) && moveDuration(5000) === 900);
  assert.deepEqual([0, 1, 2].map((i) => stagger(i, { step: 50 })), [0, 50, 100]);
  assert.equal(stagger(100), 420);
  // 出字：长句总时长有上限，短句一个字一个字
  assert.equal(revealDelays(200).at(-1) <= 900, true);
  assert.deepEqual(revealDelays(3), [0, 22, 44]);
  assert.ok(readHold(2) === 700 && readHold(30) === 2700 && readHold(1000) === 3200);
  assert.ok(labelHold(2) === 500 && labelHold(20) === 1100 && labelHold(1000) === 1800);
});

test('镜头：放进屏幕上能用的地方（去掉顶上的话、底下的按钮），竖着空的时候往上提', () => {
  const box = { x: 0, y: 0, w: 748, h: 86 };
  const view = { w: 820, h: 1180 };
  const cam = fitCamera(box, view, { top: 140, bottom: 90, pad: 28, maxScale: 1.5, lift: 0.4 });
  const s = toScreen(box, cam);
  assert.ok(s.x >= 27.9 && s.x + s.w <= 792.1, '左右放得下');
  assert.ok(s.y >= 140 + 28 - 0.01 && s.y + s.h <= 1180 - 90, '上下放得下');
  assert.ok(s.y + s.h / 2 < (140 + 1180 - 90) / 2, '比正中间靠上');
  // 小东西不放大过头
  assert.equal(fitCamera({ x: 0, y: 0, w: 10, h: 10 }, view, { maxScale: 1.5 }).s, 1.5);
});

test('贴字：先试上面；上面压着弧线就往外让，不跑到别的边去', () => {
  const anchor = { x: 100, y: 100, w: 200, h: 64 };
  const size = { w: 80, h: 24 };
  assert.equal(placeLabel(anchor, size, []).side, 'above');
  const arc = { x: 100, y: 40, w: 200, h: 58 }; // 格子上面的一道弧
  const p = placeLabel(anchor, size, [arc]);
  assert.equal(p.side, 'above');
  assert.ok(!overlaps({ ...p, ...size }, arc) && p.y + size.h <= 40, '落在弧的外面');
  // 四边都被堵死：挑压得最少的，不报错
  const wall = { x: -1000, y: -1000, w: 3000, h: 3000 };
  assert.ok(placeLabel(anchor, size, [wall]).side);
});

test('排版小件：一排格子、外框、按「隔 d 个」分组', () => {
  const slots = rowSlots(3, { cell: 64, gap: 12 });
  assert.deepEqual(slots.map((s) => s.x), [0, 76, 152]);
  assert.deepEqual(bbox(slots), { x: 0, y: 0, w: 216, h: 64 });
  assert.equal(bbox([]), null);
  assert.deepEqual(strideGroups(10, 5), [[1, 6], [2, 7], [3, 8], [4, 9], [5, 10]]);
  assert.deepEqual(strideGroups(10, 3), [[1, 4, 7, 10], [2, 5, 8], [3, 6, 9]]);
  assert.deepEqual(strideGroups(4, 1), [[1, 2, 3, 4]]);
  assert.deepEqual(strideGroups(4, 99), [[1], [2], [3], [4]]);
});

test('镜头指令：字符串（"…" 和 「…」）、箭头、key=value（值可以带空格）、行首 & 一起演', () => {
  assert.deepEqual(tokenize('hop a.1 -> a.6 label="隔 5 个" color=g1').map((t) => t.t), ['word', 'word', 'arrow', 'word', 'opt', 'opt']);
  assert.deepEqual(tokenize('say 「{a.1} 和 {a.6}」')[1], { t: 'str', v: '{a.1} 和 {a.6}' });
  assert.deepEqual(tokenize('hop a.1 → a.6')[2], { t: 'arrow' });
  const cmds = parseScript(`
    # 注释
    array a = 49 38 65
    say "从 {a.1} 往后数"
    & paint a.1 a.6 g1
    ask tap a "点一下"
  `);
  assert.deepEqual(cmds.map((c) => c.cmd), ['array', 'say', 'paint', 'ask']);
  assert.deepEqual(cmds.map((c) => c.par), [false, false, true, false]);
  assert.deepEqual(cmds[0].args.map((a) => a.v ?? a.t), ['a', 'eq', '49', '38', '65']);
  assert.equal(parseScript('hop a.1 -> a.6 label="隔 5 个"')[0].opts.label, '隔 5 个');
});

test('镜头指令写错了：不认得的指令、引号没收尾，记成错误（页面报给老师），别的行照读', () => {
  const cmds = parseScript('array a = 1 2\nzoom a\nsay "没收尾\nglow a.1');
  assert.deepEqual(cmds.map((c) => c.cmd), ['array', null, null, 'glow']);
  assert.match(cmds[1].error, /没有「zoom」这个指令/);
  assert.match(cmds[2].error, /引号没有收尾/);
  assert.ok(COMMANDS.has('fly') && COMMANDS.has('dial'));
});

test('{式子} 带空格也是一个词：answer={A + B}、vec p w = {A v}、格里的 {k + 1}；{ 没收尾、多了 } 当场报（话给老师看）', async () => {
  const { Scene, dryRun } = await import('../kit/src/stage/scene.js');
  const words = (l) => tokenize(l).map((t) => (t.t === 'opt' ? `${t.k}=${t.v}` : t.v ?? t.t));
  assert.deepEqual(words('ask value "A + B？" type=matrix answer={A + B}'), ['ask', 'value', 'A + B？', 'type=matrix', 'answer={A + B}']);
  assert.deepEqual(words('vec p w = {A v}'), ['vec', 'p', 'w', 'eq', '{A v}']);
  assert.deepEqual(words('matrix M = 1 {k + 1} / 0 1'), ['matrix', 'M', 'eq', '1', '{k + 1}', '/', '0', '1']);
  assert.deepEqual(words('graph g = A-B:{k + 1} B-C:4'), ['graph', 'g', 'eq', 'A-B:{k + 1}', 'B-C:4']);
  // 原来的写法分出来一样：不带空格的 {k}、引号里的 {a.3}（话里的小块）
  assert.deepEqual(words('matrix M = 1 {k} / 0 1'), ['matrix', 'M', 'eq', '1', '{k}', '/', '0', '1']);
  assert.deepEqual(words('say "{a.3} 和 {d}" answer={A^5}'), ['say', '{a.3} 和 {d}', 'answer={A^5}']);
  const [open] = parseScript('matrix M = 1 {k / 0 1');
  assert.equal(open.cmd, null);
  assert.match(open.error, /「\{k \/ 0 1」的 \{ 没有收尾：式子写在一对 \{\} 里/);
  assert.match(parseScript('matrix M = 1 k} / 0 1')[0].error, /多了一个 \}/);
  // 在舞台上：带空格的式子照样算（以前切成「{A」「+」「B}」，报「「{{A}」写错了」）
  const sc = new Scene();
  for (const c of parseScript('matrix A = 1 1 / -1 -1\nmatrix B = 1 -1 / -1 1\nplane p range=-4..4\nvec p v = 1 2\ndial k = 2 range=-3..3')) sc.apply(c);
  assert.deepEqual(dryRun(sc, 'ask value "A + B？" type=matrix answer={A + B}\nvec p w = {A v}\ngraph g = A-B:{k + 1} B-C:4\nmatrix S = { A + B }'), []);
  // 矩阵的格里写算成一个数的式子（第二轮放宽的）：{k + 1} 读成一个词，照收
  assert.deepEqual(dryRun(sc, 'matrix N = 1 {k + 1} / 0 1'), []);
});

test('部件的写法：整个、第几格、几格到几格、跟着走的那一个', () => {
  assert.deepEqual(parseRef('a'), { obj: 'a', mark: null, sel: null, kind: 'all' });
  assert.deepEqual(parseRef('a.3'), { obj: 'a', mark: '.', sel: '3', kind: 'slot', lo: 3, hi: 3 });
  assert.deepEqual(parseRef('a.5-2'), { obj: 'a', mark: '.', sel: '5-2', kind: 'slot', lo: 2, hi: 5 });
  assert.deepEqual(parseRef('a#8'), { obj: 'a', mark: '#', sel: '8', kind: 'key', lo: 8, hi: 8 });
  // 别的东西的部件：树的结点、矩阵的格、边（怎么读由那种东西自己定）
  assert.deepEqual(parseRef('t.A'), { obj: 't', mark: '.', sel: 'A' });
  assert.deepEqual(parseRef('m.2,3'), { obj: 'm', mark: '.', sel: '2,3' });
  assert.equal(parseRef('3a'), null);
  assert.equal(parseRef('a.'), null);
});

test('话里的写法：{a.2} 是图上的东西，{d} 是拨的数，$d$ 是字母，[不稳定] 能飞走', () => {
  const parts = parseRich('从 {a.2} 往后跳 {d} 下，$d$ 就是[隔几个]');
  assert.deepEqual(parts.map((p) => p.k), ['text', 'ref', 'text', 'var', 'text', 'math', 'text', 'word']);
  assert.equal(parts[1].v, 'a.2');
  assert.equal(parseRich('{a#8}')[0].k, 'ref');
  assert.equal(richLength(parseRich('{a.1}好')), 3);
});

test('手指按下去拿哪一个：落在里面的最小那个；落在空处挑半径以内最近的；正在等的那一问先；太远谁也不拿', async () => {
  const { pickTarget } = await import('../kit/src/stage/layout.js');
  const a = { id: 'a', rect: { x: 0, y: 0, w: 60, h: 60 } }, b = { id: 'b', rect: { x: 72, y: 0, w: 60, h: 60 } }, big = { id: 'big', rect: { x: -10, y: -10, w: 300, h: 200 } };
  assert.equal(pickTarget({ x: 30, y: 30 }, [big, a, b]).id, 'a');
  assert.equal(pickTarget({ x: 64, y: 30 }, [a, b]).id, 'a');
  assert.equal(pickTarget({ x: 69, y: 30 }, [a, b]).id, 'b');
  assert.equal(pickTarget({ x: 160, y: 30 }, [a, b], { radius: 30 }).id, 'b');
  assert.equal(pickTarget({ x: 200, y: 30 }, [a, b], { radius: 30 }), null);
  assert.equal(pickTarget({ x: 64, y: 30 }, [a, { ...b, prio: 1 }]).id, 'b');
});

test('另起一列（columnSlot）：横屏往下摆会缩得太小、摆右边缩得少，就摆右边、和最上面那样顶齐；竖屏照旧往下', async () => {
  const { columnSlot } = await import('../kit/src/stage/layout.js');
  const gap = 70;
  // 已经竖着摆了三张 300 高的矩阵
  const boxes = [0, 1, 2].map((i) => ({ x: 0, y: i * (300 + gap), w: 300, h: 300 }));
  const size = { w: 300, h: 300 };
  const wide = columnSlot(boxes, size, { w: 1180, h: 820 }, { gap });
  assert.deepEqual(wide, { x: 300 + gap, y: 0, column: true, start: true });
  const tall = columnSlot(boxes, size, { w: 820, h: 1180 }, { gap });
  assert.deepEqual(tall, { x: 0, y: 3 * (300 + gap), column: false, start: false });
  // 不知道屏幕多大：照旧往下摆
  assert.equal(columnSlot(boxes, size, null, { gap }).column, false);
  // 舞台上还没有东西
  assert.deepEqual(columnSlot([], size, { w: 1180, h: 820 }, { gap }), { x: 0, y: 0, column: false, start: false });
  // 已经另起了一列：接着摆在这一列下面（不缩得更小就先摆满这一列）
  const col = [{ x: 370, y: 0, w: 300, h: 300 }];
  const next = columnSlot([...boxes, ...col], { w: 300, h: 200 }, { w: 1180, h: 820 }, { gap, last: col });
  assert.deepEqual(next, { x: 370, y: 370, column: true, start: false });
  // 比这一列宽：左边和这一列对齐，不横着伸到左边那一列底下（伸过去 reflow 会把它推到左边那一列下面）
  assert.equal(columnSlot([...boxes, ...col], { w: 700, h: 200 }, { w: 1180, h: 820 }, { gap, last: col }).x, 370);
});

test('连到整样东西的弧：上下摆着的从上面那一样的下沿连到下面那一样的上沿（不竖着穿过上面那一样）；排成一排的照旧从上沿拱', async () => {
  const { wholeLinkGeom, linkGeom } = await import('../kit/src/stage/layout.js');
  const A = { x: 0, y: 0, w: 200, h: 120 }, B = { x: 40, y: 200, w: 160, h: 120 };
  for (const g of [wholeLinkGeom(A, B), wholeLinkGeom(B, A)]) {
    assert.match(g.d, /^M100 124 C100 160 120 160 120 196$/);
    assert.deepEqual(g.box, { x: 100, y: 124, w: 20, h: 72 });
    assert.ok(!overlaps(g.box, A) && !overlaps(g.box, B), '走的是两样东西中间的空当');
  }
  const C = { x: 300, y: 20, w: 100, h: 100 };
  assert.deepEqual(wholeLinkGeom(A, C), linkGeom(A, C));
});

test('按下去这一处有哪几种按法（pressGroup）：正在等的那一问的点（prio 高）不吃掉低一档的拖——点是那一问，按住再拖、滑是拖的那一个', async () => {
  const { pressGroup } = await import('../kit/src/stage/layout.js');
  const R = (x, y, w, h) => ({ x, y, w, h });
  // 矩阵 M：一格（ask pick 的点，prio 2）、整张的把手（左半张连括号，prio 1，按住再拖）
  const cell = { id: 'cell', prio: 2, rect: R(40, 0, 50, 40), t: { kind: 'tap' } };
  const whole = { id: 'whole', prio: 1, rect: R(0, 0, 100, 100), t: { kind: 'drag', how: 'hold' } };
  const howIds = (g) => [...g.by.entries()].map(([k, c]) => `${k}:${c.id}`).sort().join(' ');
  // 按在括号上（整张的框里，离格子不到 30 像素）：以前那一问的点独吞，现在点是那一格、按住再拖是整张
  assert.equal(howIds(pressGroup({ x: 10, y: 20 }, [cell, whole])), 'hold:whole tap:cell');
  // 按在格子上：点是那一格，按住再拖还是整张（手指按在整张的框里）
  assert.equal(howIds(pressGroup({ x: 60, y: 20 }, [cell, whole])), 'hold:whole tap:cell');
  // 手指不在整张的框里（只是离得近）：照旧只有那一问的点
  assert.equal(howIds(pressGroup({ x: 60, y: -20 }, [cell, whole])), 'tap:cell');
  // 那一问是拖（ask drag，prio 2）、底下是点：照旧那一问独吞（第一轮的手感：按下就拖）
  const dragAsk = { id: 'ask', prio: 2, rect: R(40, 0, 50, 40), t: { kind: 'drag' } };
  const tapLow = { id: 'edit', prio: 1, rect: R(0, 0, 100, 100), t: { kind: 'tap' } };
  assert.equal(howIds(pressGroup({ x: 60, y: 20 }, [dragAsk, tapLow])), 'hold:ask');
  // 同一档、同一个框的几种按法照旧并在一起（句子上又拉又折又挪）
  const w = R(0, 0, 60, 30);
  const g = pressGroup({ x: 20, y: 10 }, [{ id: 's', prio: 1, rect: w, t: { kind: 'drag', how: 'slide' } }, { id: 'f', prio: 1, rect: w, t: { kind: 'tap' } }, { id: 'm', prio: 1, rect: w, t: { kind: 'drag', how: 'hold' } }]);
  assert.equal(howIds(g), 'hold:m slide:s tap:f');
  // 低一档、同一种按法的（也是点）不并进来：那一问的点照旧先
  assert.equal(howIds(pressGroup({ x: 60, y: 20 }, [cell, { id: 'pluck', prio: 1, rect: R(0, 0, 100, 100), t: { kind: 'tap' } }])), 'tap:cell');
  assert.equal(pressGroup({ x: 500, y: 500 }, [cell, whole]), null);
});

test('复审 N1：{…} 里带等号的式子（>= <= == !=）是一个值，不在花括号里的 = 处切成选项；选项照旧在花括号外面第一个 = 处切', () => {
  const words = (l) => tokenize(l).map((t) => (t.t === 'opt' ? `${t.k}=${t.v}` : t.v ?? t.t));
  // 以前切成 opt「{k >」=「 1}」：array 造的那一行被当成写了不认得的选项，matrix 默默丢一格
  assert.deepEqual(tokenize('array vis = {k >= 1} {k == 2} 0').slice(3), [{ t: 'word', v: '{k >= 1}' }, { t: 'word', v: '{k == 2}' }, { t: 'word', v: '0' }]);
  assert.deepEqual(words('matrix R = {k <= 1} {k != 2} / 0 1'), ['matrix', 'R', 'eq', '{k <= 1}', '{k != 2}', '/', '0', '1']);
  assert.deepEqual(words('graph g = A-B:{k == 1} B-C:4'), ['graph', 'g', 'eq', 'A-B:{k == 1}', 'B-C:4']);
  // 选项的值里带等号的式子：名字是花括号外面第一个 = 前面的，值整个留着
  assert.deepEqual(tokenize('ask value "对吗？" answer={k >= 1}').at(-1), { t: 'opt', k: 'answer', v: '{k >= 1}' });
  assert.deepEqual(tokenize('goal g1 "到了" when={rank(A) == 2}').at(-1), { t: 'opt', k: 'when', v: '{rank(A) == 2}' });
  // 花括号外面的照旧：r2=r2-3r1、a=b=c（第一个 = 处切）、单独一个 =
  assert.deepEqual(words('rowop A r2=r2-3r1'), ['rowop', 'A', 'r2=r2-3r1']);
  assert.deepEqual(tokenize('label n a.1 x=b=c').at(-1), { t: 'opt', k: 'x', v: 'b=c' });
  assert.deepEqual(words('dial k = 2'), ['dial', 'k', 'eq', '2']);
  // {…} 后面紧跟着 =（少见）：还是选项，名字是那一对花括号
  assert.deepEqual(tokenize('set {k}=3').at(-1), { t: 'opt', k: '{k}', v: '3' });
});

// —— 舞台主线第一轮 D1-9：只收不判的 ask value，按钮以前也写「对吗」（页面并不判）——
test('D1-9：答题框的按钮：要判的写「对吗」，只收不判的（没写 answer=）写「写好了」，随口说的写「说」', async () => {
  const { askButtonText } = await import('../kit/src/stage/stage.js');
  assert.equal(askButtonText({ kind: 'value', answer: '5' }), '对吗');
  assert.equal(askButtonText({ kind: 'value', answer: null }), '写好了');
  assert.equal(askButtonText({ kind: 'value' }), '写好了');
  assert.equal(askButtonText({ kind: 'say' }), '说');
  assert.equal(askButtonText(null), '说');
});

// —— 舞台主线第一轮：排版检查说真话 ——
test('E1-8：整台缩到 TINY_SCALE 以下算字难认；舞台现状里写出来', async () => {
  const { TINY_SCALE, tooSmall } = await import('../kit/src/stage/layout.js');
  assert.equal(TINY_SCALE, 0.6);
  assert.equal(tooSmall(0.59), true);
  assert.equal(tooSmall(0.6), false);
  assert.equal(tooSmall(1), false);
  const { Scene } = await import('../kit/src/stage/scene.js');
  const { parseScript } = await import('../kit/src/stage/script.js');
  const s = new Scene();
  for (const c of parseScript('array a = 1 2 3')) s.apply(c);
  assert.doesNotMatch(s.stateText(), /字难认/);
  s.tiny = 4;
  assert.match(s.stateText(), /字难认：整台缩到了 4 成才放得下/);
  assert.equal(s.clone().tiny, 4);
});
test('贴的字写了 side=、画面换到了另一边：舞台现状照实写；在写的那一边的照旧', async () => {
  const { Scene } = await import('../kit/src/stage/scene.js');
  const { parseScript } = await import('../kit/src/stage/script.js');
  const s = new Scene();
  for (const c of parseScript('array b = 1 2 3\nlabel rule b "直接插入" side=above\nlabel n b "计数"')) s.apply(c);
  assert.match(s.stateText(), /rule「直接插入」（贴在 b）/);
  s.labels.get('rule').placed = 'below';
  s.labels.get('n').placed = 'right';
  assert.match(s.stateText(), /rule「直接插入」（贴在 b；写的是上面，放不下，在下面）/);
  assert.match(s.stateText(), /n「计数」（贴在 b）/, '没写 side= 的不说');
  s.labels.get('rule').placed = 'above';
  assert.match(s.stateText(), /rule「直接插入」（贴在 b）/);
});

// 舞台（kit/src/stage/，docs/stage-plan.md）不碰 DOM 的部分：动作、排版和镜头、镜头指令的读法
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arcPoints, arcPath, moveDuration, stagger, revealDelays, readHold } from '../kit/src/stage/motion.js';
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
  assert.ok(readHold(2) === 250 && readHold(1000) === 1400);
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

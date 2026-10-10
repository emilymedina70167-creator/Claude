// 课堂 figure 指令用到的图形接口（plot.js 的 figureControls 和三种图的命令计数）里不碰 DOM 的部分。
// 闪烁、动画画面、拖动在真浏览器里另外验（Playwright）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  figureControls, shapeOf, lerpValue, describeValue, round2, sameValue, sliderText, commandList, dragHandles, DRAG_SLOP,
} from '../kit/src/plot.js';
import { PROTOCOL_DOC } from '../kit/src/class/prompt.js';

// scene / graph / space 经 render.js 间接引到 mathinput.js，它在加载时给 document 挂监听：
// 给一个最小的 document 就能在 Node 里只用解析器（compatMode 让 KaTeX 不报怪异模式）
globalThis.document ??= { addEventListener() {}, compatMode: 'CSS1Compat' };
const { parseScene } = await import('../kit/src/scene.js');
const { parseGraph } = await import('../kit/src/graph.js');
const { parseSpace } = await import('../kit/src/space.js');

// —— highlight 的序号：只数命令行，从 1 数 ——

test('scene：字段行、续行、空行、注释、选项行都不算命令', () => {
  const src = [
    'id: fig-b3',
    'title: Ax 落在哪',
    'q: 第一行',
    '  续一行，还是 q 的',
    '',
    'let A = [[1, 1], [2, 2]]   # 注释不影响',
    'let x = [2, -0.5] drag',
    'note: 说明也是字段',
    'line [0, 0] dir [1, 2] color=yellow dashed',
    '- [x] 选项行也不是命令',
    'vector x color=gray label=x',
    'show $A\\mathbf x = {A*x}$',
    'goal A*x = [3, 6]',
  ].join('\n');
  const { fields, cmds } = parseScene(src);
  assert.deepEqual(cmds.map((c) => c.kind), ['let', 'let', 'line', 'vector', 'show', 'goal']);
  assert.equal(cmds[2].srcLine, 'line [0, 0] dir [1, 2] color=yellow dashed'); // highlight 3
  assert.equal(cmds[0].srcLine, 'let A = [[1, 1], [2, 2]]'); // 注释去掉了
  assert.equal(fields.q, '第一行\n  续一行，还是 q 的');
  assert.equal(fields.id, 'fig-b3');
});

test('graph、space：同样只数命令行', () => {
  const g = parseGraph('id: fig-2\ntitle: 正态\nx: -4 4\ny: 0 0.5\nslider mu -2 2 = 0\nlet a = 1 drag\nshade normpdf(x, mu, 1) -inf a\nplot normpdf(x, mu, 1) color=blue\nshow {a}');
  assert.deepEqual(g.cmds.map((c) => c.kind), ['slider', 'let', 'shade', 'plot', 'show']);
  assert.equal(g.cmds[3].srcLine, 'plot normpdf(x, mu, 1) color=blue');
  const s = parseSpace('id: fig-3\ntitle: 平面\nview: -30 20\nlet u = [1, 0, 1]\nlet v = [0, 1, 1]\nspan u, v color=blue\nvector u\nshow {u}');
  assert.deepEqual(s.cmds.map((c) => c.kind), ['let', 'let', 'span', 'vector', 'show']);
  assert.equal(s.cmds[2].srcLine, 'span u, v color=blue');
});

test('PROTOCOL_DOC 里 highlight 的例子和实际计数一致', (t) => {
  // 文档说：fig-b3 里第 N 条是某某命令。从文档里找出 fig-b3 的 scene 和这句话，按解析器数一遍
  //（文档改了写法、不再有这句话时跳过，不拦别人的改动）
  const m = PROTOCOL_DOC.match(/```scene\n(id: fig-b3[\s\S]*?)\n```/);
  const claim = PROTOCOL_DOC.match(/fig-b3 里，?第 (\d+) 条是 `([^`]+)`/);
  if (!m || !claim) return t.skip('文档里没有 fig-b3 的计数说明');
  const { cmds } = parseScene(m[1]);
  assert.ok(cmds[Number(claim[1]) - 1].srcLine.startsWith(claim[2]), `第 ${claim[1]} 条应该是 ${claim[2]}，实际是 ${cmds[Number(claim[1]) - 1].srcLine}`);
});

test('commandList：序号写错时列出每条命令，长的截断', () => {
  const { cmds } = parseScene('let A = [[1, 1], [2, 2]]\nvector A*[1, 1] color=yellow label=Ax\nshow $A\\mathbf x = {A*[1, 1]}$ 这一行很长很长很长很长很长很长很长');
  const s = commandList(cmds, 24);
  assert.equal(s.split('；').length, 3);
  assert.match(s, /^1 let A = \[\[1, 1\], \[2, 2\]\]；2 vector A\*\[1, 1\] color=y…；3 show /);
  assert.ok(s.split('；').every((x) => x.replace(/^\d+ /, '').length <= 24));
});

// —— 值的小工具 ——

test('shapeOf / lerpValue / sameValue / round2', () => {
  assert.equal(shapeOf(2), 'n');
  assert.equal(shapeOf([1, 2]), '[n,n]');
  assert.equal(shapeOf([[1, 2], [3, 4]]), '[[n,n],[n,n]]');
  assert.equal(shapeOf(NaN), null);
  assert.equal(shapeOf([]), null);
  assert.equal(shapeOf([1, 'a']), null);
  assert.equal(lerpValue(0, 1, 0.25), 0.25);
  assert.deepEqual(lerpValue([0, 2], [2, 0], 0.5), [1, 1]);
  assert.deepEqual(lerpValue([[1, 0], [0, 1]], [[2, 1], [1, 2]], 0.5), [[1.5, 0.5], [0.5, 1.5]]);
  // k = 1 时正好是终点（不是 a + (b - a) * 1 的浮点近似）
  assert.equal(lerpValue(0.1, 0.7, 1), 0.7);
  assert.ok(sameValue([1, 2], [1, 2 + 1e-12]));
  assert.ok(!sameValue([1, 2], [1, 2, 3]));
  assert.ok(!sameValue(1, [1]));
  assert.deepEqual(round2([1.005, -0.333333, [2.4449]]), [1, -0.33, [2.44]]);
  assert.equal(round2('x'), 'x');
});

test('describeValue 给报错用的说法', () => {
  assert.equal(describeValue(3), '一个数');
  assert.equal(describeValue([1, 2]), '一个 2 维向量');
  assert.equal(describeValue([[1, 2, 3], [4, 5, 6]]), '一个 2×3 矩阵');
  assert.equal(describeValue([[1], 2]), '一个不是数的值');
  assert.equal(describeValue('a'), '一个不是数的值');
});

test('sliderText：停着写分数，动着写小数', () => {
  assert.equal(sliderText(0.5), '1/2');
  assert.equal(sliderText(0.06), '3/50');
  assert.equal(sliderText(0.06, true), '0.06');
  assert.equal(sliderText(0.2249, true), '0.22');
  assert.equal(sliderText(1), '1');
  assert.equal(sliderText(-0.001, true), '0');
});

// —— figureControls：在 Node 里用一张「假图」跑 ——

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeFigure({ src = 'let A = [[1, 1], [2, 2]]\nlet x = [2, -0.5] drag\nslider t 0 1 = 0\nvector A*x\nshow {t}', extra = {}, locked, dragValue } = {}) {
  const { cmds } = parseScene(src);
  const state = { slider: {}, drag: {}, override: {} };
  cmds.filter((c) => c.kind === 'slider').forEach((c) => (state.slider[c.name] = c.init));
  const env = () => {
    const v = { ...extra, ...state.slider };
    for (const c of cmds) {
      if (c.kind !== 'let') continue;
      if (Object.hasOwn(state.override, c.name)) v[c.name] = state.override[c.name];
      else if (c.mods.drag && Object.hasOwn(state.drag, c.name)) v[c.name] = state.drag[c.name];
      else { v[c.name] = c.expr(v); if (c.mods.drag) state.drag[c.name] = v[c.name]; }
    }
    return v;
  };
  const log = { draws: 0, quiet: [], syncs: [] };
  const root = { isConnected: true, querySelectorAll: () => [] };
  const ctl = figureControls({
    root, cmds, state, extra, env, locked,
    dragValue: dragValue ?? ((name, p) => { if (shapeOf(p) !== '[n,n]') throw new Error(`${name} 要是二维向量`); return p; }),
    draw: () => { log.draws++; log.quiet.push(ctl.quiet); ctl.mark(); },
  });
  for (const c of cmds) if (c.kind === 'slider') c.sync = (moving) => log.syncs.push([state.slider[c.name], moving]);
  try { env(); } catch { /* 有的测试故意写一个算不出来的 let */ }
  return { ctl, state, extra, log, cmds, root };
}

test('play：滑块从 from 动到 to，读数先写小数、最后写分数；Promise 在终点 resolve；重画都是 quiet', async () => {
  const { ctl, state, log } = fakeFigure();
  const p = ctl.play('t', 0, 1, 60);
  assert.ok(p instanceof Promise);
  assert.equal(ctl.vars().t, 1, '动画中 vars 报终值');
  await p;
  assert.equal(state.slider.t, 1);
  assert.deepEqual(log.syncs[0], [0, true]);
  assert.deepEqual(log.syncs.at(-1), [1, false]);
  assert.ok(log.syncs.length >= 3, '中间有几帧');
  assert.ok(log.quiet.every(Boolean), '课堂 Claude 改的值不算学生的操作');
});

test('play：let 变量、外部变量（link 的 t）、向量之间；打断时旧的 Promise 也 resolve', async () => {
  const { ctl, state, extra } = fakeFigure({ extra: { t: 1, step: 0 } });
  await ctl.play('step', 0, 2, 20);
  assert.equal(extra.step, 2);
  await ctl.play('x', [0, 0], [1, 2], 20);
  assert.deepEqual(state.drag.x, [1, 2]);
  const first = ctl.play('t', 0, 1, 1000);
  const second = ctl.play('t', 1, 0, 20);
  await first; // 被第二次打断，也会 resolve，不会挂着
  await second;
  assert.equal(ctl.vars().t, 0);
  // 普通 let：用 override 盖住表达式
  await ctl.play('A', [[1, 0], [0, 1]], [[2, 0], [0, 2]], 20);
  assert.deepEqual(state.override.A, [[2, 0], [0, 2]]);
  assert.deepEqual(ctl.vars().A, [[2, 0], [0, 2]]);
});

test('play 的报错是课堂 Claude 看得懂的中文', () => {
  const { ctl } = fakeFigure();
  assert.throws(() => ctl.play('nope'), /图里没有变量 nope/);
  assert.throws(() => ctl.play(''), /play 要写变量名/);
  assert.throws(() => ctl.play('x'), /x 是一个 2 维向量，play 只能播放数值变量.*set x=/);
  assert.throws(() => ctl.play('t', [0, 0], [1, 1]), /t 是一个数，play 的起点和终点也要是一个数/);
  assert.throws(() => ctl.play('t', 'a', 1), /起点和终点要是数/);
  assert.throws(() => ctl.play('x', [0, 0, 0], [1, 1, 1]), /x 是一个 2 维向量/);
});

test('play 的时长：字符串、负数、0', async () => {
  const { ctl, state } = fakeFigure();
  await ctl.play('t', '0', '0.5', '0');
  assert.equal(state.slider.t, 0.5, '0 毫秒直接跳到终点');
  await ctl.play('t', 0, 0.25, 0);
  assert.equal(state.slider.t, 0.25);
});

test('set：滑块、拖动点、普通 let、外部变量；值不对时报错', async () => {
  const { ctl, state, extra, log } = fakeFigure({ extra: { t2: 0 } });
  await ctl.set('t', 0.4, { ms: 0 });
  assert.equal(state.slider.t, 0.4);
  assert.deepEqual(log.syncs.at(-1), [0.4, false]);
  await ctl.set('x', [1, 1]);
  assert.deepEqual(state.drag.x, [1, 1]);
  await ctl.set('A', [[0, 1], [1, 0]]);
  assert.deepEqual(state.override.A, [[0, 1], [1, 0]]);
  await ctl.set('t2', '3');
  assert.equal(extra.t2, 3);
  assert.throws(() => ctl.set('t', [1, 2]), /滑块 t 要设成一个数/);
  assert.throws(() => ctl.set('x', [1, 2, 3]), /x 要是二维向量/);
  assert.throws(() => ctl.set('A', 'abc'), /A 要设成数、向量或矩阵/);
  assert.throws(() => ctl.set('nope', 1), /图里没有变量 nope/);
  assert.throws(() => ctl.set('', 1), /set 要写变量名/);
  assert.ok(log.quiet.every(Boolean));
});

test('set 形状变了就直接跳（不补间），vars 立刻是新值', async () => {
  const { ctl, state } = fakeFigure();
  const p = ctl.set('A', 5);
  assert.equal(state.override.A, 5);
  assert.equal(ctl.vars().A, 5);
  await p;
});

test('locked：predict 的 guess 课堂 Claude 改不了', () => {
  const { ctl } = fakeFigure({ extra: { guess: [0.5, 0.5], t: 0 }, locked: { guess: 'guess 是学生自己拖的猜测，不能替学生改' } });
  assert.throws(() => ctl.set('guess', [1, 1]), /学生自己拖的猜测/);
  assert.throws(() => ctl.play('guess', 0, 1), /学生自己拖的猜测/);
  assert.deepEqual(ctl.vars().guess, [0.5, 0.5], 'vars 里照样能看到');
});

test('vars：外部变量 + let + 滑块；有的 let 算不出来时至少报滑块和拖动点', () => {
  const { ctl } = fakeFigure({ extra: { step: 1 } });
  assert.deepEqual(ctl.vars(), { step: 1, A: [[1, 1], [2, 2]], x: [2, -0.5], t: 0 });
  const bad = fakeFigure({ src: 'slider k 0 1 = 0.5\nlet B = nope + 1\nvector [k, k]' });
  assert.deepEqual(bad.ctl.vars(), { k: 0.5 });
});

test('animate（▶、link）：不认识的名字当外部变量，不是 quiet', async () => {
  const { ctl, extra, log } = fakeFigure();
  await ctl.animate('u', 0, 1, 20);
  assert.equal(extra.u, 1);
  assert.ok(log.quiet.length && log.quiet.every((q) => q === false));
});

test('highlight：序号检查；不画东西的命令返回 false', () => {
  const { ctl } = fakeFigure();
  assert.equal(ctl.highlight(1), false); // 假图里没有 data-cmd 元素
  assert.equal(ctl.highlight('5'), false);
  for (const bad of [0, -1, 2.5, 'abc', null]) assert.throws(() => ctl.highlight(bad), /highlight 后面要写命令序号/);
  assert.throws(() => ctl.highlight(6), /图里只有 5 条命令，没有第 6 条。只数命令行、从 1 数：1 let A = \[\[1, 1\], \[2, 2\]\]；2 let x = \[2, -0\.5\] drag；3 slider t 0 1 = 0；4 vector A\*x；5 show \{t\}/);
  const empty = fakeFigure({ src: 'title: 空的' });
  assert.throws(() => empty.ctl.highlight(1), /这张图里没有命令/);
});

test('图从页面上拿掉以后，动画直接走到终点、不再重画', async () => {
  const { ctl, state, root, log } = fakeFigure();
  const p = ctl.play('t', 0, 1, 5000);
  root.isConnected = false;
  const before = log.draws;
  await p;
  assert.equal(state.slider.t, 1);
  assert.equal(log.draws, before, '拿掉以后没有再画');
});

test('stop：学生自己动了这个变量，正在放的动画停在当前值', async () => {
  const { ctl, state, log } = fakeFigure();
  const p = ctl.play('t', 0, 1, 2000);
  await sleep(40);
  ctl.stop('t');
  await p;
  assert.ok(state.slider.t < 1);
  assert.equal(log.syncs.at(-1)[1], false, '停下后读数写回分数');
});

// —— 拖动：点一下（没拖出几像素）不算挪动 ——

function fakeSvg() {
  const on = {};
  return {
    on,
    classList: { add() {}, remove() {} },
    setPointerCapture() {},
    addEventListener: (t, f) => (on[t] = f),
    fire(t, x, y, extra = {}) { on[t]({ type: t, pointerId: 1, clientX: x, clientY: y, preventDefault() {}, target: { getAttribute: (k) => (k === 'data-handle' ? 'x' : null) }, ...extra }); },
  };
}

test('dragHandles：moved 只在拖出 DRAG_SLOP 像素后为 true', () => {
  const svg = fakeSvg();
  const calls = [];
  dragHandles(svg, (e) => [e.clientX, e.clientY], (id, pt, phase, moved) => calls.push([phase, moved]));
  svg.fire('pointerdown', 100, 100);
  svg.fire('pointermove', 102, 101);
  svg.fire('pointerup', 102, 101);
  assert.deepEqual(calls, [['start', false], ['move', false], ['end', false]]);
  calls.length = 0;
  svg.fire('pointerdown', 100, 100);
  svg.fire('pointermove', 100 + DRAG_SLOP + 1, 100);
  svg.fire('pointermove', 100, 100); // 拖回原处：仍然算拖过（值有没有变由图自己判断）
  svg.fire('pointerup', 100, 100);
  assert.deepEqual(calls, [['start', false], ['move', true], ['move', true], ['end', true]]);
  // 另一根手指的事件不算
  calls.length = 0;
  svg.fire('pointerdown', 100, 100);
  svg.fire('pointermove', 200, 200, { pointerId: 2 });
  svg.fire('pointerup', 200, 200, { pointerId: 2 });
  assert.deepEqual(calls, [['start', false]]);
  svg.fire('pointercancel', 0, 0);
  assert.deepEqual(calls.at(-1), ['end', false]);
});

// 第九轮 Task 3：底座给学生的反馈（圈的错、点着的、染的色、做到的勾）永远画在老师的样子上面
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitState, importantState, lookStyle, stageStyles } from '../kit/src/stage/look/css.js';

test('splitState：选择器里有状态记号的进 state；@media 整块留着', () => {
  const css = `.st-cell { background: white; }
.st-cell.is-glow { background: gold; box-shadow: 0 0 0 2px red; }
.st-cline[data-paint] { background: pink; }
.st-label.is-key { color: purple; }
@media (max-width: 600px) { .st-goal.is-met { font-size: 15px; } }
/* 注释里有 { 括号 } */
.sn-word.is-slip, .st-cell { outline: 2px dashed red; }`;
  const { base, state } = splitState(css);
  assert.match(state, /\.st-cell\.is-glow/);
  assert.match(state, /\[data-paint\]/);
  assert.match(state, /\.sn-word\.is-slip/);
  assert.doesNotMatch(state, /is-key/, 'is-key 不是状态');
  assert.doesNotMatch(state, /@media/);
  assert.match(base, /@media/);
  assert.match(base, /\.st-label\.is-key/);
});

test('importantState：每一条声明加 !important，已有的不重复加', () => {
  const out = importantState('.a.is-glow { background: gold; box-shadow: 0 0 0 2px red !important }');
  assert.match(out, /background: gold !important;/);
  assert.match(out, /box-shadow: 0 0 0 2px red !important/);
  assert.doesNotMatch(out, /!important !important/);
});

test('lookStyle：属性换成行内样式（颜色走主题变量，不写死）', () => {
  assert.deepEqual(lookStyle({ frame: 'none' }, 'box'), { background: 'transparent', 'box-shadow': 'none', 'border-color': 'transparent', '-webkit-backdrop-filter': 'none', 'backdrop-filter': 'none' });
  const card = lookStyle({ frame: 'card', radius: '8' }, 'box');
  assert.equal(card['border-radius'], '8px');
  assert.match(card.background, /var\(--st-card\)/);
  assert.equal(lookStyle({ color: 'g2' }, 'text').color, 'var(--st-g2)');
  assert.equal(lookStyle({ opacity: '0.5' }, 'box').filter, 'opacity(0.5)');
  assert.equal(lookStyle({ font: 'serif' }, 'text')['font-family'], 'var(--display, serif)');
  assert.deepEqual(lookStyle({ text: '24' }, 'line'), {}, '线不收字号');
});

test('stageStyles：原来的样式 + 状态规则的 important 副本', () => {
  const out = stageStyles('.st-cell { color: black; } .st-cell.is-dim { opacity: .3; }');
  assert.ok(out.indexOf('.st-cell { color: black; }') < out.lastIndexOf('.st-cell.is-dim'));
  assert.match(out, /opacity: \.3 !important/);
});

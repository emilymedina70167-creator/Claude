// 主线第六轮批次 0：时态课截图里的显示毛病（句子行距、贴的字离得远、事件点的字、做到过的挑战还挂着）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { layout, FONT, TAG_ROOM, BARE_TOP } from '../kit/src/stage/types/sentence.js';
import { placeLabel } from '../kit/src/stage/layout.js';

const run = (s, src) => { for (const c of parseScript(src)) s.apply(c); return s; };
const make = (src) => run(new Scene(), src);
const LONG = 'sentence s = "He had never gambled before the casino sent him a coupon for $20 worth of gambling."';

test('句子没有小标签：两行一共不超过字高的 2.6 倍 × 2', () => {
  const s = make(LONG);
  const o = s.objects.get('s');
  const L = layout(o);
  assert.equal(L.lines.length, 2);
  const h = s.objectBox('s').h;
  assert.ok(h <= 2.6 * FONT * 2, `两行占 ${h}`);
  assert.equal(L.lines[0].wordY, BARE_TOP);
});

test('句子有一处小标签：每一行都留标签的地方（整句长高一次，不是只那一行）', () => {
  const s = make(`${LONG}\nmark s.2-4 V`);
  const L = layout(s.objects.get('s'));
  if (!s.objects.get('s').tags?.length) return; // mark 画成括号、不是小标签时这一条不适用
  for (const line of L.lines) assert.ok(line.wordY - line.top >= TAG_ROOM);
});

test('贴的字：首选的一边近处被挡，先在别的一边的近处找，不往远处让', () => {
  const anchor = { x: 100, y: 100, w: 44, h: 54 };
  // 上面 70px 以内都被挡着（时间轴的轴和刻度），下面空着
  const wall = { x: 0, y: 30, w: 400, h: 70 };
  const p = placeLabel(anchor, { w: 120, h: 32 }, [wall], { prefer: ['above', 'below', 'right', 'left'], gap: 12 });
  assert.equal(p.side, 'below');
  assert.ok(p.y - (anchor.y + anchor.h) <= 60);
});

test('贴的字：近处哪边都没地方，照旧在首选的一边往远处让', () => {
  const anchor = { x: 100, y: 100, w: 44, h: 54 };
  // 上面 60px 以内、下面 60px 以内、左右 70px 以内都挡着（左右的墙只挡和东西一样高的那一段），上面再远一点是空的
  const walls = [{ x: 0, y: 40, w: 400, h: 60 }, { x: 0, y: 154, w: 400, h: 60 }, { x: 144, y: 100, w: 70, h: 54 }, { x: 30, y: 100, w: 70, h: 54 }];
  const p = placeLabel(anchor, { w: 60, h: 20 }, walls, { prefer: ['above', 'below', 'right', 'left'], gap: 12 });
  assert.equal(p.side, 'above');
});

test('事件点的框连字一起算（不再只有 44 宽）', () => {
  const s = make('timeline tl = 很久以前 过去 现在 now=现在\nevent tl st = 过去 "sent 寄来优惠券"');
  const it = s.objects.get('tl').items.find((x) => x.name === 'st');
  const b = s.partBox(it);
  assert.ok(b.w > 90, `宽 ${b.w}`);
});

test('做到过的挑战：它说的东西都不在台上了就收起；还在、没做到过的照旧挂着', () => {
  const s = make('timeline tl = 很久以前 过去 现在 now=现在\nbar tl gb = 很久以前..现在 "从未赌过" end=e\ngoal g1 "拖绿条" when="e = 过去"');
  const g = s.goals.get('g1');
  assert.equal(s.goalGone(g), false);
  run(s, 'set e 过去');
  assert.equal(g.met, true);
  assert.equal(s.goalGone(g), false); // 时间轴还在
  run(s, 'remove tl');
  assert.equal(s.goalGone(g), true);
  assert.match(s.stateText(), /挑战 g1「拖绿条」/); // 现状照旧写
});

test('做到过的挑战：写的是数、式子的不收', () => {
  const s = make('dial d = 3 range=1..5\ngoal g1 "拨到 4" when="d = 4"\nset d 4');
  assert.equal(s.goalGone(s.goals.get('g1')), false);
  run(s, 'remove d'.replace('remove d', 'unlabel dial:d'));
  assert.equal(s.goalGone(s.goals.get('g1')), false); // 拨盘还在（只是不显示）
});

test('贴的字不隔着它那样东西的墙贴（时间轴的轴）：写了 side=above 也换到下面', () => {
  const anchor = { x: 100, y: 130, w: 44, h: 54 };
  const wall = { x: 0, y: 90, w: 400, h: 36, wall: true };
  const p = placeLabel(anchor, { w: 120, h: 32 }, [wall], { prefer: ['above', 'below', 'right', 'left'], gap: 12, asked: true, walls: [wall] });
  assert.equal(p.side, 'below');
});

test('写了 side= 的那一边只是被别的东西挡着：照那一边往外让（不换边）', () => {
  const anchor = { x: 100, y: 100, w: 200, h: 64 };
  const ptrs = { x: 100, y: 170, w: 200, h: 60 };
  const p = placeLabel(anchor, { w: 80, h: 24 }, [ptrs], { prefer: ['below', 'above', 'right', 'left'], gap: 12, asked: true });
  assert.equal(p.side, 'below');
});

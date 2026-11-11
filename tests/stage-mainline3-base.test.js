// 舞台主线第三轮 C：底座第二轮留下的条目（docs/stage-gaps.md「留到下一步的」），一条一个测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { eventsText, hasWork } from '../kit/src/stage/events.js';

const run = (s, src, extra = {}) => { for (const c of parseScript(src)) s.apply({ ...c, ...extra }); return s; };
const make = (src) => run(new Scene(), src);

test('第 7 条：watch——只叫老师、不打勾、不给学生看的条件；成立时照挑战那样交出来，写给老师的话不说「做到了挑战」', () => {
  const s = make('tree t = 50 30 tray="60 20"\nopen t insert\nwatch w1 when="count(t) = 3"');
  const g = s.goals.get('w1');
  assert.deepEqual([g.watch, g.call, g.met], [true, 'now', false]);
  assert.match(s.stateText(), /盯着 w1 when="count\(t\) = 3"：还没成立（count\(t\) = 3 ✗）（学生看不到；成立时马上叫你一次）/);
  assert.doesNotMatch(s.stateText(), /挑战 w1/);
  const fx = s.apply(parseScript('insert t 60')[0], { by: 'student', open: 'insert' });
  assert.deepEqual(fx.goalsMet, ['w1']);
  assert.match(s.stateText(), /盯着 w1[^\n]*：成立过/);
  // 写给老师的那一句
  const text = eventsText([{ kind: 'goal', ids: ['w1'], reacted: 0, at: 1 }], { goals: s.goals });
  assert.match(text, /你盯着的 w1 成立了（count\(t\) = 3）/);
  assert.doesNotMatch(text, /做到了挑战|预写/);
  // 不能预写、不能和挑战撞名、要写 when=、不写给学生看的字
  assert.match(dryRun(s, '@w1 say "停"')[0].error, /watch 成立时页面只叫你/);
  assert.match(dryRun(s, 'watch w2')[0].error, /when=/);
  assert.match(dryRun(s, 'watch w2 "给学生看的" when="count(t) = 4"')[0].error, /不写给学生看的字/);
  assert.match(dryRun(s, 'watch w2 when="count(t) = 4" on="就这样"')[0].error, /on=/);
  // 学生手上有没有事不看它（学生不知道有这个条件）
  const p = make('tree t = 50 30 tray="60"\nwatch w1 when="count(t) = 3"');
  assert.equal(hasWork(p).some((x) => /w1/.test(x)), false);
  // ungoal 也收得掉
  run(s, 'ungoal w1');
  assert.equal(s.goals.has('w1'), false);
});

test('第 2 条：手势层当场弹回的那一下（这个世界做不到、翻不成一行指令）也写成一句给老师；放回原处那种不算', async () => {
  const { gestureAct, bounceText } = await import('../kit/src/stage/gestures.js');
  const s = make('tree t = 30 20 40 10\nopen t rotate');
  const o = s.objects.get('t');
  const e = s.opens.get('t:rotate');
  const node = (v) => o.nodes.find((n) => String(n.value) === String(v));
  // 把 40（没有孩子）拖到 30 上想转：转不了
  const ctx = { from: node(10), to: node(30) };
  const r = gestureAct(s, e, ctx);
  assert.ok(r.error);
  const text = bounceText(s, e, ctx, r);
  assert.match(text, /^学生想在 t 上 rotate（按住 t\.\S+（10） 放到 t\.\S+（30））：页面没让做——/);
  assert.ok(text.includes(r.error));
  // 一排格子：拖回原处不是一次尝试，不说
  const a = make('array a = 3 1 2\nopen a move');
  const cell = (k) => a.objects.get('a').cells.find((c) => c.key === k);
  const back = gestureAct(a, a.opens.get('a:move'), { from: cell(1), to: { gap: { row: 0, before: 1 } } });
  assert.equal(back.quiet, true);
  assert.equal(bounceText(a, a.opens.get('a:move'), { from: cell(1), to: { gap: { row: 0, before: 1 } } }, back), null);
  // 空格子拖不动：是一次尝试，说
  const b = make('array h = _ 5\nopen h move');
  const hc = (k) => b.objects.get('h').cells.find((c) => c.key === k);
  const rb = gestureAct(b, b.opens.get('h:move'), { from: hc(1), to: hc(2) });
  assert.match(bounceText(b, b.opens.get('h:move'), { from: hc(1), to: hc(2) }, rb), /学生想在 h 上 move（按住 h\.1（空格子） 放到 h\.2（5））：页面没让做——空格子拖不动/);
  assert.doesNotMatch(text, /[他她]/);
});

test('第 3 条：老师自己写的 compare 的结果写成一句（以前只是动画，老师要自己再比一遍）', async () => {
  const { compareNote } = await import('../kit/src/stage/scene.js');
  const s = make('array a = 49 38 65 97\nmatrix A = 1 2 / 3 4\nmatrix B = 1 2 / 3 5');
  const fx = (src) => s.apply(parseScript(src)[0]);
  assert.equal(compareNote(s, fx('compare a.2 a.4')), '你比了 a.2 和 a.4：38 < 97');
  assert.equal(compareNote(s, fx('compare a.4 a.1')), '你比了 a.4 和 a.1：97 > 49');
  assert.equal(compareNote(s, fx('compare a.1 a.1')), null);
  assert.match(compareNote(s, fx('compare A B')), /^你比了 A 和 B：.*不一样/);
  assert.equal(compareNote(s, {}), null);
});

test('第 4 条：键盘照上一张写下一步（from=）写满时，事实里说是不是阶梯形（和用把手消的那条路一样）', () => {
  const s = make('matrix M0 = 1 2 / 1 0\nmatrix M1 = _ _ / _ _ from=M0 beside=M0\nopen M1 edit input=keypad');
  const w = (ref, v) => s.apply(parseScript(`write ${ref} ${v}`)[0], { by: 'student', open: 'edit' });
  w('M1.1,1', 1); w('M1.1,2', 2); w('M1.2,1', 0);
  const fx = w('M1.2,2', -2);
  assert.match(fx.judged.after.join('；'), /现在是阶梯形了：非零行 2 行/);
  // 写满了还不是阶梯形：照实说还差什么
  const t = make('matrix M0 = 1 2 / 1 0\nmatrix M1 = 1 2 / 1 _ from=M0 beside=M0\nopen M1 edit input=keypad');
  const f2 = t.apply(parseScript('write M1.2,2 0')[0], { by: 'student', open: 'edit' });
  assert.match(f2.judged.after.join('；'), /还不是阶梯形/);
  // 没写满不说；不是照上一张写的（没有 from=）不说
  const u = make('matrix B = _ _ / 0 1\nopen B edit input=keypad');
  u.apply(parseScript('write B.1,1 1')[0], { by: 'student', open: 'edit' });
  const f3 = u.apply(parseScript('write B.1,2 0')[0], { by: 'student', open: 'edit' });
  assert.doesNotMatch((f3.judged?.after || []).join('；'), /阶梯形/);
});

test('第 9 条：平面上点、向量的两个坐标各写一个式子（point p Q = {l} {m}）；一个式子一个数也行；拨了跟着走', () => {
  const s = make('dial l = 2 range=-3..3\ndial m = 1 range=-3..3\nplane p range=-4..4\npoint p Q = {l} {m}\nvec p v = {l + 1} 2');
  const it = (n) => s.objects.get('p').items.find((x) => x.name === n);
  assert.deepEqual([String(it('Q').x), String(it('Q').y), String(it('v').x), String(it('v').y)], ['2', '1', '3', '2']);
  run(s, 'set l -1');
  assert.deepEqual([String(it('Q').x), String(it('v').x)], ['-1', '0']);
  // 写了三个、夹着别的字照旧报，报的话里有两个坐标的写法
  assert.match(dryRun(s, 'point p R = {l} {m} {l}')[0].error, /\{l\} \{m\}/);
  // 整个一个式子照旧
  assert.equal(dryRun(s, 'point p R = {[l, m]}').length, 0);
});

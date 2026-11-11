// 舞台上自己练（黑板组件 stage）不碰 DOM 的那一半：读围栏、取数、拼成镜头指令、先演一遍看这组数成不成
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStageDrill, drawStageDrill } from '../kit/src/stagedrillspec.js';

const SHELL = `id: d-stage-DS-L8.2.3-sort-shell
pick a = seq(8, 1, 99) distinct
---
array a = {a}
follow a sort shell gaps="5 3 1"
open a move`;
// 能复现的随机数
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

test('读得出三部分：编号、取数、镜头指令', () => {
  const sp = parseStageDrill(SHELL);
  assert.equal(sp.id, 'd-stage-DS-L8.2.3-sort-shell');
  assert.equal(sp.tpl.picks.length, 1);
  assert.match(sp.lines, /^array a = \{a\}\nfollow a sort shell/);
  assert.throws(() => parseStageDrill('id: x\npick a = seq(8, 1, 99)'), /「---」/);
});

test('取数：每次不一样，{名字} 换成取到的数；指令里别的 {式子} 不动', () => {
  const sp = parseStageDrill(SHELL);
  const a = drawStageDrill(sp, { rand: seeded(1) }), b = drawStageDrill(sp, { rand: seeded(2) });
  assert.ok(!a.error && !b.error, a.error || b.error);
  assert.match(a.script, /^array a = (\d+ ){7}\d+\nfollow a sort shell gaps="5 3 1"\nopen a move$/);
  assert.notEqual(a.script, b.script);
  const k = drawStageDrill(parseStageDrill('pick a = seq(4, 1, 9) distinct\n---\narray a = {a}\nfollow a sort insert\nopen a move\nsay "第一张是 {a.1}"'), { rand: seeded(3) });
  assert.match(k.script, /say "第一张是 \{a\.1\}"/);
});

test('不取数的题（图）：照原样的指令', () => {
  const g = drawStageDrill(parseStageDrill('id: d-stage-x\n---\ngraph g = 1>2:10 1>5:5 5>2:3\nfollow g net dijkstra from=1\nopen g tag'));
  assert.ok(!g.error, g.error);
  assert.match(g.script, /^graph g = 1>2:10/);
});

test('取到的数一上来就做完、或者引擎不收：换一组；12 组都不成在页面上报，不给一道空题', () => {
  const same = drawStageDrill(parseStageDrill('pick a = seq(3, 5, 5)\n---\narray a = {a}\nfollow a sort insert\nopen a move'), { rand: seeded(1) });
  assert.match(same.error, /取了 12 组数都不成（一上来就已经是做完的样子）/);
  // 小概率取到已经排好的：会自己换一组（两个数、范围很小，试很多个种子都要取得出没排好的）
  for (let i = 1; i <= 20; i++) {
    const d = drawStageDrill(parseStageDrill('pick a = seq(2, 1, 3) distinct\n---\narray a = {a}\nfollow a sort insert\nopen a move'), { rand: seeded(i) });
    assert.ok(!d.error, d.error);
    const [x, y] = d.script.match(/array a = (\d+) (\d+)/).slice(1).map(Number);
    assert.ok(x > y);
  }
});

test('指令写错：说是第几行；没有照引擎走的东西：说要有一行 follow', () => {
  const bad = drawStageDrill(parseStageDrill('pick a = seq(4, 1, 9) distinct\n---\narray a = {a}\nfolow a sort insert\nopen a move'), { rand: seeded(1) });
  assert.match(bad.error, /第 2 行/);
  const none = drawStageDrill(parseStageDrill('pick a = seq(4, 1, 9) distinct\n---\narray a = {a}\nopen a move'), { rand: seeded(1) });
  assert.match(none.error, /要有一行 follow/);
});

test('记结果：一道题 = 走完一遍——走完记一次对；到过错法、看过答案的当时记一次错（一趟只记一次）；没做完就走记放弃', async () => {
  const { trackDrill } = await import('../kit/src/stagedrillspec.js');
  const w = (o) => ({ at: 0, passed: 0, total: 3, done: false, like: null, off: false, ...o });
  // 一遍都对：只在走完时记一条对
  const t = trackDrill(w({}));
  assert.deepEqual(t.after(w({ at: null, off: true })), { records: [], done: false, step: 0 }); // 中间不在路上：不记
  assert.deepEqual(t.after(w({ at: 3, passed: 1 })), { records: [], done: false, step: 1 });
  assert.deepEqual(t.after(w({ at: 5, passed: 2 })).records, []);
  assert.deepEqual(t.after(w({ at: 7, passed: 3, done: true })), { records: [{ k: 3, ok: true, final: true }], done: true, step: 3 });
  assert.equal(t.slips, 0);
  assert.deepEqual(t.giveup(), []); // 做完了再点没有东西可记
  // 第 2 趟做成了错法的样子（来回两次只记一次），第 3 趟看了答案，最后走完：两次错、一次对
  const u = trackDrill(w({}));
  u.after(w({ at: 3, passed: 1 }));
  assert.deepEqual(u.after(w({ at: null, off: true, like: '像是相邻分组', passed: 1 })).records, [{ k: 2, ok: false, wrong: '像是相邻分组' }]);
  assert.deepEqual(u.after(w({ at: null, off: true, like: '像是相邻分组', passed: 1 })).records, []);
  u.after(w({ at: 5, passed: 2 }));
  assert.deepEqual(u.peek(), [{ k: 3, ok: false, wrong: '看了这一趟该是什么样' }]);
  assert.deepEqual(u.peek(), []);
  assert.deepEqual(u.after(w({ at: 7, passed: 3, done: true })).records, [{ k: 3, ok: true, final: true }]);
  assert.equal(u.slips, 2);
  // 没做完就走
  const v = trackDrill(w({}));
  v.after(w({ at: 3, passed: 1 }));
  assert.deepEqual(v.giveup(), [{ k: 2, ok: false, giveup: true }]);
});

test('表的题：有引擎造的表就能出（不用 follow）；记什么——填满全对记一次对；填满有错记一次错、能接着改，改对了算做完；做不出来记放弃', async () => {
  const { trackTableDrill } = await import('../kit/src/stagedrillspec.js');
  const sp = parseStageDrill('id: d-t\n---\ntable T engine=paging algo=fifo frames=3 refs="7 0 1 2"\nopen T edit');
  assert.ok(!drawStageDrill(sp).error);
  assert.match(drawStageDrill(parseStageDrill('id: d-x\n---\ntable T = 1 2 rows="a" cols="x y"')).error, /没有照引擎走的东西/);
  let t = trackTableDrill();
  assert.deepEqual(t.after({ blank: 3, wrong: 1 }), { records: [], done: false, judged: false });
  assert.deepEqual(t.after({ blank: 0, wrong: 0 }), { records: [{ ok: true, final: true }], done: true, judged: true });
  assert.deepEqual(t.after({ blank: 0, wrong: 0 }).records, [], '做完以后不再记');
  t = trackTableDrill();
  assert.deepEqual(t.after({ blank: 0, wrong: 2, first: '块 1×7 写了 5' }), { records: [{ ok: false, wrong: '块 1×7 写了 5' }], done: false, judged: true });
  assert.deepEqual(t.after({ blank: 0, wrong: 1, first: '块 2×0 写了 9' }).records, [], '错只记一次');
  assert.deepEqual(t.after({ blank: 0, wrong: 0 }), { records: [{ ok: true, final: true }], done: true, judged: true });
  assert.equal(t.slips, 1);
  t = trackTableDrill();
  assert.deepEqual(t.giveup(), [{ ok: false, giveup: true }]);
  assert.deepEqual(t.giveup(), []);
});

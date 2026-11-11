// 主线第五轮 · 首课走查里修的（docs/superpowers/specs/2026-11-12-stage-mainline-5-design.md 第 1 节）：一条一个测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
const dryRunErr = (s, src) => dryRun(s, src)[0]?.error || '';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { judge } from '../kit/src/stage/referee.js';
import { eventOf, eventsText, triggers } from '../kit/src/stage/events.js';
import { helpLine } from '../kit/src/stage/stage.js';

const run = (s, src, opt) => { let fx; for (const c of parseScript(src)) fx = s.apply(c, opt); return fx; };
const make = (src) => { const s = new Scene(); run(s, src); return s; };
const stu = (s, src) => s.apply(parseScript(src)[0], { by: 'student', open: 'move' });
const said = (fx) => [...(fx.judged?.facts || []), ...(fx.judged?.after || [])].join('\n');
const SHELL = 'array a = 49 38 65 97 76 13 27 49′ 55 04\nfollow a sort shell gaps="5 3 1"\nopen a move';

test('希尔第 3 趟（d=1）：一张一张插是对的做法，引擎一组只留一步——一趟中间不说「不在引擎走的那条路上」，只说差哪几格', () => {
  const s = make(SHELL);
  for (const x of ['swap a#1 a#6', 'swap a#2 a#7', 'swap a#3 a#8', 'swap a#4 a#9', 'swap a#5 a#10', 'swap a.4 a.7', 'swap a.2 a.5']) stu(s, x);
  assert.match(s.stateText(), /做完了第 2 趟（共 3 趟）/);
  const fx = stu(s, 'move a.2 -> a.1'); // 04 插到最前面
  assert.doesNotMatch(`${said(fx)}\n${s.stateText()}`, /引擎走的那条路/);
  assert.match(said(fx), /和第 3 趟做完该有的样子差 4 格：第 3 格（现在 49′，该是 27）/);
  assert.match(s.stateText(), /a 照 希尔排序（增量 5 3 1） 走：做完了第 2 趟（共 3 趟）；和第 3 趟做完该有的样子差 4 格：第 3 格（现在 49′，该是 27）.*。第 3 趟做完该是：04 13 27 38 49′ 49 55 65 76 97/);
});

test('希尔第 1 趟：先理哪一组都行——照引擎的先后理的那几下也不说「路」', () => {
  const s = make(SHELL);
  const fx = stu(s, 'swap a#1 a#6');
  assert.doesNotMatch(`${said(fx)}\n${s.stateText()}`, /引擎走的那条路/);
  assert.match(said(fx), /离第 1 趟做完差 8 格/);
  assert.match(s.stateText(), /还没做完第 1 趟（共 3 趟）；离第 1 趟做完差 8 格。第 1 趟做完该是/);
});

test('到了一趟（不是最后一趟）：这一下要老师接——裁判交 call=now，事件算要叫老师的；不写「你写了 call=wrong」', () => {
  const s = make(SHELL);
  for (const x of ['swap a#1 a#6', 'swap a#2 a#7', 'swap a#3 a#8', 'swap a#4 a#9']) stu(s, x);
  const c = parseScript('swap a#5 a#10')[0];
  const o = s.objects.get('a');
  const act = s.actOf ? null : null; // 走场景的入口：apply 里过裁判
  const fx = s.apply(c, { by: 'student', open: 'move' });
  assert.equal(fx.judged.verdict.right, true);
  assert.equal(fx.judged.call, 'now');
  const e = eventOf({ type: 'swap', open: 'move', src: 'swap a#5 a#10', call: 'now', reached: true, verdict: fx.judged.verdict, facts: fx.judged.after }, { at: 1 });
  assert.equal(triggers(e), true);
  assert.doesNotMatch(eventsText([e], { goals: s.goals }), /call=wrong/);
  void o; void act; void judge;
});

test('follow … call=done：到一趟不叫，走完才叫（照 done 的老规矩）', () => {
  const s = make('array a = 49 38 65 97 76 13 27 49′ 55 04\nfollow a sort shell gaps="5 3 1" call=done\nopen a move');
  for (const x of ['swap a#1 a#6', 'swap a#2 a#7', 'swap a#3 a#8', 'swap a#4 a#9']) stu(s, x);
  const fx = stu(s, 'swap a#5 a#10');
  assert.equal(fx.judged.verdict.right, true);
  assert.equal(fx.judged.call ?? null, null);
  assert.throws(() => make('array a = 3 1 2\nfollow a sort insert call=wrong'), /call= 只能写 done/);
});

test('一轮没写 ask、没有挑战、学生手上有没做完的东西：页面替挂的按钮是「做好了」，不是「接着」', () => {
  assert.equal(helpLine('', false, true), 'ask next button="做好了"');
  assert.equal(helpLine('', false, false), 'ask next');
  assert.match(helpLine('', true, true), /给个提示/);
});

test('follow … call=done：同名重造以后还记着（不变回每到一趟就叫）', () => {
  const s = make('array a = 3 1 2\nfollow a sort insert call=done\nopen a move\narray a = 4 2 9 1');
  assert.equal(s.objects.get('a').follow.call, 'done');
  const fx = stu(s, 'move a#2 -> a.1');
  assert.equal(fx.judged.verdict.right, true);
  assert.equal(fx.judged.call ?? null, null);
});

test('自己练点「做不出来」：剩下的每一趟该是什么样都写出来（以前只写下一趟，学生看不到完整的答案）', async () => {
  const { restText } = await import('../kit/src/stage/follow.js');
  const s = make(SHELL);
  for (const x of ['swap a#1 a#6', 'swap a#2 a#7', 'swap a#3 a#8', 'swap a#4 a#9', 'swap a#5 a#10']) stu(s, x);
  assert.equal(restText(s.objects.get('a'), s), '第 2 趟做完该是：13 04 49′ 38 27 49 55 65 97 76；第 3 趟做完该是：04 13 27 38 49′ 49 55 65 76 97');
  for (const x of ['swap a.4 a.7', 'swap a.2 a.5', 'move a.2 -> a.1', 'move a.4 -> a.3', 'move a.5 -> a.3', 'move a.10 -> a.9']) stu(s, x);
  assert.equal(restText(s.objects.get('a'), s), '');
});

test('跟着拨盘变的句子：占的地方照最宽最高的那种拨法算——学生拨的时候句子的框不变，拨盘、镜头不在手指下面跑', () => {
  const s = make('dial t = 现在 options="过去 现在 将来"\ndial z = 一般 options="一般 进行 完成 完成进行"\nsentence s = "Railroads {verb: combine | t | z | 复} with each other."');
  const box = () => s.objectBox('s');
  const b0 = box();
  for (const src of ['set z 完成进行', 'set t 将来', 'set z 一般', 'set t 过去']) {
    s.apply(parseScript(src)[0], { by: 'student' });
    assert.deepEqual(box(), b0, src);
  }
  // 不跟着拨盘的句子照旧（框就是它自己的大小）
  const p = make('sentence a = "It works."\nsentence b = "It has been working for years."');
  assert.ok(p.objectBox('a').w < p.objectBox('b').w);
  // rewrite 以后不再跟着拨盘：框回到它自己的大小
  run(s, 'rewrite s "It works."');
  assert.ok(box().w < b0.w);
});

test('时间轴的停靠点少的时候摆开一点：三个停靠点的轴不至于比一句话窄一大截（字和小人太小）', async () => {
  const { stepOf } = await import('../kit/src/stage/types/timeline.js');
  const w = (src) => make(src).objectBox('tl').w;
  assert.equal(stepOf({ stops: new Array(3) }), 220);
  assert.equal(stepOf({ stops: new Array(5) }), 150);
  assert.equal(stepOf({ stops: new Array(8) }), 108);
  assert.equal(stepOf({ stops: new Array(10) }), 108);
  assert.ok(w('timeline tl = 过去 现在 将来 now=现在') >= 540);
  assert.equal(w('timeline tl = 1 2 3 4 5 6 7 8 9 10'), 2 * 54 + 9 * 108); // 十个停靠点照旧
});

test('矩阵有名字：左上角写着它叫什么（跟着算的写式子），不然四张摆在一起学生分不清；name= 能改、能关', async () => {
  const { matrixName } = await import('../kit/src/stage/types/matrix.js');
  const s = make('matrix J = 1 1 / 0 1\nmatrix X = 1 0 / 2 3 beside=J\nmatrix JX = {J X}\nmatrix P = {J^2 - 2 J + 3 I}\ndial k = 2 range=1-5\nmatrix Jk = {J^k}\nmatrix T = {J\'}\nmatrix V = {J^-1}\nmatrix N = 1 {k} / 0 1\nmatrix Q = 1 2 name="α"\nmatrix H = 1 2 name=off');
  const name = (id) => matrixName(s.objects.get(id));
  assert.equal(name('J'), 'J');
  assert.equal(name('X'), 'X');
  assert.equal(name('JX'), 'JX'); // {J X}
  assert.equal(name('P'), 'P = J² − 2J + 3E'); // 老师另起了名字：两样都写
  assert.equal(name('Jk'), 'Jᵏ');
  assert.equal(name('T'), 'T = Jᵀ');
  assert.equal(name('V'), 'V = J⁻¹');
  assert.equal(name('N'), 'N'); // 只有几格跟着算：还是它自己的名字
  assert.equal(name('Q'), 'α');
  assert.equal(name('H'), '');
  // 名字占的地方算在这张矩阵的框里（上面多出一条），关了就没有
  const top = (id) => s.objectBox(id).y - s.objects.get(id).origin.y;
  assert.ok(top('J') <= -18);
  assert.equal(top('H'), 0);
  // 现状里不用另说（老师本来就知道名字）；重造带着
  run(s, 'matrix Q = 3 4');
  assert.equal(name('Q'), 'α');
  assert.match(dryRunErr(s, 'matrix Z = 1 2 name=""'), /name=/);
});

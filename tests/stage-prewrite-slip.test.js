// 预写也收「没做到」「走偏」（@名字.wrong / .miss、@ask.wrong）：只在 prewrite: all 的舞台里（黑板上外部主讲写的 stage 段）。
// 舞台课的老师照旧不收（「走偏以后怎么讲要等你看着学生写」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';

const run = (s, src) => { let fx; for (const c of parseScript(src)) fx = s.apply(c); return fx; };
const make = (all) => { const s = new Scene(); s.prewriteAll = all; return s; };
const stu = (s, line, open) => s.apply(parseScript(line)[0], { by: 'student', open });
const srcs = (fx) => (fx?.reactions || []).map((r) => r.src);

const SORT = `array a = BA B² A² AB _ _ _ _
array k = A² AB BA B² hide=on
open a move
goal g1 "按左右顺序排好" when="a.5 = k.1, a.6 = k.2, a.7 = k.3, a.8 = k.4" on="排好了"
@g1 say "对"
@g1.wrong say "先后再看看：AB 和 BA 不能换"
ask next "排好了点这里" button="排好了"`;

test('默认不收：@g1.wrong、@t.miss、@ask.wrong 照旧报', () => {
  const s = make(false);
  assert.throws(() => run(s, SORT), /不能预写/);
  const t = make(false);
  run(t, 'matrix M = 1 2 / 2 5\nopen M rowop');
  assert.throws(() => run(t, '@M.miss say "x"'), /只能写 done/);
  assert.throws(() => run(t, '@ask.wrong say "x"'), /不能预写/);
});

test('@g1.wrong：按了按钮、判成没做到时演一次；做到了以后拿掉', () => {
  const s = make(true);
  run(s, SORT);
  stu(s, 'swap a#3 a#5', 'move'); stu(s, 'swap a#1 a#6', 'move'); stu(s, 'swap a#4 a#7', 'move'); stu(s, 'swap a#2 a#8', 'move');
  const fx = stu(s, 'press "排好了"');
  assert.deepEqual(fx.goalsMet || [], []);
  assert.deepEqual(srcs(fx), ['say "先后再看看：AB 和 BA 不能换"']);
  // 只演一次
  assert.deepEqual(srcs(stu(s, 'press "排好了"')), []);
  assert.match(s.stateText(), /挑战 g1「按左右顺序排好」/);
  // 换对了再按：做到了
  stu(s, 'swap a#1 a#4', 'move');
  const ok = stu(s, 'press "排好了"');
  assert.deepEqual(ok.goalsMet, ['g1']);
  assert.deepEqual(srcs(ok), ['say "对"']);
});

test('@g1.wrong 要挑战写了 on=；没写的当场说为什么', () => {
  const s = make(true);
  run(s, 'array a = 3 1 2\nopen a move\ngoal g1 "排好" when="a sorted"');
  assert.throws(() => run(s, '@g1.wrong say "x"'), /on=/);
  // .miss 不要 on=
  assert.doesNotThrow(() => run(s, '@g1.miss say "走偏了"'));
  assert.match(s.stateText(), /挑战 g1 还没做到时学生走偏页面马上演你预写的 1 行/);
});

test('@M.wrong / @M.miss：学生做错一步、像哪种错法时演（矩阵的 rowop）', () => {
  const s = make(true);
  run(s, 'matrix M = 1 2 / 2 5\nopen M rowop\n@M.wrong say "这一步不对"\n@M.miss say "像是倍数不对"');
  // r2 - 3r1：倍数不对（像哪种错法）→ .miss
  const fx = stu(s, 'rowop M r2 - 3r1', 'rowop');
  assert.deepEqual(srcs(fx), ['say "像是倍数不对"']);
  assert.match(s.stateText(), /M 学生做错一步页面马上演你预写的 1 行/);
});

test('@M.wrong：没写 .miss 时像错法的那一下也演 .wrong；开着的动作页面不判对错的写 .wrong 当场报', () => {
  const s = make(true);
  run(s, 'matrix M = 1 2 / 2 5\nopen M rowop\n@M.wrong say "这一步不对"');
  assert.deepEqual(srcs(stu(s, 'rowop M r2 - 3r1', 'rowop')), ['say "这一步不对"']);
  const t = make(true);
  run(t, 'array a = 3 1 2\nopen a move');
  assert.throws(() => run(t, '@a.wrong say "x"'), /不判对错/);
  assert.doesNotThrow(() => run(t, '@a.miss say "x"'));
  assert.throws(() => run(make(true), '@zz.miss say "x"'), /舞台上没有/);
});

test('被弹回（wrong=block）：@M.miss 和还没做到的挑战的 @g.miss 一起交出来（舞台演）', () => {
  const s = make(true);
  run(s, 'matrix M = 1 2 / 2 5\nopen M rowop wrong=block\ngoal g1 "消掉左下角" when="M.2,1 = 0"\n@g1.miss say "先消第一列"\n@M.miss say "这一步没让做"');
  const j = s.judgeLine(parseScript('rowop M r2 - 3r1')[0], { by: 'student', open: 'rowop' });
  assert.equal(j.apply, false);
  assert.deepEqual(s.slipReactions('M', j.verdict, { blocked: true }).map((r) => r.src), ['say "这一步没让做"', 'say "先消第一列"']);
  // 用过了：再弹回一次没有了
  assert.deepEqual(s.slipReactions('M', j.verdict, { blocked: true }), []);
});

test('@ask.wrong：下一问拿走（waiting.wrong）；跟着的一问判不了对错时报', () => {
  const s = make(true);
  run(s, 'array a = 3 1 2\n@ask.wrong say "再数一遍"\nask tap a "最小的是哪一个？" expect=a.2');
  assert.deepEqual(s.waiting.wrong, ['say "再数一遍"']);
  assert.equal(s.askRightProblem(), null);
  assert.match(s.stateText(), /学生答错这一问时页面马上演你预写的 1 行/);
  const t = make(true);
  run(t, 'array a = 3 1 2\n@ask.wrong say "再数一遍"\nask next "看一看"');
  assert.match(t.askRightProblem(), /@ask\.wrong 要跟着一个页面判得了对错的 ask/);
});

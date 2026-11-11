// {verb: 原形 | 时间 | 状态 | 主语 | 被动 | 否定}（主线第五轮，设计第 2 节）：页面拼谓语，句子、话、答案跟着拨盘变
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { fillPicks, pickDeps, verbNow, splitPicks } from '../kit/src/stage/pick.js';
import { judgeAnswer } from '../kit/src/stage/answer.js';

const run = (s, src, extra = {}) => { for (const c of parseScript(src)) s.apply({ ...c, ...extra }); return s; };
const make = (src) => run(new Scene(), src);
const wordsOf = (s, id) => [...s.objects.get(id).words].sort((a, b) => a.slot - b.slot).map((w) => w.value).join(' ');
const stu = (s, src) => s.apply(parseScript(src)[0], { by: 'student' });
const DIALS = 'dial t = 现在 options="过去 现在 将来"\ndial z = 一般 options="一般 进行 完成"';

test('直接写词：页面拼出谓语；后面的格可以不写', () => {
  const none = new Map();
  assert.equal(fillPicks('It {verb: go on | 现在 | 完成进行} for years.', none), 'It has been going on for years.');
  assert.equal(fillPicks('{verb: write}', none), 'writes');
  assert.equal(fillPicks('They {verb: write | 过去 | 进行 | 复}.', none), 'They were writing.');
  assert.equal(fillPicks('It {verb: write | 现在 | 完成 | 单 | 被动 | 否定}.', none), 'It has not been written.');
  assert.equal(fillPicks('It {verb: write | 现在 | 一般 | 单 | 否定}.', none), 'It does not write.'); // 第 5 格直接写否定也认
  assert.equal(fillPicks('He {verb: go | must | 完成}.', none), 'He must have gone.');
  assert.deepEqual(pickDeps('{verb: go on | 现在 | 完成进行}'), []);
});

test('句子跟着拨盘变：拨时间、拨状态，谓语重拼；没变的词编号不变；现状里写页面拼的是什么', () => {
  const s = make(`${DIALS}\nsentence s = "She {verb: write | t | z} a letter."`);
  assert.equal(wordsOf(s, 's'), 'She writes a letter');
  assert.deepEqual(pickDeps('She {verb: write | t | z} a letter.'), ['t', 'z']);
  const keys = () => Object.fromEntries(s.objects.get('s').words.map((w) => [w.value, w.key]));
  const k0 = keys();
  stu(s, 'set t 过去');
  assert.equal(wordsOf(s, 's'), 'She wrote a letter');
  stu(s, 'set z 完成');
  assert.equal(wordsOf(s, 's'), 'She had written a letter');
  for (const w of ['She', 'a', 'letter']) assert.equal(keys()[w], k0[w], w);
  assert.match(s.stateText(), /谓语是页面拼的：write，过去 × 完成，主语单数 → had written/);
});

test('主语跟着拨盘走；格子里不能再套一层', () => {
  const s = make('dial who = he options="he they"\ndial t = 现在 options="过去 现在"\nsentence s = "{who: He | They} {verb: write | t | 一般 | who} letters."');
  assert.equal(wordsOf(s, 's'), 'He writes letters');
  stu(s, 'set who they');
  assert.equal(wordsOf(s, 's'), 'They write letters');
  assert.match(dryRun(s, 'say "{verb: write | t | 一般 | {who: 单 | 复}}"')[0].error, /格子里写词或者拨盘的名字/);
});

test('写错的当场报、列出能写的：不认得的时间、主语；拨盘里有页面不认得的词；拼不了的组合', () => {
  const s = make(`${DIALS}\ndial bad = 一般 options="一般 完了"`);
  assert.match(dryRun(s, 'say "{verb: go | past perfect}"')[0].error, /过去 \/ 现在 \/ 将来 \/ 过去将来/);
  assert.match(dryRun(s, 'say "{verb: go | 现在 | 一般 | the boy}"')[0].error, /单 \/ 复/);
  assert.match(dryRun(s, 'sentence q = "It {verb: go | t | bad}."')[0].error, /拨盘 bad 拨到「完了」时[^\n]*一般 \/ 进行 \/ 完成 \/ 完成进行/);
  assert.match(dryRun(s, 'say "{verb: | 现在}"')[0].error, /原形/);
  assert.match(dryRun(s, 'say "{verb: go | 现在 | 一般 | 单 | 被动 | 否定 | 多了}"')[0].error, /最多 6 格/);
});

test('表里没有的不规则动词：现状里说「照规则变的」；老师给了三种形式就照老师的', () => {
  const s = make('sentence s = "It {verb: broadcast | 过去}."');
  assert.equal(wordsOf(s, 's'), 'It broadcasted');
  assert.match(s.stateText(), /谓语是页面拼的：broadcast，过去 × 一般，主语单数 → broadcasted（照规则变）/);
  const s2 = make('sentence s = "It {verb: broadcast/broadcast/broadcast | 过去}."');
  assert.equal(wordsOf(s2, 's'), 'It broadcast');
  assert.doesNotMatch(s2.stateText(), /照规则变/);
  assert.equal(verbNow(splitPicks('{verb: go | 过去}')[0], new Map()).regular, false);
});

test('答案也能用：answer 里写 {verb: …}，页面拼出标准答案照英文比', () => {
  const s = make(`${DIALS}\nsentence s = "That {verb: go on | t | z} for decades."`);
  assert.equal(dryRun(s, 'ask value "现在完成进行怎么写？" answer="{verb: go on | 现在 | 完成进行}" type=en').length, 0);
  run(s, 'ask value "现在完成进行怎么写？" answer="{verb: go on | 现在 | 完成进行}" type=en');
  const spec = { type: 'en', answer: s.waiting.answer };
  assert.equal(judgeAnswer('has been going on', spec, s).ok, true);
  assert.equal(judgeAnswer('have been going on', spec, s).ok, false);
  // 不带引号也行
  assert.equal(dryRun(s, 'ask value "过去完成？" answer={verb: go on | 过去 | 完成} type=en').length, 0);
  assert.match(dryRun(s, 'ask value "？" answer="{verb: go on | 早上}" type=en')[0].error, /过去 \/ 现在 \/ 将来 \/ 过去将来/);
});

test('verb 这个名字留给 {verb: …}：不能造叫 verb 的拨盘', () => {
  assert.match(dryRun(new Scene(), 'dial verb = 1 range=1..3')[0].error, /verb 这个名字留给 \{verb: …\}/);
});

test('时间轴上的小人一拖，写了 {verb: … | 小人的拨盘} 的句子跟着变', () => {
  const s = make('timeline tl = 过去 现在 将来 now=现在\nstand tl me = 现在\nsentence s = "She {verb: write | me} a letter."');
  assert.equal(wordsOf(s, 's'), 'She writes a letter');
  run(s, 'open tl.me move');
  s.apply(parseScript('set me 过去')[0], { by: 'student', open: 'move' }); // 学生拖小人 = set me 过去（时间轴的手势交的就是这一行）
  assert.equal(wordsOf(s, 's'), 'She wrote a letter');
});

test('拨到一般不说的组合（完成进行的被动）：不拦着写——句子里那一段写成「不这样说」，现状里说为什么；标准答案不许是这种', () => {
  const s = make('dial z = 一般 options="一般 完成进行"\ndial v = 主动 options="主动 被动"\nsentence q = "The bridge {verb: build | 现在 | z | 单 | v} by them."');
  assert.equal(wordsOf(s, 'q'), 'The bridge builds by them');
  stu(s, 'set v 被动');
  assert.equal(wordsOf(s, 'q'), 'The bridge is built by them');
  stu(s, 'set z 完成进行');
  assert.equal(wordsOf(s, 'q'), 'The bridge 不这样说 by them');
  assert.match(s.stateText(), /谓语是页面拼的：build，现在 × 完成进行，主语单数，被动 → 拼不出来，画面上写的是「不这样说」（[^\n]*被动一般不用/);
  stu(s, 'set z 一般');
  assert.equal(wordsOf(s, 'q'), 'The bridge is built by them');
  assert.match(dryRun(s, 'ask value "？" answer="{verb: build | 现在 | 完成进行 | 单 | 被动}" type=en')[0].error, /被动一般不用/);
});

test('时间轴上的小人管时间：停靠点是年份也行——在「现在」（now=）之前算过去、之后算将来', () => {
  const s = make('timeline tl = 1800 1830 现在 将来 now=现在\nstand tl me = 现在\nsentence c = "The colonies {verb: become | me | 完成 | 复} independent."');
  assert.equal(wordsOf(s, 'c'), 'The colonies have become independent');
  s.apply(parseScript('set me 1830')[0], { by: 'student', open: 'move' });
  assert.equal(wordsOf(s, 'c'), 'The colonies had become independent');
  assert.match(s.stateText(), /谓语是页面拼的：become，过去（me 在 1830，「现在」之前）× 完成，主语复数 → had become/);
  s.apply(parseScript('set me 将来')[0], { by: 'student', open: 'move' });
  assert.equal(wordsOf(s, 'c'), 'The colonies will have become independent');
  // 没写 now= 的时间轴分不出过去将来：当场报
  const s2 = make('timeline t2 = 1800 1830 1900\nstand t2 you2 = 1830');
  assert.match(dryRun(s2, 'sentence d = "It {verb: go | you2}."')[0].error, /now=/);
});

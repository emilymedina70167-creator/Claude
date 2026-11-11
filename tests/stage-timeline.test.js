// 时间轴（主线第三轮 B）：一排停靠点；小人、事件条能动的那一头就是拨词的拨盘的把手——句子跟着变、挑战里比词都照拨盘的规矩
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { TYPES } from '../kit/src/stage/types/index.js';
import { gestureOf } from '../kit/src/stage/rules.js';

const run = (s, src, extra = {}) => { for (const c of parseScript(src)) s.apply({ ...c, ...extra }); return s; };
const make = (src) => run(new Scene(), src);
const TL = 'timeline tl = 1800 1830 1900 现在 将来 now=现在';
const item = (s, name) => s.objects.get('tl').items.find((x) => x.name === name);
const wordsOf = (s, id) => [...s.objects.get(id).words].sort((a, b) => a.slot - b.slot).map((w) => w.value).join(' ');

test('造：停靠点、now=；写错的当场报', () => {
  const o = make(TL).objects.get('tl');
  assert.deepEqual([o.stops, o.now], [['1800', '1830', '1900', '现在', '将来'], '现在']);
  assert.match(make(TL).stateText(), /时间轴 tl：1800 · 1830 · 1900 · 现在（now） · 将来/);
  assert.match(dryRun(new Scene(), 'timeline tl = 过去')[0].error, /至少两个停靠点/);
  assert.match(dryRun(new Scene(), 'timeline tl = a b a')[0].error, /「a」写了两次/);
  assert.match(dryRun(new Scene(), 'timeline tl = a b now=c')[0].error, /now= 写一个停靠点/);
  assert.match(dryRun(new Scene(), `timeline tl = ${Array.from({ length: 11 }, (_, i) => `s${i}`).join(' ')}`)[0].error, /最多 10 个/);
  assert.match(dryRun(new Scene(), 'timeline tl = k=1 k=2')[0].error, /不是 timeline 认的写法/);
});

test('小人 stand：同时是一个拨词的拨盘；set、{me}、句子跟着、挑战里比词都照拨盘的规矩', () => {
  const s = make(`${TL}\nstand tl me = 1830\nsentence s = "He {me: had gambled | had gambled | had gambled | has gambled | will have gambled} before."`);
  const x = s.vars.get('me');
  assert.deepEqual([x.v, x.options, x.owner, x.shown], [2, ['1800', '1830', '1900', '现在', '将来'], 'tl', false]);
  assert.equal(wordsOf(s, 's'), 'He had gambled before');
  run(s, 'set me 现在');
  assert.equal(wordsOf(s, 's'), 'He has gambled before');
  assert.match(s.stateText(), /小人 me 在 现在/);
  // 不画 ‹ › 的拨数器（把手是轴上的小人）：现状的「能拨的数」里不列
  assert.doesNotMatch(s.stateText(), /能拨的数：[^\n]*me/);
  run(s, 'goal g1 "站到将来" when="me = 将来"');
  const fx = s.apply(parseScript('set me 将来')[0], { by: 'student', open: 'move' });
  assert.deepEqual(fx.goalsMet, ['g1']);
  // 名字撞了、停靠点写错
  assert.match(dryRun(s, 'stand tl me = 1800')[0].error, /已经有叫「me」的/);
  assert.match(dryRun(s, 'stand tl you = 1999')[0].error, /没有「1999」这个停靠点/);
  assert.match(dryRun(s, 'dial me = 1 range=1..3')[0].error, /me 是时间轴 tl 上的/);
});

test('事件点 event、事件条 bar；哪一头能动就给那一头一个拨盘的名字', () => {
  const s = make(`${TL}\nstand tl me = 现在\nevent tl sent = 1830 "sent"\nbar tl war = 1800..1830 "成为独立国家"\nbar tl learn = 1900..现在 "学" end=e`);
  assert.deepEqual([item(s, 'sent').at, item(s, 'war').from, item(s, 'war').to], [2, 1, 2]);
  assert.deepEqual([s.vars.get('e').v, s.vars.get('e').owner], [4, 'tl']);
  const st = s.stateText();
  assert.match(st, /事件点 sent 在 1830「sent」/);
  assert.match(st, /事件条 war：1800 → 1830「成为独立国家」，整条在 me 之前/);
  assert.match(st, /事件条 learn：1900 → 现在「学」（右端是拨盘 e），右端正好到 me/);
  run(s, 'set e 将来');
  assert.match(s.stateText(), /事件条 learn：1900 → 将来「学」（右端是拨盘 e），me 在这一条中间/);
  // 起点不能越过终点
  assert.match(dryRun(s, 'set e 1830')[0].error, /learn 的右端不能在左端（1900）前面/);
  assert.match(dryRun(s, 'bar tl x = 现在..1800 "倒了"')[0].error, /起点（现在）在终点（1800）后面/);
  assert.match(dryRun(s, 'bar tl y = 1800-1830')[0].error, /bar tl y = 1800\.\.1830/);
  // 部件：tl.me、tl.war、tl.sent
  assert.equal(dryRun(s, 'glow tl.war\npaint tl.sent g2\nlabel n tl.me "你站在这里"').length, 0);
  assert.match(dryRun(s, 'glow tl.nobody')[0].error, /时间轴 tl 上没有「nobody」/);
});

test('拨词的拨盘比先后：同一条轴上的两个，或者和一个停靠点比；不是同一条轴的当场报', () => {
  const s = make(`${TL}\nstand tl me = 1900\nbar tl war = 1800..1830 "x" end=e\ndial t = 现在 options="过去 现在 将来"`);
  assert.equal(dryRun(s, 'goal g "x" when="e > me"\ngoal h "y" when="me >= 现在"').length, 0);
  run(s, 'goal g "x" when="e >= me"');
  assert.match(s.stateText(), /g[^\n]*e >= me ✗/);
  const fx = s.apply(parseScript('set e 1900')[0], { by: 'student', open: 'stretch' });
  assert.deepEqual(fx.goalsMet, ['g']);
  assert.match(dryRun(s, 'goal q "x" when="e < 现在"')[0].error, /现在就已经成立/);
  assert.match(dryRun(s, 'goal q "x" when="t < me"')[0].error, /不是同一条轴/);
  // 普通的拨词拨盘比先后也行（照 options 的先后）
  assert.equal(dryRun(s, 'goal q "x" when="t > 现在"').length, 0);
});

test('学生的手：move 把小人拖到一个停靠点上 = set me …；stretch 拖条上能动的那一头 = set e …', () => {
  const s = make(`${TL}\nstand tl me = 1830\nbar tl learn = 1900..现在 "学" end=e\nopen tl.me move\nopen tl.learn stretch`);
  const o = s.objects.get('tl');
  const mv = gestureOf(o, 'move');
  assert.equal(mv.gesture, 'drop-at');
  assert.deepEqual(mv.toAct(o, { from: { stand: 'me' }, to: { stop: 4 }, scene: s }), { act: { type: 'dial', name: 'me', value: '现在', from: '1830' }, src: 'set me 现在' });
  assert.match(mv.toAct(o, { from: { stand: 'me' }, to: { stop: 2 }, scene: s }).error, /还在原处/);
  const stx = gestureOf(o, 'stretch');
  assert.deepEqual(stx.toAct(o, { from: { end: 'learn', side: 'to' }, to: { stop: 5 }, scene: s }), { act: { type: 'dial', name: 'e', value: '将来', from: '现在' }, src: 'set e 将来' });
  assert.match(stx.toAct(o, { from: { end: 'learn', side: 'to' }, to: { stop: 2 }, scene: s }).error, /不能在左端/);
  // 没有能动的头的条：开不了
  const n = make(`${TL}\nbar tl war = 1800..1830 "x"`);
  assert.match(dryRun(n, 'open tl.war stretch')[0].error, /没有能动的一头/);
  assert.match(dryRun(n, 'open tl move')[0].error, /还没有小人/);
});

test('同名重造、拿掉时间轴：它的拨盘跟着没了；克隆、重放一样；例子照抄能演', () => {
  const s = make(`${TL}\nstand tl me = 1830\nbar tl b = 1800..1830 "x" end=e`);
  run(s, 'remove tl');
  assert.deepEqual([s.vars.has('me'), s.vars.has('e')], [false, false]);
  const a = make(`${TL}\nstand tl me = 1830\nset me 现在`);
  run(a, TL);
  assert.equal(a.vars.has('me'), false);
  const src = `${TL}\nstand tl me = 1830\nbar tl b = 1800..1830 "x" end=e\nset me 现在`;
  const x = make(src), y = run(new Scene(), src, { lenient: true, replay: true });
  assert.equal(JSON.stringify(x.objects.get('tl')), JSON.stringify(y.objects.get('tl')));
  assert.equal(JSON.stringify([...x.clone().vars]), JSON.stringify([...x.vars]));
  assert.deepEqual(dryRun(new Scene(), TYPES.timeline.example), []);
  assert.doesNotMatch(TYPES.timeline.doc + TYPES.timeline.hint + TYPES.timeline.example, /[他她]/);
});

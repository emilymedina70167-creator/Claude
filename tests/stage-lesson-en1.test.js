// 第一节真的舞台英语课（时态，2026-11-12）查出来的页面毛病：一条一个测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { pickDeps } from '../kit/src/stage/pick.js';

const run = (s, src, opt) => { let fx; for (const c of parseScript(src)) fx = s.apply(c, opt); return fx; };
const make = (src) => { const s = new Scene(); run(s, src); return s; };
const words = (s, id) => [...s.objects.get(id).words].sort((a, b) => a.slot - b.slot).map((w) => w.value).join(' ');

test('{verb: …} 的主语格写 he / we、时间格写 must：是词，不是拨盘的名字——句子照旧跟着别的拨盘变（课上学生白拨了 26 下）', () => {
  assert.deepEqual(pickDeps('He {verb: move | t | 一般 | he} to Beijing.'), ['t']);
  assert.deepEqual(pickDeps('We {verb: work | 现在 | s | we} hard.'), ['s']);
  assert.deepEqual(pickDeps('It {verb: go | must | z | it}.'), ['z']);
  const s = make('dial t = 过去将来 options="过去 现在 将来 过去将来"\nsentence v = "He {verb: move | t | 一般 | he} to Beijing."');
  assert.equal(words(s, 'v'), 'He would move to Beijing');
  s.apply(parseScript('set t 将来')[0], { by: 'student' });
  assert.equal(words(s, 'v'), 'He will move to Beijing');
  assert.doesNotMatch(s.stateText(), /不再跟着/);
  s.apply(parseScript('set t 过去')[0], { by: 'student' });
  assert.equal(words(s, 'v'), 'He moved to Beijing');
  const s2 = make('dial z = 完成 options="完成 完成进行"\nsentence v = "We {verb: work | 现在 | z | we} hard for months."');
  s2.apply(parseScript('set z 完成进行')[0], { by: 'student' });
  assert.equal(words(s2, 'v'), 'We have been working hard for months');
});

test('老师把 {verb} 用着的拨盘重造成拨数的：报的是人话，不是 JS 的报错', () => {
  const s = make('dial t = 过去 options="过去 现在 将来"\nsentence v = "He {verb: move | t} here."');
  assert.throws(() => run(s, 'dial t = 3'), (e) => !/Cannot read|undefined/.test(e.message) && /句子 v/.test(e.message));
});

test('一次点几样、按了才判的挑战没做到：都记成作答（以前只记成动作，3 次点错没进报告，老师拿它当依据时页面说找不到题）', async () => {
  const { actEvidence } = await import('../kit/src/stage/evidence.js');
  const pick = actEvidence({ type: 'pick', refs: ['e.4', 'e.5'], words: 'has nearly', expected: 'e.4 e.6', same: false, extra: ['e.5'], missing: ['e.6'] }, { comp: 'S75', q: '圈出谓语' });
  assert.deepEqual(pick.records, [{ type: 'stage', block: 'S75', q: '圈出谓语', value: 'has nearly', text: 'e.4 e.5', ok: false }]);
  assert.equal(pick.event, false);
  // 页面没比成的（same 是 null）不记对错
  assert.deepEqual(actEvidence({ type: 'pick', refs: ['e.4'], expected: 'e.4', same: null }, { comp: 'S1' }).records, []);
  const next = actEvidence({ type: 'next', button: '就这样', onGoals: [{ id: 'g1', met: false }] }, { comp: 'S1', goalText: () => '把绿条右端拖到合适的位置' });
  assert.deepEqual(next.records, [{ type: 'stage', block: 'S1', q: '把绿条右端拖到合适的位置', value: 'goal', text: 'g1', ok: false }]);
  // 做到了的由 goal 那边记，这里不重复
  assert.deepEqual(actEvidence({ type: 'next', button: '就这样', onGoals: [{ id: 'g1', met: true }] }, { comp: 'S3' }).records, []);
  // 照旧的几种
  assert.equal(actEvidence({ type: 'tap', expected: true, value: 'papers', ref: 'r.7', right: false }, { comp: 'S8', q: '哪个是谓语' }).records[0].ok, false);
  assert.equal(actEvidence({ type: 'value', text: 'will happen', right: false }, { comp: 'S41', q: '填空' }).records[0].value, 'will happen');
  assert.equal(actEvidence({ type: 'say', text: '嗯' }, { comp: 'S2' }).say, '嗯');
  assert.equal(actEvidence({ type: 'dial', name: 't' }, { comp: 'S2' }).event, true);
});

test('发给老师的每一轮写着这一问的编号（记忆块的依据照抄它）；说明里不再让老师自己数第几轮', async () => {
  const { turnMessage, buildStageSystem } = await import('../kit/src/stage/doc.js');
  assert.match(turnMessage({ act: '学生点了 r.7', state: '（空）', askId: 'S21' }), /^\[学生\]（这一问的编号 S21）\n学生点了 r\.7/);
  assert.match(turnMessage({ act: '', state: '（空）', askId: 'S21' }), /^\[学生\]（这一问的编号 S21） 没有动作/);
  // 样子页（不记证据）照旧
  assert.match(turnMessage({ act: '学生点了 r.7', state: '（空）' }), /^\[学生\]\n学生点了/);
  const sys = buildStageSystem({ pack: {}, memory: { mem: {}, block: 'EN-L1.2.1', space: 'en', session: 'c-1' }, title: '时态', subject: '英语' });
  assert.match(sys, /页面在每一轮 \[学生\] 后面写着「这一问的编号 S5」，照抄它，不要自己数/);
  assert.doesNotMatch(sys, /指第 5 轮最后那个 ask/);
});

// 主线第六轮 B：从 log 推出这节课的几幕（scenes.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneSpans, sceneLine, swappedLine, lookText, sceneOf } from '../kit/src/stage/scenes.js';

const T = (src) => ({ src, by: 'teacher', turn: 1 });

test('没有 scene：一幕，叫课名', () => {
  const log = [T('sentence s = "A b."'), T('say "x"')];
  assert.deepEqual(sceneSpans(log, { title: '时态' }), [{ n: 1, title: '时态', keep: [], start: 0, end: 1, keys: [] }]);
  assert.equal(sceneSpans(log)[0].title, '开头');
});

test('scene 那一行是新一幕的第一行', () => {
  const log = [T('say "a"'), T('sentence s = "A b."'), T('scene "进行时"'), T('say "b"'), T('sentence d = "C d."')];
  const sp = sceneSpans(log);
  assert.equal(sp.length, 2);
  assert.deepEqual([sp[0].start, sp[0].end, sp[1].start, sp[1].end, sp[1].title], [0, 1, 2, 4, '进行时']);
});

test('连写两个 scene、中间什么都没造：没有空幕', () => {
  const log = [T('sentence s = "A b."'), T('scene "a"'), T('say "x"'), T('scene "b"'), T('sentence d = "C d."')];
  assert.deepEqual(sceneSpans(log).map((s) => s.title), ['开头', 'b']);
  assert.equal(sceneSpans(log)[1].start, 1);
});

test('一开课就写 scene：没有「开头」那一幕', () => {
  const log = [T('scene "一般时"'), T('sentence s = "A b."')];
  assert.deepEqual(sceneSpans(log, { title: '时态' }).map((s) => s.title), ['一般时']);
});

test('要点：重点卡改写取最后一次；unlabel 以后照样留', () => {
  const log = [T('sentence s = "A b."'), T('label k s "重点：一" tone=key'), T('label k s "重点：二" side=above tone=key'), T('label n s "注" tone=note'), T('unlabel k')];
  assert.deepEqual(sceneSpans(log)[0].keys, ['重点：二']);
});

test('keep=', () => {
  assert.deepEqual(sceneOf('scene "x" keep=tl').keep, ['tl']);
  assert.deepEqual(sceneOf('scene "x" keep="tl s"').keep, ['tl', 's']);
  assert.deepEqual(sceneOf('scene "x"').keep, []);
  assert.equal(sceneOf('say "scene"'), null);
});

test('学生的行不会是 scene', () => {
  assert.equal(sceneSpans([T('sentence s = "A b."'), { src: 'scene "x"', by: 'student' }]).length, 1);
});

test('现状那一行', () => {
  assert.equal(sceneLine(sceneSpans([T('sentence s = "A b."')])), '');
  const log = [T('sentence s = "A b."'), T('scene "进行时"'), T('sentence d = "C."'), T('scene "现在完成时"'), T('sentence e = "D."'), T('scene "过去完成时"'), T('sentence f = "E."')];
  assert.equal(sceneLine(sceneSpans(log, { title: '一般时' })), '第 4 幕「过去完成时」（前面：① 一般时 ② 进行时 ③ 现在完成时）');
});

test('台上全换了又没写 scene：一句事实', () => {
  assert.match(swappedLine(['s', 'tl'], ['d'], false), /台上的东西这一轮全换了/);
  for (const args of [[['s'], ['s', 'd'], false], [['s'], ['d'], true], [[], ['d'], false], [['s'], [], false]]) assert.equal(swappedLine(...args), '');
});

test('回看过的几幕：一句；同一幕合起来', () => {
  assert.equal(lookText([{ n: 2, title: '进行时', ms: 40000 }]), '学生翻回去看了第 2 幕「进行时」（40 秒）');
  assert.equal(lookText([{ n: 2, title: '进行时', ms: 20000 }, { n: 1, title: '开头', ms: 8000 }, { n: 2, title: '进行时', ms: 20000 }]), '学生翻回去看了第 2 幕「进行时」（40 秒）；第 1 幕「开头」（8 秒）');
  assert.equal(lookText([]), '');
  assert.doesNotMatch(lookText([{ n: 1, title: 'x', ms: 1 }]), /[他她]/);
});

// —— scene 指令（scene.js 的 case 'scene'）——
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';

const run = (s, src) => { for (const c of parseScript(src)) s.apply(c); return s; };
const FULL = `sentence s = "He had never gambled before."
label gl s "gamble 赌博" side=below tone=note
timeline tl = 过去 过去之后 现在 now=现在
stand tl fr = 现在
label lf tl.fr "be free" side=above tone=note
open tl.fr move
array a = 5 3 1 4
follow a sort insert
open a
@a.done say "做完"
keep s "开始"
goal g1 "拖小人" when="fr = 过去之后"
@g1 say "对。"
watch w1 when="fr = 过去"
@ask.right say "对了"
ask tap s "点谓语" expect=s.2`;
// 等着的那一问：scene 收掉它（换问时收旧问的那一种），一串 remove 收不了它——比的时候去掉这几行
const noAsk = (t) => t.split('\n').filter((l) => !/^(最后说的话|在等学生|预写的)/.test(l)).join('\n');

test('scene 和等价的一串 remove / ungoal / unlabel 收的一样', () => {
  const a = run(new Scene(), FULL), b = run(new Scene(), FULL);
  const fx = a.apply(parseScript('scene "下一幕" keep=tl')[0]);
  run(b, 'remove s\nremove a\nungoal\nunlabel gl');
  assert.equal(a.stateText(), noAsk(b.stateText()));
  assert.deepEqual([...a.objects.keys()], ['tl']);
  assert.deepEqual([...a.labels.keys()], ['lf']);
  assert.ok(a.vars.has('fr'));
  assert.equal(a.goals.size, 0);
  assert.equal(a.waiting, null);
  assert.deepEqual([fx.scene, fx.keep, fx.dropped], ['下一幕', ['tl'], ['s', 'a']]);
});

test('scene 不带 keep：台上全收', () => {
  const a = run(new Scene(), FULL);
  run(a, 'scene "下一幕"');
  assert.equal(a.objects.size, 0);
  assert.equal(a.labels.size, 0);
  assert.match(a.stateText(), /舞台上还是空的/);
});

test('scene 写错当场报', () => {
  const s = run(new Scene(), FULL);
  assert.match(dryRun(s, 'scene "x" keep=zz')[0].error, /舞台上没有「zz」/);
  assert.match(dryRun(s, 'scene "x" keep=gl')[0].error, /keep 只能写舞台上的东西/);
  assert.match(dryRun(s, 'scene')[0].error, /scene "这一幕叫什么"/);
  assert.match(dryRun(s, 'scene "x" keap=tl')[0].error, /keep/);
});

// —— 下课的报告里的几幕（memory/report.js，主线第六轮 3.6）——
import { buildReport, REPORT_VERSION } from '../kit/src/memory/report.js';

test('舞台课分了两幕：报告里有两幕的标题和重点卡；一幕的、黑板课的没有', () => {
  const turns = [
    { seq: 1, role: 'claude', log: [{ src: 'sentence s = "A b."', by: 'teacher' }, { src: 'label k s "重点：一" tone=key', by: 'teacher' }] },
    { seq: 2, role: 'student', log: [{ src: 'tap s.1', by: 'student' }] },
    { seq: 3, role: 'claude', log: [{ src: 'scene "进行时"', by: 'teacher' }, { src: 'sentence d = "C."', by: 'teacher' }, { src: 'label k2 d "重点：二" tone=key', by: 'teacher' }] },
    { seq: 4, role: 'claude', discarded: true, log: [{ src: 'scene "作废的"', by: 'teacher' }, { src: 'sentence e = "D."', by: 'teacher' }] },
  ];
  const r = buildReport({ session: { id: 'c-1', title: '时态' }, turns });
  assert.deepEqual(r.scenes, [{ n: 1, title: '时态', keys: ['重点：一'] }, { n: 2, title: '进行时', keys: ['重点：二'] }]);
  assert.equal(buildReport({ session: { id: 'c-1' }, turns: turns.slice(0, 2) }).scenes, undefined);
  assert.equal(buildReport({ session: { id: 'c-1' }, turns: [{ seq: 1, role: 'claude', text: '```board\nnew\n```' }] }).scenes, undefined);
  assert.equal(r.v, REPORT_VERSION); // 版本号没为它加（旧课不重算）
});

test('scene 的写法和舞台演的时候一样认（「」“”、开头的 &）；写成 & scene 也算写了 scene', () => {
  assert.equal(sceneOf('scene 「过去完成时」').title, '过去完成时');
  assert.equal(sceneOf('scene “x” keep=a').keep[0], 'a');
  assert.equal(sceneOf('& scene "x"').title, 'x');
  assert.equal(sceneSpans([T('sentence s = "A b."'), T('scene 「二」'), T('sentence d = "C."')]).length, 2);
});

test('scene keep=：贴在留下的字上的字留着（和一串 remove 一样）', () => {
  const s = run(new Scene(), 'array a = 1 2 3\narray b = 4 5\nlabel k1 a.2 "hi"\nlabel k2 k1 "chain"\nlabel k3 b.1 "走"');
  run(s, 'scene "x" keep=a');
  assert.deepEqual([...s.labels.keys()].sort(), ['k1', 'k2']);
});

test('remove / scene 以后镜头不再对着没了的东西', () => {
  const s = run(new Scene(), 'array a = 1 2 3\ncamera a.2');
  run(s, 'scene "y"');
  assert.equal(s.focus, null);
  const t = run(new Scene(), 'array a = 1 2 3\narray b = 4\ncamera a.2 b.1\nremove a');
  assert.deepEqual(t.focus, ['b.1']);
});

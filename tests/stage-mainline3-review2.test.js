// 舞台主线第三轮：C、D 那几笔的审查（一个只读的助手）抓到的，一条一个测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, compareNote } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { eventsText } from '../kit/src/stage/events.js';
import { gestureAct, bounceText } from '../kit/src/stage/gestures.js';

const run = (s, src, extra = {}) => { let fx; for (const c of parseScript(src)) fx = s.apply({ ...c, ...extra }); return fx; };
const make = (src) => { const s = new Scene(); run(s, src); return s; };
const text = (s, id = 's') => [...s.objects.get(id).words].sort((a, b) => a.slot - b.slot).map((w) => w.value).join(' ');
const stu = (s, src) => s.apply(parseScript(src)[0], { by: 'student', open: 'move' });

test('句首大小写：拖到句首再拖回去，页面替它大写的词改回小写（不靠词表猜）', () => {
  const s = make('sentence s = "It is painful to read today."\nopen s move');
  stu(s, 'move s.3 -> s.1');
  assert.equal(text(s), 'Painful it is to read today');
  stu(s, 'move s.1 after s.3');
  assert.equal(text(s), 'It is painful to read today');
  // 页面大写过的词换了句首再换回来，几趟都对
  const b = make('sentence s = "Sales rose quickly."\nopen s move');
  stu(b, 'move s.3 -> s.1');
  assert.equal(text(b), 'Quickly Sales rose'); // Sales 不在词表里、别处也没有小写的样子：不动（可能是专名）
  stu(b, 'move s.1 after s.3');
  assert.equal(text(b), 'Sales rose quickly');
});

test('句首大小写：本来就是小写开头的片段两头都不动；词里面有大写的（iPhone）不改', () => {
  const f = make('sentence s = "not only did he come"\nopen s move');
  stu(f, 'move s.4 -> s.1');
  assert.equal(text(f), 'he not only did come');
  const p = make('sentence s = "The iPhone sold well."\nopen s move');
  stu(p, 'move s.2 -> s.1');
  assert.equal(text(p), 'iPhone the sold well');
  stu(p, 'move s.1 after s.2');
  assert.equal(text(p), 'The iPhone sold well');
});

test('放回原处不算想做没做成：句子上拎起来没挪开就松手，不给老师记一句', () => {
  const s = make('sentence s = "It is painful to read today."\nopen s move');
  const o = s.objects.get('s'), e = s.opens.get('s:move');
  const w = (k) => o.words.find((x) => x.slot === k);
  for (const after of [2, 3]) {
    const ctx = { from: w(3), to: { gap: { after } } };
    const r = gestureAct(s, e, ctx);
    assert.ok(r.error);
    assert.equal(bounceText(s, e, ctx, r), null);
  }
});

test('watch 成立时页面收了老师挂的按钮：照样说一声（不提「挑战写 on=」）', () => {
  const s = make('array a = 3 1 2\nopen a move\nwatch w1 when="a sorted"');
  const t = eventsText([{ kind: 'goal', ids: ['w1'], reacted: 0, unpressed: '拨好了', at: 1 }], { goals: s.goals });
  assert.match(t, /你盯着的 w1 成立了/);
  assert.match(t, /你挂的「拨好了」学生还没按/);
  assert.doesNotMatch(t, /挑战写 on=/);
});

test('老师的 compare：两边不都是数时不说大小，只说一样不一样', () => {
  const a = make('array a = 2a 10a 5 7 5');
  const say = (src) => compareNote(a, run(a, src));
  assert.match(say('compare a.1 a.2'), /2a ≠ 10a/);
  assert.match(say('compare a.3 a.4'), /5 < 7/);
  assert.match(say('compare a.3 a.5'), /5 = 5/);
  const s = make('sentence s = "The cat sat on the mat."');
  assert.match(compareNote(s, run(s, 'compare s.1 s.2')), /The ≠ cat/);
});

test('手势弹回去的那一句：同样的又试几次数次数，不另记', () => {
  const t = eventsText([{ kind: 'note', text: '学生想在 t 上 rotate：页面没让做——没有右孩子', n: 3, at: 1 }], { goals: new Map() });
  assert.match(t, /页面没让做——没有右孩子（这样试了 3 次）/);
  const one = eventsText([{ kind: 'note', text: '学生想在 t 上 rotate：页面没让做——没有右孩子', at: 1 }], { goals: new Map() });
  assert.doesNotMatch(one, /这样试了/);
});

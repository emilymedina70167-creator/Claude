// 活的舞台：学生做的事哪些马上叫老师、攒下来的怎么写给老师（kit/src/stage/events.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventOf, triggers, eventsText, tryCount, TRY_MAX } from '../kit/src/stage/events.js';

test('哪些马上叫老师：答了问的、点了提示；开放给学生直接动的、拨数是「试」，攒着', () => {
  const help = '给个提示';
  assert.equal(eventOf({ type: 'next', button: help }, { help }).kind, 'help');
  assert.equal(eventOf({ type: 'next', button: '接着' }, { help }).kind, 'answer');
  assert.equal(eventOf({ type: 'value', text: '5', answer: '5', right: true }).kind, 'answer');
  assert.equal(eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit' }).kind, 'try');
  assert.equal(eventOf({ type: 'drag', ref: 'p.u', text: 'x', open: 'drag' }).kind, 'try');
  assert.equal(triggers({ kind: 'try' }), false);
  for (const k of ['answer', 'goal', 'help', 'stuck', 'tries']) assert.equal(triggers({ kind: k }), true);
});

test('写给老师：同一格连着拨的并成一条路，点开看的并成一句，最后是叫老师的那件事', () => {
  const ev = [
    eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit' }),
    eventOf({ type: 'edit', ref: 'B.1,1', from: '2', to: '3', open: 'edit' }),
    eventOf({ type: 'explain', ref: 'C.1,1', open: 'explain' }),
    eventOf({ type: 'edit', ref: 'B.2,2', from: '1', to: '0', open: 'edit' }),
    eventOf({ type: 'explain', ref: 'C.2,1', open: 'explain' }),
    { kind: 'goal', ids: ['g1'], reacted: 2 },
  ];
  const t = eventsText(ev, { goals: new Map([['g1', { text: '让 AB 不再是 O' }]]), secs: 32 });
  assert.equal(t, ['学生拨了 B.1,1：1 → 2 → 3', '学生点开看了 C.1,1、C.2,1 怎么算出来', '学生拨了 B.2,2：1 → 0', '学生做到了挑战 g1「让 AB 不再是 O」（页面已经演了你预写的 2 行）', '（离你上一轮演完过了 32 秒）'].join('\n'));
  assert.equal(tryCount(ev), 5);
  assert.match(eventsText([{ kind: 'tries' }]), new RegExp(`试了 ${TRY_MAX} 下`));
  assert.match(eventsText([{ kind: 'goal', ids: ['g2'], reacted: 0 }]), /你没预写做到以后的行/);
  assert.match(eventsText([eventOf({ type: 'say', text: '为什么换了顺序就不一样' })]), /学生说：「为什么换了顺序就不一样」/);
  assert.doesNotMatch(eventsText([eventOf({ type: 'say', text: 'x' })], { secs: 2 }), /过了/);
});

test('老师做到的挑战：不叫老师，写给老师「不是学生做到的」', () => {
  assert.equal(triggers({ kind: 'goal-by-teacher', ids: ['g1'] }), false);
  const t = eventsText([{ kind: 'goal-by-teacher', ids: ['g1'] }], { goals: new Map([['g1', { text: '让 AB 是 O' }]]) });
  assert.equal(t, '你这一轮让挑战 g1「让 AB 是 O」成立了（不是学生做到的）');
});

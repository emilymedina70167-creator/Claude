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

// —— 裁判的结论、做完了、长度上限（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 5 节）——
const enc = new TextEncoder();
const rot = (k, verdict) => ({ kind: 'try', act: { type: 'rotate', open: 'rotate', src: `rotate t#${k} right`, verdict } });

test('每一下后面跟裁判的结论：不是正确的下一步、像哪种错、正确的是什么；判对的、做不到的、没让做的、没判成的', () => {
  const t = eventsText([rot(1, { legal: true, right: false, misread: '型从下往上读了', why: '50 右旋', next: '在 30 左旋' })]);
  assert.match(t, /不是正确的下一步，像是型从下往上读了；正确的是在 30 左旋/);
  assert.match(t, /rotate t#1 right（50 右旋）/);
  assert.match(eventsText([rot(2, { legal: true, right: true, misread: null, why: '30 左旋', next: null })]), /30 左旋）——是正确的下一步/);
  assert.match(eventsText([{ kind: 'try', act: { type: 'rotate', open: 'rotate', src: 'rotate t#5 right', blocked: true, verdict: { legal: false, right: false, misread: null, why: '35 没有左孩子，右旋转不了', next: null } } }]), /做不到：35 没有左孩子，右旋转不了/);
  assert.match(eventsText([{ kind: 'try', act: { type: 'rotate', open: 'rotate', src: 'rotate t#1 right', blocked: true, verdict: { legal: true, right: false, misread: null, why: '50 右旋', next: '在 30 左旋' } } }]), /wrong=block[^\n]*没让做/);
  assert.match(eventsText([{ kind: 'try', act: { type: 'rotate', open: 'rotate', src: 'rotate t#1 right', marked: true, verdict: { legal: true, right: false, misread: null, why: '50 右旋', next: '在 30 左旋' } } }]), /淡淡圈/);
  assert.match(eventsText([{ kind: 'try', act: { type: 'rotate', open: 'rotate', src: 'rotate t#1 right', failed: true, verdict: { legal: true, right: null, misread: null, why: null, next: null } } }]), /页面这一下没判成/);
  // 这一下以后的事实（规则交的）跟在后面
  assert.match(eventsText([{ kind: 'try', act: { type: 'rotate', open: 'rotate', src: 'rotate t#2 left', facts: ['现在每个结点都平衡了'], verdict: { legal: true, right: true, misread: null, why: '30 左旋', next: null } } }]), /现在每个结点都平衡了/);
  // 不判的（拨格子）照旧
  assert.equal(eventsText([eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit', verdict: { legal: true, right: null, misread: null, why: null, next: null } })]), '学生拨了 B.1,1：1 → 2');
});

test('call=wrong：走偏的那一下马上叫老师；做完了没预写就叫老师，预写了先不叫', () => {
  const e = eventOf({ type: 'rotate', open: 'rotate', src: 'rotate t#1 right', call: 'now', verdict: { legal: true, right: false, why: '50 右旋', next: '在 30 左旋' } });
  assert.equal(e.kind, 'try');
  assert.equal(triggers(e), true);
  assert.match(eventsText([e]), /call=wrong/);
  assert.equal(triggers({ kind: 'done', ids: ['t'], reacted: 0 }), true);
  assert.equal(triggers({ kind: 'done', ids: ['t'], reacted: 1, quiet: true }), false);
  assert.match(eventsText([{ kind: 'done', ids: ['t'], reacted: 0 }]), /学生把 t 做完了[^\n]*你没预写做完以后的行/);
  assert.match(eventsText([{ kind: 'done', ids: ['t'], reacted: 2 }]), /页面已经演了你预写的 2 行/);
  // call=done 的东西：试的那几下不算进「试了好多下」
  assert.equal(tryCount([{ kind: 'try', patient: true }, { kind: 'try' }]), 1);
});

test('长度上限：试了 30 下，[学生] 一块不超过 2 KB，前面的并成「之前又试了 N 下」', () => {
  const ev = Array.from({ length: 30 }, (_, i) => rot(i + 1, { legal: true, right: i % 3 === 0, misread: i % 3 ? '型从下往上读了：从 50 往下看是 LR 型（先在 30 左旋，再在 50 右旋），像是读成了 RL' : null, why: `第 ${i + 1} 个结点 右旋`, next: i % 3 ? '先在 30 左旋（最小不平衡子树的根是 50，LR 型）' : null }));
  ev.push({ kind: 'help', act: { type: 'next', button: '给个提示' } });
  const t = eventsText(ev);
  assert.ok(enc.encode(`[学生]\n${t}`).length <= 2048, `超了：${enc.encode(t).length}`);
  assert.match(t, /之前又试了 \d+ 下/);
  assert.match(t, /rotate t#30 right/, '最近的几下留着细节');
  assert.match(t, /学生点了「给个提示」$/, '叫老师的那件事留着');
  // 不长的不并
  assert.doesNotMatch(eventsText(ev.slice(0, 3)), /之前又试了/);
});

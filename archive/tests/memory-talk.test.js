// 一问一答的课（kind: talk）接进学习台（docs/talk-impl.md A 部分）：哪种课算「课堂里的 Claude 讲的」、
// 写死 'class' 的那几处都认 talk
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTeach, kindOf, SESSION_KINDS, TEACH_KINDS } from '../kit/src/memory/session.js';
import { COLLECTIONS } from '../kit/src/memory/schema.js';
import { validateWrite } from '../kit/src/memory/writer.js';
import { needsDebrief } from '../kit/src/memory/debrief.js';
import { earlierClasses } from '../kit/src/memory/digest.js';
import { tidyDue, TIDY_EVERY } from '../kit/src/memory/memo.js';
import { workOrder } from '../kit/src/memory/sentry.js';
import { healthCheck } from '../kit/src/memory/health.js';
import { classRows, handoffText } from '../kit/src/memory/views.js';
import { itemsOf } from '../kit/src/memory/report.js';

const TODAY = '2026-11-05';
const NOW = Date.parse('2026-11-05T12:00:00+08:00');

test('isTeach：课堂和一问一答是课堂里的 Claude 讲的；实时黑板、自学单元、练习不是；没写 kind 的旧课是课堂', () => {
  assert.equal(SESSION_KINDS.talk, '一问一答');
  assert.deepEqual(TEACH_KINDS, ['class', 'talk', 'stage']);
  assert.equal(kindOf({ kind: 'talk' }), 'talk');
  assert.equal(isTeach({ kind: 'talk' }), true);
  assert.equal(isTeach({ kind: 'class' }), true);
  assert.equal(isTeach({}), true, '以前的课没写 kind');
  assert.equal(isTeach(null), true, 'kindOf 照旧当成课堂');
  for (const k of ['live', 'unit', 'drill']) assert.equal(isTeach({ kind: k }), false, k);
});

test('schema：sessions 的 kind 能写 talk（不然 guardDb 当成不守规矩记进出错记录）', () => {
  assert.ok(COLLECTIONS.sessions.enums.kind.includes('talk'));
  assert.deepEqual(validateWrite('sessions/c-20261105-1', { date: TODAY, status: 'open', kind: 'talk' }), []);
  assert.match(validateWrite('sessions/c-20261105-1', { date: TODAY, status: 'open', kind: 'chat' }).join(), /kind 是「chat」/);
});

test('一问一答的课：复盘、开课先取的以前的课、下课顺带整理、没收尾的课、挂着没下课都算上课', () => {
  const closed = { id: 'c-20261104-1', kind: 'talk', status: 'closed', report: { at: 1, items: 3 } };
  assert.equal(needsDebrief(closed), true);
  assert.equal(needsDebrief({ ...closed, kind: 'live' }), false);

  const sessions = [
    { id: 'c-1', block: 'L2.1.4', startedAt: 1, kind: 'talk' },
    { id: 'c-2', block: 'L2.1.4', startedAt: 2, kind: 'drill' },
    { id: 'c-3', block: 'L2.1.4', startedAt: 3 },
  ];
  assert.deepEqual(earlierClasses(sessions, { session: 'c-3', block: 'L2.1.4' }), ['c-1']);

  const m = { sessions: Array.from({ length: TIDY_EVERY - 1 }, (_, i) => ({ id: `c-2026102${i}-1`, kind: i % 2 ? 'talk' : 'class', status: 'closed', block: 'L2.2.1', date: TODAY })) };
  assert.match(tidyDue(m, 'math', 'c-20261105-1'), /第 5 节/);

  const wo = workOrder({ sessions: [{ id: 'c-a', kind: 'talk', status: 'closed', date: '2026-10-28', space: 'math', report: { items: 5 }, startedAt: NOW - 8 * 86400000 }], evidence: [] }, { today: TODAY, now: NOW, packs: { math: { main: { unit: 'x' } } } });
  assert.deepEqual(wo.filter((x) => x.kind === 'backfill').map((x) => x.ref), ['c-a']);

  const t = NOW - 86400000;
  const { notes } = healthCheck({ sessions: [1, 2, 3].map((i) => ({ id: `c-2026110${i}-1`, date: `2026-11-0${i}`, status: 'open', kind: 'talk', block: 'L2.1.1', space: 'math', startedAt: t })) }, { today: TODAY, now: NOW });
  assert.ok(notes.some((n) => /挂着 3 节/.test(n.msg)));
});

test('以前的课、接手：一问一答单独标出来，没下课的能「接着上课」', () => {
  const m = { sessions: [
    { id: 'c-20261104-1', date: '2026-11-04', kind: 'talk', status: 'closed', block: 'L2.1.1', startedAt: 1, endedAt: 2 },
    { id: 'c-20261105-1', date: TODAY, kind: 'talk', status: 'open', block: 'L2.1.1', startedAt: 3 },
    { id: 'c-20261105-2', date: TODAY, kind: 'live', status: 'open', title: '分块', startedAt: 2 },
  ] };
  const rows = classRows(m);
  assert.deepEqual(rows.map((r) => [r.kind, r.teach]), [['talk', true], ['live', false], ['talk', true]]);
  const h = handoffText(m, { today: TODAY });
  assert.match(h, /上一节：一问一答 c-20261104-1/);
  assert.match(h, /有一节一问一答的课还没下课：c-20261105-1/);
});

test('活板上的「目标」不算对错：作答记录没有 ok 的是一道没判的题（不进掌握）；拨一下不给 block 不成题', () => {
  const ev = [
    { id: 'e1', src: 'record', session: 's', comp: 'L12', kind: 'huoban', sub: 'blank', q: '置换 □ 是奇的', value: '3', ok: false, at: 1 },
    { id: 'e2', src: 'record', session: 's', comp: 'L12', kind: 'huoban', sub: 'blank', q: '置换 □ 是奇的', value: '2', ok: true, at: 2 },
    { id: 'e3', src: 'record', session: 's', comp: 'L14', kind: 'huoban', sub: 'goal', q: '把 n 拨到 5', at: 3 },
    { id: 'e4', src: 'record', session: 's', kind: 'huoban', explore: true, name: 'n', to: 5, at: 4 },
  ];
  const items = itemsOf(ev);
  assert.deepEqual(items.map((it) => [it.comp, it.outcome]), [['L12', 'ok'], ['L14', 'open']]);
});

test('守卫的记录：一问一答那一轮学生看到的字（shown）也算，引的原话找得到', async () => {
  const { buildCorpus, normText } = await import('../kit/src/memory/guard.js');
  const c = buildCorpus({ turns: [{ seq: 2, role: 'claude', text: 'let p = perm(2 1 3)\n这个置换 {p?} 是奇的还是偶的？', shown: '这个置换 (2 1 3) 是奇的还是偶的？' }] });
  assert.ok(c.all.includes(normText('这个置换 (2 1 3) 是奇的还是偶的')));
  assert.ok(c.bySeq.get(2).includes(normText('(2 1 3)')));
});

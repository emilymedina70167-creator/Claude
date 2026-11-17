// 第九轮第 2 批：旁听（kit/src/aide/watch.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WATCH_HEAD, WATCH_KINDS, WATCH_MAX_LINES, WATCH_MAX_BYTES, WATCH_TTL, watchPrompt, parseWatch, watchSection, watchCanStart } from '../kit/src/aide/watch.js';
import { buildCorpus } from '../kit/src/memory/guard.js';

const mem = { errors: [{ id: 'DS-L8-T09', block: 'DS-L8.1.1', mine: '不就是后进先出吗' }], curriculum: [{ id: 'DS-L8.2.1' }] };
const corpora = { 'c-1': buildCorpus({ turns: [{ seq: 3, role: 'student', text: '后进先出' }] }) };

test('读回：种类不认的、出处对不上的丢掉；最多 5 行', () => {
  const text = [
    '以前｜这个错法以前出现过（DS-L8-T09）',
    '建议｜先讲规则',
    '以前｜和 #99 那次一样',
    '考试｜这一步 2012 年考过',
    ...Array.from({ length: 6 }, (_, i) => `以前｜第 ${i} 条（DS-L8-T09）`),
  ].join('\n');
  const r = parseWatch(text, { mem, corpora });
  assert.equal(r.lines.length, WATCH_MAX_LINES);
  assert.equal(r.lines[0].kind, '以前');
  assert.ok(!r.lines.some((l) => /先讲规则|#99/.test(l.text)));
  assert.ok(r.dropped.length >= 2);
  assert.deepEqual(WATCH_KINDS, ['以前', '考试', '讲法']);
});

test('进老师那一轮的一节：过了两轮就扔，不超 1.5 KiB', () => {
  const note = { upTo: 5, lines: [{ kind: '以前', text: '这个错法以前出现过（DS-L8-T09）' }], at: 1 };
  assert.equal(watchSection(note, { seq: 5 + WATCH_TTL + 1 }), '');
  const s = watchSection(note, { seq: 6 });
  assert.match(s, /^\[助手看到的\]（看到第 5 轮为止/);
  assert.match(s, /- 以前：这个错法以前出现过/);
  assert.equal(watchSection(null, { seq: 1 }), '');
  const big = { upTo: 1, lines: Array.from({ length: 5 }, () => ({ kind: '以前', text: '字'.repeat(400) })) };
  assert.ok(new TextEncoder().encode(watchSection(big, { seq: 1 })).length <= WATCH_MAX_BYTES);
});

test('什么时候开：老师在写、提前想在跑、旁听在跑、学生手上没东西可动、下了课都不开', () => {
  const ok = { ended: false, flight: null, spec: null, inFlight: false, canPlay: true };
  assert.equal(watchCanStart(ok), true);
  assert.equal(watchCanStart({ ...ok, flight: {} }), false);
  assert.equal(watchCanStart({ ...ok, spec: {} }), false);
  assert.equal(watchCanStart({ ...ok, inFlight: true }), false);
  assert.equal(watchCanStart({ ...ok, canPlay: false }), false);
  assert.equal(watchCanStart({ ...ok, ended: true }), false);
});

test('提示词：只写发现不写怎么教，不用他她', () => {
  const p = watchPrompt({ recent: '#3【学生】后进先出', pending: '拖了 3 下', brief: '', cards: ['### 学生卡：DS-L8.2.1'], exam: '', upTo: 3 });
  assert.ok(p.startsWith(WATCH_HEAD));
  assert.match(p, /不写.*怎么/);
  assert.ok(!/[他她](?!们)/.test(p));
});

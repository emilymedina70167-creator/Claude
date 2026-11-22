// 2026-11-22：旧课的报告照现在的判法重算（REPORT_VERSION 升到 3），归类没变的不白重做
import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_VERSION, buildReport, reportLine } from '../kit/src/memory/report.js';
import { sameForSkills } from '../kit/src/memory/skills.js';

const ev = (id, at, ok, comp = 'w1') => ({ id, at, session: 's', src: 'record', type: 'widget', comp, q: '题', ok });

test('报告版本是 3：旧版本的课首页打开时会重算', () => {
  assert.equal(REPORT_VERSION, 3);
});

test('11-18 那种课：两道题都是每次都对，重算后写「一次对 2」', () => {
  const r = buildReport({ session: { id: 's' }, evidence: [ev('a', 1, true), ev('b', 2, true), ev('c', 3, true, 'w2'), ev('d', 4, true, 'w2')] });
  assert.deepEqual(r.items.map((it) => it.outcome), ['first', 'first']);
  assert.match(reportLine(r), /一次对 2/);
});

test('sameForSkills：题和结果都没变算同一份，结果变了不算', () => {
  const a = buildReport({ session: { id: 's' }, evidence: [ev('a', 1, true), ev('b', 2, true)] });
  const b = buildReport({ session: { id: 's' }, evidence: [ev('a', 1, true), ev('b', 2, true)], now: 99 });
  assert.equal(sameForSkills(a, b), true);
  const c = buildReport({ session: { id: 's' }, evidence: [ev('a', 1, false), ev('b', 2, true)] });
  assert.equal(sameForSkills(a, c), false);
  const d = buildReport({ session: { id: 's' }, evidence: [ev('a', 1, true), ev('c', 3, true, 'w2')] });
  assert.equal(sameForSkills(a, d), false);
  assert.equal(sameForSkills(null, a), false);
});

// 真题做成练一练的题（kit/src/exam/drillgen.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drillOf } from '../kit/src/exam/drillgen.js';
import { planInbox } from '../kit/src/exam/inbox.js';
import { validateWrite } from '../kit/src/memory/writer.js';

const base = { paper: 'X-408-2019', year: 2019, points: 2, space: 'cs', course: 'OS', tags: { syl: ['G-OS-3.2'], how: 'calc', blocks: ['OS-L3.2.1'] } };
const years = [2024, 2025, 2026];

test('单选 → quiz：选项照原题、对的那个打勾；带题号和块', () => {
  const d = drillOf({ ...base, id: 'Q-408-2019-23', n: 23, type: 'single', stem: '页面置换的说法', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, answer: 'C', analysis: '因为 c' }, { years });
  assert.equal(d.id, 'd-q-408-2019-23');
  assert.equal(d.src, 'exam');
  assert.equal(d.exam, 'Q-408-2019-23');
  assert.equal(d.block, 'OS-L3.2.1');
  assert.equal(d.space, 'cs');
  assert.match(d.md, /^```quiz\nexam: Q-408-2019-23\nq: （2019 年第 23 题）页面置换的说法\n- \[ \] a\n- \[ \] b\n- \[x\] c\n- \[ \] d\nexplain: 因为 c\n```$/);
  assert.deepEqual(validateWrite(`drills/${d.id}`, { ...d, id: undefined }), []);
});

test('填空有验算式 → answer：答案是引擎算出来的值；序列的写 type: seq', () => {
  const d = drillOf({ ...base, id: 'Q-408-2019-26', n: 26, type: 'fill', stem: '缺页几次', answer: '9', check: { expr: 'faults(r, 3, lru)', vars: { r: [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2] } } }, { years });
  assert.match(d.md, /```answer\nexam: Q-408-2019-26\nq: （2019 年第 26 题）缺页几次\nanswer: 9\n```/);
  const s = drillOf({ ...base, id: 'Q-408-2019-27', n: 27, type: 'fill', stem: '换出', answer: '7 0', check: { expr: 'list(victims(r, 3, fifo))', vars: { r: [7, 0, 1, 2] } } }, { years });
  assert.match(s.md, /type: seq/);
});

test('填空没有验算式、答案是数 → quiz 的填空；不是数的不做', () => {
  assert.match(drillOf({ ...base, id: 'Q-408-2019-28', n: 28, type: 'fill', stem: 'x', answer: '12' }, { years }).md, /answer: 12/);
  assert.equal(drillOf({ ...base, id: 'Q-408-2019-29', n: 29, type: 'fill', stem: 'x', answer: '一个说法' }, { years }), null);
});

test('综合题写了 engine → 那个演示组件 mode: fill；没写不做；证明、翻译、作文不做；留着的卷不做', () => {
  const e = drillOf({ ...base, id: 'Q-408-2019-45', n: 45, type: 'comp', points: 8, stem: '页面置换过程', tags: { ...base.tags, engine: { name: 'paging', algo: 'lru', frames: 3, refs: '7 0 1 2 0 3' } } }, { years });
  assert.match(e.md, /^```paging\nexam: Q-408-2019-45\nmode: fill\nq: （2019 年第 45 题）页面置换过程\nalgo: lru\nframes: 3\nrefs: 7 0 1 2 0 3\n```$/);
  assert.equal(drillOf({ ...base, id: 'Q-408-2019-41', n: 41, type: 'comp', stem: 'x' }, { years }), null);
  assert.equal(drillOf({ ...base, id: 'Q-201-2019-46', n: 46, type: 'translate', stem: 'x', answer: 'y' }, { years }), null);
  assert.equal(drillOf({ ...base, id: 'Q-408-2025-23', year: 2025, n: 23, type: 'single', stem: 'x', options: { A: 'a' }, answer: 'A' }, { years }), null);
});

test('收件箱认 drills 这种：写进题库', () => {
  const d = drillOf({ ...base, id: 'Q-408-2019-23', n: 23, type: 'single', stem: 's', options: { A: 'a', B: 'b' }, answer: 'A' }, { years });
  const r = planInbox({ kind: 'drills', drills: [d], by: 'dev', at: 1 }, { have: new Map(), at: 3 });
  assert.equal(r.log.ok, true);
  assert.equal(r.writes[0].path, 'drills/d-q-408-2019-23');
  assert.equal(r.writes[0].data.status, 'active');
  assert.equal(planInbox({ kind: 'drills', drills: [{ id: 'bad id', md: '' }], by: 'dev' }, { have: new Map() }).log.ok, false);
});

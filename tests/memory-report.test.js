// 学习台第 1 批（docs/desk-plan.md 第 3 节）：课后报告、补记和草稿的证据、导出备份、每轮花了多少。
// 课堂里实际走一遍（下课后报告写进 sessions/{编号}/report/main、首页补记、导出）在真浏览器里另外验（desk-demo.html?dev）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildReport, itemKey, activeTime, tagSummary, fitReport, reportLine, IDLE_GAP, REPORT_MAX } = await import('../kit/src/memory/report.js');
const { backupFile, restoreBatches, backupProblem, backupName, BACKUP_FORMAT } = await import('../kit/src/memory/backup.js');
const { usageOf, callCost, usageText, tokenText, approxTokens } = await import('../kit/src/class/usage.js');
const { toEvidence, draftEvidence, manualEvidence, SESSION_SCOPED } = await import('../kit/src/memory/session.js');
const { toAnswer } = await import('../kit/src/live/sync.js');
const { checkMemory } = await import('../kit/src/memory/check.js');
const { sampleMemory } = await import('../kit/src/memory/sample.js');
const { MEMORY_COLLECTIONS } = await import('../kit/src/memory/schema.js');

const SID = 'c-20261027-1';
const T0 = Date.parse('2026-10-27T10:00:00Z');
const min = (n) => T0 + n * 60000;
const ctx = (point, turn) => ({ session: SID, block: 'L2.2.1', point, turn });
let n = 0;
// 课堂里真实的写法：组件的 session.record → toAnswer → toEvidence（和 sync.js 一样）
const rec = (e, at, point = 'tr', turn = 2) => ({ ...toEvidence('record', toAnswer({ ...e, at }), ctx(point, turn)), id: `ev-r${++n}`, at });
const evt = (type, comp, step, detail, at) => ({ ...toEvidence('event', { type, block: comp, step, detail, at }, ctx('tr', 2)), id: `ev-e${++n}`, at });

function lesson() {
  n = 0;
  return [
    // answer：错一次、再对（逐次记录 + 最终结果）
    rec({ type: 'answer', liveOnly: true, title: '求迹', q: '求 tr(A)', value: '3', ok: false, attempts: 1, step: 'b2', block: 'q-b2' }, min(2)),
    rec({ type: 'answer', liveOnly: true, title: '求迹', q: '求 tr(A)', value: '5', ok: true, attempts: 2, step: 'b2', block: 'q-b2' }, min(3)),
    // 手写原图：sync.js 传完图把 asset id 填进 images
    { ...rec({ type: 'answer', final: true, title: '求迹', q: '求 tr(A)', ok: true, attempts: 2, first: '3', last: '5', expected: '5', step: 'b2', block: 'q-b2' }, min(3)), images: ['a1'] },
    // quiz：一次就对（只有一条记录）
    rec({ type: 'quiz', q: 'αβᵀ 的秩', ok: true, attempts: 1, step: 'b3', block: 'qz-b3' }, min(5), 'rank'),
    // steps：第 1 步选对、第 2 步想不出来（record + giveup 事件）、第 3 步只揭开（老师的例题，不算题）
    rec({ type: 'steps', title: '例题', q: '换括号｜先算哪个', detail: '第 1 步', value: 'βᵀα', ok: true, ms: 30000, step: 'b4', block: 'ex-b4' }, min(8)),
    rec({ type: 'steps', title: '例题', q: '写出 Aⁿ｜', detail: '第 2 步', text: '', giveup: true, ms: 90000, step: 'b4', block: 'ex-b4' }, min(10)),
    evt('giveup', 'ex-b4', 'b4', { step: 2, title: '写出 Aⁿ' }, min(10)),
    evt('reveal', 'ex-b4', 'b4', { step: 3, title: '总结' }, min(11)),
    // 一道错了还没改对的（没有最终结果）
    rec({ type: 'answer', liveOnly: true, title: '秩一', q: '求 A²', value: 'ααᵀββᵀ', ok: false, attempts: 1, step: 'b5', block: 'q-b5' }, min(14)),
    // 拖动：不是题
    evt('drag', 'fig-1', 'b1', { name: 't', value: 2 }, min(1)),
    // 说的话、附的图、下课时的草稿
    { id: 'ev-s1', src: 'say', kind: 'say', text: '没懂为什么 βᵀα 是数', images: [], session: SID, block: 'L2.2.1', tags: ['L2.2.1'], turn: 3, at: min(6) },
    { id: 'ev-s2', src: 'say', kind: 'photo', text: '', images: ['img-1'], ink: 1, session: SID, block: 'L2.2.1', tags: ['L2.2.1'], turn: 5, at: min(12) },
    { ...draftEvidence({ step: 'b6', block: 'q-b6', kind: 'answer', title: '求 A³', text: '(3, □)' }, ctx(null, 7)), id: 'ev-d1', at: min(40) },
  ];
}
const sessionDoc = { id: SID, date: '2026-10-27', block: 'L2.2.1', title: '秩一方阵', status: 'closed', startedAt: min(0), endedAt: min(45), summary: 'ob-sum', verify: { turns: 6, discarded: 0 } };
const steps = [{ id: 'b2', page: 1, title: '迹' }, { id: 'b4', page: 2, title: '例题：换括号' }, { id: 'b5', page: 3, title: '秩一' }];
const turns = [
  { seq: 1, role: 'student', at: min(0) },
  { seq: 2, role: 'claude', at: min(1), cost: callCost({ bytes: 120000 }) },
  { seq: 3, role: 'student', at: min(6) },
  { seq: 4, role: 'claude', at: min(7), cost: callCost({ bytes: 130000, tools: 1 }) },
  { seq: 5, role: 'system', kind: 'lint', at: min(7) },
  { seq: 6, role: 'claude', at: min(8), cost: callCost({ bytes: 132000, why: 'lint' }) },
  { seq: 7, role: 'system', kind: 'closing', at: min(45), cost: callCost({ bytes: 140000, why: 'closing' }) },
];

test('itemKey：同一个组件按「第几步」分开，揭开 / 放弃的事件对得上同一步', () => {
  const evs = lesson();
  assert.equal(itemKey(evs[0]), 'q-b2|求 tr(A)');
  assert.equal(itemKey(evs[5]), 'ex-b4|第 2 步');
  assert.equal(itemKey(evs[6]), 'ex-b4|第 2 步');
});

test('课后报告：每道题的尝试序列、结果、所在的段和板、原图', () => {
  const r = buildReport({ session: sessionDoc, evidence: lesson(), turns, steps, now: min(46) });
  const by = Object.fromEntries(r.items.map((it) => [it.key, it]));
  assert.deepEqual(Object.keys(by).sort(), ['ex-b4|第 1 步', 'ex-b4|第 2 步', 'q-b2|求 tr(A)', 'q-b5|求 A²', 'qz-b3|αβᵀ 的秩']);
  const tr = by['q-b2|求 tr(A)'];
  assert.equal(tr.seq, '✗✓');
  assert.equal(tr.outcome, 'ok');
  assert.equal(tr.attempts, 2);
  assert.equal(tr.page, 1);
  assert.equal(tr.segTitle, '迹');
  assert.deepEqual(tr.images, ['a1']);
  assert.equal(tr.last, '5');
  assert.equal(tr.turn, 2);
  assert.equal(by['qz-b3|αβᵀ 的秩'].outcome, 'first');
  assert.equal(by['ex-b4|第 1 步'].outcome, 'first');
  assert.equal(by['ex-b4|第 1 步'].ms, 30000);
  assert.equal(by['ex-b4|第 2 步'].outcome, 'giveup');
  assert.equal(by['q-b5|求 A²'].outcome, 'wrong');
  // 没改对的列进 unfinished；只揭开的第 3 步不算题；拖动不算题
  assert.deepEqual(r.unfinished, ['q-b5|求 A²']);
  assert.equal(r.totals.items, 5);
  assert.equal(r.totals.first, 2);
  // 每条题都能找回证据原文
  assert.deepEqual(tr.evidence, ['ev-r1', 'ev-r2', 'ev-r3']);
});

test('课后报告：按块、按知识点汇总；说的话、附的图、草稿、观察、失误、花费', () => {
  const obs = [{ id: 'ob-1', kind: 'note', text: '换括号卡住', session: SID, turn: 4, at: min(9) }, { id: 'ob-sum', kind: 'summary', text: '小结……', session: SID, at: min(45) }, { id: 'ob-x', kind: 'note', text: '别的课', session: 'c-20261026-1', at: min(1) }];
  const slips = [{ id: 'S-20261027-1-1', by: 'class', text: '一次出了两道题', session: SID }];
  const manual = [{ id: 'ev-m1', src: 'manual', kind: 'manual', text: '纸上做了 3 道', verdict: '错', block: 'L2.2.1', images: [], at: min(-60) }];
  const r = buildReport({ session: sessionDoc, evidence: lesson(), manual, observations: obs, slips, turns, steps, now: min(46) });
  const tags = Object.fromEntries(r.byTag.map((t) => [t.tag, t]));
  assert.equal(tags['L2.2.1'].items, 5);
  assert.equal(tags['L2.2.1#tr'].items, 4);
  assert.equal(tags['L2.2.1#rank'].first, 1);
  assert.equal(tags['L2.2.1#tr'].giveup, 1);
  assert.equal(tags['L2.2.1#tr'].ms, 120000);
  assert.deepEqual(r.says.map((s) => [s.id, s.kind, s.turn]), [['ev-s1', 'say', 3], ['ev-s2', 'photo', 5]]);
  assert.deepEqual(r.says[1].images, ['img-1']);
  assert.deepEqual(r.drafts.map((d) => [d.comp, d.text, d.seg]), [['q-b6', '(3, □)', 'b6']]);
  assert.deepEqual(r.notes.map((x) => x.id), ['ob-1', 'ob-sum']);
  assert.equal(r.summary, 'ob-sum');
  assert.deepEqual(r.slips.map((x) => x.id), ['S-20261027-1-1']);
  assert.deepEqual(r.manual.map((x) => [x.id, x.verdict]), [['ev-m1', '错']]);
  assert.equal(r.usage.calls, 5); // 4 次调用 + 1 次工具轮
  assert.deepEqual(r.usage.extra, { tools: 1, lint: 1 });
  assert.deepEqual(r.verify, { turns: 6, discarded: 0 });
  assert.match(reportLine(r), /题，一次对 2/);
  // 同样的输入出同样的报告
  assert.deepEqual(buildReport({ session: sessionDoc, evidence: lesson(), manual, observations: obs, slips, turns, steps, now: min(46) }), r);
});

test('时长：开课到下课，去掉超过 10 分钟没动静的空档', () => {
  const t = activeTime([min(5), min(8), min(30)], { start: min(0), end: min(32) });
  assert.equal(t.wallMs, 32 * 60000);
  assert.equal(t.gaps, 1); // 8 → 30 分钟这一段
  assert.equal(t.activeMs, 10 * 60000);
  assert.equal(activeTime([], {}).wallMs, 0);
  assert.ok(IDLE_GAP === 10 * 60000);
  const r = buildReport({ session: sessionDoc, evidence: lesson(), turns, steps });
  assert.equal(r.time.wallMs, 45 * 60000);
  assert.equal(r.time.gaps, 1); // 第 14 到第 40 分钟没动静
  assert.equal(r.time.activeMs, 19 * 60000);
});

test('报告太大：先缩短文字，再截掉最早的条目，记下截掉几条', () => {
  const evs = [];
  for (let i = 0; i < 3000; i++) evs.push({ id: `ev-${i}`, src: 'say', kind: 'say', text: '很长的一段话'.repeat(80), images: [], session: SID, at: T0 + i });
  const r = buildReport({ session: sessionDoc, evidence: evs });
  assert.ok(new TextEncoder().encode(JSON.stringify(r)).length <= REPORT_MAX);
  assert.ok(r.more.says > 0);
  assert.equal(r.says.at(-1).id, 'ev-2999'); // 留下的是最近的
  assert.equal(fitReport({ items: [], says: [], notes: [], manual: [], drafts: [] }).more, undefined);
});

test('tagSummary：没打标签的题算在空标签下，排最后', () => {
  const s = tagSummary([{ tags: [], outcome: 'wrong', ms: 0 }, { tags: ['L1.1.1'], outcome: 'first', ms: 5 }]);
  assert.deepEqual(s.map((x) => x.tag), ['L1.1.1', '']);
  assert.equal(s[1].wrong, 1);
});

test('证据：带上第几轮；草稿、补记的证据守记忆库的规矩', () => {
  const e = toEvidence('record', toAnswer({ type: 'answer', ok: true, block: 'q1' }), ctx(null, 4));
  assert.equal(e.turn, 4);
  assert.equal(toEvidence('record', toAnswer({ type: 'answer' }), ctx(null, 0)).turn, undefined);
  const d = draftEvidence({ step: 'b6', block: 'q-b6', kind: 'answer', label: '第 2 步', text: 'x'.repeat(3000) }, ctx('tr', 9));
  assert.equal(d.kind, 'draft');
  assert.equal(d.comp, 'q-b6');
  assert.equal(d.turn, 9);
  assert.ok(d.text.length <= 2000);
  const m = manualEvidence({ text: '纸上做错了', verdict: '错', block: 'L2.2.1' });
  assert.equal(m.src, 'manual');
  assert.equal(m.ok, false);
  assert.deepEqual(m.tags, ['L2.2.1']);
  assert.equal(manualEvidence({ text: '不会', verdict: '不会' }).giveup, true);
  assert.equal(manualEvidence({ images: ['a'] }).verdict, undefined);
  assert.throws(() => manualEvidence({}), /写一句话/);
  // 放进示例记忆里自检：编号、必填、指向的块都对
  const mem = sampleMemory('2026-10-27');
  mem.evidence = [...(mem.evidence || []), d, m].map((x) => ({ ...x, session: null }));
  const res = checkMemory(mem, { today: '2026-10-27' });
  assert.deepEqual(res.problems.filter((p) => p.coll === 'evidence'), []);
  assert.ok(SESSION_SCOPED.includes('report'));
});

test('每轮花了多少：按调用记、工具轮按再发一遍估、多跑的分原因', () => {
  assert.deepEqual(callCost({ bytes: 1000.4, why: 'nope' }), { bytes: 1000, why: 'turn' });
  const u = usageOf(turns);
  assert.equal(u.calls, 5);
  assert.equal(u.bytes, 120000 + 130000 * 2 + 132000 + 140000);
  assert.equal(u.need, 3);
  assert.equal(u.extraCalls, 2);
  assert.equal(u.tokens, approxTokens(u.bytes));
  assert.match(usageText(u), /^调用 Claude 5 轮，共约 23 万 token（每轮平均约 4\.7 万 token）；多跑 2 轮：工具 1、重写 1$/);
  assert.equal(usageText(usageOf([])), '');
  assert.equal(tokenText(2800), '约 1 千 token');
  assert.equal(tokenText(280), '约 100 token');
});

test('导出备份：记忆库每一类、资料包、每节课的报告；可选不带证据、带黑板', () => {
  const mem = sampleMemory('2026-10-27');
  mem.evidence = [{ id: 'ev-1', kind: 'say', at: 1 }];
  const sessions = { [SID]: { pack: [{ id: 'main', unit: 'x' }], report: [{ id: 'main', v: 1 }], steps: [{ id: 'b1', md: 'hi' }], class_turns: [{ id: '000001', seq: 1 }] } };
  const b = backupFile({ memory: mem, pack: { main: { unit: '下一节' } }, sessions, kit: '2026-10-28', today: '2026-10-28', at: 5 });
  assert.equal(b.format, BACKUP_FORMAT);
  assert.equal(backupProblem(b), '');
  const cols = new Set(b.docs.map((d) => d.collection));
  for (const c of MEMORY_COLLECTIONS) if ((mem[c] || []).length) assert.ok(cols.has(c), c);
  assert.ok(cols.has('pack'));
  assert.ok(cols.has(`sessions/${SID}/report`));
  assert.ok(!cols.has(`sessions/${SID}/steps`)); // 默认不带黑板
  assert.equal(b.docs.find((d) => d.collection === 'evidence').doc_id, 'ev-1');
  assert.equal(b.docs[0].data.id, undefined); // id 在 doc_id 里，不重复放进 data
  const nb = backupFile({ memory: mem, sessions, evidence: false, boards: true });
  assert.ok(!nb.docs.some((d) => d.collection === 'evidence'));
  assert.ok(nb.docs.some((d) => d.collection === `sessions/${SID}/class_turns`));
  assert.equal(backupName('2026-10-28'), '学习台备份-20261028.json');
});

test('恢复：按 batch 的限制切批；已经有的带 if_version 或跳过', () => {
  const docs = [];
  for (let i = 0; i < 120; i++) docs.push({ collection: 'evidence', doc_id: `ev-${i}`, data: { kind: 'say', at: i, text: i === 7 ? 'x'.repeat(600 * 1024) : '' } });
  const b = { format: BACKUP_FORMAT, v: 1, docs };
  const batches = restoreBatches(b, { existing: { 'evidence/ev-3': 12 } });
  assert.ok(batches.every((x) => x.length <= 50));
  assert.ok(batches.every((x) => new TextEncoder().encode(JSON.stringify(x)).length < 1024 * 1024));
  assert.equal(batches.flat().length, 120);
  assert.equal(batches.flat().find((w) => w.doc_id === 'ev-3').if_version, 12);
  assert.equal(restoreBatches(b, { existing: { 'evidence/ev-3': 12 }, skipExisting: true }).flat().length, 119);
  assert.throws(() => restoreBatches({ format: 'x' }), /不是学习台的备份/);
});

test('选择题只记最后一次：前面点错的几次补成错；时长不超过开课到下课', () => {
  const evs = [{ ...toEvidence('record', toAnswer({ type: 'quiz', q: 'q', ok: true, attempts: 3, block: 'qz' }), ctx(null, 1)), id: 'ev-q', at: min(2) }];
  const r = buildReport({ session: { ...sessionDoc, startedAt: min(1), endedAt: min(3) }, evidence: evs, turns: [{ seq: 1, role: 'student', at: min(0) }, { seq: 9, role: 'system', at: min(4) }] });
  assert.equal(r.items[0].seq, '✗✗✓');
  assert.equal(r.items[0].outcome, 'ok');
  assert.equal(r.time.activeMs, r.time.wallMs);
  assert.equal(r.time.wallMs, 2 * 60000);
});

test('reportText：下课时给课堂 Claude 的报告，一道题一行带组件 id 和证据 id；太长截掉最早的题', async () => {
  const { reportText } = await import('../kit/src/memory/report.js');
  const r = buildReport({ session: sessionDoc, evidence: lesson(), turns, steps });
  const t = reportText(r);
  assert.match(t, /^## 课后报告（c-20261027-1，块 L2\.2\.1）/);
  assert.match(t, /- q-b2（b2）「求 tr\(A\)」：✗✓ 改对了，最后写的 5；证据 ev-r1,ev-r2,ev-r3/);
  assert.match(t, /没交的草稿：q-b6「\(3, □\)」/);
  assert.match(t, /学生说的话：「没懂为什么 βᵀα 是数」（ev-s1）/);
  const big = { ...r, items: Array.from({ length: 400 }, (_, i) => ({ ...r.items[0], comp: `q-${i}` })) };
  const tb = reportText(big, { max: 4096 });
  assert.ok(new TextEncoder().encode(tb).length <= 4096 + 200);
  assert.match(tb, /只列了最近的/);
  assert.match(tb, /q-399/);
});

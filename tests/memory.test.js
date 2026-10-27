// 学习台的记忆库（docs/learner-memory-spec.md 第 1 批）：分类、谁能写、复现到期、log、自检。不碰 DOM 的部分。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COLLECTIONS, MEMORY_COLLECTIONS, canWrite, assertWrite, isDate, toDate, addDays, daysBetween,
  REVIEW_TIERS, nextTier, reviewDue, dueList, logEntry, applyChange, lastLog,
} from '../kit/src/memory/schema.js';
import { checkMemory, memcheckRecord, fingerprint, LEDGER_HISTORY, FLAG_DAYS } from '../kit/src/memory/check.js';
import { sampleMemory } from '../kit/src/memory/sample.js';

const TODAY = '2026-10-27';
const clone = (x) => JSON.parse(JSON.stringify(x));

// —— 分类和谁能写 ——

test('需求第 2 节的十二类都在，每类一个写入方的规矩照表', () => {
  assert.deepEqual(MEMORY_COLLECTIONS.sort(), ['curriculum', 'errors', 'evidence', 'mastery', 'observations', 'position', 'profile', 'reviews', 'rules', 'sessions', 'slips', 'weaknesses'].sort());
  for (const c of ['rules', 'profile', 'curriculum', 'errors', 'weaknesses', 'mastery', 'reviews', 'position']) assert.deepEqual(COLLECTIONS[c].writers, ['chat'], c);
  assert.deepEqual(COLLECTIONS.evidence.writers, ['page']);
  assert.ok(COLLECTIONS.observations.writers.includes('class'));
  assert.ok(COLLECTIONS.slips.writers.includes('class') && COLLECTIONS.slips.writers.includes('chat'));
  // 历史类只增不改
  for (const c of ['evidence', 'errors', 'observations']) assert.equal(COLLECTIONS[c].kind, 'history', c);
  for (const c of ['weaknesses', 'mastery', 'reviews', 'position']) assert.equal(COLLECTIONS[c].kind, 'state', c);
});

test('canWrite / assertWrite：课堂里的 Claude 只能写观察和自己的失误；改弱点、宣布掌握在代码层面拦住', () => {
  assert.ok(canWrite('class', 'observations'));
  assert.ok(canWrite('class', 'slips'));
  for (const c of ['weaknesses', 'mastery', 'reviews', 'errors', 'rules', 'position', 'evidence', 'profile', 'curriculum']) assert.ok(!canWrite('class', c), c);
  assert.throws(() => assertWrite('class', 'mastery'), /课堂里的 Claude不能写 mastery（掌握状态）.*observations/);
  assert.doesNotThrow(() => assertWrite('chat', 'weaknesses'));
  assert.ok(canWrite('page', 'evidence') && !canWrite('chat', 'evidence'));
  assert.ok(canWrite('page', 'meta') && !canWrite('chat', 'meta') && !canWrite('class', 'meta'));
  // 不在记忆库里的集合（课堂的 steps 之类）不归这里管
  assert.ok(canWrite('class', 'steps'));
});

// —— 日期和复现 ——

test('日期：YYYY-MM-DD，按日历加减，2 月 30 日这种不算', () => {
  assert.ok(isDate('2026-10-27'));
  assert.ok(!isDate('2026-02-30'));
  assert.ok(!isDate('2026/10/27'));
  assert.ok(!isDate(20261027));
  assert.equal(addDays('2026-10-27', 7), '2026-11-03');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02', '夏令时那天也是 1 天');
  assert.equal(daysBetween('2026-10-27', '2026-11-03'), 7);
  assert.equal(toDate('2026-10-27'), '2026-10-27');
  assert.equal(toDate(new Date(2026, 9, 27, 23, 59)), '2026-10-27', '按本地日期');
});

test('复现档位 1 → 3 → 7 → 14 → 30：过了升一档，没过回到 1 天', () => {
  assert.deepEqual(REVIEW_TIERS, [1, 3, 7, 14, 30]);
  assert.equal(nextTier(1, true), 3);
  assert.equal(nextTier(14, true), 30);
  assert.equal(nextTier(30, true), 30);
  assert.equal(nextTier(7, false), 1);
  assert.equal(nextTier(undefined, true), 1, '没写档位：从第一档开始');
});

test('reviewDue：到期 = last + 档位，页面算；没做过就是今天', () => {
  assert.deepEqual(reviewDue({ tier: 3, last: '2026-10-24' }, TODAY), { due: '2026-10-27', days: 0, state: 'today' });
  assert.deepEqual(reviewDue({ tier: 1, last: '2026-10-24' }, TODAY), { due: '2026-10-25', days: -2, state: 'overdue' });
  assert.deepEqual(reviewDue({ tier: 14, last: '2026-10-20' }, TODAY), { due: '2026-11-03', days: 7, state: 'later' });
  assert.deepEqual(reviewDue({ tier: 7 }, TODAY), { due: TODAY, days: 0, state: 'today' });
  assert.match(reviewDue({ tier: 5, last: '2026-10-20' }, TODAY).error, /1 \/ 3 \/ 7 \/ 14 \/ 30/);
  assert.match(reviewDue({ tier: 3, last: '10/20' }, TODAY).error, /YYYY-MM-DD/);
  const list = dueList([{ id: 'R2', tier: 30, last: '2026-10-01' }, { id: 'R1', tier: 1, last: '2026-10-20' }, { id: 'R9', tier: 3, status: 'done' }, { id: 'R5', tier: 2 }], TODAY);
  assert.deepEqual(list.map((x) => [x.id, x.days]), [['R1', -6], ['R2', 4]], '过期的在前；停掉的、写错的不列');
});

// —— log ——

test('applyChange：改了的字段各记一条 log（谁改的、从什么到什么、依据），没改的不记，原文档不动', () => {
  const w = { id: 'W19', level: 'L1', scope: '链条', log: [{ date: '2026-10-01', by: 'chat', field: 'level', from: null, to: 'L1', basis: ['L2-07'] }] };
  const n = applyChange(w, { level: 'L0', scope: '链条' }, { date: TODAY, by: 'chat', basis: ['ev-12', 'ev-13'], note: '连着两次对' });
  assert.equal(n.level, 'L0');
  assert.equal(n.log.length, 2);
  assert.deepEqual(n.log[1], { date: TODAY, by: 'chat', field: 'level', from: 'L1', to: 'L0', basis: ['ev-12', 'ev-13'], note: '连着两次对' });
  assert.equal(w.log.length, 1, '原来的不变');
  assert.equal(lastLog(n, 'level').to, 'L0');
  assert.equal(lastLog(n, 'scope'), undefined);
  assert.deepEqual(logEntry({ date: '2026-10-27', by: 'chat', field: 'tier', from: 1, to: 3 }), { date: '2026-10-27', by: 'chat', field: 'tier', from: 1, to: 3, basis: [] });
});

// —— 自检 ——

test('示例记忆一处错都没有；计数、到期都对', () => {
  const r = checkMemory(sampleMemory(TODAY), { today: TODAY });
  assert.deepEqual(r.problems, []);
  assert.equal(r.counts.reviews, 3);
  assert.equal(r.counts.evidence, 0);
  assert.deepEqual(r.due.map((d) => [d.id, d.days]), [['R3', -1], ['R4', 0], ['R5', 5]]);
  const rec = memcheckRecord(r, { kit: 'v', today: TODAY });
  assert.equal(rec.ok, true);
  assert.equal(rec.id, 'memcheck');
  assert.deepEqual(rec.problems, []);
});

test('编号、必填、只能取的值、日期、找不到的 id 都报', () => {
  const m = sampleMemory(TODAY);
  m.weaknesses.push({ id: 'w20', title: 'x', scope: '全局', level: 'L4', errors: ['L2-99'], last: '昨天' });
  m.errors.push({ id: 'L2-08', source: 's', q: 'q', mine: 'm', step: 's', cause: 'c', date: TODAY });
  m.errors[1].cause = '';
  m.reviews.push({ id: 'R6', title: 't', tier: 3, due: TODAY });
  const msgs = checkMemory(m, { today: TODAY }).problems.map((p) => `${p.coll}/${p.id}：${p.msg}${p.soft ? '（提醒）' : ''}`);
  assert.ok(msgs.includes('weaknesses/w20：编号「w20」不对：弱点表的编号像 W19'));
  assert.ok(msgs.includes('weaknesses/w20：scope 只能是 通用 / 链条 / 局部，现在是「全局」'));
  assert.ok(msgs.includes('weaknesses/w20：level 只能是 L0 / L1 / L2 / L3，现在是「L4」'));
  assert.ok(msgs.includes('weaknesses/w20：last 要写成 YYYY-MM-DD，现在是「昨天」'));
  assert.ok(msgs.includes('weaknesses/w20：errors 指向的 L2-99 在 errors（错题档案）里找不到'));
  assert.ok(msgs.includes('errors/L2-08：缺少 cause'));
  assert.ok(msgs.includes('reviews/R6：不用写 due：到期日由页面按 last 和 tier 算（提醒）'));
});

test('结论必须挂证据：掌握状态（未学以外）要 basis，弱点要挂错题或 basis；log 里改结论也要写依据', () => {
  const m = sampleMemory(TODAY);
  m.mastery.push({ id: 'L2.2.2#tr', state: '基础题过' });
  m.mastery.push({ id: 'L2.2.1#x', state: '复现通过', basis: ['ev-1'] });
  m.mastery.push({ id: 'L2.2.1#y', state: '未学' });
  m.weaknesses.push({ id: 'W20', title: 't', scope: '局部', level: 'L0' });
  m.weaknesses[0].log.push({ date: TODAY, by: 'chat', field: 'level', from: 'L1', to: 'L2' });
  const msgs = checkMemory(m, { today: TODAY }).problems.map((p) => `${p.coll}/${p.id}：${p.msg}`);
  assert.ok(msgs.includes('mastery/L2.2.2#tr：「基础题过」没有依据：basis 里写证据、错题或检验记录的 id'));
  assert.ok(msgs.some((x) => x.startsWith('mastery/L2.2.1#x：「复现通过」要写到了第几档')));
  assert.ok(!msgs.some((x) => x.startsWith('mastery/L2.2.1#y')), '未学不用依据');
  assert.ok(msgs.includes('weaknesses/W20：没挂错题也没有依据：errors 里写错题编号，或者 basis 里写证据 id'));
  assert.ok(msgs.some((x) => x.startsWith('weaknesses/W19：log 第 2 条（level 改成「L2」）没写依据')));
});

test('块要在课程地图里；课程地图还空着（还没迁移）时只提醒', () => {
  const m = sampleMemory(TODAY);
  m.mastery.push({ id: 'L3.1.1', state: '讲过', basis: ['x'] });
  let ps = checkMemory(m, { today: TODAY }).problems;
  assert.ok(ps.some((p) => p.id === 'L3.1.1' && /课程地图里找不到/.test(p.msg) && !p.soft));
  m.curriculum = [];
  ps = checkMemory(m, { today: TODAY }).problems;
  assert.ok(ps.length && ps.every((p) => p.soft), '课程地图空着：块的问题都只是提醒');
  // 编号的层级和 level 对不上、上一级没有
  const m2 = sampleMemory(TODAY);
  m2.curriculum.push({ id: 'L4.1', level: 'block', title: 't' });
  const msgs = checkMemory(m2, { today: TODAY }).problems.map((p) => p.msg);
  assert.ok(msgs.includes('编号 L4.1 是节，level 却写成 block'));
  assert.ok(msgs.includes('上一级 L4 还没有'));
});

test('只增不改：错题被改、被删，记一条提醒，留 7 天；新加的不算', () => {
  const m = sampleMemory(TODAY);
  const first = checkMemory(m, { today: TODAY });
  assert.ok(first.ledger.hist['errors/L2-07']);
  // 新加一条错题、换了字段顺序：都不算改
  const m2 = clone(m);
  m2.errors[0] = Object.fromEntries(Object.entries(m2.errors[0]).reverse());
  m2.errors.push({ id: 'L2-08', source: 's', q: 'q', mine: 'm', step: 's', cause: 'c', date: TODAY, corrects: 'L2-07' });
  const second = checkMemory(m2, { today: TODAY, ledger: first.ledger });
  assert.deepEqual(second.problems, []);
  // 改了原条目
  const m3 = clone(m2);
  m3.errors[0].cause = '改过';
  const third = checkMemory(m3, { today: TODAY, ledger: second.ledger });
  assert.equal(third.problems.length, 1);
  assert.match(third.problems[0].msg, /只增不改，L2-07 的内容被改了.*corrects: L2-07/);
  // 下一次（同一天）还在；8 天后过期
  assert.equal(checkMemory(m3, { today: TODAY, ledger: third.ledger }).problems.length, 1);
  assert.equal(checkMemory(m3, { today: addDays(TODAY, FLAG_DAYS + 1), ledger: third.ledger }).problems.length, 0);
  // 删掉
  const m4 = clone(m3);
  m4.errors = m4.errors.filter((e) => e.id !== 'L2-08');
  m4.weaknesses[0].errors = ['L2-07'];
  assert.ok(checkMemory(m4, { today: TODAY, ledger: third.ledger }).problems.some((p) => /L2-08 被删掉了/.test(p.msg)));
  assert.deepEqual(LEDGER_HISTORY, ['errors', 'observations', 'slips']);
  assert.equal(fingerprint({ id: 'a', x: 1, y: [1, { b: 2, a: 1 }] }), fingerprint({ y: [1, { a: 1, b: 2 }], x: 1, id: 'b' }));
});

test('状态类改了要记 log：没记就一直报，补上 to 是新值的 log 就不报', () => {
  const m = sampleMemory(TODAY);
  const first = checkMemory(m, { today: TODAY });
  const m2 = clone(m);
  m2.weaknesses[0].level = 'L0';
  const r2 = checkMemory(m2, { today: TODAY, ledger: first.ledger });
  assert.deepEqual(r2.problems.map((p) => p.msg), ['level 从「L1」改成了「L0」，log 里没记：补一条 { date, by, field: "level", from, to, basis }']);
  assert.equal(r2.ledger.state['weaknesses/W19'].level, 'L1', '没记 log 时指纹停在旧值');
  // 再查一次还报
  assert.equal(checkMemory(m2, { today: TODAY, ledger: r2.ledger }).problems.length, 1);
  // 补上 log
  const m3 = clone(m2);
  m3.weaknesses[0].log.push({ date: TODAY, by: 'chat', field: 'level', from: 'L1', to: 'L0', basis: ['ev-3'] });
  const r3 = checkMemory(m3, { today: TODAY, ledger: r2.ledger });
  assert.deepEqual(r3.problems, []);
  assert.equal(r3.ledger.state['weaknesses/W19'].level, 'L0');
  // 复现组：tier、last 一起改，用 applyChange 写的就都记上了
  const m4 = clone(m3);
  m4.reviews[0] = applyChange(m4.reviews[0], { tier: nextTier(3, true), last: TODAY, result: '过' }, { date: TODAY, by: 'chat', basis: ['ev-9'] });
  assert.deepEqual(checkMemory(m4, { today: TODAY, ledger: r3.ledger }).problems, []);
});

test('log 的写法：数组、日期、谁改的、改的哪个字段', () => {
  const m = sampleMemory(TODAY);
  m.reviews[1].log = 'tier 1→3';
  m.reviews[2].log = [{ date: '10-27', by: 'me', basis: 'ev-1' }];
  const msgs = checkMemory(m, { today: TODAY }).problems.map((p) => `${p.id}：${p.msg}`);
  assert.ok(msgs.includes('R4：log 要是数组：[{ date, by, field, from, to, basis }]'));
  assert.ok(msgs.includes('R5：log 第 1 条的 date 要写成 YYYY-MM-DD'));
  assert.ok(msgs.includes('R5：log 第 1 条的 by 只能是 chat / class / page'));
  assert.ok(msgs.includes('R5：log 第 1 条缺少 field（改的是哪个字段）'));
  assert.ok(msgs.includes('R5：log 第 1 条的 basis 要是数组（证据、错题的 id）'));
});

test('memcheckRecord：硬的错在前，最多 80 行，复现组的到期一起给', () => {
  const problems = [{ coll: 'a', id: '1', msg: '提醒', soft: true }, ...Array.from({ length: 90 }, (_, i) => ({ coll: 'b', id: String(i), msg: '错' }))];
  const rec = memcheckRecord({ counts: {}, problems, due: [{ id: 'R1', title: 't', due: TODAY, days: 0 }] }, { today: TODAY });
  assert.equal(rec.ok, false);
  assert.equal(rec.problems.length, 80);
  assert.equal(rec.problems[0], 'b/0：错');
  assert.equal(rec.more, 11);
  assert.deepEqual(rec.due, [{ id: 'R1', title: 't', due: TODAY, days: 0 }]);
});

// —— 说明书（CLAUDE-PROJECT.md 第七节）和代码一致 ——

test('说明书第七节：每一类、编号的写法、只能取的值都写到了；例子照抄能过自检', () => {
  const doc = readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8');
  const sec = doc.slice(doc.indexOf('## 七、学习台'));
  assert.ok(sec.length > 2000, '有第七节');
  for (const c of MEMORY_COLLECTIONS) assert.ok(sec.includes(`\`${c}\``), `第七节提到 ${c}`);
  for (const spec of Object.values(COLLECTIONS)) for (const vals of Object.values(spec.enums || {})) for (const v of vals) assert.ok(sec.includes(v), `第七节写到了 ${v}`);
  for (const t of REVIEW_TIERS) assert.ok(sec.includes(String(t)));
  // 第七节里的 JSON 例子（```json 块）：拼起来跑一遍自检，一处硬错都没有
  const blocks = [...sec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert.ok(blocks.length >= 5, '有 JSON 例子');
  const data = {};
  for (const b of blocks) for (const [c, d] of Object.entries(b)) (data[c] ||= []).push(d);
  const hard = checkMemory(data, { today: TODAY }).problems.filter((p) => !p.soft);
  assert.deepEqual(hard, []);
});

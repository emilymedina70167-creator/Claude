// 收件箱 exam_inbox（kit/src/exam/inbox.js 纯函数 + examdesk.js 首页挂着的那一段）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPaper, parseSyllabus } from '../kit/src/exam/ingest.js';
import { planInbox, touches, countsAfter } from '../kit/src/exam/inbox.js';
import { createExamInbox } from '../kit/src/exam/examdesk.js';

const read = (f) => readFileSync(new URL(`./fixtures/exam/${f}`, import.meta.url), 'utf8');
const rec = () => {
  const { paper, questions, passages } = buildPaper({ subject: '408', year: 2019, paperText: read('408-2019.paper.txt'), answersText: read('408-2019.answers.txt') });
  return { kind: 'paper', paper, questions, passages, by: 'dev', at: 1 };
};
const sylRec = () => ({ kind: 'syllabus', course: 'DS', year: 2026, nodes: parseSyllabus(read('ds-2026.syllabus.txt'), { course: 'DS', year: 2026 }).nodes, by: 'dev', at: 1 });

test('一整卷收下：卷、47 道题，回执 ok，新加的计数', () => {
  const r = planInbox(rec(), { have: new Map(), at: 5 });
  assert.equal(r.log.ok, true);
  assert.deepEqual(r.log.problems, []);
  assert.equal(r.writes.length, 48);
  assert.equal(r.log.counts.questions, 47);
  assert.equal(r.log.added.questions, 47);
  assert.equal(r.log.added.papers, 1);
  const q = r.writes.find((w) => w.path === 'questions/Q-408-2019-23').data;
  assert.equal(q.by, 'dev');
  assert.equal(q.at, 5);
  assert.ok(!('id' in q));
});

test('有一题不对整卷不收，回执写哪一题', () => {
  const x = rec();
  x.questions[3].type = 'mcq';
  const r = planInbox(x, { have: new Map(), at: 5 });
  assert.equal(r.log.ok, false);
  assert.deepEqual(r.writes, []);
  assert.match(r.log.problems.join(), /Q-408-2019-4/);
  const y = rec();
  y.questions.pop();
  const r2 = planInbox(y, { have: new Map(), at: 5 });
  assert.equal(r2.log.ok, false);
  assert.match(r2.log.problems.join(), /少了第 47 题/);
});

test('再来一遍：reserve 不被盖掉；标签变了记 tagLog；新的没带标签不抹掉旧的', () => {
  const have = new Map([
    ['papers/X-408-2019', { subject: '408', year: 2019, reserve: true }],
    ['questions/Q-408-2019-23', { tags: { syl: ['G-OS-2.1'], how: 'concept' }, tagLog: [{ at: 1, by: 'dev', from: null, to: { syl: ['G-OS-2.1'], how: 'concept' } }] }],
    ['questions/Q-408-2019-24', { tags: { syl: ['G-OS-2.2'], how: 'calc' } }],
  ]);
  const x = rec();
  x.questions.find((q) => q.n === 23).tags = { syl: ['G-OS-2.3'], how: 'calc' };
  const r = planInbox(x, { have, at: 9 });
  const w = Object.fromEntries(r.writes.map((y) => [y.path, y.data]));
  assert.equal(w['papers/X-408-2019'].reserve, true);
  assert.equal(w['questions/Q-408-2019-23'].tagLog.length, 2);
  assert.deepEqual(w['questions/Q-408-2019-23'].tagLog.at(-1), { at: 9, by: 'dev', from: { syl: ['G-OS-2.1'], how: 'concept' }, to: { syl: ['G-OS-2.3'], how: 'calc' } });
  assert.deepEqual(w['questions/Q-408-2019-24'].tags, { syl: ['G-OS-2.2'], how: 'calc' });
  assert.equal(r.log.added.questions, 45);
});

test('大纲：考点树收下，已经挂的块（映射）不被盖掉；门课对不上不收', () => {
  const have = new Map([['syllabus/G-DS-1.2.1', { blocks: ['DS-L2.1.1'], mapAt: 3 }]]);
  const r = planInbox(sylRec(), { have, at: 5 });
  assert.equal(r.log.ok, true);
  assert.equal(r.writes.length, 8);
  assert.deepEqual(r.writes.find((w) => w.path === 'syllabus/G-DS-1.2.1').data.blocks, ['DS-L2.1.1']);
  const bad = sylRec();
  bad.nodes[0].course = 'OS';
  assert.equal(planInbox(bad, { have: new Map(), at: 5 }).log.ok, false);
});

test('标签：合进已有的题、记 tagLog；库里没有的题、考点树里没有的考点列进 rejected', () => {
  const have = new Map([['questions/Q-408-2019-23', { course: 'OS', tags: null }], ['questions/Q-408-2019-24', { course: 'OS' }]]);
  const r = planInbox({ kind: 'tags', tags: { 'Q-408-2019-23': { syl: ['G-OS-2.1'], how: 'calc' }, 'Q-408-2019-24': { syl: ['G-OS-9'], how: 'calc' }, 'Q-408-2019-99': { syl: ['G-OS-2.1'] } }, by: 'dev', at: 1 }, { have, at: 7, syllabusIds: new Set(['G-OS-2.1']) });
  assert.equal(r.log.ok, true);
  assert.equal(r.writes.length, 1);
  assert.deepEqual(r.writes[0].data.tags, { syl: ['G-OS-2.1'], how: 'calc' });
  assert.equal(r.writes[0].data.tagLog.length, 1);
  assert.deepEqual(r.log.rejected.map((x) => x.id).sort(), ['Q-408-2019-24', 'Q-408-2019-99']);
});

test('不认得的 kind 整条不收；touches 列出要先读的路径', () => {
  assert.equal(planInbox({ kind: 'xx' }, { have: new Map() }).log.ok, false);
  assert.equal(touches(rec()).length, 48);
  assert.ok(touches(sylRec()).includes('syllabus/G-DS-1.2.1'));
  assert.deepEqual(touches({ kind: 'tags', tags: { 'Q-408-2019-1': {} } }), ['questions/Q-408-2019-1']);
});

test('countsAfter：照回执加新加的', () => {
  assert.deepEqual(countsAfter({ counts: { questions: 3 } }, { ok: true, added: { questions: 47, papers: 1 } }, 9).counts, { questions: 50, papers: 1 });
  assert.deepEqual(countsAfter(null, { ok: false, added: {} }, 9).counts, {});
});

// —— 首页挂着的那一段：假数据库 ——
function fakeDb(init = {}) {
  const docs = new Map(Object.entries(init));
  const subs = [];
  const snap = (c) => ({ docs: [...docs].filter(([p]) => p.startsWith(`${c}/`) && p.split('/').length === 2).map(([p, d]) => ({ id: p.split('/')[1], data: () => structuredClone(d) })) });
  const fire = () => { for (const s of subs) s.cb(snap(s.c)); };
  const db = {
    writes: [],
    doc: (p) => ({
      get: async () => ({ exists: docs.has(p), data: () => structuredClone(docs.get(p)) }),
      set: async (d) => { db.writes.push(p); docs.set(p, structuredClone(d)); queueMicrotask(fire); },
      delete: async () => { docs.delete(p); queueMicrotask(fire); },
    }),
    collection: (c) => ({
      onSnapshot: (cb) => { subs.push({ c, cb }); queueMicrotask(() => cb(snap(c))); return () => {}; },
      get: async () => snap(c),
      where: (f, op, v) => ({ get: async () => ({ docs: snap(c).docs.filter((d) => d.data()[f] === v) }) }),
    }),
    all: () => Object.fromEntries(docs),
  };
  return db;
}
const until = async (fn, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)); } return false; };

test('首页的收件箱：好的并进来、回执、删掉；坏的只写回执不进库；计数写进 meta/exam', async () => {
  const bad = rec();
  bad.questions[0].points = 9;
  const db = fakeDb({ 'exam_inbox/X-408-2019': rec(), 'exam_inbox/bad-1': { ...bad, paper: { ...bad.paper, id: 'X-408-2018', year: 2018 }, questions: bad.questions.map((q) => ({ ...q, id: q.id.replace('2019', '2018'), year: 2018, paper: 'X-408-2018' })) } });
  const inbox = createExamInbox({ db, waits: [1, 1] });
  assert.ok(await until(() => !db.all()['exam_inbox/X-408-2019'] && !db.all()['exam_inbox/bad-1']), '两条都处理完');
  const all = db.all();
  assert.equal(all['exam_inbox_log/X-408-2019'].ok, true);
  assert.equal(all['exam_inbox_log/bad-1'].ok, false);
  assert.ok(all['questions/Q-408-2019-23']);
  assert.ok(!all['questions/Q-408-2018-23']);
  assert.ok(!all['papers/X-408-2018']);
  assert.equal(all['meta/exam'].counts.questions, 47);
  inbox.stop();
});

test('首页的收件箱：标签记录先读这几道题所在门课的考点树', async () => {
  const db = fakeDb({
    'questions/Q-408-2019-23': { course: 'OS', stem: 's' },
    'syllabus/G-OS-2.1': { course: 'OS', title: 't' },
    'exam_inbox/tags-1': { kind: 'tags', tags: { 'Q-408-2019-23': { syl: ['G-OS-2.1'], how: 'calc' } }, by: 'dev', at: 1 },
  });
  const inbox = createExamInbox({ db, waits: [1] });
  assert.ok(await until(() => db.all()['exam_inbox_log/tags-1']));
  assert.deepEqual(db.all()['questions/Q-408-2019-23'].tags, { syl: ['G-OS-2.1'], how: 'calc' });
  inbox.stop();
});

// —— 整支审查修的 ——
test('审查：数学一的卷先按题号猜成高数、照题自带的标签改门课，进得了库', () => {
  const qs = [...Array(10)].map((_, i) => ({ n: i + 1, type: 'single', points: 5 })).concat([...Array(6)].map((_, i) => ({ n: 11 + i, type: 'fill', points: 5 }))).concat([...Array(6)].map((_, i) => ({ n: 17 + i, type: 'answer', points: i < 4 ? 12 : 11 })));
  const text = qs.map((q) => `--- 题 ${q.n} | ${{ single: '单选', fill: '填空', answer: '解答' }[q.type]} | ${q.points}\n题 ${q.n}`).join('\n');
  const ans = qs.map((q) => `--- 答 ${q.n}\n答案：1`).join('\n');
  const b = buildPaper({ subject: '301', year: 2021, paperText: text, answersText: ans });
  assert.deepEqual(b.problems, []);
  assert.equal(b.questions[0].course, 'HM');
  b.questions[2].tags = { syl: ['G-LA-2.1'], how: 'calc' };
  const r = planInbox({ kind: 'paper', paper: b.paper, questions: b.questions, passages: [], by: 'dev', at: 1 }, { have: new Map(), at: 2 });
  assert.equal(r.log.ok, true);
  assert.equal(r.writes.find((w) => w.path === 'questions/Q-301-2021-3').data.course, 'LA');
});
test('审查：再来一遍同一卷，后来改过的门课和验算不被盖回去', () => {
  const have = new Map([['questions/Q-408-2019-23', { course: 'CO', tags: { syl: ['G-CO-3.1'], how: 'calc' }, verified: { how: 'engine', ok: true } }]]);
  const w = planInbox(rec(), { have, at: 9 }).writes.find((x) => x.path === 'questions/Q-408-2019-23').data;
  assert.equal(w.course, 'CO');
  assert.deepEqual(w.verified, { how: 'engine', ok: true });
});
test('审查：重新切大纲，标题变了的考点不带走原来挂的块；这次没有的旧考点标作废', () => {
  const have = new Map([
    ['syllabus/G-DS-1.2.1', { title: '顺序存储', blocks: ['DS-L2.1.1'], mapAt: 3 }],
    ['syllabus/G-DS-1.3', { title: '另一个旧标题', blocks: ['DS-L2.3'], mapAt: 3 }],
    ['syllabus/G-DS-9', { course: 'DS', space: 'cs', title: '旧大纲才有的', year: 2025, blocks: ['DS-L9.1'] }],
  ]);
  const r = planInbox(sylRec(), { have, at: 5 });
  const w = Object.fromEntries(r.writes.map((x) => [x.path, x.data]));
  assert.deepEqual(w['syllabus/G-DS-1.2.1'].blocks, ['DS-L2.1.1']);
  assert.equal(w['syllabus/G-DS-1.3'].blocks, undefined);
  assert.match(r.log.notes.join(), /G-DS-1\.3.*标题变了/);
  assert.equal(w['syllabus/G-DS-9'].status, 'void');
  assert.match(r.log.notes.join(), /G-DS-9.*这一份大纲里没有/);
});
test('审查：标签记录照主考点改门课，考点按标签的门课核', () => {
  const have = new Map([['questions/Q-301-2021-3', { course: 'HM', stem: 's' }]]);
  const r = planInbox({ kind: 'tags', tags: { 'Q-301-2021-3': { syl: ['G-LA-2.1'], how: 'rank' } }, by: 'dev', at: 1 }, { have, at: 3, syllabusIds: new Set(['G-LA-2.1']) });
  assert.deepEqual(r.log.rejected, []);
  assert.equal(r.writes[0].data.course, 'LA');
});

test('首页的考情缓存：按门课读一遍，写进 meta/exam 的 stats；没题的门课不写', async () => {
  const { refreshStats } = await import('../kit/src/exam/examdesk.js');
  const db = fakeDb({
    'syllabus/G-OS-3.2': { course: 'OS', title: '页面置换', blocks: ['OS-L3.2.1'] },
    'questions/Q-408-2019-26': { course: 'OS', year: 2019, points: 2, type: 'single', tags: { syl: ['G-OS-3.2'], how: 'calc' } },
    'questions/Q-408-2023-26': { course: 'OS', year: 2023, points: 2, type: 'single' },
    'meta/exam': { counts: { questions: 2 }, at: 5 },
  });
  await refreshStats(db, { curriculum: [{ id: 'OS-L3.2.1', level: 'block' }, { id: 'OS-L3.3.1', level: 'block' }], now: 9 });
  const m = db.all()['meta/exam'];
  assert.equal(m.statsAt, 9);
  assert.equal(m.counts.questions, 2, '计数留着');
  assert.equal(m.stats.OS.heat[0].id, 'G-OS-3.2');
  assert.equal(m.stats.OS.untagged, 1);
  assert.deepEqual(m.stats.OS.holes.blocks, ['OS-L3.3.1']);
  assert.ok(!m.stats.DS);
  assert.equal(m.blockPerYear['OS-L3.2.1'], 2 / 5);
  assert.equal(m.counts.questions, 2);
});

test('真题级的缓存：证据里有真题作答时，按那几门课算受影响的块，变了才写 exam_bar', async () => {
  const { refreshBars } = await import('../kit/src/exam/examdesk.js');
  const db = fakeDb({
    'syllabus/G-OS-3.2': { course: 'OS', title: '页面置换', blocks: ['OS-L3.2.1'] },
    'questions/Q-408-2019-26': { course: 'OS', year: 2019, points: 2, tags: { syl: ['G-OS-3.2'] } },
  });
  const evidence = [{ id: 'ev-1', kind: 'answer', exam: 'Q-408-2019-26', ok: true, attempts: 1, ms: 1000, session: 'c-1', at: 5 }];
  const r = await refreshBars(db, { evidence, bars: [], now: 9 });
  assert.deepEqual(r.wrote, ['OS-L3.2.1']);
  const bar = db.all()['exam_bar/OS-L3.2.1'];
  assert.equal(bar.passed, true);
  const n = db.writes.length;
  const r2 = await refreshBars(db, { evidence, bars: [{ id: 'OS-L3.2.1', ...bar }], now: 20 });
  assert.deepEqual(r2.wrote, []);
  assert.equal(db.writes.length, n, '没变不写');
  assert.deepEqual((await refreshBars(db, { evidence: [{ kind: 'answer', ok: true }], bars: [] })).wrote, [], '没有真题作答不读');
});

// 首页的考试收件箱（exam/examdesk.js 的 createExamInbox）：进度看得见、出错不再吞掉、不合规矩的写明哪一份为什么。
// 2026-11-15 真的学习台里 37 份只并进了第一份（第一份写完回执、还没删原件，首页就进了课堂；错误被吞了，学生什么都看不到），
// 见 docs/superpowers/specs/2026-11-15-root-rulings.md。数据库是内存里的替身，题是现造的（tests/fixtures/exam）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPaper, parseSyllabus } from '../kit/src/exam/ingest.js';
import { createExamInbox, CLASS_INBOX, CLASS_INBOX_WAIT, classInboxWait, startClassInbox } from '../kit/src/exam/examdesk.js';
import { inboxName, inboxRow, inboxProgress, inboxSig, receiptWhy } from '../kit/src/exam/inbox.js';

const read = (f) => readFileSync(new URL(`./fixtures/exam/${f}`, import.meta.url), 'utf8');
const paper = (year) => {
  const b = buildPaper({ subject: '408', year: 2019, paperText: read('408-2019.paper.txt'), answersText: read('408-2019.answers.txt') });
  const id = `X-408-${year}`;
  return {
    kind: 'paper', by: 'dev', at: 1, passages: [],
    paper: { ...b.paper, id, year },
    questions: b.questions.map((q) => ({ ...q, id: q.id.replace('2019', String(year)), year, paper: id })),
  };
};
const syllabus = () => ({ kind: 'syllabus', course: 'DS', year: 2026, nodes: parseSyllabus(read('ds-2026.syllabus.txt'), { course: 'DS', year: 2026 }).nodes, by: 'dev', at: 1 });

// fail(op, path) 返回真就让这一次写抛错；hang(op, path) 返回真就让这一次永远不回来（页面被关掉的样子）
function memDb(init = {}, { fail = () => false, hang = () => false } = {}) {
  const docs = new Map(Object.entries(init).map(([k, v]) => [k, structuredClone(v)]));
  const subs = [];
  const snap = (c) => ({ docs: [...docs].filter(([p]) => p.startsWith(`${c}/`) && p.split('/').length === 2).map(([p, d]) => ({ id: p.split('/')[1], data: () => structuredClone(d) })) });
  const fire = () => { for (const s of subs) s.cb(snap(s.c)); };
  const gate = async (op, p) => {
    if (hang(op, p)) await new Promise(() => {});
    if (fail(op, p)) throw { code: 'unavailable', message: `模拟的写入失败（${p}）` };
  };
  return {
    doc: (p) => ({
      get: async () => ({ exists: docs.has(p), data: () => structuredClone(docs.get(p)) }),
      set: async (d) => { await gate('set', p); docs.set(p, structuredClone(d)); queueMicrotask(fire); },
      delete: async () => { await gate('delete', p); docs.delete(p); queueMicrotask(fire); },
    }),
    collection: (c) => ({
      onSnapshot: (cb) => { subs.push({ c, cb }); queueMicrotask(() => cb(snap(c))); return () => { subs.splice(subs.findIndex((s) => s.cb === cb), 1); }; },
      get: async () => snap(c),
      where: (f, op, v) => ({ get: async () => ({ docs: snap(c).docs.filter((d) => d.data()[f] === v) }) }),
    }),
    all: () => Object.fromEntries(docs),
  };
}
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 5)); } return false; };

test('三份：两份合规的进库、有回执、原件删了；缺必填的那份回执写明原因、progress 里列出来', async () => {
  const bad = paper(2018);
  delete bad.paper.total;
  const db = memDb({ 'exam_inbox/X-408-2019': paper(2019), 'exam_inbox/X-408-2018': bad, 'exam_inbox/syllabus-DS-2026': syllabus() });
  let changes = 0;
  const errs = [];
  const box = createExamInbox({ db, waits: [], again: 10, reportError: (e, c) => errs.push(c), onChange: () => { changes++; } });
  assert.ok(await until(() => { const p = box.progress(); return p.done === 3 && !p.busy; }), JSON.stringify(box.progress()));
  const all = db.all();
  assert.equal(all['exam_inbox_log/X-408-2019'].ok, true);
  assert.equal(all['exam_inbox_log/syllabus-DS-2026'].ok, true);
  assert.ok(all['papers/X-408-2019'] && all['questions/Q-408-2019-23'], '合规的卷进了库');
  assert.ok(Object.keys(all).some((k) => k.startsWith('syllabus/G-DS-')), '考点树进了库');
  assert.equal(all['exam_inbox_log/X-408-2018'].ok, false);
  assert.match(all['exam_inbox_log/X-408-2018'].problems.join(), /total/);
  assert.ok(!all['papers/X-408-2018']);
  for (const id of ['X-408-2019', 'X-408-2018', 'syllabus-DS-2026']) assert.ok(!all[`exam_inbox/${id}`], `${id} 的原件还在`);
  const p = box.progress();
  assert.equal(p.total, 3);
  assert.equal(p.done, 3);
  assert.equal(p.busy, false);
  assert.deepEqual(p.failed.map((f) => f.id), ['X-408-2018']);
  assert.match(p.failed[0].why, /total/);
  assert.ok(changes >= 2, '进度变了要叫首页重画');
  assert.deepEqual(errs, [], '不合规矩不是出错，不进出错记录');
  box.stop();
});

test('第二份的写入抛错两次再成功：三份都处理完，出错记进出错记录（不再吞掉）', async () => {
  let left = 2;
  const db = memDb({ 'exam_inbox/X-408-2018': paper(2018), 'exam_inbox/X-408-2019': paper(2019), 'exam_inbox/syllabus-DS-2026': syllabus() }, {
    fail: (op, p) => op === 'set' && p.startsWith('questions/Q-408-2019-') && left-- > 0,
  });
  const errs = [];
  const box = createExamInbox({ db, waits: [], again: 10, reportError: (e, c) => errs.push(c) });
  assert.ok(await until(() => { const p = box.progress(); return p.done === 3 && !p.busy; }), JSON.stringify(box.progress()));
  const all = db.all();
  for (const id of ['X-408-2018', 'X-408-2019', 'syllabus-DS-2026']) {
    assert.equal(all[`exam_inbox_log/${id}`]?.ok, true, id);
    assert.ok(!all[`exam_inbox/${id}`], `${id} 的原件还在`);
  }
  assert.ok(errs.length >= 1, '出错要报');
  assert.ok(errs.every((c) => c.what === 'exam-inbox' && c.path === 'X-408-2019'), JSON.stringify(errs));
  assert.deepEqual(box.progress().failed, [], '后来成了的不算没并进去');
  box.stop();
});

test('一直写不进去：试几轮就停下，写明哪一份为什么，进度算处理完了（不一直挂着「还在并进来」）', async () => {
  const db = memDb({ 'exam_inbox/X-408-2019': paper(2019), 'exam_inbox/syllabus-DS-2026': syllabus() }, { fail: (op, p) => op === 'set' && p.startsWith('questions/') });
  const errs = [];
  const box = createExamInbox({ db, waits: [], again: 10, reportError: (e, c) => errs.push(c) });
  assert.ok(await until(() => { const p = box.progress(); return p.done === 2 && !p.busy && p.failed.length === 1; }), JSON.stringify(box.progress()));
  await new Promise((r) => setTimeout(r, 60));
  const p = box.progress();
  assert.equal(p.failed[0].id, 'X-408-2019');
  assert.match(p.failed[0].why, /模拟的写入失败/);
  assert.equal(db.all()['exam_inbox_log/syllabus-DS-2026'].ok, true, '别的照并');
  assert.ok(db.all()['exam_inbox/X-408-2019'], '没并进去的原件留着，下次打开首页再试');
  const n = errs.length;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(errs.length, n, '停下以后不再一直重试');
  box.stop();
});

test('真机上的样子：第一份写完回执、删原件之前首页就离开了；下次打开首页这一份再并一遍，计数不翻倍，接着并后面的', async () => {
  const init = { 'exam_inbox/X-408-2018': paper(2018), 'exam_inbox/X-408-2019': paper(2019) };
  const db = memDb(init, { hang: (op, p) => op === 'delete' && p === 'exam_inbox/X-408-2018' && first });
  let first = true;
  const a = createExamInbox({ db, waits: [], again: 10, reportError: () => {} });
  assert.ok(await until(() => db.all()['exam_inbox_log/X-408-2018']));
  assert.equal(a.progress().busy, true, '删原件那一下没回来：还在忙');
  a.stop(); // 进了课堂：整页换掉
  first = false;
  assert.ok(db.all()['exam_inbox/X-408-2018'] && db.all()['exam_inbox/X-408-2019'], '和真机一样：原件没删、第二份没动');
  const b = createExamInbox({ db, waits: [], again: 10, reportError: () => {} });
  assert.ok(await until(() => { const p = b.progress(); return p.done === 2 && !p.busy; }), JSON.stringify(b.progress()));
  const all = db.all();
  assert.ok(!all['exam_inbox/X-408-2018'] && !all['exam_inbox/X-408-2019']);
  assert.equal(all['meta/exam'].counts.questions, 94, '再并一遍的那份不重复加计数');
  b.stop();
});

test('首页那一行：卷、练习、考点树按名字叫，不堆编号', () => {
  assert.equal(inboxName('X-408-2011'), '408 2011 年真题');
  assert.equal(inboxName('drills-X-408-2011'), '408 2011 年真题做的练习');
  assert.equal(inboxName('syllabus-DS-2026'), '数据结构考点树（2026 年大纲）');
  assert.equal(inboxName('tags-408-1'), '一批真题标签');
  assert.equal(inboxName('奇怪的'), '奇怪的');
  assert.equal(inboxRow({ total: 37, done: 37, busy: false, failed: [] }), null, '都处理完、没有失败的：不出现');
  assert.equal(inboxRow({ total: 0, done: 0, busy: false, failed: [] }), null);
  const r = inboxRow({ total: 37, done: 3, busy: true, failed: [] });
  assert.equal(r.pending, '考试资料还在并进来：3 / 37，停在这一页');
  assert.equal(r.head, '');
  const f = inboxRow({ total: 37, done: 37, busy: false, failed: [{ id: 'X-408-2018', why: '缺了必填的 total' }, { id: 'drills-X-408-2010', why: 'x' }] });
  assert.equal(f.pending, '');
  assert.equal(f.head, '有 2 份考试资料没并进去');
  assert.deepEqual(f.failed, [{ id: 'X-408-2018', name: '408 2018 年真题', why: '缺了必填的 total' }, { id: 'drills-X-408-2010', name: '408 2010 年真题做的练习', why: 'x' }]);
});

// —— 审查以后改的（2026-11-16）——
test('整份不收的那一份：刷新以后（别的设备、上一次打开时并的）从回执里照样列出来；同号后来并成了就不再列', async () => {
  const db = memDb({
    'exam_inbox_log/X-408-2018': { kind: 'paper', ok: false, at: 5, problems: ['真题卷 X-408-2018：缺了必填的 total'], rejected: [], src: 'X-408-2018' },
    'exam_inbox_log/X-408-2017': { kind: 'paper', ok: true, at: 6, problems: [], rejected: [], src: 'X-408-2017' },
  });
  const box = createExamInbox({ db, waits: [], again: 10, reportError: () => {} });
  assert.ok(await until(() => box.progress().failed.length === 1));
  assert.deepEqual(box.progress().failed, [{ id: 'X-408-2018', why: '真题卷 X-408-2018：缺了必填的 total' }]);
  assert.equal(inboxRow(box.progress()).head, '有 1 份考试资料没并进去');
  // 改好重新放进来、并成了：回执同号盖掉
  await db.doc('exam_inbox/X-408-2018').set(paper(2018));
  assert.ok(await until(() => db.all()['exam_inbox_log/X-408-2018']?.ok === true && !box.progress().busy));
  assert.deepEqual(box.progress().failed, []);
  assert.equal(inboxRow(box.progress()), null);
  box.stop();
  // 课堂里不看回执
  const quiet = createExamInbox({ db: memDb({ 'exam_inbox_log/X-408-2018': { ok: false, problems: ['x'] } }), logs: false, reportError: () => {} });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(quiet.progress().failed, []);
  quiet.stop();
});

test('同一个编号的原件换了（重新放进来的）：这次打开里处理过也当新的一份再并', async () => {
  const bad = paper(2018);
  delete bad.paper.total;
  const db = memDb({ 'exam_inbox/X-408-2018': bad });
  const box = createExamInbox({ db, waits: [], again: 10, reportError: () => {} });
  assert.ok(await until(() => box.progress().done === 1 && !box.progress().busy));
  assert.equal(box.progress().failed.length, 1);
  await db.doc('exam_inbox/X-408-2018').set({ ...paper(2018), at: 2 });
  assert.ok(await until(() => db.all()['exam_inbox_log/X-408-2018']?.ok === true && !box.progress().busy), JSON.stringify(box.progress()));
  assert.deepEqual(box.progress(), { total: 1, done: 1, busy: false, failed: [] });
  box.stop();
});

test('分母不跳：正在并的那一份删了原件、还没记成处理完，也算在总数里', async () => {
  const db = memDb({ 'exam_inbox/X-408-2018': paper(2018), 'exam_inbox/X-408-2019': paper(2019) });
  const seen = [];
  let box = null;
  box = createExamInbox({ db, waits: [], again: 10, reportError: () => {}, onChange: () => { if (box) seen.push(box.progress().total); } });
  assert.ok(await until(() => box.progress().done === 2 && !box.progress().busy));
  assert.ok(seen.length && seen.every((n) => n === 2), `总数跳过：${seen.join(',')}`);
  box.stop();
});

test('计数写不进 meta/exam：照样并完，但记进出错记录（不再吞掉）', async () => {
  const db = memDb({ 'exam_inbox/X-408-2019': paper(2019) }, { fail: (op, p) => op === 'set' && p === 'meta/exam' });
  const errs = [];
  const box = createExamInbox({ db, waits: [], again: 10, stats: false, reportError: (e, c) => errs.push(c) });
  assert.ok(await until(() => box.progress().done === 1 && !box.progress().busy));
  assert.ok(!db.all()['exam_inbox/X-408-2019']);
  assert.ok(errs.some((c) => /计数/.test(c.what) && c.path === 'X-408-2019'), JSON.stringify(errs));
  box.stop();
});

// 一批同时写几条：写慢一点，数同时在写的最多几条
function countingDb(init) {
  let now = 0, max = 0;
  const db = memDb(init);
  const doc = db.doc;
  db.doc = (p) => {
    const r = doc(p);
    return { ...r, set: async (d) => { now++; max = Math.max(max, now); await new Promise((ok) => setTimeout(ok, 2)); try { return await r.set(d); } finally { now--; } } };
  };
  db.max = () => max;
  return db;
}
test('课堂里接着并：一批只写 5 条、不重算考情的统计；首页一批 20 条、重算', async () => {
  assert.deepEqual(CLASS_INBOX, { parallel: 5, stats: false, logs: false });
  const cls = countingDb({ 'exam_inbox/X-408-2019': paper(2019) });
  const a = createExamInbox({ db: cls, waits: [], again: 10, reportError: () => {}, ...CLASS_INBOX });
  assert.ok(await until(() => a.progress().done === 1 && !a.progress().busy));
  assert.ok(cls.max() <= 5, `课堂里一批写了 ${cls.max()} 条`);
  assert.equal(cls.all()['meta/exam'].counts.questions, 47, '计数照写');
  assert.equal(cls.all()['meta/exam'].statsAt, undefined, '课堂里不重算统计（回到首页由 maybeRefresh 补：at 比 statsAt 新）');
  a.stop();
  const home = countingDb({ 'exam_inbox/X-408-2019': paper(2019) });
  const b = createExamInbox({ db: home, waits: [], again: 10, reportError: () => {} });
  assert.ok(await until(() => b.progress().done === 1 && !b.progress().busy && home.all()['meta/exam']?.statsAt));
  assert.ok(home.max() > 5, `首页一批只写了 ${home.max()} 条`);
  b.stop();
});

test('课堂里等多久：默认 30 秒，?dev&examwait=1 是 1 秒（不是 dev 不认）；startClassInbox 到点才挂、能停', async () => {
  assert.equal(CLASS_INBOX_WAIT, 30000);
  assert.equal(classInboxWait('?dev&examwait=1', true), 1000);
  assert.equal(classInboxWait('?dev&examwait=0', true), 0);
  assert.equal(classInboxWait('?examwait=1', false), 30000);
  assert.equal(classInboxWait('?dev', true), 30000);
  assert.equal(classInboxWait('?dev&examwait=x', true), 30000);
  const db = memDb({ 'exam_inbox/X-408-2019': paper(2019) });
  const stop = startClassInbox({ db, wait: 30, reportError: () => {} });
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(db.all()['exam_inbox/X-408-2019'], '还没到点就并了');
  assert.ok(await until(() => !db.all()['exam_inbox/X-408-2019']));
  assert.equal(db.all()['exam_inbox_log/X-408-2019'].ok, true);
  stop();
  const db2 = memDb({ 'exam_inbox/X-408-2019': paper(2019) });
  startClassInbox({ db: db2, wait: 20, reportError: () => {} })();
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(db2.all()['exam_inbox/X-408-2019'], '停了还在并');
});

test('进度的纯函数：重新放进来的不算处理完；回执里的只补这次没处理过的', () => {
  const done = new Map([['A', { why: '', sig: '1' }], ['B', { why: '坏', sig: '1' }]]);
  assert.deepEqual(inboxProgress({ present: new Map([['A', '2']]), done, current: 'C', busy: true, logs: [{ id: 'B', ok: false, problems: ['旧'] }, { id: 'D', ok: false, problems: ['p1'] }, { id: 'A', ok: false }] }),
    { total: 3, done: 1, busy: true, failed: [{ id: 'B', why: '坏' }, { id: 'D', why: 'p1' }] });
  assert.equal(receiptWhy({ problems: [], rejected: [{ id: 'Q', error: 'e' }] }), 'Q：e');
  assert.equal(receiptWhy({}), '整份不收');
  assert.notEqual(inboxSig({ at: 1, questions: [1] }), inboxSig({ at: 2, questions: [1] }));
});

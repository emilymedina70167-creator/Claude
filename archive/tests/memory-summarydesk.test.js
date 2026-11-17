// 第十三轮：记忆摘要的数据库这一层（kit/src/memory/summarydesk.js）：当场记、课后重写、学生自己改和退回
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem0 = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem0.has(k) ? mem0.get(k) : null), setItem: (k, v) => mem0.set(k, String(v)), removeItem: (k) => mem0.delete(k), key: () => null, length: 0 };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { createSummary } = await import('../kit/src/memory/summarydesk.js');
const { REWRITE_HEAD, QUIET_MS } = await import('../kit/src/memory/summary.js');
const { fakeDb } = await import('../kit/src/live/store.js');

const SID = 'c-20261116-1';
const OPUS = 'claude-opus-5-5';
const T0 = Date.UTC(2026, 10, 16, 14, 0);
const rows = async (db, c) => (await db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const get = async (db, p) => { const r = await db.doc(p).get(); return r.exists ? r.data() : null; };
const reply = (shared, subject) => `<共用>\n${shared}\n</共用>\n<这一科>\n${subject}\n</这一科>`;

async function setup({ summary = [], legacy = {} } = {}) {
  const db = fakeDb(`sum-${Math.random()}`);
  db._clear();
  await db.doc(`sessions/${SID}`).set({ kind: 'class', status: 'open', space: 'en', block: 'EN-L1.2.2', title: '情态', startedAt: T0, date: '2026-11-16' });
  await db.doc('evidence/ev-a').set({ session: SID, src: 'say', kind: 'say', text: '换一个高效点的测验，这个完全量大堆', at: T0 + 1000 });
  await db.doc('evidence/ev-b').set({ session: SID, src: 'record', kind: 'cloze', comp: 'c-b4', ok: false, at: T0 + 2000 });
  await db.doc(`sessions/${SID}/class_turns/000001`).set({ seq: 1, role: 'claude', at: T0 + 500, text: '第三块：书上真题演练第 4–12 句，每句写三样。' });
  for (const d of summary) { const { id, ...rest } = d; await db.doc(`summary/${id}`).set(rest); }
  let clock = T0 + QUIET_MS + 60000;
  let data = { summary: await rows(db, 'summary'), sessions: await rows(db, 'sessions'), evidence: await rows(db, 'evidence'), rules: [], lessons: [], asks: [], profile: [], ...legacy };
  const calls = [];
  const ai = { fn: () => reply('学生在备考。', '英语按语法模块学。') };
  const sum = createSummary({ db, getData: () => data, now: () => clock, ai: async () => ({ call: async (prompt, opts) => { calls.push({ prompt, opts }); const r = await ai.fn(prompt, calls.length); return typeof r === 'string' ? { text: r, modelApplied: OPUS } : r; } }) });
  const refresh = async () => { data = { ...data, summary: await rows(db, 'summary'), sessions: await rows(db, 'sessions') }; };
  return { db, sum, calls, ai, refresh, tick: (ms) => { clock += ms; }, data: () => data };
}

test('当场记一条新笔记：写进那一科那一份，手上的记忆跟着有；说的是同一件事不再记', async () => {
  const t = await setup();
  assert.equal(t.sum.on(), false);
  const r = await t.sum.note({ text: '读了十分钟以后来了 9 句，学生叫停', quote: '换一个高效点的测验', space: 'en', session: SID });
  assert.equal(r.added, true);
  const doc = await get(t.db, 'summary/en');
  assert.equal(doc.notes.length, 1);
  assert.equal(doc.notes[0].quote, '换一个高效点的测验');
  assert.equal(t.sum.on(), true);
  assert.equal(t.data().summary.find((d) => d.id === 'en').notes.length, 1);
  assert.equal((await t.sum.note({ text: '读了十分钟以后来了 9 句，学生叫停了', space: 'en' })).added, false);
  await t.sum.note({ text: '术语第一次出现附英文', space: '别的' });
  assert.equal((await get(t.db, 'summary/shared')).notes.length, 1);
});

test('课后重写：两份各加一版，上一版进 history，已并的新笔记清掉，这节课记下并到哪', async () => {
  const t = await setup({ summary: [{ id: 'shared', text: '旧的共用。', v: 1, at: 1, by: 'chat', notes: [], history: [] }, { id: 'en', text: '旧的英语。', v: 2, at: 1, by: 'chat', notes: [{ text: '早先记的', at: T0 + 10 }], history: [] }] });
  assert.equal(t.sum.needs((await rows(t.db, 'sessions'))[0]), true);
  assert.equal(await t.sum.runFor(SID), 'done');
  const [sh, en, s] = [await get(t.db, 'summary/shared'), await get(t.db, 'summary/en'), await get(t.db, `sessions/${SID}`)];
  assert.deepEqual([sh.text, sh.v, sh.by, sh.history[0].text], ['学生在备考。', 2, 'page', '旧的共用。']);
  assert.deepEqual([en.text, en.v, en.history[0].text, en.notes.length], ['英语按语法模块学。', 3, '旧的英语。', 0]);
  assert.equal(s.sum.upTo, T0 + 2000);
  assert.equal(s.sum.fails, 0);
  // 提示词：固定的开头、学生的原话、这节课的记录、新笔记；后台、Opus 5.5 high
  const { prompt, opts } = t.calls[0];
  assert.ok(prompt.startsWith(REWRITE_HEAD));
  assert.match(prompt, /「换一个高效点的测验，这个完全量大堆」/);
  assert.match(prompt, /书上真题演练第 4–12 句/);
  assert.match(prompt, /早先记的/);
  assert.doesNotMatch(prompt, /以前一条条攒下的记录/); // 这一科已经有摘要了，不带原料
  assert.deepEqual([opts.model, opts.effort, opts.lane], [OPUS, 'high', 'bg']);
  // 没有新的动静：不再重写
  await t.refresh();
  assert.equal(t.sum.needs(t.data().sessions[0]), false);
  assert.equal(await t.sum.runFor(SID), 'skip');
});

test('第一次：这一科还没有摘要时带上以前攒下的规则当原料', async () => {
  const t = await setup({ legacy: { rules: [{ id: 'rule-a', cat: '讲解', text: '讲法自造，文稿的比喻一律不搬', status: 'active' }], asks: [{ id: 'A-9', text: '练习固定两步：写主干 + 完整翻译', status: 'active', scope: 'en', quotes: [] }] } });
  assert.equal(t.sum.ready(), false); // 有旧的规则、还没有摘要：等第一版
  assert.equal(await t.sum.runFor(SID), 'done');
  assert.match(t.calls[0].prompt, /以前一条条攒下的记录（原料）[\s\S]*练习固定两步[\s\S]*讲法自造/);
  assert.equal((await get(t.db, 'summary/en')).v, 1);
  assert.equal(t.sum.on(), true);
});

test('回的不是 Opus、少一段、短了一半以上：都不写，记一次试过；试满两次先跳过', async () => {
  const old = '字'.repeat(900);
  const t = await setup({ summary: [{ id: 'shared', text: '旧的共用。', v: 1, notes: [], history: [] }, { id: 'en', text: old, v: 1, notes: [], history: [] }] });
  t.ai.fn = () => ({ text: reply('甲', '乙'.repeat(600)), modelApplied: 'claude-sonnet-5-5' });
  assert.equal(await t.sum.runFor(SID), 'fail');
  t.ai.fn = () => '<共用>\n只有一段\n</共用>';
  assert.equal(await t.sum.runFor(SID), 'fail');
  assert.equal((await get(t.db, 'summary/en')).text, old);
  assert.equal((await get(t.db, 'summary/shared')).v, 1);
  await t.refresh();
  assert.equal(t.data().sessions[0].sum.fails, 2);
  assert.equal(t.sum.needs(t.data().sessions[0]), false);
  // 短了一半以上
  t.ai.fn = () => reply('新的共用。', '太短');
  assert.equal(await t.sum.runFor(SID), 'fail');
  assert.equal((await get(t.db, 'summary/en')).text, old);
  assert.equal((await get(t.db, 'summary/shared')).text, '旧的共用。'); // 一份不过，两份都不写
});

test('重写途中学生又让老师记了一条：这条留着', async () => {
  const t = await setup({ summary: [{ id: 'en', text: '旧的英语。', v: 1, notes: [{ text: '早先记的', at: T0 + 10 }], history: [] }] });
  t.ai.fn = async () => { t.tick(5000); await t.sum.note({ text: '重写途中才记的：例句的译文另起一行', space: 'en' }); return reply('共用。', '新的英语，够长的一段话。'); };
  assert.equal(await t.sum.runFor(SID), 'done');
  assert.deepEqual((await get(t.db, 'summary/en')).notes.map((n) => n.text), ['重写途中才记的：例句的译文另起一行']);
});

test('学生自己改、退回、删一条新笔记', async () => {
  const t = await setup({ summary: [{ id: 'en', text: '第一版。', v: 1, by: 'chat', at: 1, notes: [{ text: '一条笔记', at: 77 }], history: [] }] });
  await t.sum.save('en', '我改的第二版。');
  let en = await get(t.db, 'summary/en');
  assert.deepEqual([en.text, en.v, en.by, en.notes.length], ['我改的第二版。', 2, 'me', 1]);
  await t.sum.back('en');
  en = await get(t.db, 'summary/en');
  assert.deepEqual([en.text, en.v, en.history[0].text], ['第一版。', 3, '我改的第二版。']);
  await t.sum.dropNote('en', 77);
  assert.equal((await get(t.db, 'summary/en')).notes.length, 0);
  await assert.rejects(t.sum.save('en', '字'.repeat(3000)), /太长/);
  await assert.rejects(t.sum.save('xx', '甲'), /没有/);
});

test('班主任的一段对话：只重写共用那一份', async () => {
  const t = await setup({ summary: [{ id: 'shared', text: '旧的共用。', v: 1, notes: [], history: [] }] });
  await t.db.doc('chats/h-1').set({ title: '聊聊', last: T0 + 3000 });
  await t.db.doc('chats/h-1/turns/000001').set({ role: 'me', text: '我以后晚上十点以后不学新内容', at: T0 + 2500 });
  await t.db.doc('chats/h-1/turns/000002').set({ role: 'head', text: '记下了。', at: T0 + 3000 });
  assert.deepEqual(await t.sum.chatsToDo(), ['h-1']);
  t.ai.fn = () => '<共用>\n新的共用：学生说晚上十点以后不学新内容。\n</共用>';
  assert.equal(await t.sum.runForChat('h-1'), 'done');
  assert.match((await get(t.db, 'summary/shared')).text, /十点以后/);
  assert.doesNotMatch(t.calls[0].prompt, /<这一科>/);
  assert.deepEqual(await t.sum.chatsToDo(), []);
});

test('摘要开始有以前上的课不回头并', async () => {
  const t = await setup({ summary: [{ id: 'shared', text: '第一版共用。', v: 1, since: T0 + 5000, notes: [], history: [] }, { id: 'en', text: '第一版英语。', v: 1, since: T0 + 5000, notes: [], history: [] }] });
  assert.equal(t.sum.needs(t.data().sessions[0]), false);
  assert.equal(await t.sum.runFor(SID), 'skip');
  assert.equal(t.calls.length, 0);
});

test('重写回来只是太长：把那一版还给它压一遍，压进上限才写', async () => {
  const t = await setup({ summary: [{ id: 'en', text: '旧的英语。', v: 1, notes: [], history: [] }] });
  t.ai.fn = (prompt, n) => (n === 1 ? reply('共用。', '字'.repeat(3000)) : reply('共用。', '压过的英语，一段够长的话。'));
  assert.equal(await t.sum.runFor(SID), 'done');
  assert.equal(t.calls.length, 2);
  assert.match(t.calls[1].prompt, /你上一次写的（太长了）[\s\S]*「这一科」有 9000 字节，上限 8192/);
  assert.equal((await get(t.db, 'summary/en')).text, '压过的英语，一段够长的话。');
  // 压了还超：不写
  const t2 = await setup({ summary: [{ id: 'en', text: '旧的英语。', v: 1, notes: [], history: [] }] });
  t2.ai.fn = () => reply('共用。', '字'.repeat(3000));
  assert.equal(await t2.sum.runFor(SID), 'fail');
  assert.equal(t2.calls.length, 2);
  assert.equal((await get(t2.db, 'summary/en')).text, '旧的英语。');
});

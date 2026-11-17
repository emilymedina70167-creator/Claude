// 第十一轮 B1：班主任的数据库这一层（kit/src/head/headdesk.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem0 = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem0.has(k) ? mem0.get(k) : null), setItem: (k, v) => mem0.set(k, String(v)), removeItem: (k) => mem0.delete(k), key: () => null, length: 0 };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { createNotebook } = await import('../kit/src/project/notebookdesk.js');
const { createHead, splitMemo } = await import('../kit/src/head/headdesk.js');
const { fakeDb } = await import('../kit/src/live/store.js');

const OPUS = 'claude-opus-5-5';
const rows = async (db, c) => (await db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

async function setup(reply) {
  const db = fakeDb(`head-${Math.random()}`);
  db._clear();
  const data = { sessions: [], evidence: [], asks: [], profile: [], lessons: [], observations: [], rules: [], slips: [], errors: [], weaknesses: [], reviews: [], curriculum: [], mastery: [], recall: [], position: [] };
  const calls = [];
  const ai = async () => ({ tools: true, call: async (turns, opts) => { calls.push({ turns, opts }); opts.onText?.({ text: '想一' }); return reply(turns, opts, calls.length); } });
  const notebook = createNotebook({ db });
  const head = createHead({ db, getData: () => data, ai, notebook, system: () => '班主任的说明' });
  return { db, head, calls, data };
}

test('splitMemo：memo 块不显示，块的内容拿出来', () => {
  const r = splitMemo('好的，记下了。\n\n````board memo\nask text="开场复习最多三句" basis=say\n````\n还有别的吗？');
  assert.equal(r.shown, '好的，记下了。\n\n还有别的吗？');
  assert.ok(r.body.includes('ask text='));
});

test('开一段新对话：我的话记成证据（chat），回答存起来', async () => {
  const t = await setup(() => ({ text: '408 现在最该补的是页式存储。', modelApplied: OPUS }));
  const shown = [];
  const r = await t.head.send(null, '我 408 现在怎么样', { onText: (x) => shown.push(x) });
  assert.match(r.cid, /^h-\d{8}-1$/);
  const chat = (await t.db.doc(`chats/${r.cid}`).get()).data();
  assert.equal(chat.title, '我 408 现在怎么样');
  assert.equal(chat.n, 2);
  const ev = (await rows(t.db, 'evidence'))[0];
  assert.equal(ev.src, 'say');
  assert.equal(ev.chat, r.cid);
  assert.equal(ev.session, null);
  const turns = await t.head.turnsOf(r.cid);
  assert.deepEqual(turns.map((x) => x.role), ['me', 'head']);
  assert.equal(turns[1].model, OPUS);
  assert.equal(t.calls[0].turns[0].content, '班主任的说明');
  assert.equal(t.calls[0].opts.model, OPUS);
  assert.equal(t.calls[0].opts.effort, 'high');
  assert.deepEqual(t.calls[0].opts.tools.map((x) => x.name), ['read', 'list', 'search', 'notebook']);
  assert.deepEqual(shown, ['想一']);
});

test('回的不是 Opus 5.5：这一轮作废、memo 不写、照实说', async () => {
  const t = await setup(() => ({ text: '好\n```board memo\nask text="别重叠" basis=say\n```', modelApplied: 'claude-sonnet-5-5' }));
  const r = await t.head.send(null, '别重叠');
  assert.match(r.error, /不是 Opus 5\.5/);
  assert.equal((await rows(t.db, 'asks')).length, 0);
  const turns = await t.head.turnsOf(r.cid);
  assert.equal(turns[1].void, true);
  // 下一轮不带作废的那一轮
  await t.head.send(r.cid, '再试一次');
  assert.ok(!t.calls[1].turns.some((x) => x.role === 'assistant'));
});

test('工具：read 按路径读一条、list 按字段筛、search 在对话里找、notebook 写它的笔记', async () => {
  const t = await setup(() => ({ text: '嗯', modelApplied: OPUS }));
  await t.db.doc('exam_profiles/G-OS-3.2.1').set({ course: 'OS', how: '考页面置换' });
  await t.db.doc('exam_profiles/G-CN-1.1').set({ course: 'CN', how: '考时延' });
  const r = await t.head.send(null, '页面置换我老错');
  const used = [];
  const tools = Object.fromEntries(t.head.tools(used).map((x) => [x.name, x]));
  assert.equal((await tools.read.execute({ path: 'exam_profiles/G-OS-3.2.1' })).doc.how, '考页面置换');
  await assert.rejects(() => tools.read.execute({ path: 'exam_profiles' }));
  const l = await tools.list.execute({ collection: 'exam_profiles', field: 'course', value: 'OS' });
  assert.equal(l.count, 1);
  const s = await tools.search.execute({ q: '页面置换', in: ['chats'] });
  assert.match(s.hits[0].path, new RegExp(`chats/${r.cid}/turns/`));
  await tools.notebook.execute({ op: 'create', path: '学生/408.md', text: '页面置换老错' });
  const nb = (await rows(t.db, 'notebook'))[0];
  assert.deepEqual([nb.path, nb.by], ['学生/408.md', 'head']);
  assert.deepEqual(used.map((u) => u.name), ['read', 'read', 'list', 'search', 'notebook']);
});

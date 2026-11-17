// 摘要里引的原话要在记录里找得到（清点第二节第 5 条）：旧系统的守卫核过写进记忆的引号，
// 摘要的重写没过这一道——重写时把学生的话改几个字、编一句，会一直留在摘要里。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotesIn, quoteFound, checkQuotes, QUOTE_MIN } from '../kit/src/memory/summary.js';
import { createSummary } from '../kit/src/memory/summarydesk.js';

test('quotesIn：只取够长的引号，短的术语不算', () => {
  const text = '学生说过「别再一上来给我九句话」，也提过「表格」好认；板上写的是「that 引导的是同位语从句」。';
  assert.deepEqual(quotesIn(text), ['别再一上来给我九句话', 'that 引导的是同位语从句']);
  assert.equal(QUOTE_MIN, 6);
  assert.deepEqual(quotesIn(''), []);
  assert.deepEqual(quotesIn('没有引号'), []);
});

test('quotesIn：弯引号也认，套着的引号取外面那一层', () => {
  assert.deepEqual(quotesIn('学生说“这种讲法我听不懂啊”。'), ['这种讲法我听不懂啊']);
  assert.deepEqual(quotesIn('学生说「我想要『带着学』的那种课」。'), ['我想要『带着学』的那种课']);
});

test('quoteFound：照抄的过，空白、全角半角、大小写不计', () => {
  const corpus = '第 3 轮：别再一上来给我九句话，先给我结论\n第 7 轮：这里的 That 为什么不是关系代词?';
  assert.ok(quoteFound('别再一上来给我九句话', corpus));
  assert.ok(quoteFound('这里的that为什么不是关系代词？', corpus));
  assert.ok(quoteFound('别再一上来给我九句话,先给我结论', corpus));
});

test('quoteFound：改了两个字的不过', () => {
  const corpus = '第 3 轮：别再一上来给我九句话，先给我结论';
  assert.ok(!quoteFound('别再一开始给我九句话', corpus));
  assert.ok(!quoteFound('不要一上来给我九句话', corpus));
});

test('quoteFound：带省略号的按段找，先后不能乱', () => {
  const corpus = '我觉得现在基本就是回到之前了，我本来设想的是两边取长结合，你怎么看？';
  assert.ok(quoteFound('基本就是回到之前了……两边取长结合', corpus));
  assert.ok(quoteFound('基本就是回到之前了…两边取长结合', corpus));
  assert.ok(quoteFound('基本就是回到之前了...两边取长结合', corpus));
  assert.ok(!quoteFound('两边取长结合……基本就是回到之前了', corpus), '先后乱了');
  assert.ok(!quoteFound('基本就是回到之前了……两边各取所长', corpus), '后一段对不上');
});

test('checkQuotes：列出找不到的那几句；上一版摘要里本来就有的引号过', () => {
  const prev = '学生在读《王道》，把「先给结论再展开」当成自己的习惯。';
  const said = '第 3 轮：别再一上来给我九句话';
  const next = '学生的习惯是「先给结论再展开」。2026-11-16 英语课上说「别再一上来给我九句话」，还说「以后每次都要用表格讲」。';
  const r = checkQuotes({ next, corpus: `${prev}\n${said}` });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['以后每次都要用表格讲']);
  assert.deepEqual(checkQuotes({ next: prev, corpus: prev }), { ok: true, missing: [] });
  assert.deepEqual(checkQuotes({ next: '', corpus: '' }), { ok: true, missing: [] });
});

// —— 数据库那一层：重来一次改好了就收，改不好不收、上一版原样在 ——
function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const docRef = (path) => ({
    get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)), id: path.split('/').pop() }),
    set: async (v, opt) => { docs.set(path, opt?.merge ? { ...(docs.get(path) || {}), ...structuredClone(v) } : structuredClone(v)); },
    update: async (v) => { docs.set(path, { ...(docs.get(path) || {}), ...structuredClone(v) }); },
  });
  const coll = (path) => {
    const rows = (filter = () => true) => [...docs.entries()].filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(([k, v]) => ({ id: k.split('/').pop(), data: () => structuredClone(v) })).filter((d) => filter(d.data()));
    return {
      get: async () => ({ docs: rows() }),
      where: (f, _op, val) => ({ get: async () => ({ docs: rows((d) => d[f] === val) }) }),
      doc: (id) => docRef(`${path}/${id}`),
    };
  };
  return { docs, doc: docRef, collection: coll };
}

const SID = 'c-20261116-1';
const seed = () => ({
  'summary/shared': { id: 'shared', text: '学生在备考 2027 年考研，目标南京大学。学生习惯「先给结论再展开」的讲法。', v: 1, at: 100, by: 'chat', since: 100 },
  'summary/en': { id: 'en', text: '英语一：长难句在学定语从句和同位语从句的区分，这一块做过两节课。', v: 1, at: 100, by: 'chat', since: 100 },
  [`sessions/${SID}`]: { id: SID, space: 'en', subject: '英语', block: 'EN-2-01', title: '同位语从句', status: 'closed', startedAt: 200, endedAt: 900, date: '2026-11-16' },
  'evidence/e1': { id: 'e1', session: SID, src: 'say', text: '别再一上来给我九句话，先给我结论', at: 300 },
  'evidence/e2': { id: 'e2', session: SID, src: 'answer', comp: 'q1', ok: true, at: 400 },
  [`sessions/${SID}/class_turns/t1`]: { seq: 1, role: 'student', text: '别再一上来给我九句话，先给我结论', say: '别再一上来给我九句话，先给我结论', at: 300 },
  [`sessions/${SID}/class_turns/t2`]: { seq: 2, role: 'claude', text: '好，先说结论：that 后面句子完整就是同位语从句。', at: 310 },
});
const reply = (shared, subject) => ({ text: `<共用>\n${shared}\n</共用>\n<这一科>\n${subject}\n</这一科>`, modelApplied: 'claude-opus-5-5' });
const SHARED_OK = '学生在备考 2027 年考研，目标南京大学。学生习惯「先给结论再展开」的讲法。2026-11-16 英语课上说过「别再一上来给我九句话，先给我结论」。';
const SHARED_BAD = '学生在备考 2027 年考研，目标南京大学。学生习惯「先给结论再展开」的讲法。2026-11-16 英语课上说过「以后每次讲课都不许超过三句话」。';
const SUBJECT = '英语一：长难句在学定语从句和同位语从句的区分，这一块做过三节课。2026-11-16 这一节同位语从句的题做对了。';

function desk(replies) {
  const db = fakeDb(seed());
  const prompts = [];
  const data = () => {
    const pick = (p) => [...db.docs.entries()].filter(([k]) => k.startsWith(`${p}/`) && k.split('/').length === 2).map(([k, v]) => ({ id: k.split('/')[1], ...v }));
    return { summary: pick('summary'), sessions: pick('sessions'), rules: [], lessons: [], asks: [], profile: [], slips: [] };
  };
  const ai = async () => ({ call: async (input) => { prompts.push(typeof input === 'string' ? input : JSON.stringify(input)); return replies.shift() || null; } });
  let t = 1000;
  const sum = createSummary({ db, getData: data, ai, now: () => (t += 10) });
  return { db, sum, prompts };
}

test('重写里有一句找不到的引号：把那一版还给它重来一次，改好了就收', async () => {
  const { db, sum, prompts } = desk([reply(SHARED_BAD, SUBJECT), reply(SHARED_OK, SUBJECT)]);
  assert.equal(await sum.runFor(SID), 'done');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /以后每次讲课都不许超过三句话/);
  assert.match(prompts[1], /照记录抄|去掉引号/);
  assert.equal(db.docs.get('summary/shared').text, SHARED_OK);
  assert.equal(db.docs.get('summary/shared').v, 2);
});

test('重来一次还是找不到：这一份不收，上一版原样在', async () => {
  const before = seed()['summary/shared'].text;
  const { db, sum, prompts } = desk([reply(SHARED_BAD, SUBJECT), reply(SHARED_BAD, SUBJECT)]);
  assert.equal(await sum.runFor(SID), 'fail');
  assert.equal(prompts.length, 2);
  assert.equal(db.docs.get('summary/shared').text, before);
  assert.equal(db.docs.get('summary/shared').v, 1);
  assert.equal(db.docs.get('summary/en').v, 1, '两份一起不收');
});

test('引号都对得上：一次就收，不多调用', async () => {
  const { db, sum, prompts } = desk([reply(SHARED_OK, SUBJECT)]);
  assert.equal(await sum.runFor(SID), 'done');
  assert.equal(prompts.length, 1);
  assert.equal(db.docs.get('summary/en').text, SUBJECT);
});

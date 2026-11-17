// 连着重写的尺子（tools/summary-ruler-lib.mjs）：用假的课、假的回答把「取下一节 → 核 → 收 / 重来 / 不收 → 出表」走一遍。
// 真模型的那一趟结果在 evals/memory/results.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepsOf, emptyState, stepPrompt, applyAnswer, ruleWords, scoreState, scoreTable, RULE_WORDS } from '../tools/summary-ruler-lib.mjs';
import { judgeRewrite, retryPrompt, REWRITE_HEAD } from '../kit/src/memory/summary.js';

const ev = (id, session, at, extra = {}) => ({ id, session, at, src: 'answer', ...extra });
const data = () => ({
  sessions: [
    { id: 'c-2', space: 'en', subject: '英语', title: '时态', startedAt: 2000, date: '2026-11-02', status: 'closed' },
    { id: 'c-1', space: 'math', subject: '线代', title: '方阵的幂', startedAt: 1000, date: '2026-11-01', status: 'closed' },
    { id: 'c-3', space: 'en', subject: '英语', title: '从句', startedAt: 3000, date: '2026-11-03', status: 'closed' },
    { id: 'c-empty', space: 'cs', subject: '数据结构', title: '没上成', startedAt: 2500, date: '2026-11-02', status: 'closed' },
  ],
  evidence: [
    ev('e1', 'c-1', 1100, { src: 'say', text: '我用 iPad 和 Apple Pencil 写' }),
    ev('e2', 'c-1', 1200),
    ev('e3', 'c-2', 2100, { src: 'say', text: '别再一上来给我九句话，先给我结论' }),
    ev('e4', 'c-3', 3100, { src: 'say', text: '这个表格比上次清楚' }),
  ],
  turns: {
    'c-1': [{ seq: 1, role: 'student', say: '我用 iPad 和 Apple Pencil 写', text: '我用 iPad 和 Apple Pencil 写' }, { seq: 2, role: 'claude', text: '好。' }],
    'c-2': [{ seq: 1, role: 'student', say: '别再一上来给我九句话，先给我结论', text: '别再一上来给我九句话，先给我结论' }],
    'c-3': [{ seq: 1, role: 'student', say: '这个表格比上次清楚', text: '这个表格比上次清楚' }],
  },
  reports: {},
  rules: [{ id: 'rule-1', text: '每次都必须先复习三句', cat: '教法', status: 'active' }],
  lessons: [], asks: [], profile: [{ id: 'p1', topic: '目标', text: '考研目标是南京大学', status: 'active' }],
});
const reply = (shared, subject) => `<共用>\n${shared}\n</共用>\n<这一科>\n${subject}\n</这一科>`;

test('stepsOf：有证据的课照开课的先后排，没证据的不算', () => {
  assert.deepEqual(stepsOf(data()).map((s) => [s.n, s.sid, s.space]), [[1, 'c-1', 'math'], [2, 'c-2', 'en'], [3, 'c-3', 'en']]);
});

test('stepPrompt：用页面同一份提示词；这一科还没有摘要时带以前攒下的记录当原料，有了就不带', () => {
  const d = data();
  let state = emptyState();
  const p1 = stepPrompt(d, state, 1);
  assert.ok(p1.prompt.startsWith(REWRITE_HEAD));
  assert.match(p1.prompt, /以前一条条攒下的记录（原料）[\s\S]*每次都必须先复习三句/);
  assert.match(p1.prompt, /「我用 iPad 和 Apple Pencil 写」/);
  assert.equal(p1.space, 'math');
  state = applyAnswer(state, { ...p1, text: reply('学生的目标是南京大学，用 iPad 和 Apple Pencil 写。', '线代学到方阵的幂，这一块上过一节。') }).state;
  // 英语的第一节：英语那一份还空着，原料照带；共用那一份是上一步写的
  const p2 = stepPrompt(d, state, 2);
  assert.match(p2.prompt, /现在的摘要：共用\n\n学生的目标是南京大学/);
  assert.match(p2.prompt, /以前一条条攒下的记录（原料）/);
  state = applyAnswer(state, { ...p2, text: reply('学生的目标是南京大学，用 iPad 和 Apple Pencil 写。2026-11-02 说过「别再一上来给我九句话，先给我结论」。', '英语学到时态。') }).state;
  const p3 = stepPrompt(d, state, 3);
  assert.doesNotMatch(p3.prompt, /以前一条条攒下的记录（原料）/);
  assert.match(p3.prompt, /现在的摘要：这一科（英语）\n\n英语学到时态。/);
});

test('applyAnswer：收下就记这一步两份多少字节，摘要进到下一版', () => {
  const d = data();
  const p1 = stepPrompt(d, emptyState(), 1);
  const r = applyAnswer(emptyState(), { ...p1, text: reply('学生的目标是南京大学。', '线代学到方阵的幂。') });
  assert.equal(r.status, 'done');
  assert.equal(r.state.summary.shared.text, '学生的目标是南京大学。');
  assert.equal(r.state.summary.math.v, 1);
  const s = r.state.steps.at(-1);
  assert.deepEqual([s.n, s.sid, s.status, s.tries], [1, 'c-1', 'done', 1]);
  assert.equal(s.bytes.shared, new TextEncoder().encode('学生的目标是南京大学。').length);
  assert.equal(s.after.math, '线代学到方阵的幂。');
});

test('applyAnswer：引号对不上先要一次重来（给出重来的提示词），重来还对不上就不收、摘要原样', () => {
  const d = data();
  const p1 = stepPrompt(d, emptyState(), 1);
  const bad = reply('学生说过「以后每次讲课都不许超过三句话」。', '线代学到方阵的幂。');
  const r1 = applyAnswer(emptyState(), { ...p1, text: bad });
  assert.equal(r1.status, 'retry');
  assert.match(r1.retryPrompt, /以后每次讲课都不许超过三句话/);
  assert.equal(r1.state.summary.shared, null);
  const r2 = applyAnswer(r1.state, { ...p1, text: bad });
  assert.equal(r2.status, 'fail');
  assert.equal(r2.state.summary.shared, null);
  const s = r2.state.steps.at(-1);
  assert.deepEqual([s.status, s.tries, s.lost.length], ['fail', 2, 1]);
  // 重来改好了就收
  const r3 = applyAnswer(r1.state, { ...p1, text: reply('学生说过「我用 iPad 和 Apple Pencil 写」。', '线代学到方阵的幂。') });
  assert.equal(r3.status, 'done');
  assert.equal(r3.state.steps.at(-1).tries, 2);
});

test('applyAnswer：少一段、短了一半以上这类不让重来，直接不收', () => {
  const p1 = stepPrompt(data(), emptyState(), 1);
  const r = applyAnswer(emptyState(), { ...p1, text: '<共用>\n只有一段\n</共用>' });
  assert.equal(r.status, 'fail');
  assert.match(r.state.steps.at(-1).why, /这一科/);
});

test('ruleWords：数规矩词，引的学生原话里的不算，指出在哪一句', () => {
  const text = '学生习惯先看结论。老师每次都要先讲结论，必须用表格。\n学生说过「以后都别再给我九句话」，当时老师刚写了一大段。一律用白板这件事没有证据。';
  const hits = ruleWords(text);
  assert.deepEqual(hits.map((h) => h.word), ['每次都', '必须', '一律']);
  assert.match(hits[0].sentence, /老师每次都要先讲结论/);
  assert.deepEqual(RULE_WORDS, ['必须', '每次都', '一律', '务必', '以后都']);
  assert.deepEqual(ruleWords('学生是备考的研究生。'), []);
});

test('scoreState：每条事实从该出现的那一步起每一步在不在；没收的步、连着两次超长、找不到的引号都数出来', () => {
  const d = data();
  let state = emptyState();
  const run = (n, shared, subject) => { const p = stepPrompt(d, state, n); const r = applyAnswer(state, { ...p, text: reply(shared, subject) }); state = r.state; return r; };
  run(1, '学生的目标是南京大学，用 iPad 和 Apple Pencil 写。', '线代学到方阵的幂。');
  run(2, '学生的目标是南京大学。老师必须先讲结论。', '英语学到时态。');           // 丢了 iPad，长出一条规矩
  run(3, '学生的目标是南京大学，用 iPad 写。', '英语学到时态和从句。');
  const facts = [
    { id: 'goal', what: '目标院校', re: '南京大学', in: 'shared', from: 'c-1' },
    { id: 'ipad', what: '用 iPad 写', re: 'iPad', in: 'shared', from: 'c-1' },
    { id: 'tense', what: '英语学过时态', re: '时态', in: 'en', from: 'c-2' },
    { id: 'clause', what: '英语学过从句', re: '从句', in: 'any', from: 'c-3' },
  ];
  const sc = scoreState(state, facts);
  assert.deepEqual(sc.facts.map((f) => [f.id, f.lostAt]), [['goal', []], ['ipad', [2]], ['tense', []], ['clause', []]]);
  assert.equal(sc.factsLost, 1);
  assert.equal(sc.rejected, 0);
  assert.equal(sc.doubleOver, false);
  assert.equal(sc.lostQuotes, 0);
  // 规矩词按最后一版数；每一步的也留着
  assert.equal(sc.words.length, 0);
  assert.equal(sc.rows[1].words, 1);
  const table = scoreTable(sc);
  assert.match(table, /\| 2 \| c-2 \| en \|/);
  assert.match(table, /ipad[^\n]*第 2 步/);
});

test('judgeRewrite / retryPrompt：页面和尺子用的是同一套核法', () => {
  const prompt = '## 这节课里学生打的每一句\n\n- 「别再一上来给我九句话」';
  const ok = judgeRewrite({ text: reply('学生说过「别再一上来给我九句话」。', '英语学到时态。'), prompt, space: 'en', shared: null, subject: null });
  assert.deepEqual([ok.bad, ok.lost, ok.over], [[], [], []]);
  const lost = judgeRewrite({ text: reply('学生说过「不许再给我九句话了」。', '英语学到时态。'), prompt, space: 'en', shared: null, subject: null });
  assert.equal(lost.fixable, true);
  assert.deepEqual(lost.lost, ['不许再给我九句话了']);
  assert.equal(lost.bad.length, 1);
  const again = retryPrompt({ prompt, text: 'X', over: [], lost: lost.lost });
  assert.ok(again.startsWith(prompt));
  assert.match(again, /你上一次写的（引号里的话对不上记录）/);
  const long = judgeRewrite({ text: reply('长'.repeat(1400), '英语学到时态。'), prompt, space: 'en', shared: null, subject: null });
  assert.equal(long.over.length, 1);
  assert.equal(long.fixable, true);
  assert.match(retryPrompt({ prompt, text: 'X', over: long.over, lost: [] }), /你上一次写的（太长了）/);
  const broken = judgeRewrite({ text: '<共用>\n一段\n</共用>', prompt, space: 'en', shared: null, subject: null });
  assert.equal(broken.fixable, false);
  assert.match(broken.bad.join('；'), /这一科/);
});

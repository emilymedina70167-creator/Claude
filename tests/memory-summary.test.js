import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUMMARY_MAX, NOTES_MAX, HISTORY_MAX, REWRITE_HEAD, QUIET_MS,
  summaryOf, summaryOn, summaryText, noteOf, addNote, nextDoc, rollback,
  rewritePrompt, parseRewrite, checkRewrite, legacyText, needsRewrite, maxOf, utf8,
} from '../kit/src/memory/summary.js';
import { COLLECTIONS, canWrite } from '../kit/src/memory/schema.js';

const mem = {
  summary: [
    { id: 'shared', text: '学生在备考 2027 年考研，目标南京大学。', v: 2, notes: [] },
    { id: 'en', text: '英语用《语法长难句》那本书，按语法模块学。', v: 1, notes: [{ text: '11-16 读了十分钟以后来了 9 句每句写三样，学生叫停', quote: '换一个高效点的测验，这个完全量大堆', at: Date.UTC(2026, 10, 16, 14, 30), by: 'class' }] },
  ],
};

test('按科取两份；有一份有字就算有摘要', () => {
  const en = summaryOf(mem, 'en');
  assert.equal(en.shared.id, 'shared');
  assert.equal(en.subject.id, 'en');
  assert.equal(en.on, true);
  const cs = summaryOf(mem, 'cs');
  assert.equal(cs.subject, null);
  assert.equal(cs.on, true); // 共用那份有字
  assert.equal(summaryOf({}, 'en').on, false);
  assert.equal(summaryOf({ summary: [{ id: 'en', text: '  ' }] }, 'en').on, false);
  assert.equal(summaryOn(mem), true);
  assert.equal(summaryOn({ summary: [] }), false);
});

test('给老师看的那一节：标明是背景、两份各一小节、新笔记带原话', () => {
  const { shared, subject } = summaryOf(mem, 'en');
  const t = summaryText([shared, subject]);
  assert.match(t, /^## 你对这个学生的了解（记忆摘要）/);
  assert.match(t, /不是规程，怎么教由你当场判断/);
  assert.match(t, /### 三科共用\n\n学生在备考/);
  assert.match(t, /### 英语\n\n英语用/);
  assert.match(t, /### 还没并进摘要的新笔记/);
  assert.match(t, /学生的原话「换一个高效点的测验，这个完全量大堆」/);
  assert.doesNotMatch(t, /以它为准|每一条都要做到/);
});

test('发给老师的字里不称他、她', () => {
  const t = summaryText([{ id: 'shared', text: '她喜欢先看例子，他说过不要铺垫。其他照旧。', notes: [] }]);
  assert.doesNotMatch(t, /(?<![其])[他她]/);
  assert.match(t, /其他照旧/);
});

test('新笔记：说的是同一件事不收；满了丢最早的；这一份还没有时造一条', () => {
  const a = addNote(null, noteOf({ text: '学生说例句的译文要另起一行', at: 1 }), { id: 'en' });
  assert.equal(a.added, true);
  assert.equal(a.doc.id, 'en');
  assert.equal(a.doc.notes.length, 1);
  const b = addNote(a.doc, noteOf({ text: '学生说例句的译文要另起一行写', at: 2 }));
  assert.equal(b.added, false);
  let doc = a.doc;
  for (let i = 0; i < NOTES_MAX + 3; i++) doc = addNote(doc, noteOf({ text: `第 ${i} 件完全不同的事：${'甲乙丙丁戊己庚辛壬癸'[i % 10]}${i * 7919}`, at: 10 + i })).doc;
  assert.equal(doc.notes.length, NOTES_MAX);
  assert.ok(doc.notes[0].at > 1);
  assert.equal(addNote(doc, { text: '  ' }).added, false);
  assert.ok(noteOf({ text: '字'.repeat(900) }).text.length <= 300);
});

test('新的一版：版本加一，旧版进 history，重写开始以后加的笔记留着', () => {
  const prev = { id: 'en', text: '旧的', at: 100, by: 'page', v: 3, notes: [{ text: '早的', at: 150 }, { text: '重写途中才记的', at: 250 }], history: [{ text: '更旧的', at: 50, by: 'chat', v: 2 }] };
  const d = nextDoc(prev, { text: '新的全文', by: 'page', at: 300, startedAt: 200 });
  assert.equal(d.v, 4);
  assert.equal(d.text, '新的全文');
  assert.deepEqual(d.history.map((h) => h.v), [3, 2]);
  assert.deepEqual(d.notes.map((n) => n.text), ['重写途中才记的']);
  // 学生自己改的：笔记不动
  assert.equal(nextDoc(prev, { text: '我改的', by: 'me', at: 400 }).notes.length, 2);
  // history 只留最近几版
  let cur = prev;
  for (let i = 0; i < HISTORY_MAX + 4; i++) cur = nextDoc(cur, { text: `第 ${i} 版`, at: 500 + i, startedAt: 0 });
  assert.equal(cur.history.length, HISTORY_MAX);
  // 第一版：没有旧的，history 是空的
  assert.deepEqual(nextDoc(null, { id: 'cs', text: '第一版', at: 1 }).history, []);
});

test('退回上一版', () => {
  const d = nextDoc({ id: 'en', text: '甲', at: 1, by: 'page', v: 1, notes: [], history: [] }, { text: '乙', at: 2 });
  const back = rollback(d, { at: 3 });
  assert.equal(back.text, '甲');
  assert.equal(back.by, 'me');
  assert.equal(back.v, 3);
  assert.equal(back.history[0].text, '乙');
  assert.equal(rollback({ id: 'en', text: '甲', history: [] }), null);
});

test('重写的提示词：不许推广成规矩、有上限、带材料、不称他她', () => {
  const p = rewritePrompt({ space: 'en', shared: mem.summary[0], subject: mem.summary[1], transcript: '第 1 轮 老师：……', said: [{ at: Date.UTC(2026, 10, 16), text: '不测了，继续' }], report: '3 道题对 2 道', today: '2026-11-17', title: '情态' });
  assert.ok(p.startsWith(REWRITE_HEAD));
  assert.match(p, /不把学生的一句话推广成规矩/);
  assert.match(p, /不是规程/);
  assert.match(p, /<共用>[\s\S]*<这一科>/);
  assert.match(p, /「不测了，继续」/);
  assert.match(p, /还没并进摘要的新笔记/);
  assert.match(p, /不超过 1300 个字[\s\S]*不超过 2700 个字/);
  // 我写的那部分（材料以前）除了「不用『他』『她』」那一句以外不称他、她
  assert.doesNotMatch(p.split('\n## ')[0].replace('「他」「她」', ''), /(?<![其吉利])[他她](?![们人])/);
  // 班主任的对话：只重写共用
  const c = rewritePrompt({ shared: mem.summary[0], transcript: '学生：……' });
  assert.doesNotMatch(c, /<这一科>/);
  // 第一次：带原料那一段说明
  assert.match(rewritePrompt({ space: 'en', legacy: '### 规则\n\n- 一条' }), /当原料用[\s\S]*以前一条条攒下的记录/);
});

test('读回：两段都要；少一段报问题', () => {
  const ok = parseRewrite('<共用>\n甲\n</共用>\n<这一科>\n乙\n乙二\n</这一科>');
  assert.deepEqual(ok, { shared: '甲', subject: '乙\n乙二', problems: [] });
  assert.equal(parseRewrite('<共用>甲</共用>').problems.length, 1);
  assert.equal(parseRewrite('<共用>甲</共用>', { both: false }).problems.length, 0);
  assert.equal(parseRewrite('好的，我来重写。').problems.length, 2);
});

test('核：空的、超上限的、短了一半以上的不收', () => {
  assert.equal(checkRewrite({ prev: '', next: '', id: 'shared' }).ok, false);
  assert.equal(checkRewrite({ prev: '', next: '字'.repeat(1400), id: 'shared' }).ok, false);
  assert.equal(checkRewrite({ prev: '', next: '字'.repeat(1400), id: 'en' }).ok, true);
  assert.equal(checkRewrite({ prev: '字'.repeat(1000), next: '字'.repeat(400), id: 'en' }).ok, false);
  assert.equal(checkRewrite({ prev: '字'.repeat(1000), next: '字'.repeat(600), id: 'en' }).ok, true);
  assert.equal(maxOf('shared'), SUMMARY_MAX.shared);
  assert.equal(maxOf('cs'), SUMMARY_MAX.subject);
  assert.equal(utf8('字'), 3);
});

test('第一次的原料：只带这一科的和全科的；管记录的规则、作废的不带', () => {
  const t = legacyText({
    rules: [
      { id: 'rule-a', cat: '讲解', text: '讲法自造', status: 'active' },
      { id: 'rule-b', cat: '细则', text: '错题只增不改', status: 'active', use: 'record' },
      { id: 'rule-c', cat: '黑板', text: '作废的那条', status: 'void' },
      { id: 'rule-d', cat: '来源', text: '数学的教材是张宇', status: 'active', space: 'math' },
    ],
    lessons: [{ id: 'T-1', text: '判错之前先看清写的是什么', status: 'active' }, { id: 'T-2', text: '退役的', status: 'retired' }],
    asks: [{ id: 'A-1', text: '开场复习最多两三句', status: 'active', quotes: [{ at: Date.UTC(2026, 10, 5), text: '直接开始学新内容' }] }, { id: 'A-2', text: '只管数学的', status: 'active', scope: 'math', quotes: [] }],
    profile: [{ id: 'p-goal', topic: '目标', text: '她想考南大' }],
  }, 'en');
  assert.match(t, /讲法自造/);
  assert.doesNotMatch(t, /错题只增不改|作废的那条|张宇|退役的|只管数学的/);
  assert.match(t, /「直接开始学新内容」/);
  assert.match(t, /学生想考南大/);
});

test('这节课要不要重写：有新的证据、静下来了、没试满', () => {
  const s = { id: 'c-1', kind: 'class' };
  const now = 10 * 60 * 1000;
  const ev = (at) => [{ session: 'c-1', at }, { session: 'c-2', at: now }];
  assert.equal(needsRewrite(s, { evidence: ev(1000), now }), true);
  assert.equal(needsRewrite(s, { evidence: ev(now - QUIET_MS + 1000), now }), false); // 还有动静
  assert.equal(needsRewrite({ ...s, sum: { upTo: 1000 } }, { evidence: ev(1000), now }), false); // 没有新的
  assert.equal(needsRewrite({ ...s, sum: { upTo: 500, fails: 2, failUpTo: 1000 } }, { evidence: ev(1000), now }), false); // 试满了
  assert.equal(needsRewrite({ ...s, sum: { upTo: 500, fails: 2, failUpTo: 800 } }, { evidence: ev(1000), now }), true); // 又有新的
  assert.equal(needsRewrite({ ...s, kind: 'drill' }, { evidence: ev(1000), now }), false);
  assert.equal(needsRewrite({ ...s, deleting: true }, { evidence: ev(1000), now }), false);
  assert.equal(needsRewrite(s, { evidence: [], now }), false);
});

test('记忆库多一类 summary：页面、课堂、我、开发都能写', () => {
  assert.equal(COLLECTIONS.summary.label, '记忆摘要');
  for (const who of ['page', 'class', 'me', 'chat']) assert.equal(canWrite(who, 'summary'), true);
  assert.ok(COLLECTIONS.summary.id.re.test('shared'));
  assert.ok(!COLLECTIONS.summary.id.re.test('x'));
});

test('摘要开始有以前的课不回头并', async () => {
  const { sinceOf } = await import('../kit/src/memory/summary.js');
  assert.equal(sinceOf({}), 0);
  assert.equal(sinceOf({ summary: [{ id: 'shared', since: 5000 }, { id: 'en', since: 3000 }, { id: 'cs' }] }), 3000);
  const s = { id: 'c-1', kind: 'class' };
  const now = 10 * 60 * 1000;
  assert.equal(needsRewrite(s, { evidence: [{ session: 'c-1', at: 1000 }], now, since: 3000 }), false);
  assert.equal(needsRewrite(s, { evidence: [{ session: 'c-1', at: 1000 }, { session: 'c-1', at: 4000 }], now, since: 3000 }), true);
  // 第一版记下 since，以后的版本不变；当场记出来的那一份也有
  const d1 = nextDoc(null, { id: 'en', text: '甲', at: 100 });
  assert.equal(d1.since, 100);
  assert.equal(nextDoc(d1, { text: '乙', at: 900 }).since, 100);
  assert.equal(addNote(null, noteOf({ text: '一条', at: 77 }), { id: 'cs' }).doc.since, 77);
});

// 课后收尾的工具（tools/ext-wrap.mjs）的纯函数：排编号、配撤销记录、分批、写完核对。不替主讲定任何内容
import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapPlan, splitBatches, wrapVerify } from '../tools/ext-wrap-lib.js';
import { undoJournal } from '../kit/src/project/journal.js';

const NOW = 1795830000000; // 2026-11-28（北京时间）
const rand = () => { let k = 1; return () => ((k = (k * 48271) % 2147483647) / 2147483647); };
const plan = (input, have = {}, versions = {}) => wrapPlan({ input: { sid: 'c-20261128-1', space: 'en', date: '2026-11-28', ...input }, have, versions, now: NOW, rand: rand() });
const real = (w) => w.filter((x) => x.collection !== 'journal');
const journals = (w) => w.filter((x) => x.collection === 'journal');

test('空清单：什么都不写、没有提醒', () => {
  assert.deepEqual(plan({}), { writes: [], warnings: [] });
});

test('mastery 改已有的：log 多一条、带版本号，撤销记录能把整条写回去', () => {
  const old = { id: 'EN-G9.1', block: 'EN-G9.1', state: '讲过', note: '旧', basis: [], log: [{ by: 'page', field: 'state', from: null, to: '讲过' }] };
  const r = plan({ mastery: [{ block: 'EN-G9.1', state: '基础题过', note: '当堂四句对三句', basis: ['ev-1'] }] }, { mastery: [old], curriculum: [{ id: 'EN-G9.1' }] }, { 'mastery/EN-G9.1': 3 });
  assert.deepEqual(r.warnings, []);
  const [w] = real(r.writes), [j] = journals(r.writes);
  assert.equal(w.op, 'update'); assert.equal(w.doc_id, 'EN-G9.1'); assert.equal(w.if_version, 3);
  assert.equal(w.data.state, '基础题过'); assert.equal(w.data.note, '当堂四句对三句');
  assert.equal(w.data.log.length, 2);
  assert.deepEqual(w.data.log[1], { basis: ['ev-1'], by: 'chat', date: '2026-11-28', field: 'state', from: '讲过', to: '基础题过', note: '当堂四句对三句' });
  assert.match(j.doc_id, /^j-[0-9a-z]+-[0-9a-z]{5}$/);
  assert.equal(j.data.path, 'mastery/EN-G9.1'); assert.equal(j.data.by, 'ext'); assert.equal(j.data.at, NOW);
  assert.deepEqual(j.data.before, old, '撤销是把 before 整条写回去：只记一个 state 的话撤销会把别的栏都抹掉');
  assert.equal(j.data.after.state, '基础题过'); assert.equal(j.data.after.log.length, 2);
  assert.deepEqual(undoJournal(j.data), { op: 'set', path: 'mastery/EN-G9.1', data: old });
});

test('mastery 从复现通过降下来：档位跟着清掉（和手写的做法一样）', () => {
  const old = { id: 'B', block: 'B', state: '复现通过', tier: 3, log: [] };
  const [w] = real(plan({ mastery: [{ block: 'B', state: '基础题过', note: 'n' }] }, { mastery: [old] }, { 'mastery/B': 1 }).writes);
  assert.equal(w.data.tier, null);
  assert.deepEqual(w.data.log.map((l) => l.field), ['state', 'tier']);
});

test('mastery 新建：set，不带版本号，撤销是删掉', () => {
  const r = plan({ mastery: [{ block: 'EN-G9.2', state: '讲过', note: 'n' }] }, { curriculum: [{ id: 'EN-G9.2' }] });
  const [w] = real(r.writes), [j] = journals(r.writes);
  assert.equal(w.op, 'set'); assert.equal(w.if_version, undefined);
  assert.equal(w.data.block, 'EN-G9.2'); assert.equal(w.data.log[0].from, null);
  assert.equal(j.data.before, null);
});

test('提醒只是提醒，照样生成：缺版本号、block 不在课程地图、state 不认识、不认识的栏', () => {
  const r = plan({ mastery: [{ block: 'X-1', state: '会了', note: 'n' }], homework: [] }, { mastery: [{ id: 'X-1', state: '讲过', log: [] }], curriculum: [{ id: 'EN-G9.1' }] });
  const all = r.warnings.join('\n');
  assert.match(all, /mastery\/X-1 是已有文档，没给版本号：写入会被拒/);
  assert.match(all, /X-1 不在课程地图里/);
  assert.match(all, /「会了」不是掌握状态的取值/);
  assert.match(all, /不认识的栏：homework/);
  assert.equal(real(r.writes).length, 1);
  assert.equal(real(r.writes)[0].if_version, undefined);
});

test('slips 的编号接着当天已有的排；by、日期、课号自己填', () => {
  const r = plan({ slips: [{ text: '题面带出了答案', lesson: '发之前逐题看' }, { text: 't2' }] }, { slips: [{ id: 'S-20261128-2' }, { id: 'S-20261127-9' }, { id: 'S-20261128-1-7' }] });
  const ws = real(r.writes);
  assert.deepEqual(ws.map((w) => w.doc_id), ['S-20261128-3', 'S-20261128-4']);
  assert.deepEqual(ws[0].data, { id: 'S-20261128-3', by: 'ext', date: '2026-11-28', space: 'en', session: 'c-20261128-1', text: '题面带出了答案', lesson: '发之前逐题看' });
  assert.equal(ws[0].op, 'set');
});

test('recall 接着最大的编号排，从第 1 天那档开始', () => {
  const r = plan({ recall: [{ q: 'q1', a: 'a1', block: 'EN-G9.1' }, { q: 'q2', a: 'a2' }, { q: 'q3', a: 'a3' }] }, { recall: [{ id: 'K252' }, { id: 'K9' }] });
  const ws = real(r.writes);
  assert.deepEqual(ws.map((w) => w.doc_id), ['K253', 'K254', 'K255']);
  const d = ws[0].data;
  assert.equal(d.tier, 1); assert.equal(d.status, 'active'); assert.equal(d.last, '2026-11-28'); assert.equal(d.lapses, 0);
  assert.equal(d.space, 'en'); assert.equal(d.session, 'c-20261128-1'); assert.equal(d.block, 'EN-G9.1');
  assert.equal('block' in ws[1].data, false);
});

test('summary 写成一条课后小结的观察：四节照给的原样放，不改写', () => {
  const r = plan({ summary: { title: '语法第 9 节', block: 'EN-G9.1', taught: '讲了 A', stuck: '卡在 B', thin: '证据 C', next: '接 D' } });
  const [w] = real(r.writes);
  assert.equal(w.collection, 'observations'); assert.match(w.doc_id, /^ob-[0-9a-z]+-[0-9a-z]{5}$/);
  assert.equal(w.data.kind, 'summary'); assert.equal(w.data.by, 'ext'); assert.equal(w.data.session, 'c-20261128-1'); assert.equal(w.data.at, NOW); assert.equal(w.data.block, 'EN-G9.1');
  assert.equal(w.data.text, '# 课后小结（c-20261128-1，语法第 9 节）\n\n## 1. 这节课讲了什么\n讲了 A\n\n## 2. 学生哪里卡住\n卡在 B\n\n## 3. 看起来懂了但证据不够\n证据 C\n\n## 4. 下一节怎么接\n接 D');
});

test('notes 追加进这一科的摘要，原来的留着', () => {
  const old = { id: 'en', text: '学到哪', notes: [{ text: '旧', at: 1 }], v: 2 };
  const r = plan({ notes: [{ text: '从中文意思反推词性管用', quote: '我只知道意思' }] }, { summary: [old] }, { 'summary/en': 10 });
  const [w] = real(r.writes), [j] = journals(r.writes);
  assert.equal(w.op, 'update'); assert.equal(w.collection, 'summary'); assert.equal(w.doc_id, 'en'); assert.equal(w.if_version, 10);
  assert.deepEqual(w.data.notes, [{ text: '旧', at: 1 }, { at: NOW, by: 'ext', session: 'c-20261128-1', text: '从中文意思反推词性管用', quote: '我只知道意思' }]);
  assert.equal('text' in w.data, false, '「学到哪」是主讲自己写的，工具不碰');
  assert.deepEqual(j.data.before, old);
});

test('分批：一批最多 50 条，一条改动和它的撤销记录不拆开', () => {
  const r = plan({ recall: Array.from({ length: 60 }, (_, i) => ({ q: `q${i}`, a: `a${i}` })) });
  assert.equal(r.writes.length, 120);
  const bs = splitBatches(r.writes);
  assert.deepEqual(bs.map((b) => b.length), [50, 50, 20]);
  for (const b of bs) for (let i = 0; i < b.length; i += 2) assert.equal(b[i + 1].data.path, `${b[i].collection}/${b[i].doc_id}`);
  assert.equal(new Set(r.writes.map((w) => `${w.collection}/${w.doc_id}`)).size, 120, '编号不重');
  // 奇数的批量上限也不拆
  assert.deepEqual(splitBatches(r.writes.slice(0, 8), 5).map((b) => b.length), [4, 4]);
});

test('写完核对：没写上的、写了但内容不一样的都列出来', () => {
  const r = plan({ recall: [{ q: 'q1', a: 'a1' }, { q: 'q2', a: 'a2' }], slips: [{ text: 't' }] });
  const ws = real(r.writes);
  const have = { recall: [{ id: 'K1', ...ws.find((w) => w.doc_id === 'K1').data }, { id: 'K2', ...ws.find((w) => w.doc_id === 'K2').data, a: '被改了' }], slips: [], journal: journals(r.writes).slice(0, 1).map((j) => ({ id: j.doc_id, ...j.data })) };
  const v = wrapVerify({ writes: r.writes, have });
  assert.ok(v.ok.includes('recall/K1'));
  assert.ok(v.missing.some((m) => /^recall\/K2：a 和要写的不一样/.test(m)));
  assert.ok(v.missing.some((m) => /^slips\/S-20261128-1：没有这一条/.test(m)));
  assert.equal(v.ok.length + v.missing.length, r.writes.length);
});

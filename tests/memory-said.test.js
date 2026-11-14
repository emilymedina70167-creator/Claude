// 第十一轮 A1：话的账（kit/src/memory/said.js）。例子用 2026-11-05 到 11-14 我真打过的句子
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saidItems, saidPrompt, parseSaid, planSaid, saidRecord, SAID_VERSION } from '../kit/src/memory/said.js';

const ev = (id, text, at, session = 'c-14') => ({ id, src: 'say', kind: 'say', text, at, session });
const A1 = { id: 'A-1', text: '开场复习最多两三句，主要时间给新内容', quotes: [{ ev: 'ev-old', at: 100, session: 'c-12', text: '够了，我要学新内容' }], status: 'active', since: '2026-11-12', scope: 'all', checks: [], broken: 0 };

test('只有文字的进 items、只有图的进 photos，水位线以前的不要', () => {
  const evidence = [
    ev('ev-0', '以前的', 5),
    ev('ev-a', '只做2-3句就行啊，这是来学新内容还是来复习的？', 20),
    ev('ev-b', '（在画面上用 Pencil 写了字）', 30),
    ev('ev-c', '过去完成时 （在画面上用 Pencil 写了字）', 40),
    { id: 'ev-d', src: 'say', kind: 'photo', text: '', images: ['x'], at: 50, session: 'c-14' },
    ev('ev-e', '别的课', 60, 'c-99'),
    { id: 'ev-f', src: 'record', text: 'x', at: 70, session: 'c-14' },
  ];
  const { items, photos } = saidItems(evidence, 'c-14', 10);
  assert.deepEqual(items.map((x) => x.ev), ['ev-a', 'ev-c']);
  assert.equal(items[1].text, '过去完成时');
  assert.deepEqual(photos, ['ev-b', 'ev-d']);
});

test('提示词里每句都有编号、有现在的要求、没有他她', () => {
  const items = [{ ev: 'ev-a', at: 20, text: '只做2-3句就行啊' }, { ev: 'ev-c', at: 40, text: '你重叠这件事情要犯几次？' }];
  const turns = [{ seq: 1, role: 'claude', at: 10, text: '我们先复习十二句' }, { seq: 2, role: 'claude', at: 30, text: '好的，今天只做三句' }];
  const p = saidPrompt({ items, asks: [A1], profile: [{ id: 'p-goal', topic: '目标', text: '考研数学' }], lessons: [{ id: 'T-1', text: '先讲完再出题' }], turns });
  for (const id of ['ev-a', 'ev-c', 'A-1', '开场复习最多两三句', '我们先复习十二句', '好的，今天只做三句']) assert.ok(p.includes(id), id);
  assert.ok(!/[他她]/.test(p));
});

test('读回：一条消息两个去处', () => {
  const r = parseSaid('ev-a｜新要求｜text=开场复习最多两三句｜scope=all\nev-a｜不用记｜why=反问', { ids: new Set(['ev-a']), asks: [] });
  assert.equal(r.lines['ev-a'].length, 2);
  assert.deepEqual(r.lines['ev-a'].map((l) => l.to), ['new', 'skip']);
  assert.equal(r.lines['ev-a'][0].scope, 'all');
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.problems, []);
});

test('读回：漏了的进 missing、编的编号不收', () => {
  const r = parseSaid('ev-a｜不用记｜why=提问\nev-zz｜不用记｜why=编的', { ids: new Set(['ev-a', 'ev-b']), asks: [] });
  assert.deepEqual(r.missing, ['ev-b']);
  assert.equal(r.problems.length, 1);
  assert.ok(r.problems[0].includes('ev-zz'));
});

test('读回：指着没有的、不在用的要求不收；新要求没写 text 不收', () => {
  const r = parseSaid('ev-a｜又说了｜A-9｜why=没照做\nev-b｜已记｜A-2\nev-c｜新要求', { ids: new Set(['ev-a', 'ev-b', 'ev-c']), asks: [A1, { ...A1, id: 'A-2', status: 'replaced' }] });
  assert.equal(r.problems.length, 3);
  assert.deepEqual(r.missing.sort(), ['ev-a', 'ev-b', 'ev-c']);
});

test('新要求的原话是页面抄的', () => {
  const items = [{ ev: 'ev-a', at: 20, text: '只做2-3句就行啊，这是来学新内容还是来复习的？' }];
  const parsed = parseSaid('ev-a｜新要求｜text=开场复习最多两三句｜scope=all', { ids: new Set(['ev-a']), asks: [] });
  const plan = planSaid(parsed, { items, asks: [], sid: 'c-14', startedAt: 10, today: '2026-11-14' });
  assert.equal(plan.asks.length, 1);
  assert.equal(plan.asks[0].id, 'A-1');
  assert.equal(plan.asks[0].op, 'add');
  assert.equal(plan.asks[0].doc.quotes[0].text, items[0].text);
  assert.equal(plan.asks[0].doc.status, 'active');
  assert.equal(plan.asks[0].doc.since, '2026-11-14');
});

test('说第二遍算没做到、附和不算、这节课刚建的不算', () => {
  const items = [{ ev: 'ev-x', at: 500, text: '直接进入新内容学习' }];
  const ids = new Set(['ev-x']);
  const miss = planSaid(parseSaid('ev-x｜又说了｜A-1｜why=没照做', { ids, asks: [A1] }), { items, asks: [A1], sid: 'c-14', startedAt: 400, today: '2026-11-14' });
  assert.equal(miss.broken.length, 1);
  assert.equal(miss.asks[0].doc.quotes.length, 2);
  const echo = planSaid(parseSaid('ev-x｜又说了｜A-1｜why=附和', { ids, asks: [A1] }), { items, asks: [A1], sid: 'c-14', startedAt: 400, today: '2026-11-14' });
  assert.equal(echo.broken.length, 0);
  // 同一节课里先说出来（第一次过账建了 A-1），过一会儿又说了一遍：这节课才有的要求，不算没做到
  const first = planSaid(parseSaid('ev-p｜新要求｜text=只做两三句', { ids: new Set(['ev-p']), asks: [] }), { items: [{ ev: 'ev-p', at: 410, text: '只做2-3句' }], asks: [], sid: 'c-14', startedAt: 400, today: '2026-11-14' });
  const made = { id: first.asks[0].id, ...first.asks[0].doc };
  const again = planSaid(parseSaid('ev-q｜又说了｜A-1｜why=没照做', { ids: new Set(['ev-q']), asks: [made] }), { items: [{ ev: 'ev-q', at: 420, text: '我说了只做三句' }], asks: [made], sid: 'c-14', startedAt: 400, today: '2026-11-14' });
  assert.equal(again.broken.length, 0);
  assert.equal(again.asks[0].doc.quotes.length, 2);
});

test('同一句不重复加进原话', () => {
  const withX = { ...A1, quotes: [...A1.quotes, { ev: 'ev-x', at: 500, session: 'c-14', text: '直接进入新内容学习' }] };
  const plan = planSaid(parseSaid('ev-x｜已记｜A-1', { ids: new Set(['ev-x']), asks: [withX] }), { items: [{ ev: 'ev-x', at: 500, text: '直接进入新内容学习' }], asks: [withX], sid: 'c-14', startedAt: 400, today: '2026-11-14' });
  assert.equal(plan.asks.length, 0);
});

test('改了：旧的被换掉、原话接过去', () => {
  const items = [{ ev: 'ev-y', at: 600, text: '话框是主要内容，你却放在了角落，而且我不喜欢有边框' }];
  const plan = planSaid(parseSaid('ev-y｜改了｜A-1｜text=话框是主角，放中间，不要边框', { ids: new Set(['ev-y']), asks: [A1] }), { items, asks: [A1], sid: 'c-14', startedAt: 400, today: '2026-11-14' });
  const old = plan.asks.find((a) => a.id === 'A-1');
  const neu = plan.asks.find((a) => a.id === 'A-2');
  assert.equal(old.doc.status, 'replaced');
  assert.equal(old.doc.into, 'A-2');
  assert.ok(old.doc.log.some((l) => l.field === 'status' && l.to === 'replaced'));
  assert.equal(neu.doc.quotes.length, A1.quotes.length + 1);
  assert.equal(neu.doc.text, '话框是主角，放中间，不要边框');
});

test('不用了、关于我、这一次、不用记各去各处', () => {
  const items = [{ ev: 'e1', at: 1, text: '现在可以多做几道了' }, { ev: 'e2', at: 2, text: '下个月期末，只有周末有空' }, { ev: 'e3', at: 3, text: '那这节课先到这' }, { ev: 'e4', at: 4, text: 'readers是读者的意思吗？' }];
  const parsed = parseSaid('e1｜不用了｜A-1｜why=现在想多练\ne2｜关于我｜topic=时间｜text=下个月期末，只有周末有空\ne3｜这一次｜text=这节课到这里结束\ne4｜不用记｜why=问词义', { ids: new Set(['e1', 'e2', 'e3', 'e4']), asks: [A1] });
  const plan = planSaid(parsed, { items, asks: [A1], sid: 'c-14', startedAt: 0, today: '2026-11-14' });
  assert.equal(plan.asks[0].doc.status, 'dropped');
  assert.equal(plan.asks[0].doc.why, '现在想多练');
  assert.deepEqual(plan.profile, [{ topic: '时间', text: '下个月期末，只有周末有空', ev: 'e2' }]);
  assert.deepEqual(plan.once, [{ text: '这节课到这里结束', ev: 'e3' }]);
});

test('五句「直接学新内容」并成一条', () => {
  let asks = [];
  const batches = [
    ['c-05', [['b1', '直接开始学新内容', '新要求｜text=开场复习最多两三句，主要时间给新内容｜scope=all']]],
    ['c-12', [['b2', '不会操作，够了，我要学新内容', '又说了｜A-1｜why=没照做']]],
    ['c-14', [['b3', '只做2-3句就行啊', '又说了｜A-1｜why=没照做'], ['b4', '算了，进入新内容的学习', '又说了｜A-1｜why=没照做'], ['b5', '直接进入新内容学习', '又说了｜A-1｜why=没照做']]],
  ];
  let t = 0;
  for (const [sid, rows] of batches) {
    const items = rows.map(([id, text]) => ({ ev: id, at: (t += 10), text }));
    const parsed = parseSaid(rows.map(([id, , out]) => `${id}｜${out}`).join('\n'), { ids: new Set(rows.map((r) => r[0])), asks });
    const plan = planSaid(parsed, { items, asks, sid, startedAt: items[0].at - 1, today: '2026-11-14' });
    const byId = new Map(asks.map((a) => [a.id, a]));
    for (const a of plan.asks) byId.set(a.id, { id: a.id, ...a.doc });
    asks = [...byId.values()];
  }
  const live = asks.filter((a) => a.status === 'active');
  assert.equal(live.length, 1);
  assert.equal(live[0].quotes.length, 5);
});

test('水位线停在缺的那句前面，照片也有去处', () => {
  const items = [{ ev: 'ev-a', at: 10, text: 'a' }, { ev: 'ev-b', at: 20, text: 'b' }, { ev: 'ev-c', at: 30, text: 'c' }];
  const rec = saidRecord({ prev: null, items, photos: ['ev-p'], lines: { 'ev-a': [{ to: 'skip' }], 'ev-c': [{ to: 'skip' }] }, missing: ['ev-b'], once: [], at: 99 });
  assert.equal(rec.upTo, 10);
  assert.deepEqual(rec.missing, ['ev-b']);
  assert.deepEqual(rec.lines['ev-p'], [{ to: 'photo' }]);
  assert.equal(rec.v, SAID_VERSION);
  // 下一次补上了：合进上一份，水位线到最后
  const rec2 = saidRecord({ prev: rec, items: [{ ev: 'ev-b', at: 20, text: 'b' }], photos: [], lines: { 'ev-b': [{ to: 'once', text: '这次' }] }, missing: [], once: [{ text: '这次', ev: 'ev-b' }], at: 100 });
  assert.equal(rec2.upTo, 30);
  assert.deepEqual(rec2.missing, []);
  assert.equal(Object.keys(rec2.lines).length, 4);
  assert.deepEqual(rec2.once, [{ text: '这次', ev: 'ev-b' }]);
});

test('同一批里指着刚记成新要求的那句（还没有编号）', () => {
  const items = [{ ev: 'ev-a', at: 10, text: '能不能把内容弄好再展现给我看？' }, { ev: 'ev-b', at: 20, text: '为什么老是有两个星号' }];
  const parsed = parseSaid('ev-a｜新要求｜text=内容先弄好再展示｜scope=all\nev-b｜已记｜ev-a', { ids: new Set(['ev-a', 'ev-b']), asks: [] });
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.missing, []);
  const plan = planSaid(parsed, { items, asks: [], sid: 'c-1', startedAt: 0, today: '2026-11-14' });
  assert.equal(plan.asks.length, 1);
  assert.deepEqual(plan.asks[0].doc.quotes.map((q) => q.ev), ['ev-a', 'ev-b']);
  // 指着这一批里没记成新要求的那句：不收
  const bad = parseSaid('ev-a｜不用记｜why=x\nev-b｜已记｜ev-a', { ids: new Set(['ev-a', 'ev-b']), asks: [] });
  assert.equal(bad.problems.length, 1);
});

test('最近几节课「这一次」的也给它看（隔几节课又说同样的话就是要求）', () => {
  const p = saidPrompt({ items: [{ ev: 'ev-a', at: 10, text: '够了，我要学新内容' }], asks: [], recent: [{ text: '这节课不复习，直接开始讲新内容', date: '2026-11-05' }] });
  assert.ok(p.includes('这节课不复习，直接开始讲新内容'));
  assert.ok(p.includes('2026-11-05'));
});

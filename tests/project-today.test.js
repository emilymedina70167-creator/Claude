// 页面让出决定（第十四轮任务 14）：今天做什么、复现什么时候到期、掌握算到哪、题库的题，都是项目 Claude 写；
// 页面只照它写的画，没写就只摆事实；页面按作答算的掌握只当参考放在 meta/mastery-calc，不改 mastery。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayRows, todayFacts } from '../kit/src/project/today.js';
import { reviewDue } from '../kit/src/memory/schema.js';
import { masteryCalc } from '../kit/src/memory/mastery.js';
import { projectTools } from '../kit/src/project/tools.js';
import { FORBIDDEN } from '../kit/src/project/system.js';

const today = '2026-11-19';
const data = {
  reviews: [
    { id: 'R3', title: '秩和极大无关组', tier: 3, last: '2026-11-10', status: 'active', blocks: ['L3.2.1'] },
    { id: 'R4', title: '矩阵乘法', tier: 7, last: '2026-11-18', status: 'active' },
  ],
  recall: [], sessions: [], drills: [],
};

test('照 meta/today 画：一项一行，复现课开的就是它写的那几组', () => {
  const rows = todayRows({ date: today, items: [{ kind: 'review', ids: ['R3'], why: '到期了' }] }, data, today);
  const picked = rows.filter((r) => r.kind !== 'fact');
  assert.equal(picked.length, 1);
  assert.deepEqual([picked[0].kind, picked[0].ids, picked[0].why], ['review', ['R3'], '到期了']);
  assert.match(picked[0].label, /秩和极大无关组/, '没写 label 的复现用组的标题');
});

test('没写 meta/today（或写的不是今天）：只有事实行，没有页面挑的题', () => {
  for (const meta of [null, { date: '2026-11-18', items: [{ kind: 'drill', ids: ['d1'] }] }]) {
    const rows = todayRows(meta, data, today);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.kind === 'fact'), JSON.stringify(rows));
    assert.ok(rows.some((r) => /到期.*1 组/.test(r.text)), '到期了几组');
  }
});

test('认不出的 kind、该有编号没编号的不画，也不报错', () => {
  const rows = todayRows({ date: today, items: [{ kind: 'xx' }, { kind: 'review' }, { kind: 'drill', ids: ['d1', 'd2'], reviews: ['R3'] }, { kind: 'class', block: 'L3.2.1', label: '秩' }] }, data, today);
  assert.deepEqual(rows.filter((r) => r.kind !== 'fact').map((r) => r.kind), ['drill', 'class']);
  assert.deepEqual(rows[0].reviews, ['R3'], '练一练算进哪几组复现也是它写的');
});

test('todayFacts：首页照哪里画、到期几组；只写事实', () => {
  const t = todayFacts(data, today);
  assert.match(t, /meta\/today/);
  assert.match(t, /到期的复现组 1 组/);
  assert.match(t, /meta\/mastery-calc/);
  for (const w of FORBIDDEN) assert.ok(!t.includes(w), w);
});

test('复现组写了 due 就按它算到期，没写照档位算', () => {
  const r = { id: 'R3', tier: 3, last: '2026-11-10', due: '2026-11-20' };
  assert.equal(reviewDue(r, '2026-11-19').state, 'later');
  assert.equal(reviewDue(r, '2026-11-20').state, 'today');
  assert.equal(reviewDue({ ...r, due: undefined }, '2026-11-19').state, 'overdue');
  assert.ok(reviewDue({ ...r, due: '11月20' }, '2026-11-19').error);
  // 到了它写的日子做过了（页面记了更新的 last）：due 用过了，下一次按档位算
  assert.equal(reviewDue({ id: 'R3', tier: 3, last: '2026-11-20', due: '2026-11-20' }, '2026-11-21').state, 'later');
  assert.equal(reviewDue({ id: 'R3', tier: 3, last: '2026-11-20', due: '2026-11-20' }, '2026-11-21').due, '2026-11-23');
});

test('masteryCalc：按作答算出参考，原来的 mastery 一条不动', () => {
  const mem = {
    mastery: [], pending: [], curriculum: [{ id: 'L2.1.1', level: 'block' }], sessions: [{ id: 'c-1', date: '2026-11-17' }],
    evidence: [
      { id: 'ev-1', src: 'record', session: 'c-1', comp: 'q1', tags: ['L2.1.1'], ok: true, at: 1, block: 'L2.1.1' },
      { id: 'ev-2', src: 'record', session: 'c-1', comp: 'q2', tags: ['L2.1.1'], ok: true, at: 2, block: 'L2.1.1' },
    ],
  };
  const before = JSON.stringify(mem.mastery);
  const calc = masteryCalc(mem, { now: 5 });
  assert.equal(JSON.stringify(mem.mastery), before);
  assert.equal(calc.at, 5);
  assert.ok(Array.isArray(calc.items));
  for (const it of calc.items) assert.ok(it.target && it.state && it.reason);
});

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  return {
    docs,
    doc: (path) => ({ get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }), set: async (v) => { docs.set(path, structuredClone(v)); }, delete: async () => { docs.delete(path); } }),
    collection: () => ({ get: async () => ({ docs: [] }) }),
  };
}

test('往题库写题：页面先验一遍，不过的照写但标 broken（练一练不挑），回 problems', async () => {
  const db = fakeDb();
  const render = async (md) => (/坏/.test(md) ? ['写法错误：看不懂这一行'] : []);
  const w = projectTools({ db, write: true, render }).find((t) => t.name === 'write');
  const bad = await w.execute({ op: 'set', path: 'drills/d-1', data: { md: '```answer\n坏\n```', kind: 'answer', block: 'L2.1.1' } });
  assert.equal(bad.ok, true);
  assert.equal(bad.broken, true);
  assert.ok(bad.problems.some((p) => /看不懂/.test(p)));
  assert.equal(db.docs.get('drills/d-1').broken, true);
  const good = await w.execute({ op: 'update', path: 'drills/d-1', data: { md: '```answer\n好\n```' } });
  assert.ok(!good.broken);
  assert.equal(db.docs.get('drills/d-1').broken, undefined, '改好了 broken 去掉');
});

test('开 Claude 排的那一块的课：备好的资料包是别的块的就不用', async () => {
  const { packForBlock } = await import('../kit/src/project/today.js');
  const pack = { main: { block: 'L3.1.1', unit: '秩' }, problems: { items: [] } };
  assert.equal(packForBlock(pack, 'L3.1.1'), pack);
  assert.deepEqual(packForBlock(pack, 'L2.1.1'), { main: null, problems: null });
  assert.equal(packForBlock(pack, ''), pack, '没指定块（主角卡的「开新课」）照旧用');
});

test('练习教练：coach 一项要有块，带主讲写的为什么、盯的错法、题号', async () => {
  const rows = todayRows({ date: today, items: [{ kind: 'coach', block: 'L3.2.1', why: '到期了', focus: '把 AB 写成 BA', ids: ['d1'] }, { kind: 'coach', why: '没写块' }] }, { ...data, curriculum: [{ id: 'L3.2.1', title: '秩' }] }, today);
  const c = rows.filter((r) => r.kind === 'coach');
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].block, c[0].focus, c[0].ids, c[0].label], ['L3.2.1', '把 AB 写成 BA', ['d1'], '秩']);
  const { coachPack } = await import('../kit/src/project/today.js');
  const pack = coachPack(c[0]);
  assert.equal(pack.main.block, 'L3.2.1');
  const { packText } = await import('../kit/src/class/prompt.js');
  const t = packText(pack).text;
  assert.match(t, /主讲写的/);
  assert.match(t, /把 AB 写成 BA/);
});

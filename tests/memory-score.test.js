// 410 分的进度（docs/score-plan.md）：页面按掌握记录数「已经攒下的分」，不调用 Claude
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { GOAL, SUBJECTS, LADDER, creditOf, stateAt, scoreMap, scoreBoard, scoreLine, fmt, signed } = await import('../kit/src/memory/score.js');

// 一张小课程地图：线代两讲（第 0 讲是入门、不考），第 1 讲两块；数据结构一章两块、一章还没排块
const curriculum = [
  { id: 'L0', level: 'lecture', title: '第0讲 零基础入门' },
  { id: 'L1', level: 'lecture', title: '第1讲 行列式' },
  { id: 'L1.1', level: 'section', title: '§1' },
  { id: 'L1.1.1', level: 'block', title: '排列' },
  { id: 'L1.1.2', level: 'block', title: '逆序数' },
  { id: 'L2', level: 'lecture', title: '第2讲 矩阵' },
  { id: 'DS-L1', level: 'lecture', title: '第1章 绪论' },
  { id: 'DS-L7', level: 'lecture', title: '第7章 查找' },
  { id: 'DS-L7.1.1', level: 'block', title: '顺序查找' },
  { id: 'DS-L7.1.2', level: 'block', title: '折半查找' },
  { id: 'EN-L1', level: 'lecture', title: '简单句' },
  { id: 'EN-L1.1.1', level: 'block', title: '主谓' },
];

test('四科的目标加起来是 410，每一科的部分加起来是卷面满分', () => {
  assert.equal(GOAL, 410);
  assert.equal(SUBJECTS.reduce((n, s) => n + s.target, 0), 410);
  for (const s of SUBJECTS) assert.equal(s.parts.reduce((n, p) => n + p.points, 0), s.full, s.label);
  for (const s of SUBJECTS) for (const p of s.parts) assert.ok(p.basis, `${p.label} 要写依据`);
});

test('达成什么加几成：讲过 1 成、基础题过 5 成、复现通过按档位往上、隔 30 天还对算满；掉了退回 1 成', () => {
  assert.equal(creditOf('未学'), 0);
  assert.equal(creditOf('讲过'), 0.1);
  assert.equal(creditOf('基础题过'), 0.5);
  assert.equal(creditOf('复现通过', 1), 0.6);
  assert.equal(creditOf('复现通过', 7), 0.75);
  assert.equal(creditOf('复现通过', 30), 1);
  assert.equal(creditOf('复现通过'), 0.6, '没写档位按第一档');
  assert.equal(creditOf('掉了'), 0.1);
  // 档位越高越多
  const tiers = LADDER.filter((x) => x.state === '复现通过').map((x) => x.credit);
  assert.deepEqual([...tiers].sort((a, b) => a - b), tiers);
});

test('每块值几分：部分按章平分（入门那章不分），章再平分到块；没排块的章照样占着分', () => {
  const { blocks, parts } = scoreMap(curriculum);
  const la = parts.find((p) => p.key === 'LA');
  // 线代 30 分 × 130/150 = 26，分给第 1、2 讲各 13；第 1 讲两块各 6.5
  assert.equal(Math.round(la.points * 10) / 10, 26);
  assert.deepEqual(la.chapters.map((c) => c.id), ['L1', 'L2']);
  assert.equal(Math.round(blocks['L1.1.1'].points * 100) / 100, 6.5);
  assert.equal(la.chapters.find((c) => c.id === 'L2').blocks.length, 0);
  // 数据结构 45 × 135/150 = 40.5，两章各 20.25，第 7 章两块各 10.125
  assert.equal(blocks['DS-L7.1.1'].points, 10.125);
  // 学习台里还没有的部分：分占着，标出来
  assert.equal(parts.find((p) => p.key === 'HM').inDesk, false);
  assert.equal(parts.find((p) => p.key === 'PO').inDesk, false);
  // 章上写了 weight：按比例分
  const w = scoreMap([...curriculum.filter((b) => b.id !== 'L2'), { id: 'L2', level: 'lecture', title: '第2讲', weight: 3 }]);
  assert.equal(Math.round(w.parts.find((p) => p.key === 'LA').chapters.find((c) => c.id === 'L2').points * 10) / 10, 19.5);
});

test('某一天的状态：按 log 退回去；那天以前没有改动就是第一条改动之前的值', () => {
  const doc = { state: '复现通过', tier: 7, log: [
    { field: 'state', date: '2026-10-20', from: '未学', to: '基础题过' },
    { field: 'state', date: '2026-11-01', from: '基础题过', to: '复现通过' },
    { field: 'tier', date: '2026-11-01', from: null, to: 1 },
    { field: 'tier', date: '2026-11-04', from: 1, to: 7 },
  ] };
  assert.deepEqual(stateAt(doc), { state: '复现通过', tier: 7 });
  assert.deepEqual(stateAt(doc, '2026-11-02'), { state: '复现通过', tier: 1 });
  assert.deepEqual(stateAt(doc, '2026-10-25'), { state: '基础题过', tier: null });
  assert.deepEqual(stateAt(doc, '2026-10-01'), { state: '未学', tier: null });
  assert.deepEqual(stateAt({ state: '讲过' }, '2026-10-01'), { state: '讲过', tier: null }, '没有 log 当一直是这样');
  assert.deepEqual(stateAt(null), { state: '未学', tier: null });
});

test('整张表：攒了几分、这 7 天攒了几分（升的、掉的分开）、还差几分每周要攒多少', () => {
  const mastery = [
    { id: 'L1.1.1', state: '基础题过', log: [{ field: 'state', date: '2026-11-03', from: '讲过', to: '基础题过' }] },
    { id: 'L1.1.2', state: '掉了', log: [{ field: 'state', date: '2026-11-04', from: '基础题过', to: '掉了' }] },
    { id: 'DS-L7.1.1', state: '复现通过', tier: 30 },
    { id: 'DS-L7.1.1#seq', state: '复现通过', tier: 30 }, // 知识点不单独算分
    { id: 'EN-L1.1.1', state: '讲过' },
  ];
  const b = scoreBoard({ curriculum, mastery }, { today: '2026-11-05' });
  // 6.5×0.5 + 6.5×0.1 + 10.125×1 + 22.5×0.1 = 3.25 + 0.65 + 10.125 + 2.25
  assert.equal(Math.round(b.total * 1000) / 1000, 16.275);
  assert.equal(Math.round(b.subjects.find((s) => s.key === 'math').got * 100) / 100, 3.9);
  // 7 天前：L1.1.1 讲过（0.65）、L1.1.2 基础题过（3.25）→ 现在 3.25、0.65：一升一掉
  assert.equal(b.week.ups.length, 1);
  assert.equal(b.week.ups[0].id, 'L1.1.1');
  assert.equal(b.week.ups[0].from, '讲过');
  assert.equal(b.week.downs[0].id, 'L1.1.2');
  assert.equal(Math.round(b.week.delta * 100) / 100, 0);
  assert.equal(b.pace.weeks, Math.ceil(411 / 7));
  assert.ok(Math.abs(b.pace.perWeek - (410 - b.total) / b.pace.weeks) < 1e-9);
  // 作废的掌握不算
  const gone = scoreBoard({ curriculum, mastery: mastery.map((m) => (m.id === 'DS-L7.1.1' ? { ...m, status: 'void' } : m)) }, { today: '2026-11-05' });
  assert.equal(Math.round((b.total - gone.total) * 1000) / 1000, 10.125);
});

test('写法：一位小数、整数不带 .0、正负号；首页那行小字', () => {
  assert.equal(fmt(3.84), '3.8');
  assert.equal(fmt(4), '4');
  assert.equal(signed(2.46), '+2.5');
  assert.equal(signed(-0.44), '−0.4');
  assert.equal(signed(0.01), '0');
  assert.equal(scoreLine({ week: { delta: 1.2 }, pace: { left: 402.2, perWeek: 6.82 } }), '还差 403 分，每周要攒 6.8');
  assert.equal(scoreLine({ week: { delta: 0 }, pace: { left: 0, perWeek: 0 } }), '攒够 410 了');
});

test('考试档案改了目标：scoreBoard 的 goal、四科 target、每块的分都跟着变', () => {
  const base = scoreBoard({ curriculum }, { today: '2026-11-12' });
  const b = scoreBoard({ curriculum, exam: [{ id: 'target', school: '南京大学', goal: 400, split: { math: 120, cs: 135, en: 75, pol: 70 } }] }, { today: '2026-11-12' });
  assert.equal(b.goal, 400);
  assert.equal(b.subjects.find((s) => s.key === 'math').target, 120);
  const pts = (x) => x.subjects.find((s) => s.key === 'math').parts.find((p) => p.key === 'LA').points;
  assert.ok(Math.abs(pts(b) / pts(base) - 120 / 130) < 1e-9);
  assert.match(scoreLine(b), /还差 400 分/);
  // 考试日期也读档案：日期早了，剩下的周数少了
  const early = scoreBoard({ curriculum, exam: [{ id: 'target', school: '南京大学', date: '2027-01-21' }] }, { today: '2026-11-12' });
  assert.ok(early.pace.weeks < base.pace.weeks);
});

test('真题级没过的块最多攒七成；过了照旧；没真题的块照旧；这 7 天里过的算进这 7 天', () => {
  const cur = [{ id: 'OS-L3', level: 'lecture', title: '第3章' }, { id: 'OS-L3.1', level: 'section', title: '§1' }, { id: 'OS-L3.1.1', level: 'block', title: 'a' }, { id: 'OS-L3.1.2', level: 'block', title: 'b' }];
  const mastery = [{ id: 'OS-L3.1.1', state: '复现通过', tier: 30, log: [] }, { id: 'OS-L3.1.2', state: '复现通过', tier: 30, log: [] }];
  const exam = { 'OS-L3.1.1': 1, 'OS-L3.1.2': 1 };
  const now = Date.parse('2026-11-12T12:00:00Z');
  const got = (b, id) => b.subjects.find((s) => s.key === 'cs').parts.find((p) => p.key === 'OS').chapters[0].got;
  const none = scoreBoard({ curriculum: cur, mastery }, { today: '2026-11-12', exam });
  const half = scoreBoard({ curriculum: cur, mastery, exam_bar: [{ id: 'OS-L3.1.1', passed: true, passedAt: now - 2 * 86400000 }] }, { today: '2026-11-12', exam });
  const pts = scoreMap(cur, null, { weights: exam }).blocks;
  assert.ok(Math.abs(got(none) - 0.7 * (pts['OS-L3.1.1'].points + pts['OS-L3.1.2'].points)) < 1e-9);
  assert.ok(Math.abs(got(half) - (pts['OS-L3.1.1'].points + 0.7 * pts['OS-L3.1.2'].points)) < 1e-9);
  assert.ok(half.week.ups.some((x) => x.id === 'OS-L3.1.1'), '这 7 天里过的');
  const free = scoreBoard({ curriculum: cur, mastery }, { today: '2026-11-12' });
  assert.ok(got(free) > got(none), '没有真题入库时不封顶');
});

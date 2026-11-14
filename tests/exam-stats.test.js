// 考情的统计（kit/src/exam/stats.js）：每个考点、每块、每门课的热度
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeStats, blockStats, courseHeat, statsCache } from '../kit/src/exam/stats.js';

const q = (id, year, points, syl, how = 'calc', type = 'single') => ({ id, year, points, type, course: 'OS', tags: { syl, how } });
const qs = [
  q('Q-408-2015-23', 2015, 2, ['G-OS-3.2']),
  q('Q-408-2017-24', 2017, 2, ['G-OS-3.2', 'G-OS-3.1'], 'concept'),
  q('Q-408-2024-45', 2024, 8, ['G-OS-3.2'], 'process', 'comp'),
  q('Q-408-2025-25', 2025, 2, ['G-OS-3.1', 'G-OS-3.2']),
  q('Q-408-2025-26', 2025, 2, ['G-OS-2.3']),
];

test('每个考点：次数、哪几年、分数（次考点算一半）、平均每年、题型和考法、一起考的', () => {
  const s = nodeStats(qs, { years: [2015, 2025] }).get('G-OS-3.2');
  assert.equal(s.n, 4);
  assert.deepEqual(s.years, [2015, 2017, 2024, 2025]);
  assert.equal(s.points, 2 + 2 + 8 + 1);
  assert.equal(s.perYear, 13 / 11);
  assert.deepEqual(s.types, { single: 3, comp: 1 });
  assert.deepEqual(s.hows, { calc: 2, concept: 1, process: 1 });
  assert.deepEqual(s.with, [{ id: 'G-OS-3.1', n: 2 }]);
});

test('最近五年和以前比：多了是 up', () => {
  const s = nodeStats(qs, { years: [2015, 2025] }).get('G-OS-3.2');
  assert.equal(s.trend, 'up');
  assert.equal(nodeStats([q('Q-408-2015-1', 2015, 2, ['G-1']), q('Q-408-2016-1', 2016, 2, ['G-1'])], { years: [2015, 2025] }).get('G-1').trend, 'down');
  assert.equal(nodeStats(qs, { years: [2023, 2025] }).get('G-OS-3.2').trend, 'flat', '不到六年不比');
});

test('一块的统计：挂的几个考点合起来，同一道题只算一次（主考点在这一块全分）', () => {
  const s = blockStats(['G-OS-3.1', 'G-OS-3.2'], qs, { years: [2015, 2025] });
  assert.equal(s.n, 4);
  assert.equal(s.points, 2 + 2 + 8 + 2);
  assert.deepEqual(blockStats(['G-NONE'], qs, { years: [2015, 2025] }).n, 0);
});

test('一门课的热度排行；首页的缓存（每块平均每年几分、没挂的、没打标签的）', () => {
  const syllabus = [{ id: 'G-OS-3.2', title: '页面置换', course: 'OS', blocks: ['OS-L3.2.1'] }, { id: 'G-OS-3.1', title: '分页', course: 'OS', blocks: ['OS-L3.2.1'] }, { id: 'G-OS-2.3', title: 'PV', course: 'OS' }];
  const h = courseHeat(qs, syllabus, { years: [2015, 2025] });
  assert.deepEqual(h.map((x) => x.id), ['G-OS-3.2', 'G-OS-3.1', 'G-OS-2.3']);
  assert.equal(h[0].rank, 1);
  assert.equal(h[0].title, '页面置换');
  const c = statsCache({ course: 'OS', questions: [...qs, { id: 'Q-408-2025-27', year: 2025, points: 2, course: 'OS' }], syllabus, curriculum: [{ id: 'OS-L3.2.1', level: 'block' }, { id: 'OS-L9.1.1', level: 'block' }] });
  assert.equal(c.blockPerYear['OS-L3.2.1'], 14 / 11);
  assert.deepEqual(c.holes.blocks, ['OS-L9.1.1']);
  assert.deepEqual(c.holes.nodes, ['G-OS-2.3']);
  assert.equal(c.untagged, 1);
  assert.equal(c.heat[0].id, 'G-OS-3.2');
});

test('卷面样本：主考点拿全分、有次考点时各一半；不带题面和答案', async () => {
  const { paperSkeletons } = await import('../kit/src/exam/stats.js');
  const syllabus = [
    { id: 'G-OS-3.1', course: 'OS', blocks: ['OS-L3.1.1'] },
    { id: 'G-OS-3.2', course: 'OS', blocks: ['OS-L3.1.2'] },
    { id: 'G-OS-2.3', course: 'OS', blocks: [] },
  ];
  const sk = paperSkeletons([
    { ...q('Q-408-2015-23', 2015, 2, ['G-OS-3.2']), q: '题面', answer: 'A' },
    q('Q-408-2017-24', 2017, 2, ['G-OS-3.2', 'G-OS-3.1']),
    q('Q-408-2017-25', 2017, 2, ['G-OS-2.3']),
  ], syllabus, 'OS');
  assert.deepEqual(sk[2015], [['OS-L3.1.2', 2, 'single']]);
  assert.deepEqual(sk[2017], [['OS-L3.1.2', 1, 'single'], ['OS-L3.1.1', 1, 'single']]);
  assert.ok(!JSON.stringify(sk).includes('题面'));
  const c = statsCache({ course: 'OS', questions: qs, syllabus, curriculum: [], years: [] });
  assert.ok(c.papers && typeof c.papers === 'object');
});

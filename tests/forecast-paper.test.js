// 卷面：分值分到块、合成卷、真卷样本、抽卷（spec 6.1）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUBJECT_CODE, units, synthPaper, realPapers, pickPaper } from '../kit/src/forecast/paper.js';
import { structureOf } from '../kit/src/exam/structure.js';
import { rng } from '../kit/src/forecast/rng.js';

const curriculum = [
  { id: 'L0', level: 'lecture', title: '第0讲 入门' },
  { id: 'L1', level: 'lecture', title: '第1讲 行列式' },
  { id: 'L1.1.1', level: 'block', title: '排列' },
  { id: 'L1.1.2', level: 'block', title: '逆序数' },
  { id: 'L2', level: 'lecture', title: '第2讲 矩阵' },
  { id: 'DS-L2', level: 'lecture', title: '线性表' },
  { id: 'DS-L2.1.1', level: 'block', title: '顺序表' },
];
const sum = (xs) => xs.reduce((n, x) => n + x.points, 0);

test('单位加起来是满分', () => {
  for (const [k, full] of [['math', 150], ['cs', 150], ['en', 100], ['pol', 100]]) assert.ok(Math.abs(sum(units(curriculum, k)) - full) < 1e-9, k);
  const m = units(curriculum, 'math');
  assert.ok(m.some((u) => u.id === 'HM:*') && m.some((u) => u.id === 'L2:*') && m.some((u) => u.id === 'L1.1.1'));
  assert.ok(!m.some((u) => u.id.startsWith('L0')), '入门不考');
  assert.ok(Math.abs(m.find((u) => u.id === 'L1.1.1').points - 7.5) < 1e-9, '线代 30 分两章，第 1 讲两块');
});

test('合成卷照结构', () => {
  const p = synthPaper('cs', units(curriculum, 'cs'), structureOf('408', 2026));
  assert.equal(p.length, 47);
  assert.ok(p.slice(0, 40).every((x) => x.type === 'single' && x.points === 2));
  assert.ok(Math.abs(sum(p.slice(40)) - 70) < 1e-9);
  assert.ok(Math.abs(sum(p) - 150) < 1e-9);
  const en = synthPaper('en', units(curriculum, 'en'), structureOf('201', 2026));
  assert.ok(en.filter((x) => x.type === 'essay').every((x) => x.pool.every((u) => u.part === 'WR')), '作文只落在写作');
});

test('真卷标了不到七成的分不用（标签打到一半时预测不断崖）', () => {
  const us = units(curriculum, 'cs');
  assert.deepEqual(realPapers({ 2020: [['DS-L2.1.1', 100, 'single']] }, us, 'cs', structureOf('408', 2020)), []);
});

test('真卷缺分补齐：照合成卷的题型补（留着蒙对的底），只落在还缺分的部分', () => {
  const us = units(curriculum, 'cs');
  const ps = realPapers({ 2020: [['DS-L2.1.1', 40, 'comp'], ['OS-L9.9.9', 80, 'single']] }, us, 'cs', structureOf('408', 2020));
  const items = ps[0].items;
  assert.ok(Math.abs(sum(items) - 150) < 1e-9);
  assert.equal(items[1].unit, 'OS:*', '不在单位里的块归到它那一部分');
  const fill = items.slice(2);
  assert.ok(fill.some((x) => x.type === 'single'), '补的题里有单选');
  assert.ok(fill.every((x) => x.pool.every((u) => u.part !== 'OS')), '操作系统已经够分，不往它上补');
});

test('近几年抽得多', () => {
  const papers = Array.from({ length: 15 }, (_, i) => ({ year: 2011 + i, items: [{ unit: String(2011 + i), type: 'single', points: 150 }] }));
  const r = rng(7);
  let recent = 0;
  for (let i = 0; i < 2000; i++) if (Number(pickPaper(r, papers)[0].unit) >= 2021) recent++;
  assert.ok(recent / 2000 > 5 / 15 + 0.1);
  assert.equal(pickPaper(r, []), null);
  assert.equal(SUBJECT_CODE.cs, '408');
});

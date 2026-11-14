// 按考点树补课程地图的章（kit/src/exam/skeleton.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skeleton } from '../kit/src/exam/skeleton.js';
import { validateWrite } from '../kit/src/memory/writer.js';

const nodes = ['计算机系统概述', '数据的表示和运算', '存储系统', '指令系统', '中央处理器', '总线', '输入输出系统'].map((t, i) => ({ id: `G-CO-${i + 1}`, title: t, course: 'CO', parent: '' }))
  .concat([{ id: 'G-CO-3.1', title: '存储器的分类', course: 'CO', parent: 'G-CO-3' }]);

test('组成原理已有第 1 章：补出 2～7 章，编号接着排，标题带「第N章」，守课程地图的规矩', () => {
  const out = skeleton({ course: 'CO', nodes, curriculum: [{ id: 'CO-L1', level: 'lecture', title: '第1章 计算机系统概述' }, { id: 'CO-L1.1.1', level: 'block', title: 'x' }] });
  assert.deepEqual(out.map((c) => c.id), ['CO-L2', 'CO-L3', 'CO-L4', 'CO-L5', 'CO-L6', 'CO-L7']);
  assert.equal(out[1].title, '第3章 存储系统');
  assert.equal(out[1].from, 'G-CO-3');
  assert.equal(out[1].level, 'lecture');
  for (const c of out) assert.deepEqual(validateWrite(`curriculum/${c.id}`, { ...c, id: undefined }), []);
  const again = skeleton({ course: 'CO', nodes, curriculum: [{ id: 'CO-L1', level: 'lecture', title: '第1章 计算机系统概述' }, ...out] });
  assert.deepEqual(again, []);
});

test('线代的章不带前缀；标题相近也算已有', () => {
  const out = skeleton({ course: 'LA', nodes: [{ id: 'G-LA-1', title: '行列式', course: 'LA' }, { id: 'G-LA-2', title: '矩阵', course: 'LA' }], curriculum: [{ id: 'L1', level: 'lecture', title: '第1讲 行列式的计算' }] });
  assert.deepEqual(out.map((c) => [c.id, c.title]), [['L2', '第2章 矩阵']]);
});

test('blockPlan：没有块的章照考点树排节和块、一个叶子考点一块；已有块的章按标题挂；指定的章对应照写', async () => {
  const { blockPlan } = await import('../kit/src/exam/skeleton.js');
  const nodes = [
    { id: 'G-DS-1', course: 'DS', title: '基本概念', parent: '' },
    { id: 'G-DS-1.1', course: 'DS', title: '数据结构的基本概念', parent: 'G-DS-1' },
    { id: 'G-DS-1.2', course: 'DS', title: '算法的基本概念', parent: 'G-DS-1' },
    { id: 'G-DS-2', course: 'DS', title: '查找', parent: '' },
    { id: 'G-DS-2.1', course: 'DS', title: '顺序查找法', parent: 'G-DS-2' },
    { id: 'G-DS-2.2', course: 'DS', title: '树形查找', parent: 'G-DS-2' },
    { id: 'G-DS-2.2.1', course: 'DS', title: '二叉搜索树', parent: 'G-DS-2.2' },
    { id: 'G-DS-3', course: 'DS', title: '图', parent: '' },
    { id: 'G-DS-3.1', course: 'DS', title: '图的存储', parent: 'G-DS-3' },
    { id: 'G-DS-3.1.1', course: 'DS', title: '邻接矩阵', parent: 'G-DS-3.1' },
  ];
  const curriculum = [
    { id: 'DS-L1', level: 'lecture', title: '第1章 绪论' },
    { id: 'DS-L7', level: 'lecture', title: '第7章 查找' },
    { id: 'DS-L7.1.1', level: 'block', title: '顺序查找' },
    { id: 'DS-L7.1.2', level: 'block', title: '二叉排序树（BST）' },
  ];
  const r = blockPlan({ course: 'DS', nodes, curriculum, chapters: { 'G-DS-1': 'DS-L1', 'G-DS-2': 'DS-L7' }, manual: { 'G-DS-2.2.1': ['DS-L7.1.2'] } });
  const ids = r.writes.map((w) => w.id);
  assert.ok(ids.includes('DS-L1.1') && ids.includes('DS-L1.1.1') && ids.includes('DS-L1.2.1'), '绪论没有块：照考点排');
  assert.ok(ids.includes('DS-L8') && ids.includes('DS-L8.1.1'), '图这一章课程地图没有：新开一章，编号接着最大的');
  assert.ok(!ids.some((x) => x.startsWith('DS-L7.')), '查找已经有块：不另排');
  assert.deepEqual(r.map['G-DS-1.2'], ['DS-L1.2.1']);
  assert.deepEqual(r.map['G-DS-2.1'], ['DS-L7.1.1'], '标题像的挂上');
  assert.deepEqual(r.map['G-DS-2.2.1'], ['DS-L7.1.2'], '手工指定的照写');
  assert.deepEqual(r.map['G-DS-3.1.1'], ['DS-L8.1.1']);
  assert.deepEqual(r.unmapped, []);
  assert.ok(r.writes.every((w) => w.by === 'dev' && w.level));
  // 节、块带上一层（课程地图的树按 parent 拼）；章没有上一层
  assert.equal(r.writes.find((w) => w.id === 'DS-L1.1.1').parent, 'DS-L1.1');
  assert.equal(r.writes.find((w) => w.id === 'DS-L1.1').parent, 'DS-L1');
  assert.equal(r.writes.find((w) => w.id === 'DS-L8').parent, undefined);
  const co = blockPlan({ course: 'CO', nodes, curriculum, manual: { 'G-DS-2.2.1': ['DS-L7.1.2'] } });
  assert.deepEqual(co.map, {}, '别的门课手工指定的不混进来');
});

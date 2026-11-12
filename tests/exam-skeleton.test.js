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

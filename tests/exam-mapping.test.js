// 考点 ↔ 课程地图（kit/src/exam/mapping.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockSyllabus, syllabusOfBlock, mapHoles, mapSig } from '../kit/src/exam/mapping.js';

const syllabus = [
  { id: 'G-DS-1', course: 'DS', title: '线性表' },
  { id: 'G-DS-1.1', course: 'DS', parent: 'G-DS-1', title: '顺序表', blocks: ['DS-L2.1.1'] },
  { id: 'G-DS-1.2', course: 'DS', parent: 'G-DS-1', title: '链表', blocks: ['DS-L2.1.1', 'DS-L2.2.1'] },
  { id: 'G-DS-1.3', course: 'DS', parent: 'G-DS-1', title: '应用' },
  { id: 'G-DS-9', course: 'DS', title: '作废的', status: 'void', blocks: ['DS-L9.1.1'] },
];
const curriculum = [{ id: 'DS-L2.1.1', level: 'block', title: '顺序表' }, { id: 'DS-L2.2.1', level: 'block', title: '链表' }, { id: 'DS-L2.3.1', level: 'block', title: '没挂' }, { id: 'L1.1.1', level: 'block', title: '线代的' }];

test('块 → 考点；作废的考点不算', () => {
  assert.deepEqual(blockSyllabus(syllabus).get('DS-L2.1.1'), ['G-DS-1.1', 'G-DS-1.2']);
  assert.equal(blockSyllabus(syllabus).has('DS-L9.1.1'), false);
  assert.deepEqual(syllabusOfBlock('DS-L2.2.1', syllabus).map((n) => n.id), ['G-DS-1.2']);
});

test('漏挂的：没挂考点的块、没挂块的叶子考点（父节点不算）', () => {
  assert.deepEqual(mapHoles({ syllabus, curriculum, course: 'DS' }), { blocks: ['DS-L2.3.1'], nodes: ['G-DS-1.3'] });
});

test('课程地图的指纹：改一块的标题就变；别的门课的块不算', () => {
  const a = mapSig(curriculum, 'DS');
  assert.notEqual(mapSig(curriculum.map((b) => (b.id === 'DS-L2.3.1' ? { ...b, title: '改了' } : b)), 'DS'), a);
  assert.equal(mapSig(curriculum.map((b) => (b.id === 'L1.1.1' ? { ...b, title: '改了' } : b)), 'DS'), a);
});

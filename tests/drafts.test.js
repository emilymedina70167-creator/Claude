// 草稿（学生写了还没提交的东西）：格子里的写法、课堂 Claude 看到的那一行、黑板现状里的样子
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftLine, boardStateText, PROTOCOL_DOC } from '../kit/src/class/prompt.js';

// mathinput.js 加载时给 document 挂键盘监听：Node 里给个最小的替身
globalThis.document ??= { addEventListener() {}, compatMode: 'CSS1Compat' };
const { partialText } = await import('../kit/src/mathinput.js');

const cells = (...vs) => vs.map((v) => ({ k: 0, v }));

test('partialText：一个都没填是空；空格子写成 □', () => {
  assert.equal(partialText({ kind: 'array', n: 3 }, cells('', ' ', '')), '');
  assert.equal(partialText({ kind: 'array', n: 3 }, cells('3', '', '−1')), '(3, □, -1)');
  assert.equal(partialText({ kind: 'vector', n: 2 }, cells('1/2', '4')), '(1/2, 4)');
  assert.equal(partialText({ kind: 'number' }, cells(' 7 ')), '7');
});

test('partialText：矩阵按行，一组向量按向量分组', () => {
  assert.equal(partialText({ kind: 'matrix', r: 2, c: 2 }, cells('1', '', '3', '4')), '[1 □; 3 4]');
  assert.equal(partialText({ kind: 'vectors', n: 2 }, [{ k: 0, v: '1' }, { k: 0, v: '2' }, { k: 1, v: '' }, { k: 1, v: '5' }]), '{(1, 2), (□, 5)}');
  assert.equal(partialText(null, cells('x')), '(x)');
});

test('draftLine：位置、第几步、写着什么，注明还没提交', () => {
  assert.equal(draftLine({ step: 'b4', block: 'q-b4', kind: 'answer', title: '算一个', text: '(3, □)' }), '[草稿] b4 里的 answer q-b4「算一个」：写着 (3, □)，还没提交');
  assert.equal(draftLine({ step: 'b2', block: 'ex-1', kind: 'steps', label: '第 2 步', text: '先把\n括号展开' }), '[草稿] b2 里的 steps ex-1 第 2 步：写着 先把 / 括号展开，还没提交');
  assert.equal(draftLine({ step: 'b2', block: 'x', text: '  ' }), '');
  assert.equal(draftLine(null), '');
});

test('黑板现状：组件下面列出现在的草稿', () => {
  const t = boardStateText([{ id: 'b1', blocks: [
    { id: 'q-1', kind: 'answer', results: [], draft: '(3, □)' },
    { id: 'q-2', kind: 'answer', results: ['b1 里的 answer q-2：填了 2（错，第 1 次）'], draft: '5' },
    { id: 'q-3', kind: 'answer', results: [] },
  ] }]);
  assert.ok(t.includes('  - answer q-1：还没提交，现在写着：(3, □)'));
  assert.ok(t.includes('    - 填了 2（错，第 1 次）\n    - 现在写着（还没提交）：5'));
  assert.ok(t.includes('  - answer q-3：还没有作答'));
});

test('课堂说明讲了「[草稿]」怎么看', () => {
  assert.ok(PROTOCOL_DOC.includes('[草稿]'));
  assert.ok(/不要因为草稿打断学生/.test(PROTOCOL_DOC));
});

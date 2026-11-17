// 项目指令（meta/instructions，第十四轮）：学生自己写，每一轮原样给项目 Claude；留以前的版本
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveInstructions, INSTR_HISTORY, shownNotes } from '../kit/src/project/instructions.js';

test('存一版：旧的进 history（新的在前，最多 20 版），作者写 me', () => {
  let doc = saveInstructions(null, '第一版', 1);
  assert.deepEqual([doc.text, doc.at, doc.by, doc.history.length], ['第一版', 1, 'me', 0]);
  doc = saveInstructions(doc, '第二版', 2);
  assert.deepEqual([doc.text, doc.history[0].text], ['第二版', '第一版']);
  for (let i = 3; i < 30; i++) doc = saveInstructions(doc, `第 ${i} 版`, i);
  assert.equal(INSTR_HISTORY, 20);
  assert.equal(doc.history.length, 20);
});
test('没改就不存新的一版', () => {
  const doc = saveInstructions(null, '一样', 1);
  assert.equal(saveInstructions(doc, '一样', 2), doc);
});
test('「笔记」页列 show 的、没删的，最近改的在前', () => {
  const list = shownNotes([{ path: 'a.md', show: true, at: 1 }, { path: 'b.md', show: true, at: 5 }, { path: 'c.md', show: false }, { path: 'd.md', show: true, deleted: true }]);
  assert.deepEqual(list.map((d) => d.path), ['b.md', 'a.md']);
});

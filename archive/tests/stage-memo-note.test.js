// 第十一轮 A2：舞台课里老师写的 memo 没收，下一轮告诉它（以前存成 system note，messages() 只发老师和学生的轮，老师永远不知道）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notesBefore } from '../kit/src/stage/history.js';

test('memo 被拒：拼进紧跟着的那一条学生消息前面', () => {
  const history = [
    { seq: 1, role: 'claude', text: '老师第一轮' },
    { seq: 2, role: 'system', kind: 'note', text: '[系统] memo 里有 1 条没记：\n- ask text="x"\n  原因：要挂学生说的那句话' },
    { seq: 3, role: 'student', text: '学生', msg: '[学生] 我答了' },
    { seq: 4, role: 'claude', text: '老师第二轮' },
    { seq: 5, role: 'student', text: '学生 2' },
  ];
  const m = notesBefore(history);
  assert.ok(m.get(3).startsWith('[页面] memo 里有 1 条没记'));
  assert.ok(m.get(3).includes('要挂学生说的那句话'));
  assert.equal(m.has(5), false);
});

test('作废的、别的种类的系统轮不算', () => {
  const history = [
    { seq: 1, role: 'claude', text: 'x' },
    { seq: 2, role: 'system', kind: 'aide', discarded: true, text: '旁听' },
    { seq: 3, role: 'system', kind: 'note', discarded: true, text: '[系统] memo 里有 1 条没记' },
    { seq: 4, role: 'student', text: 'y' },
  ];
  assert.equal(notesBefore(history).size, 0);
});

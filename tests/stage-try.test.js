// 舞台试演工具（tools/stage-try.mjs）不碰浏览器的那一半：读一幕的文件、写报告
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTry, formatReport } from '../tools/stage-try-lib.js';

test('老师的行并成一段，学生的一行一步', () => {
  const s = parseTry('matrix A = 1 1 / -1 -1\n\nsay "看"\n学生: write A.1,1 2\n学生：next\nmul C');
  assert.deepEqual(s.map((x) => x.kind), ['teacher', 'student', 'student', 'teacher']);
  assert.equal(s[0].src, 'matrix A = 1 1 / -1 -1\nsay "看"');
  assert.equal(s[0].line, 1);
  assert.deepEqual([s[1].how, s[1].cmd, s[1].args], ['do', 'write', 'A.1,1 2']);
  assert.deepEqual([s[2].how, s[2].cmd], ['answer', 'next']);
  assert.equal(s[3].line, 6);
});

test('学生写了不认得的动作：报行号和能写的', () => {
  assert.throws(() => parseTry('array a = 1 2\n学生: fly a.1'), /第 2 行.*write swap move vec mul tap drag value say next/);
});

test('报告里有舞台现在、挑战、叫没叫老师、没交给学生', () => {
  const out = formatReport({ file: 'x.txt', views: [{ tag: '竖屏', steps: [{ step: { kind: 'student', how: 'do', cmd: 'write', args: 'B.1,1 2', src: '学生: write B.1,1 2', line: 4 }, played: 1, errors: [], state: '矩阵 B …', goals: [{ id: 'g1', text: '让 C = O', status: '做到了' }], called: { why: '做到了挑战', msg: '[学生]\n学生做到了挑战 g1' }, pending: '', untouched: null, issues: [], shot: 'a.png' }] }] });
  for (const k of ['## 竖屏', '第 1 步：学生 第 4 行 write B.1,1 2', '舞台现在：', 'g1', '做到了', '页面叫了老师（做到了挑战）', 'a.png']) assert.ok(out.includes(k), k);
});

test('报告：没叫老师时写攒着的，没交给学生、停下来的都写出来', () => {
  const out = formatReport({ file: 'x.txt', views: [{ tag: '横屏', stopped: '后面的步没跑：页面在等老师', steps: [{ step: { kind: 'teacher', src: 'array a = 1', line: 1 }, played: 3, errors: [{ line: 4, src: 'swap a.9 a.1', error: '没有第 9 格' }], state: '一排格子 a', goals: [], called: null, pending: '学生拨了 B.1,1：1 → 2', untouched: 'a 没有交给学生 edit，学生动不了', issues: [{ what: '压着', a: 'obj:a', b: 'label:t' }], shot: '' }] }] });
  for (const k of ['第 1 步：老师 第 1 行起', '没演上的行：', 'swap a.9 a.1', '没有第 9 格', '还没叫老师，攒着：', '学生拨了 B.1,1', '没交给学生：', '压着', '后面的步没跑：页面在等老师']) assert.ok(out.includes(k), k);
});

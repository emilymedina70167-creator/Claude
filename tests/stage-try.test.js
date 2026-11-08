// 舞台试演工具（tools/stage-try.mjs）不碰浏览器的那一半：读一幕的文件、把学生的一行翻成手势的输入、写报告
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTry, formatReport, studentGesture, STUDENT_FORMS } from '../tools/stage-try-lib.js';

test('老师的行并成一段，学生的一行一步', () => {
  const s = parseTry('matrix A = 1 1 / -1 -1\n\nsay "看"\n学生: write A.1,1 2\n学生：next\nmul C');
  assert.deepEqual(s.map((x) => x.kind), ['teacher', 'student', 'student', 'teacher']);
  assert.equal(s[0].src, 'matrix A = 1 1 / -1 -1\nsay "看"');
  assert.equal(s[0].line, 1);
  assert.deepEqual([s[1].how, s[1].cmd, s[1].args], ['do', 'write', 'A.1,1 2']);
  assert.deepEqual([s[2].how, s[2].cmd], ['answer', 'next']);
  assert.equal(s[3].line, 6);
});

test('学生写了不认得的动作：报行号和能写的（新的几种也在里面）', () => {
  assert.throws(() => parseTry('array a = 1 2\n学生: fly a.1'), /第 2 行.*write.*rotate.*insert.*rowop.*mark.*fold.*undo.*dial.*tap.*next/);
  for (const k of ['rotate t.30 left', 'insert t 47', 'insert t.45 right 47', 'rowop M r3 - 2r1', 'rowop M r1 <-> r3', 'rowop M 3r2', 'mark s.2-4 V', 'fold s.3-6', 'undo', 'dial k 3']) {
    assert.ok(STUDENT_FORMS.includes(k), `学生能写的列表里有 ${k}`);
  }
});

test('新的学生写法：都是直接动画面（how: do），带上翻成的手势', () => {
  const s = parseTry([
    'tree t = 50 30',
    '学生: rotate t.30 left',
    '学生: insert t 47',
    '学生: insert t.45 right 47',
    '学生: rowop M r3 - 2r1',
    '学生: rowop M r1 <-> r3',
    '学生: rowop M 3r2',
    '学生: mark s.2-4 V',
    '学生: fold s.3-6',
    '学生: undo',
    '学生: dial k 3',
  ].join('\n')).filter((x) => x.kind === 'student');
  assert.ok(s.every((x) => x.how === 'do'), '都是 how: do');
  assert.deepEqual(s.map((x) => x.cmd), ['rotate', 'insert', 'insert', 'rowop', 'rowop', 'rowop', 'mark', 'fold', 'undo', 'dial']);
  assert.deepEqual(s[0].gesture, { obj: 't', action: 'rotate', at: 't.30', dir: 'left' });
  assert.deepEqual(s[1].gesture, { obj: 't', action: 'insert', value: '47' });
  assert.deepEqual(s[2].gesture, { obj: 't', action: 'place', at: 't.45', side: 'right', value: '47' });
  assert.deepEqual(s[3].gesture, { obj: 'M', action: 'rowop', op: 'add', from: 1, to: 3, value: '-2' });
  assert.deepEqual(s[4].gesture, { obj: 'M', action: 'rowop', op: 'swap', from: 1, to: 3 });
  assert.deepEqual(s[5].gesture, { obj: 'M', action: 'rowop', op: 'scale', row: 2, value: '3' });
  assert.deepEqual(s[6].gesture, { obj: 's', action: 'mark', span: 's.2-4', role: 'V' });
  assert.deepEqual(s[7].gesture, { obj: 's', action: 'fold', span: 's.3-6' });
  assert.deepEqual(s[8].gesture, { undo: true });
  assert.deepEqual(s[9].gesture, { dial: 'k', value: 3 });
});

test('学生的一行 → 手势：在 X 往哪边转、倍数框里写的数（照学生在键盘上写的）', () => {
  const g = (line) => studentGesture(...line.split(/\s+(.*)/s).slice(0, 2));
  assert.equal(g('rotate t#3 right').at, 't#3');
  assert.equal(g('rotate t.30 右').dir, 'right');
  assert.deepEqual(g('rowop M r2 + r1'), { obj: 'M', action: 'rowop', op: 'add', from: 1, to: 2, value: '1' });
  assert.equal(g('rowop M r3 - r2').value, '-1');
  assert.equal(g('rowop M r3 + (1/2)r1').value, '1/2');
  assert.equal(g('rowop M r3 - 1/2 r1').value, '-1/2');
  assert.equal(g('rowop M r3 + (-2)r1').value, '-2');
  assert.equal(g('rowop M r3 − 2r1').value, '-2', '键盘上的减号');
  assert.deepEqual(g('rowop M r2 = r2 - 3r1'), { obj: 'M', action: 'rowop', op: 'add', from: 1, to: 2, value: '-3' });
  assert.deepEqual(g('rowop M r2 ↔ r3'), { obj: 'M', action: 'rowop', op: 'swap', from: 2, to: 3 });
  assert.equal(g('rowop M -r1').value, '-1');
  assert.equal(g('rowop M (-1/2)r2').value, '-1/2');
  assert.deepEqual(g('rowop M r2 / 3'), { obj: 'M', action: 'rowop', op: 'scale', row: 2, value: '1/3' });
  assert.equal(g('rowop M 0r2').value, '0', '乘 0 照样交出去（裁判判做不到）');
  assert.deepEqual(g('mark s.1 主语'), { obj: 's', action: 'mark', span: 's.1', role: '主语' });
  assert.equal(g('mark s.2-4 "to do"').role, 'to do');
  assert.deepEqual(g('dial k 0'), { dial: 'k', value: 0 });
});

test('翻不成一下手势的写法：说清楚为什么（不抛错，试演照样往下走）', () => {
  const g = (line) => studentGesture(...line.split(/\s+(.*)/s).slice(0, 2));
  for (const [line, re] of [
    ['rotate t.50 LR', /一次转一下/],
    ['rotate t left', /哪个结点/],
    ['rotate t.30', /left/],
    ['rowop M r2 - 2r1, r3 - r1', /一下只做一步/],
    ['rowop M c1 <-> c2', /列/],
    ['rowop M 2r2 - 3r1', /先.*乘.*再/],
    ['rowop M r2 - 2r2', /自己/],
    ['rowop M r1 <-> r1', /自己/],
    ['rowop M', /rowop M r3 - 2r1/],
    ['insert t', /insert t 47/],
    ['mark s.2-4', /成分/],
    ['fold s', /fold s\.3-6/],
    ['dial k', /dial k 3/],
    ['dial k 2.5x', /dial k 3/],
  ]) {
    const r = g(line);
    assert.ok(r.error, `${line}：{ error }`);
    assert.match(r.error, re, line);
  }
  assert.match(studentGesture('undo', 'B.1,1').error, /undo 后面不写/);
});

test('学生的一行写错了不让整个文件读不下去：错放在那一步上', () => {
  const s = parseTry('tree t = 50\n学生: rotate t.50 LR\n学生: rotate t.50 left');
  assert.equal(s.length, 3);
  assert.ok(s[1].gesture.error);
  assert.equal(s[2].gesture.dir, 'left');
});

test('报告里有舞台现在、挑战、叫没叫老师、没交给学生', () => {
  const out = formatReport({ file: 'x.txt', views: [{ tag: '竖屏', steps: [{ step: { kind: 'student', how: 'do', cmd: 'write', args: 'B.1,1 2', src: '学生: write B.1,1 2', line: 4 }, played: 1, errors: [], state: '矩阵 B …', goals: [{ id: 'g1', text: '让 C = O', status: '做到了' }], called: { why: '做到了挑战', msg: '[学生]\n学生做到了挑战 g1' }, pending: '', untouched: null, issues: [], shot: 'a.png' }] }] });
  for (const k of ['## 竖屏', '第 1 步：学生 第 4 行 write B.1,1 2', '舞台现在：', 'g1', '做到了', '页面叫了老师（做到了挑战）', 'a.png']) assert.ok(out.includes(k), k);
});

test('报告：没叫老师时写攒着的，没交给学生、停下来的都写出来', () => {
  const out = formatReport({ file: 'x.txt', views: [{ tag: '横屏', stopped: '后面的步没跑：页面在等老师', steps: [{ step: { kind: 'teacher', src: 'array a = 1', line: 1 }, played: 3, errors: [{ line: 4, src: 'swap a.9 a.1', error: '没有第 9 格' }], state: '一排格子 a', goals: [], called: null, pending: '学生拨了 B.1,1：1 → 2', untouched: 'a 没有交给学生 edit，学生动不了', issues: [{ what: '压着', a: 'obj:a', b: 'label:t' }], shot: '' }] }] });
  for (const k of ['第 1 步：老师 第 1 行起', '没演上的行：', 'swap a.9 a.1', '没有第 9 格', '还没叫老师，攒着：', '学生拨了 B.1,1', '没交给学生：', '压着', '后面的步没跑：页面在等老师']) assert.ok(out.includes(k), k);
});

test('报告：手指做的那一下、翻成的那一行、页面没让做（弹回去了）、撤掉的那一下', () => {
  const base = { played: 0, errors: [], state: '树 t', goals: [], called: null, pending: '', untouched: null, issues: [], shot: '' };
  const out = formatReport({ file: 'avl.txt', views: [{ tag: '竖屏', steps: [
    { ...base, step: { kind: 'student', how: 'do', cmd: 'rotate', args: 't.50 left', line: 9 }, did: '把 t.60 拖到 t.50 上 → rotate t#1 left', blocked: '这一下不是正确的下一步，型从下往上读了，没让做' },
    { ...base, step: { kind: 'student', how: 'do', cmd: 'undo', args: '', line: 10 }, undone: 'rotate t#2 left' },
  ] }] });
  for (const k of ['手指做的：把 t.60 拖到 t.50 上 → rotate t#1 left', '页面没让做（弹回去了）：这一下不是正确的下一步', '撤掉的那一下：rotate t#2 left', '第 2 步：学生 第 10 行 undo']) assert.ok(out.includes(k), k);
});

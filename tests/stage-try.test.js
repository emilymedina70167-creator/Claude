// 舞台试演工具（tools/stage-try.mjs）不碰浏览器的那一半：读一幕的文件、把学生的一行翻成手势的输入、写报告
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTry, formatReport, studentGesture, STUDENT_FORMS, mustHits, goalsMetWhere, MUST, tryDiff, diffText } from '../tools/stage-try-lib.js';

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

// —— 第二轮的学生写法（真的手指：点、滑、按住 0.35 秒再拖、点 ✕、一格一格填）——
const NEW_FORMS = [
  'pick t.45 t.50', 'refer s.23 -> s.15', 'unrefer s.23', 'unmark s.21', 'move s.1-6 after s.11', 'unfold s.5', 'delete t.7',
  'compare AB BA', 'put AB Sum', 'merge X Y', 'back t "插入后"', 'value 1 n n(n-1)/2 / 0 1 n / 0 0 1',
];

test('新的学生写法：12 种各一条，回答一问的是 pick、value，别的 10 种直接动画面；翻成的手势都不带 error', () => {
  const s = parseTry(NEW_FORMS.map((f) => `学生: ${f}`).join('\n'));
  assert.equal(s.length, 12);
  assert.deepEqual(s.map((x) => x.cmd), ['pick', 'refer', 'unrefer', 'unmark', 'move', 'unfold', 'delete', 'compare', 'put', 'merge', 'back', 'value']);
  for (const x of s) {
    assert.equal(x.how, ['pick', 'value'].includes(x.cmd) ? 'answer' : 'do', `${x.cmd} 的 how`);
    assert.ok(!x.gesture?.error, `${x.src}：${x.gesture?.error}`);
  }
  for (const f of NEW_FORMS) assert.ok(STUDENT_FORMS.includes(f), `学生能写的列表里有 ${f}`);
  const by = Object.fromEntries(s.map((x) => [x.cmd, x]));
  assert.deepEqual(by.pick.gesture, { action: 'pick', refs: ['t.45', 't.50'] });
  assert.deepEqual(by.refer.gesture, { obj: 's', action: 'refer', from: 's.23', to: 's.15' });
  assert.deepEqual(by.unrefer.gesture, { obj: 's', action: 'unrefer', at: 's.23' });
  assert.deepEqual(by.unmark.gesture, { obj: 's', action: 'unmark', span: 's.21' });
  assert.deepEqual(by.move.gesture, { obj: 's', action: 'move', span: 's.1-6', where: 'after', at: 's.11' });
  assert.deepEqual(by.unfold.gesture, { obj: 's', action: 'unfold', at: 's.5' });
  assert.deepEqual(by.delete.gesture, { obj: 't', action: 'delete', at: 't.7' });
  assert.deepEqual(by.compare.gesture, { obj: 'AB', action: 'compare', to: 'BA' });
  assert.deepEqual(by.put.gesture, { obj: 'AB', action: 'put', to: 'Sum' });
  assert.deepEqual(by.merge.gesture, { obj: 'X', action: 'merge', to: 'Y' });
  assert.deepEqual(by.back.gesture, { obj: 't', action: 'back', name: '插入后' });
  // 按格的那一问：答案照原样交给页面，页面看是一个框还是一格一格的（answer.js 的 formulaRows 切开）
  assert.equal(by.value.gesture, undefined);
  assert.equal(by.value.args, '1 n n(n-1)/2 / 0 1 n / 0 0 1');
});

test('新的学生写法的几种变体：线松在一道括号、整句；挪到最前面；refer 写 →；back 写中文引号', () => {
  const g = (line) => studentGesture(...line.split(/\s+(.*)/s).slice(0, 2));
  assert.deepEqual(g('refer s.6 -> s.1-2'), { obj: 's', action: 'refer', from: 's.6', to: 's.1-2' });
  assert.deepEqual(g('refer s.6 → s'), { obj: 's', action: 'refer', from: 's.6', to: 's' });
  assert.deepEqual(g('move s.7 before s.1'), { obj: 's', action: 'move', span: 's.7', where: 'before', at: 's.1' });
  assert.deepEqual(g('move s.3 -> s.1'), { obj: 's', action: 'move', span: 's.3', where: 'to', at: 's.1' });
  assert.deepEqual(g('back t 「回到前」'), { obj: 't', action: 'back', name: '回到前' });
  assert.deepEqual(g('unmark s.2-5'), { obj: 's', action: 'unmark', span: 's.2-5' });
  assert.deepEqual(g('delete t#4'), { obj: 't', action: 'delete', at: 't#4' });
});

test('新的学生写法写错了：说清楚为什么（不抛错）', () => {
  const g = (line) => studentGesture(...line.split(/\s+(.*)/s).slice(0, 2));
  for (const [line, re] of [
    ['pick', /pick t\.45 t\.50/],
    ['pick t', /pick t\.45 t\.50/],
    ['refer s.23', /refer s\.23 -> s\.15/],
    ['refer s -> s.2', /refer s\.23 -> s\.15/],
    ['refer s.3 -> t.2', /同一句/],
    ['unrefer s', /unrefer s\.23/],
    ['unmark', /unmark s\.21/],
    ['move s.1-6', /move s\.1-6 after s\.11/],
    ['unfold s', /unfold s\.5/],
    ['delete t', /delete t\.7/],
    ['compare AB', /compare AB BA/],
    ['put AB.1,1 Sum', /put AB Sum/],
    ['merge X', /merge X Y/],
    ['back t', /back t "插入后"/],
  ]) {
    const r = g(line);
    assert.ok(r.error, `${line}：{ error }`);
    assert.match(r.error, re, line);
  }
});

test('stage-must 攒着的也查：叫老师的那几条、最后一步还攒着没发出去的', () => {
  const step = (called, pending) => ({ step: { kind: 'student' }, called: called ? { why: '答了', msg: called } : null, pending });
  // 最后一步没叫老师、攒着的里有：算 ✓
  assert.equal(mustHits([step('[学生]\n学生填了「3」', ''), step(null, '学生拨了 k：1 → 2（停在 2）')], /学生拨了 \S+：/).length, 1);
  // 只在前面某一步攒着过（后来发出去了、或者被别的换掉了），最后一步没有：不算
  assert.equal(mustHits([step(null, '学生拨了 k：1 → 2'), step(null, '学生点了「好了」')], /学生拨了 \S+：/).length, 0);
  // 叫老师的那一条里有：哪一步都算
  const hits = mustHits([step('学生拨了 k：1 → 2', ''), step(null, ''), step('r(A) = 2', '')], /学生拨了 \S+：|r\(A\) = \d/);
  assert.deepEqual(hits.map((h) => [h.step, h.where]), [[0, 'called'], [2, 'called']]);
  // 带 g 的正则不因为 lastIndex 漏掉
  assert.equal(mustHits([step('无解', ''), step('无解', '')], /无解/g).length, 2);
  assert.deepEqual(mustHits([], /x/), []);
});

test('stage-must 的表：照设计第 13 节，正则对得上舞台写的样子', () => {
  const files = MUST.flatMap((m) => m.files);
  for (const f of ['L2/分支3.txt', 'L2/幕5.txt', 'L2/幕4.txt', 'D2/幕5.txt', 'D2/幕6.txt', 'E2/幕1.txt', 'E2/幕6.txt', 'E2/分支1.txt', 'E3/幕8.txt', 'L1/幕3.txt', 'E3/幕1.txt']) assert.ok(files.includes(f), f);
  const hit = (file, text) => MUST.find((m) => m.files.includes(file)).checks.map((c) => c.re.test(text));
  // 三幕一组（was initiated 在 E2 第 6 幕、to help 在 E3 第 8 幕、分支 1 两种都有）：一条事实三幕里有一幕有就算；别的每一幕各查
  assert.deepEqual(MUST.filter((m) => m.anyOf).map((m) => m.files), [['E2/幕6.txt', 'E2/分支1.txt', 'E3/幕8.txt']]);
  assert.deepEqual(MUST.find((m) => m.files.includes('D2/幕5.txt')).files, ['D2/幕5.txt']);
  assert.deepEqual(hit('L2/分支3.txt', '页面算的：rankA(M) = 1，rank(M) = 2\n0 = −3\n拨 l（1 → 2）'), [true, true, true, true]);
  assert.deepEqual(hit('L2/幕5.txt', 'r(A) = 2，r(A | b) = 3：无解\n学生拨了 l：1 → 2'), [true, true, true, true]);
  assert.deepEqual(hit('L2/幕4.txt', '第 3 格该是 −4'), [true]);
  assert.deepEqual(hit('E2/幕6.txt', '学生 mark s.4 谓语——was 只圈了一半\n学生 mark s.9 谓语（ensuring）——把非谓语当成了谓语'), [true, true]);
  assert.deepEqual(hit('E2/幕6.txt', 'was\n只圈了一半'), [false, false], '要在同一行里');
  assert.deepEqual(hit('L1/幕3.txt', '学生拨了 k：1 → 2 → 3（拨到 3 时做到了 g1）'), [true]);
  assert.deepEqual(hit('E3/幕1.txt', '学生点了 q.2（laughing）'), [true]);
  assert.deepEqual(hit('E3/幕1.txt', '学生点了 q.2（laugh）'), [false], '题卡那一行写的不是 laughs / laughing');
  assert.deepEqual(hit('D2/幕5.txt', 'count(t) = 6，height(t) = 4，tray(t) = 0'), [true, true, true]);
  assert.ok(MUST.find((m) => m.files.includes('D2/幕5.txt')).noMetAt, '幕 5 另查 4 个结点时不打勾');
});

test('幕 5 另查：现状是 4 个结点的那几步，没有挑战是「做到了」（做到过、现在不成立的不算）', () => {
  const st = (state, ...goals) => ({ step: { kind: 'student' }, state, goals: goals.map((status, i) => ({ id: `g${i + 1}`, text: '', status })) });
  const re = /树 \S+（4 个结点/;
  assert.deepEqual(goalsMetWhere([st('树 w（3 个结点，2 层）', '还没做到'), st('树 w（4 个结点，3 层）', '做到了'), st('树 w（4 个结点，3 层）', '做到过；现在不成立（…）')], re), [1]);
  assert.deepEqual(goalsMetWhere([st('树 w（4 个结点，3 层）', '还没做到（w height 3 ✗）'), st('树 w（6 个结点，3 层）', '做到了')], re), []);
});

test('stage-try-diff：基线里没错的、现在报错的；演上的行少了；新多了没交给学生的；没跑到的步', () => {
  const T = (line, played, errors = []) => ({ step: { kind: 'teacher', line }, played, errors });
  const S = (line, cmd, extra = {}) => ({ step: { kind: 'student', line, cmd, args: '' }, errors: [], untouched: null, ...extra });
  const view = (tag, steps, stopped = null) => ({ tag, steps, stopped });
  const base = [{ file: 'a.txt', path: 'try/D1/a.txt', views: [view('竖屏', [T(1, 5, [{ line: 3, src: 'swap a.9 a.1', error: '没有第 9 格' }]), S(6, 'next'), T(7, 4), S(9, 'tap')])] }];
  // 一模一样：没有不同
  assert.deepEqual(tryDiff(base, structuredClone(base)), []);
  const now = structuredClone(base);
  const v = now[0].views[0];
  v.steps[0].errors = [{ line: 3, src: 'swap a.9 a.1', error: '换了说法：a 只有 8 格' }, { line: 4, src: 'pulse a.2', error: '没有 a.2' }];
  v.steps[2].played = 3;
  v.steps[3].untouched = 'a 没有交给学生 drag';
  const d = tryDiff(base, now);
  assert.deepEqual(d.map((x) => [x.path, x.view, x.step, x.kind]), [
    ['try/D1/a.txt', '竖屏', 1, 'error'], ['try/D1/a.txt', '竖屏', 3, 'played'], ['try/D1/a.txt', '竖屏', 4, 'untouched'],
  ]);
  assert.match(d[0].text, /第 4 行「pulse a\.2」：没有 a\.2/, '改了说法的报错不算（同一行基线里就报了）');
  assert.match(d[1].text, /演上了 3 行（基线 4 行）/);
  // 现在少跑了步、少了文件、照演了的提醒也列出来
  const short = structuredClone(base);
  short[0].views[0].steps = short[0].views[0].steps.slice(0, 2);
  short[0].views[0].stopped = '后面的步没跑：页面在等老师';
  short[0].views[0].steps[0].errors.push({ line: 2, src: 'say "{kk}"', error: '「{kk}」不是拨数', kept: true });
  const d2 = tryDiff(base, short);
  assert.deepEqual(d2.map((x) => x.kind), ['error', 'missing']);
  assert.match(d2[0].text, /照演了/);
  assert.match(d2[1].text, /第 3、4 步没跑到（后面的步没跑：页面在等老师）/);
  assert.deepEqual(tryDiff(base, []).map((x) => x.kind), ['file']);
  // 没有 path 的照文件名对（tools/stage-try.mjs 以前的输出）
  const noPath = structuredClone(base).map(({ path, ...r }) => r);
  assert.deepEqual(tryDiff(noPath, noPath), []);
  assert.match(diffText(d), /3 处不同/);
  assert.match(diffText([]), /没有不同/);
});

// —— fix1：一条页面毛病一份最小的试演，查「必须出现 / 不许出现」（舞台主线第一轮）——
import { FIX1, mustNotHits, seenHits, auditHits } from '../tools/stage-try-lib.js';

test('fix1 的查法：不许出现的在叫老师的那条、攒着的、现状、报错里都查', () => {
  const steps = [{ called: { msg: '学生填了「1,4」——填错了' }, state: '在等学生：打字回答', errors: [{ line: 2, src: 'ask drag k', error: '图不能拖' }] }, { pending: '做到了', state: '好' }];
  assert.deepEqual(mustNotHits(steps, /填错了/), [{ step: 0, where: 'called' }]);
  assert.deepEqual(mustNotHits(steps, /打字回答/), [{ step: 0, where: 'state' }]);
  assert.deepEqual(mustNotHits(steps, /图不能拖/), [{ step: 0, where: 'errors' }]);
  assert.deepEqual(mustNotHits(steps, /做到了/), [{ step: 1, where: 'pending' }]);
  assert.deepEqual(mustNotHits(steps, /没有的话/), []);
  assert.deepEqual(seenHits(steps, /图不能拖|做到了/), [0, 1]);
});
test('fix1 的查法：排版那一栏', () => {
  const steps = [{ issues: [] }, { issues: [{ what: '压着', a: 'obj:a', b: 'obj:b' }, { what: '出了屏幕', a: 'obj:q', b: '' }] }];
  assert.deepEqual(auditHits(steps, /压着：obj:a 和 obj:b/), [1]);
  assert.deepEqual(auditHits(steps, /出了屏幕：obj:q/), [1]);
  assert.deepEqual(auditHits(steps, /缩得太小/), []);
});
test('fix1 的表：每行有编号、文件，checks / nots / called / audit / noAudit 至少一样', () => {
  for (const r of FIX1) {
    assert.match(r.id, /^(D1|D3|D4|L3|E1)-\d+|^side-\d$/);
    assert.ok(r.files.length);
    assert.ok(['checks', 'nots', 'called', 'audit', 'noAudit'].some((k) => r[k]?.length), r.id);
  }
});

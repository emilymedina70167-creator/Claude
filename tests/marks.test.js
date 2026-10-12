import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../kit/src/tokens.js';
import { parseMarkSpec, parseMarkBlock, parseUnmark, markText, defaultStyle } from '../kit/src/markspec.js';
import { parseOutput, parseCommand } from '../kit/src/class/protocol.js';

const spec = (s, o) => {
  const r = parseMarkSpec(s, o);
  assert.ok(r.spec, `应该能解析：${s}（${r.error}）`);
  return r.spec;
};
const err = (s, o) => {
  const r = parseMarkSpec(s, o);
  assert.ok(r.error, `应该报错：${s}`);
  return r.error;
};

test('tokens：引号、括号里的空格、等号后面空着', () => {
  const t = tokenize('target=fig-1 at=[1, 2] note="Ax 在这" side=右');
  assert.deepEqual(t.map((x) => [x.key, x.value]), [['target', 'fig-1'], ['at', '[1, 2]'], ['note', 'Ax 在这'], ['side', '右']]);
  assert.deepEqual(tokenize('id= title="对"').map((x) => [x.key, x.value]), [['id', ''], ['title', '对']]);
  assert.deepEqual(tokenize('note=「一个数」 row 2').map((x) => [x.key, x.value, x.quoted]), [['note', '一个数', true], [null, 'row', false], [null, '2', false]]);
  assert.deepEqual(tokenize('at=([1, 2])x').map((x) => x.value), ['([1, 2])x']);
});

test('parseMarkSpec：各种「标哪里」和默认画法', () => {
  assert.deepEqual(spec('target=b5 term=mid note="一个数"'), { target: 'b5', sel: { kind: 'term', name: 'mid' }, note: '一个数', color: 'yellow', style: 'circle' });
  assert.deepEqual(spec('target=m1 row 2').sel, { kind: 'row', i: 2 });
  assert.equal(spec('target=m1 row 2').style, 'box');
  assert.deepEqual(spec('target=m1 row=3').sel, { kind: 'row', i: 3 });
  assert.deepEqual(spec('target=m1 col2').sel, { kind: 'col', j: 2 });
  assert.deepEqual(spec('target=m1 entry=2,3').sel, { kind: 'entry', i: 2, j: 3 });
  assert.deepEqual(spec('target=m1 entry 2，3').sel, { kind: 'entry', i: 2, j: 3 });
  assert.deepEqual(spec('target=m1 entry=(1, 2)').sel, { kind: 'entry', i: 1, j: 2 });
  assert.deepEqual(spec('target=m1 diag').sel, { kind: 'diag' });
  assert.deepEqual(spec('target=m1 主对角线').sel, { kind: 'diag' });
  assert.deepEqual(spec('target=m1 block=1,2').sel, { kind: 'block', i: 1, j: 2 });
  assert.deepEqual(spec('target=ex-1 step=2').sel, { kind: 'step', k: 2 });
  assert.deepEqual(spec('target=fig-1 label=Ax').sel, { kind: 'label', text: 'Ax' });
  assert.deepEqual(spec('target=fig-1 item 4').sel, { kind: 'item', k: 4 });
  assert.deepEqual(spec('target=fig-1 at=[1, 2] style=arrow').sel, { kind: 'at', expr: '[1, 2]' });
  assert.deepEqual(spec('target=b5').sel, { kind: 'all' });
  assert.equal(spec('target=b5').style, 'box');
  for (const k of ['term', 'entry', 'at', 'label', 'item']) assert.equal(defaultStyle(k), 'circle');
});

test('parseMarkSpec：画法、颜色、旁注、位置的各种写法', () => {
  const s = spec('target=b5 term=x 框 粉 "看这里" side=左 of=A id=key-1');
  assert.equal(s.style, 'box');
  assert.equal(s.color, 'pink');
  assert.equal(s.note, '看这里');
  assert.equal(s.side, 'left');
  assert.equal(s.of, 'A');
  assert.equal(s.id, 'key-1');
  assert.equal(spec('target=b5 term=x style=cancel').style, 'strike');
  assert.equal(spec('target=b5 term=x color=Gold').color, 'yellow');
  assert.equal(spec('target=b5 term=x underline blue').style, 'underline');
  assert.equal(spec('target=b5 term=x note="  "').note, undefined);
});

test('parseMarkSpec：写错了说清楚哪里错', () => {
  assert.match(err('term=mid'), /缺少 target/);
  assert.match(err('target=b5 term=mid row=2'), /只能标一处/);
  assert.match(err('target=b5 row'), /row 后面要写序号/);
  assert.match(err('target=b5 row=0'), /从 1 数/);
  assert.match(err('target=b5 entry=2'), /两个从 1 数的序号/);
  assert.match(err('target=b5 style=wavy'), /style 只认/);
  assert.match(err('target=b5 color=teal'), /color 只认/);
  assert.match(err('target=b5 side=middle'), /side 只认/);
  assert.match(err('target=b5 foo=1'), /看不懂「foo=」/);
  assert.match(err('target=b5 blah'), /看不懂「blah」/);
  assert.match(err('target=b5 at=1,2'), /at 后面写图里的坐标/);
  assert.match(err('target=b5 term=a.b'), /只能用字母/);
  assert.match(err(`target=b5 term=x note="${'很'.repeat(81)}"`), /旁注太长/);
  assert.match(err('target=b5 term=x "一" "二"'), /多了一段引号/);
  assert.match(err('target=b5 row 2 from=2'), /from \/ until 只用在 matrix 组件/);
  assert.match(err('target=.. row 2'), /target「..」不合法/);
});

test('parseMarkSpec：matrix 组件里的 mark', () => {
  const s = spec('row 2 note="×2" from=1 until=3', { component: true });
  assert.deepEqual(s, { sel: { kind: 'row', i: 2 }, note: '×2', from: 1, until: 3, color: 'yellow', style: 'box' });
  assert.match(err('target=m1 row 2', { component: true }), /不写 target/);
  assert.match(err('term=x', { component: true }), /只能标 row、col、diag、entry、block/);
  assert.equal(spec('', { component: true }).sel.kind, 'all');
});

test('parseMarkBlock：开头那行给 target 和颜色，块里一行一条', () => {
  const r = parseMarkBlock('target=b5 color=pink', 'term=mid note="一个数"\nterm=rest blue\n\n# 说明行不算\nrow 9 style=wavy');
  assert.equal(r.marks.length, 2);
  assert.deepEqual(r.marks.map((m) => [m.target, m.sel.name, m.color]), [['b5', 'mid', 'pink'], ['b5', 'rest', 'blue']]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^第 3 行「row 9 style=wavy」：style 只认/);
  // 开头那行自己也指了地方：它也算一条
  const both = parseMarkBlock('target=b5 term=a', 'term=b');
  assert.deepEqual(both.marks.map((m) => m.sel.name), ['a', 'b']);
  // 块里空着：开头那行就是一条（只写 target 就框住整段）
  assert.deepEqual(parseMarkBlock('target=b5', '').marks.map((m) => m.sel.kind), ['all']);
  // 各行自己写 target
  assert.deepEqual(parseMarkBlock('', 'target=b5 term=a\ntarget=fig-1 at=[1, 2]').marks.map((m) => m.target), ['b5', 'fig-1']);
  assert.match(parseMarkBlock('', 'term=a').errors[0], /缺少 target/);
  assert.ok(parseMarkBlock('target=b5 wavy', '').error);
});

test('parseUnmark：id、target、all，可以写好几个', () => {
  assert.deepEqual(parseUnmark('id=m3'), { ids: ['m3'], targets: [], all: false });
  assert.deepEqual(parseUnmark('m3 m4'), { ids: ['m3', 'm4'], targets: [], all: false });
  assert.deepEqual(parseUnmark('target=b5'), { ids: [], targets: ['b5'], all: false });
  assert.deepEqual(parseUnmark('b5'), { ids: [], targets: ['b5'], all: false });
  assert.deepEqual(parseUnmark('all'), { ids: [], targets: [], all: true });
  assert.ok(parseUnmark('').error);
  assert.ok(parseUnmark('color=red').error);
});

test('markText：给课堂 Claude 看的一行', () => {
  assert.equal(markText('m1', spec('target=b5 term=mid note="一个数"')), 'm1：b5 里\\hl{mid}（圈）「一个数」');
  assert.equal(markText('m2', spec('target=fig-1 of=A row 2 pink')), 'm2：fig-1 里A 的第 2 行（框，pink）');
  assert.equal(markText('m3', spec('target=b5')), 'm3：整个 b5（框）');
});

test('协议：mark / unmark 指令', () => {
  assert.deepEqual(parseCommand('mark target=b5 term=mid'), { op: 'mark', head: 'target=b5 term=mid', target: 'b5' });
  assert.match(parseCommand('mark target=b5 wavy').error, /看不懂「wavy」/);
  assert.deepEqual(parseCommand('unmark m1'), { op: 'unmark', ids: ['m1'], targets: [], all: false });
  assert.ok(parseCommand('unmark').error);

  const text = [
    '看这一项：',
    '```board mark target=b5 term=mid note="一个数"```',
    '````board mark target=fig-1',
    'at=[1, 2] style=arrow note="Ax 在这"',
    'label=Ax pink',
    'row 99 bogus',
    '````',
    '```board unmark m1```',
    '```board mark target=b5 nonsense```',
  ].join('\n');
  const r = parseOutput(text, { final: true });
  const ops = r.ops;
  assert.deepEqual(ops.map((o) => o.op), ['mark', 'mark', 'unmark']);
  assert.equal(ops[0].marks.length, 1);
  assert.equal(ops[0].marks[0].note, '一个数');
  assert.deepEqual(ops[1].marks.map((m) => m.sel.kind), ['at', 'label']);
  assert.equal(ops[1].marks[1].color, 'pink');
  assert.equal(ops[1].errors.length, 1);
  assert.match(ops[1].errors[0], /第 3 行/);
  assert.deepEqual(ops[2].ids, ['m1']);
  // 一条也没写对：整块看不懂，当普通文字
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].error, /nonsense/);
});

test('协议：mark 块流式时先只看开头那行，闭合后才拼出 marks', () => {
  const text = '````board mark target=b5\nterm=a\nterm=b\n````\n';
  for (let i = 1; i < text.length; i++) parseOutput(text.slice(0, i)); // 不抛异常
  const draft = parseOutput('````board mark target=b5\nterm=a\n');
  const b = draft.segments.find((s) => s.type === 'board');
  assert.equal(b.closed, false);
  assert.equal(b.op.op, 'mark');
  assert.equal(b.op.marks, undefined);
  const done = parseOutput(text, { final: true });
  assert.deepEqual(done.ops[0].marks.map((m) => m.sel.name), ['a', 'b']);
});

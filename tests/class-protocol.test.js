import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOutput, parseCommand } from '../kit/src/class/protocol.js';

const speeches = (r) => r.segments.filter((s) => s.type === 'speech').map((s) => s.text);
const boards = (r) => r.segments.filter((s) => s.type === 'board');
const types = (r) => r.segments.map((s) => s.type);

// 一轮典型输出：先说话，再用 ````board（4 个反引号）加一段带组件的课件，再用 ```board 动图
const TURN = [
  '我们换个角度：$A\\mathbf x$ 本身也是一个向量。',
  '',
  '````board add id=b7 title="Ax 也是一个向量"',
  '先看图，拖动 $\\mathbf x$ 🙂：',
  '',
  '```scene',
  'id: fig-b7',
  'let A = [[1, 1], [2, 2]]',
  'vector x = [1, 0] drag',
  'vector A*x',
  '```',
  '',
  '```steps',
  'id: ex-b7',
  'step: Ax 在哪',
  'ask: 不管 x 怎么拖，Ax 落在哪？',
  'choices: 一条线上 | 到处都有',
  'answer: 一条线上',
  'show: 都在 (1, 2) 方向上',
  '```',
  '````',
  '',
  '拖一拖，看看 $A\\mathbf x$ 跑不跑出那条线。',
  '```board figure target=fig-b7 set x=[1, 2] k=2',
  '```',
  '```board figure target=fig-b7 play t 0 1 2s',
  '```',
  '```board hide id=b5',
  '```',
  '',
].join('\n');

test('纯文字：保留 Markdown，去掉首尾空行，空的不输出', () => {
  const r = parseOutput('\n\n  - 先看 **第一列**\n  - 再看第二列\n\n\n');
  assert.deepEqual(r.segments, [{ type: 'speech', text: '  - 先看 **第一列**\n  - 再看第二列' }]);
  assert.deepEqual(r.ops, []);
  for (const empty of ['', '\n\n', '   \n \t\n', null, undefined]) {
    assert.deepEqual(parseOutput(empty).segments, [], `输入 ${JSON.stringify(empty)}`);
    assert.deepEqual(parseOutput(empty, { final: true }).segments, []);
  }
  // 普通文字里的非 board 代码块原样算作文字
  const code = '看这段：\n```python\nprint(1)\n```\n就这样。';
  assert.deepEqual(parseOutput(code, { final: true }).segments, [{ type: 'speech', text: code }]);
});

test('多个 board 块：顺序、header、body、ops', () => {
  const r = parseOutput(TURN, { final: true });
  assert.deepEqual(types(r), ['speech', 'board', 'speech', 'board', 'board', 'board']);
  assert.equal(speeches(r)[0], '我们换个角度：$A\\mathbf x$ 本身也是一个向量。');
  assert.equal(speeches(r)[1], '拖一拖，看看 $A\\mathbf x$ 跑不跑出那条线。');
  const [add] = boards(r);
  assert.equal(add.header, 'add id=b7 title="Ax 也是一个向量"');
  assert.equal(add.closed, true);
  assert.deepEqual(add.op, { op: 'add', id: 'b7', title: 'Ax 也是一个向量' });
  assert.ok(add.body.startsWith('先看图'));
  assert.match(add.body, /```scene\nid: fig-b7[\s\S]*```\n\n```steps[\s\S]*show: 都在 \(1, 2\) 方向上\n```$/);
  assert.deepEqual(r.ops.map((o) => [o.op, o.id || o.target, o.action]), [
    ['add', 'b7', undefined],
    ['figure', 'fig-b7', 'set'],
    ['figure', 'fig-b7', 'play'],
    ['hide', 'b5', undefined],
  ]);
  assert.equal(r.ops[0].body, add.body, 'ops 带上 body');
  assert.equal(r.ops[3].body, '');
  assert.deepEqual(r.ops[1].assigns, { x: '[1, 2]', k: '2' });
  assert.deepEqual(r.rejected, []);
  // 流式但全文已收完：结果一样
  assert.deepEqual(parseOutput(TURN), r);
});

test('嵌套组件围栏：外层 3 个反引号', () => {
  const t = '```board add id=b1\n文字\n```scene\nid: fig-1\nvector [1, 2]\n```\n\n```answer\nid: q-1\nanswer: 3\n```\n```\n之后的话';
  const r = parseOutput(t, { final: true });
  assert.deepEqual(types(r), ['board', 'speech']);
  assert.equal(r.segments[0].body, '文字\n```scene\nid: fig-1\nvector [1, 2]\n```\n\n```answer\nid: q-1\nanswer: 3\n```');
  assert.equal(r.segments[1].text, '之后的话');
});

test('嵌套组件围栏：外层 4 个反引号，内层 ``` 碰不到外层', () => {
  const t = '````board replace id=b2 title="改一下"\n```scene\nid: fig-2\n```\n```\n这一行还在块里\n````\n完';
  const r = parseOutput(t, { final: true });
  assert.deepEqual(types(r), ['board', 'speech']);
  assert.deepEqual(r.ops[0], { op: 'replace', id: 'b2', title: '改一下', body: '```scene\nid: fig-2\n```\n```\n这一行还在块里' });
  // 组件忘了闭合：```` 仍然结束这一块，不会把后面的话吞掉
  const forgot = parseOutput('````board add id=b3\n```scene\nid: fig-3\nvector [1, 1]\n````\n后面的话', { final: true });
  assert.deepEqual(types(forgot), ['board', 'speech']);
  assert.equal(forgot.ops[0].body, '```scene\nid: fig-3\nvector [1, 1]');
  // 更长的闭合围栏也算
  assert.equal(parseOutput('````board hide id=b1\n``````\n', { final: true }).ops.length, 1);
});

test('嵌套组件围栏：内层比外层长时，内层里的 ``` 是原文', () => {
  const t = '```board add id=b4\n````steps\nid: s-1\nshow: 代码\n```\nx = 1\n```\n````\n```\n';
  const r = parseOutput(t, { final: true });
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].body, '````steps\nid: s-1\nshow: 代码\n```\nx = 1\n```\n````');
  // 内层用 ~~~ 围栏也一样跳过
  const tilde = parseOutput('```board add id=b5\n~~~scene\nid: f\n~~~\n```\n', { final: true });
  assert.equal(tilde.ops[0].body, '~~~scene\nid: f\n~~~');
  // ```a``` 是行内代码，不是内层围栏
  const inline = parseOutput('```board add id=b6\n```A``` 写在行首的行内代码\n```\n后面', { final: true });
  assert.deepEqual(inline.ops, [{ op: 'add', id: 'b6', body: '```A``` 写在行首的行内代码' }]);
  // 内层没有信息串的代码块不压栈：外层 ```` 时它碰不到外层
  const anon = parseOutput('````board add id=b7\n```\n纯代码\n```\n````\n', { final: true });
  assert.equal(anon.ops[0].body, '```\n纯代码\n```');
});

test('~~~ 围栏', () => {
  const t = '好\n~~~board add id=b8 title=「波浪线」\n```scene\nid: fig-8\n```\n```\n~~~\n再见\n~~~~board hide id=b8\n~~~~\n';
  const r = parseOutput(t, { final: true });
  assert.deepEqual(types(r), ['speech', 'board', 'speech', 'board']);
  assert.deepEqual(r.ops[0], { op: 'add', id: 'b8', title: '波浪线', body: '```scene\nid: fig-8\n```\n```' });
  assert.deepEqual(r.ops[1], { op: 'hide', id: 'b8', body: '' });
  // ~~~ 外层：``` 不能闭合它
  const open = parseOutput('~~~board add id=b9\n文字\n```\n', { final: false });
  assert.equal(boards(open)[0].closed, false);
});

test('流式：逐字截断，每个前缀都不抛异常，闭合前的块都是 closed:false', () => {
  const full = parseOutput(TURN, { final: true });
  // 每个 board 块闭合围栏那一行（含换行）结束的位置
  const closeEnds = ['方向上\n```\n````\n', 'k=2\n```\n', '2s\n```\n', 'b5\n```\n'].map((s) => TURN.indexOf(s) + s.length);
  assert.ok(closeEnds.every((e, k) => e > 0 && (k === 0 || e > closeEnds[k - 1])));
  let lastOps = 0;
  for (let n = 0; n <= TURN.length; n++) {
    const prefix = TURN.slice(0, n);
    let r;
    assert.doesNotThrow(() => { r = parseOutput(prefix); }, `前缀 ${n}`);
    assert.doesNotThrow(() => parseOutput(prefix, { final: true }), `前缀 ${n}（final）`);
    const want = closeEnds.filter((e) => e <= n).length;
    assert.equal(r.ops.length, want, `前缀 ${n}：已闭合 ${want} 块`);
    assert.deepEqual(r.ops, full.ops.slice(0, want), `前缀 ${n}：已闭合的块和最终结果一致`);
    assert.ok(r.ops.length >= lastOps, '已闭合的块不会消失');
    lastOps = r.ops.length;
    // 没闭合的块只能是最后一个片段
    const bs = boards(r);
    bs.forEach((b, k) => { if (!b.closed) assert.equal(r.segments.indexOf(b), r.segments.length - 1, `前缀 ${n}：草稿块在最后`); });
    assert.equal(bs.filter((b) => !b.closed).length, bs.length - want);
    // 话里不会闪出半截围栏
    for (const s of speeches(r)) assert.ok(!/[`~]/.test(s), `前缀 ${n}：话里出现了围栏 ${JSON.stringify(s)}`);
  }
});

test('流式：块写到一半时是草稿，op 尽量先解析出来', () => {
  const at = (s) => TURN.slice(0, TURN.indexOf(s) + s.length);
  let r = parseOutput(at('````board add id=b7 title="Ax 也'));
  let last = r.segments[r.segments.length - 1];
  assert.equal(last.type, 'board');
  assert.equal(last.closed, false);
  assert.deepEqual(last.op, { op: 'add', id: 'b7', title: 'Ax 也' }, '引号还没写完的标题取到行尾');
  assert.equal(last.body, '');

  r = parseOutput(at('vector x = [1, 0] dr'));
  last = r.segments[r.segments.length - 1];
  assert.equal(last.closed, false);
  assert.ok(last.body.endsWith('```scene\nid: fig-b7\nlet A = [[1, 1], [2, 2]]\nvector x = [1, 0] dr'));
  assert.deepEqual(r.ops, []);

  // 闭合围栏写了一半、或者写完但还没换行：都还不算闭合
  for (const tail of ['`', '``', '```', '````']) {
    const p = at('show: 都在 (1, 2) 方向上\n```\n') + tail;
    const b = boards(parseOutput(p))[0];
    assert.equal(b.closed, false, `结尾是 ${tail}`);
    assert.ok(b.body.endsWith('show: 都在 (1, 2) 方向上\n```'), '半截围栏不进 body');
  }
  assert.equal(boards(parseOutput(at('show: 都在 (1, 2) 方向上\n```\n````\n')))[0].closed, true);
  // 收到最后一个字但还没换行：final 时算闭合
  assert.equal(parseOutput('```board hide id=b5\n```', { final: true }).ops.length, 1);
  assert.equal(parseOutput('```board hide id=b5\n```').ops.length, 0);

  // 话后面跟着半截 board 开头：先不显示
  for (const tail of ['`', '``', '```', '```b', '```boar', '~~~', '````  bo']) {
    const segs = parseOutput('你好\n' + tail).segments;
    assert.deepEqual(segs, [{ type: 'speech', text: '你好' }], `结尾是 ${tail}`);
  }
  assert.deepEqual(parseOutput('你好\n```ba').segments, [{ type: 'speech', text: '你好\n```ba' }], '不像 board 了就照常显示');
  assert.deepEqual(parseOutput('你好\n``', { final: true }).segments, [{ type: 'speech', text: '你好\n``' }]);
  // 开头那行刚写完 board：草稿块，指令还看不懂也没关系
  r = parseOutput('你好\n```board');
  assert.deepEqual(types(r), ['speech', 'board']);
  assert.equal(boards(r)[0].op.error !== undefined, true);
});

test('流式：按不规则的块拼接，最后结果和一次性解析一致', () => {
  let text = '';
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  let i = 0;
  while (i < TURN.length) {
    const n = 1 + Math.floor(rand() * 20);
    text += TURN.slice(i, i + n);
    i += n;
    const r = parseOutput(text);
    for (const b of boards(r)) if (b.closed) assert.ok(!b.op.error);
  }
  assert.deepEqual(parseOutput(text, { final: true }), parseOutput(TURN, { final: true }));
});

test('未闭合的块：流式时是草稿，final 时整块当普通文字', () => {
  const t = '先说一句。\n\n````board add id=b1 title="还没写完"\n```scene\nid: fig-1\n```\n';
  const draft = parseOutput(t);
  assert.deepEqual(types(draft), ['speech', 'board']);
  assert.equal(boards(draft)[0].closed, false);
  assert.deepEqual(draft.ops, []);

  const fin = parseOutput(t, { final: true });
  assert.deepEqual(fin.segments, [{ type: 'speech', text: '先说一句。\n\n````board add id=b1 title="还没写完"\n```scene\nid: fig-1\n```' }]);
  assert.deepEqual(fin.ops, []);
  // 忘了闭合，下一块又开始了：上一块当文字，下一块照常
  const two = parseOutput('```board add id=b1\n内容\n```board add id=b2\n内容2\n```\n', { final: true });
  assert.deepEqual(two.segments, [
    { type: 'speech', text: '```board add id=b1\n内容' },
    { type: 'board', header: 'add id=b2', op: { op: 'add', id: 'b2' }, body: '内容2', closed: true },
  ]);
  const twoDraft = parseOutput('```board add id=b1\n内容\n```board add id=b2\n内容2');
  assert.deepEqual(types(twoDraft), ['speech', 'board']);
  assert.equal(boards(twoDraft)[0].op.id, 'b2');
});

test('看不懂的指令：已闭合的块整段当普通文字，并列进 rejected', () => {
  const cases = [
    ['```board move id=b1\n内容\n```', /看不懂的指令「move」/],
    ['```board add title="没有 id"\n内容\n```', /add 缺少 id/],
    ['```board add id=b 7\n内容\n```', null], // b 是 id，7 被忽略：合法
    ['```board hide id=第一段\n```', /不合法/],
    ['```board\nadd id=b1\n```', /缺少指令/],
    ['```board figure target=fig-1 spin\n```', /看不懂的 figure 动作「spin」/],
  ];
  for (const [src, err] of cases) {
    const t = `前面的话\n${src}\n后面的话`;
    const r = parseOutput(t, { final: true });
    if (!err) { assert.equal(r.ops.length, 1, src); continue; }
    assert.deepEqual(r.segments, [{ type: 'speech', text: t }], src);
    assert.deepEqual(r.ops, []);
    assert.equal(r.rejected.length, 1);
    assert.match(r.rejected[0].error, err);
  }
  // 合法块和非法块混在一起：只执行合法的
  const mix = parseOutput('```board hide id=b1\n```\n```board nope\n```\n```board hide id=b2\n```\n', { final: true });
  assert.deepEqual(mix.ops.map((o) => o.id), ['b1', 'b2']);
  assert.deepEqual(types(mix), ['board', 'speech', 'board']);
  assert.equal(mix.segments[1].text, '```board nope\n```');
});

test('开头那行的各种写法', () => {
  // board 前可以有空格；大小写不敏感；最多 3 个空格缩进，缩进会从 body 里去掉
  assert.equal(parseOutput('``` board hide id=b1\n```\n').ops[0].id, 'b1');
  assert.equal(parseOutput('```Board hide id=b1\n```\n').ops[0].id, 'b1');
  const ind = parseOutput('   ```board add id=b1\n   第一行\n     缩进的\n   ```\n');
  assert.equal(ind.ops[0].body, '第一行\n  缩进的');
  // 4 个空格是缩进代码，不是 board；```boards 也不是
  assert.deepEqual(parseOutput('    ```board hide id=b1\n    ```\n').ops, []);
  assert.deepEqual(parseOutput('```boards hide id=b1\n```\n').ops, []);
  // Windows 换行
  const crlf = parseOutput('嗯\r\n```board add id=b1\r\n内容\r\n```\r\n好\r\n');
  assert.deepEqual(crlf.ops, [{ op: 'add', id: 'b1', body: '内容' }]);
  assert.deepEqual(speeches(crlf), ['嗯', '好']);
  // 一行写完的短指令
  const one = parseOutput('```board figure target=fig-1 play t```\n好', { final: true });
  assert.deepEqual(one.ops, [{ op: 'figure', target: 'fig-1', action: 'play', name: 't', from: 0, to: 1, ms: 1200, body: '' }]);
  assert.deepEqual(speeches(one), ['好']);
  // 流式时一行指令写到一半，结尾的反引号先不算进指令
  const half = boards(parseOutput('```board hide id=b5``'))[0];
  assert.equal(half.closed, false);
  assert.deepEqual(half.op, { op: 'hide', id: 'b5' });
});

test('parseCommand：add / replace / hide', () => {
  assert.deepEqual(parseCommand('add id=b7 title="Ax 也是一个向量"'), { op: 'add', id: 'b7', title: 'Ax 也是一个向量' });
  assert.deepEqual(parseCommand('add id=b7'), { op: 'add', id: 'b7' });
  assert.deepEqual(parseCommand('replace id=b5'), { op: 'replace', id: 'b5' });
  assert.deepEqual(parseCommand('replace id=b5 title="新标题"'), { op: 'replace', id: 'b5', title: '新标题' });
  assert.deepEqual(parseCommand('hide id=b5'), { op: 'hide', id: 'b5' });
  assert.deepEqual(parseCommand('hide id=b5 title="多余"'), { op: 'hide', id: 'b5' }, 'hide 不带标题');
  assert.deepEqual(parseCommand('  ADD   id = b7   '), { op: 'add', id: 'b7' }, '大小写、多余空格');
  assert.deepEqual(parseCommand('hide b5'), { op: 'hide', id: 'b5' }, '省掉 id=');
  assert.deepEqual(parseCommand('add title="先写标题" id=b9'), { op: 'add', id: 'b9', title: '先写标题' }, '顺序随意');
  assert.deepEqual(parseCommand('add id=x.y-z_1:2@3+4~5'), { op: 'add', id: 'x.y-z_1:2@3+4~5' });
  assert.equal(parseCommand('add id=' + 'a'.repeat(64)).id.length, 64);
  assert.match(parseCommand('add id=' + 'a'.repeat(65)).error, /不合法/);
  assert.match(parseCommand('add id=b/7').error, /不合法/);
  assert.match(parseCommand('add').error, /add 缺少 id/);
  assert.match(parseCommand('add id= title="x"').error, /add 缺少 id/, '等号后面空着，不能把 title 当 id');
  assert.match(parseCommand('').error, /缺少指令/);
  assert.match(parseCommand(null).error, /缺少指令/);
  assert.match(parseCommand('delete id=b1').error, /看不懂的指令「delete」/);
});

test('parseCommand：中文引号和各种标题写法', () => {
  assert.equal(parseCommand('add id=b7 title=“Ax 也是一个向量”').title, 'Ax 也是一个向量');
  assert.equal(parseCommand('add id=b7 title=「秩一方阵」').title, '秩一方阵');
  assert.equal(parseCommand('add id=b7 title=『秩一』').title, '秩一');
  assert.equal(parseCommand("add id=b7 title='单引号'").title, '单引号');
  assert.equal(parseCommand('add id=b7 title=“左右写反了“').title, '左右写反了');
  assert.equal(parseCommand('add id=b7 title="混着写”').title, '混着写');
  assert.equal(parseCommand('add id=b7 title=“$A^n$ 怎么算” ').title, '$A^n$ 怎么算');
  // 标题里夹着引号
  assert.equal(parseCommand('add id=b7 title="他说"对"了"').title, '他说"对"了');
  assert.equal(parseCommand('add id=b7 title=“为什么是“一条线”” id=b8').id, 'b8');
  assert.equal(parseCommand('add id=b7 title=“为什么是“一条线”” id=b8').title, '为什么是“一条线”');
  // 不加引号：裸值；带空格的也接上，直到下一个 key=
  assert.equal(parseCommand('add id=b7 title=秩一').title, '秩一');
  assert.equal(parseCommand('add id=b7 title=Ax 也是 一个向量').title, 'Ax 也是 一个向量');
  assert.deepEqual(parseCommand('add title=Ax 也是 一个向量 id=b7'), { op: 'add', id: 'b7', title: 'Ax 也是 一个向量' });
  assert.equal(parseCommand('add id=b7 title=""').title, '');
  // 公式里的反斜杠原样保留
  assert.equal(parseCommand('add id=b7 title="$\\alpha\\beta^T$ 的迹"').title, '$\\alpha\\beta^T$ 的迹');
  // 全角等号
  assert.deepEqual(parseCommand('add id＝b7 title＝“全角”'), { op: 'add', id: 'b7', title: '全角' });
});

test('parseCommand：figure set 多个带空格、逗号、括号的值', () => {
  assert.deepEqual(parseCommand('figure target=fig-b7 set x=[1, 2] A=[[1,2],[3,4]] k=2'), {
    op: 'figure', target: 'fig-b7', action: 'set', assigns: { x: '[1, 2]', A: '[[1,2],[3,4]]', k: '2' },
  });
  assert.deepEqual(parseCommand('figure target=fig-b7 set A = [[1, 2], [3, 4]], x = [1, -1] , k=2 * t + 1').assigns, {
    A: '[[1, 2], [3, 4]]', x: '[1, -1]', k: '2 * t + 1',
  });
  // 括号里的 = 和比较符不切
  assert.deepEqual(parseCommand('figure target=f set h=(t>=0.5)*2 m=max(a, b) q=a==b').assigns, {
    h: '(t>=0.5)*2', m: 'max(a, b)', q: 'a==b',
  });
  // 全角标点、希腊字母变量、加了引号的值、分号分隔
  assert.deepEqual(parseCommand('figure target=f set x=［1，2］； θ=30 v="[0, 1]"').assigns, { x: '[1,2]', θ: '30', v: '[0, 1]' });
  // target 写在动作后面
  assert.deepEqual(parseCommand('figure set x=[1, 2] target=fig-9'), { op: 'figure', target: 'fig-9', action: 'set', assigns: { x: '[1, 2]' } });
  assert.deepEqual(parseCommand('figure fig-9 set x=1'), { op: 'figure', target: 'fig-9', action: 'set', assigns: { x: '1' } }, '省掉 target=');
  assert.deepEqual(parseCommand('figure id=fig-9 SET: x=1').assigns, { x: '1' });
  assert.match(parseCommand('figure target=f set').error, /set 后面缺少/);
  assert.match(parseCommand('figure target=f set x=').error, /x 后面缺少值/);
  assert.match(parseCommand('figure target=f set 把 x=1').error, /看不懂「把」/);
  assert.match(parseCommand('figure set x=1').error, /缺少 target/);
  assert.match(parseCommand('figure target=图1 set x=1').error, /target「图1」不合法/);
  assert.match(parseCommand('figure target=f').error, /缺少动作/);
  assert.match(parseCommand('figure target=f rotate 30').error, /看不懂的 figure 动作「rotate」/);
});

test('parseCommand：figure play 的可选参数', () => {
  const base = { op: 'figure', target: 'fig-b7', action: 'play' };
  assert.deepEqual(parseCommand('figure target=fig-b7 play t'), { ...base, name: 't', from: 0, to: 1, ms: 1200 });
  assert.deepEqual(parseCommand('figure target=fig-b7 play t 0 1 2s'), { ...base, name: 't', from: 0, to: 1, ms: 2000 });
  assert.deepEqual(parseCommand('figure target=fig-b7 play k -1 3 1500ms'), { ...base, name: 'k', from: -1, to: 3, ms: 1500 });
  assert.deepEqual(parseCommand('figure target=fig-b7 play t 1 0 2'), { ...base, name: 't', from: 1, to: 0, ms: 2000 }, '不带单位按秒');
  assert.deepEqual(parseCommand('figure target=fig-b7 play t 0 1 0.5s').ms, 500);
  assert.deepEqual(parseCommand('figure target=fig-b7 play t 0 1 3秒').ms, 3000);
  assert.deepEqual(parseCommand('figure target=fig-b7 play t 0 1 800').ms, 800, '≥100 的裸数显然是毫秒');
  assert.deepEqual(parseCommand('figure target=fig-b7 play t 0 1 600s').ms, 60000, '最长 1 分钟');
  assert.deepEqual(parseCommand('figure target=fig-b7 play t 0.5'), { ...base, name: 't', from: 0.5, to: 1, ms: 1200 }, '只给起点');
  assert.deepEqual(parseCommand('figure target=fig-b7 play θ −90 1/2'), { ...base, name: 'θ', from: -90, to: 0.5, ms: 1200 });
  assert.deepEqual(parseCommand('figure target=fig-b7 play t from=0.2 to=0.8 ms=900'), { ...base, name: 't', from: 0.2, to: 0.8, ms: 900 });
  assert.deepEqual(parseCommand('figure play t target=fig-b7').target, 'fig-b7');
  assert.match(parseCommand('figure target=f play').error, /play 缺少变量名/);
  assert.match(parseCommand('figure target=f play 1t').error, /变量名「1t」不合法/);
  assert.match(parseCommand('figure target=f play t a b').error, /起止值要写数字/);
  assert.match(parseCommand('figure target=f play t 0 1 快点').error, /时长/);
});

test('parseCommand：figure highlight', () => {
  assert.deepEqual(parseCommand('figure target=fig-b7 highlight 3'), { op: 'figure', target: 'fig-b7', action: 'highlight', index: 3 });
  assert.equal(parseCommand('figure target=f highlight #2').index, 2);
  assert.equal(parseCommand('figure target=f highlight 第4条').index, 4);
  assert.equal(parseCommand('figure target=f highlight index=5').index, 5);
  assert.match(parseCommand('figure target=f highlight').error, /命令序号/);
  assert.match(parseCommand('figure target=f highlight 0').error, /命令序号/);
  assert.match(parseCommand('figure target=f highlight 1.5').error, /命令序号/);
  assert.match(parseCommand('figure target=f highlight x').error, /命令序号/);
});

test('ops 等于已闭合且合法的 board 片段（契约里的定义）', () => {
  for (const final of [false, true]) {
    for (let n = 0; n <= TURN.length; n += 7) {
      const r = parseOutput(TURN.slice(0, n), { final });
      const want = r.segments.filter((s) => s.type === 'board' && s.closed && s.op && !s.op.error).map((s) => ({ ...s.op, body: s.body }));
      assert.deepEqual(r.ops, want);
      if (final) assert.ok(boards(r).every((b) => b.closed), 'final 时没有草稿块');
    }
  }
});

test('乱七八糟的输入不抛异常', () => {
  const junk = ['```', '````', '~~~~~~', '```board', '```board\n```board\n```board', '``` board figure', '\n```board add id=b1\n````\n```\n',
    '```board figure target=f set x=[[[', '```board figure target=f set )))x=1', '\uD83D', '```board add id=b1 title="\uD83D\n```\n', '\r\r\r'];
  for (const s of junk) {
    for (const final of [false, true]) assert.doesNotThrow(() => parseOutput(s, { final }), JSON.stringify(s));
  }
  assert.doesNotThrow(() => parseOutput(12345));
  assert.deepEqual(parseOutput(12345, { final: true }).segments, [{ type: 'speech', text: '12345' }]);
});

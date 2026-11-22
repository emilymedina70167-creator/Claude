import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, splitAlts } from '../kit/src/tokens.js';
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
  assert.match(err('target=b5 style=zigzag'), /style 只认/);
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
  const r = parseMarkBlock('target=b5 color=pink', 'term=mid note="一个数"\nterm=rest blue\n\n# 说明行不算\nrow 9 style=zigzag');
  assert.equal(r.marks.length, 2);
  assert.deepEqual(r.marks.map((m) => [m.target, m.sel.name, m.color]), [['b5', 'mid', 'pink'], ['b5', 'rest', 'blue']]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^第 3 行「row 9 style=zigzag」：style 只认/);
  // 开头那行自己也指了地方：它也算一条
  const both = parseMarkBlock('target=b5 term=a', 'term=b');
  assert.deepEqual(both.marks.map((m) => m.sel.name), ['a', 'b']);
  // 块里空着：开头那行就是一条（只写 target 就框住整段）
  assert.deepEqual(parseMarkBlock('target=b5', '').marks.map((m) => m.sel.kind), ['all']);
  // 各行自己写 target
  assert.deepEqual(parseMarkBlock('', 'target=b5 term=a\ntarget=fig-1 at=[1, 2]').marks.map((m) => m.target), ['b5', 'fig-1']);
  assert.match(parseMarkBlock('', 'term=a').errors[0], /缺少 target/);
  assert.ok(parseMarkBlock('target=b5 zigzag', '').error);
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
  assert.match(parseCommand('mark target=b5 zigzag').error, /看不懂「zigzag」/);
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

test('splitAlts：公式里的 | 不算选项分隔', () => {
  assert.deepEqual(splitAlts('$2(r_i+|y|)-|y|$ | $2r_i-|y|$ | 不用管'), ['$2(r_i+|y|)-|y|$', '$2r_i-|y|$', '不用管']);
  assert.deepEqual(splitAlts('a|b| c '), ['a', 'b', 'c']);
});

test('英语句子里的词：word= / words= / phrase= / blank=', async () => {
  const { parseMarkSpec, markWhere } = await import('../kit/src/markspec.js');
  const { wordSpan, wordsIn } = await import('../kit/src/entext.js');
  const p = (l) => parseMarkSpec(l);
  assert.deepEqual(p('target=b3 word=3').spec.sel, { kind: 'word', k: 3 });
  assert.equal(p('target=b3 word=3').spec.style, 'circle');
  assert.deepEqual(p('target=b3 words=4-7').spec.sel, { kind: 'words', a: 4, b: 7 });
  assert.equal(p('target=b3 words=4-7').spec.style, 'underline');
  assert.deepEqual(p('target=b3 phrase="who lives#2"').spec.sel, { kind: 'phrase', text: 'who lives', n: 2 });
  assert.equal(p('target=c1 blank=2').spec.style, 'box');
  assert.deepEqual(p('target=b3 word3').spec.sel, { kind: 'word', k: 3 });
  assert.match(p('target=b3 words=7-4').error, /words=4-7/);
  assert.match(p('target=b3 phrase=""').error, /phrase/);
  assert.match(markWhere(p('target=b3 phrase="who lives"').spec), /who lives/);
  const w = wordsIn("My brother, who lives in Beijing, isn't a doctor who lives well.").map((x) => x.w);
  assert.ok(w.includes("isn't"), '缩写算一个词');
  assert.deepEqual(wordSpan({ kind: 'word', k: 3 }, w), { from: 2, to: 2 });
  assert.deepEqual(wordSpan({ kind: 'phrase', text: 'Who Lives', n: 2 }, w), { from: 9, to: 10 });
  assert.match(wordSpan({ kind: 'phrase', text: 'who lives' }, w).error, /出现了 2 次.*#2/);
  assert.match(wordSpan({ kind: 'phrase', text: 'that' }, w).error, /没有「that」/);
  assert.match(wordSpan({ kind: 'word', k: 99 }, w).error, /一共 12 个词/);
});

test('新写法：text= 板上的字、li= / para= / tr= 一段、to= 箭头指过去；新画法和默认颜色', () => {
  const t = spec('target=b5 text="be 动词除外" color=red note="例外"');
  assert.deepEqual(t.sel, { kind: 'text', text: 'be 动词除外', n: 0 });
  assert.equal(t.style, 'circle', '几个字默认圈');
  assert.equal(t.color, 'red');
  assert.equal(spec('target=b5 text="例外#2"').sel.n, 2);
  assert.equal(spec('target=b5 text="主语是第三人称单数时，谓语动词加 -s，be 动词除外"').style, 'underline', '长的一句默认划线');
  assert.deepEqual(spec('target=b5 li=1-4 style=brace note="要背"').sel, { kind: 'li', a: 1, b: 4 });
  assert.equal(spec('target=b5 li=1-4').style, 'circle', '一组列表默认一个大圈');
  assert.deepEqual(spec('target=b5 li=3').sel, { kind: 'li', a: 3, b: 3 });
  assert.deepEqual(spec('target=b5 p=2').sel, { kind: 'para', a: 2, b: 2 });
  assert.deepEqual(spec('target=b5 tr=2-3').sel, { kind: 'tr', a: 2, b: 3 });
  assert.match(err('target=b5 li=4-1'), /li 后面写第几个或者一段/);
  assert.match(err('target=b5 text=""'), /text 后面写板上的字/);
  // 中文的画法名、新画法
  assert.equal(spec('target=b5 text="x" 波浪线').style, 'wave');
  assert.equal(spec('target=b5 text="x" style=大括号').style, 'brace');
  assert.equal(spec('target=b5 text="x" 着重号').style, 'dots');
  assert.equal(spec('target=b5 text="x" style=double').style, 'double');
  // ✓ 默认绿、✗ 默认红；写了颜色用写的；块里开头那行的颜色沿用
  assert.equal(spec('target=b5 text="He works." tick').color, 'green');
  assert.equal(spec('target=b5 text="He work." cross').color, 'red');
  assert.equal(spec('target=b5 text="He work." cross yellow').color, 'yellow');
  const blk = parseMarkBlock('target=b5 color=pink', 'text="a" tick\ntext="b"');
  assert.deepEqual(blk.marks.map((m) => m.color), ['pink', 'pink']);
  // to=：从这里画箭头指到那里
  const a = spec('target=b5 text="主语" to="谓语" note="管着"');
  assert.equal(a.style, 'arrow');
  assert.deepEqual(a.to, { text: '谓语', n: 0 });
  assert.match(err('target=b5 text="主语" to="谓语" style=circle'), /to= 是画一个箭头/);
  assert.match(markText('m4', spec('target=b5 li=1-4 style=brace color=pink note="要背"')), /^m4：b5 里第 1–4 条（大括号，pink）「要背」$/);
  assert.match(markText('m5', spec('target=b5 text="He work." cross')), /^m5：b5 里「He work\.」（✗）$/);
});

test('找字：不管空格、大小写、全角半角；…隔开头尾；跨好几个文字节点；第几次', async () => {
  const { findText, pickHit } = await import('../kit/src/textfind.js');
  const nodes = ['规则：主语是第三人称单数时，谓语动词加 -s；', 'be', ' 动词除外。'];
  const [h] = findText(nodes, 'be 动词除外');
  assert.deepEqual(h, { from: [1, 0], to: [2, 5] });
  assert.equal(findText(nodes, 'BE动词除外').length, 1, '空格、大小写不管');
  assert.equal(findText(nodes, '加 -s;').length, 1, '全角分号和半角一样');
  assert.equal(findText(nodes, '主语是 （ 第三人称').length, 0);
  const g = findText(nodes, '主语是…除外');
  assert.deepEqual(g[0].from, [0, 3]);
  assert.deepEqual(g[0].to, [2, 5]);
  assert.equal(findText(['he / she / it'], 'he/she/it').length, 1);
  const two = findText(['例外：a', '还有一个例外'], '例外');
  assert.equal(two.length, 2);
  assert.equal(pickHit(two, 0, '例外').hit, two[0]);
  assert.match(pickHit(two, 0, '例外').warn, /出现了 2 次.*#2/);
  assert.equal(pickHit(two, 2, '例外').hit, two[1]);
  assert.match(pickHit(two, 3, '例外').error, /只出现了 2 次/);
  assert.match(pickHit([], 0, '例外').error, /这里没有「例外」/);
  assert.equal(findText(['ＡＢＣ'], 'abc').length, 1, '全角字母');
  // 尾巴离得太远不算
  assert.equal(findText([`头${'x'.repeat(500)}尾`], '头…尾').length, 0);
});

test('画法的几何：四周空多少、留白不压到别的字、圈包住要圈的、跨行半句沿着字圈、大括号、拱形箭头', async () => {
  const { roomAround, padsFor, shapeFor, lassoPath, arcPath, sameLine, rng } = await import('../kit/src/markdraw.js');
  const line = { x: 100, y: 100, w: 120, h: 20 };
  // 上一行的字框和这一行叠了一个像素：仍算上一行（按中心分）；同一行左边挨着的字；自己的字不算
  const obs = [{ x: 0, y: 72, w: 400, h: 29 }, { x: 40, y: 100, w: 58, h: 20 }, { x: 110, y: 100, w: 50, h: 20 }, { x: 0, y: 140, w: 400, h: 20 }];
  const room = roomAround(line, obs);
  assert.deepEqual(room, { top: 0, bottom: 20, left: 2, right: 40 });
  // 留白：空隙的一半，最少 1.5、最多 want
  const p = padsFor(room);
  assert.equal(p.top, 1.5);
  assert.equal(p.bottom, 6);
  assert.equal(p.left, 1.5);
  assert.equal(p.right, 8);
  // 圈（圆角长圈）把要圈的四个角都包住；bbox 比它大
  const pathPts = (d) => [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [+m[1], +m[2]]);
  const c = shapeFor('circle', { box: line, room: {} }, 's1');
  const pts = pathPts(c.strokes[0]);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  assert.ok(Math.min(...xs) < line.x && Math.max(...xs) > line.x + line.w && Math.min(...ys) < line.y && Math.max(...ys) > line.y + line.h);
  assert.ok(Math.min(...xs) > line.x - 20, '宽的一行字不会像椭圆那样往两边多出一大截');
  // 跨两行、第一行从中间开始：沿着字圈（lasso），不是整段一个大圈
  const two = shapeFor('circle', { box: { x: 0, y: 0, w: 400, h: 50 }, lines: [{ x: 250, y: 0, w: 150, h: 20 }, { x: 0, y: 30, w: 180, h: 20 }], room: {} }, 's2');
  const tp = pathPts(two.strokes[0]);
  assert.ok(!tp.some(([px, py]) => px < 100 && py < 15), '第一行左边没圈进去');
  assert.match(lassoPath([{ x: 0, y: 0, w: 50, h: 20 }, { x: 0, y: 22, w: 30, h: 20 }], rng('x')), /^M/);
  // 大括号在右边，旁注挨着括号尖
  const br = shapeFor('brace', { box: { x: 20, y: 0, w: 200, h: 120 } }, 's3');
  assert.ok(br.bbox.x >= 220 && br.tip[0] > 225 && Math.abs(br.tip[1] - 60) < 3);
  const bl = shapeFor('brace', { box: { x: 80, y: 0, w: 200, h: 120 }, side: 'left' }, 's3');
  assert.ok(bl.bbox.x + bl.bbox.w <= 80 && bl.tip[0] < 70);
  // 荧光笔是涂色（画在字下面那层），着重号一个字一个点，✓ 写在句子后面
  assert.equal(shapeFor('highlight', { box: line }, 'h').fills.length, 1);
  assert.equal(shapeFor('dots', { box: line, chars: [{ x: 100, w: 20 }, { x: 120, w: 20 }, { x: 140, w: 20 }] }, 'd').dots.length, 3);
  assert.ok(shapeFor('tick', { box: line }, 't').bbox.x >= line.x + line.w);
  assert.equal(shapeFor('double', { box: line }, 'dd').strokes.length, 2);
  // 同一行两处的箭头：上面挤就往下拱
  const a = { x: 0, y: 100, w: 60, h: 20 }, b = { x: 190, y: 100, w: 50, h: 20 };
  assert.ok(sameLine(a, b));
  assert.equal(arcPath(a, b, rng('a'), { top: 10, bottom: 40 }).down, true);
  assert.equal(arcPath(a, b, rng('a'), { top: 40, bottom: 40 }).down, false);
  assert.ok(!sameLine(a, { x: 0, y: 200, w: 40, h: 20 }));
});

test('课堂 Claude 拿「mark」「标注」「tag」查组件写法：给黑板指令那一节，不再说「没有这个组件」', async () => {
  const { readFileSync } = await import('node:fs');
  const { componentDocs } = await import('../kit/build-docs.js');
  const { docLookup } = await import('../kit/src/class/prompt.js');
  const md = readFileSync(new URL('../kit/components.md', import.meta.url), 'utf8');
  const D = componentDocs(md);
  for (const n of ['mark', 'board mark', '标注', '画圈', 'tag', 'highlight', '荧光笔']) {
    for (const sub of ['线代', '英语', '数据结构']) assert.match(docLookup(D, sub, n), /不是组件，是黑板指令[\s\S]*### mark \/ unmark/, `${sub} ${n}`);
  }
  assert.match(docLookup(D, '英语', 'parse'), /^### parse/, '真有的组件照旧');
  assert.match(docLookup(D, '线代', 'figure'), /### figure/);
  assert.throws(() => docLookup(D, '线代', 'zzz'), /标注不是组件，是黑板指令 board mark/);
});

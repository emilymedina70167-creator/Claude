// 版面（kit/src/class/canvas.js）：Claude 说结构（几栏、每段第几栏），页面按内容排
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCols, parseCol, bandsOf, layoutText, colsText } from '../kit/src/class/canvas.js';
import { parseCommand, parseOutput } from '../kit/src/class/protocol.js';
import { boardStateText, buildSystem, CANVAS_DOC, bytes } from '../kit/src/class/prompt.js';

test('parseCols / parseCol', () => {
  assert.deepEqual(parseCols('7/5'), [7, 5]);
  assert.deepEqual(parseCols('2'), [1, 1]);
  assert.deepEqual(parseCols('1:1:1'), [1, 1, 1]);
  assert.match(parseCols('1/1/1/1').error, /最多 3 栏/);
  assert.match(parseCols('左右').error, /看不懂/);
  assert.equal(parseCol('2'), 2);
  assert.equal(parseCol('all'), 'all');
  assert.match(parseCol('5').error, /看不懂/);
  assert.equal(colsText([7, 5]), '7/5');
});

test('protocol：new 的 cols=、段的 col=、move、layout', () => {
  assert.deepEqual(parseCommand('new id=b1 cols=7/5 title="x"'), { op: 'new', id: 'b1', cols: [7, 5], title: 'x' });
  assert.equal(parseCommand('add id=b2 col=2').col, 2);
  assert.equal(parseCommand('add id=b3 col=all').col, 'all');
  assert.deepEqual(parseCommand('move id=b2 col=1'), { op: 'move', id: 'b2', col: 1 });
  assert.deepEqual(parseCommand('layout cols=6/6'), { op: 'layout', cols: [6, 6] });
  assert.match(parseCommand('move id=b2').error, /哪一栏/);
  assert.match(parseCommand('add id=b2 cols=2').error, /cols= 写在 board new 上/);
});

test('bandsOf：同一栏按先后从上往下；col=all 自己一层，前后各成一层', () => {
  const segs = [{ id: 'b1', col: 'all' }, { id: 'b2', col: 1 }, { id: 'b3', col: 2 }, { id: 'b4', col: 1 }, { id: 'b5', col: 'all' }, { id: 'b6', col: 3 }];
  assert.deepEqual(bandsOf(segs, [7, 5]), [
    { kind: 'all', id: 'b1' },
    { kind: 'cols', cols: [['b2', 'b4'], ['b3']] },
    { kind: 'all', id: 'b5' },
    { kind: 'cols', cols: [[], ['b6']] }, // 只有两栏：第 3 栏放进最后一栏
  ]);
  assert.deepEqual(bandsOf([{ id: 'b1', col: 2 }, { id: 'b2', col: 1 }], [1]), [{ kind: 'cols', cols: [['b1', 'b2']] }], '一栏的板：都从上往下');
});

test('layoutText：几栏、每栏从上往下、各多高、比一屏长多少', () => {
  const t = layoutText({ cols: [7, 5], bands: bandsOf([{ id: 'b1', col: 1 }, { id: 'b2', col: 2 }, { id: 'b3', col: 1 }], [7, 5]), info: (id) => ({ h: { b1: 300, b2: 200, b3: 420 }[id], held: id === 'b2' }), widths: [600, 430], screen: 600, total: 760 });
  assert.match(t, /当前板分 2 栏，宽 7\/5（左栏约 600、右栏约 430 像素）/);
  assert.match(t, /左栏 b1（高约 300） → b3（高约 420）；右栏 b2（藏着）/);
  assert.match(t, /内容一共高约 760，一屏能看约 600：学生要往下滑一下/);
  const board = { segs: [{ id: 'b1', page: 1, title: '图', summary: '', blocks: [] }], pages: [{ n: 1, title: '秩一' }], cur: 1, view: 1, canvas: { text: t } };
  assert.ok(boardStateText(board).includes('当前板分 2 栏'));
});

test('说明里有版面一节（开着时才带），例子照抄能解析，不长', () => {
  const on = buildSystem({ componentDocs: '', pack: {}, board: [], canvas: true });
  const off = buildSystem({ componentDocs: '', pack: {}, board: [] });
  assert.ok(on.includes(CANVAS_DOC) && !off.includes(CANVAS_DOC));
  assert.ok(bytes(CANVAS_DOC) < 3 * 1024, `版面说明 ${bytes(CANVAS_DOC)} 字节`);
  assert.doesNotMatch(CANVAS_DOC, /[他她]/);
  for (const h of CANVAS_DOC.match(/`board [^`]+`/g).map((x) => x.slice(7, -1))) {
    if (!/[…]/.test(h)) assert.ok(!parseCommand(h).error, `例子写法不对：${h}`);
  }
  assert.equal(parseOutput('````board layout cols=6/6\n````\n', { final: true }).ops[0].op, 'layout');
});

test('layoutText：页面因为两栏差太多改成一栏时告诉 Claude', () => {
  const bands = bandsOf([{ id: 'b1', col: 1 }, { id: 'b2', col: 2 }], [1, 1]);
  const t = layoutText({ cols: [1, 1], bands, stacked: [{ i: 0, h: '300/1400' }] });
  assert.match(t, /这块板两栏差得太多（左栏 300、右栏 1400），页面改成了一栏：先左栏、再右栏/);
});

test('layoutText：两栏高矮差得多但分栏留着时，照实说短的那栏钉在屏幕上', () => {
  const t = layoutText({ cols: [7, 5], bands: bandsOf([{ id: 'b1', col: 1 }, { id: 'b2', col: 2 }], [7, 5]), widths: [640, 440], screen: 700, total: 1200, follow: [{ i: 0, col: 1, h: '1200/420' }] });
  assert.match(t, /两栏高矮差得多（左栏 1200、右栏 420）：分栏照你排的留着，短的右栏钉在屏幕上/);
  assert.doesNotMatch(t, /改成了一栏/);
});

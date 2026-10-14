import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMatrix, matrixEnv, matrixItems, floatEnv, snapSlider, flights, changedCells, checkMark, cellTeX } from '../kit/src/matrixspec.js';
import { shapeFor, placeNote, gapBetween, union, rng, arrowPath, leaderPath, strokeObstacles } from '../kit/src/markdraw.js';
import { Q } from '../kit/src/exact.js';

const items = (src, state = {}) => {
  const { cmds } = parseMatrix(src);
  const { vars, errors } = matrixEnv(cmds, state);
  const r = matrixItems(cmds, vars);
  return { ...r, errors: [...errors, ...r.errors], cmds, vars };
};

test('parseMatrix：字段、命令、修饰', () => {
  const { fields, cmds } = parseMatrix([
    'id: m-pow',
    'title: B 的幂',
    'q: 拖动 $k$',
    '看那几个 1',
    'let B = [[0, 1, 0], [0, 0, 1], [0, 0, 0]]',
    'slider k 1 3 = 1 step=1 label="k" play',
    'matrix B^k label="B^{\\calc{k}} ="',
    'tex =',
    'matrix B name=B0 from=2',
    'split rows=1 cols=2 of=B0',
    'mark row 1 note="只剩右上角" until=3',
    'product B B',
  ].join('\n'));
  assert.equal(fields.id, 'm-pow');
  assert.equal(fields.q, '拖动 $k$\n看那几个 1');
  assert.deepEqual(cmds.map((c) => c.kind), ['let', 'slider', 'matrix', 'tex', 'matrix', 'split', 'mark', 'product']);
  assert.deepEqual([cmds[1].min, cmds[1].max, cmds[1].init, cmds[1].step, cmds[1].mods.play], [1, 3, 1, 1, true]);
  assert.equal(cmds[2].label, 'B^{\\calc{k}} =');
  assert.equal(cmds[2].name, undefined);
  assert.deepEqual([cmds[4].name, cmds[4].from], ['B0', 2]);
  assert.deepEqual([cmds[5].rows, cmds[5].cols, cmds[5].of], [[1], [2], 'B0']);
  assert.deepEqual([cmds[6].spec.sel, cmds[6].spec.note, cmds[6].spec.until], [{ kind: 'row', i: 1 }, '只剩右上角', 3]);
  assert.deepEqual([cmds[7].a, cmds[7].b, cmds[7].nameC], ['B', 'B', 'BB']);
  // 表达式就是一个变量名时，name 默认用它
  assert.equal(parseMatrix('matrix A').cmds[0].name, 'A');
});

test('parseMatrix：写错了说清楚是哪一行', () => {
  assert.throws(() => parseMatrix('let A = [[1, 2]]'), /至少要有一条 matrix/);
  assert.throws(() => parseMatrix('matrix A\nvector x'), /看不懂这一行：vector x/);
  assert.throws(() => parseMatrix('matrix A +'), /「matrix A \+」/);
  assert.throws(() => parseMatrix('slider k 3 1\nmatrix A'), /最大值比最小值大/);
  assert.throws(() => parseMatrix('matrix A\nsplit'), /至少写 rows= 或 cols=/);
  assert.throws(() => parseMatrix('matrix A\nsplit rows=0'), /从 1 数/);
  assert.throws(() => parseMatrix('matrix A\nmark term=x'), /只能标 row、col、diag、entry、block/);
  assert.throws(() => parseMatrix('matrix A\nmark row 2 of=B'), /没有叫 B 的矩阵（有的是：A）/);
  assert.throws(() => parseMatrix('matrix A\nproduct A'), /product 的写法/);
  assert.throws(() => parseMatrix('let I = [[1]]\nmatrix I'), /保留的名字/);
});

test('matrixEnv / matrixItems：精确分数、滑块取整、\\calc 标签', () => {
  const src = 'let B = [[0, 1, 0], [0, 0, 1], [0, 0, 0]]\nslider k 1 3 = 1 step=1\nmatrix B^k label="B^{\\calc{k}} ="';
  const one = items(src);
  assert.deepEqual(one.errors, []);
  assert.deepEqual(one.items[0].cells, [['0', '1', '0'], ['0', '0', '1'], ['0', '0', '0']]);
  assert.equal(one.items[0].label, 'B^{{1}} =');
  // play 的中间值：按 step 取整
  const two = items(src, { slider: { k: 1.7 } });
  assert.deepEqual(two.items[0].cells, [['0', '0', '1'], ['0', '0', '0'], ['0', '0', '0']]);
  assert.equal(two.items[0].label, 'B^{{2}} =');
  // 分数：精确
  const half = items('let A = [[2, 1], [1, 1]]\nmatrix inv(A)/2');
  assert.deepEqual(half.items[0].cells, [['\\tfrac{1}{2}', '-\\tfrac{1}{2}'], ['-\\tfrac{1}{2}', '1']]);
  // 向量是一列，数不画括号
  const v = items('let a = [1, 2]\nmatrix a\nmatrix a\'*a\nmatrix a*a\'');
  assert.deepEqual(v.items.map((x) => x.shape), ['vector', 'number', 'matrix']);
  assert.deepEqual(v.items[0].cells, [['1'], ['2']]);
  assert.deepEqual(v.items[1].cells, [['5']]);
  assert.deepEqual(v.items[2].cells, [['1', '2'], ['2', '4']]);
  // 整节课的量（let 块）和 set 覆盖的值
  const base = { A: [[Q.int(1), Q.int(2)], [Q.int(3), Q.int(4)]] };
  assert.deepEqual(items('matrix A', { base }).items[0].cells, [['1', '2'], ['3', '4']]);
  assert.deepEqual(items('let A = [[1, 0], [0, 1]]\nmatrix A', { override: { A: [[0.5, 0], [0, 2]] } }).items[0].cells, [['\\tfrac{1}{2}', '0'], ['0', '2']]);
  assert.deepEqual(floatEnv({ A: base.A, k: Q.int(2) }), { A: [[1, 2], [3, 4]], k: 2 });
});

test('matrixItems：from / until 跟着 step，split 和 mark', () => {
  const src = 'let A = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]\nmatrix A name=A\nsplit rows=1 cols=1\nmatrix A*2 from=2\nmark row 2 from=1\nmark entry 3,3 until=0';
  const s0 = items(src, { extra: { step: 0 } });
  assert.equal(s0.items.length, 1);
  assert.deepEqual(s0.items[0].split, { rows: [1], cols: [1] });
  assert.deepEqual(s0.marks.map((m) => m.spec.sel.kind), ['entry']);
  const s2 = items(src, { extra: { step: 2 } });
  assert.equal(s2.items.length, 2);
  assert.deepEqual(s2.marks.map((m) => m.spec.sel.kind), ['row']);
  // 分块线画在矩阵外面：报错
  assert.match(items('let A = [[1, 2], [3, 4]]\nmatrix A\nsplit rows=2').errors[0], /只有 2 行，第 2 行后面画不了分块线/);
  // 算不出来：带着命令原文
  assert.match(items('let A = [[1, 2], [3, 4]]\nmatrix A*[1, 2, 3]').errors[0], /第 2 条（matrix A\*\[1, 2, 3\]）/);
  assert.match(items('matrix A label="\\calc{zz}"', { base: { A: [[Q.int(1)]] } }).errors[0], /\\calc\{zz\} 算不出来/);
  // 太大
  assert.match(items('matrix I(9)').errors[0], /太大了/);
});

test('matrixItems：product', () => {
  const r = items('let a = [-1, 2, 1]\nlet b = [1, 1, -2]\nproduct a b\' name=A');
  assert.deepEqual(r.errors, []);
  const p = r.items[0];
  assert.deepEqual(p.names, ['a', 'B', 'A']);
  assert.deepEqual(p.A.cells, [['-1'], ['2'], ['1']]);
  assert.deepEqual(p.B.cells, [['1', '1', '-2']]);
  assert.deepEqual(p.C.cells, [['1', '1', '-2'].map((x) => x === '1' ? '-1' : '2'), ['2', '2', '-4'], ['1', '1', '-2']]);
  assert.deepEqual(p.terms(1, 2), [['2', '-2']]);
  assert.match(items('let A = [[1, 2]]\nproduct A A').errors[0], /前一个的列数要等于后一个的行数/);
});

test('checkMark：组件里的 mark 对得上矩阵', () => {
  const r = items('let A = [[1, 2, 3], [4, 5, 6]]\nmatrix A name=A\nsplit rows=1');
  const mk = (s) => parseMatrix(`matrix A\nmark ${s}`).cmds[1].spec;
  assert.equal(checkMark(mk('row 2'), r.items), '');
  assert.match(checkMark(mk('row 3'), r.items), /2×3 的，没有第 3 行/);
  assert.match(checkMark(mk('col 4'), r.items), /没有第 4 列/);
  assert.match(checkMark(mk('entry 3,1'), r.items), /没有 \(3, 1\) 元/);
  assert.equal(checkMark(mk('block 2,1'), r.items), '');
  assert.match(checkMark(mk('block 1,2'), r.items), /分成 2×1 块，没有子块 \(1, 2\)/);
  assert.match(checkMark(mk('block 1,1'), items('let A = [[1]]\nmatrix A').items), /还没分块/);
});

test('snapSlider、flights、changedCells：矩阵怎么动', () => {
  const c = { min: 1, max: 4, step: 1 };
  assert.deepEqual([0, 1.49, 1.5, 3.7, 9].map((x) => snapSlider(c, x)), [1, 1, 2, 4, 4]);
  assert.equal(snapSlider({ min: 0, max: 1, step: 0.1 }, 0.33), 0.3);
  // B → B²：(1,3) 的 1 是从 (1,2) 飞过来的（最近的、原来是 1、后来变了的格子）
  const B = [['0', '1', '0'], ['0', '0', '1'], ['0', '0', '0']];
  const B2 = [['0', '0', '1'], ['0', '0', '0'], ['0', '0', '0']];
  assert.deepEqual(flights(B, B2), [{ from: [0, 1], to: [0, 2] }]);
  assert.deepEqual(changedCells(B, B2), [[0, 1], [0, 2], [1, 2]]);
  // 0 不飞；形状变了不飞
  assert.deepEqual(flights(B2, B), [{ from: [0, 2], to: [0, 1] }]);
  assert.deepEqual(flights(B, [['1']]), []);
  assert.deepEqual(changedCells(B, B), []);
  assert.equal(cellTeX(Q.from(-0.5)), '-\\tfrac{1}{2}');
  assert.equal(cellTeX(Math.sqrt(2)), '1.41');
});

test('markdraw：逐行框的时候，相邻两行的框线不打架', () => {
  // 表格（matrix 组件）里三行挨着的格子，每行 38px 高；marks.js 给表格的行 inset -5
  const rowBox = (i) => ({ x: 40, y: 100 + i * 38, w: 240, h: 38 });
  const ys = (d) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => +m[2]);
  const half = 1.4 + 1; // 线宽 2.8 的一半，加上粉笔滤镜的毛边
  for (let s = 0; s < 40; s++) {
    for (let i = 0; i < 2; i++) {
      // 贝塞尔曲线落在控制点围成的范围里，所以比较控制点就够保守了
      const lo = Math.max(...ys(shapeFor('box', { box: rowBox(i), tight: 'y', inset: -5 }, `r${i}:${s}`).strokes[0]));
      const hi = Math.min(...ys(shapeFor('box', { box: rowBox(i + 1), tight: 'y', inset: -5 }, `r${i + 1}:${s}`).strokes[0]));
      assert.ok(lo + half < hi - half, `seed ${s}：第 ${i + 1} 行的框（到 ${lo}）和下一行的框（从 ${hi}）碰到了`);
    }
  }
  // 逐列也一样（左右方向）
  const xs = (d) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => +m[1]);
  for (let s = 0; s < 40; s++) {
    const a = Math.max(...xs(shapeFor('box', { box: { x: 0, y: 0, w: 60, h: 120 }, tight: 'x', inset: -5 }, `c1:${s}`).strokes[0]));
    const b = Math.min(...xs(shapeFor('box', { box: { x: 60, y: 0, w: 60, h: 120 }, tight: 'x', inset: -5 }, `c2:${s}`).strokes[0]));
    assert.ok(a + half < b - half, `seed ${s}：相邻两列的框碰到了`);
  }
});

test('markdraw：示意图里的线，旁注躲开（方块只躲边，里面能写）', () => {
  const block = { x: 100, y: 100, w: 120, h: 120 };
  const obs = strokeObstacles([{ box: block, closed: true }, { box: { x: 260, y: 40, w: 12, h: 200 }, closed: false }]);
  assert.equal(obs.length, 5, '方块四条边 + 括号一块');
  const inside = { x: 130, y: 140, w: 60, h: 24 };
  const onEdge = { x: 190, y: 140, w: 60, h: 24 };
  const hit = (r) => obs.some((o) => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h);
  assert.ok(!hit(inside), '方块里面空着的地方不算');
  assert.ok(hit(onEdge), '压在方块的右边上要躲');
  assert.ok(hit({ x: 250, y: 100, w: 40, h: 20 }), '压在括号上要躲');
  assert.deepEqual(strokeObstacles([{ box: { x: 0, y: 0, w: 4, h: 4 }, closed: true }]), [{ x: -4, y: -4, w: 12, h: 12 }], '小得没有里面的形状整个躲');
  assert.deepEqual(strokeObstacles([{ box: null }, { box: { x: NaN, y: 0, w: 1, h: 1 } }]), []);

  // 放旁注：目标在方块里靠右，右边紧挨着就是方块的边。把边当障碍时，旁注不再压在边上
  const target = { x: 160, y: 140, w: 40, h: 40 };
  const area = { x0: 0, y0: 0, x1: 400, y1: 300 };
  const at = placeNote(target, { w: 90, h: 24 }, area, { obstacles: obs });
  assert.ok(!hit({ x: at.x, y: at.y, w: 90, h: 24 }), `旁注 (${at.x}, ${at.y}) 压到了线`);
});

test('markdraw：形状、箭头、旁注放哪', () => {
  const R1 = rng('m1'), R2 = rng('m1');
  assert.equal(R1(), R2(), '同一个 seed，抖动一样');
  const box = { x: 100, y: 50, w: 60, h: 30 };
  for (const style of ['circle', 'box', 'underline', 'strike', 'highlight', 'arrow']) {
    const s = shapeFor(style, { box }, 'm1');
    assert.ok(s.bbox.w >= box.w - 1 && s.bbox.h >= box.h - 1, `${style} 的范围包住目标`);
    assert.deepEqual(shapeFor(style, { box }, 'm1'), s, `${style} 重画一样`);
    for (const d of [...s.strokes, ...s.fills]) assert.match(d, /^M[-\d.]+ [-\d.]+/);
  }
  assert.equal(shapeFor('highlight', { box }, 'x').fills.length, 1);
  const diag = shapeFor('box', { diag: [{ x: 0, y: 0, w: 20, h: 20 }, { x: 40, y: 40, w: 20, h: 20 }] }, 'd');
  assert.equal(diag.strokes.length, 1);
  assert.ok(diag.bbox.w > 60 && diag.bbox.h > 60);
  assert.match(arrowPath({ x: 0, y: 0, w: 50, h: 20 }, box, 'a'), /^M.* Q.* M.* L.* L/);
  assert.match(leaderPath({ x: 0, y: 0, w: 50, h: 20 }, box, 'a'), /^M.* Q/);
  assert.deepEqual(union([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 5, h: 20 }]), { x: 0, y: 0, w: 25, h: 25 });

  const area = { x0: 0, y0: 0, x1: 400, y1: 300 };
  const size = { w: 80, h: 24 };
  // 右边空着：放右边，挨着
  const r = placeNote(box, size, area);
  assert.equal(r.side, 'right');
  assert.ok(gapBetween({ ...r, ...size }, box) < 12);
  // 右边有字：换到不压字的地方
  const words = [{ x: 160, y: 30, w: 240, h: 70 }];
  const r2 = placeNote(box, size, area, { obstacles: words });
  const note2 = { x: r2.x, y: r2.y, ...size };
  assert.ok(!words.some((o) => gapBetween(note2, o) === 0 && note2.x < o.x + o.w && note2.x + note2.w > o.x && note2.y < o.y + o.h && note2.y + note2.h > o.y), '不压字');
  // 指定了 side 就先试那边
  assert.equal(placeNote(box, size, area, { side: 'left' }).side, 'left');
  // 沿用上次的位置
  const kept = placeNote(box, size, area, { keep: { side: 'below', gap: 30, align: 'start' } });
  assert.deepEqual([kept.side, kept.x, kept.y], ['below', 100, 110]);
  assert.equal(kept.lead, true, '离得远要连线');
  // 放不下时夹在范围里，也不压住目标
  const edge = placeNote({ x: 330, y: 0, w: 70, h: 20 }, size, area);
  assert.ok(edge.x >= 0 && edge.x + size.w <= 400 && edge.y >= 0);
  assert.equal(gapBetween({ x: edge.x, y: edge.y, ...size }, { x: 330, y: 0, w: 70, h: 20 }) > 0 || edge.y >= 20, true);
});

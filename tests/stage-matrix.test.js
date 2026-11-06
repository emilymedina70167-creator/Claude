// 舞台上的矩阵（kit/src/stage/types/matrix.js）：造、部件的写法、行变换（精确分数）、交换、倍乘、改数、主元、阶梯线、乘法的一格、给老师看的现状
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { matrix, parseOps, parseRows, opText, echelon, layout, stairsPoints, toQ, MX } from '../kit/src/stage/types/matrix.js';

const run = (scene, src) => { for (const c of parseScript(src)) scene.apply(c); return scene; };
const one = (scene, line) => scene.apply(parseScript(line)[0]);
const err = (scene, line) => scene.check(parseScript(line)[0]);
/** 矩阵现在每一行的数（按现在的位置） */
const rows = (s, id = 'm') => {
  const o = s.objects.get(id);
  return Array.from({ length: o.rows }, (_, i) => o.cells.filter((x) => x.r === i + 1).sort((a, b) => a.c - b.c).map((x) => x.value));
};

test('造：/ 分行，数是精确分数（0.5 记成 1/2），也认 ; 和 [[…][…]]；| 是增广矩阵的竖线', () => {
  const s = run(new Scene(), 'matrix m = 1 2 3 / 4 5 6 / 7 8 10');
  assert.deepEqual(rows(s), [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '10']]);
  run(s, 'matrix n = 1/2 -3 / 0.5 −2/4');
  assert.deepEqual(rows(s, 'n'), [['1/2', '-3'], ['1/2', '-1/2']]);
  run(s, 'matrix k = 1 2; 3 4');
  assert.deepEqual(rows(s, 'k'), [['1', '2'], ['3', '4']]);
  run(s, 'matrix q = [[1 2][3 4]]');
  assert.deepEqual(rows(s, 'q'), [['1', '2'], ['3', '4']]);
  run(s, 'matrix b = 1 1 | 3 / 1 -1 | 1');
  const b = s.objects.get('b');
  assert.equal(b.aug, 2);
  assert.equal(b.cols, 3);
  // 只在第一行写竖线也行
  assert.equal(run(s, 'matrix b2 = 1 1 | 3 / 1 -1 1').objects.get('b2').aug, 2);
  // 新的矩阵放在已有东西的下面
  assert.ok(s.objects.get('n').origin.y > s.objects.get('m').origin.y + layout(s.objects.get('m')).box.h);
});

test('造错了说清楚怎么写', () => {
  const s = new Scene();
  assert.match(err(s, 'matrix m 1 2 / 3 4'), /要写成 matrix 名字 = 1 2 \/ 3 4/);
  assert.match(err(s, 'matrix m = 1 2 / 3'), /第 2 行有 1 个数，第 1 行有 2 个/);
  assert.match(err(s, 'matrix m = 1 2 / / 3 4'), /第 2 行是空的/);
  assert.match(err(s, 'matrix m = 1 x / 3 4'), /「x」不是数/);
  assert.match(err(s, 'matrix m = 1 2 3 4 5 6 7 8 9'), /最多 6 行 8 列/);
  assert.match(err(s, 'matrix m = 1 | 2 3 / 4 5 | 6'), /竖线 \| 每行要写在同一个位置/);
  assert.match(err(s, 'matrix m = | 1 2'), /竖线 \| 要写在两个数中间/);
  assert.match(err(s, 'matrix m ='), /矩阵要有数/);
  assert.match(err(run(new Scene(), 'array a = 1 2'), 'matrix m = 1 2 beside=zz'), /beside=zz：舞台上没有「zz」/);
});

test('部件的写法：m.2,3 一格、m.r2 一行、m.c3 一列、m.r1-2 几行；写错报怎么写', () => {
  const s = run(new Scene(), 'matrix m = 1 2 3 / 4 5 6 / 7 8 10');
  assert.deepEqual(s.parts('m.2,3').map((x) => x.value), ['6']);
  assert.deepEqual(s.parts('m.r2').map((x) => x.value), ['4', '5', '6']);
  assert.deepEqual(s.parts('m.c3').map((x) => x.value), ['3', '6', '10']);
  assert.deepEqual(s.parts('m.r1-2').map((x) => x.value), ['1', '2', '3', '4', '5', '6']);
  assert.equal(s.parts('m').length, 9);
  assert.equal(s.refOf(s.parts('m.3,2')[0]), 'm.3,2');
  assert.throws(() => s.parts('m.4,1'), /m 是 3×3 的，没有第 4 行/);
  assert.throws(() => s.parts('m.1,9'), /没有第 9 列/);
  assert.throws(() => s.parts('m.c4'), /没有第 4 列/);
  assert.throws(() => s.parts('m#3'), /矩阵写 m\.2,3（第 2 行第 3 列）、m\.r2（第 2 行）或 m\.c3（第 3 列）/);
  assert.throws(() => s.parts('m.x'), /矩阵写 m\.2,3/);
  // 话里的小块、共用的指令都认这些写法
  assert.deepEqual(dryRun(s, 'say "看 {m.2,1} 和 {m.r3}"\nglow m.r2\npaint m.c1 g2\ndim m.3,3\nlabel t m.r1 "第一行" side=left\ncompare m.1,1 m.2,1'), []);
});

test('行变换的写法照课本：r2 - 3r1、r2 = r2 - 3r1、r3 + 1/2 r1、3r2、r2 / 3、-r1、2r2 - 3r1、r1 <-> r2、列变换 c', () => {
  const o = run(new Scene(), 'matrix m = 1 2 3 / 4 5 6 / 7 8 10').objects.get('m');
  const p = (t) => parseOps(t, o).map((op) => ({ ...op, a: op.a?.toString() ?? null, b: op.b?.toString() ?? null }));
  assert.deepEqual(p('r2 - 3r1'), [{ line: 'r', kind: 'add', i: 2, j: 1, a: '1', b: '-3' }]);
  assert.deepEqual(p('r2 = r2 - 3r1'), p('r2 - 3r1'));
  assert.deepEqual(p('R2-3*R1'), p('r2 - 3r1'));
  assert.deepEqual(p('r₂ − 3r₁'), p('r2 - 3r1'));
  assert.deepEqual(p('r3 + 1/2 r1')[0].b, '1/2');
  assert.deepEqual(p('r3 + (-1/2)r1')[0].b, '-1/2');
  assert.deepEqual(p('r2 - r1*4')[0].b, '-4');
  assert.deepEqual(p('3r2'), [{ line: 'r', kind: 'scale', i: 2, j: null, a: '3', b: null }]);
  assert.equal(p('r2 / 3')[0].a, '1/3');
  assert.equal(p('r2 ÷ 3')[0].a, '1/3');
  assert.equal(p('-r1')[0].a, '-1');
  assert.deepEqual(p('2r2 - 3r1'), [{ line: 'r', kind: 'comb', i: 2, j: 1, a: '2', b: '-3' }]);
  assert.deepEqual(p('r1 <-> r3'), [{ line: 'r', kind: 'swap', i: 1, j: 3, a: null, b: null }]);
  assert.deepEqual(p('r1 ↔ r3'), p('r1 <-> r3'));
  assert.deepEqual(p('c1 <-> c2'), [{ line: 'c', kind: 'swap', i: 1, j: 2, a: null, b: null }]);
  assert.equal(p('c3 - 2c1')[0].line, 'c');
  assert.equal(p('r2 - 4r1, r3 - 7r1').length, 2);
  // 照课本写出来
  const t = (s) => parseOps(s, o).map(opText).join('，');
  assert.equal(t('r2 - 3r1'), 'r₂ − 3r₁');
  assert.equal(t('r2 + r1'), 'r₂ + r₁');
  assert.equal(t('r3 + 1/2 r1'), 'r₃ + (1/2)r₁');
  assert.equal(t('r1 <-> r3'), 'r₁ ↔ r₃');
  assert.equal(t('r2 / 3'), 'r₂ ÷ 3');
  assert.equal(t('r2 / -3'), 'r₂ ÷ (−3)');
  assert.equal(t('2/3 r2'), '(2/3)r₂');
  assert.equal(t('-r1'), '−r₁');
  assert.equal(t('2r2 - 3r1'), '2r₂ − 3r₁');
  assert.equal(t('c1 <-> c2'), 'c₁ ↔ c₂');
});

test('行变换写错的：说清楚错在哪', () => {
  const s = run(new Scene(), 'matrix m = 1 2 / 3 4');
  assert.match(err(s, 'rowop m r3 - r1'), /m 只有 2 行，没有 r3/);
  assert.match(err(s, 'rowop m c1 <-> c5'), /m 只有 2 列，没有 c5/);
  assert.match(err(s, 'rowop m r2'), /「r2」什么也没变/);
  assert.match(err(s, 'rowop m 0r2'), /系数不能是 0/);
  assert.match(err(s, 'rowop m r2 = 3r1'), /r2 自己要在式子里/);
  assert.match(err(s, 'rowop m r1 <-> r1'), /两行是同一行/);
  assert.match(err(s, 'rowop m r1 <-> c2'), /行和列不能互换/);
  assert.match(err(s, 'rowop m r2 - 3c1'), /一步里行和列不能混着写/);
  assert.match(err(s, 'rowop m r2 - r1, c1 <-> c2'), /行变换和列变换不要混着写/);
  assert.match(err(s, 'rowop m r2 + x'), /看不懂「r2\+x」：行变换写成 r2 - 3r1/);
  assert.match(err(s, 'rowop m'), /rowop 后面写一步行变换，比如 rowop m r2 - 3r1/);
  assert.match(err(s, 'rowop q r2 - r1'), /舞台上没有「q」/);
  assert.match(err(s, 'rowop m r2 / 0'), /不能除以 0/);
  const t = run(new Scene(), 'matrix m = 1 2 3 / 4 5 6 / 7 8 9');
  assert.match(err(t, 'rowop m r3 + r1 + r2'), /一步只能加上一行的倍数/);
  assert.match(err(run(new Scene(), 'array a = 1 2'), 'rowop a r2 - r1'), /一排格子没有「rowop」（矩阵才有）/);
});

test('消元到阶梯形：每一步精确；做完的写法贴在那一行右边；阶梯线、全零行', () => {
  const s = run(new Scene(), 'matrix m = 1 2 3 / 4 5 6 / 7 8 9');
  const fx = one(s, 'rowop m r2 - 4r1, r3 - 7r1');
  assert.deepEqual(rows(s), [['1', '2', '3'], ['0', '-3', '-6'], ['0', '-6', '-12']]);
  assert.equal(fx.ops.length, 2);
  assert.deepEqual(fx.ops[0].before, ['4', '5', '6']);
  assert.deepEqual(fx.ops[0].scaled, ['-4', '-8', '-12']);
  assert.deepEqual(fx.ops[0].after, ['0', '-3', '-6']);
  assert.deepEqual(fx.ops[0].src, ['1.1', '1.2', '1.3']);
  // 每一步的写法贴在它改的那一行右边
  assert.deepEqual(fx.labels, ['op:m', 'op:m:2']);
  const l = s.labels.get('op:m'), l2 = s.labels.get('op:m:2');
  assert.deepEqual([l.text, l.refs, l.side, l.tone], ['r₂ − 4r₁', ['m.r2'], 'right', 'op']);
  assert.deepEqual([l2.text, l2.refs], ['r₃ − 7r₁', ['m.r3']]);
  assert.match(err(s, 'stairs m'), /m 还不是阶梯形：第 3 行第一个不为 0 的数没有在第 2 行那个的右边/);
  one(s, 'rowop m r3 - 2r2');
  assert.deepEqual(rows(s)[2], ['0', '0', '0']);
  assert.equal(s.labels.get('op:m').text, 'r₃ − 2r₂');
  assert.equal(s.labels.has('op:m:2'), false, '上一次的写法换掉');
  assert.deepEqual(one(s, 'stairs m').pivots, [{ r: 1, c: 1 }, { r: 2, c: 2 }]);
  assert.ok(s.objects.get('m').stairs);
  const pts = stairsPoints(s.objects.get('m'));
  assert.equal(pts.length, 5, '两个台阶：竖、横、竖、横走到头');
  assert.ok(pts[2].x > pts[1].x && pts[3].y > pts[2].y);
  const t = s.stateText();
  assert.match(t, /第 3 行：0  0  0（全为 0）/);
  assert.match(t, /画着阶梯线：非零行 2 行/);
  assert.match(t, /op:m「r₃ − 2r₂」（贴在 m\.r3）/);
  // 数一变阶梯线就收起来
  one(s, 'rowop m 2r1');
  assert.equal(s.objects.get('m').stairs, false);
  assert.match(err(s, 'stairs x'), /舞台上没有「x」/);
  // 全零行在中间不是阶梯形
  assert.throws(() => echelon(run(new Scene(), 'matrix z = 1 0 / 0 0 / 0 1').objects.get('z')), /全为 0 的行下面，第 3 行不全为 0/);
});

test('分数精确：r3 + 1/2 r1、r2 / 3、2r2 - 3r1（不用浮点）', () => {
  const s = run(new Scene(), 'matrix m = 2 4 1 / 3 1 1/3 / -1 5 7');
  one(s, 'rowop m r3 + 1/2 r1');
  assert.deepEqual(rows(s)[2], ['0', '7', '15/2']);
  one(s, 'rowop m r2 / 3');
  assert.deepEqual(rows(s)[1], ['1', '1/3', '1/9']);
  const fx = one(s, 'rowop m 2r2 - 3r1');
  assert.deepEqual(fx.ops[0].mid, ['2', '2/3', '2/9']);
  assert.deepEqual(rows(s)[1], ['-4', '-34/3', '-25/9']);
  // 增广矩阵：竖线后面那一列也跟着变
  const b = run(new Scene(), 'matrix b = 1 1 | 3 / 2 -1 | 0');
  one(b, 'rowop b r2 - 2r1');
  assert.deepEqual(rows(b, 'b'), [['1', '1', '3'], ['0', '-3', '-6']]);
  one(b, 'rowop b r2 / -3');
  assert.deepEqual(rows(b, 'b')[1], ['0', '1', '2']);
});

test('交换两行：格子带着数走（主元的框跟着走），m.1,1 指的是现在的第 1 行；列也能换', () => {
  const s = run(new Scene(), 'matrix m = 0 2 / 1 3\npivot m.2,1');
  const fx = one(s, 'rowop m r1 <-> r2');
  assert.deepEqual(rows(s), [['1', '3'], ['0', '2']]);
  assert.deepEqual(s.labels.get('op:m').refs, ['m.r1', 'm.r2'], '交换的写法贴在两行旁边');
  assert.deepEqual(fx.ops[0].keys, ['1.1', '1.2']);
  assert.deepEqual(fx.ops[0].other, ['2.1', '2.2']);
  const p = s.parts('m.1,1')[0];
  assert.equal(p.value, '1');
  assert.equal(p.key, '2.1', '一开始在第 2 行的那一格');
  assert.equal(p.pivot, true, '框跟着那个数走');
  assert.equal(s.labels.get('op:m').text, 'r₁ ↔ r₂');
  one(s, 'rowop m c1 <-> c2');
  assert.deepEqual(rows(s), [['3', '1'], ['2', '0']]);
  assert.equal(s.labels.get('op:m').side, 'below');
  one(s, 'unpivot m');
  assert.ok(s.objects.get('m').cells.every((x) => !x.pivot));
});

test('改一个数、主元：write 和一排格子的 write 各管各的', () => {
  const s = run(new Scene(), 'matrix m = 1 2 / 3 4\narray a = 9 8');
  one(s, 'write m.2,1 -1/2');
  assert.equal(s.parts('m.2,1')[0].value, '-1/2');
  one(s, 'write a.1 7');
  assert.equal(s.parts('a.1')[0].value, '7');
  assert.match(err(s, 'write m.2,1 x'), /「x」不是数/);
  assert.match(err(s, 'write m.r1 5'), /write 一次改一格/);
  one(s, 'pivot m.1,1 m.2,2');
  assert.match(s.stateText(), /1（主元框着）  2/);
  assert.match(err(s, 'pivot'), /pivot 后面写要框起来的那一格/);
});

test('乘法：product 把 A、B 排成一行、后面 = C；mul 一格是 A 的一行乘 B 的一列（精确）', () => {
  const s = run(new Scene(), 'matrix A = 1 2 3 / -1 0 1/2\nmatrix B = 1 0 / 2 1 / -2 4\nproduct C = A B');
  const A = s.objects.get('A'), B = s.objects.get('B'), C = s.objects.get('C');
  assert.equal(C.rows, 2);
  assert.equal(C.cols, 2);
  assert.ok(C.cells.every((x) => x.value === '' && x.label === '?'), 'C 先空着（话里的小块写 ?）');
  // 排成一行：A 左、B 中、C 右，上下居中
  const la = layout(A).box, lb = layout(B).box, lc = layout(C).box;
  assert.ok(la.x + la.w < lb.x && lb.x + lb.w + MX.EQ <= lc.x + 1);
  assert.ok(Math.abs(la.y + la.h / 2 - (lb.y + lb.h / 2)) < 1 && Math.abs(la.y + la.h / 2 - (lc.y + lc.h / 2)) < 1);
  const fx = one(s, 'mul C.1,2');
  assert.equal(fx.items[0].sum, '14');
  assert.deepEqual(fx.items[0].terms.map((t) => `${t.av}×${t.bv}=${t.p}`), ['1×0=0', '2×1=2', '3×4=12']);
  assert.deepEqual(fx.items[0].terms.map((t) => t.a), ['1.1', '1.2', '1.3']);
  assert.deepEqual(fx.items[0].terms.map((t) => t.b), ['1.2', '2.2', '3.2']);
  assert.match(s.stateText(), /矩阵 C = A B（2×2）：\n  第 1 行：□  14\n  第 2 行：□  □\n  还空着：C\.1,1 C\.2,1 C\.2,2/);
  one(s, 'mul C');
  assert.deepEqual(rows(s, 'C'), [['-1', '14'], ['-2', '2']]);
  // 乘积的部件写法照常
  assert.deepEqual(dryRun(s, 'glow A.r1 B.c2\nask tap C "点 {C.2,2}" expect=C.2,2'), []);
});

test('乘法写错的：尺寸不对、不是乘积、还空着', () => {
  const s = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 1 2 3');
  assert.match(err(s, 'product C = A B'), /A 是 2×2，B 是 1×3：A 的列数要等于 B 的行数才能乘/);
  assert.match(err(s, 'product C = A Z'), /「Z」舞台上没有/);
  assert.match(err(s, 'product C A B'), /要写成 product C = A B/);
  assert.match(err(s, 'product A = A A'), /乘积换一个名字/);
  assert.match(err(s, 'mul A.1,1'), /A 不是乘积（先写 product A = A B）/);
  assert.match(err(s, 'mul'), /mul 后面写算乘积的哪一格/);
  run(s, 'matrix B = 1 / 2\nproduct C = A B\nproduct D = A C');
  assert.match(err(s, 'product E = C B'), /C 是 2×1，B 是 2×1/);
  assert.match(err(s, 'mul D.1,1'), /C\.1,1 还空着/);
  assert.match(err(s, 'stairs C'), /C\.1,1 还空着/);
  // A 换了尺寸
  run(s, 'matrix A = 1 2 3 / 4 5 6');
  assert.match(err(s, 'mul C.1,1'), /尺寸变了/);
});

test('排版：分数那一列宽一点；增广的竖线在两列中间；乘积下面留出算式的地方', () => {
  const s = run(new Scene(), 'matrix m = 1 -25/9 | 3 / 2 1 | 4');
  const o = s.objects.get('m');
  const L = layout(o);
  assert.ok(L.cw[2] > L.cw[1]);
  assert.ok(L.barX > L.colX[2] + L.cw[2] && L.barX < L.colX[3]);
  assert.equal(toQ('-25/9').toString(), '-25/9');
  assert.equal(toQ('0.25').toString(), '1/4');
  assert.equal(toQ('x'), null);
  run(s, 'matrix A = 1 2 / 3 4\nmatrix B = 1 / 2\nproduct C = A B');
  // 乘积占的地方：从 A 的左边到 C 的右边，下面留出一条写算式（三个里最高的下面）
  const A = s.objects.get('A'), C = s.objects.get('C');
  const box = matrix.objectBox(C), la = layout(A).box, lc = layout(C).box;
  assert.ok(box.x <= la.x && box.x + box.w >= lc.x + lc.w);
  assert.ok(box.y + box.h >= Math.max(la.y + la.h, lc.y + lc.h) + MX.BAND - 1);
  assert.deepEqual(parseRows(['1', '2/', '3', '4']).rows, [['1', '2'], ['3', '4']]);
});

test('给老师看的现状：写法提示、每一行的数和样子、还空着的', () => {
  const s = run(new Scene(), 'matrix m = 1 2 / 0 0\npaint m.r1 g1\nglow m.1,2\ndim m.r2');
  const t = s.stateText();
  assert.match(t, /（矩阵：名字\.2,3 是第 2 行第 3 列/);
  assert.match(t, /矩阵 m（2×2）：\n  第 1 行：1（蓝）  2（蓝、亮）\n  第 2 行：0（灰）  0（灰）（全为 0）/);
  assert.equal(t.match(/（矩阵：/g).length, 1, '提示只给一次');
});

test('说明里的例子照抄能演：一行不错', () => {
  assert.deepEqual(dryRun(new Scene(), matrix.example), []);
  const s = run(new Scene(), matrix.example);
  assert.deepEqual(rows(s), [['1', '2', '3'], ['0', '-3', '-6'], ['0', '0', '1']]);
  assert.equal(s.parts('C.1,1')[0].value, '19');
  assert.equal(s.waiting.kind, 'tap');
  assert.doesNotMatch(matrix.doc + matrix.hint, /[他她]/);
});

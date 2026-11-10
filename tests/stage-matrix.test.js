// 舞台上的矩阵（kit/src/stage/types/matrix.js）：造、部件的写法、行变换（精确分数）、交换、倍乘、改数、主元、阶梯线、乘法的一格、给老师看的现状
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { matrix, parseOps, parseRows, opText, echelon, layout, stairsPoints, toQ, MX } from '../kit/src/stage/types/matrix.js';
import { compareFact, mergeFact } from '../kit/src/stage/scene.js';
import { factsOf } from '../kit/src/stage/stage.js';

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
  assert.match(s.stateText(), /矩阵 C = A B（2×2；算出来的 1 格跟着 A、B 自动重算）：\n  第 1 行：□  14\n  第 2 行：□  □\n  还空着：C\.1,1 C\.2,1 C\.2,2/);
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
  // 例子是活的一轮：算一格做示范，剩下的交给学生点开看；做到了预写的行把 B 交给学生拨、再给下一个挑战
  const s = run(new Scene(), matrix.example);
  assert.equal(s.parts('C.1,1')[0].value, '0');
  assert.equal(s.parts('C.2,2')[0].value, '');
  assert.ok(s.opens.has('C:explain') && s.goals.has('g1') && s.reactions.get('g1').length === 3);
  // 学生点开看的几下（预写的行只在学生的一下演）
  for (const c of parseScript('mul C.1,2\nmul C.2,1')) s.apply(c, { by: 'student' });
  const [fx] = parseScript('mul C.2,2').map((c) => s.apply(c, { by: 'student' }));
  assert.deepEqual(fx.goalsMet, ['g1']);
  for (const r of fx.reactions) for (const c of parseScript(r.src)) s.apply({ ...c, lenient: true });
  assert.ok(s.opens.has('B:edit') && s.goals.has('g2') && !s.goals.get('g2').met);
  assert.doesNotMatch(matrix.doc + matrix.hint, /[他她]/);
});

test('复核（第三次量）：空格子上能挂跟着算的——{A D}、{coef(M) Eta - rhs(M)}、格里的 {D.1,1 + 1}：先挂上，跟着空格子变的格空着、量判不了；填上了跟着算', async () => {
  const { evalMeasure } = await import('../kit/src/stage/rules.js');
  const { goalStatus } = await import('../kit/src/stage/goal.js');
  const s = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix D = _ _ / _ _');
  assert.equal(err(s, 'matrix AD = {A D}'), null, '能挂上（以前报「D.1,1 还空着」整行不演）');
  run(s, 'matrix AD = {A D}');
  assert.deepEqual(rows(s, 'AD'), [['', ''], ['', '']]);
  assert.equal(evalMeasure(s, 'rank(AD)').value, null, '量判不了');
  run(s, 'goal g1 "AD = O" when="AD = O"');
  assert.notEqual(goalStatus(s, s.goals.get('g1')), '做到了');
  assert.match(s.stateText(), /还空着：AD\.1,1 AD\.1,2 AD\.2,1 AD\.2,2（跟着算的：用到的还有空格子/);
  // 填上 D 的第 1 列：AD 的第 1 列跟着算出来，第 2 列还空着
  one(s, 'write D.1,1 1');
  assert.deepEqual(rows(s, 'AD'), [['', ''], ['', '']], 'D.2,1 还空着：AD 的第 1 列还跟着它变');
  run(s, 'write D.2,1 0');
  assert.deepEqual(rows(s, 'AD'), [['1', ''], ['3', '']]);
  run(s, 'write D.1,2 0\nwrite D.2,2 1');
  assert.deepEqual(rows(s, 'AD'), [['1', '2'], ['3', '4']]);
  assert.equal(evalMeasure(s, 'rank(AD)').value, 2);
  // L2 第 6 幕：代回去的残差，第 3 行不跟着空格子变（0·η − 0 = 0）照写
  run(s, 'matrix M = 1 2 -2 | 0 / 0 -2 -2 | -2 / 0 0 0 | 0\nmatrix Eta = _ / _ / 0\nmatrix R1 = {coef(M) Eta - rhs(M)} hide=on');
  assert.deepEqual(rows(s, 'R1'), [[''], [''], ['0']]);
  run(s, 'write Eta.1,1 -2\nwrite Eta.2,1 1');
  assert.deepEqual(rows(s, 'R1'), [['0'], ['0'], ['0']]);
  // 格里的 {D.1,1 + 1}：D.1,1 还空着时这一格空着
  run(s, 'matrix P = _ 0 / 0 1\nmatrix N = {P.1,1 + 1} 0 / 0 1');
  assert.deepEqual(rows(s, 'N'), [['', '0'], ['0', '1']]);
  run(s, 'write P.1,1 4');
  assert.deepEqual(rows(s, 'N'), [['5', '0'], ['0', '1']]);
  // 不是因为空格子算不出来的照旧当场报：维数对不上、没有这样东西
  run(s, 'matrix T = _ _ _ / _ _ _ / _ _ _');
  assert.match(err(s, 'matrix X = {A T}') || '', /算不出来|维数|对不上|乘/);
  assert.match(err(s, 'matrix X = {A Zz}') || '', /Zz/);
});

test('空格子：_ 是空着的一格，填满以前量、判断式都判不了；学生写进去以后是数', async () => {
  const { evalMeasure, predicateOf } = await import('../kit/src/stage/rules.js');
  const s = run(new Scene(), 'matrix D = _ _ / _ _');
  const D = s.objects.get('D');
  assert.equal(D.cells.length, 4);
  assert.ok(D.cells.every((x) => x.value === ''));
  assert.equal(evalMeasure(s, 'rank(D)').value, null);
  assert.equal(predicateOf(s, 'D', 'stairs')([]), null);
  run(s, 'write D.1,1 1');
  assert.equal(s.parts('D.1,1')[0].value, '1');
  assert.equal(s.parts('D.2,2')[0].value, '');
  // 一行里空着的和数混着写、增广的竖线照旧
  run(s, 'matrix M1 = 1 2 | 3 / _ _ | _');
  assert.deepEqual(rows(s, 'M1'), [['1', '2', '3'], ['', '', '']]);
  assert.equal(s.objects.get('M1').aug, 2);
  // 判答案时不认 _（答案不上舞台，空着的格不是一个答案）
  assert.throws(() => parseRows(['1 _'], null, { cap: false }), /不是数/);
});

test('vars=、from= 记在矩阵上（读回方程、和上一张比用）；写错了当场说', () => {
  const s = run(new Scene(), 'matrix M0 = 1 2 0 | 2 / 2 2 -4 | 2\nmatrix M1 = 1 2 0 | 2 / _ _ _ | _ from=M0 vars="x y z"');
  const M1 = s.objects.get('M1');
  assert.equal(M1.from, 'M0');
  assert.deepEqual(M1.vars, ['x', 'y', 'z']);
  assert.equal(s.objects.get('M0').from ?? null, null);
  assert.match(err(s, 'matrix M2 = 1 2 | 3 from=Q'), /from=Q：舞台上没有「Q」/);
  run(s, 'array a = 1 2');
  assert.match(err(s, 'matrix M2 = 1 2 | 3 from=a'), /from=a：「a」不是矩阵/);
  assert.match(err(s, 'matrix M2 = 1 2 / 3 4 from=M0'), /from=M0：M0 是 2×4 的，M2 是 2×2 的/);
  assert.match(err(s, 'matrix M2 = 1 2 | 3 vars="x y z"'), /vars= 写了 3 个未知数/);
});

test('并同类项：merge X Y 把 {-2 A} 并进 {-A} 成 {(-3) A}，X 拿下舞台；A 再变 Y 照新的式子跟着变', () => {
  const s = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix X = {-2 A}\nmatrix Y = {-A}');
  const fx = one(s, 'merge X Y');
  assert.equal(s.objects.has('X'), false);
  assert.deepEqual(rows(s, 'Y'), [['-3', '-6'], ['-9', '-12']]);
  assert.equal(s.objects.get('Y').live.whole, '(-3) A');
  assert.equal(fx.merge.x, 'X');
  assert.equal(fx.merge.y, 'Y');
  assert.equal(fx.merge.to.k.toString(), '-3');
  assert.equal(fx.merge.to.base, 'A');
  assert.equal(fx.merge.from.k.toString(), '-2');
  assert.equal(fx.merge.into.k.toString(), '-1');
  assert.ok(fx.removed);
  assert.equal(mergeFact(fx.merge), '学生把 X（−2A）拖到 Y（−A）上：并成了 −3A');
  one(s, 'write A.1,1 2');
  assert.deepEqual(rows(s, 'Y'), [['-6', '-6'], ['-9', '-12']]);
  assert.match(s.stateText(), /Y = \{\(-3\) A\}/);
  // 写错的：说清楚
  assert.match(err(s, 'merge Y'), /merge X Y/);
  assert.match(err(s, 'merge Y Q'), /舞台上没有「Q」/);
  assert.match(err(s, 'merge Y Y'), /自己/);
  // 还有东西跟着 X 算：X 拿不下来
  run(s, 'matrix X = {2 A}\nmatrix Z = {X + A}');
  assert.match(err(s, 'merge X Y'), /Z 跟着 X 算，X 拿不下来，并不了/);
  // 并好的系数照常写：1 倍写 A、−1 倍写 -A（再并一张照样认得）
  const t = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix X = {2 A}\nmatrix Y = {-A}\nmatrix U = {-2 A}\nmatrix V = {A}\nmerge X Y\nmerge U V');
  assert.equal(t.objects.get('Y').live.whole, 'A');
  assert.equal(t.objects.get('V').live.whole, '-A');
  assert.match(t.stateText(), /Y = \{A\}；V = \{-A\}/);
  assert.doesNotMatch(t.stateText(), /\(1\)|\(-1\)/);
  run(t, 'merge Y V');
  assert.equal(t.objects.get('V').live.whole, '0 A');
  // 写了 undo=on：并完 X 和它上面开着的这一项一起拿下舞台，撤一步的按钮会没声没息地没了，写下时就说
  const u = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix X = {-2 A}\nmatrix Y = {-A}');
  assert.equal(err(u, 'open X merge undo=on'), 'merge 会把 X 拿下舞台，撤不了：不要写 undo=on');
  assert.equal(err(u, 'open X merge'), null);
  assert.equal(err(u, 'open X compare undo=on'), null, 'compare 不拿掉东西，撤得了');
});

test('抵消：{2 A} 并 {-2 A}，Y 全是 0，现状写「Y = O（抵消了）」', () => {
  const s = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix X = {2 A}\nmatrix Y = {-2 A}');
  const fx = one(s, 'merge X Y');
  assert.ok(s.objects.get('Y').cells.every((x) => x.value === '0'));
  assert.match(s.stateText(), /Y = O（抵消了）/);
  // 式子也写 O，不写 (0) A（还跟着 A 的大小：里面记的是 0 A）
  assert.match(s.stateText(), /跟着算的[^\n]*Y = O（并同类项抵消了）/);
  assert.doesNotMatch(s.stateText(), /\(0\)|\{0 A\}/);
  assert.equal(s.objects.get('Y').live.whole, '0 A');
  assert.equal(mergeFact(fx.merge), '学生把 X（2A）拖到 Y（−2A）上：并成了 O（抵消了）');
  // A 变了 Y 照旧是 O；再并进一张就不是抵消了
  one(s, 'write A.1,1 9');
  assert.ok(s.objects.get('Y').cells.every((x) => x.value === '0'));
  run(s, 'matrix W = {3 A}\nmerge W Y');
  assert.doesNotMatch(s.stateText(), /抵消了/);
  assert.deepEqual(rows(s, 'Y'), [['27', '6'], ['9', '12']]);
});

test('收集：matrix Sum = collect 空着时一个空格，放进第一张以后照它的大小；放了就是跟着算的 {AA + AB}；collect - 是第一张减后面的；大小不一样放不进去', () => {
  const s = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 0 1 / 1 0\nmatrix AA = {A A}\nmatrix AB = {A B}\nmatrix BA = {B A}\nmatrix Sum = collect');
  const S0 = s.objects.get('Sum');
  assert.equal(S0.rows, 1);
  assert.equal(S0.cols, 1);
  assert.equal(S0.cells[0].value, '');
  assert.deepEqual(S0.collect, { sign: '+', terms: [] });
  assert.match(s.stateText(), /矩阵 Sum（收集用的，加起来；还空着/);
  one(s, 'put AA Sum');
  assert.deepEqual(rows(s, 'Sum'), [['7', '10'], ['15', '22']]);
  const fx = one(s, 'put AB Sum');
  assert.equal(s.objects.get('Sum').live.whole, 'AA + AB');
  assert.deepEqual(s.objects.get('Sum').collect.terms, ['AA', 'AB']);
  assert.deepEqual(rows(s, 'Sum'), [['9', '11'], ['19', '25']]);
  assert.ok(fx.derived?.some((d) => d.id === 'Sum'), '变了的格画面闪一下');
  assert.match(s.stateText(), /Sum = \{AA \+ AB\}/);
  assert.match(s.stateText(), /收集用的（加起来）：Sum = AA \+ AB/);
  // A 变了 Sum 跟着变
  one(s, 'write A.1,1 0');
  assert.deepEqual(rows(s, 'Sum'), [['8', '8'], ['16', '25']]);
  // 第一张减后面的
  run(s, 'matrix Dd = collect -\nput AB Dd\nput BA Dd');
  assert.equal(s.objects.get('Dd').live.whole, 'AB - BA');
  assert.deepEqual(rows(s, 'Dd'), [['-1', '-4'], ['4', '1']]);
  // 大小不一样：放不进去（学生的一下这个世界做不到，弹回去）
  run(s, 'matrix C = 1 2 3 / 4 5 6');
  assert.match(err(s, 'put C Sum'), /Sum 是 2×2 的，C 是 2×3，放不进去/);
  const bad = s.apply(parseScript('put C Sum')[0], { by: 'student', open: 'put' });
  assert.ok(bad.blocked);
  assert.equal(bad.judged.verdict.legal, false);
  assert.equal(bad.judged.verdict.why, 'Sum 是 2×2 的，C 是 2×3，放不进去');
  assert.equal(s.objects.get('Sum').live.whole, 'AA + AB');
  // 不是收集用的
  assert.match(err(s, 'put AB A'), /A 不是收集用的矩阵（写 matrix A = collect）/);
  assert.match(err(s, 'put Sum Sum'), /自己/);
  // 学生只能往里放：收集用的拨不了、不能做行变换
  const e = run(new Scene(), 'matrix E = collect');
  assert.match(err(e, 'open E edit'), /收集用的/);
  assert.match(err(e, 'matrix F = collect *'), /collect -/);
});

test('整张拖去比：compare P Q 逐格比，不一样的格写出来；两张都不变', () => {
  const s = run(new Scene(), 'matrix P = 1 3 / -1 2\nmatrix Q = 1 5 / 1 2');
  const fx = one(s, 'compare P Q');
  assert.equal(fx.compare.whole, true);
  assert.equal(fx.compare.total, 4);
  assert.equal(compareFact(fx), '学生把 P 拖到 Q 上比：4 格里 2 格不一样——(1,2) 3 和 5，(2,1) −1 和 1（两张都没变）');
  assert.equal(compareFact(fx.compare), compareFact(fx));
  assert.deepEqual(rows(s, 'P'), [['1', '3'], ['-1', '2']]);
  assert.deepEqual(rows(s, 'Q'), [['1', '5'], ['1', '2']]);
  run(s, 'matrix R = 1 3 / -1 2');
  assert.equal(compareFact(one(s, 'compare P R')), '学生把 P 拖到 R 上比：4 格都一样（两张都没变）');
  run(s, 'matrix T = 1 2 3 / 4 5 6');
  assert.match(compareFact(one(s, 'compare P T')), /P 是 2×2 的，T 是 2×3 的，不一样大/);
  // 两格比大小照旧
  assert.equal(one(s, 'compare P.1,1 Q.1,2').sign, -1);
});

test('compare、merge 的事实进学生的这一下（factsOf）：compare 不过裁判、merge 以后 X 不在了，都照 fx 交', () => {
  const s = run(new Scene(), 'matrix P = 1 3 / -1 2\nmatrix Q = 1 5 / 1 2\nopen P compare');
  const fx = s.apply(parseScript('compare P Q')[0], { by: 'student', open: 'compare' });
  assert.ok(factsOf(fx).some((f) => f.includes('4 格里 2 格不一样')), factsOf(fx).join('；'));
  const s2 = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix X = {-2 A}\nmatrix Y = {-A}\nopen X merge');
  const fx2 = s2.apply(parseScript('merge X Y')[0], { by: 'student', open: 'merge' });
  assert.equal(s2.objects.has('X'), false);
  assert.ok(factsOf(fx2).some((f) => f.includes('并成了 −3A')), factsOf(fx2).join('；'));
  // 放进收集用的：照裁判交的事实
  const s3 = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 0 1 / 1 0\nmatrix AA = {A A}\nmatrix AB = {A B}\nmatrix Sum = collect\nput AA Sum\nopen AB put');
  const fx3 = s3.apply(parseScript('put AB Sum')[0], { by: 'student', open: 'put' });
  assert.deepEqual(factsOf(fx3), ['学生把 AB 放进了 Sum：Sum = {AA + AB}']);
  assert.deepEqual(factsOf({ judged: { after: ['x'] } }), ['x']);
  assert.deepEqual(factsOf({ judged: { after: ['x'] }, pickDiff: 'p' }), ['x', 'p']);
  assert.deepEqual(factsOf({}), []);
  assert.deepEqual(factsOf(null), []);
});

test('跟着算的也能开 compare / put / merge（数照旧由式子定）；别的照旧报', () => {
  const s = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 0 1 / 1 0\nmatrix AB = {A B}');
  assert.equal(err(s, 'open AB compare'), null);
  assert.equal(err(s, 'open AB put'), null);
  assert.equal(err(s, 'open AB merge'), null);
  assert.match(err(s, 'open AB edit'), /AB 是跟着算的，学生动不了/);
  assert.match(err(s, 'open AB rowop'), /AB 是跟着算的，学生动不了/);
  // 整张的把手：写整张矩阵的名字
  assert.match(err(s, 'open A.1,1 compare'), /写整张矩阵的名字/);
  // 三种都不判对错：写 wrong= 当场报
  assert.match(err(s, 'open AB compare wrong=mark'), /判不了对错/);
});

test('扣着的一格：学生看的小块写「M 第 2 行第 1 列」，不写值；写给老师的写值、说一声扣着', async () => {
  const { chipTextOf, tapValueOf } = await import('../kit/src/stage/scene.js');
  const s = run(new Scene(), 'matrix M = 1 2 / 37 4\ncover M.2,1');
  const M = s.objects.get('M');
  const [p] = s.parts('M.2,1');
  assert.equal(chipTextOf(p, M), 'M 第 2 行第 1 列');
  assert.doesNotMatch(chipTextOf(p, M), /37/);
  assert.equal(tapValueOf(p), '37，扣着');
  assert.equal(chipTextOf(s.parts('M.1,2')[0], M), '2', '没扣着的照旧写值');
});

test('点开看怎么算碰到扣着的格：mul 交出参与的扣着的格（写给老师照实说是几），画面照它画成 ?', () => {
  const s = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 5 6 / 7 8 beside=A\nproduct C = A B\ncover C.1,1\ncover A.1,2\ncover B.2,2');
  const [fx] = parseScript('mul C.1,1').map((c) => s.apply(c, { by: 'student' }));
  // C.1,1 = 1×5 + 2×7 = 19：参与的有 A 的第 1 行（A.1,2 扣着）、B 的第 1 列、C.1,1（扣着）；B.2,2 不在这一格的算式里
  assert.deepEqual(fx.hidden, [{ ref: 'C.1,1', value: '19' }, { ref: 'A.1,2', value: '2' }]);
  // 没扣着的不交
  const t = run(new Scene(), 'matrix A = 1 2 / 3 4\nmatrix B = 5 6 / 7 8 beside=A\nproduct C = A B');
  const [g] = parseScript('mul C.1,1').map((c) => t.apply(c, { by: 'student' }));
  assert.equal(g.hidden, undefined);
});

test('复核（第三次量，排版）：同名重造乘积 product P = B A 翻在原来那一排上——两个因子换槽、乘积留在原处，不被推到后造的东西下面', () => {
  const s = run(new Scene(), `matrix A = 1 2 / 2 4
matrix B = 2 2 / -1 -1 beside=A
matrix C = 1 0 / 2 1 beside=B
product P = A B
mul P
matrix D = 0 0 / 0 0
matrix AC = {A C}
matrix AD = {A D} beside=AC
card q = "BA 也是 O" "BA 不是 O" "说不准"`);
  const order = [...s.objects.keys()];
  const at = (id) => ({ ...s.objects.get(id).origin });
  const a0 = at('A'), b0 = at('B'), p0 = at('P'), q0 = at('q');
  run(s, 'product P = B A\nmul P');
  // 以前：乘积照 B 原来的地方重新排、排到 objects 最后，reflow 把「= P」推到 AC、AD、题卡下面，那一排散了
  assert.deepEqual([...s.objects.keys()], order, 'P 在 objects 里的先后不变');
  assert.deepEqual(at('P'), p0, '乘积留在原处');
  assert.equal(at('B').x, a0.x, 'B 换到 A 原来的槽');
  assert.equal(at('A').x, b0.x, 'A 换到 B 原来的槽');
  assert.equal(at('B').y, a0.y);
  assert.equal(at('A').y, b0.y);
  assert.deepEqual(at('q'), q0, '后造的东西不动');
  assert.deepEqual(rows(s, 'P'), [['6', '12'], ['-3', '-6']]);
  // 大小不一样（2×3 乘 3×2 翻成 3×2 乘 2×3）：照旧排在原来那一排的左边起、上下居中，P 不掉到后造的东西下面，后造的往下让
  const t = run(new Scene(), `matrix A = 1 2 3 / 4 5 6
matrix B = 1 0 / 0 1 / 1 1 beside=A
product P = A B
matrix D = 7 8 / 9 10`);
  const left = t.objectBox('A').x;
  run(t, 'product P = B A');
  assert.deepEqual([...t.objects.keys()], ['A', 'B', 'P', 'D']);
  assert.equal(t.objectBox('B').x, left, '从原来那一排的左边起');
  const rowOf = (id) => { const o = t.objects.get(id); const b = layout(o).box; return b.y + b.h / 2; };
  assert.ok(Math.abs(rowOf('B') - rowOf('A')) <= 1 && Math.abs(rowOf('A') - rowOf('P')) <= 1, '三个上下居中，在一排上');
  assert.ok(t.objectBox('A').x > t.objectBox('B').x && layout(t.objects.get('P')).box.x > t.objectBox('A').x, 'B、A、P 从左往右');
  const p = t.objectBox('P'), d = t.objectBox('D');
  assert.ok(d.y >= p.y + p.h, 'P 长高了，D 往下让');
});

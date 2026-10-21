// stack / cqueue / compress / extsort（和 sort 的希尔排序）共同的约定：说明草稿和示例页里的例子照抄就能用；
// 第 0 步不挂问题；填表的格子数和表头对得上；随便写几组输入也不会走崩
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFields } from '../kit/src/parse.js';
import { resolveAsks, commonSpec, trackFields, fillSpec, fillOrder } from '../kit/src/stepperspec.js';
import { stackEngine } from '../kit/src/engines/stack.js';
import { cqueueEngine } from '../kit/src/engines/cqueue.js';
import { compressEngine } from '../kit/src/engines/compress.js';
import { extsortEngine } from '../kit/src/engines/extsort.js';
import { sortEngine } from '../kit/src/engines/sort.js';

const ENGINES = { stack: stackEngine, cqueue: cqueueEngine, compress: compressEngine, extsort: extsortEngine, sort: sortEngine };
const blocksOf = (file) => [...readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').matchAll(/^(`{3,})(\w+)\n([\s\S]*?)^\1\s*$/gm)].filter((m) => ENGINES[m[2]]).map((m) => [m[2], m[3]]);

function checkBlock(name, src, { strict }) {
  const e = ENGINES[name];
  const where = `${name}（${src.split('\n').find((l) => /^id:/.test(l)) || src.split('\n')[0]}）`;
  const tracked = trackFields(parseFields(src).fields);
  const { fields } = tracked;
  const input = e.parse(fields, src);
  const r = e.run(input);
  assert.ok(r.steps.length >= 2, `${where}：至少两步`);
  assert.ok(!r.steps[0].ask && !r.steps[0].asks, `${where}：第 0 步挂了问题`);
  const spec = commonSpec(fields);
  assert.deepEqual(resolveAsks(spec.ask, r.steps).errors, [], `${where}：ask 写的问不到`);
  if (strict) assert.deepEqual(e.problems?.(input, r) || [], [], `${where}：自检有提醒`);
  assert.ok(e.quiz(input, r, fields), `${where}：没有 quiz`);
  const t = e.table(input, r, fields);
  if (t) {
    for (const row of t.rows) assert.equal(row.cells.length, t.head.length, `${where}：表的一行 ${row.cells.length} 格，表头 ${t.head.length} 个`);
    const fs = fillSpec(t, spec.mode === 'fill' ? fields : {});
    assert.deepEqual(fs.errors, [], `${where}：填表的字段不对`);
    assert.ok(fillOrder(fs.table).length + (fs.table.extra || []).length > 0, `${where}：表里没有要填的格子`);
  }
  // 每一步都画得出来；错法也走得完
  r.steps.forEach((s) => assert.equal(typeof e.view(s.view, input, {}), 'string'));
  for (const v of e.variants(input, fields)) { const vr = e.run(v.input); e.quiz(v.input, vr, fields); e.table(v.input, vr, fields); assert.match(v.label, /^像是.*（王道：.*）$/, `${where}：错法的说法`); }
  assert.deepEqual(tracked.unknown(), [], `${where}：有用不上的字段`);
}

test('说明草稿（docs/drafts/linear.md）和示例页里的例子：照抄就能用', () => {
  const doc = blocksOf('docs/drafts/linear.md');
  assert.ok(doc.length >= 5, `草稿里只找到 ${doc.length} 个例子`);
  for (const [name, src] of doc) checkBlock(name, src, { strict: true });
  const page = blocksOf('kit/examples/ds-linear-demo.html');
  assert.ok(page.length >= 12);
  for (const [name, src] of page) checkBlock(name, src, { strict: false });
});

test('说明草稿的精简版每节不超过 500 字节', () => {
  const md = readFileSync(new URL('../docs/drafts/linear.md', import.meta.url), 'utf8');
  for (const part of md.split(/^### /m).slice(1, 5)) {
    const head = part.slice(0, part.indexOf('<!-- 完整写法 -->'));
    assert.ok(Buffer.byteLength(`### ${head}`.trim()) <= 500, `${part.split('\n')[0]}：精简版 ${Buffer.byteLength(head)} 字节`);
  }
});

test('随便写几组输入：都走得完，第 0 步不问，写错的报中文原因', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let k = 0; k < 40; k++) {
    // 中缀：随机的 a op b op c，带一对括号
    const ops = ['+', '-', '*', '/'];
    const ex = `a ${ops[rnd(4)]} (b ${ops[rnd(4)]} c) ${ops[rnd(4)]} d ${ops[rnd(4)]} e`;
    checkBlock('stack', `infix: ${ex}`, { strict: false });
    checkBlock('stack', `brackets: ${Array.from({ length: 6 }, () => '()[]{}'[rnd(6)]).join('')}`, { strict: false });
    const push = [1, 2, 3, 4, 5];
    const pop = push.slice().sort(() => rnd(3) - 1);
    checkBlock('stack', `push: ${push.join(' ')}\npop: ${pop.join(' ')}`, { strict: false });
    const opsQ = Array.from({ length: 6 }, () => (rnd(3) ? `enqueue ${'abcdefgh'[rnd(8)]}${rnd(9)}` : 'dequeue')).join(', ');
    for (const full of ['spare', 'count', 'tag']) checkBlock('cqueue', `size: ${3 + rnd(4)}\nfull: ${full}\nops: ${opsQ}`, { strict: false });
    const n = 3 + rnd(6), kind = ['symmetric', 'lower', 'upper', 'tridiagonal'][rnd(4)];
    checkBlock('compress', `matrix: ${kind} ${n}\nat: ${1 + rnd(n)} ${1 + rnd(n)}\norder: ${rnd(2) ? 'row' : 'col'}`, { strict: false });
    checkBlock('extsort', `loser: ${Array.from({ length: 3 + rnd(5) }, () => rnd(90)).join(' ')}\nnext: ${rnd(50)} ∞ ${rnd(70)}`, { strict: false });
    checkBlock('extsort', `replace: ${Array.from({ length: 12 }, () => rnd(99)).join(' ')}\nwork: ${2 + rnd(3)}`, { strict: false });
    checkBlock('extsort', `merge: ${Array.from({ length: 4 + rnd(8) }, () => 1 + rnd(40)).join(' ')}\nk: ${2 + rnd(3)}`, { strict: false });
    checkBlock('sort', `algo: shell\narray: ${Array.from({ length: 6 + rnd(7) }, () => rnd(99)).join(' ')}`, { strict: false });
  }
  assert.throws(() => stackEngine.parse({ infix: 'a +' }), /结尾/);
  assert.throws(() => stackEngine.parse({ infix: 'a', postfix: '1' }), /一次演示一种/);
  assert.throws(() => cqueueEngine.parse({ size: '1', ops: 'dequeue' }), /size/);
  assert.throws(() => compressEngine.parse({ matrix: 'symmetric 5', at: '6 1' }), /不在矩阵里/);
  assert.throws(() => extsortEngine.parse({ replace: '3 1 2', work: '5' }), /不比记录数/);
});

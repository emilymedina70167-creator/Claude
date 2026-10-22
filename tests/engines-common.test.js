// 所有演示引擎的共同约定：第 0 步是开始的样子，不能挂问题（挂了永远问不到）；填表的表格式对得上
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFields } from '../kit/src/parse.js';
import { sortEngine } from '../kit/src/engines/sort.js';
import { treeEngine } from '../kit/src/engines/tree.js';
import { kmpEngine, hashEngine, bsearchEngine } from '../kit/src/engines/search.js';
import { netEngine } from '../kit/src/engines/graph.js';
import { traceEngine } from '../kit/src/engines/trace.js';
import { schedEngine, pagingEngine, bankerEngine, diskEngine } from '../kit/src/engines/os.js';
import { addrEngine } from '../kit/src/engines/addr.js';
import { bitsEngine, cacheEngine, pipeEngine } from '../kit/src/engines/co.js';
import { subnetEngine, tcpEngine, windowEngine } from '../kit/src/engines/net4.js';
import { elimEngine } from '../kit/src/engines/elim.js';
import { detEngine } from '../kit/src/engines/det.js';
import { eigEngine, schmidtEngine } from '../kit/src/engines/eig.js';
import { quadEngine } from '../kit/src/engines/quad.js';
import { framesEngine } from '../kit/src/engines/frames.js';
import { crcEngine, hammingEngine } from '../kit/src/engines/codes.js';
import { allocEngine } from '../kit/src/engines/osmem.js';
import { memexpEngine } from '../kit/src/engines/comem.js';
import { faddEngine } from '../kit/src/engines/cofloat.js';
import { mulEngine } from '../kit/src/engines/comul.js';
import { fileidxEngine } from '../kit/src/engines/osfile.js';
import { pagetableEngine } from '../kit/src/engines/ospt.js';
import { fragEngine } from '../kit/src/engines/netfrag.js';
import { encodeEngine } from '../kit/src/engines/netcode.js';
import { huffmanEngine } from '../kit/src/engines/huffman.js';
import { ufEngine } from '../kit/src/engines/uf.js';
import { buildtreeEngine } from '../kit/src/engines/buildtree.js';
import { threadEngine } from '../kit/src/engines/thread.js';
import { forestEngine } from '../kit/src/engines/forest.js';
import { avlEngine, rbtEngine } from '../kit/src/engines/balanced.js';
import { btreeEngine } from '../kit/src/engines/btree.js';
import { stackEngine } from '../kit/src/engines/stack.js';
import { cqueueEngine } from '../kit/src/engines/cqueue.js';
import { compressEngine } from '../kit/src/engines/compress.js';
import { extsortEngine } from '../kit/src/engines/extsort.js';
import { asmEngine } from '../kit/src/engines/coasm.js';
import { fillSpec, fillOrder } from '../kit/src/stepperspec.js';

const ENGINES = Object.fromEntries([sortEngine, treeEngine, kmpEngine, hashEngine, bsearchEngine, netEngine, traceEngine, schedEngine, pagingEngine, bankerEngine, diskEngine, addrEngine, bitsEngine, cacheEngine, pipeEngine, subnetEngine, tcpEngine, windowEngine, elimEngine, detEngine, eigEngine, schmidtEngine, quadEngine, framesEngine,
  crcEngine, hammingEngine, allocEngine, memexpEngine, faddEngine, mulEngine, fileidxEngine, pagetableEngine, fragEngine, encodeEngine,
  huffmanEngine, ufEngine, buildtreeEngine, threadEngine, forestEngine, avlEngine, rbtEngine, btreeEngine, stackEngine, cqueueEngine, compressEngine, extsortEngine, asmEngine].map((e) => [e.name, e]));

// 示例页里的每个演示组件，再加几个 408-demo 没有的写法
const blocks = [];
for (const f of ['kit/examples/408-demo.html']) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/```(\w+)\n([\s\S]*?)```/g)) if (ENGINES[m[1]]) blocks.push([m[1], m[2]]);
}
blocks.push(['bits', 'float: 0xC1260000'], ['bits', 'add: 100 + 50'], ['subnet', 'ip: 192.168.10.130/26'], ['subnet', 'aggregate: 192.168.0.0/24, 192.168.1.0/24, 192.168.2.0/24, 192.168.3.0/24'],
  ['tcp', 'close: u=500, v=800, w=900'], ['window', 'proto: sr\nframes: 6\nwindow: 4\nlost: 2'], ['net', 'edges: A-B 1, B-C 2, A-C 3\nrun: prim from A'], ['net', 'edges: A->B 2, A->C 3, B->D 2, C->D 1\nrun: critical'],
  ['elim', 'vectors: (1,0), (0,1), (1,1)'], ['elim', 'matrix: [[1,2],[3,4]]\ninverse: true'], ['det', 'matrix: [[2,1],[1,3]]'], ['eig', 'matrix: [[2,1],[1,2]]'], ['schmidt', 'vectors: (1,1,0), (1,0,1)'],
  ['quad', 'f: x^2 + 2xy + 3y^2'], ['quad', 'f: 2x1^2 + 3x2^2 + 3x3^2 + 4x2x3\nmethod: orth'], ['frames', 'id: f\n---\narray: 1 2\n---\narray: 2 1\n? 换了吗 = 是'],
  ['tree', 'bst: 53 17 78 09 45\nops: delete 17'], ['sched', 'algo: sjf\nprocs: P1 0 8, P2 1 4, P3 2 9'], ['paging', 'refs: 1 2 3 4 1 2 5 1 2 3 4 5\nframes: 3\nalgo: clock']);

test('每个演示：第 0 步没有问题；填表的表每一行格子数和表头一样', () => {
  assert.ok(blocks.length > 25);
  for (const [name, src] of blocks) {
    const e = ENGINES[name];
    const { fields } = parseFields(e.head ? e.head(src) : src);
    const input = e.parse(fields, src);
    const r = e.run(input);
    assert.ok(r.steps.length >= 2, `${name}：至少两步`);
    assert.ok(!r.steps[0].ask && !r.steps[0].asks, `${name}（${src.split('\n')[0]}）：第 0 步挂了问题，永远问不到`);
    const t = e.table?.(input, r, fields);
    if (t) {
      for (const row of t.rows) assert.equal(row.cells.length, t.head.length, `${name}：表的一行 ${row.cells.length} 格，表头 ${t.head.length} 个`);
      const spec = fillSpec(t, {});
      assert.ok(fillOrder(spec.table).length + (spec.table.extra || []).length > 0, `${name}：表里没有要填的格子`);
    }
  }
});

// 说明（CLAUDE-PROJECT.md）里的每个演示组件例子：课件作者照抄的就是它们，必须一字不改就能用——
// 解析得了、走得完、ask: 写的种类都问得到、mode / given / rows / cols 都对
test('说明里的演示组件例子：照抄就能用（ask 的种类都有、填表的字段都对）', async () => {
  const { resolveAsks, commonSpec, trackFields } = await import('../kit/src/stepperspec.js');
  const md = readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8');
  const found = [];
  for (const m of md.matchAll(/^(`{3,})(\w+)\n([\s\S]*?)^\1\s*$/gm)) if (ENGINES[m[2]]) found.push([m[2], m[3]]);
  assert.ok(found.length >= 12, `说明里只找到 ${found.length} 个演示组件的例子`);
  for (const [name, src] of found) {
    const e = ENGINES[name];
    const where = `${name}（${src.split('\n').find((l) => /^id:/.test(l)) || src.split('\n')[0]}）`;
    const tracked = trackFields(parseFields(e.head ? e.head(src) : src).fields);
    const { fields } = tracked;
    const input = e.parse(fields, src);
    const r = e.run(input);
    const spec = commonSpec(fields);
    const { errors } = resolveAsks(spec.ask, r.steps);
    assert.deepEqual(errors, [], `${where}：ask 写的问不到`);
    assert.deepEqual(e.problems?.(input, r) || [], [], `${where}：自检有提醒`);
    if (spec.mode === 'quiz') assert.ok(e.quiz?.(input, r, fields), `${where}：mode: quiz 却没有 quiz`);
    if (spec.mode === 'fill') {
      const t = e.table?.(input, r, fields);
      assert.ok(t, `${where}：mode: fill 却没有表`);
      assert.deepEqual(fillSpec(t, fields).errors, [], `${where}：given / rows / cols 写错了`);
    }
    if (e.defaultAsk) e.defaultAsk(input);
    assert.deepEqual(tracked.unknown(), [], `${where}：例子里有用不上的字段`);
  }
});

// 新加的演示组件忘了放进上面的 ENGINES，就不会被「例子照抄就能用」查到：按 blocks/index.js 里注册的对一遍
test('blocks/index.js 里注册的演示组件都在这份测试的 ENGINES 里', () => {
  const src = readFileSync(new URL('../kit/src/blocks/index.js', import.meta.url), 'utf8');
  const registered = [...src.matchAll(/^\s*(\w+):\s*stepperBlock\(/gm)].map((m) => m[1]);
  assert.ok(registered.length > 30);
  const missing = registered.filter((n) => !ENGINES[n]);
  assert.deepEqual(missing, [], `这些组件没放进 tests/engines-common.test.js 的 ENGINES：${missing.join('、')}`);
  // elim 走 elimBlock()（mode: do 另有画面），也要在
  assert.ok(ENGINES.elim);
});

// 每个 quiz 的标准答案自己判自己要是对的；填表的表照着标准答案填要全对——判法和出题对不上时（宽度、写法、分组），学生写对了也会被判错
test('quiz 的答案、填表的标准答案：照着填都判对（示例页 + 手册里的每个例子）', async () => {
  const { textAnswerSpec } = await import('../kit/src/textspec.js');
  const { checkFill, normCell } = await import('../kit/src/stepperspec.js');
  const { readdirSync } = await import('node:fs');
  const all = [...blocks];
  const pages = ['CLAUDE-PROJECT.md', ...readdirSync('kit/examples').filter((f) => f.endsWith('.html')).map((f) => `kit/examples/${f}`)];
  for (const f of pages) for (const m of readFileSync(f, 'utf8').matchAll(/^(`{3,})(\w+)\n([\s\S]*?)^\1\s*$/gm)) if (ENGINES[m[2]]) all.push([m[2], m[3]]);
  let quizzes = 0, tables = 0;
  for (const [name, src] of all) {
    const e = ENGINES[name];
    const where = `${name}（${src.split('\n').find((l) => /^id:/.test(l)) || src.split('\n')[0]}）`;
    const { fields } = parseFields(e.head ? e.head(src) : src);
    let input, r;
    try { input = e.parse(fields, src); r = e.run(input); } catch { continue; } // 示例页里故意写错的、只演示出错的
    let q = null;
    try { q = e.quiz?.(input, r, fields) ?? null; } catch { /* 这种用法没有 quiz */ }
    const spec = q && textAnswerSpec(q.type || 'seq', q.answer, { width: q.width });
    if (spec) { quizzes++; assert.ok(spec.check(spec.display).ok, `${where}：quiz 的答案「${spec.display}」自己判成了错`); }
    let t = null;
    try { t = e.table?.(input, r, fields) ?? null; } catch { /* 这种用法没有表 */ }
    if (!t) continue;
    tables++;
    const { table } = fillSpec(t, {});
    const first = (c) => String([].concat(c.v ?? '')[0] ?? '');
    const values = table.rows.map((row) => row.cells.map((c) => (c.given ? '' : c.mark ? (normCell(first(c)) !== '' ? '√' : '') : first(c))));
    values.extra = (table.extra || []).map(first);
    const res = checkFill(table, values);
    assert.ok(res.ok, `${where}：照着标准答案填，${res.first ? (res.first.extra !== undefined ? `附加的第 ${res.first.extra + 1} 格` : `第 ${res.first.r + 1} 行第 ${res.first.c + 1} 格`) : ''}判成了错`);
  }
  if (process.env.SHOW_COUNTS) console.log(`quiz ${quizzes}、表 ${tables}`);
  assert.ok(quizzes > 30 && tables > 30, `quiz ${quizzes} 个、表 ${tables} 张，太少了`);
});

// 手册的格式：每个演示组件都要有一节（课堂 Claude 只知道手册里写了的），能 quiz / fill / 认错法的，说明里要提到
test('每个演示组件在手册里都有说明，quiz、fill、错法诊断都写到了', async () => {
  const { componentDocs } = await import('../kit/build-docs.js');
  const { docSections } = await import('../kit/src/subject.js');
  const md = readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8');
  const secs = docSections(componentDocs(md));
  const textOf = (name) => { const s = secs.find((x) => x.names.includes(name)); return s ? [...s.body, ...(s.detail || [])].join('\n') : null; };
  const missing = [], gaps = [];
  for (const [name, e] of Object.entries(ENGINES)) {
    const t = textOf(name);
    if (t === null) { missing.push(name); continue; }
    if (e.quiz && !/mode: quiz|`quiz`/.test(t)) gaps.push(`${name} 有 quiz，说明里没写 mode: quiz`);
    if (e.table && !/mode: fill|`fill`/.test(t)) gaps.push(`${name} 有填表，说明里没写 mode: fill`);
    if (e.variants && !/错法/.test(t)) gaps.push(`${name} 认得出错法，说明里没写「错法诊断认得出……」`);
  }
  assert.deepEqual(missing, [], `这些组件在 CLAUDE-PROJECT.md 第三节没有说明（小节标题里要有组件名）：${missing.join('、')}`);
  assert.deepEqual(gaps, []);
});

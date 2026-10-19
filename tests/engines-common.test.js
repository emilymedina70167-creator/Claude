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
import { fillSpec, fillOrder } from '../kit/src/stepperspec.js';

const ENGINES = Object.fromEntries([sortEngine, treeEngine, kmpEngine, hashEngine, bsearchEngine, netEngine, traceEngine, schedEngine, pagingEngine, bankerEngine, diskEngine, addrEngine, bitsEngine, cacheEngine, pipeEngine, subnetEngine, tcpEngine, windowEngine, elimEngine, detEngine, eigEngine, schmidtEngine, quadEngine, framesEngine].map((e) => [e.name, e]));

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

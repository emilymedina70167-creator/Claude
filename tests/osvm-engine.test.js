// 访存的整条链和有效访问时间（kit/src/engines/osvm.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseFields } from '../kit/src/parse.js';
import { trackFields, resolveAsks, commonSpec, fillSpec, checkAsk } from '../kit/src/stepperspec.js';
import { memEngine as M, parseTime, eatCases, big } from '../kit/src/engines/osvm.js';

const Q46 = { page: '4KB', table: '0->101H, 1->-, 2->254H', vaddr: '2362H, 1565H, 25A5H', cost: 'tlb=10 mem=100 fault=10^8', resident: '2' };

// 2009 年统考第 46 题（官方答案）：2362H 要 210 ns；1565H 要 100000220 ns（10 + 100 + 10^8 + 10 + 100）；25A5H 要 110 ns。
// 1565H 缺页时驻留集已满，LRU 换出页 0（页 2 刚访问过），页 1 调进 101H 块，物理地址 101565H
test('2009 年第 46 题：三个地址的时间、换出的页、物理地址', () => {
  const input = M.parse(Q46);
  const r = M.run(input);
  assert.deepEqual(r.results.map((x) => x.time), [210, 100000220, 110]);
  assert.deepEqual(r.results.map((x) => x.pa.toString(16).toUpperCase()), ['254362', '101565', '2545A5']);
  assert.deepEqual(r.results.map((x) => [x.hit, x.fault, x.victim]), [[false, false, null], [false, true, 0], [true, false, null]]);
  assert.ok(!r.steps[0].ask);
  const victim = r.steps.find((s) => s.ask?.tag === 'victim').ask;
  assert.ok(checkAsk(victim, '0').ok && !checkAsk(victim, '2').ok);
  const pa = r.steps.filter((s) => s.ask?.tag === 'paddr')[1].ask;
  for (const g of ['101565H', '0x101565', '101565']) assert.ok(checkAsk(pa, g).ok, g);
  assert.equal(M.quiz(input, r).answer, '210 100000220 110');
  const t = M.table(input, r);
  assert.deepEqual(t.rows.map((x) => x.cells.map((c) => [].concat(c.v)[0])), [['2', '', '', '254362H', '210'], ['1', '', '√', '101565H', '100000220'], ['2', '√', '', '2545A5H', '110']]);
  assert.deepEqual(fillSpec(t, {}).errors, []);
});

test('2009 年第 46 题的常见错法：各自算出来的和对的不一样', () => {
  const input = M.parse(Q46);
  const vs = M.variants(input);
  const by = Object.fromEntries(vs.map((v) => [v.input.mistake, M.run(v.input).results]));
  // 缺页处理完没重新执行：10 + 100 + 10^8 = 100000110；以为重查快表还没命中：多一次查页表 100000320
  assert.equal(by.noRetry[1].time, 100000110);
  assert.equal(by.retryMiss[1].time, 100000320);
  // 查完页表没放进快表：25A5H 也没命中，210
  assert.equal(by.noFill[2].time, 210);
  // 没算查快表的时间：200、100000210、110
  assert.deepEqual(by.parallel.map((x) => x.time), [200, 100000210, 110]);
  // 换出了刚访问过的页 2：1565H → 254565H
  assert.equal(by.mru[1].pa.toString(16).toUpperCase(), '254565');
  // FIFO 在这组数上换的也是页 0：和对的一样，不列
  assert.ok(!('fifo' in by));
  assert.ok(vs.every((v) => v.label.startsWith('像是')));
});

test('别的约定：两级页表、快表和页表同时查、缺页后快表还没命中、空闲块、FIFO', () => {
  const two = M.run(M.parse({ ...Q46, levels: 2 }));
  assert.deepEqual(two.results.map((x) => x.time), [310, 100000320, 110]);
  const par = M.run(M.parse({ ...Q46, parallel: 'true' }));
  assert.deepEqual(par.results.map((x) => x.time), [200, 100000210, 110]);
  const tab = M.run(M.parse({ ...Q46, retry: 'table' }));
  assert.equal(tab.results[1].time, 100000320);
  // 驻留集没满：调进空闲块 3A0H，不换出
  const fr = M.run(M.parse({ ...Q46, resident: 3, free: '3A0H' }));
  assert.equal(fr.results[1].victim, null);
  assert.equal(fr.results[1].pa.toString(16).toUpperCase(), '3A0565');
  // FIFO：页 2 先调入（order: 2 0），换出页 2
  const fifo = M.run(M.parse({ ...Q46, replace: 'fifo', order: '2 0' }));
  assert.equal(fifo.results[1].victim, 2);
  assert.throws(() => M.parse({ ...Q46, resident: 3 }), /free:/);
  assert.throws(() => M.parse({ ...Q46, vaddr: '5000H' }), /页表里没有/);
  assert.throws(() => M.parse({ ...Q46, tlb: '1' }), /不在内存/);
});

// Silberschatz《操作系统概念》习题：访存 200 ns，75% 的页表引用在快表里（查快表不计时间）：EAT = 0.75 × 200 + 0.25 × 400 = 250 ns
// 常见算法题：快表 0.2 μs、内存 1 μs、命中率 85%：0.85 × 1.2 + 0.15 × 2.2 = 1.35 μs
test('有效访问时间：书上的两道算法题、带缺页、带 Cache 和两级页表', () => {
  assert.equal(M.run(M.parse({ rate: 'tlb=75%', cost: 'tlb=0 mem=200' })).eat, 250);
  const us = M.run(M.parse({ rate: 'tlb=0.85', cost: 'tlb=0.2 mem=1', unit: 'us' }));
  assert.equal(us.eat, 1.35);
  // 和 2009 年那题同样的口径：三种情况 110、210、100000220
  const f = M.parse({ rate: 'tlb=0.9 fault=0.0001', cost: 'tlb=10 mem=100 fault=10^8' });
  const r = M.run(f);
  assert.deepEqual(r.cases.map((x) => [x.p, x.t]), [[0.9, 110], [0.0999, 210], [0.0001, 100000220]]);
  assert.equal(r.eat, 10120.001);
  assert.deepEqual(M.variants(f).map((v) => v.input.mistake), ['noRetry', 'retryMiss', 'parallel', 'missNoData']);
  // Cache 命中率 0.9（10 ns）：取一次数据 0.9 × 10 + 0.1 × 110 = 20；两级页表没命中 5 + 200 + 20
  const c = eatCases(M.parse({ rate: 'tlb=0.95 cache=0.9', cost: 'tlb=5 cache=10 mem=100', levels: 2 }));
  assert.equal(c.D, 20);
  assert.deepEqual(c.cases.map((x) => x.t), [25, 225]);
  assert.equal(c.eat, 35);
  assert.equal(M.quiz(f, r).type, 'num');
  assert.throws(() => M.parse({ rate: 'tlb=0.9', cost: 'mem=100' }), /tlb=/);
  assert.throws(() => M.parse({ rate: 'tlb=0.9 fault=0.2', cost: 'tlb=1 mem=100 fault=1ms' }), /超过 1/);
});

test('时间的写法', () => {
  assert.equal(parseTime('10^8'), 1e8);
  assert.equal(parseTime('1e8'), 1e8);
  assert.equal(parseTime('2.5×10^7'), 25000000);
  assert.equal(parseTime('8ms'), 8e6);
  assert.equal(parseTime('200ns', 'us'), 0.2);
  assert.equal(big(1e8), '10⁸');
  assert.equal(big(25000000), '2.5×10⁷');
  assert.equal(big(100000220), '100000220');
});

// 示例页、说明草稿里的 mem 例子：照抄就能用
test('示例页和说明里的 mem 例子：解析得了、ask 都问得到、字段都用上', () => {
  const srcs = ['kit/examples/os2-demo.html', 'docs/drafts/os2.md'].filter((f) => existsSync(f)).map((f) => readFileSync(f, 'utf8'));
  let n = 0;
  for (const src of srcs) {
    for (const m of src.matchAll(/^```mem\n([\s\S]*?)^```/gm)) {
      n++;
      const tracked = trackFields(parseFields(m[1]).fields);
      const input = M.parse(tracked.fields);
      const r = M.run(input);
      const spec = commonSpec(tracked.fields);
      assert.ok(!r.steps[0].ask);
      assert.deepEqual(resolveAsks(spec.ask, r.steps).errors, [], m[1]);
      if (spec.mode === 'fill') assert.deepEqual(fillSpec(M.table(input, r), tracked.fields).errors, []);
      if (spec.mode === 'quiz') assert.ok(M.quiz(input, r));
      assert.deepEqual(M.problems(input, r), []);
      assert.deepEqual(tracked.unknown(), [], m[1]);
    }
  }
  assert.ok(n >= 3);
});

// 引擎跑完以后的量（kit/src/engines/measures.js）：检验题的条件、答案用它们。
// 比较、移动的数法照王道代码另数一遍，要和教材公式对得上；每一趟的序列要和引擎画的一样。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES } from '../kit/src/engines/registry.js';
import {
  MEASURES, runEngine, measure, markDuplicates, wangdaoSort, sortPass, variantsOf, variantValues,
} from '../kit/src/engines/measures.js';

const rev = (n) => Array.from({ length: n }, (_, i) => n - i);
const asc = (n) => Array.from({ length: n }, (_, i) => i + 1);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('直接插入：倒序 4 个比 9、移 12；顺序比 3、移 0', () => {
  assert.deepEqual(wangdaoSort('insert', [4, 3, 2, 1]).cmp, 9);
  assert.deepEqual(wangdaoSort('insert', [4, 3, 2, 1]).move, 12);
  const up = wangdaoSort('insert', [1, 2, 3, 4]);
  assert.equal(up.cmp, 3);
  assert.equal(up.move, 0);
  // measure 交出来的一样
  const m = measure('sort', { algo: 'insert', array: '4 3 2 1' });
  assert.equal(m.values.cmp, 9);
  assert.equal(m.values.move, 12);
});

test('希尔 gaps=1：倒序 4 个比 6、移 12', () => {
  const r = wangdaoSort('shell', [4, 3, 2, 1], { gaps: [1] });
  assert.equal(r.cmp, 6);
  assert.equal(r.move, 12);
  assert.equal(measure('sort', { algo: 'shell', gaps: '1', array: '4 3 2 1' }).values.cmp, 6);
});

test('和教材公式一致：n = 2…8 的顺序和倒序', () => {
  for (let n = 2; n <= 8; n++) {
    const ri = wangdaoSort('insert', rev(n)), ai = wangdaoSort('insert', asc(n));
    assert.equal(ri.cmp, ((n + 2) * (n - 1)) / 2, `插入倒序比较 n=${n}`);
    assert.equal(ri.move, ((n + 4) * (n - 1)) / 2, `插入倒序移动 n=${n}`);
    assert.equal(ai.cmp, n - 1);
    assert.equal(ai.move, 0);
    const rb = wangdaoSort('bubble', rev(n)), ab = wangdaoSort('bubble', asc(n));
    assert.equal(rb.cmp, (n * (n - 1)) / 2);
    assert.equal(rb.swap, (n * (n - 1)) / 2);
    assert.equal(rb.move, (3 * n * (n - 1)) / 2);
    assert.equal(ab.cmp, n - 1);
    assert.equal(ab.passes.length, 1);
    assert.equal(wangdaoSort('select', rev(n)).cmp, (n * (n - 1)) / 2);
    assert.equal(wangdaoSort('select', asc(n)).cmp, (n * (n - 1)) / 2);
    const aq = wangdaoSort('quick', asc(n));
    assert.equal(aq.cmp, (n * (n - 1)) / 2);
    assert.equal(aq.passes.length, n - 1);
  }
});

test('乱序的输入也钉住：希尔 4 3 2 1 gaps 2 1、直接插入 3 1 2、冒泡 3 1 2', () => {
  // 希尔 d=2：i=3 (2<4) 比 1 移 3，i=4 (1<3) 比 1 移 3 → 2 1 4 3；d=1：i=2 (1<2) 比 1 移 3，i=3 (4<2 不成立) 比 1，i=4 (3<4) 比 2 移 3
  const sh = wangdaoSort('shell', [4, 3, 2, 1], { gaps: [2, 1] });
  assert.equal(sh.cmp, 6);
  assert.equal(sh.move, 12);
  // 直接插入 3 1 2：i=2 比 1<3、和哨兵比，移 3；i=3 比 2<3、2<1 不成立，移 3
  const ins = wangdaoSort('insert', [3, 1, 2]);
  assert.equal(ins.cmp, 4);
  assert.equal(ins.move, 6);
  // 冒泡 3 1 2：第 1 趟比 (1,2) 不换、(3,1) 换；第 2 趟比 (3,2) 换
  const bu = wangdaoSort('bubble', [3, 1, 2]);
  assert.equal(bu.cmp, 3);
  assert.equal(bu.swap, 2);
  assert.equal(bu.move, 6);
  assert.equal(bu.passes.length, 2);
});

test('快排：一趟划分 m 个元素比 m−1 次（不照字面再比挪过去的那个）', () => {
  assert.equal(wangdaoSort('quick', [2, 1]).cmp, 1);
  // 3 1 2：第 1 次划分 3 个元素比 2 次 → 2 1 3；第 2 次划分 [2 1] 比 1 次
  const q = wangdaoSort('quick', [3, 1, 2]);
  assert.equal(q.cmp, 3);
  assert.deepEqual(q.passes, runEngine('sort', { algo: 'quick', array: '3 1 2' }).run.passes);
  // 一般的：每次划分的区间长度 − 1 加起来（王道的例子划分 4 次：8 个 → 27 38 13 | 49 | 76 97 65 49′，
  // 左边 3 个 → 13 27 38，右边 4 个 → 49′ 65 76 97，再划 [49′ 65] 2 个：7 + 2 + 3 + 1）
  const wd = measure('sort', { algo: 'quick', array: "49 38 65 97 76 13 27 49'" }).values;
  assert.equal(wd.passes, 4);
  assert.equal(wd.cmp, 13);
});

test('归并：每次 B[i] <= B[j] 算一次（照引擎的每一趟另数，passes 和引擎一样）', () => {
  // 1 2 3 4：第 1 趟 (1,2)(3,4) 各比 1 次；第 2 趟 (1 2)(3 4) 比 2 次（1≤3、2≤3，左边用完）
  assert.equal(wangdaoSort('merge', [1, 2, 3, 4]).cmp, 4);
  // 4 3 2 1：第 1 趟各 1 次；第 2 趟 (3 4)(1 2)：3>1、3>2 右边用完，比 2 次
  assert.equal(wangdaoSort('merge', [4, 3, 2, 1]).cmp, 4);
  // 5 个：最后落单的一段原样留到下一趟（不比）；1 3 | 2 5 | 4 → 第 1 趟比 2 次，第 2 趟 (1 3)(2 5)：1≤2、3>2、3≤5 比 3 次，第 3 趟 (1 2 3 5)(4)：比 4 次
  const r = wangdaoSort('merge', [3, 1, 5, 2, 4]);
  assert.equal(r.cmp, 2 + 3 + 4);
  const { run } = runEngine('sort', { algo: 'merge', array: '3 1 5 2 4' });
  assert.deepEqual(r.passes, run.passes);
});

test('堆（2015 真题）：小根堆 8 15 10 21 34 16 12 删掉 8 以后重建比较 3 次', () => {
  const m = measure('tree', { heap: '8 15 10 21 34 16 12', type: 'min', ops: 'delete' });
  assert.equal(m.values.cmp1, 3);
  assert.equal(m.values.cmp, 3);
  assert.equal(m.values.swaps, 1);
  assert.deepEqual(m.values.final, [10, 15, 12, 21, 34, 16]);
  // 建堆 + 插入 + 删除，每个操作各自的比较次数也交
  const b = measure('tree', { heap: '53 17 78 09 45 65 87 32', type: 'max', ops: 'build, insert 90, delete' });
  assert.equal(b.values.cmp, b.values.cmp1 + b.values.cmp2 + b.values.cmp3);
  // 交换次数和引擎画出来的交换一样
  const { run } = runEngine('tree', { heap: '53 17 78 09 45 65 87 32', type: 'max', ops: 'build, insert 90, delete' });
  assert.equal(b.values.swaps, run.steps.filter((s) => s.ask?.tag === 'swap').length);
  assert.deepEqual(b.values.final, run.final.map(Number));
  // 堆排序的每一趟
  const s = measure('tree', { heap: '1 2 3 4 5', type: 'max', ops: 'build, sort' });
  assert.deepEqual(s.values.final, [1, 2, 3, 4, 5]);
  assert.equal(s.values.pass4.length, 5);
});

// 有重复的随机数组（值只在 1～6 里取）
function rnd(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}
test('另数的每一趟和引擎的每一趟一样：insert / shell / bubble / select / quick / merge 各随机 50 组（有重复）', () => {
  const r = rnd(7);
  for (const algo of ['insert', 'shell', 'bubble', 'select', 'quick', 'merge']) {
    for (let k = 0; k < 50; k++) {
      const n = 2 + Math.floor(r() * 9);
      const a = Array.from({ length: n }, () => 1 + Math.floor(r() * 6));
      const fields = { algo, array: a.join(' ') };
      if (algo === 'shell' && n > 3 && r() < 0.5) fields.gaps = n > 4 ? '3 1' : '2 1';
      const { input, run } = runEngine('sort', fields);
      const mine = wangdaoSort(algo, a, { gaps: input.gaps });
      assert.deepEqual(mine.passes, run.passes, `${algo} ${a.join(' ')}`);
    }
  }
});

test('sortPass：希尔第 2 趟作用在学生写的第 1 趟上', () => {
  // 正确的第 1 趟（d = 4）是 49 13 27 49 76 38 65 97；学生写错了一处（13、27 换了）
  const wrong = [49, 27, 13, 49, 76, 38, 65, 97];
  // d = 2 两组：{49 13 76 65} → 13 49 65 76；{27 49 38 97} → 27 38 49 97
  assert.deepEqual(sortPass('shell', wrong, 2, { gaps: [4, 2, 1] }), [13, 27, 49, 38, 65, 49, 76, 97]);
  // 不给 gaps 照 n/2 减半
  assert.deepEqual(sortPass('shell', wrong, 2, { n: 8 }), [13, 27, 49, 38, 65, 49, 76, 97]);
  // 直接插入第 k 趟只插第 k+1 个；冒泡第 k 趟把后面最小的冒到第 k 个；选择第 k 趟换第 k 个
  assert.deepEqual(sortPass('insert', [3, 5, 1, 4], 2), [1, 3, 5, 4]);
  assert.deepEqual(sortPass('bubble', [3, 5, 1, 4], 1), [1, 3, 5, 4]);
  assert.deepEqual(sortPass('select', [3, 5, 1, 4], 2), [3, 1, 5, 4]);
  // 不改传进来的那一行
  assert.deepEqual(wrong, [49, 27, 13, 49, 76, 38, 65, 97]);
});

test('希尔 gaps="2 1" 排 3 2 2\' 1：unstable 1、flipped ["2 2′"]；直接插入 unstable 0', () => {
  const s = measure('sort', { algo: 'shell', gaps: '2 1', array: "3 2 2' 1" });
  assert.equal(s.values.unstable, 1);
  assert.deepEqual(s.values.flipped, ['2 2′']);
  assert.deepEqual(s.values.final, [1, 2, 2, 3]);
  const i = measure('sort', { algo: 'insert', array: "3 2 2' 1" });
  assert.equal(i.values.unstable, 0);
  assert.deepEqual(i.values.flipped, []);
  // 学生没写撇号：页面自己记上，说一声
  const m = measure('sort', { algo: 'shell', gaps: '2 1', array: '3 2 2 1' });
  assert.equal(m.values.unstable, 1);
  assert.match(m.marked, /第二个 2 记成 2′/);
  assert.equal(i.marked, null);
});

const md = (s) => { const { text, changed } = markDuplicates(s); return { text, changed }; };
test('markDuplicates："49 38 49" → "49 38 49′"；"49 49\'"、"49 49’" 都成 "49 49′"', () => {
  assert.deepEqual(md('49 38 49'), { text: '49 38 49′', changed: true });
  assert.deepEqual(md("49 49'"), { text: '49 49′', changed: false });
  assert.deepEqual(md('49 49’'), { text: '49 49′', changed: false });
  assert.deepEqual(md('49 49′'), { text: '49 49′', changed: false });
  assert.deepEqual(md('5 5 5'), { text: '5 5′ 5′′', changed: true });
  assert.deepEqual(md('1, 2, 3'), { text: '1, 2, 3', changed: false });
  // 学生自己标在前面那个上：照学生的
  assert.equal(markDuplicates("49' 49").text, '49′ 49');
  // 说的那句：第几个记成什么
  assert.deepEqual(markDuplicates('49 38 49').notes, ['第二个 49 记成 49′']);
});

test('FIFO Belady：1 2 3 4 1 2 5 1 2 3 4 5，3 块缺 9 次、4 块缺 10 次', () => {
  const refs = '1 2 3 4 1 2 5 1 2 3 4 5';
  const a = measure('paging', { refs, frames: '3', algo: 'fifo' });
  const b = measure('paging', { refs, frames: '4', algo: 'fifo' });
  assert.equal(a.values.faults, 9);
  assert.equal(b.values.faults, 10);
  assert.equal(a.values.hits, 3);
  near(a.values.rate, 9 / 12);
  assert.deepEqual(a.ties, []);
});

test('OPT 7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1、3 块：faults 9，ties 里有 victims，faults 没有并列', () => {
  // 这条引用串一步一步看：每次换页时以后都不再用的页最多只有一页（第 11 个访问时只有 4、第 14 个时只有 3、第 18 个时只有 2），
  // 所以照实没有并列；victims 是唯一的 7 1 0 4 3 2
  const m = measure('paging', { refs: '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1', frames: '3', algo: 'opt' });
  assert.equal(m.values.faults, 9);
  assert.deepEqual(m.values.victims, ['7', '1', '0', '4', '3', '2']);
  assert.ok(!m.ties.includes('faults'));
  assert.ok(!m.ties.includes('victims'));
  // 有并列的串：1 2 3 4 1 2 5 1 2 3 4 5 访问第 10 个（3）时 1、2 以后都不再用，第 11 个（4）时 2、3 都不再用
  const t = measure('paging', { refs: '1 2 3 4 1 2 5 1 2 3 4 5', frames: '3', algo: 'opt' });
  assert.equal(t.values.faults, 7);
  assert.ok(t.ties.includes('victims'));
  assert.ok(!t.ties.includes('faults'));
  assert.deepEqual(t.tieAt.victims, [9, 10]);
  // FIFO、LRU 不会并列
  assert.deepEqual(measure('paging', { refs: '1 2 3 4 1 2 5 1 2 3 4 5', frames: '3', algo: 'lru' }).ties, []);
});

test('SSTF 两个请求一样远：ties 里有 order', () => {
  // 磁头 50，40 和 60 一样远：先去哪边都是 10 + 20，距离没有并列
  const a = measure('disk', { requests: '40 60', head: '50', algo: 'sstf' });
  assert.ok(a.ties.includes('order'));
  assert.ok(!a.ties.includes('dist'));
  assert.equal(a.values.dist, 30);
  // 磁头 50，40 60 100：先去 40 是 10+20+40 = 70，先去 60 是 10+40+60 = 110：距离也靠并列定
  const b = measure('disk', { requests: '40 60 100', head: '50', algo: 'sstf' });
  assert.ok(b.ties.includes('order'));
  assert.ok(b.ties.includes('dist'));
  assert.ok(b.ties.includes('avg'));
  // 没有一样远的
  assert.deepEqual(measure('disk', { requests: '98 183 37 122 14 124 65 67', head: '53', algo: 'sstf' }).ties, []);
  // 一样的磁道号写了两次不算并列
  assert.deepEqual(measure('disk', { requests: '60 60 70', head: '50', algo: 'sstf' }).ties, []);
});

test('AVL：3 2 1 一次 LL、root 2；3 1 2 一次 LR；有重复的数抛引擎原话', () => {
  const a = measure('avl', { avl: '3 2 1' });
  assert.equal(a.values.rot, 1);
  assert.equal(a.values.LL, 1);
  assert.equal(a.values.LR, 0);
  assert.equal(a.values.root, 2);
  const b = measure('avl', { avl: '3 1 2' });
  assert.equal(b.values.rot, 1);
  assert.equal(b.values.turns, 2);
  assert.equal(a.values.turns, 1);
  assert.equal(b.values.LR, 1);
  assert.equal(b.values.LL, 0);
  let msg = '';
  try { ENGINES.avl.parse({ avl: '3 3' }); } catch (e) { msg = e.message; }
  assert.ok(msg);
  assert.throws(() => measure('avl', { avl: '3 3' }), (e) => e.message === msg);
});

test('二叉排序树 2 1 3：height 2、leaves 2、aslSucc 5/3', () => {
  const m = measure('tree', { bst: '2 1 3' });
  assert.equal(m.values.height, 2);
  assert.equal(m.values.leaves, 2);
  near(m.values.aslSucc, 5 / 3);
  const c = measure('tree', { bst: '1 2 3 4' });
  assert.equal(c.values.height, 4);
  assert.equal(c.values.leaves, 1);
  near(c.values.aslSucc, 10 / 4);
});

test('FCFS P1 0 3, P2 2 6：avgTurn 5、avgWait 0.5、order ["P1","P2"]；磁盘 FCFS 头 50、请求 60 40：dist 30、avg 15', () => {
  const s = measure('sched', { procs: 'P1 0 3, P2 2 6', algo: 'fcfs' });
  assert.equal(s.values.avgTurn, 5);
  assert.equal(s.values.avgWait, 0.5);
  near(s.values.avgWeighted, (1 + 7 / 6) / 2);
  assert.deepEqual(s.values.order, ['P1', 'P2']);
  const d = measure('disk', { requests: '60 40', head: '50', algo: 'fcfs' });
  assert.equal(d.values.dist, 30);
  assert.equal(d.values.avg, 15);
  assert.deepEqual(d.values.order, [60, 40]);
});

test('散列 1 12 23、p=11、线性探测、表长 11：aslSucc 2、clashes 2', () => {
  const m = measure('hash', { hash: '1 12 23', p: '11', probe: 'linear', size: '11' });
  assert.equal(m.values.aslSucc, 2);
  assert.equal(m.values.clashes, 2);
  assert.equal(typeof m.values.aslFail, 'number');
  // 拉链法：接在链表后面的算冲突
  assert.equal(measure('hash', { hash: '1 12 23 5', p: '11', probe: 'chain' }).values.clashes, 2);
});

test('variantsOf：sort shell 有 shellBlock；paging lru 有 fifo、noInitial；variantValues(paging lru → fifo) 的 faults 是 FIFO 的', () => {
  const sv = variantsOf('sort', { algo: 'shell', array: "49 38 65 97 76 13 27 49'", gaps: '4 2 1' });
  assert.ok(sv.some((v) => v.key === 'shellBlock' && v.label && v.input));
  const pf = { refs: '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1', frames: '3', algo: 'lru' };
  const keys = variantsOf('paging', pf).map((v) => v.key);
  assert.ok(keys.includes('fifo'));
  assert.ok(keys.includes('noInitial'));
  assert.equal(new Set(keys).size, keys.length);
  const fifo = measure('paging', { ...pf, algo: 'fifo' });
  assert.equal(variantValues('paging', pf, 'fifo').values.faults, fifo.values.faults);
  // 一开始调入不算缺页：少算开头那 3 次
  assert.equal(variantValues('paging', pf, 'noInitial').values.faults, measure('paging', pf).values.faults - 3);
  // 错法的那一份排序：passes 是错法的
  const sb = variantValues('sort', { algo: 'shell', array: "49 38 65 97 76 13 27 49'", gaps: '4 2 1' }, 'shellBlock');
  assert.ok(sb.values.pass1);
  assert.equal(variantValues('paging', pf, '没有这个'), null);
  // 磁盘方向弄反、堆建反了：短名是一个词
  const dk = variantsOf('disk', { requests: '98 183 37 122 14 124 65 67', head: '53', algo: 'scan' }).map((v) => v.key);
  assert.ok(dk.includes('reverse'));
  assert.ok(dk.includes('look'));
  const hk = variantsOf('tree', { heap: '53 17 78 09 45 65 87 32', ops: 'build' }).map((v) => v.key);
  assert.ok(hk.includes('minHeap'));
  assert.ok(hk.includes('insertBuild'));
  // sched 的 RR：新到的和用完时间片的谁先
  const rk = variantsOf('sched', { procs: 'P1 0 3, P2 1 4, P3 2 2', algo: 'rr q=2' }).map((v) => v.key);
  assert.ok(rk.includes('rrOld'));
  assert.ok(rk.includes('fcfs'));
});

test('variantsOf：每个引擎的短名不重复、没有 undefined；同一种错法的短名不看它排第几', () => {
  const inputs = {
    sort: ['insert', 'shell', 'bubble', 'select', 'quick', 'merge', 'radix'].map((algo) => ({ algo, array: "49 38 65 97 76 13 27 49'" })),
    tree: [{ bst: '45 24 53 12 37 93', ops: 'delete 45' }, { heap: '53 17 78 09 45 65 87 32', ops: 'build, sort' }, { nodes: 'A(B(D, E), C(, F))', walk: 'inorder' }],
    avl: [{ avl: '15 3 7 10 9 8' }, { avl: '3 1 2' }],
    paging: ['fifo', 'lru', 'opt', 'clock', 'eclock'].map((algo) => ({ refs: '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1', frames: '3', algo })),
    sched: [{ procs: 'P1 0 3 2, P2 1 4 1, P3 2 2 3', algo: 'rr q=2' }, { procs: 'P1 0 3 2, P2 1 4 1, P3 2 2 3', algo: 'prio' }],
    disk: ['fcfs', 'sstf', 'scan', 'cscan', 'look', 'clook'].map((algo) => ({ requests: '98 183 37 122 14 124 65 67', head: '53', algo })),
    hash: [{ hash: '19 14 23 01 68 20 84 27 55 11 10 79', p: '13', size: '16' }, { hash: '19 14 23 01 68', p: '13', probe: 'quadratic', size: '19' }, { hash: '19 14 23 01 68', p: '13', probe: 'chain' }],
  };
  assert.deepEqual(Object.keys(inputs).sort(), Object.keys(MEASURES).sort());
  for (const [name, list] of Object.entries(inputs)) for (const f of list) {
    const keys = variantsOf(name, f).map((v) => v.key);
    for (const k of keys) assert.ok(typeof k === 'string' && k && !k.includes('undefined'), `${name} ${JSON.stringify(f)}：${k}`);
    assert.equal(new Set(keys).size, keys.length, `${name} ${JSON.stringify(f)}：${keys.join(' ')}`);
    // 每种错法都算得出量
    for (const k of keys) assert.ok(variantValues(name, f, k), `${name} ${k}`);
  }
});

test('MEASURES 里每个名字 measure 都交出来了（没有 undefined）', () => {
  const samples = {
    sort: [
      { algo: 'insert', array: "49 38 65 97 76 13 27 49'" },
      { algo: 'bubble', array: "49 38 65 97 76 13 27 49'" },
      { algo: 'shell', array: "49 38 65 97 76 13 27 49'" },
      { algo: 'quick', array: "49 38 65 97 76 13 27 49'" },
    ],
    tree: [{ bst: '45 24 53 12 37 93' }, { heap: '53 17 78 09 45 65 87 32', ops: 'build, sort' }],
    avl: [{ avl: '15 3 7 10 9 8' }],
    paging: [{ refs: '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1', frames: '3', algo: 'lru' }],
    sched: [{ procs: 'P1 0 3, P2 2 6, P3 4 4', algo: 'sjf' }],
    disk: [{ requests: '98 183 37 122 14 124 65 67', head: '53', algo: 'sstf' }],
    hash: [{ hash: '19 14 23 01 68 20 84 27 55 11 10 79', p: '13', size: '16' }],
  };
  assert.deepEqual(Object.keys(samples).sort(), Object.keys(MEASURES).sort());
  for (const [name, list] of Object.entries(MEASURES)) {
    const got = {};
    for (const f of samples[name]) Object.assign(got, measure(name, f).values);
    for (const k of Object.values(got)) assert.notEqual(k, undefined);
    for (const [k, v] of Object.entries(got)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${name}.${k} = ${v}`);
    for (const m of list) {
      const key = m.endsWith('#') ? `${m.slice(0, -1)}1` : m;
      assert.ok(key in got, `${name} 没交出 ${m}`);
      assert.notEqual(got[key], undefined, `${name}.${key}`);
    }
  }
});

test('runEngine：不认识的引擎、读不懂的字段抛引擎原话', () => {
  assert.throws(() => runEngine('nope', {}), /nope/);
  let msg = '';
  try { ENGINES.sort.parse({ algo: 'insert', array: '1 x 3' }); } catch (e) { msg = e.message; }
  assert.throws(() => runEngine('sort', { algo: 'insert', array: '1 x 3' }), (e) => e.message === msg);
  // 也认整段写法
  assert.equal(measure('sort', 'algo: insert\narray: 4 3 2 1').values.cmp, 9);
});

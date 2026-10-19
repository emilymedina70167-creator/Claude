// 排序演示引擎（组件 sort）：直接插入、冒泡、简单选择、快速排序、二路归并、基数排序，一律按王道的代码走。
// 位置从 1 数（考题里的「第几个」）；重复的数在后面加 '（49'），看稳定性。纯函数，不碰 DOM（tests/stepper.test.js；常见错法在 tests/sorting.test.js）。
import { parseArray } from '../sorting.js';
import { arrayView, esc, itemText } from './arrayview.js';

export const ALGOS = {
  insert: '直接插入排序', bubble: '冒泡排序', select: '简单选择排序', quick: '快速排序', merge: '二路归并排序', radix: '基数排序',
};
const ALIAS = {
  insert: 'insert', insertion: 'insert', 插入: 'insert', 直接插入: 'insert',
  bubble: 'bubble', 冒泡: 'bubble',
  select: 'select', selection: 'select', 选择: 'select', 简单选择: 'select',
  quick: 'quick', quicksort: 'quick', 快排: 'quick', 快速: 'quick',
  merge: 'merge', 归并: 'merge', 二路归并: 'merge',
  radix: 'radix', 基数: 'radix',
};

const vOf = (x) => x.v;
const seqOf = (A) => A.map(vOf).join(' ');
const t = itemText;
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
const clsFor = (ps, c, base = {}) => { const o = { ...base }; for (const p of ps) o[p] = o[p] ? `${o[p]} ${c}` : c; return o; };

export function parse(fields) {
  const algoSrc = String(fields.algo ?? fields.algorithm ?? '').trim().toLowerCase();
  if (!algoSrc) throw new Error(`sort 要写 algo:（${Object.keys(ALGOS).join(' / ')}）`);
  const algo = ALIAS[algoSrc];
  if (!algo) throw new Error(`algo: 不认识「${fields.algo ?? fields.algorithm}」，可以写 ${Object.entries(ALGOS).map(([k, v]) => `${k}（${v}）`).join('、')}`);
  if (!fields.array) throw new Error('sort 要写 array:（如 49 38 65 97 76 13 27 49\'）');
  const items = parseArray(fields.array);
  if (algo === 'radix' && items.some((x) => !Number.isInteger(x.v) || x.v < 0)) throw new Error('基数排序只排非负整数');
  const pass = fields.pass === undefined || fields.pass === '' ? 1 : Number(fields.pass);
  if (!Number.isInteger(pass) || pass < 1) throw new Error(`pass: 写第几趟（从 1 数）（现在是「${fields.pass}」）`);
  return { algo, items, pass };
}

/** 跑一遍：{ steps: [{ view, msg, ask? }], passes: [每一趟结束后的序列（数组）] } */
export function run(input) {
  const f = { insert: insertion, bubble, select: selection, quick, merge, radix }[input.algo];
  const ok = f(input.items.map((x) => ({ ...x })));
  return input.mistake ? mistakeRun(input, ok) : ok;
}

// —— 常见错法 ——
// 只拿来和学生写的比（外壳拿它说「像是……」），不用一步步的演示。每种错法：
//   passes(a, ok)：从头到尾都按错法做，每一趟（快排是每一次划分）之后的序列（只有值）；ok 是正确的那一遍。mode: quiz / fill 比这个
//   one(a, view, k)：先猜时学生看着的是正确的状态（view.A），在它上面按错法走第 k 趟（从 0 数）会写出什么
//   first: true：只有第 1 趟说得清（之后「按错法再走一趟」没有唯一的写法），只给第 1 趟的先猜
//   都没有的（趟数数错、枢轴取错、先按高位分配）：先猜的题面已经写明了插第几个、哪个枢轴、按哪一位，不会这样错
const MISTAKES = {
  // 冒泡从前往后（大的往后沉）
  bubbleFront: {
    first: true,
    passes: (a) => {
      const A = a.slice(), n = A.length, ps = [];
      for (let i = 0; i < n - 1; i++) {
        let flag = false;
        for (let j = 0; j < n - 1 - i; j++) if (A[j] > A[j + 1]) { [A[j], A[j + 1]] = [A[j + 1], A[j]]; flag = true; }
        ps.push(A.slice());
        if (!flag) break;
      }
      return ps;
    },
  },
  // 冒泡只把最小的挪到最前、别的不动：「每趟冒一个最小的上来」记住了，忘了沿途的逆序对也在两两交换
  bubbleMin: { passes: (a) => shiftPasses(a), one: (a, v, k) => shiftMin(a, k) },
  // 选择排序每趟选最大的放到最后
  selectMax: {
    first: true,
    passes: (a) => {
      const A = a.slice(), ps = [];
      for (let i = A.length - 1; i > 0; i--) {
        let m = 0;
        for (let j = 1; j <= i; j++) if (A[j] > A[m]) m = j;
        [A[i], A[m]] = [A[m], A[i]];
        ps.push(A.slice());
      }
      return ps;
    },
  },
  // 选择排序选出最小的以后像插入那样把中间的往后挪（和 bubbleMin 做出来一样，只是错在不同的算法上）
  selectShift: { passes: (a) => shiftPasses(a), one: (a, v, k) => shiftMin(a, k) },
  // 插入排序把第 1 个元素自己也算一趟：学生的第 k 趟是正确的第 k−1 趟（第 1 趟是原样）
  insertCount: { passes: (a, ok) => [a.slice(), ...ok.passes.slice(0, -1)] },
  // 快排取最后一个作枢轴（填坑法）
  quickLast: { passes: (a) => quickPasses(a, lastPartition) },
  // 快排用交换法划分（枢轴还是第一个）
  quickSwap: { passes: (a) => quickPasses(a, swapPartition), one: (a, v) => { swapPartition(a, v.lo - 1, v.hi - 1); return a; } },
  // 归并时最后落单的一段并进前面那一组
  mergeOdd: {
    passes: (a) => {
      const A = a.slice(), ps = [];
      let segs = segsOf(A.length, 1);
      while (segs.length > 1) { segs = mergeOddPass(A, segs); ps.push(A.slice()); }
      return ps;
    },
    one: (a, v, k) => { mergeOddPass(a, segsOf(a.length, 2 ** k)); return a; },
  },
  // 基数排序从最高位开始分配（每趟照样是整个序列分配、收集）
  radixMSD: { passes: (a) => { let A = a; const ps = []; for (let k = digitsOf(a) - 1; k >= 0; k--) ps.push(A = radixPass(A, k)); return ps; } },
  // 基数排序收集时同一个队列后进先出（队列画成竖着一摞，从上往下收）
  radixLIFO: { passes: (a) => { let A = a; const ps = []; for (let k = 0; k < digitsOf(a); k++) ps.push(A = radixPass(A, k, true)); return ps; }, one: (a, v, k) => radixPass(a, k, true) },
};

function mistakeRun(input, ok) {
  const M = MISTAKES[input.mistake];
  const a = input.items.map(vOf);
  // 趟数和正确的一样多：填表的行数对不上，外壳就不拿它比了。错法提前排完的照最后的样子补上，多走的不要
  const n = ok.passes.length;
  const passes = M.passes(a, ok).slice(0, n);
  while (passes.length < n) passes.push((passes.at(-1) || a).slice());
  // 先猜：题面照抄正确的那一遍（外壳按题面找同一个问题），答案换成错法
  const steps = [{ view: { A: input.items.slice() }, msg: '' }];
  let k = 0;
  for (const s of ok.steps) {
    if (!s.ask || !PASS_ASKS.includes(s.ask.tag)) continue;
    const got = M.one ? M.one(s.view.A.map(vOf), s.view, k) : M.first && k === 0 ? passes[0] : null;
    k++;
    if (got) steps.push({ view: s.view, msg: '', ask: { ...s.ask, answer: got.join(' ') } });
  }
  return { steps, passes };
}
const PASS_ASKS = ['pass', 'partition'];

// 第 i 个到最后里最小的拿出来放到第 i 个，中间的依次往后挪一格
function shiftMin(A, i) {
  let m = i;
  for (let j = i + 1; j < A.length; j++) if (A[j] < A[m]) m = j;
  A.splice(i, 0, ...A.splice(m, 1));
  return A;
}
const shiftPasses = (a) => { const A = a.slice(), ps = []; for (let i = 0; i < A.length - 1; i++) ps.push(shiftMin(A, i).slice()); return ps; };

// 快排的划分（下标从 0 数，返回枢轴落在哪）；quickPasses 和正确的一样：先左后右递归，只剩一个的区间不划分
const quickPasses = (a, part) => {
  const A = a.slice(), ps = [];
  const sort = (lo, hi) => { if (lo >= hi) return; const p = part(A, lo, hi); ps.push(A.slice()); sort(lo, p - 1); sort(p + 1, hi); };
  sort(0, A.length - 1);
  return ps;
};
function lastPartition(A, lo, hi) {
  const pivot = A[hi];
  let l = lo, h = hi;
  while (l < h) {
    while (l < h && A[l] <= pivot) l++;
    A[h] = A[l];
    while (l < h && A[h] >= pivot) h--;
    A[l] = A[h];
  }
  A[l] = pivot;
  return l;
}
// 交换法（Hoare 式，很多教材和网上的代码这样写）：枢轴取 A[lo]，i 从 lo+1 往右找比枢轴大的、j 从 hi 往左找比枢轴小的
// （和枢轴相等的两边都跳过），找到就对换；i、j 交错后把枢轴和 A[j] 交换。
// 49 38 65 97 76 13 27 49′ 一次划分得 13 38 27 49 76 97 65 49′（王道的填坑法是 27 38 13 49 76 97 65 49′）
function swapPartition(A, lo, hi) {
  const p = A[lo];
  let i = lo + 1, j = hi;
  for (;;) {
    while (i <= j && A[i] <= p) i++;
    while (i <= j && A[j] >= p) j--;
    if (i >= j) break;
    [A[i], A[j]] = [A[j], A[i]];
  }
  [A[lo], A[j]] = [A[j], A[lo]];
  return j;
}

// 二路归并：每段长 len 切开（[起, 止)）；一趟把相邻两段归并，最后配不上对的一段并进前面那一组（错法；正确的是原样留着）
const segsOf = (n, len) => { const o = []; for (let s = 0; s < n; s += len) o.push([s, Math.min(n, s + len)]); return o; };
function mergeOddPass(A, segs) {
  const out = [];
  for (let i = 0; i < segs.length; i += 2) {
    if (i + 1 < segs.length) out.push([segs[i][0], segs[i + 1][1]]);
    else if (out.length) out[out.length - 1][1] = segs[i][1];
    else out.push(segs[i]);
  }
  for (const [s, e] of out) A.splice(s, e - s, ...A.slice(s, e).sort((x, y) => x - y));
  return out;
}

// 基数排序的一趟：按第 k 位（0 是个位）分配到 0～9 号队列再收集；lifo：同一个队列里后放进去的先收（错法）
const digitsOf = (a) => Math.max(1, ...a.map((x) => String(x).length));
function radixPass(A, k, lifo = false) {
  const B = Array.from({ length: 10 }, () => []);
  for (const x of A) B[Math.floor(x / 10 ** k) % 10].push(x);
  return B.flatMap((b) => (lifo ? b.slice().reverse() : b));
}

// —— 直接插入排序（带哨兵 A[0]）——
//   for(i=2;i<=n;i++) if(A[i]<A[i-1]){ A[0]=A[i]; for(j=i-1;A[0]<A[j];--j) A[j+1]=A[j]; A[j+1]=A[0]; }
function insertion(A) {
  const n = A.length;
  const steps = [], passes = [];
  const at = (p) => A[p - 1];
  const done = (i) => clsFor(range(1, i), 'sv-done');
  steps.push({ view: { A: A.slice(), cls: done(1), zero: { label: '哨兵', item: null } }, msg: '初始序列。A[0] 是哨兵，用来暂存要插入的元素。第 1 个元素自己就是一个有序表。' });
  for (let i = 2; i <= n; i++) {
    const pass = i - 1;
    const x = at(i), y = at(i - 1);
    const sorted = A.slice();
    // 这一趟的结果先算出来（给 ask 用）
    { const B = A.slice(0, i); const k = B.findIndex((e) => vOf(e) > vOf(x)); if (vOf(x) < vOf(y)) { B.splice(i - 1, 1); B.splice(k, 0, x); } for (let p = 0; p < i; p++) sorted[p] = B[p]; }
    steps.push({
      view: { A: A.slice(), cls: { ...done(i - 1), [i]: 'sv-cur' }, ptr: { [i]: 'i' }, zero: { label: '哨兵', item: null } },
      msg: `第 ${pass} 趟：i = ${i}，要把 A[${i}] = ${t(x)} 插进前面的有序表（第 1～${i - 1} 个）。先和前一个 A[${i - 1}] = ${t(y)} 比。`,
      ask: { tag: 'pass', kind: 'text', q: `第 ${pass} 趟（i = ${i}，插入 ${t(x)}）结束后，序列是什么？`, answer: seqOf(sorted) },
    });
    if (!(vOf(x) < vOf(y))) {
      steps.push({ view: { A: A.slice(), cls: { ...done(i), [i]: 'sv-done sv-cmp', [i - 1]: 'sv-done sv-cmp' }, ptr: { [i]: 'i' }, zero: { label: '哨兵', item: null } }, msg: `${t(x)} ≥ ${t(y)}（不小于），它已经在正确的位置上，这一趟不用动。前 ${i} 个有序了。` });
      passes.push(A.map(vOf));
      continue;
    }
    steps.push({ view: { A: A.slice(), cls: { ...done(i - 1), [i]: 'sv-cmp', [i - 1]: 'sv-done sv-cmp' }, ptr: { [i]: 'i' }, zero: { label: '哨兵', item: x, fresh: true, cls: 'sv-cur' } }, msg: `${t(x)} < ${t(y)}：把 ${t(x)} 存进哨兵 A[0]，从 j = ${i - 1} 往前找插入的位置。` });
    let j = i - 1;
    while (vOf(x) < vOf(at(j))) {
      const moved = at(j);
      A[j] = moved; // A[j+1] = A[j]
      steps.push({ view: { A: A.slice(), cls: { ...done(i), [j]: 'sv-hole', [j + 1]: 'sv-done' }, ptr: { [j]: 'j' }, zero: { label: '哨兵', item: x, cls: 'sv-cur' }, fresh: [j + 1] }, msg: `A[0] = ${t(x)} < A[${j}] = ${t(moved)}：A[${j}] 后移到 A[${j + 1}]，j 减 1。` });
      j--;
      if (j === 0) break;
    }
    A[j] = x; // A[j+1] = A[0]
    steps.push({
      view: { A: A.slice(), cls: { ...done(i), [j + 1]: 'sv-done sv-placed' }, ptr: j >= 1 ? { [j]: 'j' } : {}, zero: { label: '哨兵', item: x }, fresh: [j + 1] },
      msg: j === 0 ? `j = 0：A[0] 就是 ${t(x)} 自己，A[0] < A[0] 不成立，循环停下。把 ${t(x)} 放进 A[1]。前 ${i} 个有序了。` : `A[0] = ${t(x)} ≥ A[${j}] = ${t(at(j))}：循环停下。把 ${t(x)} 放进 A[${j + 1}]。前 ${i} 个有序了。`,
      ask: { tag: 'place', kind: 'pick', q: `${t(x)} 最后插在第几个位置？在图里点那个格子。`, answer: String(j + 1) },
    });
    passes.push(A.map(vOf));
  }
  steps.push({ view: { A: A.slice(), cls: clsFor(range(1, n), 'sv-done'), zero: { label: '哨兵', item: null } }, msg: `排序完成，一共 ${n - 1} 趟。` });
  return { steps, passes };
}

// —— 冒泡排序（王道：每趟从后往前，小的往前冒；一趟没交换就提前结束）——
//   for(i=0;i<n-1;i++){ flag=false; for(j=n-1;j>i;j--) if(A[j-1]>A[j]){ swap; flag=true; } if(!flag) return; }
function bubble(A) {
  const n = A.length;
  const steps = [], passes = [];
  steps.push({ view: { A: A.slice() }, msg: '初始序列。王道的冒泡排序：每一趟从最后往前两两比较，逆序就交换，小的一路往前冒；一趟把剩下最小的放到最前面。' });
  for (let i = 0; i < n - 1; i++) {
    const pass = i + 1;
    const doneC = clsFor(range(1, i), 'sv-done');
    const after = A.slice();
    for (let j = n - 1; j > i; j--) if (vOf(after[j - 1]) > vOf(after[j])) [after[j - 1], after[j]] = [after[j], after[j - 1]];
    steps.push({ view: { A: A.slice(), cls: doneC, lo: i + 1 }, msg: `第 ${pass} 趟：从第 ${n} 个往前比到第 ${i + 1} 个，这一趟会把第 ${i + 1}～${n} 个里最小的放到第 ${i + 1} 个。`, ask: { tag: 'pass', kind: 'text', q: `第 ${pass} 趟结束后，序列是什么？`, answer: seqOf(after) } });
    let flag = false;
    for (let j = n - 1; j > i; j--) {
      const a = A[j - 1], b = A[j];
      const swap = vOf(a) > vOf(b);
      if (swap) { [A[j - 1], A[j]] = [b, a]; flag = true; }
      steps.push({
        view: { A: A.slice(), cls: clsFor([j, j + 1], swap ? 'sv-swap' : 'sv-cmp', doneC), ptr: { [j + 1]: 'j' }, lo: i + 1, fresh: swap ? [j, j + 1] : [] },
        msg: swap ? `第 ${j} 个 ${t(a)} > 第 ${j + 1} 个 ${t(b)}：逆序，交换。` : `第 ${j} 个 ${t(a)} ≤ 第 ${j + 1} 个 ${t(b)}：不交换${vOf(a) === vOf(b) ? '（相等不交换，所以冒泡是稳定的）' : ''}。`,
        ask: { tag: 'swap', kind: 'choice', q: `第 ${j} 个（${t(a)}）和第 ${j + 1} 个（${t(b)}）要交换吗？`, choices: ['交换', '不交换'], answer: swap ? '交换' : '不交换' },
      });
    }
    passes.push(A.map(vOf));
    steps.push({ view: { A: A.slice(), cls: clsFor(range(1, i + 1), 'sv-done') }, msg: flag ? `第 ${pass} 趟结束：${t(A[i])} 到了第 ${i + 1} 个。` : `第 ${pass} 趟一次都没有交换：剩下的已经有序，排序提前结束（flag = false）。` });
    if (!flag) break;
  }
  steps.push({ view: { A: A.slice(), cls: clsFor(range(1, n), 'sv-done') }, msg: `排序完成，一共 ${passes.length} 趟。` });
  return { steps, passes };
}

// —— 简单选择排序 ——
//   for(i=0;i<n-1;i++){ min=i; for(j=i+1;j<n;j++) if(A[j]<A[min]) min=j; if(min!=i) swap(A[i],A[min]); }
function selection(A) {
  const n = A.length;
  const steps = [], passes = [];
  steps.push({ view: { A: A.slice() }, msg: '初始序列。简单选择排序：第 i 趟在第 i～n 个里选出最小的，和第 i 个交换。' });
  for (let i = 0; i < n - 1; i++) {
    const pass = i + 1;
    const doneC = clsFor(range(1, i), 'sv-done');
    let m = i;
    for (let j = i + 1; j < n; j++) if (vOf(A[j]) < vOf(A[m])) m = j;
    const after = A.slice();
    [after[i], after[m]] = [after[m], after[i]];
    const trueMin = m;
    steps.push({ view: { A: A.slice(), cls: { ...doneC, [i + 1]: 'sv-cur' }, ptr: { [i + 1]: 'min' }, lo: i + 1 }, msg: `第 ${pass} 趟：在第 ${i + 1}～${n} 个里找最小的。先假设最小的是第 ${i + 1} 个（${t(A[i])}）。`, ask: { tag: 'pass', kind: 'text', q: `第 ${pass} 趟结束后，序列是什么？`, answer: seqOf(after) } });
    m = i;
    for (let j = i + 1; j < n; j++) {
      const less = vOf(A[j]) < vOf(A[m]);
      const old = m;
      if (less) m = j;
      steps.push({
        view: { A: A.slice(), cls: { ...doneC, [m + 1]: 'sv-cur', [j + 1]: less ? 'sv-cur sv-cmp' : 'sv-cmp' }, ptr: j === m ? { [j + 1]: 'j,min' } : { [j + 1]: 'j', [m + 1]: 'min' }, lo: i + 1 },
        msg: less ? `${t(A[j])} < ${t(A[old])}：最小的换成第 ${j + 1} 个。` : `${t(A[j])} 不比 ${t(A[m])} 小，最小的还是第 ${m + 1} 个。`,
        ask: j === i + 1 ? { tag: 'min', kind: 'pick', q: `这一趟找到的最小值在第几个？在图里点出来。`, answer: String(trueMin + 1) } : undefined,
      });
    }
    const swapped = m !== i;
    if (swapped) [A[i], A[m]] = [A[m], A[i]];
    passes.push(A.map(vOf));
    steps.push({ view: { A: A.slice(), cls: clsFor(range(1, i + 1), 'sv-done', swapped ? { [m + 1]: 'sv-swap' } : {}), fresh: swapped ? [i + 1, m + 1] : [], lo: i + 1 }, msg: swapped ? `把最小的 ${t(A[i])} 和第 ${i + 1} 个交换（换到第 ${m + 1} 个的是 ${t(A[m])}）。第 ${pass} 趟结束。` : `最小的就是第 ${i + 1} 个，不用交换。第 ${pass} 趟结束。` });
  }
  steps.push({ view: { A: A.slice(), cls: clsFor(range(1, n), 'sv-done') }, msg: `排序完成，一共 ${n - 1} 趟。` });
  return { steps, passes };
}

// —— 快速排序（王道的 Partition：枢轴取 A[low]，high、low 轮流往中间走、填坑）——
function quick(A) {
  const n = A.length;
  const steps = [], passes = [];
  const fixed = new Set(); // 已经到最终位置的
  const fixedC = () => clsFor([...fixed], 'sv-done');
  steps.push({ view: { A: A.slice(), zero: { label: '枢轴', item: null } }, msg: '初始序列。王道的快速排序：每次划分取区间第一个元素作枢轴，high 从右往左找比它小的、low 从左往右找比它大的，轮流填坑，最后枢轴落到最终位置。' });
  let count = 0;
  const part = (lo, hi) => {
    // 位置从 1 数：lo、hi
    const pc = ++count;
    const pivot = A[lo - 1];
    const sim = A.slice();
    let finalPos;
    { let l = lo, h = hi; while (l < h) { while (l < h && vOf(sim[h - 1]) >= vOf(pivot)) h--; sim[l - 1] = sim[h - 1]; while (l < h && vOf(sim[l - 1]) <= vOf(pivot)) l++; sim[h - 1] = sim[l - 1]; } sim[l - 1] = pivot; finalPos = l; }
    const view = (extra = {}) => ({ A: A.slice(), zero: { label: '枢轴', item: pivot, cls: 'sv-pivot' }, lo, hi, ...extra, cls: { ...fixedC(), ...(extra.cls || {}) } });
    steps.push({ view: view({ cls: { [lo]: 'sv-hole' }, ptr: lo === hi ? { [lo]: 'low,high' } : { [lo]: 'low', [hi]: 'high' }, zero: { label: '枢轴', item: pivot, cls: 'sv-pivot', fresh: true } }), msg: `第 ${pc} 次划分：区间第 ${lo}～${hi} 个。枢轴 pivot = A[low] = ${t(pivot)}，先拿出来，第 ${lo} 个空出一个坑。`, ask: { tag: 'partition', kind: 'text', q: `这一次划分（区间第 ${lo}～${hi} 个，枢轴 ${t(pivot)}）结束后，整个序列是什么？`, answer: seqOf(sim) } });
    let l = lo, h = hi;
    while (l < h) {
      const h0 = h;
      while (l < h && vOf(A[h - 1]) >= vOf(pivot)) h--;
      const skipped = range(h + 1, h0).map((p) => t(A[p - 1]));
      if (l < h) {
        A[l - 1] = A[h - 1];
        steps.push({ view: view({ cls: { [h]: 'sv-hole', [l]: 'sv-cmp' }, ptr: { [l]: 'low', [h]: 'high' }, fresh: [l] }), msg: `high 从第 ${h0} 个往左找比 ${t(pivot)} 小的${skipped.length ? `（跳过 ${skipped.join('、')}，都 ≥ ${t(pivot)}）` : ''}：停在第 ${h} 个（${t(A[l - 1])}），把它填进第 ${l} 个的坑，第 ${h} 个成了新坑。` });
      } else {
        steps.push({ view: view({ cls: { [h]: 'sv-hole' }, ptr: { [l]: 'low,high' } }), msg: `high 从第 ${h0} 个往左走${skipped.length ? `（${skipped.join('、')} 都 ≥ ${t(pivot)}）` : ''}，一直走到和 low 相遇（第 ${h} 个）。` });
        break;
      }
      const l0 = l;
      while (l < h && vOf(A[l - 1]) <= vOf(pivot)) l++;
      const passed = range(l0, l - 1).filter((p) => p !== l0).map((p) => t(A[p - 1]));
      if (l < h) {
        A[h - 1] = A[l - 1];
        steps.push({ view: view({ cls: { [l]: 'sv-hole', [h]: 'sv-cmp' }, ptr: { [l]: 'low', [h]: 'high' }, fresh: [h] }), msg: `low 从第 ${l0} 个往右找比 ${t(pivot)} 大的${passed.length ? `（跳过 ${passed.join('、')}，都 ≤ ${t(pivot)}）` : ''}：停在第 ${l} 个（${t(A[h - 1])}），把它填进第 ${h} 个的坑，第 ${l} 个成了新坑。` });
      } else {
        steps.push({ view: view({ cls: { [l]: 'sv-hole' }, ptr: { [l]: 'low,high' } }), msg: `low 从第 ${l0} 个往右走${passed.length ? `（${passed.join('、')} 都 ≤ ${t(pivot)}）` : ''}，一直走到和 high 相遇（第 ${l} 个）。` });
      }
    }
    A[l - 1] = pivot;
    fixed.add(l);
    passes.push(A.map(vOf));
    steps.push({
      view: { A: A.slice(), zero: { label: '枢轴', item: null }, lo, hi, cls: { ...fixedC(), [l]: 'sv-done sv-placed' }, fresh: [l] },
      msg: `low = high = ${l}：把枢轴 ${t(pivot)} 放进第 ${l} 个，它到了最终位置。左边（第 ${lo}～${l - 1} 个）都 ≤ ${t(pivot)}，右边（第 ${l + 1}～${hi} 个）都 ≥ ${t(pivot)}。`,
      ask: { tag: 'pivot', kind: 'pick', q: `枢轴 ${t(pivot)} 最后落在第几个位置？在图里点出来。`, answer: String(finalPos) },
    });
    return l;
  };
  const sort = (lo, hi) => {
    if (lo > hi) return;
    if (lo === hi) { fixed.add(lo); return; }
    const p = part(lo, hi);
    sort(lo, p - 1);
    sort(p + 1, hi);
  };
  sort(1, n);
  steps.push({ view: { A: A.slice(), cls: clsFor(range(1, n), 'sv-done'), zero: { label: '枢轴', item: null } }, msg: `排序完成，一共划分了 ${count} 次（只剩一个元素的区间不用划分）。` });
  return { steps, passes };
}

// —— 二路归并排序（按趟：每段长 1、2、4……相邻两段归并）——
function merge(A) {
  const n = A.length;
  const steps = [], passes = [];
  const runs = (len) => { const o = {}; for (let p = 1; p <= n; p++) o[p] = Math.floor((p - 1) / len) % 2 ? 'sv-g2' : 'sv-g1'; return o; };
  steps.push({ view: { A: A.slice(), cls: runs(1) }, msg: '初始序列。二路归并排序：一开始每个元素自己是一段有序段；每一趟把相邻两段归并成一段，段长翻倍。' });
  let pass = 0;
  for (let len = 1; len < n; len *= 2) {
    pass++;
    const after = A.slice();
    for (let s = 0; s < n; s += 2 * len) { const seg = after.slice(s, Math.min(n, s + 2 * len)).sort((a, b) => vOf(a) - vOf(b)); after.splice(s, seg.length, ...seg); }
    // 稳定：上面用的 sort 在 V8 / JSC 里是稳定的；归并本身也稳定
    steps.push({ view: { A: A.slice(), cls: runs(len) }, msg: `第 ${pass} 趟：现在每段长 ${len}（同色是一段），相邻两段归并成长 ${2 * len} 的一段。`, ask: { tag: 'pass', kind: 'text', q: `第 ${pass} 趟归并结束后，序列是什么？`, answer: seqOf(after) } });
    for (let s = 0; s < n; s += 2 * len) {
      const a1 = s + 1, a2 = Math.min(n, s + len), b1 = s + len + 1, b2 = Math.min(n, s + 2 * len);
      if (b1 > n) {
        steps.push({ view: { A: A.slice(), cls: { ...runs(2 * len), ...clsFor(range(a1, a2), 'sv-cmp') } }, msg: `最后剩下的一段（第 ${a1}～${a2} 个）没有可以配对的，原样留到下一趟。` });
        continue;
      }
      const left = A.slice(a1 - 1, a2).map(t), right = A.slice(b1 - 1, b2).map(t);
      // 稳定的二路归并：相等时先取左边的
      const L = A.slice(a1 - 1, a2), R = A.slice(b1 - 1, b2), out = [];
      let x = 0, y = 0;
      while (x < L.length && y < R.length) out.push(vOf(L[x]) <= vOf(R[y]) ? L[x++] : R[y++]);
      while (x < L.length) out.push(L[x++]);
      while (y < R.length) out.push(R[y++]);
      A.splice(a1 - 1, out.length, ...out);
      steps.push({ view: { A: A.slice(), cls: { ...runs(2 * len), ...clsFor(range(a1, b2), 'sv-cmp') }, fresh: range(a1, b2) }, msg: `把（${left.join(', ')}）和（${right.join(', ')}）归并：两段各从头比，小的先放（相等先放左边的），得到（${A.slice(a1 - 1, b2).map(t).join(', ')}）。` });
    }
    passes.push(A.map(vOf));
    steps.push({ view: { A: A.slice(), cls: runs(Math.min(2 * len, n)) }, msg: `第 ${pass} 趟结束：现在每段长 ${Math.min(2 * len, n)}${2 * len >= n ? '，整个序列就是一段，排序完成' : ''}。` });
  }
  steps.push({ view: { A: A.slice(), cls: clsFor(range(1, n), 'sv-done') }, msg: `排序完成，一共 ${pass} 趟（⌈log₂${n}⌉ = ${pass}）。` });
  return { steps, passes };
}

// —— 基数排序（最低位优先 LSD，十进制，每一趟分配到 0～9 号队列再收集）——
const DIGIT = ['个位', '十位', '百位', '千位', '万位'];
function radix(A) {
  const n = A.length;
  const steps = [], passes = [];
  const d = Math.max(1, ...A.map((x) => String(vOf(x)).length));
  steps.push({ view: { A: A.slice() }, msg: `初始序列。基数排序（最低位优先）：最大的数有 ${d} 位，做 ${d} 趟，依次按${DIGIT.slice(0, d).join('、')}分配、收集。` });
  for (let k = 0; k < d; k++) {
    const name = DIGIT[k] || `第 ${k + 1} 位`;
    const dig = (x) => Math.floor(vOf(x) / 10 ** k) % 10;
    const buckets = Array.from({ length: 10 }, () => []);
    for (const x of A) buckets[dig(x)].push(x);
    const after = buckets.flat();
    steps.push({ view: { A: A.slice(), digit: k }, msg: `第 ${k + 1} 趟：按${name}分配。`, ask: { tag: 'pass', kind: 'text', q: `第 ${k + 1} 趟（按${name}）收集之后，序列是什么？`, answer: seqOf(after) } });
    steps.push({ view: { A: A.slice(), digit: k, buckets: buckets.map((b) => b.slice()) }, msg: `从前往后，把每个数放进它${name}对应的队列（${buckets.map((b, i) => (b.length ? `${i} 号：${b.map(t).join(' ')}` : '')).filter(Boolean).join('；')}）。同一个队列里先进先出，保持原来的先后。` });
    A.splice(0, n, ...after);
    passes.push(A.map(vOf));
    steps.push({ view: { A: A.slice(), digit: k, fresh: range(1, n) }, msg: `从 0 号队列到 9 号队列依次收集，得到第 ${k + 1} 趟的结果。` });
  }
  steps.push({ view: { A: A.slice(), cls: clsFor(range(1, n), 'sv-done') }, msg: `排序完成，一共 ${d} 趟。` });
  return { steps, passes };
}

export function view(s, input) {
  let h = arrayView(s.A, { cls: s.cls, ptr: s.ptr, zero: s.zero, lo: s.lo ?? null, hi: s.hi ?? null, fresh: s.fresh, keys: true });
  if (s.digit !== undefined && !s.buckets) {
    // 基数排序：数下面标出这一趟看的那一位
    h += `<div class="sv-digits" style="--cols:${s.A.length}">${s.A.map((x) => { const str = String(x.v); const k = str.length - 1 - s.digit; return `<div>${k >= 0 ? `${esc(str.slice(0, k))}<b>${esc(str[k])}</b>${esc(str.slice(k + 1))}` : `<b>0</b>${esc(str)}`}</div>`; }).join('')}</div>`;
  }
  if (s.buckets) {
    h += `<div class="sv-buckets">${s.buckets.map((b, i) => `<div class="sv-bucket${b.length ? '' : ' sv-empty'}"><span class="sv-bucket-n">${i}</span>${b.map((x) => `<span class="sv-bucket-x">${esc(itemText(x))}</span>`).join('')}</div>`).join('')}</div>`;
  }
  return h;
}

export function quiz(input, r) {
  const k = Math.min(input.pass, r.passes.length);
  const unit = input.algo === 'quick' ? `第 ${k} 次划分` : `第 ${k} 趟`;
  return {
    q: `对上面的序列做${ALGOS[input.algo]}（升序${input.algo === 'quick' ? '，王道的划分方法：枢轴取区间第一个' : ''}），写出${unit}结束后的序列。`,
    qhtml: arrayView(input.items, { pick: false }),
    type: 'seq',
    answer: r.passes[k - 1].join(' '),
  };
}

export function problems(input, r) {
  const v = input.items.map(vOf);
  const out = [];
  if (v.every((x, i) => i === 0 || v[i - 1] <= x)) out.push('array: 已经是升序的，演示里几乎看不到元素怎么动，换一组乱一点的数');
  if (input.pass > r.passes.length) out.push(`pass: ${input.pass} 超过了实际的趟数（${r.passes.length} 趟），按最后一趟出题`);
  return out;
}

// 考卷上那张表：每一趟（快排是每一次划分）结束后的整个序列
export function table(input, r) {
  const unit = input.algo === 'quick' ? '次划分' : '趟';
  return {
    q: `对上面的序列做${ALGOS[input.algo]}（升序${input.algo === 'quick' ? '，王道的划分方法：枢轴取区间第一个' : input.algo === 'bubble' ? '，王道的冒泡：每趟从后往前，小的往前冒' : ''}），写出每一${unit}结束后的序列。`,
    qhtml: arrayView(input.items, { pick: false }),
    dir: 'row',
    head: input.items.map((_, i) => `${i + 1}`),
    rows: r.passes.map((p, k) => ({ label: `第 ${k + 1} ${unit}`, cells: p.map((v) => ({ v: [String(v), `${v}′`, `${v}'`] })) })),
  };
}

// 常见错法（只给老师看）。先后有用：同一个答案两种错法都对得上时，说前面那种
const VARIANTS = {
  insert: [
    ['insertCount', '像是把第 1 个元素自己也算成了一趟，写的第 k 趟其实是第 k−1 趟（王道：第 1 个元素自己就是有序表，第 1 趟是插入第 2 个，一共 n−1 趟）'],
  ],
  bubble: [
    ['bubbleFront', '像是从前往后冒泡、大的往后沉了（王道的冒泡：每趟从后往前两两比较，小的往前冒）'],
    ['bubbleMin', '像是每趟只把最小的那个挪到了最前面，别的照原样往后排（王道的冒泡：从后往前两两比较、逆序就交换，路上别的逆序对也会被换掉）'],
  ],
  select: [
    ['selectMax', '像是每趟选最大的放到最后了（王道的简单选择排序：每趟选最小的，和第 i 个交换）'],
    ['selectShift', '像是选出最小的以后把前面的元素依次往后挪了一格（王道的简单选择排序：最小的直接和第 i 个交换，被换走的那个跳到最小的原来的位置）'],
  ],
  quick: [
    ['quickSwap', '像是用交换法划分的：左边找到比枢轴大的、右边找到比枢轴小的就对换，最后枢轴和相遇处交换（王道的划分是填坑：枢轴先拿出来，high、low 轮流把数填进对面的坑）'],
    ['quickLast', '像是取了区间最后一个当枢轴（王道：枢轴取区间第一个 A[low]）'],
  ],
  merge: [
    ['mergeOdd', '像是把最后落单的那一段并进了前面一组一起归并（王道：配不上对的最后一段原样留到下一趟）'],
  ],
  radix: [
    ['radixMSD', '像是从最高位开始分配了（王道的基数排序是最低位优先：第 1 趟按个位，再按十位、百位……）'],
    ['radixLIFO', '像是同一个队列里后放进去的先收集了（王道：每个队列先进先出，按放进去的先后收集，基数排序才稳定）'],
  ],
};

// 这组数上做出来和正确的（或者前面一种错法）每一趟都一样的错法不列：认不出来，列了只会说错
export function variants(input) {
  const sig = (r) => r.passes.map((p) => p.join(' ')).join(' / ');
  const seen = new Set([sig(run(input))]);
  const out = [];
  for (const [mistake, label] of VARIANTS[input.algo] || []) {
    const v = { ...input, mistake };
    const s = sig(run(v));
    if (seen.has(s)) continue;
    seen.add(s);
    out.push({ label, input: v });
  }
  return out;
}

export const sortEngine = { name: 'sort', title: '排序演示', parse, run, view, quiz, problems, table, variants };

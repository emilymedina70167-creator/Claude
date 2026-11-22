// 引擎跑完以后的量（纯函数，不碰 DOM；tests/engines-measures.test.js）。
// 二类检验（check/）的 construct、predict、trace 要在条件和答案里用「这组输入跑出来的数」：缺页几次、比较几次、第 2 趟是什么、
// 稳不稳定……引擎本身只管演示，不一定交出这些数（排序不数比较），所以这里按字段跑一遍引擎，再从结果里取，取不到的另数。
//
// 几条口径：
//   - 排序的比较、移动照王道的代码另数一遍（只数，不演示），要和教材的公式对得上：
//     直接插入、希尔里 if (A[i] < A[i-dk]) 和循环第一次 A[0] < A[j] 是同一对关键字，算一次；哨兵 A[0] 让循环停下的那次照算；
//     j > 0、low < high 这种下标的比较不算；移动是元素的每一次赋值（进出 A[0] 也算；一次交换算 3 次）。
//     另数的每一趟要和引擎画的一样（测试拿随机数组对），对不上说明另数的不是引擎演示的那个算法。
//     快排的比较照教材「一趟划分比较 n−1 次」：m 个元素的区间比 m−1 次（不照字面数填坑代码，见 COUNTERS.quick）。
//   - 归并每执行一次 B[i] <= B[j] 算一次（不交移动）；趟照引擎：段长 1、2、4……自底向上，落单的一段不比。
//   - 堆向下调整：有两个孩子的一层比 2 次、只有一个孩子的一层比 1 次；向上调整一层 1 次。另交每个操作各自的（cmp1、cmp2……）。
//   - 并列：靠「两个一样好」定下来的量写进 ties（OPT 换页时以后都不再用的页有两页以上 → victims；SSTF 两个请求离磁头一样远 → order，
//     走法不同距离也不同时还有 dist、avg）。用到这些量的题页面判不了，交外部核。
//   - 学生写的数组里有一样的数（49 38 49），跑排序之前把后出现的记成 49′（markDuplicates），稳定性才看得出来。
import { ENGINES } from './registry.js';
import { parseFields } from '../parse.js';
import { defaultGaps } from '../sorting.js';
import { itemText } from './arrayview.js';

/** 每个引擎交出的量。`pass#` 是 pass1…passN，`cmp#` 是第几个操作的比较次数（堆） */
export const MEASURES = {
  // 快排另有 rounds / round#：真题说的「趟」（一层划分做完，2019 年第 10 题的定义）；pass# 是第几次划分以后
  sort: ['passes', 'pass#', 'rounds', 'round#', 'final', 'cmp', 'move', 'swap', 'unstable', 'flipped'],
  // 二叉排序树（bst:）：height leaves aslSucc；堆（heap:）：cmp cmp# swaps final pass#
  tree: ['height', 'leaves', 'aslSucc', 'cmp', 'cmp#', 'swaps', 'final', 'pass#'],
  // rot：调整几次（LR 算 1 次）；turns：单旋几次（LL、RR 1 次，LR、RL 2 次）
  avl: ['rot', 'turns', 'LL', 'RR', 'LR', 'RL', 'root'],
  paging: ['faults', 'hits', 'rate', 'victims'],
  sched: ['avgTurn', 'avgWait', 'avgWeighted', 'order'],
  disk: ['dist', 'avg', 'order'],
  hash: ['aslSucc', 'aslFail', 'clashes'],
};

const fieldsOf = (f) => (typeof f === 'string' ? parseFields(f).fields : { ...(f || {}) });
const numOr = (s) => (typeof s === 'string' && /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s);

/** 按字段跑一遍引擎：{ input, run }。不认识的引擎、读不懂的字段照抛引擎的原话（学生造的输入不收时，判没过就写这句） */
export function runEngine(name, fields) {
  const engine = ENGINES[name];
  if (!engine) throw new Error(`不认识的引擎「${name}」`);
  const input = engine.parse(fieldsOf(fields), '');
  return { input, run: engine.run(input) };
}

// —— 相同的数 ——

const MARKS = /['’′_]/g;
const TOKEN = /(-?\d+(?:\.\d+)?)(['’′_]*)/g;
const ORD = ['', '第一个', '第二个', '第三个', '第四个', '第五个', '第六个', '第七个', '第八个', '第九个', '第十个'];

/**
 * 一样的数后出现的记成 49′、49′′……（' ’ ′ 都认，统一写成 ′）。学生自己标了的照学生的（49' 49 → 49′ 49）。
 * changed：页面自己给哪个数加了撇号（只是把 ' 换成 ′ 不算），作答下面要说一声。notes：说的那几句
 */
export function markDuplicates(text) {
  const src = String(text ?? '');
  const len = (marks) => marks.replace(MARKS, '_').length;
  // 学生自己标了的撇号数先占上，页面补的时候避开
  const used = new Map();
  const of = (v) => { if (!used.has(v)) used.set(v, new Set()); return used.get(v); };
  // 按数值认一样的（49 和 49.0 是同一个数）
  for (const m of src.matchAll(TOKEN)) if (len(m[2])) of(Number(m[1])).add(len(m[2]));
  const seen = new Map(); // 值 → 这一个是第几次出现
  const plain = new Set(); // 已经有一个不带撇号的值
  const notes = [];
  const out = src.replace(TOKEN, (all, v, marks) => {
    const key = Number(v);
    const nth = (seen.get(key) || 0) + 1;
    seen.set(key, nth);
    let k = len(marks);
    if (!k) {
      if (!plain.has(key)) plain.add(key);
      else {
        const set = of(key);
        k = 1;
        while (set.has(k)) k++;
        set.add(k);
        notes.push(`${ORD[nth] || `第 ${nth} 个`} ${v} 记成 ${v}${'′'.repeat(k)}`);
      }
    }
    return `${v}${'′'.repeat(k)}`;
  });
  return { text: out, changed: notes.length > 0, notes };
}

// —— 排序：照王道代码另数 ——

/**
 * 王道的排序代码只数不演示：{ cmp, move, swap, passes }（passes 是每一趟（快排是每一次划分）之后的序列，和引擎的 run.passes 一样）。
 * 归并、快排不交 move；只有冒泡、简单选择交 swap（别的是 0）。基数排序不数比较。
 */
export function wangdaoSort(algo, values, { gaps } = {}) {
  const a = values.map(Number);
  const f = COUNTERS[algo];
  if (!f) throw new Error(`${algo} 不数比较次数`);
  return f(a, algo === 'shell' ? gaps || defaultGaps(a.length) : undefined);
}

const COUNTERS = {
  // for(i=2;i<=n;i++) if(A[i]<A[i-1]){ A[0]=A[i]; for(j=i-1;A[0]<A[j];--j) A[j+1]=A[j]; A[j+1]=A[0]; }
  insert(a) {
    const A = [null, ...a], n = a.length, passes = [];
    let cmp = 0, move = 0;
    for (let i = 2; i <= n; i++) {
      cmp++; // A[i] < A[i-1]，也是循环第一次的 A[0] < A[j]
      if (A[i] < A[i - 1]) {
        A[0] = A[i]; move++;
        let j = i - 1;
        A[j + 1] = A[j]; move++; j--;
        for (;;) { cmp++; if (!(A[0] < A[j])) break; A[j + 1] = A[j]; move++; j--; } // j = 0 时是和哨兵自己比，照算
        A[j + 1] = A[0]; move++;
      }
      passes.push(A.slice(1));
    }
    return { cmp, move, swap: 0, passes };
  },
  // for(d=…) for(i=d+1;i<=n;++i) if(A[i]<A[i-d]){ A[0]=A[i]; for(j=i-d;j>0&&A[0]<A[j];j-=d) A[j+d]=A[j]; A[j+d]=A[0]; }
  shell(a, gaps) {
    const A = [null, ...a], n = a.length, passes = [];
    let cmp = 0, move = 0;
    for (const d of gaps) {
      for (let i = d + 1; i <= n; i++) {
        cmp++;
        if (A[i] < A[i - d]) {
          A[0] = A[i]; move++;
          let j = i - d;
          A[j + d] = A[j]; move++; j -= d;
          while (j > 0) { cmp++; if (!(A[0] < A[j])) break; A[j + d] = A[j]; move++; j -= d; } // j > 0 不算比较
          A[j + d] = A[0]; move++;
        }
      }
      passes.push(A.slice(1));
    }
    return { cmp, move, swap: 0, passes };
  },
  // for(i=0;i<n-1;i++){ flag=false; for(j=n-1;j>i;j--) if(A[j-1]>A[j]){ swap; flag=true; } if(!flag) return; }
  bubble(a) {
    const A = a.slice(), n = A.length, passes = [];
    let cmp = 0, swap = 0;
    for (let i = 0; i < n - 1; i++) {
      let flag = false;
      for (let j = n - 1; j > i; j--) { cmp++; if (A[j - 1] > A[j]) { [A[j - 1], A[j]] = [A[j], A[j - 1]]; swap++; flag = true; } }
      passes.push(A.slice());
      if (!flag) break;
    }
    return { cmp, move: 3 * swap, swap, passes };
  },
  // for(i=0;i<n-1;i++){ min=i; for(j=i+1;j<n;j++) if(A[j]<A[min]) min=j; if(min!=i) swap(A[i],A[min]); }
  select(a) {
    const A = a.slice(), n = A.length, passes = [];
    let cmp = 0, swap = 0;
    for (let i = 0; i < n - 1; i++) {
      let m = i;
      for (let j = i + 1; j < n; j++) { cmp++; if (A[j] < A[m]) m = j; }
      if (m !== i) { [A[i], A[m]] = [A[m], A[i]]; swap++; }
      passes.push(A.slice());
    }
    return { cmp, move: 3 * swap, swap, passes };
  },
  // Partition：pivot=A[low]; while(low<high){ while(low<high&&A[high]>=pivot) --high; A[low]=A[high]; while(low<high&&A[low]<=pivot) ++low; A[high]=A[low]; } A[low]=pivot
  // 比较次数照教材「一趟划分比较 n−1 次」：区间里除了枢轴，每个元素和枢轴比一次，m 个元素的区间比 m−1 次。
  // 不照字面数代码：填坑以后刚挪过去的那个元素在另一头会再和枢轴比一次（[2 1] 字面是 2 次），学生和考题的答案都不这样算。
  // 有序时两种数法一样（n(n−1)/2）。序列照代码走，每一趟要和引擎的一样
  quick(a) {
    const A = a.slice(), passes = [];
    let cmp = 0;
    const part = (lo, hi) => {
      cmp += hi - lo;
      const pivot = A[lo];
      while (lo < hi) {
        while (lo < hi && A[hi] >= pivot) hi--;
        A[lo] = A[hi];
        while (lo < hi && A[lo] <= pivot) lo++;
        A[hi] = A[lo];
      }
      A[lo] = pivot;
      return lo;
    };
    const sort = (lo, hi) => { if (lo < hi) { const p = part(lo, hi); passes.push(A.slice()); sort(lo, p - 1); sort(p + 1, hi); } };
    sort(0, A.length - 1);
    return { cmp, move: undefined, swap: 0, passes };
  },
  // 引擎的归并是一趟一趟（段长 1、2、4……）自底向上的；每一对相邻的段照王道的 Merge 并：B[i] <= B[j] 每执行一次算一次
  merge(a) {
    const A = a.slice(), n = A.length, passes = [];
    let cmp = 0;
    for (let len = 1; len < n; len *= 2) {
      for (let s = 0; s + len < n; s += 2 * len) {
        const mid = s + len - 1, high = Math.min(n - 1, s + 2 * len - 1);
        const B = A.slice();
        let i = s, j = mid + 1, k = s;
        for (; i <= mid && j <= high; k++) { cmp++; A[k] = B[i] <= B[j] ? B[i++] : B[j++]; }
        while (i <= mid) A[k++] = B[i++];
        while (j <= high) A[k++] = B[j++];
      }
      passes.push(A.slice());
    }
    return { cmp, move: undefined, swap: 0, passes };
  },
};

/**
 * 第 k 趟（从 1 数）作用在任意一行 arr 上（学生自己写的上一趟）：trace 判「后面按你自己的上一行推都对」用。
 * 只有每一趟只依赖上一趟序列的才有：insert / shell / bubble / select。shell 没给 gaps 照 n/2 减半（n 默认是 arr 的长度）
 */
export function sortPass(algo, arr, k, { gaps, n } = {}) {
  const A = arr.map(Number);
  const len = A.length;
  if (algo === 'insert') {
    const i = k; // 0 起的下标：插入第 k+1 个
    if (i >= len) return A;
    const x = A[i];
    let j = i - 1;
    while (j >= 0 && x < A[j]) { A[j + 1] = A[j]; j--; }
    A[j + 1] = x;
    return A;
  }
  if (algo === 'shell') {
    const d = (gaps || defaultGaps(n ?? len))[k - 1];
    if (!d) return A;
    for (let i = d; i < len; i++) {
      const x = A[i];
      let j = i - d;
      while (j >= 0 && x < A[j]) { A[j + d] = A[j]; j -= d; }
      A[j + d] = x;
    }
    return A;
  }
  if (algo === 'bubble') {
    const i = k - 1;
    for (let j = len - 1; j > i; j--) if (A[j - 1] > A[j]) [A[j - 1], A[j]] = [A[j], A[j - 1]];
    return A;
  }
  if (algo === 'select') {
    const i = k - 1;
    if (i >= len - 1) return A;
    let m = i;
    for (let j = i + 1; j < len; j++) if (A[j] < A[m]) m = j;
    [A[i], A[m]] = [A[m], A[i]];
    return A;
  }
  throw new Error(`${algo} 的每一趟不只看上一趟的序列`);
}

// —— 堆：照引擎的建堆、插入、删除、堆排序另数比较 ——

function heapCount({ items, max, ops }) {
  const A = [null, ...items.map((x) => x.v)];
  let len = items.length, swaps = 0, cmp = 0;
  const better = (a, b) => (max ? a > b : a < b);
  const per = [];
  const down = (k) => {
    for (;;) {
      let c = 2 * k;
      if (c > len) return;
      if (c + 1 <= len) { cmp++; if (better(A[c + 1], A[c])) c++; } // 两个孩子先比一次
      cmp++; // 较「大」的孩子和双亲比
      if (!better(A[c], A[k])) return;
      [A[k], A[c]] = [A[c], A[k]]; swaps++;
      k = c;
    }
  };
  const up = (k) => {
    while (k > 1) {
      const p = k >> 1;
      cmp++;
      if (!better(A[k], A[p])) return;
      [A[k], A[p]] = [A[p], A[k]]; swaps++;
      k = p;
    }
  };
  for (const o of ops) {
    const before = cmp;
    if (o.op === 'build') for (let i = len >> 1; i >= 1; i--) down(i);
    else if (o.op === 'insert') { A[++len] = Number(o.arg); up(len); }
    else if (o.op === 'delete') { A[1] = A[len]; A.length = len; len--; if (len >= 1) down(1); }
    else if (o.op === 'sort') {
      const n0 = len;
      while (len > 1) { [A[1], A[len]] = [A[len], A[1]]; len--; down(1); }
      len = n0;
    }
    per.push(cmp - before);
  }
  return { cmp, per, swaps, final: A.slice(1, len + 1) };
}

// —— 树 ——

function treeShape(t) {
  let height = 0, leaves = 0, depthSum = 0, n = 0;
  const walk = (id, d) => {
    if (id === null || id === undefined) return;
    const x = t.nodes[id];
    n++; depthSum += d; height = Math.max(height, d);
    if (x.left === null && x.right === null) leaves++;
    walk(x.left, d + 1); walk(x.right, d + 1);
  };
  walk(t.root, 1);
  return { height, leaves, aslSucc: n ? depthSum / n : 0 };
}

// —— 每个引擎从 { input, run } 里取量：{ values, ties, tieAt } ——

// 排完、每一趟以后的序列带上撇号（dr-final-fix 第 3 条）：有撇号的元素写成 '5′'（字），别的照旧是数；一个撇号也没有的整串照旧全是数。
// 引擎每个元素有 id（和 flipped 一样），所以 5′ 跑到 5 前面看得出来；比的规矩在 check/values.js 的 seqMatch：
// 学生一个撇号都没写只比数，写了撇号连位置一起比。items：这一趟的元素（sort.js 的 snap 挂上的；错法那一遍没有，只有值）
function markedSeq(vals, items = vals.items) {
  if (!items || !items.some((x) => x?.mark)) return vals.slice();
  return items.map((x) => (x.mark ? itemText(x) : x.v));
}
const passVals = (passes, values, conv = (x) => x) => { (passes || []).forEach((p, k) => { values[`pass${k + 1}`] = p.map(conv); }); };

const MEASURERS = {
  sort(input, run) {
    const values = { passes: run.passes.length };
    run.passes.forEach((p, k) => { values[`pass${k + 1}`] = markedSeq(p); });
    if (run.rounds) {
      values.rounds = run.rounds.length;
      run.rounds.forEach((p, k) => { values[`round${k + 1}`] = markedSeq(p); });
    }
    if (input.mistake) {
      // 错法那一遍只有每一趟的序列（引擎不演示错法），没有另数的比较和稳定性
      values.final = (run.passes.at(-1) || input.items.map((x) => x.v)).slice();
      return { values };
    }
    const A = run.steps.at(-1).view.A;
    values.final = markedSeq(A.map((x) => x.v), A);
    if (COUNTERS[input.algo]) {
      const c = wangdaoSort(input.algo, input.items.map((x) => x.v), { gaps: input.gaps });
      values.cmp = c.cmp;
      if (c.move !== undefined) values.move = c.move;
      if (input.algo === 'bubble' || input.algo === 'select') values.swap = c.swap;
    }
    // 稳定性：一样的数排完以后先后换了的那几对（原来在前的写在前：「2 2′」）
    const flipped = [];
    for (let p = 0; p < A.length; p++) for (let q = p + 1; q < A.length; q++) {
      if (A[p].v === A[q].v && A[p].id > A[q].id) flipped.push(`${itemText(A[q])} ${itemText(A[p])}`);
    }
    values.unstable = flipped.length;
    values.flipped = flipped;
    return { values };
  },
  tree(input, run) {
    if (input.kind === 'bst') return { values: treeShape(run.final) };
    if (input.kind !== 'heap') return { values: {} };
    const values = { final: run.final.map(Number) };
    passVals(run.passes, values, Number);
    if (!input.mistake) {
      const c = heapCount(input);
      values.cmp = c.cmp;
      c.per.forEach((x, k) => { values[`cmp${k + 1}`] = x; });
      values.swaps = c.swaps;
    }
    return { values };
  },
  avl(input, run) {
    const types = run.log.flatMap((r) => r.types);
    const count = (t) => types.filter((x) => x === t).length;
    const root = run.final.root === null ? '' : numOr(run.final.nodes[run.final.root].key);
    const turns = types.reduce((a, t) => a + (t === 'LR' || t === 'RL' ? 2 : 1), 0);
    return { values: { rot: types.length, turns, LL: count('LL'), RR: count('RR'), LR: count('LR'), RL: count('RL'), root } };
  },
  paging(input, run) {
    const n = input.refs.length;
    let faults = run.faults;
    // 错法「一开始调入不算缺页」：引擎照常跑，少算开头调入的那几次（和引擎的 quiz、结尾那句一样：min(物理块数, 不同的页数)）
    if (input.noInitial && !input.init) faults -= Math.min(input.frames, new Set(input.refs).size);
    const values = { faults, hits: n - run.faults, rate: faults / n, victims: run.victims.slice() };
    // OPT：换页时以后都不再用的页有两页以上，换哪一页靠并列定（缺页次数不受影响：那几页以后都不用）
    const tieAt = [];
    if (input.algo === 'opt') {
      const cols = run.steps.filter((s) => s.view.k >= 0 && !s.view.end).map((s) => s.view.cols.at(-1));
      cols.forEach((c, k) => {
        if (c.victim === null) return;
        const before = k ? cols[k - 1].slots : (input.init || []).map((x) => x.page);
        const never = before.filter((pg) => pg !== null && input.refs.indexOf(pg, k + 1) < 0);
        if (never.length >= 2) tieAt.push(k);
      });
    }
    return tieAt.length ? { values, ties: ['victims'], tieAt: { victims: tieAt } } : { values };
  },
  sched(input, run) {
    return { values: { avgTurn: run.avgTurn, avgWait: run.avgWait, avgWeighted: run.avgWeighted, order: run.order.slice() } };
  },
  disk(input, run) {
    const values = { dist: run.dist, avg: run.dist / input.reqs.length, order: run.order.slice() };
    if (input.algo !== 'sstf') return { values };
    const t = sstfTies(input.reqs, input.head);
    if (!t.at.length) return { values };
    return { values, ties: t.dist ? ['order', 'dist', 'avg'] : ['order'], tieAt: { order: t.at } };
  },
  hash(input, run) {
    const last = run.steps.at(-1).view;
    const clashes = input.probe === 'chain' ? last.chains.reduce((a, c) => a + Math.max(0, c.length - 1), 0) : last.table.filter((x) => x && x.cnt > 1).length;
    const num = (s) => { const [p, q] = String(s).split('/').map(Number); return q ? p / q : p; };
    return { values: { aslSucc: num(run.asl.succ), aslFail: num(run.asl.fail), clashes } };
  },
};

// SSTF：哪几步有两个不同的磁道离磁头一样远（引擎按先到的那个走），换一边走总距离会不会变（会变 dist、avg 也靠并列）。
// 并列很少，有并列时把每一种走法都走一遍；分叉太多就当距离也有并列（宁可交外部核，也不错判）
function sstfTies(reqs, head) {
  const nearest = (left, pos) => { const best = Math.min(...left.map((x) => Math.abs(x - pos))); return [...new Set(left.filter((x) => Math.abs(x - pos) === best))]; };
  const without = (left, x) => { const i = left.indexOf(x); return [...left.slice(0, i), ...left.slice(i + 1)]; };
  // 引擎走的那条路：一样近的取先到的（left 保持请求的先后，nearest 的第一个就是它）
  const at = [];
  for (let left = reqs.slice(), pos = head, k = 0; left.length; k++) {
    const c = nearest(left, pos);
    if (c.length > 1) at.push(k);
    left = without(left, c[0]);
    pos = c[0];
  }
  if (!at.length) return { at, dist: false };
  const dists = new Set();
  let budget = 512;
  const go = (left, pos, d) => {
    if (budget <= 0) return;
    if (!left.length) { dists.add(d); budget--; return; }
    for (const x of nearest(left, pos)) go(without(left, x), x, d + Math.abs(x - pos));
  };
  go(reqs.slice(), head, 0);
  return { at, dist: dists.size > 1 || budget <= 0 };
}

// 排序：跑之前把一样的数标上撇号
function prepare(name, fields) {
  const f = fieldsOf(fields);
  let marked = null;
  if (name === 'sort' && f.array !== undefined) {
    const m = markDuplicates(f.array);
    f.array = m.text;
    if (m.changed) marked = `页面把${m.notes.join('、')}`;
  }
  return { fields: f, marked };
}

function valuesOf(name, input, run) {
  const m = MEASURERS[name];
  if (!m) return { values: {}, ties: [], tieAt: {} };
  const r = m(input, run);
  return { values: r.values, ties: r.ties || [], tieAt: r.tieAt || {} };
}

/**
 * 跑一遍、取量：{ values, ties, tieAt, marked }。
 *   values：量名 → 值（数；序列是数组：final、pass1、victims、order、flipped）
 *   ties：靠并列定下来的量名；tieAt：{ 量名: [第几步（从 0 数：paging 是第几个访问，disk 是第几个服务）] }
 *   marked：页面给一样的数加了撇号时说的那句（「页面把第二个 49 记成 49′」），没加是 null
 * 不认识的引擎、读不懂的字段、引擎不收（AVL 里有重复的数）照抛引擎的原话
 */
export function measure(name, fields) {
  const { fields: f, marked } = prepare(name, fields);
  const { input, run } = runEngine(name, f);
  return { ...valuesOf(name, input, run), marked };
}

// —— 错法 ——

// 短名照这几条取：错法自带的 mistake → 新冒出来的 true（noInitial、rrOld）→ 变了的那个字段的值（algo: fifo → fifo）。
// 没有好名字的几处另起：磁盘方向弄反、堆建反了、表长当成了除数
const KEY_NAMES = {
  disk: { dir: () => 'reverse' },
  tree: { max: (v) => (v ? 'maxHeap' : 'minHeap') },
  hash: { p: () => 'modSize' },
};
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function keyOf(name, base, v) {
  if (v.mistake && v.mistake !== base.mistake) return v.mistake;
  const changed = Object.keys(v).filter((k) => !same(v[k], base[k]));
  const fresh = changed.find((k) => v[k] === true && !KEY_NAMES[name]?.[k]);
  if (fresh) return fresh;
  for (const k of changed) if (KEY_NAMES[name]?.[k]) return KEY_NAMES[name][k](v[k]);
  const str = changed.find((k) => typeof v[k] === 'string' && v[k]);
  if (str) return v[str];
  const off = changed.find((k) => v[k] === false);
  if (off) return `no${cap(off)}`;
  return changed[0] || 'variant';
}

// 短名撞了（两种错法照上面的规则取出同一个名字）：后备的名字只从这一种错法自己来，不看它排第几——
// 外部写的 against: 不会因为引擎多列了一种错法就指到别的上。先拼上变了的别的字段，再不行拼说明的短指纹
function keyCandidates(name, base, v, label) {
  const key = keyOf(name, base, v);
  const changed = Object.keys(v).filter((k) => !same(v[k], base[k]));
  const out = [key, ...changed.map((k) => `${key}${cap(k)}`).filter((k) => k !== key)];
  let h = 5381;
  for (const ch of String(label || '')) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  out.push(`${key}-${h.toString(36).slice(0, 5)}`);
  return out;
}

/** 引擎的常见错法，每种一个短名：[{ key, label, input }]（这组数上和对的一样的引擎自己已经去掉了） */
export function variantsOf(name, fields) {
  const engine = ENGINES[name];
  if (!engine) throw new Error(`不认识的引擎「${name}」`);
  if (!engine.variants) return [];
  const { fields: f } = prepare(name, fields);
  const input = engine.parse(f, '');
  const used = new Set();
  return (engine.variants(input, f) || []).map((x) => {
    const cands = keyCandidates(name, input, x.input, x.label);
    let key = cands.find((k) => !used.has(k));
    if (!key) { const last = cands.at(-1); let i = 2; while (used.has(`${last}${i}`)) i++; key = `${last}${i}`; } // 连说明都一样，几乎不会有
    used.add(key);
    return { key, label: x.label, input: x.input };
  });
}

/** 按某种错法算出来的那一份量：{ values, ties }（predict 认学生写的是不是这种错法）；没有这个错法是 null */
export function variantValues(name, fields, key) {
  const v = variantsOf(name, fields).find((x) => x.key === key);
  if (!v) return null;
  const { values, ties } = valuesOf(name, v.input, ENGINES[name].run(v.input));
  return { values, ties };
}

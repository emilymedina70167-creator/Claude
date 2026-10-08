// 排序课用的纯逻辑（不碰 DOM，可以单测）：
// 解析数组、按王道 ShellSort 代码逐步执行、子表划分、生成讲解文字和数组的 HTML。
//
// 数组写法：`49 38 65 97 76 13 27 49'`（也可以用逗号、方括号）。
// 重复的数在后面加 ' 区分（显示成带下划线），用来看稳定性。

export function parseArray(src) {
  const s = String(src ?? '').trim().replace(/^\[/, '').replace(/\]$/, '');
  const toks = s.split(/[\s,，、]+/).filter(Boolean);
  if (!toks.length) throw new Error('array: 不能为空，写成 49 38 65 97 这样');
  if (toks.length > 16) throw new Error(`array: 最多 16 个元素（现在 ${toks.length} 个）`);
  return toks.map((t, k) => {
    const m = t.match(/^(-?\d+(?:\.\d+)?)(['’′_]*)$/);
    if (!m) throw new Error(`array: 看不懂元素「${t}」。写数字；重复的数可以加 ' 区分，如 49'`);
    return { v: Number(m[1]), mark: m[2].length, id: k };
  });
}

export function parseGaps(src, n) {
  if (src === undefined || src === null || String(src).trim() === '') return defaultGaps(n);
  const gs = String(src).trim().replace(/^\[|\]$/g, '').split(/[\s,，、]+/).filter(Boolean).map(Number);
  if (!gs.length || gs.some((d) => !Number.isInteger(d) || d < 1)) throw new Error(`增量要写正整数，如 4, 2, 1（现在是「${src}」）`);
  if (gs.some((d) => d >= n)) throw new Error(`增量必须小于元素个数 ${n}（现在是「${src}」）`);
  return gs;
}

// 希尔本人建议的增量：d₁ = ⌊n/2⌋，之后每次减半，直到 1
export function defaultGaps(n) {
  const gs = [];
  for (let d = Math.floor(n / 2); d >= 1; d = Math.floor(d / 2)) gs.push(d);
  return gs.length ? gs : [1];
}

// 第 g 个子表（g 从 1 开始）的位置：g, g+d, g+2d, …
export function subtable(n, d, g) {
  const out = [];
  for (let p = g; p <= n; p += d) out.push(p);
  return out;
}
export const subtables = (n, d) => Array.from({ length: Math.min(d, n) }, (_, k) => subtable(n, d, k + 1));
export const groupOf = (p, d) => ((p - 1) % d) + 1;

// 按王道代码逐步执行希尔排序，记下每一步（给「代码」演示用）。
// A 用 1 号到 n 号存元素，0 号是暂存单元（不是哨兵）。
// 每一步：{ line, A, temp, d, i, j, pass, cmp:[p,q], moved, placed, ok, kind, moves, msg }
export const SHELL_CODE = [
  '//希尔排序',
  'void ShellSort(int A[],int n){',
  '    int d, i, j;',
  '    //A[0]只是暂存单元，不是哨兵，当j<=0时，插入位置已到',
  '    for(d=n/2; d>=1; d=d/2)        //步长变化',
  '        for(i=d+1; i<=n; ++i)',
  '            if(A[i]<A[i-d]){        //需将A[i]插入有序增量子表',
  '                A[0]=A[i];          //暂存在A[0]',
  '                for(j=i-d; j>0 && A[0]<A[j]; j-=d)',
  '                    A[j+d]=A[j];    //记录后移，查找插入的位置',
  '                A[j+d]=A[0];        //插入',
  '            }//if',
  '}',
];

export function shellTrace(items, gaps, { upto } = {}) {
  const n = items.length;
  const A = [null, ...items];
  const steps = [];
  let moves = 0;
  let pass = 0;
  const show = (x) => fmt(x);
  const snap = (extra) => steps.push({ A: A.slice(), moves, pass, ...extra });
  snap({ kind: 'start', line: null, msg: '初始状态。A[0] 空着，留作暂存单元。' });
  for (const d of gaps) {
    pass++;
    const last = pass === gaps.length;
    snap({ kind: 'pass', line: 4, d, msg: `第 ${pass} 趟：d = ${d}。相距 ${d} 的元素属于同一个子表，共 ${Math.min(d, n)} 个子表。` });
    const iEnd = last && upto ? Math.min(upto, n) : n;
    for (let i = d + 1; i <= iEnd; i++) {
      const g = groupOf(i, d);
      snap({ kind: 'i', line: 5, d, i, msg: `i = ${i}：轮到子表 ${g} 的元素 A[${i}] = ${show(A[i])}。` });
      const less = A[i].v < A[i - d].v;
      snap({ kind: 'if', line: 6, d, i, cmp: [i, i - d], ok: less,
        msg: less ? `A[${i}] = ${show(A[i])} < A[${i - d}] = ${show(A[i - d])}，比同子表的前一个小，需要往前插。`
          : `A[${i}] = ${show(A[i])} 不小于 A[${i - d}] = ${show(A[i - d])}，子表里这一段已经有序，不用动。` });
      if (!less) continue;
      A[0] = A[i];
      snap({ kind: 'save', line: 7, d, i, msg: `A[0] = A[${i}]：把 ${show(A[i])} 暂存到 0 号位置。` });
      let j = i - d;
      for (;;) {
        const cond = j > 0 && A[0].v < A[j].v;
        snap({ kind: 'test', line: 8, d, i, j, cmp: j > 0 ? [0, j] : null, ok: cond,
          msg: j <= 0 ? `j = ${j}，已经 ≤ 0：同一子表前面没有元素了，循环结束。`
            : cond ? `j = ${j}：A[0] = ${show(A[0])} < A[${j}] = ${show(A[j])}，A[${j}] 要后移。`
              : `j = ${j}：A[0] = ${show(A[0])} 不小于 A[${j}] = ${show(A[j])}，插入位置找到了，循环结束。` });
        if (!cond) break;
        A[j + d] = A[j];
        moves++;
        snap({ kind: 'move', line: 9, d, i, j, moved: j + d,
          msg: `A[${j + d}] = A[${j}]：${show(A[j])} 往后挪 d = ${d} 格（不是 1 格）。然后 j -= ${d}。` });
        j -= d;
      }
      A[j + d] = A[0];
      snap({ kind: 'place', line: 10, d, i, j, placed: j + d, msg: `A[${j + d}] = A[0]：把 ${show(A[0])} 放进插入位置 ${j + d}。` });
    }
    snap({ kind: 'passEnd', line: null, d, msg: last && upto && upto < n ? `处理到 i = ${upto} 为止。`
      : `第 ${pass} 趟结束：${d === 1 ? '整个表有序了。' : `每个子表内部都有序了。`}` });
  }
  return steps;
}

// 一趟（或多趟）之后的结果，以及每趟的后移次数
export function shellRun(items, gaps, opts = {}) {
  const steps = shellTrace(items, gaps, opts);
  const states = [];
  let prevMoves = 0;
  for (const s of steps) {
    if (s.kind === 'passEnd') {
      states.push({ d: s.d, A: s.A.slice(1), moves: s.moves - prevMoves });
      prevMoves = s.moves;
    }
  }
  return { states, result: steps[steps.length - 1].A.slice(1), moves: prevMoves };
}

// 「先做再看」的讲解：每个子表排序前后 → 结果
export function explainPass(items, d) {
  const n = items.length;
  const after = shellRun(items, [d]).result;
  const lines = subtables(n, d).map((ps, k) => `- 子表 ${k + 1}（位置 ${ps.join(', ')}）：$${ps.map((p) => tex(items[p - 1])).join(',\\ ')} \\;\\to\\; ${ps.map((p) => tex(after[p - 1])).join(',\\ ')}$`);
  return `${lines.join('\n')}\n\n各子表排好后放回原来的位置：$${after.map(tex).join(',\\ ')}$`;
}

// 代码顺序下只处理到 i = upto 的讲解：每个 i 一行
export function explainUpto(items, d, upto) {
  const lines = [];
  let cur = items;
  for (let i = d + 1; i <= upto; i++) {
    const res = shellRun(cur, [d], { upto: i }).result;
    const moved = res.some((x, k) => x !== cur[k]);
    lines.push(`- $i=${i}$（子表 ${groupOf(i, d)}）：${moved ? `$${tex(cur[i - 1])} < ${tex(cur[i - 1 - d])}$，往前插` : `$${tex(cur[i - 1])} \\ge ${tex(cur[i - 1 - d])}$，不动`} → $${res.map(tex).join(',\\ ')}$`);
    cur = res;
  }
  return lines.join('\n');
}

export const fmt = (x) => (x ? `${x.v}${x.mark ? '′'.repeat(x.mark) : ''}` : '—');
export const tex = (x) => (x.mark ? `\\underline{${x.v}}` : `${x.v}`);
export const values = (A) => A.map((x) => x.v);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 数组画成一排格子 + 下标。opts：
//   zero: 显示 0 号格；temp: 0 号格里的元素
//   gap: 按子表着色；cls: {下标: class}；ptr: {下标: '标签'}；split: 下面按子表分行
export function arrayHtml(items, opts = {}) {
  const n = items.length;
  const { zero = false, temp = null, gap = 0, cls = {}, ptr = {}, split = false, done = false } = opts;
  const first = zero ? 0 : 1;
  const cols = n + 1 - first;
  const cell = (p, x, extra = '') => {
    const g = gap && p > 0 ? groupOf(p, gap) : 0;
    const c = ['arr-cell', x ? '' : 'arr-empty', g ? `grp grp-${((g - 1) % 6) + 1}` : '', done && p > 0 ? 'arr-done' : '', cls[p] || '', extra].join(' ').replace(/\s+/g, ' ').trim();
    return `<div class="${c}" data-p="${p}">${x ? (x.mark ? `<u>${x.v}</u>` : x.v) : ''}</div>`;
  };
  let h = `<div class="arr" style="--cols:${cols}">`;
  h += '<div class="arr-row">';
  for (let p = first; p <= n; p++) h += cell(p, p === 0 ? temp : items[p - 1], p === 0 ? 'arr-zero' : '');
  h += '</div><div class="arr-row arr-idx">';
  for (let p = first; p <= n; p++) h += `<div>${p}</div>`;
  h += '</div>';
  if (Object.keys(ptr).length) {
    h += '<div class="arr-row arr-ptr">';
    for (let p = first; p <= n; p++) h += `<div>${ptr[p] ? `<span>▲</span>${esc(ptr[p])}` : ''}</div>`;
    h += '</div>';
  }
  h += '</div>';
  if (split && gap > 1) {
    h += `<div class="arr arr-split" style="--cols:${cols + 1}">`;
    subtables(n, gap).forEach((ps, k) => {
      h += '<div class="arr-row">';
      for (let p = first; p <= n; p++) h += ps.includes(p) ? cell(p, items[p - 1]) : '<div class="arr-gap"></div>';
      h += `<div class="arr-label">子表${k + 1}</div></div>`;
    });
    h += '</div>';
  }
  return h;
}

// —— 练习题生成器 ——
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function randomItems(n, { dup = false } = {}) {
  const pool = new Set();
  while (pool.size < n) pool.add(rnd(10, 99));
  const vals = [...pool];
  const items = vals.map((v, k) => ({ v, mark: 0, id: k }));
  if (dup && n >= 4) {
    // 放一对相等的数，后一个加下划线
    const a = rnd(0, n - 2), b = rnd(a + 1, n - 1);
    items[b] = { v: items[a].v, mark: 1, id: b };
  }
  return items;
}

export const SORT_GENERATORS = {
  // 给增量 d，写出一趟希尔排序后的序列（考研高频题型）
  shellpass(level = 1) {
    const n = level >= 2 ? rnd(10, 12) : rnd(8, 10);
    const ds = [...new Set([Math.floor(n / 2), 3, 4, 5])].filter((d) => d > 1 && d <= Math.floor(n / 2));
    const d = ds[rnd(0, ds.length - 1)];
    let items;
    do items = randomItems(n, { dup: Math.random() < 0.4 }); while (shellRun(items, [d]).moves === 0);
    const res = shellRun(items, [d]).result;
    return {
      q: `对下面的序列做**一趟**增量 $d = ${d}$ 的希尔排序（升序），写出这一趟结束后的序列。`,
      qhtml: arrayHtml(items, { gap: 0 }),
      recordQ: `d=${d} 一趟：${items.map(fmt).join(' ')}`,
      type: 'array',
      answer: values(res),
      explain: explainPass(items, d),
    };
  },
  // 子表划分：给 n、d 和一个位置，写出它所在子表的全部位置
  shellgroup() {
    const n = rnd(9, 13);
    const d = rnd(3, 5);
    const p = rnd(1, n);
    const ps = subtable(n, d, groupOf(p, d));
    return {
      q: `表长 $n = ${n}$，增量 $d = ${d}$（位置从 1 开始数）。**第 ${p} 号位置**所在的子表包含哪些位置？从小到大填。`,
      recordQ: `n=${n}, d=${d}, 位置 ${p} 所在子表`,
      type: 'array',
      answer: ps,
      explain: `同一子表 = 位置相差 $d$ 的整数倍。从 ${p} 往前减 ${d} 减到不能再减得到起点 ${ps[0]}，再每次加 ${d}：$${ps.join(',\\ ')}$（不超过 ${n}）。这是第 ${groupOf(p, d)} 个子表。`,
    };
  },
};


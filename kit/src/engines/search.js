// 查找的演示引擎（纯函数，不碰 DOM；tests/search-engine.test.js）：
//   kmp     模式串的 next / nextval 数组（王道：从 1 数，next[1] = 0），KMP 匹配
//   hash    散列表：除留余数法，线性探测 / 平方探测 / 拉链法，算 ASL（成功、失败）
//   bsearch 折半查找：low / mid / high 一步步走，判定树，ASL
import { arrayView, chips, esc } from './arrayview.js';
import { treeSvg } from './treeview.js';

const frac = (a, b) => { const g = gcd(a, b); const p = a / g, q = b / g; return q === 1 ? `${p}` : `${p}/${q}`; };
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; }
const dec = (a, b) => (Number.isInteger(a / b) ? String(a / b) : (a / b).toFixed(2).replace(/0$/, ''));

// ================= KMP =================

export function nextArray(T) {
  const n = T.length - 1; // T[1..n]
  const next = [undefined, 0];
  for (let j = 2; j <= n; j++) next[j] = border(T, j - 1) + 1;
  return next;
}
// T[1..len] 最长的相等真前缀、真后缀的长度
function border(T, len) {
  for (let k = len - 1; k >= 1; k--) {
    let ok = true;
    for (let t = 1; t <= k; t++) if (T[t] !== T[len - k + t]) { ok = false; break; }
    if (ok) return k;
  }
  return 0;
}
export function nextvalArray(T, next) {
  const n = T.length - 1;
  const nv = [undefined, 0];
  for (let j = 2; j <= n; j++) nv[j] = T[j] === T[next[j]] ? nv[next[j]] : next[j];
  return nv;
}

function kmpParse(fields) {
  const pat = String(fields.pattern ?? '').replace(/\s+/g, '');
  if (!pat) throw new Error('kmp 要写 pattern:（模式串，如 abaabc）');
  if ([...pat].length > 16) throw new Error('pattern: 最长 16 个字符');
  const text = fields.text === undefined ? '' : String(fields.text).replace(/\s+/g, '');
  if ([...text].length > 32) throw new Error('text: 主串最长 32 个字符');
  let show = String(fields.show || (text ? 'match' : 'next')).trim().toLowerCase();
  if (!['next', 'nextval', 'match'].includes(show)) throw new Error('show: 写 next（求 next 数组）、nextval（再求 nextval）或 match（用主串 text: 演示匹配）');
  if (show === 'match' && !text) throw new Error('show: match 要写 text:（主串）');
  const use = String(fields.use || 'next').trim().toLowerCase();
  if (!['next', 'nextval'].includes(use)) throw new Error('use: 匹配时用 next（默认）还是 nextval');
  return { T: [undefined, ...pat], S: [undefined, ...text], show, use };
}

function kmpRun({ T, S, show, use }) {
  const n = T.length - 1;
  const next = nextArray(T);
  const nv = nextvalArray(T, next);
  const steps = [];
  const pat = T.slice(1).join('');
  if (show !== 'match') {
    const shown = { next: [], nextval: [] };
    const v = (extra = {}) => ({ table: true, next: shown.next.slice(), nextval: show === 'nextval' ? shown.nextval.slice() : null, ...extra });
    steps.push({ view: v(), msg: `求 next 数组（王道，从 1 数）：next[1] = 0；j ≥ 2 时，看 T[1..j−1] 里最长的相等前后缀，长度是 k，next[j] = k + 1。` });
    for (let j = 1; j <= n; j++) {
      shown.next[j] = next[j];
      if (j === 1) { steps.push({ view: v({ j }), msg: 'next[1] = 0（规定：第一个字符就失配，主串往后走一个）。' }); continue; }
      const k = next[j] - 1;
      const sub = T.slice(1, j).join('');
      const pre = range(1, k), suf = range(j - k, j - 1);
      steps.push({
        view: v({ j, pre, suf }),
        msg: k ? `T[1..${j - 1}] = ${sub}：最长的相等前后缀是「${sub.slice(0, k)}」（长 ${k}），所以 next[${j}] = ${k} + 1 = ${next[j]}。` : `T[1..${j - 1}] = ${sub}：没有相等的前后缀（长 0），所以 next[${j}] = 1。`,
        ask: { tag: 'next', kind: 'number', q: `next[${j}] 是多少？`, answer: next[j] },
      });
    }
    if (show === 'nextval') {
      steps.push({ view: v(), msg: `再求 nextval：nextval[1] = 0；j ≥ 2 时，如果 T[j] = T[next[j]]，失配后退到 next[j] 还是会失配，所以 nextval[j] = nextval[next[j]]；不相等就是 next[j]。` });
      for (let j = 1; j <= n; j++) {
        shown.nextval[j] = nv[j];
        if (j === 1) { steps.push({ view: v({ j }), msg: 'nextval[1] = 0。' }); continue; }
        const k = next[j];
        const same = T[j] === T[k];
        steps.push({
          view: v({ j, ref: k }),
          msg: same ? `T[${j}] = '${T[j]}' 和 T[next[${j}]] = T[${k}] = '${T[k]}' 相等：nextval[${j}] = nextval[${k}] = ${nv[j]}。` : `T[${j}] = '${T[j]}' 和 T[${k}] = '${T[k]}' 不相等：nextval[${j}] = next[${j}] = ${k}。`,
          ask: { tag: 'nextval', kind: 'number', q: `nextval[${j}] 是多少？`, answer: nv[j] },
        });
      }
    }
    steps.push({ view: v(), msg: `next = ${next.slice(1).join(' ')}${show === 'nextval' ? `；nextval = ${nv.slice(1).join(' ')}` : ''}。` });
    return { steps, passes: [show === 'nextval' ? nv.slice(1) : next.slice(1)], next, nv };
  }
  // 匹配
  const arr = use === 'nextval' ? nv : next;
  const m = S.length - 1;
  let i = 1, j = 1, cmps = 0;
  const v = (extra = {}) => ({ match: true, i, j, cmps, arr: arr.slice(), ...extra });
  steps.push({ view: v(), msg: `用 ${use} 数组做 KMP 匹配：i 指主串、j 指模式串。相等（或 j = 0）就 i、j 都加 1；不相等时 i 不回退，j = ${use}[j]。` });
  while (i <= m && j <= n) {
    if (j === 0) { i++; j++; steps.push({ view: v(), msg: `j = 0：i、j 都加 1（主串往后走一个，模式串从第 1 个比）。` }); continue; }
    let r = 0;
    while (i + r <= m && j + r <= n && S[i + r] === T[j + r]) r++;
    cmps += r;
    if (r > 0) {
      const ok = range(j, j + r - 1);
      steps.push({ view: v({ eq: ok }), msg: `S[${i}..${i + r - 1}] 和 T[${j}..${j + r - 1}] 逐个相等（比较 ${r} 次），i、j 往后走 ${r} 个。` });
      i += r; j += r;
      if (j > n || i > m) break;
    }
    cmps++;
    steps.push({ view: v({ bad: true }), msg: `S[${i}] = '${S[i]}' ≠ T[${j}] = '${T[j]}'：失配。` });
    const nj = arr[j];
    const jOld = j;
    j = nj;
    steps.push({ view: v(), msg: nj ? `i 不动，j = ${use}[${jOld}] = ${nj}：模式串往右滑，让 T[${nj}] 对着 S[${i}]。` : `${use}[${jOld}] = 0：j 变成 0。`, ask: { tag: 'slide', kind: 'number', q: `失配了（j = ${jOld}），j 接下来变成多少？`, answer: nj } });
  }
  const ok = j > n;
  steps.push({ view: v({ done: ok }), msg: ok ? `j 超过模式串的长度 ${n}：匹配成功，位置是 i − ${n} = ${i - n}。一共比较了 ${cmps} 次。` : `主串走完了：匹配失败。一共比较了 ${cmps} 次。` });
  return { steps, passes: [[ok ? i - n : 0]], next, nv };
}
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, k) => a + k);

function kmpView(s, input) {
  const { T, S } = input;
  const n = T.length - 1;
  if (s.table) {
    const pre = new Set(s.pre || []), suf = new Set(s.suf || []);
    const row = (label, cells) => `<div class="sv-tbl-row"><div class="sv-tbl-h">${label}</div>${cells.join('')}</div>`;
    const cell = (j, txt, cls = '') => `<div class="sv-tbl-c ${cls}" data-cmd="${j}" data-pick="${j}" data-label="${esc(T[j])}">${esc(txt)}</div>`;
    let h = `<div class="sv-tbl" style="--cols:${n}">`;
    h += row('j', range(1, n).map((j) => `<div class="sv-tbl-c sv-tbl-idx${s.j === j ? ' sv-cur' : ''}">${j}</div>`));
    h += row('T', range(1, n).map((j) => cell(j, T[j], [pre.has(j) ? 'sv-g1' : '', suf.has(j) ? 'sv-g2' : '', s.j === j ? 'sv-cur' : '', s.ref === j ? 'sv-cmp' : ''].filter(Boolean).join(' '))));
    h += row('next', range(1, n).map((j) => `<div class="sv-tbl-c sv-tbl-v${s.j === j && !s.nextval ? ' sv-new' : ''}">${s.next[j] ?? ''}</div>`));
    if (s.nextval) h += row('nextval', range(1, n).map((j) => `<div class="sv-tbl-c sv-tbl-v${s.j === j ? ' sv-new' : ''}">${s.nextval[j] ?? ''}</div>`));
    return h + '</div>';
  }
  // 匹配：主串一行，模式串对齐在下面（T[j] 对着 S[i]）
  const m = S.length - 1;
  const off = s.i - s.j; // 模式串第 1 个字符在主串的位置 − 1
  const eq = new Set(s.eq || []);
  const cols = Math.max(m, off + n);
  let h = `<div class="sv-tbl sv-kmp" style="--cols:${cols}">`;
  h += `<div class="sv-tbl-row"><div class="sv-tbl-h">i</div>${range(1, cols).map((p) => `<div class="sv-tbl-c sv-tbl-idx${p === s.i ? ' sv-cur' : ''}">${p <= m ? p : ''}</div>`).join('')}</div>`;
  h += `<div class="sv-tbl-row"><div class="sv-tbl-h">S</div>${range(1, cols).map((p) => { const j = p - off; const c = p > m ? 'sv-empty' : s.done && j >= 1 && j <= n ? 'sv-done' : eq.has(j) ? 'sv-done' : p === s.i && s.bad ? 'sv-swap' : p === s.i ? 'sv-cmp' : ''; return `<div class="sv-tbl-c ${c}" data-cmd="${p}" data-label="${esc(S[p] ?? '')}">${esc(S[p] ?? '')}</div>`; }).join('')}</div>`;
  // 模式串的字符和下标带 data-key：j 回退时整行往右滑（morph.js）
  h += `<div class="sv-tbl-row"><div class="sv-tbl-h">T</div>${range(1, cols).map((p) => { const j = p - off; if (j < 1 || j > n) return '<div class="sv-tbl-c sv-tbl-gap"></div>'; const c = s.done || eq.has(j) ? 'sv-done' : j === s.j && s.bad ? 'sv-swap' : j === s.j ? 'sv-cmp' : ''; return `<div class="sv-tbl-c ${c}" data-key="t${j}">${esc(T[j])}</div>`; }).join('')}</div>`;
  h += `<div class="sv-tbl-row"><div class="sv-tbl-h">j</div>${range(1, cols).map((p) => { const j = p - off; return j >= 1 && j <= n ? `<div class="sv-tbl-c sv-tbl-idx${j === s.j ? ' sv-cur' : ''}" data-key="tj${j}">${j}</div>` : '<div class="sv-tbl-c sv-tbl-idx"></div>'; }).join('')}</div>`;
  h += '</div>';
  return h + chips([['i', s.i], ['j', s.j], [input.use, s.arr.slice(1).join(' ')], ['比较次数', s.cmps]]);
}

export const kmpEngine = {
  name: 'kmp',
  title: 'KMP',
  parse: kmpParse,
  run: kmpRun,
  view: kmpView,
  quiz(input, r) {
    const pat = input.T.slice(1).join('');
    if (input.show === 'match') return { q: `用 ${input.use} 数组在主串 ${input.S.slice(1).join('')} 里找模式串 ${pat}，写出匹配成功的位置（从 1 数，找不到写 0）。`, type: 'seq', answer: String(r.passes[0][0]) };
    return { q: `写出模式串 ${pat} 的 ${input.show} 数组（从 j = 1 开始）。`, type: 'seq', answer: r.passes[0].join(' ') };
  },
};

// ================= 散列表 =================

const PROBES = { linear: '线性探测法', quadratic: '平方探测法', chain: '拉链法' };
const PROBE_ALIAS = { linear: 'linear', 线性: 'linear', 线性探测: 'linear', 线性探测法: 'linear', quadratic: 'quadratic', square: 'quadratic', 平方: 'quadratic', 平方探测: 'quadratic', 平方探测法: 'quadratic', chain: 'chain', chaining: 'chain', 拉链: 'chain', 拉链法: 'chain', 链地址: 'chain', 链地址法: 'chain' };

function hashParse(fields) {
  const keys = String(fields.hash ?? '').trim().split(/[\s,，、]+/).filter(Boolean);
  if (!keys.length) throw new Error('hash: 要写关键字，如 19 14 23 01 68');
  if (keys.some((k) => !/^\d+$/.test(k))) throw new Error('hash: 关键字要是非负整数');
  if (keys.length > 20) throw new Error('hash: 最多 20 个关键字');
  const p = Number(fields.p ?? fields.mod);
  if (!Number.isInteger(p) || p < 2) throw new Error('hash 要写 p:（除留余数法 H(key) = key % p 的 p，如 13）');
  const probe = PROBE_ALIAS[String(fields.probe || 'linear').trim().toLowerCase()];
  if (!probe) throw new Error(`probe: 写 linear（线性探测）、quadratic（平方探测）或 chain（拉链法）`);
  const size = fields.size === undefined || fields.size === '' ? p : Number(fields.size);
  if (!Number.isInteger(size) || size < p) throw new Error(`size: 表长要是不小于 p（${p}）的整数`);
  if (size > 26) throw new Error('size: 表长最多 26');
  if (probe !== 'chain' && keys.length > size) throw new Error(`关键字有 ${keys.length} 个，表长只有 ${size}，放不下`);
  return { keys: keys.map((t) => ({ text: t, v: Number(t) })), p, size: probe === 'chain' ? p : size, probe };
}

function hashRun({ keys, p, size, probe }) {
  const steps = [];
  const table = Array(size).fill(null); // 开放定址：{ key, cnt }
  const chains = Array.from({ length: size }, () => []); // 拉链：[{ key, cnt }]
  const v = (extra = {}) => ({ table: table.map((x) => x && { ...x }), chains: chains.map((c) => c.map((x) => ({ ...x }))), ...extra });
  steps.push({ view: v(), msg: `散列函数 H(key) = key % ${p}，${PROBES[probe]}处理冲突${probe === 'chain' ? '（新关键字接在链表末尾）' : `，表长 ${size}（地址 0～${size - 1}）`}。依次插入 ${keys.map((k) => k.text).join('、')}。` });
  const probeSeq = (h) => {
    if (probe === 'linear') return Array.from({ length: size }, (_, d) => ({ d, a: (h + d) % size }));
    // 平方探测：d = 0, 1², −1², 2², −2², …（k ≤ size/2）
    const out = [{ d: 0, a: h }];
    for (let k = 1; k <= Math.floor(size / 2); k++) for (const d of [k * k, -k * k]) out.push({ d, a: (((h + d) % size) + size) % size });
    return out;
  };
  for (const key of keys) {
    const h = key.v % p;
    steps.push({ view: v({ cur: h, key: key.text }), msg: `H(${key.text}) = ${key.text} % ${p} = ${h}。`, ask: { tag: 'hash', kind: 'number', q: `H(${key.text}) 是多少？`, answer: h } });
    if (probe === 'chain') {
      chains[h].push({ key: key.text, cnt: chains[h].length + 1 });
      steps.push({ view: v({ cur: h, fresh: h, key: key.text }), msg: chains[h].length === 1 ? `${h} 号链表是空的，${key.text} 成为第一个结点（查到它要比较 1 次）。` : `${h} 号链表已经有 ${chains[h].length - 1} 个结点（冲突），${key.text} 接在末尾，是第 ${chains[h].length} 个（查到它要比较 ${chains[h].length} 次）。`, ask: { tag: 'place', kind: 'pick', q: `${key.text} 放在哪个地址的链表里？点出来。`, answer: String(h) } });
      continue;
    }
    let cnt = 0, placed = -1;
    const seq = probeSeq(h);
    for (const { d, a } of seq) {
      cnt++;
      if (table[a] === null) { placed = a; break; }
      steps.push({ view: v({ cur: a, clash: a, key: key.text }), msg: `第 ${cnt} 次：地址 ${a}（${probe === 'linear' ? `H + ${d}` : `H ${d < 0 ? '−' : '+'} ${Math.abs(d)}`}）已经放了 ${table[a].key}，冲突。` });
    }
    if (placed < 0) throw new Error(`${key.text} 用${PROBES[probe]}探测了一圈都没找到空位（平方探测不一定能探测到所有地址：表长最好是 4k+3 的素数）`);
    table[placed] = { key: key.text, cnt };
    steps.push({ view: v({ cur: placed, fresh: placed, key: key.text }), msg: `地址 ${placed} 空着，${key.text} 放进去。一共比较了 ${cnt} 次（查找成功时找到它也要比较 ${cnt} 次）。`, ask: { tag: 'place', kind: 'pick', q: `${key.text} 最后放在哪个地址？在图里点出来。`, answer: String(placed) } });
  }
  // ASL
  const n = keys.length;
  const succ = probe === 'chain' ? chains.flat().map((x) => x.cnt) : table.filter(Boolean).map((x) => x.cnt);
  const sSum = succ.reduce((a, b) => a + b, 0);
  steps.push({ view: v({ showCnt: true }), msg: `ASL成功 = 每个关键字的比较次数加起来 ÷ ${n} = (${succ.join(' + ')}) / ${n} = ${frac(sSum, n)}${Number.isInteger(sSum / n) ? '' : ` ≈ ${dec(sSum, n)}`}。`, ask: { tag: 'asl', kind: 'number', q: 'ASL成功（查找成功的平均查找长度）是多少？', answer: sSum / n, display: frac(sSum, n) } });
  // 查找失败：按散列函数可能算出的 p 个地址，各自要比较几次才能确定没有
  const fail = [];
  for (let r = 0; r < p; r++) {
    if (probe === 'chain') { fail.push(chains[r].length); continue; }
    let c = 0;
    for (const { a } of probeSeq(r)) { c++; if (table[a] === null) break; }
    fail.push(c);
  }
  const fSum = fail.reduce((a, b) => a + b, 0);
  const rule = probe === 'chain' ? '链表有几个结点就比较几次（王道：和空指针的比较不算）' : '一直探测到空位置为止（王道：和空位置的那次比较也算）';
  steps.push({ view: v({ showCnt: true, fail }), msg: `ASL失败：H(key) 只能算出 0～${p - 1} 这 ${p} 个地址，从每个地址开始查失败要比较几次：${rule}。(${fail.join(' + ')}) / ${p} = ${frac(fSum, p)}${Number.isInteger(fSum / p) ? '' : ` ≈ ${dec(fSum, p)}`}。`, ask: { tag: 'aslfail', kind: 'number', q: 'ASL失败（查找失败的平均查找长度）是多少？', answer: fSum / p, display: frac(fSum, p) } });
  return { steps, passes: [table.map((x) => (x ? x.key : '#'))], asl: { succ: frac(sSum, n), fail: frac(fSum, p) } };
}

function hashView(s, input) {
  if (input.probe === 'chain') {
    let h = '<div class="sv-chains">';
    s.chains.forEach((c, a) => {
      const cls = [s.cur === a ? 'sv-cur' : '', s.fresh === a ? 'sv-new' : ''].filter(Boolean).join(' ');
      h += `<div class="sv-chain-row"><div class="sv-cell sv-chain-addr ${cls}" data-pick="${a}" data-cmd="${a + 1}">${a}</div>`;
      h += c.map((x, k) => `<span class="sv-chain-arrow">→</span><div class="sv-cell sv-chain-node${s.fresh === a && k === c.length - 1 ? ' sv-new sv-done' : ''}" data-label="${esc(x.key)}">${esc(x.key)}${s.showCnt ? `<sub>${x.cnt}</sub>` : ''}</div>`).join('');
      h += `${c.length ? '' : '<span class="sv-chain-null">∧</span>'}${s.fail ? `<span class="sv-chain-fail">失败 ${s.fail[a] ?? ''}</span>` : ''}</div>`;
    });
    return h + '</div>' + chips([['关键字', s.key]]);
  }
  const cls = {};
  if (s.clash !== undefined) cls[s.clash] = 'sv-swap';
  else if (s.cur !== undefined && s.fresh === undefined) cls[s.cur] = 'sv-cur';
  if (s.fresh !== undefined) cls[s.fresh] = 'sv-done';
  const extra = [];
  if (s.showCnt) extra.push({ label: '比较次数', cells: s.table.map((x) => (x ? x.cnt : '')) });
  if (s.fail) extra.push({ label: '查找失败', cells: Array.from({ length: input.size }, (_, a) => (a < input.p ? s.fail[a] : '')) });
  const h = arrayView(s.table.map((x) => (x ? x.key : null)), { base: 0, cls, fresh: s.fresh !== undefined ? [s.fresh] : [], extra });
  return h + chips([['关键字', s.key]]);
}

export const hashEngine = {
  name: 'hash',
  title: '散列表',
  parse: hashParse,
  run: hashRun,
  view: hashView,
  quiz(input, r, fields) {
    const what = String(fields.quiz || 'table').toLowerCase();
    const head = `H(key) = key % ${input.p}，${PROBES[input.probe]}${input.probe === 'chain' ? '' : `，表长 ${input.size}`}，依次插入 ${input.keys.map((k) => k.text).join('、')}。`;
    if (what === 'asl') return { q: `${head}写出 ASL成功（写成分数或小数）。`, type: 'seq', answer: `${r.asl.succ}` };
    if (input.probe === 'chain') throw new Error('拉链法的 quiz 只能是 quiz: asl');
    return { q: `${head}写出散列表从地址 0 到 ${input.size - 1} 的内容（空的写 #）。`, type: 'seq', answer: r.passes[0].join(' ') };
  },
};

// ================= 折半查找 =================

function bsParse(fields) {
  const toks = String(fields.bsearch ?? '').trim().split(/[\s,，、]+/).filter(Boolean);
  if (!toks.length) throw new Error('bsearch: 要写有序表，如 7 10 13 16 19 29 32 33 37 41 43');
  if (toks.length > 31) throw new Error('bsearch: 最多 31 个');
  if (toks.some((t) => !/^-?\d+(\.\d+)?$/.test(t))) throw new Error('bsearch: 要写数');
  const vals = toks.map(Number);
  for (let i = 1; i < vals.length; i++) if (vals[i] <= vals[i - 1]) throw new Error(`bsearch: 要从小到大排好（第 ${i} 个 ${toks[i - 1]} 和第 ${i + 1} 个 ${toks[i]} 不对），并且没有重复`);
  const keys = String(fields.key ?? '').trim().split(/[\s,，、]+/).filter(Boolean);
  if (keys.some((t) => !/^-?\d+(\.\d+)?$/.test(t))) throw new Error('key: 要写数');
  const tree = /^(true|yes|1|是)$/i.test(String(fields.tree || '').trim());
  if (!keys.length && !tree) throw new Error('bsearch 要写 key:（要查的关键字，几个用逗号），或者 tree: true（画判定树）');
  return { items: toks.map((t, i) => ({ text: t, v: vals[i] })), keys: keys.map(Number), keyText: keys, tree };
}

// 判定树：区间 [l, h] 的根是 mid = ⌊(l+h)/2⌋（位置从 1 数）
function decisionTree(n) {
  const nodes = {};
  const build = (l, h, d) => {
    if (l > h) return null;
    const m = Math.floor((l + h) / 2);
    nodes[String(m)] = { key: '', left: build(l, m - 1, d + 1), right: build(m + 1, h, d + 1), d };
    return String(m);
  };
  const root = build(1, n, 1);
  return { root, nodes };
}

function bsRun({ items, keys, keyText, tree }) {
  const n = items.length;
  const steps = [];
  const T = decisionTree(n);
  for (const [id, nd] of Object.entries(T.nodes)) nd.key = items[Number(id) - 1].text;
  const v = (extra = {}) => ({ ...extra });
  steps.push({ view: v(), msg: `折半查找：low = 1、high = ${n}，每次比较 mid = ⌊(low + high)/2⌋ 位置上的元素：相等就找到；key 小就去左半边（high = mid − 1），大就去右半边（low = mid + 1）；low > high 就失败。` });
  const seqs = [];
  keys.forEach((key, ki) => {
    let low = 1, high = n;
    const path = [];
    steps.push({ view: v({ low, high, key: keyText[ki], path: [] }), msg: `查找 ${keyText[ki]}：low = 1，high = ${n}。` });
    for (;;) {
      if (low > high) {
        steps.push({ view: v({ low, high, key: keyText[ki], path: path.slice(), fail: true }), msg: `low = ${low} > high = ${high}：查找失败，一共比较了 ${path.length} 次（${path.map((p) => items[p - 1].text).join('、')}）。` });
        break;
      }
      const mid = Math.floor((low + high) / 2);
      path.push(mid);
      const x = items[mid - 1];
      const c = key === x.v ? 0 : key < x.v ? -1 : 1;
      const ask = { tag: 'mid', kind: 'pick', q: `下一次和哪个元素比？在图里点出来。`, answer: String(mid) };
      if (c === 0) {
        steps.push({ view: v({ low, high, mid, key: keyText[ki], path: path.slice(), found: mid }), msg: `mid = ⌊(${low} + ${high})/2⌋ = ${mid}，第 ${mid} 个是 ${x.text} = ${keyText[ki]}：找到了，一共比较了 ${path.length} 次。`, ask });
        break;
      }
      steps.push({ view: v({ low, high, mid, key: keyText[ki], path: path.slice() }), msg: `mid = ⌊(${low} + ${high})/2⌋ = ${mid}，第 ${mid} 个是 ${x.text}：${keyText[ki]} ${c < 0 ? '<' : '>'} ${x.text}，去${c < 0 ? `左半边，high = ${mid - 1}` : `右半边，low = ${mid + 1}`}。`, ask });
      if (c < 0) high = mid - 1; else low = mid + 1;
    }
    seqs.push(path.map((p) => items[p - 1].text));
  });
  let asl = null;
  if (tree) {
    const depths = Object.values(T.nodes).map((x) => x.d);
    const sSum = depths.reduce((a, b) => a + b, 0);
    // 失败结点（判定树里空的位置）：比较的次数 = 它双亲所在的层数
    const fails = [];
    for (const nd of Object.values(T.nodes)) for (const c of [nd.left, nd.right]) if (c === null) fails.push(nd.d);
    const fSum = fails.reduce((a, b) => a + b, 0);
    asl = { succ: frac(sSum, n), fail: frac(fSum, n + 1) };
    const byLevel = (arr) => { const m = {}; for (const d of arr) m[d] = (m[d] || 0) + 1; return Object.entries(m).map(([d, c]) => `${d}×${c}`).join(' + '); };
    steps.push({ view: v({ all: true }), msg: `判定树：每个结点就是一次比较，查到第 d 层的结点要比较 d 次。ASL成功 = (${byLevel(depths)}) / ${n} = ${frac(sSum, n)}。`, ask: { tag: 'asl', kind: 'number', q: 'ASL成功是多少？', answer: sSum / n, display: frac(sSum, n) } });
    steps.push({ view: v({ all: true }), msg: `查找失败落在判定树的 ${n + 1} 个空位置上，比较次数是空位置双亲的层数。ASL失败 = (${byLevel(fails)}) / ${n + 1} = ${frac(fSum, n + 1)}。`, ask: { tag: 'aslfail', kind: 'number', q: 'ASL失败是多少？', answer: fSum / (n + 1), display: frac(fSum, n + 1) } });
  }
  return { steps, passes: seqs, T, asl };
}

function bsView(s, input) {
  const n = input.items.length;
  const cls = {};
  const path = new Set(s.path || []);
  for (const p of path) cls[p] = 'sv-cmp';
  if (s.mid) cls[s.mid] = 'sv-cur';
  if (s.found) cls[s.found] = 'sv-done';
  const ptr = {};
  const put = (p, t) => { if (p >= 1 && p <= n) ptr[p] = ptr[p] ? `${ptr[p]},${t}` : t; };
  if (s.low !== undefined) { put(s.low, 'low'); put(s.high, 'high'); if (s.mid) put(s.mid, 'mid'); }
  let h = arrayView(input.items.map((x) => x.text), { cls, ptr, lo: s.low !== undefined && !s.fail ? s.low : null, hi: s.high !== undefined && !s.fail ? s.high : null });
  if (input.tree) {
    const T = run0(input);
    const tcls = {};
    for (const p of path) tcls[String(p)] = 'sv-path';
    if (s.mid) tcls[String(s.mid)] = 'sv-cur';
    if (s.found) tcls[String(s.found)] = 'sv-found';
    const edge = Object.fromEntries([...path].map((p) => [String(p), 'sv-edge-path']));
    h += treeSvg(T, { cls: tcls, edge, pick: (id) => id, cmd: (id) => Number(id) });
  }
  return h + chips([['查找', s.key]]);
}
const run0 = (input) => { const T = decisionTree(input.items.length); for (const [id, nd] of Object.entries(T.nodes)) nd.key = input.items[Number(id) - 1].text; return T; };

export const bsearchEngine = {
  name: 'bsearch',
  title: '折半查找',
  parse: bsParse,
  run: bsRun,
  view: bsView,
  quiz(input, r) {
    if (!input.keys.length) throw new Error('bsearch 的 quiz 要写 key:（问查找它时依次和哪些元素比较）');
    return { q: `在有序表 ${input.items.map((x) => x.text).join(' ')} 里折半查找 ${input.keyText[0]}，依次和哪些元素比较？按顺序写出来。`, type: 'seq', answer: r.passes[0].join(' ') };
  },
};

// 校验码（组成原理、计网共用）：crc（循环冗余校验：模 2 除法一步步做）、hamming（海明码：编码、纠错）。
// 口径按王道：CRC 的生成多项式 r 阶就在信息后面补 r 个 0，按位异或（不借位）；
// 海明码的校验位 P_i 放在 H_{2^(i−1)}，写成 H_n … H_1（左边是高位），偶校验（parity: odd 改奇校验）。
// 纯函数，不碰 DOM（tests/codes-engine.test.js）。
import { esc } from './arrayview.js';

const bits = (src, what) => {
  const s = String(src ?? '').replace(/[\s_]/g, '');
  if (!/^[01]+$/.test(s)) throw new Error(`${what}写成一串 0 和 1（现在是「${src}」）`);
  return s;
};

// 生成多项式：10011，或者 x^4 + x + 1
export function parseGen(src) {
  const s = String(src ?? '').trim();
  if (/^[01\s_]+$/.test(s)) {
    const g = bits(s, 'gen: ');
    if (g[0] !== '1' || g.length < 2) throw new Error('gen: 最高位要是 1，至少两位（比如 10011）');
    return g;
  }
  const terms = s.replace(/\s+/g, '').replace(/X/g, 'x').split('+').filter(Boolean);
  if (!terms.length) throw new Error('gen: 写成 10011 或 x^4 + x + 1');
  const pow = terms.map((t) => {
    if (t === '1') return 0;
    if (t === 'x') return 1;
    const m = /^x\^(\d+)$/.exec(t);
    if (!m) throw new Error(`gen: 看不懂「${t}」（写成 x^4 + x + 1）`);
    return Number(m[1]);
  });
  const r = Math.max(...pow);
  return Array.from({ length: r + 1 }, (_, i) => (pow.includes(r - i) ? '1' : '0')).join('');
}

// —— CRC ——

function crcParse(fields) {
  const gen = parseGen(fields.gen ?? fields.poly);
  const r = gen.length - 1;
  if (fields.recv !== undefined) {
    const recv = bits(fields.recv, 'recv: ');
    if (recv.length <= r) throw new Error(`recv: 收到的帧要比 r = ${r} 位长`);
    return { gen, r, recv, mode: 'check', zeros: 0 };
  }
  const data = bits(fields.data, 'data: ');
  if (data.length > 24) throw new Error('data: 最多 24 位（一屏放得下）');
  return { gen, r, data, mode: 'send', zeros: r };
}

// 模 2 除法：逐位往下，最高位是 1 就异或 G。返回每一次异或（位置、异或前后的那几位）、商、余数
export function mod2div(dividend, gen) {
  const r = gen.length - 1;
  const a = dividend.split('');
  const ops = [];
  const q = [];
  for (let i = 0; i + r < a.length; i++) {
    if (a[i] === '1') {
      const before = a.slice(i, i + r + 1).join('');
      for (let k = 0; k <= r; k++) a[i + k] = a[i + k] === gen[k] ? '0' : '1';
      ops.push({ at: i, before, after: a.slice(i, i + r + 1).join(''), rest: a.join('') });
      q.push('1');
    } else q.push('0');
  }
  return { ops, quotient: q.join(''), rem: a.slice(a.length - r).join('') };
}

function crcRun(input) {
  const { gen, r } = input;
  const steps = [];
  const genText = genPoly(gen);
  if (input.mode === 'check') {
    const d = mod2div(input.recv, gen);
    steps.push({ view: { div: input.recv, gen, ops: [], cur: -1 }, msg: `收到的帧 ${input.recv} 直接除以 G = ${gen}（${genText}）：余数是 0 就是没检出错。` });
    d.ops.forEach((o, k) => steps.push({ view: { div: input.recv, gen, ops: d.ops.slice(0, k + 1), cur: k }, msg: `第 ${k + 1} 次：从第 ${o.at + 1} 位起的 ${o.before} 异或 ${gen}，得 ${o.after}。` }));
    const ok = /^0+$/.test(d.rem);
    steps.push({ view: { div: input.recv, gen, ops: d.ops, cur: -1, rem: d.rem, done: true }, msg: `余数 ${d.rem}：${ok ? '是 0，没有检测到差错' : '不是 0，传输出错了'}。`, ask: { tag: 'ok', kind: 'choice', q: '这一帧检测出差错了吗？', choices: ['没有差错', '有差错'], answer: ok ? '没有差错' : '有差错' } });
    return { steps, rem: d.rem, ops: d.ops, ok };
  }
  const zeros = input.zeros;
  const dividend = input.data + '0'.repeat(zeros);
  const d = mod2div(dividend, gen);
  // 余数取最后 r 位（补的 0 个数错了的错法照样取 r 位）
  const rem = d.rem;
  steps.push({ view: { data: input.data, gen, ops: [], cur: -1 }, msg: `信息 M = ${input.data}，生成多项式 G(x) = ${genText}（${gen}，${r} 阶，${r + 1} 位）。` });
  steps.push({ view: { div: dividend, gen, ops: [], cur: -1, pad: zeros }, msg: `G 是 ${r} 阶：在 M 后面补 ${r} 个 0，得到被除数 ${dividend}。`, ask: { tag: 'zeros', kind: 'number', q: '要在信息后面补几个 0？', answer: r } });
  d.ops.forEach((o, k) => steps.push({
    view: { div: dividend, gen, ops: d.ops.slice(0, k + 1), cur: k, pad: zeros },
    msg: `第 ${k + 1} 次：从第 ${o.at + 1} 位起的 ${o.before} 最高位是 1，异或 ${gen}（模 2 减，不借位），得 ${o.after}；商这一位是 1。${k === 0 && d.quotient.startsWith('0') ? '（前面最高位是 0 的位置商 0，直接往后移。）' : ''}`,
    ask: { tag: 'xor', kind: 'text', q: `第 ${k + 1} 次：${o.before} 异或 ${gen} 得多少？（${r + 1} 位）`, answer: o.after },
  }));
  const frame = input.data + rem;
  steps.push({ view: { div: dividend, gen, ops: d.ops, cur: -1, pad: zeros, rem, done: true }, msg: `最后剩下的 ${r} 位 ${rem} 就是余数（校验码 FCS）；商是 ${d.quotient}。`, ask: { tag: 'rem', kind: 'text', q: `余数（${r} 位校验码）是多少？`, answer: rem } });
  steps.push({ view: { div: dividend, gen, ops: d.ops, cur: -1, pad: zeros, rem, done: true, frame }, msg: `发送的帧 = M 后面接上余数：${input.data} ${rem}。接收方用它除以 G，余数是 0 就认为没出错。`, ask: { tag: 'frame', kind: 'text', q: '发送出去的帧是什么？', answer: frame } });
  return { steps, rem, frame, ops: d.ops, quotient: d.quotient };
}

function genPoly(gen) {
  const r = gen.length - 1;
  const t = [];
  for (let i = 0; i <= r; i++) if (gen[i] === '1') { const p = r - i; t.push(p === 0 ? '1' : p === 1 ? 'x' : `x^${p}`); }
  return t.join(' + ');
}

// 竖式：被除数一排格子，每一次异或写在它下面（对齐到异或的那几位），当前这一次亮着
function crcView(s, input) {
  const g = s.gen;
  if (!s.div) return `<div class="cc-head"><span class="cc-k">M</span><span class="cc-bits">${bitRow(s.data)}</span><span class="cc-k">G</span><span class="cc-bits">${bitRow(g)}</span></div>`;
  const L = s.div.length;
  const row = (str, off, cls = '', label = '', cmd = '') => `<div class="cc-row ${cls}"${cmd ? ` data-cmd="${cmd}"` : ''}><span class="cc-lbl">${esc(label)}</span>${Array.from({ length: L }, (_, j) => {
    const c = j >= off && j < off + str.length ? str[j - off] : '';
    const pad = s.pad && j >= L - s.pad ? ' cc-pad' : '';
    return `<span class="cc-b${c ? '' : ' cc-e'}${pad}">${c}</span>`;
  }).join('')}</div>`;
  let h = `<div class="cc-div">${row(s.div, 0, 'cc-top', input.mode === 'check' ? '收到' : '被除数')}`;
  s.ops.forEach((o, k) => {
    const live = k === s.cur ? ' cc-cur' : '';
    h += row(g, o.at, `cc-g${live}`, '⊕', String(k + 1));
    h += row(o.after, o.at, `cc-r${live}`, '');
  });
  if (s.rem !== undefined) h += row(s.rem, L - s.rem.length, 'cc-rem', '余数');
  h += '</div>';
  if (s.frame) h += `<div class="cc-head"><span class="cc-k">发送</span><span class="cc-bits">${bitRow(s.frame, s.frame.length - (input.r || 0))}</span></div>`;
  return h;
}
const bitRow = (str, split = -1) => [...str].map((c, i) => `<span class="cc-b${i === split ? ' cc-split' : ''}">${c}</span>`).join('');

function crcTable(input, r) {
  if (input.mode === 'check') return null;
  return {
    q: '一步步做模 2 除法：每一次异或之后那几位是什么；最后写余数和发送的帧。', qhtml: '', dir: 'row',
    head: ['异或以后'],
    rows: r.ops.map((o, k) => ({ label: `第 ${k + 1} 次（${o.before} ⊕ ${input.gen}）`, cells: [{ v: o.after }] })),
    extra: [{ label: '余数', v: r.rem }, { label: '发送的帧', v: r.frame }],
  };
}

export const crcEngine = {
  name: 'crc', title: 'CRC 循环冗余校验', parse: crcParse, run: crcRun, view: crcView, table: crcTable,
  quiz(input, r) {
    if (input.mode === 'check') return { q: '这一帧检测出差错了吗？写「有」或「没有」。', type: 'seq', answer: r.ok ? '没有' : '有' };
    return { q: `求余数（${input.r} 位校验码）。`, type: 'seq', answer: [...r.rem].join(' ') + ' | ' + r.rem };
  },
  // 常见错法：信息后面没补 0、补了 r + 1 个（把 G 的位数当成了阶数）
  variants(input) {
    if (input.mode === 'check') return [];
    const out = [];
    const right = crcRun(input).rem;
    for (const [z, label] of [[0, '像是信息后面没补 0 就直接除了（王道：G 是 r 阶，先在 M 后面补 r 个 0）'], [input.r + 1, '像是补了 r + 1 个 0（把 G 的位数当成了阶数：G 有 r + 1 位，r 阶）']]) {
      try { const v = { ...input, zeros: z }; if (crcRun(v).rem !== right) out.push({ label, input: v }); } catch { /* 算不了就不列 */ }
    }
    return out;
  },
};

// —— 海明码 ——

const isPow2 = (x) => (x & (x - 1)) === 0;

function hamParse(fields) {
  const odd = /^(odd|奇)/i.test(String(fields.parity || '').trim());
  if (fields.recv !== undefined) {
    const recv = bits(fields.recv, 'recv: ');
    const N = recv.length;
    let k = 0;
    while (2 ** k < N + 1) k++;
    if (N > 31) throw new Error('recv: 最多 31 位');
    return { mode: 'check', recv, N, k, odd, swap: false };
  }
  const data = bits(fields.data, 'data: ');
  if (data.length > 16) throw new Error('data: 信息位最多 16 位');
  return { mode: 'send', data, odd, swap: false };
}

// 位置 → 这一位是谁：P1、P2、D1……
function layout(n, k) {
  const N = n + k;
  const at = [];
  let d = 0, p = 0;
  for (let pos = 1; pos <= N; pos++) at[pos] = isPow2(pos) ? { kind: 'P', i: ++p } : { kind: 'D', i: ++d };
  return at;
}

function hamRun(input) {
  const steps = [];
  const par = input.odd ? '奇' : '偶';
  if (input.mode === 'check') {
    const { recv, N, k } = input;
    const H = (pos) => Number(recv[N - pos]);
    const at = layout(N - k, k);
    steps.push({ view: { N, at, vals: [...recv].reverse().map(Number), show: true }, msg: `收到 ${recv}（H${N} … H1），校验位在 H1、H2、H4…。每个校验组重新算一遍${par}校验，得到 S${k} … S1。` });
    const S = [];
    for (let i = 1; i <= k; i++) {
      const cover = Array.from({ length: N }, (_, j) => j + 1).filter((pos) => pos & (1 << (i - 1)));
      let x = cover.reduce((acc, pos) => acc ^ H(pos), 0);
      if (input.odd) x ^= 1;
      if (input.swap) x ^= 1;
      S.push(x);
      steps.push({ view: { N, at, vals: [...recv].reverse().map(Number), show: true, cover, S: S.slice() }, msg: `S${i} = ${cover.map((p) => `H${p}`).join(' ⊕ ')}${input.odd ? ' ⊕ 1' : ''} = ${x}。`, ask: { tag: 's', kind: 'number', q: `S${i} 是多少？`, answer: x } });
    }
    const pos = S.reduce((acc, b, i) => acc + (b << i), 0);
    const fixed = pos ? [...recv].map((c, j) => (N - j === pos ? (c === '1' ? '0' : '1') : c)).join('') : recv;
    steps.push({ view: { N, at, vals: [...fixed].reverse().map(Number), show: true, S, err: pos }, msg: pos ? `S${k}…S1 = ${S.slice().reverse().join('')} = ${pos}：H${pos} 出错了，取反改正：${fixed}。` : `S 全是 0：没有出错。`, ask: { tag: 'pos', kind: 'number', q: '第几位出错了？（没出错写 0）', answer: pos } });
    return { steps, S, pos, fixed };
  }
  const n = input.data.length;
  let k = 0;
  while (2 ** k < n + k + 1) k++;
  const N = n + k;
  const at = layout(n, k);
  // 信息写成 D_n … D_1（左边是高位）：D1 是最右边那一位
  const D = [...input.data].reverse().map(Number);
  const vals = [];
  const order = input.reverse ? D.slice().reverse() : D;
  for (let pos = 1; pos <= N; pos++) if (at[pos].kind === 'D') vals[pos - 1] = order[at[pos].i - 1];
  steps.push({ view: { data: input.data }, msg: `信息位 ${input.data}（D${n} … D1），${n} 位。` });
  steps.push({ view: { N, at, vals: vals.slice() }, msg: `校验位个数 k 满足 2^k ≥ n + k + 1：n = ${n}，k = ${k}（2^${k} = ${2 ** k} ≥ ${n + k + 1}），一共 ${N} 位。校验位放在 H1、H2、H4…（2 的幂的位置），信息位按顺序放在其余的位置。`, ask: { tag: 'k', kind: 'number', q: '要几个校验位？', answer: k } });
  const P = [];
  for (let i = 1; i <= k; i++) {
    const self = 2 ** (i - 1);
    const cover = Array.from({ length: N }, (_, j) => j + 1).filter((pos) => pos !== self && pos & self);
    let x = cover.reduce((acc, pos) => acc ^ (vals[pos - 1] ?? 0), 0);
    if (input.odd !== !!input.swap) x ^= 1;
    vals[self - 1] = x;
    P.push(x);
    steps.push({ view: { N, at, vals: vals.slice(), cover, self }, msg: `P${i} 在 H${self}，管位置编号第 ${i} 位是 1 的那些：P${i} = ${cover.map((p) => `H${p}`).join(' ⊕ ')}${input.odd ? ' ⊕ 1' : ''} = ${x}（${par}校验）。`, ask: { tag: 'p', kind: 'number', q: `P${i} 是多少？`, answer: x } });
  }
  const code = vals.slice().reverse().join('');
  steps.push({ view: { N, at, vals: vals.slice(), done: true }, msg: `海明码 H${N} … H1 = ${code}。`, ask: { tag: 'code', kind: 'text', q: `写出海明码（H${N} … H1，从左往右）。`, answer: code } });
  return { steps, P, code, k, N };
}

function hamView(s) {
  if (s.data) return `<div class="cc-head"><span class="cc-k">信息</span><span class="cc-bits">${bitRow(s.data)}</span></div>`;
  const cover = new Set(s.cover || []);
  let h = '<div class="hm-row">';
  for (let pos = s.N; pos >= 1; pos--) {
    const a = s.at[pos];
    const v = s.vals[pos - 1];
    const cls = [a.kind === 'P' ? 'hm-p' : 'hm-d', cover.has(pos) ? 'hm-cover' : '', s.self === pos ? 'hm-self' : '', s.err === pos ? 'hm-err' : ''].filter(Boolean).join(' ');
    h += `<div class="hm-c ${cls}" data-cmd="${pos}" data-key="h${pos}"><span class="hm-h">H${pos}</span><span class="hm-v">${v === undefined ? '' : v}</span><span class="hm-n">${a.kind}${a.i}</span></div>`;
  }
  h += '</div>';
  if (s.S) h += `<div class="hm-s">S${s.S.length} … S1 = ${s.S.slice().reverse().join(' ')}</div>`;
  return h;
}

export const hammingEngine = {
  name: 'hamming', title: '海明码', parse: hamParse, run: hamRun, view: hamView,
  quiz(input, r) {
    if (input.mode === 'check') return { q: '第几位出错了？（没出错写 0）', type: 'num', answer: String(r.pos) };
    return { q: '写出海明码（从左往右是 H_n … H_1）。', type: 'seq', answer: `${r.code} | ${[...r.code].join(' ')}` };
  },
  table(input, r) {
    if (input.mode === 'check') return { q: '每个校验组重新算一遍，写出 S1、S2…，最后写出错的位置（没出错写 0）。', qhtml: '', dir: 'row', head: ['值'], rows: r.S.map((x, i) => ({ label: `S${i + 1}`, cells: [{ v: String(x), num: true }] })), extra: [{ label: '出错的位置', v: String(r.pos), num: true }] };
    return { q: '写出每个校验位，最后写出整个海明码（H_n … H_1）。', qhtml: '', dir: 'row', head: ['值'], rows: r.P.map((x, i) => ({ label: `P${i + 1}`, cells: [{ v: String(x), num: true }] })), extra: [{ label: '海明码', v: r.code }] };
  },
  // 常见错法：奇偶校验弄反、信息位从高位开始往 H3 放（王道：D1 放在 H3）
  variants(input) {
    const out = [];
    const sig = (x) => JSON.stringify(x.mode === 'check' ? [x.S, x.pos] : [x.P, x.code]);
    const right = sig(hamRun(input));
    const cand = [[{ ...input, swap: true }, input.odd ? '像是用了偶校验（这题是奇校验：每组 1 的个数是奇数）' : '像是用了奇校验（王道默认偶校验：每组 1 的个数是偶数）']];
    if (input.mode === 'send') cand.push([{ ...input, reverse: true }, '像是信息位从最高位 D_n 开始往 H3 放了（王道：D1 放在 H3，往高位依次放）']);
    for (const [v, label] of cand) if (sig(hamRun(v)) !== right) out.push({ label, input: v });
    return out;
  },
};

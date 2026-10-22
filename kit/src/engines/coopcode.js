// 组成原理的指令格式与扩展操作码：opcode（指令字长、地址码位数、每一类指令要几条 → 一类一类地分操作码；
// 或者问某一类最多几条、指令字长至少几位）。
// 口径按王道：地址码多的先分（三地址 → 二地址 → 一地址 → 零地址）；每一类从小往大用编码，剩下最大的几个留作「扩展窗口」，
// 后面接上空出来的地址码位数，就是下一类能用的编码：可用 = 上一类剩下的个数 × 2^扩展位数；短码不能是长码的前缀。
// 纯函数（tests/co2-engine.test.js）。
import { esc } from './arrayview.js';
import { keepDiffering } from './coea.js';

const CLS = { 三: 3, 3: 3, 二: 2, 两: 2, 2: 2, 一: 1, 单: 1, 1: 1, 零: 0, 无: 0, 0: 0 };
const CNAME = ['零地址', '一地址', '二地址', '三地址', '四地址'];

function parse(fields) {
  const lenSrc = String(fields.len ?? '').trim();
  const findLen = /^[?？]$/.test(lenSrc);
  const len = findLen ? null : Number(lenSrc);
  if (!findLen && !(Number.isInteger(len) && len >= 4 && len <= 64)) throw new Error('len: 指令字长（位数，4～64）；要求「指令字长至少几位」时写 len: ?');
  const a = Number(String(fields.addr ?? '').trim());
  if (!(Number.isInteger(a) && a >= 1 && a <= 16)) throw new Error('addr: 每个地址码几位（1～16）');
  if (fields.need === undefined || !String(fields.need).trim()) throw new Error('opcode 要写 need:（每一类要几条），比如 need: 三地址 15, 二地址 15, 一地址 15, 零地址 16；问最多几条的那一类写 ?');
  const classes = [];
  for (const part of String(fields.need).split(/[,，;；、\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^([三二两一单零无0-3])\s*(?:地址)?(?:指令)?\s*[:：=]?\s*(\d+|[?？]|max|最多)\s*条?$/i.exec(part);
    if (!m) throw new Error(`need: 一项写成「三地址 15」（问最多几条的写「一地址 ?」），现在有「${part}」`);
    const n = CLS[m[1]];
    if (classes.some((c) => c.n === n)) throw new Error(`need: ${CNAME[n]}写了两次`);
    const cnt = /^\d+$/.test(m[2]) ? Number(m[2]) : null;
    if (cnt === 0) throw new Error(`need: ${CNAME[n]} 0 条就不用写`);
    classes.push({ n, cnt });
  }
  classes.sort((x, y) => y.n - x.n);
  const unknown = classes.filter((c) => c.cnt === null).length;
  if (unknown > 1) throw new Error('need: 一次只能问一类最多几条（只写一个 ?）');
  if (unknown && findLen) throw new Error('len: ? 和 need: 里的 ? 不能同时写：先定下每一类几条，才能求指令字长');
  const unit = fields.unit === undefined || fields.unit === '' ? 0 : Number(fields.unit);
  if (unit && !(findLen && [8, 16, 32].includes(unit))) throw new Error(findLen ? 'unit: 编址单位的位数：8（按字节编址）、16 或 32' : 'unit: 只在 len: ? 时有用（指令字长凑成编址单位的整数倍）');
  const input = { len, findLen, a, classes, unit, mistake: '' };
  if (findLen) {
    const tries = minLen(input);
    if (!tries.length || !tries.at(-1).ok) throw new Error('这几类指令放不下：指令字长到 64 位也不够');
  } else {
    const p = plan(len, input);
    if (!p.ok) throw new Error(`这几类指令放不下：${p.why}`);
  }
  return input;
}

const pow2 = (k) => 2 ** k;
const bin = (v, w) => v.toString(2).padStart(w, '0');

/**
 * 按指令字长 L 一类一类地分编码。rows：[{ n, cnt, opLen, ext（比上一类多出来的操作码位数）, avail, reserve（要给后面留的前缀数）, max?, left, start, end }]
 * ok = false 时 why 是放不下的原因
 */
export function plan(L, input) {
  const { a, classes, mistake } = input;
  const rows = classes.map((c, i) => ({ ...c, opLen: L - c.n * a, ext: i ? (classes[i - 1].n - c.n) * a : 0 }));
  if (rows[0].opLen < 1) return { ok: false, rows, why: `${CNAME[rows[0].n]}的 ${rows[0].n} 个地址码就占了 ${rows[0].n * a} 位，操作码没地方了（指令字长只有 ${L} 位）` };
  // 从后往前：第 j 类往后一共要占几个第 j 级的编码（自己的条数 + 给更后面留的前缀）
  const need = Array(rows.length).fill(0);
  for (let j = rows.length - 1; j >= 0; j--) {
    const later = j < rows.length - 1 ? Math.ceil(need[j + 1] / pow2(rows[j + 1].ext)) : 0;
    rows[j].reserve = later;
    need[j] = (rows[j].cnt ?? 0) + later;
  }
  let start = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // 错法 noMul：扩展时只算了新接上的 2^e 个，忘了乘上一类剩下的个数
    r.avail = i === 0 ? pow2(r.opLen) : mistake === 'noMul' ? pow2(r.ext) : rows[i - 1].left * pow2(r.ext);
    if (i > 0) start = (rows[i - 1].end + 1) * pow2(r.ext);
    let reserve = r.reserve;
    if (mistake === 'noReserve' && i < rows.length - 1) reserve = 0; // 错法：中间那一类把编码用光，没给后面留前缀
    if (mistake === 'lastReserve' && i === rows.length - 1) reserve = 1; // 错法：最后一类也留了一个编码
    if (r.cnt === null) { r.max = r.avail - reserve; r.cnt = r.max; r.unknown = true; }
    // 按错法算时不拦：要的就是那种做法算出来的数（拿来和学生写的比）
    if (!mistake && (r.cnt < (r.unknown ? 1 : 0) || r.cnt > r.avail)) return { ok: false, rows, why: `${CNAME[r.n]}要 ${r.unknown ? '至少 1' : r.cnt} 条，只有 ${r.avail} 个编码${i ? `（上一类剩 ${rows[i - 1].left} 个 × 2^${r.ext}）` : `（操作码 ${r.opLen} 位）`}` };
    r.left = r.avail - r.cnt;
    r.start = start;
    r.end = start + r.cnt - 1;
    if (!mistake && i < rows.length - 1 && r.left < 1) return { ok: false, rows, why: `${CNAME[r.n]}用掉了全部 ${r.avail} 个编码，后面的${CNAME[rows[i + 1].n]}没有前缀可用` };
  }
  return { ok: true, rows };
}

// 指令字长至少几位：操作码从放得下第一类的位数开始一位一位试
function minLen(input) {
  const { a, classes } = input;
  const base = classes[0].n * a;
  const tries = [];
  const k0 = Math.max(1, Math.ceil(Math.log2(classes[0].cnt + (classes.length > 1 ? 1 : 0))) - 1);
  for (let k = k0; base + k <= 64; k++) {
    const p = plan(base + k, { ...input, mistake: '' });
    tries.push({ k, L: base + k, ok: p.ok, why: p.why, p });
    if (p.ok) break;
  }
  return tries;
}

// 编码按「第一类的操作码 | 每次扩展的几位」分组，和王道写的「1111 0000」一样
function codeText(v, rows, i) {
  const s = bin(v, rows[i].opLen);
  const cuts = [rows[0].opLen, ...rows.slice(1, i + 1).map((r) => r.ext)];
  const out = [];
  let p = 0;
  for (const c of cuts) { if (c) out.push(s.slice(p, p + c)); p += c; }
  return out.join(' ');
}
const rangeText = (r, rows, i) => (r.cnt === 1 ? codeText(r.start, rows, i) : `${codeText(r.start, rows, i)}～${codeText(r.end, rows, i)}`);
// 范围的几种写法：分组或不分组，～ / ~ / - / 至，前后有没有空格（判分时按空格切开，所以每种都要列）
function rangeAlts(r, rows, i) {
  const out = new Set();
  const pairs = [[codeText(r.start, rows, i), codeText(r.end, rows, i)], [bin(r.start, r.opLen), bin(r.end, r.opLen)], [bin(r.start, r.opLen).replace(/(.{4})(?=.)/g, '$1 '), bin(r.end, r.opLen).replace(/(.{4})(?=.)/g, '$1 ')]];
  for (const [x, y] of pairs) for (const sep of ['～', '-', '至', '到']) for (const sp of ['', ' ']) out.add(r.cnt === 1 ? x : `${x}${sp}${sep}${sp}${y}`);
  return [...out].join(' | ');
}

function run(input) {
  const steps = [];
  const { a } = input;
  let L = input.len;
  const need = input.classes.map((c) => `${CNAME[c.n]}${c.cnt === null ? '最多几条' : ` ${c.cnt} 条`}`).join('、');
  steps.push({ view: { stage: 'start', i: -1, L }, msg: `${input.findLen ? '指令字长待定' : `指令字长 ${L} 位`}，每个地址码 ${a} 位；要${need}。用扩展操作码：地址码多的先分，每一类从小往大用编码，剩下的编码留作前缀，接上空出来的地址码位数给下一类用。` });
  let tries = [];
  if (input.findLen) {
    tries = minLen(input);
    const c0 = input.classes[0];
    tries.forEach((t, j) => {
      const last = j === tries.length - 1;
      steps.push({ view: { stage: 'len', tries: tries.slice(0, j + 1), i: -1 }, msg: `操作码 ${t.k} 位（指令 ${c0.n} × ${a} + ${t.k} = ${t.L} 位）：${t.ok ? `${CNAME[c0.n]}有 2^${t.k} = ${pow2(t.k)} 个编码，${t.p.rows.map((r, i) => (i ? `剩 ${t.p.rows[i - 1].left} 个 × 2^${r.ext} = ${r.avail} 个给${CNAME[r.n]}（要 ${r.cnt}）` : `用 ${r.cnt} 个`)).join('，')}：放得下。` : `放不下：${t.why}。`}${last && !input.unit ? `指令字长至少 ${t.L} 位。` : ''}`, ask: last && !input.unit ? { tag: 'len', kind: 'number', q: '指令字长至少几位？', answer: t.L } : undefined });
    });
    L = tries.at(-1).L;
    const raw = L;
    if (input.unit) {
      if (input.mistake !== 'noRound') L = Math.ceil(L / input.unit) * input.unit;
      steps.push({ view: { stage: 'len', tries, i: -1, L }, msg: `至少 ${raw} 位；按 ${input.unit} 位一个编址单位，指令字长要凑成 ${input.unit} 的整数倍：${L} 位。`, ask: { tag: 'len', kind: 'number', q: `指令字长至少几位（要是 ${input.unit} 的整数倍）？`, answer: L } });
    }
  }
  const { rows } = plan(L, input);
  rows.forEach((r, i) => {
    const name = CNAME[r.n];
    const fmt = r.n ? `${r.n} 个地址码占 ${r.n} × ${a} = ${r.n * a} 位，` : '没有地址码，';
    steps.push({ view: { stage: 'avail', i, L, tries }, msg: i === 0
      ? `${name}指令：${fmt}操作码 ${L} − ${r.n * a} = ${r.opLen} 位，一共 2^${r.opLen} = ${r.avail} 个编码。`
      : `${name}指令：${fmt}操作码 ${r.opLen} 位，比上一类多 ${r.ext} 位。上一类剩下的 ${rows[i - 1].left} 个编码作前缀，每个后面再接 ${r.ext} 位：${rows[i - 1].left} × 2^${r.ext} = ${r.avail} 个编码。`,
    ask: { tag: 'avail', kind: 'number', q: i === 0 ? `${name}指令的操作码有几位、一共几个编码？（写编码个数）` : `${name}指令一共有几个编码可以用？`, answer: r.avail } });
    const range = rangeText(r, rows, i);
    if (r.unknown) {
      const keep = r.reserve;
      steps.push({ view: { stage: 'range', i, L, tries }, msg: i < rows.length - 1
        ? `后面还要${rows.slice(i + 1).map((x) => `${CNAME[x.n]} ${x.cnt} 条`).join('、')}：至少要留 ${keep} 个编码作前缀（每个前缀能扩展出 2^${rows[i + 1].ext} = ${pow2(rows[i + 1].ext)} 个）。所以${name}最多 ${r.avail} − ${keep} = ${r.max} 条：${range}。`
        : `${name}是最后一类，不用再给别人留前缀，${r.avail} 个编码全能用：最多 ${r.max} 条，${range}。`,
      ask: { tag: 'max', kind: 'number', q: `${name}指令最多有几条？`, answer: r.max }, asks: [{ tag: 'range', kind: 'text', q: `${name}指令的操作码范围是？（写成「第一个～最后一个」）`, answer: rangeAlts(r, rows, i) }] });
    } else {
      steps.push({ view: { stage: 'range', i, L, tries }, msg: `${name}用 ${r.cnt} 个，从小往大：${range}。`, ask: { tag: 'range', kind: 'text', q: `${name}指令的操作码范围是？（写成「第一个～最后一个」，二进制）`, answer: rangeAlts(r, rows, i) } });
    }
    if (i < rows.length - 1) {
      steps.push({ view: { stage: 'left', i, L, tries }, msg: `${name}用了 ${r.cnt} 个，剩 ${r.avail} − ${r.cnt} = ${r.left} 个编码（${r.left === 1 ? codeText(r.end + 1, rows, i) : `${codeText(r.end + 1, rows, i)}～${codeText(r.start + r.avail - 1, rows, i)}`}），留作下一类的前缀。`, ask: { tag: 'left', kind: 'number', q: `${name}用完以后，还剩几个编码可以拿去扩展？`, answer: r.left } });
    }
  });
  const u = rows.find((r) => r.unknown);
  steps.push({ view: { stage: 'done', i: rows.length, L, tries }, msg: `分完了：${rows.map((r, i) => `${CNAME[r.n]} ${r.cnt} 条（${rangeText(r, rows, i)}）`).join('；')}。${u ? `${CNAME[u.n]}最多 ${u.max} 条。` : ''}没有一个短码是长码的前缀。` });
  return { steps, rows, L, tries, max: u?.max ?? null };
}

function view(st, input) {
  const L = st.L ?? input.len;
  let h = `<div class="oc-head"><span class="oc-chip">指令字长 <b>${L ?? '?'}</b> 位</span><span class="oc-chip">地址码 <b>${input.a}</b> 位</span></div>`;
  if (st.tries?.length && (st.stage === 'len' || st.stage === 'start')) {
    h += `<div class="oc-tries">${st.tries.map((t) => `<div class="oc-try ${t.ok ? 'oc-ok' : 'oc-no'}">操作码 ${t.k} 位 → 字长 ${t.L} 位：${t.ok ? '放得下' : '放不下'}</div>`).join('')}</div>`;
  }
  if (L === null || L === undefined || st.stage === 'len' || st.stage === 'start') {
    // 还没定字长 / 刚开始：只列要求
    h += `<div class="oc-need">${input.classes.map((c) => `<span class="oc-chip">${CNAME[c.n]} <b>${c.cnt ?? '?'}</b> 条</span>`).join('')}</div>`;
    return h;
  }
  const { rows } = plan(L, input);
  const lvl = { avail: 1, range: 2, left: 3 };
  h += '<div class="oc-rows">';
  rows.forEach((r, i) => {
    if (i > st.i && st.stage !== 'done') return;
    const now = i === st.i ? lvl[st.stage] || 0 : 9;
    const fields = [{ name: 'OP', bits: r.opLen, cls: 'oc-op' }, ...Array.from({ length: r.n }, (_, k) => ({ name: `A${r.n === 1 ? '' : k + 1}`, bits: input.a, cls: 'oc-ad' }))];
    const bar = `<div class="oc-bar">${fields.map((f) => `<span class="oc-f ${f.cls}" style="flex: ${f.bits} 1 0"><b>${f.name}</b><small>${f.bits} 位</small></span>`).join('')}</div>`;
    const range = now >= 2 ? `<div class="oc-range">${esc(rangeText(r, rows, i))}</div>` : '';
    const nums = [`可用 ${now >= 1 ? r.avail : '?'}`, `用 ${now >= 2 ? r.cnt : r.unknown ? '?' : r.cnt}`, ...(i < rows.length - 1 ? [`剩 ${now >= 3 ? r.left : '?'}`] : [])];
    h += `<div class="oc-row${i === st.i ? ' oc-cur' : ''}" data-cmd="${i + 1}" data-label="${CNAME[r.n]}"><div class="oc-name">${CNAME[r.n]}<small>${r.unknown && now < 2 ? '最多几条？' : `${r.cnt} 条`}</small></div>${bar}<div class="oc-nums">${nums.map((x) => `<span>${x}</span>`).join('')}</div>${range}</div>`;
  });
  return `${h}</div>`;
}

export const opcodeEngine = {
  name: 'opcode', title: '扩展操作码', parse, run, view,
  quiz(input, r) {
    if (r.max !== null) { const u = r.rows.find((x) => x.unknown); return { qhtml: view({ stage: 'start', i: -1, L: input.len }, input), q: `${CNAME[u.n]}指令最多有几条？`, type: 'num', answer: String(r.max) }; }
    if (input.findLen) return { qhtml: view({ stage: 'start', i: -1, L: null }, input), q: `指令字长至少几位${input.unit ? `（按 ${input.unit} 位一个编址单位）` : ''}？`, type: 'num', answer: String(r.L) };
    const last = r.rows.at(-1);
    return { qhtml: view({ stage: 'start', i: -1, L: input.len }, input), q: `按「从小往大用、剩下的留作前缀」分，${CNAME[last.n]}指令的第一个操作码是什么？（写二进制，${last.opLen} 位）`, type: 'bin', width: last.opLen, answer: `0b${bin(last.start, last.opLen)}` };
  },
  table(input, r) {
    return {
      q: '一类一类地填：操作码几位、一共几个编码可用、几条，第一个和最后一个操作码（二进制）。', dir: 'row',
      head: ['操作码位数', '可用编码数', '条数', '第一个', '最后一个'],
      rows: r.rows.map((x) => ({ label: CNAME[x.n], cells: [{ v: String(x.opLen), num: true }, { v: String(x.avail), num: true }, { v: String(x.cnt), num: true, given: !x.unknown }, { v: bin(x.start, x.opLen) }, { v: bin(x.end, x.opLen) }] })),
      extra: input.findLen ? [{ label: '指令字长', v: String(r.L), num: true }] : undefined,
    };
  },
  // 常见错法：扩展时忘了乘剩下的个数；中间那一类没给后面留前缀；最后一类也留了一个；指令字长没凑成编址单位的整数倍
  variants(input) {
    const list = [
      ['noMul', '像是扩展时只算了新接上的 2^e 个编码，忘了乘上一类剩下的个数'],
      ['noReserve', '像是把编码用光了，没给后面的指令留前缀'],
      ['lastReserve', '像是最后一类也留了一个编码（最后一类不用再扩展，编码全能用）'],
      ['noRound', '像是没把指令字长凑成编址单位的整数倍'],
    ].map(([m, label]) => ({ label, input: { ...input, mistake: m } }));
    return keepDiffering(opcodeEngine, input, list);
  },
};

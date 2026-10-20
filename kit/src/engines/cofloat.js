// 组成原理的浮点加减运算：fadd（对阶、尾数加减、规格化、舍入、溢出判断）。
// 口径按王道 / 唐朔飞：阶码和尾数都用补码、双符号位（变形补码）；小阶向大阶看齐，小阶的尾数算术右移，移出去的位先留着（括号里），
// 规格化以后按 0 舍 1 入（或截断）舍掉；尾数补码规格化的样子是 00.1×× 或 11.0××；阶码的两个符号位不一样就是溢出（01 上溢，10 下溢）。
// 尾数按定点小数精确算（BigInt，分母 2^F），不会有浮点误差。纯函数（tests/cofloat-engine.test.js）。
import { esc } from './arrayview.js';

const F = 96; // 尾数的分母 2^F：对阶最多移几十位，留足了不丢位
const ONE = 1n << BigInt(F);

// 「2^010 × 0.11011011」「2^{-100}×(−0.10101100)」「-0.1011 × 2^-11」→ { e, m（分子，分母 2^F）, eb, mb, text }
export function parseTerm(src, what) {
  const s = String(src ?? '').replace(/\s+/g, '').replace(/[−–—]/g, '-').replace(/[{}]/g, '');
  const em = /2\^\(?([+-]?)([01]+)\)?/.exec(s);
  const rest = em ? s.replace(em[0], '').replace(/[×xX*·()]/g, '') : '';
  const mm = /^([+-]?)0\.([01]+)$/.exec(rest);
  if (!em || !mm) throw new Error(`${what}写成「2^阶码 × 尾数」，阶码、尾数都是二进制真值，比如 2^010 × 0.11011011、2^-100 × (-0.10101100)（现在是「${src}」）`);
  const e = (em[1] === '-' ? -1 : 1) * parseInt(em[2], 2);
  const mag = (BigInt(`0b${mm[2]}`) << BigInt(F)) >> BigInt(mm[2].length);
  return { e, m: mm[1] === '-' ? -mag : mag, eb: em[2].length, mb: mm[2].length, tex: `2^{${em[1]}${em[2]}}\\times ${mm[1] === '-' ? '(-' : ''}0.${mm[2]}${mm[1] === '-' ? ')' : ''}` };
}

function parse(fields) {
  const x = parseTerm(fields.x, 'x: ');
  const y = parseTerm(fields.y, 'y: ');
  const opSrc = String(fields.op ?? '+').trim();
  if (!/^(\+|-|−|add|sub|加|减)$/i.test(opSrc)) throw new Error(`op: 写 +（加）或 -（减）（现在是「${opSrc}」）`);
  const sub = /^(-|−|sub|减)$/i.test(opSrc);
  const eb = fields.ebits !== undefined ? Number(fields.ebits) : Math.max(x.eb, y.eb);
  const mb = fields.mbits !== undefined ? Number(fields.mbits) : Math.max(x.mb, y.mb);
  if (!(Number.isInteger(eb) && eb >= 2 && eb <= 6)) throw new Error('ebits: 阶码的数值位数（不算符号位），2～6');
  if (!(Number.isInteger(mb) && mb >= 3 && mb <= 16)) throw new Error('mbits: 尾数的数值位数（不算符号位），3～16');
  for (const [t, n] of [[x, 'x'], [y, 'y']]) {
    if (t.mb > mb) throw new Error(`${n} 的尾数有 ${t.mb} 位，比 mbits: ${mb} 长`);
    if (t.e > 2 ** eb - 1 || t.e < -(2 ** eb)) throw new Error(`${n} 的阶码用 ${eb} 位补码放不下`);
  }
  const roundSrc = String(fields.round ?? '0舍1入').trim();
  let round;
  if (/^(0舍1入|0 舍 1 入|half|01)$/i.test(roundSrc)) round = 'half';
  else if (/^(截断|恒舍|cut|trunc)$/i.test(roundSrc)) round = 'cut';
  else throw new Error(`round: 写「0舍1入」或「截断」（现在是「${roundSrc}」）`);
  return { x, y, sub, eb, mb, round, mistake: '' };
}

// —— 补码的写法 ——
const pow2 = (k) => 1n << BigInt(k);
// 阶码：双符号位补码「00,010」
export function eCode(e, eb) {
  const n = BigInt(e) < 0n ? BigInt(e) + pow2(eb + 2) : BigInt(e);
  const b = n.toString(2).padStart(eb + 2, '0').slice(-(eb + 2));
  return `${b.slice(0, 2)},${b.slice(2)}`;
}
// 尾数：双符号位补码，m 位数值位 + g 位移出去的（写在括号里）。{ s: 符号位, v: 数值位, g: 移出去的位 }
export function mParts(m, mb, g = 0) {
  const w = mb + g;
  let n = m >> BigInt(F - w);
  if (n < 0n) n += pow2(w + 2);
  const b = n.toString(2).padStart(w + 2, '0').slice(-(w + 2));
  return { s: b.slice(0, 2), v: b.slice(2, 2 + mb), g: b.slice(2 + mb) };
}
export const mText = (m, mb, g = 0) => { const p = mParts(m, mb, g); return `${p.s}.${p.v}${p.g ? `(${p.g})` : ''}`; };
const mInt = (m, mb) => { const p = mParts(m, mb); return BigInt(`0b${p.s}${p.v}`); };
// 移出去的位里最右边那个 1 在第几位：括号里要写几位（后面全是 0 的不写）
function guardLen(m, mb) {
  const rest = ((m % (ONE >> BigInt(mb))) + (ONE >> BigInt(mb))) % (ONE >> BigInt(mb));
  if (rest === 0n) return 0;
  let g = 0;
  while (((m << BigInt(mb + g)) % ONE) !== 0n) g++;
  return g;
}
// 真值：−0.11101010
const trueText = (m, mb) => {
  const neg = m < 0n;
  const a = neg ? -m : m;
  const g = Math.max(mb, guardLen(a, mb));
  const n = a >> BigInt(F - g);
  if (a === ONE) return neg ? '−1' : '1';
  return `${neg ? '−' : ''}0.${n.toString(2).padStart(g, '0')}`;
};
// 规格化了吗：补码的符号位和最高数值位不一样（00.1××、11.0××）；错法 one：按原码的习惯，只看最高数值位是不是 1
const isNorm = (m, mb, mistake) => {
  const p = mParts(m, mb, 2);
  if (p.s[0] !== p.s[1]) return false;
  if (mistake === 'normOne') return p.v[0] === '1' || m === -ONE;
  return p.s[1] !== p.v[0];
};
const overflowed = (m) => m >= ONE || m < -ONE;
const floorDiv = (a, b) => { const q = a / b; return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q; };
const decText = (m, e) => {
  const v = Number(m) / Number(ONE) * 2 ** e;
  return Number.isInteger(v) ? String(v) : String(+v.toPrecision(10));
};

function run(input) {
  const { x, y, sub, eb, mb, round, mistake } = input;
  const steps = [];
  const lines = []; // 画面上一行行写下来的：{ k: 名字, e?, m?, g?, add? }
  const snap = (extra = {}) => ({ lines: lines.map((l) => ({ ...l })), ...extra });
  const opName = sub ? '−' : '+';
  const yUse = sub && mistake !== 'subNoNeg' ? -y.m : y.m;

  steps.push({ view: snap(), msg: `$x = ${x.tex}$，$y = ${y.tex}$，求 x ${opName} y。阶码 ${eb} 位、尾数 ${mb} 位（都不算符号位），用双符号位补码，${round === 'half' ? '0 舍 1 入' : '截断（恒舍）'}。` });

  // 1. 写成补码
  lines.push({ k: '[x]浮', e: x.e, m: x.m }, { k: '[y]浮', e: y.e, m: y.m });
  const neg = y.m < 0n ? ['y', y] : x.m < 0n ? ['x', x] : ['y', y];
  steps.push({ view: snap({ cur: [0, 1] }), msg: `写成补码（阶码在前，尾数在后，都是两个符号位）：[x]浮 = ${eCode(x.e, eb)}；${mText(x.m, mb)}，[y]浮 = ${eCode(y.e, eb)}；${mText(y.m, mb)}。负数的补码：符号位 11，数值位取反、末位加 1。`, ask: { tag: 'code', kind: 'bin', width: mb + 2, q: `${neg[0]} 的尾数写成双符号位补码是？（写成 11.0101…，小数点可写可不写）`, answer: mInt(neg[1].m, mb) } });

  // 2. 对阶：小阶向大阶看齐，小阶的尾数右移；移出去的位写在括号里（gCur 位），后面一直跟着这几位算
  const dE = x.e - y.e;
  let e, mA, mB, gCur = 0, small = '';
  if (dE === 0) {
    e = x.e; mA = x.m; mB = yUse;
    steps.push({ view: snap(), msg: `阶差 ΔE = [Ex]补 − [Ey]补 = 0：阶码一样，不用对阶。` });
  } else {
    const k = Math.abs(dE);
    small = dE < 0 ? 'x' : 'y';
    const wrong = mistake === 'wrongSide'; // 错法：大阶的尾数右移（大阶向小阶看齐）
    const shiftX = wrong ? small === 'y' : small === 'x';
    e = wrong ? Math.min(x.e, y.e) : Math.max(x.e, y.e);
    mA = shiftX ? floorDiv(x.m, pow2(k)) : x.m;
    mB = shiftX ? yUse : floorDiv(yUse, pow2(k));
    const shifted = shiftX ? mA : floorDiv(y.m, pow2(k));
    gCur = guardLen(shifted, mb) ? k : 0;
    lines.push({ k: `[${shiftX ? 'x' : 'y'}]浮 对阶后`, e, m: shifted, g: gCur });
    steps.push({ view: snap({ cur: [lines.length - 1] }), msg: `求阶差：[ΔE]补 = [Ex]补 + [−Ey]补 = ${eCode(x.e, eb)} + ${eCode(-y.e, eb)} = ${eCode(dE, eb)}，ΔE = ${dE}。${small} 的阶小，小阶向大阶看齐：${small} 的尾数算术右移 ${k} 位（符号位跟着往右补），阶码加 ${k}，移出去的位先留着（括号里）。`, ask: { tag: 'shift', kind: 'number', q: '小阶的尾数要右移几位？', answer: k } });
  }

  // 3. 尾数相加（减法：加上 [−My]补）
  let m = mA + mB;
  const gSum = gCur;
  const bits = (v, g) => { const p = mParts(v, mb, g); return BigInt(`0b${p.s}${p.v}${p.g}`); };
  const subNote = sub ? (mistake === 'subNoNeg' ? '减法：' : `减法：加上 [−My]补 = ${mText(yUse, mb)}（[My]补 连同符号位取反、末位加 1）。`) : '';
  lines.push({ k: sub ? '尾数相减' : '尾数相加', add: { a: mA, b: mB, sum: m }, g: gCur });
  steps.push({ view: snap({ cur: [lines.length - 1] }), msg: `${subNote}尾数相加：${mText(mA, mb, gCur)} + ${mText(mB, mb, gCur)} = ${mText(m, mb, gCur)}${overflowed(m) ? '：两个符号位不一样，尾数溢出了（要右规）' : ''}。`, ask: { tag: 'sum', kind: 'bin', width: mb + 2 + gCur, q: `尾数相加得多少？（双符号位补码${gCur ? `，括号里移出去的 ${gCur} 位也写上` : ''}）`, answer: bits(m, gCur) } });

  if (m === 0n) {
    steps.push({ view: snap(), msg: `尾数是 0：结果是 0（机器零），不用再规格化。` });
    return { steps, m: 0n, e: 0, zero: true, norm: '不用规格化', of: '没有溢出', g: gSum, mid: { mA, mB, sum: 0n } };
  }

  // 4. 规格化
  const sum = m;
  let norm, k = 0;
  if (overflowed(m)) {
    norm = '右规';
    m = floorDiv(m, 2n); e += 1; gCur += 1;
    lines.push({ k: '右规后', e, m, g: gCur });
    steps.push({ view: snap({ cur: [lines.length - 1] }), msg: `两个符号位不一样（${mParts(sum, mb).s}）：尾数溢出，右规一位（最高的符号位不动，往右移），阶码加 1：${mText(m, mb, gCur)}，阶码 ${eCode(e, eb)}。`, ask: { tag: 'norm', kind: 'choice', q: '尾数要怎么规格化？', choices: ['左规', '右规', '不用规格化'], answer: '右规' } });
  } else if (!isNorm(m, mb, mistake)) {
    norm = '左规';
    while (!isNorm(m, mb, mistake) && k < mb + gCur + 2) { m *= 2n; k++; }
    e -= k; gCur = Math.max(0, gCur - k);
    lines.push({ k: `左规 ${k} 位`, e, m, g: gCur });
    steps.push({ view: snap({ cur: [lines.length - 1] }), msg: `${mText(sum, mb, gSum)} 不是规格化数（补码的规格化尾数是 00.1×× 或 11.0××：符号位和最高数值位不一样）：左规 ${k} 位（括号里的位跟着移进来，右边补 0），阶码减 ${k}：${mText(m, mb, gCur)}，阶码 ${eCode(e, eb)}。`, ask: { tag: 'norm', kind: 'choice', q: '尾数要怎么规格化？', choices: ['左规', '右规', '不用规格化'], answer: '左规' } });
  } else {
    norm = '不用规格化';
    steps.push({ view: snap(), msg: `${mText(m, mb, gCur)} 已经是规格化数（符号位和最高数值位不一样），不用规格化。`, ask: { tag: 'norm', kind: 'choice', q: '尾数要怎么规格化？', choices: ['左规', '右规', '不用规格化'], answer: '不用规格化' } });
  }

  // 5. 舍入
  const before = m;
  const gb = guardLen(m, mb) ? gCur : 0;
  const unit = ONE >> BigInt(mb);
  if (gb) {
    const useRound = round === 'half' && mistake !== 'noRound' ? 'half' : 'cut';
    const first = mParts(m, mb, 1).g === '1';
    m = floorDiv(m, unit) * unit + (useRound === 'half' && first ? unit : 0n);
    let note = useRound === 'half' ? (first ? '移出去的最高位是 1：末位加 1' : '移出去的最高位是 0：直接舍掉') : '截断：移出去的位直接舍掉';
    if (overflowed(m)) { m = floorDiv(m, 2n); e += 1; note += `；加 1 以后尾数溢出（${mParts(m * 2n, mb).s}），再右规一位，阶码加 1`; }
    else if (!isNorm(m, mb, mistake)) { m *= 2n; e -= 1; note += '；舍入以后不是规格化数了，再左规一位，阶码减 1'; }
    lines.push({ k: '舍入后', e, m });
    steps.push({ view: snap({ cur: [lines.length - 1] }), msg: `舍入（${round === 'half' ? '0 舍 1 入' : '截断'}）：${mText(before, mb, gb)}，${note}，得 ${mText(m, mb)}。`, ask: { tag: 'round', kind: 'bin', width: mb + 2, q: '舍入以后的尾数是？（双符号位补码）', answer: mInt(m, mb) } });
  } else {
    steps.push({ view: snap(), msg: `没有移出去的位（或者都是 0），不用舍入：尾数 ${mText(m, mb)}。` });
  }

  // 6. 溢出判断：看阶码的两个符号位
  const ec = eCode(e, eb);
  const of = e > 2 ** eb - 1 ? '上溢' : e < -(2 ** eb) ? '下溢' : '没有溢出';
  const ofMsg = of === '上溢' ? '阶码的符号位是 01：上溢，要做溢出处理（中断）。' : of === '下溢' ? '阶码的符号位是 10：下溢，结果按机器零处理。' : `阶码 ${ec} 的两个符号位一样：没有溢出。`;
  steps.push({ view: snap({ cur: [lines.length - 1] }), msg: `判断溢出（看阶码，不看尾数）：${ofMsg}`, ask: { tag: 'of', kind: 'choice', q: '结果溢出了吗？', choices: ['没有溢出', '上溢', '下溢'], answer: of } });

  // 7. 结果
  if (of === '没有溢出') {
    const eTrue = `${e < 0 ? '−' : ''}${Math.abs(e).toString(2).padStart(eb, '0')}`;
    steps.push({ view: snap({ done: true }), msg: `结果：[x ${opName} y]浮 = ${ec}；${mText(m, mb)}，即 $x ${sub ? '-' : '+'} y = 2^{${eTrue.replace('−', '-')}}\\times(${trueText(m, mb).replace('−', '-')}) = ${decText(m, e)}$。` });
  }
  return { steps, m, e, norm, of, k, g: gSum, mid: { mA, mB, sum } };
}

// —— 画面：一行一行写下来（阶码 ；尾数），尾数相加写成竖式 ——
const mHtml = (m, mb, g) => {
  const p = mParts(m, mb, g);
  return `<span class="fa-sign">${p.s}</span>.${p.v}${p.g ? `<span class="fa-g">(${p.g})</span>` : ''}`;
};
function view(s, input, ctx) {
  const { eb, mb } = input;
  let h = `<div class="fa-q"><span>${ctx.tex(`x = ${input.x.tex}`)}</span><span>${ctx.tex(`y = ${input.y.tex}`)}</span><span class="fa-op">求 x ${input.sub ? '−' : '+'} y</span></div>`;
  if (!s.lines.length) return h;
  h += '<div class="fa-lines">';
  s.lines.forEach((l, i) => {
    const cur = s.cur?.includes(i) ? ' fa-cur' : '';
    if (l.add) {
      const g = l.g;
      const row = (sign, m, cls = '') => `<div class="fa-arow ${cls}"><span class="fa-pm">${sign}</span><span class="fa-m">${mHtml(m, mb, g)}</span></div>`;
      h += `<div class="fa-line fa-addl${cur}" data-cmd="${i + 1}" data-label="${esc(l.k)}"><span class="fa-k">${esc(l.k)}</span><div class="fa-add">${row('', l.add.a)}${row('+', l.add.b, 'fa-plus')}${row('', l.add.sum, 'fa-sum')}</div></div>`;
      return;
    }
    h += `<div class="fa-line${cur}" data-cmd="${i + 1}" data-label="${esc(l.k)}"><span class="fa-k">${esc(l.k)}</span><span class="fa-e">${eCode(l.e, eb)}</span><span class="fa-semi">；</span><span class="fa-m">${mHtml(l.m, mb, l.g || 0)}</span></div>`;
  });
  h += '</div>';
  return h;
}

const binAlts = (m, mb, g = 0) => { const p = mParts(m, mb, g); return [`${p.s}.${p.v}${p.g ? `(${p.g})` : ''}`, `${p.s}.${p.v}${p.g}`, `${p.s}${p.v}${p.g}`]; };

export const faddEngine = {
  name: 'fadd', title: '浮点加减运算', parse, run, view,
  quiz(input, r) {
    if (r.zero) return { q: `$x = ${input.x.tex}$，$y = ${input.y.tex}$，求 x ${input.sub ? '−' : '+'} y 的尾数（双符号位补码）。`, type: 'bin', width: input.mb + 2, answer: `0b${'0'.repeat(input.mb + 2)}` };
    const p = mParts(r.m, input.mb);
    return { q: `阶码 ${input.eb} 位、尾数 ${input.mb} 位（不算符号位），双符号位补码，${input.round === 'half' ? '0 舍 1 入' : '截断'}。$x = ${input.x.tex}$，$y = ${input.y.tex}$，求 x ${input.sub ? '−' : '+'} y，写出结果的尾数（双符号位补码）。`, type: 'bin', width: input.mb + 2, answer: `0b${p.s}${p.v}` };
  },
  // 考卷上那张表：对阶后、尾数相加、规格化后、舍入后的阶码和尾数，最后是溢出没有
  table(input, r) {
    const { eb, mb } = input;
    const rows = [];
    const g0 = r.g;
    rows.push({ label: '尾数相加', cells: [{ v: binAlts(r.mid.sum, mb, g0) }] });
    if (!r.zero) rows.push({ label: '规格化、舍入后', cells: [{ v: binAlts(r.m, mb) }] });
    return {
      q: '按步骤做，把每一步的结果填进表里（尾数写双符号位补码，移出去的位写在括号里）。', qhtml: '', dir: 'row',
      head: ['尾数'],
      rows,
      extra: [
        { label: '小阶右移几位', v: String(Math.abs(input.x.e - input.y.e)), num: true },
        { label: '怎么规格化', v: [r.norm, r.norm.replace('不用规格化', '不用')] },
        { label: '结果的阶码', v: r.zero ? ['0'] : [eCode(r.e, eb), eCode(r.e, eb).replace(',', ''), eCode(r.e, eb).replace(',', '.')] },
        { label: '溢出', v: [r.of, r.of.replace('没有溢出', '没有'), r.of.replace('没有溢出', '无')] },
      ],
    };
  },
  // 常见错法：大阶向小阶看齐、减法忘了对 y 求补、把 11.1×× 当成规格化的（按原码的习惯）、没做 0 舍 1 入（和对的一样时不列）
  variants(input) {
    const sig = (r) => JSON.stringify([String(r.m), r.e, r.norm, r.of, r.steps.map((s) => String(s.ask?.answer ?? ''))]);
    const right = sig(run(input));
    const out = [];
    const list = [
      ['wrongSide', '像是大阶向小阶看齐了（应该是小阶的尾数右移、阶码加上去：右移丢的是低位，误差小）'],
      ...(input.sub ? [['subNoNeg', '像是减法时直接加了 [My]补（减法要加 [−My]补：连同符号位取反、末位加 1）']] : []),
      ['normOne', '像是把 11.1×× 当成了规格化数（补码的规格化看符号位和最高数值位不一样：负数是 11.0××）'],
      ...(input.round === 'half' ? [['noRound', '像是没做 0 舍 1 入，直接截断了']] : []),
    ];
    for (const [m, label] of list) {
      const v = { ...input, mistake: m };
      try { if (sig(run(v)) !== right) out.push({ label, input: v }); } catch { /* */ }
    }
    return out;
  },
};

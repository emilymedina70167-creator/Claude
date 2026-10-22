// 组成原理的定点除法：div（原码加减交替法、补码加减交替法），画成「被除数（余数）| 商 | 说明」的表，和 mul 一样。
// 原码（不恢复余数法）：符号位单独异或；|x| − |y| 开始，余数 ≥ 0 上商 1、左移一位减 |y|，< 0 上商 0、左移一位加 |y|；
//   一共得 n + 1 位商（第一位是整数位，|x| < |y| 时是 0），最后余数是负的再加一次 |y| 恢复。
// 补码：符号位参加运算；同号先减、异号先加；余数和除数同号上商 1、左移减 [y]补，异号上商 0、左移加 [y]补；
//   做 n 次得到 q0（符号位）～ q(n−1)，商的末位恒置 1（王道 / 唐朔飞的口径）。纯函数（tests/codiv-engine.test.js）。
import { fixText } from './comul.js';

function parseFrac(src, what) {
  const s = String(src ?? '').replace(/\s+/g, '').replace(/[−–—]/g, '-').replace(/[()（）]/g, '');
  const m = /^([+-]?)0?\.([01]+)$/.exec(s);
  if (!m) throw new Error(`${what}写成二进制定点小数（真值），比如 0.1011、-0.1101（现在是「${src}」）`);
  return { neg: m[1] === '-', digits: m[2] };
}
const ALGO = { orig: 'orig', 原码: 'orig', 原码加减交替: 'orig', comp: 'comp', 补码: 'comp', 补码加减交替: 'comp' };
const NAME = { orig: '原码加减交替法', comp: '补码加减交替法' };

function parse(fields) {
  const x = parseFrac(fields.x, 'x: ');
  const y = parseFrac(fields.y, 'y: ');
  const algo = ALGO[String(fields.algo ?? 'orig').trim().toLowerCase()];
  if (!algo) throw new Error(`algo: 写 orig（原码加减交替法）或 comp（补码加减交替法）（现在是「${fields.algo}」）`);
  const n = fields.n !== undefined ? Number(fields.n) : Math.max(x.digits.length, y.digits.length);
  if (!(Number.isInteger(n) && n >= 2 && n <= 8)) throw new Error('n: 数值位数 2～8');
  if (x.digits.length > n || y.digits.length > n) throw new Error(`x、y 的小数位不能比 n: ${n} 多`);
  const val = (t) => { const v = BigInt(`0b${t.digits.padEnd(n, '0')}`); return t.neg ? -v : v; };
  const X = val(x), Y = val(y);
  if (Y === 0n) throw new Error('y 不能是 0');
  const ax = X < 0n ? -X : X, ay = Y < 0n ? -Y : Y;
  if (ax >= ay) throw new Error(`定点小数除法要 |x| < |y|（不然商的整数部分不是 0，溢出了）：|x| = 0.${x.digits}，|y| = 0.${y.digits}`);
  return { algo, n, X, Y, xs: fields.x, ys: fields.y, mistake: '' };
}

const A2 = (v, n) => fixText(v, 2, n); // 双符号位
const sup = (k) => `2⁻${String(k).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])}`;
const signOf = (v) => (v < 0n ? 1 : 0);

function runOrig(input) {
  const { n, X, Y, mistake } = input;
  const ax = X < 0n ? -X : X, ay = Y < 0n ? -Y : Y;
  const neg = (X < 0n) !== (Y < 0n);
  const rows = [], steps = [];
  steps.push({ view: { rows: [] }, msg: `用原码加减交替法算 x ÷ y：x = ${input.xs}，y = ${input.ys}，数值位 ${n} 位。` });
  rows.push({ r: A2(ax, n), q: '', note: `开始：|x| = ${A2(ax, n)}（双符号位）`, kind: 'start' });
  steps.push({ view: { rows: rows.slice() }, msg: `符号位单独算：${signOf(X)} ⊕ ${signOf(Y)} = ${neg ? 1 : 0}。|y| 的补码 [|y|]补 = ${A2(ay, n)}，[−|y|]补 = ${A2(-ay, n)}。先做 |x| − |y|（加 [−|y|]补）；以后余数 ≥ 0 上商 1、左移一位减 |y|，余数 < 0 上商 0、左移一位加 |y|。`, ask: { tag: 'code', kind: 'bin', width: n + 2, q: '[−|y|]补（双符号位）是？', answer: BigInt.asUintN(n + 2, -ay), display: A2(-ay, n) } });
  let R = ax - ay, q = '';
  rows.push({ r: A2(-ay, n), q: '', note: '+[−|y|]补', kind: 'add' });
  for (let i = 0; i <= n; i++) {
    const bit = R >= 0n ? 1 : 0;
    q += bit;
    rows.push({ r: A2(R, n), q: q.padEnd(n + 1, ' '), note: `余数${R >= 0n ? ' ≥ 0' : ' < 0'}，上商 ${bit}`, kind: 'sum' });
    const before = rows.length;
    let msg = `${i === 0 ? '|x| − |y|' : '这一次'} 得余数 ${A2(R, n)}：${R >= 0n ? '是正的（符号位 00）' : '是负的（符号位 11）'}，上商 ${bit}${i === 0 ? '（第一位商是整数位，|x| < |y| 所以是 0）' : ''}。`;
    if (i < n) {
      // 恢复余数法（负了先加回 |y| 再左移减）算出来的商一样：2(R + |y|) − |y| = 2R + |y|，所以不当成错法
      const plus = bit === 0;
      const shifted = R * 2n;
      rows.push({ r: A2(shifted, n), q: q.padEnd(n + 1, ' '), note: '← 左移一位', kind: 'shift' });
      rows.push({ r: A2(plus ? ay : -ay, n), q: '', note: plus ? '+[|y|]补' : '+[−|y|]补', kind: 'add' });
      R = shifted + (plus ? ay : -ay);
      msg += ` 余数左移一位，${plus ? '加 |y|' : '减 |y|'}。`;
    }
    steps.push({ view: { rows: rows.slice(), from: before - 1 }, msg, ask: { tag: 'q', kind: 'choice', q: `第 ${i + 1} 位商上几？`, choices: ['0', '1'], answer: String(bit) } });
  }
  // 最后余数是负的：加一次 |y| 恢复成真正的余数
  let restored = false;
  if (R < 0n && mistake !== 'noRestore') { R += ay; restored = true; rows.push({ r: A2(R, n), q: q, note: '余数是负的：+[|y|]补 恢复', kind: 'sum' }); }
  if (mistake === 'fixLast') q = q.slice(0, -1) + '1'; // 错法：和补码除法弄混，末位也恒置 1
  const qv = BigInt(`0b${q}`); // 第一位是整数位（0）
  const quotient = `${neg ? 1 : 0}.${q.slice(1)}`;
  const remTrue = ((mistake === 'remSign' ? neg : X < 0n) ? -R : R); // 错法 remSign：余数的符号跟了商（应该和被除数同号）
  steps.push({ view: { rows: rows.slice(), done: true }, msg: `${restored ? '最后的余数是负的，加 |y| 恢复；' : ''}商的数值是 0.${q.slice(1)}，加上符号位：[x ÷ y]原 = ${quotient}；余数 = ${X < 0n ? '−' : ''}0.${(R < 0n ? -R : R).toString(2).padStart(n, '0')} × ${sup(n)}（和被除数同号）。`, ask: { tag: 'result', kind: 'bin', width: n + 1, q: '[x ÷ y]原 是？（符号位 + 小数点后面的位）', answer: BigInt(`0b${neg ? 1 : 0}${q.slice(1)}`), display: quotient } });
  return { steps, rows, quotient, q: qv, rem: remTrue };
}

function runComp(input) {
  const { n, X, Y, mistake } = input;
  const rows = [], steps = [];
  steps.push({ view: { rows: [] }, msg: `用补码加减交替法算 x ÷ y：x = ${input.xs}，y = ${input.ys}，数值位 ${n} 位。` });
  rows.push({ r: A2(X, n), q: '', note: `开始：[x]补 = ${A2(X, n)}`, kind: 'start' });
  const same0 = signOf(X) === signOf(Y);
  steps.push({ view: { rows: rows.slice() }, msg: `符号位参加运算。[y]补 = ${A2(Y, n)}，[−y]补 = ${A2(-Y, n)}。第一步：x 和 y ${same0 ? '同号，x 减 y（加 [−y]补）' : '异号，x 加 y'}；以后余数和除数同号上商 1、左移减 y，异号上商 0、左移加 y；做 ${n} 次，商的末位恒置 1。`, ask: { tag: 'code', kind: 'bin', width: n + 2, q: '[−y]补（双符号位）是？', answer: BigInt.asUintN(n + 2, -Y), display: A2(-Y, n) } });
  // 错法 firstSub：第一步不管同号异号都减
  const firstSub = same0 || mistake === 'firstSub';
  rows.push({ r: A2(firstSub ? -Y : Y, n), q: '', note: firstSub ? '+[−y]补' : '+[y]补', kind: 'add' });
  let R = X + (firstSub ? -Y : Y), q = '';
  for (let i = 0; i < n; i++) {
    // 错法 sign：看余数的正负（不和除数比）上商
    const bit = mistake === 'signOnly' ? (R >= 0n ? 1 : 0) : (signOf(R) === signOf(Y) ? 1 : 0);
    q += bit;
    rows.push({ r: A2(R, n), q: q.padEnd(n + 1, ' '), note: `余数和除数${signOf(R) === signOf(Y) ? '同' : '异'}号，上商 ${bit}`, kind: 'sum' });
    const before = rows.length;
    let msg = `余数 ${A2(R, n)}，符号位 ${signOf(R) ? '11' : '00'}；除数 y 的符号 ${signOf(Y)}：${signOf(R) === signOf(Y) ? '同号' : '异号'}，上商 ${bit}${i === 0 ? '（这是商的符号位）' : ''}。`;
    if (i < n - 1 || mistake === 'noLastOne') {
      const shifted = R * 2n;
      const sub = bit === 1;
      rows.push({ r: A2(shifted, n), q: q.padEnd(n + 1, ' '), note: '← 左移一位', kind: 'shift' });
      rows.push({ r: A2(sub ? -Y : Y, n), q: '', note: sub ? '+[−y]补' : '+[y]补', kind: 'add' });
      R = shifted + (sub ? -Y : Y);
      msg += ` 余数左移一位，${sub ? '减 y' : '加 y'}。`;
    }
    steps.push({ view: { rows: rows.slice(), from: before - 1 }, msg, ask: { tag: 'q', kind: 'choice', q: `第 ${i + 1} 位商（${i === 0 ? '符号位' : `q${i}`}）上几？`, choices: ['0', '1'], answer: String(bit) } });
  }
  // 末位恒置 1（错法 noLastOne：多做一次，按余数上最后一位）
  if (mistake === 'noLastOne') q += signOf(R) === signOf(Y) ? 1 : 0;
  else q += 1;
  const quotient = `${q[0]}.${q.slice(1)}`;
  rows.push({ r: '', q, note: mistake === 'noLastOne' ? '最后一位按余数上' : '商的末位恒置 1', kind: 'end' });
  const value = BigInt.asIntN(n + 1, BigInt(`0b${q}`));
  steps.push({ view: { rows: rows.slice(), done: true }, msg: `商的末位恒置 1：[x ÷ y]补 = ${quotient}（真值 ${value < 0n ? '−' : ''}0.${(value < 0n ? -value : value).toString(2).padStart(n, '0')}，误差不超过 ${sup(n)}）。`, ask: { tag: 'result', kind: 'bin', width: n + 1, q: '[x ÷ y]补 是？（写成 1.0101…，小数点可写可不写）', answer: BigInt(`0b${q}`), display: quotient } });
  return { steps, rows, quotient, q: value, rem: R };
}

const run = (input) => (input.algo === 'orig' ? runOrig(input) : runComp(input));

function view(s, input) {
  if (!s.rows.length) return `<div class="ml-q0">x = ${input.xs}，y = ${input.ys}</div>`;
  const body = s.rows.map((r, i) => {
    const fresh = s.from !== undefined && i >= s.from;
    const a = r.kind === 'add' ? `+ ${r.r}` : r.kind === 'shift' ? `← ${r.r}` : ` ${r.r}`;
    return `<tr class="ml-${r.kind}${fresh ? ' ml-new' : ''}" data-cmd="${i + 1}"><td class="ml-a">${a}</td><td class="ml-q">${r.q}</td><td class="ml-n">${r.note}</td></tr>`;
  }).join('');
  return `<div class="ml-wrap"><table class="ml-tab sv-tab"><thead><tr><th>被除数（余数）</th><th>商</th><th>说明</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export const divEngine = {
  name: 'div', title: '定点除法', parse, run, view,
  quiz(input, r) {
    return { q: `用${NAME[input.algo]}算 x ÷ y，x = ${input.xs}，y = ${input.ys}（${input.n} 位数值位）。写出 [x ÷ y]${input.algo === 'comp' ? '补' : '原'}（符号位 + ${input.n} 位小数）。`, type: 'bin', width: input.n + 1, answer: `0b${r.quotient.replace('.', '')}` };
  },
  // 考卷上那张表：每次上的商（从第 1 位起），最后是商
  table(input, r) {
    const qs = r.rows.filter((x) => x.kind === 'sum' && /上商/.test(x.note));
    return {
      q: `用${NAME[input.algo]}算，填每一次的余数（双符号位）和上的商。`, qhtml: '', dir: 'row', head: ['余数', '上商'],
      rows: qs.map((x, i) => ({ label: `第 ${i + 1} 次`, cells: [{ v: [x.r, x.r.replace('.', '')] }, { v: String(x.q.trim().slice(-1)), num: true }] })),
      extra: [{ label: `[x ÷ y]${input.algo === 'comp' ? '补' : '原'}`, v: [r.quotient, r.quotient.replace('.', '')] }],
    };
  },
  // 常见错法：原码时最后余数是负的没恢复、末位也恒置 1、余数的符号跟了商；补码时第一步不看同号异号都减、只看余数正负上商、末位没有恒置 1（和对的一样时不列）
  variants(input) {
    const sig = (r) => JSON.stringify([r.quotient, String(r.rem), r.steps.map((s) => String(s.ask?.answer ?? ''))]);
    const right = sig(run(input));
    const list = input.algo === 'orig'
      ? [['noRestore', '像是最后余数是负的没有恢复（要再加一次 |y|）'], ['fixLast', '像是商的末位也恒置 1 了（那是补码除法的做法；原码加减交替法每一位都按余数上）'], ['remSign', '像是余数的符号跟了商（余数和被除数同号）']]
      : [['firstSub', '像是第一步不管同号异号都减了（补码除法：同号减、异号加）'], ['signOnly', '像是只看余数的正负上商（补码除法看余数和除数是不是同号）'], ['noLastOne', '像是末位按余数上了商（王道：商的末位恒置 1）']];
    const out = [];
    for (const [m, label] of list) {
      const v = { ...input, mistake: m };
      try { if (sig(run(v)) !== right) out.push({ label, input: v }); } catch { /* */ }
    }
    return out;
  },
};

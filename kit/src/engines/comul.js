// 组成原理的定点乘法：mul（原码一位乘、补码一位乘 Booth），画成王道那张「部分积 | 乘数 | 说明」的表。
// 原码一位乘：符号位单独异或；|x|、|y| 相乘，乘数最低位是 1 就加 |x|，然后部分积和乘数一起逻辑右移（部分积前面那一位是进位），做 n 次。
// 补码一位乘（Booth）：部分积、被乘数取双符号位，乘数 [y]补 末尾补一位 0（y_{n+1}）；看 y_n y_{n+1}：00 / 11 加 0，01 加 [x]补，10 加 [−x]补；
// 再一起算术右移；一共加 n + 1 次、移 n 次（最后一次只加不移）。纯函数（tests/comul-engine.test.js）。

// 「0.1101」「-0.1011」「−.1011」→ { neg, mag（BigInt，按 n 位小数）, digits }
function parseFrac(src, what) {
  const s = String(src ?? '').replace(/\s+/g, '').replace(/[−–—]/g, '-').replace(/[()（）]/g, '');
  const m = /^([+-]?)0?\.([01]+)$/.exec(s);
  if (!m) throw new Error(`${what}写成二进制定点小数（真值），比如 0.1101、-0.1011（现在是「${src}」）`);
  return { neg: m[1] === '-', digits: m[2] };
}
const ALGO = { booth: 'booth', 补码一位乘: 'booth', 补码: 'booth', orig: 'orig', 原码一位乘: 'orig', 原码: 'orig' };
const NAME = { booth: '补码一位乘（Booth）', orig: '原码一位乘' };

function parse(fields) {
  const x = parseFrac(fields.x, 'x: ');
  const y = parseFrac(fields.y, 'y: ');
  const algo = ALGO[String(fields.algo ?? 'booth').trim().toLowerCase()];
  if (!algo) throw new Error(`algo: 写 booth（补码一位乘）或 orig（原码一位乘）（现在是「${fields.algo}」）`);
  const n = fields.n !== undefined ? Number(fields.n) : Math.max(x.digits.length, y.digits.length);
  if (!(Number.isInteger(n) && n >= 2 && n <= 8)) throw new Error('n: 数值位数 2～8');
  if (x.digits.length > n || y.digits.length > n) throw new Error(`x、y 的小数位不能比 n: ${n} 多`);
  const val = (t) => { const v = BigInt(`0b${t.digits.padEnd(n, '0')}`); return t.neg ? -v : v; };
  return { algo, n, X: val(x), Y: val(y), xs: fields.x, ys: fields.y, mistake: '' };
}

const pw = (k) => 1n << BigInt(k);
// 定点小数的补码写法：width 位整数部分（符号位）+ f 位小数
export function fixText(v, intBits, f) {
  let u = v < 0n ? v + pw(intBits + f) : v;
  const b = u.toString(2).padStart(intBits + f, '0').slice(-(intBits + f));
  return `${b.slice(0, intBits)}.${b.slice(intBits)}`;
}
const bits = (v, w) => (v < 0n ? v + pw(w) : v).toString(2).padStart(w, '0').slice(-w);
const trueText = (v, f) => `${v < 0n ? '−' : ''}0.${(v < 0n ? -v : v).toString(2).padStart(f, '0')}`;

function runBooth(input) {
  const { n, X, Y, mistake } = input;
  const rows = []; // 表的一行：{ a: 部分积, q: 乘数（n+1 位）, q1, note, kind: 'add' | 'sum' | 'shift' | 'start' }
  const steps = [];
  let A = 0n, Q = Y < 0n ? Y + pw(n + 1) : Y, q1 = 0;
  const A2 = (v) => fixText(v, 2, n);
  const Qt = () => `${bits(Q, n + 1)}`;
  rows.push({ a: A2(A), q: Qt(), q1, note: `开始：部分积 0，乘数 [y]补 = ${fixText(Y, 1, n)}，末尾补 y${n + 1} = 0`, kind: 'start' });
  steps.push({ view: { rows: rows.slice() }, msg: `[x]补 = ${A2(X)}，[−x]补 = ${A2(-X)}（双符号位），[y]补 = ${fixText(Y, 1, n)}。看乘数最低两位 y${n}y${n + 1}：00 / 11 加 0，01 加 [x]补，10 加 [−x]补，再一起算术右移；一共加 ${n + 1} 次、移 ${n} 次。`, ask: { tag: 'code', kind: 'bin', width: n + 2, q: '[−x]补（双符号位）是？', answer: (-X < 0n ? -X + pw(n + 2) : -X), display: A2(-X) } });
  const adds = mistake === 'noLastAdd' ? n : n + 1;
  for (let i = 0; i < adds; i++) {
    const yn = Number(Q & 1n);
    let pair = `${yn}${q1}`;
    if (mistake === 'pairRev') pair = `${q1}${yn}`; // 错法：读成 y_{n+1} y_n
    const add = pair === '01' ? X : pair === '10' ? -X : 0n;
    const opName = pair === '01' ? '+[x]补' : pair === '10' ? '+[−x]补' : '+0';
    const realPair = `${yn}${q1}`;
    const before = rows.length;
    if (add !== 0n) rows.push({ a: `${add < 0n ? '' : ''}${A2(add)}`, q: '', note: `y${n}y${n + 1} = ${realPair}，${opName}`, kind: 'add' });
    A += add;
    if (add !== 0n) rows.push({ a: A2(A), q: Qt(), q1, note: '', kind: 'sum' });
    const last = i === adds - 1 && mistake !== 'extraShift';
    let shiftNote = '';
    if (!last) {
      // 部分积、乘数、y_{n+1} 一起算术右移一位
      q1 = Number(Q & 1n);
      Q = (Q >> 1n) | ((((A < 0n ? A + pw(n + 2) : A) & 1n)) << BigInt(n));
      A >>= 1n;
      rows.push({ a: A2(A), q: Qt(), q1, note: '→ 一起算术右移一位', kind: 'shift' });
      shiftNote = `，再一起算术右移一位（部分积的符号位跟着往右补）`;
    }
    const why = realPair === '00' || realPair === '11' ? `y${n}y${n + 1} = ${realPair}：加 0` : realPair === '01' ? `y${n}y${n + 1} = 01：加 [x]补 = ${A2(X)}` : `y${n}y${n + 1} = 10：加 [−x]补 = ${A2(-X)}`;
    steps.push({ view: { rows: rows.slice(), from: before }, msg: `第 ${i + 1} 次：${why}${shiftNote}${last ? `。这是第 ${n + 1} 次，最后一次只加不移` : ''}。`, ask: { tag: 'op', kind: 'choice', q: `第 ${i + 1} 次：乘数最低两位 y${n}y${n + 1} = ${realPair}，要做什么？`, choices: ['+0', '+[x]补', '+[−x]补'], answer: opName } });
  }
  // 结果：部分积（去掉一个符号位）接上乘数的前 n 位
  const P = (A << BigInt(n)) | (Q >> 1n);
  const prodText = fixText(P, 1, 2 * n);
  steps.push({ view: { rows: rows.slice(), done: true }, msg: `乘积 [x·y]补 = 部分积接上乘数的前 ${n} 位 = ${prodText}，x·y = ${trueText(P, 2 * n)}。`, ask: { tag: 'result', kind: 'bin', width: 2 * n + 1, q: '[x·y]补 是？（写成 1.0111…，小数点可写可不写）', answer: P < 0n ? P + pw(2 * n + 1) : P, display: prodText } });
  return { steps, rows, P, prodText };
}

function runOrig(input) {
  const { n, X, Y, mistake } = input;
  const ax = X < 0n ? -X : X, ay = Y < 0n ? -Y : Y;
  const neg = (X < 0n) !== (Y < 0n);
  const rows = [];
  const steps = [];
  let A = 0n, Q = ay;
  const At = (v) => fixText(v, 1, n); // 部分积前面那一位是进位
  const Qt = () => bits(Q, n);
  rows.push({ a: At(A), q: Qt(), note: `开始：部分积 0，乘数 |y| = ${fixText(ay, 1, n).slice(2)}`, kind: 'start' });
  steps.push({ view: { rows: rows.slice() }, msg: `符号位单独算：${X < 0n ? 1 : 0} ⊕ ${Y < 0n ? 1 : 0} = ${neg ? 1 : 0}。|x| = ${fixText(ax, 1, n)}，|y| = ${fixText(ay, 1, n)}：乘数最低位是 1 就加 |x|，是 0 加 0，然后部分积和乘数一起逻辑右移一位（部分积前面那一位是进位，移进来），做 ${n} 次。`, ask: { tag: 'sign', kind: 'choice', q: '乘积的符号位是？', choices: ['0', '1'], answer: neg ? '1' : '0' } });
  for (let i = 0; i < n; i++) {
    const yn = Number(Q & 1n);
    const before = rows.length;
    if (yn) { rows.push({ a: At(ax), q: '', note: `y${n} = 1，+|x|`, kind: 'add' }); A += ax; rows.push({ a: At(A), q: Qt(), note: '', kind: 'sum' }); }
    const carry = A >> BigInt(n);
    Q = (Q >> 1n) | ((A & 1n) << BigInt(n - 1));
    A >>= 1n;
    if (mistake === 'arith' && carry) A |= pw(n); // 错法：当成补码算术右移，进位那一位留着又补了一个 1
    rows.push({ a: At(A), q: Qt(), note: '→ 一起逻辑右移一位', kind: 'shift' });
    steps.push({ view: { rows: rows.slice(), from: before }, msg: `第 ${i + 1} 次：乘数最低位 ${yn}，${yn ? `加 |x| = ${At(ax)}` : '加 0'}，再一起逻辑右移一位${carry ? '（这次有进位，进位移进部分积的最高数值位）' : ''}。`, ask: { tag: 'op', kind: 'choice', q: `第 ${i + 1} 次：乘数最低位是 ${yn}，要做什么？`, choices: ['+0', '+|x|'], answer: yn ? '+|x|' : '+0' } });
  }
  const mag = (A << BigInt(n)) | Q;
  const P = neg ? -mag : mag;
  const prodText = `${neg ? 1 : 0}.${bits(mag, 2 * n)}`;
  steps.push({ view: { rows: rows.slice(), done: true }, msg: `数值部分 = 部分积接上乘数 = 0.${bits(mag, 2 * n)}，加上符号位：[x·y]原 = ${prodText}，x·y = ${trueText(P, 2 * n)}。`, ask: { tag: 'result', kind: 'bin', width: 2 * n + 1, q: '[x·y]原 是？（符号位 + 小数点后面的位）', answer: BigInt(`0b${neg ? 1 : 0}${bits(mag, 2 * n)}`), display: prodText } });
  return { steps, rows, P, prodText };
}

const run = (input) => (input.algo === 'booth' ? runBooth(input) : runOrig(input));

function view(s, input) {
  const head = `<tr><th>部分积</th><th>乘数${input.algo === 'booth' ? `<small>（y${input.n + 1}）</small>` : ''}</th><th>说明</th></tr>`;
  const body = s.rows.map((r, i) => {
    const fresh = s.from !== undefined && i >= s.from;
    const a = r.kind === 'add' ? `+ ${r.a}` : r.kind === 'shift' ? `→ ${r.a}` : ` ${r.a}`;
    return `<tr class="ml-${r.kind}${fresh ? ' ml-new' : ''}" data-cmd="${i + 1}"><td class="ml-a">${a}</td><td class="ml-q">${r.q}${input.algo === 'booth' && r.q ? `<span class="ml-q1">${r.q1}</span>` : ''}</td><td class="ml-n">${r.note}</td></tr>`;
  }).join('');
  return `<div class="ml-wrap"><table class="ml-tab sv-tab"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

export const mulEngine = {
  name: 'mul', title: '定点乘法', parse, run, view,
  quiz(input, r) {
    const n = input.n;
    return { q: `用${NAME[input.algo]}算 x·y，x = ${input.xs}，y = ${input.ys}（${n} 位数值位）。写出 [x·y]${input.algo === 'booth' ? '补' : '原'}（符号位 + ${2 * n} 位小数）。`, type: 'bin', width: 2 * n + 1, answer: `0b${r.prodText.replace('.', '')}` };
  },
  // 考卷上那张表：每次移位以后的部分积和乘数
  table(input, r) {
    const shifts = r.rows.filter((x) => x.kind === 'shift');
    const alts = (t) => [t, t.replace('.', '')];
    return {
      q: `用${NAME[input.algo]}算，填每次右移以后的部分积和乘数${input.algo === 'booth' ? `（乘数写 ${input.n + 1} 位，不含 y${input.n + 1}）` : ''}。`, qhtml: '', dir: 'row',
      head: ['部分积', '乘数'],
      rows: shifts.map((x, i) => ({ label: `第 ${i + 1} 次右移后`, cells: [{ v: alts(x.a) }, { v: [x.q] }] })),
      extra: [{ label: `[x·y]${input.algo === 'booth' ? '补' : '原'}`, v: alts(r.prodText) }],
    };
  },
  // 常见错法：Booth 把两位读反了（看成 y_{n+1} y_n）、最后一次也移位了、只加了 n 次；原码一位乘当成算术右移（和对的一样时不列）
  variants(input) {
    const sig = (r) => JSON.stringify([r.prodText, r.steps.map((s) => String(s.ask?.answer ?? ''))]);
    const right = sig(run(input));
    const list = input.algo === 'booth'
      ? [['pairRev', '像是把最低两位读反了（看的是 y_n y_{n+1}：01 加 [x]补，10 加 [−x]补）'], ['extraShift', '像是最后一次加完也移位了（Booth 一共加 n + 1 次、只移 n 次）'], ['noLastAdd', '像是只加了 n 次（还要看最后一次 y_n y_{n+1} 再加一次，不移位）']]
      : [['arith', '像是右移时当成算术右移了（原码一位乘是逻辑右移，最前面那一位是进位，移进来以后补 0）']];
    const out = [];
    for (const [m, label] of list) {
      const v = { ...input, mistake: m };
      try { if (sig(run(v)) !== right) out.push({ label, input: v }); } catch { /* */ }
    }
    return out;
  },
};

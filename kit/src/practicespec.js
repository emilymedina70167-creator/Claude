// practice 的自定义题型（type: custom）：课堂里的 Claude 写出题模板，页面不断出新题、精确判分。
// 纯函数，有测试（tests/practice.test.js）。
//
//   type: custom
//   pick a = int(-3, 3) nonzero        随机取数：int(最小, 最大)、choice(1, 2, 5)、vec(3, -2, 2)、mat(2, 2, -3, 3)
//   pick c = int(1, 3)
//   let A = [[c, 1], [a*c, a]]         由取到的数算出来的量（精确分数）
//   where tr(A) != 0                   条件：不满足就重新取（一行一个，都要成立）
//   q: 设 $A=\calc{A}$，求 $A^{5}$。
//   answer: A^5
//   explain: $A^5=(\operatorname{tr}A)^4A=\calc{A^5}$
import { parse } from './expr.js';
import { calcValue, expandCalc, isQ, Q, textValue } from './exact.js';
import './algofuncs.js'; // where 里用得到 faults()、nextval()（引擎算）

const CMD = /^(pick|let|where)\s+(.*)$/i;
const NAME = /^[A-Za-z_][\w]*$/;
const ONE_LINE = new Set(['id', 'title', 'type', 'types', 'count', 'level', 'answer', 'before', 'after', 'formula', 'check', 'width', 'calc', 'domain']);
// 常数和图里的变量名不能拿来 pick；n 只有在 formula: n（答案是含 n 的式子）时才不能用
// I、E 可以用（组成原理里 E 是阶码）：题目里的量只在这个题型里有效，单独写 E 就是它，E(3) 照样是单位矩阵
const RESERVED = new Set(['pi', 'e', 'step', 't']);
const GENS = ['int', 'choice', 'vec', 'mat', 'bits', 'seq', 'word', 'str'];

/** 解析模板。返回 { fields, picks, lets, wheres }；写错了抛出中文原因 */
export function parseTemplate(src) {
  const fields = {};
  const picks = [], lets = [], wheres = [];
  let last = null;
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.replace(/\s+#\s.*$/, '').trimEnd();
    if (!line.trim()) { if (last) fields[last] += '\n'; continue; }
    const t = line.trim();
    if (commandLine(t, { picks, lets, wheres })) { last = null; continue; }
    const f = line.match(/^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/);
    if (f) { last = f[1].toLowerCase(); fields[last] = f[2]; continue; }
    if (last && !ONE_LINE.has(last)) fields[last] += '\n' + line;
    else throw new Error(`看不懂这一行：${t}（自定义题型的命令：pick / let / where，题面写 q:，答案写 answer:）`);
  }
  for (const k in fields) fields[k] = fields[k].trim();
  if (fields.formula && /\bn\b/.test(fields.formula)) {
    const clash = [...picks, ...lets].find((x) => x.name === 'n');
    if (clash) throw new Error(`「${clash.line.slice(0, 60)}」：formula: n 的答案里 n 是变量，pick / let 不能再叫 n，换一个名字`);
  }
  if (!picks.length) throw new Error('自定义题型至少要一条 pick（随机取的数），比如 pick a = int(-3, 3) nonzero');
  if (!fields.q) throw new Error('自定义题型要写 q:（题面，里面用 \\calc{…} 写出取到的数）');
  if (!fields.answer) throw new Error('自定义题型要写 answer:（答案的表达式，用 pick / let 的名字）');
  return { fields, picks, lets, wheres };
}

/**
 * 一行 pick / let / where（自定义题型、practice 的 use: 共用）：是命令就解析进 into，返回 true；
 * 不是命令返回 false；写错了抛出中文原因（带着这一行）
 */
export function commandLine(t, into) {
  const c = t.match(CMD);
  if (!c) return false;
  const kind = c[1].toLowerCase();
  try {
    if (kind === 'where') { parse(c[2]); into.wheres.push({ src: c[2].trim(), line: t }); }
    else {
      const m = c[2].match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
      if (!m) throw new Error(`${kind} 的写法：${kind} 名字 = ${kind === 'pick' ? 'int(-3, 3)' : '表达式'}`);
      if (RESERVED.has(m[1])) throw new Error(`${m[1]} 是保留的名字，换一个`);
      if (kind === 'pick') into.picks.push({ name: m[1], ...parsePick(m[2]), line: t });
      else { parse(m[2]); into.lets.push({ name: m[1], src: m[2].trim(), line: t }); }
    }
  } catch (e) {
    throw new Error(`「${t.slice(0, 60)}」：${e.message}`);
  }
  return true;
}

/** 取到的数写成一行（作答记录、自检的报错用）：a=3，d=1011，v=7 0 1 2 */
export function pickedText(picked) {
  const one = (v) => (isQ(v) ? v.toString() : Array.isArray(v) ? (v.some(Array.isArray) ? `[${v.map(one).join('; ')}]` : v.map(one).join(' ')) : v?.digits ?? String(v));
  return Object.entries(picked || {}).map(([n, v]) => `${n}=${one(v)}`).join('，');
}

// pick 的右边：int(-3, 3) nonzero / choice(1, 2, 5) / vec(3, -2, 2) / mat(2, 2, -3, 3)
// 计算机课：bits(4)（一串 0/1，写出来就是 1011）/ seq(8, 0, 5)（8 个数的一串，后面可以加 distinct：不重复）
function parsePick(rhs) {
  let s = rhs.trim();
  let nonzero = false, distinct = false;
  for (let m; (m = s.match(/\s+(nonzero|distinct)$/i));) {
    if (m[1].toLowerCase() === 'nonzero') nonzero = true; else distinct = true;
    s = s.slice(0, m.index);
  }
  const m = s.match(/^([a-z]+)\s*\((.*)\)$/i);
  if (!m || !GENS.includes(m[1].toLowerCase())) throw new Error(`pick 的右边写 int(最小, 最大)、choice(…)、vec(维数, 最小, 最大)、mat(行, 列, 最小, 最大)、bits(位数)、seq(个数, 最小, 最大)、word(词, 词) 或 str(长度, 字母表)，后面可以加 nonzero`);
  const gen = m[1].toLowerCase();
  const args = splitArgs(m[2]);
  if (distinct && gen !== 'seq') throw new Error('distinct（不重复）只能跟在 seq(…) 后面');
  // 文字：word(fifo, lru, opt) 挑一个词（算法名、方向）；str(7, ab) 用 a、b 拼一个 7 个字母的串（KMP 的模式串）
  if (gen === 'word') {
    if (!args.length || args.some((a) => !a.trim())) throw new Error('word(…) 里写几个词，用逗号隔开，比如 word(fifo, lru, opt)');
    return { gen, items: args, nonzero };
  }
  if (gen === 'str') {
    const len = Number(args[0]);
    if (args.length !== 2 || !Number.isInteger(len) || len < 1 || len > 16 || !/^[A-Za-z0-9]{2,8}$/.test(args[1])) throw new Error('str(长度, 字母表)：长度 1 到 16，字母表写 2 到 8 个字母，比如 str(7, ab)');
    return { gen, nums: [len], chars: args[1], nonzero };
  }
  if (gen === 'bits') {
    const w = Number(args[0]);
    if (args.length !== 1 || !Number.isInteger(w) || w < 1 || w > 32) throw new Error('bits(位数)：位数写 1 到 32 的整数，比如 bits(4)');
    return { gen, nums: [w], nonzero };
  }
  if (gen === 'seq') {
    const nums = args.map(Number);
    if (nums.length !== 3 || !nums.every(Number.isInteger)) throw new Error('seq(个数, 最小, 最大)：都写整数，比如 seq(8, 0, 5)');
    if (nums[0] < 1 || nums[0] > 20) throw new Error('seq 的个数写 1 到 20');
    if (nums[2] < nums[1]) throw new Error('seq 的最大值要不小于最小值');
    if (distinct && nums[2] - nums[1] + 1 < nums[0]) throw new Error(`seq(${nums.join(', ')}) distinct：${nums[1]} 到 ${nums[2]} 只有 ${nums[2] - nums[1] + 1} 个数，取不出 ${nums[0]} 个不重复的`);
    return { gen, nums, nonzero, distinct };
  }
  if (gen === 'choice') {
    if (!args.length) throw new Error('choice 里至少写一个值');
    args.forEach((a) => parse(a));
    return { gen, items: args, nonzero };
  }
  // 范围可以是前面 pick 过的量的式子（int(0, g*2^k - 1)），取的时候再算；写死的整数现在就检查
  const nums = args.map((a) => {
    if (/^-?\d+$/.test(a)) return Number(a);
    if (gen !== 'int') throw new Error(`${gen}(…) 里写整数（看不懂「${a}」）`);
    try { parse(a); } catch { throw new Error(`int(…) 里写整数，或者用前面 pick 的量写的式子（看不懂「${a}」）`); }
    return a;
  });
  const need = { int: 2, vec: 3, mat: 4 }[gen];
  if (nums.length !== need) throw new Error({ int: 'int(最小, 最大)', vec: 'vec(维数, 最小, 最大)', mat: 'mat(行, 列, 最小, 最大)' }[gen]);
  const [lo, hi] = nums.slice(-2);
  if (typeof lo === 'number' && typeof hi === 'number' && !(hi >= lo)) throw new Error(`${gen} 的最大值要不小于最小值`);
  if (nonzero && lo === 0 && hi === 0) throw new Error('范围里只有 0，nonzero 取不到数');
  if (gen !== 'int' && nums.slice(0, need - 2).some((d) => d < 1 || d > 6)) throw new Error(`${gen} 的大小写 1 到 6`);
  return { gen, nums, nonzero };
}

// 按最外层逗号切
function splitArgs(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const randInt = (lo, hi, rand) => lo + Math.floor(rand() * (hi - lo + 1));

function draw(p, vars, rand) {
  const int = (lo, hi) => {
    let x;
    do x = randInt(lo, hi, rand); while (p.nonzero && x === 0);
    return Q.int(x);
  };
  if (p.gen === 'int') {
    const bound = (x) => {
      if (typeof x === 'number') return x;
      const v = calcValue(x, vars).value;
      if (!isQ(v) || !v.integer) throw new Error(`int(…) 的范围「${x}」算出来不是整数`);
      return Number(v.n);
    };
    const lo = bound(p.nums[0]), hi = bound(p.nums[1]);
    if (hi < lo) throw new Error(`int(${p.nums[0]}, ${p.nums[1]}) 的最大值比最小值小`);
    return int(lo, hi);
  }
  if (p.gen === 'choice') return calcValue(p.items[randInt(0, p.items.length - 1, rand)], vars).value;
  if (p.gen === 'word') return textValue(p.items[randInt(0, p.items.length - 1, rand)]);
  if (p.gen === 'str') return textValue(Array.from({ length: p.nums[0] }, () => p.chars[randInt(0, p.chars.length - 1, rand)]).join(''));
  if (p.gen === 'bits') {
    // 一位一位取（位数多时 2^w 超过 JS 整数的精度）；写出来就是 0/1 串，不能再算
    for (;;) {
      const d = Array.from({ length: p.nums[0] }, () => (rand() < 0.5 ? '0' : '1')).join('');
      if (!p.nonzero || d.includes('1')) return calcValue(`bin(0b${d}, ${p.nums[0]})`, {}).value;
    }
  }
  if (p.gen === 'seq') {
    const [len, lo, hi] = p.nums;
    if (p.distinct) {
      const pool = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
      for (let i = pool.length - 1; i > 0; i--) { const j = randInt(0, i, rand); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      return pool.slice(0, len).map((x) => Q.int(x));
    }
    for (;;) {
      const v = Array.from({ length: len }, () => Q.int(randInt(lo, hi, rand)));
      if (!p.nonzero || v.some((x) => !x.zero)) return v;
    }
  }
  if (p.gen === 'vec') {
    // nonzero：向量不能全是 0（每个分量可以是 0）
    for (;;) {
      const v = Array.from({ length: p.nums[0] }, () => Q.int(randInt(p.nums[1], p.nums[2], rand)));
      if (!p.nonzero || v.some((x) => !x.zero)) return v;
    }
  }
  for (;;) {
    const M = Array.from({ length: p.nums[0] }, () => Array.from({ length: p.nums[1] }, () => Q.int(randInt(p.nums[2], p.nums[3], rand))));
    if (!p.nonzero || M.some((r) => r.some((x) => !x.zero))) return M;
  }
}

const truthy = (v) => (isQ(v) ? !v.zero : typeof v === 'number' ? v !== 0 : !!v);

/**
 * 取一组数：pick → let → where，不满足 where（或者 let 算不出来，比如除以 0）就重取。
 * 返回 { vars, picked（取到的数，记进作答记录）}；300 次都取不到时抛出中文原因
 */
export function instantiate(tpl, { base = {}, rand = Math.random, tries = 300, avoid = null } = {}) {
  let lastErr = null, failedWhere = null;
  for (let t = 0; t < tries; t++) {
    const vars = { ...base };
    try {
      for (const p of tpl.picks) vars[p.name] = draw(p, vars, rand);
      for (const l of tpl.lets) vars[l.name] = calcValue(l.src, vars).value;
      const bad = tpl.wheres.find((w) => !truthy(calcValue(w.src, vars).value));
      if (bad) { failedWhere = bad; continue; }
    } catch (e) {
      lastErr = e;
      continue;
    }
    const picked = Object.fromEntries(tpl.picks.map((p) => [p.name, vars[p.name]]));
    // 和上一题取到的一样：再取一次（取值空间很小时就算了）
    if (avoid && sameVals(picked, avoid) && t < tries / 2) continue;
    return { vars, picked };
  }
  if (lastErr && !failedWhere) throw new Error(`取了 ${tries} 次都算不出来：${lastErr.message}`);
  throw new Error(`取了 ${tries} 次都没满足「${failedWhere?.line || 'where'}」：条件太严，或者 pick 的范围太小`);
}

function sameVals(a, b) {
  const s = (v) => JSON.stringify(v, (k, x) => (isQ(x) ? x.toString() : x));
  return s(a) === s(b);
}

/** 题面这类文字里的 \calc 换成算好的 TeX（记录、给课堂 Claude 看的题目原文用）；算不出来的返回 errors */
export function fillText(text, vars) {
  return expandCalc(String(text ?? ''), (e) => calcValue(e, vars).tex);
}

/**
 * 模板写得对不对：取几组数，题面、提示、解析、答案都要算得出来。返回出错的说明（没有就是空数组）。
 * formulaCheck：答案是式子时，检查它代得进去（由调用方给，免得这里依赖 formula.js 的细节）
 */
export function checkTemplate(tpl, { base = {}, rand = Math.random, rounds = 12, formulaCheck = null } = {}) {
  const errors = [];
  for (let k = 0; k < rounds && !errors.length; k++) {
    let inst;
    try { inst = instantiate(tpl, { base, rand }); } catch (e) { errors.push(e.message); break; }
    const at = pickedText(inst.picked);
    for (const f of ['q', 'hint', 'explain', 'before', 'after']) {
      if (!tpl.fields[f]) continue;
      const r = fillText(tpl.fields[f], inst.vars);
      for (const e of r.errors) errors.push(`取 ${at} 时，${f}: 里的 \\calc{${e.expr.trim().slice(0, 40)}} 算不出来：${e.msg}`);
    }
    try {
      if (formulaCheck) formulaCheck(inst.vars);
      else calcValue(tpl.fields.answer, inst.vars);
    } catch (e) { errors.push(`取 ${at} 时，answer: 算不出来：${e.message}`); }
  }
  return errors;
}

// —— 内置的线代题型：就是写好的自定义模板（和 type: custom 同一套取数、自检、判分），按 level 选难度 ——
// 每个题型 [level 1, level 2]；数都取得「好算」：行列式不大、逆矩阵分母小、特征值是整数
const T = String.raw;
export const BUILTIN_TEMPLATES = {
  det3: {
    name: '三阶 / 四阶行列式',
    levels: [T`pick A = mat(3, 3, -3, 3)
where det(A) != 0
where abs(det(A)) <= 40
q: 计算行列式 $D=\calc{vmat(A)}$。
answer: det(A)
before: D =
hint: 先用倍加把一列（一行）化出两个 0（倍加不改变行列式），再按它展开。
explain: $D=\calc{det(A)}$。`, T`pick A = mat(4, 4, -2, 2)
where det(A) != 0
where abs(det(A)) <= 60
q: 计算四阶行列式 $D=\calc{vmat(A)}$。
answer: det(A)
before: D =
hint: 先化出一列只剩一个非零元，按这一列展开降成三阶；换行要变号。
explain: $D=\calc{det(A)}$。`],
  },
  inverse: {
    name: '求逆矩阵',
    levels: [T`pick A = mat(2, 2, -4, 4)
where det(A) != 0
where abs(det(A)) <= 6
q: 求 $A=\calc{A}$ 的逆矩阵。
answer: inv(A)
before: A^{-1} =
hint: 二阶矩阵：主对角线两个数换位置，副对角线两个数变号，再除以 $|A|$。
explain: $|A|=\calc{det(A)}$，$A^{-1}=\calc{inv(A)}$。`, T`pick A = mat(3, 3, -2, 2)
where abs(det(A)) == 1
q: 求 $A=\calc{A}$ 的逆矩阵。
answer: inv(A)
before: A^{-1} =
hint: 对 $(A\mid E)$ 做初等行变换，左边化成 $E$ 时右边就是 $A^{-1}$。
explain: $A^{-1}=\calc{inv(A)}$（乘回去验算 $AA^{-1}=E$）。`],
  },
  rank: {
    name: '矩阵的秩',
    levels: [T`pick u = vec(3, -2, 2)
pick v = vec(4, -2, 2)
pick w = vec(3, -2, 2)
pick z = vec(4, -2, 2)
pick s = choice(0, 1, 1)
let A = u*v' + s*w*z'
where rank(A) >= 1
q: 求矩阵 $A=\calc{A}$ 的秩。
answer: rank(A)
before: r(A) =
hint: 用初等行变换化成行阶梯形，数非零行。
explain: 化成阶梯形后有 $\calc{rank(A)}$ 个非零行，$r(A)=\calc{rank(A)}$。`, T`pick B = mat(4, 2, -2, 2)
pick C = mat(2, 5, -2, 2)
pick D = mat(4, 1, -1, 1)
pick F = mat(1, 5, -1, 1)
let A = B*C + D*F
where rank(A) >= 2
q: 求矩阵 $A=\calc{A}$ 的秩。
answer: rank(A)
before: r(A) =
hint: 用初等行变换化成行阶梯形，数非零行。
explain: $r(A)=\calc{rank(A)}$。`],
  },
  eigen: {
    name: '特征值',
    levels: [T`pick P = mat(2, 2, -2, 2)
pick a = int(-3, 4)
pick b = int(-3, 4)
where abs(det(P)) == 1
where a < b
let A = P*diag(a, b)*inv(P)
where tr(A'*A) <= 120
q: 求 $A=\calc{A}$ 的特征值（从小到大写）。
answer: [a, b]
hint: $|\lambda E-A|=\lambda^2-\operatorname{tr}(A)\,\lambda+|A|$，令它等于 0。
explain: 特征值是 $\calc{a}$ 和 $\calc{b}$。验算：两者之和是 $\operatorname{tr}A=\calc{tr(A)}$，乘积是 $|A|=\calc{det(A)}$。`, T`pick P = mat(3, 3, -1, 1)
pick a = int(-2, 3)
pick b = int(-2, 3)
pick c = int(-2, 3)
where abs(det(P)) == 1
where a < b
where b < c
let A = P*diag(a, b, c)*inv(P)
where tr(A'*A) <= 150
q: 求 $A=\calc{A}$ 的特征值（从小到大写）。
answer: [a, b, c]
hint: 解 $|\lambda E-A|=0$；可以先试试 $\operatorname{tr}A$ 的因数，再用「特征值之和 = 迹、之积 = 行列式」验算。
explain: 特征值是 $\calc{a}$、$\calc{b}$、$\calc{c}$（和 $=\operatorname{tr}A=\calc{tr(A)}$，积 $=|A|=\calc{det(A)}$）。`],
  },
  eigvec: {
    name: '特征向量',
    check: 'eigvec',
    levels: [T`pick P = mat(2, 2, -2, 2)
pick a = int(-3, 4)
pick b = int(-3, 4)
where abs(det(P)) == 1
where a != b
let A = P*diag(a, b)*inv(P)
where tr(A'*A) <= 120
q: $A=\calc{A}$ 的特征值是 $\calc{a}$ 和 $\calc{b}$。求属于 $\lambda=\calc{a}$ 的一个特征向量。
answer: col(P, 1)
check: eigvec
hint: 解 $(\lambda E-A)\mathbf x=\mathbf 0$，$\lambda=\calc{a}$。
explain: 比如 $\calc{col(P, 1)}$，它的任何非零倍数都对。`, T`pick P = mat(3, 3, -1, 1)
pick a = int(-2, 3)
pick b = int(-2, 3)
pick c = int(-2, 3)
where abs(det(P)) == 1
where a != b
where a != c
where b != c
let A = P*diag(a, b, c)*inv(P)
where tr(A'*A) <= 150
q: $A=\calc{A}$ 的特征值是 $\calc{a}$、$\calc{b}$、$\calc{c}$。求属于 $\lambda=\calc{a}$ 的一个特征向量。
answer: col(P, 1)
check: eigvec
hint: 解 $(\lambda E-A)\mathbf x=\mathbf 0$，$\lambda=\calc{a}$：化成行最简形，自由未知数取 1。
explain: 比如 $\calc{col(P, 1)}$，它的任何非零倍数都对。`],
  },
  quadform: {
    name: '二次型的矩阵',
    levels: [T`pick S = mat(3, 3, -3, 3)
let A = (S + S')/2
where rank(A) >= 2
q: 写出二次型 $f=\calc{qf(A)}$ 的矩阵 $A$。
answer: A
before: A =
hint: 平方项 $x_i^2$ 的系数放在对角线上；交叉项 $x_ix_j$ 的系数除以 2，放在 $a_{ij}$ 和 $a_{ji}$ 两个位置。
explain: $A=\calc{A}$。`, T`pick S = mat(4, 4, -3, 3)
let A = (S + S')/2
where rank(A) >= 3
q: 写出二次型 $f=\calc{qf(A)}$ 的矩阵 $A$。
answer: A
before: A =
hint: 交叉项 $x_ix_j$ 的系数除以 2，放在 $a_{ij}$ 和 $a_{ji}$ 两个位置。
explain: $A=\calc{A}$。`],
  },
};

/** 内置模板题型：名字 + level → 解析好的模板（不是内置模板的返回 null） */
export function builtinTemplate(name, level = 1) {
  const b = BUILTIN_TEMPLATES[String(name).trim().toLowerCase()];
  if (!b) return null;
  const src = b.levels[Math.min(b.levels.length, Math.max(1, Number(level) || 1)) - 1];
  return { ...parseTemplate(src), name: b.name };
}

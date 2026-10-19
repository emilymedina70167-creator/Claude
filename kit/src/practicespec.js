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
import { calcValue, expandCalc, isQ, Q } from './exact.js';

const CMD = /^(pick|let|where)\s+(.*)$/i;
const NAME = /^[A-Za-z_][\w]*$/;
const ONE_LINE = new Set(['id', 'title', 'type', 'types', 'count', 'level', 'answer', 'before', 'after', 'formula', 'check', 'width']);
// 常数和图里的变量名不能拿来 pick；n 只有在 formula: n（答案是含 n 的式子）时才不能用
// I、E 可以用（组成原理里 E 是阶码）：题目里的量只在这个题型里有效，单独写 E 就是它，E(3) 照样是单位矩阵
const RESERVED = new Set(['pi', 'e', 'step', 't']);
const GENS = ['int', 'choice', 'vec', 'mat'];

/** 解析模板。返回 { fields, picks, lets, wheres }；写错了抛出中文原因 */
export function parseTemplate(src) {
  const fields = {};
  const picks = [], lets = [], wheres = [];
  let last = null;
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.replace(/\s+#\s.*$/, '').trimEnd();
    if (!line.trim()) { if (last) fields[last] += '\n'; continue; }
    const t = line.trim();
    const c = t.match(CMD);
    if (c) {
      const kind = c[1].toLowerCase();
      try {
        if (kind === 'where') { parse(c[2]); wheres.push({ src: c[2].trim(), line: t }); }
        else {
          const m = c[2].match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
          if (!m) throw new Error(`${kind} 的写法：${kind} 名字 = ${kind === 'pick' ? 'int(-3, 3)' : '表达式'}`);
          if (RESERVED.has(m[1])) throw new Error(`${m[1]} 是保留的名字，换一个`);
          if (kind === 'pick') picks.push({ name: m[1], ...parsePick(m[2]), line: t });
          else { parse(m[2]); lets.push({ name: m[1], src: m[2].trim(), line: t }); }
        }
      } catch (e) {
        throw new Error(`「${t.slice(0, 60)}」：${e.message}`);
      }
      last = null;
      continue;
    }
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

// pick 的右边：int(-3, 3) nonzero / choice(1, 2, 5) / vec(3, -2, 2) / mat(2, 2, -3, 3)
function parsePick(rhs) {
  let s = rhs.trim();
  const nonzero = /\s+nonzero$/i.test(s);
  if (nonzero) s = s.replace(/\s+nonzero$/i, '');
  const m = s.match(/^([a-z]+)\s*\((.*)\)$/i);
  if (!m || !GENS.includes(m[1].toLowerCase())) throw new Error(`pick 的右边写 int(最小, 最大)、choice(…)、vec(维数, 最小, 最大) 或 mat(行, 列, 最小, 最大)，后面可以加 nonzero`);
  const gen = m[1].toLowerCase();
  const args = splitArgs(m[2]);
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
    const at = Object.entries(inst.picked).map(([n, v]) => `${n}=${isQ(v) ? v.toString() : JSON.stringify(v, (kk, x) => (isQ(x) ? x.toString() : x))}`).join('，');
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

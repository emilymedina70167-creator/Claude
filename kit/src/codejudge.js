// code 组件的判题（408 的算法设计题）：学生写 C 函数，老师给测试，页面用 trace 的解释器（cinterp.js）真的跑一遍，
// 逐个测试比数组、返回值、输出；再按几组规模跑出步数，估时间复杂度（「大约 O(n)」）和额外空间。纯函数，不碰 DOM（tests/codejudge.test.js）。
//
// 老师写：
//   fn: void Reverse(int A[], int n)     要学生写的函数（开头的代码框里就是它，函数体空着）
//   call: Reverse(A, n)                  每个测试怎么调用（不写就照 fn 的参数名调用）
//   tests:                               一行一个：输入 -> 期望（-> 后面不写就用 ref: 的参考解法算）
//     A = [1, 2, 3, 4, 5], n = 5 -> A = [5, 4, 3, 2, 1]
//     A = [3, 1, 2], n = 3 -> return = 2
//   ref: | 参考解法（多行，学生看不到）：没写期望的测试用它算；也拿它的复杂度和学生的比
//   scale: n = 4 8 16 32; A = rand(n)     估复杂度：n 取这几个值，其余的输入由 n 生成
import { parseProgram, runProgram, parseExpression, CError } from './cinterp.js';
import { evaluate } from './expr.js';

const SIZES = [4, 8, 16, 32];
const MAX_STEPS_SCALE = 60000;

// 一个值：数、字符 'a'、数组 [1, 2]、二维 [[1, 2], [3, 4]]、字符串 "abc"
export function parseValue(src, what = '') {
  const s = String(src ?? '').trim();
  if (/^"(.*)"$/s.test(s)) return { str: s.slice(1, -1) };
  if (/^'.'$/.test(s)) return s[1];
  try {
    const v = JSON.parse(s.replace(/'(.)'/g, '"$1"'));
    const ok = (x) => typeof x === 'number' || (typeof x === 'string' && x.length === 1);
    if (ok(v) || (Array.isArray(v) && (v.every(ok) || v.every((r) => Array.isArray(r) && r.every(ok))))) return v;
  } catch { /* 下面报错 */ }
  throw new Error(`${what}「${s}」看不懂：写数（3）、数组（[1, 2, 3]）、字符（'a'）或字符串（"abc"）`);
}

// 「A = [1, 2], n = 2」：按最外层逗号切（数组里的逗号不切）
function splitAssigns(src, what) {
  const parts = [];
  let depth = 0, cur = '', quote = '';
  for (const ch of String(src)) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if ('[('.includes(ch)) depth++;
    if ('])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const out = {};
  for (const p of parts) {
    const m = /^\s*([A-Za-z_]\w*)\s*=\s*([\s\S]+?)\s*$/.exec(p);
    if (!m) throw new Error(`${what}「${p.trim()}」要写成「名字 = 值」`);
    out[m[1]] = m[2];
  }
  return out;
}

/** 函数签名 void Reverse(int A[], int n) → { ret, name, params: [名字] } */
export function parseSignature(src) {
  const m = /^\s*([A-Za-z_][\w\s*&]*?)\s+\**\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*;?\s*$/.exec(String(src ?? ''));
  if (!m) throw new Error('fn: 写函数的样子，比如 fn: void Reverse(int A[], int n)');
  const params = m[3].trim() && m[3].trim() !== 'void' ? m[3].split(',').map((p) => {
    const n = /([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)*$/.exec(p.trim());
    if (!n) throw new Error(`fn: 的参数「${p.trim()}」看不懂`);
    return n[1];
  }) : [];
  return { ret: m[1].trim(), name: m[2], params, text: String(src).trim().replace(/;\s*$/, '') };
}

/** 老师写的字段 → 判题的说明。写错了抛出中文原因 */
export function parseCodeSpec(fields) {
  const sig = fields.fn ? parseSignature(fields.fn) : null;
  const call = String(fields.call ?? '').trim() || (sig ? `${sig.name}(${sig.params.join(', ')})` : '');
  if (!call && !/\bmain\b/.test(fields.ref || '')) throw new Error('code 要写 fn:（要学生写的函数，比如 fn: void Reverse(int A[], int n)）或 call:');
  let callExpr = null;
  if (call) { try { callExpr = parseExpression(call); } catch (e) { throw new Error(`call: 看不懂「${call}」：${e.message}`); } }
  const tests = String(fields.tests ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((line, k) => {
    const [inp, exp] = line.split(/\s*->\s*/);
    const input = Object.fromEntries(Object.entries(splitAssigns(inp, `tests 第 ${k + 1} 行：`)).map(([n, v]) => [n, parseValue(v, `tests 第 ${k + 1} 行 ${n} = `)]));
    const expect = exp === undefined ? null : Object.fromEntries(Object.entries(splitAssigns(exp, `tests 第 ${k + 1} 行 -> 后面：`)).map(([n, v]) => [n, parseValue(v, `tests 第 ${k + 1} 行 ${n} = `)]));
    return { line, input, expect };
  });
  if (!tests.length) throw new Error('code 要写 tests:（一行一个测试：A = [1, 2, 3], n = 3 -> A = [3, 2, 1]）');
  let ref = null;
  if (fields.ref) { try { ref = parseProgram(fields.ref); } catch (e) { throw new Error(`ref:（参考解法）${e instanceof CError ? e.message : e.message}`); } }
  if (!ref && tests.some((t) => !t.expect)) throw new Error('有的测试没写 -> 期望：要么写上，要么给 ref:（参考解法），页面拿它算');
  const scale = fields.scale ? parseScale(fields.scale) : null;
  const starter = String(fields.starter ?? '').trim() ? String(fields.starter).replace(/^\n+|\s+$/g, '') : sig ? `${sig.text} {\n    \n}` : '';
  return { sig, call, callExpr, tests, ref, scale, starter };
}

// scale: n = 4 8 16 32; A = rand(n), k = n / 2
export function parseScale(src) {
  const [head, rest = ''] = String(src).split(/\s*;\s*/);
  const m = /^\s*([A-Za-z_]\w*)\s*=\s*([\d\s,]+)$/.exec(head);
  if (!m) throw new Error('scale: 写成「n = 4 8 16 32; A = rand(n)」（先写规模变量和它取的几个值，再写别的输入怎么由它生成）');
  const sizes = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
  if (sizes.length < 3 || sizes.some((x) => !(x >= 1 && x <= 256))) throw new Error('scale: 至少给 3 个规模，每个 1 到 256');
  const gens = rest.trim() ? splitAssigns(rest, 'scale: ') : {};
  return { name: m[1], sizes, gens };
}

// 由规模生成输入：rand(n)（0～99 的随机数）、range(n)（1..n）、rev(n)（n..1）、zeros(n)，或者含 n 的算式
function genValue(src, env, rnd) {
  const m = /^\s*(rand|range|rev|zeros)\(\s*([^)]+)\)\s*$/.exec(src);
  if (m) {
    const len = Math.max(0, Math.round(evaluate(m[2], env)));
    if (m[1] === 'rand') return Array.from({ length: len }, () => Math.floor(rnd() * 100));
    if (m[1] === 'range') return Array.from({ length: len }, (_, i) => i + 1);
    if (m[1] === 'rev') return Array.from({ length: len }, (_, i) => len - i);
    return Array(len).fill(0);
  }
  return evaluate(src, env);
}

// 程序 + 学生代码：要学生写的函数在学生的代码里；老师 ref 里的辅助函数不混进来
function compile(code, what) {
  try { return parseProgram(code); } catch (e) { throw Object.assign(new Error(`${what}${e instanceof CError ? e.message : e.message}`), { line: e.line }); }
}

// 跑一次：返回 { arrays: {名字: 值}, ret, out, error, steps, depth, extra（额外数组的元素个数） }
function runOnce(program, spec, input, { maxSteps } = {}) {
  const vars = {};
  for (const [k, v] of Object.entries(input)) vars[k] = v && typeof v === 'object' && 'str' in v ? [...v.str, '\0'] : v;
  const fn = spec.callExpr?.t === 'call' ? program.funcs[spec.callExpr.name] : null;
  if (spec.callExpr && spec.callExpr.t === 'call' && !fn) return { error: `代码里没有函数 ${spec.callExpr.name}` };
  // 有返回值的：调用写成赋值给一个全局变量，跑完读出来
  const wantRet = fn && fn.ret !== 'void';
  if (wantRet) vars.__ret = fn.ret === 'double' || fn.ret === 'float' ? 0.5 : 0;
  const entry = spec.callExpr ? { src: spec.call, e: wantRet ? { t: 'assign', op: '=', target: { t: 'var', name: '__ret', line: 1 }, value: spec.callExpr, line: 1 } : spec.callExpr } : null;
  let r;
  try { r = runProgram(program, { entry, vars, maxSteps }); } catch (e) { return { error: e.message, line: e.line }; }
  const last = r.steps.at(-1) || { globals: [] };
  const arrays = {};
  let ret;
  for (const g of last.globals || []) {
    if (g.name === '__ret') ret = g.value;
    else if (g.arr && Object.hasOwn(input, g.name)) arrays[g.name] = g.data;
  }
  const depth = Math.max(0, ...r.steps.map((s) => (s.frames || []).length));
  const inputs = new Set(Object.keys(input));
  const extra = r.arrays.filter((a) => !inputs.has(a.name)).reduce((s, a) => s + a.dims.reduce((x, y) => x * y, 1), 0);
  return { arrays, ret, out: r.out, error: r.error ? r.error.message : null, line: r.error?.line, steps: r.steps.length, depth, extra };
}

const norm = (v) => {
  if (v && typeof v === 'object' && 'str' in v) return v.str;
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (typeof v === 'string' && /^'.'$/.test(v)) return v[1];
  return v;
};
// 解释器写出来的数组元素是文字（show 过的）：数按数比，字符按字符比
const sameVal = (a, b) => {
  const x = norm(a), y = norm(b);
  if (Array.isArray(x) || Array.isArray(y)) return Array.isArray(x) && Array.isArray(y) && x.length >= y.length && y.every((v, i) => sameVal(x[i], v));
  if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) < 1e-9;
  return String(x) === String(y);
};
const valText = (v) => {
  const x = norm(v);
  if (Array.isArray(x)) return `[${x.map(valText).join(', ')}]`;
  return typeof x === 'string' && x.length === 1 ? `'${x}'` : String(x);
};

/**
 * 跑全部测试：[{ ok, line（测试原文）, error, errLine, diff: [{ what, want, got }] }]。
 * code 是学生写的完整代码（就是那个函数，可以带辅助函数、#define、typedef）
 */
export function runTests(code, spec) {
  let program;
  try { program = compile(code, '代码'); } catch (e) { return spec.tests.map((t) => ({ ok: false, line: t.line, error: e.message, errLine: e.line, compile: true })); }
  return spec.tests.map((t) => {
    let expect = t.expect;
    if (!expect) {
      const rr = runOnce(spec.ref, spec, t.input);
      if (rr.error) return { ok: false, line: t.line, error: `参考解法在这个测试上出错了：${rr.error}`, teacher: true };
      expect = { ...rr.arrays, ...(rr.ret !== undefined ? { return: rr.ret } : {}), ...(rr.out ? { out: { str: rr.out } } : {}) };
    }
    const r = runOnce(program, spec, t.input);
    if (r.error) return { ok: false, line: t.line, error: r.error, errLine: r.line };
    const diff = [];
    for (const [k, want] of Object.entries(expect)) {
      const got = k === 'return' ? r.ret : k === 'out' ? { str: r.out } : r.arrays[k];
      if (got === undefined) { diff.push({ what: k, want: valText(want), got: k === 'return' ? '（函数没有返回值）' : '（没有这个变量）' }); continue; }
      if (k === 'out' ? norm(got) !== norm(want) : !sameVal(got, want)) diff.push({ what: k === 'return' ? '返回值' : k === 'out' ? '输出' : k, want: valText(want), got: valText(k === 'out' ? got : Array.isArray(norm(want)) ? norm(got).slice(0, norm(want).length) : got) });
    }
    return { ok: !diff.length, line: t.line, diff, steps: r.steps };
  });
}

// 步数随 n 怎么长：在几种增长方式里挑「步数 / f(n)」最稳定的那一个
const MODELS = [
  ['O(1)', () => 1], ['O(log n)', (n) => Math.log2(n)], ['O(n)', (n) => n], ['O(n log n)', (n) => n * Math.log2(n)],
  ['O(n²)', (n) => n * n], ['O(n³)', (n) => n ** 3], ['O(2ⁿ)', (n) => 2 ** n],
];
export function fitGrowth(ns, ys) {
  let best = null;
  for (const [label, f] of MODELS) {
    const r = ns.map((n, i) => ys[i] / f(n)).slice(1); // 最小的规模常数项影响大，不算
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    if (!(mean > 0) || !Number.isFinite(mean)) continue;
    const spread = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length) / mean;
    if (!best || spread < best.spread - 1e-9) best = { label, spread };
  }
  return best ? best.label : '';
}

/** 估复杂度：{ ns, steps, time（O(…)）, space（额外数组 + 递归深度的 O(…)）, error } */
export function estimate(code, spec, { seed = 1 } = {}) {
  if (!spec.scale) return null;
  let program;
  try { program = typeof code === 'string' ? compile(code, '代码') : code; } catch (e) { return { error: e.message }; }
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const ns = [], steps = [], spaces = [];
  for (const n of spec.scale.sizes) {
    const env = { [spec.scale.name]: n };
    const input = { [spec.scale.name]: n };
    try { for (const [k, src] of Object.entries(spec.scale.gens)) input[k] = genValue(src, env, rnd); } catch (e) { return { error: `scale: ${e.message}` }; }
    const r = runOnce(program, spec, input, { maxSteps: MAX_STEPS_SCALE });
    if (r.error) return { ns, steps, error: /已经走了/.test(r.error) ? `n = ${n} 时超过 ${MAX_STEPS_SCALE} 步了（太慢，或者死循环）` : `n = ${n} 时出错：${r.error}` };
    ns.push(n); steps.push(r.steps); spaces.push(r.extra + r.depth);
  }
  const flat = spaces.every((x) => x === spaces[0]);
  return { ns, steps, time: fitGrowth(ns, steps), space: flat ? 'O(1)' : fitGrowth(ns, spaces.map((x) => Math.max(1, x))) };
}

/** 参考解法的复杂度（老师给了 ref 和 scale 才有） */
export function refEstimate(spec) {
  return spec.ref && spec.scale ? estimate(spec.ref, spec) : null;
}

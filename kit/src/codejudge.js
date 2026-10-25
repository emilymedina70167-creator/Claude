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
//   check: | 答案不唯一时（「相对次序不限」）：老师写一个 C 函数 int check(int A[], int A0[], int n)，
//            A 是学生跑完的、A0 是原来的（每个数组参数后面跟一个 …0），返回 1 算对；printf 的话就是没过的原因
import { parseProgram, runProgram, parseExpression, CError } from './cinterp.js';
import { evaluate } from './expr.js';

const SIZES = [4, 8, 16, 32];
const MAX_STEPS_SCALE = 60000;

// 一个值：数、字符 'a'、数组 [1, 2]、二维 [[1, 2], [3, 4]]、字符串 "abc"、单链表 list [1, 2, 3]
export function parseValue(src, what = '') {
  const s = String(src ?? '').trim();
  // 链表的写法同 trace：第一个写「头」是带头结点，不写就是不带
  const lm = /^list\s*\[([\s\S]*)\]$/i.exec(s);
  if (lm) {
    const items = lm[1].split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    const head = items.length > 0 && /^(头|头结点|head|h)$/i.test(items[0]);
    const nums = (head ? items.slice(1) : items).map(Number);
    if (nums.some((x) => !Number.isFinite(x))) throw new Error(`${what}「${s}」：list 后面写结点里的数，带头结点的第一个写「头」，比如 list [头, 1, 2, 3]`);
    return { list: nums, head };
  }
  if (/^"(.*)"$/s.test(s)) return { str: s.slice(1, -1) };
  if (/^'.'$/.test(s)) return s[1];
  try {
    const v = JSON.parse(s.replace(/'(.)'/g, '"$1"'));
    const ok = (x) => typeof x === 'number' || (typeof x === 'string' && x.length === 1);
    if (ok(v) || (Array.isArray(v) && (v.every(ok) || v.every((r) => Array.isArray(r) && r.every(ok))))) return v;
  } catch { /* 下面报错 */ }
  throw new Error(`${what}「${s}」看不懂：写数（3）、数组（[1, 2, 3]）、字符（'a'）、字符串（"abc"）或单链表（list [头, 1, 2, 3]）`);
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
  const lists = [...new Set(tests.flatMap((t) => [...Object.entries(t.input), ...Object.entries(t.expect || {})].filter(([, v]) => v && typeof v === 'object' && 'list' in v).map(([k]) => k)))];
  // 带不带头结点看输入里的链表（同 trace：list [头, 1, 2] 带，list [1, 2] 不带）
  const heads = new Set(tests.flatMap((t) => Object.values(t.input).filter((v) => v && typeof v === 'object' && 'list' in v).map((v) => v.head)));
  if (heads.size > 1) throw new Error('tests 里的链表有的带头结点（list [头, …]）有的不带：一道题统一一种');
  const head = heads.has(true);
  if (lists.length && fields.check) throw new Error('链表题（list [...]）暂时不能配 check:：把期望的链表写在 -> 后面');
  const lspec = { lists, head, sig, call };
  let ref = null;
  if (fields.ref) { try { ref = compile(fields.ref, '', lspec); } catch (e) { throw new Error(`ref:（参考解法）${e.message}`); } }
  let check = null;
  if (fields.check) {
    try { check = parseProgram(fields.check); } catch (e) { throw new Error(`check:（检查函数）${e.message}`); }
    if (!check.funcs.check) throw new Error('check: 里要有一个叫 check 的函数，比如 int check(int A[], int A0[], int n)');
  }
  if (!ref && !check && tests.some((t) => !t.expect)) throw new Error('有的测试没写 -> 期望：要么写上，要么给 ref:（参考解法）或 check:（检查函数），页面拿它判');
  const scale = fields.scale ? parseScale(fields.scale) : null;
  // 链表题：起始代码带上王道的结点定义，学生知道成员叫 data、next
  const starter = String(fields.starter ?? '').trim() ? String(fields.starter).replace(/^\n+|\s+$/g, '') : sig ? `${lists.length ? `${LNODE}\n\n` : ''}${sig.text} {\n    \n}` : '';
  // check 怎么调：学生函数的参数，每个数组参数后面加一个原来的（A → A, A0）；有返回值的再加 ret
  const params = sig ? sig.params : [];
  const checkCall = check ? String(fields.check_call ?? '').trim() || `check(${[...params.flatMap((p) => (tests.some((t) => Array.isArray(t.input[p])) ? [p, `${p}0`] : [p])), ...(sig && sig.ret !== 'void' ? ['ret'] : [])].join(', ')})` : '';
  return { sig, call, callExpr, tests, ref, check, checkCall, scale, starter, lists, head };
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

// 链表题（王道的单链表）：测试里写 L = list [1, 2, 3]。解释器只认 C，所以在代码后面接一段 C 的架子：
// 先 malloc 出链表（list [头, 1, 2] 带头结点，list [1, 2] 不带）、调学生的函数、再把链表抄进一个数组读出来。
// 学生代码里没有 LNode 的 typedef 就在最前面补一行（报错的行号减回去）。
export const LNODE = 'typedef struct LNode { int data; struct LNode *next; } LNode, *LinkList;';
const LIST_MAX = 200; // 读回来最多这么多个结点：再多就是成环了
const hasLNode = (code) => /\bLNode\b[^;{]*\{|\}\s*LNode\b/.test(code);
function listHarness(spec) {
  const { lists, head } = spec;
  const ret = spec.sig && spec.sig.ret !== 'void' && !/\*|LinkList/.test(spec.sig.ret) ? spec.sig.ret : '';
  const build = (k) => `    ${k} = __mk(__a_${k}, __n_${k});`;
  return `
LinkList ${lists.join(', ')};
${lists.map((k) => `int __o_${k}[${LIST_MAX}];\nint __on_${k};`).join('\n')}
${ret ? `${ret} __ret;` : ''}
LinkList __mk(int a[], int n) {
    LNode *h = (LNode *)malloc(sizeof(LNode));
    h->next = NULL;
    LNode *t = h;
    for (int i = 0; i < n; i++) { LNode *s = (LNode *)malloc(sizeof(LNode)); s->data = a[i]; s->next = NULL; t->next = s; t = s; }
    ${head ? 'return h;' : 'LNode *f = h->next; free(h); return f;'}
}
int __dump(LinkList h, int o[]) {
    LNode *p = ${head ? 'h->next' : 'h'};
    int k = 0;
    while (p != NULL && k < ${LIST_MAX}) { o[k] = p->data; k++; p = p->next; }
    return k;
}
void __base() {
${lists.map(build).join('\n')}
${lists.map((k) => `    __on_${k} = __dump(${k}, __o_${k});`).join('\n')}
}
void __test() {
${lists.map(build).join('\n')}
    ${ret ? `__ret = ${spec.call};` : `${spec.call};`}
${lists.map((k) => `    __on_${k} = __dump(${k}, __o_${k});`).join('\n')}
}
`;
}

// 程序 + 学生代码：要学生写的函数在学生的代码里；老师 ref 里的辅助函数不混进来
function compile(code, what, spec = null) {
  let src = code, off = 0;
  if (spec?.lists?.length) {
    if (!hasLNode(code)) { src = `${LNODE}\n${code}`; off = 1; }
    src += `\n${listHarness(spec)}`;
  }
  try { return Object.assign(parseProgram(src), { off }); } catch (e) { throw Object.assign(new Error(`${what}${(e.message || '').replace(/第 (\d+) 行/, (_, n) => `第 ${n - off} 行`)}`), { line: e.line ? e.line - off : e.line }); }
}

// 跑一次：返回 { arrays: {名字: 值}, ret, out, error, steps, depth, extra（额外数组的元素个数） }
function runOnce(program, spec, input, { maxSteps, base = false } = {}) {
  if (spec.lists?.length) return runList(program, spec, input, { maxSteps, base });
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

// 链表题跑一次：架子里的 __test() 建链表、调用、读回来；base 不调用（估复杂度时减掉建链表、读回来的步数）
function runList(program, spec, input, { maxSteps, base }) {
  const vars = {};
  const off = program.off || 0;
  for (const [k, v] of Object.entries(input)) {
    if (spec.lists.includes(k)) {
      const a = Array.isArray(v) ? v : v?.list || [];
      vars[`__a_${k}`] = a.length ? a : [0];
      vars[`__n_${k}`] = a.length;
    } else vars[k] = v && typeof v === 'object' && 'str' in v ? [...v.str, '\0'] : v;
  }
  for (const k of spec.lists) if (!(`__n_${k}` in vars)) { vars[`__a_${k}`] = [0]; vars[`__n_${k}`] = 0; }
  const name = base ? '__base' : '__test';
  let r;
  try { r = runProgram(program, { entry: { src: `${name}()`, e: parseExpression(`${name}()`) }, vars, maxSteps }); } catch (e) { return { error: e.message, line: e.line && e.line - off }; }
  const last = r.steps.at(-1) || { globals: [] };
  const g = Object.fromEntries((last.globals || []).map((x) => [x.name, x]));
  const arrays = {};
  for (const [k, v] of Object.entries(input)) if (!spec.lists.includes(k) && g[k]?.arr) arrays[k] = g[k].data;
  for (const k of spec.lists) {
    const n = Number(g[`__on_${k}`]?.value);
    if (Number.isFinite(n)) arrays[k] = { list: g[`__o_${k}`].data.slice(0, n).map(Number), loop: n >= LIST_MAX };
  }
  const ret = g.__ret?.value;
  const depth = Math.max(0, ...r.steps.map((s) => (s.frames || []).length)) - 1; // __test 自己那一层不算
  const err = r.error ? r.error.message.replace(/第 (\d+) 行/, (_, n) => `第 ${n - off} 行`) : null;
  return { arrays, ret, out: r.out, error: err, line: r.error?.line && r.error.line - off, steps: r.steps.length, depth, extra: 0 };
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
  if (v && typeof v === 'object' && 'list' in v) return v.loop ? '（链表成环了：顺着 next 走不到 NULL）' : v.list.length ? `${v.list.join(' → ')} → NULL` : '空链表';
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
  try { program = compile(code, '代码', spec); } catch (e) { return spec.tests.map((t) => ({ ok: false, line: t.line, error: e.message, errLine: e.line, compile: true })); }
  return spec.tests.map((t) => {
    let expect = t.expect;
    if (!expect && spec.check) {
      // 老师的 check 函数判：学生跑完的数组 + 原来的数组（…0）+ 返回值
      const r = runOnce(program, spec, t.input);
      if (r.error) return { ok: false, line: t.line, error: r.error, errLine: r.line };
      const vars = {};
      for (const [k, v] of Object.entries(t.input)) {
        if (Array.isArray(v)) { vars[k] = (r.arrays[k] || v).map((x) => norm(x)); vars[`${k}0`] = v; } else vars[k] = v;
      }
      if (r.ret !== undefined) vars.ret = norm(r.ret);
      const cspec = { call: spec.checkCall, callExpr: parseExpression(spec.checkCall) };
      const c = runOnce(spec.check, cspec, vars);
      if (c.error) return { ok: false, line: t.line, error: `检查函数出错了：${c.error}`, teacher: true };
      const ok = Number(norm(c.ret)) !== 0;
      const got = Object.keys(t.input).filter((k) => Array.isArray(t.input[k])).map((k) => `${k} = ${valText(r.arrays[k])}`).join('，');
      return { ok, line: t.line, diff: ok ? [] : [{ what: '检查', want: c.out ? c.out.trim() : '满足题目的要求', got: got || valText(r.ret) }], steps: r.steps };
    }
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
      if (want && typeof want === 'object' && 'list' in want) {
        const ok = got && 'list' in got && !got.loop && got.list.length === want.list.length && got.list.every((x, i) => x === want.list[i]);
        if (!ok) diff.push({ what: k, want: valText(want), got: got ? valText(got) : '（没有这个变量）' });
        continue;
      }
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
  try { program = typeof code === 'string' ? compile(code, '代码', spec) : code; } catch (e) { return { error: e.message }; }
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const ns = [], steps = [], spaces = [];
  for (const n of spec.scale.sizes) {
    const env = { [spec.scale.name]: n };
    const input = { [spec.scale.name]: n };
    try { for (const [k, src] of Object.entries(spec.scale.gens)) input[k] = genValue(src, env, rnd); } catch (e) { return { error: `scale: ${e.message}` }; }
    const r = runOnce(program, spec, input, { maxSteps: MAX_STEPS_SCALE });
    if (r.error) return { ns, steps, error: /已经走了/.test(r.error) ? `n = ${n} 时超过 ${MAX_STEPS_SCALE} 步了（太慢，或者死循环）` : `n = ${n} 时出错：${r.error}` };
    // 链表题：建链表、读回来的步数不算学生的
    const b = spec.lists?.length ? runOnce(program, spec, input, { maxSteps: MAX_STEPS_SCALE, base: true }) : null;
    ns.push(n); steps.push(Math.max(1, r.steps - (b && !b.error ? b.steps : 0))); spaces.push(r.extra + r.depth);
  }
  const flat = spaces.every((x) => x === spaces[0]);
  return { ns, steps, time: fitGrowth(ns, steps), space: flat ? 'O(1)' : fitGrowth(ns, spaces.map((x) => Math.max(1, x))) };
}

/** 参考解法的复杂度（老师给了 ref 和 scale 才有） */
export function refEstimate(spec) {
  return spec.ref && spec.scale ? estimate(spec.ref, spec) : null;
}

// 作答判分里不碰 DOM 的部分（tests/v2.test.js）：
//   readCell：一格里写的数（分数精确，带根号的按值）；
//   parseConditions / checkConditions：answer 的 check: 条件判分（答案不唯一的题：特解、P、Q、可逆变换）。
import { Frac } from './linalg.js';
import { compile } from './expr.js';

/**
 * 一格里写的：整数、小数、分数照旧精确（Frac）；带根号的（1/√2、−2/√6、√3/3）按式子算成数，
 * 记下原来的写法（显示、记录用），参与比较时是它的值。正交矩阵、单位向量的答案要用
 */
export function readCell(text) {
  const s = String(text ?? '').trim().replace(/−/g, '-');
  try { return Frac.from(s); } catch { /* 不是分数，看看是不是带根号 */ }
  if (!/√|sqrt/i.test(s)) throw new Error('bad');
  const expr = s.replace(/√\s*\(/g, 'sqrt(').replace(/√\s*(\d+(?:\.\d+)?)/g, 'sqrt($1)');
  const v = compile(expr)({});
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('bad');
  return { v, s, valueOf() { return this.v; }, toString() { return this.s; } };
}

// —— check: 条件判分 ——
// 一行一个条件（或用 ; 隔开）：A*ans == b、det(ans) != 0、ans'*ans == E(3)；ans 是学生写的。
// 后面可以写「=> 不满足时说的话」。两边都是数、向量或矩阵，逐个元素比（容差 1e-6，根号的小数也认）
export function parseConditions(src) {
  return String(src).split(/[;\n]+/).map((x) => x.trim()).filter(Boolean).map((line) => {
    const [body, msg] = line.split('=>').map((x) => x.trim());
    const m = /^(.*?)(==|!=)(.*)$/.exec(body);
    if (!m) throw new Error(`check: 「${line}」要写成「式子 == 式子」或「式子 != 式子」`);
    const lhs = compile(m[1].trim()), rhs = compile(m[3].trim());
    return { text: body, op: m[2], lhs, rhs, msg: msg || '' };
  });
}
const toFloat = (x) => (Array.isArray(x) ? x.map(toFloat) : Number(x));
function close(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => close(x, b[i]));
  // 有一边不是有限数就不相等（dr-final-fix 第 1 条：∞ 和任何数的容差都是 ∞）
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}
export function checkConditions(cond, given, vars) {
  const scope = { ...vars, ans: toFloat(given) };
  for (const c of cond) {
    let ok;
    try { ok = close(c.lhs(scope), c.rhs(scope)) === (c.op === '=='); } catch (e) { return { ok: false, which: c.text, msg: `代进去算不了：${e.message}` }; }
    if (!ok) return { ok: false, which: c.text, msg: c.msg || `代进去不满足 ${c.text.replace(/\bans\b/g, '你的答案')}。` };
  }
  return { ok: true, msg: '' };
}

// —— 引用前面那道题学生写的答案：ans(q-P) ——
// 写在 check: 或 answer: 里（学生选的 P 不同，后面的 P⁻¹AP 照样判对）。表达式里不能有「-」这类字符，
// 先把 ans(编号) 换成 __ans0、__ans1 这样的变量名，判的时候再把那道题的答案放进去
const ANS_REF = /\bans\(\s*([A-Za-z0-9_\-.~:@+]+)\s*\)/g;
export function ansRefs(src) {
  const refs = [];
  const out = String(src ?? '').replace(ANS_REF, (m, id) => {
    let r = refs.find((x) => x.id === id);
    if (!r) { r = { id, name: `__ans${refs.length}` }; refs.push(r); }
    return r.name;
  });
  return { src: out, refs };
}

/**
 * answer: 里引用了前面的答案时，标准答案跟着学生前面写的变：把它变成一条 check（ans == 那个式子）。
 * 返回 { cond, refs }；answer 和 check 里都没引用就返回 null
 */
export function refConditions(answerSrc, checkSrc) {
  const a = ansRefs(answerSrc);
  const c = checkSrc ? ansRefs(checkSrc) : { src: '', refs: [] };
  if (!a.refs.length && !c.refs.length) return null;
  // 两边编号要一致：合在一起再换一次
  const both = ansRefs(`${answerSrc}\u0000${checkSrc || ''}`);
  const [ans2, check2] = both.src.split('\u0000');
  const cond = [];
  if (a.refs.length) cond.push({ ...parseConditions(`ans == ${ans2}`)[0], text: 'ans == 答案', msg: '按你前面那一题写的答案算，这里还不对。' });
  if (check2) cond.push(...parseConditions(check2));
  return { cond, refs: both.refs, answerSrc: ans2 };
}

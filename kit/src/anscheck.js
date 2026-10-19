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
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
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

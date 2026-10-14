// 代码逐行跟踪（组件 trace）：把一段 C 代码真的跑一遍（cinterp.js），一行一步：左边代码高亮当前行，右边变量、数组、调用栈、输出。
// 纯函数，不碰 DOM（tests/trace-engine.test.js）。写法：
//   call: InsertSort(A, 5)          从哪个函数开始（代码里有 main 就不用写）
//   let A = [0, 38, 49, 65, 13, 27] 给的输入（数组、数），一行一个
//   pointers: i, j                  哪些变量当成下标，画在数组格子下面（不写就找 i j k low high mid 这类名字）
//   predict: 7 if i == 4 -> j       先猜：执行第 7 行（i == 4 那一次）之后 j 是多少（几个用 ; 隔开）
//   code:                           放在最后，下面全是代码
import { parseProgram, runProgram, parseExpression, CError } from '../cinterp.js';
import { parseFields } from '../parse.js';
import { arrayView, esc } from './arrayview.js';

const AUTO_PTR = ['i', 'j', 'k', 'low', 'high', 'mid', 'left', 'right', 'l', 'r', 'p', 'q', 'front', 'rear', 'top', 'min', 'max', 'pos'];

export function parse(_fields, src) {
  const lines = String(src ?? '').split('\n');
  const at = lines.findIndex((l) => /^\s*code\s*[:：]\s*$/i.test(l));
  if (at < 0) throw new Error('trace 要写 code:（单独一行），下面是代码；code: 放在最后');
  const head = lines.slice(0, at);
  const code = lines.slice(at + 1).join('\n').replace(/^\n+|\s+$/g, '');
  if (!code) throw new Error('code: 下面没有代码');
  const vars = {};
  const rest = [];
  for (const l of head) {
    const m = /^\s*let\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s*$/.exec(l);
    if (m) { vars[m[1]] = parseValue(m[2], m[1]); continue; }
    rest.push(l);
  }
  const { fields } = parseFields(rest.join('\n'));
  let program;
  try { program = parseProgram(code); } catch (e) { throw new Error(e instanceof CError ? `代码${e.message}` : e.message); }
  let entry = null;
  if (fields.call) {
    try { entry = { src: fields.call.trim(), e: parseExpression(fields.call.trim()) }; } catch (e) { throw new Error(`call: 看不懂「${fields.call}」：${e.message}`); }
    if (entry.e.t !== 'call') throw new Error('call: 要写成函数调用，比如 InsertSort(A, 5)');
    if (!program.funcs[entry.e.name]?.body) throw new Error(`call: 代码里没有函数 ${entry.e.name}`);
  } else if (!program.funcs.main) throw new Error('代码里没有 main：写 call:（从哪个函数开始，如 call: InsertSort(A, 5)），用 let 给输入');
  const pointers = fields.pointers ? fields.pointers.split(/[\s,，、]+/).filter(Boolean) : null;
  const predicts = fields.predict ? String(fields.predict).split(/[;；\n]+/).map((x) => x.trim()).filter(Boolean).map(parsePredict) : [];
  const nLines = code.split('\n').length;
  for (const p of predicts) if (p.line < 1 || p.line > nLines) throw new Error(`predict: 代码只有 ${nLines} 行，没有第 ${p.line} 行`);
  const quiz = String(fields.quiz || '').trim();
  return { code, program, entry, vars, pointers, predicts, quiz };
}

// let 的值：数、字符 'a'、数组 [1, 2]、二维 [[1, 2], [3, 4]]、字符串 "abc"（字符数组）
function parseValue(src, name) {
  const s = src.trim();
  if (/^"(.*)"$/.test(s)) return [...s.slice(1, -1)];
  if (/^'.'$/.test(s)) return s[1];
  try {
    const v = JSON.parse(s.replace(/'(.)'/g, '"$1"'));
    const ok = (x) => typeof x === 'number' || (typeof x === 'string' && x.length === 1);
    if (ok(v) || (Array.isArray(v) && v.length && (v.every(ok) || v.every((r) => Array.isArray(r) && r.length === v[0].length && r.every(ok))))) return v;
  } catch { /* 下面报错 */ }
  throw new Error(`let ${name} = ${s}：写数、字符 'a'、数组 [1, 2, 3] 或二维数组 [[1, 2], [3, 4]]`);
}

// predict: 7 if i == 4 -> j
function parsePredict(src) {
  const m = /^(\d+)\s*(?:if\s+(.+?))?\s*(?:->|→|=>)\s*(.+)$/i.exec(src);
  if (!m) throw new Error(`predict: 看不懂「${src}」，写成「7 if i == 4 -> j」（执行第 7 行、i == 4 的那一次之后，问 j）`);
  const side = (e, what) => {
    let ast;
    try { ast = parseExpression(e); } catch (x) { throw new Error(`predict: ${what}「${e}」写错了：${x.message}`); }
    const bad = (x) => x && typeof x === 'object' && (['assign', 'incdec', 'call'].includes(x.t) || Object.values(x).some((v) => (Array.isArray(v) ? v.some(bad) : bad(v))));
    if (bad(ast)) throw new Error(`predict: ${what}「${e}」里不能有赋值、自增或函数调用`);
    return ast;
  };
  return { line: Number(m[1]), condSrc: m[2]?.trim() || '', cond: m[2] ? side(m[2], '条件') : null, takeSrc: m[3].trim(), take: side(m[3], '要问的') };
}

export function run(input) {
  const watchers = input.predicts.map((p) => ({ ...p }));
  const r = runProgram(input.program, { entry: input.entry, vars: input.vars, watchers });
  const steps = [];
  let prev = null;
  for (const s of r.steps) {
    const changed = diff(prev, s);
    const st = { view: { ...s, changed }, msg: s.line ? `第 ${s.line} 行：${s.msg}` : s.msg };
    const w = s.asks?.[0];
    if (w && w.value !== undefined) {
      const isChar = /^'.'$/.test(w.value);
      st.ask = { tag: 'predict', kind: isChar ? 'text' : 'number', q: `执行第 ${w.w.line} 行${w.w.condSrc ? `（${w.w.condSrc} 的那一次）` : ''}之后，${w.w.takeSrc} 是多少？`, answer: isChar ? w.value.slice(1, -1) : Number(w.value), display: w.value };
    } else if (s.line && s.kind === 'cond') {
      st.ask = { tag: 'cond', kind: 'choice', q: `第 ${s.line} 行的条件这次成立吗？`, choices: ['成立', '不成立'], answer: s.cond ? '成立' : '不成立' };
    } else if (s.line) {
      st.ask = { tag: 'line', kind: 'number', q: '接下来执行第几行？', answer: s.line };
    }
    steps.push(st);
    prev = s;
  }
  if (r.error) steps.push({ view: { ...(prev || {}), changed: [], error: true }, msg: `运行出错：${r.error.message}` });
  const unasked = watchers.filter((w) => !r.steps.some((s) => s.asks?.some((a) => a.w === w)));
  return { steps, out: r.out, error: r.error, arrays: r.arrays, unasked, final: r.steps.at(-1) };
}

// 两步之间哪些变量、数组格子变了（画面上闪一下）
function diff(a, b) {
  if (!a) return [];
  const out = [];
  const flat = (s) => {
    const m = new Map();
    s.globals.forEach((v) => put(m, 'g', v));
    s.frames.forEach((f, i) => f.vars.forEach((v) => put(m, `f${i}`, v)));
    return m;
  };
  const put = (m, where, v) => {
    if (v.data) v.data.forEach((x, i) => m.set(`#${v.arr}[${i}]`, x));
    else if (!v.arr) m.set(`${where}:${v.name}`, v.value);
  };
  const A = flat(a), B = flat(b);
  for (const [k, v] of B) if (A.has(k) && A.get(k) !== v) out.push(k);
  return out;
}

// —— 画 ——
export function view(s, input) {
  const lines = input.code.split('\n');
  const cur = s.line;
  const code = `<pre class="tr-code">${lines.map((l, i) => `<span class="tr-line${i + 1 === cur ? ' tr-cur' : ''}${s.error && i + 1 === cur ? ' tr-err' : ''}" data-cmd="${i + 1}" data-pick="${i + 1}"><i>${i + 1}</i>${esc(l) || ' '}</span>`).join('')}</pre>`;
  const changed = new Set(s.changed || []);
  const frames = s.frames || [];
  const top = frames.length - 1;
  // 数组：自己定义的（有 data 的）都画；下标变量画在格子下面
  const arrays = [];
  const seen = new Set();
  const collect = (vars) => vars.forEach((v) => { if (v.data && !seen.has(v.arr)) { seen.add(v.arr); arrays.push(v); } });
  collect(s.globals || []);
  frames.forEach((f) => collect(f.vars));
  // 当前这一层的引用名：InsertSort 里的 A 指向全局的 A
  const alias = {};
  if (top >= 0) for (const v of frames[top].vars) if (v.ref && v.arr) (alias[v.arr] ||= []).push(v.name);
  const topVars = top >= 0 ? frames[top].vars : [];
  const ptrNames = input.pointers || AUTO_PTR;
  let arrHtml = '';
  for (const a of arrays) {
    const label = [a.name, ...(alias[a.arr] || []).filter((x) => x !== a.name)].join(' = ');
    if (a.dims.length === 1) {
      const ptr = {};
      for (const v of topVars) {
        if (!ptrNames.includes(v.name) || v.data || v.arr) continue;
        const k = Number(v.value);
        if (Number.isInteger(k) && k >= 0 && k < a.dims[0]) ptr[k] = ptr[k] ? `${ptr[k]},${v.name}` : v.name;
      }
      const fresh = a.data.map((_, i) => i).filter((i) => changed.has(`#${a.arr}[${i}]`));
      arrHtml += `<div class="tr-arr"><div class="tr-arr-name">${esc(label)}</div>${arrayView(a.data.map((x) => (x === '?' ? null : x)), { base: 0, ptr, fresh, cls: Object.fromEntries(fresh.map((i) => [i, 'sv-cmp'])), pick: false })}</div>`;
    } else {
      const [R, C] = a.dims;
      let t = `<table class="sv-gtbl tr-2d"><thead><tr><th>${esc(label)}</th>${Array.from({ length: C }, (_, j) => `<th>${j}</th>`).join('')}</tr></thead><tbody>`;
      for (let i = 0; i < R; i++) t += `<tr><th>${i}</th>${Array.from({ length: C }, (_, j) => { const k = i * C + j; return `<td class="${changed.has(`#${a.arr}[${k}]`) ? 'sv-chg' : ''}">${esc(a.data[k])}</td>`; }).join('')}</tr>`;
      arrHtml += `<div class="tr-arr">${t}</tbody></table></div>`;
    }
  }
  // 变量：当前这一层的（数组、引用的数组不再写），下面一行写调用栈
  const scal = (vars, where) => vars.filter((v) => !v.data && !(v.ref && v.arr)).map((v) => `<span class="tr-var${changed.has(`${where}:${v.name}`) ? ' sv-new tr-chg' : ''}"><b>${esc(v.name)}</b>${v.ref ? '<small>&amp;</small>' : ''} ${esc(v.value)}</span>`).join('');
  const vars = top >= 0 ? scal(frames[top].vars, `f${top}`) : '';
  const glob = scal(s.globals || [], 'g');
  const stack = frames.length ? `<div class="tr-stack">${frames.map((f, i) => `<span class="${i === top ? 'tr-top' : ''}">${esc(f.fn)}${f.args ? `(${esc(f.args)})` : '()'}</span>`).join('<i>→</i>')}</div>` : '';
  const out = s.out ? `<div class="tr-out"><div class="tr-out-h">输出</div><pre>${esc(s.out)}</pre></div>` : '';
  return `<div class="tr-wrap">${code}<div class="tr-state">${stack}${vars ? `<div class="tr-vars">${vars}</div>` : ''}${glob ? `<div class="tr-vars tr-glob"><span class="tr-vars-h">全局</span>${glob}</div>` : ''}${arrHtml}${out}</div></div>`;
}

export function quiz(input, r) {
  const what = input.quiz || (r.out ? 'output' : '');
  if (what === 'output') {
    if (!r.out) throw new Error('quiz: output，但这段代码没有输出');
    return { q: '这段代码运行后输出什么？（按顺序写出输出的内容，用空格隔开）', qhtml: `<pre class="tr-code tr-code-q">${esc(input.code)}</pre>`, type: 'seq', answer: r.out.trim().split(/\s+/).join(' ') };
  }
  const name = what || Object.keys(input.vars).find((k) => Array.isArray(input.vars[k]));
  if (!name) throw new Error('quiz: 写 output（问输出）或者一个数组的名字（问运行结束后这个数组的内容）');
  const v = [...(r.final?.globals || []), ...(r.final?.frames || []).flatMap((f) => f.vars)].find((x) => x.name === name && x.data);
  if (!v) throw new Error(`quiz: 运行结束时找不到数组 ${name}（只能问全局的或者 let 给的数组）`);
  const call = input.entry ? `执行 ${input.entry.src}` : '运行';
  return { q: `${call}之后，数组 ${name} 是什么？（从下标 0 开始，用空格隔开）`, qhtml: `<pre class="tr-code tr-code-q">${esc(input.code)}</pre>`, type: 'seq', answer: v.data.join(' ') };
}

export function problems(input, r) {
  const out = [];
  if (r.error) out.push(`代码运行出错了：${r.error.message}（学生会看到出错的那一行；如果不是有意的，改一下代码或输入）`);
  for (const w of r.unasked) out.push(`predict: 「${w.line}${w.condSrc ? ` if ${w.condSrc}` : ''} -> ${w.takeSrc}」一直没走到（条件没成立过），这个问题不会出现`);
  return out;
}

export const traceEngine = { name: 'trace', title: '代码跟踪', parse, run, view, quiz, problems, defaultAsk: (input) => (input.predicts.length ? 'predict' : '') };

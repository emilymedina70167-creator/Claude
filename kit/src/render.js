// Markdown + KaTeX 渲染，自定义代码块变成互动组件
import MarkdownIt from 'markdown-it';
import katex from 'katex';
import { blocks } from './blocks/index.js';
import { session } from './session.js';
import { calcValue, expandCalc, parseLets } from './exact.js';
import { MARK_COLORS } from './markspec.js';

const md = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });

const MATH_RE = /(`+)[\s\S]*?\1|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$/g;

// 把公式先换成占位符，避免被 Markdown 改坏（比如 \\ 和 _）
function maskMath(src, store) {
  const out = [];
  let fence = null;
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    let text = buf.join('\n').replace(/\\\$/g, '\uE000');
    text = text.replace(MATH_RE, (m, tick, dd, br, pr, inl) => {
      if (tick) return m;
      const display = dd !== undefined || br !== undefined;
      store.push({ tex: dd ?? br ?? pr ?? inl, display });
      return `\uE001${store.length - 1}\uE002`;
    });
    out.push(text.replace(/\uE000/g, '\\$'));
    buf = [];
  };
  for (const line of src.split('\n')) {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      out.push(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
    } else if (m) {
      flush();
      fence = m[1];
      out.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();
  return out.join('\n');
}

function unmask(html, store) {
  return html
    .replace(/<p>\s*\uE001(\d+)\uE002\s*<\/p>/g, (m, i) => (store[+i].display ? `\uE001${i}\uE002` : m))
    .replace(/\uE001(\d+)\uE002/g, (_, i) => {
      const { tex, display } = store[+i];
      return tex2html(tex, display);
    });
}

// 公式里给 Claude 用的几个宏：
//   \hl{名字}{…}：给一项起名字（板书标注 mark term=名字 靠它找到这一项），本身不画东西
//   \chalk{颜色}{…}：这一项用彩色粉笔写（颜色跟着风格走，见 styles.css 的 [data-lkc]）
// 两个都展开成 \htmlData，所以 trust 只放行 \htmlData（\htmlClass、\href 这类照旧不认）
const MACROS = { '\\hl': '\\htmlData{lkmark=#1}{#2}', '\\chalk': '\\htmlData{lkc=#1}{#2}' };
const trust = (ctx) => ctx.command === '\\htmlData';

// \calc{表达式}：页面精确地算出来再写进公式。变量：整节课的 let 块（session.vars），
// 加上组件自己的 let（组件渲染自己的题面、解析时用 withCalcScope 推进来，里面的优先）
const scopes = [];
export function withCalcScope(vars, fn) {
  scopes.push(vars || {});
  try { return fn(); } finally { scopes.pop(); }
}
export function calcScope(extra) {
  return Object.assign({}, session.vars, ...scopes, extra || {});
}

export function tex2html(tex, display = false) {
  let src = String(tex ?? '');
  let errors = [];
  if (src.includes('\\calc')) {
    const scope = calcScope();
    ({ tex: src, errors } = expandCalc(src, (e) => calcValue(e, scope).tex));
  }
  let html;
  try {
    // macros 每次给一份新的：KaTeX 遇到 \gdef 会往里写
    html = katex.renderToString(src, { displayMode: display, throwOnError: false, strict: false, trust, macros: { ...MACROS } });
  } catch (e) {
    html = `<code class="tex-error">${escapeHtml(src)}</code>`;
  }
  // 算不出来的 \calc：画成红框，写法自检（renderLesson 和 class/selfcheck.js）据此报给作者
  if (errors.length) return `<span class="calc-error" data-calc-error="${escapeHtml(calcErrorText(errors))}">${html}</span>`;
  return html;
}

const calcErrorText = (errors) => errors.map((e) => `\\calc{${e.expr.trim().slice(0, 60)}} 算不出来：${e.msg}`).join('；');

/**
 * 检查一段文字（可以有好几段）里的 \calc{…} 能不能算出来，不渲染。vars：组件自己的变量。
 * 返回出错的说明（没有就是空数组）。组件可以在创建时检查以后才显示的文字（比如答对后的解析）
 */
export function calcProblems(texts, vars) {
  const scope = calcScope(vars);
  const out = [];
  for (const t of [].concat(texts || [])) {
    if (!t || !String(t).includes('\\calc')) continue;
    const { errors } = expandCalc(String(t), (e) => calcValue(e, scope).tex);
    if (errors.length) out.push(calcErrorText(errors));
  }
  return out;
}

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 渲染一段 Markdown（组件内部的文字也用它），不挂载组件
export function mdToHtml(src, { inline = false } = {}) {
  const store = [];
  const masked = maskMath(String(src ?? ''), store);
  const html = inline ? md.renderInline(masked) : md.render(masked);
  return unmask(html, store);
}

// 渲染一段课件并挂载互动组件
// 会产生作答的组件（live 模式下要有稳定的 id）
const ANSWERING = new Set(['answer', 'conjecture', 'quiz', 'predict', 'practice', 'steps', 'recognize', 'findbug', 'draft', 'sortpass']);
// 课堂模式里 figure 指令要按 id 找图
const FIGURES = new Set(['scene', 'graph', 'space', 'matrix', 'sketch', 'derive']);
// 自己检查文字里 \calc 的组件（它们有自己的 let，变量要连同这些一起算）
const SELF_CALC = new Set(['answer', 'scene', 'predict', 'matrix', 'let', 'sketch', 'derive', 'practice']);

// 一段里的 let 块先算一遍：正文的公式在组件挂载之前就渲染了，里面的 \calc 要用到这些量。
// 写错的不管，let 组件挂载时自己再算一次、报出来
function prerunLets(src) {
  let fence = null, body = null;
  for (const line of String(src).split('\n')) {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) {
        if (body) {
          try {
            for (const d of parseLets(body.join('\n'))) {
              try { session.vars[d.name] = calcValue(d.src, session.vars).value; } catch { /* 组件会报 */ }
            }
          } catch { /* 组件会报 */ }
        }
        fence = null;
        body = null;
      } else if (body) body.push(line);
    } else if (m) {
      fence = m[1];
      body = m[2].toLowerCase() === 'let' ? [] : null;
    }
  }
}

export function renderLesson(src, root) {
  const pending = [];
  let seq = 0;
  prerunLets(src);
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const tok = tokens[idx];
    const name = tok.info.trim().split(/\s+/)[0].toLowerCase();
    if (blocks[name]) {
      pending.push({ name, src: tok.content });
      return `<div class="block block-${name}" data-block="${pending.length - 1}"></div>\n`;
    }
    const near = name.length >= 3 && Object.keys(blocks).find((b) => b !== name && editDistance(b, name) <= 2);
    if (near) {
      pending.push({ name: '_typo', src: tok.content, near, wrong: name });
      return `<div class="block" data-block="${pending.length - 1}"></div>\n`;
    }
    return defaultFence(tokens, idx, opts, env, self);
  };
  try {
    root.innerHTML = mdToHtml(src);
  } finally {
    md.renderer.rules.fence = defaultFence;
  }
  // 正文里算不出来的 \calc（组件这时还是空壳，它们的文字下面单独查）
  root.querySelectorAll('.calc-error').forEach((x) => session.problem(x, '公式', x.dataset.calcError));
  // \chalk{颜色}{…} 的颜色写错了：那一项照常写出来、只是不变色，作者以为强调了、学生看不出来
  const odd = [...new Set([...root.querySelectorAll('[data-lkc]')].map((e) => e.dataset.lkc).filter((c) => !MARK_COLORS.includes(c)))];
  if (odd.length) session.problem(root, '公式', `\\chalk 的颜色「${odd.slice(0, 3).join('」「')}」不认识：只认 ${MARK_COLORS.join(' / ')}`);
  root.querySelectorAll('h2').forEach((h) => {
    const m = h.innerHTML.match(/^\s*(\d{1,2})\s*[.、．:：]\s*/);
    if (m) h.innerHTML = `<span class="h-num">${m[1]}</span><span>${h.innerHTML.slice(m[0].length)}</span>`;
  });
  root.querySelectorAll('[data-block]').forEach((el) => {
    const { name, src: body, near, wrong } = pending[+el.dataset.block];
    if (name === '_typo') {
      el.innerHTML = `<div class="block-error"><strong>没有「${escapeHtml(wrong)}」组件</strong>，是不是想写 <code>${near}</code>？<pre>${escapeHtml(body)}</pre></div>`;
      session.problem(el, wrong, `没有「${wrong}」组件，是不是想写 ${near}？`);
      return;
    }
    // 组件 id：作答记录按它对应。课件里写了 id: 就用它，没写就按「小节 + 序号」生成
    const own = body.match(/^\s*id\s*[:：]\s*([\w\-.~:@+]+)\s*$/m);
    const prefix = root.closest?.('[data-step]')?.dataset.step || `s${session.stageOf(root)}`;
    el.dataset.bid = own ? own[1] : `${prefix}-${++seq}`;
    el.dataset.t0 = Date.now();
    if (!own && session.live && (ANSWERING.has(name) || FIGURES.has(name) || blocks[name].stepper)) session.problem(el, name, `这个组件没写 id:，暂时按 ${el.dataset.bid} 记。请加一行 id:（同一个单元里不重复）`, { soft: true });
    // 组件文字里的 \calc：有自己 let 的组件（answer、scene、predict、matrix）自己带着变量查；别的按整节课的量查。
    // 要现在查：解析这类文字往往答完题才显示，那时再报就晚了
    if (!SELF_CALC.has(name)) for (const msg of calcProblems(body)) session.problem(el, name, msg);
    try {
      blocks[name](el, body);
    } catch (e) {
      console.error(e);
      el.innerHTML = `<div class="block-error"><strong>「${name}」组件出错：</strong>${escapeHtml(e.message)}<pre>${escapeHtml(body)}</pre></div>`;
      session.problem(el, name, e.message);
    }
  });
  pairLinked(root);
}

// 绑定了 steps 的 scene（link: 某个 steps 的 id）放到那道题旁边，做题时一直看得到图
function pairLinked(root) {
  root.querySelectorAll('.block-scene[data-link], .block-graph[data-link], .block-space[data-link]').forEach((sc) => {
    const st = root.querySelector(`.block-steps[data-bid="${CSS.escape(sc.dataset.link)}"]`);
    if (!st || sc.closest('.steps-pair')) return;
    const wrap = document.createElement('div');
    wrap.className = 'steps-pair';
    st.before(wrap);
    wrap.append(st, sc);
  });
}

export function lessonTitle(src) {
  const m = String(src).match(/^\s*#\s+(.+)$/m);
  return m ? m[1].replace(/\$[^$]*\$/g, (x) => x.slice(1, -1)).trim() : '未命名课件';
}

// 课件开头可选的设置块：
// ---
// mode: guided
// ---
export function frontMatter(src) {
  const m = String(src).match(/^\s*---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([\w-]+)\s*[:：]\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

// 按二级标题切成小节（跳过代码块里的 ##）
export function splitStages(src) {
  const stages = [];
  let cur = { title: '', lines: [] };
  let fence = null;
  for (const line of String(src).split('\n')) {
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null; }
    else if (f) fence = f[1];
    else if (/^##\s+/.test(line)) {
      if (cur.lines.join('').trim() || cur.title) stages.push(cur);
      cur = { title: line.replace(/^##\s+/, '').trim(), lines: [] };
    }
    cur.lines.push(line);
  }
  stages.push(cur);
  return stages.map((s) => ({ title: s.title, src: s.lines.join('\n') }));
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

// Markdown + KaTeX 渲染，自定义代码块变成互动组件
import MarkdownIt from 'markdown-it';
import katex from 'katex';
import { blocks } from './blocks/index.js';

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

export function tex2html(tex, display = false) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: false, trust: false });
  } catch (e) {
    return `<code class="tex-error">${escapeHtml(tex)}</code>`;
  }
}

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 渲染一段 Markdown（组件内部的文字也用它），不挂载组件
export function mdToHtml(src, { inline = false } = {}) {
  const store = [];
  const masked = maskMath(String(src ?? ''), store);
  const html = inline ? md.renderInline(masked) : md.render(masked);
  return unmask(html, store);
}

// 渲染整篇课件并挂载互动组件
export function renderLesson(src, root) {
  const pending = [];
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const tok = tokens[idx];
    const name = tok.info.trim().split(/\s+/)[0].toLowerCase();
    if (blocks[name]) {
      pending.push({ name, src: tok.content });
      return `<div class="block block-${name}" data-block="${pending.length - 1}"></div>\n`;
    }
    return defaultFence(tokens, idx, opts, env, self);
  };
  try {
    root.innerHTML = mdToHtml(src);
  } finally {
    md.renderer.rules.fence = defaultFence;
  }
  root.querySelectorAll('[data-block]').forEach((el) => {
    const { name, src: body } = pending[+el.dataset.block];
    try {
      blocks[name](el, body);
    } catch (e) {
      console.error(e);
      el.innerHTML = `<div class="block-error"><strong>「${name}」组件出错：</strong>${escapeHtml(e.message)}<pre>${escapeHtml(body)}</pre></div>`;
    }
  });
}

export function lessonTitle(src) {
  const m = String(src).match(/^\s*#\s+(.+)$/m);
  return m ? m[1].replace(/\$[^$]*\$/g, (x) => x.slice(1, -1)).trim() : '未命名课件';
}

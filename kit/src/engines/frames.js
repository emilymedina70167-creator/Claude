// 通用演示 frames：老师自己写每一步的样子（Markdown 表格、一排格子、栈、队列、二叉树），页面负责
// 上一步 / 下一步 / 播放、换步动画（同一个数、同一个结点滑到新位置）、先猜再揭晓、挖空让学生填、课堂的 figure step。
// 菜单上没有的过程（AVL 旋转、中缀转后缀、PV 交替执行、距离向量表……）都能演，而且还能判分。
// 纯函数，不碰 DOM（tests/frames-engine.test.js）；Markdown 由外壳传进来的 md() 渲染。
//
// 写法：
//   id / title / q / note / speed … 写在第一个 --- 之前
//   ---                    每一帧之间用一行 --- 隔开
//   array: 49 *38 !65 ~97 _ 13@low 27@high {{49}}
//   array A: …             左边写名字
//   stack: a b             栈（右边是栈顶）；queue: a b（左边是队头）
//   tree: A(B(D, E), C)    二叉树（写法同 tree 组件的 nodes:）
//   hl: A, D               这一帧要高亮的结点 / 格子（按上面写的字找）
//   > 说明                 这一步的说明（可以几行）
//   ? 问题 = 答案           走到这一帧之前先问（答案是数就按数判，否则按序列判）
//   ?? 问题 = 对的 | 错的 | 错的   选择题：第一个是对的，显示时打乱
//   其余的行是 Markdown（表格、文字、公式），{{答案}} 是要学生填的空（几种都对写 {{3|三}}；不能写在公式里）
//   前缀：* 正在看（黄）、! 冲突 / 交换（红）、~ 已完成（绿）；_ 是空格子；@名字 是格子下面的指针
import { splitAlts } from '../tokens.js';
import { arrayView, keyMaker, esc, chips } from './arrayview.js';
import { treeSvg } from './treeview.js';
import { parseTree } from './tree.js';

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SEP = /^-{3,}\s*$/;
const MAX_FRAMES = 60;

/** 第一个 --- 之前是组件的字段（交给外壳的 parseFields） */
export function head(src) {
  const lines = String(src ?? '').split('\n');
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]);
    if (f) { open = open && lines[i].trim().startsWith(open) ? null : open || f[1]; continue; }
    if (!open && SEP.test(lines[i])) return lines.slice(0, i).join('\n');
  }
  return lines.join('\n');
}

function bodyFrames(src) {
  const lines = String(src ?? '').split('\n');
  const frames = [];
  let cur = null;
  let open = null;
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (f) open = open && line.trim().startsWith(open) ? null : open || f[1];
    if (!open && !f && SEP.test(line)) { cur = []; frames.push(cur); continue; }
    if (cur) cur.push(line);
  }
  return frames;
}

// 一个格子：前缀标记、@指针、{{空}}
function cellOf(tok, where) {
  let t = tok;
  const out = { mark: '', ptr: '', blank: null, text: '' };
  const at = /^(.*?)@([^@\s]+)$/.exec(t);
  if (at && at[1] !== '') { t = at[1]; out.ptr = at[2]; }
  if (/^[*!~]/.test(t) && t.length > 1) { out.mark = t[0]; t = t.slice(1); }
  const b = /^\{\{(.+)\}\}$/.exec(t);
  if (b) { out.blank = splitAlts(b[1]); if (!out.blank.length) throw new Error(`${where}：{{}} 里要写答案`); out.text = out.blank[0]; }
  else if (t === '_') out.text = null;
  else out.text = t;
  return out;
}

function parseAsk(line, where, choice) {
  const body = line.replace(/^\?\??\s*/, '');
  const i = body.lastIndexOf('=');
  if (i < 0) throw new Error(`${where}：问题要写成「? 问题 = 答案」${choice ? '（选择题「?? 问题 = 对的 | 错的 | 错的」）' : ''}`);
  const q = body.slice(0, i).trim(), a = body.slice(i + 1).trim();
  if (!q || !a) throw new Error(`${where}：问题和答案都不能空`);
  if (choice) {
    const opts = splitAlts(a);
    if (opts.length < 2) throw new Error(`${where}：选择题至少写两个选项：?? 问题 = 对的 | 错的`);
    // 打乱选项（按题面定下来，每次打开都一样）
    let h = 0;
    for (const c of q) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const shown = opts.slice();
    for (let k = shown.length - 1; k > 0; k--) { h = (h * 1103515245 + 12345) >>> 0; const j = h % (k + 1); [shown[k], shown[j]] = [shown[j], shown[k]]; }
    return { tag: 'q', kind: 'choice', q, choices: shown, answer: opts[0] };
  }
  const num = /^-?\d+(\.\d+)?$|^-?\d+\/\d+$/.test(a);
  return { tag: 'q', kind: num ? 'number' : 'text', q, answer: num ? (a.includes('/') ? Number(a.split('/')[0]) / Number(a.split('/')[1]) : Number(a)) : a, display: a };
}

export function parse(fields, src) {
  const raw = bodyFrames(src);
  if (!raw.length) throw new Error('frames 要用一行 --- 把每一帧隔开（第一个 --- 之前写 id、title）');
  if (raw.length > MAX_FRAMES) throw new Error(`frames 最多 ${MAX_FRAMES} 帧`);
  const frames = raw.map((lines, fi) => {
    const where = `第 ${fi + 1} 帧`;
    const items = [];
    const msg = [];
    let ask = null;
    let hl = [];
    let md = [];
    const flush = () => { if (md.join('\n').trim()) items.push({ type: 'md', text: md.join('\n') }); md = []; };
    let open = null;
    for (const line of lines) {
      const f = FENCE.exec(line);
      if (f || open) { if (f) open = open && line.trim().startsWith(open) ? null : open || f[1]; md.push(line); continue; }
      const m = /^(array|stack|queue)(?:\s+([^:：]+?))?\s*[:：]\s*(.*)$/i.exec(line);
      if (m) {
        flush();
        const kind = m[1].toLowerCase();
        const toks = m[3].trim().split(/[\s,，]+/).filter(Boolean);
        if (!toks.length && kind === 'array') throw new Error(`${where}：array: 后面要写格子里的东西（空格子写 _）`);
        items.push({ type: kind, label: (m[2] || '').trim(), cells: toks.map((t) => cellOf(t, where)) });
        continue;
      }
      const t = /^tree\s*[:：]\s*(.*)$/i.exec(line);
      if (t) {
        flush();
        let tree;
        try { tree = parseTree(t[1]); } catch (e) { throw new Error(`${where}：tree: ${e.message}`); }
        items.push({ type: 'tree', tree });
        continue;
      }
      const h = /^hl\s*[:：]\s*(.*)$/i.exec(line);
      if (h) { hl = h[1].split(/[\s,，、]+/).filter(Boolean); continue; }
      if (/^>\s?/.test(line)) { msg.push(line.replace(/^>\s?/, '')); continue; }
      if (/^\?\?/.test(line)) { ask = parseAsk(line, where, true); continue; }
      if (/^\?\s/.test(line)) { ask = parseAsk(line, where, false); continue; }
      md.push(line);
    }
    flush();
    if (fi === 0 && ask) throw new Error('第 1 帧是开始的样子，不能先猜（问题写在第 2 帧起，问的是「走到这一帧之前」）');
    if (!items.length && !msg.length) throw new Error(`${where}是空的`);
    // 这一帧要学生填的空（Markdown 里的 {{…}} 和格子里的 {{…}}），按出现的先后编号
    const blanks = [];
    for (const it of items) {
      if (it.type === 'md') {
        it.text = it.text.replace(/\{\{([^{}]+)\}\}/g, (_, a) => {
          const alts = splitAlts(a);
          if (!alts.length) throw new Error(`${where}：{{}} 里要写答案`);
          blanks.push({ v: alts, num: alts.every((x) => /^-?\d+(\.\d+)?$|^-?\d+\/\d+$/.test(x)) });
          return `\u0001B${blanks.length - 1}\u0001`;
        });
        if (/\$[^$]*\u0001B\d+\u0001[^$]*\$/.test(it.text)) throw new Error(`${where}：{{}} 不能写在公式（$…$）里面`);
      } else if (it.cells) {
        for (const c of it.cells) if (c.blank) { blanks.push({ v: c.blank, num: c.blank.every((x) => /^-?\d+(\.\d+)?$|^-?\d+\/\d+$/.test(x)) }); c.b = blanks.length - 1; }
      }
    }
    if (fi === 0 && ask) throw new Error('第 1 帧是开始的样子，不能先猜（问题写在第 2 帧起，问的是「走到这一帧之前」）');
    if (fi === 0 && blanks.length) throw new Error('第 1 帧是开始的样子，不能挖空（{{}} 写在第 2 帧起）');
    return { items, msg: msg.join('\n').trim(), ask, hl, blanks };
  });
  return { frames };
}

export function run({ frames }) {
  return { steps: frames.map((f, i) => ({ view: { i }, msg: f.msg, ask: f.ask || undefined, blanks: f.blanks.length ? f.blanks : undefined })) };
}

const MARK = { '*': 'sv-cur', '!': 'sv-swap', '~': 'sv-done' };

/**
 * opts.md：Markdown 渲染（外壳传进来）；opts.blank(i) → 第 i 个空画成什么（输入框，或者答案）。
 * 格子按值编身份（同一帧里重复的值按出现的先后），树的结点按名字：换帧时同一个东西滑过去
 */
export function view(s, input, opts = {}) {
  const f = input.frames[s.i];
  const md = opts.md || ((x) => `<p>${esc(x)}</p>`);
  const blank = opts.blank || ((i) => `<span class="sv-blank-a">${esc([].concat(f.blanks[i]?.v ?? '')[0])}</span>`);
  const hl = new Set(f.hl.map((x) => x.toUpperCase()));
  let h = '';
  let cmd = 0;
  for (const it of f.items) {
    if (it.type === 'md') {
      h += `<div class="fr-md">${md(it.text).replace(/\u0001B(\d+)\u0001/g, (_, i) => blank(Number(i)))}</div>`;
      continue;
    }
    if (it.type === 'tree') {
      const ids = Object.keys(it.tree.nodes);
      const cls = {};
      for (const id of ids) if (hl.has(String(it.tree.nodes[id].key).toUpperCase())) cls[id] = 'sv-cur';
      const base = cmd;
      h += `<div class="fr-tree">${treeSvg(it.tree, { cls, key: (id) => `t:${it.tree.nodes[id].key}`, cmd: (id) => base + ids.indexOf(id) + 1 })}</div>`;
      cmd += ids.length;
      continue;
    }
    const cells = it.cells;
    const cls = {}, ptr = {};
    cells.forEach((c, k) => {
      const p = k + 1;
      // 挖空的格子：值照写（身份按答案编，换帧时能滑过去），画完再把格子里的字换成输入框
      const m = [MARK[c.mark] || '', c.text !== null && hl.has(String(c.text).toUpperCase()) ? 'sv-cur' : '', c.b !== undefined ? `fr-b${c.b}` : ''].filter(Boolean).join(' ');
      if (m) cls[p] = m;
      if (c.ptr) ptr[p] = ptr[p] ? `${ptr[p]},${c.ptr}` : c.ptr;
    });
    const label = it.label || (it.type === 'stack' ? '栈（右边是栈顶）' : it.type === 'queue' ? '队列（左边是队头）' : '');
    let arr = arrayView(cells.map((c) => c.text), { cls, ptr, idx: it.type === 'array' && cells.length > 1 && !it.label, pick: true, keys: true, label });
    // data-cmd 接着前面的编号（一帧里几排格子、几棵树都能 highlight）
    arr = arr.replace(/data-cmd="(\d+)"/g, (_, n) => `data-cmd="${cmd + Number(n)}"`);
    arr = arr.replace(/(<div class="[^"]*\bfr-b(\d+)\b[^"]*"[^>]*>)[^<]*(<\/div>)/g, (_, open, i, close) => open + blank(Number(i)) + close);
    cmd += cells.length;
    h += `<div class="fr-arr fr-${it.type}">${arr}</div>`;
  }
  return h || '<div class="muted">（这一帧只有说明）</div>';
}

export function problems(input) {
  const out = [];
  if (input.frames.length < 2) out.push('frames 只有一帧，演示不出过程：至少写两帧（用 --- 隔开）');
  return out;
}

// 帧里写了 ? 的就是要问的：没写 ask: 也问（写 ask: none 就只演示）
export const defaultAsk = (input) => (input.frames.some((f) => f.ask) ? 'all' : null);

export const framesEngine = { name: 'frames', title: '一步步看', head, parse, run, view, problems, defaultAsk };

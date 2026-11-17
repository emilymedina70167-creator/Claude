// 笔记本（第十四轮）：项目 Claude 自己的长期记忆，照 Anthropic 记忆工具的做法——一个文件夹，写什么、怎么分、哪些每一轮带着都由它定。
// 这里只有机械的事（纯函数，tests/project-notebook.test.js）：路径、改一段要对得上、留版本、删了能恢复、每一轮放哪些（pin）、
// 课上输出里 board note 块的写法、引号在记录里找不找得到（只记不拦）。不审内容，不替它挑、不替它写。
import { checkQuotes } from './quotes.js';

export const NOTE_HISTORY = 20;
const enc = new TextEncoder();
const bytes = (s) => enc.encode(String(s ?? '')).length;

/** 规范路径：去首尾空白和开头的斜杠，连续斜杠合一；空的、带 .. 的、超过 200 字的不收 */
export function notePath(p) {
  const t = String(p ?? '').trim().replace(/\/{2,}/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!t) throw new Error('笔记的路径是空的');
  if (t.split('/').some((x) => x === '..' || x === '.')) throw new Error(`笔记的路径不能带 .. 或 .：${t}`);
  if ([...t].length > 200) throw new Error('笔记的路径太长（最多 200 个字）');
  return t;
}

/** 路径 → 能当文档编号的字（UTF-8 的 base64url） */
export function noteId(path) {
  const b = enc.encode(notePath(path));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  const b64 = typeof btoa === 'function' ? btoa(s) : Buffer.from(b).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const withText = (doc, text, { at, by }) => ({
  ...doc, text,
  v: (Number(doc.v) || 0) + 1, at, by,
  history: [{ text: doc.text ?? '', at: doc.at ?? null, by: doc.by ?? null, v: Number(doc.v) || 0 }, ...(Array.isArray(doc.history) ? doc.history : [])].slice(0, NOTE_HISTORY),
});
const countOf = (hay, needle) => { let n = 0, i = 0; while (needle && (i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; } return n; };

/**
 * 对一个文件做一次操作。doc：现在的样子（没有就是 null）。返回 { doc, error?, moved? }；有 error 时 doc 是原样。
 * kind：create / str_replace / insert / delete / rename / set / restore
 */
export function applyNoteOp(doc, op, { at = Date.now(), by = '' } = {}) {
  const path = notePath(op?.path);
  const live = doc && !doc.deleted;
  const fail = (error) => ({ doc, error });
  switch (op?.kind) {
    case 'create':
      if (live) return fail(`${path} 已经有了：要改用 str_replace，要整篇换先 delete 再 create`);
      return { doc: doc ? { ...withText(doc, String(op.text ?? ''), { at, by }), deleted: false } : { path, text: String(op.text ?? ''), v: 1, at, by, history: [] } };
    case 'str_replace': {
      if (!live) return fail(`没有 ${path}`);
      const n = countOf(String(doc.text ?? ''), String(op.old ?? ''));
      if (!op.old) return fail('str_replace 要写原来的那一段');
      if (n === 0) return fail(`${path} 里没找到要换的那一段`);
      if (n > 1) return fail(`${path} 里要换的那一段出现了 ${n} 次：多写几个字让它只出现一次`);
      return { doc: withText(doc, String(doc.text).replace(String(op.old), () => String(op.new ?? '')), { at, by }) };
    }
    case 'insert': {
      if (!live) return fail(`没有 ${path}`);
      const lines = String(doc.text ?? '').split('\n');
      const k = Math.max(0, Math.min(lines.length, Number(op.line) || 0));
      lines.splice(k, 0, String(op.text ?? ''));
      return { doc: withText(doc, lines.join('\n'), { at, by }) };
    }
    case 'delete':
      if (!live) return fail(`没有 ${path}`);
      return { doc: { ...doc, deleted: true, at, by } };
    case 'restore':
      if (!doc) return fail(`没有 ${path}`);
      return { doc: { ...doc, deleted: false, at, by } };
    case 'rename':
      if (!live) return fail(`没有 ${path}`);
      return { doc, moved: notePath(op.to) };
    case 'set': {
      if (!live) return fail(`没有 ${path}`);
      const next = { ...doc, at, by };
      if (op.pin !== undefined) next.pin = !!op.pin;
      if (op.show !== undefined) next.show = !!op.show;
      if (op.order !== undefined) next.order = Number(op.order);
      return { doc: next };
    }
    default:
      return fail(`不认识的笔记操作：${op?.kind}`);
  }
}

const liveDocs = (docs) => (Array.isArray(docs) ? docs : []).filter((d) => d && !d.deleted && d.path);

/** pin 的文件整份放进说明：按 order（小的先，没写的在后），再按最近改的；room 字节放不下的列进 skipped */
export function pinnedText(docs, room) {
  const pins = liveDocs(docs).filter((d) => d.pin).sort((a, b) => (Number.isFinite(a.order) ? a.order : Infinity) - (Number.isFinite(b.order) ? b.order : Infinity) || (Number(b.at) || 0) - (Number(a.at) || 0));
  const parts = [], skipped = [];
  let used = 0;
  for (const d of pins) {
    const piece = `### 笔记：${d.path}\n${d.text ?? ''}`;
    const n = bytes(piece) + 2;
    if (used + n > room) { skipped.push({ path: d.path, bytes: bytes(d.text) }); continue; }
    parts.push(piece);
    used += n;
  }
  return { text: parts.join('\n\n'), used, skipped };
}

const day = (t) => (Number(t) ? new Date(Number(t)).toISOString().slice(0, 10) : '');
/** 目录：每个没删的文件一行 */
export function notebookDir(docs) {
  return liveDocs(docs).sort((a, b) => a.path.localeCompare(b.path)).map((d) => `- ${d.path} · ${bytes(d.text)} 字节${d.pin ? ' · pin' : ''}${d.show ? ' · show' : ''}${d.at ? ` · ${day(d.at)}` : ''}`).join('\n');
}

const flag = (v) => (/^(on|true|1|是)$/i.test(v) ? true : /^(off|false|0|否)$/i.test(v) ? false : undefined);
/**
 * 课上输出里的 board note 块：一行一个操作，正文写在 <<< 和 >>> 之间（str_replace 的旧、新用 === 隔开）。
 * 返回 { ops, errors }，写错的那一条进 errors，别的照收
 */
export function parseNoteBlock(body) {
  const lines = String(body ?? '').split('\n');
  const ops = [], errors = [];
  const takeText = (i) => {
    if (lines[i]?.trim() !== '<<<') return { error: '正文要写在 <<< 和 >>> 之间', next: i };
    const out = [];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '>>>') out.push(lines[j++]);
    if (j >= lines.length) return { error: '正文少了收尾的 >>>', next: j };
    return { text: out.join('\n'), next: j + 1 };
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const [kind, ...rest] = line.split(/\s+/);
    try {
      if (kind === 'create' || kind === 'insert' || kind === 'str_replace') {
        const path = notePath(rest[0]);
        const t = takeText(i + 1);
        if (t.error) { errors.push(`${line}：${t.error}`); i = t.next + 1; continue; }
        if (kind === 'create') ops.push({ kind, path, text: t.text });
        else if (kind === 'insert') ops.push({ kind, path, line: Number(rest[1]) || 0, text: t.text });
        else {
          const k = t.text.split('\n').findIndex((x) => x.trim() === '===');
          if (k < 0) errors.push(`${line}：旧的和新的那一段之间要有一行 ===`);
          else { const parts = t.text.split('\n'); ops.push({ kind, path, old: parts.slice(0, k).join('\n'), new: parts.slice(k + 1).join('\n') }); }
        }
        i = t.next;
        continue;
      }
      if (kind === 'rename') ops.push({ kind, path: notePath(rest[0]), to: notePath(rest[1]) });
      else if (kind === 'delete' || kind === 'restore') ops.push({ kind, path: notePath(rest[0]) });
      else if (kind === 'set') {
        const op = { kind, path: notePath(rest[0]) };
        for (const kv of rest.slice(1)) {
          const [k, v] = kv.split('=');
          if (k === 'pin' || k === 'show') op[k] = flag(v);
          else if (k === 'order') op.order = Number(v);
        }
        ops.push(op);
      } else errors.push(`看不懂这一行：${line}`);
    } catch (e) { errors.push(`${line}：${e.message}`); }
    i++;
  }
  return { ops, errors };
}

/** 正文里引号括起来的话，在 corpus（这节课的记录、学生打的话、以前的记录）里找不到的那些 */
export const quoteNotes = (text, corpus) => checkQuotes({ next: text, corpus }).missing;

// 项目 Claude 的工具（第十四轮）：班主任、课上的老师、课后那一轮都用这一套。学习台里任何一条能读、任何一类能列、按字能找，
// 笔记本能看能写。工具的说明只写它做什么、读一次要多一轮（事实），不写该什么时候用。
import { searchDocs } from './search.js';
import { notebookDir, notePath } from './notebook.js';
import { journalId } from './journal.js';
import { validateWrite } from '../memory/writer.js';

export const READ_MAX = 32 * 1024;
const LIST_PAGE = 50;
const enc = new TextEncoder();
const bytes = (s) => enc.encode(String(s ?? '')).length;
const rowsOf = (snap) => (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
// 路径：成对的是一条文档（类/编号），单数段的是一类
const okPath = (p, even) => { const segs = String(p || '').split('/').filter(Boolean); return segs.length && segs.length % 2 === (even ? 0 : 1) && segs.every((x) => /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(x) && x !== '.' && x !== '..') ? segs.join('/') : ''; };
/** 按字节切出一段（不切坏汉字）：从 offset 字节起最多 max 字节 */
function sliceBytes(s, offset, max) {
  const b = enc.encode(s);
  let end = Math.min(b.length, offset + max);
  while (end < b.length && (b[end] & 0xc0) === 0x80) end--;
  let start = offset;
  while (start < b.length && (b[start] & 0xc0) === 0x80) start++;
  return { text: new TextDecoder().decode(b.slice(start, end)), end, total: b.length };
}
const textOf = (d) => [d.path, d.title, d.q, d.text, d.can, d.summary, d.say, typeof d.value === 'string' ? d.value : '', d.stem, d.body, d.how, d.traps ? JSON.stringify(d.traps) : ''].filter(Boolean).join('\n');

export const SEARCH_IN = ['books', 'exam', 'evidence', 'turns', 'chats', 'notebook', 'old'];
const OLD = ['rules', 'lessons', 'asks', 'profile', 'slips', 'observations', 'summary', 'errors', 'weaknesses', 'mastery', 'reviews', 'recall'];

/**
 * db：学习台的数据库；getData()：首页 / 课堂手上的数据（记忆库各类）；getBooks()：{ chunks }；notebook：notebookdesk 的 { run }；
 * by：写笔记本时记的作者；write：能不能写笔记本；used：每调一次记一条（花费和记录用）
 */
export function projectTools({ db, getData = () => ({}), getBooks = () => null, notebook = null, by = 'head', write = true, used = [] } = {}) {
  const cache = new Map();
  const once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn().catch(() => [])); return cache.get(key); };
  const collRows = (path) => once(`c:${path}`, async () => rowsOf(await db.collection(path).get()));

  async function sources(scopes) {
    const data = getData() || {};
    const out = [];
    const push = (coll, list) => { for (const d of list || []) if (d && d.id !== undefined) out.push({ path: `${coll}/${d.id}`, text: textOf(d) }); };
    if (scopes.has('notebook')) push('notebook', (data.notebook || []).filter((d) => !d.deleted));
    if (scopes.has('old')) for (const c of OLD) push(c, data[c]);
    if (scopes.has('evidence')) push('evidence', data.evidence);
    if (scopes.has('books')) for (const c of getBooks()?.chunks || []) out.push({ path: `books/${c.book}/chunks/${c.id}`, text: `${c.title || ''}\n${c.text || ''}` });
    if (scopes.has('exam')) for (const c of ['questions', 'exam_profiles', 'syllabus', 'passages']) push(c, await collRows(c));
    if (scopes.has('turns')) for (const s of data.sessions || []) push(`sessions/${s.id}/class_turns`, await collRows(`sessions/${s.id}/class_turns`));
    if (scopes.has('chats')) for (const c of await collRows('chats')) push(`chats/${c.id}/turns`, await collRows(`chats/${c.id}/turns`));
    return out;
  }

  const tools = [
    {
      name: 'read',
      description: `按路径读学习台数据库里的一条文档（「类/编号」，比如 meta/forecast、sessions/c-20261116-1/report/main、notebook/{编号}）。一次最多 ${READ_MAX / 1024} KiB，长的回 next，带 offset 接着读。每调一次多等一整轮。`,
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' } }, required: ['path'] },
      async execute(input) {
        used.push({ name: 'read', input: { path: String(input?.path ?? ''), offset: input?.offset } });
        const path = okPath(input?.path, true);
        if (!path) throw new Error('path 要是「类/编号」这样成对的路径，比如 meta/forecast');
        const s = await db.doc(path).get();
        if (!s.exists) throw new Error(`没有 ${path}`);
        const all = JSON.stringify(s.data());
        const offset = Math.max(0, Number(input?.offset) || 0);
        if (!offset && bytes(all) <= READ_MAX) return { path, doc: s.data() };
        const part = sliceBytes(all, offset, READ_MAX);
        return { path, text: part.text, ...(part.end < part.total ? { more: part.total - part.end, next: part.end } : {}) };
      },
    },
    {
      name: 'list',
      description: `列学习台数据库里的一类（比如 questions、exam_profiles、sessions、sessions/c-20261116-1/class_turns），可以按一个字段等于某个值筛（field + value）。一页 ${LIST_PAGE} 条，后面还有就回 next，带 cursor 接着列。每调一次多等一整轮。`,
      inputSchema: { type: 'object', properties: { collection: { type: 'string' }, field: { type: 'string' }, value: {}, cursor: { type: 'number' } }, required: ['collection'] },
      async execute(input) {
        used.push({ name: 'list', input: { collection: String(input?.collection ?? ''), field: input?.field, value: input?.value, cursor: input?.cursor } });
        const coll = okPath(input?.collection, false);
        if (!coll) throw new Error('collection 要是一类的路径，比如 questions 或 sessions/c-20261116-1/class_turns');
        const field = String(input?.field ?? '').trim();
        let rows = rowsOf(await (field ? db.collection(coll).where(field, '==', input?.value) : db.collection(coll)).get());
        rows = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const from = Math.max(0, Number(input?.cursor) || 0);
        const page = [];
        let size = 0;
        for (const r of rows.slice(from, from + LIST_PAGE)) { const n = bytes(JSON.stringify(r)); if (page.length && size + n > READ_MAX) break; page.push(r); size += n; }
        const end = from + page.length;
        return { collection: coll, count: rows.length, items: page, ...(end < rows.length ? { next: end } : {}) };
      },
    },
    {
      name: 'search',
      description: `在学习台里按字找，回命中的路径和那一小段原文（最多 30 条，分高的在前；要全文再 read）。in 可以只找其中几处：${SEARCH_IN.join('、')}（books 教材，exam 真题和考点，evidence 每一次作答和说的话，turns 每节课的每一轮，chats 和班主任的对话，notebook 你的笔记，old 以前一条条存的记忆和学习的账）；不写就全找。每调一次多等一整轮。`,
      inputSchema: { type: 'object', properties: { q: { type: 'string' }, in: { type: 'array', items: { type: 'string' } } }, required: ['q'] },
      async execute(input) {
        const q = String(input?.q ?? '').trim();
        const scopes = new Set((Array.isArray(input?.in) && input.in.length ? input.in : SEARCH_IN).filter((x) => SEARCH_IN.includes(x)));
        used.push({ name: 'search', input: { q, in: [...scopes] } });
        if (!q) throw new Error('要写 q（找什么）');
        const hits = searchDocs(await sources(scopes), q, { limit: 30 });
        return hits.length ? { hits } : { hits: [], note: '没找到：换个说法，或者换几个字' };
      },
    },
    {
      name: 'notebook',
      description: '你的笔记本（学生在「管理 → 笔记本」里看得到、改得了、退得回；每次改都留一版）。op：view（不写 path 是目录，写了是那个文件全文）、create（path、text）、str_replace（path、old、new：old 要恰好出现一次）、insert（path、line、text）、delete（path）、restore（path）、rename（path、to）、set（path，pin=true 时每一轮都整份放进你的说明，show=true 时出现在学生的「笔记」页，order 是 pin 的先后）。每调一次多等一整轮。',
      inputSchema: { type: 'object', properties: { op: { type: 'string' }, path: { type: 'string' }, text: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' }, line: { type: 'number' }, to: { type: 'string' }, pin: { type: 'boolean' }, show: { type: 'boolean' }, order: { type: 'number' } }, required: ['op'] },
      async execute(input) {
        const op = String(input?.op ?? '');
        used.push({ name: 'notebook', input: { op, path: input?.path } });
        const docs = (getData()?.notebook || []).filter((d) => !d.deleted);
        if (op === 'view') {
          if (!input?.path) return { dir: notebookDir(docs) || '（笔记本是空的）' };
          const p = notePath(input.path);
          const d = docs.find((x) => x.path === p);
          if (!d) throw new Error(`没有 ${p}`);
          return { path: p, text: d.text ?? '', pin: !!d.pin, show: !!d.show, v: d.v, ...(d.quotes?.length ? { quotes_not_found: d.quotes } : {}) };
        }
        if (!write || !notebook) throw new Error('这里只能 view');
        const r = await notebook.run({ kind: op, path: input?.path, text: input?.text, old: input?.old, new: input?.new, line: input?.line, to: input?.to, pin: input?.pin, show: input?.show, order: input?.order }, { by });
        if (!r.ok) throw new Error(r.error);
        return r;
      },
    },
  ];
  // 整个学习台的读写权（学生 2026-11-17：「直接你给 Claude 所有内容的操作权限不就行了吗」）：每一次写记进 journal，学生在管理页撤销
  if (write) tools.push({
    name: 'write',
    description: '改学习台数据库里的任何一条（「类/编号」）。op：set（整条换成 data）、update（把 data 的字段合进去）、delete（删掉这一条）、str_replace（这一条的 field 字段里，old 换成 new，old 要恰好出现一次）。每一次写都记进 journal，学生在「管理 → Claude 改过的」里看得到、能撤销。格式和学习台认的不一样时照写，回的 problems 里写哪里不对（缺哪个字段、哪个值不认）；要看一类现在长什么样，先 list 或 read 一条。每调一次多等一整轮。',
    inputSchema: { type: 'object', properties: { op: { type: 'string' }, path: { type: 'string' }, data: { type: 'object' }, field: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['op', 'path'] },
    async execute(input) {
      const op = String(input?.op ?? '');
      const path = okPath(input?.path, true);
      used.push({ name: 'write', input: { op, path: String(input?.path ?? '') } });
      if (!path) throw new Error('path 要是「类/编号」这样成对的路径，比如 meta/today');
      const ref = db.doc(path);
      const snap = await ref.get();
      const before = snap.exists ? snap.data() : null;
      let after;
      if (op === 'set') after = { ...(input?.data || {}) };
      else if (op === 'update') after = { ...(before || {}), ...(input?.data || {}) };
      else if (op === 'delete') { if (!before) throw new Error(`没有 ${path}`); after = null; }
      else if (op === 'str_replace') {
        if (!before) throw new Error(`没有 ${path}`);
        const field = String(input?.field ?? '');
        const cur = before[field];
        if (typeof cur !== 'string') throw new Error(`${path} 的 ${field} 不是一段文字`);
        const old = String(input?.old ?? '');
        const n = old ? cur.split(old).length - 1 : 0;
        if (n !== 1) throw new Error(n ? `old 在 ${field} 里出现了 ${n} 次：多写几个字让它只出现一次` : `old 在 ${field} 里没找到`);
        after = { ...before, [field]: cur.replace(old, () => String(input?.new ?? '')) };
      } else throw new Error('op 只能是 set / update / delete / str_replace');
      if (after === null) await ref.delete(); else await ref.set(after);
      const at = Date.now();
      await db.doc(`journal/${journalId(at)}`).set({ at, by, path, op, before, after });
      const problems = after ? validateWrite(path, after) : [];
      return { ok: true, path, ...(problems.length ? { problems } : {}) };
    },
  });
  return tools;
}

/** 工具的说明写成一段（放进说明的「工具」一节）：每个一行，名字和它做什么 */
export const toolsDoc = (tools) => (tools || []).map((t) => `- ${t.name}：${t.description}`).join('\n');

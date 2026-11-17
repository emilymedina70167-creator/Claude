// 笔记本存进学习台的数据库（第十四轮）：notebook/{编号}，编号是路径的 base64url（notebook.js 的 noteId）。
// 同一个文件的几次写排队（老师课上的 board note 块、班主任、课后那一轮可能同时改一个文件），每次先读最新的再改，
// 不拿旧的去盖。内容不审；引号在记录里找不到的只记在那一版上（quotes），不拦。
import { applyNoteOp, noteId, notePath, quoteNotes } from './notebook.js';
import { assertWrite } from '../memory/schema.js';

// 谁写的 → 记忆库的身份：课后那一轮、第一次整理都是页面开的项目 Claude，和班主任一样
const ROLE = { class: 'class', head: 'head', after: 'head', organize: 'head', me: 'me', page: 'page', chat: 'chat' };

/** db：学习台的数据库；corpus：拿来核引号的原始记录（这节课的记录、学生打的话……），给一个函数现取 */
export function createNotebook({ db, corpus = () => '' } = {}) {
  const queues = new Map();
  const ref = (path) => db.doc(`notebook/${noteId(path)}`);
  const read = async (path) => { const s = await ref(path).get(); return s.exists ? s.data() : null; };
  // 没有可核的原始记录（比如学生自己在管理页里改）就不核
  const stamp = (doc) => {
    let c = '';
    try { c = corpus() || ''; } catch { c = ''; }
    if (!c) return doc;
    let quotes = [];
    try { quotes = quoteNotes(doc.text, c); } catch { quotes = []; }
    return { ...doc, quotes };
  };
  const queued = (path, fn) => {
    const prev = queues.get(path) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    queues.set(path, next);
    next.finally(() => { if (queues.get(path) === next) queues.delete(path); }).catch(() => {});
    return next;
  };
  async function run(op, { by = 'head', at = Date.now() } = {}) {
    let path;
    try { path = notePath(op?.path); } catch (e) { return { ok: false, error: e.message }; }
    assertWrite(ROLE[by] || 'page', 'notebook');
    return queued(path, async () => {
      const cur = await read(path);
      const r = applyNoteOp(cur, { ...op, path }, { at, by });
      if (r.error) return { ok: false, error: r.error, path };
      if (r.moved) {
        const to = r.moved;
        return queued(to, async () => {
          const there = await read(to);
          if (there && !there.deleted) return { ok: false, error: `${to} 已经有了`, path };
          await ref(to).set(stamp({ ...cur, path: to, at, by, deleted: false }));
          await ref(path).set({ ...cur, deleted: true, movedTo: to, at, by });
          return { ok: true, path: to };
        });
      }
      const textChanged = !cur || cur.text !== r.doc.text;
      await ref(path).set(textChanged ? stamp(r.doc) : r.doc);
      return { ok: true, path };
    });
  }
  async function runAll(ops = [], opts = {}) {
    const out = [];
    for (const op of ops) out.push(await run(op, opts));
    return out;
  }
  return { run, runAll };
}

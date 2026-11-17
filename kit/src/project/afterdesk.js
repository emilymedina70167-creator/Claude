// 课后那一轮、第一次整理（第十四轮）：首页后台（lane: 'bg'）给项目 Claude 一轮，带全部工具（读、列、搜、写笔记本）。
// 提示只有一句事实（after.js）；它读什么、写什么、写不写都由它定。回的不是 Opus 5.5 就不算，记一次没成。不碰 DOM。
import { afterPrompt, organizePrompt, AFTER_FAILS } from './after.js';
import { projectTools, toolsDoc } from './tools.js';
import { HEAD, HEAD_MODEL, fitHistory } from '../head/context.js';
import { reportError } from '../errlog.js';

/**
 * db：学习台的数据库；ai()：调用 Claude 的；getData()：首页手上的数据；notebook：笔记本那一层；getBooks()：教材；
 * system(toolsDoc)：项目 Claude 这一轮的说明（headSystem，页面拼好）；render(md)：往题库写题时藏着画一遍（problemrender.js）；now：时钟
 */
export function createAfter({ db, ai, getData, notebook, getBooks = () => null, system, render = null, now = () => Date.now() }) {
  async function call(prompt, by) {
    const c = await ai();
    if (!c) return { error: '这个页面现在调用不了 Claude' };
    const used = [];
    const tools = projectTools({ db, getData, getBooks, notebook, by, write: true, used, render });
    try {
      const fit = fitHistory(system(toolsDoc(tools)), [{ role: 'me', text: prompt }]);
      const res = await c.call(fit.turns, { ...HEAD, cache: false, lane: 'bg', ...(c.tools ? { tools } : {}) });
      if (res?.modelApplied !== HEAD_MODEL) return { error: `回的不是 Opus 5.5（是 ${res?.modelApplied || '不知道哪个'}）`, used };
      return { res, used };
    } catch (e) {
      return { error: e?.message || e?.code || String(e), used };
    }
  }

  /** 课后那一轮。s：sessions 里这节课的文档 */
  async function after(s) {
    const ref = db.doc(`sessions/${s.id}`);
    const cur = await ref.get().then((x) => (x.exists ? x.data() : null)).catch(() => null);
    if (!cur) return 'gone';
    const prev = cur.after || {};
    const r = await call(afterPrompt({ ...cur, id: s.id }), 'after');
    if (r.error) {
      await ref.set({ ...cur, after: { ...prev, fails: (Number(prev.fails) || 0) + 1, error: String(r.error).slice(0, 200), tried: now() } }).catch(() => {});
      if ((Number(prev.fails) || 0) + 1 >= AFTER_FAILS) reportError(new Error(`课后那一轮没成：${r.error}`), { what: '课后那一轮', path: `sessions/${s.id}`, soft: true });
      return 'failed';
    }
    const text = String(r.res.text || '');
    await ref.set({ ...cur, after: { at: now(), model: r.res.modelApplied, rounds: (Number(prev.rounds) || 0) + 1, cont: !!r.res.truncated, last: text.slice(-600), tools: r.used.length } });
    return 'done';
  }

  /** 第一次整理：counts 是以前的记录每类几条；做完（或试满了）写 meta/project.since，之后下课的课才给课后那一轮 */
  async function organize(counts) {
    const ref = db.doc('meta/project');
    const cur = await ref.get().then((x) => (x.exists ? x.data() : {})).catch(() => ({}));
    const r = await call(organizePrompt(counts), 'organize');
    if (r.error) {
      const fails = (Number(cur.fails) || 0) + 1;
      // 试满了也写 since：不然以后每节课的课后那一轮都等着它
      await ref.set({ ...cur, fails, error: String(r.error).slice(0, 200), ...(fails >= AFTER_FAILS ? { since: now(), organized: false } : {}) }).catch(() => {});
      return 'failed';
    }
    await ref.set({ ...cur, since: now(), organized: true, at: now(), model: r.res.modelApplied, tools: r.used.length });
    return 'done';
  }

  return { after, organize };
}

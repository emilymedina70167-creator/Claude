// 班主任的数据库这一层：一段段对话存在 chats/{h-YYYYMMDD-n}（标题、开始和最后的时间、几轮），
// 每一轮在 chats/{编号}/turns/{000001}（role: me / head、text、at、model、用了哪些工具）。
// 发一句：先把我的话记成一条证据（src: say、chat: 编号）→ 调用 Opus 5.5 high（前台，学生在等）→ 回的不是 Opus 5.5 这一轮作废、照实说。
// 第十四轮起班主任就是项目 Claude：工具是 project/tools.js 那一套（读、列、搜、写它的笔记本），话的账、memo 块不再有。不碰 DOM（画面在 chatview.js）。
import { HEAD, HEAD_MODEL, fitHistory, nextChatId, chatTitle } from './context.js';
import { projectTools } from '../project/tools.js';
import { toDate } from '../memory/schema.js';
import { reportError } from '../errlog.js';

const rowsOf = (snap) => (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
const seqId = (n) => String(n).padStart(6, '0');
// 回答里要是还写了 memo 块（```board memo … ```）：画面上不显示块本身（第十四轮起不再执行它）
const MEMO_RE = /(`{3,})\s*board\s+memo\b[^\n]*\n([\s\S]*?)\1/g;
export function splitMemo(text) {
  const bodies = [];
  const shown = String(text ?? '').replace(MEMO_RE, (_, __, body) => { bodies.push(body); return ''; }).replace(/\n{3,}/g, '\n\n').trim();
  return { shown, body: bodies.join('\n') };
}

/**
 * db：学习台的数据库；getData()：首页手上的数据；ai()：调用 Claude 的；notebook：笔记本那一层（project/notebookdesk.js）；
 * getBooks()：教材（search 用）；system()：这一轮的说明（context.js 的 headSystem，页面拼好）
 */
export function createHead({ db, getData, ai, notebook = null, getBooks = () => null, system, render = null, now = () => Date.now() }) {
  async function chats() {
    return rowsOf(await db.collection('chats').get().catch(() => null)).sort((a, b) => (b.last || 0) - (a.last || 0));
  }
  async function turnsOf(cid) {
    return rowsOf(await db.collection(`chats/${cid}/turns`).get().catch(() => null)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  // —— 工具：项目 Claude 的那一套（project/tools.js）：读、列、搜学习台里的一切，写它自己的笔记本 ——
  const tools = (used) => projectTools({ db, getData, getBooks, notebook, by: 'head', write: true, used, render });

  // 发给它的对话：作废的轮不带（fitHistory 去掉 void）
  const callHistory = (history) => history;

  async function newChat(text) {
    const t = now();
    const id = nextChatId(await chats(), toDate(t));
    await db.doc(`chats/${id}`).set({ title: chatTitle(text), startedAt: t, last: t, n: 0, date: toDate(t) });
    return id;
  }
  async function patchChat(cid, patch) {
    const ref = db.doc(`chats/${cid}`);
    const cur = await ref.get().then((r) => (r.exists ? r.data() : {}));
    await ref.set({ ...cur, ...patch });
  }

  /**
   * 发一句。cid 空就开一段新对话。onText：边写边显示（只给画面看的字，memo 块不显示）。
   * 返回 { cid, turn, error? }：error 是这一轮没成的原因（照实写在画面上）
   */
  async function send(cid, text, { onText, signal } = {}) {
    const say = String(text ?? '').trim();
    if (!say) throw new Error('没有字');
    if (!cid) cid = await newChat(say);
    const at = now();
    const ev = { id: `ev-${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, src: 'say', kind: 'say', session: null, chat: cid, text: say.slice(0, 4000), at };
    const { id: evId, ...evDoc } = ev;
    await db.doc(`evidence/${evId}`).set(evDoc);
    const before = await turnsOf(cid);
    const meTurn = { role: 'me', text: say, at, ev: evId };
    await db.doc(`chats/${cid}/turns/${seqId(before.length + 1)}`).set(meTurn);
    await patchChat(cid, { last: at, n: before.length + 1 });
    const history = [...before, meTurn];
    const used = [];
    const c = await ai();
    if (!c) return { cid, error: '这个页面现在调用不了 Claude' };
    let res = null;
    let err = null;
    try {
      const fit = fitHistory(system(), callHistory(history));
      res = await c.call(fit.turns, { ...HEAD, cache: false, signal, ...(c.tools ? { tools: tools(used) } : {}), onText: ({ text: t }) => onText?.(splitMemo(t).shown) });
    } catch (e) {
      err = e;
    }
    const n = before.length + 2;
    if (err || !res) {
      const partial = String(err?.text || '');
      const why = err?.code === 'cancelled' || err?.name === 'AbortError' ? '停了' : `没回成：${err?.message || err?.code || '不知道为什么'}`;
      await db.doc(`chats/${cid}/turns/${seqId(n)}`).set({ role: 'head', text: partial, at: now(), void: true, why, tools: used });
      if (!['停了'].includes(why)) reportError(err, { what: '班主任没回成', path: `chats/${cid}`, soft: true });
      return { cid, error: why };
    }
    // 回的不是 Opus 5.5：这一轮作废（不进以后的对话），照实说
    if (res.modelApplied !== HEAD_MODEL) {
      await db.doc(`chats/${cid}/turns/${seqId(n)}`).set({ role: 'head', text: String(res.text || ''), at: now(), void: true, model: res.modelApplied || '', why: `回的不是 Opus 5.5（是 ${res.modelApplied || '不知道哪个'}），这一轮作废`, tools: used });
      return { cid, error: `回的不是 Opus 5.5（是 ${res.modelApplied || '不知道哪个'}），这一轮作废了，再发一次试试` };
    }
    const full = String(res.text || '');
    const { shown } = splitMemo(full);
    const turn = { role: 'head', text: full, shown, at: now(), model: res.modelApplied, tools: used };
    await db.doc(`chats/${cid}/turns/${seqId(n)}`).set(turn);
    await patchChat(cid, { last: turn.at, n });
    return { cid, turn };
  }

  return { chats, turnsOf, send, tools };
}

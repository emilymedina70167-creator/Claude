// 班主任的数据库这一层（第十一轮 B1，设计第十三节）：一段段对话存在 chats/{h-YYYYMMDD-n}（标题、开始和最后的时间、几轮），
// 每一轮在 chats/{编号}/turns/{000001}（role: me / head、text、at、model、用了哪些工具、memo 记了几条）。
// 发一句：先把我的话记成一条证据（src: say、chat: 编号；话的账和守卫都认它）→ 调用 Opus 5.5 high（前台，学生在等）
// → 回的不是 Opus 5.5 这一轮作废、照实说 → 回答里的 board memo 块过守卫写进记忆（作者 head，每条一张改动单、能撤销）
// → 后台给这段对话过一次话的账。不碰 DOM（画面在 chatview.js）。
import { HEAD, HEAD_MODEL, fitHistory, nextChatId, chatTitle, memoryReadDoc } from './context.js';
import { parseMemoLines, splitKnow } from '../memory/memo.js';
import { memoryRead } from '../memory/session.js';
import { reportText } from '../memory/report.js';
import { debriefText } from '../memory/debrief.js';
import { toDate } from '../memory/schema.js';
import { reportError } from '../errlog.js';

const rowsOf = (snap) => (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
const seqId = (n) => String(n).padStart(6, '0');
const READ_MAX = 12 * 1024;
const LIST_MAX = 50;
const SEARCH_CHATS = 30;
const utf8 = (s) => new TextEncoder().encode(String(s ?? '')).length;
const clipJson = (v) => { const s = JSON.stringify(v); return s.length <= READ_MAX ? v : { text: `${s.slice(0, READ_MAX - 100)}…`, note: '太长，截掉了后面' }; };
// 回答里的 memo 块：```board memo … ```（三个以上反引号）。画面上不显示块本身
const MEMO_RE = /(`{3,})\s*board\s+memo\b[^\n]*\n([\s\S]*?)\1/g;
export function splitMemo(text) {
  const bodies = [];
  const shown = String(text ?? '').replace(MEMO_RE, (_, __, body) => { bodies.push(body); return ''; }).replace(/\n{3,}/g, '\n\n').trim();
  return { shown, body: bodies.join('\n') };
}

/**
 * db：学习台的数据库；getData()：首页手上的记忆；ops：memops；ai()：调用 Claude 的；said：话的账（saiddesk.js）；
 * system()：这一轮的说明（context.js 的 headSystem，页面拼好）
 */
// summary：记忆摘要那一层（summarydesk.js 的 { on, note }）；有摘要时关于学生的事记成新笔记，不过话的账
export function createHead({ db, getData, ops, ai, said = null, summary = null, system, now = () => Date.now() }) {
  async function chats() {
    return rowsOf(await db.collection('chats').get().catch(() => null)).sort((a, b) => (b.last || 0) - (a.last || 0));
  }
  async function turnsOf(cid) {
    return rowsOf(await db.collection(`chats/${cid}/turns`).get().catch(() => null)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  // —— 工具：都是只读的（写只走 memo 块）——
  async function sessionRows(ids) {
    const data = getData();
    const out = [];
    for (const sid of ids.slice(0, 4)) {
      const doc = (data.sessions || []).find((x) => x.id === sid);
      if (!doc) { out.push({ id: sid, error: '没有这节课' }); continue; }
      const rep = await db.doc(`sessions/${sid}/report/main`).get().then((x) => (x.exists ? x.data() : null)).catch(() => null);
      const obs = (data.observations || []).filter((o) => o.session === sid);
      out.push({
        id: sid, kind: doc.kind || 'class', date: doc.date, block: doc.block, title: doc.title, status: doc.status,
        summary: obs.find((o) => o.kind === 'summary')?.text, notes: obs.filter((o) => o.kind !== 'summary').map((o) => `${o.kind}：${o.text}`).slice(0, 12),
        report: rep ? reportText(rep).slice(0, 6000) : doc.report?.line || '（这节课还没有课后报告）',
        ...(doc.debrief ? { debrief: debriefText(doc.debrief) } : {}),
      });
    }
    return { collection: 'sessions', items: out };
  }
  async function evidenceRows({ block, session: sid, id }) {
    if (id) {
      const s = await db.doc(`evidence/${id}`).get();
      if (!s.exists) throw new Error(`evidence 里没有 ${id}`);
      return { collection: 'evidence', doc: s.data() };
    }
    if (!block && !sid) throw new Error('evidence 要写 block 或 session（或者 id）');
    const [k, v] = block ? ['block', String(block)] : ['session', String(sid)];
    const rows = rowsOf(await db.collection('evidence').where(k, '==', v).get()).sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-30)
      .map((d) => ({ id: d.id, at: d.at, session: d.session, kind: d.kind, comp: d.comp || undefined, ok: d.ok ?? undefined, q: typeof d.q === 'string' ? d.q.slice(0, 120) : undefined, text: typeof d.text === 'string' ? d.text.slice(0, 200) : undefined, tags: d.tags }));
    return { collection: 'evidence', [k]: v, count: rows.length, items: rows };
  }
  const okPath = (p, even) => { const segs = String(p || '').split('/').filter(Boolean); return segs.length && segs.length % 2 === (even ? 0 : 1) && segs.every((x) => /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(x) && x !== '.' && x !== '..') ? segs.join('/') : ''; };
  function tools(used) {
    return [
      {
        name: 'memory_read',
        description: memoryReadDoc(!!summary?.on()),
        inputSchema: { type: 'object', properties: { collection: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, id: { type: 'string' }, block: { type: 'string' }, session: { type: 'string' } }, required: ['collection'] },
        async execute(input) {
          const q = { collection: String(input?.collection ?? '').trim(), ids: Array.isArray(input?.ids) ? input.ids.map(String) : undefined, id: input?.id, block: input?.block, session: input?.session };
          used.push({ name: 'memory_read', input: q });
          if (q.collection === 'asks') {
            const asks = getData().asks || [];
            const want = [...(q.ids || []), q.id].filter(Boolean).map(String);
            return clipJson({ collection: 'asks', docs: want.length ? asks.filter((a) => want.includes(String(a.id))) : asks });
          }
          const r = memoryRead(getData(), q);
          if (!r.needDb) return r;
          if (q.collection === 'sessions') return sessionRows(r.ids);
          return evidenceRows(q);
        },
      },
      {
        name: 'read',
        description: '按路径读学习台数据库里的一条文档（只读），比如 sessions/c-20261112-1/report/main、exam_profiles/G-OS-3.2.1、meta/forecast、meta/exam。最多 12 KiB。',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        async execute(input) {
          const path = okPath(input?.path, true);
          used.push({ name: 'read', input: { path: String(input?.path ?? '') } });
          if (!path) throw new Error('path 要是「类/编号」这样成对的路径，比如 meta/forecast');
          const s = await db.doc(path).get();
          if (!s.exists) throw new Error(`没有 ${path}`);
          return clipJson({ path, doc: s.data() });
        },
      },
      {
        name: 'list',
        description: '列学习台数据库里的一类（只读），可以按一个字段等于某个值筛（field + value），最多 50 条、12 KiB。比如 collection exam_profiles、field course、value OS；或者 sessions/c-20261112-1/class_turns。',
        inputSchema: { type: 'object', properties: { collection: { type: 'string' }, field: { type: 'string' }, value: { type: 'string' } }, required: ['collection'] },
        async execute(input) {
          const coll = okPath(input?.collection, false);
          used.push({ name: 'list', input: { collection: String(input?.collection ?? ''), field: input?.field, value: input?.value } });
          if (!coll) throw new Error('collection 要是一类的路径，比如 exam_profiles 或 sessions/c-20261112-1/class_turns');
          const ref = db.collection(coll);
          const field = String(input?.field ?? '').trim();
          const rows = rowsOf(await (field ? ref.where(field, '==', input?.value) : ref).get());
          const out = [];
          let size = 0;
          for (const r of rows) { const n = utf8(JSON.stringify(r)); if (out.length >= LIST_MAX || size + n > READ_MAX) break; out.push(r); size += n; }
          return { collection: coll, count: rows.length, items: out, ...(out.length < rows.length ? { more: rows.length - out.length, note: '没给全：加 field / value 缩小，或者 read 一条' } : {}) };
        },
      },
      {
        name: 'search_chats',
        description: '在以前和学生的对话里（最近 30 段）按字找，返回是哪一段、哪一轮、谁说的和那一小段原文。',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        async execute(input) {
          const q = String(input?.q ?? '').trim();
          used.push({ name: 'search_chats', input: { q } });
          if (!q) throw new Error('要写 q（找什么）');
          const low = q.toLowerCase();
          const hits = [];
          for (const c of (await chats()).slice(0, SEARCH_CHATS)) {
            for (const t of await turnsOf(c.id)) {
              const txt = String(t.text || '');
              const i = txt.toLowerCase().indexOf(low);
              if (i < 0) continue;
              hits.push({ chat: c.id, title: c.title, turn: t.id, role: t.role === 'head' ? '你' : '学生', date: toDate(t.at || c.startedAt || 0), text: txt.slice(Math.max(0, i - 60), i + 140) });
              if (hits.length >= 20) return { hits };
            }
          }
          return hits.length ? { hits } : { hits: [], note: '没找到：换个说法' };
        },
      },
    ];
  }

  // 发给它的对话：上一轮 memo 没收的，写在我下一句前面（和课堂一样，不然它以为记上了）
  function callHistory(history) {
    let carry = '';
    return history.map((t) => {
      if (t.role === 'head') {
        const rej = t.void ? [] : t.memo?.rejected || [];
        carry = rej.length ? `[页面] 你上一轮 memo 里有 ${rej.length} 条没记上：\n${rej.map((x) => `- ${x.line ? `${x.line}\n  ` : ''}原因：${x.error}`).join('\n')}\n\n` : '';
        return t;
      }
      const out = carry ? { ...t, text: `${carry}${t.text}` } : t;
      carry = '';
      return out;
    });
  }

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
    // 回的不是 Opus 5.5：这一轮作废（不进以后的对话、memo 不写），照实说
    if (res.modelApplied !== HEAD_MODEL) {
      await db.doc(`chats/${cid}/turns/${seqId(n)}`).set({ role: 'head', text: String(res.text || ''), at: now(), void: true, model: res.modelApplied || '', why: `回的不是 Opus 5.5（是 ${res.modelApplied || '不知道哪个'}），这一轮作废`, tools: used });
      return { cid, error: `回的不是 Opus 5.5（是 ${res.modelApplied || '不知道哪个'}），这一轮作废了，再发一次试试` };
    }
    const full = String(res.text || '');
    const { shown, body } = splitMemo(full);
    let memo = null;
    if (body.trim()) {
      const { entries: all, errors } = parseMemoLines(body);
      // 关于学生的事记成记忆摘要的新笔记（第十三轮）：班主任的对话三科都管，没写哪一科就记在共用那一份
      const { notes: knows, rest } = splitKnow(all, { on: !!summary?.on() });
      const entries = summary ? rest : all;
      if (summary) for (const k of knows) summary.note({ text: k.text, quote: k.say ? String(ev?.text || '') : '', space: k.space || 'shared', by: 'head' }).catch(() => {});
      try {
        const turns = history.map((t, i) => ({ seq: i + 1, role: t.role === 'head' ? 'claude' : 'student', text: t.text, at: t.at }));
        const r = entries.length ? await ops.applyMemo(entries, { author: 'head', evidence: [ev], turns }) : { pds: [], rejected: [] };
        memo = { n: r.pds.length, pds: r.pds.map((p) => p.id), rejected: [...errors.map((x) => ({ line: '', error: x })), ...r.rejected.map((x) => ({ line: x.line, error: x.error }))] };
      } catch (e) {
        memo = { n: 0, pds: [], rejected: [{ line: '', error: `没记成：${e?.message || e}` }] };
        reportError(e, { what: '班主任的 memo 没记成', path: `chats/${cid}`, soft: true });
      }
    }
    const turn = { role: 'head', text: full, shown, at: now(), model: res.modelApplied, tools: used, ...(memo ? { memo } : {}) };
    await db.doc(`chats/${cid}/turns/${seqId(n)}`).set(turn);
    await patchChat(cid, { last: turn.at, n });
    // 我这一句过一次话的账（后台、讲课优先；要求进「我的要求」，下一节课的老师就读到）
    if (!summary?.on()) said?.runForChat(cid).catch(() => {});
    return { cid, turn };
  }

  return { chats, turnsOf, send, tools };
}

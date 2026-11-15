// 话的账的数据库这一层（第十一轮，docs/superpowers/specs/2026-11-14-round11-design.md 6.2）：给一节课过账——
// 读这节课还没过账的话（按课号现查，不用快照），调用 Opus（后台、讲课优先），读回、核对，写进「我的要求」和这节课那一份账。
// 判断都在 said.js（纯函数）；这里只管读最新的、调用、写回去。首页、课堂、删课前都用它。
import { saidItems, saidPrompt, parseSaid, planSaid, saidRecord } from './said.js';
import { isTeach } from './session.js';
import { assertWrite } from './schema.js';
import { reportError } from '../errlog.js';

export const SAID_MODEL = 'claude-opus-5-5';
export const SAID_FAILS = 2; // 试满几次交给教研室（照课后助手的 AFTER_FAILS）
export const SAID_TIMEOUT = 6 * 60 * 1000;
const rowsOf = (snap) => (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));

/**
 * db：学习台的数据库（没 scope 过的）；getData()：手上的记忆（sessions、evidence、profile、lessons 用来判断要不要过账、拼提示词）；
 * ops：memops（applySaid）；ai()：拿到调用 Claude 的（没有就 null）
 */
export function createSaid({ db, getData, ops, ai, now = () => Date.now() }) {
  const running = new Map(); // 课号（或对话编号）→ 正在跑的那一次
  // 话从哪来：一节课（sessions/{课号}，证据按 session 查）或者班主任的一段对话（chats/{编号}，证据按 chat 查，
  // 轮次在 chats/{编号}/turns：我是 student、班主任是 claude，和课堂的轮次一个样，提示词里「老师前后说了什么」照用）
  const SRC = {
    class: (id) => ({ id, doc: `sessions/${id}`, rec: `sessions/${id}/said/main`, field: 'session', turns: `sessions/${id}/class_turns`, coll: 'sessions', mapTurn: (t) => t }),
    chat: (id) => ({ id, doc: `chats/${id}`, rec: `chats/${id}/said/main`, field: 'chat', turns: `chats/${id}/turns`, coll: 'chats', mapTurn: (t) => ({ ...t, role: t.role === 'head' ? 'claude' : 'student' }) }),
  };

  function needs(s) {
    if (!s || !isTeach(s)) return false;
    const st = s.said || {};
    if ((Number(st.fails) || 0) >= SAID_FAILS) return false;
    const upTo = Number(st.upTo) || 0;
    return (getData().evidence || []).some((e) => e.src === 'say' && String(e.session) === String(s.id) && Number(e.at || 0) > upTo);
  }

  // 读最新的那条再改（课上、别的设备可能刚改过）
  async function patchSession(sid, patch, src = SRC.class(sid)) {
    const ref = db.doc(src.doc);
    const cur = await ref.get().then((r) => (r.exists ? r.data() : null));
    if (!cur) return;
    if (src.coll === 'sessions') assertWrite('page', 'sessions');
    await ref.set({ ...cur, said: { ...(cur.said || {}), ...patch } });
  }

  async function call(prompt) {
    const c = await ai();
    if (!c) return null;
    let timer = null;
    const late = new Promise((r) => { timer = setTimeout(() => r(null), SAID_TIMEOUT); timer?.unref?.(); });
    const res = await Promise.race([c.call(prompt, { model: SAID_MODEL, effort: 'medium', modelTier: 'complex', cache: false, lane: 'bg' }), late]).finally(() => clearTimeout(timer));
    return !res || res.modelApplied !== SAID_MODEL ? null : res;
  }

  // 读这节课要过账的：s、上一份账、新话（items）、只有图的、拼提示词要的材料。没有这节课返回 null
  async function prepare(sid, src = SRC.class(sid)) {
    const sRef = await db.doc(src.doc).get();
    const s = sRef.exists ? sRef.data() : null;
    if (!s) return null;
    const prev = await db.doc(src.rec).get().then((r) => (r.exists ? r.data() : null)).catch(() => null);
    // 对话里的话 session 是空的：照课的样子把对话编号当成 session（只在这里，库里的不改），said.js 一个字不用动
    const evidence = rowsOf(await db.collection('evidence').where(src.field, '==', sid).get()).map((e) => (src.field === 'session' ? e : { ...e, session: sid }));
    const { items, photos } = saidItems(evidence, sid, 0, new Set(Object.keys(prev?.lines || {})));
    const turns = items.length ? rowsOf(await db.collection(src.turns).get().catch(() => null)).map(src.mapTurn) : [];
    const asks = items.length ? rowsOf(await db.collection('asks').get()) : [];
    const data = getData();
    const recent = (data.sessions || []).filter((x) => x.id !== sid).flatMap((x) => (x.said?.once || []).map((t) => ({ text: t, date: x.date || '' })));
    const base = { asks, profile: (data.profile || []).filter((p) => (p.status || 'active') === 'active'), lessons: (data.lessons || []).filter((l) => (l.status || 'active') === 'active'), turns, recent };
    return { sid, s, prev, evidence, items, photos, base, src };
  }
  // 照读回的去处写进去：要求、关于我、这节课那一份账、sessions.said
  async function commit(p, parsed) {
    const { sid, s, prev, items, photos, base, src } = p;
    const plan = planSaid(parsed, { items, asks: base.asks, sid, startedAt: Number(s.startedAt) || 0, today: s.date || new Date(now()).toISOString().slice(0, 10) });
    const w = await ops.applySaid(plan, { session: sid, turns: base.turns, ...(src.field === 'session' ? {} : { evidence: p.evidence }) });
    // 守卫没收的要求（编号被占了、对不上）：那几句不算有去处，留着下次再过（不然就再也没有下次了）
    const here = new Set(items.map((x) => x.ev));
    const lost = new Set();
    for (const r of w.rejected) {
      const a = plan.asks.find((x) => x.id === r.id);
      for (const q of a?.doc?.quotes || []) if (q.session === sid && here.has(q.ev)) lost.add(q.ev);
    }
    const lines = Object.fromEntries(Object.entries(parsed.lines).filter(([ev]) => !lost.has(ev)));
    const missing = [...new Set([...parsed.missing, ...lost])];
    const rec = saidRecord({ prev, items, photos, lines, missing, once: plan.once, at: now() });
    await db.doc(src.rec).set(rec);
    // 还缺句：试过的次数不清零（试满两次交教研室）
    await patchSession(sid, { upTo: rec.upTo, n: Object.keys(rec.lines).length, missing: rec.missing.length, ...(rec.missing.length ? {} : { fails: 0 }), at: now(), once: rec.once.slice(-5).map((o) => o.text) }, src);
    return { plan, written: w.written, rejected: w.rejected, missing: rec.missing };
  }

  /** 教研室的单子（labdesk.js）：拼同一份提示词；没有要过账的新话返回 null */
  async function input(sid) {
    const p = await prepare(sid);
    if (!p || !p.items.length) return null;
    return { prompt: saidPrompt({ ...p.base, items: p.items, earlier: p.prev?.lines || {} }), ctx: { session: sid } };
  }
  /** 教研室交回来的回答：照首页同一套读、核、写。返回 { ok, took, rejected, why } */
  async function take(sid, text) {
    const p = await prepare(sid);
    if (!p || !p.items.length) return { ok: false, why: '这节课已经没有要过账的话了' };
    const parsed = parseSaid(text, { ids: new Set(p.items.map((x) => x.ev)), asks: p.base.asks });
    const r = await commit(p, parsed);
    return { ok: true, took: { asks: r.written.length, lines: Object.keys(parsed.lines).length }, rejected: [...parsed.problems.map((x) => ({ error: x })), ...r.rejected.map((x) => ({ error: `${x.id}：${x.error}` })), ...r.missing.map((id) => ({ error: `${id} 没有去处` }))] };
  }

  /** 给一节课过账：'done'（过完了）、'partial'（还有句子没去处，下次再过）、'none'（没有要调用的新话）、'fail'（调用不了、回的不是 Opus、出错） */
  // 同一节课正在过账时又叫一次（删课、首页和课上同时）：等那一次跑完、拿它的结果（以前直接回 'none'，删课就把没过完的话删了）
  function runFor(sid, src = SRC.class(sid)) {
    const key = `${src.coll}/${sid}`;
    if (running.has(key)) return running.get(key);
    const p = runOnce(sid, src).finally(() => running.delete(key));
    running.set(key, p);
    return p;
  }
  /** 班主任的一段对话过账（chats/{编号}）：同一套，结果一样 */
  const runForChat = (cid) => runFor(cid, SRC.chat(cid));
  async function runOnce(sid, src) {
    try {
      const p = await prepare(sid, src);
      if (!p) return 'none';
      const { s, prev, evidence, items, photos, base } = p;
      if (!items.length) {
        if (photos.length) await db.doc(src.rec).set(saidRecord({ prev, photos, at: now() }));
        await patchSession(sid, { upTo: Math.max(Number(s.said?.upTo) || 0, ...evidence.filter((e) => e.src === 'say').map((e) => Number(e.at || 0))), at: now() }, src);
        return 'none';
      }
      // 调用之前先记一次「试过」：整页刷新断在半路，后面的 fail 跑不到（照 aidedesk.js 的 afterOne）
      await patchSession(sid, { fails: (Number(s.said?.fails) || 0) + 1, tryAt: now() }, src);
      const res = await call(saidPrompt({ ...base, items, earlier: prev?.lines || {} }));
      if (!res) return 'fail';
      const ids = new Set(items.map((x) => x.ev));
      let parsed = parseSaid(res.text, { ids, asks: base.asks });
      if (parsed.missing.length) {
        const left = items.filter((x) => parsed.missing.includes(x.ev));
        const again = await call(saidPrompt({ ...base, items: left, earlier: { ...(prev?.lines || {}), ...parsed.lines } }));
        if (again) {
          const p2 = parseSaid(again.text, { ids: new Set(parsed.missing), asks: base.asks });
          parsed = { lines: { ...parsed.lines, ...p2.lines }, missing: p2.missing, problems: [...parsed.problems, ...p2.problems] };
        }
      }
      const r = await commit(p, parsed);
      return r.missing.length ? 'partial' : 'done';
    } catch (err) {
      reportError(err, { what: '话的账', path: src.doc, soft: true });
      return 'fail';
    }
  }

  return { runFor, runForChat, needs, input, take, busy: () => running.size > 0 };
}

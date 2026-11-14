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
  const running = new Set();

  function needs(s) {
    if (!s || !isTeach(s)) return false;
    const st = s.said || {};
    if ((Number(st.fails) || 0) >= SAID_FAILS) return false;
    const upTo = Number(st.upTo) || 0;
    return (getData().evidence || []).some((e) => e.src === 'say' && String(e.session) === String(s.id) && Number(e.at || 0) > upTo);
  }

  // 读最新的那条再改（课上、别的设备可能刚改过）
  async function patchSession(sid, patch) {
    const ref = db.doc(`sessions/${sid}`);
    const cur = await ref.get().then((r) => (r.exists ? r.data() : null));
    if (!cur) return;
    assertWrite('page', 'sessions');
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

  /** 给一节课过账：'done'（过完了）、'none'（没有要调用的新话）、'fail'（调用不了、回的不是 Opus、出错） */
  async function runFor(sid) {
    if (running.has(sid)) return 'none';
    running.add(sid);
    try {
      const sRef = await db.doc(`sessions/${sid}`).get();
      const s = sRef.exists ? sRef.data() : null;
      if (!s) return 'none';
      const recRef = db.doc(`sessions/${sid}/said/main`);
      const prev = await recRef.get().then((r) => (r.exists ? r.data() : null)).catch(() => null);
      const evidence = rowsOf(await db.collection('evidence').where('session', '==', sid).get());
      const { items, photos } = saidItems(evidence, sid, 0, new Set(Object.keys(prev?.lines || {})));
      if (!items.length) {
        if (photos.length) await recRef.set(saidRecord({ prev, photos, at: now() }));
        if (photos.length || !prev) await patchSession(sid, { upTo: Math.max(Number(s.said?.upTo) || 0, ...evidence.filter((e) => e.src === 'say').map((e) => Number(e.at || 0))), at: now() });
        return 'none';
      }
      // 调用之前先记一次「试过」：整页刷新断在半路，后面的 fail 跑不到（照 aidedesk.js 的 afterOne）
      const fails = (Number(s.said?.fails) || 0) + 1;
      await patchSession(sid, { fails, tryAt: now() });
      const turns = rowsOf(await db.collection(`sessions/${sid}/class_turns`).get().catch(() => null));
      const asks = rowsOf(await db.collection('asks').get());
      const data = getData();
      const recent = (data.sessions || []).filter((x) => x.id !== sid).flatMap((x) => (x.said?.once || []).map((t) => ({ text: t, date: x.date || '' })));
      const base = { asks, profile: (data.profile || []).filter((p) => (p.status || 'active') === 'active'), lessons: (data.lessons || []).filter((l) => (l.status || 'active') === 'active'), turns, recent };
      const res = await call(saidPrompt({ ...base, items, earlier: prev?.lines || {} }));
      if (!res) return 'fail';
      const ids = new Set(items.map((x) => x.ev));
      let parsed = parseSaid(res.text, { ids, asks });
      if (parsed.missing.length) {
        const left = items.filter((x) => parsed.missing.includes(x.ev));
        const again = await call(saidPrompt({ ...base, items: left, earlier: { ...(prev?.lines || {}), ...parsed.lines } }));
        if (again) {
          const p2 = parseSaid(again.text, { ids: new Set(parsed.missing), asks });
          parsed = { lines: { ...parsed.lines, ...p2.lines }, missing: p2.missing, problems: [...parsed.problems, ...p2.problems] };
        }
      }
      const plan = planSaid(parsed, { items, asks, sid, startedAt: Number(s.startedAt) || 0, today: s.date || new Date(now()).toISOString().slice(0, 10) });
      await ops.applySaid(plan, { session: sid, turns });
      const rec = saidRecord({ prev, items, photos, lines: parsed.lines, missing: parsed.missing, once: plan.once, at: now() });
      await recRef.set(rec);
      await patchSession(sid, { upTo: rec.upTo, n: Object.keys(rec.lines).length, missing: rec.missing.length, fails: 0, at: now(), once: rec.once.slice(-5).map((o) => o.text) });
      return 'done';
    } catch (err) {
      reportError(err, { what: '话的账', path: `sessions/${sid}`, soft: true });
      return 'fail';
    } finally {
      running.delete(sid);
    }
  }

  return { runFor, needs, busy: () => running.size > 0 };
}

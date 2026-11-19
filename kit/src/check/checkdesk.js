// 检验的数据库那一层（设计 5.5、5.6″）：进度、证据、题库、吸收、记错题。课堂里的检验和复测的课共用。
// db 是这节课的（scopeDb：check、ink 在 sessions/{编号}/ 下面；evidence、probes、absorb、errors 是全局的）。
import { bankDocs, bankId, fenceOf, seenPatch } from './bank.js';
import { evidenceOf, absorbDoc, errorEntries, absorbStale } from './record.js';
import { absorbOf } from './flow.js';
import { reportError } from '../errlog.js';
import { guardDb } from '../memory/writer.js';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());

/**
 * sid、space：这节课；memoOps：desk.memo.ops（记错题，applyMemo）；ctx()：{ turn, turns }（这时课堂到第几轮）；
 * bankOf / retest：复测的课（局部 id → 题库编号、隔几天）
 */
export function createCheckDesk(rawDb, { sid = null, space = null, memoOps = null, ctx = () => ({}), bankOf = null, retest = null, readOnly = false, curriculum = () => [] } = {}) {
  // 写都走同一个出口（memory/writer.js 的 guardDb）：网络抖、限流自己重试两次，学生的第一次作答不丢；读照旧
  const db = guardDb(rawDb);
  const written = new Map(); // 检验 id → { 题 id → 证据 }
  const soft = (what, path) => (e) => reportError(e, { what, path, soft: true });
  const evsOf = (cid) => written.get(cid) || written.set(cid, {}).get(cid);

  return {
    async load(cid) { const d = await db.doc(`check/${cid}`).get().catch(() => null); return d?.exists ? d.data()?.state || null : null; },
    async list() { const r = await db.collection('check').get().catch(() => null); return r ? r.docs.map((d) => ({ id: d.id, ...d.data() })) : []; },
    save(cid, state) { if (readOnly) return; db.doc(`check/${cid}`).set({ state, at: Date.now() }).catch(soft('存检验的进度', `check/${cid}`)); },
    /** 写这几道题的证据（本题定下来了 / retry 判出来了），题库里记见过 */
    record(ids, state, { rejudged = false, partial = false } = {}) {
      if (readOnly) return [];
      const cid = state.check.id;
      const out = [];
      for (const id of ids) {
        const ev = { ...evidenceOf(state, id, { ctx: { session: sid, turn: ctx().turn }, bankOf, retest, rejudged, partial }), wroteAt: Date.now() };
        evsOf(cid)[id] = ev;
        out.push(ev);
        db.doc(`evidence/${ev.id}`).set(ev).catch(soft('写检验的证据', `evidence/${ev.id}`));
        if (rejudged) continue; // 改判追加的一条：题库不再记一次见过
        const p = state.check.probes[id];
        const bid = bankOf?.[id] || bankId(fenceOf(p));
        const as = retest ? 'retest' : state.results[id]?.of ? 'retry' : 'first';
        db.doc(`probes/${bid}`).get().then((d) => (d.exists ? db.doc(`probes/${bid}`).update(seenPatch(d.data(), { session: sid, at: Date.now(), as })) : null)).catch(soft('题库记见过', `probes/${bid}`));
      }
      return out;
    },
    /** 执行 board check 时把题存进题库（同一个编号不写第二次）；base：这节课 let 的量（浮点），题里用到的抄进 lets */
    async bankStore(check, base = {}) {
      if (readOnly || bankOf) return;
      for (const { id, doc } of bankDocs(check, { session: sid, at: Date.now(), base })) {
        const had = await db.doc(`probes/${id}`).get().catch(() => null);
        if (!had?.exists) db.doc(`probes/${id}`).set(doc).catch(soft('存进检验题库', `probes/${id}`));
      }
    },
    /**
     * 做完（或外部改判以后）：每块写吸收（复测的课不写），最后没过的、很确定却错了的记错题（同一道题记过的 memo 照规矩不另记）。
 * late：刷新以后补写的（那一块已经有更晚的检验写的吸收就跳过）
     * 返回 { absorbs: { 块: absorbOf }, errors: [回报的一句] }
     */
    async finish(state, { errors = true, late = false } = {}) {
      const check = state.check;
      const absorbs = Object.fromEntries(check.blocks.map((b) => [b.block, absorbOf(state, b.block)]));
      if (readOnly) return { absorbs, errors: [] };
      // 证据：这次打开页面以后写的在手上；刷新以前写的照进度里记的编号读回来
      const evs = { ...evsOf(check.id) };
      for (const [pid, eid] of Object.entries(state.evidence || {})) {
        if (evs[pid]) continue;
        const d = await db.doc(`evidence/${eid}`).get().catch(() => null);
        if (d?.exists) evs[pid] = { id: eid, ...d.data() };
      }
      if (!retest) {
        for (const b of check.blocks) {
          const a = absorbs[b.block];
          if (!a?.state) continue;
          const path = `absorb/${b.block.replace(/#/g, '~')}`;
          const prev = await db.doc(path).get().then((d) => (d.exists ? d.data() : null), () => null);
          // 补写（刷新以后才写的）：这一块已经有更晚的检验写的吸收，不盖回去
          if (late && absorbStale(prev, { check: check.id, session: sid, endedAt: state.endedAt })) continue;
          const ids = a.probes.map((pid) => evs[pid]?.id).filter(Boolean);
          const doc = absorbDoc(prev, { ...a, block: b.block }, {
            check, session: sid, space, at: Date.now(), today: today(), families: b.must.map((pid) => check.probes[pid].family), owed: state.owed || [], evidence: ids.length ? ids : prev?.probes || [],
          });
          // 外部改判以后重算的是同一次检验：不另进 history（log 照记改了什么）
          if (prev?.check === check.id && prev?.session === sid) Object.assign(doc, { history: prev.history || [], retests: prev.retests || doc.retests, date: prev.date || doc.date });
          await db.doc(path).set(doc).catch(soft('写吸收', path));
        }
      }
      const lines = [];
      if (errors && memoOps) {
        // 块不在课程地图里（还没建图的科）：不挂块照记，免得整条记不上（和计划 1 的解答题一样）
        const cur = curriculum() || [];
        const entries = errorEntries(state, check, { evidence: Object.fromEntries(Object.entries(evs).map(([k, v]) => [k, v.id])) })
          .map((e) => (e.attrs.block && cur.length && !cur.some((c) => String(c.id) === String(e.attrs.block)) ? { ...e, attrs: { ...e.attrs, block: undefined } } : e));
        if (entries.length) {
          try {
            const r = await memoOps.applyMemo(entries, { session: sid, block: null, space, turn: ctx().turn ?? null, turns: ctx().turns || null, evidence: Object.values(evs) });
            if (r.pds?.length) lines.push(`错题本记了 ${r.pds.map((x) => x.target).join('、')}`);
            for (const x of r.rejected || []) lines.push(`错题本没记：${x.error}`);
          } catch (e) { lines.push(`错题本没记成：${String(e?.message || e).slice(0, 120)}`); }
        }
      }
      return { absorbs, errors: lines };
    },
    evidenceOf: (cid) => ({ ...evsOf(cid) }),
  };
}

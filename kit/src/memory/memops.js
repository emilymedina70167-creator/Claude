// 改记忆的数据库这一层（docs/desk-plan.md 第 4 节）：课堂里执行 memo 块、下课整理单，学习台上「确认 / 不要 / 撤销」、我自己改。
// 判断都在 memo.js（纯函数）；这里只管读最新的那条、写回去。课堂和学习台首页共用。
// 安全线：我确认才写的那几类只有 confirm() 会写，而 confirm() 只由页面上我点的按钮调用（memoview.js），课堂 Claude 的输出走不到这里。
import { toDate } from './schema.js';
import { planEntry, pendingRecord, applyPending, rejectPending, undoPending, meChange, nextErrorId, nextWeaknessId, nextReviewId } from './memo.js';

const NEXT = { errors: nextErrorId, weaknesses: nextWeaknessId, reviews: nextReviewId };

/**
 * db：学习台的数据库（没有 scopeDb 过的）；mem()：页面手上的记忆库（各类的数组，一直在订阅）。
 */
export function createMemOps({ db, mem }) {
  const rows = (snap) => (snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : []);

  async function write(writes) {
    // 改动单最后写：目标文档没写成时，改动单还停在原来的状态
    for (const w of [...writes].sort((a, b) => (a.coll === 'pending') - (b.coll === 'pending'))) await db.doc(`${w.coll}/${w.id}`).set(w.doc);
  }

  // 拿最新的那条（订阅可能还没跟上刚才的写入），盖在手上那份记忆上
  async function fresh(coll, id) {
    const m = { ...mem() };
    const snap = await db.doc(`${coll}/${id}`).get().catch(() => null);
    const list = (m[coll] || []).filter((d) => String(d.id) !== String(id));
    m[coll] = snap?.exists ? [...list, { id, ...snap.data() }] : list;
    return m;
  }

  async function freshPending(pd) {
    const snap = await db.doc(`pending/${pd.id}`).get().catch(() => null);
    return snap?.exists ? { id: pd.id, ...snap.data() } : pd;
  }

  /**
   * 执行一个 memo 块（课堂一轮的输出、下课整理单）。entries：protocol.js 读出来的；ctx：{ session, block, turn }。
   * 直接写的马上写进去；要我确认的只写改动单。返回 { pds（新的改动单）, rejected: [{ line, error }] }
   */
  async function applyMemo(entries, { session = null, block = null, turn = null } = {}) {
    const evidence = session ? rows(await db.collection('evidence').where('session', '==', session).get().catch(() => null)) : [];
    const date = toDate(Date.now());
    // 同一块里的几条要编号的（两道新错题）：先在手上的副本里占住号，免得撞
    const local = { ...mem() };
    const pds = [];
    const rejected = [];
    for (const e of entries || []) {
      const ch = planEntry(e, { mem: local, evidence, session, block, date });
      if (ch.error) { rejected.push({ line: e.line, error: ch.error }); continue; }
      if (ch.op === 'add') local[ch.coll] = [...(local[ch.coll] || []), { id: ch.target, ...(ch.data || {}) }];
      let pd = pendingRecord(ch, { session, turn, by: 'class', line: e.line });
      if (!e.attrs.id && NEXT[ch.coll]) pd.autoId = true;
      try {
        if (pd.tier === 'direct') {
          const r = applyPending(pd, await fresh(ch.coll, ch.target), { date });
          await write(r.writes);
          pd = r.pd;
        } else {
          const { id, ...doc } = pd;
          await db.doc(`pending/${id}`).set(doc);
        }
        pds.push(pd);
      } catch (err) {
        rejected.push({ line: e.line, error: err?.message || String(err) });
      }
    }
    return { pds, rejected };
  }

  /** 我点了「确认」（edits：在「改」里改过的字段） */
  async function confirm(pd0, edits = null) {
    let pd = await freshPending(pd0);
    let m = await fresh(pd.coll, pd.target);
    // 自动编的号这期间被占了（别的错题先确认了）：换下一个号
    if (pd.op === 'add' && pd.autoId && (m[pd.coll] || []).some((d) => String(d.id) === String(pd.target))) {
      const all = rows(await db.collection(pd.coll).get().catch(() => null));
      pd = { ...pd, target: NEXT[pd.coll](all, pd.data?.block) };
      m = await fresh(pd.coll, pd.target);
    }
    const r = applyPending(pd, m, { edits });
    await write(r.writes);
    return r.pd;
  }

  async function reject(pd0) {
    const r = rejectPending(await freshPending(pd0));
    await write(r.writes);
    return r.pd;
  }

  async function undo(pd0) {
    const pd = await freshPending(pd0);
    // 错题的作废更正要新编号：拿整个错题档案
    const m = await fresh(pd.coll, pd.target);
    if (pd.coll === 'errors') m.errors = rows(await db.collection('errors').get().catch(() => null));
    const r = undoPending(pd, m);
    await write(r.writes);
    return r.pd;
  }

  /** 我自己改：pref（改偏好的文字）/ resolve（错题标已解决）/ pause / resume（复现组） */
  async function me(what, args = {}) {
    const m = { ...mem() };
    if (what === 'resolve') m.errors = rows(await db.collection('errors').get().catch(() => null));
    const pd = meChange(what, m, args);
    const r = applyPending(pd, await fresh(pd.coll, pd.target));
    await write(r.writes);
    return r.pd;
  }

  return { applyMemo, confirm, reject, undo, me };
}

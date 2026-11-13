// 改记忆的数据库这一层（docs/desk-plan.md 第 4 节）：课堂里执行 memo 块、下课整理单，学习台上「确认 / 不要 / 撤销」、我自己改。
// 判断都在 memo.js（纯函数）；这里只管读最新的那条、写回去。课堂和学习台首页共用。
// 安全线：我确认才写的那几类只有 confirm() 会写，而 confirm() 只由页面上我点的按钮调用（memoview.js），课堂 Claude 的输出走不到这里。
import { toDate } from './schema.js';
import { planEntry, pendingRecord, applyPending, rejectPending, undoPending, meChange, nextErrorId, nextWeaknessId, nextReviewId } from './memo.js';
import { guardCandidate, buildCorpus, guardMark, guardReason, guardLog } from './guard.js';
import { spaceOfId } from './space.js';

const NEXT = { errors: nextErrorId, weaknesses: nextWeaknessId, reviews: nextReviewId };
export const MEMO_MAX = 12;
// 课后助手（第九轮，作者 aide）只写事实：错题、弱点（新的、又出现一次）、过程观察、老师讲错的地方、记忆点。
// 判断（守则又犯、待办、复现组结果、下一节、偏好、规则）留给课堂里的老师当场写
export const AIDE_KINDS = new Set(['error', 'weakness', 'note', 'slip', 'recall']);
const LAB_FRESH = ['errors', 'weaknesses', 'reviews', 'recall', 'lessons', 'observations', 'slips', 'profile', 'rules', 'position'];

/**
 * db：学习台的数据库（没有 scopeDb 过的）；mem()：页面手上的记忆库（各类的数组，一直在订阅）。
 */
// exam：() => { ids, reserved }（这节课这门课的真题、考点、坑的编号，exam/fields.js 的 examIndexOf；守卫认题号、拒留作模考的）
export function createMemOps({ db, mem, exam = () => null }) {
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
  // 守卫（guard.js）：每一条写进去之前看一遍。turns：这节课到现在的每一轮（课堂手上的 history，用来核原话、轮次、板上编号）；
  // closing：下课整理单——被拒的没有下一轮能告诉它了，记进 meta/guard 的 carry，下一节同一科开课时资料包里带着
  async function applyMemo(entries, { session = null, block = null, space = null, turn = null, turns = null, closing = false, author = 'class' } = {}) {
    const evidence = session ? rows(await db.collection('evidence').where('session', '==', session).get().catch(() => null)) : [];
    const corpus = buildCorpus({ turns: turns || [], evidence });
    const logs = [];
    const date = toDate(Date.now());
    // 同一块里的几条要编号的（两道新错题）：先在手上的副本里占住号，免得撞
    const local = { ...mem() };
    // 教研室的回答几份一起并进来（labdesk.js 一份接一份）：手上那份记忆可能还没跟上上一份刚写的，
    // 自动编号（K3、T-14、错题号）会撞、重复的看不出来。它不在上课那条路上，先从数据库把会写的几类读一遍新的
    if (author === 'lab' || author === 'aide') {
      for (const c of LAB_FRESH) {
        const r = rows(await db.collection(c).get().catch(() => null));
        if (r.length) local[c] = r;
      }
    }
    const pds = [];
    const rejected = [];
    // 一个 memo 块最多记 MEMO_MAX 条（归纳守则的 lesson 不算）：记得太多学生看不过来，挑要紧的。
    // 整理（合并、作废、停掉、关掉）、判复现结果、改 position 不算：它们让记忆变少、变准，
    // 下课整理单常常一次有好几行，算进去会把排在最后的合并、position 截掉（下课以后没人看得到被拒了）
    const free = (e) => e.kind === 'lesson' || e.kind === 'position' || ['merged', 'void', 'retired', 'closed', 'done'].includes(e.attrs?.status) || (e.kind === 'review' && e.attrs?.result);
    let n = 0;
    for (const e of entries || []) {
      if (author === 'aide' && !AIDE_KINDS.has(e.kind)) { rejected.push({ line: e.line, error: '助手只写事实（错题、弱点、过程观察、讲错的地方、记忆点），这一条留给课上的老师' }); continue; }
      if (!free(e) && ++n > MEMO_MAX) { rejected.push({ line: e.line, error: `一次最多记 ${MEMO_MAX} 条（归纳守则不算），这条没记：挑要紧的` }); continue; }
      const ch = planEntry(e, { mem: local, evidence, session, block, space, date });
      if (ch.error) { rejected.push({ line: e.line, error: ch.error }); continue; }
      // 事后补写的不改「下一节从哪接」：之后可能又上过课，课堂里当场写的那条为准（单子里也说了）
      if ((author === 'lab' || author === 'aide') && ch.coll === 'position') { rejected.push({ line: e.line, error: '事后补写的不写 position（下一节怎么接写在小结里）' }); continue; }
      // 教研室事后写的（lab.js）：新加的记成它写的、标「事后补写」（守卫按这个认，页面上也看得出不是课堂当场写的）
      if ((author === 'lab' || author === 'aide') && ch.op === 'add' && ch.data) ch.data = { ...ch.data, ...('by' in ch.data ? { by: author } : {}), ...(session && ['observations', 'slips', 'errors'].includes(ch.coll) ? { backfill: true } : {}) };
      if (ch.op === 'add') local[ch.coll] = [...(local[ch.coll] || []), { id: ch.target, ...(ch.data || {}) }];
      // 同一块里对同一条改两次（守则又犯两次）：第二条要看到第一条改过的
      else if (ch.tier === 'direct') local[ch.coll] = (local[ch.coll] || []).map((d) => (String(d.id) === String(ch.target) ? { ...d, ...(ch.patch || {}) } : d));
      let pd = pendingRecord(ch, { session, turn, by: author === 'lab' || author === 'aide' ? author : 'class', line: e.line });
      if (!e.attrs.id && NEXT[ch.coll]) pd.autoId = true;
      try {
        // 先算出写进去会是什么样（直接写的、要我确认的都算一遍），守卫看的是这一份；还没写
        const m = await fresh(ch.coll, ch.target);
        let r = null;
        try { r = applyPending(pd, m, { date }); } catch (err) {
          // 要我确认的那档（规则）以前不先算、直接记改动单：算不出来（编号到确认时才定）照旧，守卫看改动单里写的
          if (pd.tier === 'direct') throw err;
        }
        const w = r ? r.writes.find((x) => x.coll === ch.coll) : { id: String(ch.target), doc: { ...(ch.data || {}), ...(ch.patch || {}) } };
        const old = (m[ch.coll] || []).find((d) => String(d.id) === String(ch.target));
        const { id: _o, ...before } = old || {};
        // 课堂手上的记忆不一定带证据：这节课的证据（上面刚读的）一起给守卫，不然真有的依据会被当成找不到
        const seen = new Set((local.evidence || []).map((x) => String(x.id)));
        const g = guardCandidate({ coll: ch.coll, id: w.id, doc: w.doc, before: old ? before : null, author, session, basis: pd.basis, missingBasis: ch.missingBasis }, { mem: { ...local, evidence: [...(local.evidence || []), ...evidence.filter((x) => !seen.has(String(x.id)))] }, corpus, exam: exam?.() || null });
        if (g.verdict !== 'accept') logs.push(guardLog(g, { coll: ch.coll, id: w.id, session, author, line: e.line, closing }));
        if (g.verdict === 'reject') { rejected.push({ line: e.line, error: guardReason(g), guard: true }); undoLocal(local, ch); continue; }
        if (g.verdict === 'hold') {
          // 先暂存：改动单记成 held，带守卫看出来的问题；在「管理 → 自检 → 守卫」里我能放行或者不要
          const { id, ...doc } = { ...pd, status: 'held', guard: guardMark(g) };
          await db.doc(`pending/${id}`).set(doc);
          rejected.push({ line: e.line, error: `先暂存了：${guardReason(g)}`, held: true });
          undoLocal(local, ch);
          continue;
        }
        if (pd.tier === 'direct') {
          // 挂提醒：照写，那一条上记着守卫看出来的问题（页面、以后写内容的 Claude 都看得到；Claude 写的话不动）
          if (g.verdict === 'flag') w.doc = { ...w.doc, guard: guardMark(g) };
          await write(r.writes);
          pd = r.pd;
        } else {
          const { id, ...doc } = g.verdict === 'flag' ? { ...pd, guard: guardMark(g) } : pd;
          await db.doc(`pending/${id}`).set(doc);
        }
        pds.push(pd);
      } catch (err) {
        rejected.push({ line: e.line, error: err?.message || String(err) });
      }
    }
    // 暂存的不带进下一节（它在「管理」里等我放行，带过去会重复记）
    await writeGuard(logs, closing ? rejected.filter((x) => !x.held).map((x) => ({ line: x.line, error: x.error })) : [], { session, space: space || (block ? spaceOfId(block) : 'math') });
    return { pds, rejected };
  }

  // 被守卫拒掉、暂存的那一条：从手上的副本里拿掉（同一块后面的条目别以为它已经在了）
  function undoLocal(local, ch) {
    if (ch.op === 'add') local[ch.coll] = (local[ch.coll] || []).filter((d) => String(d.id) !== String(ch.target));
  }

  // 审计日志（guard_log，只记没直接收下的）和 meta/guard（每种结果几条；下课整理单没收的记进 carry，下一节开课带着）
  async function writeGuard(logs, carry, { session, space }) {
    if (!logs.length && !carry.length) return;
    try {
      for (const l of logs) await db.doc(`guard_log/${l.id}`).set(l.doc);
      const ref = db.doc('meta/guard');
      const cur = await ref.get().then((s) => (s.exists ? s.data() : {})).catch(() => ({}));
      const counts = { ...(cur.counts || {}) };
      for (const l of logs) counts[l.doc.verdict] = (counts[l.doc.verdict] || 0) + 1;
      const carryAll = { ...(cur.carry || {}) };
      if (carry.length) carryAll[space] = [...carry.map((x) => ({ ...x, session, at: Date.now() })), ...(carryAll[space] || [])].slice(0, 8);
      await ref.set({ ...cur, counts, carry: carryAll, at: Date.now() });
    } catch (err) { console.warn('守卫的记录没写成', err); }
  }

  /** 我在「管理 → 守卫」里放行一条暂存的：当成我确认，照常写进去 */
  async function release(pd0) {
    const pd = await freshPending(pd0);
    if (pd.status !== 'held') throw new Error('这条已经不是暂存的了');
    const done = await confirmPd({ ...pd, status: 'open', released: true });
    // 放行的是教研室补写的小结：这节课记上小结（工作单就不再列它，也不会再补写一份）
    if (pd.coll === 'observations' && pd.data?.kind === 'summary' && pd.session) {
      const ref = db.doc(`sessions/${pd.session}`);
      const s = await ref.get().catch(() => null);
      if (s?.exists && !s.data().summary) await ref.set({ ...s.data(), summary: String(pd.target), backfilled: Date.now() }).catch(() => {});
    }
    return done;
  }
  /** 不要这条暂存的 */
  async function drop(pd0) {
    const pd = await freshPending(pd0);
    if (pd.status !== 'held') throw new Error('这条已经不是暂存的了');
    return rejectPd({ ...pd, status: 'open' });
  }

  /** 我点了「确认」（edits：在「改」里改过的字段） */
  async function confirm(pd0, edits = null) { return confirmPd(await freshPending(pd0), edits); }
  async function confirmPd(pd0, edits = null) {
    let pd = pd0;
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

  /** 直接写一张改动单（页面算的掌握、练习后的复现组结果）：写进去，改动单记成 done，能撤销 */
  async function applyNow(pd) {
    const r = applyPending({ ...pd, tier: 'direct' }, await fresh(pd.coll, pd.target));
    await write(r.writes);
    return r.pd;
  }

  async function reject(pd0) { return rejectPd(await freshPending(pd0)); }
  async function rejectPd(pd) {
    const r = rejectPending(pd);
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

  return { applyMemo, applyNow, confirm, reject, undo, me, release, drop };
}

// 云端教研室在学习台这一边（docs/lab-plan.md）：拼工作单子 lab_brief、收回答 lab_inbox、写回执 lab_inbox_log。
// 判断都在 lab.js（纯函数）；这里只读数据库、拼材料、写回去，出题的那一种还要在页面上把题画一遍看有没有写法错误。
// 不调用 Claude，也不在课堂那条路上：首页每次自检后（desk.js 的 runSentry）同步一次单子，收件箱一直订阅着。
import { renderLesson } from '../render.js';
import { session as kitSession } from '../session.js';
import { parseOutput } from '../class/protocol.js';
import { COMPONENT_DOCS } from '../class/docs.js';
import { assertWrite } from './schema.js';
import { scopeDb } from './session.js';
import { pendingRecord } from './memo.js';
import { guardCandidate, buildCorpus, guardMark, guardReason, guardLog } from './guard.js';
import { LAB_CAPS, briefId, bytesOf, BRIEF_MAX, LAB_VERSION, srcOf, backfillMaterial, problemsMaterial, briefDoc, parseBackfill, parseProblems, problemLint, twinOf, prepBrief, checkReply, receipt } from './lab.js';
import { reportError } from '../errlog.js';

const docsOf = (snap) => (snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : []);
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * db：学习台的数据库（guardDb 过的）；getData()：手上的记忆库；packs：各科的资料包（desk.js 订阅着）；
 * planner：planview.js（备课的材料和读回答）；ops：memops.js；onChange()：回执、单子变了（管理页重画）
 */
export function createLabDesk({ db, getData, packs, planner, ops, onChange = () => {} }) {
  let briefs = [];
  let logs = [];
  let syncing = false;
  const empty = new Set(); // 拼过、没有材料的（单子编号|材料指纹）：这次打开不再去读它的记录
  let again = null;
  let firstInbox = null;
  const firstDone = new Promise((r) => { firstInbox = r; });
  db.collection('lab_brief').onSnapshot((s) => { briefs = docsOf(s); onChange(); }, () => {});
  const loadLogs = () => db.collection('lab_inbox_log').orderBy('at', 'desc').limit(8).get().then((s) => { logs = docsOf(s); onChange(); }, () => {});
  // 回执只留最近的 LOG_KEEP 份（教研室只看最近的几份；数据库一共只能放两万多条）
  const LOG_KEEP = 40;
  async function pruneLogs() {
    const all = docsOf(await db.collection('lab_inbox_log').get().catch(() => null)).sort((a, b) => (b.at || 0) - (a.at || 0));
    for (const r of all.slice(LOG_KEEP)) await db.doc(`lab_inbox_log/${r.id}`).delete().catch(() => {});
  }
  loadLogs();

  /* ---------------- 拼单子 ---------------- */

  async function build(item) {
    const data = getData();
    if (item.kind === 'backfill') return buildBackfill(item, data);
    if (item.kind === 'newproblems' || item.kind === 'probe') return problemsMaterial(data, item, { docs: COMPONENT_DOCS });
    if (item.kind === 'prep') {
      const { prompt, ctx } = await planner.prepInput(item.ref, { sp: item.space });
      const block = data.curriculum.find((b) => b.id === item.ref);
      return { prompt: prepBrief({ prompt, block: item.ref, title: block?.title || item.title }), ctx };
    }
    return null;
  }

  async function buildBackfill(item, data) {
    const s = data.sessions.find((x) => x.id === item.ref);
    if (!s) return null;
    const scoped = scopeDb(db, s.id);
    const [turns, rep] = await Promise.all([
      scoped.collection('class_turns').get().then((x) => x.docs.map((d) => d.data()), () => []),
      scoped.doc('report/main').get().then((r) => (r.exists ? r.data() : null), () => null),
    ]);
    return backfillMaterial(data, s, { turns, rep });
  }

  /** 工作单变了（runSentry）：照它把单子同步好。收件箱第一遍做完再拼（别把教研室刚回答的那张单子先删了） */
  async function sync(items) {
    if (syncing) { again = items; return; }
    syncing = true;
    try {
      await Promise.race([firstDone, new Promise((r) => setTimeout(r, 8000))]);
      const have = new Map(docsOf(await db.collection('lab_brief').get().catch(() => null)).map((b) => [b.id, b]));
      const want = new Set();
      // 照工作单的顺序拼，每种最多 LAB_CAPS 张；拼不成的（那节课一轮记录都没存）不占名额，轮到下一件
      const n = {};
      for (const it of items || []) {
        if (!it || !(it.kind in LAB_CAPS) || (n[it.kind] || 0) >= LAB_CAPS[it.kind]) continue;
        const id = briefId(it);
        const src = srcOf(it, getData(), packs);
        if (empty.has(`${id}|${src}`)) continue;
        const old = have.get(id);
        if (old && old.src === src && old.v === LAB_VERSION) { want.add(id); n[it.kind] = (n[it.kind] || 0) + 1; continue; }
        let got = null;
        try { got = await build(it); } catch (err) { console.warn('教研室的单子没拼成', id, err?.message || err); }
        if (!got) { empty.add(`${id}|${src}`); continue; }
        if (bytesOf(got.prompt) > BRIEF_MAX) { reportError(`教研室的单子 ${id} 太大（${Math.round(bytesOf(got.prompt) / 1024)} KB），没写`, { what: '教研室', soft: true }); empty.add(`${id}|${src}`); continue; }
        assertWrite('page', 'lab_brief');
        // 一张没写成（太大被数据库拒了、网络断了）不挡着后面几张
        try { await db.doc(`lab_brief/${id}`).set(briefDoc(it, got, src)); } catch (err) { reportError(err, { what: '教研室的单子没写进去', path: `lab_brief/${id}`, soft: true }); empty.add(`${id}|${src}`); continue; }
        want.add(id);
        n[it.kind] = (n[it.kind] || 0) + 1;
      }
      // 工作单里没有了的（做完了、不用做了）：撤掉
      for (const id of have.keys()) if (!want.has(id)) await db.doc(`lab_brief/${id}`).delete().catch(() => {});
    } catch (err) {
      reportError(err, { what: '教研室的单子没同步成' });
    } finally {
      syncing = false;
      if (again) { const x = again; again = null; sync(x); }
    }
  }

  /* ---------------- 收回答 ---------------- */

  let inboxBusy = false;
  let inboxNext = null;
  const done = new Set();
  db.collection('lab_inbox').onSnapshot((s) => take(docsOf(s)), () => firstInbox());
  async function take(docs) {
    if (inboxBusy) { inboxNext = docs; return; }
    inboxBusy = true;
    try {
      for (const d of docs.filter((x) => !done.has(x.id)).sort((a, b) => (a.at || 0) - (b.at || 0))) {
        done.add(d.id);
        let r;
        try { r = await takeOne(d); } catch (err) { r = receipt({ inbox: d, result: 'error', notes: [String(err?.message || err)] }); reportError(err, { what: '教研室的回答没并进来', path: `lab_inbox/${d.id}` }); }
        assertWrite('page', 'lab_inbox_log');
        await db.doc(`lab_inbox_log/${d.id}`).set(r).catch(() => {});
        await db.doc(`lab_inbox/${d.id}`).delete().catch(() => {});
        await bump(r);
      }
    } finally {
      inboxBusy = false;
      firstInbox();
      if (docs.length) pruneLogs().then(loadLogs, loadLogs); else loadLogs();
      if (inboxNext) { const x = inboxNext; inboxNext = null; take(x); }
    }
  }

  async function bump(r) {
    try {
      const ref = db.doc('meta/lab');
      const cur = await ref.get().then((s) => (s.exists ? s.data() : {})).catch(() => ({}));
      const counts = { ...(cur.counts || {}) };
      counts[r.result] = (counts[r.result] || 0) + 1;
      await ref.set({ ...cur, counts, last: { kind: r.kind, ref: r.ref, result: r.result, at: r.at }, at: Date.now() });
    } catch { /* 计数没写成不要紧 */ }
  }

  async function takeOne(d) {
    const snap = await db.doc(`lab_brief/${d.brief}`).get().catch(() => null);
    const brief = snap?.exists ? { id: d.brief, ...snap.data() } : null;
    const chk = checkReply(d, brief);
    if (!chk.ok) return receipt({ inbox: d, brief, result: 'stale', notes: [chk.why] });
    const meta = { model: String(d.model || ''), at: Date.now() };
    let r;
    if (brief.kind === 'backfill') r = await takeBackfill(d, brief, meta);
    else if (brief.kind === 'newproblems' || brief.kind === 'probe') r = await takeProblems(d, brief, meta);
    else if (brief.kind === 'prep') r = await takePrep(d, brief, meta);
    else return receipt({ inbox: d, brief, result: 'error', notes: [`不认识的单子 ${brief.kind}`] });
    // 做完了的单子撤掉（下一次自检，工作单里它也就没了）；没收成的留着，教研室看了回执重做
    if (r.result === 'ok' || r.result === 'partial') await db.doc(`lab_brief/${brief.id}`).delete().catch(() => {});
    return r;
  }

  // 补收尾：小结（过守卫：引的原话要在记录里找得到；对不上先暂存）+ 整理单（memops.applyMemo，author: lab）
  async function takeBackfill(d, brief, meta) {
    const { session: sid, block, space } = brief.ctx || {};
    const got = parseBackfill(d.text, { parseOutput });
    if (got.problems.length && !got.summary) return receipt({ inbox: d, brief, result: 'error', notes: got.problems });
    const cur = await db.doc(`sessions/${sid}`).get().then((s) => (s.exists ? s.data() : null)).catch(() => null);
    if (!cur) return receipt({ inbox: d, brief, result: 'stale', notes: ['这节课已经删了'] });
    if (cur.summary) return receipt({ inbox: d, brief, result: 'stale', notes: ['这节课已经有小结了（课堂里写上了）'] });
    const turns = await scopeDb(db, sid).collection('class_turns').get().then((x) => x.docs.map((t) => t.data()), () => []);
    const evidence = (getData().evidence || []).filter((e) => e.session === sid);
    const corpus = buildCorpus({ turns, evidence });
    const took = { summary: 0, memo: 0 };
    const notes = [...got.problems];
    let held = 0;
    if (got.summary) {
      const id = `ob-${newId()}`;
      const doc = { kind: 'summary', text: got.summary.slice(0, 8000), about: [], session: sid, block: block || null, at: Date.now(), by: 'lab', backfill: true, lab: meta };
      const g = guardCandidate({ coll: 'observations', id, doc, author: 'lab', session: sid }, { mem: getData(), corpus });
      if (g.verdict !== 'accept') { const gl = guardLog(g, { coll: 'observations', id, session: sid, author: 'lab', line: '事后补写的小结' }); await db.doc(`guard_log/${gl.id}`).set(gl.doc).catch(() => {}); }
      if (g.verdict === 'reject') notes.push(`小结没收：${guardReason(g)}`);
      else if (g.verdict === 'hold') {
        // 对不上这节课的记录：先暂存，在「管理 → 自检 → 守卫」里我放行了才写进去
        const pd = pendingRecord({ kind: 'note', tier: 'direct', coll: 'observations', op: 'add', target: id, data: doc, label: '事后补写的小结', reason: '教研室' }, { session: sid, by: 'lab', line: '事后补写的小结' });
        const { id: pid, ...pdoc } = { ...pd, status: 'held', guard: guardMark(g) };
        await db.doc(`pending/${pid}`).set(pdoc);
        held++;
        notes.push(`小结先暂存了：${guardReason(g)}`);
      } else {
        assertWrite('page', 'observations');
        await db.doc(`observations/${id}`).set(g.verdict === 'flag' ? { ...doc, guard: guardMark(g) } : doc);
        await db.doc(`sessions/${sid}`).set({ ...cur, summary: id, backfilled: Date.now() });
        took.summary = 1;
      }
    }
    let rejected = got.errors.map((e) => ({ line: '', error: e }));
    if (got.entries.length) {
      const r = await ops.applyMemo(got.entries, { session: sid, block, space, turns, author: 'lab' });
      took.memo = r.pds.length;
      held += r.rejected.filter((x) => x.held).length;
      rejected = [...rejected, ...r.rejected.filter((x) => !x.held)];
    }
    const result = took.summary || took.memo ? (rejected.length || held ? 'partial' : 'ok') : 'error';
    return receipt({ inbox: d, brief, result, took, rejected, held, notes });
  }

  // 出新题：每道题先看写法（lab.js 的 problemLint）、和题库里的比（twinOf），再在页面上画一遍，有写法错误的不收
  async function takeProblems(d, brief, meta) {
    const { target, block, subject } = brief.ctx || {};
    const got = parseProblems(d.text, { brief: brief.id, block, target });
    const existing = (getData().drills || []).filter((x) => !String(x.id).startsWith(`d-lab-${brief.id}-`));
    const rejected = got.problems.map((p) => ({ line: '', error: p }));
    const kept = [];
    for (const it of got.items) {
      const errs = problemLint(it, { subject });
      const twin = twinOf(it, [...existing, ...kept.map((k) => ({ id: k.id, ...k.doc }))]);
      if (twin) errs.push(`和题库里的 ${twin.id} 几乎一样`);
      if (!errs.length) errs.push(...(await renderCheck(it.doc.md)));
      if (errs.length) { rejected.push({ line: `题 ${it.n}`, error: errs.join('；') }); continue; }
      kept.push(it);
    }
    assertWrite('page', 'drills');
    for (const it of kept) await db.doc(`drills/${it.id}`).set({ ...it.doc, lab: meta });
    const result = kept.length ? (rejected.length ? 'partial' : 'ok') : 'error';
    return receipt({ inbox: d, brief, result, took: { drills: kept.length }, rejected });
  }

  // 在页面上画一遍（藏在屏幕外面）：组件写法错误、取数自检不过都会进 session.problems；画完马上拿掉
  async function renderCheck(md) {
    if (typeof document === 'undefined') return [];
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;visibility:hidden;pointer-events:none';
    document.body.appendChild(host);
    const before = kitSession.problems.length;
    // 写坏的组件 render.js 会往控制台报一次错：这里本来就是在找错（收在 session.problems 里），不让它算成页面出错
    const err0 = console.error;
    console.error = () => {};
    try {
      renderLesson(String(md), host);
      await new Promise((r) => setTimeout(r, 60));
      return kitSession.problems.slice(before).filter((p) => !p.soft).map((p) => `写法错误：${p.msg}`).slice(0, 3);
    } catch (err) {
      return [`画不出来：${err?.message || err}`];
    } finally {
      console.error = err0;
      host.remove();
      kitSession.problems.splice(before);
    }
  }

  // 备课：这期间我自己已经备好了（资料包是新的、还没用过）就不盖
  async function takePrep(d, brief, meta) {
    const ctx = brief.ctx || {};
    const main = packs[ctx.sp]?.main;
    if (main && !main.usedBy && (main.at || 0) > (brief.at || 0)) return receipt({ inbox: d, brief, result: 'stale', notes: ['这一科已经备好课了'] });
    try {
      const m = await planner.prepFinish(d.text, ctx, { bytes: bytesOf(brief.prompt), model: meta.model, by: 'lab' });
      return receipt({ inbox: d, brief, result: 'ok', took: { pack: 1 }, notes: m.prepCheck?.length ? [`备课检查：${m.prepCheck.slice(0, 3).join('；')}`] : [] });
    } catch (err) {
      return receipt({ inbox: d, brief, result: 'error', notes: [String(err?.message || err)] });
    }
  }

  return { sync, briefs: () => briefs, logs: () => logs, take };
}


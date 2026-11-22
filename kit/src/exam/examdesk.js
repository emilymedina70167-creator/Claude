// 首页挂着的考试资料收件箱：开发那边写进 exam_inbox 的一条条记录，
// 页面照 inbox.js 的 planInbox 查过再并进去；整条不对的只写回执、不进库。照教材收件箱（books/bookview.js 的 takeInbox）的做法：
// 正在做时来了新快照接着做、出错的过一会儿重读一遍、并的时候屏幕别熄；一条一条做（一卷几十道题，同时写 20 条）。
// 回执 exam_inbox_log/{同号}，留最近 40 份；库里有几卷几题记在 meta/exam（照回执加，首页不为了计数读整类）。
// 首页挂着；课堂里开课 30 秒以后也挂一个轻的（startClassInbox：一批 5 条、不重算统计、不画东西，不在调用模型的路上）。
import { planInbox, touches, countsAfter, inboxSig, inboxProgress, receiptWhy } from './inbox.js';
import { assertWrite } from '../memory/schema.js';
import { PERMANENT } from '../memory/writer.js';
import { reportError as reportErr } from '../errlog.js';
import { loadExamCourse } from './load.js';
import { statsCache } from './stats.js';
import { readReserve } from './reserve.js';
import { EXAM_COURSES, subjectOfCourse } from './schema.js';
import { barOf, barsChanged } from './bar.js';
import { blockSyllabus } from './mapping.js';
import { staleProfiles, staleMaps, profileSrc } from './fresh.js';

/**
 * 首页的考情缓存（meta/exam 的 stats / blockPerYear，410 分的权重、考情页、体检、后方的工作单都读它）：一门课一门课按门课读
 * （不订阅、不读整类），算 statsCache。计数也照读到的重算（收件箱照回执加的会在写到一半出错、两台设备、从备份恢复时偏）。
 * 只在收件箱并进了东西、或者 meta/exam 比上次算的新时算（examdesk 管）
 */
export async function refreshStats(db, { curriculum = [], now = Date.now(), years = null } = {}) {
  // 留作模考的年份：读档案（3 秒读不到用默认）
  const reserve = years || await readReserve(db, new Date(now).toISOString().slice(0, 10));
  const stats = {};
  const blockPerYear = {};
  const blockUsable = {};
  // 卷面样本按科目代码合起来（408 一卷四门课）：{ 408: { 2015: [[块, 分, 题型]…] } }
  const paperRows = {};
  const papers = new Set();
  let questions = 0, syllabus = 0;
  for (const c of EXAM_COURSES) {
    const d = await loadExamCourse(db, c);
    syllabus += d.syllabus.length;
    for (const p of d.papers) papers.add(p.id);
    if (!d.questions.length) continue;
    questions += d.questions.length;
    stats[c] = statsCache({ course: c, questions: d.questions, syllabus: d.syllabus, curriculum, years: reserve });
    // 后方的工作单要的（教研室重写画像、重挂映射）：过时的画像按热度排，映射过时的，题的标题和上游指纹
    const heatRank = new Map(stats[c].heat.map((h, i) => [h.id, i]));
    const sp = staleProfiles(d.profiles, d.questions, d.syllabus, reserve).sort((a, b) => (heatRank.get(a) ?? 99) - (heatRank.get(b) ?? 99));
    stats[c].stale = { profiles: sp.slice(0, 20), maps: staleMaps(d.syllabus, curriculum).slice(0, 40) };
    stats[c].titles = Object.fromEntries(d.syllabus.filter((n) => sp.includes(n.id)).map((n) => [n.id, n.title]));
    stats[c].srcs = Object.fromEntries(sp.slice(0, 20).map((id) => [id, profileSrc(id, d.questions, reserve)]));
    // 体检要的：答案没核过的（verified.how 是 none）、画像过时的个数
    stats[c].unverified = d.questions.filter((q) => q.verified?.how === 'none').length;
    Object.assign(blockPerYear, stats[c].blockPerYear);
    Object.assign(blockUsable, stats[c].blockUsable);
    const code = subjectOfCourse(c);
    for (const [y, rows] of Object.entries(stats[c].papers || {})) ((paperRows[code] ||= {})[y] ||= []).push(...rows);
    delete stats[c].papers;
  }
  const meta = await db.doc('meta/exam').get().then((x) => (x?.exists ? x.data() : {})).catch(() => ({}));
  const next = { ...meta, counts: { ...(meta.counts || {}), papers: papers.size, questions, syllabus }, stats, blockPerYear, blockUsable, papers: paperRows, statsAt: now };
  await db.doc('meta/exam').set(next);
  return next;
}

export const LOG_KEEP = 40;
const PARALLEL = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SUBJECT_COURSES = { 408: ['DS', 'CO', 'OS', 'CN'], 301: ['LA', 'HM', 'PS'], 201: ['EN'], 101: ['PO'] };
/**
 * 真题级的缓存（exam_bar，每块一条）：证据里有带 exam= / like= 的作答时，读那几门课的考试资料（按门课），
 * 每块挂着的真题照 bar.js 算一遍，和现在存着的比，变了才写。返回 { wrote: [块] }
 */
export async function refreshBars(db, { evidence = [], bars = [], now = Date.now() } = {}) {
  const ids = [...new Set(evidence.flatMap((e) => [e?.exam, e?.like]).filter(Boolean))];
  if (!ids.length) return { wrote: [] };
  const courses = [...new Set(ids.flatMap((id) => SUBJECT_COURSES[String(id).match(/^Q-(\d{3})-/)?.[1]] || []))];
  const have = new Map(bars.map((b) => [b.id, b]));
  const wrote = [];
  for (const c of courses) {
    const d = await loadExamCourse(db, c);
    for (const [block, syl] of blockSyllabus(d.syllabus)) {
      const set = new Set(syl);
      const questions = d.questions.filter((q) => (q.tags?.syl || []).some((s) => set.has(s)));
      if (!questions.length) continue;
      const prev = have.get(block) || null;
      const next = barOf({ block, questions, evidence, prev, now });
      if (!next.done.length && !prev) continue;
      const { id: _, ...old } = prev || {};
      if (!barsChanged(prev ? old : null, next)) continue;
      assertWrite('page', 'exam_bar');
      await db.doc(`exam_bar/${block}`).set(next);
      wrote.push(block);
    }
  }
  return { wrote };
}

// 一份试满几轮还写不进去就先停下（写明哪一份为什么，等下次打开首页再试）：以前出错的过 10 秒再读一遍、一直试下去，
// 错误还被吞掉——学生看不到、出错记录里也没有
export const INBOX_TRIES = 2;
const why = (err) => `没写进数据库：${String(err?.message || err?.code || err || '').slice(0, 200)}`;

// 课堂里接着并（2026-11-15：学生的习惯是打开首页就进课堂，只在首页并，37 份只并进了第一份）：开课 30 秒以后，
// 一次一份、一批只写 5 条（首页 20 条），不重算考情的统计（refreshStats 要读整门课的题；回到首页由 maybeRefresh 补），
// 不看回执、不画那一行。不在调用模型的路上，也不往说明里加东西
export const CLASS_INBOX = { parallel: 5, stats: false, logs: false };
export const CLASS_INBOX_WAIT = 30000;
/** 课堂里等多久开始并：?dev&examwait=1 是 1 秒（e2e 用），别的时候 30 秒 */
export function classInboxWait(search = '', dev = false) {
  const raw = new URLSearchParams(String(search || '')).get('examwait');
  return dev && raw !== null && raw !== '' && Number(raw) >= 0 ? Number(raw) * 1000 : CLASS_INBOX_WAIT;
}
/** 课堂页面里开一个（黑板课、舞台课、一问一答；只读翻看、练一练不开）：等 wait 毫秒再挂，返回停下的函数 */
export function startClassInbox({ db, wait = CLASS_INBOX_WAIT, ...opts } = {}) {
  let box = null;
  let gone = false;
  const t = setTimeout(() => { if (!gone) box = createExamInbox({ db, ...CLASS_INBOX, ...opts }); }, wait);
  return () => { gone = true; clearTimeout(t); box?.stop(); };
}

/**
 * 首页挂着的收件箱（课堂里也挂，见 startClassInbox）。onChange：进度变了叫一声（首页重画那一行，见 progress）；
 * reportError：出错记进出错记录（测试里换成假的）；again：有出错的过多久再读一遍收件箱；
 * parallel：一批同时写几条；stats：并进了东西要不要重算考情的统计；logs：要不要看回执（整份不收的，刷新以后、别的设备并的也列得出来）
 */
export function createExamInbox({ db, waits = [1200, 2400, 3600, 4800], curriculum = () => [], onChange = () => {}, reportError = reportErr, again = 10000, parallel = PARALLEL, stats = true, logs = true } = {}) {
  let busy = false;
  let latest = null;
  let stopped = false;
  let tookOk = false;
  // 这次打开处理过的（写了回执的、试满几轮放弃的）：id → { why: 没并进去的原因（并进去了是 ''）, sig: 那时原件的样子 }。
  // 同一个编号的原件换了（改好重新放进来的）就当新的一份再并
  const done = new Map();
  const tries = new Map();
  // 收件箱里现在有的（最近一次快照）：id → sig；别的设备并掉的不算进总数
  let present = new Map();
  let current = null; // 正在并的那一份：删原件触发的快照先把它拿掉，总数别跳一下
  let receipts = []; // 回执里整份不收的（logs 开着才读）
  const changed = () => { try { onChange(); } catch { /* 首页重画出错别打断并入 */ } };
  const settled = (d) => done.has(d.id) && done.get(d.id).sig === inboxSig(d);
  let lock = null;
  const awake = async () => { try { if (!lock && typeof document !== 'undefined' && document.visibilityState === 'visible') lock = await navigator.wakeLock?.request?.('screen'); } catch { lock = null; } };
  const sleepOk = () => { try { lock?.release?.(); } catch { /* */ } lock = null; };
  // 网络抖、被限流的重试；没权限、写法不对这类重试也没用的直接抛（不然一份要白等十几秒）
  async function retry(fn) {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= waits.length || PERMANENT.has(String(e?.code || ''))) throw e; await sleep(waits[i]); }
    }
  }
  const docsOf = (snap) => (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
  const write = (path, data) => { assertWrite('page', path.split('/')[0]); return retry(() => db.doc(path).set(data)); };

  async function readHave(rec) {
    const have = new Map();
    const paths = touches(rec);
    for (let i = 0; i < paths.length; i += parallel) {
      await Promise.all(paths.slice(i, i + parallel).map(async (p) => {
        const s = await retry(() => db.doc(p).get());
        if (s?.exists) have.set(p, s.data());
      }));
    }
    return have;
  }
  // 标签记录要核考点：读这几道题所在门课的考点树（按门课 where 读，不读整类）
  async function syllabusIdsFor(have, rec) {
    // 题现在的门课，加上标签里考点的门课（数学一的题先猜成高数，标签挂的可能是线代）
    const fromTags = Object.values(rec.tags || {}).flatMap((t) => (t?.syl || []).map((x) => String(x).match(/^G-([A-Z]{2})-/)?.[1]));
    const courses = [...new Set([...[...have.values()].map((q) => q.course), ...fromTags].filter(Boolean))];
    const ids = new Set();
    for (const c of courses) for (const d of docsOf(await retry(() => db.collection('syllabus').where('course', '==', c).get()))) ids.add(d.id);
    return ids;
  }

  async function takeOne(d) {
    const { id, ...rec } = d;
    const have = await readHave(rec);
    // 重切大纲：这门课库里已有的考点都读进来（找出这一份里没有了的，标作废）
    if (rec.kind === 'syllabus' && rec.course) for (const x of docsOf(await retry(() => db.collection('syllabus').where('course', '==', rec.course).get()))) { const { id: xid, ...d } = x; if (!have.has(`syllabus/${xid}`)) have.set(`syllabus/${xid}`, d); }
    const syllabusIds = rec.kind === 'tags' ? await syllabusIdsFor(have, rec) : null;
    const at = Date.now();
    const years = rec.kind === 'drills' ? await readReserve(db, new Date(at).toISOString().slice(0, 10)) : [];
    const { writes, log } = planInbox(rec, { have, at, syllabusIds, years });
    for (let i = 0; i < writes.length; i += parallel) await Promise.all(writes.slice(i, i + parallel).map((w) => write(w.path, w.data)));
    await write(`exam_inbox_log/${id}`, { ...log, src: id });
    if (log.ok) {
      const meta = await retry(() => db.doc('meta/exam').get()).then((s) => (s?.exists ? s.data() : null)).catch(() => null);
      // 计数写不进去不挡这一份（回执写了、库里有了），但要让人知道：首页重算统计时会照读到的改对
      await retry(() => db.doc('meta/exam').set(countsAfter(meta, log, at))).catch((err) => reportError(err, { what: 'exam-inbox：计数没写进 meta/exam', path: id }));
    }
    await retry(() => db.doc(`exam_inbox/${id}`).delete());
    // 不合规矩的整份不收：回执写了原因，首页那一行也列出来（不是出错，不进出错记录）
    done.set(id, { why: log.ok ? '' : receiptWhy(log), sig: inboxSig(d) });
    tries.delete(id);
    if (log.ok) tookOk = true;
  }
  // 回执只留最近 40 份
  async function trimLogs() {
    const logs = docsOf(await db.collection('exam_inbox_log').get().catch(() => null)).sort((a, b) => (b.at || 0) - (a.at || 0));
    for (const l of logs.slice(LOG_KEEP)) await db.doc(`exam_inbox_log/${l.id}`).delete().catch(() => {});
  }

  async function take(docs) {
    if (stopped) return;
    present = new Map(docs.map((d) => [d.id, inboxSig(d)]));
    changed();
    if (busy) { latest = docs; return; }
    const todo = docs.filter((d) => !settled(d));
    if (!todo.length) return;
    busy = true;
    changed();
    awake();
    let failed = false;
    // 这一轮出过错的不在同一轮里接着试（来了新快照也不）：等 again 以后那一次，网络抖的时候不至于两下就放弃
    const failedNow = new Set();
    try {
      let list = todo;
      while (list?.length) {
        for (const d of list.sort((a, b) => (a.id < b.id ? -1 : 1))) {
          if (stopped) return;
          if (settled(d) || failedNow.has(d.id)) continue;
          // 换过的原件（重新放进来的）从头算几轮
          if (done.has(d.id)) { done.delete(d.id); tries.delete(d.id); }
          current = d.id;
          changed();
          try { await takeOne(d); } catch (err) {
            // 以前这里什么都不做（catch { failed = true; }）：错误不进出错记录，学生在首页也看不到
            reportError(err, { what: 'exam-inbox', path: d.id });
            const n = (tries.get(d.id) || 0) + 1;
            tries.set(d.id, n);
            failedNow.add(d.id);
            if (n >= INBOX_TRIES) done.set(d.id, { why: why(err), sig: inboxSig(d) }); else failed = true;
          }
          current = null;
          changed();
        }
        list = latest?.filter((d) => !settled(d) && !failedNow.has(d.id));
        latest = null;
      }
      await trimLogs();
      if (tookOk && stats) { tookOk = false; await refreshStats(db, { curriculum: curriculum() }).catch(() => {}); }
    } finally {
      busy = false;
      current = null;
      sleepOk();
      changed();
      // 有出错的（被限流、网络抖）：过一会儿重新读一遍收件箱接着做（试满 INBOX_TRIES 轮的不再试）
      if (failed && !stopped) setTimeout(() => { if (!stopped) db.collection('exam_inbox').get().then((s) => take(docsOf(s)), () => {}); }, again);
    }
  }
  /** 首页那一行要的（exam/inbox.js 的 inboxProgress 算、inboxRow 写成字）：{ total, done, busy, failed: [{ id, why }] } */
  const progress = () => inboxProgress({ present, done, current, busy, logs: receipts });
  const unsub = db.collection('exam_inbox').onSnapshot((s) => take(docsOf(s)), () => {});
  // 回执（最多 LOG_KEEP 份，小）：整份不收的那几份刷新以后、别的设备并的也要列得出来；后来同号并成了的回执盖掉了它，就不再列
  const unlog = logs ? db.collection('exam_inbox_log').onSnapshot((s) => { receipts = docsOf(s).filter((l) => l.ok === false); changed(); }, () => {}) : null;
  // 课程地图读到以后看一眼：缓存比上次并收件箱旧（别的设备并的、从备份恢复的）就重算一遍
  let checked = false;
  async function maybeRefresh() {
    if (checked || stopped) return;
    checked = true;
    const m = await db.doc('meta/exam').get().then((x) => (x?.exists ? x.data() : null)).catch(() => null);
    if (m && (!m.statsAt || (m.at || 0) > m.statsAt)) await refreshStats(db, { curriculum: curriculum() }).catch(() => {});
  }
  return { stop() { stopped = true; try { unsub?.(); unlog?.(); } catch { /* */ } }, progress, maybeRefresh, refresh: () => refreshStats(db, { curriculum: curriculum() }) };
}

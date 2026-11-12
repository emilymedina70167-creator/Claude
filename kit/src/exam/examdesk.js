// 首页挂着的考试资料收件箱（docs/exam-plan.md 1.2、第二节第 7 步）：开发那边写进 exam_inbox 的一条条记录，
// 页面照 inbox.js 的 planInbox 查过再并进去；整条不对的只写回执、不进库。照教材收件箱（books/bookview.js 的 takeInbox）的做法：
// 正在做时来了新快照接着做、出错的过一会儿重读一遍、并的时候屏幕别熄；一条一条做（一卷几十道题，同时写 20 条）。
// 回执 exam_inbox_log/{同号}，留最近 40 份；库里有几卷几题记在 meta/exam（照回执加，首页不为了计数读整类）。
// 只挂在首页，课堂里不挂（不碰上课的速度）。
import { planInbox, touches, countsAfter } from './inbox.js';
import { assertWrite } from '../memory/schema.js';

export const LOG_KEEP = 40;
const PARALLEL = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createExamInbox({ db, waits = [1200, 2400, 3600, 4800] } = {}) {
  let busy = false;
  let latest = null;
  let stopped = false;
  const done = new Set();
  let lock = null;
  const awake = async () => { try { if (!lock && typeof document !== 'undefined' && document.visibilityState === 'visible') lock = await navigator.wakeLock?.request?.('screen'); } catch { lock = null; } };
  const sleepOk = () => { try { lock?.release?.(); } catch { /* */ } lock = null; };
  async function retry(fn) {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= waits.length) throw e; await sleep(waits[i]); }
    }
  }
  const docsOf = (snap) => (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
  const write = (path, data) => { assertWrite('page', path.split('/')[0]); return retry(() => db.doc(path).set(data)); };

  async function readHave(rec) {
    const have = new Map();
    const paths = touches(rec);
    for (let i = 0; i < paths.length; i += PARALLEL) {
      await Promise.all(paths.slice(i, i + PARALLEL).map(async (p) => {
        const s = await retry(() => db.doc(p).get());
        if (s?.exists) have.set(p, s.data());
      }));
    }
    return have;
  }
  // 标签记录要核考点：读这几道题所在门课的考点树（按门课 where 读，不读整类）
  async function syllabusIdsFor(have) {
    const courses = [...new Set([...have.values()].map((q) => q.course).filter(Boolean))];
    const ids = new Set();
    for (const c of courses) for (const d of docsOf(await retry(() => db.collection('syllabus').where('course', '==', c).get()))) ids.add(d.id);
    return ids;
  }

  async function takeOne(d) {
    const { id, ...rec } = d;
    const have = await readHave(rec);
    const syllabusIds = rec.kind === 'tags' ? await syllabusIdsFor(have) : null;
    const at = Date.now();
    const { writes, log } = planInbox(rec, { have, at, syllabusIds });
    for (let i = 0; i < writes.length; i += PARALLEL) await Promise.all(writes.slice(i, i + PARALLEL).map((w) => write(w.path, w.data)));
    await write(`exam_inbox_log/${id}`, { ...log, src: id });
    if (log.ok) {
      const meta = await retry(() => db.doc('meta/exam').get()).then((s) => (s?.exists ? s.data() : null)).catch(() => null);
      await retry(() => db.doc('meta/exam').set(countsAfter(meta, log, at))).catch(() => {});
    }
    await retry(() => db.doc(`exam_inbox/${id}`).delete());
    done.add(id);
  }
  // 回执只留最近 40 份
  async function trimLogs() {
    const logs = docsOf(await db.collection('exam_inbox_log').get().catch(() => null)).sort((a, b) => (b.at || 0) - (a.at || 0));
    for (const l of logs.slice(LOG_KEEP)) await db.doc(`exam_inbox_log/${l.id}`).delete().catch(() => {});
  }

  async function take(docs) {
    if (stopped) return;
    if (busy) { latest = docs; return; }
    const todo = docs.filter((d) => !done.has(d.id));
    if (!todo.length) return;
    busy = true;
    awake();
    let failed = false;
    try {
      let list = todo;
      while (list?.length) {
        for (const d of list.sort((a, b) => (a.id < b.id ? -1 : 1))) {
          if (stopped) return;
          if (done.has(d.id)) continue;
          try { await takeOne(d); } catch { failed = true; }
        }
        list = latest?.filter((d) => !done.has(d.id));
        latest = null;
      }
      await trimLogs();
    } finally {
      busy = false;
      sleepOk();
      // 有出错的（被限流、网络抖）：过一会儿重新读一遍收件箱接着做
      if (failed && !stopped) setTimeout(() => { db.collection('exam_inbox').get().then((s) => take(docsOf(s)), () => {}); }, 10000);
    }
  }
  const unsub = db.collection('exam_inbox').onSnapshot((s) => take(docsOf(s)), () => {});
  return { stop() { stopped = true; try { unsub?.(); } catch { /* */ } } };
}

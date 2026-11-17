// 隔天再验的题：这里仅按记录挑题、拼材料和算结果，不替老师宣布学会了。
import { toDate } from './schema.js';
import { aimsSummary, STATUS_TEXT } from '../class/aims.js';

export const HOLD_MAX = 4;
export const HOLD_DAY = 1;
export const HOLD_LATE = 3;

/**
 * 隔天验哪几件事：这节课现在的，加上课上被老师换掉的（aimsPast，编号换成 p1、p2……免得和现在的撞）。
 * 有作答的排前面（真练过的先验），再是只讲了没做的。report：课后报告（里面有每件的状态）；没有就照原来的先后
 */
export function holdAims(session = {}, report = null) {
  const st = (list, a, i) => (Array.isArray(list) ? list[i]?.status : '') || 'none';
  const past = (Array.isArray(session.aimsPast) ? session.aimsPast : []).map((a, i) => ({ ...a, id: `p${i + 1}`, status: st(report?.aimsPast, a, i) }));
  const cur = (Array.isArray(session.aims) ? session.aims : []).map((a, i) => ({ ...a, status: st(report?.aims, a, i) }));
  const rank = (a) => (a.status && a.status !== 'none' ? 0 : 1);
  return [...past, ...cur].map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map(({ a }) => { const { status, until, ...rest } = a; return rest; });
}

// 下课后页面自动挑真题、请 Opus 出留题（needsHolds / pickHolds / holdBrief / holdDocs）第十四轮搬进了 archive/：
// 留不留、留什么由项目 Claude 定（写 drills 和 sessions.holds）；这里只剩到期、交了以后算结果、写给老师看的几行。

const daysSince = (session, today) => {
  const day = toDate(session.endedAt || session.startedAt || session.date || session.holds?.at);
  return Math.max(0, Math.floor((Date.parse(today) - Date.parse(day)) / 86400000) || 0);
};
export function holdState(session = {}, today) {
  if (!session.holds?.ids?.length) return 'none';
  if (session.later) return 'done';
  const days = daysSince(session, today);
  return days >= HOLD_LATE ? 'late' : days >= HOLD_DAY ? 'due' : 'wait';
}

export function laterOf(rows, { session, drills = [], today } = {}) {
  const ids = new Set(session.holds?.ids || []);
  const seen = new Set();
  const mine = rows.filter(r => ids.has(r.id) && !seen.has(r.id) && seen.add(r.id) && !['skip', 'open'].includes(r.outcome));
  const far = mine.filter(r => drills.find(d => d.id === r.id)?.far === true);
  const right = rs => rs.filter(r => r.outcome === 'first').length;
  // 按「要拿下的事」分开数：下一节的老师要知道是哪一件隔天没撑住，总数说不出来（drills 的 aim 是出题时针对的那件）
  const aims = {};
  for (const r of mine) {
    // 只认这节课自己出的留题（hold 是这节课）：别处来的题身上的 aim 不是这节课的编号
    const d = drills.find(d => d.id === r.id);
    const aim = d?.hold === session.id ? d.aim : '';
    if (!aim) continue;
    const a = (aims[aim] ??= { n: 0, right: 0 });
    a.n += 1;
    if (r.outcome === 'first') a.right += 1;
  }
  return { n: mine.length, right: right(mine), days: daysSince(session, today), far: { n: far.length, right: right(far) }, ...(Object.keys(aims).length ? { aims } : {}) };
}

/** 课后只认完整的一次独立测验；跳过或退出的留到下次，不把半份成绩说成整节课的结果。 */
const laterWrites = new WeakMap();
export function writeLater(db, drillDoc, rows, options = {}) {
  if (!drillDoc?.hold) return Promise.resolve();
  let queue = laterWrites.get(db);
  if (!queue) { queue = new Map(); laterWrites.set(db, queue); }
  const key = drillDoc.hold;
  const next = (queue.get(key) || Promise.resolve()).catch(() => {}).then(() => saveLater(db, drillDoc, rows, options));
  queue.set(key, next);
  next.finally(() => { if (queue.get(key) === next) queue.delete(key); }).catch(() => {});
  return next;
}
async function saveLater(db, drillDoc, rows, { drills = [], today } = {}) {
  if (!drillDoc?.hold) return;
  const ref = db.doc(`sessions/${drillDoc.hold}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  const session = snap.data();
  if (Object.hasOwn(session, 'later')) return;
  const result = laterOf(rows, { session, drills, today });
  if (!result.n || result.n !== new Set(session.holds?.ids || []).size) return;
  await ref.update({ later: { ...result, at: Date.now(), drill: drillDoc.id } });
}

export function laterLine(later) {
  if (!later?.n) return '';
  return `隔 ${later.days} 天做没见过的题：${later.n} 道对 ${later.right} 道${later.far?.n ? `（要迁移的 ${later.far.n} 道对 ${later.far.right} 道）` : ''}`;
}

/**
 * 给下一节课的老师看的隔天验（开课时页面替它取的「以前的课」、memory_read 取 sessions 都用它）：
 * 验完了写结果，按要拿下的事逐件写几道对几道；留了题还没做也照实说，免得把「没验」读成「没问题」。
 * 只写页面数出来的事实，不写该怎么教
 */
export function laterBrief(session = {}) {
  const ids = session?.holds?.ids || [];
  if (!session?.later?.n) return ids.length ? `留了 ${ids.length} 道没见过的题隔天验，学生还没做完` : '';
  const named = new Map(holdAims(session).map(a => [a.id, a.can]));
  const per = Object.entries(session.later.aims || {}).map(([id, x]) => `  - ${named.get(id) || id}：${x.n} 道对 ${x.right} 道`);
  return [`${laterLine(session.later)}（一次就对的才算对）`, ...per].join('\n');
}

export function aimLines(session, report = null) {
  const aims = report?.aims || aimsSummary(session?.aims, report?.items || []);
  return aims.map(a => `${a.can}：${STATUS_TEXT[a.status] || STATUS_TEXT.none}`);
}

export function dueHolds(sessions = [], today) {
  return sessions.filter(s => ['due', 'late'].includes(holdState(s, today))).sort((a, b) => (a.endedAt || a.startedAt || 0) - (b.endedAt || b.startedAt || 0));
}

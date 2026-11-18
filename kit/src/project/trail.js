// 每一步都有记录、每一条都被分析（dr-learning-trail T3）：外部主讲分析到哪了（meta/cursor-{科}），
// 那以后这一科还有哪些证据没分析（meta/since-analysis-{科}，一次 get 读完）。只算、不下结论。纯函数，tests/project-trail.test.js
import { spaceOfId } from '../memory/space.js';
import { toDate } from '../memory/schema.js';

export const SPACES = ['math', 'cs', 'en'];
export const cursorId = (space) => `cursor-${space}`;
export const sinceId = (space) => `since-analysis-${space}`;
export const TRAIL_MAX = 200 * 1024; // since-analysis 一份最多多大（字节）：再多照实写还有几条没放下

/** 一条证据是哪一科：挂的块；没挂块看那节课；都没有算数学 */
export function spaceOfEvidence(ev, sessionsById = new Map()) {
  if (ev?.space && SPACES.includes(ev.space)) return ev.space;
  if (ev?.block) { try { return spaceOfId(ev.block); } catch { /* */ } }
  const s = ev?.session ? sessionsById.get(ev.session) : null;
  if (s?.space && SPACES.includes(s.space)) return s.space;
  if (s?.block) { try { return spaceOfId(s.block); } catch { /* */ } }
  return 'math';
}

const clip = (t, n) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const okText = (ok) => (ok === true ? '对' : ok === false ? '错' : '没判');
const hhmm = (at) => { const d = new Date(Number(at) || 0); return `${toDate(Number(at) || 0)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** 一条证据写成一行（给外部读，不是给学生看的） */
export function evidenceLine(ev, { sessionTitle = '' } = {}) {
  const where = [ev.session ? `${ev.session}${sessionTitle ? `「${clip(sessionTitle, 20)}」` : ''}` : '', ev.block || '', ev.comp || ''].filter(Boolean).join(' · ');
  const head = `${hhmm(ev.at)}${where ? ` [${where}]` : ''}`;
  const val = ev.value !== undefined && ev.value !== null && ev.value !== '' ? ` 填了「${clip(typeof ev.value === 'string' ? ev.value : JSON.stringify(ev.value), 120)}」` : '';
  switch (ev.src) {
    case 'record': return `${head} 作答 ${ev.kind || ''}${ev.q ? `「${clip(ev.q, 80)}」` : ''}${val}（${okText(ev.ok)}${ev.attempts ? `，第 ${ev.attempts} 次` : ''}${ev.giveup ? '，放弃了' : ''}${ev.revealed ? '，看了答案' : ''}）${ev.misread ? ` 像是：${clip(ev.misread, 80)}` : ''}${ev.text ? ` 写的：${clip(ev.text, 200)}` : ''}`;
    case 'event': return `${head} 动作 ${ev.kind || ev.type || ''}${ev.text || ev.detail?.text ? `：${clip(ev.text || ev.detail.text, 200)}` : ''}`;
    case 'say': return `${head} 学生${ev.via === 'chat' ? '在对话里' : ''}说：${clip(ev.text, 400) || '（只有图）'}${ev.images?.length ? `（附图 ${ev.images.length} 张：${ev.images.join('、')}）` : ''}`;
    case 'helper': return `${head} 页面里的 Claude（${{ helper: '外部叫来的助手', coach: '板边助教', teacher: '页面里的老师' }[ev.role] || ev.role || '助手'}）说：${clip(ev.text, 400)}${ev.did?.length ? `；执行了 ${ev.did.join('、')}` : ''}`;
    case 'draft': return `${head} 下课时没交的草稿：${clip(ev.text, 300)}`;
    case 'manual': return `${head} 补记：${clip(ev.text || ev.note, 400)}`;
    case 'recall': return `${head} 要记的「${clip(ev.q, 60)}」：${ev.rate || ev.result || ''}`;
    default: return `${head} ${ev.src || '证据'} ${ev.kind || ''}${ev.text ? `：${clip(ev.text, 300)}` : ''}`;
  }
}

/**
 * meta/since-analysis-{科}：游标（cursor.at）以后这一科的全部证据，按先后一条一行。
 * 返回 { space, at, from, n, shown, more, text }
 */
export function sinceAnalysis({ evidence = [], sessions = [], cursor = null, space = 'math', at = Date.now(), max = TRAIL_MAX } = {}) {
  const byId = new Map((sessions || []).map((s) => [s.id, s]));
  const from = Number(cursor?.at) || 0;
  const list = (evidence || []).filter((e) => e && Number(e.at) > from && spaceOfEvidence(e, byId) === space).sort((a, b) => Number(a.at) - Number(b.at));
  const lines = [];
  let bytes = 0, shown = 0;
  for (const e of list) {
    const l = evidenceLine(e, { sessionTitle: byId.get(e.session)?.title || '' });
    const b = new TextEncoder().encode(l).length + 1;
    if (bytes + b > max) break;
    lines.push(`${e.id}　${l}`);
    bytes += b;
    shown++;
  }
  const head = from ? `上次分析（${hhmm(from)}）以后这一科的证据 ${list.length} 条` : `这一科还没有分析游标（meta/${cursorId(space)}）：全部证据 ${list.length} 条`;
  const more = list.length - shown;
  return { space, at, from, n: list.length, shown, more, text: [`${head}${more ? `；放下了前 ${shown} 条，还有 ${more} 条没放下（分析完这些、把游标挪到最后一条的时刻，再读一次）` : ''}。`, ...lines].join('\n') };
}

/** 开场简报最前面的一行（T3） */
export function cursorLine({ cursor = null, n = 0, space = 'math' } = {}) {
  if (!cursor?.at) return `分析游标：这一科还没有（meta/${cursorId(space)}）；证据 ${n} 条都没分析过，全文在 meta/${sinceId(space)}。`;
  return n ? `分析游标：上次分析（${toDate(Number(cursor.at))}）以后这一科还有 ${n} 条证据没分析，全文在 meta/${sinceId(space)}。` : `分析游标：上次分析（${toDate(Number(cursor.at))}）以后这一科没有新的证据。`;
}

/** memcheck 3：笔记本「现状/总览.md」是几天前写的（超过 7 天写该重写了） */
export const SNAPSHOT_PATH = '现状/总览.md';
export function snapshotLine(notes = [], today = toDate(Date.now())) {
  const n = (notes || []).find((x) => x && !x.deleted && (x.path === SNAPSHOT_PATH || x.id === SNAPSHOT_PATH));
  if (!n) return `现状快照：笔记本里还没有「${SNAPSHOT_PATH}」。`;
  const at = Number(n.at || n.updatedAt || n.updated || 0);
  if (!at) return `现状快照：笔记本「${SNAPSHOT_PATH}」没写时间。`;
  const days = Math.max(0, Math.round((Date.parse(`${today}T00:00:00+08:00`) - Date.parse(`${toDate(at)}T00:00:00+08:00`)) / 86400000));
  return `现状快照：笔记本「${SNAPSHOT_PATH}」是 ${days} 天前（${toDate(at)}）写的${days > 7 ? '，该重写了' : ''}。`;
}

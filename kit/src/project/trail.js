// 每一步都有记录、每一条都被分析（dr-learning-trail T3）：外部主讲分析到哪了（meta/cursor-{科}），
// 那以后这一科还有哪些证据没分析（meta/since-analysis-{科}，一次 get 读完）。只算、不下结论。纯函数，tests/project-trail.test.js
import { spaceOfId } from '../memory/space.js';
import { toDate } from '../memory/schema.js';
import { checkLine } from '../check/record.js';

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

// 一道题用了多久（dr-batch4 第 4 条）：ms 是出现在屏幕上到第一次交，msTotal 到这一次交（切走、锁屏、翻到别的板不算）
const secs = (ms) => { const s = Math.round(Number(ms) / 1000); return s >= 60 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${s} 秒`; };
export function timeText(ev) {
  const a = Number(ev?.ms), b = Number(ev?.msTotal);
  if (!(a > 0) && !(b > 0)) return '';
  return `，用时${a > 0 ? ` 首次 ${secs(a)}` : ''}${b > 0 && Math.abs(b - a) >= 1000 ? `${a > 0 ? '、' : ' '}到这次 ${secs(b)}` : ''}`;
}
// 书上的题的书名题号（和 memory/bookq.js 的 bookLabel 同一种写法；这里不 import 它，免得 trail.js 拖进学习台的模块）
const bookLine = (b = {}) => [String(b.title || '').replace(/^张宇\s*/, ''), b.part, b.subject, b.ch ? `第 ${b.ch} 章` : '', b.no ? `第 ${b.no} 题` : ''].filter(Boolean).join(' ');

/** 一条证据写成一行（给外部读，不是给学生看的） */
export function evidenceLine(ev, { sessionTitle = '' } = {}) {
  const where = [ev.session ? `${ev.session}${sessionTitle ? `「${clip(sessionTitle, 20)}」` : ''}` : '', ev.block || '', ev.comp || ''].filter(Boolean).join(' · ');
  const head = `${hhmm(ev.at)}${where ? ` [${where}]` : ''}`;
  const val = ev.value !== undefined && ev.value !== null && ev.value !== '' ? ` 填了「${clip(typeof ev.value === 'string' ? ev.value : JSON.stringify(ev.value), 120)}」` : '';
  const took = timeText(ev);
  switch (ev.src) {
    // 解答题（dr-batch4 第 1 条）：交了整道题、判了以后逐步的结论（「第 3 步 规则用错：…」）
    case 'record': if (ev.kind === 'solve') return ev.judged ? `${head} 解答题判定（${{ helper: '页面里的 Claude', teacher: '老师' }[ev.by] || '主讲'}）：${clip(ev.value, 400) || '（空）'}${ev.ok === true ? '（整道题对）' : ''}` : `${head} 交了解答题${ev.q ? `「${clip(ev.q, 80)}」` : ''}：${ev.value ? `打字「${clip(ev.value, 200)}」` : ''}${ev.photos?.length || ev.images?.length ? `${ev.value ? '；' : ''}照片 ${(ev.photos || ev.images).length} 张（${(ev.photos || ev.images).join('、')}）` : ''}${took}`;
      return `${head} 作答 ${ev.kind || ''}${ev.q ? `「${clip(ev.q, 80)}」` : ''}${val}（${okText(ev.ok)}${ev.attempts ? `，第 ${ev.attempts} 次` : ''}${ev.giveup ? '，放弃了' : ''}${ev.revealed ? '，看了答案' : ''}）${ev.misread ? ` 像是：${clip(ev.misread, 80)}` : ''}${ev.text ? ` 写的：${clip(ev.text, 200)}` : ''}${took}`;
    // 书上的题（dr-batch4 第 2 条）：「1000 题 基础篇 线代 第 2 章 第 15 题：错」
    case 'book': return `${head} 书上的题 ${bookLine(ev.book)}：${ev.verdict || okText(ev.ok)}${ev.text ? ` 写的：${clip(ev.text, 200)}` : ''}${ev.images?.length ? `（照片 ${ev.images.length} 张：${ev.images.join('、')}）` : ''}${ev.block ? '' : '（还没归块）'}`;
    case 'event': return `${head} 动作 ${ev.kind || ev.type || ''}${ev.text || ev.detail?.text ? `：${clip(ev.text || ev.detail.text, 200)}` : ''}`;
    case 'say': return `${head} 学生${ev.via === 'chat' ? '在对话里' : ''}说：${clip(ev.text, 400) || '（只有图）'}${ev.images?.length ? `（附图 ${ev.images.length} 张：${ev.images.join('、')}）` : ''}`;
    case 'helper': return `${head} 页面里的 Claude（${{ helper: '外部叫来的助手', coach: '板边助教', teacher: '页面里的老师' }[ev.role] || ev.role || '助手'}）说：${clip(ev.text, 400)}${ev.did?.length ? `；执行了 ${ev.did.join('、')}` : ''}`;
    case 'draft': return `${head} 下课时没交的草稿：${clip(ev.text, 300)}`;
    case 'manual': return `${head} 补记：${clip(ev.text || ev.note, 400)}`;
    // 检验（check/record.js）：一道题一条，第一次的作答、每一项、补讲、retry、信心、用时
    case 'check': return `${head} ${checkLine(ev)}`;
    case 'recall': return `${head} 要记的「${clip(ev.q, 60)}」：${ev.rate || ev.result || ''}`;
    default: return `${head} ${ev.src || '证据'} ${ev.kind || ''}${ev.text ? `：${clip(ev.text, 300)}` : ''}`;
  }
}

/** 一条证据写进学习台的时刻（dr-trail-fix 2）：页面写的带 wroteAt；以前的没有，按事件时间 at */
export const wroteOf = (e) => Number(e?.wroteAt) || Number(e?.at) || 0;

/**
 * meta/since-analysis-{科}：游标（cursor.at）以后**写进学习台的**这一科的全部证据，按事件时间 at 一条一行。
 * 游标按写入时间 wroteAt 比（dr-trail-fix 2）：外部写的 said 带学生说话的时间，常常早于写入；按 at 比，游标已经挪过去的那一条就永远进不来。
 * upTo：放下的这些里最晚的写入时刻——分析完把游标写成它，没放下的下一次照样在。
 * 返回 { space, at, from, n, shown, more, upTo, text }
 */
export function sinceAnalysis({ evidence = [], sessions = [], cursor = null, space = 'math', at = Date.now(), max = TRAIL_MAX } = {}) {
  const byId = new Map((sessions || []).map((s) => [s.id, s]));
  const from = Number(cursor?.at) || 0;
  // 按写入的先后挑（放不下时先放早写进来的，游标才挪得对），再按事件时间排给外部读
  const list = (evidence || []).filter((e) => e && wroteOf(e) > from && spaceOfEvidence(e, byId) === space).sort((a, b) => wroteOf(a) - wroteOf(b) || Number(a.at) - Number(b.at));
  const picked = [];
  let bytes = 0;
  for (const e of list) {
    const l = lineOf(e, byId);
    const b = new TextEncoder().encode(l).length + 1;
    if (bytes + b > max) break;
    picked.push([e, l]);
    bytes += b;
  }
  const shown = picked.length;
  const upTo = shown ? Math.max(...picked.map(([e]) => wroteOf(e))) : from;
  const lines = picked.sort(([a], [b]) => Number(a.at) - Number(b.at)).map(([e, l]) => `${e.id}　${l}`);
  const head = from ? `上次分析（游标 ${hhmm(from)}）以后写进学习台的这一科的证据 ${list.length} 条` : `这一科还没有分析游标（meta/${cursorId(space)}）：全部证据 ${list.length} 条`;
  const more = list.length - shown;
  const tail = shown ? `分析完把 meta/${cursorId(space)} 的 at 写成 ${upTo}（放下的这些里最晚写进来的那一刻；游标按写入时间比，不按事件时间）。` : '';
  return { space, at, from, n: list.length, shown, more, upTo, text: [`${head}${more ? `；放下了先写进来的 ${shown} 条，还有 ${more} 条没放下（分析完这些、照下面把游标挪过去，再读一次）` : ''}。按事件时间排；事件和写入差得多的那一行标了「写入」。${tail}`, ...lines].join('\n') };
}
// 一行：事件时间在前；写入比事件晚一分钟以上的（外部补写的话、以后补的记录）标出写入的时刻
function lineOf(e, byId) {
  const l = evidenceLine(e, { sessionTitle: byId.get(e.session)?.title || '' });
  const w = Number(e.wroteAt);
  return w && Math.abs(w - Number(e.at || 0)) > 60e3 ? `${l}（写入 ${hhmm(w)}）` : l;
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

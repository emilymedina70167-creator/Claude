// 隔天再验的题：这里仅按记录挑题、拼材料和算结果，不替老师宣布学会了。
import { usable } from '../exam/reserve.js';
import { toDate } from './schema.js';
import { fencesOf, withId } from './drills.js';
import { problemsBrief } from './lab.js';

export const HOLD_MAX = 4;
export const HOLD_DAY = 1;
export const HOLD_LATE = 3;

export function needsHolds(session = {}) {
  return (!session.kind || session.kind === 'class') && session.status === 'closed' &&
    !!session.aims?.length && !(Array.isArray(session.review) ? session.review.length : session.review) && !session.reviews?.length &&
    !Object.hasOwn(session, 'holds') && (Number(session.holdTries) || 0) < 2;
}

export function pickHolds({ session = {}, drills = [], evidence = [], reserve = [] } = {}) {
  const done = new Set(evidence.map(e => e.comp));
  const targets = new Set((session.aims || []).map(a => a.exam).filter(Boolean));
  const pool = drills.filter(d => d.src === 'exam' && d.block === session.block && d.status === 'active' &&
    d.md && !d.broken && usable({ id: d.exam, reserve: d.reserve }, reserve) && !done.has(d.id) && !targets.has(d.exam));
  const ids = [];
  // 有明确目标对应时先覆盖，再补同一块的题；没有对应关系不能编造考点映射。
  for (const a of session.aims || []) {
    const d = pool.find(d => d.aim === a.id && !ids.includes(d.id));
    if (d && ids.length < HOLD_MAX) ids.push(d.id);
  }
  for (const d of pool) if (ids.length < HOLD_MAX && !ids.includes(d.id)) ids.push(d.id);
  return ids;
}

// originals：这节课抄进题库的原题（带完整的 md）。有就用它：报告里题面只留开头一百来个字，照半截题面出不了「同类换数」；
// 没抄出题的课（题都是页面判不了的）才退回用报告里的题面
export function holdBrief({ session = {}, aims = session.aims || [], items = [], originals = [], subject = '', n = aims.length, docs = '' } = {}) {
  const asked = originals.length ? originals.map((d) => ({ id: String(d.id), md: String(d.md || '').slice(0, 3000) })) : items.map((it, i) => ({ id: String(i + 1), md: it.q || '' }));
  return `你在给一节刚上完的黑板课留隔天再做的题。\n\n${problemsBrief({ target: { kind: 'hold', title: session.title || session.block }, subject, n: Math.min(HOLD_MAX, n), docs, originals: asked, blockInfo: aims.map(a => `${a.id}：${a.can}${a.proof ? `；${a.proof}` : ''}`).join('\n') })}\n\n留题的额外要求（以这里为准）：
- 每件要拿下的事尽量一道，最多 ${HOLD_MAX} 道；不能照抄课上题面。
- 每道题第二行写「类型：同类」或「类型：迁移」，一半同类换数、一半迁移到新情境。
- 再写「针对：a1」这样的目标编号，只能从上面给的目标中选。
- 只用 quiz、answer 或演示组件的 mode: quiz；不要 practice、steps、开放题。答案必须能由页面判断。
- 回答仍从「=== 题 1」开始，不要额外讲解。`;
}

export function holdDocs(parsed, { session, at } = {}) {
  const aims = new Set((session.aims || []).map(a => a.id));
  const seen = new Set();
  return (parsed.items || parsed || []).filter(it => aims.has(it.why) && typeof it.far === 'boolean').slice(0, HOLD_MAX).flatMap(it => {
    const id = `d-hold-${session.id}-${it.n}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const md = fencesOf(it.doc.md).map(f => f.lang === 'let' ? f.raw : withId(f, id)).join('\n\n');
    return [{ id, doc: { ...it.doc, md, src: 'hold', by: 'page', hold: session.id, aim: it.why, far: it.far, at } }];
  });
}

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
  return { n: mine.length, right: right(mine), days: daysSince(session, today), far: { n: far.length, right: right(far) } };
}

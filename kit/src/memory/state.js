// 「讲过」和「会了」分开、矛盾一律报（dr-learning-trail T4、T5）：每一块讲过没有（coverage）、掌握状态核不核得上（只认证据）、
// 最近 3 条证据、最近一次失手、下次复现日；记录之间对不上的列出来，不自动改。写成 meta/state-{科}。纯函数，tests/memory-state.test.js
import { spaceOfId } from './space.js';
import { toDate, reviewDue, lastLog } from './schema.js';
import { evidenceLine } from '../project/trail.js';

const blockOf = (id) => String(id || '').split('#')[0];
const dayOf = (at) => (Number(at) ? toDate(Number(at)) : '');
const PASSED = new Set(['基础题过', '复现通过']);
const LEVEL = { L0: 0, L1: 1, L2: 2, L3: 3 };
const isRecord = (e) => e && e.src === 'record';
const firstTry = (e) => isRecord(e) && e.ok === true && !e.giveup && !e.revealed && (e.attempts == null || Number(e.attempts) <= 1);
const safeSpace = (id) => { try { return spaceOfId(id); } catch { return null; } };

/**
 * 一条掌握状态核不核得上（只认证据）：未学不用核；别的最近一次改状态的 log（没有就看 doc.basis）要写依据、依据在证据里找得到，
 * 基础题过 / 复现通过还要依据里有做对的作答。返回 { ok, why }
 */
export function verifyMastery(doc, evById = new Map()) {
  const state = doc?.state;
  if (!state || state === '未学') return { ok: true };
  const log = lastLog(doc, 'state');
  const basis = [...new Set([...(log?.basis || []), ...(Array.isArray(doc.basis) ? doc.basis : [])])].filter(Boolean).map(String);
  if (!basis.length) return { ok: false, why: '没写依据（basis）' };
  const missing = basis.filter((b) => !evById.has(b));
  if (missing.length === basis.length) return { ok: false, why: `依据 ${missing.slice(0, 3).join('、')} 在证据里找不到` };
  if (PASSED.has(state) && !basis.some((b) => evById.get(b)?.ok === true)) return { ok: false, why: '依据里没有做对的作答' };
  return { ok: true, ...(missing.length ? { note: `依据里 ${missing.length} 条找不到` } : {}) };
}

/**
 * 这一科每一块的现状和矛盾。mem：记忆库（mastery、reviews、weaknesses、errors、sessions、curriculum、evidence）；coverage：讲过的记录。
 * 返回 { space, rows: [{ block, title, taught, mastery, recent, lastSlip, nextReview }], conflicts: [{ kind, block, text }], text }
 */
export function deskState({ mem = {}, coverage = [], space = 'math', today = toDate(Date.now()) } = {}) {
  const ev = (mem.evidence || []).filter(Boolean);
  const evById = new Map(ev.map((e) => [String(e.id), e]));
  const sessions = (mem.sessions || []).filter(Boolean);
  const inSpace = (b) => b && safeSpace(b) === space;
  const titleOf = new Map((mem.curriculum || []).map((c) => [String(c.id), c.title || '']));
  // 讲过：coverage 里记的；以前的课（coverage 以前）按那节课的块和在那节课里的证据算
  const taught = new Map();
  const teach = (b, at, sid) => { if (!inSpace(b)) return; const t = taught.get(b) || { first: Infinity, last: 0, sessions: new Set() }; t.first = Math.min(t.first, at || Infinity); t.last = Math.max(t.last, at || 0); if (sid) t.sessions.add(sid); taught.set(b, t); };
  for (const c of coverage || []) { if (c?.kind === 'point') continue; for (const sid of c.sessions || [null]) teach(blockOf(c.block || c.id), Number(c.first) || 0, sid); teach(blockOf(c.block || c.id), Number(c.last) || 0, null); }
  const teachKinds = new Set(['class', 'ext', 'talk', 'stage', 'live', 'unit']);
  for (const s of sessions) if (teachKinds.has(s.kind || 'class')) for (const b of [s.block, ...(s.blocks || [])]) teach(b, Number(s.startedAt) || 0, s.id);
  // 每块的证据（作答）
  const byBlock = new Map();
  for (const e of ev) { const b = blockOf(e.block); if (!inSpace(b)) continue; (byBlock.get(b) || byBlock.set(b, []).get(b)).push(e); }
  for (const l of byBlock.values()) l.sort((a, b) => Number(a.at) - Number(b.at));
  const mastery = (mem.mastery || []).filter((m) => m && m.status !== 'void' && inSpace(blockOf(m.id)));
  const mByBlock = new Map(mastery.filter((m) => !String(m.id).includes('#')).map((m) => [String(m.id), m]));
  const blocks = [...new Set([...taught.keys(), ...byBlock.keys(), ...mastery.map((m) => blockOf(m.id))])].sort();
  const reviews = (mem.reviews || []).filter((r) => r && (r.status || 'active') === 'active');
  const conflicts = [];
  const rows = blocks.map((b) => {
    const t = taught.get(b);
    const m = mByBlock.get(b);
    const v = m ? verifyMastery(m, evById) : null;
    const recs = (byBlock.get(b) || []).filter(isRecord);
    const slip = [...recs].reverse().find((e) => e.ok === false);
    const due = reviews.filter((r) => (r.blocks || []).includes(b)).map((r) => reviewDue(r, today)).filter((d) => d && d.due).map((d) => d.due).sort()[0] || null;
    // T5 矛盾（只报，不改）
    if (m && m.state && m.state !== '未学' && !t) conflicts.push({ kind: 'untaught', block: b, text: `${b} 没讲过（没有讲过的记录、也没上过这一块的课），掌握却写着「${m.state}」` });
    if (m && PASSED.has(m.state)) {
      const since = lastLog(m, 'state')?.date || '';
      const wrong = recs.find((e) => e.ok === false && dayOf(e.at) > since);
      if (since && wrong) conflicts.push({ kind: 'slipped', block: b, text: `${b} 掌握写着「${m.state}」（${since}），之后 ${dayOf(wrong.at)} 同块做错了：${evidenceLine(wrong)}` });
    }
    if ((!m || m.state === '未学' || m.state === '讲过') && t && Number.isFinite(t.first)) {
      const firstDay = dayOf(t.first);
      const later = recs.find((e) => firstTry(e) && dayOf(e.at) > firstDay && (e.fresh || /^d-(lab|hold)-/.test(String(e.drill || e.comp || ''))));
      if (later) conflicts.push({ kind: 'maybeKnown', block: b, text: `${b} 掌握写着「${m?.state || '没写'}」，可 ${dayOf(later.at)} 隔天的新题一次做对了：${evidenceLine(later)}` });
    }
    if (m && v && !v.ok) conflicts.push({ kind: 'unverified', block: b, text: `${b} 掌握写着「${m.state}」，依据核不上（${v.why}），页面不算它` });
    return {
      block: b, title: titleOf.get(b) || '',
      taught: t ? { first: Number.isFinite(t.first) && t.first ? dayOf(t.first) : '', last: t.last ? dayOf(t.last) : '', sessions: t.sessions.size } : null,
      mastery: m ? { state: m.state, ok: !!v?.ok, ...(v && !v.ok ? { why: v.why } : {}) } : null,
      recent: recs.slice(-3).map((e) => evidenceLine(e)),
      lastSlip: slip ? evidenceLine(slip) : null,
      nextReview: due,
    };
  });
  // 弱点：L1 以上（以为好了一些）以后又有挂它的错题
  for (const w of mem.weaknesses || []) {
    if (!w || ['void', 'merged'].includes(w.status) || (w.space && w.space !== space)) continue;
    if ((LEVEL[w.level] ?? 0) < 1) continue;
    const since = lastLog(w, 'level')?.date || '';
    const errs = (mem.errors || []).filter((e) => e && (e.weakness === w.id || (w.errors || []).includes(e.id)) && e.date && since && e.date > since);
    if (errs.length) conflicts.push({ kind: 'weakness', block: (w.blocks || [])[0] || '', text: `弱点 ${w.id}「${w.title}」${since} 定成 ${w.level}，之后又有挂它的错题：${errs.map((e) => `${e.id}（${e.date}）`).join('、')}` });
  }
  // 复现组判过，依据不合通过标准（依据里没有一次做对的新题）
  for (const r of mem.reviews || []) {
    if (!r || (r.space && r.space !== space) || !(r.blocks || []).some(inSpace)) continue;
    const log = lastLog(r, 'result');
    if (!log || !/过|pass/i.test(String(log.to ?? '')) || /没过|未过|不过/.test(String(log.to ?? ''))) continue;
    const basis = (log.basis || []).map((x) => evById.get(String(x))).filter(Boolean);
    if (!basis.some(firstTry)) conflicts.push({ kind: 'review', block: (r.blocks || [])[0] || '', text: `复现组 ${r.id}「${r.title}」${log.date || ''} 判了「${log.to}」，依据里没有一次做对的作答${basis.length ? '' : '（依据是空的或找不到）'}` });
  }
  const line = (r) => `${r.block}${r.title ? `「${r.title}」` : ''}：${r.taught ? `讲过（${r.taught.first}${r.taught.last && r.taught.last !== r.taught.first ? `～${r.taught.last}` : ''}，${r.taught.sessions} 节）` : '没讲过'}；掌握 ${r.mastery ? `${r.mastery.state}${r.mastery.ok ? '' : `（依据核不上，不算：${r.mastery.why}）`}` : '没写'}${r.nextReview ? `；下次复现 ${r.nextReview}` : ''}${r.lastSlip ? `\n    最近一次失手：${r.lastSlip}` : ''}${r.recent.length ? `\n    最近的作答：\n${r.recent.map((x) => `      ${x}`).join('\n')}` : ''}`;
  const text = [`这一科 ${rows.length} 块（讲过的、有作答的、写了掌握的）；矛盾 ${conflicts.length} 条。`, ...(conflicts.length ? ['矛盾（只报，不改）：', ...conflicts.map((c) => `- ${c.text}`)] : []), '每一块：', ...rows.map(line)].join('\n');
  return { space, rows, conflicts, text };
}

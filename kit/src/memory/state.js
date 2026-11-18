// 「讲过」和「会了」分开、矛盾一律报（dr-learning-trail T4、T5）：每一块讲过没有（coverage）、掌握状态核不核得上、
// 最近 3 条作答、最近一次失手、下次复现日；记录之间对不上的列出来，不自动改。写成 meta/state-{科}。纯函数，tests/memory-state.test.js
//
// dr-trail-fix 1（学生：「明明我学了……却诊断我学了当成没掌握……这些就很危险」）：学习台以前的课（9 月在 claude.ai 对话里讲的）
// 没有原始作答，只有错题本（errors，含 T 编号的检验记录）、掌握 log 里「旧记录：…」的文字、笔记本的归档。这些都算记录：
// 依据在 evidence 里找到的是「核上了」，在 errors / observations / sessions 里找到的、「旧记录」开头的文字是「旧记录（没有原始作答）」，
// 状态照算、标出来，不写「不算」；讲过认 coverage 的 kind: legacy（外部补的，或页面照错题本的日期补的 legacyCoverage）。
import { spaceOfId } from './space.js';
import { toDate, reviewDue, lastLog } from './schema.js';
import { evidenceLine } from '../project/trail.js';

const blockOf = (id) => String(id || '').split('#')[0];
const dayOf = (at) => (Number(at) ? toDate(Number(at)) : '');
const PASSED = new Set(['基础题过', '复现通过']);
const LEVEL = { L0: 0, L1: 1, L2: 2, L3: 3 };
// 作答：课上的作答，加上学生自己记的书上的题（src: book，dr-batch4 第 2 条）
const isRecord = (e) => e && (e.src === 'record' || e.src === 'book');
const firstTry = (e) => isRecord(e) && e.ok === true && !e.giveup && !e.revealed && (e.attempts == null || Number(e.attempts) <= 1);
const safeSpace = (id) => { try { return spaceOfId(id); } catch { return null; } };
const live = (d) => d && !['void', 'merged', 'retired'].includes(d.status);
const clip = (t, n) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/** 「旧记录：…」开头的文字依据（学习台以前的课，没有原始作答） */
export const LEGACY_RE = /^\s*旧记录/;
const RECORD_NAME = { errors: '错题本', observations: '观察', sessions: '课' };
/** 检验记录（errors 里的 T 编号）写着过了；「不计」的不算过也不算失手 */
const passedRecord = (d) => /^(过|通过|复现通过|基础题过)/.test(String(d?.result ?? '').trim());
const neutralRecord = (d) => /^不计/.test(String(d?.result ?? '').trim());
/** 错题是学习台里哪一节课记的（session 字段，或来源里写着课号）；旧的是 null */
export const sessionOfError = (e) => e?.session || String(e?.source ?? '').match(/\bc-\d{8}-\d+\b/)?.[0] || null;

/** 依据能去哪里找：evidence 的编号 → 证据本身；errors、observations、sessions 的编号 → { coll, doc } */
export function basisIndex(mem = {}) {
  const idx = new Map();
  for (const coll of ['sessions', 'observations', 'errors']) for (const d of mem[coll] || []) if (d?.id && live(d)) idx.set(String(d.id), { coll, doc: d });
  for (const e of mem.evidence || []) if (e?.id) idx.set(String(e.id), e);
  return idx;
}
const hitOf = (idx, b) => { const v = idx.get(b); if (!v) return null; return v.coll && v.doc ? v : { coll: 'evidence', doc: v }; };

/**
 * 一条掌握状态核不核得上：未学不用核；别的最近一次改状态的 log（没有就看 doc.basis）要写依据、依据找得到。
 * idx：basisIndex(mem)（只给证据的 Map 也行）。依据全在证据里的：基础题过 / 复现通过还要有做对的作答；
 * 有旧记录（错题本、观察、课的编号，「旧记录：…」的文字）的：照写的算（ok），legacy 标出来。
 * 返回 { ok, why?, legacy?, from?: ['错题本 L1-T01', '旧记录的文字'], note? }
 */
export function verifyMastery(doc, idx = new Map()) {
  const state = doc?.state;
  if (!state || state === '未学') return { ok: true };
  const log = lastLog(doc, 'state');
  const basis = [...new Set([...(log?.basis || []), ...(Array.isArray(doc.basis) ? doc.basis : [])])].filter(Boolean).map(String);
  if (!basis.length) return { ok: false, why: '没写依据（basis）' };
  const texts = basis.filter((b) => LEGACY_RE.test(b));
  const ids = basis.filter((b) => !LEGACY_RE.test(b));
  const hits = ids.map((b) => [b, hitOf(idx, b)]);
  const missing = hits.filter(([, h]) => !h).map(([b]) => b);
  const orig = hits.filter(([, h]) => h?.coll === 'evidence').map(([, h]) => h.doc);
  const recs = hits.filter(([, h]) => h && h.coll !== 'evidence');
  const from = [...recs.map(([b, h]) => `${RECORD_NAME[h.coll]} ${b}`), ...(texts.length ? [`旧记录的文字 ${texts.length} 条`] : [])];
  if (!orig.length && !from.length) return { ok: false, why: `依据 ${missing.slice(0, 3).join('、')} 在证据、错题本、观察、课里都找不到` };
  const note = missing.length ? `依据里 ${missing.length} 条找不到（${missing.slice(0, 3).join('、')}）` : '';
  if (from.length) return { ok: true, legacy: true, from, refs: recs.map(([b, h]) => ({ coll: h.coll, id: b, date: h.doc?.date || '', session: h.doc?.session || null, source: h.doc?.source || '' })), texts: texts.length, ...(note ? { note } : {}) };
  if (PASSED.has(state) && !orig.some((e) => e.ok === true)) return { ok: false, why: '依据里没有做对的作答' };
  return { ok: true, ...(note ? { note } : {}) };
}

// —— 旧的讲过（kind: legacy）——

/** 文字里的日期（「09-28」「9/28」「2026-09-28」）；年份按 ref（那条记录写下的日子）推：月份比它大的算上一年 */
export function datesIn(text, ref = '') {
  const out = [];
  const refY = Number(String(ref).slice(0, 4)) || new Date().getFullYear();
  const refM = Number(String(ref).slice(5, 7)) || 12;
  const s = String(text ?? '');
  for (const m of s.matchAll(/(?<!\d)(20\d\d)-(\d\d)-(\d\d)(?!\d)/g)) out.push(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of s.replace(/(?<!\d)20\d\d-\d\d-\d\d(?!\d)/g, ' ').matchAll(/(?<![\d.])(\d{1,2})[-/](\d{1,2})(?![\d.])/g)) {
    const mo = Number(m[1]), d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    out.push(`${mo > refM ? refY - 1 : refY}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}
const atOf = (day) => Date.parse(`${day}T12:00:00+08:00`);

/**
 * 页面补的旧的讲过：这一科里有错题、或掌握的依据是旧记录，可学习台里第一次讲这一块之前（或一直没讲）的那一段没有 legacy 记录的块，
 * 照错题本的日期、依据文字里的日期补一条 coverage/legacy-{块}（by: page）。外部写过 legacy 的块不动。返回要写的文档
 */
export function legacyCoverage({ mem = {}, coverage = [], space = 'math', at = Date.now() } = {}) {
  const inSpace = (b) => b && safeSpace(b) === space;
  const hasLegacy = new Set((coverage || []).filter((c) => c?.kind === 'legacy').map((c) => blockOf(c.block || String(c.id).replace(/^legacy-/, ''))));
  const firstNew = new Map();
  for (const c of coverage || []) if (c && c.kind !== 'legacy' && c.kind !== 'point') { const b = blockOf(c.block || c.id); const f = Number(c.first) || Infinity; firstNew.set(b, Math.min(firstNew.get(b) ?? Infinity, f)); }
  for (const s of mem.sessions || []) if (s?.block && Number(s.startedAt)) firstNew.set(s.block, Math.min(firstNew.get(s.block) ?? Infinity, Number(s.startedAt)));
  const found = new Map(); // 块 → { days: Set, src: Set }
  const add = (b, days, src) => { if (!inSpace(b) || hasLegacy.has(b)) return; const before = firstNew.get(b) ?? Infinity; const ok = days.filter((d) => !Number.isFinite(before) || d < dayOf(before)); if (!ok.length && days.length) return; const f = found.get(b) || { days: new Set(), src: new Set() }; ok.forEach((d) => f.days.add(d)); f.src.add(src); found.set(b, f); };
  // 掌握明写着「未学」的块不补（考过一道题不等于讲过）；学习台里的课记下的错题不算旧的
  const unlearned = new Set((mem.mastery || []).filter((m) => live(m) && m.state === '未学').map((m) => String(m.id)));
  for (const e of mem.errors || []) if (live(e) && e.block && e.date && !sessionOfError(e) && !unlearned.has(blockOf(e.block))) add(blockOf(e.block), [e.date], /-T\d/.test(String(e.id)) ? '检验记录' : '错题本');
  for (const m of mem.mastery || []) {
    if (!live(m) || !m.state || m.state === '未学' || String(m.id).includes('#')) continue;
    const log = lastLog(m, 'state');
    const texts = [...(log?.basis || []), ...(Array.isArray(m.basis) ? m.basis : [])].map(String).filter((b) => LEGACY_RE.test(b));
    if (!texts.length) continue;
    const days = texts.flatMap((t) => datesIn(t, log?.date || ''));
    add(m.id, days.length ? days : [], '掌握的依据（旧记录）');
  }
  const out = [];
  for (const [b, f] of found) {
    const days = [...f.days].sort();
    if (!days.length) continue; // 一个日期都没有：不编
    out.push({ id: `legacy-${b}`, kind: 'legacy', block: b, space, first: atOf(days[0]), last: atOf(days.at(-1)), sessions: [], segs: 0, by: 'page', at, source: `页面照${[...f.src].join('、')}的日期补的（${days.length} 个日子：${days.slice(0, 4).join('、')}${days.length > 4 ? '…' : ''}）`, note: '学习台以前的讲课，没有原始作答' });
  }
  return out.sort((a, b) => a.block.localeCompare(b.block));
}

const monthsOf = (first, last) => {
  const a = new Date(Number(first)), b = new Date(Number(last || first));
  const m1 = a.getMonth() + 1, m2 = b.getMonth() + 1;
  if (!Number.isFinite(m1)) return '';
  return m1 === m2 && a.getFullYear() === b.getFullYear() ? `${m1} 月` : `${m1}–${m2} 月`;
};
const errorAt = (e) => (e?.date ? atOf(e.date) : 0);
// 错题来自哪（dr-legacy-label）：学习台以前的课是「旧记录」；学习台建好以后记的（日期在这一科第一节课、第一条证据之后），
// 只是没有原始作答，叫「错题本（没有原始作答）」，那天正好有这一科的课的挂上课号。origin(e) → { label, session }
const errorLine = (e, origin = () => ({ label: '旧记录' })) => { const o = origin(e); return `${e.date || '?'} ${/-T\d/.test(String(e.id)) ? '检验记录' : '错题本'} ${e.id}${e.q ? `「${clip(e.q, 60)}」` : ''}${e.mine ? ` 写的：${clip(e.mine, 120)}` : ''}（${e.result ? clip(e.result, 20) : '错'}，${o.label}${o.session ? `，${o.session}` : ''}）`; };

/**
 * 这一科每一块的现状和矛盾。mem：记忆库（mastery、reviews、weaknesses、errors、observations、sessions、curriculum、evidence）；coverage：讲过的记录（含 kind: legacy）。
 * 返回 { space, rows: [{ block, title, taught, mastery, recent, lastSlip, nextReview }], conflicts: [{ kind, block, text }], text }
 */
export function deskState({ mem = {}, coverage = [], space = 'math', today = toDate(Date.now()) } = {}) {
  const ev = (mem.evidence || []).filter(Boolean);
  const idx = basisIndex(mem);
  const sessions = (mem.sessions || []).filter(Boolean);
  const inSpace = (b) => b && safeSpace(b) === space;
  const titleOf = new Map((mem.curriculum || []).map((c) => [String(c.id), c.title || '']));
  // 讲过：coverage 里记的；以前的课（coverage 以前）按那节课的块和在那节课里的证据算；旧的（kind: legacy）另记
  const taught = new Map();
  const legacy = new Map();
  const teach = (b, at, sid) => { if (!inSpace(b)) return; const t = taught.get(b) || { first: Infinity, last: 0, sessions: new Set() }; if (at) { t.first = Math.min(t.first, at); t.last = Math.max(t.last, at); } if (sid) t.sessions.add(sid); taught.set(b, t); };
  for (const c of coverage || []) {
    if (!c || c.kind === 'point') continue;
    const b = blockOf(c.block || c.id);
    if (c.kind === 'legacy') {
      if (!inSpace(b)) continue;
      const l = legacy.get(b) || { first: Infinity, last: 0, source: [], by: new Set() };
      if (Number(c.first)) l.first = Math.min(l.first, Number(c.first));
      l.last = Math.max(l.last, Number(c.last) || Number(c.first) || 0);
      if (c.source) l.source.push(String(c.source));
      if (c.by) l.by.add(c.by);
      legacy.set(b, l);
      continue;
    }
    const sids = Array.isArray(c.sessions) && c.sessions.length ? c.sessions : [null];
    for (const sid of sids) teach(b, Number(c.first) || 0, sid);
    teach(b, Number(c.last) || 0, null);
  }
  const teachKinds = new Set(['class', 'ext', 'talk', 'stage', 'live', 'unit']);
  const sById = new Map(sessions.map((s) => [s.id, s]));
  const teachingSession = (sid) => { const s = sById.get(sid); return s && teachKinds.has(s.kind || 'class') ? s : null; };
  for (const s of sessions) if (teachKinds.has(s.kind || 'class')) for (const b of [s.block, ...(s.blocks || [])]) teach(b, Number(s.startedAt) || 0, s.id);
  // 在一节课里做过这一块的题（证据、那节课记的错题）：这一块那节课讲过
  for (const e of ev) if (isRecord(e) && e.session && teachingSession(e.session)) teach(blockOf(e.block), Number(e.at) || 0, e.session);
  for (const e of mem.errors || []) { const sid = live(e) ? sessionOfError(e) : null; if (sid && teachingSession(sid)) teach(blockOf(e.block), errorAt(e), sid); }
  // 掌握的依据是一节课里的作答（页面按知识点归过类，作答原本挂在别的块上）：这一块也在那节课里讲过
  for (const m of mem.mastery || []) {
    if (!live(m) || !m.state || m.state === '未学' || String(m.id).includes('#')) continue;
    for (const b of (m.log || []).filter((l) => l?.field === 'state').flatMap((l) => l.basis || [])) { const e = idx.get(String(b)); if (e && !e.coll && e.session && teachingSession(e.session)) teach(String(m.id), Number(e.at) || 0, e.session); }
  }
  // 每块的证据（作答）和错题本（旧的错题、检验记录）
  const byBlock = new Map();
  for (const e of ev) { const b = blockOf(e.block); if (!inSpace(b)) continue; (byBlock.get(b) || byBlock.set(b, []).get(b)).push(e); }
  for (const l of byBlock.values()) l.sort((a, b) => Number(a.at) - Number(b.at));
  const errByBlock = new Map();
  for (const e of mem.errors || []) { if (!live(e)) continue; const b = blockOf(e.block); if (!inSpace(b)) continue; (errByBlock.get(b) || errByBlock.set(b, []).get(b)).push(e); }
  for (const l of errByBlock.values()) l.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const mastery = (mem.mastery || []).filter((m) => m && m.status !== 'void' && inSpace(blockOf(m.id)));
  const mByBlock = new Map(mastery.filter((m) => !String(m.id).includes('#')).map((m) => [String(m.id), m]));
  const blocks = [...new Set([...taught.keys(), ...legacy.keys(), ...byBlock.keys(), ...errByBlock.keys(), ...mastery.map((m) => blockOf(m.id))])].sort();
  const reviews = (mem.reviews || []).filter((r) => r && (r.status || 'active') === 'active');
  const conflicts = [];
  // 这一科在学习台里开始的那一天：最早的一节课、最早的一条证据
  const starts = [...sessions.filter((x) => inSpace(x.block) && Number(x.startedAt)).map((x) => Number(x.startedAt)), ...ev.filter((e) => inSpace(blockOf(e.block)) && Number(e.at)).map((e) => Number(e.at))];
  const deskDay = starts.length ? dayOf(Math.min(...starts)) : '';
  const sessionOn = (day) => sessions.find((x) => inSpace(x.block) && x.id && dayOf(Number(x.startedAt)) === day)?.id || null;
  const origin = (e) => {
    const sid = sessionOfError(e);
    if (sid) return { label: '错题本（没有原始作答）', session: sid };
    // 来源写着是学习台上的课（外部黑板、实时黑板、学习台）：那几节课的记录没留下来，也不是学习台以前的
    if (/外部黑板|实时黑板|学习台|黑板课/.test(String(e?.source || ''))) return { label: '错题本（没有原始作答）', session: e?.date ? sessionOn(e.date) : null };
    if (deskDay && e?.date && e.date >= deskDay) return { label: '错题本（没有原始作答）', session: sessionOn(e.date) };
    return { label: '旧记录' };
  };
  const rows = blocks.map((b) => {
    const t = taught.get(b);
    const lg = legacy.get(b);
    const m = mByBlock.get(b);
    const v = m ? verifyMastery(m, idx) : null;
    const recs = (byBlock.get(b) || []).filter(isRecord);
    const errs = errByBlock.get(b) || [];
    const basisSet = new Set(m ? [...(lastLog(m, 'state')?.basis || []), ...(Array.isArray(m.basis) ? m.basis : [])].map(String) : []);
    // 作答和错题本按先后拼成一条（旧的错题没有时刻，按那天中午算）
    const trail = [...recs.map((e) => ({ at: Number(e.at) || 0, line: evidenceLine(e), slip: e.ok === false })), ...errs.map((e) => ({ at: errorAt(e), line: errorLine(e, origin), slip: !passedRecord(e) && !neutralRecord(e) }))].sort((a, c) => a.at - c.at);
    const slip = [...trail].reverse().find((x) => x.slip);
    const due = reviews.filter((r) => (r.blocks || []).includes(b)).map((r) => reviewDue(r, today)).filter((d) => d && d.due).map((d) => d.due).sort()[0] || null;
    // T5 矛盾（只报，不改）
    if (m && m.state && m.state !== '未学' && !t && !lg) conflicts.push({ kind: 'untaught', block: b, text: `${b} 没讲过（没有讲过的记录、也没上过这一块的课、也没有旧的讲过），掌握却写着「${m.state}」` });
    if (m && PASSED.has(m.state)) {
      const since = lastLog(m, 'state')?.date || '';
      const wrong = recs.find((e) => e.ok === false && dayOf(e.at) > since);
      const wrongOld = errs.find((e) => e.date && since && e.date > since && !passedRecord(e) && !neutralRecord(e) && !basisSet.has(String(e.id)));
      if (since && wrong) conflicts.push({ kind: 'slipped', block: b, text: `${b} 掌握写着「${m.state}」（${since}），之后 ${dayOf(wrong.at)} 同块做错了：${evidenceLine(wrong)}` });
      else if (since && wrongOld) conflicts.push({ kind: 'slipped', block: b, text: `${b} 掌握写着「${m.state}」（${since}），之后错题本 ${wrongOld.date} 同块记了错题：${errorLine(wrongOld, origin)}` });
    }
    const firstAt = Math.min(t && Number.isFinite(t.first) ? t.first : Infinity, lg && Number.isFinite(lg.first) ? lg.first : Infinity);
    if ((!m || m.state === '未学' || m.state === '讲过') && Number.isFinite(firstAt)) {
      const firstDay = dayOf(firstAt);
      const later = recs.find((e) => firstTry(e) && dayOf(e.at) > firstDay && (e.fresh || /^d-(lab|hold)-/.test(String(e.drill || e.comp || ''))));
      if (later) conflicts.push({ kind: 'maybeKnown', block: b, text: `${b} 掌握写着「${m?.state || '没写'}」，可 ${dayOf(later.at)} 隔天的新题一次做对了：${evidenceLine(later)}` });
    }
    if (m && v && !v.ok) conflicts.push({ kind: 'unverified', block: b, text: `${b} 掌握写着「${m.state}」，依据核不上（${v.why}），页面不算它` });
    const taughtRow = t || lg ? {
      first: t && Number.isFinite(t.first) && t.first ? dayOf(t.first) : '',
      last: t?.last ? dayOf(t.last) : '',
      sessions: t ? t.sessions.size : 0,
      ...(lg ? { legacy: { first: Number.isFinite(lg.first) ? dayOf(lg.first) : '', last: lg.last ? dayOf(lg.last) : '', months: Number.isFinite(lg.first) ? monthsOf(lg.first, lg.last) : '', source: lg.source.join('；'), by: [...lg.by].join('、') } } : {}),
    } : null;
    if (taughtRow && !t) { taughtRow.first = ''; taughtRow.last = ''; }
    return {
      block: b, title: titleOf.get(b) || '',
      taught: taughtRow,
      mastery: m ? { state: m.state, ok: !!v?.ok, ...(v?.legacy ? { legacy: !v.texts && (v.refs || []).every((r) => r.coll === 'errors' && origin(r).label !== '旧记录') ? 'book' : true, from: v.from } : {}), ...(v && !v.ok ? { why: v.why } : {}), ...(v?.note ? { note: v.note } : {}) } : null,
      recent: trail.slice(-3).map((x) => x.line),
      lastSlip: slip ? slip.line : null,
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
  // 复现组判过，依据不合通过标准（依据里没有一次做对的作答；依据是写着过了的检验记录的照旧记录算）
  for (const r of mem.reviews || []) {
    if (!r || (r.space && r.space !== space) || !(r.blocks || []).some(inSpace)) continue;
    const log = lastLog(r, 'result');
    if (!log || !/过|pass/i.test(String(log.to ?? '')) || /没过|未过|不过/.test(String(log.to ?? ''))) continue;
    const basis = (log.basis || []).map((x) => hitOf(idx, String(x))).filter(Boolean);
    const oldPass = basis.some((h) => h.coll === 'errors' && passedRecord(h.doc)) || (log.basis || []).some((x) => LEGACY_RE.test(String(x)));
    if (!oldPass && !basis.some((h) => h.coll === 'evidence' && firstTry(h.doc))) conflicts.push({ kind: 'review', block: (r.blocks || [])[0] || '', text: `复现组 ${r.id}「${r.title}」${log.date || ''} 判了「${log.to}」，依据里没有一次做对的作答${basis.length ? '' : '（依据是空的或找不到）'}` });
  }
  const taughtText = (x) => {
    if (!x) return '没讲过';
    const lg = x.legacy;
    const now = x.sessions || x.first ? `${x.first}${x.last && x.last !== x.first ? `～${x.last}` : ''}，${x.sessions} 节` : '';
    if (lg && now) return `讲过（${lg.months || '学习台以前'}旧记录；学习台里 ${now}）`;
    if (lg) return `讲过（${lg.months || '学习台以前'}，旧记录）`;
    return `讲过（${now}）`;
  };
  const masteryText = (x) => (!x ? '没写' : `${x.state}${!x.ok ? `（依据核不上，不算：${x.why}）` : x.legacy === 'book' ? `（依据在${x.from.join('、')}，没有原始作答）` : x.legacy ? `（旧记录：${x.from.join('、')}，没有原始作答）` : ''}${x.note ? `（${x.note}）` : ''}`);
  const line = (r) => `${r.block}${r.title ? `「${r.title}」` : ''}：${taughtText(r.taught)}；掌握 ${masteryText(r.mastery)}${r.nextReview ? `；下次复现 ${r.nextReview}` : ''}${r.taught?.legacy?.source ? `\n    旧的讲过：${clip(r.taught.legacy.source, 160)}` : ''}${r.lastSlip ? `\n    最近一次失手：${r.lastSlip}` : ''}${r.recent.length ? `\n    最近的作答：\n${r.recent.map((x) => `      ${x}`).join('\n')}` : ''}`;
  const text = [`这一科 ${rows.length} 块（讲过的、有作答的、写了掌握的、错题本里有的）；矛盾 ${conflicts.length} 条。旧记录 = 学习台以前的课（claude.ai 对话），只有错题本、检验记录和记下的文字，没有原始作答。`, ...(conflicts.length ? ['矛盾（只报，不改）：', ...conflicts.map((c) => `- ${c.text}`)] : []), '每一块：', ...rows.map(line)].join('\n');
  return { space, rows, conflicts, text };
}

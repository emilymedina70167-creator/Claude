// 学习台后方的复查和调度（docs/guard-plan.md 第 3 步）。纯函数，不调用 Claude，不改任何一条记录：
// - recheck：已经收下的结论，后来的证据不一样了（修好了的弱点又错、复现「过」了又错、「消了」的误解又冒出来），标出来；
//   错题后来连着一次做对、可能已经会了的，也标出来。判断交给下一次本来就有的下课整理（closingPrompt 带几行），不单独调用。
// - workOrder：后方今天该做什么（没收尾的课、待重判的结论、到期却只有原题的复现组、好久没测的弱点、该备的课），
//   按价值排好，写明大概花多少。首页「管理 → 自检」能看；以后的云端教研室照它干活，不自己挑。
import { toDate, daysBetween, dueList } from './schema.js';
import { spaceOfId } from './space.js';
import { similarity, voidedIds, resolvedErrors } from './memo.js';
import { lastActivity } from './report.js';

export const SENTRY_VERSION = 1;
const DAY = 86400000;
const KINDS = new Set(['class', 'live', 'unit', 'drill']);
const kindOf = (s) => (KINDS.has(s?.kind) ? s.kind : 'class');
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const day = (at) => toDate(Number(at) || 0);
// 一上来就对的作答（练一练的原题不算：原题对了只说明还记得这道）
const firstTry = (e) => e?.src === 'record' && e.ok === true && (Number(e.attempts) || 1) <= 1 && !String(e.comp || '').startsWith('d-');
const wrong = (e) => e?.src === 'record' && e.ok === false;

/**
 * mem：记忆库各类的数组。返回 { stale: [{ coll, id, code, why, evidence, space }], maybeSolved: [{ id, block, why, evidence, space }] }
 */
export function recheck(mem = {}) {
  const get = (c) => (Array.isArray(mem[c]) ? mem[c] : []);
  const gone = voidedIds(mem);
  const ev = get('evidence');
  const stale = [];
  const after = (blocks, since) => ev.filter((e) => blocks.includes(String(e.block || '')) && (!since || day(e.at) > since));

  // 修好了的弱点（closed、L3）之后这几块又错了
  for (const w of get('weaknesses')) {
    if (gone.has(`weaknesses/${w.id}`) || !(w.status === 'closed' || w.level === 'L3')) continue;
    const bad = after(list(w.blocks).map(String), w.last || '').filter(wrong);
    if (bad.length) stale.push({ coll: 'weaknesses', id: String(w.id), code: 'weakness-back', why: `标成${w.status === 'closed' ? '修好了' : 'L3'}（${w.last || '早先'}），之后这几块又错了 ${bad.length} 次`, evidence: bad.slice(-3).map((e) => e.id), space: w.space || spaceOfId(String(list(w.blocks)[0] || '')) });
  }
  // 复现组记「过」以后，这几块又错了
  for (const r of get('reviews')) {
    if (gone.has(`reviews/${r.id}`) || !/^过/.test(String(r.result || '')) || ['done', 'void', 'merged'].includes(r.status)) continue;
    const bad = after(list(r.blocks).map(String), r.last || '').filter(wrong);
    if (bad.length) stale.push({ coll: 'reviews', id: String(r.id), code: 'review-back', why: `上次复现记了「过」（${r.last || ''}），之后这几块又错了 ${bad.length} 次`, evidence: bad.slice(-3).map((e) => e.id), space: r.space || spaceOfId(String(list(r.blocks)[0] || '')) });
  }
  // 复盘里「消了」的误解，后来的复盘说它还在、新冒出，或者后来的错题说的是同一件事
  const withDebrief = get('sessions').filter((s) => s?.debrief?.mis?.length).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  for (let i = 0; i < withDebrief.length; i++) {
    const s = withDebrief[i];
    const sp = s.space || spaceOfId(String(s.block || ''));
    for (const m of s.debrief.mis.filter((x) => x.state === '消了')) {
      const laterDebrief = withDebrief.slice(i + 1).find((t) => (t.space || spaceOfId(String(t.block || ''))) === sp && t.debrief.mis.some((x) => ['还在', '新冒出'].includes(x.state) && similarity(x.text, m.text) >= 0.3));
      const laterError = get('errors').find((e) => !gone.has(`errors/${e.id}`) && e.date && e.date > (s.date || day(s.startedAt)) && spaceOfId(String(e.block || '')) === sp && similarity(`${e.cause || ''}`, m.text) >= 0.3);
      if (laterDebrief || laterError) stale.push({ coll: 'debrief', id: `${s.id}`, code: 'misconception-back', why: `复盘说「${String(m.text).slice(0, 40)}」消了，${laterDebrief ? `${laterDebrief.id} 的复盘又说它还在` : `之后的错题 ${laterError.id} 说的是同一件事`}`, evidence: laterError ? [laterError.id] : [], space: sp });
    }
  }
  // 错题：之后这一块至少两节课一上来就做对、再没错过 → 可能已经会了（不替它标已解决，交给下一次下课整理判断）
  const solved = resolvedErrors(mem);
  const maybeSolved = [];
  for (const e of get('errors')) {
    if (e.corrects || gone.has(`errors/${e.id}`) || solved.has(String(e.id)) || !e.block || !e.date) continue;
    const later = after([String(e.block)], e.date);
    if (later.some(wrong)) continue;
    const good = later.filter(firstTry);
    const sessions = new Set(good.map((x) => x.session || day(x.at)));
    if (sessions.size >= 2) maybeSolved.push({ id: String(e.id), block: String(e.block), why: `${e.date} 以后这一块 ${sessions.size} 节课一上来就做对、没再错过`, evidence: good.slice(-3).map((x) => x.id), space: spaceOfId(String(e.block)) });
  }
  return { stale, maybeSolved };
}

/** 下课整理时带给课堂 Claude 的几行（这一科的，最多 max 条）：要它判断这些结论还成不成立；没有就是空串 */
export function recheckText(res, space, { max = 5 } = {}) {
  const lines = [
    ...res.stale.filter((x) => x.space === space).map((x) => `- ${x.coll === 'debrief' ? `复盘 ${x.id}` : `${x.coll === 'weaknesses' ? '弱点' : '复现组'} ${x.id}`}：${x.why}${x.evidence.length ? `（证据 ${x.evidence.join('、')}）` : ''}`),
    ...res.maybeSolved.filter((x) => x.space === space).map((x) => `- 错题 ${x.id}：${x.why}（证据 ${x.evidence.join('、')}）`),
  ].slice(0, max);
  if (!lines.length) return '';
  return `【后来的证据不一样了】下面这几条以前的结论，后来的作答和它对不上。整理单里顺带判断：还成立就不用写；不成立就改（弱点 ˋweakness id=… level=… status=… basis=…ˋ，复现组 ˋreview id=… result=…ˋ，确实会了的错题标已解决 ˋerror id=… status=resolved basis=…ˋ），依据写后面列的证据。\n${lines.join('\n')}`;
}

/**
 * 后方的工作单。packs：{ math: { main }, cs: …, en: … }（每科的资料包，看有没有备好的课）。
 * 返回 [{ kind, space, ref, title, why, value, cost }]，价值高的在前
 */
export function workOrder(mem = {}, { today = toDate(Date.now()), now = Date.now(), packs = {}, re = null } = {}) {
  const get = (c) => (Array.isArray(mem[c]) ? mem[c] : []);
  const gone = voidedIds(mem);
  const items = [];
  const obs = get('observations');
  // 1. 没收尾的课：一节课堂下了课（或挂着三小时没动静）却没有课堂 Claude 写的小结
  for (const s of get('sessions')) {
    if (kindOf(s) !== 'class' || s.summary || obs.some((o) => o.session === s.id && o.kind === 'summary')) continue;
    const quiet = s.status === 'closed' || now - lastActivity(s, get('evidence')) > 3 * 3600 * 1000;
    const real = (Number(s.report?.items) || 0) > 0 || (Number(s.report?.activeMs) || 0) > 5 * 60000;
    if (!quiet || !real) continue;
    items.push({ kind: 'backfill', space: s.space || spaceOfId(String(s.block || '')), ref: s.id, title: s.title || s.id, why: `${s.date || ''} 这节课${s.status === 'closed' ? '直接下课了' : '挂着没下课'}，没有小结、整理单`, value: 90, cost: '一次 Opus 5.5（读整节课的记录写小结和整理单，按事后补写走守卫）' });
  }
  // 2. 待重判：后来的证据不一样了
  const r = re || recheck(mem);
  for (const x of r.stale) items.push({ kind: 'recheck', space: x.space, ref: `${x.coll}/${x.id}`, title: x.why, why: '以前的结论被后来的作答推翻了', value: 70, cost: '并进下一次下课整理，不另调用' });
  if (r.maybeSolved.length) {
    const by = {};
    for (const x of r.maybeSolved) (by[x.space] ||= []).push(x.id);
    for (const [sp, ids] of Object.entries(by)) items.push({ kind: 'resolve', space: sp, ref: ids.join(','), title: `${ids.length} 道错题可能已经会了`, why: '之后这几块连着几节课一上来就做对', value: 40, cost: '并进下一次下课整理，不另调用' });
  }
  // 3. 到期的复现组只有原题（练一练的原题不算复现通过）：缺新题
  const drills = get('drills').filter((d) => d && d.status !== 'void' && !d.broken);
  for (const d of dueList(get('reviews'), today).filter((x) => x.days <= 0)) {
    const rv = get('reviews').find((x) => String(x.id) === d.id);
    if (!rv || gone.has(`reviews/${rv.id}`)) continue;
    const blocks = list(rv.blocks).map(String);
    const fresh = drills.filter((x) => x.src !== 'board' && blocks.includes(String(x.block || '')));
    if (fresh.length >= 2) continue;
    items.push({ kind: 'newproblems', space: rv.space || spaceOfId(String(blocks[0] || '')), ref: String(rv.id), title: rv.title || rv.id, why: `${d.days < 0 ? `过期 ${-d.days} 天` : '今天到期'}，题库里只有课上的原题`, value: 60 + Math.min(20, -d.days), cost: '一次 Opus 5.5 出 3～5 道新题（守卫核过答案才进题库）' });
  }
  // 4. 好久没测的弱点：还没修好（L0 / L1），这几块 14 天没有作答。L0 在前，最多列 6 条（全列出来就看不过来了）
  const probes = [];
  for (const w of get('weaknesses')) {
    if (gone.has(`weaknesses/${w.id}`) || ['closed', 'merged', 'void'].includes(w.status) || !['L0', 'L1'].includes(w.level)) continue;
    const blocks = list(w.blocks).map(String);
    if (!blocks.length) continue;
    const lastAt = Math.max(0, ...get('evidence').filter((e) => blocks.includes(String(e.block || ''))).map((e) => Number(e.at) || 0));
    const idle = lastAt ? Math.floor((now - lastAt) / DAY) : null;
    if (idle !== null && idle < 14) continue;
    probes.push({ kind: 'probe', space: w.space || spaceOfId(blocks[0]), ref: String(w.id), title: w.title || w.id, why: idle === null ? '挂了以后一次都没测过' : `${idle} 天没测`, value: w.level === 'L0' ? 32 : 30, cost: '下一节这一科开头一道探题，不另调用', idle: idle ?? 9999 });
  }
  items.push(...probes.sort((a, b) => b.value - a.value || b.idle - a.idle).slice(0, 6).map(({ idle: _, ...x }) => x));
  // 5. 该备的课：这一科下一节从哪接写着，却没有备好的教案
  for (const pos of get('position')) {
    const sp = pos.id === 'now' ? 'math' : pos.id === 'now-cs' ? 'cs' : pos.id === 'now-en' ? 'en' : spaceOfId(String(pos.block || ''));
    const main = packs?.[sp]?.main;
    if (!pos.block || (main && !main.usedBy)) continue;
    items.push({ kind: 'prep', space: sp, ref: String(pos.block), title: pos.next ? String(pos.next).slice(0, 60) : String(pos.block), why: '下一节从哪接写着，还没有备好的教案', value: 50, cost: '一次 Opus 5.5（备课 + 课前预演）' });
  }
  return items.sort((a, b) => b.value - a.value);
}

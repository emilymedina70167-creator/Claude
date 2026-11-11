// 掌握：页面按证据算，出改动单，我点「确认」才写（docs/learning-plan.md 2.2）。纯函数，有测试（tests/memory-mastery.test.js）。
//
// 为什么页面算：掌握原来只有对话里的 Claude 能写，而上课、练习都在学习台里，很少回对话，课程地图的颜色就停住不动了。
// 课堂里的 Claude 照旧不能宣布掌握（红线 6）：这里不调用 Claude，只数证据；写进去要我确认（改动单 by: page，tier: confirm）。
//
// 按时间顺序走一遍这一块（或块里的一个知识点 块#名字）做过的题：
//   干净 = 一次对，而且没标「没把握」；失手 = 第一次就错（后来改对了也算）、想不出来、看了答案
//   两道不同的题干净 → 基础题过；
//   基础题过以后，隔够 1 / 3 / 7 / 14 / 30 天又干净一道 → 复现通过（第几档）；
//   基础题过 / 复现通过以后失手 → 掉了，重新数。
//   一节课一节课地看（walk 的说明）：一节课里先对后错不算过，复现只看这节课第一次碰到它。
// 归过类的课（skills.js）按知识点数：证据的标签换成归类时定的「块 + 知识点」。
// 练一练里的题是课上原样抄来的（drills.js，组件 id 是题库编号 d-…）：再做对只是记住了题，按我的规则（复现要新题、不是原题换数）
// 不算干净、不往上升；原题都做错了照样算失手（连原题都不会了，肯定是掉了）。
// 从记忆里现有的状态出发（我确认过的、对话里的 Claude 写的），只看那以后的题：不会把定下来的状态推翻成没依据的样子。
import { REVIEW_TIERS, toDate, daysBetween } from './schema.js';
import { itemsOf } from './report.js';
import { voidedIds } from './memo.js';
import { spaceOfId } from './space.js';
import { retagEvidence, pointCatalog } from './skills.js';

export const MASTERY_RULE = {
  basic: 2, // 几道不同的题干净算基础题过
  tiers: REVIEW_TIERS, // 复现的间隔（和复现组同一套档位）
  text: '两道不同的题一次对、没标没把握 → 基础题过（一节课里只算最后一次失手以后的）；之后隔够 1 / 3 / 7 / 14 / 30 天、那节课一上来就做对（新题，练一练里的原题不算）→ 复现通过到那一档；一上来就错了、看了答案、想不出来 → 掉了',
};

/** 练一练里做的原题（题库编号 d-…）：做对不算数，做错照样算失手。
 * 教研室出的新题（d-lab-…）第一次做的那节课不算原题（it.fresh，masteryProposals 标的）：学生没见过，正是复现要的新题；以后再做就是原题了 */
export const isOriginal = (it) => /^d-/.test(String(it?.comp || '')) && !it?.fresh;
const CLEAN = (it) => it.outcome === 'first' && it.sure !== false && !isOriginal(it);
// 改对了（第一次错）也算失手：考试只有一次机会
// 试出来的选择题（report.js 的 guess）outcome 是 ok，本来就算失手
const FAIL = (it) => ['wrong', 'giveup', 'revealed', 'ok'].includes(it.outcome);
// 同一道题（练习里抄来的组件 id 每次一样）在不同的课里做两遍，不算「两道不同的题」
const same = (k) => String(k).split('§').pop();
const blockOf = (id) => String(id || '').split('#')[0];
const isTarget = (t) => /^(?:[A-Z]{2}-)?L\d+(?:\.\d+){0,2}(?:#[A-Za-z0-9_-]+)?$/.test(t);

/**
 * 一串题（按时间排好）从 start 状态出发走一遍。start：{ state, tier, last（上次干净那天）}。
 * 一节课一节课地看（同一节课挨着的题算一组），不在一节课里来回翻：
 * - 还没过（未学 / 讲过 / 掉了）：这节课最后一次失手以后的干净题才算（前面错、后面做对，是当堂学会的；先对后错，是还没会）；
 *   几节课里攒够 basic 道不同的干净题 → 基础题过。中间哪节课失手了，攒的清零
 * - 过了（基础题过 / 复现通过）：只看这节课第一次碰到它——隔够了天数、一上来就做对 → 复现通过（升一档）；一上来就失手 → 掉了。
 *   后面再做对，是当堂又学了一遍，留到下一节课再算
 * 返回 { state, tier, last, basis（定下这个状态的那几道题的证据）, why（一句话）}；没有变化时 state 和 start 一样。
 */
export function walk(items, start = {}, rule = MASTERY_RULE) {
  let state = start.state || '未学';
  let tier = Number(start.tier) || null;
  let last = start.last || null;
  let clean = []; // 还没到基础题过时，攒着的干净题
  let basis = [];
  let why = '';
  const tiers = rule.tiers;
  const dayOf = (it) => toDate(it.first || it.end || Date.now());
  const evOf = (it) => (it.evidence || []).slice(-3);
  // 按课分组（挨着的同一节课）；没有课号的（旧数据）每道题自己一组，照原来的一道道算
  const groups = [];
  for (const it of items) {
    const g = groups.at(-1);
    if (g && it.session && g[0].session === it.session) g.push(it); else groups.push([it]);
  }
  for (const g of groups) {
    const day = dayOf(g[0]);
    if (['未学', '讲过', '掉了'].includes(state)) {
      let lastFail = -1;
      g.forEach((it, i) => { if (FAIL(it)) lastFail = i; });
      if (lastFail >= 0) clean = [];
      for (const it of g.slice(lastFail + 1)) {
        if (CLEAN(it) && !clean.some((c) => c.key === same(it.key))) clean.push({ key: same(it.key), ev: evOf(it), day: dayOf(it) });
      }
      if (clean.length >= rule.basic) {
        state = '基础题过'; tier = null; last = clean.at(-1).day;
        basis = clean.flatMap((c) => c.ev); clean = [];
        why = `${rule.basic} 道不同的题一次对`;
      }
      continue;
    }
    const firstHit = g.find((it) => CLEAN(it) || FAIL(it));
    if (!firstHit) continue;
    if (FAIL(firstHit)) {
      state = '掉了'; tier = null; basis = evOf(firstHit);
      why = `过了以后又${firstHit.outcome === 'giveup' ? '想不出来' : firstHit.outcome === 'revealed' ? '看了答案' : '做错'}`;
      // 掉了以后这节课又做对的，算进重新攒的干净题
      clean = [];
      let lastFail = -1;
      g.forEach((it, i) => { if (FAIL(it)) lastFail = i; });
      for (const it of g.slice(lastFail + 1)) if (CLEAN(it) && !clean.some((c) => c.key === same(it.key))) clean.push({ key: same(it.key), ev: evOf(it), day: dayOf(it) });
      continue;
    }
    const i = state === '复现通过' ? tiers.indexOf(tier) : -1;
    const need = tiers[Math.min(tiers.length - 1, i + 1)];
    if (last && daysBetween(last, day) >= need) {
      const was = state === '复现通过' ? `第 ${tier} 天那档` : '基础题过';
      state = '复现通过'; tier = need; last = day; basis = evOf(firstHit);
      why = `${was}以后隔够 ${need} 天，一上来就做对`;
    }
  }
  return { state, tier, last, basis: [...new Set(basis)], why };
}

/**
 * 记忆里这一条从哪个状态起算、从什么时候起的题才看。
 * 最后几次改状态是页面自己算出来的（log 的 by: page）：退回到页面算之前的那个状态重算——规则、知识点归类改了以后，
 * 页面以前的结论按新的重新算（比如按旧规则一会儿「基础题过」一会儿「掉了」的），我和以前对话里定下的不动。
 */
function startOf(doc, pending = []) {
  if (!doc) return { state: '未学', tier: null, last: null, since: 0 };
  const log = Array.isArray(doc.log) ? doc.log : [];
  const byPage = (e) => e?.by === 'page' || pending.find((p) => p.id === e?.ref)?.by === 'page';
  const states = log.filter((e) => e?.field === 'state');
  let k = states.length;
  while (k > 0 && byPage(states[k - 1])) k--;
  const base = k > 0 ? states[k - 1] : null;
  const firstPage = k < states.length ? states[k] : null;
  // 页面改之前是什么：第一次页面改的 from（tier 找同一张改动单的那条）；没有页面改过就是现在的
  const state = firstPage ? (firstPage.from || '未学') : (doc.state || '未学');
  const tierLog = firstPage ? log.find((e) => e?.field === 'tier' && e.ref && e.ref === firstPage.ref) : null;
  const tier = firstPage ? (tierLog ? Number(tierLog.from) || null : state === '复现通过' ? Number(doc.tier) || null : null) : Number(doc.tier) || null;
  const pd = base?.ref ? pending.find((p) => p.id === base.ref) : null;
  const date = base?.date || (!firstPage ? doc.date : null) || null;
  const since = Number(pd?.doneAt) || (date ? Date.parse(`${date}T23:59:59`) : 0) || 0;
  const last = state === '基础题过' || state === '复现通过' ? (date || null) : null;
  return { state, tier, last, since };
}

/**
 * 全部提议：[{ target, op, data | patch, basis, reason, space, upto }]（还没变成改动单）。
 * mem：整个记忆库（evidence、mastery、pending、curriculum、sessions）。
 * 只提块（课程地图里有的）和块里的知识点（证据的 tags 写了的）。
 */
/**
 * 新题标上 fresh（isOriginal 不把它当原题）：教研室出的题（d-lab-…）、不换数的舞台题（图）只有第一次做的那节课算；
 * 换数的舞台题（d-stage-…，题库里 random：每次打开换一组数）每次都算。drills：题库（认哪几道是换数的）
 */
export function markFresh(items = [], drills = []) {
  const random = new Set((drills || []).filter((d) => d && d.random).map((d) => String(d.id)));
  const first = new Map();
  for (const it of items) {
    const c = String(it?.comp || '');
    if (!/^d-(lab|stage)-/.test(c) || !it.session) continue;
    const t = Number(it.first) || Number(it.end) || 0;
    const cur = first.get(c);
    if (!cur || t < cur.t) first.set(c, { t, session: it.session });
  }
  for (const it of items) {
    const c = String(it?.comp || '');
    if (random.has(c) || first.get(c)?.session === it.session) it.fresh = true;
  }
  return items;
}

export function masteryProposals(mem = {}, { rule = MASTERY_RULE } = {}) {
  const gone = voidedIds(mem);
  const mastery = (mem.mastery || []).filter((d) => d && !gone.has(`mastery/${d.id}`));
  const pending = mem.pending || [];
  const blocks = new Set((mem.curriculum || []).filter((d) => d && (d.level === 'block' || String(d.id).replace(/^[A-Z]{2}-/, '').split('.').length === 3)).map((d) => String(d.id)));
  // 归过类的课（skills.js）：证据换成「真正的块 + 知识点」的标签再数
  const evs = retagEvidence((mem.evidence || []).filter((e) => e && (e.src === 'record' || e.src === 'event')), mem.sessions || []);
  const catalog = pointCatalog(mem.sessions || [], mastery);
  const items = itemsOf(evs, new Map(), { bySession: true });
  markFresh(items, mem.drills || []);
  const byTarget = new Map();
  for (const it of items) {
    for (const t of it.tags || []) {
      if (!isTarget(t)) continue;
      if (blocks.size && !blocks.has(blockOf(t))) continue;
      if (!byTarget.has(t)) byTarget.set(t, []);
      byTarget.get(t).push(it);
    }
  }
  const evIds = new Set((mem.evidence || []).map((e) => String(e?.id)));
  const out = [];
  // 页面算过、但现在一条证据都不剩的（删了那节课）：也要过一遍，退回页面改之前的状态
  for (const m of mastery) if (m?.id && !byTarget.has(String(m.id)) && isTarget(String(m.id)) && (!blocks.size || blocks.has(blockOf(String(m.id))))) byTarget.set(String(m.id), []);
  for (const [target, list] of [...byTarget].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    const doc = mastery.find((m) => String(m.id) === target);
    const start = startOf(doc, pending);
    const after = list.filter((it) => (Number(it.end) || Number(it.first) || 0) > start.since).sort((a, b) => (a.first ?? 0) - (b.first ?? 0));
    if (!after.length) {
      // 没有证据撑着页面定的结论了：退回页面改之前（我和对话里定的不动：startOf 只退页面改的那几次）
      if (!doc || (start.state === (doc.state || '未学') && (start.tier ?? null) === (Number(doc.tier) || null))) continue;
      // 只在依据的作答真的没了时退（删了课）；作答还在、只是归类换了块的，不动（免得已有的掌握来回跳）
      const evs0 = (Array.isArray(doc.basis) ? doc.basis : []).filter((x) => /^ev-/.test(String(x)));
      if (!evs0.length || evs0.some((x) => evIds.has(String(x)))) continue;
      const value = { state: start.state, tier: start.state === '复现通过' ? start.tier : null };
      out.push({ target, op: 'update', patch: value, basis: [], reason: '页面按证据算的：原来定这个状态的作答已经删掉了（删了那节课），退回页面改之前的状态', space: spaceOfId(target), upto: '' });
      continue;
    }
    const r = walk(after, start, rule);
    // 和记忆里现在的比（start 可能是退回去重算的那个状态）
    const curState = doc?.state || '未学';
    const curTier = Number(doc?.tier) || null;
    if (r.state === curState && (r.state !== '复现通过' || (r.tier ?? null) === curTier)) continue;
    if (!doc && r.state === '未学') continue;
    const upto = after.at(-1).evidence?.at(-1) || '';
    const value = { state: r.state, ...(r.state === '复现通过' ? { tier: r.tier } : curTier ? { tier: null } : {}) };
    const reason = `页面按证据算的：${r.why || '按现在的规则重算，这几节课的题还不够定下原来那个结论'}。规则：${rule.text}`;
    const title = target.includes('#') ? catalog[target]?.title || '' : '';
    const space = spaceOfId(target);
    // 依据接在原来的后面（原来的是定下上一个状态的，留着）
    if (doc) out.push({ target, op: 'update', patch: { ...value, basis: [...new Set([...(Array.isArray(doc.basis) ? doc.basis : []), ...r.basis])].slice(-20) }, basis: r.basis, reason, space, upto });
    else out.push({ target, op: 'add', data: { ...value, block: blockOf(target), ...(title ? { title } : {}), basis: r.basis }, basis: r.basis, reason, space, upto });
  }
  return out;
}

const newId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
const sameValue = (a, b) => (a.state ?? null) === (b.state ?? null) && (a.tier ?? null) === (b.tier ?? null);
const valueOf = (pd) => pd.patch || pd.data || {};

/**
 * 提议 → 要写的改动单：[{ id, doc }]。
 * - 同一条还开着的提议：内容一样不动；变了就改写那一张（不在「待确认」里堆好几张）
 * - 我点过「不要」的：同样的结论、同样的依据（upto 一样）不再提
 */
export function masteryPendingWrites(proposals, pending = [], { now = Date.now() } = {}) {
  const writes = [];
  for (const p of proposals) {
    const mine = pending.filter((d) => d && d.kind === 'mastery' && String(d.target) === p.target);
    const open = mine.find((d) => d.status === 'open');
    const value = p.patch || p.data;
    if (mine.some((d) => d.status === 'rejected' && sameValue(valueOf(d), value) && d.upto === p.upto)) continue;
    if (open && sameValue(valueOf(open), value) && open.op === p.op) continue;
    const id = open?.id || `pd-m${newId()}`;
    writes.push({
      id,
      doc: {
        kind: 'mastery', tier: 'direct', by: 'page', coll: 'mastery', op: p.op, target: p.target,
        ...(p.op === 'add' ? { data: p.data } : { patch: p.patch }),
        reason: p.reason, basis: p.basis.slice(0, 20), label: '掌握', space: p.space, upto: p.upto,
        session: null, status: 'open', at: open?.at || now, log: open?.log || [],
      },
    });
  }
  return writes;
}

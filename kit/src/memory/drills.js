// 页面自己跑的练习和混练（docs/learning-plan.md 第 3 节）里不碰 DOM 的部分，有测试（tests/memory-drills.test.js）。
//
// 为什么：学得牢靠的是隔一段时间自己再做出来。原来复现靠「开一节复现课」，每节都是几十轮 Opus，额度一紧就做得很少。
// 练习不调用 Claude：题从以前的课里抄（零成本）、页面判分、作答照常进证据，掌握照常算（mastery.js）；只在我要开课时才调用。
//
// - 题库 drills：下课写报告时，页面把这节课**页面判得了分**的组件（连同这节课的 let 块）抄一份。组件 id 换成题库编号，
//   练习里的作答 comp 就是题库编号，按它对回题库、块和知识点。
// - 挑题 pickDrills：到期的复现组挂的块和错题、掉了的块、该复现的块、最近错过的，分高的先；混练：挨着的两道尽量不同块。
// - 做完 drillOutcome：每道题的结果；复现组没过的直接记（原题都对了不算复现通过，档位不动）；错了的几道拼成开课用的资料包。
import { reserveYears, usable } from '../exam/reserve.js';
import { targetOf } from '../exam/target.js';
import { toDate, addDays, dueList, nextTier, REVIEW_TIERS } from './schema.js';
import { itemsOf } from './report.js';
import { voidedIds, resolvedErrors } from './memo.js';
import { filterSpace, spaceOfId } from './space.js';
import { stageDrillsOf } from './stagedrills.js';

const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(String);
const blockOf = (id) => String(id || '').split('#')[0];
export const DRILL_MAX = 12 * 1024; // 一道题的原文最多多大（课上写的大段组件不抄）
export const DRILL_N = 8; // 一次练几道
export const STAGE_DRILL_MAX = 2; // 其中舞台题最多几道

/* ---------------- 读黑板段的组件 ---------------- */

/** 一段 Markdown 里的围栏组件：[{ lang, body, id, raw }] */
export function fencesOf(md) {
  const out = [];
  const re = /^(`{3,}|~{3,})[ \t]*([A-Za-z][\w-]*)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm;
  let m;
  while ((m = re.exec(String(md ?? '')))) {
    const body = m[3].replace(/\n$/, '');
    const id = body.match(/^\s*id\s*[:：]\s*([\w\-.~:@+]+)\s*$/m)?.[1] || '';
    out.push({ lang: m[2].toLowerCase(), body, id, raw: m[0], fence: m[1] });
  }
  return out;
}

/** 题库编号：d-{课}-{组件}（同一节课的同一个组件抄几遍都是同一条） */
export function drillId(session, comp) {
  return `d-${String(session || 'x').replace(/^c-/, '')}-${String(comp || 'x')}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
}

/** 组件原文换成题库编号（写了 id 就换掉，没写就加一行） */
export function withId(fence, id) {
  const body = /^\s*id\s*[:：]/m.test(fence.body) ? fence.body.replace(/^\s*id\s*[:：].*$/m, `id: ${id}`) : `id: ${id}\n${fence.body}`;
  // 原来用几个反引号就用几个（组件里面还套着 ``` 的，换成三个会被截断）
  const f = fence.fence || '```';
  return `${f}${fence.lang}\n${body}\n${f}`;
}

// 抄不了的：图（拖一拖、看一看，判不了对错）、let（单独抄）、猜想（等 Claude 看）、代码题（太长、要跑测试，以后再说）
const SKIP = new Set(['let', 'scene', 'graph', 'space', 'plot', 'sketch', 'image', 'derive', 'matrix', 'conjecture', 'code', 'thinkbox', 'draft', 'predict', 'figure', 'summary']);

/**
 * 一节课 → 抄进题库的题。session：sessions 文档（带 id）；steps：这节课黑板的段（id、md、point）；report：这节课的报告（report.js）；
 * mem：记忆库（挂错题用）。返回 [{ id, doc }]，已经在题库里的（existing 里有）不重复抄。
 */
export function harvestDrills({ session = {}, steps = [], turns = [], report = null, mem = {}, existing = [], now = Date.now() } = {}) {
  const sid = String(session.id || '');
  // 舞台课没有黑板的组件：抄的是老师照引擎走过的每一种（stagedrills.js），报告里一道题都没有也照抄
  if (sid && session.kind === 'stage') return stageDrillsOf({ session, turns, existing, now });
  if (!sid || !report?.items?.length) return [];
  if (session.kind === 'drill') return []; // 练习本身的题本来就在题库里
  const have = new Set((existing || []).map((d) => String(d.id)));
  const segs = (steps || []).filter((s) => s && s.id && !s.failed);
  // 这节课的 let 块（按段的顺序）：题里的 \calc 用得到
  const lets = [...new Set(segs.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).flatMap((s) => fencesOf(s.md).filter((f) => f.lang === 'let').map((f) => f.raw)))];
  const errs = (mem.errors || []).filter((e) => e && !e.corrects);
  const out = [];
  const done = new Set();
  for (const it of report.items) {
    if (!it.comp || it.outcome === 'open' || done.has(it.comp)) continue;
    const seg = segs.find((s) => String(s.id) === String(it.seg)) || segs.find((s) => fencesOf(s.md).some((f) => f.id === it.comp));
    const f = seg && fencesOf(seg.md).find((x) => x.id === it.comp);
    if (!f || SKIP.has(f.lang)) continue;
    done.add(it.comp);
    const id = drillId(sid, it.comp);
    if (have.has(id)) continue;
    const md = [...lets, withId(f, id)].join('\n\n');
    if (new TextEncoder().encode(md).length > DRILL_MAX) continue;
    // 这道题在这节课里的结果：同一个组件分步的取最差的那步
    const mine = report.items.filter((x) => x.comp === it.comp);
    const rank = { first: 0, ok: 1, wrong: 2, revealed: 3, giveup: 3, open: 0 };
    const worst = mine.reduce((a, b) => (rank[b.outcome] > rank[a.outcome] ? b : a), mine[0]);
    const evIds = new Set(mine.flatMap((x) => x.evidence || []));
    const block = session.block || report.block || null;
    const point = mine.flatMap((x) => x.tags || []).find((t) => t.includes('#'))?.split('#')[1] || seg.point || '';
    out.push({
      id,
      doc: {
        block, ...(point ? { point } : {}), kind: f.lang, md, q: cut(it.q || seg.title || '', 160), title: cut(seg.title || '', 80),
        src: 'board', from: { session: sid, seg: String(seg.id), comp: String(it.comp) }, fromSession: sid,
        orig: worst.outcome, errors: errs.filter((e) => list(e.evidence).some((x) => evIds.has(x))).map((e) => String(e.id)),
        ...(block ? { space: spaceOfId(block) } : {}), status: 'active', at: now,
      },
    });
  }
  return out;
}

/* ---------------- 挑题 ---------------- */

/** 每道题在练习里最近一次做得怎样：{ [题库编号]: { outcome, sure, day, at } } */
export function drillHistory(evidence = []) {
  const items = itemsOf((evidence || []).filter((e) => e && String(e.comp || '').startsWith('d-')), new Map(), { bySession: true });
  const out = {};
  for (const it of items) {
    const prev = out[it.comp];
    if (!prev || (it.first ?? 0) >= prev.at) out[it.comp] = { outcome: it.outcome, sure: it.sure, day: toDate(it.first || Date.now()), at: it.first ?? 0 };
  }
  return out;
}

const CLEAN = (h) => h && h.outcome === 'first' && h.sure !== false;

/**
 * 挑这一次练哪几道。mem：整个记忆库（drills、reviews、mastery、errors、evidence……）；space：只挑这一科的。
 * 返回 { items: [{ id, block, score, why }], reviews: [这次练到的到期复现组] }。
 */
export function pickDrills(mem = {}, { space = 'math', today = toDate(Date.now()), n = DRILL_N } = {}) {
  const m = filterSpace(mem, space);
  const gone = voidedIds(m);
  // 真题做的题（src: exam）：留作模考那几年的不挑（档案里改了留的年份，以前进了题库的也拦住）
  const reserve = reserveYears(targetOf(mem), today);
  const drills = (m.drills || []).filter((d) => d && d.status !== 'void' && !d.broken && d.md && (!d.space || d.space === space) && !(d.exam && !usable({ id: d.exam }, reserve)));
  if (!drills.length) return { items: [], reviews: [] };
  const hist = drillHistory(mem.evidence || []);
  const solved = resolvedErrors(m);
  const errs = (m.errors || []).filter((e) => e && !e.corrects && !gone.has(`errors/${e.id}`));
  const weakOf = (eid) => errs.find((e) => String(e.id) === eid)?.weakness;
  const due = dueList(m.reviews || [], today).filter((r) => r.days <= 0);
  const reviews = (m.reviews || []).filter((r) => due.some((d) => d.id === String(r.id)));
  const mastery = (m.mastery || []).filter((x) => x && !gone.has(`mastery/${x.id}`));
  const stateOf = (b) => mastery.find((x) => String(x.id) === b);
  const scored = [];
  for (const d of drills) {
    const h = hist[d.id];
    // 今天（或者昨天）刚做对过：不急着再做；今天课上一次就做对的也一样（隔开时间再做才是复现）
    if (CLEAN(h) && h.day >= addDays(today, -1)) continue;
    if (!h && d.orig === 'first' && d.at && toDate(d.at) === today) continue;
    const why = [];
    let s = 0;
    const rv = reviews.filter((r) => String(d.review || '') === String(r.id) || list(r.blocks).includes(String(d.block)) || list(r.weaknesses).some((w) => list(d.errors).some((e) => weakOf(e) === w)));
    if (rv.length) { s += 100; why.push(`复现组 ${rv.map((r) => r.id).join('、')} 到期`); }
    const st = stateOf(String(d.block));
    const lastLog = [...(st?.log || [])].reverse().find((e) => e?.field === 'state' || e?.field === 'tier');
    if (st?.state === '掉了') { s += 60; why.push('这块掉了'); }
    else if (st && ['基础题过', '复现通过'].includes(st.state)) {
      const tier = st.state === '复现通过' ? Number(st.tier) || 1 : REVIEW_TIERS[0];
      const since = lastLog?.date || '';
      if (!since || addDays(since, tier) <= today) { s += 50; why.push('这块该复现了'); }
      else s -= 20;
    } else if (st?.state === '讲过' || !st) { s += 25; why.push('这块还没过'); }
    const open = list(d.errors).filter((e) => !solved.has(e));
    if (open.length) { s += 40; why.push(`挂着错题 ${open.join('、')}`); }
    if (h && !CLEAN(h)) { s += 35; why.push('上次练错了'); }
    else if (!h && ['wrong', 'giveup', 'revealed', 'ok'].includes(d.orig)) { s += 20; why.push('课上没一次做对'); }
    if (CLEAN(h)) s -= 10;
    // 教研室出的、还没做过的新题：复现要的就是没见过的题（原题做对不算复现通过），探弱点的题是专门测那个毛病的
    if (d.src === 'lab' && !h) { s += d.weakness ? 45 : 30; why.push(d.weakness ? `探弱点 ${d.weakness}` : '新题'); }
    if (d.src === 'exam' && !h) { s += 35; why.push('没做过的真题'); }
    scored.push({ id: d.id, block: String(d.block || ''), kind: String(d.kind || ''), score: s, why: why.join('；') || '复习', at: Number(d.at) || 0 });
  }
  scored.sort((a, b) => b.score - a.score || b.at - a.at || a.id.localeCompare(b.id));
  // 混练：每块最多 3 道；按分数轮着从各块拿，挨着的两道尽量不同块
  const per = new Map();
  const pool = [];
  let stageN = 0; // 舞台题（走完一遍一个算法）比填空长：一次最多 2 道
  for (const x of scored) {
    const k = per.get(x.block) || 0;
    if (k >= 3) continue;
    if (x.kind === 'stage' && ++stageN > STAGE_DRILL_MAX) continue;
    per.set(x.block, k + 1);
    pool.push(x);
    if (pool.length >= n * 2) break;
  }
  const chosen = pool.slice(0, n);
  const items = interleave(chosen);
  const used = new Set(items.map((x) => x.block));
  return { items, reviews: reviews.filter((r) => list(r.blocks).some((b) => used.has(b)) || items.some((x) => (x.why || '').includes(String(r.id)) || String(drills.find((d) => d.id === x.id)?.review || '') === String(r.id))).map((r) => String(r.id)) };
}

/** 排顺序：挨着的两道尽量不是同一块（考试时也不会告诉你这题是哪一章的） */
export function interleave(items) {
  const left = [...items];
  const out = [];
  while (left.length) {
    const prev = out.at(-1)?.block;
    const i = left.findIndex((x) => x.block !== prev);
    out.push(left.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}

/* ---------------- 做完 ---------------- */

/**
 * 这一次练习的结果。drills：这次的题（题库的文档，带 id）；evidence：这次练习的证据；mem：记忆库（复现组）；reviews：这次练到的复现组编号。
 * 返回 { rows: [{ id, block, outcome, sure, clean, q }], wrong: [题库编号], reviewResults: [{ id, passed, basis }] }
 */
// fresh：这一次是第一次做的教研室新题（题库编号的集合，drillrun.js 查过以前的作答）
export function drillOutcome({ drills = [], evidence = [], mem = {}, reviews = [], fresh = new Set() } = {}) {
  const items = itemsOf(evidence, new Map());
  const rows = drills.map((d) => {
    const mine = items.filter((it) => it.comp === d.id);
    // 分步的题（steps、演示组件）：一步没一次对就不算干净
    const outcome = !mine.length ? 'skip' : mine.some((x) => ['giveup', 'revealed'].includes(x.outcome)) ? 'giveup' : mine.some((x) => x.outcome === 'wrong') ? 'wrong' : mine.some((x) => x.outcome === 'ok') ? 'ok' : mine.every((x) => x.outcome === 'open') ? 'open' : 'first';
    const sure = mine.some((x) => x.sure === false) ? false : mine.some((x) => x.sure === true) ? true : null;
    return { id: d.id, block: String(d.block || ''), point: d.point || '', q: d.q || '', outcome, sure, clean: outcome === 'first' && sure !== false, fresh: fresh.has(d.id), evidence: mine.flatMap((x) => x.evidence || []) };
  });
  const reviewResults = [];
  const practiced = [];
  for (const rid of reviews) {
    const r = (mem.reviews || []).find((x) => String(x.id) === String(rid));
    if (!r) continue;
    const errWeak = (eid) => (mem.errors || []).find((e) => String(e.id) === eid)?.weakness;
    const mine = rows.filter((row) => {
      const d = drills.find((x) => x.id === row.id);
      return String(d?.review || '') === String(r.id) || list(r.blocks).includes(row.block) || list(r.weaknesses).some((w) => list(d?.errors).some((e) => errWeak(e) === w));
    }).filter((row) => row.outcome !== 'skip' && row.outcome !== 'open');
    if (!mine.length) continue;
    const passed = mine.every((x) => x.clean);
    // 练一练的题是原题：都对了只说明还记得这几道，按我的规则（新题、不是原题换数）不算复现通过，档位不动（practiced）；
    // 里面有教研室出的、第一次做的新题，又都一次做对：这才是复现通过，档位往上走。有一道没一次做对，照样记没过
    if (passed && !mine.some((x) => x.fresh)) { practiced.push({ id: String(r.id), n: mine.length }); continue; }
    reviewResults.push({ id: String(r.id), passed, tier: nextTier(r.tier, passed), basis: mine.flatMap((x) => x.evidence.slice(-2)).slice(0, 20), n: mine.length, bad: mine.filter((x) => !x.clean).length });
  }
  return { rows, wrong: rows.filter((x) => ['wrong', 'giveup', 'ok'].includes(x.outcome) || x.sure === false).map((x) => x.id), reviewResults, practiced };
}

const newId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

/** 复现组的结果 → 改动单（by: page，直接写、能撤销；档位按结果变） */
export function reviewPendings(results, { session = null, date = toDate(Date.now()), now = Date.now(), mem = {} } = {}) {
  return results.map((r) => {
    const rv = (mem.reviews || []).find((x) => String(x.id) === r.id);
    const space = rv?.space || (list(rv?.blocks)[0] ? spaceOfId(list(rv.blocks)[0]) : undefined);
    return {
      id: `pd-r${newId()}`,
      doc: {
        kind: 'review', tier: 'direct', by: 'page', coll: 'reviews', op: 'update', target: r.id,
        patch: { result: r.passed ? '过' : '没过', tier: r.tier, last: date },
        reason: `页面按练习算的：这一组练了 ${r.n} 道，${r.passed ? '都一次做对、没标没把握' : `${r.bad} 道没一次做对（或标了没把握）`}`,
        basis: r.basis, label: '复现组', session, ...(space ? { space } : {}), status: 'open', at: now, log: [],
      },
    };
  });
}

/**
 * 练习里错了的几道 → 开课用的资料包（{ main, problems }，和外部写的一样的字段）。
 * rows：drillOutcome 的 rows；drills：题库的文档；answers：{ 题库编号: 最后写的 }（给老师看学生是怎么答的）
 */
export function drillPack(rows, drills, { answers = {}, mem = {} } = {}) {
  const bad = rows.filter((x) => ['wrong', 'giveup', 'ok'].includes(x.outcome) || x.sure === false);
  if (!bad.length) return null;
  const blocks = [...new Set(bad.map((x) => x.block).filter(Boolean))];
  const cur = (mem.curriculum || []).filter((c) => blocks.includes(String(c.id)));
  const txt = { wrong: '做错了', giveup: '想不出来 / 看了答案', ok: '第一次错、后来改对了', first: '做对了但标了没把握' };
  return {
    main: {
      unit: `练习里没过的 ${bad.length} 道`,
      goal: '把练习里没一次做对的几道弄明白：先让学生说当时怎么想的，针对错的那一步讲，再换一道同类的让学生自己做。',
      block: blocks[0] || null,
      scope: cur.map((c) => `${c.id} ${c.title || ''}：${c.scope || ''}`).join('\n'),
      plan: [
        '1. 一道一道来：把原题写上黑板（下面「题」里有原文，照抄就能用），先问学生当时卡在哪。',
        '2. 针对错的那一步讲，讲完马上换数出一道同类的（practice 的自定义题型，或者改几个数）。',
        '3. 下课整理单里有新的错因就写 error，弱点有变化写 weakness。',
      ].join('\n'),
      student: bad.map((x) => `- ${x.id}（${x.block}）：${txt[x.outcome] || x.outcome}${answers[x.id] ? `；学生写的「${cut(answers[x.id], 120)}」` : ''}`).join('\n'),
      updatedAt: Date.now(),
    },
    problems: { items: bad.map((x) => { const d = drills.find((y) => y.id === x.id); return { q: d?.q || x.id, md: d?.md || '', source: `练习（原题 ${d?.from?.session || ''} ${d?.from?.comp || ''}）`.trim(), block: x.block }; }) },
  };
}

/** 题库的一行（首页、题库页）：块、题面 */
export const drillLine = (d) => `${d.block || ''}${d.point ? `#${d.point}` : ''}　${cut(d.q || d.title || d.kind, 60)}`;

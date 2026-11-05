// 学习台给我看的页面（docs/desk-plan.md 第 3、4 批）里不碰 DOM 的部分，有测试（tests/memory-views.test.js）。
// 页面都只读、不调用 Claude：课程地图、弱点表、错题本、以前的课、某一块的作答时间线、学习统计；
// 还有两样拼文字的：复现课的资料包（页面自己拼，不用外部备课）、复制给外部 Claude 的启动语。
import { REVIEW_TIERS, toDate, addDays, daysBetween, reviewDue, dueList } from './schema.js';
import { voidedIds, resolvedErrors, pendingTitle } from './memo.js';
import { OUTCOME_TEXT } from './report.js';
import { SPACES, positionId, packIds, filterSpace, courseOf, subjectOf, spaceOfId } from './space.js';
import { classView, memoryCatalog, utf8 } from './digest.js';
import { weaknessHits, pointCatalog } from './skills.js';
import { isTeach } from './session.js';

const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
/** 截短给我看的一句（会按 Markdown 画）：不截在公式中间（$ 落单了整句就成了原始 LaTeX） */
export function cutMd(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  let c = t.slice(0, n - 1);
  if (((c.match(/(?<!\\)\$/g) || []).length) % 2) c = c.slice(0, c.lastIndexOf('$')).trimEnd();
  return `${c}…`;
}
/** 下拉框里的一行（不能画公式）：去掉 $ 和 TeX 命令，只留字 */
export const plainTitle = (s) => String(s ?? '').replace(/\$/g, '').replace(/\\(?:mathbf|boldsymbol|mathrm|operatorname|text|mathit)\{([^}]*)\}/g, '$1').replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
// 截短带公式的文字：截断处落在 $…$ 里面时，退到那个公式前面（不然页面上露出半截 TeX）
const cutTex = (s, n) => {
  const t = cut(s, n);
  if (!t.endsWith('…')) return t;
  const body = t.slice(0, -1);
  return (body.split('$').length % 2 === 0 ? body.slice(0, body.lastIndexOf('$')).trimEnd() : body) + '…';
};
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(String);
export const cmpId = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const blockOf = (id) => String(id || '').split('#')[0];
const live = (mem, c) => { const gone = voidedIds(mem); return (Array.isArray(mem?.[c]) ? mem[c] : []).filter((d) => d && d.id !== undefined && !gone.has(`${c}/${d.id}`)); };

/* ---------------- 课程地图 ---------------- */

// 掌握的颜色：没写的当「未学」
export const MASTERY_ORDER = ['未学', '讲过', '基础题过', '复现通过', '掉了'];
export const MASTERY_KEY = { 未学: 'none', 讲过: 'taught', 基础题过: 'basic', 复现通过: 'review', 掉了: 'lost' };

/**
 * 讲 → 节 → 块的树：[{ id, title, level, state, tier, points: [{ id, state, tier }], children }]。
 * 块的 state 来自 mastery 里同编号的那条；块里的知识点（L2.2.1#tr）挂在 points 上。节、讲按下面的块汇总（count：各状态几块）。
 */
export function curriculumTree(mem = {}) {
  const cur = live(mem, 'curriculum');
  const mastery = live(mem, 'mastery');
  const mOf = (id) => mastery.find((m) => String(m.id) === String(id));
  const catalog = pointCatalog(mem.sessions || [], mastery);
  const depth = (id) => String(id).split('.').length;
  const parentOf = (d) => d.parent || String(d.id).split('.').slice(0, -1).join('.');
  const node = (d) => {
    const m = mOf(d.id);
    const n = { id: String(d.id), title: d.title || '', level: d.level || ['lecture', 'section', 'block'][depth(d.id) - 1] || 'block', state: m?.state || '未学', tier: m?.tier ?? null, children: [] };
    // 块里的知识点：有掌握状态的，加上归类时用过、还没有状态的（未学）；标题来自归类（skills.js）
    if (n.level === 'block') {
      const pts = mastery.filter((x) => String(x.id).startsWith(`${d.id}#`)).map((x) => ({ id: String(x.id), title: x.title || catalog[x.id]?.title || '', state: x.state, tier: x.tier ?? null }));
      for (const [pid, c] of Object.entries(catalog)) if (c.block === String(d.id) && !pts.some((x) => x.id === pid)) pts.push({ id: pid, title: c.title, state: '未学', tier: null });
      n.points = pts.sort((a, b) => cmpId(a.id, b.id));
    }
    return n;
  };
  const byId = new Map(cur.map((d) => [String(d.id), node(d)]));
  const roots = [];
  for (const d of [...cur].sort((a, b) => cmpId(a.id, b.id))) {
    const n = byId.get(String(d.id));
    const p = byId.get(parentOf(d));
    if (p && p !== n) p.children.push(n); else roots.push(n);
  }
  const tally = (n) => {
    if (!n.children.length) return n.level === 'block' ? { [n.state]: 1 } : {};
    const c = {};
    for (const ch of n.children) for (const [k, v] of Object.entries(tally(ch))) c[k] = (c[k] || 0) + v;
    n.count = c;
    return c;
  };
  roots.forEach(tally);
  return roots;
}

/** 一块的详情：掌握（依据、log）、这块的知识点、相关的错题、弱点、复现组 */
export function blockDetail(mem = {}, id) {
  const b = live(mem, 'curriculum').find((d) => String(d.id) === String(id)) || null;
  const mastery = live(mem, 'mastery').filter((m) => blockOf(m.id) === String(id) || String(m.block || '') === String(id));
  const solved = resolvedErrors(mem);
  const errors = live(mem, 'errors').filter((e) => !e.corrects && blockOf(e.block) === String(id)).map((e) => ({ ...e, resolved: solved.has(String(e.id)) }));
  const errIds = new Set(errors.map((e) => String(e.id)));
  const weaknesses = live(mem, 'weaknesses').filter((w) => list(w.blocks).some((x) => blockOf(x) === String(id)) || list(w.errors).some((e) => errIds.has(e)));
  const reviews = live(mem, 'reviews').filter((r) => list(r.blocks).some((x) => blockOf(x) === String(id)) || list(r.weaknesses).some((w) => weaknesses.some((x) => x.id === w)));
  return { block: b, mastery, errors, weaknesses, reviews };
}

/* ---------------- 证据：某一块 / 某一类的时间线 ---------------- */

/** 一条证据一句话（时间线、依据里用） */
export function evidenceLine(e) {
  if (!e) return '';
  const ok = e.ok === true ? '（对）' : e.ok === false ? '（错）' : '';
  if (e.src === 'say') return e.text ? `说：「${cut(e.text, 80)}」` : `附了 ${list(e.images).length} 张图`;
  if (e.src === 'manual') return `补记：${cut(e.text, 80) || '（截图）'}${e.verdict ? `（${e.verdict}）` : ''}`;
  if (e.src === 'draft') return `没交的草稿：${cut(e.text, 60)}`;
  if (e.src === 'event') return { giveup: '想不出来，直接揭开了', reveal: '揭开了一步', drag: '拖了图', open: '打开了课', end: '下课' }[e.kind] || e.kind;
  const what = e.value ?? e.last ?? e.text ?? '';
  return `${e.kind || '作答'}${e.q ? `「${cutTex(e.q, 50)}」` : ''}${what ? `：${cutTex(what, 40)}` : ''}${ok}${e.giveup ? '，想不出来' : ''}${e.revealed ? '，看了答案' : ''}${Number(e.attempts) > 1 ? `，第 ${e.attempts} 次` : ''}`;
}

/** 这一块（或它里面的知识点）的证据，最近的在前：{ id, at, date, session, src, kind, ok, line, images } */
export function blockTimeline(evidence = [], id, { limit = 60 } = {}) {
  const k = String(id);
  const hit = (e) => blockOf(e.block) === k || list(e.tags).some((t) => blockOf(t) === k);
  return evidence.filter((e) => e && hit(e) && (e.src !== 'event' || ['giveup', 'reveal'].includes(e.kind)))
    .sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, limit)
    .map((e) => ({ id: e.id, at: e.at, date: toDate(e.at), session: e.session || null, src: e.src, kind: e.kind, ok: e.ok ?? null, line: evidenceLine(e), images: list(e.images) }));
}

/* ---------------- 弱点表 ---------------- */

const SCOPE_RANK = { 通用: 0, 链条: 1, 局部: 2 };
const LEVEL_RANK = { L3: 0, L2: 1, L1: 2, L0: 3 };

/** 按影响面（通用 > 链条 > 局部）、证据级（L3 > … > L0）排；关了的放最后。每条带挂着的错题、最近一次改证据级的 log */
export function weaknessRows(mem = {}) {
  const errors = live(mem, 'errors');
  const solved = resolvedErrors(mem);
  const hits = weaknessHits(mem);
  return live(mem, 'weaknesses').map((w) => ({
    ...w,
    // 出现过几次、最近哪天、之后做对过几道（错题档案 + 每节课归类时挂上的，skills.js）
    hits: hits.get(String(w.id)) || null,
    closed: w.status === 'closed',
    errorDocs: list(w.errors).map((id) => errors.find((e) => String(e.id) === id)).filter(Boolean).map((e) => ({ ...e, resolved: solved.has(String(e.id)) })),
    levelLog: (Array.isArray(w.log) ? w.log : []).filter((l) => l?.field === 'level'),
  })).sort((a, b) => (a.closed - b.closed) || (SCOPE_RANK[a.scope] ?? 9) - (SCOPE_RANK[b.scope] ?? 9) || (LEVEL_RANK[a.level] ?? 9) - (LEVEL_RANK[b.level] ?? 9) || cmpId(a.id, b.id));
}

/* ---------------- 错题本 ---------------- */

/**
 * 错题（原条），更正挂在原条下面（fixes）；作废的不列，已解决的标出来。
 * filter：{ block, weakness, state: 'open' | 'resolved' | 'all' }
 */
export function errorRows(mem = {}, { block = '', weakness = '', state = 'all' } = {}) {
  const all = live(mem, 'errors');
  const solved = resolvedErrors(mem);
  const rows = all.filter((e) => !e.corrects).map((e) => ({
    ...e,
    resolved: solved.has(String(e.id)),
    fixes: all.filter((x) => String(x.corrects) === String(e.id)),
  }));
  return rows.filter((e) => (!block || blockOf(e.block).startsWith(block)) && (!weakness || e.weakness === weakness)
    && (state === 'all' || (state === 'resolved' ? e.resolved : !e.resolved)))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || cmpId(b.id, a.id));
}

/* ---------------- 以前的课 ---------------- */

/** 一节课一行：日期、块、时长（课后报告算的）、核验、小结第一句、花了多少；最近的在前 */
export function classRows(mem = {}) {
  const obs = Array.isArray(mem.observations) ? mem.observations : [];
  return (Array.isArray(mem.sessions) ? mem.sessions : []).filter((s) => s && s.id).map((s) => {
    const sum = obs.find((o) => o.id === s.summary) || obs.find((o) => o.session === s.id && o.kind === 'summary');
    const first = String(sum?.text || '').split('\n').map((l) => l.replace(/^[\s\d.、*#-]+/, '').replace(/\*\*/g, '').trim()).find(Boolean) || '';
    return {
      id: s.id, date: s.date || '', block: s.block || '', title: s.title || '', status: s.status || '',
      minutes: s.report?.activeMs ? Math.round(s.report.activeMs / 60000) : null, line: s.report?.line || '',
      verify: s.verify || null, summary: cutMd(first, 80), usage: s.usage || null, review: s.review || null, startedAt: s.startedAt || 0,
      kind: ['talk', 'live', 'unit'].includes(s.kind) ? s.kind : 'class',
      // 课堂里的 Claude 讲的课（课堂、一问一答）：「接着上课」
      teach: isTeach(s),
      // 练一练、课前热身（kind: drill）：列表里照旧算一行，「上一节」不算它
      drill: s.kind === 'drill',
      skills: s.skills || null,
      debrief: s.debrief || null,
    };
  }).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0) || cmpId(b.id, a.id));
}

/* ---------------- 学习统计（不花额度，从每节课的报告算）---------------- */

/**
 * 最近 days 天：每天学了多久、做了几题、一次对几题；每块一共学了多久；每节课的一次做对率（看趋势）。
 * 时长和题数来自每节课的课后报告要点（sessions.report：activeMs、items、first）。
 */
export function learningStats(mem = {}, { today = toDate(Date.now()), days = 14 } = {}) {
  const ss = (Array.isArray(mem.sessions) ? mem.sessions : []).filter((s) => s && s.report);
  const from = addDays(today, -(days - 1));
  const daily = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const mine = ss.filter((s) => (s.date || toDate(s.startedAt)) === d);
    daily.push({ date: d, minutes: Math.round(mine.reduce((n, s) => n + (Number(s.report.activeMs) || 0), 0) / 60000), items: mine.reduce((n, s) => n + (Number(s.report.items) || 0), 0), first: mine.reduce((n, s) => n + (Number(s.report.first) || 0), 0) });
  }
  const blocks = new Map();
  for (const s of ss) {
    const b = s.block || '（没写块）';
    const x = blocks.get(b) || { block: b, minutes: 0, sessions: 0, items: 0, first: 0 };
    x.minutes += (Number(s.report.activeMs) || 0) / 60000;
    x.sessions++;
    x.items += Number(s.report.items) || 0;
    x.first += Number(s.report.first) || 0;
    blocks.set(b, x);
  }
  const trend = [...ss].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)).filter((s) => Number(s.report.items) > 0)
    .map((s) => ({ id: s.id, date: s.date || '', rate: Math.round((Number(s.report.first) / Number(s.report.items)) * 100) }));
  const total = daily.reduce((n, d) => n + d.minutes, 0);
  return { daily, blocks: [...blocks.values()].map((x) => ({ ...x, minutes: Math.round(x.minutes) })).sort((a, b) => b.minutes - a.minutes || cmpId(a.block, b.block)), trend, total, studyDays: daily.filter((d) => d.minutes > 0).length };
}

/* ---------------- 复现：今天先做哪几组，页面自己拼资料包 ---------------- */

// 一节复现课最多几组（我的规则 rule-pre-2：一轮最多 3 组，超出的排队不丢）
export const REVIEW_MAX = 3;

/**
 * 到期的复现组按我的规则排先后（rule-pre-2）：从没复现 > 上次没过 > 过期久。
 * 返回 [{ id, title, days, course, subject, space, why }]（只要过期和今天到期的；停掉、暂停、并掉的不算）
 */
// 复现组排在哪一档：0 从没复现过（还没判过结果；课堂新建的组带着建组那天的 last，不能拿 last 判）、1 上次没过、2 到期了。
// 首页「今天复现」和备课的开头复现共用（books/planview.js），两边挑出来的才一样
export const reviewRank = (r) => (!r?.result || /从未|还没/.test(String(r.result)) ? 0 : /没过|不过/.test(String(r.result)) ? 1 : 2);
export function reviewQueue(mem = {}, { today = toDate(Date.now()) } = {}) {
  const rs = live(mem, 'reviews');
  const rank = reviewRank;
  return dueList(rs, today).filter((d) => d.days <= 0).map((d) => {
    const r = rs.find((x) => String(x.id) === d.id);
    const b = list(r.blocks)[0] || '';
    const k = rank(r);
    return { id: d.id, title: d.title, days: d.days, rank: k, course: courseOf(b), subject: subjectOf(b), space: r.space || spaceOfId(b), why: ['从没复现过', '上次没过', '到期了'][k] };
  }).sort((a, b) => a.rank - b.rank || a.days - b.days || cmpId(a.id, b.id));
}

/**
 * 首页「今天复现」：每门课一行（不分科都列出来，在学英语时也看得到线代积压了多少），
 * 每行先挑排在最前的 REVIEW_MAX 组：[{ course, subject, space, total, pick: [复现组], rest: [复现组] }]，积压多的门课在前。
 * 一节课只上一门课（课堂按门课带组件说明和教法），所以不跨门课混。
 */
export function todayReviews(mem = {}, { today = toDate(Date.now()), max = REVIEW_MAX } = {}) {
  const by = new Map();
  for (const q of reviewQueue(mem, { today })) {
    if (!by.has(q.course)) by.set(q.course, { course: q.course, subject: q.subject, space: q.space, list: [] });
    by.get(q.course).list.push(q);
  }
  return [...by.values()].map((g) => ({ course: g.course, subject: g.subject, space: g.space, total: g.list.length, pick: g.list.slice(0, max), rest: g.list.slice(max) }))
    .sort((a, b) => b.total - a.total || a.course.localeCompare(b.course));
}

/** sessions / 资料包里记的复现组：以前是一个编号，现在是编号的数组（备课写的开头复现是 [{ id, how }]） */
export const reviewIdsOf = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x && typeof x === 'object' ? x.id : x)).filter((x) => x && x !== 'undefined');

/**
 * 开一节复现课（一组或几组，同一门课）：每组的内容、盯的弱点、相关错题原文、相关块的范围，加上以前各节课资料包里同一块的题（packs）。
 * 返回 { main, problems }（和外部写的资料包一样的字段，main 多一个 review：复现组编号的数组）
 * sheets：以前这几块的课下课时整理的「这节课的一页」[{ date, title, md }]（memory/sheet.js），复现课从它开始
 */
export function reviewPack(mem = {}, rids, { packs = [], sheets = [], today = toDate(Date.now()) } = {}) {
  const ids = reviewIdsOf(rids);
  const all = live(mem, 'reviews');
  const groups = ids.map((rid) => { const r = all.find((x) => String(x.id) === rid); if (!r) throw new Error(`复现组里没有 ${rid}`); return r; });
  if (!groups.length) throw new Error('没有要复现的组');
  const solved = resolvedErrors(mem);
  const blocksAll = [];
  const seenErr = new Set();
  const parts = groups.map((r) => {
    const ws = live(mem, 'weaknesses').filter((w) => list(r.weaknesses).includes(String(w.id)));
    const wErr = new Set(ws.flatMap((w) => list(w.errors)));
    const blocks = list(r.blocks).length ? list(r.blocks) : [...new Set(ws.flatMap((w) => list(w.blocks)))];
    for (const b of blocks) if (!blocksAll.includes(b)) blocksAll.push(b);
    // 几组一起上时每组的错题最多几道（资料包有预算）；同一道错题只放一次
    const errs = live(mem, 'errors').filter((e) => !e.corrects && !seenErr.has(String(e.id)) && (wErr.has(String(e.id)) || blocks.includes(blockOf(e.block)))).sort((a, b) => cmpId(a.id, b.id)).slice(0, groups.length > 1 ? 4 : 12);
    for (const e of errs) seenErr.add(String(e.id));
    return { r, ws, errs, blocks, due: reviewDue(r, today), content: list(r.content) };
  });
  const cur = live(mem, 'curriculum').filter((c) => blocksAll.includes(String(c.id)));
  const items = [];
  const seen = new Set();
  for (const p of packs) {
    if (!p || !blocksAll.includes(String(p.block || ''))) continue;
    for (const it of Array.isArray(p.items) ? p.items : []) {
      const k = String(it?.q || '');
      if (!k || seen.has(k)) continue;
      seen.add(k);
      items.push({ ...it, source: it.source || `以前的课 ${p.session || ''}`.trim() });
    }
  }
  const many = groups.length > 1;
  const name = (r) => `${r.id}「${r.title || ''}」${r.family ? `（机制族：${r.family}）` : ''}`;
  const when = ({ r, due }) => `第 ${r.tier} 天那档${due.days !== undefined ? `（${due.days < 0 ? `过期 ${-due.days} 天` : due.days === 0 ? '今天到期' : `还有 ${due.days} 天`}）` : ''}，上次 ${r.last || '还没做过'}${r.result ? `，结果：${r.result}` : ''}`;
  const main = {
    // 给我看的标题不写编号（编号在 review 里）
    unit: `复现 · ${groups.map((r) => r.title || r.id).join('、')}`.trim(),
    goal: `检验${groups.map((r) => `「${r.title || r.id}」`).join('、')}现在还会不会：不看提示、独立做出新题、说得清依据。`,
    block: blocksAll[0] || null,
    review: groups.map((r) => String(r.id)),
    reviewClass: true,
    scope: [
      `这是复现课，不讲新内容：${many ? `${groups.length} 组` : '复现组'} ${parts.map((p) => `${name(p.r)}，${when(p)}`).join('；')}。`,
      ...cur.map((c) => `${c.id} ${c.title || ''}：${c.scope || ''}${c.exam ? `；考试口径：${c.exam}` : ''}`),
    ].join('\n'),
    plan: [
      sheets.length ? `0. 资料包里有以前这${many ? '几' : '一'}块的课整理的一页：从学生当时错的、没拿下的那几处出题（换问法、换场景），不要照抄原题。` : '',
      `1. ${many ? '每组至少一道新题，几组的题混着出、不说是哪一组' : '先出一道这一组的新题'}（不是原题换数，不贴标签），不给提示，让学生独立做完、写出依据。一道题尽量测组里的几个点；组里列的点没测到的，换一道再测，不要测了一两点就算过。`,
      '2. 做对了：换一个角度再出一道，确认不是记住了答案；做错了：先问学生卡在哪，再针对盯的弱点补一小段，最后再出一道同类的新题。',
      `3. 下课整理单里${many ? `每组写一行（${groups.map((r) => r.id).join('、')}）` : '写一行'} review id=${many ? '…' : groups[0].id} result=过 / 没过（依据写那几道题的组件 id）；只测到一部分的组照最弱的那一点判，没测到的点用 add="…" 记进那一组，下次先测；弱点有变化也写。`,
      ...parts.filter((p) => p.content.length).map((p) => `${p.r.id} 的内容：${p.content.join('；')}`),
    ].filter(Boolean).join('\n'),
    student: parts.map((p) => [
      many ? `【${p.r.id} ${p.r.title || ''}】` : '',
      p.ws.length ? `盯的弱点：${p.ws.map((w) => `${w.id} ${w.title}（${w.scope}，${w.level}）`).join('；')}` : '',
      p.errs.length ? `相关错题原文：\n${p.errs.map((e) => `- ${e.id}${solved.has(String(e.id)) ? '（学生标了已解决）' : ''}：题「${cut(e.q, 200)}」；学生写「${cut(e.mine, 120)}」；错在 ${cut(e.step, 80)}；根因 ${cut(e.cause, 120)}`).join('\n')}` : '',
    ].filter(Boolean).join('\n')).filter(Boolean).join('\n\n'),
    ...(sheets.length ? { '以前这一块整理的一页': sheets.map((x) => `【${x.date} ${x.title}】\n${x.md}`).join('\n\n') } : {}),
    updatedAt: Date.now(),
  };
  return { main, problems: items.length ? { items: items.slice(0, 30) } : null };
}

/* ---------------- 复制给外部 Claude 的启动语 ---------------- */

/**
 * 贴进任何一个对话就能接手：说明书在哪、学习台在哪、现在学到哪、上节课怎么样、有什么等着外部做。
 * kitUrl：组件库地址；deskUrl：学习台地址（页面不一定知道，没有就让外部问我）
 */
export function handoffText(mem = {}, { kitUrl = '', deskUrl = '', today = toDate(Date.now()), pack = null, space = 'math' } = {}) {
  const pos = (mem.position || []).find((p) => p.id === positionId(space));
  const rows = classRows(mem);
  const last = rows.find((r) => r.status === 'closed' && !r.drill);
  const opens = rows.filter((r) => r.status === 'open');
  const open = (mem.pending || []).filter((p) => p.status === 'open');
  const gone = voidedIds(mem);
  const proposals = (mem.observations || []).filter((o) => o.kind === 'proposal' && !gone.has(`observations/${o.id}`) && (!last || o.session === last.id));
  const due = dueList(live(mem, 'reviews'), today).filter((d) => d.days <= 0);
  const todo = [];
  const ids = packIds(space);
  // 学习台自己管自己（docs/autonomy-plan.md）：备课、改记忆、判复现都由学习台做，外部只做开发，这里只告诉它现状
  if (!pack) todo.push(`下一节${SPACES[space]?.label || ''}课还没备：学习台首页「让 Claude 备课」自己备（资料包 pack/${ids.main}、pack/${ids.problems}），不用你代写。`);
  if (proposals.length) todo.push(`上一节课堂里的 Claude 留了 ${proposals.length} 条提议（observations 里 kind: proposal）：开发时参考，不用你代写记忆。`);
  if (open.length) todo.push(`还有 ${open.length} 张改动单没写进去（pending，status: open）：学习台首页打开时会自己写，不用你代写。`);
  return [
    `【学习台 · 接手 · ${SPACES[space]?.label || ''}】`,
    `- 学习台：${deskUrl || kitUrl || '（地址问我要：在 claude.ai 打开学习台时地址栏里的那个）'}。说明书、组件写法、记忆、每节课都在它里面：先用 Artifact 工具 action: "read"、path: "CLAUDE-PROJECT.md" 读说明书，记忆用 ArtifactData 读。`,
    `- 这一科：${SPACES[space]?.label || space}（只列这一科的；学习台还有${Object.keys(SPACES).filter((k) => k !== space).map((k) => SPACES[k].label).join('、')}）。`,
    `- 今天 ${today}。${pos ? `学到 ${pos.block || '？'}；下一节：${cut(pos.next, 120)}${list(pos.debts).length ? `；欠账：${list(pos.debts).map((x) => cut(x, 60)).join('；')}` : ''}。` : '还没有 position。'}`,
    last ? `- 上一节：${last.kind === 'class' ? '' : `${{ talk: '一问一答', live: '实时黑板' }[last.kind] || '自学单元'} `}${last.id}（${last.block || '没写块'}）${last.line ? `，${last.line}` : ''}${last.summary ? `；小结开头：${last.summary}` : ''}。课后报告在 sessions/${last.id}/report/main。` : '- 还没有下过课。',
    ...opens.map((r) => (r.kind === 'live'
      ? `- 实时黑板 ${r.id}「${cut(r.title, 40)}」还开着：接着写就往 sessions/${r.id}/steps 写，黑板现状在 sessions/${r.id}/meta/now（说明书第五节）。`
      : r.kind === 'unit' ? `- 自学单元 ${r.id}「${cut(r.title, 40)}」我还没学完。` : `- 有一节${r.kind === 'talk' ? '一问一答的课' : '课堂'}还没下课：${r.id}。`)),
    due.length ? `- 到期的复现组：${due.map((d) => `${d.id}${d.days < 0 ? `（过期 ${-d.days} 天）` : ''}`).join('、')}（学习台首页能直接开复现课）。` : '',
    pack ? `- 已经备好的下一节：${cut(pack.unit || '', 60)}${pack.block ? `（${pack.block}）` : ''}。` : '',
    todo.length ? `- 现状（学习台自己处理，你只做开发）：\n${todo.map((t) => `  - ${t}`).join('\n')}` : '',
    open.length ? `- 还没写进去的改动：${open.slice(0, 6).map((p) => cut(pendingTitle(p), 50)).join('；')}${open.length > 6 ? '……' : ''}` : '',
  ].filter(Boolean).join('\n');
}

export const TIER_LABEL = (tier) => (REVIEW_TIERS.includes(Number(tier)) ? `${tier} 天档` : '');
export { OUTCOME_TEXT, daysBetween };

/* ---------------- 给对话里的 Claude 的开场简报（docs/memory-plan.md）---------------- */

// 页面写进 meta/brief（数学）、meta/brief-cs、meta/brief-en：对话里的 Claude 开场 get 一份，就知道现在学到哪、
// 有什么等它做，和这一科记忆库里每一样东西的编号（一条一行，要全文再按编号读），不用一类一类 list 十几次
export const BRIEF_MAX = 24 * 1024;
export const briefId = (space) => (space === 'math' ? 'brief' : `brief-${space}`);
export function deskBrief(mem = {}, { space = 'math', today = toDate(Date.now()), kitUrl = '', deskUrl = '', pack = null, books = [] } = {}) {
  const mine = books.filter((b) => !b.space || b.space === space);
  const head = handoffText(filterSpace(mem, space), { kitUrl, deskUrl, today, pack, space })
    + (mine.length ? `\n- 学习台里的资料（books，条目在 books/{编号}/chunks）：${mine.map((b) => `${b.id}《${cut(b.title, 30)}》${b.chunks ? ` ${b.chunks} 条` : ''}${b.status === 'partial' ? '（没转完）' : ''}`).join('；')}。` : '');
  const view = classView(mem, { space, forClass: false });
  const cat = memoryCatalog(view, { tools: false, today, max: BRIEF_MAX - utf8(head) - 600 });
  const how = '要哪一条的全文，用 ArtifactData 按编号读（get；同一类几条用 query 的 where id in […]）。这份是页面在学习台打开时写的（看 at）；隔了很久没打开，或者你刚写过记忆，以数据库为准。';
  const body = cat.text.replace(/（没放全文的）/g, '').replace(/（没放全文的，/g, '（');
  return { space, text: `${head}\n\n${how}\n\n${body.replace(/^## 目录（记忆库里没放全文的，一条一行）\n\n这个查看方式不支持工具，目录里的东西取不了全文。\n\n/, '## 这一科记忆库里有什么（一条一行）\n\n')}`, today };
}
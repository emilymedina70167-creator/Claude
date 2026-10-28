// 学习台给我看的页面（docs/desk-plan.md 第 3、4 批）里不碰 DOM 的部分，有测试（tests/memory-views.test.js）。
// 页面都只读、不调用 Claude：课程地图、弱点表、错题本、以前的课、某一块的作答时间线、学习统计；
// 还有两样拼文字的：复现课的资料包（页面自己拼，不用外部备课）、复制给外部 Claude 的启动语。
import { REVIEW_TIERS, toDate, addDays, daysBetween, reviewDue, dueList } from './schema.js';
import { voidedIds, resolvedErrors, pendingTitle } from './memo.js';
import { OUTCOME_TEXT } from './report.js';
import { SPACES, positionId, packIds, filterSpace } from './space.js';
import { classView, memoryCatalog, utf8 } from './digest.js';

const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
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
  const depth = (id) => String(id).split('.').length;
  const parentOf = (d) => d.parent || String(d.id).split('.').slice(0, -1).join('.');
  const node = (d) => {
    const m = mOf(d.id);
    const n = { id: String(d.id), title: d.title || '', level: d.level || ['lecture', 'section', 'block'][depth(d.id) - 1] || 'block', state: m?.state || '未学', tier: m?.tier ?? null, children: [] };
    if (n.level === 'block') n.points = mastery.filter((x) => String(x.id).startsWith(`${d.id}#`)).map((x) => ({ id: String(x.id), state: x.state, tier: x.tier ?? null })).sort((a, b) => cmpId(a.id, b.id));
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
  return live(mem, 'weaknesses').map((w) => ({
    ...w,
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
      verify: s.verify || null, summary: cut(first, 80), usage: s.usage || null, review: s.review || null, startedAt: s.startedAt || 0,
      kind: ['live', 'unit'].includes(s.kind) ? s.kind : 'class',
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

/* ---------------- 复现课：页面自己拼资料包 ---------------- */

/**
 * 到期的复现组一键开课：这一组的内容、盯的弱点、相关错题原文、相关块的范围，加上以前各节课资料包里同一块的题（packs）。
 * 返回 { main, problems }（和外部写的资料包一样的字段，main 多一个 review）
 */
export function reviewPack(mem = {}, rid, { packs = [], today = toDate(Date.now()) } = {}) {
  const r = live(mem, 'reviews').find((x) => String(x.id) === String(rid));
  if (!r) throw new Error(`复现组里没有 ${rid}`);
  const ws = live(mem, 'weaknesses').filter((w) => list(r.weaknesses).includes(String(w.id)));
  const wErr = new Set(ws.flatMap((w) => list(w.errors)));
  const blocks = list(r.blocks).length ? list(r.blocks) : [...new Set(ws.flatMap((w) => list(w.blocks)))];
  const solved = resolvedErrors(mem);
  const errs = live(mem, 'errors').filter((e) => !e.corrects && (wErr.has(String(e.id)) || blocks.includes(blockOf(e.block)))).sort((a, b) => cmpId(a.id, b.id));
  const cur = live(mem, 'curriculum').filter((c) => blocks.includes(String(c.id)));
  const due = reviewDue(r, today);
  const content = list(r.content);
  const items = [];
  const seen = new Set();
  for (const p of packs) {
    if (!p || !blocks.includes(String(p.block || ''))) continue;
    for (const it of Array.isArray(p.items) ? p.items : []) {
      const k = String(it?.q || '');
      if (!k || seen.has(k)) continue;
      seen.add(k);
      items.push({ ...it, source: it.source || `以前的课 ${p.session || ''}`.trim() });
    }
  }
  const main = {
    unit: `复现 ${r.id} · ${r.title || ''}`.trim(),
    goal: `检验「${r.title || r.id}」${r.family ? `（机制族：${r.family}）` : ''}现在还会不会：不看提示独立做出来、说得清为什么。`,
    block: blocks[0] || null,
    review: String(r.id),
    scope: [
      `这是复现课，不讲新内容：复现组 ${r.id}，第 ${r.tier} 天那档${due.days !== undefined ? `（${due.days < 0 ? `过期 ${-due.days} 天` : due.days === 0 ? '今天到期' : `还有 ${due.days} 天`}）` : ''}，上次 ${r.last || '还没做过'}${r.result ? `，结果：${r.result}` : ''}。`,
      ...cur.map((c) => `${c.id} ${c.title || ''}：${c.scope || ''}${c.exam ? `；考试口径：${c.exam}` : ''}`),
    ].join('\n'),
    plan: [
      '1. 先出一道这一组的题，不给提示，让学生独立做完、说出理由。',
      '2. 做对了：换一个角度再出一道（换数、换问法），确认不是记住了答案；做错了：先问学生卡在哪，再针对盯的弱点补一小段，最后再出一道同类题。',
      '3. 下课整理单里写 review id=' + r.id + ' result=过 / 没过（依据写那几道题的组件 id），弱点有变化也写。',
      content.length ? `这一组的内容：${content.join('；')}` : '',
    ].filter(Boolean).join('\n'),
    student: [
      ws.length ? `盯的弱点：${ws.map((w) => `${w.id} ${w.title}（${w.scope}，${w.level}）`).join('；')}` : '',
      errs.length ? `相关错题原文：\n${errs.map((e) => `- ${e.id}${solved.has(String(e.id)) ? '（学生标了已解决）' : ''}：题「${cut(e.q, 200)}」；学生写「${cut(e.mine, 120)}」；错在 ${cut(e.step, 80)}；根因 ${cut(e.cause, 120)}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'),
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
  const last = rows.find((r) => r.status === 'closed');
  const opens = rows.filter((r) => r.status === 'open');
  const open = (mem.pending || []).filter((p) => p.status === 'open');
  const gone = voidedIds(mem);
  const proposals = (mem.observations || []).filter((o) => o.kind === 'proposal' && !gone.has(`observations/${o.id}`) && (!last || o.session === last.id));
  const due = dueList(live(mem, 'reviews'), today).filter((d) => d.days <= 0);
  const todo = [];
  const ids = packIds(space);
  if (!pack) todo.push(`备下一节${SPACES[space]?.label || ''}课：往学习台写资料包 pack/${ids.main}、pack/${ids.problems}（说明书第六节「在学习台里开一节课」、第七节「分科」）。`);
  if (proposals.length) todo.push(`看上一节课堂里的 Claude 的提议（observations 里 kind: proposal，${proposals.length} 条），掌握状态、规则只能由你决定。`);
  if (open.length) todo.push(`还有 ${open.length} 张改动单等我确认（pending，status: open）：我在学习台上点，你不用代写。`);
  return [
    `【学习台 · 接手 · ${SPACES[space]?.label || ''}】`,
    `- 学习台：${deskUrl || kitUrl || '（地址问我要：在 claude.ai 打开学习台时地址栏里的那个）'}。说明书、组件写法、记忆、每节课都在它里面：先用 Artifact 工具 action: "read"、path: "CLAUDE-PROJECT.md" 读说明书，记忆用 ArtifactData 读。`,
    `- 这一科：${SPACES[space]?.label || space}（只列这一科的；学习台还有${Object.keys(SPACES).filter((k) => k !== space).map((k) => SPACES[k].label).join('、')}）。`,
    `- 今天 ${today}。${pos ? `学到 ${pos.block || '？'}；下一节：${cut(pos.next, 120)}${list(pos.debts).length ? `；欠账：${list(pos.debts).map((x) => cut(x, 60)).join('；')}` : ''}。` : '还没有 position。'}`,
    last ? `- 上一节：${last.kind === 'class' ? '' : `${last.kind === 'live' ? '实时黑板' : '自学单元'} `}${last.id}（${last.block || '没写块'}）${last.line ? `，${last.line}` : ''}${last.summary ? `；小结开头：${last.summary}` : ''}。课后报告在 sessions/${last.id}/report/main。` : '- 还没有下过课。',
    ...opens.map((r) => (r.kind === 'live'
      ? `- 实时黑板 ${r.id}「${cut(r.title, 40)}」还开着：接着写就往 sessions/${r.id}/steps 写，黑板现状在 sessions/${r.id}/meta/now（说明书第五节）。`
      : r.kind === 'unit' ? `- 自学单元 ${r.id}「${cut(r.title, 40)}」我还没学完。` : `- 有一节课堂还没下课：${r.id}。`)),
    due.length ? `- 到期的复现组：${due.map((d) => `${d.id}${d.days < 0 ? `（过期 ${-d.days} 天）` : ''}`).join('、')}（学习台首页能直接开复现课）。` : '',
    pack ? `- 已经备好的下一节：${cut(pack.unit || '', 60)}${pack.block ? `（${pack.block}）` : ''}。` : '',
    todo.length ? `- 等你做的：\n${todo.map((t) => `  - ${t}`).join('\n')}` : '- 现在没有等你做的。',
    open.length ? `- 等我确认的改动：${open.slice(0, 6).map((p) => cut(pendingTitle(p), 50)).join('；')}${open.length > 6 ? '……' : ''}` : '',
  ].filter(Boolean).join('\n');
}

export const TIER_LABEL = (tier) => (REVIEW_TIERS.includes(Number(tier)) ? `${tier} 天档` : '');
export { OUTCOME_TEXT, daysBetween };

/* ---------------- 给对话里的 Claude 的开场简报（docs/memory-plan.md）---------------- */

// 页面写进 meta/brief（数学）、meta/brief-cs、meta/brief-en：对话里的 Claude 开场 get 一份，就知道现在学到哪、
// 有什么等它做，和这一科记忆库里每一样东西的编号（一条一行，要全文再按编号读），不用一类一类 list 十几次
export const BRIEF_MAX = 24 * 1024;
export const briefId = (space) => (space === 'math' ? 'brief' : `brief-${space}`);
export function deskBrief(mem = {}, { space = 'math', today = toDate(Date.now()), kitUrl = '', deskUrl = '', pack = null } = {}) {
  const head = handoffText(filterSpace(mem, space), { kitUrl, deskUrl, today, pack, space });
  const view = classView(mem, { space, forClass: false });
  const cat = memoryCatalog(view, { tools: false, today, max: BRIEF_MAX - utf8(head) - 600 });
  const how = '要哪一条的全文，用 ArtifactData 按编号读（get；同一类几条用 query 的 where id in […]）。这份是页面在学习台打开时写的（看 at）；隔了很久没打开，或者你刚写过记忆，以数据库为准。';
  const body = cat.text.replace(/（没放全文的）/g, '').replace(/（没放全文的，/g, '（');
  return { space, text: `${head}\n\n${how}\n\n${body.replace(/^## 目录（记忆库里没放全文的，一条一行）\n\n这个查看方式不支持工具，目录里的东西取不了全文。\n\n/, '## 这一科记忆库里有什么（一条一行）\n\n')}`, today };
}
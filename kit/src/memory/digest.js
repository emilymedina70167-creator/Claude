// 记忆摘要：课堂里的 Claude 每一轮带着的那份「对学生的了解」（docs/learner-memory-spec.md 第 3 节、docs/memory-plan.md）。纯函数，有测试。
// 课堂里的 Claude 没有记忆：每一轮只看得到页面这一轮发给它的文字，每多发 1 KB，整节课每一轮都多付 1 KB。所以分两层：
// - 全文（必读）：和这节课直接有关的——规则（给课堂的、这一科的）、关于学生（这一科的）、上一节停在哪、这一块、以前学这一块的课、
//   相关的弱点和错题原文、掌握、最近的失误、等确认的改动；这一块的长原文放最后
// - 目录（一条一行，只有编号和一句话）：记忆库里其余的东西都列出来（规则、弱点、错题、掌握、复现组、以前的课、课程地图、较早的失误），
//   它看到编号才知道「有这么一条」，要用时 memory_read 按编号取全文（一次可以取好几条）
// 规则最多占全文预算的 RULES_SHARE（红线、掌握、检验、讲解在前），放不下的进目录：真实的记忆库里规则有十几 KB，
// 不限的话全被规则占满（2026-10-29 用真数据量出来的）。目录有自己的上限 CATALOG_MAX，太长时远处的错题、掌握收成按块的编号。
// 撤销了的（status: void、有一条作废的更正指向它）不带；学生标了已解决的错题注明；还在等学生确认的改动单列出来，免得它再提一遍。
import { voidedIds, resolvedErrors, pendingTitle } from './memo.js';
import { filterSpace, spaceOfId, positionId, sharedFor } from './space.js';
import { dueList, toDate } from './schema.js';

const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
export const utf8 = (s) => (enc ? enc.encode(String(s)).length : Buffer.byteLength(String(s)));
const one = (s, n = 400) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(String);
const byDate = (k) => (a, b) => String(b?.[k] || '').localeCompare(String(a?.[k] || ''));
const cmpId = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
// 块的编号：L2.2.1；知识点：L2.2.1#tr → 所在的块 L2.2.1
const blockOf = (id) => String(id || '').split('#')[0];
const sectionOf = (id) => blockOf(id).split('.').slice(0, 2).join('.');
export const RULES_SHARE = 0.6;
export const CATALOG_MAX = 7 * 1024;
const ERRORS_FULL = 8; // 相关的错题最多带几条原文（这一块的、最新的在前），其余进目录
const SLIPS_FULL = 6;
// 规则的类别：课堂里最要紧的在前（放不下时后面的进目录）
const RULE_ORDER = ['红线', '掌握', '检验', '讲解', '教法', '黑板', '细则', '来源'];
const ruleRank = (r) => { const i = RULE_ORDER.indexOf(String(r.cat || '')); return i < 0 ? RULE_ORDER.length : i; };

/** 这节课有关的块：当前块、它依赖的块、依赖它的块、同一节里紧挨着的前后两块 */
export function nearBlocks(curriculum, block) {
  const docs = (curriculum || []).filter((d) => d && d.id);
  const cur = docs.find((d) => d.id === block);
  if (!cur) return { cur: null, near: [] };
  const parentOf = (d) => d.parent || String(d.id).split('.').slice(0, -1).join('.');
  const isBlock = (d) => (d.level || (String(d.id).split('.').length === 3 ? 'block' : '')) === 'block';
  const row = docs.filter((d) => (isBlock(d) && parentOf(d) === parentOf(cur)) || d.id === block).sort((a, b) => cmpId(a.id, b.id));
  const at = row.findIndex((d) => d.id === block);
  const adj = [row[at - 1], row[at + 1]].filter(Boolean);
  const req = list(cur.requires).map((id) => docs.find((d) => d.id === id)).filter(Boolean);
  const users = docs.filter((d) => isBlock(d) && list(d.requires).includes(block));
  const near = [...new Map([...req, ...adj, ...users].filter((d) => d.id !== block).map((d) => [d.id, d])).values()];
  return { cur, near };
}

/**
 * 课堂里的 Claude 能看到的那份记忆（这一科的；规则去掉 for: chat 的）。memoryDigest 和对话里的 Claude 的开场简报都从它出发。
 * 返回 { space, mem（过滤好的）, gone, solved, position, here（这节课的块）}
 */
export function classView(mem0 = {}, { block = '', forClass = true, space: sp = '' } = {}) {
  const space = sp || spaceOfId(block || (mem0.position || []).find((d) => d?.id === 'now')?.block);
  const mem = filterSpace(mem0, space);
  for (const c of ['rules', 'profile', 'slips']) mem[c] = sharedFor(mem[c], space);
  if (forClass) mem.rules = (mem.rules || []).filter((r) => r?.for !== 'chat');
  const gone = voidedIds(mem);
  const solved = resolvedErrors(mem);
  // 作废的、更正别的条目的（作废更正、「已解决」那条）都不单独带：原条上注明
  const get = (c) => (Array.isArray(mem[c]) ? mem[c].filter((d) => d && d.id !== undefined && !gone.has(`${c}/${d.id}`) && !(c === 'errors' && d.corrects && (d.void || d.resolved))) : []);
  const position = get('position').find((d) => d.id === positionId(space)) || null;
  return { space, mem, get, gone, solved, position, here: String(block || position?.block || '') };
}

const ruleLine = (r) => `- ${r.cat ? `［${one(r.cat, 20)}］` : ''}${String(r.text ?? '').trim()}`;
const errorFull = (e, solved) => [
  `- ${e.id}${e.source ? `（${one(e.source, 60)}）` : ''}${e.date ? ` ${e.date}` : ''}${e.block ? `，${e.block}` : ''}${e.weakness ? `，挂 ${e.weakness}` : ''}${e.corrects ? `，更正 ${e.corrects}` : ''}${solved.has(String(e.id)) ? '，学生标了已解决' : ''}`,
  e.q ? `  - 题面：${one(e.q, 600)}` : '', e.mine ? `  - 学生的答案：${one(e.mine, 400)}` : '', e.step ? `  - 错在：${one(e.step, 200)}` : '', e.cause ? `  - 根因：${one(e.cause, 300)}` : '',
].filter(Boolean).join('\n');
// 以前的一节课：一行要点（哪一种课、哪一块、报告的一行、小结的开头）
const KIND = { live: '实时黑板', unit: '自学单元' };
const sessionLine = (s, obs, n = 80) => {
  const sum = obs.find((o) => o.id === s.summary) || obs.find((o) => o.session === s.id && o.kind === 'summary');
  const first = String(sum?.text || '').split('\n').map((l) => l.replace(/^[\s\d.、*#-]+/, '').replace(/\*\*/g, '').trim()).filter(Boolean);
  return { head: `${s.id}${KIND[s.kind] ? ` ${KIND[s.kind]}` : ''}${s.block ? ` ${s.block}` : ''}${s.status === 'open' ? '（没下课）' : ''}`, line: one(s.report?.line || '', 80), sum: first.slice(0, 3).map((l) => one(l, n)) };
};

/**
 * mem：{ rules, profile, curriculum, weaknesses, errors, mastery, reviews, slips, position, observations, pending, sessions }（每类一个数组，缺的当空）；
 * block：这节课的块（没有就用 position 里的）；budget：字节上限（规则、全文、目录合起来）；session：这节课的编号；
 * tools：这个查看方式能不能用 memory_read；today：算复现组到期用。
 * 返回 { rules（给「角色和红线」那一节的规则全文）, text（全文 + 目录）, cut: [{ coll, more, ids }]（没放全文、在目录里的）, bytes }
 */
export function memoryDigest(mem0 = {}, { block = '', budget = 24 * 1024, session = '', tools = true, today = toDate(Date.now()) } = {}) {
  const view = classView(mem0, { block });
  const { mem, get, solved, position, here } = view;
  const { cur, near } = nearBlocks(get('curriculum'), here);
  const nearIds = new Set([here, ...near.map((d) => d.id)].filter(Boolean));
  const shown = new Set(); // 'errors/L2-07'：放了全文的，目录里不再列

  // —— 全文的各节：标题 + 一条条（按优先级排好）。每条记着它是哪一类哪一条（进了全文就不进目录）——
  const sections = [];
  const rules = get('rules').filter((r) => r.status !== 'void').sort((a, b) => ruleRank(a) - ruleRank(b) || cmpId(a.id, b.id));
  sections.push({ coll: 'rules', share: RULES_SHARE, items: rules.map((r) => ({ key: `rules/${r.id}`, text: ruleLine(r) })) });
  sections.push({ coll: 'profile', head: '## 学生（profile）', items: get('profile').map((p) => ({ key: `profile/${p.id}`, text: `- ${p.topic ? `${one(p.topic, 30)}：` : ''}${one(p.text, 600)}` })) });
  // 上一节停在哪：很短、每节课开头都要用
  if (position) {
    sections.push({
      coll: 'position', head: '## 上一节停在哪（position）',
      items: [{ key: `position/${position.id}`, text: [
        position.block ? `- 学到：${position.block}` : '', position.next ? `- 这一节从哪接：${one(position.next, 400)}` : '',
        list(position.first).length ? `- 先收的题：${list(position.first).map((x) => one(x, 200)).join('；')}` : '', list(position.debts).length ? `- 欠账：${list(position.debts).map((x) => one(x, 200)).join('；')}` : '',
      ].filter(Boolean).join('\n') }],
    });
  }
  const cItems = [];
  if (cur) {
    const lines = [`### 这节课的块：${cur.id}${cur.title ? ` ${one(cur.title, 80)}` : ''}`];
    if (cur.scope) lines.push(`- 范围：${one(cur.scope, 800)}`);
    if (cur.depth) lines.push(`- 详略：${one(cur.depth, 400)}`);
    if (cur.exam) lines.push(`- 考试口径：${one(cur.exam, 600)}`);
    const pts = list(cur.points);
    if (pts.length) lines.push(`- 文稿要点（按视频顺序）：\n${pts.map((p, i) => `  ${i + 1}. ${one(p, 300)}`).join('\n')}`);
    if (list(cur.requires).length) lines.push(`- 准入依赖：${list(cur.requires).join('、')}`);
    cItems.push({ key: `curriculum/${cur.id}`, text: lines.join('\n') });
  } else {
    cItems.push({ text: here ? `（课程地图里还没有块 ${here}。）` : '（这节课没有指定块。）' });
  }
  if (near.length) cItems.push({ text: `### 相邻的块（只给范围）\n${near.map((d) => `- ${d.id}${d.title ? ` ${one(d.title, 60)}` : ''}${d.scope ? `：${one(d.scope, 200)}` : ''}`).join('\n')}` });
  sections.push({ coll: 'curriculum', head: '## 课程地图（curriculum）', items: cItems });

  // 以前学这一块（和挨着的块）的课：最近两节，报告的一行 + 小结开头。上一节怎么样，开课就要知道
  const obs = get('observations');
  const before = get('sessions').filter((s) => s.id !== session && nearIds.has(String(s.block || '')) && (s.report || s.summary || s.status === 'closed'))
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 2);
  sections.push({
    coll: 'sessions', head: '## 以前学这一块的课（sessions，最近的在前）',
    items: before.map((s) => { const x = sessionLine(s, obs, 160); return { key: `sessions/${s.id}`, text: `- ${x.head}${s.date ? ` ${s.date}` : ''}${x.line ? `：${x.line}` : ''}${x.sum.length ? `\n  - 小结：${x.sum.join(' / ')}` : ''}` }; }),
  });

  // 相关的错题：块挨着这节课的，或者挂在相关弱点上的。相关的弱点：管着这几块的、挂着这些错题的、影响面是「通用」的
  const errors = get('errors');
  const weak = get('weaknesses').filter((w) => w.status !== 'closed' && w.status !== 'void');
  const nearErr = new Set(errors.filter((e) => nearIds.has(blockOf(e.block))).map((e) => String(e.id)));
  const relW = weak.filter((w) => list(w.blocks).some((b) => nearIds.has(blockOf(b))) || list(w.errors).some((e) => nearErr.has(e)) || w.scope === '通用');
  const touch = (w) => (list(w.blocks).includes(here) || list(w.errors).some((e) => errors.find((x) => x.id === e)?.block === here) ? 0 : 1);
  relW.sort((a, b) => touch(a) - touch(b) || byDate('last')(a, b));
  const relWIds = new Set(relW.map((w) => String(w.id)));
  sections.push({
    coll: 'weaknesses', head: '## 相关的弱点（weaknesses）',
    items: relW.map((w) => ({ key: `weaknesses/${w.id}`, text: `- ${w.id} ${one(w.title, 120)}（${[w.scope, w.level ? `证据级 ${w.level}` : '', w.last ? `最近 ${w.last}` : '', list(w.errors).length ? `错题 ${list(w.errors).join('、')}` : ''].filter(Boolean).join('，')}）` })),
  });
  // 这一块的在前，同一块里最新的在前；最多 ERRORS_FULL 条原文，其余在目录里（一条一行：编号、块、根因）
  const relE = errors.filter((e) => nearErr.has(String(e.id)) || relWIds.has(String(e.weakness)))
    .sort((a, b) => (blockOf(a.block) === here ? 0 : 1) - (blockOf(b.block) === here ? 0 : 1) || byDate('date')(a, b) || cmpId(b.id, a.id));
  sections.push({ coll: 'errors', head: '## 相关的错题（errors，原文，这一块的、最近的在前）', limit: ERRORS_FULL, items: relE.map((e) => ({ key: `errors/${e.id}`, text: errorFull(e, solved) })) });
  const relM = get('mastery').filter((m) => nearIds.has(blockOf(m.block || m.id)))
    .sort((a, b) => (blockOf(a.id) === here ? 0 : 1) - (blockOf(b.id) === here ? 0 : 1) || cmpId(a.id, b.id));
  sections.push({ coll: 'mastery', head: '## 掌握状态（mastery，只读：你不能宣布掌握）', items: relM.map((m) => ({ key: `mastery/${m.id}`, text: `- ${m.id}：${m.state}${m.state === '复现通过' && m.tier ? `（第 ${m.tier} 天那档）` : ''}` })) });
  const slips = get('slips').sort(byDate('date'));
  sections.push({ coll: 'slips', head: '## 别再犯（两个 Claude 以前的教学失误，最近的在前）', limit: SLIPS_FULL, items: slips.map((s) => ({ key: `slips/${s.id}`, text: `- ${s.date || ''}（${s.by === 'class' ? '课堂里的 Claude' : '对话里的 Claude'}）${one(s.text, 300)}${s.lesson ? ` → ${one(s.lesson, 200)}` : ''}` })) });
  // 还在等学生确认的改动（memo 写的错题、弱点、复现组、位置）：已经提过了，别再提
  const open = (Array.isArray(mem.pending) ? mem.pending : []).filter((p) => p && p.status === 'open').sort((a, b) => (a.at || 0) - (b.at || 0));
  sections.push({ coll: 'pending', head: '## 已经提了、等学生确认的改动（不用再提）', items: open.map((p) => ({ text: `- ${one(pendingTitle(p), 160)}` })) });
  // 这一块的文稿原文、教材原文：长，放最后（放不下就在目录里写一句，用 memory_read 取 curriculum 的这一块）
  const src = [];
  if (cur?.transcript) src.push({ text: `### ${cur.id} 的文稿原文\n${String(cur.transcript).trim()}` });
  for (const t of cur ? (Array.isArray(cur.textbook) ? cur.textbook : list(cur.textbook).map((text) => ({ text }))) : []) {
    if (t && (t.text || t.ref)) src.push({ text: `### 教材原文${t.ref ? `（${one(t.ref, 80)}）` : ''}\n${String(t.text || '（只有原图）').trim()}` });
  }
  sections.push({ coll: 'source', head: '## 这一块的原文（curriculum）', items: src });

  // —— 先给目录留出位置，全文按优先级往剩下的预算里装：一条放不下，它和后面的全都不放（从后往前截）——
  const intro = `这节课在学习台里上${session ? `（${session}）` : ''}。下面是学习台记忆库里你能看的部分，由项目对话里的 Claude 维护；你只能读，不能改（掌握、弱点、错题、复现都由它课后看证据判断）。前面是和这节课直接有关的**全文**，最后是记忆库里其余东西的**目录**（一条一行）。`;
  const reserve = Math.min(CATALOG_MAX, Math.floor(budget * 0.3));
  const room = budget - reserve;
  let used = utf8(intro);
  let rulesText = '';
  const body = [intro];
  let full = false;
  let srcCut = 0;
  for (const s of sections) {
    if (!s.items.length) continue;
    const kept = [];
    let own = 0;
    const cap = s.share ? Math.floor(room * s.share) : Infinity;
    for (const it of s.items) {
      if (full || (s.limit && kept.length >= s.limit)) break;
      // 规则单独放；别的节：第一条带上小标题，节和节之间空一行
      const add = utf8(it.text) + 1 + (kept.length || !s.head ? 0 : utf8(s.head) + 4);
      if (own + add > cap) break;
      if (used + add > room) { full = true; break; }
      used += add;
      own += add;
      kept.push(it.text);
      if (it.key) shown.add(it.key);
    }
    if (s.coll === 'source') srcCut = s.items.length - kept.length;
    if (s.coll === 'rules') { rulesText = kept.join('\n'); continue; }
    if (kept.length) body.push(`${s.head}\n\n${kept.join('\n')}`);
  }
  const cat = memoryCatalog(view, { shown, here, nearIds, session, today, tools, srcCut, max: Math.max(1024, budget - used - 200) });
  if (cat.text) body.push(cat.text);
  const text = body.join('\n\n');
  return { rules: rulesText, text, cut: cat.cut, bytes: utf8(text) + utf8(rulesText) };
}

/**
 * 目录：记忆库里没放全文的东西，一条一行（编号 + 一句话），让 Claude 知道有什么、要时按编号取。
 * view：classView 的结果；shown：已经放了全文的（'errors/L2-07'）；max：字节上限（超了先把远处的错题、掌握收成按块的编号，再收别的）。
 * 返回 { text, cut: [{ coll, more, ids }] }
 */
export function memoryCatalog(view, { shown = new Set(), here = view.here, nearIds = new Set([here]), session = '', today = toDate(Date.now()), tools = true, srcCut = 0, max = CATALOG_MAX } = {}) {
  const { get, solved } = view;
  const not = (c) => (d) => !shown.has(`${c}/${d.id}`);
  const cut = [];
  const note = (coll, docs) => { if (docs.length) cut.push({ coll, more: docs.length, ids: docs.map((d) => String(d.id)) }); };
  // 每一节：详的写法（一条一行）和省的写法（只列编号）；放不下时从后往前换成省的
  const parts = [];
  const rules = get('rules').filter((r) => r.status !== 'void').filter(not('rules')).sort((a, b) => ruleRank(a) - ruleRank(b) || cmpId(a.id, b.id));
  note('rules', rules);
  if (rules.length) parts.push({ head: '规则（没放全文的）', full: rules.map((r) => `${r.id}［${one(r.cat, 8)}］${one(r.text, 34)}`), short: [rules.map((r) => r.id).join('、')] });
  const prof = get('profile').filter(not('profile'));
  note('profile', prof);
  if (prof.length) parts.push({ head: '关于学生（没放全文的）', full: prof.map((p) => `${p.id} ${one(p.topic, 10)}：${one(p.text, 30)}`), short: [prof.map((p) => p.id).join('、')] });
  // 以前的课（这一科，最近 8 节，不含这一节和全文里那两节）
  const obs = get('observations');
  const ss = get('sessions').filter((s) => s.id !== session).filter(not('sessions')).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  if (ss.length) {
    const top = ss.slice(0, 8);
    parts.push({ head: `以前的课（最近 ${top.length} 节${ss.length > 8 ? `，一共 ${ss.length} 节` : ''}）`, full: top.map((s) => { const x = sessionLine(s, obs, 40); return `${x.head}${s.date ? ` ${s.date.slice(5)}` : ''}${x.line ? `：${x.line}` : x.sum[0] ? `：${x.sum[0]}` : ''}`; }), short: [top.map((s) => s.id).join('、')] });
  }
  const weak = get('weaknesses').filter(not('weaknesses'));
  const openW = weak.filter((w) => w.status !== 'closed' && w.status !== 'void').sort((a, b) => cmpId(a.id, b.id));
  const closedW = weak.filter((w) => w.status === 'closed');
  note('weaknesses', openW);
  if (openW.length || closedW.length) parts.push({ head: '弱点（没放全文的）', full: [...openW.map((w) => `${w.id} ${one(w.title, 36)}（${[w.scope, w.level].filter(Boolean).join('，')}）`), ...(closedW.length ? [`已关闭：${closedW.map((w) => w.id).join('、')}`] : [])], short: [openW.map((w) => w.id).join('、') + (closedW.length ? `；已关闭 ${closedW.length} 条` : '')] });
  // 错题：挨着这节课的一条一行（编号、块、根因），远处的按块只列编号
  const errs = get('errors').filter(not('errors'));
  note('errors', errs);
  if (errs.length) {
    const nearE = errs.filter((e) => nearIds.has(blockOf(e.block))).sort((a, b) => cmpId(a.id, b.id));
    const far = errs.filter((e) => !nearIds.has(blockOf(e.block)));
    const groups = new Map();
    for (const e of far) { const k = blockOf(e.block) || '（没挂块）'; groups.set(k, [...(groups.get(k) || []), e]); }
    const farLines = [...groups.entries()].sort((a, b) => cmpId(a[0], b[0])).map(([k, es]) => `${k}：${es.sort((a, b) => cmpId(a.id, b.id)).map((e) => `${e.id}${solved.has(String(e.id)) ? '✓' : ''}`).join('、')}`);
    const bySec = new Map();
    for (const e of far) { const k = sectionOf(e.block) || '（没挂块）'; bySec.set(k, (bySec.get(k) || 0) + 1); }
    parts.push({
      head: `错题（没放全文的，${errs.length} 条；✓ 是学生标了已解决）`,
      full: [...nearE.map((e) => `${e.id}（${e.block || '？'}）${one(e.cause || e.step || e.q, 30)}${solved.has(String(e.id)) ? ' ✓' : ''}`), ...farLines],
      short: [...nearE.map((e) => `${e.id}（${e.block || '？'}）`), ...[...bySec.entries()].map(([k, n]) => `${k} 有 ${n} 条`)],
    });
  }
  const mast = get('mastery').filter(not('mastery'));
  if (mast.length) {
    const bySec = new Map();
    for (const m of mast) { const k = sectionOf(m.block || m.id); bySec.set(k, [...(bySec.get(k) || []), m]); }
    const count = (ms) => Object.entries(ms.reduce((o, m) => ({ ...o, [m.state]: (o[m.state] || 0) + 1 }), {})).map(([s, n]) => `${s} ${n}`).join('，');
    parts.push({ head: '掌握状态（没放全文的）', full: [...bySec.entries()].sort((a, b) => cmpId(a[0], b[0])).map(([k, ms]) => `${k}：${ms.sort((a, b) => cmpId(a.id, b.id)).map((m) => `${m.id} ${m.state}`).join('、')}`), short: [...bySec.entries()].map(([k, ms]) => `${k}：${count(ms)}`) });
  }
  const due = dueList(get('reviews'), today);
  if (due.length) parts.push({ head: '复现组', full: due.map((d) => `${d.id} ${one(d.title, 30)}（${d.days < 0 ? `过期 ${-d.days} 天` : d.days === 0 ? '今天到期' : `${d.due.slice(5)} 到期`}）`), short: [due.map((d) => `${d.id}${d.days <= 0 ? '（到期）' : ''}`).join('、')] });
  const slips = get('slips').filter(not('slips')).sort(byDate('date'));
  if (slips.length) parts.push({ head: '较早的教学失误', full: [slips.map((s) => s.id).join('、')], short: [`${slips.length} 条`] });
  // 课程地图：这一科的讲、节（这一节的块写标题）——知道还有哪些块、编号怎么写
  const cur = get('curriculum');
  if (cur.length) {
    const lvl = (d) => d.level || ['', 'lecture', 'section', 'block'][String(d.id).split('.').length] || '';
    const lect = cur.filter((d) => lvl(d) === 'lecture').sort((a, b) => cmpId(a.id, b.id));
    const sec = cur.filter((d) => lvl(d) === 'section').sort((a, b) => cmpId(a.id, b.id));
    const mine = sectionOf(here);
    const blocks = cur.filter((d) => lvl(d) === 'block' && sectionOf(d.id) === mine && d.id !== here).sort((a, b) => cmpId(a.id, b.id));
    parts.push({
      head: '课程地图',
      full: [...lect.map((l) => `${l.id} ${one(l.title, 20)}：${sec.filter((s) => s.id.startsWith(`${l.id}.`)).map((s) => `${s.id} ${one(s.title, 14)}`).join('、') || '（还没分节）'}`), ...(blocks.length ? [`这一节的块：${blocks.map((b) => `${b.id} ${one(b.title, 14)}`).join('、')}`] : [])],
      short: [lect.map((l) => l.id).join('、')],
    });
  }
  if (srcCut) parts.push({ head: '这一块的原文', full: [`${here} 的文稿原文、教材原文还有 ${srcCut} 段没放进来`], short: [`${here} 还有 ${srcCut} 段原文`] });

  const how = tools
    ? '要看哪一条的全文，用 memory_read 按编号取，**一次可以取好几条**（ids 写编号数组，比如 ["L2-31","W23"]，同一类的放一起）；以前的课写 collection: "sessions"、id 写课的编号，给你那节课的报告和小结。每调用一次要多跑一整轮（整份说明再读一遍），所以：学生的错像目录里某道旧错题、要提起以前的课、要按某条规则做又拿不准原文时才取，一次取够，不要一条一条取。'
    : '这个查看方式不支持工具，目录里的东西取不了全文。';
  const render = (mode) => ['## 目录（记忆库里没放全文的，一条一行）', how, ...parts.map((p, i) => `**${p.head}**：\n${(mode[i] ? p.short : p.full).map((l) => `- ${l}`).join('\n')}`)].join('\n\n');
  // 放不下：从后往前（课程地图、失误、复现组、掌握、错题……）一节节换成省的写法
  const mode = parts.map(() => false);
  let text = parts.length ? render(mode) : '';
  for (let i = parts.length - 1; text && utf8(text) > max && i >= 0; i--) { mode[i] = true; text = render(mode); }
  return { text, cut };
}

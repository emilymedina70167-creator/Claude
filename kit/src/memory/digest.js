// 记忆摘要：课堂里的 Claude 每一轮带着的那份「对学生的了解」（docs/learner-memory-spec.md 第 3 节、docs/memory-plan.md）。纯函数，有测试。
// 课堂里的 Claude 没有记忆：每一轮只看得到页面这一轮发给它的文字，每多发 1 KB，整节课每一轮都多付 1 KB。所以分两层：
// - 全文（必读）：和这节课直接有关的——规则（给课堂的、这一科的）、关于学生（这一科的）、上一节停在哪、这一块、以前学这一块的课、
//   相关的弱点和错题原文、掌握、最近的失误、等确认的改动；这一块的长原文放最后
// - 目录（一条一行，只有编号和一句话）：记忆库里其余的东西都列出来（规则、弱点、错题、掌握、复现组、以前的课、课程地图、较早的失误），
//   它看到编号才知道「有这么一条」，要用时 memory_read 按编号取全文（一次可以取好几条）
// 规则最多占全文预算的 RULES_SHARE（红线、掌握、检验、讲解在前），放不下的进目录：真实的记忆库里规则有十几 KB，
// 不限的话全被规则占满（2026-10-29 用真数据量出来的）。目录有自己的上限 CATALOG_MAX，太长时远处的错题、掌握收成按块的编号。
// 撤销了的（status: void、有一条作废的更正指向它）不带；学生标了已解决的错题注明；还在等学生确认的改动单列出来，免得它再提一遍。
import { weaknessHits, hitText, lessonLines, lessonLinesText, pointCatalog } from './skills.js';
import { debriefText } from './debrief.js';
import { voidedIds, resolvedErrors, pendingTitle, absorbedSlips } from './memo.js';
import { filterSpace, spaceOfId, positionId, sharedFor } from './space.js';
import { dueList, toDate } from './schema.js';
import { recallLine } from './recall.js';
import { isTeach } from './session.js';

const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
export const utf8 = (s) => (enc ? enc.encode(String(s)).length : Buffer.byteLength(String(s)));
const one = (s, n = 400) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(String);
const byDate = (k) => (a, b) => String(b?.[k] || '').localeCompare(String(a?.[k] || ''));
const cmpId = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
// 块的编号：L2.2.1；知识点：L2.2.1#tr → 所在的块 L2.2.1
const blockOf = (id) => String(id || '').split('#')[0];
const sectionOf = (id) => blockOf(id).split('.').slice(0, 2).join('.');
// 规则最多占全文预算的多少：原来 0.6，2026-11-03 真数据里 55 条通用规则占满了它，这节课的错题、掌握、关于我都被挤进目录
export const RULES_SHARE = 0.42;
export const LESSONS_SHARE = 0.35; // 一科最多 20 条守则，一条四五百字节：要全文放得下
export const CATALOG_MAX = 7 * 1024;
// 先给目录留多少（目录是一条一行，真数据里 3～4 KB；全文装完剩下的也都给目录）
export const CATALOG_RESERVE = 5 * 1024;
// 装的先后：这节课这一块的在前（CORE，合起来最多占全文预算的 CORE_SHARE），再是关于我（短、每轮都要）、规则、守则
// 课前档案、学生卡（第九轮，aide/）：助手从全部记忆合并出来的，最先装；算在这一块的那一份（CORE_SHARE）里，
// 两节合起来最多 AIDE_SHARE——不额外占地方，规则、守则、关于我照旧（整支审查：以前另外占，守则会被整段挤掉）
export const AIDE_SHARE = 0.25;
export const PACK_ORDER = ['aide-brief', 'aide-cards', 'position', 'curriculum', 'weaknesses', 'mastery', 'recall', 'sessions', 'errors', 'profile', 'rules', 'lessons', 'slips', 'pending', 'source'];
const CORE = new Set(['aide-brief', 'aide-cards', 'position', 'curriculum', 'errors', 'weaknesses', 'mastery', 'recall', 'sessions']);
export const CORE_SHARE = 0.45;

/**
 * 发给 Claude 的提示词里提到学生不用「他」「她」（我明确要求过）。以前对话里的 Claude 写进记忆的原文里有「他」
 * （「他对 log 没有直觉」），摘要里换成「学生」；「其他」「他们」「他人」「她们」「吉他」不动
 */
export const neutral = (t) => String(t ?? '').replace(/(?<![其吉利])[他她](?![们人])/g, '学生');
const ERRORS_FULL = 8; // 相关的错题最多带几条原文（这一块的、最新的在前），其余进目录
const RECALL_FULL = 12; // 要记的最多带几条（老想不起的在前）
const SLIPS_FULL = 6;
// 规则的类别：课堂里最要紧的在前（放不下时后面的进目录）
// 规则的先后（放不下时后面的进目录）：每一轮都要照着做的在前（红线、怎么讲、怎么排板），出题、记录这类用到时再看的在后。
// 正文写着【红线…】的（比如 cat 是「检验」的红线 7）按红线排
const RULE_ORDER = ['红线', '讲解', '教法', '黑板', '掌握', '检验', '细则', '来源'];
const ruleRank = (r) => { if (/^\s*【红线/.test(String(r.text || ''))) return 0; const i = RULE_ORDER.indexOf(String(r.cat || '')); return i < 0 ? RULE_ORDER.length : i; };

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
  for (const c of ['rules', 'profile', 'slips', 'lessons']) mem[c] = sharedFor(mem[c], space, mem0);
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
const KIND = { talk: '一问一答', live: '实时黑板', unit: '自学单元' };
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
// aide：{ brief（briefText 的字，可以空）, cards（cardText 的字的数组）}：课堂助手的两节（aide/brief.js、card.js 算好的），没有就是 null（和以前一字不差）
export function memoryDigest(mem0 = {}, { block = '', space = '', budget = 24 * 1024, session = '', tools = true, today = toDate(Date.now()), aide = null } = {}) {
  // space：没块开的课（新的一科还没选块）按这节课的科带，不落到数学
  const view = classView(mem0, { block, space: block ? '' : space });
  const { mem, get, solved, position, here } = view;
  const { cur, near } = nearBlocks(get('curriculum'), here);
  const nearIds = new Set([here, ...near.map((d) => d.id)].filter(Boolean));
  const shown = new Set(); // 'errors/L2-07'：放了全文的，目录里不再列

  // —— 全文的各节：标题 + 一条条（按优先级排好）。每条记着它是哪一类哪一条（进了全文就不进目录）——
  const sections = [];
  const rules = get('rules').filter((r) => r.status !== 'void').sort((a, b) => ruleRank(a) - ruleRank(b) || cmpId(a.id, b.id));
  sections.push({ coll: 'rules', share: RULES_SHARE, items: rules.map((r) => ({ key: `rules/${r.id}`, text: ruleLine(r) })) });
  // 教学守则（以前的失误归纳出来的）紧跟规则：它们就是这位老师自己定下的做法。又犯得多的在前
  const lessons = get('lessons').filter((l) => (l.status || 'active') === 'active').sort((a, b) => (Number(b.hits) || 1) - (Number(a.hits) || 1) || byDate('last')(a, b));
  sections.push({ coll: 'lessons', share: LESSONS_SHARE, head: '## 教学守则（两个 Claude 以前的教学失误归纳出来的，每条都要做到；又犯得多的在前）', items: lessons.map((l) => ({ key: `lessons/${l.id}`, text: `- ${l.id} ${l.topic ? `［${one(l.topic, 10)}］` : ''}${one(l.text, 400)}${(Number(l.hits) || 1) > 1 ? `（犯过 ${l.hits} 次${l.last ? `，最近 ${l.last}` : ''}${Array.isArray(l.recent) && l.recent.length ? `：${one(l.recent.at(-1), 80)}` : ''}）` : ''}` })) });
  // 助手的两节：紧跟规则、守则，在别的原始条目前面（档案每行一条，卡一张一条；放不下的那几行就不带）
  const briefLines = String(aide?.brief || '').split('\n').filter((l) => l.trim());
  sections.push({ coll: 'aide-brief', head: '## 这节课要知道的（课前助手读了全部学生卡写的，每行有出处）', items: briefLines.filter((l) => !/^#{1,3}\s/.test(l)).map((text) => ({ text })) });
  sections.push({ coll: 'aide-cards', head: '## 学生卡（这一块和相关的块：助手从全部记忆合并的，每行有出处；细节在下面的原文和目录里）', items: (Array.isArray(aide?.cards) ? aide.cards : []).filter((c) => String(c || '').trim()).map((text) => ({ text: String(text).trim() })) });
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
  // 课上换过块的（blocks）也算：讲到一半转去别的块，这一块的那一段还是学过
  const obs = get('observations');
  const catalog = pointCatalog(get('sessions'), get('mastery'));
  const before = get('sessions').filter((s) => s.id !== session && (nearIds.has(String(s.block || '')) || (Array.isArray(s.blocks) && s.blocks.some((b) => nearIds.has(String(b))))) && (s.report || s.summary || s.status === 'closed'))
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 2);
  sections.push({
    coll: 'sessions', head: '## 以前学这一块的课（sessions，最近的在前）',
    items: before.map((s, i) => {
      const x = sessionLine(s, obs, 160);
      // 最近那节归过类的：会了 / 还不稳 / 下次先测（页面按知识点算的），这节课开头先测没稳的
      const ll = i === 0 && s.skills ? lessonLinesText(lessonLines(s.skills, catalog)) : [];
      // 最近那节下课后的复盘（debrief.js）：误解消了没有、开头先测什么
      const db = i === 0 && s.debrief ? debriefText(s.debrief).split('\n').map((l) => `    ${l}`).join('\n') : '';
      return { key: `sessions/${s.id}`, text: `- ${x.head}${s.date ? ` ${s.date}` : ''}${x.line ? `：${x.line}` : ''}${x.sum.length ? `\n  - 小结：${x.sum.join(' / ')}` : ''}${ll.length ? `\n  - 页面按知识点算的：${ll.join('。')}` : ''}${db ? `\n  - 下课后的复盘：\n${db}` : ''}` };
    }),
  });

  // 相关的错题：块挨着这节课的，或者挂在相关弱点上的。相关的弱点：管着这几块的、挂着这些错题的、影响面是「通用」的
  // 这一科最近两节课（不算练习）记的错题、挂上的弱点也算相关：块常常记成了开课时的块（课上改讲了别的），
  // 按块找会漏掉刚犯的错（2026-11-03 真数据：11-02 那节的 6 道错题记在第三章，课讲的是第一章）
  // （只算做过题、记过错题的课：只说了几句话就停的课不算）
  const errors = get('errors');
  const withErr = new Set(errors.map((e) => String(e.session || '')));
  const recent = new Set(get('sessions').filter((x) => x.id !== session && x.kind !== 'drill' && ((Number(x.report?.items) || 0) > 0 || withErr.has(String(x.id))))
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 2).map((x) => String(x.id)));
  const recentWeak = new Set(get('sessions').filter((x) => recent.has(String(x.id))).flatMap((x) => (Array.isArray(x.skills?.items) ? x.skills.items : []).map((it) => it?.w).filter(Boolean).map(String)));
  const weak = get('weaknesses').filter((w) => w.status !== 'closed' && w.status !== 'void');
  const nearErr = new Set(errors.filter((e) => nearIds.has(blockOf(e.block)) || recent.has(String(e.session || ''))).map((e) => String(e.id)));
  const relW = weak.filter((w) => list(w.blocks).some((b) => nearIds.has(blockOf(b))) || list(w.errors).some((e) => nearErr.has(e)) || w.scope === '通用' || recentWeak.has(String(w.id)) || recent.has(String(w.session || '')));
  const touch = (w) => (list(w.blocks).includes(here) || list(w.errors).some((e) => errors.find((x) => x.id === e)?.block === here) ? 0 : 1);
  relW.sort((a, b) => touch(a) - touch(b) || byDate('last')(a, b));
  const relWIds = new Set(relW.map((w) => String(w.id)));
  const hits = weaknessHits(mem);
  sections.push({
    coll: 'weaknesses', head: '## 相关的弱点（weaknesses）',
    items: relW.map((w) => ({ key: `weaknesses/${w.id}`, text: `- ${w.id} ${one(w.title, 120)}（${[w.scope, w.level ? `证据级 ${w.level}` : '', hitText(hits.get(String(w.id))) || (w.last ? `最近 ${w.last}` : ''), list(w.errors).length ? `错题 ${list(w.errors).join('、')}` : ''].filter(Boolean).join('，')}）` })),
  });
  // 这一块的在前，同一块里最新的在前；最多 ERRORS_FULL 条原文，其余在目录里（一条一行：编号、块、根因）
  const relE = errors.filter((e) => nearErr.has(String(e.id)) || relWIds.has(String(e.weakness)))
    .sort((a, b) => (blockOf(a.block) === here || recent.has(String(a.session || '')) ? 0 : 1) - (blockOf(b.block) === here || recent.has(String(b.session || '')) ? 0 : 1) || byDate('date')(a, b) || cmpId(b.id, a.id));
  sections.push({ coll: 'errors', head: '## 相关的错题（errors，原文，这一块的、最近的在前）', limit: ERRORS_FULL, items: relE.map((e) => ({ key: `errors/${e.id}`, text: errorFull(e, solved) })) });
  const relM = get('mastery').filter((m) => nearIds.has(blockOf(m.block || m.id)))
    .sort((a, b) => (blockOf(a.id) === here ? 0 : 1) - (blockOf(b.id) === here ? 0 : 1) || cmpId(a.id, b.id));
  sections.push({ coll: 'mastery', head: '## 掌握状态（mastery，只读：你不能宣布掌握）', items: relM.map((m) => ({ key: `mastery/${m.id}`, text: `- ${m.id}${String(m.id).includes('#') && (m.title || catalog[m.id]?.title) ? `（${one(m.title || catalog[m.id].title, 40)}）` : ''}：${m.state}${m.state === '复现通过' && m.tier ? `（第 ${m.tier} 天那档）` : ''}` })) });
  // 要记的（记忆点，recall.js）：这几块记过哪些、哪几条老想不起——课上不重复记，老想不起的换个讲法再讲一次
  const recalls = get('recall').filter((k) => (k.status || 'active') === 'active' && (nearIds.has(blockOf(k.block)) || Number(k.lapses) >= 2))
    .sort((a, b) => (Number(b.lapses) || 0) - (Number(a.lapses) || 0) || cmpId(a.id, b.id));
  sections.push({ coll: 'recall', head: '## 要记的（recall：这几块记过的、老想不起的；学生每天在首页自己想一遍，页面按 1 → 3 → 7 → 14 → 30 天排）', limit: RECALL_FULL, items: recalls.map((k) => ({ key: `recall/${k.id}`, text: recallLine(k, today) })) });
  // 失误：已经归纳进守则的不再带（守则里有了），只带还没归纳的，最近的在前
  const absorbed = absorbedSlips(mem.lessons);
  const slips = get('slips').filter((s) => !absorbed.has(String(s.id))).sort(byDate('date'));
  sections.push({ coll: 'slips', head: '## 还没归纳进守则的教学失误（最近的在前；下课时并进守则）', limit: SLIPS_FULL, items: slips.map((s) => ({ key: `slips/${s.id}`, text: `- ${s.id}（${s.date || ''}，${s.by === 'class' ? '课堂里的 Claude' : s.by === 'lab' ? '课后补写的' : '以前对话里的 Claude'}）${one(s.text, 300)}${s.lesson ? ` → ${one(s.lesson, 200)}` : ''}` })) });
  // 还在等学生确认的改动（memo 写的错题、弱点、复现组、位置）：已经提过了，别再提
  const open = (Array.isArray(mem.pending) ? mem.pending : []).filter((p) => p && p.status === 'open').sort((a, b) => (a.at || 0) - (b.at || 0));
  sections.push({ coll: 'pending', head: '## 以前提的、还没写进去的改动（不用再提）', items: open.map((p) => ({ text: `- ${one(pendingTitle(p), 160)}` })) });
  // 这一块的文稿原文、教材原文：长，放最后（放不下就在目录里写一句，用 memory_read 取 curriculum 的这一块）
  const src = [];
  if (cur?.transcript) src.push({ text: `### ${cur.id} 的文稿原文\n${String(cur.transcript).trim()}` });
  for (const t of cur ? (Array.isArray(cur.textbook) ? cur.textbook : list(cur.textbook).map((text) => ({ text }))) : []) {
    if (t && (t.text || t.ref)) src.push({ text: `### 教材原文${t.ref ? `（${one(t.ref, 80)}）` : ''}\n${String(t.text || '（只有原图）').trim()}` });
  }
  sections.push({ coll: 'source', head: '## 这一块的原文（curriculum）', items: src });

  // —— 先给目录留出位置，全文往剩下的预算里装。装的先后（PACK_ORDER）和写出来的先后不一样：
  // 先装这节课这一块的（上一节停在哪、这一块、错题、弱点、掌握、要记的、以前的课，合起来最多 CORE_SHARE），
  // 再装通用的规则、守则、关于我。2026-11-03 用真数据量出来：英语课里 55 条通用规则占了 13.7 KB，
  // 这一块的 10 道错题里 9 道、掌握整段被挤进目录，课堂 Claude 只看得到编号。一节里一条放不下，只停这一节，别的节照样装 ——
  const intro = `这节课在学习台里上${session ? `（${session}）` : ''}。下面是学习台记忆库里和你有关的部分。**记忆由你管**：错题、弱点、复现组、下一节从哪接、规则你都直接写（memo 块），不用等学生确认；掌握由页面按证据算。前面是和这节课直接有关的**全文**，最后是记忆库里其余东西的**目录**（一条一行）。`;
  const reserve = Math.min(CATALOG_RESERVE, Math.floor(budget * 0.3));
  const room = budget - reserve;
  let used = utf8(intro);
  let rulesText = '';
  const body = [intro];
  let srcCut = 0;
  const coreCap = Math.floor(room * CORE_SHARE);
  let coreUsed = 0;
  const aideCap = Math.floor(room * AIDE_SHARE);
  let aideUsed = 0;
  const keptOf = new Map();
  const rank = (c) => { const i = PACK_ORDER.indexOf(c); return i < 0 ? PACK_ORDER.length : i; };
  for (const s of [...sections].sort((a, b) => rank(a.coll) - rank(b.coll))) {
    const kept = [];
    keptOf.set(s, kept);
    if (!s.items.length) continue;
    const core = CORE.has(s.coll);
    let own = 0;
    const cap = s.share ? Math.floor(room * s.share) : Infinity;
    for (const it of s.items) {
      if (s.limit && kept.length >= s.limit) break;
      // 规则单独放；别的节：第一条带上小标题，节和节之间空一行
      const add = utf8(it.text) + 1 + (kept.length || !s.head ? 0 : utf8(s.head) + 4);
      const isAide = s.coll.startsWith('aide-');
      if (own + add > cap || used + add > room || (core && coreUsed + add > coreCap) || (isAide && aideUsed + add > aideCap)) break;
      used += add;
      own += add;
      if (core) coreUsed += add;
      if (isAide) aideUsed += add;
      kept.push(it.text);
      if (it.key) shown.add(it.key);
    }
  }
  for (const s of sections) {
    const kept = keptOf.get(s) || [];
    if (s.coll === 'source') srcCut = s.items.length - kept.length;
    if (s.coll === 'rules') { rulesText = kept.join('\n'); continue; }
    if (kept.length) body.push(`${s.head}\n\n${kept.join('\n')}`);
  }
  const cat = memoryCatalog(view, { shown, here, nearIds, session, today, tools, srcCut, max: Math.max(1024, budget - used - 200) });
  if (cat.text) body.push(cat.text);
  const text = neutral(body.join('\n\n'));
  rulesText = neutral(rulesText);
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
  const absorbed = absorbedSlips(view.mem.lessons);
  const slips = get('slips').filter(not('slips')).filter((s) => !absorbed.has(String(s.id))).sort(byDate('date'));
  const lessonsLeft = get('lessons').filter((l) => (l.status || 'active') === 'active').filter(not('lessons'));
  if (lessonsLeft.length) parts.push({ head: '教学守则（没放全文的）', full: lessonsLeft.map((l) => `${l.id} ${one(l.text, 34)}`), short: [lessonsLeft.map((l) => l.id).join('、')] });
  if (slips.length) parts.push({ head: '较早的、还没归纳的教学失误', full: [slips.map((s) => s.id).join('、')], short: [`${slips.length} 条`] });
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

/**
 * 开课时页面先替课堂 Claude 取好的「以前的课」：这一科最近的一节，再加这一块最近的一节（不是同一节时），最多 2 节。
 * 真课里 5 节有 3 节，它第一轮先 memory_read 取上一节课，开场的板就多等一整轮（2026-11-02、11-03）。
 * 学生常常不点「下课」，所以 open 的课也算；只要比这节课早开始的。返回课的编号（最近的在前）
 */
export function earlierClasses(sessions = [], { session = '', block = '' } = {}) {
  const me = (sessions || []).find((s) => s?.id === session);
  const sp = spaceOfId(block || me?.block || '');
  const before = (sessions || []).filter((s) => s && s.id !== session && isTeach(s) && spaceOfId(s.block || '') === sp
    && (!me?.startedAt || !s.startedAt || s.startedAt < me.startedAt)).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const out = [];
  if (before[0]) out.push(before[0].id);
  const same = before.find((s) => s.block === block);
  if (same && !out.includes(same.id)) out.push(same.id);
  return out;
}

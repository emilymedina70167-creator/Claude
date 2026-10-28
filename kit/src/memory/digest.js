// 记忆摘要：课堂里的 Claude 每一轮带着的那份「对学生的了解」（docs/learner-memory-spec.md 第 3 节）。纯函数，有测试。
// 从学习台的记忆库里挑和这节课的块有关的部分，按优先级排：
//   rules 全文 → profile → 当前块的 curriculum（相邻块只给范围）→ 相关的 weaknesses、errors 原文、mastery → 最近的 slips → position
// 有字节预算（和资料包一起受 SYSTEM_MAX 限制）：放不下时从后往前截，截掉的写明「还有几条，用 memory_read 查」。
// 规则最多占预算的 RULES_SHARE（按类别：红线、掌握、检验、讲解在前）：真实的记忆库里规则有十几 KB，不限的话
// 16 KB 全被规则占满，这一块的范围、上一节停在哪、相关的错题全被截掉（2026-10-29 用真数据量出来的）。
// 上一节停在哪、这一块的要点比长的原文先放；文稿原文、教材原文放在最后（资料包里一般也有这节课要照着讲的原文）。
// 撤销了的（status: void、有一条作废的更正指向它）不带；学生标了已解决的错题注明；还在等学生确认的改动单列出来，免得它再提一遍。
import { voidedIds, resolvedErrors, pendingTitle } from './memo.js';
import { filterSpace, spaceOfId, positionId } from './space.js';

const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
export const utf8 = (s) => (enc ? enc.encode(String(s)).length : Buffer.byteLength(String(s)));
const one = (s, n = 400) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(String);
const byDate = (k) => (a, b) => String(b?.[k] || '').localeCompare(String(a?.[k] || ''));
// 块的编号：L2.2.1；知识点：L2.2.1#tr → 所在的块 L2.2.1
const blockOf = (id) => String(id || '').split('#')[0];
export const RULES_SHARE = 0.45;
// 规则的类别：课堂里最要紧的在前（放不下时后面的先截）
const RULE_ORDER = ['红线', '掌握', '检验', '讲解', '教法', '黑板', '细则', '来源'];
const ruleRank = (r) => { const i = RULE_ORDER.indexOf(String(r.cat || '')); return i < 0 ? RULE_ORDER.length : i; };

/** 这节课有关的块：当前块、它依赖的块、依赖它的块、同一节里紧挨着的前后两块 */
export function nearBlocks(curriculum, block) {
  const docs = (curriculum || []).filter((d) => d && d.id);
  const cur = docs.find((d) => d.id === block);
  if (!cur) return { cur: null, near: [] };
  const parentOf = (d) => d.parent || String(d.id).split('.').slice(0, -1).join('.');
  const isBlock = (d) => (d.level || (String(d.id).split('.').length === 3 ? 'block' : '')) === 'block';
  const byId = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  const row = docs.filter((d) => (isBlock(d) && parentOf(d) === parentOf(cur)) || d.id === block).sort(byId);
  const at = row.findIndex((d) => d.id === block);
  const adj = [row[at - 1], row[at + 1]].filter(Boolean);
  const req = list(cur.requires).map((id) => docs.find((d) => d.id === id)).filter(Boolean);
  const users = docs.filter((d) => isBlock(d) && list(d.requires).includes(block));
  const near = [...new Map([...req, ...adj, ...users].filter((d) => d.id !== block).map((d) => [d.id, d])).values()];
  return { cur, near };
}

/**
 * mem：{ rules, profile, curriculum, weaknesses, errors, mastery, slips, position }（每类一个数组，缺的当空）；
 * block：这节课的块（没有就用 position 里的）；budget：字节上限（rules 和正文合起来）；tools：这个查看方式能不能用 memory_read。
 * 返回 { rules（给「角色和红线」那一节的规则全文，没有就是空字符串）, text（正文）, cut: [{ coll, more }], bytes }
 */
export function memoryDigest(mem0 = {}, { block = '', budget = 32 * 1024, session = '', tools = true } = {}) {
  // 分科：只带这一科的（数学课不带英语的弱点），「关于我」、规则、失误全科共用
  const space = spaceOfId(block || (mem0.position || []).find((d) => d?.id === 'now')?.block);
  const mem = filterSpace(mem0, space);
  const gone = voidedIds(mem);
  const solved = resolvedErrors(mem);
  // 作废的、更正别的条目的（作废更正、「已解决」那条）都不单独带：原条上注明
  const get = (c) => (Array.isArray(mem[c]) ? mem[c].filter((d) => d && d.id !== undefined && !gone.has(`${c}/${d.id}`) && !(c === 'errors' && d.corrects && (d.void || d.resolved))) : []);
  const position = get('position').find((d) => d.id === positionId(space)) || null;
  const here = String(block || position?.block || '');
  const { cur, near } = nearBlocks(get('curriculum'), here);
  const nearIds = new Set([here, ...near.map((d) => d.id)].filter(Boolean));

  // —— 每一节：标题 + 一条条（按优先级排好）。一条放不下就停，后面的记成「还有几条」——
  const sections = [];
  const rules = get('rules').filter((r) => r.status !== 'void').sort((a, b) => ruleRank(a) - ruleRank(b) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  sections.push({ coll: 'rules', cap: Math.floor(budget * RULES_SHARE), ids: rules.map((r) => r.id), items: rules.map((r) => `- ${r.cat ? `［${one(r.cat, 20)}］` : ''}${String(r.text ?? '').trim()}`) });
  sections.push({ coll: 'profile', head: '## 学生（profile）', items: get('profile').map((p) => `- ${p.topic ? `${one(p.topic, 30)}：` : ''}${one(p.text, 600)}`) });
  // 上一节停在哪：很短、每节课开头都要用，放在前面
  if (position) {
    sections.push({
      coll: 'position', head: '## 上一节停在哪（position）',
      items: [[
        position.block ? `- 学到：${position.block}` : '', position.next ? `- 这一节从哪接：${one(position.next, 400)}` : '',
        list(position.first).length ? `- 先收的题：${list(position.first).map((x) => one(x, 200)).join('；')}` : '', list(position.debts).length ? `- 欠账：${list(position.debts).map((x) => one(x, 200)).join('；')}` : '',
      ].filter(Boolean).join('\n')].filter(Boolean),
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
    cItems.push(lines.join('\n'));
  } else {
    cItems.push(here ? `（课程地图里还没有块 ${here}。）` : '（这节课没有指定块。）');
  }
  if (near.length) cItems.push(`### 相邻的块（只给范围）\n${near.map((d) => `- ${d.id}${d.title ? ` ${one(d.title, 60)}` : ''}${d.scope ? `：${one(d.scope, 200)}` : ''}`).join('\n')}`);
  sections.push({ coll: 'curriculum', head: '## 课程地图（curriculum）', items: cItems });

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
    items: relW.map((w) => `- ${w.id} ${one(w.title, 120)}（${[w.scope, w.level ? `证据级 ${w.level}` : '', w.last ? `最近 ${w.last}` : '', list(w.errors).length ? `错题 ${list(w.errors).join('、')}` : ''].filter(Boolean).join('，')}）`),
  });
  const relE = errors.filter((e) => nearErr.has(String(e.id)) || relWIds.has(String(e.weakness))).sort(byDate('date'));
  sections.push({
    coll: 'errors', head: '## 相关的错题（errors，原文）',
    items: relE.map((e) => [
      `- ${e.id}${e.source ? `（${one(e.source, 60)}）` : ''}${e.date ? ` ${e.date}` : ''}${e.weakness ? `，挂 ${e.weakness}` : ''}${e.corrects ? `，更正 ${e.corrects}` : ''}${solved.has(String(e.id)) ? '，学生标了已解决' : ''}`,
      e.q ? `  - 题面：${one(e.q, 600)}` : '', e.mine ? `  - 学生的答案：${one(e.mine, 400)}` : '', e.step ? `  - 错在：${one(e.step, 200)}` : '', e.cause ? `  - 根因：${one(e.cause, 300)}` : '',
    ].filter(Boolean).join('\n')),
  });
  const relM = get('mastery').filter((m) => nearIds.has(blockOf(m.block || m.id)))
    .sort((a, b) => (blockOf(a.id) === here ? 0 : 1) - (blockOf(b.id) === here ? 0 : 1) || String(a.id).localeCompare(String(b.id)));
  sections.push({ coll: 'mastery', head: '## 掌握状态（mastery，只读：你不能宣布掌握）', items: relM.map((m) => `- ${m.id}：${m.state}${m.state === '复现通过' && m.tier ? `（第 ${m.tier} 天那档）` : ''}`) });
  const slips = get('slips').sort(byDate('date')).slice(0, 12);
  sections.push({ coll: 'slips', head: '## 别再犯（两个 Claude 以前的教学失误，最近的在前）', items: slips.map((s) => `- ${s.date || ''}（${s.by === 'class' ? '课堂里的 Claude' : '对话里的 Claude'}）${one(s.text, 300)}${s.lesson ? ` → ${one(s.lesson, 200)}` : ''}`) });
  // 还在等学生确认的改动（memo 写的错题、弱点、复现组、位置）：已经提过了，别再提
  const open = (Array.isArray(mem.pending) ? mem.pending : []).filter((p) => p && p.status === 'open').sort((a, b) => (a.at || 0) - (b.at || 0));
  sections.push({ coll: 'pending', head: '## 已经提了、等学生确认的改动（不用再提）', items: open.map((p) => `- ${one(pendingTitle(p), 160)}`) });

  // 这一块的文稿原文、教材原文：长，放最后（放不下就用 memory_read 查 curriculum 的这一块）
  const src = [];
  if (cur?.transcript) src.push(`### ${cur.id} 的文稿原文\n${String(cur.transcript).trim()}`);
  for (const t of cur ? (Array.isArray(cur.textbook) ? cur.textbook : list(cur.textbook).map((text) => ({ text }))) : []) {
    if (t && (t.text || t.ref)) src.push(`### 教材原文${t.ref ? `（${one(t.ref, 80)}）` : ''}\n${String(t.text || '（只有原图）').trim()}`);
  }
  sections.push({ coll: 'curriculum', label: `${cur?.id || ''} 的原文`, head: '## 这一块的原文（curriculum）', items: src });

  // —— 按优先级往预算里装：一条放不下，它和后面的全都不放（从后往前截），最后一行写明还有哪些、怎么查 ——
  const intro = `这节课在学习台里上${session ? `（${session}）` : ''}。下面是学习台记忆库里和这节课有关的部分，由项目对话里的 Claude 维护；你只能读，不能改（掌握、弱点、错题、复现都由它课后看证据判断）。${tools ? '没放下的、要看原文的，用 memory_read 工具查（collection 写集合名，id 写编号）。' : ''}`;
  const RESERVE = 400; // 留给最后那行「没放下」
  let used = utf8(intro) + RESERVE;
  const cut = [];
  let rulesText = '';
  const body = [intro];
  let full = false;
  for (const s of sections) {
    if (!s.items.length) continue;
    const kept = [];
    let i = 0;
    let own = 0;
    for (; !full && i < s.items.length; i++) {
      // 规则单独放；别的节：第一条带上小标题，节和节之间空一行
      const add = utf8(s.items[i]) + 1 + (kept.length || !s.head ? 0 : utf8(s.head) + 4);
      // 规则到了自己的上限就停，后面的节照常放
      if (s.cap && own + add > s.cap) break;
      if (used + add > budget) { full = true; break; }
      used += add;
      own += add;
      kept.push(s.items[i]);
    }
    if (s.items.length - i) cut.push({ coll: s.coll, more: s.items.length - i, ...(s.ids ? { ids: s.ids.slice(i) } : {}), ...(s.label ? { label: s.label } : {}) });
    if (s.coll === 'rules') { rulesText = kept.join('\n'); continue; }
    if (kept.length) body.push(`${s.head}\n\n${kept.join('\n')}`);
  }
  if (cut.length) body.push(`（放不下，没带：${cut.map((c) => `${c.label || c.coll} ${c.more} 条${c.ids ? `（${c.ids.slice(0, 20).join('、')}${c.ids.length > 20 ? '……' : ''}）` : ''}`).join('、')}。${tools ? '要用就用 memory_read 查。' : ''}）`);
  const text = body.join('\n\n');
  return { rules: rulesText, text, cut, bytes: utf8(text) + utf8(rulesText) };
}

// 学习台自己备课（docs/textbook-plan.md 第 3 批）：不经过对话里的 Claude。两件事，都是「Claude 提、我确认」：
// - 挂课程地图：把一本资料的条目挂到课程地图的块上（已有的块挂上教材、文稿；没有的块按教材的章节提新块）。mapPrompt / parseMap
// - 备课：开课前按这一块的范围、要点、挂着的教材和文稿原文、学生的记忆，写这节课的资料包（目标、推进、要用的组件、题、要照着讲的条目）。
//   prepPrompt / parsePrep。资料包的样子和对话里的 Claude 写的一样（pack/main、pack/problems），课堂照常读。
// 纯函数，有测试；画面和调用在 planview.js。
import { chunkLine, chunkText } from './textbook.js';
import { fixLatexEscapes } from './ingest.js';

const one = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(String);
const cmpId = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const jsonOf = (raw) => {
  if (raw && typeof raw === 'object') return raw;
  const m = String(raw ?? '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('回的不是 JSON');
  // 公式里单个反斜杠被 JSON 吃掉的（\frac 成了换页符）补回来
  return fixLatexEscapes(JSON.parse(m[0]));
};

/** 课程地图里一块的一行（给 Claude 看已有的块）：编号 标题：范围（挂了几条资料） */
const blockLine = (b) => `${b.id}${b.level && b.level !== 'block' ? `（${b.level === 'lecture' ? '讲' : '节'}）` : ''} ${one(b.title, 30)}${b.scope ? `：${one(b.scope, 90)}` : ''}${list(b.chunks).length ? `（已挂 ${list(b.chunks).length} 条）` : ''}`;

/**
 * 挂课程地图的提示词。book：这本资料；chunks：它的全部条目；curriculum：这一科现有的课程地图；prefix：这门课的编号前缀（线代不带）
 */
export function mapPrompt({ book, chunks = [], curriculum = [], prefix = '' }) {
  const cur = [...curriculum].sort((a, b) => cmpId(a.id, b.id));
  const lines = chunks.map((c) => `${chunkLine(c)}${c.chapter ? ` 〔${one(c.chapter, 16)}${c.section ? ` / ${one(c.section, 16)}` : ''}〕` : ''}`);
  return [
    '你在帮学生整理学习台的课程地图：把一份资料里的条目挂到课程地图的「块」上。上课时课堂里的 Claude 按块取资料，所以每条要挂对。',
    `资料：${book.id}《${book.title || ''}》（${({ textbook: '教材', transcript: '视频课文稿', slides: '讲义', notes: '笔记' })[book.kind] || ''}），一共 ${chunks.length} 条，下面一条一行（编号［类型］标题（页）〔讲 / 节〕）。`,
    '',
    '现有的课程地图（讲 → 节 → 块，块是一节课讲的量）：',
    cur.length ? cur.map(blockLine).join('\n') : '（还是空的）',
    '',
    '要求：',
    '1. 已有的块：把属于它的条目挂上（定义、定理、例题、讲解都算）。一条可以挂到几块；和哪块都不沾的（前言、目录）不挂。',
    `2. 资料里讲到、课程地图还没有的内容：按资料的章节提新的讲、节、块。编号接着现有的往下编${prefix ? `，前面带 ${prefix}` : ''}（讲 L3、节 L3.1、块 L3.1.1）。一块是一节课 30–45 分钟能讲完、有一个核心结论的量；scope 写这块讲什么（范围、详略），points 写要点（三到六条），requires 写它依赖的块。`,
    '3. 条目连着一串的可以写范围：「B1-23.1~B1-25.2」（按上面的顺序，含两头）。',
    '4. 拿不准挂哪块的，写在 notes 里，不要硬挂。',
    '',
    '只输出 JSON：',
    '{"blocks":[{"id":"L2.1.4","chunks":["B1-23.1~B1-24.2","B1-30.1"]},{"id":"L3.1","new":true,"level":"section","parent":"L3","title":"…"},{"id":"L3.1.1","new":true,"level":"block","parent":"L3.1","title":"…","scope":"…","points":["…"],"requires":["L2.1.4"],"chunks":["…"]}],"notes":"…"}',
    '',
    `资料的条目（${book.id}）：`,
    lines.join('\n'),
  ].join('\n');
}

/** 把「B1-23.1~B1-25.2」这样的范围按条目顺序展开 */
export function expandIds(refs = [], chunks = []) {
  const order = chunks.map((c) => c.id);
  const out = [];
  for (const r of list(refs)) {
    const m = r.split(/\s*[~～]\s*/);
    if (m.length === 2) {
      const a = order.indexOf(m[0]);
      const b = order.indexOf(m[1]);
      if (a >= 0 && b >= a) out.push(...order.slice(a, b + 1));
      continue;
    }
    if (order.includes(r)) out.push(r);
  }
  return [...new Set(out)];
}

/**
 * 读挂课程地图的结果：对每一块给出要做的事。已有的块只加条目（不改别的字段）；新块要编号合规、父级存在（或者也在这次新提的里）。
 * 返回 { rows: [{ id, isNew, level, parent, title, scope, points, requires, chunks, problems: [] }], notes }
 */
export function parseMap(raw, { chunks = [], curriculum = [], idRe = /^(?:[A-Z]{2}-)?L\d+(?:\.\d+){0,2}$/ } = {}) {
  const obj = jsonOf(raw);
  const have = new Map(curriculum.map((b) => [b.id, b]));
  const proposed = (Array.isArray(obj.blocks) ? obj.blocks : []).filter((b) => b && b.id);
  const ids = new Set([...have.keys(), ...proposed.map((b) => String(b.id))]);
  const rows = proposed.map((b) => {
    const id = String(b.id).trim();
    const old = have.get(id);
    const isNew = !old;
    const level = ['lecture', 'section', 'block'].includes(b.level) ? b.level : (old?.level || ['', 'lecture', 'section', 'block'][id.replace(/^[A-Z]{2}-/, '').split('.').length] || 'block');
    const problems = [];
    if (!idRe.test(id)) problems.push('编号不合规矩');
    const parent = String(b.parent || old?.parent || id.split('.').slice(0, -1).join('.') || '');
    if (isNew && level !== 'lecture' && parent && !ids.has(parent)) problems.push(`上一级 ${parent} 不存在`);
    if (isNew && !String(b.title || '').trim()) problems.push('新块没写标题');
    const got = expandIds(b.chunks, chunks);
    const unknown = list(b.chunks).filter((r) => !/[~～]/.test(r) && !chunks.some((c) => c.id === r));
    if (unknown.length) problems.push(`没有这些条目：${unknown.slice(0, 5).join('、')}`);
    return {
      id, isNew, level, parent: level === 'lecture' ? '' : parent, title: String(b.title || old?.title || '').trim(),
      scope: isNew ? String(b.scope || '') : '', points: isNew ? list(b.points) : [], requires: isNew ? list(b.requires).filter((r) => ids.has(r)) : [],
      chunks: got, add: got.filter((c) => !list(old?.chunks).includes(c)), problems,
    };
  }).filter((r) => r.isNew || r.add.length);
  return { rows, notes: String(obj.notes || '') };
}

/** 确认了的一行变成写进课程地图的文档（已有的块合并条目；新块带来源） */
export function mapDoc(row, old = null, { today = '', book = '' } = {}) {
  if (old) return { ...old, chunks: [...new Set([...list(old.chunks), ...row.chunks])] };
  return {
    title: row.title, level: row.level, ...(row.parent ? { parent: row.parent } : {}), ...(row.scope ? { scope: row.scope } : {}),
    ...(row.points.length ? { points: row.points } : {}), ...(row.requires.length ? { requires: row.requires } : {}),
    ...(row.chunks.length ? { chunks: row.chunks } : {}), since: today, source: `学习台按 ${book} 提议、我确认`,
  };
}

/**
 * 备课的提示词。block：这一块（课程地图）；material：挂着的条目全文（教材、文稿）；memoryText：学生的记忆（memoryDigest 的全文 + 目录）；
 * rulesText：全部规则（包括只给对话里 Claude 的：资料包怎么写、备课的规矩）；components：能用的组件名；subject：门课
 */
export function prepPrompt({ block, material = [], books = [], memoryText = '', rulesText = '', components = [], subject = '', recent = '' }) {
  const b = block || {};
  return [
    '你是这个学生的老师，现在给下一节课备课。备好的资料包交给课堂里的 Claude（也是 Opus 5.5）在学习台里照着上：它每一轮都会带着资料包、学生的记忆和组件说明，现场写黑板、出题、判断学生懂没懂。资料包写得越准、越贴学生，课越好。',
    '',
    `## 这节课：${b.id || ''} ${b.title || ''}（${subject}）`,
    b.scope ? `- 范围：${b.scope}` : '',
    b.depth ? `- 详略：${b.depth}` : '',
    b.exam ? `- 考试口径：${b.exam}` : '',
    list(b.points).length ? `- 要点：\n${list(b.points).map((p, i) => `  ${i + 1}. ${p}`).join('\n')}` : '',
    list(b.requires).length ? `- 准入依赖：${list(b.requires).join('、')}` : '',
    '',
    '## 挂在这一块上的资料（教材、文稿原文）',
    material.length ? material.map((c) => chunkText(c, books.find((x) => x.id === c.book))).join('\n\n') : '（这一块还没挂资料。只能按范围和要点备，教材原文要讲到时课堂里的 Claude 用 textbook_search 找。）',
    b.transcript ? `\n### 这一块的文稿原文（课程地图里存的）\n${String(b.transcript).slice(0, 20000)}` : '',
    '',
    '## 学生的规则（全部，包括备课和资料包的规矩）',
    rulesText || '（没有）',
    '',
    '## 学生的记忆（和这一块有关的全文 + 其余的目录）',
    memoryText || '（没有）',
    recent ? `\n## 最近几节课\n${recent}` : '',
    '',
    `## 能用的组件\n${components.join('、')}`,
    '',
    '## 要你写的资料包（只输出 JSON，不要别的文字；字符串里公式的反斜杠写两个，比如 "$\\\\frac{1}{2}$"）',
    '{',
    '  "unit": "这节课的名字（短）",',
    '  "goal": "这节课要学生最后能做到什么（具体到能检验，比如「看到行成比例的方阵能认出秩一，并用 tr 写出 Aⁿ」）",',
    '  "scope": "这节课讲到哪、不讲什么、考试口径（照范围和文稿，不要超出）",',
    '  "plan": "建议的推进顺序：先收什么旧账（记忆里的欠账、到期的复现、相关的错题），每一步让学生动脑的点、用什么组件或教具、检验题放在哪。是建议，课堂里会按学生的反应调整",',
    '  "chunks": ["这节课要照着讲的教材、文稿条目编号（从上面挂的里挑；会全文放进资料包，别挑不用的）"],',
    '  "components": ["这节课会用到的组件名（从上面挑，三到八个）"],',
    '  "problems": [{"q": "题面（数值写全，矩阵写成 [[1,2],[3,4]]）", "answer": "答案", "point": "考点", "source": "来源（教材例题编号，或「自编」）"}],',
    '  "student": "这节课特别要注意的学生情况（记忆里已经有的不用抄，只写对这节课最要紧的一两句）"',
    '}',
    '题目：基础题检验机制、混合题对齐考试难度，按学生的规则出；答案自己先算一遍再写。',
  ].filter((x) => x !== '').join('\n');
}

/** 读备课结果：字段清理、编号只留挂着的、组件只留认得的；返回 { main, problems } */
export function parsePrep(raw, { block, chunkIds = [], components = [], today = '' } = {}) {
  const o = jsonOf(raw);
  const text = (v, n = 8000) => String(v ?? '').trim().slice(0, n);
  const okComp = new Set(components);
  const main = {
    unit: text(o.unit, 120) || `${block?.id || ''} ${block?.title || ''}`.trim(),
    goal: text(o.goal, 2000), scope: text(o.scope, 4000), plan: text(o.plan, 12000), student: text(o.student, 2000),
    block: block?.id || null,
    chunks: list(o.chunks).filter((id) => chunkIds.includes(id)),
    components: list(o.components).filter((c) => okComp.has(c)).slice(0, 10),
    by: 'desk', at: Date.now(), ...(today ? { date: today } : {}),
  };
  const problems = { items: (Array.isArray(o.problems) ? o.problems : []).filter((p) => p && p.q).slice(0, 20).map((p) => ({ q: text(p.q, 2000), answer: text(p.answer, 2000), point: text(p.point, 200), source: text(p.source, 200) })) };
  if (!main.goal && !main.plan) throw new Error('备课结果里没有目标和推进计划');
  return { main, problems };
}

/** 下一节默认讲哪一块：position 的块（还没讲完就是它，讲完了是课程地图里的下一块） */
export function suggestBlock(curriculum = [], position = null) {
  const blocks = curriculum.filter((b) => (b.level || (b.id.replace(/^[A-Z]{2}-/, '').split('.').length === 3 ? 'block' : '')) === 'block').sort((a, b) => cmpId(a.id, b.id));
  if (!blocks.length) return '';
  const at = blocks.findIndex((b) => b.id === position?.block);
  if (at < 0) return blocks[0].id;
  // position.next 里提到了哪块的编号，就是那块
  const named = blocks.find((b) => String(position?.next || '').includes(b.id));
  if (named) return named.id;
  return (blocks[at + 1] || blocks[at]).id;
}

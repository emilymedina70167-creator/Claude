// 挂课程地图（docs/textbook-plan.md 第 3 批）：把一本资料的条目挂到课程地图的块上（已有的块挂上教材、文稿；没有的块按教材的章节提新块），
// Claude 提、我确认。mapPrompt / parseMap。资料包里教案的结构化字段写成文字（lessonPlanText，课堂读以前备好的、项目 Claude 写的资料包用）。
// 首页「让 Claude 备课」（prepPrompt / parsePrep / checkPrep / openTodos）第十四轮搬进了 archive/kit/src/books/plan.js：备课学生跟项目 Claude 说。
// 纯函数，有测试；画面和调用在 planview.js。
import { chunkLine } from './textbook.js';
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

/** 资料包里教案的几个结构化字段写成给课堂 Claude 看的文字（prompt.js 的 packText 用） */
export function lessonPlanText(main = {}) {
  const out = {};
  if (Array.isArray(main.methods) && main.methods.length) out.methods = main.methods.map((m) => `- ${m.id} ${m.title || ''}${m.teach ? `（第 ${m.teach} 步讲）` : ''}${m.scope ? `［${m.scope}］` : ''}\n  ${String(m.steps || '').replace(/\n/g, '\n  ')}`).join('\n');
  if (Array.isArray(main.sequence) && main.sequence.length) out.sequence = main.sequence.map((x) => `${x.step}. ${x.point}${x.how ? `\n   怎么讲：${x.how}` : ''}${x.check ? `\n   确认：${x.check}` : ''}`).join('\n');
  // 备课写的开头复现是 [{ id, how }]；复现课（views.js 的 reviewPack）是编号的数组，整节课都在复现它们
  if (Array.isArray(main.review) && main.review.length) out.review = main.reviewClass
    ? `这节课复现 ${main.review.map((r) => String(r?.id ?? r)).join('、')}（整节课都是复现，见下面的范围和计划）`
    : main.review.map((r) => (r && typeof r === 'object' ? `- ${r.id}：${r.how}` : `- ${r}`)).join('\n');
  if (Array.isArray(main.prepCheck) && main.prepCheck.length) out.prepCheck = main.prepCheck.map((w) => `- ${w}`).join('\n');
  if (Array.isArray(main.todos) && main.todos.length) out.todos = main.todos.map((t) => `- ${t.text}`).join('\n');
  if (main.examBar?.id) out.examBar = `${main.examBar.id}${main.examBar.why ? `：${main.examBar.why}` : ''}（讲完这一块让学生做它，那一问写 exam=${main.examBar.id}）`;
  return out;
}

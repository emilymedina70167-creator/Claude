// 学习台自己备课（docs/textbook-plan.md 第 3 批）：不经过对话里的 Claude。两件事，都是「Claude 提、我确认」：
// - 挂课程地图：把一本资料的条目挂到课程地图的块上（已有的块挂上教材、文稿；没有的块按教材的章节提新块）。mapPrompt / parseMap
// - 备课：开课前按这一块的范围、要点、挂着的教材和文稿原文、学生的记忆，写这节课的资料包（目标、推进、要用的组件、题、要照着讲的条目）。
//   prepPrompt / parsePrep。资料包的样子和对话里的 Claude 写的一样（pack/main、pack/problems），课堂照常读。
// 纯函数，有测试；画面和调用在 planview.js。
import { rehearsalText } from './rehearse.js';
import { chunkLine, chunkText } from './textbook.js';
import { fixLatexEscapes } from './ingest.js';
import { spaceOfDoc, spaceOfId } from '../memory/space.js';

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
 * rulesText：全部规则（包括只给对话里 Claude 的：资料包怎么写、备课的规矩）；components：能用的组件名；subject：门课；
 * due：到期的复现组（一行一组，最多几组由规则定，没写就 3 组）；lessons：教学守则（以前的失误归纳出来的）
 *
 * 备课产出的是一份教案，不只是资料包：2026-11-02 那节课 27 条失误大半是「没备课、边讲边编」——规则课上补了三次、
 * 题目用到没讲过的规则、一块板塞讲解加题。所以这里要它课前就把可执行的规则写完整、排好讲解顺序（一步一块板，大的点分几步讲）、
 * 每道题写清用到哪几条规则、放在哪一步之后，页面再核一遍依赖（checkPrep）。
 */
/**
 * 还没补的待办（课上学生问了教案以外的内容，课堂里的 Claude 记的 todo，docs/autonomy-plan.md）：这一科的、不在 done 里的，最早的在前。
 * done：已经被某次备课补上的待办编号（meta/todos 的 done，页面在备课写完后记）
 */
export function openTodos(mem = {}, space = '', done = []) {
  const gone = new Set((done || []).map(String));
  return (Array.isArray(mem.observations) ? mem.observations : [])
    .filter((o) => o && o.kind === 'todo' && o.status !== 'done' && !o.void && !gone.has(String(o.id)) && (!space || spaceOfDoc('observations', o, mem) === space || (o.block && spaceOfId(o.block) === space)))
    .sort((a, b) => (a.at || 0) - (b.at || 0));
}

// exam：这一块的考情（exam/context.js 拼的，备课用 8 KiB 的预算）；有的话教案多一个 examBar：这节课结束时学生要能做的那道真题
export function prepPrompt({ block, material = [], books = [], memoryText = '', rulesText = '', components = [], subject = '', recent = '', due = '', lessons = '', todos = [], exam = '' }) {
  const b = block || {};
  return [
    '你是这个学生的老师，现在给下一节课备课。备好的教案交给课堂里的 Claude（也是 Opus 5.5）在学习台里照着上：它每一轮都会带着教案、学生的记忆和组件说明，现场写黑板、出题、判断学生懂没懂。它上课时来不及把整节的材料从头读一遍，所以**要讲的规则、讲的顺序、每道题用到什么，都在这里想好**：课上现编，就会出现「题目用到了没讲过的规则、学生撞墙后才补」。',
    '',
    `## 这节课：${b.id || ''} ${b.title || ''}（${subject}）`,
    b.scope ? `- 范围：${b.scope}` : '',
    b.depth ? `- 详略：${b.depth}` : '',
    b.exam ? `- 考试口径：${b.exam}` : '',
    list(b.points).length ? `- 要点：\n${list(b.points).map((p, i) => `  ${i + 1}. ${p}`).join('\n')}` : '',
    list(b.requires).length ? `- 准入依赖：${list(b.requires).join('、')}` : '',
    '',
    '## 这节课的资料（教材、文稿原文）',
    material.length ? material.map((c) => chunkText(c, books.find((x) => x.id === c.book))).join('\n\n') : '（这一块还没挂资料。只能按范围和要点备，教材原文要讲到时课堂里的 Claude 用 textbook_search 找。）',
    b.transcript ? `\n### 这一块的文稿原文（课程地图里存的）\n${String(b.transcript).slice(0, 20000)}` : '',
    '',
    exam ? `## 这一块在考试里（页面从入库的真题算的：考情的数字只用这里的）\n${exam}\n` : '',
    '## 学生的规则（全部，包括备课和资料包的规矩）',
    rulesText || '（没有）',
    lessons ? `\n## 教学守则（以前上课的失误归纳出来的，备课时就要照着做）\n${lessons}` : '',
    '',
    '## 学生的记忆（和这一块有关的全文 + 其余的目录）',
    memoryText || '（没有）',
    recent ? `\n## 最近几节课\n${recent}` : '',
    due ? `\n## 到期的复现组（开头复现从这里挑，按学生的规则：一轮最多几组、从没复现 > 上次没过 > 过期久）\n${due}` : '',
    todos.length ? `\n## 学生上课时问过、教案里没有的（待办）\n和这一块有关的排进讲解顺序补上，补上了的编号写进 todos；和这一块无关的留着以后补\n${todos.map((t) => `- ${t.id}${t.block ? `（${t.block}）` : ''}：${String(t.text || '').slice(0, 300)}`).join('\n')}` : '',
    '',
    `## 能用的组件\n${components.join('、')}`,
    '',
    '## 要你写的教案（只输出 JSON，不要别的文字；字符串里公式的反斜杠写两个，比如 "$\\\\frac{1}{2}$"）',
    '{',
    '  "unit": "这节课的名字（短）",',
    '  "goal": "这节课要学生最后能做到什么（具体到能检验）",',
    '  "scope": "这节课讲到哪、不讲什么、考试口径（照范围和文稿，不要超出）",',
    '  "route": "开课时给学生看的路线：三到六行，先做什么、再讲什么、怎么练、大概到哪结束",',
    '  "review": [{"id": "R19", "how": "开头怎么复现这一组（一道不贴标签的新题，写清题面和考哪一点）"}],',
    '  "methods": [{"id": "m1", "title": "怎么找谓语", "steps": "照着就能做的步骤：第一步……第二步……；判据用书上的清单和明确的标志，不用「感觉像不像」", "scope": "完整的，还是暂时清单（只够这节课的题，以后会补）", "teach": 2}],',
    '  "sequence": [{"step": 1, "point": "这一步讲什么（一步一块板：一个点，或者大的点的一部分）", "how": "怎么讲：用哪个例句 / 例子、哪个组件或教具让学生动手（揭开、拖、一步步走，不是考题）", "check": "讲完怎么轻轻确认一下（可以没有）"}],',
    '  "problems": [{"q": "题面（数值写全，矩阵写成 [[1,2],[3,4]]）", "answer": "答案", "point": "考点", "needs": ["m1", "m2"], "after": 3, "traps": "学生可能怎么错（按记忆里的错题和弱点）", "source": "来源（教材例题编号，或「自编」）"}],',
    '  "chunks": ["这节课要照着讲的教材、文稿条目编号（从上面挑；会全文放进资料包，别挑不用的）"],',
    '  "components": ["这节课会用到的组件名（从上面挑，三到八个；answer、quiz、steps、scene、predict 这几个常用的一直带着，不用列。要用 practice、matrix、derive、sketch、image、演示组件的一定列上：没列的课堂里只有标题，用的时候要多跑一轮去查写法）"],',
    '  "plan": "补充说明：上面没写到的推进细节、什么情况下换讲法（可以空）",',
    '  "student": "这节课特别要注意的学生情况（记忆里已经有的不用抄，只写对这节课最要紧的一两句）",',
    '  "todos": ["这节课补上的待办编号（上面「待办」里的；没有就空数组）"],',
    ...(exam ? ['  "examBar": {"id": "这节课结束时学生要能做的那道真题的题号（从上面「这一块在考试里」的代表题、目录里挑）", "why": "为什么挑它（一句话：考法、难度和这节课的目标对得上）"}'] : []),
    '}',
    '',
    '写之前照这几条自己核一遍：',
    '1. **先讲后练**：methods 里每条规则的 teach 是 sequence 里讲它的那一步；每道题的 needs 列出做这道题要用到的**全部**规则，after 写它放在第几步讲完之后。题目要用的规则必须都在 after 之前讲过。逐题自己做一遍，把用到的每一个判断都对一下：用到了 methods 里没有的，要么补进 methods 和 sequence，要么换一道题。',
    '2. **规则写完整**：methods 的 steps 要让第一次学的人照着就能做，例外和容易混的情况写进去（比如「代词自己一块」「名词\'s 是前置修饰」这类题里会碰到的）；只够这节课的写明是暂时清单。',
    '3. **按内容分步，讲透为先**：sequence 一步一块板；小的点一步讲完，大的点（规则多、步骤长、要配表和例题）按顺序分两三步，不为了少几步把内容压缩、省步骤；讲解时的互动是揭开、拖、一步步走，考题放在讲完之后出。',
    '4. **答案自己先算一遍**再写；基础题检验机制、混合题对齐考试难度，按学生的规则出；书上说「不用掌握」的叫法不当判分点。',
  ].filter((x) => x !== '').join('\n');
}

/**
 * 页面再核一遍教案的依赖（不调用 Claude）：每道题要用的规则有没有、是不是在它之前讲过；规则有没有排进讲解顺序。
 * 返回问题列表（中文，一条一句）。课堂里的 Claude 看得到（资料包里「备课检查」），学生开课前在首页也看得到。
 */
export function checkPrep(main = {}, problems = {}) {
  const methods = Array.isArray(main.methods) ? main.methods : [];
  const seq = Array.isArray(main.sequence) ? main.sequence : [];
  const items = Array.isArray(problems.items) ? problems.items : [];
  const steps = new Set(seq.map((x, i) => Number(x.step) || i + 1));
  const byId = new Map(methods.map((m) => [m.id, m]));
  const out = [];
  for (const m of methods) {
    if (!m.steps) out.push(`规则 ${m.id}（${one(m.title, 20)}）没写步骤`);
    if (!Number(m.teach)) out.push(`规则 ${m.id}（${one(m.title, 20)}）没排进讲解顺序（teach 写第几步讲）`);
    else if (seq.length && !steps.has(Number(m.teach))) out.push(`规则 ${m.id} 的 teach=${m.teach}，讲解顺序里没有这一步`);
  }
  items.forEach((p, i) => {
    const n = `第 ${i + 1} 题`;
    const needs = list(p.needs);
    if (!needs.length) { if (methods.length) out.push(`${n}没写要用到哪几条规则（needs）`); return; }
    for (const id of needs) {
      const m = byId.get(id);
      if (!m) { out.push(`${n}要用的 ${id} 不在规则清单里：先讲清再出，或者换题`); continue; }
      if (Number(p.after) && Number(m.teach) && Number(m.teach) > Number(p.after)) out.push(`${n}放在第 ${p.after} 步之后，但它要用的 ${id}（${one(m.title, 16)}）第 ${m.teach} 步才讲`);
    }
  });
  return out;
}

/** 读备课结果：字段清理、编号只留挂着的、组件只留认得的、页面核一遍依赖；返回 { main, problems, warnings } */
// examIds：这一块能用的真题题号（Set）；给了就核 examBar
export function parsePrep(raw, { block, chunkIds = [], components = [], today = '', reviewIds = null, todos = [], examIds = null } = {}) {
  const o = jsonOf(raw);
  const text = (v, n = 8000) => String(v ?? '').trim().slice(0, n);
  const okComp = new Set(components);
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const methods = arr(o.methods).slice(0, 12).map((m, i) => ({ id: text(m.id, 12) || `m${i + 1}`, title: text(m.title, 60), steps: text(m.steps, 1500), ...(m.scope ? { scope: text(m.scope, 200) } : {}), ...(Number(m.teach) ? { teach: Number(m.teach) } : {}) }));
  const sequence = arr(o.sequence).slice(0, 20).map((x, i) => ({ step: Number(x.step) || i + 1, point: text(x.point, 200), how: text(x.how, 800), ...(x.check ? { check: text(x.check, 300) } : {}) }));
  const review = arr(o.review).filter((r) => !reviewIds || reviewIds.includes(String(r.id))).slice(0, 4).map((r) => ({ id: text(r.id, 12), how: text(r.how, 800) }));
  const main = {
    unit: text(o.unit, 120) || `${block?.id || ''} ${block?.title || ''}`.trim(),
    goal: text(o.goal, 2000), scope: text(o.scope, 4000), route: text(o.route, 1200), plan: text(o.plan, 8000), student: text(o.student, 2000),
    ...(review.length ? { review } : {}), ...(methods.length ? { methods } : {}), ...(sequence.length ? { sequence } : {}),
    block: block?.id || null,
    chunks: list(o.chunks).filter((id) => chunkIds.includes(id)),
    components: list(o.components).filter((c) => okComp.has(c)).slice(0, 10),
    // 这节课要补的待办：带上原话，课堂里的 Claude 看得到学生以前问过什么
    ...(() => { const t = list(o.todos).map((id) => todos.find((x) => String(x.id) === String(id))).filter(Boolean).map((x) => ({ id: String(x.id), text: text(x.text, 300) })); return t.length ? { todos: t } : {}; })(),
    by: 'desk', at: Date.now(), ...(today ? { date: today } : {}),
  };
  const problems = { items: (Array.isArray(o.problems) ? o.problems : []).filter((p) => p && p.q).slice(0, 20).map((p) => ({ q: text(p.q, 2000), answer: text(p.answer, 2000), point: text(p.point, 200), ...(list(p.needs).length ? { needs: list(p.needs).slice(0, 8) } : {}), ...(Number(p.after) ? { after: Number(p.after) } : {}), ...(p.traps ? { traps: text(p.traps, 400) } : {}), source: text(p.source, 200) })) };
  if (!main.goal && !main.plan && !sequence.length) throw new Error('备课结果里没有目标和讲解顺序');
  // examBar：这节课结束时学生要能做的真题（考情第 4 批）；不是这一块能用的真题不收、写进备课检查
  const bar = o.examBar && typeof o.examBar === 'object' ? { id: text(o.examBar.id, 30), why: text(o.examBar.why, 300) } : null;
  const barBad = bar?.id && examIds && !examIds.has(bar.id);
  if (bar?.id && !barBad) main.examBar = bar;
  const warnings = [...checkPrep(main, problems), ...(barBad ? [`examBar 写的 ${bar.id} 不是这一块能用的真题（留作模考的、别的块的、库里没有的都不行）`] : [])];
  if (warnings.length) main.prepCheck = warnings.slice(0, 12);
  return { main, problems, warnings };
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
  // 课前预演（rehearse.js）：按这个学生的记录把教案走了一遍，哪一步会卡、拿什么题探
  if (main.rehearsal && typeof main.rehearsal === 'object') { const t = rehearsalText(main.rehearsal); if (t) out.rehearsal = t; }
  return out;
}

/** 「10-17」「10～17」「12」→ [10, 17]；写不对、空的 → null */
export function parsePages(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,4})(?:\s*[-~～—–到]\s*(\d{1,4}))?$/);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2] ?? m[1]);
  return b >= a ? [a, b] : [b, a];
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

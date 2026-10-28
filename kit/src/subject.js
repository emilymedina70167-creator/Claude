// 科目：课件开头的 subject: 写哪门课。课堂说明每一轮有 160 KiB 的上限，四门计算机课的组件说明全塞进去会超，
// 所以 CLAUDE-PROJECT.md 第三节的小节标题下面写着它是哪门课的（<!-- 科目：数据结构 操作系统 -->），
// 课堂里只带「通用 + 这门课」的那几节。纯函数，不碰 DOM，有测试（tests/subject.test.js）。

// 规范的名字 → 认得的写法
const NAMES = {
  线代: ['线代', '线性代数', 'linear algebra', 'la'],
  数据结构: ['数据结构', '数构', 'ds', 'data structure', 'data structures'],
  操作系统: ['操作系统', 'os', 'operating system', 'operating systems'],
  组成原理: ['组成原理', '计算机组成原理', '计组', '计算机组成', 'co', 'computer organization'],
  计网: ['计网', '计算机网络', '网络', 'cn', 'computer network', 'computer networks'],
  英语: ['英语', 'english', 'en', '英语一', '考研英语', '语法', 'grammar'],
};
export const SUBJECTS = Object.keys(NAMES);
// 计算机四门（408）：教法、术语附不附英文和线代不一样
export const CS = ['数据结构', '操作系统', '组成原理', '计网'];

/** 课件写的科目 → 规范的名字（线代 / 数据结构 / 操作系统 / 组成原理 / 计网）；不认识的（比如概率论）返回 '' */
export function subjectKey(s) {
  const t = String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return '';
  for (const [k, names] of Object.entries(NAMES)) if (names.includes(t)) return k;
  return '';
}

export const isCS = (s) => CS.includes(subjectKey(s));
export const isEN = (s) => subjectKey(s) === '英语';

// 小节的科目标记：<!-- 科目：数据结构 操作系统 -->（冒号全角半角都行，几门课用空格、逗号、顿号隔开）
const TAG_RE = /^\s*<!--\s*科目\s*[:：]\s*(.*?)\s*-->\s*$/;
export function parseTag(line) {
  const m = TAG_RE.exec(line);
  if (!m) return null;
  return m[1].split(/[\s,，、/]+/).filter(Boolean).map((x) => subjectKey(x) || x);
}

// 行首（最多 3 个空格）的围栏
function fenceOf(line) {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  const info = m[2].trim();
  if (m[1][0] === '`' && info.includes('`')) return null;
  return { ch: m[1][0], len: m[1].length, info };
}

// 小节里的「<!-- 完整写法 -->」：这一行以前是精简版（课堂说明里一直带着），以后是不常用的字段和更多例子。
// 课堂说明有长度上限，完整写法让课堂 Claude 按名字取（component_doc 工具），写错了页面也会附上；
// 对话里写课件的 Claude 读的是整份 CLAUDE-PROJECT.md，两部分都看得到。
const DETAIL_RE = /^\s*<!--\s*完整写法\s*-->\s*$/;

// 小节标题里的组件名：「### sched / paging / banker / disk：操作系统的过程」→ sched paging banker disk。
// 只认两个字母以上的英文词（「C 代码」「含 n 的式子」里的单个字母不算）
export function sectionNames(heading) {
  const t = String(heading ?? '').replace(/^#+\s*/, '');
  const out = [];
  for (const m of t.matchAll(/(?<![\w-])([A-Za-z][\w-]+)/g)) {
    const n = m[1].toLowerCase();
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * 第三节按 ### 切成小节：{ head（标题行）, names, tags（null = 通用）, body（精简版的行）, detail（完整写法的行，没有就是 null）}。
 * 第一个 ### 之前的话是 head 为空的一节。代码块里的 ###、标记都不算。
 */
export function docSections(docs) {
  const lines = String(docs ?? '').split('\n');
  const out = [];
  let open = null;
  let cur = { head: '', names: [], tags: null, body: [], detail: null };
  const push = () => { out.push(cur); };
  for (const line of lines) {
    const f = fenceOf(line);
    const into = (l) => (cur.detail ? cur.detail : cur.body).push(l);
    if (open) {
      if (f && !f.info && f.ch === open.ch && f.len >= open.len) open = null;
      into(line);
      continue;
    }
    if (f) { open = f; into(line); continue; }
    if (/^#{1,3}\s/.test(line)) {
      push();
      cur = { head: line, names: /^###\s/.test(line) ? sectionNames(line) : [], tags: null, body: [line], detail: null };
      continue;
    }
    const tag = parseTag(line);
    if (tag) { cur.tags = tag; continue; }
    if (DETAIL_RE.test(line) && !cur.detail) { cur.detail = []; continue; }
    into(line);
  }
  push();
  return out;
}

const forSubject = (sec, key) => !sec.tags || !key || sec.tags.includes(key);
const tidy = (lines) => lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
// 精简版的末尾指一下完整写法在哪
// （lookup：课堂 Claude 有没有 component_doc 工具；没有时只能等写错了页面附上）
// 说明开头讲过怎么取、写错了会附上，这里只留一句（每节都有，越短越好）
const pointer = (sec, lookup) => (lookup ? `（更多写法：component_doc 取 ${sec.names[0]}）` : '（还有更多写法）');

/**
 * 组件说明（componentDocs 截出来的第三节）按科目挑：没有标记的小节是通用的，一直留着；
 * 标了科目的小节只留给那几门课。subject 不认识（或没写）时全部留着。标记行本身去掉。
 * full：有「完整写法」的小节带不带后半段——true 全带，false（默认）都不带，也可以是组件名的数组（只带这几个的）。
 * 不带的在精简版末尾写一句完整写法怎么取（lookup：有没有 component_doc 工具）。
 */
export function docsForSubject(docs, subject, { full = false, lookup = true, only = null } = {}) {
  const key = subjectKey(subject);
  const want = Array.isArray(full) ? new Set(full.map((x) => String(x).toLowerCase())) : null;
  // only：只带这些组件的写法（常用的 + 资料包点名的），别的组件只留标题一行，要用时按名字取（没有工具取不了，就不省）
  const keepOnly = only && lookup ? new Set([...only].map((x) => String(x).toLowerCase())) : null;
  const out = [];
  for (const sec of docSections(docs)) {
    if (!forSubject(sec, key)) continue;
    if (keepOnly && sec.names.length && !sec.names.some((n) => keepOnly.has(n))) {
      out.push(sec.head, '', `（这节课没点名，只留了标题。要用时 component_doc 取 ${sec.names[0]}；写错了页面也会附上写法）`, '');
      continue;
    }
    out.push(...sec.body);
    if (!sec.detail) continue;
    const take = full === true || (want && sec.names.some((n) => want.has(n)));
    if (take) out.push(...sec.detail);
    else {
      while (out.length && out[out.length - 1] === '') out.pop();
      out.push('', pointer(sec, lookup), '');
    }
  }
  // 去掉小节后留下的连续空行
  return tidy(out);
}

/** 有完整写法的组件名（这门课的） */
export function detailNames(docs, subject) {
  const key = subjectKey(subject);
  return docSections(docs).filter((s) => s.detail && forSubject(s, key)).flatMap((s) => s.names);
}

/**
 * 一个组件的完整说明（精简版 + 完整写法）：标题里有这个名字的小节都算（answer 和「answer 的线代写法」），
 * 只要这门课的。找不到返回 null。
 */
export function componentDoc(docs, name, subject) {
  const key = subjectKey(subject);
  const n = String(name ?? '').trim().replace(/^`|`$/g, '').toLowerCase();
  if (!n) return null;
  const all = docSections(docs).filter((s) => forSubject(s, key));
  let secs = all.filter((s) => s.names.includes(n));
  // 中文的名字（「演示组件」「表达式」）：标题里有就算
  if (!secs.length) secs = all.filter((s) => /^###\s/.test(s.head) && s.head.toLowerCase().includes(n));
  if (!secs.length) return null;
  return secs.map((s) => tidy([...s.body, ...(s.detail || [])])).join('\n\n');
}

/** 这门课的说明里有小节的全部组件名（component_doc 找不到时列给它看） */
export function allNames(docs, subject) {
  const key = subjectKey(subject);
  return [...new Set(docSections(docs).filter((s) => forSubject(s, key)).flatMap((s) => s.names))];
}

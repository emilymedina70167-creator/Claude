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

/**
 * 组件说明（componentDocs 截出来的第三节）按科目挑：没有标记的小节是通用的，一直留着；
 * 标了科目的小节只留给那几门课。subject 不认识（或没写）时全部留着。标记行本身去掉。
 * 小节以 ### 为界；代码块里的 ### 和标记不算。
 */
export function docsForSubject(docs, subject) {
  const key = subjectKey(subject);
  const lines = String(docs ?? '').split('\n');
  const out = [];
  let open = null;
  let section = []; // 当前小节的行
  let tags = null; // 当前小节的科目；null = 通用
  const flush = () => {
    if (!tags || !key || tags.includes(key)) out.push(...section);
    section = [];
    tags = null;
  };
  for (const line of lines) {
    const f = fenceOf(line);
    if (open) {
      if (f && !f.info && f.ch === open.ch && f.len >= open.len) open = null;
      section.push(line);
      continue;
    }
    if (f) { open = f; section.push(line); continue; }
    if (/^#{1,3}\s/.test(line)) flush();
    const tag = parseTag(line);
    if (tag) { tags = tag; continue; }
    section.push(line);
  }
  flush();
  // 去掉小节后留下的连续空行
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 留作模考（docs/exam-plan.md 1.2）：最近三年的整卷默认留到冲刺阶段做模考。留着的卷只进统计（考没考、几分），
// 题面、答案、坑、代表题一律不出现在课堂、备课、教研室出题和练一练里。
// 光过滤真题拦不住：王道的条目里本来就带年份真题（「【2025 统考真题】…」），会经教材进课堂——所以教材条目里出现
// 留着那几年的统考标记就整条剔掉（scrubBooks 接在开课、备课读教材的那一处，textbookForClass、textbook_search、
// textbook_read、目录、备课全都拿不到）。纯函数（readReserve 除外），有测试（tests/exam-reserve.test.js）。

/**
 * 最近一次考过的那张卷的年份。卷按招生年份叫：2025 年 12 月考的叫 2026 卷。
 * 12 月 26 日以后算今年 12 月那次考过了（初试在 12 月下旬）
 */
export function latestPaperYear(today) {
  const [y, m, d] = String(today || '').split('-').map(Number);
  if (!y) return new Date().getFullYear();
  return m === 12 && d >= 26 ? y + 1 : y;
}

/** 留着哪几年：档案里写了数组就用它（空数组 = 一张都不留），没写是默认的最近三年 */
export function reserveYears(target, today) {
  if (Array.isArray(target?.reserve)) return target.reserve.map(Number).filter(Boolean);
  const y = latestPaperYear(today);
  return [y - 2, y - 1, y];
}

// 统考标记：年份后面跟着「统考 / 联考 / 真题 / 全国硕士…招生考试 / 科目名」，或者括号里的年份后面跟着这些。
// 年份和后面的字之间可以有「年」、空格、逗号、间隔号（数学辅导书常写「（2024，数一）」「(2024,数学一,5分)」），全角数字先转半角。
// 只有年份不算（2025 年版、1945 年的冯诺依曼结构）；「考研」后面没有真题、试题不算（2025 年考研大纲新增了…、2026 考研复习指导）；
// 科目名后面跟着「轮 / 分 / 数字」的不算（数学一轮复习、408 分以上）；「政治」要跟着真题才算（政治局、政治经济学）
const Y = '(20\\d{2})';
const SEP = '\\s*年?\\s*[，,、·・]?\\s*';
const SUBJ = '(?:数学[一二三](?![轮\\d])|数[一二三](?![轮\\d])|英语[一二](?!\\d)|408(?![分\\d]))';
const EXAM = '(?:全国\\s*)?(?:硕士\\s*)?(?:计算机\\s*)?(?:统考|联考)';
const PAPER = '(?:真题|试题|试卷)';
const MARKS = [
  new RegExp(`[【（(\\[]\\s*${Y}${SEP}(?:${EXAM}|考研\\s*${PAPER}|${PAPER}|${SUBJ})`, 'g'),
  new RegExp(`${Y}${SEP}(?:全国\\s*)?(?:硕士研究生|硕士|研究生)\\s*(?:招生|入学)\\s*考试`, 'g'),
  new RegExp(`${Y}${SEP}${EXAM}`, 'g'),
  new RegExp(`${Y}${SEP}${SUBJ}`, 'g'),
  new RegExp(`${Y}${SEP}(?:考研\\s*|政治\\s*)?${PAPER}`, 'g'),
];
const halfDigits = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** 一段字里统考标记的年份（去重） */
export function markYears(text) {
  const s = halfDigits(String(text || ''));
  const out = new Set();
  for (const re of MARKS) for (const m of s.matchAll(re)) { const y = Number(m[1]); if (y >= 2009) out.add(y); }
  return [...out];
}

const yearOf = (q) => Number(q?.year) || Number(String(q?.id || '').match(/^Q-\d{3}-(\d{4})-/)?.[1]) || 0;

/** 这道真题能不能用（课堂、备课、练一练、教研室出题）：留着那几年的、卷标了 reserve 的都不能用 */
export function usable(q, years = []) {
  if (!q || q.reserve) return false;
  return !years.includes(yearOf(q));
}

// 一条习题的题号（标题开头的数：「18.」「01.【解答】」「18」）
const numOf = (c) => { const m = String(c?.title || '').match(/^\s*0*(\d{1,3})\s*(?:[.．、]|【|$)/); return m ? Number(m[1]) : null; };
const ANSWERISH = /答案|解析|解答|详解/;
const placeOf = (c, n) => `${c.vol || c.book || ''}|${c.chapter || ''}|${n}`;

/**
 * 教材条目里带着留着那几年统考标记的整条剔掉；它的答案、解析多半在同一章「答案与解析」那一节，只写「18.【解析】」、不重复年份，
 * 所以同一本书同一章、同一个题号、看得出是答案的那条一起剔
 */
export function scrubChunks(chunks = [], years = []) {
  if (!years.length) return chunks;
  const set = new Set(years.map(Number));
  const gone = new Set();
  const places = new Set();
  for (const c of chunks) {
    if (!markYears(`${c?.title || ''}\n${c?.text || ''}`).some((y) => set.has(y))) continue;
    gone.add(c);
    const n = numOf(c);
    if (n !== null) places.add(placeOf(c, n));
  }
  for (const c of chunks) {
    if (gone.has(c)) continue;
    const n = numOf(c);
    if (n !== null && places.has(placeOf(c, n)) && ANSWERISH.test(`${c.section || ''} ${c.title || ''} ${c.kind || ''}`)) gone.add(c);
  }
  return chunks.filter((c) => !gone.has(c));
}

/** 课堂、备课拿到的那一份教材（normalizeBooks 的结果）剔过的样子：别的字段原样，多一个 scrubbed（剔掉了几条） */
export function scrubBooks(b = {}, years = []) {
  const chunks = scrubChunks(b.chunks || [], years);
  return { ...b, chunks, scrubbed: (b.chunks || []).length - chunks.length };
}

/** 读档案里留着的年份；读不到、ms 毫秒没回来就用默认（开课不为它多等） */
export async function readReserve(db, today, { ms = 3000 } = {}) {
  const fallback = reserveYears(null, today);
  try {
    const snap = await Promise.race([db.doc('exam/target').get(), new Promise((r) => setTimeout(() => r(null), ms))]);
    return snap?.exists ? reserveYears(snap.data(), today) : fallback;
  } catch {
    return fallback;
  }
}

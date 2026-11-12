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

// 统考标记：年份后面跟着「统考 / 考研 / 真题 / 全国硕士…招生考试 / 科目名」，或者括号里的年份后面跟着这些。
// 只有年份不算（教材里年份很多：2025 年版、1945 年的冯诺依曼结构）
const Y = '(20\\d{2})';
const MARKS = [
  new RegExp(`[【（(\\[]\\s*${Y}\\s*年?\\s*(?:全国\\s*)?(?:硕士\\s*)?(?:统考|考研|真题)`, 'g'),
  new RegExp(`${Y}\\s*年?\\s*(?:全国\\s*)?(?:硕士研究生|硕士|研究生)?\\s*(?:招生考试|入学考试|统考|考研)`, 'g'),
  new RegExp(`${Y}\\s*年?\\s*(?:408|数学[一二三]|数[一二三]|英语[一二]|政治)(?!\\d)`, 'g'),
  new RegExp(`${Y}\\s*年?\\s*真题`, 'g'),
];

/** 一段字里统考标记的年份（去重） */
export function markYears(text) {
  const s = String(text || '');
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

/** 教材条目里带着留着那几年统考标记的整条剔掉 */
export function scrubChunks(chunks = [], years = []) {
  if (!years.length) return chunks;
  const set = new Set(years.map(Number));
  return chunks.filter((c) => !markYears(`${c?.title || ''}\n${c?.text || ''}`).some((y) => set.has(y)));
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

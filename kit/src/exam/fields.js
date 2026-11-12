// 组件写 exam: / like:（docs/exam-plan.md 4.1）：这道题是哪一道真题（exam=），或者对标哪一道真题出的（like=）。
// 渲染时（render.js）拿掉这两行、挂在组件外面（data-exam / data-like），组件不用一个个改；作答记录（session.record）从那一层取。
// 字段名不叫 q：q 已经是题面（证据、组件、题库、记忆点里都是）。纯函数，有测试（tests/exam-fields.test.js）。
const LINE = /^\s*(exam|like)\s*[:：]\s*(\S+)\s*$/;
const QID = /^Q-(?:101|201|301|408)-\d{4}-\d{1,2}$/;

/** 组件的原文 → { exam, like, body（拿掉这两行的）}；不像题号的不收（那一行照样拿掉） */
export function takeExamFields(body) {
  const out = { exam: '', like: '' };
  const keep = [];
  for (const line of String(body ?? '').split('\n')) {
    const m = line.match(LINE);
    if (!m) { keep.push(line); continue; }
    if (QID.test(m[2])) out[m[1]] = m[2];
  }
  return { ...out, body: keep.join('\n') };
}

/** 一次作答的组件挂着的题号：{ exam?, like? } */
export function examOfRecord(el) {
  if (!el?.closest) return {};
  const e = el.closest('[data-exam]')?.dataset?.exam;
  const l = el.closest('[data-like]')?.dataset?.like;
  return { ...(e ? { exam: e } : {}), ...(l ? { like: l } : {}) };
}

/**
 * 舞台的 exam= / like= 当场核（scene.js 的 examCheck）：这门课的考试资料读到以后，题号库里没有、是留作模考的卷就报。
 * exam：load.js 的结果；years：留作模考的年份。返回 (id) → 出错的话 | ''
 */
export function examCheckOf(exam, years = []) {
  const all = new Map((exam?.questions || []).map((q) => [q.id, q]));
  const yearOf = (id) => Number(String(id).match(/^Q-\d{3}-(\d{4})-/)?.[1]) || 0;
  return (id) => {
    if (years.includes(yearOf(id)) || all.get(id)?.reserve) return `${id} 是留作模考的卷，课上不能用（换一道能用的，或者照它 like= 出一道）`;
    if (!all.has(id)) return `库里没有这道真题 ${id}（写「这一块在考试里」那一节列着的题号）`;
    return '';
  };
}
export const QID_RE = QID;

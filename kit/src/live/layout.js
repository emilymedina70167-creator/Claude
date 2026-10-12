// 实时黑板（外部版）：对话里的 Claude 往 steps 里写的段，排成一块一块的板（纯函数，不碰 DOM，有测试）。
//
// steps/{id}：{ seq, md, title?, page?, pin?, hidden? }
// - page：写在第几块板。不写就接着前一段（按 seq）那块板；第一段不写就是第 1 块。
// - pin: true（或 place: "pin"）：放进常驻栏，不在哪块板上。
// - 一块板的标题就是板上第一段（seq 最小、没撤回的）的 title（没写就用它开头的 ## 小标题）；那一段自己不再写小标题。
// - hidden: true 的段不显示；一块板上的段都撤回了，这块板就没了。

const isPin = (d) => d.pin === true || d.place === 'pin';
// 段开头的 ## 小标题（对话里的 Claude 习惯照 guided 课件那样写）：没写 title 时拿它当板的标题
export const leadingHeading = (md) => (String(md ?? '').trimStart().match(/^##[ \t]+(.+?)[ \t#]*(?:\n|$)/)?.[1] || '').trim();
const pageOf = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : 0;
};

/**
 * docs：[{ id, seq, page, pin, place, title, hidden }]
 * 返回 { steps: Map(id → { page, place, lead }), pages: [{ n, title, lead }]（按板号排）, cur }
 * cur 是最新那块板（板号最大的、有看得见的段的那块），没有板时是 0。
 */
export function planBoards(docs) {
  const list = (Array.isArray(docs) ? docs : []).filter((d) => d && d.id !== undefined && d.id !== null)
    .slice().sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0) || (String(a.id) > String(b.id) ? 1 : String(a.id) < String(b.id) ? -1 : 0));
  const steps = new Map();
  const pages = new Map();
  let prev = 0;
  for (const d of list) {
    const id = String(d.id);
    if (isPin(d)) {
      steps.set(id, { page: 0, place: 'pin', lead: false });
      continue;
    }
    // 没写板号：接着前一段那块板（撤回的段也算，免得撤回一段后后面的段跳板）
    const page = pageOf(d.page) || prev || 1;
    prev = page;
    const lead = !d.hidden && !pages.has(page);
    if (lead) pages.set(page, { n: page, title: String(d.title ?? '').trim() || leadingHeading(d.md), lead: id });
    steps.set(id, { page, place: 'board', lead });
  }
  const sorted = [...pages.values()].sort((a, b) => a.n - b.n);
  return { steps, pages: sorted, cur: sorted.length ? sorted.at(-1).n : 0 };
}

/**
 * 一段要写回数据库的写法检查结果（lint/{段 id}）：没问题、而且以前也没记过问题时不用写（返回 null）。
 * problems：[{ kind, msg, soft? }]；before：数据库里现在的那条（没有就是 undefined）
 */
export function lintRecord(id, title, problems, before) {
  const list = (problems || []).map((p) => ({ kind: String(p.kind || ''), msg: String(p.msg || ''), ...(p.soft ? { soft: true } : {}) }));
  const had = Array.isArray(before?.problems) && before.problems.length > 0;
  if (!list.length && !had) return null;
  const next = { id: String(id), step: String(id), title: String(title || ''), ok: !list.some((p) => !p.soft), problems: list };
  if (before && before.ok === next.ok && JSON.stringify(before.problems || []) === JSON.stringify(list) && (before.title || '') === next.title) return null;
  return next;
}

/**
 * 屏幕和当前板放不放得下（meta/screen），给对话里的 Claude 看：写之前先比一下，差不多就不重复写。
 * 像素取整到 10，免得滚动、键盘弹出时的一两个像素也写一次。
 */
export function screenRecord({ w, h, board, page, fit }) {
  const r10 = (v) => Math.round((Number(v) || 0) / 10) * 10;
  const rec = {
    id: 'screen',
    w: r10(w), h: r10(h), landscape: Number(w) > Number(h),
    board: board && board.w > 0 ? { w: r10(board.w), h: r10(board.h) } : null,
    page: Number(page) || 0,
    fits: fit ? !!fit.fits : null,
    need: fit ? r10(fit.need) : null,
  };
  return rec;
}

export const sameScreen = (a, b) => !!a && !!b && JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });

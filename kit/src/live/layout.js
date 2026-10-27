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

/**
 * 黑板现状（meta/now）：对话里的 Claude 一次 get 就知道学生那边的全部情况，不用分别查作答、事件、写法错误、屏幕。
 * 页面在有变化后写一次（停下来约 2 秒）；内容和上一次一样就不写（比较时不看 at）。
 * - recent：最近的作答 / 动作，一行一条（和课堂模式发给课堂 Claude 的写法一样），最新的在最后
 * - drafts：现在黑板上写了、还没点「检查」「提交」的草稿
 * - lint：现在还有写法错误的段
 * - uploads：学生交给 Claude 看的截图（asset id），最新的在最后
 * - kit：这块黑板用的组件库版本。对话里的 Claude 拿它和说明的版本比，对不上就是黑板用的旧版组件库（旧版写不出新写法）
 * - ops：最近的教具指令（ops 集合里的 mark / unmark / figure）的结果，一条一行，最新的在最后
 * - marks：现在板上的标注，一段一行：「s3：m1：s3 里\hl{key}（圈）「…」；m2：…」（markspec.js 的 markText），撤标注、换讲法时靠它找 id
 * - figures：当前板和常驻栏上的图能用 figure set / play 改的变量
 */
export const NOW_LIMITS = { recent: 30, line: 300, drafts: 20, uploads: 6, lint: 20, ops: 10, marks: 20, figures: 20 };

export function statusRecord({ cur = 0, view = 0, pages = [], recent = [], drafts = [], lint = [], screen = null, uploads = [], kit = '', ops = [], marks = [], figures = [] } = {}) {
  const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const L = NOW_LIMITS;
  return {
    id: 'now',
    kit: String(kit || ''),
    board: Number(cur) || 0,
    view: Number(view) || 0,
    boards: (pages || []).map((p) => ({ n: Number(p.n) || 0, title: cut(p.title, 60) })),
    recent: (recent || []).filter(Boolean).slice(-L.recent).map((r) => (typeof r === 'string' ? { line: cut(r, L.line) } : { line: cut(r.line, L.line), ...(r.at ? { at: r.at } : {}) })),
    drafts: (drafts || []).filter((d) => d && String(d.text ?? '').trim()).slice(0, L.drafts).map((d) => ({
      step: String(d.step ?? ''), block: String(d.block ?? ''), ...(d.label ? { label: String(d.label) } : {}), text: cut(d.text, L.line),
    })),
    lint: (lint || []).filter((l) => l && l.ok === false).slice(0, L.lint).map((l) => ({ step: String(l.step ?? l.id ?? ''), problems: (l.problems || []).filter((p) => !p.soft).map((p) => cut(`${p.kind}：${p.msg}`, 200)) })),
    screen: screen ? { w: screen.w, h: screen.h, landscape: !!screen.landscape, board: screen.board || null, fits: screen.fits ?? null } : null,
    uploads: (uploads || []).slice(-L.uploads).map((u) => ({ id: String(u.id), images: (u.images || []).map(String), ...(u.note ? { note: cut(u.note, 200) } : {}), page: Number(u.page) || 0, at: u.at || 0 })),
    ops: (ops || []).map((o) => (typeof o === 'string' ? o : o?.line)).filter(Boolean).slice(-L.ops).map((l) => cut(l, L.line)),
    marks: (marks || []).filter((m) => m && m.step && (m.list || []).length).slice(0, L.marks).map((m) => cut(`${m.step}：${m.list.join('；')}`, 600)),
    figures: (figures || []).filter((f) => f && f.id).slice(0, L.figures).map((f) => ({
      id: String(f.id), ...(f.kind ? { kind: String(f.kind) } : {}), step: String(f.step ?? ''), vars: (f.vars || []).map(String).slice(0, 30),
    })),
  };
}

export const sameStatus = (a, b) => !!a && !!b && JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });

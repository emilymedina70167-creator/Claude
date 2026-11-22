// 这节课的一页：下课时页面把一节课整理成一页复习用的板——记号和结论（常驻栏）、
// 重点 / 定义 / 定理 / 易错框、做错又改对的题和当时的错答、还没拿下的题。页面自己拼，不调用 Claude；
// 小结那块板、学习台「以前的课」、复现课的资料包都用它。纯函数（tests/memory-sheet.test.js）。

// 板上值得留下的框（content.js 的 callout）
export const SHEET_CALLOUTS = { remember: '要背', definition: '定义', theorem: '定理', key: '重点', warning: '易错' };
const MAX_KEYS = 10;
const MAX_ITEMS = 8;
export const SHEET_MAX = 6000; // 一页多长（字）：放进复现课的资料包也不占太多

const cut = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const oneLine = (s, n) => cut(String(s ?? '').replace(/\s+/g, ' '), n);

/** 一段 Markdown 里的重点框：```remember / key / definition / theorem / warning（title: 那行是标题） */
export function calloutsIn(md) {
  const out = [];
  const re = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*(remember|definition|theorem|key|warning)[ \t]*\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*$/gm;
  let m;
  while ((m = re.exec(String(md ?? '')))) {
    let body = m[3].replace(/\n$/, '');
    let title = '';
    for (;;) {
      const f = body.match(/^\s*(title|id)\s*[:：]\s*(.*)\n?/i);
      if (!f) break;
      if (f[1].toLowerCase() === 'title') title = f[2].trim();
      body = body.slice(f[0].length);
    }
    out.push({ kind: m[2], title, md: body.trim() });
  }
  return out;
}

/**
 * steps：这节课黑板上的段（place / hidden / failed / seq / title / md）；items：课后报告的题（report.js 的 itemsOf）。
 * 返回 { notes: [{ title, md }]（常驻栏）, keys: [{ kind, title, md, seg }], fixed: [{ q, wrongs, last, seg }], open: [{ q, outcome, expected }] }
 */
export function lessonSheet({ steps = [], items = [] } = {}) {
  const live = (steps || []).filter((s) => s && !s.hidden && !s.failed && String(s.md || '').trim()).sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const notes = live.filter((s) => s.place === 'pin').map((s) => ({ title: cut(s.title, 40), md: cut(s.md, 600) }));
  const keys = [];
  for (const s of live) {
    if (s.place === 'pin') continue;
    for (const c of calloutsIn(s.md)) if (keys.length < MAX_KEYS) keys.push({ ...c, title: cut(c.title, 60), md: cut(c.md, 800), seg: s.id });
  }
  const its = (items || []).filter(Boolean);
  // 做错又改对的：当时写错的那几次留着（复习时最有用的就是「我当时是怎么错的」）
  const fixed = its.filter((it) => it.outcome === 'ok').slice(0, MAX_ITEMS).map((it) => ({
    q: oneLine(it.q || it.segTitle || it.comp || '', 120), wrongs: (it.wrongs || []).map((w) => oneLine(w, 80)).slice(0, 3), last: oneLine(it.last, 80), seg: it.seg ?? null,
  }));
  const open = its.filter((it) => ['wrong', 'giveup', 'revealed'].includes(it.outcome)).slice(0, MAX_ITEMS).map((it) => ({
    q: oneLine(it.q || it.segTitle || it.comp || '', 120), outcome: it.outcome, wrongs: (it.wrongs || []).map((w) => oneLine(w, 80)).slice(0, 3), ...(it.expected !== undefined ? { expected: oneLine(it.expected, 80) } : {}),
  }));
  return { notes, keys, fixed, open };
}

const OPEN_TEXT = { wrong: '还没做对', giveup: '想不出来', revealed: '看了答案' };

/** 有没有东西可写（一节课只聊了几句，就不出这一页） */
export const sheetEmpty = (sh) => !sh || !((sh.notes || []).length || (sh.keys || []).length || (sh.fixed || []).length || (sh.open || []).length);

/** 写成一页 Markdown（学习台、小结板上用 mdToHtml 画；复现课的资料包直接放文字） */
export function sheetMd(sh, { max = SHEET_MAX } = {}) {
  if (sheetEmpty(sh)) return '';
  const parts = [];
  if (sh.notes?.length) parts.push(`**记号和结论**\n\n${sh.notes.map((n) => `- ${n.title ? `${n.title}：` : ''}${n.md.replace(/\n+/g, ' ')}`).join('\n')}`);
  if (sh.keys?.length) parts.push(sh.keys.map((k) => `**${SHEET_CALLOUTS[k.kind] || '重点'}${k.title ? ` · ${k.title}` : ''}**\n\n${k.md}`).join('\n\n'));
  if (sh.fixed?.length) parts.push(`**做错又改对的**\n\n${sh.fixed.map((f) => `- ${f.q}${f.wrongs.length ? `：当时写了${f.wrongs.map((w) => `「${w}」`).join('、')}` : ''}${f.last ? `，后来写对了「${f.last}」` : ''}`).join('\n')}`);
  if (sh.open?.length) parts.push(`**还没拿下的**\n\n${sh.open.map((o) => `- ${o.q}（${OPEN_TEXT[o.outcome] || o.outcome}${o.wrongs?.length ? `，写过${o.wrongs.map((w) => `「${w}」`).join('、')}` : ''}${o.expected ? `；答案 ${o.expected}` : ''}）`).join('\n')}`);
  const md = parts.join('\n\n');
  return md.length > max ? `${md.slice(0, max)}\n\n（后面省略了）` : md;
}

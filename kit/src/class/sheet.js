// 按题汇总的作答表（sessions/{课号}/meta/answers）：这节课的证据按组件拢成一道题一行。
// 外部主讲以前每轮都要从一百多条流水证据里手数（点一下生词、演示走一步各占一条）。
// 只列事实：每次怎么答、页面怎么判、点开过哪些生词、演示走到第几步、有没有点放弃；
// 不算「掌握了没有」、不给建议（那是主讲自己的判断）。流水证据照旧在 evidence 里。纯函数，tests/class-sheet.test.js。

const cut = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
/** 一行最多留最后几次作答（n 是总次数） */
export const SHEET_TRIES = 12;

// 页面判错时说的话：各种题放在不同的栏里
function whyOf(e) {
  if (typeof e.detail === 'string' && e.detail) return e.detail;
  if (e.fail) return String(e.fail);
  if (Array.isArray(e.wrong) && e.wrong.length) return `选了 ${e.wrong.join('、')}`;
  return '';
}

/**
 * evs：这节课的证据（evidence 里 session 是这节课的那些）；at：这份表算的时刻（不给就是最后一条证据的时刻）。
 * 返回 { at, n, rows }；rows 按第一次动那道题的先后排
 */
export function answerSheet(evs = [], { at = 0 } = {}) {
  const list = (evs || []).filter((e) => e && e.comp && (e.src === 'record' || e.src === 'event')).sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
  const rows = new Map();
  const rowOf = (e) => {
    if (!rows.has(e.comp)) rows.set(e.comp, { comp: String(e.comp), step: '', kind: '', title: '', q: '', n: 0, okAt: 0, tries: [], gloss: new Map() });
    const r = rows.get(e.comp);
    if (!r.step && e.step) r.step = String(e.step);
    return r;
  };
  for (const e of list) {
    const d = e.detail && typeof e.detail === 'object' ? e.detail : {};
    if (e.src === 'record') {
      const r = rowOf(e);
      r.kind = String(e.kind || r.kind);
      if (e.title) r.title = cut(e.title, 80);
      if (e.q) r.q = cut(e.q, 200);
      r.n++;
      if (e.ok && !r.okAt) r.okAt = r.n;
      const why = e.ok ? '' : whyOf(e);
      r.tries.push({ at: Number(e.at) || 0, ok: !!e.ok, ...(e.value != null && e.value !== '' ? { value: cut(e.value, 400) } : {}), ...(why ? { why: cut(why, 400) } : {}), ...(Number(e.ms) ? { ms: Number(e.ms) } : {}) });
    } else if (e.kind === 'gloss' && d.word) {
      const g = rowOf(e).gloss;
      const k = String(d.word);
      g.set(k, { word: k, gloss: cut(d.gloss, 60), n: (g.get(k)?.n || 0) + 1 });
    } else if (e.kind === 'giveup') rowOf(e).giveup = true;
    else if (e.kind === 'drag' && d.name === 'step' && Number.isFinite(Number(d.value))) { const r = rowOf(e); r.reached = Math.max(r.reached || 0, Number(d.value)); }
    else if (e.kind === 'reveal' && Number(d.step)) { const r = rowOf(e); r.revealed = Math.max(r.revealed || 0, Number(d.step)); }
  }
  const out = [...rows.values()].map(({ gloss, tries, ...r }) => ({ ...r, tries: tries.slice(-SHEET_TRIES), ...(gloss.size ? { gloss: [...gloss.values()] } : {}) }));
  return { at: at || Number(list.at(-1)?.at) || 0, n: out.length, rows: out };
}

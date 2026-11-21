// 长难句的层次图（视觉第 5 批）：主干的词在最外面一行，每个从句、插入语是缩进的一块，块里再套块——代替一行数不清的 ]]]。
// 从句块的标签能点：折起来变成「…」，前后的主干接成一句。分裂结构（~n）的两段之间画一条弧。
// 排行是 entext.js 的 layerRows（纯函数），这里只管画。
import { layerRows, joinsOf, joinWords, CLAUSE_ROLES, roleName } from '../entext.js';
import { escapeHtml } from './common.js';

/** 句子里从句最多套了几层（0：没有从句） */
export function clauseDepth(spans) {
  const cl = spans.filter((s) => CLAUSE_ROLES.has(s.role));
  return cl.reduce((m, s) => Math.max(m, cl.filter((o) => o.from <= s.from && s.to <= o.to).length), 0);
}

/**
 * 在 host 里画层次图。p = { tokens, spans }；roles 定颜色和名字（和括号的画法同一套 pz-c0…5）。
 * 返回 { update(spans)（换一组成分重画，折叠的状态清掉）, el }
 */
export function layersView(host, { tokens, spans, roles = [], fold = true, onPick = null, arcsFor = null }) {
  const el = document.createElement('div');
  el.className = `ly${onPick ? ' is-pick' : ''}`;
  host.appendChild(el);
  // onPick：学生点一段（连分裂结构用），这时不折叠；arcsFor：只画这几个 ~n 的弧（没连出来的先不画）
  if (onPick) fold = false;
  let cur = spans, folded = new Set(), chosen = new Set(), shownArcs = arcsFor;
  const color = (k) => `pz-c${Math.max(0, roles.findIndex((r) => r.key === k)) % 6}`;
  const name = (k) => roles.find((r) => r.key === k)?.name || roleName(k);
  const text = (from, to) => escapeHtml(joinWords(tokens.slice(from, to + 1).map((t) => t.w)));

  function draw() {
    let rows;
    try { rows = layerRows({ tokens, spans: cur }, { fold: [...folded] }); } catch { rows = []; }
    const html = rows.map((row) => {
      const cl = row.clause === null ? null : cur[row.clause];
      const pieces = row.pieces.map((x) => {
        if (x.folded !== undefined) return `<button type="button" class="ly-dots ${color(x.role)}" data-unfold="${x.folded}" aria-label="展开${escapeHtml(name(x.role))}">…<small>${escapeHtml(name(x.role))}</small></button>`;
        if (!x.role) return `<span class="ly-piece is-plain" data-span="${x.span}" data-from="${x.from}">${text(x.from, x.to)}</span>`;
        return `<span class="ly-piece ${color(x.role)}" data-span="${x.span}" data-from="${x.from}"><span class="ly-words">${text(x.from, x.to)}</span><small>${escapeHtml(name(x.role))}</small></span>`;
      }).join(' ');
      if (!cl) return `<div class="ly-row" style="--ly-d:${row.depth}">${pieces}</div>`;
      // 被里面的从句隔开的后一截：不再写一遍名字，写「接着」
      const tag = row.cont ? `<span class="ly-tag is-cont">（${escapeHtml(name(cl.role))}接着）</span>`
        : fold ? `<button type="button" class="ly-tag" data-fold="${row.clause}" aria-label="折起${escapeHtml(name(cl.role))}">${escapeHtml(name(cl.role))}</button>` : `<span class="ly-tag">${escapeHtml(name(cl.role))}</span>`;
      return `<div class="ly-row is-clause${row.cont ? ' is-cont' : ''} ${color(cl.role)}" style="--ly-d:${row.depth}"${row.cont ? '' : ` data-span="${row.clause}"`}>${tag}<span class="ly-in">${pieces}</span></div>`;
    }).join('');
    el.innerHTML = `${html}<svg class="ly-arcs" aria-hidden="true"></svg>`;
    arcs();
  }
  // 分裂结构：两段之间一条弧（量画出来的位置）
  function arcs() {
    const svg = el.querySelector('.ly-arcs');
    if (!svg) return;
    let joins = [];
    try { joins = joinsOf(cur); } catch { joins = []; }
    if (shownArcs) joins = joins.filter((j) => shownArcs.has(j.id));
    el.querySelectorAll('[data-span]').forEach((x) => x.classList.toggle('is-chosen', chosen.has(Number(x.dataset.span))));
    const box = el.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${Math.max(1, box.width)} ${Math.max(1, box.height)}`);
    svg.innerHTML = joins.map((j) => {
      const [a, b] = j.parts.map((i) => el.querySelector(`[data-span="${i}"]`));
      if (!a || !b) return '';
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const x1 = ra.left + Math.min(ra.width / 2, 60) - box.left, y1 = ra.bottom - box.top + 2, x2 = rb.left + Math.min(rb.width / 2, 60) - box.left, y2 = rb.top - box.top - 2;
      const below = Math.abs(ra.top - rb.top) > 10 && y2 >= y1;
      const h = Math.max(6, (y2 - y1) / 2);
      // 不在同一行：从上一段的下沿弯到下一段的上沿；同一行：从上面拱过去
      const d = below ? `M${x1} ${y1} C${x1} ${y1 + h}, ${x2} ${y2 - h}, ${x2} ${y2}` : `M${x1} ${ra.top - box.top - 2} C${x1} ${ra.top - box.top - 26}, ${x2} ${rb.top - box.top - 26}, ${x2} ${rb.top - box.top - 2}`;
      return `<path class="ly-arc" d="${d}"/><circle class="ly-arc-dot" cx="${x1}" cy="${below ? y1 : ra.top - box.top - 2}" r="3.5"/><circle class="ly-arc-dot" cx="${x2}" cy="${below ? y2 : rb.top - box.top - 2}" r="3.5"/>`;
    }).join('');
  }
  el.addEventListener('click', (e) => {
    if (onPick) {
      // 点从句的标签是点那个从句；点块里的一段（成分或没标的词）交给 onPick(段, 点的那个词)，由它决定是哪一段
      const piece = e.target.closest?.('.ly-piece[data-span]');
      if (piece) { onPick(Number(piece.dataset.span), Number(piece.dataset.from)); return; }
      const row = e.target.closest?.('.ly-row.is-clause[data-span]');
      if (row) onPick(Number(row.dataset.span), cur[Number(row.dataset.span)]?.from ?? -1);
      return;
    }
    const f = e.target.closest?.('[data-fold]'), u = e.target.closest?.('[data-unfold]');
    if (f) { folded.add(Number(f.dataset.fold)); draw(); } else if (u) { folded.delete(Number(u.dataset.unfold)); draw(); }
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => arcs()).observe(el);
  draw();
  return {
    el, redraw: draw,
    update(next) { cur = next; folded = new Set(); draw(); },
    choose(list) { chosen = new Set(list); arcs(); },
    showArcs(ids) { shownArcs = ids; arcs(); },
  };
}

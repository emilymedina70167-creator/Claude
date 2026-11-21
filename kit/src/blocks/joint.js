// 联合分布表 joint（概率第 4 批）：二维离散随机变量。边缘、条件、独立、矩页面算；Z = g(X, Y) 取值相同的格子同色；
// 学生填边缘、填空着的格、填 Z 的分布、判独立（点出一格说明）、算一个量，页面逐格判。
// 写法和判法在 prob/jointspec.js，计算在 prob/joint.js（都是纯函数）。
import { REVEAL_TRIES, sameWrong } from '../tries.js';
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import { markDraft } from '../drafts.js';
import { parseJointBlock, judgeQuantity, judgeCells, answerLine } from '../prob/jointspec.js';
import { marginals, conditional, rhoLine } from '../prob/joint.js';
import { qShow, qShowTeX } from '../prob/num.js';

const numText = (z) => (typeof z === 'number' ? String(Number(z.toPrecision(6))) : z.toString());

export function joint(el, src) {
  const b = parseJointBlock(src);
  const title = b.fields.title || '联合分布 Joint';
  const body = widget(el, { cls: 'joint', title });
  for (const msg of b.problems) session.problem(el, 'joint', msg);
  if (!b.joint) { body.innerHTML = `<div class="block-error">联合分布表画不出来：${escapeHtml(b.problems[0] || '')}</div>`; return; }
  const j = b.joint, { px, py } = marginals(j), R = j.xs.length, C = j.ys.length;
  const decimal = /\d\.\d|%/.test(b.fields.p) && !/\d\s*\/\s*\d/.test(b.fields.p);
  const f = (q) => qShow(q, decimal), ft = (q) => qShowTeX(q, decimal);
  const md = (s) => mdToHtml(s, { inline: true });

  const state = { i: 0, tries: 0, inputs: {}, marks: {}, sel: null, hotZ: null, said: null, done: new Set(), checked: '', again: sameWrong(), indepStage: 0 };
  const gateDone = b.asks.length ? session.gate(el, title) : null;
  const cur = () => (state.i < b.asks.length ? b.asks[state.i] : null);
  const asking = (kind) => { const a = cur(); return !!a && a.kind === kind && !state.settled; };
  const hasMargins = b.show.has('margins') || b.asks.some((a) => a.kind === 'margins');
  const blankCells = new Set((b.raw.blanks || []).map(([i, k]) => `${i},${k}`));
  const cellsAsk = b.asks.find((a) => a.kind === 'cells');

  body.innerHTML = `
    ${b.fields.q ? `<div class="w-q">${mdToHtml(b.fields.q)}</div>` : ''}
    <div class="jt-body">
      <div class="jt-main"><div class="jt-scroll"><table class="jt-table"></table></div><div class="jt-zbox"></div></div>
      <div class="jt-side">
        <div class="jt-said" hidden></div>
        <div class="jt-facts"></div>
        <div class="jt-ask" hidden></div>
        ${b.fields.note ? `<div class="w-note">${mdToHtml(b.fields.note)}</div>` : ''}
      </div>
    </div>`;
  const table = body.querySelector('.jt-table'), zBox = body.querySelector('.jt-zbox'), said = body.querySelector('.jt-said'), facts = body.querySelector('.jt-facts'), askBox = body.querySelector('.jt-ask');

  // 一格：是让学生填的就画输入框（填过的值留着），不然写数
  const slot = (id, value, open) => {
    if (!open) return `<span class="jt-num">${f(value)}</span>`;
    const mark = state.marks[id];
    return `<input class="jt-in${mark === true ? ' is-right' : mark === false ? ' is-wrong' : ''}" data-slot="${id}" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="填这一格" value="${escapeHtml(state.inputs[id] || '')}">`;
  };
  const zClass = (i, k) => (b.z && b.z.cellZ[i][k] >= 0 ? ` z${b.z.cellZ[i][k] % 6}` : '');

  function paintTable() {
    const mOpen = asking('margins'), mShow = hasMargins && (b.show.has('margins') || state.done.has('margins') || mOpen);
    const cOpen = asking('cells'), cHide = cellsAsk && !state.done.has('cells') && !cOpen; // 还没轮到的空格先写「?」
    const sel = state.sel, hot = state.hotZ;
    let h = `<thead><tr><th class="jt-corner"><span>X</span><i></i><span>Y</span></th>${j.ys.map((y, k) => `<th class="jt-head${sel?.type === 'col' && sel.i === k ? ' is-sel' : ''}" data-col="${k}">${f(y)}</th>`).join('')}${mShow ? '<th class="jt-marg-h">P(X = x)</th>' : ''}</tr></thead><tbody>`;
    j.xs.forEach((x, i) => {
      h += `<tr><th class="jt-head${sel?.type === 'row' && sel.i === i ? ' is-sel' : ''}" data-row="${i}">${f(x)}</th>`;
      j.ys.forEach((y, k) => {
        const key = `${i},${k}`, blank = blankCells.has(key);
        const lit = (sel?.type === 'row' && sel.i === i) || (sel?.type === 'col' && sel.i === k) || (hot !== null && b.z.cellZ[i][k] === hot) || (state.pickCell === key);
        h += `<td class="jt-cell${zClass(i, k)}${lit ? ' is-lit' : ''}" data-cell="${key}">${blank && cHide ? '<span class="jt-num is-q">?</span>' : slot(`c${i}_${k}`, j.p[i][k], blank && cOpen)}</td>`;
      });
      if (mShow) h += `<td class="jt-marg">${slot(`mx${i}`, px[i], mOpen)}</td>`;
      h += '</tr>';
    });
    h += '</tbody>';
    if (mShow) h += `<tfoot><tr><th class="jt-marg-h">P(Y = y)</th>${j.ys.map((y, k) => `<td class="jt-marg">${slot(`my${k}`, py[k], mOpen)}</td>`).join('')}<td class="jt-marg jt-one">1</td></tr></tfoot>`;
    table.innerHTML = h;
    if (b.z) {
      const zOpen = asking('z');
      // 式子写成公式：max、min 是正体，乘号是点，abs(…) 是绝对值
      const zTeX = escapeHtml(b.fields.z).replace(/\bmax\b/g, '\\max').replace(/\bmin\b/g, '\\min').replace(/\babs\(([^()]*)\)/g, '|$1|').replace(/\*/g, '\\cdot ');
      zBox.innerHTML = `<div class="jt-zcap">${md(`$Z = ${zTeX}$ 的分布（取值相同的格子同一种颜色）`)}</div><div class="jt-scroll"><table class="jt-table jt-ztable"><tbody>
        <tr><th>Z</th>${b.z.rows.map((r, n) => `<td class="jt-cell z${n % 6}${hot === n ? ' is-lit' : ''}" data-z="${n}">${numText(r.z)}</td>`).join('')}</tr>
        <tr><th>P</th>${b.z.rows.map((r, n) => `<td class="jt-marg">${slot(`z${n}`, r.p, zOpen)}</td>`).join('')}</tr></tbody></table></div>`;
    }
  }
  function paintFacts() {
    const out = [];
    said.hidden = !state.said; said.innerHTML = state.said ? md(state.said) : '';
    const m = b.moments;
    if (b.show.has('moments')) {
      out.push(`<div class="jt-fact">${md(`$E(X) = ${ft(m.EX)}$，$E(Y) = ${ft(m.EY)}$，$E(XY) = ${ft(m.EXY)}$`)}</div>`);
      out.push(`<div class="jt-fact">${md(`$D(X) = ${ft(m.DX)}$，$D(Y) = ${ft(m.DY)}$`)}</div>`);
      out.push(`<div class="jt-fact">${md(`$\\operatorname{Cov}(X, Y) = E(XY) - E(X)E(Y) = ${ft(m.cov)}$`)}</div>`);
      out.push(`<div class="jt-fact">${md(m.rho === null ? '$\\rho_{XY}$ 没有定义（有一个的方差是 0）' : `$${rhoLine(m)}$`)}</div>`);
    }
    if (b.show.has('independent')) {
      const d = b.indep;
      out.push(`<div class="jt-fact">${md(d.ok ? '$X$、$Y$ 独立：每一格都等于两个边缘的乘积。' : `$X$、$Y$ 不独立：$P(X = ${f(j.xs[d.where[0]])}, Y = ${f(j.ys[d.where[1]])}) = ${ft(j.p[d.where[0]][d.where[1]])}$，而 $P(X = ${f(j.xs[d.where[0]])})P(Y = ${f(j.ys[d.where[1]])}) = ${ft(d.product)}$。`)}</div>`);
    }
    facts.innerHTML = out.join('');
  }
  function paint() { paintTable(); paintFacts(); }

  // 点表头：这一行 / 列的条件分布；点 Z 的一格：是哪几格加起来的
  function tapHead(type, i) {
    state.hotZ = null; state.pickCell = null;
    if (state.sel && state.sel.type === type && state.sel.i === i) { state.sel = null; state.said = null; paint(); return; }
    state.sel = { type, i };
    const yx = type === 'row', cond = conditional(j, yx ? 'Y|X' : 'X|Y', i), base = yx ? px[i] : py[i];
    const A = yx ? 'X' : 'Y', Bv = yx ? 'Y' : 'X', a = f(yx ? j.xs[i] : j.ys[i]), vals = yx ? j.ys : j.xs;
    // 还有题没答完：只亮出这一行 / 列、说怎么算，不把边缘和条件分布的数写出来（正在问的可能就是它）
    if (cur() && !state.settled) { state.said = `已知 $${A} = ${a}$：看亮着的这一${yx ? '行' : '列'}，每格除以这一${yx ? '行' : '列'}的和，就是这个条件下 $${Bv}$ 的分布。`; paint(); return; }
    state.said = cond ? `已知 $${A} = ${a}$（概率 $${ft(base)}$）：这一${yx ? '行' : '列'}每格除以它，$${vals.map((v, k) => `P(${Bv} = ${f(v)} \\mid ${A} = ${a}) = ${ft(cond[k])}`).join('$，$')}$。`
      : `$P(${A} = ${a}) = 0$，这个条件下的分布没有定义。`;
    paint();
  }
  function tapZ(n) {
    state.sel = null; state.pickCell = null;
    if (state.hotZ === n) { state.hotZ = null; state.said = null; paint(); return; }
    state.hotZ = n;
    const r = b.z.rows[n];
    state.said = asking('z') ? `$Z = ${numText(r.z)}$ 是亮着的这 ${r.cells.length} 格。` : `$P(Z = ${numText(r.z)}) = ${r.cells.map(([i, k]) => ft(j.p[i][k])).join(' + ')}${r.cells.length > 1 ? ` = ${ft(r.p)}` : ''}$`;
    paint();
  }

  // —— 作答 ——
  const slotsOf = (a) => (a.kind === 'margins' ? [...j.xs.map((_, i) => [`mx${i}`, px[i]]), ...j.ys.map((_, k) => [`my${k}`, py[k]])]
    : a.kind === 'cells' ? a.cells.map(([i, k]) => [`c${i}_${k}`, j.p[i][k]]) : b.z.rows.map((r, n) => [`z${n}`, r.p]));
  const fb = () => askBox.querySelector('.jt-fb');
  function record(a, ok, extra) { session.record({ type: 'joint', title, q: a.q.replace(/\s+/g, ' ').slice(0, 120), ok, attempts: state.tries, el, ...extra }); }
  function next() {
    state.i++; state.tries = 0; state.checked = ''; state.again = sameWrong(); state.settled = false; state.indepStage = 0; state.pickCell = null; state.marks = {};
    if (state.i >= b.asks.length) gateDone?.();
    paint(); paintAsk();
  }
  function settle(a, html, cls) {
    const last = state.i >= b.asks.length - 1;
    state.settled = true; state.done.add(a.kind);
    paint();
    fb().className = `jt-fb ${cls}`; fb().innerHTML = html;
    askBox.querySelector('.jt-actions').innerHTML = last ? '' : '<button type="button" class="btn btn-primary jt-next">下一问 ›</button>';
    askBox.querySelector('.jt-input')?.setAttribute('disabled', '');
    askBox.querySelectorAll('.jt-yn').forEach((x) => x.setAttribute('disabled', ''));
    if (last) { state.i = b.asks.length; state.lastShown = true; gateDone?.(); }
    askBox.querySelector('.jt-next')?.addEventListener('click', next);
  }
  const reveal = (a, onClick) => { const btn = fb().querySelector('.jt-reveal'); btn?.addEventListener('click', onClick); };
  function fail(a, text, onReveal) {
    fb().className = 'jt-fb is-bad';
    fb().innerHTML = `✗ ${escapeHtml(text)}${state.tries >= REVEAL_TRIES ? ' <button type="button" class="link-btn jt-reveal">看答案</button>' : ''}`;
    reveal(a, onReveal);
  }
  function check() {
    const a = cur();
    if (!a || state.settled) return;
    if (a.kind === 'value') {
      const input = askBox.querySelector('.jt-input').value, q = a.quantity, r = judgeQuantity(q, input);
      const ans = `$${answerLine(q, ft)}$`;
      if (r.ok === null) { fb().className = 'jt-fb is-hint'; fb().textContent = r.text; return; }
      if (state.again.repeat(input.trim())) return; // 同一个错答案又点了一次检查：不算一次新的尝试
      state.again.after(input.trim(), r.ok);
      state.tries++; state.checked = input.trim();
      record(a, r.ok, { value: input.trim(), detail: r.text, ...(r.tag ? { misread: r.tag } : {}) });
      if (r.ok) { settle(a, `✓ ${md(ans)}`, 'is-ok'); return; }
      fail(a, r.text, () => { record(a, false, { value: input.trim(), giveup: true, expected: ans.replace(/\$/g, '') }); settle(a, `答案：${md(ans)}`, 'is-reveal'); });
      return;
    }
    // 一组格子
    const slots = slotsOf(a);
    for (const inp of body.querySelectorAll('.jt-in')) state.inputs[inp.dataset.slot] = inp.value;
    const got = slots.map(([id]) => state.inputs[id] || ''), r = judgeCells(slots.map(([, v]) => v), got);
    if (r.ok === null) { fb().className = 'jt-fb is-hint'; fb().textContent = r.text; return; }
    if (state.again.repeat(got.join(' '))) return;
    state.again.after(got.join(' '), r.ok);
    state.tries++; state.checked = got.join(' ');
    slots.forEach(([id], n) => { state.marks[id] = r.marks[n]; });
    record(a, r.ok, { value: got.join('、'), detail: r.text });
    if (r.ok) { settle(a, '✓ 都对。', 'is-ok'); return; }
    paintTable();
    fail(a, r.text, () => { record(a, false, { value: got.join('、'), giveup: true, expected: slots.map(([, v]) => f(v)).join('、') }); state.marks = {}; settle(a, '答案填在表里了。', 'is-reveal'); });
  }
  // 独立吗：先点是 / 否；不独立的再点出一格说明
  function answerIndep(saysYes) {
    const a = cur();
    if (!a || state.settled) return;
    const right = saysYes === a.answer;
    if (state.again.repeat(`yn:${saysYes}`)) return; // 再点刚点错的那一个：不算新的一次
    state.again.after(`yn:${saysYes}`, right);
    state.tries++;
    // 说对了「不独立」还要点出一格才算完：这一下先不记，和点的那一格一起记
    if (!right || a.answer) record(a, right, { value: saysYes ? '独立' : '不独立', detail: right ? '对' : '不对' });
    if (!right) { fail(a, saysYes ? '不对：看看每一格是不是都等于它那一行、那一列两个边缘的乘积。' : '不对：每一格都正好等于两个边缘的乘积。', () => {
      record(a, false, { value: saysYes ? '独立' : '不独立', giveup: true, expected: a.answer ? '独立' : '不独立' });
      // 独立的表没有「对不上的那一格」可指：直接说结论
      if (a.answer) settle(a, '答案：独立——每一格都等于它那一行、那一列两个边缘的乘积。', 'is-reveal'); else showWhy(a, a.cells[0]);
    }); return; }
    if (a.answer) { settle(a, '✓ 独立：每一格都等于两个边缘的乘积。', 'is-ok'); return; }
    state.indepStage = 1;
    fb().className = 'jt-fb is-hint';
    fb().textContent = '对，不独立。在表里点出一格来说明：这一格的概率不等于两个边缘的乘积。';
    askBox.querySelectorAll('.jt-yn').forEach((x) => x.setAttribute('disabled', ''));
  }
  function showWhy(a, cell, ok = false) {
    const [i, k] = cell;
    state.pickCell = `${i},${k}`;
    const line = `$P(X = ${f(j.xs[i])}, Y = ${f(j.ys[k])}) = ${ft(j.p[i][k])}$，而 $P(X = ${f(j.xs[i])})P(Y = ${f(j.ys[k])}) = ${ft(px[i])} \\times ${ft(py[k])} = ${ft(px[i].mul(py[k]))}$`;
    settle(a, `${ok ? '✓ ' : ''}${md(a.answer ? '独立：每一格都等于两个边缘的乘积。' : `${line}，不相等，所以不独立。`)}`, ok ? 'is-ok' : 'is-reveal');
  }
  function pickCell(i, k) {
    const a = cur();
    const hit = a.cells.some(([x, y]) => x === i && y === k);
    if (state.again.repeat(`cell:${i},${k}`)) return; // 再点刚点错的那一格：不算新的一次
    state.again.after(`cell:${i},${k}`, hit);
    state.tries++;
    record(a, hit, { value: `不独立，点了 X = ${f(j.xs[i])}、Y = ${f(j.ys[k])} 那一格`, detail: hit ? '这一格不等于乘积' : '这一格正好等于乘积' });
    if (hit) { showWhy(a, [i, k], true); return; }
    fail(a, `这一格正好相等（${f(px[i])} × ${f(py[k])} = ${f(j.p[i][k])}），换一格。`, () => { record(a, false, { value: '', giveup: true, expected: `X = ${f(j.xs[a.cells[0][0]])}、Y = ${f(j.ys[a.cells[0][1]])} 那一格` }); showWhy(a, a.cells[0]); });
  }
  function paintAsk() {
    const a = cur();
    if (!a) { if (!state.lastShown) askBox.hidden = true; return; }
    askBox.hidden = false;
    const count = b.asks.length > 1 ? `<span class="jt-count">${state.i + 1} / ${b.asks.length}</span>` : '';
    const mid = a.kind === 'value' ? `<div class="jt-fill"><input class="jt-input" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${a.quantity.exact ? '分数或小数，如 9/10' : '小数（三位有效数字）'}" aria-label="填答案"></div>`
      : a.kind === 'independent' ? '<div class="jt-yns"><button type="button" class="btn jt-yn" data-yn="1">独立</button><button type="button" class="btn jt-yn" data-yn="0">不独立</button></div>'
        : '';
    askBox.innerHTML = `<div class="jt-q">${count}${md(a.q)}</div>${mid}
      <div class="jt-actions">${a.kind === 'independent' ? '' : '<button type="button" class="btn btn-primary jt-check">检查</button>'}</div>
      <div class="jt-fb" aria-live="polite"></div>`;
    askBox.querySelector('.jt-check')?.addEventListener('click', check);
    askBox.querySelector('.jt-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    askBox.querySelectorAll('.jt-yn').forEach((x) => x.addEventListener('click', () => answerIndep(x.dataset.yn === '1')));
  }

  // 表上的点按、输入
  body.addEventListener('input', (e) => { const s = e.target?.dataset?.slot; if (s) state.inputs[s] = e.target.value; });
  body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target?.dataset?.slot) check(); });
  body.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-row], [data-col], [data-z], [data-cell]');
    if (!t || e.target.closest('input')) return;
    if (t.dataset.row !== undefined) return tapHead('row', Number(t.dataset.row));
    if (t.dataset.col !== undefined) return tapHead('col', Number(t.dataset.col));
    if (t.dataset.z !== undefined) return tapZ(Number(t.dataset.z));
    const a = cur();
    if (a && a.kind === 'independent' && state.indepStage === 1 && !state.settled) { const [i, k] = t.dataset.cell.split(',').map(Number); pickCell(i, k); }
    return undefined;
  });
  markDraft(body, () => {
    const a = cur();
    if (!a || state.settled) return '';
    if (a.kind === 'value') { const v = askBox.querySelector('.jt-input')?.value.trim() || ''; return v && v !== state.checked ? v : ''; }
    if (a.kind === 'independent') return state.indepStage === 1 ? '说了「不独立」，还没点出是哪一格不等于两个边缘的乘积' : '';
    const got = slotsOf(a).map(([id]) => (state.inputs[id] || '').trim());
    return got.some(Boolean) && got.join(' ') !== state.checked ? `表里填了 ${got.map((x) => x || '（空）').join('、')}` : '';
  });
  paint();
  paintAsk();
}

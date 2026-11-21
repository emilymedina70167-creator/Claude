// 概率树 ptree（概率第 4 批）：树（每条边上写概率、叶子上写乘出来的数）+ 面积图（单位正方形按先验分列、每列里按条件概率分出结果）+ 后验那一条。
// 「A1 0.5: B 0.02」这种写法的树三样都有，面积图的分界能拖（树上的数、后验当场变）；缩进写的多层树只有树。
// 写法、问的量、判法在 prob/treespec.js，计算在 prob/tree.js（都是纯函数）。
import { REVEAL_TRIES, sameWrong } from '../tries.js';
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import { markDraft } from '../drafts.js';
import { parsePtree, valueOf, judgeTreeProb } from '../prob/treespec.js';
import { treeNumbers, leaves, moveBoundary, setCond, condHandle } from '../prob/tree.js';
import { qTeX, qShow, judgeNumber, Q1 } from '../prob/num.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const isTerminating = (q) => { let d = q.d; while (d % 2n === 0n) d /= 2n; while (d % 5n === 0n) d /= 5n; return d === 1n; };
const ROW = 44, COL = 138, PAD = 24; // 一行 44px：整行能点
const SIDE = 240, AX = 44, AY = 30; // 面积图：正方形的边长、左上角

export function ptree(el, src) {
  const spec = parsePtree(src);
  const title = spec.fields.title || '概率树 Tree';
  const body = widget(el, { cls: 'ptree', title });
  for (const msg of spec.problems) session.problem(el, 'ptree', msg);
  if (!spec.tree) { body.innerHTML = `<div class="block-error">概率树画不出来：${escapeHtml(spec.problems[0] || '')}</div>`; return; }
  let tree = spec.tree;
  const bayes = tree.form === 'bayes';
  // 主讲写的是小数就照小数写（除得尽的），不然写分数
  const decimalStyle = /[.%]/.test(src) && !/\d\s*\/\s*\d/.test(src.replace(/^(title|q|note|ask|find|labels|blank)\s*[:：].*$/gim, ''));
  const fmt = (q) => qShow(q, decimalStyle); // 和 joint 的表同一个写法（prob/num.js）
  // 写进公式里的数：主讲写小数、这个数又除得尽的写小数，别的写分数（和树上的写法一个风格）
  const tx = (q) => (decimalStyle && q.d !== 1n && isTerminating(q) && fmt(q).length <= 8 ? fmt(q) : qTeX(q));
  const label = (name, not) => { const l = spec.labels[name] || name; return not ? (/^[A-Za-z]\d*$/.test(l) ? `${l[0]}̄${l.slice(1)}` : `非${l}`) : l; };

  body.innerHTML = `
    ${spec.fields.q ? `<div class="w-q">${mdToHtml(spec.fields.q)}</div>` : ''}
    <div class="pt-body${bayes ? '' : ' is-single'}">
      <div class="pt-tree"></div>
      ${bayes ? '<div class="pt-right"><div class="pt-area"></div><div class="pt-post"></div></div>' : ''}
    </div>
    <div class="pt-side">
      <div class="pt-finds"></div>
      <div class="pt-tip" hidden></div>
      <div class="pt-ask" hidden></div>
      ${spec.drag ? `<div class="w-hint">${spec.blanks.length + spec.asks.length ? '答完上面的题以后，' : ''}面积图上的分界线可以拖：竖的改每个原因占多少，横的改这一列里结果占多少。</div>` : ''}
      ${spec.fields.note ? `<div class="w-note">${mdToHtml(spec.fields.note)}</div>` : ''}
    </div>`;
  const treeBox = body.querySelector('.pt-tree'), areaBox = body.querySelector('.pt-area'), postBox = body.querySelector('.pt-post');
  const findsBox = body.querySelector('.pt-finds'), tip = body.querySelector('.pt-tip'), askBox = body.querySelector('.pt-ask');

  // —— 学生要做的：先填树上空着的，再答 ask ——
  const todo = [
    ...spec.blanks.map((b) => ({ kind: 'blank', q: `树上打问号的那一处：$${b.tex}$ 是多少？`, blank: b })),
    ...spec.asks.map((a) => ({ kind: 'ask', q: a.q, term: a.term })),
  ];
  const state = { i: 0, tries: 0, checked: '', again: sameWrong(), hot: null, filled: new Set() };
  const gateDone = todo.length ? session.gate(el, title) : null;
  const cur = () => (state.i < todo.length ? todo[state.i] : null);
  const blankOpen = (where) => spec.blanks.some((b) => b.where === where) && !state.filled.has(where);
  const allDone = () => state.i >= todo.length;
  // 还有没答的题问的是「已知结果、倒推原因」：后验那一条先不画（画了就是答案）
  const postAsked = () => todo.slice(state.i).some((x) => x.kind === 'ask' && x.term.b);
  // 题没答完不让拖：拖了树上的数就变了，和题目说的那组数对不上
  const canDrag = () => spec.drag && allDone();

  // —— 树 ——
  function drawTree() {
    const ls = leaves(tree);
    const depth = tree.depth, W = PAD + depth * COL + 124, H = PAD * 2 + (ls.length - 1) * ROW + 8;
    treeBox.textContent = '';
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pt-svg', role: 'img', 'aria-label': '概率树' }, treeBox);
    let row = 0;
    // 先排叶子的位置，往上取孩子的中间
    const place = (kids, d, path) => kids.map((k, i) => {
      const node = { k, d, i, path: [...path, i], kids: [] };
      if (k.children.length) { node.kids = place(k.children, d + 1, node.path); node.y = (node.kids[0].y + node.kids[node.kids.length - 1].y) / 2; } else { node.y = PAD + 4 + row * ROW; row++; }
      node.x = PAD + (d + 1) * COL;
      return node;
    });
    const top = place(tree.children, 0, []);
    const root = { x: PAD, y: (top[0].y + top[top.length - 1].y) / 2 };
    const hot = state.hot;
    const draw = (parent, node, prod, onPath) => {
      const lit = onPath && hot && hot[node.d] === node.i;
      const p = prod.mul(node.k.p);
      const where = bayes ? (node.d === 0 ? `prior:${node.i}` : `edge:${node.path[0]}:${node.k.not ? 'not' : 'yes'}`) : '';
      svgEl('line', { x1: parent.x, y1: parent.y, x2: node.x, y2: node.y, class: `pt-edge${lit ? ' is-lit' : ''}${bayes && node.d === 0 ? ` c${node.i % 4}` : ''}` }, svg);
      const mx = parent.x + (node.x - parent.x) * 0.52, my = parent.y + (node.y - parent.y) * 0.52;
      const t = svgEl('text', { x: mx, y: my - 7, class: `pt-prob${blankOpen(where) ? ' is-blank' : state.filled.has(where) ? ' is-filled' : ''}` }, svg);
      t.textContent = blankOpen(where) ? '?' : fmt(node.k.p);
      svgEl('circle', { cx: node.x, cy: node.y, r: 4.5, class: `pt-dot${bayes ? ` c${node.path[0] % 4}` : ''}` }, svg);
      const leaf = !node.kids.length;
      const nm = svgEl('text', { x: node.x + (leaf ? 10 : 0), y: node.y + (leaf ? 0 : -13), class: `pt-name${leaf ? ' is-leaf' : ''}` }, svg);
      nm.textContent = label(node.k.name, node.k.not);
      if (leaf) {
        const lw = bayes ? `leaf:${node.path[0]}:${node.k.not ? 'not' : 'yes'}` : '';
        const out = svgEl('text', { x: W - 6, y: node.y, class: `pt-leaf${lit ? ' is-lit' : ''}${blankOpen(lw) ? ' is-blank' : state.filled.has(lw) ? ' is-filled' : ''}` }, svg);
        out.textContent = blankOpen(lw) ? '?' : fmt(p);
        // 整行都能点（44px 高）：看这条路是怎么乘出来的
        svgEl('rect', { x: node.x - 40, y: node.y - ROW / 2, width: W - node.x + 40, height: ROW, class: 'pt-hit', 'data-path': node.path.join(',') }, svg);
      }
      for (const kid of node.kids) draw(node, kid, p, lit || (onPath && !hot));
    };
    svgEl('circle', { cx: root.x, cy: root.y, r: 4.5, class: 'pt-dot is-root' }, svg);
    for (const n of top) draw(root, n, Q1, true);
    svg.addEventListener('click', (e) => { const p = e.target.getAttribute?.('data-path'); if (p) showPath(p.split(',').map(Number)); });
  }
  // 点一条路：亮起来，写出怎么乘的
  function showPath(path) {
    state.hot = state.hot && state.hot.join() === path.join() ? null : path;
    if (!state.hot) { tip.hidden = true; repaint(); return; }
    const parts = []; let kids = tree.children, prod = Q1; const names = [];
    for (const i of path) { const k = kids[i]; parts.push(tx(k.p)); prod = prod.mul(k.p); names.push(label(k.name, k.not)); kids = k.children; }
    tip.hidden = false;
    // 这条路上有还空着的数（先验、这一支、叶子上的乘积）：只说怎么算，不把数写出来
    const eff = bayes && path.length === 2 ? (path[1] === 0 ? 'yes' : 'not') : null;
    if (bayes && (blankOpen(`prior:${path[0]}`) || (eff && (blankOpen(`edge:${path[0]}:${eff}`) || blankOpen(`leaf:${path[0]}:${eff}`))))) {
      tip.innerHTML = mdToHtml(`${names.join(' → ')}：沿着这条路把边上的概率乘起来（这条路上有还没填的数）。`, { inline: true });
      repaint();
      return;
    }
    tip.innerHTML = mdToHtml(`${names.join(' → ')}：沿着这条路把概率乘起来，$${parts.join(' \\times ')} = ${tx(prod)}$`, { inline: true });
    repaint();
  }

  // —— 面积图、后验 ——
  let areaSvg = null;
  function drawArea() {
    if (!bayes) return;
    const n = treeNumbers(tree), W = AX + SIDE + 16, H = AY + SIDE + 40;
    if (!areaSvg) {
      areaSvg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pt-svg pt-area-svg', role: 'img', 'aria-label': '面积图' }, areaBox);
      wireDrag(areaSvg, W);
    }
    areaSvg.textContent = '';
    const g = areaSvg;
    let x = AX;
    const xs = [];
    tree.causes.forEach((c, i) => {
      const w = c.p.toNumber() * SIDE, hB = tree.cond[i].toNumber() * SIDE, lit = state.hot && state.hot[0] === i;
      xs.push(x);
      if (w > 0.01) {
        svgEl('rect', { x, y: AY, width: w, height: SIDE - hB, class: `pt-cell is-not c${i % 4}${lit && state.hot[1] === 1 ? ' is-lit' : ''}`, 'data-path': `${i},1` }, g);
        svgEl('rect', { x, y: AY + SIDE - hB, width: w, height: hB, class: `pt-cell is-yes c${i % 4}${lit && state.hot[1] === 0 ? ' is-lit' : ''}`, 'data-path': `${i},0` }, g);
        if (w > 26) {
          svgEl('text', { x: x + w / 2, y: AY - 10, class: 'pt-colname' }, g).textContent = label(c.name);
          svgEl('text', { x: x + w / 2, y: AY + SIDE + 16, class: 'pt-colp' }, g).textContent = blankOpen(`prior:${i}`) ? '?' : fmt(c.p);
        }
      }
      x += w;
    });
    svgEl('rect', { x: AX, y: AY, width: SIDE, height: SIDE, class: 'pt-square' }, g);
    svgEl('text', { x: AX - 8, y: AY + SIDE - 4, class: 'pt-axis' }, g).textContent = label(tree.effect);
    svgEl('text', { x: AX - 8, y: AY + 12, class: 'pt-axis' }, g).textContent = label(tree.effect, true);
    areaSvg.classList.toggle('is-drag', !!canDrag());
    if (canDrag()) {
      // 把手：竖的分界（两列之间）、每列里横的分界。看得见的是一小段粗线，能抓的地方宽 44px。
      // 先画竖的、再画横的：窄的列里两种把手叠在一起，横线附近归横的，别处归竖的
      for (let i = 0; i < tree.causes.length - 1; i++) {
        const bx = xs[i + 1];
        svgEl('line', { x1: bx, y1: AY + SIDE / 2 - 16, x2: bx, y2: AY + SIDE / 2 + 16, class: 'pt-grip' }, g);
        svgEl('rect', { x: bx - 22, y: AY, width: 44, height: SIDE, class: 'pt-handle is-v', 'data-bound': i }, g);
      }
      tree.causes.forEach((c, i) => {
        const w = c.p.toNumber() * SIDE, yB = AY + SIDE - tree.cond[i].toNumber() * SIDE;
        // 能抓的地方整个在方块里、窄的列也有（prob/tree.js 的 condHandle）
        const half = Math.max(3, Math.min(14, w / 3));
        svgEl('line', { x1: xs[i] + w / 2 - half, y1: yB, x2: xs[i] + w / 2 + half, y2: yB, class: 'pt-grip' }, g);
        svgEl('rect', { ...condHandle(xs[i], w, yB, AY, SIDE), class: 'pt-handle is-h', 'data-cond': i }, g);
      });
    }
    // 后验：把结果发生的那几块抽出来排成一条
    const strip = (post, joint, name) => {
      if (!post) return `<div class="pt-strip-row"><span class="pt-strip-name">已知${escapeHtml(name)}</span><span class="pt-strip is-none">这个结果的概率是 0，后验没有定义</span></div>`;
      // 条上只涂颜色（够宽的写名字），数写在下面一行：窄的那几段字放不下，硬塞会被切掉
      const bar = post.map((p, i) => (p.zero ? '' : `<span class="pt-seg c${i % 4}" style="flex:${p.toNumber()} 1 0">${p.toNumber() >= 0.18 ? escapeHtml(label(tree.causes[i].name)) : ''}</span>`)).join('');
      const vals = post.map((p, i) => `<span class="pt-val"><i class="pt-key c${i % 4}"></i>${escapeHtml(label(tree.causes[i].name))} ${fmt(p)}</span>`).join('');
      return `<div class="pt-strip-row"><span class="pt-strip-name">已知${escapeHtml(name)}</span><span class="pt-strip">${bar}</span><span class="pt-strip-vals">${vals}</span></div>`;
    };
    postBox.innerHTML = postAsked() ? '<div class="pt-strip-row"><span class="pt-strip-name">后验</span><span class="pt-strip is-none">答完上面的题再看</span></div>'
      : strip(n.post, n.joint, label(tree.effect)) + strip(n.postNot, n.jointNot, label(tree.effect, true));
  }
  function wireDrag(svg, W) {
    let drag = null;
    const at = (e) => { const r = svg.getBoundingClientRect(), k = W / r.width; return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; };
    svg.addEventListener('pointerdown', (e) => {
      const t = e.target, b = t.getAttribute?.('data-bound'), c = t.getAttribute?.('data-cond');
      if (b === null && c === null) return;
      drag = b !== null ? { kind: 'bound', i: Number(b), id: e.pointerId, moved: false } : { kind: 'cond', i: Number(c), id: e.pointerId, moved: false };
      try { svg.setPointerCapture(e.pointerId); } catch { /* 合成事件 */ }
      e.preventDefault();
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      const [x, y] = at(e);
      const next = drag.kind === 'bound' ? moveBoundary(tree, drag.i, (x - AX) / SIDE) : setCond(tree, drag.i, (AY + SIDE - y) / SIDE);
      drag.moved = true;
      tree = next;
      repaint();
    });
    const end = (e) => {
      const d = drag; drag = null;
      if (!d || !d.moved || e.type === 'pointercancel') return;
      const nm = tree.causes[d.i].name;
      if (d.kind === 'bound') session.event('drag', el, { name: `P(${nm})`, value: fmt(tree.causes[d.i].p) });
      else session.event('drag', el, { name: `P(${tree.effect} | ${nm})`, value: fmt(tree.cond[d.i]) });
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('click', (e) => { const p = e.target.getAttribute?.('data-path'); if (p) showPath(p.split(',').map(Number)); });
  }

  function drawFinds() {
    findsBox.innerHTML = spec.finds.map((f) => {
      const r = valueOf(f, tree);
      return `<div class="pt-find">${mdToHtml(r.status === 'ok' ? `$${f.tex} = ${tx(r.value)}$` : `$${f.tex}$ 没有定义（条件的概率是 0）`, { inline: true })}</div>`;
    }).join('');
  }
  function repaint() { drawTree(); drawArea(); drawFinds(); }

  // —— 作答 ——
  function record(item, ok, extra) { session.record({ type: 'ptree', title, q: item.q.replace(/\s+/g, ' ').slice(0, 120), ok, attempts: state.tries, el, ...extra }); }
  const answerTeX = (item) => (item.kind === 'blank' ? `$${item.blank.tex} = ${tx(item.blank.value(tree))}$` : (() => { const r = valueOf(item.term, tree); return r.status === 'ok' ? `$${item.term.tex} = ${tx(r.value)}$` : `$${item.term.tex}$ 没有定义`; })());
  function next() {
    state.i++; state.tries = 0; state.checked = ''; state.again = sameWrong();
    if (state.i >= todo.length) gateDone?.();
    paintAsk();
    repaint(); // 后验那一条、能拖的把手跟着答题的进度出来
  }
  function settle(item, html, cls) {
    const last = state.i >= todo.length - 1;
    if (item.kind === 'blank') { state.filled.add(item.blank.where); repaint(); }
    askBox.querySelector('.pt-fb').className = `pt-fb ${cls}`;
    askBox.querySelector('.pt-fb').innerHTML = html;
    askBox.querySelector('.pt-actions').innerHTML = last ? '' : '<button type="button" class="btn btn-primary pt-next">下一问 ›</button>';
    askBox.querySelector('.pt-input').setAttribute('disabled', '');
    askBox.dataset.settled = '1';
    if (last) { state.i = todo.length; state.lastShown = true; gateDone?.(); repaint(); }
    askBox.querySelector('.pt-next')?.addEventListener('click', next);
  }
  function check() {
    const item = cur();
    if (!item || askBox.dataset.settled) return;
    const input = askBox.querySelector('.pt-input').value;
    const r = item.kind === 'blank' ? judgeNumber(item.blank.value(tree), input) : judgeTreeProb(item.term, tree, input);
    const fb = askBox.querySelector('.pt-fb');
    if (r.ok === null) { fb.className = 'pt-fb is-hint'; fb.textContent = r.text; return; }
    if (state.again.repeat(input.trim())) return; // 同一个错答案又点了一次检查：不算一次新的尝试
    state.again.after(input.trim(), r.ok);
    state.tries++;
    state.checked = input.trim();
    record(item, r.ok, { value: input.trim(), detail: r.text, ...(r.tag ? { misread: r.tag } : {}) });
    if (r.ok) { settle(item, `✓ ${mdToHtml(answerTeX(item), { inline: true })}`, 'is-ok'); return; }
    fb.className = 'pt-fb is-bad';
    fb.innerHTML = `✗ ${escapeHtml(r.text)}${state.tries >= REVEAL_TRIES ? ' <button type="button" class="link-btn pt-reveal">看答案</button>' : ''}`;
    fb.querySelector('.pt-reveal')?.addEventListener('click', () => {
      record(item, false, { value: input.trim(), giveup: true, expected: answerTeX(item).replace(/\$/g, '') });
      settle(item, `答案：${mdToHtml(answerTeX(item), { inline: true })}`, 'is-reveal');
    });
  }
  function paintAsk() {
    const item = cur();
    delete askBox.dataset.settled;
    if (!item) { if (!state.lastShown) askBox.hidden = true; return; }
    askBox.hidden = false;
    const count = todo.length > 1 ? `<span class="pt-count">${state.i + 1} / ${todo.length}</span>` : '';
    askBox.innerHTML = `
      <div class="pt-q">${count}${mdToHtml(item.q, { inline: true })}</div>
      <div class="pt-fill"><input class="pt-input" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="分数或小数" aria-label="填概率"></div>
      <div class="pt-actions"><button type="button" class="btn btn-primary pt-check">检查</button></div>
      <div class="pt-fb" aria-live="polite"></div>`;
    askBox.querySelector('.pt-check').addEventListener('click', check);
    askBox.querySelector('.pt-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  }
  markDraft(body, () => {
    if (!cur() || askBox.dataset.settled) return '';
    const val = askBox.querySelector('.pt-input')?.value.trim() || '';
    return val && val !== state.checked ? val : '';
  });

  repaint();
  paintAsk();
}

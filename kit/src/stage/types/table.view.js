// 表的画法（types/table.js 的画面那一半）：没有括号，行名在左、列名在上（淡一点）；造的时候就有值的格是实的，
// 空着等填的是虚线框，学生写的是学生的颜色；行、列、格上的勾和叉。学生点一格写：通用手势（gesturedom.js）抓 cell 这个把手
import { EASE, stagger } from '../motion.js';
import { TB, colWidths, nameWidth, headHeight } from './table.js';
import { openParts } from '../gesturedom.js';

const tr = (x, y) => `translate(${x}px, ${y}px)`;
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5;
const MARK = { tick: '✓', cross: '✕' };

// 摆一块不属于部件的字（行名、列名、勾叉）：位置变了跟着走
function place(stage, n, box, ctx, entering) {
  if (same(n.__box, box)) return;
  const was = n.__box;
  n.__box = { ...box };
  n.style.width = `${box.w}px`;
  n.style.height = `${box.h}px`;
  if (was && !stage.instant && !entering) ctx.jobs.push(stage.tween(n, [{ transform: tr(was.x, was.y) }, { transform: tr(box.x, box.y) }], { duration: 420, easing: EASE.move }));
  else n.style.transform = tr(box.x, box.y);
}

export const tableView = {
  sync(stage, o, ctx) {
    const sc = stage.scene;
    const entering = ctx.entering === o.id;
    const ws = colWidths(o), nw = nameWidth(o), hh = headHeight(o);
    const want = new Set();
    const head = (key, cls, text, box, mark) => {
      want.add(key);
      const n = stage.decor(o.id, key, () => { const d = el('div', `tb-head ${cls}`, stage.layer); el('span', 'tb-ht', d); if (entering) d.style.opacity = '0'; return d; });
      if (n.firstChild.textContent !== text) n.firstChild.textContent = text;
      // 勾、叉：跟在名字后面的一个小记号
      let b = n.querySelector('.tb-mk');
      if (mark && !b) { b = el('b', 'tb-mk', n); if (!stage.instant && !entering) stage.tween(b, [{ opacity: 0, scale: '.4' }, { opacity: 1, scale: '1' }], { duration: 320, easing: EASE.spring }); }
      if (!mark && b) b.remove();
      if (mark) { b.textContent = MARK[mark]; b.dataset.mark = mark; }
      place(stage, n, box, ctx, entering);
    };
    let x = o.origin.x + nw;
    o.colNames.forEach((name, j) => { head(`cn:${j + 1}`, 'tb-col', name, { x, y: o.origin.y, w: ws[j], h: hh - 4 }, o.marks.cols[j + 1]); x += ws[j] + TB.GAP; });
    o.rowNames.forEach((name, i) => head(`rn:${i + 1}`, 'tb-row', name, { x: o.origin.x, y: o.origin.y + hh + i * (TB.CH + TB.GAP), w: nw - 8, h: TB.CH }, o.marks.rows[i + 1]));
    // 没有行名 / 列名的表也能给一行一列打勾：记号单独挂在那一行的右边 / 那一列的上面
    stage.dropDecor(o.id, (k) => (k.startsWith('cn:') || k.startsWith('rn:')) && !want.has(k));
    const moves = [];
    for (const p of o.cells) {
      const b = sc.partBox(p);
      let made = false;
      const n = stage.partNode(p, () => {
        made = true;
        const d = el('div', 'st-cell tb-cell', stage.layer);
        el('span', 'st-v', d);
        d.style.transform = tr(b.x, b.y);
        d.__box = b;
        if (entering) d.style.opacity = '0';
        else if (!stage.instant) ctx.jobs.push(stage.tween(d, [{ opacity: 0, transform: tr(b.x, b.y + 8) }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 360, easing: EASE.out }));
        return d;
      });
      n.style.width = `${b.w}px`;
      n.style.height = `${b.h}px`;
      const v = n.querySelector('.st-v');
      if (v.textContent !== p.value) {
        const was = v.textContent;
        v.textContent = p.value;
        // 写进去的字弹一下（刚造出来的、重放的不弹）
        if (!made && !stage.instant && p.value !== '' && was !== p.value) ctx.jobs.push(stage.tween(v, [{ opacity: 0, scale: '.7' }, { opacity: 1, scale: '1' }], { duration: 300, easing: EASE.spring }));
      }
      v.classList.toggle('is-long', [...p.value].length > 6);
      n.classList.toggle('is-blank', p.value === '');
      n.classList.toggle('is-given', !!p.given);
      n.classList.toggle('is-mine', p.by === 'student');
      let mk = n.querySelector('.tb-mk');
      if (p.tick && !mk) mk = el('b', 'tb-mk', n);
      if (!p.tick && mk) mk.remove();
      if (p.tick) { mk.textContent = MARK[p.tick]; mk.dataset.mark = p.tick; }
      stage.flagPart(n, p, ctx);
      if (!made && !same(n.__box, b)) moves.push({ part: p, node: n, from: n.__box, to: b, order: p.r, duration: 420 });
    }
    return moves;
  },

  // 列名、行名先淡进来，格子一行一行落下
  async enter(stage, o) {
    const jobs = [];
    for (const [k, n] of stage.decors.get(o.id) || []) if (k.startsWith('cn:') || k.startsWith('rn:')) jobs.push(stage.tween(n, [{ opacity: 0 }, { opacity: 1 }], { duration: 320 }));
    for (const p of o.cells) {
      const n = stage.nodeOf(p), b = n?.__box;
      if (!n || !b) continue;
      jobs.push(stage.tween(n, [{ opacity: 0, transform: tr(b.x, b.y - 10) }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 360, delay: stagger((p.r - 1) * 2 + (p.c - 1) * 0.5, { step: 50, max: 700 }), easing: EASE.out }));
    }
    await Promise.all(jobs);
  },

  // 通用手势抓哪儿（规则文件 table.rules.js 的手势表）：一格（点它写）。给定的格不给点（学生写不了）
  grips: {
    cell: (stage, o, e) => openParts(stage, e, o.cells).filter((x) => !x.given).map((x) => ({
      key: `cell:${x.key}`,
      part: () => stage.scene.partOf(o.id, x.key),
      node: () => stage.nodes.get(`${o.id}:${x.key}`),
    })),
  },

  css: `
/* 表：格子是小白卡（和一排格子一个样），字比数字小一号；行名列名淡一点 */
.st-cell.tb-cell { border-radius: 12px; }
.st-cell.tb-cell .st-v { font: 600 19px/1.15 var(--sans, sans-serif); letter-spacing: 0; padding: 0 6px; text-align: center; overflow-wrap: anywhere; }
.st-cell.tb-cell .st-v.is-long { font-size: 15px; }
/* 给定的格：实的、淡一点的底；学生写的：学生的颜色；空着等填：虚线框（.st-cell.is-blank，一排格子那一条） */
.st-cell.tb-cell.is-given { background: color-mix(in srgb, var(--st-ink) 5%, var(--st-card)); }
.st-cell.tb-cell.is-mine .st-v { color: var(--st-brand); }
.tb-head { position: absolute; left: 0; top: 0; display: flex; align-items: center; justify-content: center; gap: 4px; box-sizing: border-box; font: 500 14px/1.2 var(--sans, sans-serif); color: var(--st-muted); pointer-events: none; }
.tb-head.tb-row { justify-content: flex-end; text-align: right; }
.tb-head .tb-ht { overflow-wrap: anywhere; }
.tb-mk { font: 700 14px/1 var(--sans, sans-serif); }
.tb-mk[data-mark="tick"] { color: var(--st-g3); }
.tb-mk[data-mark="cross"] { color: var(--st-red); }
.st-cell.tb-cell > .tb-mk { position: absolute; right: -5px; top: -7px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--st-card); box-shadow: 0 0 0 1px var(--st-line); font-size: 12px; }
`,
};

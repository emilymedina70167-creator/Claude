// 树的画法（types/tree.js 的画面那一半）：圆的结点、树枝（画在 stage.under，动画时每一帧跟着结点走）、角上的小字、访问号；
// 插入、查找（圈从根一路比下去）、删除（后继的值飞上来顶替）、旋转（结点和子树沿弧转过去、树枝重连）、换值、遍历这些专门的动作。
// 树变了（插、删、转）整棵重新排版：sync 把要挪的结点交给舞台统一演，新长出来的从父结点那里长出来
import { EASE, stagger } from '../motion.js';
import { NODE, LEVEL, SEP, layoutTree, boxesFor, edgesOf, levelOrder, depths, rootSpot, bfOf, bfText } from './tree.js';
import { el, svg, tr, same, centerOf, ensureCss, placeLines, follow, vanish, Ring, cmpBadge, flyText, swapValue, setOrder, setTag, sizeValue, NODE_CSS } from './node.view.js';

const R = NODE / 2;
const pidOf = (o, k) => `${o.id}:${k}`;
const nodeIn = (o, k) => o.nodes.find((n) => n.key === k);
const parentIn = (o, k) => o.nodes.find((n) => n.left === k || n.right === k) || null;

// 树枝：两个圆心之间的线，两头各缩进一个半径（结点灰掉、半透明时线不穿进圆里）
function drawEdge(line, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
  const k = (R + 1) / d;
  const r = (v) => Math.round(v * 10) / 10;
  line.setAttribute('x1', r(a.x + dx * k)); line.setAttribute('y1', r(a.y + dy * k));
  line.setAttribute('x2', r(b.x - dx * k)); line.setAttribute('y2', r(b.y - dy * k));
  line.style.visibility = d < NODE + 2 ? 'hidden' : '';
}

// 结点在左孩子、右孩子、根的位置：角上的小字贴在外侧（不压着从父结点下来的那条树枝）
function setSide(n, side) {
  n.classList.toggle('is-left', side === 'left');
  n.classList.toggle('is-right', side === 'right');
  n.classList.toggle('is-root', side === 'root');
}

// 树枝对齐到某个结构：新的淡进来、没了的淡掉；两头染成同一种颜色时树枝也染上（路径、子树一眼看得出），一头灰了树枝也灰
function syncEdges(stage, o, struct, { hidden = false, delay = 0, jobs = null } = {}) {
  const want = new Set();
  for (const [a, b] of edgesOf(struct)) {
    const k = `e:${a}>${b}`;
    want.add(k);
    let made = false;
    const line = stage.decor(o.id, k, () => {
      made = true;
      const l = svg('line', { class: 'tr-edge' }, stage.under);
      l.__ends = [pidOf(o, a), pidOf(o, b)];
      l.__draw = drawEdge;
      if (hidden || !stage.instant) l.style.opacity = '0';
      return l;
    });
    const A = nodeIn(o, a), B = nodeIn(o, b);
    const paint = A?.paint && A.paint === B?.paint ? A.paint : null;
    if (paint) line.dataset.paint = paint; else delete line.dataset.paint;
    line.classList.toggle('is-dim', !!(A?.dim || B?.dim));
    if (made && !hidden && !stage.instant) {
      const job = stage.tween(line, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay, easing: EASE.out });
      jobs?.push(job);
    } else if (made && stage.instant) line.style.opacity = '';
  }
  stage.dropDecor(o.id, (k) => k.startsWith('e:') && !want.has(k));
}

// 结点身上的东西：值、左右、角上的小字（自己写的优先；开着 bf 就是平衡因子）、访问号
function dress(stage, o, p, n, side, { animate }) {
  const v = n.querySelector('.st-v');
  if (v.textContent !== p.value && !n.__busy) v.textContent = p.value;
  sizeValue(v, v.textContent);
  setSide(n, side);
  const bf = o.bf ? bfOf(o, p.key) : 0;
  const tag = p.tag ?? (o.bf ? bfText(bf) : null);
  const jobs = [];
  jobs.push(setTag(stage, n, tag, { animate, bad: p.tag == null && Math.abs(bf) >= 2, auto: p.tag == null }));
  jobs.push(setOrder(stage, n, p.order, { pop: animate }));
  return jobs.filter(Boolean);
}

function nodeEl(stage, p, b, hidden) {
  const n = el('div', 'st-cell tr-node', stage.layer);
  el('span', 'st-v', n).textContent = p.value;
  n.style.transform = tr(b.x, b.y);
  n.__box = b;
  if (hidden) n.style.opacity = '0';
  return n;
}

export const treeView = {
  sync(stage, o, ctx) {
    ensureCss('tree', treeView.css);
    const sc = stage.scene;
    const entering = ctx.entering === o.id;
    const pos = layoutTree(o);
    // 空树：根的位置一个虚圈（插进来就长在这里）
    if (o.root == null) {
      stage.decor(o.id, 'empty', () => {
        const g = el('div', 'tr-empty', stage.layer);
        const b = rootSpot(o);
        g.style.transform = tr(b.x, b.y);
        return g;
      });
    } else stage.dropDecor(o.id, (k) => k === 'empty');
    const moves = [], fresh = [];
    // 换值、改值、后继顶替由专门的动作演；访问号由 visit / traverse 弹出来——这里只对齐，不再演一遍
    const animate = !entering && !['visit', 'traverse'].includes(ctx.cmd);
    for (const p of levelOrder(o)) {
      const b = sc.partBox(p);
      let made = false;
      const n = stage.partNode(p, () => { made = true; return nodeEl(stage, p, b, entering || !stage.instant); });
      stage.flagPart(n, p, ctx);
      ctx.jobs.push(...dress(stage, o, p, n, pos.get(p.key)?.side || 'root', { animate: animate && !made }));
      if (made) { if (!entering) fresh.push({ p, n, b }); continue; }
      if (!same(n.__box, b) && (!ctx.only || ctx.only.includes(p))) moves.push({ part: p, node: n, from: n.__box, to: b, order: 0, duration: 640 });
    }
    // 新长出来的：从父结点那里长出来（树同时在长开的话，等它开一点）
    for (const f of fresh) {
      if (stage.instant) { f.n.style.opacity = ''; continue; }
      const par = parentIn(o, f.p.key);
      const pb = par ? sc.partBox(par) : { ...f.b, y: f.b.y - 24 };
      ctx.jobs.push(stage.tween(f.n, [{ opacity: 0, transform: tr(pb.x, pb.y, 0.35) }, { opacity: 1, transform: tr(f.b.x, f.b.y) }], { duration: 620, delay: moves.length ? 260 : 0, easing: EASE.spring }));
    }
    syncEdges(stage, o, o, { hidden: entering, delay: fresh.length ? 200 : 0, jobs: ctx.jobs });
    if (!stage.instant && (moves.length || fresh.length)) ctx.jobs.push(follow(stage, o.id));
    else placeLines(stage, o.id);
    return moves;
  },

  // 一层一层长出来：根先落下，孩子从父结点那里长出来，树枝跟着长
  async enter(stage, o) {
    const sc = stage.scene;
    const d = depths(o);
    const jobs = [];
    const empty = stage.decor(o.id, 'empty');
    if (empty) jobs.push(stage.tween(empty, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 }));
    const rows = new Map();
    for (const p of levelOrder(o)) {
      const n = stage.nodeOf(p), b = sc.partBox(p);
      if (!n) continue;
      const depth = d.get(p.key) || 0;
      const i = rows.get(depth) || 0;
      rows.set(depth, i + 1);
      const par = parentIn(o, p.key);
      const pb = par ? sc.partBox(par) : { ...b, y: b.y - 26 };
      const delay = depth * 170 + stagger(i, { step: 35, max: 200 });
      jobs.push(stage.tween(n, [{ opacity: 0, transform: tr(pb.x, pb.y, par ? 0.35 : 0.9) }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 560, delay, easing: EASE.spring }));
      const line = par && stage.decor(o.id, `e:${par.key}>${p.key}`);
      if (line) jobs.push(stage.tween(line, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: delay + 60 }));
    }
    jobs.push(follow(stage, o.id, { min: 500 }));
    await Promise.all(jobs);
  },

  choreo: {
    // 二叉排序树插入：圈从根一路比下去（每到一个结点冒出「35 < 50」），到了空位往那边一探，树长开、新结点长出来
    async insert(stage, c, fx, pre) {
      if (stage.instant) return;
      if (fx.mode === 'bst' && fx.path.length) await descendShow(stage, fx, pre, { end: 'dip' });
      // 新结点从父结点那里弹着长出来，本身就是强调，不再另闪一下（插一个要比几层，别拖）
      await stage.sync({ pre, cmd: 'insert', fx });
    },
    async append(stage, c, fx, pre) {
      if (stage.instant) return;
      await stage.sync({ pre, cmd: 'append', fx });
    },
    // 查找：一路比下去；找到了那个结点闪一下，找不到圈往空位那边一探、冒出「空」
    async search(stage, c, fx, pre) {
      if (stage.instant) return;
      await descendShow(stage, fx, pre, { end: fx.found != null ? 'found' : 'miss' });
    },
    // 删除：叶子、只有一个孩子的直接缩没（孩子那一支在 sync 里顶上去）；两个孩子的，圈先去找中序后继，后继的值飞上来顶替，再把后继缩没
    async delete(stage, c, fx, pre) {
      if (stage.instant) return;
      const o = stage.scene.objects.get(fx.id);
      const target = stage.nodes.get(pidOf(o, fx.key));
      if (fx.case === 'two' && target) {
        const box = (k) => pre.boxes.get(pidOf(o, k)) || stage.nodes.get(pidOf(o, k))?.__box;
        const ring = new Ring(stage, target.__box);
        await ring.show();
        for (const k of fx.path) { await ring.to(box(k)); await stage.wait(160); }
        const sn = stage.nodes.get(pidOf(o, fx.succ));
        if (sn) {
          sn.querySelector('.st-v').style.visibility = 'hidden';
          await flyText(stage, fx.value, centerOf(sn.__box), centerOf(target.__box), { dir: fx.by === 'succ' ? 1 : -1 });
          ring.out();
          await swapValue(stage, target, fx.value);
          await shrink(stage, sn);
          vanish(stage, pidOf(o, fx.succ));
        } else await ring.out();
      } else if (target) {
        await shrink(stage, target);
        vanish(stage, pidOf(o, fx.key));
      }
      await stage.sync({ pre, cmd: 'delete', fx });
    },
    // 旋转：两个结点和挂着的子树一起沿弧转过去（右旋顺时针、左旋逆时针），树枝跟着结点走、换到新的父结点上；双旋是两下
    async rotate(stage, c, fx) {
      if (stage.instant) return;
      const o = stage.scene.objects.get(fx.id);
      for (const [i, st] of fx.steps.entries()) {
        const to = boxesFor(o, st.snap);
        const na = stage.nodes.get(pidOf(o, st.a)), nb = stage.nodes.get(pidOf(o, st.b));
        if (!na || !nb) continue;
        const cw = st.dir === 'right';
        na.classList.add('is-hot'); nb.classList.add('is-hot');
        await Promise.all([stage.pulse(nodeIn(o, st.a)), stage.pulse(nodeIn(o, st.b))]);
        const pos = layoutTree(st.snap);
        const jobs = [];
        for (const p of o.nodes) {
          const n = stage.nodes.get(pidOf(o, p.key)), b = to.get(p.key);
          if (!n || !b) continue;
          setSide(n, pos.get(p.key)?.side || 'root');
          if (same(n.__box, b)) continue;
          jobs.push(stage.moveNode(p, turnFrames(n.__box, b, cw), b, { duration: 980, easing: EASE.move }));
        }
        syncEdges(stage, o, st.snap, { delay: 380, jobs });
        jobs.push(follow(stage, o.id));
        await Promise.all(jobs);
        na.classList.remove('is-hot'); nb.classList.remove('is-hot');
        if (i < fx.steps.length - 1) await stage.wait(320);
      }
    },
    // 换值：两个值各走一道弧换过去（一个从左边过、一个从右边过），结点不动
    async swap(stage, c, fx) {
      // 话里指着这两个的小块跟着值走（老师说「{h.12}」说的是 12 这个值，换到哪个结点它就指着哪个；重放时也要换）
      const pa = stage.pid(fx.a), pb = stage.pid(fx.b);
      const ca = [...stage.root.querySelectorAll(`.st-chip[data-cell="${CSS.escape(pa)}"]`)], cb = [...stage.root.querySelectorAll(`.st-chip[data-cell="${CSS.escape(pb)}"]`)];
      ca.forEach((ch) => { ch.dataset.cell = pb; });
      cb.forEach((ch) => { ch.dataset.cell = pa; });
      if (stage.instant) return;
      const na = stage.nodeOf(fx.a), nb = stage.nodeOf(fx.b);
      if (!na || !nb) return;
      const va = na.querySelector('.st-v'), vb = nb.querySelector('.st-v');
      const A = centerOf(na.__box), B = centerOf(nb.__box);
      // 学生拖过去的：它的值从手放开的地方飞进去
      const drop = c.dragged ? (na.__drop || A) : A;
      delete na.__drop;
      const ta = va.textContent, tb = vb.textContent;
      na.__busy = nb.__busy = true;
      va.style.visibility = vb.style.visibility = 'hidden';
      await Promise.all([flyText(stage, ta, drop, B, { dir: -1 }), flyText(stage, tb, B, A, { dir: -1 })]);
      va.textContent = fx.a.value; vb.textContent = fx.b.value;
      sizeValue(va, va.textContent); sizeValue(vb, vb.textContent);
      va.style.visibility = vb.style.visibility = '';
      na.__busy = nb.__busy = false;
      await Promise.all([stage.pulse(fx.a), stage.pulse(fx.b)]);
    },
    async write(stage, c, fx) {
      if (stage.instant) return;
      const n = stage.nodeOf(fx.part);
      if (n) await swapValue(stage, n, fx.part.value);
    },
    // 圈沿着树枝走一遍：停的结点闪一下
    async walk(stage, c, fx) {
      if (stage.instant) return;
      const o = stage.scene.objects.get(fx.id);
      const box = (k) => stage.nodes.get(pidOf(o, k))?.__box;
      const ring = new Ring(stage, box(fx.path[0]));
      await ring.show();
      const stops = [...fx.stops];
      if (stops[0] === fx.path[0]) { stops.shift(); stage.pulse(nodeIn(o, fx.path[0])); }
      for (const k of fx.path.slice(1)) {
        await ring.to(box(k));
        if (stops[0] === k) { stops.shift(); await stage.pulse(nodeIn(o, k)); }
      }
      await stage.wait(200);
      await ring.out();
    },
    // 访问：和上一个访问的相邻（父子），圈沿树枝走过去；不相邻（层序、先序回头）就在这个结点上亮起来；号码弹出来
    async visit(stage, c, fx) {
      if (stage.instant) return;
      const o = stage.scene.objects.get(fx.id);
      const box = (k) => stage.nodes.get(pidOf(o, k))?.__box;
      const near = (a, b) => a != null && (parentIn(o, a)?.key === b || parentIn(o, b)?.key === a);
      let ring = null, prev = fx.from;
      for (const k of fx.keys) {
        if (ring && near(prev, k)) await ring.to(box(k));
        else if (near(prev, k)) { ring = new Ring(stage, box(prev)); await ring.show(); await ring.to(box(k)); }
        else { if (ring) ring.out(); ring = new Ring(stage, box(k)); await ring.show(); }
        await setOrder(stage, stage.nodes.get(pidOf(o, k)), nodeIn(o, k).order, { pop: true });
        prev = k;
      }
      await stage.wait(240);
      await ring?.out();
    },
    // 整趟遍历：圈沿着树枝绕一圈（下去、回来），到了该记下的时候号码弹出来；层序一层一层亮
    async traverse(stage, c, fx) {
      if (stage.instant) return;
      const o = stage.scene.objects.get(fx.id);
      for (const p of o.nodes) { const n = stage.nodes.get(pidOf(o, p.key)); if (n && !fx.order.includes(p.key)) setOrder(stage, n, null); else if (n) n.querySelector(':scope > .nv-ord')?.remove(); }
      const box = (k) => stage.nodes.get(pidOf(o, k))?.__box;
      const pop = (j) => setOrder(stage, stage.nodes.get(pidOf(o, fx.order[j])), j + 1, { pop: true });
      if (!fx.tour) {
        for (let j = 0; j < fx.order.length; j++) { stage.pulse(nodeIn(o, fx.order[j])); await pop(j); await stage.wait(140); }
        return;
      }
      const step = fx.tour.length > 16 ? 230 : 300;
      const ring = new Ring(stage, box(fx.tour[0]));
      await ring.show();
      let j = 0;
      for (let i = 0; i < fx.tour.length; i++) {
        if (i > 0) await ring.to(box(fx.tour[i]), { duration: step });
        while (j < fx.at.length && fx.at[j] === i) { await pop(j); j++; }
      }
      await stage.wait(260);
      await ring.out();
    },
  },

  // 学生拖：按住一个结点，把它的值拖出来，放到另一个结点上，两个就换值（堆的上滤、下滤自己动手做）
  drag(stage, x, peers, done) {
    const n = stage.nodeOf(x);
    if (!n) return () => {};
    n.classList.add('is-drag');
    let start = null, ghost = null, from = null;
    const target = (wx, wy) => {
      let best = null, bd = Infinity;
      for (const p of peers) {
        if (p === x || p.obj !== x.obj) continue;
        const c = centerOf(stage.scene.partBox(p));
        const d = Math.hypot(c.x - wx, c.y - wy);
        if (d < bd) { bd = d; best = p; }
      }
      return bd < NODE * 0.8 ? best : null;
    };
    const at = (p) => tr(p.x - NODE / 2, p.y - NODE / 2);
    const down = (e) => {
      e.preventDefault();
      n.setPointerCapture?.(e.pointerId);
      start = stage.toWorld(e.clientX, e.clientY);
      from = centerOf(n.__box);
      n.classList.add('is-hold');
      const v = n.querySelector('.st-v');
      ghost = el('div', 'nv-fly is-drag', stage.layer);
      ghost.textContent = v.textContent;
      ghost.style.transform = at(from);
      v.style.visibility = 'hidden';
    };
    const move = (e) => {
      if (!start) return;
      const p = stage.toWorld(e.clientX, e.clientY);
      const q = { x: from.x + p.x - start.x, y: from.y + p.y - start.y };
      ghost.style.transform = `${at(q)} scale(1.15)`;
      ghost.__at = q;
      const t = target(q.x, q.y);
      peers.forEach((pp) => stage.nodeOf(pp)?.classList.toggle('is-over', pp === t));
    };
    const up = async () => {
      if (!start) return;
      start = null;
      n.classList.remove('is-hold');
      peers.forEach((pp) => stage.nodeOf(pp)?.classList.remove('is-over'));
      const q = ghost.__at || from;
      const t = target(q.x, q.y);
      const g = ghost;
      ghost = null;
      if (t) {
        n.__drop = q;
        g.remove();
        done({ type: 'drag', text: `学生把 ${x.value}（${stage.scene.refOf(x)}）拖到 ${t.value}（${stage.scene.refOf(t)}）上，两个结点换了值（舞台已经照做了）`, from: stage.scene.refOf(x), to: stage.scene.refOf(t) }, `swap ${x.obj}#${x.key} ${t.obj}#${t.key}`);
        return;
      }
      // 没放到别的结点上：值飞回去
      await stage.tween(g, [{ transform: g.style.transform }, { transform: at(from) }], { duration: 360, easing: EASE.spring });
      g.remove();
      n.querySelector('.st-v').style.visibility = '';
    };
    n.addEventListener('pointerdown', down);
    n.addEventListener('pointermove', move);
    n.addEventListener('pointerup', up);
    n.addEventListener('pointercancel', up);
    return () => { n.classList.remove('is-drag', 'is-hold'); n.removeEventListener('pointerdown', down); n.removeEventListener('pointermove', move); n.removeEventListener('pointerup', up); n.removeEventListener('pointercancel', up); };
  },

  css: `${NODE_CSS}
.st-cell.tr-node { width: ${NODE}px; height: ${NODE}px; border-radius: 50%; }
.st-cell.tr-node.is-tap::after, .st-cell.tr-node.is-drag::after { border-radius: 50%; }
.st-cell.tr-node.is-hot { box-shadow: 0 0 0 2.5px var(--st-gold), 0 0 0 8px color-mix(in srgb, var(--st-gold) 22%, transparent), 0 10px 20px -12px rgb(var(--shade-rgb, 25 45 40) / 0.5); z-index: 3; }
.tr-node > .nv-tag { top: -12px; left: 38px; }
.tr-node.is-left > .nv-tag { left: auto; right: 38px; }
.tr-node > .nv-ord { left: 50%; bottom: -12px; margin-left: -12px; }
.nv-fly.is-drag { z-index: 7; cursor: grabbing; }
.tr-edge { stroke: rgb(var(--chalk-rgb, 27 34 32) / 0.32); stroke-width: 2.5; stroke-linecap: round; transition: stroke .35s, stroke-width .35s, opacity .35s; }
.tr-edge[data-paint] { stroke: var(--c); stroke-width: 3.5; }
.tr-edge.is-dim { opacity: .28; }
.tr-empty { position: absolute; left: 0; top: 0; width: ${NODE}px; height: ${NODE}px; box-sizing: border-box; border-radius: 50%; border: 1.5px dashed rgb(var(--chalk-rgb, 27 34 32) / 0.28); }
.tr-miss { position: absolute; left: 0; top: 0; width: ${NODE}px; height: ${NODE}px; box-sizing: border-box; border-radius: 50%; border: 2px dashed var(--st-red); color: var(--st-red); display: grid; place-items: center; font: 600 16px/1 var(--sans, sans-serif); pointer-events: none; }
`,
};

// 旋转时一个结点从 a 走到 b：沿一道弧（右旋顺时针、左旋逆时针拱），像整棵转过去
function turnFrames(a, b, cw) {
  const p0 = centerOf(a), p1 = centerOf(b);
  const dx = p1.x - p0.x, dy = p1.y - p0.y, d = Math.hypot(dx, dy) || 1;
  const k = Math.min(64, d * 0.32);
  // 屏幕坐标 y 朝下：顺时针转，弧往弦的「左手边」拱
  const nx = cw ? dy / d : -dy / d, ny = cw ? -dx / d : dx / d;
  const cx = (p0.x + p1.x) / 2 + nx * k, cy = (p0.y + p1.y) / 2 + ny * k;
  return Array.from({ length: 17 }, (_, i) => {
    const t = i / 16, u = 1 - t;
    const x = u * u * p0.x + 2 * u * t * cx + t * t * p1.x, y = u * u * p0.y + 2 * u * t * cy + t * t * p1.y;
    return { transform: tr(x - a.w / 2, y - a.h / 2), offset: t };
  });
}

async function shrink(stage, n) {
  if (!n?.__box) return;
  const b = n.__box;
  await stage.tween(n, [{ opacity: 1, transform: tr(b.x, b.y) }, { opacity: 0, transform: tr(b.x, b.y + 10, 0.3) }], { duration: 360, easing: EASE.in });
}

// 二叉排序树从根比下去（插入、查找共用）：圈一个结点一个结点往下走，每到一个冒出比较的结果
async function descendShow(stage, fx, pre, { end }) {
  const o = stage.scene.objects.get(fx.id);
  const box = (k) => pre.boxes.get(pidOf(o, k)) || stage.nodes.get(pidOf(o, k))?.__box;
  const valueOf = (k) => stage.nodes.get(pidOf(o, k))?.querySelector('.st-v')?.textContent ?? nodeIn(o, k)?.value;
  const ring = new Ring(stage, box(fx.path[0]));
  await ring.show();
  // 一层大约 0.7 秒：圈到了冒出比较，停一下让人看清，收牌子和往下走同时进行
  let last = null;
  for (let i = 0; i < fx.path.length; i++) {
    const k = fx.path[i];
    if (i > 0) await ring.to(box(k), { duration: 300 });
    const badge = cmpBadge(stage, box(k), fx.value, fx.cmps[i], valueOf(k));
    await badge.shown;
    await stage.wait(fx.cmps[i] === 0 ? 520 : i ? 300 : 420);
    last = badge.hide();
  }
  await last;
  if (end === 'found') {
    const p = nodeIn(o, fx.found);
    const n = stage.nodes.get(pidOf(o, fx.found));
    n?.classList.add('is-hot');
    await stage.pulse(p);
    await stage.wait(360);
    n?.classList.remove('is-hot');
    await ring.out();
    return;
  }
  // 往空位那边探一下（插入时树接着长开，新结点从这里长出来；查找时冒出一个「空」）
  const dx = fx.side === 'left' ? -SEP / 2 : SEP / 2;
  if (end === 'miss') {
    const b = box(fx.path.at(-1));
    const g = el('div', 'tr-miss', stage.layer);
    g.textContent = '空';
    const at = { x: b.x + dx * 0.9, y: b.y + LEVEL * 0.8 };
    ring.dip(dx * 0.6, LEVEL * 0.5);
    await stage.tween(g, [{ opacity: 0, transform: tr(at.x, at.y - 16, 0.6) }, { opacity: 1, transform: tr(at.x, at.y) }], { duration: 320, easing: EASE.out });
    await stage.wait(520);
    await stage.tween(g, [{ opacity: 1 }, { opacity: 0 }], { duration: 260 });
    g.remove();
    return;
  }
  await ring.dip(dx * 0.6, LEVEL * 0.45);
}


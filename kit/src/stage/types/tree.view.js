// 树的画法（types/tree.js 的画面那一半）：圆的结点、树枝（画在 stage.under，动画时每一帧跟着结点走）、角上的小字、访问号；
// 插入、查找（圈从根一路比下去）、删除（后继的值飞上来顶替）、旋转（结点只上下移、树枝重连，换父亲的那棵子树描橙色）、换值、遍历这些专门的动作。
// 树变了（插、删、转）照中序重新排版（tree.js 的 layoutTree：插入只挪右边的，旋转只上下移）：sync 把要挪的结点交给舞台统一演，
// 新长出来的从父结点那里长出来。树长宽了不重排：第一列不动，镜头往后退（stage.js 的 keepInView）
import { EASE, stagger } from '../motion.js';
import { bbox, grow } from '../layout.js';
import { NODE, LEVEL, COL, TAG_ROOM, CORNER_H, boxesFor, edgesOf, levelOrder, depths, rootSpot, bfOf, bfText, heightOf, cornerRect, trayBoxes, trayArea, treeArea, slotSpots } from './tree.js';
import { el, svg, tr, same, centerOf, ensureCss, placeLines, follow, vanish, Ring, cmpBadge, flyText, swapValue, setOrder, setTag, sizeValue, NODE_CSS } from './node.view.js';
import { openParts } from '../gesturedom.js';

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

// 结点身上的东西：值、角上的三种小字（各贴一个角，一起开着也不叠：老师写的 tag 左上、开着 bf 的平衡因子右上、
// 开着 heights 的子树高右下；以前 tag 和平衡因子挤一个角，写了 tag 就看不见平衡因子）、正下方的访问号
function dress(stage, o, p, n, { animate }) {
  const v = n.querySelector('.st-v');
  if (v.textContent !== p.value && !n.__busy) v.textContent = p.value;
  sizeValue(v, v.textContent);
  const bf = o.bf ? bfOf(o, p.key) : null;
  const jobs = [];
  jobs.push(setTag(stage, n, p.tag ?? null, { animate, slot: 'tag' }));
  jobs.push(setTag(stage, n, bf == null ? null : bfText(bf), { animate, bad: bf != null && Math.abs(bf) >= 2, auto: true, slot: 'bf' }));
  jobs.push(setTag(stage, n, o.heights ? String(heightOf(o, p.key)) : null, { animate, auto: true, slot: 'h' }));
  jobs.push(setOrder(stage, n, p.order, { pop: animate }));
  return jobs.filter(Boolean);
}

// 托盘（tray="47 10"）：树下面一排待插的数，插进去一个就少一个（插的那一下树从父结点那里长出新结点，托盘里那一个淡掉）
function syncTray(stage, o, ctx) {
  const want = new Set();
  const entering = ctx.entering === o.id;
  const put = (n, b, made) => {
    const was = n.__box;
    n.__box = b;
    if (made || stage.instant || !was) {
      n.style.transform = tr(b.x, b.y);
      if (b.w != null && n.classList.contains('tr-tray')) { n.style.width = `${b.w}px`; n.style.height = `${b.h}px`; }
      if (made && (entering || !stage.instant)) n.style.opacity = '0';
      if (made && !entering && !stage.instant) ctx.jobs.push(stage.tween(n, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: 200, easing: EASE.out }).then(() => { n.style.opacity = ''; }));
      return;
    }
    if (same(was, b) && was.w === b.w) return;
    const f0 = { transform: tr(was.x, was.y) }, f1 = { transform: tr(b.x, b.y) };
    if (n.classList.contains('tr-tray')) { f0.width = `${was.w}px`; f1.width = `${b.w}px`; n.style.width = `${b.w}px`; n.style.height = `${b.h}px`; }
    ctx.jobs.push(stage.tween(n, [f0, f1], { duration: 520, easing: EASE.move }));
  };
  const area = trayArea(o);
  let idle = false;
  if (area) {
    want.add('tray');
    let made = false;
    const bg = stage.decor(o.id, 'tray', () => { made = true; return el('div', 'tr-tray', stage.layer); });
    put(bg, area, made);
    // 插入没交给学生（老师 close 了、还没 open t insert）：托盘画淡，看着不像能拖（自由排版试验：「先收回插入」画面上看不出来）
    const armed = [...(stage.scene.opens?.values?.() || [])].some((e) => e.obj === o.id && (e.action === 'insert' || e.action === 'move'));
    bg.classList.toggle('is-idle', !armed);
    idle = !armed;
  }
  for (const b of trayBoxes(o)) {
    const k = `tray:${b.value}`;
    want.add(k);
    let made = false;
    const n = stage.decor(o.id, k, () => {
      made = true;
      const n = el('div', 'st-cell tr-node tr-chip', stage.layer);
      const v = el('span', 'st-v', n);
      v.textContent = b.value;
      sizeValue(v, b.value);
      return n;
    });
    put(n, b, made);
    n.classList.toggle('is-idle', idle);
  }
  stage.dropDecor(o.id, (k) => (k === 'tray' || k.startsWith('tray:')) && !want.has(k));
}

// 通用手势（gesturedom.js）抓哪儿：结点、托盘里的数、整棵树（拖进来插入）、空位（自己摆）。部件、节点都按 key 现取
const nodeGrips = (stage, id, list) => list.map((p) => ({
  key: `n:${p.key}`,
  part: () => stage.scene.partOf(id, p.key),
  node: () => stage.nodes.get(`${id}:${p.key}`),
  box: () => { const x = stage.scene.partOf(id, p.key); return x ? stage.scene.partBox(x) : null; },
}));
// 只在拖的时候画出来的落点（整棵树那一块、一个个空位）：show(true) 画上、show(false) 收掉；不带 data-obj，排版不算它
function shownGrip(stage, key, part, box, cls) {
  let n = null;
  return {
    key, part, box, node: () => n,
    show(on) {
      if (on && !n) {
        const b = box();
        if (!b) return;
        n = el('div', cls, stage.layer);
        n.style.transform = tr(b.x, b.y);
        n.style.width = `${b.w}px`;
        n.style.height = `${b.h}px`;
      } else if (!on && n) { n.remove(); n = null; }
    },
  };
}

function nodeEl(stage, p, b, hidden) {
  const n = el('div', 'st-cell tr-node', stage.layer);
  el('span', 'st-v', n).textContent = p.value;
  n.style.transform = tr(b.x, b.y);
  n.__box = b;
  if (hidden) n.style.opacity = '0';
  return n;
}

// 角上的小字贴在哪（tree.js 的 cornerRect，测试量过不叠、不压值）：CSS 照它写
const TL = cornerRect('tag', 24), TR = cornerRect('bf', 24), BR = cornerRect('height', 24), OR = cornerRect('order', 24);

export const treeView = {
  sync(stage, o, ctx) {
    ensureCss('tree', treeView.css);
    const sc = stage.scene;
    const entering = ctx.entering === o.id;
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
      ctx.jobs.push(...dress(stage, o, p, n, { animate: animate && !made }));
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
    syncTray(stage, o, ctx);
    if (!stage.instant && (moves.length || fresh.length)) ctx.jobs.push(follow(stage, o.id));
    else placeLines(stage, o.id);
    return moves;
  },

  grips: {
    // rotate：拖的是结点（open t.30* rotate 只拖那几个），放的是它的父亲（手势表交 toAct 判是不是父亲）
    node: (stage, o, e) => nodeGrips(stage, o.id, openParts(stage, e, o.nodes)),
    parent: (stage, o) => nodeGrips(stage, o.id, o.nodes),
    // 托盘里的数：插进去它就没了（consumed：拎走的样子演完再放回）
    tray: (stage, o) => (o.tray || []).map((v) => ({
      key: `tray:${v}`, value: v, consumed: true,
      part: () => ({ tray: v }),
      node: () => stage.decor(o.id, `tray:${v}`),
      box: () => { const t = stage.scene.objects.get(o.id); return t ? trayBoxes(t).find((b) => b.value === v) || null : null; },
    })),
    // insert：拖到树上哪儿都行，页面从根比下去
    tree: (stage, o) => [shownGrip(stage, 'tree', () => ({ tree: o.id }), () => { const t = stage.scene.objects.get(o.id); if (!t) return null; const b = treeArea(t); return { x: b.x + TAG_ROOM / 2, y: b.y + TAG_ROOM / 2, w: b.w - TAG_ROOM, h: b.h - TAG_ROOM }; }, 'tr-zone')],
    // place：一个个空位（结点缺孩子的那一边）
    slot: (stage, o) => slotSpots(o).map((sp) => shownGrip(stage, `slot:${sp.parent}:${sp.side}`, () => ({ slot: { parent: sp.parent, side: sp.side } }), () => sp.box, 'tr-spot')),
  },
  // 拖着悬在落点上：先说放下会怎样（「在 50 右旋」「47 放在 45 的右边」）
  gestureHint(stage, o, e, r) {
    const a = r?.act;
    const val = (k) => o.nodes.find((n) => n.key === k)?.value ?? '';
    if (a?.type === 'rotate') return `在 ${val(a.at)} ${a.dir === 'right' ? '右旋' : '左旋'}`;
    if (a?.type === 'insert') return a.parent != null ? `${a.value} 放在 ${val(a.parent)} 的${a.side === 'left' ? '左' : '右'}边` : `插入 ${a.value}`;
    return '';
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
    // 托盘跟着树一起淡进来
    for (const [k, n] of stage.decors.get(o.id) || []) if (k === 'tray' || k.startsWith('tray:')) jobs.push(stage.tween(n, [{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: 160 + (d.size ? Math.max(...d.values()) : 0) * 170 }).then(() => { n.style.opacity = ''; }));
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
    // 旋转：按中序排的，转前转后横坐标不变，结点只上下移（转上来的往上、转下去的往下，挂着的子树跟着）；紧凑排的照旧沿弧转过去
    // （右旋顺时针、左旋逆时针）。树枝换到新的父结点上。换了父亲的那棵子树（右旋 a：b 原来的右子树挂到 a 的左边）先描一道橙色，
    // 滑到新父亲下面时闪一下（按中序排的它不挪，是新父亲转下来接住它）——只是画面，不改什么。双旋是两下，每一下各描各的
    async rotate(stage, c, fx) {
      if (stage.instant) return;
      const o = stage.scene.objects.get(fx.id);
      for (const [i, st] of fx.steps.entries()) {
        const to = boxesFor(o, st.snap);
        const na = stage.nodes.get(pidOf(o, st.a)), nb = stage.nodes.get(pidOf(o, st.b));
        if (!na || !nb) continue;
        na.classList.add('is-hot'); nb.classList.add('is-hot');
        const moved = st.moved != null ? regraft(stage, o, st, to) : null;
        await Promise.all([stage.pulse(nodeIn(o, st.a)), stage.pulse(nodeIn(o, st.b)), moved?.shown]);
        const jobs = [];
        const arc = o.layout === 'compact';
        const duration = arc ? 980 : 820;
        for (const p of o.nodes) {
          const n = stage.nodes.get(pidOf(o, p.key)), b = to.get(p.key);
          if (!n || !b || same(n.__box, b)) continue;
          const frames = arc ? turnFrames(n.__box, b, st.dir === 'right') : [{ transform: tr(n.__box.x, n.__box.y) }, { transform: tr(b.x, b.y) }];
          jobs.push(stage.moveNode(p, frames, b, { duration, easing: EASE.move }));
        }
        syncEdges(stage, o, st.snap, { delay: arc ? 380 : 320, jobs });
        if (moved) jobs.push(moved.slide(duration));
        moved?.relink();
        jobs.push(follow(stage, o.id));
        await Promise.all(jobs);
        na.classList.remove('is-hot'); nb.classList.remove('is-hot');
        if (moved) await moved.arrive();
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

  // 学生拖（手指的事在 pointer.js）：按住一个结点，把它的值拖出来，靠近哪个结点就亮哪个，放上去两个就换值（堆的上滤、下滤自己动手做）；
  // 没靠近别的结点就飞回去。部件、节点按 key 现取
  dragSpec(stage, x, peers) {
    const id = x.obj, key = x.key;
    const keys = peers.filter((p) => p.obj === id && p.key !== key).map((p) => p.key);
    const node = (k = key) => stage.nodes.get(`${id}:${k}`);
    const part = (k = key) => stage.scene.partOf(id, k);
    const at = (p) => tr(p.x - NODE / 2, p.y - NODE / 2);
    let start = null, from = null, ghost = null, over = null, q = null;
    const near = (p) => {
      let best = null, bd = Infinity;
      for (const k of keys) { const pp = part(k); if (!pp) continue; const c = centerOf(stage.scene.partBox(pp)); const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = k; } }
      return bd < NODE * 0.9 ? best : null;
    };
    const light = (k) => { if (over === k) return; if (over != null) node(over)?.classList.remove('is-over'); over = k; if (k != null) node(k)?.classList.add('is-over'); };
    const clear = () => { light(null); node()?.classList.remove('is-hold'); };
    return {
      start(w) {
        const n = node();
        if (!n || !part()) throw new Error('这个结点不在了');
        start = w;
        from = centerOf(stage.scene.partBox(part()));
        q = from;
        n.classList.add('is-hold');
        const v = n.querySelector('.st-v');
        ghost = el('div', 'nv-fly is-drag', stage.layer);
        ghost.textContent = v?.textContent ?? '';
        ghost.style.transform = at(from);
        if (v) v.style.visibility = 'hidden';
      },
      move(w) {
        if (!start || !ghost) return;
        q = { x: from.x + w.x - start.x, y: from.y + w.y - start.y };
        ghost.style.transform = `${at(q)} scale(1.15)`;
        light(near(q));
      },
      drop() {
        const t = over;
        clear();
        const a = part(), b = t != null ? part(t) : null;
        if (!a || !b || !ghost) return null;
        node().__drop = q;
        ghost.remove();
        ghost = null;
        return { act: { type: 'drag', text: `学生把 ${a.value}（${stage.scene.refOf(a)}）拖到 ${b.value}（${stage.scene.refOf(b)}）上，两个结点换了值（舞台已经照做了）`, from: stage.scene.refOf(a), to: stage.scene.refOf(b) }, src: `swap ${id}#${a.key} ${id}#${b.key}` };
      },
      async cancel() {
        clear();
        const g = ghost;
        ghost = null;
        if (g && from) { await stage.tween(g, [{ transform: g.style.transform }, { transform: at(from) }], { duration: 360, easing: EASE.spring }); g.remove(); }
        const v = node()?.querySelector('.st-v');
        if (v) v.style.visibility = '';
      },
    };
  },

  css: `${NODE_CSS}
.st-cell.tr-node { width: ${NODE}px; height: ${NODE}px; border-radius: 50%; }
.st-cell.tr-node.is-tap::after, .st-cell.tr-node.is-drag::after { border-radius: 50%; }
.st-cell.tr-node.is-hot { box-shadow: 0 0 0 2.5px var(--st-gold), 0 0 0 8px color-mix(in srgb, var(--st-gold) 22%, transparent), 0 10px 20px -12px rgb(var(--shade-rgb, 25 45 40) / 0.5); z-index: 3; }
.tr-node > .nv-tag { top: ${TL.y}px; }
.tr-node > .nv-tag[data-slot="tag"] { right: ${NODE - TL.x - TL.w}px; }
.tr-node > .nv-tag[data-slot="bf"] { left: ${TR.x}px; }
.tr-node > .nv-tag[data-slot="h"] { top: auto; bottom: ${NODE - BR.y - CORNER_H}px; left: ${BR.x}px; min-width: 22px; padding: 0 5px; border-radius: 7px; font-weight: 500; }
.tr-node > .nv-ord { left: ${OR.x}px; bottom: ${NODE - OR.y - OR.h}px; }
.tr-moved { position: absolute; left: 0; top: 0; box-sizing: border-box; border-radius: ${NODE / 2 + 10}px; border: 2.5px solid var(--st-g6); background: color-mix(in srgb, var(--st-g6) 7%, transparent); pointer-events: none; }
.tr-moved.is-arrive { animation: tr-arrive .45s ease-in-out 2; }
.st-cell.tr-node.is-arrive { animation: tr-arrive-node .45s ease-in-out 2; }
@keyframes tr-arrive { 50% { background: color-mix(in srgb, var(--st-g6) 18%, transparent); box-shadow: 0 0 0 7px color-mix(in srgb, var(--st-g6) 22%, transparent); } }
@keyframes tr-arrive-node { 50% { box-shadow: 0 0 0 2.5px var(--st-g6), 0 0 0 8px color-mix(in srgb, var(--st-g6) 22%, transparent); } }
@media (prefers-reduced-motion: reduce) { .tr-moved.is-arrive, .st-cell.tr-node.is-arrive { animation: none; } }
.nv-fly.is-drag { z-index: 7; cursor: grabbing; }
.tr-edge { stroke: rgb(var(--chalk-rgb, 27 34 32) / 0.32); stroke-width: 2.5; stroke-linecap: round; transition: stroke .35s, stroke-width .35s, opacity .35s; }
.tr-edge[data-paint] { stroke: var(--c); stroke-width: 3.5; }
.tr-edge.is-dim { opacity: .28; }
.tr-edge.is-moved { stroke: var(--st-g6); stroke-width: 3.5; }
.tr-empty { position: absolute; left: 0; top: 0; width: ${NODE}px; height: ${NODE}px; box-sizing: border-box; border-radius: 50%; border: 1.5px dashed rgb(var(--chalk-rgb, 27 34 32) / 0.28); }
.tr-tray.is-idle { opacity: .45; border-style: solid; }
.tr-chip.is-idle { opacity: .55; }
.tr-tray { position: absolute; left: 0; top: 0; box-sizing: border-box; border-radius: 40px; background: color-mix(in srgb, var(--st-brand) 5%, transparent); border: 1.5px dashed color-mix(in srgb, var(--st-brand) 26%, transparent); pointer-events: none; }
.tr-chip { z-index: 2; }
.tr-chip.is-drag::after { border-radius: 50%; }
.tr-zone { position: absolute; left: 0; top: 0; box-sizing: border-box; border-radius: 28px; border: 2px dashed color-mix(in srgb, var(--st-brand) 30%, transparent); pointer-events: none; transition: background-color .2s, border-color .2s; }
.tr-zone.is-over { background: color-mix(in srgb, var(--st-brand) 7%, transparent); border-color: var(--st-brand); }
.tr-spot { position: absolute; left: 0; top: 0; box-sizing: border-box; border-radius: 50%; border: 2px dashed color-mix(in srgb, var(--st-brand) 40%, transparent); pointer-events: none; transition: background-color .2s, border-color .2s, scale .2s; }
.tr-spot.is-over { background: color-mix(in srgb, var(--st-brand) 12%, transparent); border-color: var(--st-brand); scale: 1.08; }
.tr-miss { position: absolute; left: 0; top: 0; width: ${NODE}px; height: ${NODE}px; box-sizing: border-box; border-radius: 50%; border: 2px dashed var(--st-red); color: var(--st-red); display: grid; place-items: center; font: 600 16px/1 var(--sans, sans-serif); pointer-events: none; }
`,
};

// 紧凑排的旋转时一个结点从 a 走到 b：沿一道弧（右旋顺时针、左旋逆时针拱），像整棵转过去
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

// 旋转里换了父亲的那棵子树（st.moved 是它的根）：外面描一道橙色的圈（按中序排时子树占着连着的几列、下面几层，框里没有别的结点；紧凑排的偶尔框进一点邻居），
// 原来连着它的那根树枝也染橙；转完连到新父亲的那根染橙，整棵闪一下，再收掉。只是画面后果，场景里什么都不记
// to：这一步转完每个结点的框（紧凑排的这棵子树会挪，圈跟着滑过去）
function regraft(stage, o, st, to) {
  const keys = levelOrder(st.snap, st.moved).map((n) => n.key);
  const boxes = keys.map((k) => stage.nodes.get(pidOf(o, k))?.__box).filter(Boolean);
  const area = bbox(boxes);
  if (!area) return null;
  const b = grow(area, 10); // 不出结点让出来的那一圈（treeArea），排版检查不报
  const b1 = grow(bbox(keys.map((k) => to.get(k)).filter(Boolean)) || area, 10);
  // 记成这一样东西的 decor：中途清舞台、拿掉这棵树时跟着收掉，不会留下一个孤零零的橙框
  const ring = stage.decor(o.id, 'moved', () => {
    const n = el('div', 'tr-moved');
    stage.layer.prepend(n); // 在结点下面（树枝在更下面的 stage.under）
    return n;
  });
  ring.style.transform = tr(b.x, b.y);
  ring.style.width = `${b.w}px`;
  ring.style.height = `${b.h}px`;
  const nodes = keys.map((k) => stage.nodes.get(pidOf(o, k))).filter(Boolean);
  const edge = (from) => stage.decor(o.id, `e:${from}>${st.moved}`);
  edge(st.b)?.classList.add('is-moved');
  return {
    shown: stage.tween(ring, [{ opacity: 0, transform: `${tr(b.x, b.y)} scale(1.06)` }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 300, easing: EASE.out }),
    // 跟着结点滑到转完的地方（按中序排的不挪：前后一样就不动）
    slide(duration) {
      if (same(b, b1)) return Promise.resolve();
      ring.style.width = `${b1.w}px`;
      ring.style.height = `${b1.h}px`;
      return stage.tween(ring, [{ transform: tr(b.x, b.y) }, { transform: tr(b1.x, b1.y) }], { duration, easing: EASE.move });
    },
    // 树枝换好了（syncEdges 刚画上新父亲那一根）
    relink() { edge(st.a)?.classList.add('is-moved'); },
    async arrive() {
      ring.classList.add('is-arrive');
      nodes.forEach((n) => n.classList.add('is-arrive'));
      await stage.wait(900);
      nodes.forEach((n) => n.classList.remove('is-arrive'));
      edge(st.a)?.classList.remove('is-moved');
      stage.dropDecor(o.id, (k) => k === 'moved'); // 淡掉、拿下（双旋的第二下另描一个）
      await stage.wait(200);
    },
  };
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
  const dx = fx.side === 'left' ? -COL / 2 : COL / 2; // 空位在半列的地方（tree.js 的 slotSpots）
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


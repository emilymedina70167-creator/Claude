// 老师的教具（课堂模式和实时黑板共用）：板书标注 mark / unmark、让图动 figure set / play / highlight。
// 指令从哪来、结果告诉谁由各自的控制器管（课堂：课堂 Claude 的 board 块；实时黑板：数据库的 ops 集合）；
// 这里只管在板上执行：找目标、只动当前板和常驻栏、记下板上现有的标注（段改写、撤回时一起擦掉）。
// 画法在 marks.js，写法在 markspec.js / protocol.js。
import { tasksText } from '../graphpick.js';
import { session } from '../session.js';
import { compile as compileRad } from '../expr.js';
import { markLayer } from '../marks.js';
import { markWhere } from '../markspec.js';

// 画图的地方三角函数按角度（curve … for s 0 360、滑块的角度）：计划 3 以后表达式默认弧度，这里明着要角度（tests/expr-rad.test.js）
const compile = (src) => compileRad(src, { deg: true });

const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * bv：板视图（boardview.js）；segs：段表（Map：段 id → { id, hidden, pending?, failed?, sec }）。
 * 返回执行指令的函数和板上现有的标注（marks：标注 id → { id, seg（所在的段）, spec, host（画在哪一段上）}）。
 */
/**
 * figure set 的赋值：step=rotate#2 / end 先按事件找步号（演示组件的 stepAlias），别的照常算。
 * 上课时执行、刷新后放回（课堂、实时黑板）都用这一个，免得放回时 step=end 算不出来、停在开头
 */
export function applyAssigns(api, assigns = {}) {
  const vars = (api.vars || api.snapshot)?.call(api) || {};
  for (const [name, src] of Object.entries(assigns || {})) {
    const alias = name === 'step' ? api.stepAlias?.(src) : null;
    api.set(name, alias ?? compile(src)(vars));
  }
}

// anyBoard()：为真时以前板上的东西也能标、能动（外部的课，需求 R8）；结果里带 page（在第几块板上），页面去提醒学生
export function createBoardTools({ bv, segs, anyBoard = () => false }) {
  const board = bv.board;
  const marks = new Map();
  let markSeq = 0;

  // 元素在当前板上，或者在常驻栏里（常驻栏一直看得到）
  function onCurrent(el) {
    if (el.closest('.class-pins')) return true;
    return Number(el.closest('.class-page')?.dataset.page) === bv.cur;
  }

  // 自己起的、或者以前用过的 m7 这样的 id：自动编号跳过它（撤掉的也算，免得重复）
  function bumpSeq(id) {
    const k = /^m(\d+)$/.exec(id || '');
    if (k) markSeq = Math.max(markSeq, Number(k[1]));
  }

  // 一个 mark 块里可以有好几条：画上的记进 marks，画不上的（目标不对、不在当前板上……）一条条说明原因
  function markOp(op, { animate = true } = {}) {
    const done = [];
    const errs = [];
    const warns = [];
    for (const spec of op.marks || []) {
      const r = placeMark(spec, { animate });
      if (r.ok) done.push({ id: r.id, seg: r.seg, spec: { ...spec, id: undefined }, ...(r.page ? { page: r.page } : {}) });
      else errs.push(`${markWhere(spec)}：${r.error}`);
      if (r.warn) warns.push(`${r.id}：${r.warn}`);
    }
    errs.push(...(op.errors || []));
    const away = done.find((d) => d.page)?.page;
    return { op: 'mark', id: op.target || '', ok: done.length > 0, marks: done, ...(away ? { page: away, away: true } : {}), error: errs.length ? errs.join('；') : undefined, warn: warns.length ? warns.join('；') : undefined };
  }

  // 画一条标注。restore：刷新后重放（不管在不在当前板上）。返回 { ok, id, seg } 或 { ok: false, error }
  function placeMark(spec, { animate = true, restore = false } = {}) {
    const t = spec.target;
    let seg = segs.get(t);
    let host, root, scene = null;
    if (seg) {
      if (seg.hidden) return { ok: false, error: `${t} 已经撤回了` };
      if (seg.pending || seg.failed || !seg.sec?.isConnected) return { ok: false, error: `${t} 没画出来，标不了` };
      host = seg.sec;
      root = seg.sec.querySelector('.stage-body') || seg.sec;
    } else {
      const el = board.querySelector(`.class-seg:not([hidden]) [data-bid="${CSS.escape(t)}"]`);
      if (!el) return { ok: false, error: `黑板上没有 ${t}（target= 写段的 id，比如 b5，或者组件的 id:）` };
      host = el.closest('.class-seg');
      seg = segs.get(host?.dataset.step);
      if (!host || !seg) return { ok: false, error: `${t} 不在黑板的段里` };
      root = el;
      scene = el.dataset.scene ? session.scenes.get(el.dataset.scene)?.api || null : null;
    }
    const away = !onCurrent(host) ? Number(host.closest('.class-page')?.dataset.page) : 0;
    if (!restore && away && !anyBoard()) return { ok: false, error: `${t} 在第 ${away} 块板上，不在当前板上，学生现在看不到` };
    bumpSeq(spec.id);
    const id = spec.id || `m${markSeq + 1}`;
    const prev = marks.get(id);
    // 目标所在的板现在藏着（学生翻回去看旧板、这一轮新开的板还没翻过去）：先不可见地摆出来，
    // 照常找字、查写法——不然写错的 text= / term= / step= 也算标上了（写错要报出来），摆好再藏回去
    const shut = [];
    for (let el = host; el && el !== board.parentElement; el = el.parentElement) if (el.hidden) shut.push(el);
    for (const el of shut) { el.hidden = false; el.style.visibility = 'hidden'; }
    let r;
    try { r = markLayer(host).add(id, spec, { root, scene, name: t, animate: animate && !shut.length }); }
    finally { for (const el of shut) { el.hidden = true; el.style.visibility = ''; } }
    if (!r.ok) return { ok: false, error: r.error };
    if (!spec.id) markSeq++;
    // 同一个 id 换了地方：原来那条擦掉
    if (prev && prev.host !== host) prev.host?._marks?.remove(id);
    marks.set(id, { id, seg: seg.id, spec, host });
    return { ok: true, id, seg: seg.id, ...(away && !restore ? { page: away } : {}), ...(r.warn ? { warn: r.warn } : {}) };
  }

  function unmarkOp(op) {
    const gone = [];
    const miss = [];
    const drop = (id) => {
      const m = marks.get(id);
      if (!m) return false;
      m.host?._marks?.remove(id);
      marks.delete(id);
      gone.push(id);
      return true;
    };
    if (op.all) for (const id of [...marks.keys()]) drop(id);
    for (const id of op.ids || []) if (!drop(id) && !op.all) miss.push(id);
    for (const t of op.targets || []) {
      if (drop(t)) continue; // 不带 key 的词可能是自己起的标注 id
      const hit = [...marks.values()].filter((m) => m.spec.target === t || m.seg === t);
      if (!hit.length && !op.all) miss.push(t);
      hit.forEach((m) => drop(m.id));
    }
    const error = miss.length ? `没有这些标注：${miss.join('、')}（现有的标注列在黑板现状里各段的下面）` : undefined;
    return { op: 'unmark', id: '', ok: !miss.length || gone.length > 0, ids: gone, error };
  }

  // 段被改写、撤回：上面的标注一起擦掉（标注指着的东西已经不在了）
  function dropMarks(segId) {
    for (const [id, m] of marks) {
      if (m.seg !== segId) continue;
      m.host?._marks?.remove(id);
      marks.delete(id);
    }
  }

  // 让图动。animate: false（学生正翻回去看旧板）：play 直接跳到终点，不播放
  function figureOp(op, notes = [], { animate = true } = {}) {
    const args = op.action === 'set' ? { assigns: op.assigns } : op.action === 'play' ? { name: op.name, from: op.from, to: op.to, ms: op.ms } : { index: op.index };
    const base = { op: 'figure', id: op.target, action: op.action, args };
    const all = [...board.querySelectorAll(`.class-seg [data-bid="${CSS.escape(op.target)}"]`)];
    // 撤回的段不算；翻板只是藏起来，不算撤回（下面再看在不在当前板上）
    const el = all.find((e) => e.dataset.scene && !e.closest('.class-seg[hidden]'));
    const sc = el && session.scenes.get(el.dataset.scene);
    if (!sc) {
      const figs = [...board.querySelectorAll('.class-seg:not([hidden]) [data-scene][data-bid]')].filter((e) => onCurrent(e)).map((e) => e.dataset.bid);
      const other = all.find((e) => !e.closest('.class-seg[hidden]'));
      const kind = other && [...other.classList].find((c) => c.startsWith('block-'))?.slice(6);
      const error = other ? `${op.target} 是 ${kind || '组件'}，不是图`
        : all.length ? `${op.target} 所在的段已经撤回了`
          : `黑板上没有 id 为 ${op.target} 的图${figs.length ? `（当前板上的图：${figs.join('、')}）` : ''}`;
      return { ...base, ok: false, error };
    }
    // 在以前的板上：学生现在看不到，动了也白动
    const away = !onCurrent(el) ? Number(el.closest('.class-page')?.dataset.page) : 0;
    if (away && !anyBoard()) return { ...base, ok: false, error: `${op.target} 在第 ${away} 块板上，不在当前板上，学生现在看不到它。要用这张图，就在当前板上重新画一张（换个新 id）` };
    if (away) base.page = away, base.away = true;
    const api = sc.api;
    try {
      if (op.action === 'set') {
        // 演示组件：step=rotate#2 / end 按事件找步号（老师数不出步号）
        applyAssigns(api, op.assigns);
      } else if (op.action === 'play') {
        if (!animate) api.set(op.name, op.to ?? 1);
        else if (api.play) api.play(op.name, op.from ?? 0, op.to ?? 1, op.ms ?? 1200);
        else api.animate?.(op.name, op.from ?? 0, op.to ?? 1, op.ms ?? 1200);
      } else if (op.action === 'highlight') {
        const hit = api.highlight?.(op.index);
        if (hit === false) notes.push(`figure ${op.target} highlight ${op.index}：第 ${op.index} 条命令不画东西（比如 let），没有闪`);
      }
      // 板超出一屏、图不在视野里时滚过去（学生正看着当前板时才动页面）
      if (bv.view === bv.cur) el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
      return { ...base, ok: true, ...(op.action === 'play' && !animate ? { jumped: true } : {}) };
    } catch (e) {
      return { ...base, ok: false, error: e?.message || String(e) };
    }
  }

  // 一张图能用 figure set / play 改的变量（不是图就是 undefined）
  function figureVars(b) {
    const sc = b.dataset.scene && session.scenes.get(b.dataset.scene);
    if (!sc) return undefined;
    let v = {};
    try { v = (sc.api.vars || sc.api.snapshot)?.call(sc.api) || {}; } catch { v = {}; }
    // predict 的 guess 是学生的猜测，不让老师改
    return Object.keys(v).filter((k) => !(b.classList.contains('block-predict') && k === 'guess'));
  }

  // 演示组件的一行概要（一共几步、每种问题在第几步）；函数图、三维图的关卡（目标做到几个、点一点点了哪几个）
  function figureOutline(b) {
    const sc = b.dataset.scene && session.scenes.get(b.dataset.scene);
    let o = '', t = '';
    try { o = sc?.api.outline?.() || ''; } catch { o = ''; }
    try { t = tasksText(sc?.api.tasks?.()); } catch { t = ''; }
    return [o, t].filter(Boolean).join('；') || undefined;
  }

  return {
    marks, onCurrent, bumpSeq, markOp, placeMark, unmarkOp, dropMarks, figureOp, figureVars, figureOutline,
    get nextMark() { return `m${markSeq + 1}`; },
  };
}

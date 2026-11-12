// 照引擎走（主线第四轮，docs/superpowers/specs/2026-11-11-stage-mainline-4-design.md 第 2 节）。纯函数，有测试（tests/stage-follow.test.js）。
//
// 页面不懂任何算法：算法的知识全在黑板那边的引擎里（kit/src/engines/）。老师写一行 follow a sort shell gaps="5 3 1"，
// 页面让引擎把这个算法在这样东西现在的数据上跑一遍，拼出「正确的那条路」（引擎每一步之后这样东西是什么样）和每种常见错法的路，
// 之后拿这样东西现在的样子去对：到了哪个检查点（一趟、一轮）、是不是引擎认得的哪种错法、离下一趟做完差哪几处。
//
// 每类算法只写一份「对应关系」（follows/*.js，registerFollow）：
//   engine            引擎本身（{ parse, run, variants }）
//   types             能接在哪几种东西上；subjects：说明里哪几门课带它；head：follow a sort shell 里不写名字的那个字段
//   title(fields)     给老师看的名字（「希尔排序（增量 5 3 1）」）；unit：'趟' 或 (fields) => '次划分'
//   fields(o, opts, scene) → 引擎的字段（从这样东西现在的样子拼；opts 是老师写的那几项）
//   snap(o, scene)    写 follow 那一刻记下的东西（一排格子：这时候每一格是哪张牌——引擎的编号从这里数起），之后原样交回 stateOf
//   dataOf(o, scene)  这样东西的「数据」写成一串（不管摆成什么样）：变了就是老师（或学生）改了数据，页面从新的样子重跑
//   stateOf(o, scene, snap) → 现在的样子写成能比的一串；cellsOf(o, scene, snap) → 现在每一处显示的字；nameOf(i) → 第 i 处叫什么；word：一处叫「格」还是别的
//   known：引擎认得的字段（head 以外的；写了别的当场报）；label(cell, snap)（可选）一处的字写给人看时换成什么
//   frames(run, spec) → [{ state, cells, mark? }]   引擎的每一步写成同样的一串；mark 是「第几趟做完」（数）
//   drillOpen(fields)（可选）抄进题库自己练的时候开哪种手（课上老师没 open 过时）
//   loose(state)（可选）和错法的样子比的时候两边都先过它（排序的错法只有数、不带撇）
//   toKey(o, fields, scene)（可选）接在表上：引擎的结果直接当表的答案，不走路
//
// 页面当场判得准的是检查点：对（和引擎一样）、还是像哪种错法。检查点之间学生的每一下只说在不在路上、离这一趟差哪几处，不说对错——
// 一趟里先理哪条链、先写哪个顶点，本来就没有唯一的先后。

const FOLLOWS = new Map();

/** 登记一类算法的对应关系 */
export function registerFollow(name, adapter) { FOLLOWS.set(name, adapter); }
export const followOf = (name) => FOLLOWS.get(name) || null;
export const followNames = () => [...FOLLOWS.keys()];

const unitOf = (a, fields) => (typeof a.unit === 'function' ? a.unit(fields || {}) : a.unit || '趟');
const titleOf = (a, name, fields) => (a.title ? a.title(fields || {}) : name);

// —— 路 ——
const CACHE = new Map();
const CACHE_MAX = 60;

/** 一串步 → 路：连着一样的并成一个，检查点的号收在一起（[1] / [2, 3]：第 2、3 趟做完是同一个样子） */
function pathOf(frames) {
  const path = [];
  for (const f of frames || []) {
    const last = path[path.length - 1];
    const marks = f.mark == null ? [] : [].concat(f.mark).map(Number); // 一步可以同时是好几趟的检查点（那几趟没有要动的）
    if (last && last.state === f.state) {
      last.marks.push(...marks);
      // 并掉的那一步引擎自己的那一句接上去（Dijkstra 连着两轮 dist 不变：两轮各确定了谁都要写）
      if (f.lead && !last.lead.includes(f.lead)) last.lead += f.lead;
      continue;
    }
    path.push({ state: f.state, cells: f.cells || [], marks, lead: f.lead || '' });
  }
  return path;
}
const topMark = (path, at) => { let m = 0; for (let i = 0; i <= at; i++) for (const k of path[i].marks) m = Math.max(m, k); return m; };

function build(a, input) {
  const spec = a.engine.parse(input);
  const run = a.engine.run(spec);
  const path = pathOf(a.frames(run, spec));
  if (!path.length) throw new Error('引擎没有交出任何一步');
  const looseOf = (st) => (a.loose ? a.loose(st) : st);
  const onPath = new Set(path.map((p) => looseOf(p.state)));
  const total = topMark(path, path.length - 1);
  const variants = [];
  for (const v of a.engine.variants?.(spec) || []) {
    // 错法跑不了、交不出路的，不认它（不影响正确的那条路）
    try {
      const p = pathOf(a.frames(a.engine.run(v.input), v.input));
      // loose：错法的样子比得松一点（排序的错法只有数、不带撇）
      // 错法的检查点里，样子和正确的路上某一步（松着比）一样的不算：到了那里分不出是对是错，不能说「像这种错法」
      for (const fr of p) { fr.loose = looseOf(fr.state); if (onPath.has(fr.loose)) fr.marks = []; }
      if (p.some((fr) => fr.marks.length)) variants.push({ label: v.label, path: p });
    } catch { /* 这种错法在这份数据上跑不了 */ }
  }
  return { path, total, variants };
}

/** 这样东西照着走的那条路（按引擎的输入缓存）：{ path, total, variants, error } */
export function traceOf(o) {
  const f = o?.follow;
  const a = f && followOf(f.name);
  if (!a) return null;
  if (f.error || !f.input) return { path: [], total: 0, variants: [], error: f.error || '没有数据' };
  const key = `${f.name}\u0000${JSON.stringify(f.input)}`;
  let t = CACHE.get(key);
  if (!t) {
    try { t = build(a, f.input); } catch (err) { t = { path: [], total: 0, variants: [], error: err?.message || String(err) }; }
    if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
    CACHE.set(key, t);
  }
  return t;
}

/** 从这样东西现在的样子（重新）开始：记下起点、让引擎跑。跑不了记在 follow.error 上（不抛：老师改了数据以后可能照不下去） */
function restart(o, scene) {
  const f = o.follow, a = followOf(f.name);
  f.snap = a.snap ? a.snap(o, scene) : null;
  f.data = a.dataOf ? a.dataOf(o, scene) : '';
  f.passed = 0;
  delete f.error;
  delete f.startDone;
  delete f.start;
  delete f.back;
  delete f.held;
  delete f.last;
  try {
    f.input = a.fields(o, f.fields || {}, scene);
    const t = build(a, f.input);
    // 起点：这一刻的样子。引擎的路可能从「第一步做完」才开始（图：一上来牌子都还没写），起点不在路上也不算走偏
    f.start = a.stateOf(o, scene, f.snap);
    const at0 = t.path.findIndex((p) => p.state === f.start);
    f.passed = at0 >= 0 ? topMark(t.path, at0) : 0;
    if (at0 === t.path.length - 1) f.startDone = true;
  } catch (err) {
    f.input = null;
    f.error = err?.message || String(err);
  }
}

/** follow a sort shell …：开始照着走。引擎不收（字段写错、数据不对）抛引擎自己的那句话 */
export function startFollow(o, name, fields, scene) {
  o.follow = { name, fields: { ...fields } };
  restart(o, scene);
  if (o.follow.error) { const msg = o.follow.error; delete o.follow; throw new Error(msg); }
}

/** 学生把照着走的数改写了（同时开着 edit）：引擎照的是原来那一份，不重跑（重跑的话写成有序的就成了「走完了」） */
const REWRITTEN = '学生把数改写了，引擎照的是原来的那一份：要接着照就重新写 follow';
/**
 * 每一行之后（scene.js）：数据变了——老师改的（write、同名重造）从新的样子重跑；学生改的不重跑，记「照不下去了」，
 * 学生自己改回原样（写回去、撤一步）就接着照。在路上就把「过了几个检查点」记下来
 */
export function refreshFollow(o, scene, { student = false } = {}) {
  const f = o?.follow, a = f && followOf(f.name);
  if (!a) return;
  if (f.back != null) {
    // 学生改写过：改回了改写以前的样子就接着照；老师动了数据照老办法重跑
    if (a.stateOf(o, scene, f.snap) === f.back) { delete f.error; delete f.back; } else if (!student && a.dataOf(o, scene) !== f.held) { delete f.back; restart(o, scene); return; } else { f.held = a.dataOf(o, scene); return; }
  } else if (a.dataOf && a.dataOf(o, scene) !== f.data) {
    if (student && f.input && !f.error) { f.error = REWRITTEN; f.back = f.last ?? f.start; f.held = a.dataOf(o, scene); return; }
    restart(o, scene);
    f.last = f.start;
    return;
  }
  const w = whereOf(o, scene);
  if (w && w.at != null) f.passed = w.passed;
  if (w && !w.error) f.last = a.stateOf(o, scene, f.snap);
}

/**
 * 现在在哪：{ at（正确的路上第几个；还在起点、起点不在路上是 -1；不在路上是 null）, passed（过了几个检查点）, total, done, like（像哪种错法）, likeMark, off（不在正确的路上）,
 *   next（下一个检查点 { mark, upto, cells }；没有是 null）, error }
 */
export function whereOf(o, scene) {
  const f = o?.follow, a = f && followOf(f.name);
  if (!a) return null;
  const t = traceOf(o);
  if (t.error) return { at: null, passed: 0, total: 0, done: false, like: null, likeMark: null, off: true, next: null, error: t.error };
  const state = a.stateOf(o, scene, f.snap);
  let at = -1;
  for (let i = t.path.length - 1; i >= 0; i--) if (t.path[i].state === state) { at = i; break; }
  const nextAfter = (passed) => {
    const fr = t.path.find((p) => p.marks.some((k) => k > passed));
    if (!fr) return null;
    const ks = fr.marks.filter((k) => k > passed);
    return { mark: Math.min(...ks), upto: Math.max(...ks), cells: fr.cells, lead: fr.lead || '' };
  };
  if (at >= 0) {
    const passed = topMark(t.path, at);
    // mid：不在检查点上（一趟做到一半）。现状里多说一句离下一趟做完差哪几处
    return { at, passed, total: t.total, done: at === t.path.length - 1, like: null, likeMark: null, off: false, mid: !t.path[at].marks.length && at > 0, next: nextAfter(passed), error: null };
  }
  // 还在起点（at: -1）：在路上，只是一步还没走
  if (state === f.start) return { at: -1, passed: 0, total: t.total, done: false, like: null, likeMark: null, off: false, next: nextAfter(0), error: null };
  let like = null, likeMark = null;
  const loose = a.loose ? a.loose(state) : state;
  for (const v of t.variants) {
    const fr = v.path.find((p) => p.marks.length && p.loose === loose);
    if (fr) { like = v.label; likeMark = Math.min(...fr.marks); break; }
  }
  const passed = f.passed || 0;
  return { at: null, passed, total: t.total, done: false, like, likeMark, off: true, mid: true, next: nextAfter(passed), error: null };
}

// —— 写给老师的话 ——
/** 一个检查点该是什么样，写给老师看（对应关系可以自己排：图写成 1=0（确定） 2=10） */
const labelOf = (a, f, cell) => (a.label ? a.label(cell, f.snap) : cell); // 一处的字写给人看（排序：引擎的 5 写成牌上的 05）
const wordOf = (a, f) => (typeof a.word === 'function' ? a.word(f.fields || {}) : a.word || '处');
const shown = (a, f, nx) => `${nx.lead || ''}${a.show ? a.show(nx.cells, f.snap, f.fields || {}) : nx.cells.map((c) => labelOf(a, f, c)).join(' ')}`; // lead：这一步引擎自己的一句（Dijkstra：确定 5；）
const nth = (a, f, k, upto = k) => `第 ${k} ${unitOf(a, f.fields)}${upto > k ? `（第 ${k + 1}${upto > k + 1 ? `～${upto}` : ''} ${unitOf(a, f.fields)}没有要动的，做完是同一个样子）` : ''}`;

/** 离下一个检查点差哪几处：[{ i, now, want }] */
function gaps(a, o, scene, next) {
  const now = a.cellsOf ? a.cellsOf(o, scene, o.follow.snap) : [];
  const out = [];
  const n = Math.max(now.length, next.cells.length);
  for (let i = 0; i < n; i++) if (String(now[i] ?? '') !== String(next.cells[i] ?? '')) out.push({ i, now: now[i] ?? '', want: next.cells[i] ?? '' });
  return { list: out, n };
}
function gapText(a, o, scene, w, { brief = false } = {}) {
  if (!w.next) return '';
  const f = o.follow, u = unitOf(a, f.fields);
  const g = gaps(a, o, scene, w.next);
  const head = `第 ${w.next.mark} ${u}做完`;
  const word = wordOf(a, f); // 一排格子说「格」，Dijkstra 说「个顶点」
  if (brief) return `离${head}差 ${g.list.length} ${word}`;
  // 差得多（超过一半）只说差几处：一条条列出来老师也不会看
  if (!g.list.length || g.list.length * 2 > g.n) return `离${head}差 ${g.list.length} ${word}`;
  const name = (i) => (a.nameOf ? a.nameOf(i, f.snap) : `第 ${i + 1} 处`);
  return `和${head}该有的样子差 ${g.list.length} ${word}：${g.list.map((x) => `${name(x.i)}（现在 ${x.now === '' ? '空着' : labelOf(a, f, x.now)}，该是 ${labelOf(a, f, x.want)}）`).join('、')}`;
}

/** 照什么走、一步叫什么（自己练的组件写题面用） */
export function followInfo(o) {
  const f = o?.follow, a = f && followOf(f.name);
  return a ? { title: titleOf(a, f.name, f.fields), unit: unitOf(a, f.fields) } : null;
}
/** 下一个检查点该是什么样，写给人看（自己练的「看这一趟该是什么样」） */
export function nextText(o, scene) {
  const f = o?.follow, a = f && followOf(f.name);
  const w = a && whereOf(o, scene);
  return w?.next ? `${nth(a, f, w.next.mark, w.next.upto)}做完该是：${shown(a, f, w.next)}` : '';
}

/** 还没做的每一个检查点该是什么样（自己练点「做不出来」以后给学生看完整的答案）；都做完了是空的 */
export function restText(o, scene) {
  const f = o?.follow, a = f && followOf(f.name);
  const w = a && whereOf(o, scene);
  if (!w || w.error || w.done) return '';
  const out = [];
  let passed = w.passed;
  for (const fr of traceOf(o).path) {
    const ks = fr.marks.filter((k) => k > passed);
    if (!ks.length) continue;
    out.push(`${nth(a, f, Math.min(...ks), Math.max(...ks))}做完该是：${shown(a, f, { cells: fr.cells, lead: fr.lead || '' })}`);
    passed = Math.max(...ks);
  }
  return out.join('；');
}

const GONE = '走完以后又动了，现在不是做完的样子';

/** 舞台现状里的那一行（没在照着走是 null） */
export function followLine(o, scene) {
  const f = o?.follow, a = f && followOf(f.name);
  if (!a) return null;
  const head = `${o.id} 照 ${titleOf(a, f.name, f.fields)} 走：`;
  const w = whereOf(o, scene);
  const u = unitOf(a, f.fields);
  if (w.error) return `${head}照不下去了（${w.error}）`;
  if (f.startDone && w.done) return `${head}一上来就已经是做完的样子`;
  if (w.done) return `${head}${w.total} ${u}都做完了`;
  const want = w.next ? `${nth(a, f, w.next.mark, w.next.upto)}做完该是：${shown(a, f, w.next)}` : '';
  if (w.like) return `${head}${w.like}（和这种错法做完第 ${w.likeMark} ${u}的样子一样）${want ? `。${want}` : ''}`;
  if (w.off && !w.next) return `${head}${GONE}`;
  // 一趟做到一半：只说离这一趟做完差哪几处。不说「在不在引擎走的那条路上」——引擎一组、一趟只留一步，
  // 学生一张一张插、先理哪一组都是对的做法，说「不在路上」是假话（主线第五轮首课走查）
  const at = w.passed ? `做完了第 ${w.passed} ${u}` : `还没做完第 ${w.next?.mark ?? 1} ${u}`;
  const gap = w.mid && w.next ? `；${gapText(a, o, scene, w)}` : '';
  return `${head}${at}（共 ${w.total} ${u}）${gap}${want ? `。${want}` : ''}`;
}

// —— 盖在那种东西自己的规则上面 ——
const WRAPPED = new WeakMap();

/** 照着走的东西的规则：下一步、判一下、事实、做完、量、判断式照引擎的路，手势和别的量照旧用它自己的（base） */
export function followRules(base, o) {
  const f = o.follow;
  const hit = WRAPPED.get(base);
  if (hit && hit.name === f.name) return hit.rules;
  const a = followOf(f.name);
  if (!a) return base;
  // 这样东西上学生能做的几种动作；老写法的 open a / open h（drag：拖着换）也算——堆就是拖着结点换值，
  // 不算的话 @h.right 写不进去、走完了也不叫老师（主线第五轮）
  const acts = [...new Set([...Object.keys(base.gestures || {}), 'drag'])];
  // 这一行是这样东西自己的指令，可它自己的规则不判（老写法 open a、不过裁判的指令）：照着走时也要看这一下以后到了哪
  const hidden = (act, key, value) => Object.defineProperty(act, key, { value, enumerable: false });
  const rules = {
    ...base,
    hasNext: true,
    reopen: null,
    judges: acts,
    doneBy: acts,
    actOf(obj, c, h, ctx) {
      let act = base.actOf(obj, c, h, ctx);
      if (!act) { act = { type: c.cmd }; hidden(act, 'made', true); }
      hidden(act, 'line', c);
      return act;
    },
    next(obj, scene) {
      const w = whereOf(obj, scene);
      if (!w || w.error) return { acts: [], why: `照不下去了（${w?.error || ''}）` };
      if (w.done) return null;
      // acts：页面不知道具体哪一下，只知道还没做完——交「这样东西上能做的几种动作」，学生开着其中一种就算手上还有事（events.js 的 hasWork）
      return { acts: acts.map((type) => ({ type })), why: w.next ? `${nth(a, obj.follow, w.next.mark, w.next.upto)}做完该是：${shown(a, obj.follow, w.next)}` : '' };
    },
    check(obj, act, scene, ctx = {}) {
      const mine = act.made ? { legal: true } : base.check(obj, act, scene, ctx) || {};
      const out = { legal: mine.legal !== false, right: null, misread: null, why: mine.why ?? null, next: null };
      if (!out.legal || ctx.by !== 'student') return { ...mine, right: mine.legal === false ? mine.right ?? null : null };
      const w0 = whereOf(obj, scene);
      if (!w0 || w0.error || !act.line) return out;
      // 先在场景的副本上把这一行演一遍，看演完到了哪（judged: null：副本里不再过裁判）
      const s2 = scene.clone();
      try { s2.apply({ ...act.line, lenient: true }, { by: 'student', open: ctx.open || null, judged: null }); } catch { return out; }
      const o2 = s2.objects.get(obj.id);
      const w1 = o2 && whereOf(o2, s2);
      if (!w1 || w1.error) return out;
      const was = w0.at != null ? w0.passed : obj.follow.passed || 0;
      // 只在到了检查点时说对（@a.right 也是这时候演）：一趟中间正好走在引擎的路上的那几下不判，只在事实里说一声
      if (w1.at != null && w1.passed > was) {
        out.right = true;
        // 到了一趟、还没走完：这一下要老师接（学生照老师说的做完了这一趟，接下来隔几个、看什么是老师的事）。走完了走 done 的老规矩。
        // 老师写了 follow … call=done 就不叫（学生自己一口气走完）
        if (!w1.done && obj.follow.call !== 'done') out.call = 'now';
      }
      // 引擎的错法自己以「像是」开头，叫老师的那一句前面还会加一个「像是」（events.js）：这里去掉
      else if (w1.like && w1.like !== w0.like) { out.right = false; out.misread = w1.like.replace(/^像是/, ''); }
      if (w1.next) out.next = `${nth(a, obj.follow, w1.next.mark, w1.next.upto)}做完该是：${shown(a, obj.follow, w1.next)}`;
      return out;
    },
    facts(before, after, act, scene) {
      let mine = [];
      if (!act?.made) mine = base.facts(before, after, act, scene) || [];
      const w = whereOf(after, scene);
      if (!w || w.error || !before?.follow) return mine;
      const wb = whereOf(before, scene);
      const was = wb && wb.at != null ? wb.passed : before.follow.passed || 0;
      const u = unitOf(a, after.follow.fields);
      if (w.at != null && w.passed > was) return [...mine, `到了第 ${w.passed} ${u}做完的样子（和引擎算的一样）`];
      if (w.like) return [...mine, `${w.like}（和这种错法做完第 ${w.likeMark} ${u}的样子一样）`];
      if (w.off && !w.next) return [...mine, GONE];
      // 一趟中间的一下：只说离这一趟做完差哪几处（不说在不在引擎的路上，见 followLine）
      if (w.next && (w.off || !wb || w.at !== wb.at)) return [...mine, gapText(a, after, scene, w)].filter(Boolean);
      return mine;
    },
    measures: {
      ...base.measures,
      pass: Object.assign((obj, parts, scene) => whereOf(obj, scene)?.passed ?? null, { listed: () => false }),
    },
    predicates: {
      ...base.predicates,
      pass: (obj, args, scene) => { const w = whereOf(obj, scene); return w && !w.error ? w.passed >= Number(args[0]) : null; },
      done: (obj, args, scene) => { const w = whereOf(obj, scene); return w && !w.error ? w.done : null; },
      onpath: (obj, args, scene) => { const w = whereOf(obj, scene); return w && !w.error ? w.at != null : null; },
    },
  };
  WRAPPED.set(base, { name: f.name, rules });
  return rules;
}

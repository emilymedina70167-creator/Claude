// 活的舞台上学生做的事（docs/stage-plan.md E 段）：哪些要马上叫老师、哪些攒着；攒下来的怎么写给老师看。纯函数，有测试（tests/stage-events.test.js）。
//
// 学生在舞台上随时能动（拨格子、拖、点开看怎么算），这些是「试」：一下一下都告诉老师太碎、也太慢（每叫一次老师就是一整轮），
// 所以攒着，等到有要老师接的事——答了老师问的、做到了挑战、打字、点「给个提示」、试了好多下还没做到、很久没动——
// 一起写成一段发过去。老师照它看学生是怎么试的、卡在哪，再当场写下一步。
import { lookText } from './scenes.js';
import { actText, pathKey, pathEnd, pathGoesOn, hiddenText } from './stage.js';
import { rulesOf } from './rules.js';
import { shapeText } from './goal.js';

/** 试了几下还没做到就叫老师（不等学生自己点提示） */
export const TRY_MAX = 8;
/** 挑战还没做到、学生多久没动就叫老师（毫秒） */
export const QUIET_MS = 45000;
/**
 * 发给老师的 [学生] 一块最多多少字节（UTF-8，连那一行标题）：学生在老师想的时候试了好多下，按要紧程度压（capTries），不整段发过去。
 * 2 KB 压掉的正是老师要的那几下（错法），提到 3 KB（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 4 节）
 */
export const STUDENT_MAX = 3072;
const HEAD = '[学生]\n';
const enc = typeof TextEncoder === 'function' ? new TextEncoder() : null;
const bytesOf = (t) => (enc ? enc.encode(String(t)).length : String(t).length);
const text = (x) => (typeof x === 'string' ? x : x?.why || '');

/**
 * 一件事要不要马上叫老师。做到挑战（做完了交给学生的东西）时老师预写的行又给了学生下一件事（新的一问、新的挑战）：这件事 quiet，
 * 先不叫（叫了老师的新一轮会盖掉学生正在做的），跟着学生下一次要老师接的事一起发。
 * 试的一下本来攒着；老师在 open 那一行写了 call=wrong、学生这一下走偏了（now）：马上叫
 */
export const triggers = (e) => !e.quiet && (!!e.now || ['answer', 'goal', 'done', 'help', 'stuck', 'tries', 'askfail', 'handfail'].includes(e.kind));

/**
 * 老师这一轮交给学生的手（open）没演上、学生手上没东西可动：要马上叫老师重写（主线第七轮）。
 * errors 是这一轮没演上的行（kept 的照演了，不算）；演完以后学生开着的手只剩「回到…」按钮或者一个都没有，
 * 手上也没有一问可答（等着的只是「接着 / 就这样」这种按钮，或者什么都没等）。老师写了 open 就是要交给学生一只手，不猜话的意思
 */
export function handMissed(errors, scene) {
  const missed = (errors || []).some((e) => !e.kept && /^\s*&?\s*open\b/.test(String(e.src || '')));
  if (!missed) return false;
  if ([...scene.opens.values()].some((x) => x.action !== 'back')) return false;
  const w = scene.waiting;
  return !w || w.kind === 'next';
}

/**
 * 学生手上还有什么事（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 6.2）：做到挑战、做完、答对一问以后，有事就攒着，
 * 没事了才叫老师。空的就是没事了。有事是：
 *   - 还挂着要学生答的一问（tap / pick / drag / value / say）；ask next（连「给个提示」）不算：点它就是叫老师
 *     （预写刚挂出来的 ask next 是学生要按的那一下，算不算由课堂循环看它是不是刚挂的：loop.js 的 settle）；
 *   - 还没做到的挑战——学生手上动得了东西才算（开着、看得见的东西，或者拨数；按了按钮才判的挑战，那个按钮挂着也算）：
 *     什么都动不了的挑战学生做不到，攒着就是让学生干等；
 *   - 交给了学生（open 了规则 doneBy 里的动作）、还没做完的东西——规则算得出下一步、下一步学生做得了才算（页面判不了的，
 *     比如没写 key 的句子，永远等不到它做完；平衡了、托盘还有数，可只开了 rotate，插不进去），不能拿它挡着不叫老师
 */
export function hasWork(scene) {
  const out = [];
  const w = scene?.waiting;
  if (w && w.kind !== 'next') out.push(`还有一问没答（ask ${w.kind}）`);
  const moves = canMove(scene);
  // watch（只叫老师的条件）学生不知道有它：不算学生手上的事
  for (const g of scene?.goals?.values() || []) if (!g.met && !g.watch && (moves || (g.on && w?.kind === 'next' && (w.button || '接着') === g.on))) out.push(`挑战 ${g.id}「${g.text}」还没做到`);
  const undone = undoneOf(scene);
  if (undone.length) out.push(`${undone.join('、')} 还没做完`);
  return out;
}
/** 学生手上有没有动得了的：开着的、看得见的东西（按「回到……」也算），或者拨数 */
function canMove(scene) {
  for (const e of scene?.opens?.values() || []) if (scene.objects?.get(e.obj) && !scene.objects.get(e.obj).hidden) return true;
  for (const v of scene?.vars?.values() || []) if (v?.shown !== false) return true;
  return false;
}
/**
 * 交给了学生、规则算得出下一步、下一步学生做得了、还没做完的东西（hasWork 的第三种；课堂循环拿它兜底「很久没动」）。
 * 做得了：东西看得见，下一步的动作学生开着（手势表里 makes 写了它交的是哪种动作的照它：树的 place 拖到空位上交的是 insert）
 */
export function undoneOf(scene) {
  const undone = [];
  for (const e of scene?.opens?.values() || []) {
    if (undone.includes(e.obj)) continue;
    // 交给学生用键盘填的空格子还没填满：学生做得了（键盘开着、看得见）；开着 rowop 的矩阵也是（还空着就不是做完了：最后一审 M3）
    if (scene.fillOpen?.(e.obj) && scene.blankLeft(e.obj)) { if (!scene.objects.get(e.obj).hidden) undone.push(e.obj); continue; }
    if (!scene.doneOpen?.(e.obj) && scene.fillOpen?.(e.obj)) continue;
    if (!scene.doneOpen?.(e.obj)) continue;
    const o = scene.objects.get(e.obj);
    const r = rulesOf(o);
    if (!r?.hasNext || o.hidden) continue;
    let nx = null;
    try { nx = r.next(o, scene); } catch { nx = null; }
    if (!nx?.acts?.length) continue;
    // makes 可以是好几种（一排格子的拖交 swap / move）：摊开了比，再加上动作自己的名字（照引擎走的东西 next 交的是动作名）
    const can = new Set([...scene.opens.values()].filter((x) => x.obj === e.obj).flatMap((x) => [x.action, ...[].concat(r.gestures?.[x.action]?.makes || [])]));
    if (nx.acts.some((a) => can.has(a.type))) undone.push(e.obj);
  }
  return undone;
}
/** 攒着的那一件事后面接的半句：那时学生手上还有什么事、没叫老师 */
const heldText = (e) => (e?.held?.length ? `；那时 ${e.held.join('，')}，没叫你` : '');
/**
 * 收集型挑战收齐了：学生收齐了 g1 的 3 张：B = (1 0; 0 1)、(2 1; 0 2)、(0 1; 0 0)（另有 2 下和收过的一样，没收）。
 * c 是挑战上的 collect（got 是 measure），或者课堂循环记下的那一刻的样子（got 已经是字）
 */
export function collectText(id, c) {
  const got = (c.got || []).map((m) => (typeof m === 'string' ? m : shapeText(m)));
  return `学生收齐了 ${id} 的 ${got.length} 张：${c.obj} = ${got.join('、')}${c.dup ? `（另有 ${c.dup} 下和收过的一样，没收）` : ''}`;
}

/**
 * 一个动作 → 一件事：{ kind: 'answer' | 'help' | 'try' | 'goal' | 'done' | 'stuck' | 'tries', act?, text?, at }
 * （另有页面记下的一句 { kind: 'note', text }：loop.js 收 stage.onNote，不叫老师、不算「试」）。
 * 试的一下：裁判说马上叫老师（act.call === 'now'）记 now；老师写了 call=done（做完才叫）的东西上试的记 patient，不算进「试了好多下」
 */
export function eventOf(act, { help = '', at = 0 } = {}) {
  // 学生翻回去看了一幕（主线第六轮 3.5）：事实，跟着下一条告诉老师，不叫老师（不在 triggers 里）
  if (act.type === 'look') return { kind: 'look', act: slim(act), at };
  if (act.type === 'next' && help && act.button === help) return { kind: 'help', act: slim(act), at };
  // 撤一步、按「回到……」也是「试」（攒着写给老师），可不算进「试了好多下」：撤几下、回去几次不该凑出叫老师
  if (act.open || act.type === 'dial') return { kind: 'try', act: slim(act), at, ...(act.call === 'now' || act.verdict?.call === 'now' ? { now: true } : {}), ...(act.patient || act.type === 'undo' || act.type === 'back' ? { patient: true } : {}) };
  return { kind: 'answer', act: slim(act), at };
}

/**
 * 裁判的结论拆成三截：pre（对不对、像哪种错）、next（「；正确的是…」）、how（没让做 / 圈了一下）。
 * 压的时候「正确的是」只留在每样东西的最后一下（之前那几下的「正确的是」说的是那时候的样子，学生已经接着动了），结论一直留着
 */
function verdictParts(a) {
  const none = { pre: '', next: '', how: '' };
  const v = a?.verdict;
  if (!v || a.error) return none; // 没演上的一下（actText 已经说了）不接裁判的结论
  if (a.failed) return { ...none, pre: '——页面这一下没判成（照做了）' };
  if (v.legal === false) return { ...none, pre: `——做不到：${v.why || '这一下做不到'}（没演，弹回去了）` };
  if (v.right === true) return { ...none, pre: '——是正确的下一步' };
  if (v.right !== false) return none;
  const nx = text(v.next);
  return {
    pre: `——不是正确的下一步${v.misread ? `，像是${v.misread}` : ''}`,
    next: nx ? `；正确的是${nx}` : '',
    how: a.blocked ? '；照你写的 wrong=block 没让做，弹回去了' : a.marked ? '；照做了，画面上那一处淡淡圈了一下（wrong=mark）' : '',
  };
}

/**
 * 裁判的结论（stage.js 挂在动作上的 act.verdict）写成跟在这一下后面的半句：对不对、像哪种错、正确的是什么、没让做 / 圈了一下。
 * 不判的（right 是 null）、没过裁判的是空的
 */
export function verdictText(a) {
  const p = verdictParts(a);
  return `${p.pre}${p.next}${p.how}`;
}
/** 存得下的样子（不带 tries 里的大东西） */
export const slim = (a) => JSON.parse(JSON.stringify({ ...a, tries: a.tries?.map((t) => ({ type: t.type, name: t.name, path: t.path })) }));

const minus = (v) => String(v).replace(/^-/, '−');
const SYM = (ok) => (ok === true ? '✓' : ok === false ? '✗' : '?');
const objOf = (w) => String(w ?? '').match(/^[A-Za-z_]\w*/)?.[0] || null;
/** 这一下在哪样东西上（每样东西只有最后一下留「正确的是」和事实）、动了哪几个部件（错法并成 ×N 时括号里写它） */
function whereOf(a) {
  if (a.type === 'dial') return { obj: `dial:${a.name}`, refs: String(a.name) };
  if (a.type === 'edit' && a.ref) return { obj: objOf(a.ref), refs: a.ref };
  const words = String(a.src || a.line || '').trim().split(/\s+/).filter(Boolean).slice(1);
  const parts = words.filter((w) => /^[A-Za-z_]\w*[.#]/.test(w));
  return { obj: objOf(parts[0] || words[0] || a.ref), refs: parts.length ? parts.join(' ') : words.length ? words.join(' ') : a.ref || '' };
}
/**
 * 一条路写成一行：学生拨了 B.2,2：−1 → 0 → 1 → 2（停在 …；拨到 2 时做到了 g1；Dd = O：✗ ✗ ✗ ✓）。
 * 括号里：停在哪（拨数才有）、拨到哪做到了哪个挑战、挑战每一句在每一个停下的值上成不成立（第一下的 marks0 是拨之前，每一下的 marks 是拨完）。
 * 最后一下的事实（from= 的「M1 第 2 行变了…」）接在后面；前几下的事实说的是拨到一半的样子，不写
 */
function pathRow(p) {
  const a0 = p.moves[0];
  const dial = a0.type === 'dial';
  const to = (m) => (dial ? m.value : m.to);
  const start = dial ? a0.from : a0.from === '' ? '空' : a0.from;
  const vals = [...(start == null ? [] : [start]), ...p.moves.map(to)];
  const bits = [];
  if (dial) bits.push(`停在 ${minus(vals.at(-1))}`);
  for (const m of p.moves) for (const id of m.met || []) bits.push(`拨到 ${minus(to(m))} 时做到了 ${id}`);
  const m0 = Array.isArray(a0.marks0) ? a0.marks0 : [];
  const multi = new Set(m0.map((x) => x.goal)).size > 1;
  for (const c of m0) {
    const same = (x) => x.goal === c.goal && x.clause === c.clause;
    // 一个停下的值一个符号：没写从几拨起（旧的拨数事件没有 from）就没有「拨之前」那个值，拨之前的符号也不写（不然整串错开一格）
    const seq = [...(start == null ? [] : [c.ok]), ...p.moves.map((m) => (m.marks || []).find(same)?.ok ?? null)];
    bits.push(`${multi ? `${c.goal} ` : ''}${c.clause}：${seq.map(SYM).join(' ')}`);
  }
  const head = `学生拨了 ${dial ? a0.name : a0.ref}：${vals.map(minus).join(' → ')}${bits.length ? `（${bits.join('；')}）` : ''}`;
  // 学生先点的几样（ask pick）以后第一次变的那一句只说一次：落在路的前几下也留着，不跟着前几下的事实去掉
  const once = p.moves.slice(0, -1).map((m) => m.pickDiff).filter(Boolean);
  const facts = [...once, ...(p.moves.at(-1).facts || [])].filter(Boolean);
  const tail = facts.length ? `。${facts.join('；')}` : '';
  return { ...p, full: head + tail, short: head, tail, n: p.moves.length };
}

/**
 * 轮流拨的几条路并成一条（第三次量 L1 第 3、4 幕：B 的四格各一行、t 和 s 各一行，哪一停时别的格是几拼不出来）：
 * 同一张矩阵的几格、几个拨数，一条路还没拨完另一条就插进来了（先后交错），这几条按先后并成一行（kind 'multi'，
 * 一段一段写，multiRow）；一格拨完再拨另一格的照旧一格一行（以前的样子）。并成的那一行占最早那一条的位置
 */
function interleaved(rows) {
  const group = (p) => (p.moves[0].type === 'dial' ? 'dial' : `edit:${objOf(p.moves[0].ref)}`);
  const byGroup = new Map();
  for (const r of rows) if (r.kind === 'path') { const g = group(r); if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(r); }
  const merged = new Map(); // 并进去的那一条 → 并成的那一行（最早的那一条换成它，别的拿掉）
  for (const list of byGroup.values()) {
    let comp = null;
    const close = () => { if (comp?.parts.length > 1) { const m = { kind: 'multi', parts: comp.parts }; for (const p of comp.parts) merged.set(p, m); } };
    // 按第一下的先后扫：这一条的第一下在前面几条的最后一下之前，就是交错着拨的
    for (const p of [...list].sort((a, b) => a.at[0] - b.at[0])) {
      if (comp && p.at[0] < comp.end) { comp.parts.push(p); comp.end = Math.max(comp.end, p.last); continue; }
      close();
      comp = { parts: [p], end: p.last };
    }
    close();
  }
  if (!merged.size) return rows;
  const out = [];
  for (const r of rows) {
    const m = merged.get(r);
    if (!m) out.push(r);
    else if (!out.includes(m)) out.push(m); // 第一次碰到的那一条（最早开始的）就是并成的那一行的位置
  }
  return out;
}
/**
 * 并成的一行：学生拨了 B 的几格：B.1,1 1 → 2 → 3，B.1,2 0 → 1，B.1,1 3 → 2（拨到 B.1,1 = 2 时做到了 g1；Df = O：✗ ✗ ✗ ✗ ✓）。
 * 一段是同一条路上连着的几下；✓ ✗ 照先后一停一个（第一下之前一个）；拨数写「停在 t = 1、s = 0」。事实照 pathRow：最后一下的
 */
function multiRow(r) {
  const all = r.parts.flatMap((p) => p.moves.map((m, j) => ({ m, p, i: p.at[j] }))).sort((a, b) => a.i - b.i);
  const dial = all[0].m.type === 'dial';
  const name = (m) => (dial ? m.name : m.ref);
  const to = (m) => (dial ? m.value : m.to);
  const from = (m) => (dial ? m.from : m.from === '' ? '空' : m.from);
  const segs = [];
  for (const x of all) {
    const last = segs.at(-1);
    if (last && last.p === x.p) { last.vals.push(to(x.m)); continue; }
    const f = from(x.m);
    segs.push({ p: x.p, name: name(x.m), vals: [...(f == null ? [] : [f]), to(x.m)] });
  }
  const names = [...new Set(all.map((x) => name(x.m)))];
  const bits = [];
  if (dial) bits.push(`停在 ${names.map((n) => `${n} = ${minus(to(all.filter((x) => name(x.m) === n).at(-1).m))}`).join('、')}`);
  for (const { m } of all) for (const id of m.met || []) bits.push(`拨到 ${name(m)} = ${minus(to(m))} 时做到了 ${id}`);
  const a0 = all[0].m;
  const m0 = Array.isArray(a0.marks0) ? a0.marks0 : [];
  const multi = new Set(m0.map((x) => x.goal)).size > 1;
  for (const c of m0) {
    const same = (x) => x.goal === c.goal && x.clause === c.clause;
    const seq = [...(from(a0) == null ? [] : [c.ok]), ...all.map(({ m }) => (m.marks || []).find(same)?.ok ?? null)];
    bits.push(`${multi ? `${c.goal} ` : ''}${c.clause}：${seq.map(SYM).join(' ')}`);
  }
  const head = `学生拨了 ${dial ? names.join('、') : `${objOf(a0.ref)} 的几格`}：${segs.map((g) => `${g.name} ${g.vals.map(minus).join(' → ')}`).join('，')}${bits.length ? `（${bits.join('；')}）` : ''}`;
  const once = all.slice(0, -1).map((x) => x.m.pickDiff).filter(Boolean);
  const facts = [...once, ...(all.at(-1).m.facts || [])].filter(Boolean);
  const tail = facts.length ? `。${facts.join('；')}` : '';
  const obj = dial ? `dial:${names.join('、')}` : objOf(a0.ref);
  return { kind: 'path', obj, refs: names.join(' '), src: '', right: 0, wrong: 0, misread: null, moves: all.map((x) => x.m), last: all.at(-1).i, full: head + tail, short: head, tail, n: all.length };
}

/**
 * 试的几下 → 一行一行（每一行 { full 原样, short 去掉「正确的是」和事实, tail 去掉的那一截, obj, refs, src, n 是几下,
 * right / wrong 其中判对、判错几下, misread 像哪种错, last 最后一下是第几件 }）：同一格、同一个拨数连着拨的几下并成一条路；
 * 点开看的几格并成一句；过了裁判的一下后面跟结论和这一下以后的事实
 */
function tryLines(tries) {
  const rows = [];
  const paths = new Map();
  let explain = null;
  tries.forEach((e, i) => {
    const a = e.act || {};
    const key = pathKey(a);
    if (key) {
      let p = paths.get(key);
      // 中间这个数、这一格被别的动过（判了对错的那一下、行变换……）：从几拨起对不上就另起一条，不然路上的数是假的
      // （舞台那边照同一条规矩另起，新的一条路开头那一下带着 marks0，✓ ✗ 照样写得出：stage.js 的 studentDo）
      if (p && !pathGoesOn(pathEnd(p.moves.at(-1)), a)) p = null;
      if (!p) { p = { kind: 'path', moves: [], at: [], ...whereOf(a), src: '', right: 0, wrong: 0, misread: null }; paths.set(key, p); rows.push(p); }
      p.moves.push(a);
      p.at.push(i);
      p.last = i;
      return;
    }
    if (a.type === 'explain') {
      if (!explain) { explain = { kind: 'explain', refs: [], hidden: [], n: 0, obj: null, tail: '', right: 0, wrong: 0, misread: null, first: i }; rows.push(explain); }
      explain.n++;
      explain.last = i;
      if (!explain.refs.includes(a.ref)) explain.refs.push(a.ref);
      for (const h of a.hidden || []) if (!explain.hidden.some((x) => x.ref === h.ref)) explain.hidden.push(h);
      return;
    }
    // 不并进路的拨数（页面判了对错的、没演上的）：actText 不写拨数，照拨格子的样子写一句
    const main = actText(a) || (a.type === 'dial' ? `学生把 ${a.name} 从 ${minus(a.from ?? '?')} 拨到 ${minus(a.value)}` : '');
    if (!main) return;
    const v = verdictParts(a);
    const facts = (a.facts || []).filter(Boolean);
    const judged = !a.error && !a.failed && a.verdict;
    rows.push({
      kind: 'one', ...whereOf(a), src: a.src || a.line || main, last: i, first: i, n: 1,
      full: `${main}${v.pre}${v.next}${v.how}${facts.length ? `。${facts.join('；')}` : ''}`,
      short: `${main}${v.pre}${v.how}`,
      tail: `${v.next}${facts.length ? `。${facts.join('；')}` : ''}`,
      right: judged && a.verdict.legal !== false && a.verdict.right === true ? 1 : 0,
      wrong: judged && a.verdict.right === false ? 1 : 0,
      misread: judged && a.verdict.legal !== false && a.verdict.right === false ? a.verdict.misread || null : null,
      how: v.how, // 照老师写的 wrong=block 没让做 / wrong=mark 圈了一下：和错法一样不并进「之前又试了」
    });
  });
  return interleaved(rows).map((r) => {
    if (r.kind === 'multi') return { ...multiRow(r), first: Math.min(...r.parts.map((p) => p.at[0])) };
    if (r.kind === 'path') return { ...pathRow(r), first: r.at[0] };
    if (r.kind === 'explain') { const t = `学生点开看了 ${r.refs.join('、')} 怎么算出来${hiddenText(r.hidden)}`; return { ...r, full: t, short: t }; }
    return r;
  });
}

/**
 * 试的那几行放不下：按要紧程度压（rest 是叫老师的那几件事，一字不动）。依次，放得下就停：
 * 1. 原样；2. 「正确的是」和事实只留每样东西的最后一下；3. 连着几下都是正确的下一步并成「接着 N 下」；
 * 4. 从前往后把没有错法的几行并成「之前又试了 N 下」；5. 同一种错法并成「像是… ×N（部件…）」。
 * 有错法的那几下永远不省（老师要从它们看学生卡在哪），再放不下也不删；页面照老师写的 wrong=block 拦下、wrong=mark 圈了的那几下也一样
 * （老师得知道页面替它拦了、圈了哪几下），同一种也只并成「不是正确的下一步 ×N（…）；照你写的 wrong=block 没让做…」一行
 */
function capTries(items, rest) {
  // 每行带着它在这几下里的位置（first：这一行第一下是第几件；试的几行彼此照旧按谁先开始排），写给老师时照先后和别的事排在一起（主线第一轮 D4-11）
  const fits = (lines) => bytesOf(HEAD + [...lines.map((l) => l.text), ...rest].join('\n')) <= STUDENT_MAX;
  const all = items.map((x) => ({ text: x.full, first: x.first }));
  if (!all.length || fits(all)) return all; // 没有一行细节就没什么可并的，不写「之前又试了 0 下」
  // 2. 每样东西只有最后一下留「正确的是」和事实（没写在哪样东西上的各算各的）
  const lastOf = new Map();
  for (const x of items) {
    if (!x.tail) continue;
    const k = x.obj ?? x;
    if (!lastOf.has(k) || x.last > lastOf.get(k).last) lastOf.set(k, x);
  }
  const keeps = (x) => !x.tail || lastOf.get(x.obj ?? x) === x;
  let rows = items.map((x) => ({ ...x, keep: keeps(x), text: keeps(x) ? x.full : x.short }));
  const texts = () => rows.filter((r) => !r.gone).map((r) => ({ text: r.text, first: r.first }));
  if (fits(texts())) return texts();
  // 3. 连着 ≥ 2 下是正确的下一步：并成一行，括号里最多列 6 下；留着「正确的是」、事实的那一下照样接在后面
  const merged = [];
  for (let i = 0; i < rows.length;) {
    let j = i;
    while (j < rows.length && rows[j].kind === 'one' && rows[j].right) j++;
    if (j - i < 2) { merged.push(rows[i]); i = Math.max(i + 1, j); continue; }
    const run = rows.slice(i, j);
    const list = run.slice(0, 6).map((r) => r.src).join('、') + (run.length > 6 ? '、…' : '');
    const tails = run.filter((r) => r.keep && r.tail).map((r) => r.tail).join('');
    merged.push({ kind: 'run', text: `接着 ${run.length} 下都是正确的下一步（${list}）${tails}`, n: run.length, right: run.length, wrong: 0, misread: null, first: run[0].first });
    i = j;
  }
  rows = merged;
  if (fits(texts())) return texts();
  // 4. 从前往后，没有错法、页面也没拦没圈的几行并进开头一行（别的跳过、留在原处）
  const kept = (r) => !!(r.misread || r.how);
  let n = 0, right = 0, wrong = 0;
  const head = () => `之前又试了 ${n} 下${right + wrong ? `（页面判了 ${right + wrong} 下：${right} 下是正确的下一步，${wrong} 下不是）` : ''}，细节省了`;
  const withHead = () => (n ? [{ text: head(), first: -1 }, ...texts()] : texts());
  for (const r of rows) {
    if (kept(r)) continue;
    r.gone = true;
    n += r.n || 1; right += r.right || 0; wrong += r.wrong || 0;
    if (fits(withHead())) return withHead();
  }
  // 5. 同一种错法（连同页面拦没拦、圈没圈）并成一行，放在这一种第一次出现的地方（下数多的先并）
  const groups = new Map();
  for (const r of rows) {
    if (r.gone || !kept(r)) continue;
    const k = `${r.misread || ''}|${r.how || ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const g of [...groups.values()].filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)) {
    const [r0] = g;
    g[0].text = `${r0.misread ? `像是${r0.misread}` : '不是正确的下一步'} ×${g.length}（${g.map((r) => r.refs).join('、')}）${r0.how || ''}`;
    for (const r of g.slice(1)) r.gone = true;
    if (fits(withHead())) break;
  }
  // 6. 还放不下也不删错法的那几行（叫老师的那件事本身超了也不截，和第一轮一样）
  return withHead();
}

/**
 * 攒下的事 → 写给老师看的一段（先写学生怎么试的，再写叫老师的那件事）。
 * goals：挑战 id → { text }（写「做到了挑战 g1「…」」用）；reacted：做到时演了几行预写的。
 * 连 [学生] 那一行不超过 STUDENT_MAX：试得多时按要紧程度压（capTries；错法那几下不省，叫老师的那件事一字不动）
 */
export function eventsText(events, { goals = new Map(), secs = null } = {}) {
  const tries = events.filter((e) => e.kind === 'try');
  // 试的第几下在整段里排第几件（试的行照它第一下的位置，和别的事排在一起）
  const tryAt = events.flatMap((e, i) => (e.kind === 'try' ? [i] : []));
  // 拨数现在一下一下记成试的事件、写成一条路；旧的存档里回答那一下还带着 tries（以前拨数攒在那里）：有路了就不再写一遍
  const dialed = tries.some((e) => e.act?.type === 'dial');
  const placed = []; // { at: 在整段里第几件, text }
  let at = 0;
  const lines = { push: (...xs) => { for (const text of xs) placed.push({ at, text }); } };
  // 回看过的几幕合成一句（同一幕看几次合起来），放在第一次回看的地方
  const looks = events.filter((e) => e.kind === 'look');
  let lookSaid = false;
  for (const [i, e] of events.entries()) {
    at = i;
    if (e.kind === 'try') continue;
    if (e.kind === 'look') { if (!lookSaid) { lookSaid = true; lines.push(lookText(looks.map((x) => x.act))); } continue; }
    if (e.kind === 'goal') for (const id of e.ids || []) {
      const g = goals.get(id);
      // watch：只叫老师的条件成立了（不是挑战：学生那边什么也没有）
      if (g?.watch) {
        lines.push(`你盯着的 ${id} 成立了（${g.when}）${heldText(e)}`);
        // 你挂的按钮学生还没按，页面收了（和挑战一样；「挑战写 on=」对 watch 说不通，不提）
        if (e.unpressed && id === e.ids.at(-1)) lines.push(`（你挂的「${e.unpressed}」学生还没按：盯着的条件成立，页面就叫你了，按钮收起来了）`);
        continue;
      }
      const c = e.collected?.[id] || g?.collect;
      // 一下做到几条挑战：各写各的预写行数（per；旧存档没有，照合起来的数）
      const n = e.per ? e.per[id] || 0 : e.reacted;
      const lost = e.per ? e.perMissed?.[id] || 0 : e.missed;
      const pre = n ? `（页面已经演了你预写的 ${n} 行）` : lost ? '（你预写的行都没演上）' : '（你没预写做到以后的行）';
      // 收集型：收齐了写收了哪几张（每收一张页面都演了预写的行）
      lines.push(c ? `${collectText(id, c)}${e.reacted ? `；页面每收一张都演了你预写的行` : ''}${heldText(e)}` : `学生做到了挑战 ${id}${g ? `「${g.text}」` : ''}${pre}${heldText(e)}`);
      // 你挂的按钮学生还没按，页面当它按了（loop.js 的 settle）
      if (e.unpressed && id === e.ids.at(-1)) lines.push(`（你挂的「${e.unpressed}」学生还没按：做到了页面就叫你了。要等学生自己按了再叫，挑战写 on="${e.unpressed}"）`);
    }
    else if (e.kind === 'goal-by-teacher') for (const id of e.ids || []) {
      const g = goals.get(id);
      const name = g?.watch ? `你盯着的 ${id}（${g.when}）` : `挑战 ${id}${g ? `「${g.text}」` : ''}`;
      // 舞台演你预写的行时成立的、预写出的挑战一出来就成立的：照实说，不说「你这一轮让它成立了」
      lines.push(e.fresh?.includes(id) ? `预写出的${name}一出来就已经成立了（不是学生做到的）` : `${e.pre ? '你预写的行让' : '你这一轮让'}${name}成立了（不是学生做到的）`);
    }
    else if (e.kind === 'done') {
      // 键盘填的空格子写满了（filled）：页面不判写得对不对，不说「算出来没有下一步了」，也没有预写（@M.done 只给规则判得了做完的动作）
      // 开着 rowop 又开着键盘的矩阵，写满正好就是消完了（ruled）：两件都说
      const fill = (e.ids || []).filter((id) => e.filled?.includes(id));
      const rest = (e.ids || []).filter((id) => !fill.includes(id) || e.ruled?.includes(id));
      const parts = [];
      if (fill.length) parts.push(`学生把 ${fill.join('、')} 的空格子都写满了（页面不判写得对不对）`);
      // 这一次没有预写可演：以前写过的（上一次做完时拿出来用了、你那一轮让它做完时拿掉了）照实说，不说「你没预写」（最后一审 M2）。
      // 不说「演过了」：拿出来的行当时可能没演上（指着的部件没了，那一次已经告诉老师「都没演上」：复审 N8）
      const spent = rest.map((id) => e.before?.[id]);
      // 几样一起做完、各有各的来历（极少）：不说预写的事，免得对其中一样说错
      const all = (k) => spent.every((x) => x === k);
      const none = all('played') ? '（你预写的行上一次做完时已经拿出来用过了：一组只用一次）' : all('dropped') ? '（你预写的行在你那一轮让它做完时拿掉了，没演）' : all(undefined) ? '（你没预写做完以后的行）' : '';
      if (rest.length) parts.push(`学生把 ${rest.join('、')} 做完了${e.reacted ? `（页面已经演了你预写的 ${e.reacted} 行）` : e.missed ? '（页面算出来没有下一步了）（你预写的行都没演上）' : `（页面算出来没有下一步了）${none}`}`);
      lines.push(`${parts.join('；')}${heldText(e)}`);
    }
    else if (e.kind === 'help') lines.push(`学生点了「${e.act.button}」`);
    else if (e.kind === 'stuck') lines.push(e.text || `学生 ${Math.round(QUIET_MS / 1000)} 秒没动，挑战还没做到`);
    else if (e.kind === 'tries') lines.push(e.text || `学生试了 ${TRY_MAX} 下还没做到`);
    // 老师上一轮的提问没演上（写错了）：学生手上没事可做，页面马上叫老师重写（loop.js；主线第一轮 D3-3、D4-5）
    else if (e.kind === 'handfail') lines.push('你这一轮交给学生的手（open）没演上，学生手上没有能动的：页面马上叫了你，重写那几行（看下面没演的行）');
    else if (e.kind === 'askfail') lines.push('你上一轮的提问没演上（看下面没演的行）：学生手上只有页面替你挂的打字框，还什么都没做。把那一问重写一遍');
    // 页面记下的一句（老师演的那一下改了学生先点的几样：stage.js 的 onNote）：不叫老师、不算「试」，照写
    else if (e.kind === 'note') lines.push(`${e.text || ''}${e.n > 1 ? `（这样试了 ${e.n} 次）` : ''}`);
    else if (e.act) {
      lines.push(actText(dialed ? { ...e.act, tries: undefined } : e.act));
      // 答对了这一问、页面演了 @ask.right 预写的行（学生手上还有事就攒着，写那时有什么事）
      if (e.reacted || e.missed) lines.push(`学生答对了（${e.reacted ? `页面已经演了你预写的 ${e.reacted} 行` : '你预写的行都没演上'}）${heldText(e)}`);
      else if (e.held?.length) lines.push(`（${e.held.join('，')}，没叫你）`);
    }
  }
  at = Infinity; // 最后的两句说明
  // 老师写了 call=wrong、学生走偏了才叫的：说一声为什么这时候叫
  if (events.some((e) => e.now && !e.act?.reached)) lines.push('（你在 open 那一行写了 call=wrong：学生走偏了，页面马上叫你）');
  if (secs != null && secs >= 5) lines.push(`（离你上一轮演完过了 ${secs} 秒）`);
  const rest = placed.filter((x) => x.text);
  // 照发生的先后排（以前试的几下一律在最前面：学生先做到挑战、点对一问，再试的几下，写出来先后是反的）。
  // 一条路放在它开头的地方（路上写着拨到哪做到了哪个挑战）。压过的「之前又试了 N 下」那一行在最前面（first 是 -1）
  const tried = tries.length ? capTries(tryLines(tries), rest.map((x) => x.text)).map((r) => ({ at: r.first < 0 ? -1 : tryAt[r.first] ?? -1, text: r.text })) : [];
  return [...tried, ...rest].map((x, i) => ({ ...x, i })).sort((a, b) => a.at - b.at || a.i - b.i).map((x) => x.text).filter(Boolean).join('\n');
}

/** 往一格里写一个值（open M edit input=keypad 的那一下）：写的是哪一格；别的 null */
const fillOf = (a) => (a?.type === 'write' ? String(a.line || a.src || '').match(/^write\s+(\S+)/)?.[1] || null : null);
/**
 * 自从上一次叫老师，学生试了几下（拨、拖、点开看都算）。不算的：
 *   - 老师写了 call=done 的东西上试的、撤一步、按「回到……」（patient）；
 *   - 往一格里写第一个值：键盘一格一格写满一张矩阵是在填，不是试了没做到（以前写到第 8 格就叫老师「试了 8 下还没做到」）；
 *     同一格再写一次才算一下；
 *   - 做到挑战、收集型收了一张、做完了的那一下（act.reached，stage.js 记的）：往前走了一步，它和它之前试的都不再算「还没做到」，从头数；
 *   - 同一个拨数、同一格连着 ± 拨的几下（中间没动过别的，路接得上：和写给老师的「一条路」同一套 pathKey / pathGoesOn）、
 *     一直往一个方向拨，只算一下：拨数 0 拨到 8 要按 8 下 ›，是一次「试」（以前一下算一下，拨到 8 就叫老师
 *     「试了 8 下还没做到」，第三次量 L3/幕6 那种）。换了方向（这一下和这条路上一下方向相反）是又试了一下：
 *     不然来回拨永远只算一下，学生一直在拨也一直没人管（「很久没动」按最后一下计时，拨着就不算没动；最后一审 I3）。
 *     只按换方向数：拨回这条路上停过的值不另算（以前另算，0 → 8 → 0 扫一趟是 9 下，学生只是上去下来看了一遍就叫老师
 *     「试了好多下」；现在是 2 下：复审 N11）
 */
const numOfStop = (x) => { const m = String(x ?? '').trim().replace(/^[−–]/, '-').match(/^(-?\d+(?:\.\d+)?)(?:\/(\d+))?$/); return m ? Number(m[1]) / (m[2] ? Number(m[2]) : 1) : null; };
export function tryCount(events) {
  let n = 0;
  const filled = new Set();
  // 上一下是哪条路上的：{ key, end, dir（上一下往哪拨：1 / -1，看不出是 0）}；
  // 中间有别的一下（连撤一步、按「回到……」）就断了
  let run = null;
  for (const e of events) {
    // 中间夹着学生别的事（答了一问、做到挑战……）也断了这一条路；页面记下的一句（note）不是学生做的，不断
    if (e.kind !== 'try') { if (e.kind !== 'note') run = null; continue; }
    const a = e.act || {};
    const key = pathKey(a);
    const end = key ? pathEnd(a) : null;
    const on = !!(key && run && run.key === key && pathGoesOn(run.end, a));
    const x = numOfStop(a.from ?? run?.end), y = numOfStop(end);
    const dir = x != null && y != null ? Math.sign(y - x) : 0;
    const goesOn = on && !(dir && run.dir && dir !== run.dir);
    run = key ? { key, end, dir: dir || (on ? run.dir : 0) } : null;
    if (a.reached?.length) { n = 0; filled.clear(); run = null; continue; }
    if (e.patient) continue;
    if (goesOn) continue;
    const cell = fillOf(a);
    if (cell && !filled.has(cell)) { filled.add(cell); continue; }
    n++;
  }
  return n;
}

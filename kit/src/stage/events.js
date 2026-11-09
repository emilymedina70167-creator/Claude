// 活的舞台上学生做的事（docs/stage-plan.md E 段）：哪些要马上叫老师、哪些攒着；攒下来的怎么写给老师看。纯函数，有测试（tests/stage-events.test.js）。
//
// 学生在舞台上随时能动（拨格子、拖、点开看怎么算），这些是「试」：一下一下都告诉老师太碎、也太慢（每叫一次老师就是一整轮），
// 所以攒着，等到有要老师接的事——答了老师问的、做到了挑战、打字、点「给个提示」、试了好多下还没做到、很久没动——
// 一起写成一段发过去。老师照它看学生是怎么试的、卡在哪，再当场写下一步。
import { actText } from './stage.js';
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
export const triggers = (e) => !e.quiet && (!!e.now || ['answer', 'goal', 'done', 'help', 'stuck', 'tries'].includes(e.kind));

/**
 * 学生手上还有什么事（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 6.2）：做到挑战、做完、答对一问以后，有事就攒着，
 * 没事了才叫老师。空的就是没事了。有事是：
 *   - 还挂着要学生答的一问（tap / pick / drag / value / say）；ask next（连页面挂的「给个提示」）不算：点它就是叫老师；
 *   - 还没做到的挑战；
 *   - 交给了学生（open 了规则 doneBy 里的动作）、还没做完的东西——规则算得出下一步才算（页面判不了的，比如没写 key 的句子，
 *     永远等不到它做完，不能拿它挡着不叫老师）
 */
export function hasWork(scene) {
  const out = [];
  const w = scene?.waiting;
  if (w && w.kind !== 'next') out.push(`还有一问没答（ask ${w.kind}）`);
  for (const g of scene?.goals?.values() || []) if (!g.met) out.push(`挑战 ${g.id}「${g.text}」还没做到`);
  const undone = undoneOf(scene);
  if (undone.length) out.push(`${undone.join('、')} 还没做完`);
  return out;
}
/** 交给了学生、规则算得出下一步、还没做完的东西（hasWork 的第三种；课堂循环拿它兜底「很久没动」） */
export function undoneOf(scene) {
  const undone = [];
  for (const e of scene?.opens?.values() || []) {
    if (undone.includes(e.obj) || !scene.doneOpen?.(e.obj)) continue;
    const o = scene.objects.get(e.obj);
    const r = rulesOf(o);
    if (!r?.hasNext) continue;
    let nx = null;
    try { nx = r.next(o, scene); } catch { nx = null; }
    if (nx?.acts?.length) undone.push(e.obj);
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
 * 拨数、拨格子的一下并进哪一条路（同一个数、同一格连着拨的都并成一条）。没让做、没演上、页面判了对错的一下不算路上的一步，单独一行
 */
function pathKey(a) {
  if (a.error || a.blocked || a.failed) return null;
  // 页面判了对错的一下（以后拨数也过裁判时）不并进路：错法要单独写出来，不能藏在一条路里
  if ((a.verdict?.right ?? null) !== null || a.verdict?.legal === false) return null;
  if (a.type === 'dial') return `dial:${a.name}`;
  if (a.type === 'edit') return `edit:${a.ref}`;
  return null;
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
 * 试的几下 → 一行一行（每一行 { full 原样, short 去掉「正确的是」和事实, tail 去掉的那一截, obj, refs, src, n 是几下,
 * right / wrong 其中判对、判错几下, misread 像哪种错, last 最后一下是第几件 }）：同一格、同一个拨数连着拨的几下并成一条路；
 * 点开看的几格并成一句；过了裁判的一下后面跟结论和这一下以后的事实
 */
function tryLines(tries) {
  const rows = [];
  const paths = new Map();
  let explain = null;
  // 一条路最后停在哪：下一下要从这里拨起才接得上
  const endOf = (p) => { const m = p.moves.at(-1); return String(m.type === 'dial' ? m.value : m.to); };
  tries.forEach((e, i) => {
    const a = e.act || {};
    const key = pathKey(a);
    if (key) {
      let p = paths.get(key);
      // 中间这个数、这一格被别的动过（判了对错的那一下、行变换……）：从几拨起对不上就另起一条，不然路上的数是假的
      if (p && a.from != null && String(a.from) !== endOf(p)) p = null;
      if (!p) { p = { kind: 'path', moves: [], ...whereOf(a), src: '', right: 0, wrong: 0, misread: null }; paths.set(key, p); rows.push(p); }
      p.moves.push(a);
      p.last = i;
      return;
    }
    if (a.type === 'explain') {
      if (!explain) { explain = { kind: 'explain', refs: [], n: 0, obj: null, tail: '', right: 0, wrong: 0, misread: null }; rows.push(explain); }
      explain.n++;
      explain.last = i;
      if (!explain.refs.includes(a.ref)) explain.refs.push(a.ref);
      return;
    }
    // 不并进路的拨数（页面判了对错的、没演上的）：actText 不写拨数，照拨格子的样子写一句
    const main = actText(a) || (a.type === 'dial' ? `学生把 ${a.name} 从 ${minus(a.from ?? '?')} 拨到 ${minus(a.value)}` : '');
    if (!main) return;
    const v = verdictParts(a);
    const facts = (a.facts || []).filter(Boolean);
    const judged = !a.error && !a.failed && a.verdict;
    rows.push({
      kind: 'one', ...whereOf(a), src: a.src || a.line || main, last: i, n: 1,
      full: `${main}${v.pre}${v.next}${v.how}${facts.length ? `。${facts.join('；')}` : ''}`,
      short: `${main}${v.pre}${v.how}`,
      tail: `${v.next}${facts.length ? `。${facts.join('；')}` : ''}`,
      right: judged && a.verdict.legal !== false && a.verdict.right === true ? 1 : 0,
      wrong: judged && a.verdict.right === false ? 1 : 0,
      misread: judged && a.verdict.legal !== false && a.verdict.right === false ? a.verdict.misread || null : null,
      how: v.how, // 照老师写的 wrong=block 没让做 / wrong=mark 圈了一下：和错法一样不并进「之前又试了」
    });
  });
  return rows.map((r) => {
    if (r.kind === 'path') return pathRow(r);
    if (r.kind === 'explain') { const t = `学生点开看了 ${r.refs.join('、')} 怎么算出来`; return { ...r, full: t, short: t }; }
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
  const fits = (lines) => bytesOf(HEAD + [...lines, ...rest].join('\n')) <= STUDENT_MAX;
  const all = items.map((x) => x.full);
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
  const texts = () => rows.filter((r) => !r.gone).map((r) => r.text);
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
    merged.push({ kind: 'run', text: `接着 ${run.length} 下都是正确的下一步（${list}）${tails}`, n: run.length, right: run.length, wrong: 0, misread: null });
    i = j;
  }
  rows = merged;
  if (fits(texts())) return texts();
  // 4. 从前往后，没有错法、页面也没拦没圈的几行并进开头一行（别的跳过、留在原处）
  const kept = (r) => !!(r.misread || r.how);
  let n = 0, right = 0, wrong = 0;
  const head = () => `之前又试了 ${n} 下${right + wrong ? `（页面判了 ${right + wrong} 下：${right} 下是正确的下一步，${wrong} 下不是）` : ''}，细节省了`;
  const withHead = () => (n ? [head(), ...texts()] : texts());
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
  // 拨数现在一下一下记成试的事件、写成一条路；旧的存档里回答那一下还带着 tries（以前拨数攒在那里）：有路了就不再写一遍
  const dialed = tries.some((e) => e.act?.type === 'dial');
  const lines = [];
  for (const e of events) {
    if (e.kind === 'try') continue;
    if (e.kind === 'goal') for (const id of e.ids || []) {
      const g = goals.get(id);
      const c = e.collected?.[id] || g?.collect;
      const pre = e.reacted ? `（页面已经演了你预写的 ${e.reacted} 行）` : e.missed ? '（你预写的行都没演上）' : '（你没预写做到以后的行）';
      // 收集型：收齐了写收了哪几张（每收一张页面都演了预写的行）
      lines.push(c ? `${collectText(id, c)}${e.reacted ? `；页面每收一张都演了你预写的行` : ''}${heldText(e)}` : `学生做到了挑战 ${id}${g ? `「${g.text}」` : ''}${pre}${heldText(e)}`);
    }
    else if (e.kind === 'goal-by-teacher') for (const id of e.ids || []) {
      const g = goals.get(id);
      const name = `挑战 ${id}${g ? `「${g.text}」` : ''}`;
      // 舞台演你预写的行时成立的、预写出的挑战一出来就成立的：照实说，不说「你这一轮让它成立了」
      lines.push(e.fresh?.includes(id) ? `预写出的${name}一出来就已经成立了（不是学生做到的）` : `${e.pre ? '你预写的行让' : '你这一轮让'}${name}成立了（不是学生做到的）`);
    }
    else if (e.kind === 'done') {
      const ids = (e.ids || []).join('、');
      lines.push(`学生把 ${ids} 做完了${e.reacted ? `（页面已经演了你预写的 ${e.reacted} 行）` : e.missed ? '（页面算出来没有下一步了）（你预写的行都没演上）' : '（页面算出来没有下一步了）（你没预写做完以后的行）'}${heldText(e)}`);
    }
    else if (e.kind === 'help') lines.push(`学生点了「${e.act.button}」`);
    else if (e.kind === 'stuck') lines.push(e.text || `学生 ${Math.round(QUIET_MS / 1000)} 秒没动，挑战还没做到`);
    else if (e.kind === 'tries') lines.push(e.text || `学生试了 ${TRY_MAX} 下还没做到`);
    // 页面记下的一句（老师演的那一下改了学生先点的几样：stage.js 的 onNote）：不叫老师、不算「试」，照写
    else if (e.kind === 'note') lines.push(e.text || '');
    else if (e.act) {
      lines.push(actText(dialed ? { ...e.act, tries: undefined } : e.act));
      // 答对了这一问、页面演了 @ask.right 预写的行（学生手上还有事就攒着，写那时有什么事）
      if (e.reacted || e.missed) lines.push(`学生答对了（${e.reacted ? `页面已经演了你预写的 ${e.reacted} 行` : '你预写的行都没演上'}）${heldText(e)}`);
      else if (e.held?.length) lines.push(`（${e.held.join('，')}，没叫你）`);
    }
  }
  // 老师写了 call=wrong、学生走偏了才叫的：说一声为什么这时候叫
  if (events.some((e) => e.now)) lines.push('（你在 open 那一行写了 call=wrong：学生走偏了，页面马上叫你）');
  if (secs != null && secs >= 5) lines.push(`（离你上一轮演完过了 ${secs} 秒）`);
  const rest = lines.filter(Boolean);
  return [...(tries.length ? capTries(tryLines(tries), rest) : []), ...rest].filter(Boolean).join('\n');
}

/** 自从上一次叫老师，学生试了几下（拨、拖、点开看都算；老师写了 call=done 的东西上试的、撤一步不算） */
export const tryCount = (events) => events.filter((e) => e.kind === 'try' && !e.patient).length;

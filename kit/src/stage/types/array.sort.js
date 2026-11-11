// 一排格子懂排序的那一半（数据结构第八章）：不碰 DOM、不改场景，纯函数（tests/stage-array-rules.test.js）。
// types/array.js（sort 指令、舞台现状）和 types/array.rules.js（下一步、判一下、事实、量、判断式）都用它。
//
// 每一趟的结果、常见错法都从黑板那边的排序引擎来（engines/sort.js，照王道的代码走），这里不另写一份排序：
//   - 一趟的粒度（七种都有）：planOf 让引擎从起点跑一遍，交每一趟（快排是每一次划分）结束后的那一排——字和格子上写的一样，
//     49′ 和 49 分得开——和常见错法每一趟的数；sortStatus 拿现在这一排去对：等于第几趟、像哪种错法、做完没有。
//   - 一下的粒度（直接插入、希尔、冒泡、简单选择）：nextOf 从现在的样子算正确的下一步，学生走偏以后也从现在的样子接着算；
//     checkOf 判一下。快排、归并、基数只做一趟的粒度：学生的每一下不判对错。
// 老师写明在做哪种排序记在 o.sort：{ algo, d（希尔这一趟的增量）, dv（d 跟着的拨数名）, from（写明那一刻的一排，起点）, moved（写明排序以来让了几格：再写一次 sort 接着数，sort a off 才归零）,
//   src（另一排的名字：这一排该等于它做完第 pass 趟的样子）, pass }。没有 o.sort 时页面不猜：这里什么都不判。
import { parse, run, variants, ALGOS, shellBlocks } from '../../engines/sort.js';
import { shellTrace } from '../../sorting.js';
import { strideGroups } from '../layout.js';

/** 认得的七种（名字 → 中文） */
export const SORTS = ALGOS;
/** 页面判得了每一下的四种；别的只判到一趟 */
export const STEP_SORTS = ['insert', 'shell', 'bubble', 'select'];
/** 没写明在做哪种排序时的话（next 的 why、报错） */
export const noSortText = (id) => `没写 ${id} 在做哪种排序（sort ${id} insert、sort ${id} shell d=5……），页面不判对错`;

// 49′ 和 49' 是同一个写法；真的减号当减号
const norm = (t) => String(t ?? '').replace(/['’]/g, '′').replace(/[−–]/g, '-').trim();
/** 格子里的数（49′ 当 49；不是数是 null）：只认整数、小数——引擎排的就是这两种 */
export function numOf(v) {
  const t = norm(v).replace(/′/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}
/** 这一排现在的样子（按格的先后）：[{ key, slot, value, num, row }] */
export const rowOf = (o) => [...o.cells].sort((a, b) => a.slot - b.slot).map((c) => ({ key: c.key, slot: c.slot, value: c.value, num: numOf(c.value), row: c.row || 0 }));
export const textsOf = (o) => [...o.cells].sort((a, b) => a.slot - b.slot).map((c) => c.value);
const sameTexts = (a, b) => a.length === b.length && a.every((t, i) => norm(t) === norm(b[i]));
const sameNums = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const sortedUp = (nums) => nums.every((v, i) => !i || nums[i - 1] <= v);
const unitOf = (algo) => (algo === 'quick' ? '次划分' : '趟');

/** 前大后小的有几对（逆序对） */
export function inversions(nums) {
  let n = 0;
  for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) if (nums[i] > nums[j]) n++;
  return n;
}

// —— 隔 d 的链 ——
/** n 格、隔 d：每条链是第几格（从 1 数）[[1, 6], [2, 7], …] */
export const chainSlots = (n, d) => strideGroups(n, d);
/** 第 slot 格在第几条链上（从 1 数） */
export const chainOf = (slot, d) => ((slot - 1) % d) + 1;
/** 这一排现在隔几个算链：写明了希尔就是它这一趟的 d，不然是分组（group … stride=）的那个；都没有是 null */
export function strideOf(o) {
  if (o.sort?.algo === 'shell' && o.sort.d != null) return o.sort.d;
  return o.groupD || null;
}
/** 隔 d 的链上挨着、前大后小的几对：[{ chain（第几条）, a, b }]（a 在前，rowOf 的那一格） */
export function badPairs(row, d) {
  const out = [];
  chainSlots(row.length, d).forEach((slots, g) => {
    for (let i = 1; i < slots.length; i++) {
      const a = row[slots[i - 1] - 1], b = row[slots[i] - 1];
      if (a.num != null && b.num != null && a.num > b.num) out.push({ chain: g + 1, a, b });
    }
  });
  return out;
}
/** 两格是不是隔 d 的同一条链上挨着的 */
export const chainMates = (sa, sb, d) => Math.abs(sa - sb) === d;
const validD = (d, n) => Number.isInteger(d) && d >= 1 && d < n;

// —— 一趟的粒度：让引擎跑 ——
const CACHE = new Map();
const CACHE_MAX = 80;
// 引擎的报错是黑板组件的说法（array: / algo:），换成舞台上老师照着改得对的话
function engineError(err) {
  const m = String(err?.message || err);
  const bad = m.match(/看不懂元素「(.+?)」/);
  if (bad) return `格子里要都是数（「${bad[1]}」不是；重复的数加 ′ 区分）`;
  return m.replace(/^(array|algo|pass): ?/, '');
}
// 一步的画面是不是完整的一排（直接插入、快排中间的样子有一张牌画了两次，不算）
const whole = (A, n) => Array.isArray(A) && A.length === n && A.every(Boolean) && new Set(A.map((x) => x.id)).size === n;

/**
 * 照引擎把这一种排序从 start（一排字）跑一遍：
 * { algo, d, start, passes: [每一趟结束后的一排字], nums: [每一趟的数], counts: [{ cmp, moves }] | null, variants: [{ id, label, passes: [[数]] }], track }。
 * 引擎的 passes 只有数（49′ 成了 49）：每一趟结束时是哪几张牌，照引擎那一步的画面认（一趟里完整的一排只有起点和终点，数对得上的第一步就是）。
 * counts 只有直接插入、希尔有（照王道的代码数：比较几次、后移几次）；track 是冒泡每换一次的样子（下一步照它接）。
 * 跑不了（有空格子、不全是数、希尔没写 d、d 不比格数小）抛错，话给老师看
 */
export function planOf(algo, start, d = null) {
  if (!ALGOS[algo]) throw new Error(`没有「${algo}」这种排序：写 ${Object.keys(ALGOS).join(' / ')}`);
  if (start.some((t) => t == null || t === '')) throw new Error('还有空着的格');
  if (algo === 'shell' && d == null) throw new Error('希尔排序要写这一趟的增量：d=5（能写拨数的名字）');
  const key = `${algo}|${algo === 'shell' ? d : ''}|${start.map(norm).join(' ')}`;
  if (CACHE.has(key)) return CACHE.get(key);
  let input, r;
  try {
    input = parse({ algo, array: start.map(norm).join(' '), ...(algo === 'shell' ? { gaps: String(d) } : {}) });
    r = run(input);
  } catch (err) { throw new Error(engineError(err)); }
  const n = input.items.length;
  const passes = [];
  let t = 0;
  for (const p of r.passes) {
    let ids = null;
    for (; t < r.steps.length; t++) {
      const A = r.steps[t].view?.A;
      if (whole(A, n) && A.every((x, i) => x.v === p[i])) { ids = A.map((x) => x.id); break; }
    }
    if (!ids) throw new Error('页面没对上引擎的这一趟');
    passes.push(ids.map((id) => start[id]));
  }
  const track = [];
  if (algo === 'bubble') for (const s of r.steps) { const A = s.view?.A; if (!whole(A, n)) continue; const x = A.map((y) => start[y.id]); if (!track.length || !sameTexts(track.at(-1), x)) track.push(x); }
  const plan = {
    algo, d: algo === 'shell' ? d : null, start: [...start], passes, nums: r.passes, counts: countsOf(algo, input.items, d),
    variants: variants(input).map((v) => ({ id: v.input.mistake, label: String(v.label).replace(/^像是/, ''), passes: run(v.input).passes })), track,
  };
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, plan);
  return plan;
}
// 照王道的代码数（sorting.js 的 shellTrace 一行一行走的就是那段代码）：希尔的一趟比较几次（if 一次，j > 0 时循环里每比一次）、后移几次；
// 直接插入是带哨兵的那一版：j 走到 0 时 A[0] < A[0] 也比一次，一趟一趟分开数（第 k 趟是插第 k + 1 个）
function countsOf(algo, items, d) {
  if (algo === 'shell') {
    let cmp = 0, moves = 0;
    for (const s of shellTrace(items, [d])) { if (s.kind === 'if' || (s.kind === 'test' && s.j > 0)) cmp++; if (s.kind === 'move') moves++; }
    return [{ cmp, moves }];
  }
  if (algo !== 'insert') return null;
  const out = items.slice(1).map(() => ({ cmp: 0, moves: 0 }));
  for (const s of shellTrace(items, [1])) {
    const k = out[s.i - 2];
    if (!k) continue;
    if (s.kind === 'if' || s.kind === 'test') k.cmp++;
    if (s.kind === 'move') k.moves++;
  }
  return out;
}

/** 这一排的起点：自己写明那一刻的一排，或者 from= 写的那一排现在的样子（那一排不在了、格数对不上抛错） */
function startOf(o, scene) {
  const s = o.sort;
  if (!s.src) return s.from;
  const src = scene?.objects?.get(s.src);
  if (!src || src.type !== 'array') throw new Error(`from= 写的 ${s.src} 不在舞台上`);
  if (src.cells.length !== o.cells.length) throw new Error(`${s.src} 是 ${src.cells.length} 格，${o.id} 是 ${o.cells.length} 格，对不上`);
  return textsOf(src);
}
export function planFor(o, scene) {
  const s = o.sort;
  if (s.algo === 'shell' && !validD(s.d, o.cells.length)) throw new Error(`增量 d = ${s.d} 要是比格数（${o.cells.length}）小的正整数`);
  return planOf(s.algo, startOf(o, scene), s.d);
}

/**
 * 现在这一排对着引擎看是什么样：{ algo, d, src, target, blank, error, plan, total（一共几趟）, at（等于第几趟结束后的样子；0 是起点；对不上是 null）,
 *   first（连着几趟不用动时最早是第几趟，at 是最后那一趟）,
 *   same（数和第几趟一样、可相等的几张先后不一样：at 是 null 时才有）, like（{ id, label, k }：正好是哪种常见错法的第 k 趟）,
 *   done（做完了：希尔是这一趟每条链都递增；别的是整个排好；from= 的一排是等于该等于的那一趟）, exact（和照王道的代码做出来的一模一样） }。
 * 没写明排序是 null。算不了（空格子、不全是数、from= 的那一排不在了）写在 error / blank 上，别的项照「不知道」留着
 */
export function sortStatus(o, scene) {
  const s = o.sort;
  if (!s) return null;
  const row = rowOf(o);
  const cur = row.map((c) => c.value);
  const out = { algo: s.algo, d: s.algo === 'shell' ? s.d : null, src: s.src || null, target: s.src ? s.pass || 1 : null, blank: cur.includes(''), error: null, plan: null, total: 0, at: null, same: null, like: null, done: false, exact: false };
  try { out.plan = planFor(o, scene); } catch (err) { out.error = err.message; }
  if (out.blank) return out;
  const nums = row.map((c) => c.num);
  if (nums.some((v) => v == null)) { out.error ||= '格子里不全是数'; return out; }
  const p = out.plan;
  if (p) {
    out.total = p.passes.length;
    if (sameTexts(cur, p.start)) out.at = 0;
    // 连着几趟不用动时好几趟结束后都是这个样子：at 取最后那一趟，first 是最早那一趟
    p.passes.forEach((x, k) => { if (sameTexts(cur, x)) { out.at = k + 1; out.first ??= k + 1; } });
    const want = out.target;
    if (out.at == null) { const k = p.nums.findIndex((x) => sameNums(x, nums)); if (k >= 0) out.same = k + 1; }
    // 像哪种常见错法：只在数正好等于那种做法某一趟的结果、又不是正确的哪一趟时说（from= 的一排只和它该等于的那一趟比）。
    // 原地排、页面判每一下的那四种不在这里说：一趟做到一半的样子会碰巧和哪种错法的结果一样（冒泡先换了前面一对，正好是
    // 「只把最小的挪到最前」），像哪种错在每一下上判（checkOf 的 misread）
    if (out.same == null && (want != null ? out.at !== want : out.at == null && !STEP_SORTS.includes(s.algo))) {
      for (const v of p.variants) {
        const k = want != null ? (v.passes[want - 1] && sameNums(v.passes[want - 1], nums) ? want - 1 : -1) : v.passes.findIndex((x) => sameNums(x, nums));
        if (k >= 0) { out.like = { id: v.id, label: v.label, k: k + 1 }; break; }
      }
    }
  }
  if (s.src) { out.done = !!p && out.at === out.target; out.exact = out.done; return out; }
  if (s.algo === 'shell') out.done = validD(s.d, row.length) && badPairs(row, s.d).length === 0;
  else out.done = sortedUp(nums);
  out.exact = !!p && out.at === out.total;
  return out;
}

/**
 * 现在等于第 want 趟结束后的样子吗（want 是 null：希尔是这一趟，from= 的一排是它该等于的那一趟）：true / false；
 * 现在判不了、之后判得了（还有空着的格、起点那一排还空着、拨数把 d 拨到了用不了的值）是 null；别的算不了（不全是数、那一排不在了、没有这一趟）抛错
 */
export function passEquals(o, scene, want = null) {
  const s = o.sort;
  const k = want ?? (s.src ? s.pass || 1 : 1);
  let plan;
  try { plan = planFor(o, scene); } catch (err) { if (/空着|增量 d/.test(err.message)) return null; throw err; }
  if (k > plan.passes.length) throw new Error(`${ALGOS[s.algo]}从这一排起一共 ${plan.passes.length} ${unitOf(s.algo)}，没有第 ${k} ${unitOf(s.algo)}`);
  const cur = textsOf(o);
  return cur.includes('') ? null : sameTexts(cur, plan.passes[k - 1]);
}

// —— 一下的粒度 ——
/**
 * 直接插入（d = 1）、希尔（隔 d）：每条没排好的链上「下一个该插的」——链上第一张比前一张小的牌 x，该插在链上第 j 个位置
 * （前面不比它大的都留在它前面：相等的不越过，王道的代码只在 A[0] < A[j] 时后移），over 是要给它让位的几张。
 * [{ chain, slots, x, pred（链上它前面那一张）, to（该到第几格）, over }]
 */
export function insertSteps(row, d) {
  const out = [];
  chainSlots(row.length, d).forEach((slots, g) => {
    const cs = slots.map((s) => row[s - 1]);
    const t = cs.findIndex((c, i) => i > 0 && c.num < cs[i - 1].num);
    if (t < 0) return;
    const x = cs[t];
    const j = cs.slice(0, t).filter((c) => c.num <= x.num).length;
    out.push({ chain: g + 1, slots, x, pred: cs[t - 1], to: slots[j], over: cs.slice(j, t) });
  });
  return out;
}
/** 冒泡（王道：从后往前，小的往前冒）现在能换的几对：挨着、前大后小、后面那张是它往后所有牌里最小的（正被带着往前冒的那一张）。[{ a, b }]（a 在前），最靠后的排第一 */
export function bubbleSwaps(row) {
  const out = [];
  let min = Infinity;
  for (let j = row.length - 1; j >= 1; j--) {
    min = Math.min(min, row[j].num);
    if (row[j - 1].num > row[j].num && row[j].num === min) out.push({ a: row[j - 1], b: row[j] });
  }
  return out;
}
/** 简单选择：前面已经到位的有几张（每一张都不比它后面的大），和后面最小的那一张（王道的代码取第一个最小的） */
export function selectStep(row) {
  const n = row.length;
  let k = 0;
  while (k < n - 1 && row.slice(k + 1).every((c) => row[k].num <= c.num)) k++;
  if (k >= n - 1) return null;
  let m = k;
  for (let j = k + 1; j < n; j++) if (row[j].num < row[m].num) m = j;
  return { k, at: row[k], min: row[m] };
}

/** 这一下以后的一排（key 按格的先后）；做不了是 null。swap { a, b }（key）、move { key, to（第几格）, d（隔几个的链上挪，默认 1） } */
export function applyAct(row, act) {
  const keys = row.map((c) => c.key);
  if (act?.type === 'swap') {
    const i = keys.indexOf(act.a), j = keys.indexOf(act.b);
    if (i < 0 || j < 0 || i === j) return null;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    return keys;
  }
  if (act?.type === 'move') {
    const i = keys.indexOf(act.key), to = act.to - 1, d = act.d || 1;
    if (i < 0 || !(to >= 0 && to < keys.length) || (i - to) % d !== 0 || i === to) return null;
    const step = to < i ? -d : d;
    for (let p = i; p !== to; p += step) keys[p] = keys[p + step];
    keys[to] = act.key;
    return keys;
  }
  return null;
}

const listOf = (xs) => xs.join('、');
const slotsText = (slots) => `第 ${listOf(slots)} 格`;
// 一步插入写成「把……」（裁判接在「现在正确的是」后面）
function insertWhy(st, d, more) {
  const { x, pred, to, over, chain, slots } = st;
  const give = over.map((c) => c.value);
  const each = over.length > 1 ? '各' : '';
  const hop = d > 1 ? `${each}往后跳 ${d} 格` : `${each}往后让一格`;
  const also = over.length === 1 ? '（就是这两张对调）' : `（和前一张 ${pred.value} 对调着一步步往前换也行）`;
  const head = d > 1 ? `第 ${chain} 条链（${slotsText(slots)}）上的 ` : '';
  return `把${head ? '' : ' '}${head}${x.value}（第 ${x.slot} 格）插到第 ${to} 格，${listOf(give)} ${hop}${also}：它比${d > 1 ? '同链' : ''}前一张 ${pred.value} 小${more > 0 ? `；另外还有 ${more} 条链没排好，先做哪条都行` : ''}`;
}

/**
 * 现在正确的下一步：{ acts: [可接受的每一下], why } | null（做完了）；acts 空着是页面算不了（blank：还有空格子）。
 * 只判到一趟的（快排、归并、基数）交 free 的动作：学生手上有事可做，可每一下不判对错
 */
export function nextOf(o, scene) {
  const s = o.sort;
  if (!s) return { acts: [], why: noSortText(o.id) };
  const row = rowOf(o);
  if (row.some((c) => c.value === '')) return { acts: [], why: '还有空着的格，页面算不了下一步', blank: true };
  if (row.some((c) => c.num == null)) return { acts: [], why: '格子里不全是数，页面排不了' };
  const st = sortStatus(o, scene);
  // from= 的那一排还空着：等它写满了照算（blank），不是永远判不了
  if (s.src) return st.done ? null : { acts: [], why: st.error ? `页面判不了：${st.error}` : `和 ${s.src} 做完第 ${st.target} ${unitOf(s.algo)}的样子还不一样`, ...(st.error && /空着/.test(st.error) ? { blank: true } : {}) };
  if (s.algo === 'shell' && !validD(s.d, row.length)) return { acts: [], why: `增量 d = ${s.d} 要是比格数（${row.length}）小的正整数` };
  if (st.done) return null;
  if (s.algo === 'insert' || s.algo === 'shell') {
    const d = s.algo === 'shell' ? s.d : 1;
    const steps = insertSteps(row, d);
    // 插过去，或者和链上前一张对调着往前换（只隔一张时两种是同一下）
    const acts = steps.flatMap((x) => [{ type: 'move', key: x.x.key, to: x.to, d }, { type: 'swap', a: x.x.key, b: x.pred.key }]);
    return { acts, why: insertWhy(steps[0], d, steps.length - 1) };
  }
  if (s.algo === 'bubble') {
    const can = bubbleSwaps(row);
    // 照王道的顺序接着做：还在引擎走的那条路上就取路上的下一下，走偏了从现在的样子重新从后往前扫（最靠后的那一对）
    const cur = row.map((c) => c.value);
    const tr = st.plan?.track || [];
    let k = -1;
    tr.forEach((x, i) => { if (sameTexts(x, cur)) k = i; });
    const nx = k >= 0 && tr[k + 1];
    const j = nx ? nx.findIndex((t, i) => norm(t) !== norm(cur[i])) : -1;
    const first = (j >= 0 && can.find((p) => p.a.slot === j + 1)) || can[0];
    const acts = [first, ...can.filter((p) => p !== first)].map((p) => ({ type: 'swap', a: p.a.key, b: p.b.key }));
    return { acts, why: `把第 ${first.a.slot}、${first.b.slot} 格的 ${first.a.value} 和 ${first.b.value} 交换（从后往前两两比，${first.b.value} 往前冒）` };
  }
  if (s.algo === 'select') {
    const x = selectStep(row);
    return { acts: [{ type: 'swap', a: x.min.key, b: x.at.key }], why: `把最小的 ${x.min.value}（第 ${x.min.slot} 格）和第 ${x.at.slot} 格的 ${x.at.value} 交换（第 ${x.k + 1} 趟：在第 ${x.at.slot}～${row.length} 格里选最小的）` };
  }
  const unit = unitOf(s.algo);
  const p = st.plan;
  const to = p && st.at != null && st.at < p.passes.length ? `下一${unit}做完该是 ${p.passes[st.at].join(' ')}` : st.error ? `页面算不了（${st.error}）` : `现在不是哪一${unit}结束后的样子`;
  return { acts: [{ type: 'swap', free: true }, { type: 'move', free: true }], why: `${ALGOS[s.algo]}页面只判到一${unit}，每一下不判对错；${to}` };
}

/**
 * 一下做了什么（「38 和 49 对调」「04 从第 10 格挪到第 5 格，76 往后跳 5 格」）；读不出是 null。
 * d：写明了希尔时这一趟的增量——动的几张不在一条链上就接一句（这一句跟着这一下走，试得多、事实被压掉时也留着）
 */
export function actWhy(row, act, d = null) {
  const by = (k) => row.find((c) => c.key === k);
  const name = (c) => (c.value === '' ? '空格子' : c.value);
  const off = () => (d > 1 && new Set(touched(row, act).map((c) => chainOf(c.slot, d))).size > 1 ? `，不在隔 ${d} 的同一条链上` : '');
  if (act?.type === 'swap') {
    const a = by(act.a), b = by(act.b);
    if (!a || !b) return null;
    if (a.value === '' || b.value === '') { const [x, e] = a.value === '' ? [b, a] : [a, b]; return `${name(x)} 从第 ${x.slot} 格挪进第 ${e.slot} 格的空格子`; }
    return `${a.value} 和 ${b.value} 对调，第 ${a.slot} 格 ↔ 第 ${b.slot} 格${off()}`;
  }
  if (act?.type === 'move') {
    const x = by(act.key);
    if (!x || applyAct(row, act) == null) return null;
    const lo = Math.min(x.slot, act.to), hi = Math.max(x.slot, act.to);
    const others = row.filter((c) => c.key !== x.key && c.slot >= lo && c.slot <= hi && (c.slot - x.slot) % (act.d || 1) === 0).map(name);
    const back = act.to < x.slot ? '往后' : '往前';
    const each = others.length > 1 ? '各' : '';
    const md = act.d || 1;
    return `${name(x)} 从第 ${x.slot} 格挪到第 ${act.to} 格，${listOf(others)} ${md > 1 ? `${each}${back}跳 ${md} 格` : `${each}${back}让一格`}${off()}`;
  }
  if (act?.type === 'write') { const x = by(act.key); return x ? `第 ${x.slot} 格写成 ${act.value === '' ? '空' : act.value}` : null; }
  return null;
}

// 这一下动了哪几格（swap 的两格；move 是它和给它让位的几张）
function touched(row, act) {
  if (act.type === 'swap') return [act.a, act.b].map((k) => row.find((c) => c.key === k)).filter(Boolean);
  const x = row.find((c) => c.key === act.key);
  if (!x) return [];
  const d = act.d || 1, lo = Math.min(x.slot, act.to), hi = Math.max(x.slot, act.to);
  return row.filter((c) => c.slot >= lo && c.slot <= hi && (c.slot - x.slot) % d === 0);
}
const labelOf = (plan, id) => plan?.variants.find((v) => v.id === id)?.label || null;

// 不是正确的那一下像哪种错：认得准的才说（引擎那边列了、这组数上分得出的常见错法；越过相等的），别的是 null
function misreadOf(o, act, row, st) {
  const s = o.sort;
  const n = row.length;
  if (s.algo === 'shell' || s.algo === 'insert') {
    const d = s.algo === 'shell' ? s.d : 1;
    const cells = touched(row, act);
    if (d > 1 && new Set(cells.map((c) => chainOf(c.slot, d))).size > 1) {
      // 动的几张不在一条链上、却在引擎那种错法切出来的同一段里：把相邻的当成了一组
      const blocks = shellBlocks(n, d);
      const blockOf = (slot) => blocks.findIndex(([from, len]) => slot - 1 >= from && slot - 1 < from + len);
      const label = labelOf(st.plan, 'shellBlock');
      if (label && new Set(cells.map((c) => blockOf(c.slot))).size === 1) return label;
      return null;
    }
    if (act.type !== 'move') return null;
    // 该插的那一张插过了头，停在和它相等的牌前面
    const step = insertSteps(row, d).find((x) => x.x.key === act.key);
    if (step && (act.d || 1) === d && act.to < step.to) {
      const passed = row.filter((c) => c.slot >= act.to && c.slot < step.to && (c.slot - step.to) % d === 0);
      if (passed.length && passed.every((c) => c.num === step.x.num)) return `把 ${step.x.value} 插到了和它相等的 ${listOf(passed.map((c) => c.value))} 前面（王道的代码只在 A[0] < A[j] 时后移：相等的不越过，该停在第 ${step.to} 格）`;
    }
    return null;
  }
  if (s.algo === 'bubble' && act.type === 'swap') {
    const [a, b] = [row.find((c) => c.key === act.a), row.find((c) => c.key === act.b)].sort((x, y) => x.slot - y.slot);
    // 挨着、前大后小，前面那张是它往前所有牌里最大的：从前往后、大的往后沉
    if (a && b && b.slot - a.slot === 1 && a.num > b.num && row.slice(0, a.slot).every((c) => c.num <= a.num)) return labelOf(st.plan, 'bubbleFront');
    return null;
  }
  if (s.algo === 'select') {
    const step = selectStep(row);
    if (!step) return null;
    // 把最小的插到前面、中间的各往后让一格
    if (act.type === 'move' && (act.d || 1) === 1 && act.key === step.min.key && act.to === step.at.slot) return labelOf(st.plan, 'selectShift');
    if (act.type === 'swap') {
      // 选最大的放到最后：后面已经到位的不算，前面最大的（引擎取第一个最大的）和最后一个没到位的换
      let e = n - 1;
      while (e > 0 && row.slice(0, e).every((c) => c.num <= row[e].num)) e--;
      let m = 0;
      for (let j = 1; j <= e; j++) if (row[j].num > row[m].num) m = j;
      const keys = [act.a, act.b];
      if (m !== e && keys.includes(row[m].key) && keys.includes(row[e].key)) return labelOf(st.plan, 'selectMax');
    }
  }
  return null;
}

/**
 * 判一下：{ legal, right, misread, why, next }。没写明排序、只判到一趟的、from= 的一排、往格里写数、有空格子：right 是 null（不判）。
 * 这个世界做不到的（legal: false）只有一种：分开排（split）以后学生把牌拖到别的泳道上——手指本来就放不上去
 */
export function checkOf(o, act, scene, { by = 'student' } = {}) {
  const row = rowOf(o);
  const why = actWhy(row, act, o.sort?.algo === 'shell' && !o.sort.src ? o.sort.d : null);
  const quiet = { legal: true, right: null, misread: null, why, next: null };
  if (!act || why == null) return { legal: true, right: null };
  if (by === 'student' && act.type === 'swap' && row.some((c) => c.row)) {
    const a = row.find((c) => c.key === act.a), b = row.find((c) => c.key === act.b);
    if (a.row !== b.row) return { legal: false, right: false, misread: null, why: `分开排着的时候只能在自己那一排里拖（${a.value} 在第 ${a.row} 条泳道，${b.value === '' ? '那个空格子' : b.value} 在第 ${b.row} 条）`, next: null };
  }
  const s = o.sort;
  if (!s || s.src || act.type === 'write' || !STEP_SORTS.includes(s.algo) || row.some((c) => c.num == null)) return quiet;
  const nx = nextOf(o, scene);
  if (nx && !nx.acts.length) return quiet; // 页面现在算不了下一步：不判
  const st = sortStatus(o, scene);
  if (nx === null) {
    const all = s.algo === 'shell' ? `隔 ${s.d} 的每条链都排好了，这一趟不用再动` : '已经排好了，不用再动';
    return { legal: true, right: false, misread: all, why, next: { why: '不用再动（已经做完了）', acts: [] } };
  }
  const mine = applyAct(row, act)?.join(',');
  const right = mine != null && nx.acts.some((a) => applyAct(row, a)?.join(',') === mine);
  if (right) return { legal: true, right: true, misread: null, why, next: null };
  let misread = null;
  try { misread = misreadOf(o, act, row, st); } catch { misread = null; }
  return { legal: true, right: false, misread, why, next: { why: nx.why, acts: nx.acts } };
}

// —— 写给老师的话 ——
const pairText = (p) => `${p.a.value}>${p.b.value}`;
/** 隔 d 的几条链现在怎么样：「隔 5 的 5 条链排好 3 条，没排好的：第 1 条 49>13、第 4 条 97>55」 */
export function chainsText(row, d) {
  const total = chainSlots(row.length, d).length;
  const bad = badPairs(row, d);
  if (!bad.length) return `隔 ${d} 的 ${total} 条链都递增`;
  const by = new Map();
  for (const p of bad) by.set(p.chain, [...(by.get(p.chain) || []), pairText(p)]);
  return `隔 ${d} 的 ${total} 条链排好 ${total - by.size} 条，没排好的：${[...by].map(([g, ps]) => `第 ${g} 条 ${ps.join('、')}`).join('；')}`;
}
/** 那一排和该等于的那一趟哪几格不一样：「第 3、8 格（该是 49′、65）」 */
function diffText(cur, want) {
  const at = want.map((t, i) => (norm(t) === norm(cur[i]) ? 0 : i + 1)).filter(Boolean);
  return `第 ${listOf(at)} 格（该是 ${listOf(at.map((i) => want[i - 1]))}）`;
}
const algoName = (s) => `${ALGOS[s.algo]}${s.algo === 'shell' ? ` d = ${s.d}${s.dv ? `（跟着 ${s.dv} 拨）` : ''}` : ''}`;
// 对着引擎看的那几句（现状和事实共用）。brief：事实里用，链没排好时不再说一遍「这一趟还没做完」（前一句已经列了没排好的链）
function statusBits(o, st, { brief = false } = {}) {
  const s = o.sort;
  const unit = unitOf(s.algo);
  const p = st.plan;
  const cur = textsOf(o);
  const bits = [];
  if (st.blank) return ['还有空着的格，页面判不了'];
  if (s.src) {
    if (st.error) return [`页面判不了（${st.error}）`];
    if (st.done) return [`和 ${s.src} 做完第 ${st.target} ${unit}的样子一样`];
    bits.push(`和 ${s.src} 做完第 ${st.target} ${unit}的样子不一样：${diffText(cur, p.passes[st.target - 1])}`);
  } else if (s.algo === 'shell') {
    if (st.done) bits.push(st.exact ? `这一趟做完了（和照王道的代码做一趟的结果一样${p.counts ? `：那样做比较 ${p.counts[0].cmp} 次、后移 ${p.counts[0].moves} 次` : ''}）`
      : `隔 ${s.d} 的每条链都递增了${p ? `，可和照王道的代码从 ${p.start.join(' ')} 做一趟的结果不一样（那是 ${p.passes[0].join(' ')}）` : ''}`);
    else if (!brief) bits.push('这一趟还没做完');
  } else if (st.done) {
    bits.push(st.exact || !p ? '整个排好了' : `排成从小到大了，可和照王道的代码排出来的不一样（那是 ${p.passes.at(-1).join(' ')}：相等的牌先后不同）`);
  } else if (st.at != null && st.at > 0) {
    // 连着几趟不用动：第 1～3 趟结束后都是这个样子
    const a = st.first ?? st.at, many = st.at > a;
    const cs = p.counts?.slice(a - 1, st.at);
    const c = cs?.length ? cs.reduce((x, y) => ({ cmp: x.cmp + y.cmp, moves: x.moves + y.moves })) : null;
    bits.push(`现在等于第 ${many ? `${a}～${st.at}` : st.at} ${unit}结束后的样子（${many ? `后面这几${unit}不用动；` : ''}一共 ${st.total} ${unit}${c ? `；照王道的代码${many ? `这 ${st.at - a + 1} 趟一共` : '这一趟'}比较 ${c.cmp} 次、后移 ${c.moves} 次` : ''}）`);
  } else if (st.at === 0) bits.push('还是起点的样子');
  else if (st.same != null) bits.push(`数和第 ${st.same} ${unit}结束后的一样，可相等的牌先后不一样`);
  else if (st.error) bits.push(`对不了每一${unit}（${st.error}）`);
  else if (p) bits.push(`不是哪一${unit}结束后的样子`);
  if (st.like) bits.push(`像是：${st.like.label}（和这种做法第 ${st.like.k} ${unit}的结果一样）`);
  return bits;
}

/** 舞台现状里那一句（types/array.js 的 pageBits）：在做哪种排序、对着引擎看现在什么样、正确的下一步 */
export function sortLine(o, scene) {
  const s = o.sort;
  if (!s) return null;
  const st = sortStatus(o, scene);
  const head = s.src ? `该等于 ${s.src} 做${algoName(s)}第 ${st.target} ${unitOf(s.algo)}结束后的样子` : `在做${algoName(s)}，从 ${s.from.map((t) => (t === '' ? '_' : t)).join(' ')} 起`;
  const bits = statusBits(o, st);
  let next = '';
  if (!s.src && !st.blank && !st.done && STEP_SORTS.includes(s.algo)) { try { const nx = nextOf(o, scene); if (nx?.acts.length) next = `；下一步：${nx.why}`; } catch { next = ''; } }
  return `${head}：${bits.join('；')}${next}`;
}

/**
 * 学生这一下以后写给老师的几句（规则的 facts）：有牌出了自己那条链、链 / 逆序对现在怎么样、对着引擎看到了哪、一共让了几格；
 * from= 的一排写满时和该等于的那一趟比。没写明排序的不写
 */
export function factsOf(before, after, act, scene) {
  const s = after?.sort;
  if (!s || !act) return [];
  const row = rowOf(after);
  const st = sortStatus(after, scene);
  if (s.src) return act.type === 'write' && !st.blank ? statusBits(after, st).map((b, i) => (i ? b : `${after.id} 写满了：${b}`)) : [];
  if (act.type === 'write' || st.blank || row.some((c) => c.num == null)) return [];
  const out = [];
  if (s.algo === 'shell' && before) {
    const was = new Map(rowOf(before).map((c) => [c.key, c.slot]));
    const gone = row.filter((c) => was.has(c.key) && chainOf(was.get(c.key), s.d) !== chainOf(c.slot, s.d));
    if (gone.length) out.push(`${gone.map((c) => `${c.value} 出了自己那条链（第 ${chainOf(was.get(c.key), s.d)} 条 → 第 ${chainOf(c.slot, s.d)} 条）`).join('，')}`);
    out.push(chainsText(row, s.d));
  } else out.push(`现在前大后小 ${inversions(row.map((c) => c.num))} 对`);
  out.push(...statusBits(after, st, { brief: true }));
  if (Number.isInteger(s.moved)) out.push(`一共让了 ${s.moved} 格`);
  return out;
}

/** 拨数扫一遍时的要点（规则的 brief）：隔 d 的链是不是都递增、坏在哪几对；没有 d 是 null */
export function briefOf(o) {
  const d = strideOf(o);
  const row = rowOf(o);
  if (!d || !validD(d, row.length) || row.some((c) => c.num == null)) return null;
  const bad = badPairs(row, d);
  return bad.length ? `链上坏 ${bad.length} 对：${bad.slice(0, 4).map(pairText).join('、')}${bad.length > 4 ? '…' : ''}` : '每条链都递增';
}

// 句子变换的计划（视觉第 5 批）：主动变被动、强调句、倒装还原……原句和变换以后的句子各写一行，用 [成分 词…] 括出成分，
// 页面按成分把两行配起来：谁挪到哪、哪些词变了、哪些是新加的框架词。纯函数，不碰 DOM。
import { tokenizeSentence, joinWords } from './entext.js';

// 比词：大小写、标点不算；弯撇号当直撇号（老师的字从不同地方来，两种混着用）
const norm = (s) => String(s).toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[^\p{L}\p{N}'\s-]/gu, '').replace(/\s+/g, ' ').trim();

// 一行 → 一段一段：{ key, role, text }（成分）或 { text, punct }（括号外面的词、标点）
function parseLine(src, which) {
  const s = String(src ?? '').trim();
  const out = [], count = {};
  let loose = [];
  const flush = () => { if (loose.length) { out.push({ text: joinWords(loose) }); loose = []; } };
  // [O the plan]：成分 O；[O=S The plan]：和另一行的 O 配对，在这一行里是主语（被动句里原来的宾语当了主语）
  for (const m of s.matchAll(/\[([A-Za-z][\w]*)(?:#(\d+))?(?:=([A-Za-z]\w*)?)?\s+([^[\]]*)\]|[[\]]|[^\s[\]]+/g)) {
    if (m[0] === '[' || m[0] === ']') {
      // 「[S~1 …」这种成分名后面跟着读不懂的记号的，说清楚是哪一个（以前一律说括号不配对）
      const after = s.slice(m.index);
      const tag = /^\[([A-Za-z]\w*)(\S*)\s/.exec(after);
      if (m[0] === '[' && tag && /~/.test(tag[2])) throw new Error(`${which} 里「[${tag[1]}${tag[2]}」：shift 里不用 ~（分裂结构的记号只在 parse 里用），成分写 [${tag[1]} …]，和另一行配对写 [${tag[1]}=S …]`);
      if (m[0] === '[' && tag && tag[2]) throw new Error(`${which} 里「[${tag[1]}${tag[2]}」读不懂：成分写 [S …]，同名的第二个写 [S#2 …]，和另一行的成分配对写 [O=S …]`);
      throw new Error(`${which} 的括号不配对，或者括号套了括号（这里一个成分一对方括号，不套）`);
    }
    if (m[1]) {
      flush();
      if (/=/.test(m[0].split(/\s/)[0]) && !m[3]) throw new Error(`${which} 里 [${m[1]}= …] 的 = 后面要写这一行里它是什么成分，比如 [O=S The plan]`);
      const name = m[1], role = m[3] || name, text = joinWords(tokenizeSentence(m[4]).map((t) => t.w));
      if (!text) throw new Error(`${which} 里 [${name} …] 是空的`);
      const n = m[2] ? Number(m[2]) : (count[name] = (count[name] || 0) + 1);
      out.push({ key: n === 1 ? name : `${name}#${n}`, role, text });
      continue;
    }
    for (const t of tokenizeSentence(m[0])) { if (t.word) loose.push(t.w); else { flush(); out.push({ text: t.w, punct: true }); } }
  }
  flush();
  if (!out.some((x) => x.key)) throw new Error(`${which} 里要用 [成分 词…] 括出成分，比如 [S The committee] [V approved] [O the plan].`);
  const keys = out.filter((x) => x.key).map((x) => x.key);
  if (new Set(keys).size < keys.length) throw new Error(`${which} 里有两个成分撞了名字（同名的第二个写成 A#2）`);
  return out;
}

/** 一行写回句子 */
export const lineText = (segs) => joinWords(segs.flatMap((x) => tokenizeSentence(x.text).map((t) => t.w)));

/** { from, to } 两行 → { from: [段], to: [段] }。两行的成分要一一对上（新加、去掉的词写在括号外面） */
export function parseShift({ from, to } = {}) {
  if (!String(from ?? '').trim() || !String(to ?? '').trim()) throw new Error('要写 from:（原句）和 to:（变换以后的句子），两行都用 [成分 词…] 括出成分');
  const a = parseLine(from, 'from'), b = parseLine(to, 'to');
  const ka = new Set(a.filter((x) => x.key).map((x) => x.key)), kb = new Set(b.filter((x) => x.key).map((x) => x.key));
  for (const k of kb) if (!ka.has(k)) throw new Error(`成分 ${k} 在 from 里没有：两行的成分要一一对上（新加的词写在括号外面）`);
  for (const k of ka) if (!kb.has(k)) throw new Error(`成分 ${k} 在 to 里没有：两行的成分要一一对上（去掉的词写在括号外面）`);
  return { from: a, to: b };
}

/**
 * 变换的计划：order（变换以后成分的先后）、moves（位置变了的：[{ key, from, to }]，按原句的先后）、
 * changed（词变了的：[{ key, before, after }]；句首的大小写、标点不算）、added（新加的框架词）、dropped（去掉的词）
 */
export function shiftPlan(s) {
  const A = s.from.filter((x) => x.key), B = s.to.filter((x) => x.key);
  const order = B.map((x) => x.key);
  const moves = [], changed = [];
  A.forEach((x, i) => {
    const j = order.indexOf(x.key);
    if (j !== i) moves.push({ key: x.key, from: i, to: j });
    if (norm(x.text) !== norm(B[j].text)) changed.push({ key: x.key, before: x.text, after: B[j].text });
  });
  const { added, dropped } = looseDiff(s.from, s.to);
  return { order, moves, changed, added, dropped };
}

// 括号外面的词：两行一个词一个词地比（最长公共子序列），对不上的连着的几个词并成一段——
// 「said that」→「said」只说去掉了 that，「It was … that」是新加的两段
function looseDiff(from, to) {
  const words = (segs) => segs.flatMap((x, seg) => (!x.key && !x.punct ? tokenizeSentence(x.text).filter((t) => t.word).map((t) => ({ w: t.w, n: norm(t.w), seg })) : []));
  const a = words(from), b = words(to);
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i].n === b[j].n ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const inA = new Set(), inB = new Set();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i].n === b[j].n) { inA.add(i); inB.add(j); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  const runs = (list, kept) => {
    const out = [];
    let cur = null;
    list.forEach((t, k) => {
      if (kept.has(k)) { cur = null; return; }
      if (cur && cur.seg === t.seg && cur.last === k - 1) { cur.ws.push(t.w); cur.last = k; } else { cur = { seg: t.seg, last: k, ws: [t.w] }; out.push(cur); }
    });
    return out.map((r) => joinWords(r.ws));
  };
  return { added: runs(b, inB), dropped: runs(a, inA) };
}

/**
 * decoys:（一行一个：V = 错的 | 错的）→ { decoys: { 成分: '错的 | 错的' }, problems: [给写的人看的话] }。
 * 只问变了形式的成分；写了没有的成分、没变的成分、写错格式的，报出来（不然这一步悄悄不问）
 */
export function shiftDecoys(text, s, plan = shiftPlan(s)) {
  const decoys = {}, problems = [];
  const keys = new Set(s.from.filter((x) => x.key).map((x) => x.key)), changed = new Set(plan.changed.map((c) => c.key));
  for (const line of String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^([\w#]+)\s*=\s*(.+)$/.exec(line);
    if (!m) { problems.push(`decoys: 一行写一个成分：V = 错的 | 错的（现在是「${line}」）`); continue; }
    if (!keys.has(m[1])) problems.push(`decoys: 里写了 ${m[1]}，句子里没有成分 ${m[1]}`);
    else if (!changed.has(m[1])) problems.push(`decoys: 里写了 ${m[1]}，可它的词在变换以后没变：只有变了形式的成分才问`);
    else decoys[m[1]] = m[2];
  }
  return { decoys, problems };
}

/** 学生排的顺序（成分的 key 的数组）：{ ok: true | false | null（没排完）, firstWrong?, text }。不说答案，只说第几个位置不对 */
export function judgeOrder(mine = [], s) {
  const { order } = shiftPlan(s);
  const left = order.length - order.filter((_, n) => mine[n] !== undefined && mine[n] !== null).length;
  if (left > 0) return { ok: null, text: `还有 ${left} 个没放。` };
  const i = order.findIndex((k, n) => mine[n] !== k);
  if (i < 0) return { ok: true, text: '顺序对了。' };
  return { ok: false, firstWrong: i, text: `第 ${i + 1} 个位置不对。` };
}

// shift 认的字段；id、upload 是组件外面的通用字段
const SHIFT_KEYS = ['title', 'q', 'from', 'to', 'mode', 'decoys', 'explain', 'id', 'upload'];
/** 写错的字段、mode 的取值：返回给写的人看的话（空数组就是没问题） */
export function shiftFieldProblems(fields = {}) {
  const out = [];
  for (const k of Object.keys(fields)) if (!SHIFT_KEYS.includes(k)) out.push(`shift 不认识字段 ${k}（认的是 ${SHIFT_KEYS.slice(0, 7).join('、')}）`);
  if (fields.mode !== undefined && !/^(show|do)?$/i.test(String(fields.mode).trim())) out.push(`mode 只能写 show（一步步播）或 do（学生自己排），现在是 ${fields.mode}`);
  return out;
}

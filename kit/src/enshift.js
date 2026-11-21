// 句子变换的计划（视觉第 5 批）：主动变被动、强调句、倒装还原……原句和变换以后的句子各写一行，用 [成分 词…] 括出成分，
// 页面按成分把两行配起来：谁挪到哪、哪些词变了、哪些是新加的框架词。纯函数，不碰 DOM。
import { tokenizeSentence, joinWords } from './entext.js';

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}'’\s-]/gu, '').replace(/\s+/g, ' ').trim();

// 一行 → 一段一段：{ key, role, text }（成分）或 { text, punct }（括号外面的词、标点）
function parseLine(src, which) {
  const s = String(src ?? '').trim();
  const out = [], count = {};
  let loose = [];
  const flush = () => { if (loose.length) { out.push({ text: joinWords(loose) }); loose = []; } };
  for (const m of s.matchAll(/\[([A-Za-z][\w]*)(?:#(\d+))?\s+([^[\]]*)\]|[[\]]|[^\s[\]]+/g)) {
    if (m[0] === '[' || m[0] === ']') throw new Error(`${which} 的括号不配对，或者括号套了括号（这里一个成分一对方括号，不套）`);
    if (m[1]) {
      flush();
      const role = m[1], text = joinWords(tokenizeSentence(m[3]).map((t) => t.w));
      if (!text) throw new Error(`${which} 里 [${role} …] 是空的`);
      const n = m[2] ? Number(m[2]) : (count[role] = (count[role] || 0) + 1);
      out.push({ key: n === 1 ? role : `${role}#${n}`, role, text });
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
  const looseOf = (segs) => segs.filter((x) => !x.key && !x.punct).map((x) => x.text);
  const la = looseOf(s.from), lb = looseOf(s.to);
  const has = (list, t) => list.some((x) => norm(x) === norm(t));
  return { order, moves, changed, added: lb.filter((t) => !has(la, t)), dropped: la.filter((t) => !has(lb, t)) };
}

/** 学生排的顺序（成分的 key 的数组）：{ ok: true | false | null（没排完）, firstWrong?, text }。不说答案，只说第几个位置不对 */
export function judgeOrder(mine = [], s) {
  const { order } = shiftPlan(s);
  if (mine.length < order.length) return { ok: null, text: `还有 ${order.length - mine.length} 个没放。` };
  const i = order.findIndex((k, n) => mine[n] !== k);
  if (i < 0) return { ok: true, text: '顺序对了。' };
  return { ok: false, firstWrong: i, text: `第 ${i + 1} 个位置不对。` };
}

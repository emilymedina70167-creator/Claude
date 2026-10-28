// 英语（语法）组件不碰 DOM 的部分：答案怎么比、句子怎么切成词、成分标注的写法和判分。纯函数，有测试（tests/entext.test.js）。
// 组件：cloze（填空，一句或一段里几个空）、errfind（点出用错的词再改）、parse（句子成分标注，能套从句）、drill（句型操练，一题一题做）。
// 判分只认写法上的差别：大小写（默认不管）、弯引号、多余空格、缩写（don't = do not）、句末标点；词不对就是不对，
// 不对时说第几个词开始不一样，不说应该是什么。

// —— 比对 ——

const QUOTES = [[/[‘’‚‛′]/g, "'"], [/[“”„‟″]/g, '"'], [/[–—]/g, '-'], [/ /g, ' ']];
// 缩写展开成全写再比：don't 和 do not 一样。's、'd 有两种意思，不展开
const CONTRACTIONS = [
  [/\bwon't\b/g, 'will not'], [/\bshan't\b/g, 'shall not'], [/\bcan't\b/g, 'can not'], [/\bcannot\b/g, 'can not'],
  [/\bain't\b/g, 'am not'], [/n't\b/g, ' not'], [/'m\b/g, ' am'], [/'re\b/g, ' are'], [/'ve\b/g, ' have'], [/'ll\b/g, ' will'],
];

/** 规范化：caseSensitive 时不改大小写；sentence 时去掉句末的 . ! ?（整句作答时可写可不写） */
export function normText(s, { caseSensitive = false, sentence = false } = {}) {
  let t = String(s ?? '');
  for (const [re, to] of QUOTES) t = t.replace(re, to);
  t = t.trim().replace(/\s+/g, ' ');
  if (!caseSensitive) t = t.toLowerCase();
  for (const [re, to] of CONTRACTIONS) t = t.replace(re, to);
  t = t.replace(/\s+([,;:.!?])/g, '$1').replace(/\s+/g, ' ').trim();
  if (sentence) t = t.replace(/[.!?。]+$/, '').trim();
  return t;
}

/** 可接受的几种写法：went | have gone（| 隔开） */
export const parseAlts = (s) => String(s ?? '').split('|').map((x) => x.trim()).filter(Boolean);

const wordsOf = (t) => t.split(/(?=[,;:.!?])|\s+/).map((x) => x.trim()).filter(Boolean);

/**
 * 学生写的 vs 几种可接受的答案：{ ok, empty, at（第几个词开始不一样，从 1 数）, near（只差大小写或标点）}
 * opts：{ caseSensitive, sentence }
 */
export function matchText(input, alts, opts = {}) {
  const given = normText(input, opts);
  if (!given) return { ok: false, empty: true };
  const list = (Array.isArray(alts) ? alts : parseAlts(alts)).map((a) => normText(a, opts));
  if (list.includes(given)) return { ok: true };
  // 只差大小写、标点：算错，但告诉学生是哪一种（区分大小写的题目、标点算分的题目才会走到这里）
  const loose = (x) => normText(x, { sentence: true }).replace(/[,;:.!?"'-]/g, '').replace(/\s+/g, ' ');
  const near = list.some((a) => loose(a) === loose(given));
  // 和最接近的答案比，第几个词开始不一样
  const gw = wordsOf(given);
  let at = 1;
  for (const a of list) {
    const aw = wordsOf(a);
    let k = 0;
    while (k < gw.length && k < aw.length && gw[k] === aw[k]) k++;
    at = Math.max(at, k + 1);
  }
  return { ok: false, near, at: Math.min(at, gw.length + 1) };
}

/** 不对时给学生的一句话（不泄露答案） */
export function textHint(r, { what = '答案' } = {}) {
  if (r.ok) return '';
  if (r.empty) return `还没写${what}`;
  if (r.near) return '词都对了，大小写或标点不对';
  return `从第 ${r.at} 个词开始不对`;
}

// —— 填空 cloze：{{went}}、{{has lived|has been living}} ——

/**
 * 「By the time we arrived, the film {{had started}} (start).」→ { parts: [{ text } | { blank: i, alts }], blanks: [alts] }。
 * 没有空、空里什么都没写都报错
 */
export function parseCloze(text) {
  const src = String(text ?? '');
  const parts = [];
  const blanks = [];
  const re = /\{\{([^{}]*)\}\}/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) parts.push({ text: src.slice(last, m.index) });
    const alts = parseAlts(m[1]);
    if (!alts.length) throw new Error(`第 ${blanks.length + 1} 个空 {{}} 里没写答案`);
    parts.push({ blank: blanks.length, alts });
    blanks.push(alts);
    last = re.lastIndex;
  }
  if (last < src.length) parts.push({ text: src.slice(last) });
  if (/\{\{|\}\}/.test(parts.filter((p) => p.text).map((p) => p.text).join(''))) throw new Error('{{ 和 }} 没有配对');
  if (!blanks.length) throw new Error('text 里要有空：把答案写成 {{答案}}，几种写法都对时 {{a|b}}');
  return { parts, blanks };
}

// —— 切词：errfind、parse 用 ——

/**
 * 句子切成词：[{ w, i, word（是不是词，标点不是）}]。缩写（don't）、连字符（well-known）、所有格（Tom's）算一个词；
 * 标点各自成一个，不能点、不能标
 */
export function tokenizeSentence(text) {
  const out = [];
  const re = /[A-Za-z0-9]+(?:['’][A-Za-z]+)*(?:-[A-Za-z0-9]+(?:['’][A-Za-z]+)*)*|[^\sA-Za-z0-9]/g;
  let m;
  while ((m = re.exec(String(text ?? '')))) out.push({ w: m[0], i: out.length, word: /[A-Za-z0-9]/.test(m[0]) });
  return out;
}

// —— 找错 errfind：wrong: are（第二次出现的写 are#2）——

/** 句子里用错的那个词是第几个（tokenizeSentence 的下标）。找不到、有歧义都报错 */
export function findWrong(text, wrong) {
  const toks = tokenizeSentence(text);
  const m = /^(.*?)(?:#(\d+))?$/.exec(String(wrong ?? '').trim());
  const w = m[1].trim(), nth = Number(m[2] || 0);
  if (!w) throw new Error('wrong: 要写句子里用错的那个词');
  const hits = toks.filter((t) => t.word && t.w.toLowerCase() === w.toLowerCase());
  if (!hits.length) throw new Error(`句子里没有「${w}」这个词（wrong: 要和 text 里的写法一样）`);
  if (hits.length > 1 && !nth) throw new Error(`「${w}」在句子里出现了 ${hits.length} 次：写 wrong: ${w}#2 指第几次`);
  if (nth && !hits[nth - 1]) throw new Error(`「${w}」只出现了 ${hits.length} 次，没有第 ${nth} 次`);
  return hits[(nth || 1) - 1].i;
}

// —— 成分标注 parse：[S The man [RC who lives next door]] [V gave] [O me] [O a book] ——

// 常用的成分（写法 → 中文名）；roles: 可以只列几种，也可以自己起名（RC=定语从句）
export const ROLES = {
  S: '主语', V: '谓语', O: '宾语', IO: '间接宾语', DO: '直接宾语', P: '表语', C: '补语', OC: '宾补', A: '状语', Attr: '定语', App: '同位语',
  RC: '定语从句', SC: '主语从句', ObC: '宾语从句', PC: '表语从句', AppC: '同位语从句', AdvC: '状语从句', NF: '非谓语', Conj: '连接词',
};

/** roles: 「S V O」或「S=主语 V=谓语 RC=定语从句」→ [{ key, name }] */
export function parseRoles(src, fallback = []) {
  const items = String(src ?? '').split(/[\s,，、]+/).filter(Boolean);
  const out = items.map((x) => { const [k, n] = x.split(/[=＝]/); return { key: k.trim(), name: (n || ROLES[k.trim()] || k).trim() }; });
  return out.length ? out : fallback.map((k) => ({ key: k, name: ROLES[k] || k }));
}

/**
 * 括号写法 → { text（原句）, tokens, spans: [{ role, from, to, depth }] }。from / to 是词的下标（含两端），可以套（从句里再分成分）。
 * 括号不配对、角色没写都报错。标点不算进成分的头尾（[S Tom ,] 记成只到 Tom）
 */
export function parseBrackets(src) {
  const s = String(src ?? '').trim();
  const words = [];
  const spans = [];
  const stack = [];
  const re = /\[([A-Za-z][\w]*)\s+|\]|[^\s[\]]+/g;
  let m;
  const pieces = [];
  while ((m = re.exec(s))) {
    if (m[1]) { stack.push({ role: m[1], from: null, depth: stack.length }); continue; }
    if (m[0] === ']') {
      const top = stack.pop();
      if (!top) throw new Error('多了一个 ]');
      if (top.from === null) throw new Error(`[${top.role} …] 里面没有词`);
      spans.push({ role: top.role, from: top.from, to: lastWord(top.from), depth: top.depth });
      continue;
    }
    // 一段文字：再按句子的切法切开（标点单独成词）
    for (const t of tokenizeSentence(m[0])) {
      const idx = words.length;
      words.push(t.w);
      if (t.word) for (const fr of stack) if (fr.from === null) fr.from = idx;
      pieces.push({ idx, word: t.word });
    }
  }
  if (stack.length) throw new Error(`[${stack.at(-1).role} 没有配对的 ]`);
  function lastWord(from) {
    for (let k = pieces.length - 1; k >= 0; k--) if (pieces[k].word && pieces[k].idx >= from) return pieces[k].idx;
    return from;
  }
  if (!spans.length) throw new Error('answer 里要用 [角色 词…] 标出成分，比如 [S The man] [V gave] [O me]');
  const tokens = tokenizeSentence(words.join(' '));
  return { text: joinWords(words), tokens, spans: spans.sort((a, b) => a.from - b.from || b.to - a.to) };
}

// 词连回句子：标点贴在前一个词后面
export function joinWords(words) {
  return words.reduce((s, w) => (!s ? w : /^[,;:.!?)\]}”’]$/.test(w) ? s + w : /[(\[{“‘]$/.test(s) ? s + w : `${s} ${w}`), '');
}

const key = (x) => `${x.role}:${x.from}-${x.to}`;

/**
 * 学生标的 vs 答案：{ ok, right: [span], wrongRole: [{ span, should }], missing: [span], extra: [span] }。
 * 范围一样、角色不一样算 wrongRole；答案里有、学生没标算 missing；学生标了答案里没有的范围算 extra。
 */
export function judgeSpans(mine = [], answer = []) {
  const ansByRange = new Map(answer.map((a) => [`${a.from}-${a.to}`, a]));
  const right = [], wrongRole = [], extra = [];
  const hit = new Set();
  for (const s of mine) {
    const a = ansByRange.get(`${s.from}-${s.to}`);
    if (!a) { extra.push(s); continue; }
    hit.add(key(a));
    if (a.role === s.role) right.push(s); else wrongRole.push({ span: s, should: a.role });
  }
  const missing = answer.filter((a) => !hit.has(key(a)));
  return { ok: !wrongRole.length && !missing.length && !extra.length, right, wrongRole, missing, extra };
}

/** 一段范围写成文字：「The man who lives next door」 */
export const spanText = (tokens, s) => joinWords(tokens.slice(s.from, s.to + 1).map((t) => t.w));

/** 判分结果给学生的一句话（不说答案） */
export function spansHint(r, roles = []) {
  if (r.ok) return '';
  const name = (k) => roles.find((x) => x.key === k)?.name || ROLES[k] || k;
  const bits = [];
  if (r.right.length) bits.push(`对了 ${r.right.length} 处`);
  if (r.wrongRole.length) bits.push(`${r.wrongRole.length} 处范围对了、成分标错了（${r.wrongRole.map((x) => name(x.span.role)).join('、')}）`);
  if (r.extra.length) bits.push(`${r.extra.length} 处范围不对`);
  if (r.missing.length) bits.push(`还少 ${r.missing.length} 处`);
  return bits.join('；');
}

// —— 句型操练 drill：一行一题 ——

/** 「- They built it. => It was built.｜It was built by them.」→ [{ q, alts }]（=> 后面几种都对时 | 隔开） */
export function parseDrill(lines) {
  const items = [];
  for (const raw of Array.isArray(lines) ? lines : String(lines ?? '').split('\n')) {
    const m = /^\s*[-*]\s+(.*?)\s*(?:=>|⇒|→)\s*(.+)$/.exec(raw);
    if (!m) continue;
    const alts = parseAlts(m[2]);
    if (!m[1] || !alts.length) continue;
    items.push({ q: m[1], alts });
  }
  if (!items.length) throw new Error('drill 要一行一题：- 原句 => 答案（几种都对时 a | b）');
  return items;
}

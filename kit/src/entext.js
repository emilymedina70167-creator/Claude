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

// —— 常见错答：「had started | !has started=用成了现在完成时」——
// 对的几种写法照旧用 | 隔开；! 开头的是常见的错答，= 后面是针对它的一句提示（学生看到，记录里也写给老师：页面看出来像是哪种错法）

/** 一个答案的写法 → { alts（对的）, wrongs: [{ text, why }]（常见错答）}。opts 用来查「错答和对的一样」 */
export function parseAnswer(s, opts = {}) {
  const alts = [];
  const wrongs = [];
  for (const part of parseAlts(s)) {
    if (!part.startsWith('!')) { alts.push(part); continue; }
    const body = part.slice(1);
    const i = body.indexOf('=');
    const text = (i < 0 ? body : body.slice(0, i)).trim();
    const why = i < 0 ? '' : body.slice(i + 1).trim();
    if (!text) throw new Error(`「${part}」：! 后面写常见的错答，比如 !has started=用成了现在完成时`);
    wrongs.push({ text, why });
  }
  for (const w of wrongs) if (alts.some((a) => normText(a, opts) === normText(w.text, opts))) throw new Error(`常见错答「${w.text}」和对的答案一样，不用列`);
  return { alts, wrongs };
}

/** 学生写的是不是哪一种常见错答：{ text, why } 或 null */
export function diagnose(input, wrongs = [], opts = {}) {
  const g = normText(input, opts);
  return g ? wrongs.find((w) => normText(w.text, opts) === g) || null : null;
}

/**
 * 选择式的空（第 3 批）：「that=逗号后面不用 that|*which|who」→ [{ text, ok, why }]。* 是对的（可以不止一个），= 后面是选了它时的提示
 */
export function parseChoices(inner) {
  const opts = parseAlts(inner).map((p) => {
    const ok = p.startsWith('*');
    const body = ok ? p.slice(1) : p;
    const i = body.indexOf('=');
    return { text: (i < 0 ? body : body.slice(0, i)).trim(), ok, why: i < 0 ? '' : body.slice(i + 1).trim() };
  }).filter((o) => o.text);
  if (opts.length < 2) throw new Error('选择式的空至少要两个选项：{{[that|*which|who]}}');
  if (!opts.some((o) => o.ok)) throw new Error('选择式的空要用 * 标出对的选项：{{[that|*which|who]}}');
  const seen = new Set();
  for (const o of opts) { const k = normText(o.text); if (seen.has(k)) throw new Error(`选项「${o.text}」写了两遍`); seen.add(k); }
  return opts;
}

// —— 填空 cloze：{{went}}、{{has lived|has been living}}、{{[that|*which]}} ——

/**
 * 「By the time we arrived, the film {{had started}} (start).」→ { parts: [{ text } | { blank: i, alts, wrongs, choices }], blanks: [alts], specs }。
 * 打字的空：alts 对的写法、wrongs 常见错答；选择式的空 {{[that|*which]}}：choices 选项（alts 是对的那几个）。
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
    const k = blanks.length + 1;
    const inner = m[1].trim();
    let spec;
    try {
      if (/^\[.*\]$/s.test(inner)) {
        const choices = parseChoices(inner.slice(1, -1));
        spec = { alts: choices.filter((c) => c.ok).map((c) => c.text), wrongs: choices.filter((c) => !c.ok && c.why).map((c) => ({ text: c.text, why: c.why })), choices };
      } else spec = { ...parseAnswer(inner), choices: null };
    } catch (e) { throw new Error(`第 ${k} 个空：${e.message}`); }
    if (!spec.alts.length) throw new Error(`第 ${k} 个空 {{}} 里没写答案`);
    parts.push({ blank: blanks.length, ...spec });
    blanks.push(spec.alts);
    last = re.lastIndex;
  }
  if (last < src.length) parts.push({ text: src.slice(last) });
  if (/\{\{|\}\}/.test(parts.filter((p) => p.text).map((p) => p.text).join(''))) throw new Error('{{ 和 }} 没有配对');
  if (!blanks.length) throw new Error('text 里要有空：把答案写成 {{答案}}，几种写法都对时 {{a|b}}');
  return { parts, blanks, specs: parts.filter((p) => p.blank !== undefined) };
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

/**
 * 英文里的词（和 tokenizeSentence 的「词」一样：缩写、连字符、所有格算一个），带在原文里的位置：[{ w, start, end }]。
 * punct：标点也算进来（word: false），phrase=", which" 要标逗号时用
 */
export function wordsIn(text, { punct = false } = {}) {
  const out = [];
  const re = punct ? /[A-Za-z0-9]+(?:['’][A-Za-z]+)*(?:-[A-Za-z0-9]+(?:['’][A-Za-z]+)*)*|[,;:.!?—–()"“”]/g : /[A-Za-z0-9]+(?:['’][A-Za-z]+)*(?:-[A-Za-z0-9]+(?:['’][A-Za-z]+)*)*/g;
  let m;
  while ((m = re.exec(String(text ?? '')))) out.push({ w: m[0], start: m.index, end: m.index + m[0].length, word: /[A-Za-z0-9]/.test(m[0]) });
  return out;
}
/** phrase 里有没有要标的标点（有就连标点一起数） */
export const phraseHasPunct = (text) => /[,;:.!?—–()"“”]/.test(String(text ?? ''));

const wkey = (w) => String(w).toLowerCase().replace(/’/g, "'");

/**
 * board mark 标英语句子里的词：sel 是 { kind: word, k } / { kind: words, a, b } / { kind: phrase, text, n }，
 * words 是那句英文按顺序的词（字符串）。返回 { from, to }（从 0 数，含两头）或 { error }
 */
export function wordSpan(sel, words) {
  const n = words.length;
  if (!n) return { error: '这里没有英文词' };
  if (sel.kind === 'word') return sel.k > n ? { error: `这里一共 ${n} 个词，没有第 ${sel.k} 个` } : { from: sel.k - 1, to: sel.k - 1 };
  if (sel.kind === 'words') return sel.b > n ? { error: `这里一共 ${n} 个词，没有第 ${sel.b} 个` } : { from: sel.a - 1, to: sel.b - 1 };
  const want = wordsIn(sel.text, { punct: phraseHasPunct(sel.text) }).map((x) => wkey(x.w));
  if (!want.length) return { error: `phrase「${sel.text}」里没有英文词，也没有标点` };
  const keys = words.map(wkey);
  const hits = [];
  for (let i = 0; i + want.length <= n; i++) if (want.every((w, j) => keys[i + j] === w)) hits.push(i);
  if (!hits.length) return { error: `这里没有「${sel.text}」${n <= 40 ? `（句子是：${words.join(' ')}）` : ''}` };
  if (sel.n && !hits[sel.n - 1]) return { error: `「${sel.text}」只出现了 ${hits.length} 次，没有第 ${sel.n} 次` };
  if (hits.length > 1 && !sel.n) return { error: `「${sel.text}」出现了 ${hits.length} 次：写 phrase="${sel.text}#2" 指第几次` };
  const i = hits[(sel.n || 1) - 1];
  return { from: i, to: i + want.length - 1 };
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

/**
 * errfind 的 decoys:（常见的点错的词）：「Neither=neither 本身没错，看谓语; the#2=…」→ [{ i（第几个记号）, w, why }]
 */
export function parseDecoys(text, src) {
  const out = [];
  for (const part of String(src ?? '').split(/[;；\n]/).map((x) => x.trim()).filter(Boolean)) {
    const i = part.indexOf('=');
    const w = (i < 0 ? part : part.slice(0, i)).trim();
    const why = i < 0 ? '' : part.slice(i + 1).trim();
    if (!why) throw new Error(`decoys 里「${part}」：写成 词=为什么它没错，比如 Neither=neither 本身没错，看谓语`);
    out.push({ i: findWrong(text, w), w: w.replace(/#\d+$/, ''), why });
  }
  return out;
}

// —— 成分标注 parse：[S The man [RC who lives next door]] [V gave] [O me] [O a book] ——

// 常用的成分（写法 → 中文名）；roles: 可以只列几种，也可以自己起名（RC=定语从句）
export const ROLES = {
  S: '主语', V: '谓语', O: '宾语', IO: '间接宾语', DO: '直接宾语', P: '表语', C: '补语', OC: '宾补', A: '状语', Attr: '定语', App: '同位语',
  RC: '定语从句', SC: '主语从句', ObC: '宾语从句', PC: '表语从句', AppC: '同位语从句', AdvC: '状语从句', NF: '非谓语', Conj: '连接词',
};
// 层次图、句子变换用的两个成分（视觉第 5 批）。不放进 ROLES：舞台的句子（stage/types/sentence.js）拿 ROLES 当它认得的成分名，那边的行为不变
export const MORE_ROLES = { Par: '插入语', Emp: '被强调的部分', Aux: '助动词' };
const ALL_ROLES = { ...ROLES, ...MORE_ROLES };
/** 成分的中文名（不认识的原样返回） */
export const roleName = (k) => ALL_ROLES[k] || k;
// 层次图里「另起一层」的：从句和插入语（主语、谓语这些短的成分留在所在的那一行里）
export const CLAUSE_ROLES = new Set(['RC', 'SC', 'ObC', 'PC', 'AppC', 'AdvC', 'Par']);

/** roles: 「S V O」或「S=主语 V=谓语 RC=定语从句」→ [{ key, name }] */
export function parseRoles(src, fallback = []) {
  const items = String(src ?? '').split(/[\s,，、]+/).filter(Boolean);
  const out = items.map((x) => { const [k, n] = x.split(/[=＝]/); return { key: k.trim(), name: (n || ALL_ROLES[k.trim()] || k).trim() }; });
  return out.length ? out : fallback.map((k) => ({ key: k, name: ALL_ROLES[k] || k }));
}

// 读不懂的「[成分名」：说哪里写错了、该怎么写
function badTag(t) {
  const tag = t.slice(1);
  if (!tag) return '「[」后面要紧跟成分名，比如 [S The man]（[ 和成分名之间不空格）';
  if (/~(?!\d)/.test(tag)) return `「${t}」：~ 后面要写数字，同一个数字的两段是分裂结构，比如 [S~1 …] … [AppC~1 …]`;
  if (/=/.test(tag)) return `「${t}」：parse 里不写 =（[O=S …] 是 shift 的配对写法），成分就写 [S …]${/~\d/.test(tag) ? '，分裂结构写 [S~1 …]' : ''}`;
  if (/#/.test(tag)) return `「${t}」：parse 里不写 #（#2 是 shift 里同名成分的写法），同名的成分照写 [${tag.split('#')[0]} …]`;
  return `「${t}」读不懂：成分写成 [S The man]，成分名后面空一格再写词`;
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
  // [S~1 …]：~1 是分裂结构的记号（同一个号的两段本来是连着的）
  // 第二种：「[」后面跟着读不懂的成分名（[S~ …]、[S~1=O …]、[A#2 …]）——单独说，不让它落到后面成了「多了一个 ]」
  const re = /\[([A-Za-z][\w]*)(?:~(\d+))?\s+|(\[[^\s\]]*)|\]|[^\s[\]]+/g;
  let m;
  const pieces = [];
  while ((m = re.exec(s))) {
    if (m[3] !== undefined) throw new Error(badTag(m[3]));
    if (m[1]) { stack.push({ role: m[1], from: null, depth: stack.length, ...(m[2] ? { join: Number(m[2]) } : {}) }); continue; }
    if (m[0] === ']') {
      const top = stack.pop();
      if (!top) throw new Error('多了一个 ]');
      if (top.from === null) throw new Error(`[${top.role} …] 里面没有词`);
      spans.push({ role: top.role, from: top.from, to: lastWord(top.from), depth: top.depth, ...(top.join ? { join: top.join } : {}) });
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
  const sorted = spans.sort((a, b) => a.from - b.from || b.to - a.to);
  joinsOf(sorted); // ~n 只写了一段、写了三段：这里就报
  return { text: joinWords(words), tokens, spans: sorted };
}

/** 成分写回括号写法（记录、草稿里给老师看）：parseBrackets 的反过来，分裂结构带着 ~n */
export function spansMarkup(tokens, spans) {
  const words = tokens.map((t) => t.w);
  const open = words.map(() => []), close = words.map(() => 0);
  for (const sp of [...spans].sort((a, b) => a.from - b.from || b.to - a.to)) { open[sp.from].push(sp.join ? `${sp.role}~${sp.join}` : sp.role); close[sp.to]++; }
  return joinWords(words.map((w, i) => `${open[i].map((r) => `[${r} `).join('')}${w}${']'.repeat(close[i])}`));
}

// —— 层次：括号套出来的树、一层层的行 ——

/** 成分按包含关系排成树：[{ index（在 spans 里的下标）, children }]，同一层按位置。交叉的范围（学生标出来的可能有）报错 */
export function nestSpans(spans) {
  const order = spans.map((_, i) => i).sort((a, b) => spans[a].from - spans[b].from || spans[b].to - spans[a].to || (spans[a].depth ?? 0) - (spans[b].depth ?? 0) || a - b);
  const root = { index: -1, children: [] }, stack = [root];
  for (const i of order) {
    const sp = spans[i];
    while (stack.length > 1 && spans[stack.at(-1).index].to < sp.from) stack.pop();
    const top = stack.at(-1);
    if (top.index >= 0 && sp.to > spans[top.index].to) throw new Error(`「${spans[top.index].role}」和「${sp.role}」两段的范围交叉了（一段要么整个在另一段里面，要么在外面）`);
    const node = { index: i, children: [] };
    top.children.push(node); stack.push(node);
  }
  return root.children;
}

/**
 * 给层次图排行：主干的词在最外面，每个从句、插入语另起缩进的一行；fold 里的（spans 的下标）收成一个「…」，前后的词接回一行。
 * 回 [{ depth, clause（这一行属于哪个从句，最外层是 null）, pieces: [{ from, to, role, span } | { folded: 下标, role }] }]
 */
export function layerRows(p, { fold = [] } = {}) {
  const { spans, tokens } = p, folded = new Set(fold);
  const clauses = spans.map((s, i) => i).filter((i) => CLAUSE_ROLES.has(spans[i].role)).sort((a, b) => spans[a].from - spans[b].from || spans[b].to - spans[a].to);
  const inside = (i, t) => spans[i].from <= t && t <= spans[i].to;
  const rows = [];
  const push = (key, depth, piece) => {
    let row = rows.at(-1);
    if (!row || row.clause !== key) { row = { depth, clause: key, pieces: [] }; rows.push(row); }
    const last = row.pieces.at(-1);
    if (last && piece.folded === undefined && last.folded === undefined && last.span === piece.span && last.to === piece.from - 1) last.to = piece.to; else row.pieces.push(piece);
  };
  for (let t = 0; t < tokens.length; t++) {
    const chain = clauses.filter((i) => inside(i, t)); // 从外到里
    const cut = chain.findIndex((i) => folded.has(i));
    if (cut >= 0) {
      // 折起来的从句：只在它的第一个词那里放一个「…」，放在它外面那一层的行里
      const f = chain[cut];
      if (t === spans[f].from) push(cut ? chain[cut - 1] : null, cut, { folded: f, role: spans[f].role });
      continue;
    }
    const key = chain.length ? chain.at(-1) : null;
    // 这个词的成分：包着它的、不是从句的、最里面的那一个——而且要整个在这一行的从句里面（外面的主语不算从句里的词的成分）
    let own = -1;
    spans.forEach((s, i) => {
      if (CLAUSE_ROLES.has(s.role) || !inside(i, t)) return;
      if (key !== null && !(s.from >= spans[key].from && s.to <= spans[key].to)) return;
      if (own < 0 || s.to - s.from < spans[own].to - spans[own].from || (s.to - s.from === spans[own].to - spans[own].from && (s.depth ?? 0) > (spans[own].depth ?? 0))) own = i;
    });
    push(key, chain.length, { from: t, to: t, role: own >= 0 ? spans[own].role : null, span: own });
  }
  // 标点放在哪一行（2026-11-21 改）：
  //   一行开头的标点（句首状语从句后面的逗号）跟着上一行收尾，不起这一行；
  //   最后只剩标点的一行（句末的点）回到它自己那一层最近的一行（主干的点留在主干，以前挪进了最后一个从句）；
  //   中间只剩标点的一行并到上一行的末尾。只是标点的一段标 punct（画的时候前面不空格）。
  // 一个从句被里面的从句隔成两截时，后一截标 cont（接着上面那一块）
  const isPunct = (x) => x.folded === undefined && !x.role && tokens.slice(x.from, x.to + 1).every((tk) => !tk.word);
  for (const row of rows) for (const x of row.pieces) if (isPunct(x)) x.punct = true;
  const out = [], seen = new Set();
  rows.forEach((row, k) => {
    let lead = 0;
    while (lead < row.pieces.length && row.pieces[lead].punct) lead++;
    if (lead === row.pieces.length && out.length) {
      const home = k === rows.length - 1 ? out.findLast((r) => r.clause === row.clause) || out.at(-1) : out.at(-1);
      home.pieces.push(...row.pieces.map((x) => ({ ...x, tail: true })));
      return;
    }
    if (lead && out.length) { out.at(-1).pieces.push(...row.pieces.slice(0, lead).map((x) => ({ ...x, tail: true }))); row.pieces = row.pieces.slice(lead); }
    if (row.clause !== null) { if (seen.has(row.clause)) row.cont = true; seen.add(row.clause); }
    out.push(row);
  });
  return out;
}

/** 分裂结构：~n 一样的两段。回 [{ id, parts: [下标, 下标] }]；一个号只有一段、多于两段报错 */
export function joinsOf(spans) {
  const by = new Map();
  spans.forEach((s, i) => { if (s.join) by.set(s.join, [...(by.get(s.join) || []), i]); });
  const out = [];
  for (const [id, parts] of [...by].sort((a, b) => a[0] - b[0])) {
    if (parts.length < 2) throw new Error(`~${id} 只有一段：分裂的两段都要写 ~${id}（[S~${id} The rumor] … [AppC~${id} that …]）`);
    if (parts.length > 2) throw new Error(`~${id} 写了 ${parts.length} 段：一个记号只连两段`);
    out.push({ id, parts });
  }
  return out;
}
/**
 * 连分裂结构时学生点的是哪一段：点的那一段自己带 ~n 就是它；不然往外找最近的、包着它（或包着点的那个词）的带 ~n 的一段
 * （点从句里的词就是点那个从句）；都没有：点了成分就是那个成分，点了没标的词是 -1（什么都不选）。
 */
export function joinTarget(spans, i, token) {
  if (i >= 0 && spans[i]?.join) return i;
  const lo = i >= 0 ? spans[i].from : token, hi = i >= 0 ? spans[i].to : token;
  let best = -1;
  spans.forEach((sp, k) => {
    if (k === i || !sp.join || !(sp.from <= lo && hi <= sp.to)) return;
    if (best < 0 || sp.to - sp.from < spans[best].to - spans[best].from) best = k;
  });
  return best >= 0 ? best : i;
}
/** 学生连的（[[下标, 下标], …]）对不对：{ ok: true | false | null（一对都没连）, text } */
export function judgeJoins(mine = [], joins = []) {
  if (!mine.length) return { ok: null, text: '还没连：先点一段，再点和它本来连着的那一段。' };
  const pk = ([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const want = new Set(joins.map((j) => pk(j.parts))), got = new Set(mine.map(pk));
  const wrong = [...got].filter((k) => !want.has(k)).length, missing = [...want].filter((k) => !got.has(k)).length;
  if (wrong) return { ok: false, text: `有 ${wrong} 对连错了：这两段不是一家。` };
  if (missing) return { ok: false, text: `还有 ${missing} 对没连。` };
  return { ok: true, text: '对，这两段本来是连着的。' };
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
  const name = (k) => roles.find((x) => x.key === k)?.name || ALL_ROLES[k] || k;
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
    const { alts, wrongs } = parseAnswer(m[2], { sentence: true });
    if (!m[1] || !alts.length) continue;
    items.push({ q: m[1], alts, wrongs });
  }
  if (!items.length) throw new Error('drill 要一行一题：- 原句 => 答案（几种都对时 a | b）');
  return items;
}

// —— 分步拆句 parse 的 steps:：「V | S O | RC」——

/**
 * 「V | S O | RC」→ [[V], [S, O], [RC]]：一步标哪几种成分。每一步的成分在答案里都要有；
 * 答案里有、哪一步都没问到的成分最后照样画出来（不判）
 */
export function parseSteps(src, spans = []) {
  const groups = String(src ?? '').split('|').map((g) => g.trim().split(/[\s,，、]+/).filter(Boolean)).filter((g) => g.length);
  if (!groups.length) throw new Error('steps: 写每一步标哪几种成分，用 | 隔开，比如 steps: V | S O | RC');
  const have = new Set(spans.map((s) => s.role));
  groups.forEach((g, i) => {
    const miss = g.filter((r) => !have.has(r));
    if (miss.length) throw new Error(`steps 第 ${i + 1} 步的 ${miss.join('、')} 在 answer 里没有标`);
  });
  const all = groups.flat();
  const dup = all.find((r, i) => all.indexOf(r) !== i);
  if (dup) throw new Error(`${dup} 在 steps 里写了两次：一种成分只在一步里标`);
  return groups;
}

// —— 意群断句 chunk：「The man who lives next door / gave me a book / that I had wanted | for years.」——
// / 是一定要切的地方，| 是切不切都行的地方。切口在两个词之间：用切口后面那个词的下标表示

/** → { tokens（去掉 / 和 | 的句子，tokenizeSentence 的样子）, must: [切口], may: [切口], gaps: [能切的地方] } */
export function parseChunk(text) {
  const raw = tokenizeSentence(text);
  const tokens = [];
  const must = [], may = [];
  let mark = null;
  for (const t of raw) {
    if (t.w === '/' || t.w === '|') { mark = mark === '/' ? '/' : t.w; continue; }
    if (mark && tokens.length) (mark === '/' ? must : may).push(tokens.length);
    mark = null;
    tokens.push({ ...t, i: tokens.length });
  }
  // 能切的地方：每个词前面（第一个词除外）
  const gaps = tokens.filter((t, i) => i > 0 && t.word).map((t) => t.i);
  const fix = (g) => (gaps.includes(g) ? g : gaps.find((x) => x > g) ?? g); // 切在标点前面的，挪到标点后面的那个词前
  const M = [...new Set(must.map(fix))], Y = [...new Set(may.map(fix))].filter((g) => !M.includes(g));
  if (!M.length) throw new Error('text 里用 / 标出要切的地方（切不切都行的地方用 |），比如 The man who lives next door / gave me a book.');
  return { tokens, must: M, may: Y, gaps, text: joinWords(tokens.map((t) => t.w)) };
}

/** 学生切的 vs 答案：{ ok, missing（还要切的）, extra（不该切的）} */
export function judgeChunks(cuts, { must, may }) {
  const S = new Set(cuts);
  const missing = must.filter((g) => !S.has(g));
  const extra = [...S].filter((g) => !must.includes(g) && !may.includes(g)).sort((a, b) => a - b);
  return { ok: !missing.length && !extra.length, missing, extra };
}

/** 不对时的一句话：「door 后面还要切一刀；me 和 a 之间不用切」（不说切几刀、不给答案） */
export function chunkHint(r, tokens) {
  if (r.ok) return '';
  const before = (g) => { let k = g - 1; while (k > 0 && !tokens[k].word) k--; return tokens[k]?.w || ''; };
  const bits = [];
  if (r.missing.length) bits.push(`「${before(r.missing[0])}」后面还要切一刀${r.missing.length > 1 ? `（一共还少 ${r.missing.length} 刀）` : ''}`);
  if (r.extra.length) bits.push(`「${before(r.extra[0])} ${tokens[r.extra[0]]?.w || ''}」是一个意群，中间不用切${r.extra.length > 1 ? `（多切了 ${r.extra.length} 刀）` : ''}`);
  return bits.join('；');
}

/** 切好的意群：[[词…]]（给译文框、记录用） */
export function chunksOf(tokens, cuts) {
  const set = new Set(cuts);
  const out = [[]];
  tokens.forEach((t, i) => { if (set.has(i) && out.at(-1).length) out.push([]); out.at(-1).push(t.w); });
  return out.map((ws) => joinWords(ws));
}

// —— 连线 link（第 6 批）：点一个词，再点它连着的那个词（关系词 → 先行词、非谓语 → 逻辑主语、谓语 → 主语的中心词）——

/**
 * text 是句子；pairs 是「who -> brother; gave -> man」（几条用 ; 隔开，出现几次的词写 the#2）；
 * 常见的连错写成「!who -> Beijing=就近的名词不一定是先行词」。返回 { tokens, pairs: [{ from, to }], wrongs: [{ from, to, why }] }（下标是 tokenizeSentence 的）
 */
export function parseLink(text, src) {
  const tokens = tokenizeSentence(text);
  const pairs = [], wrongs = [];
  for (const raw of String(src ?? '').split(/[;；\n]/).map((x) => x.trim()).filter(Boolean)) {
    const bad = raw.startsWith('!');
    const body = bad ? raw.slice(1) : raw;
    const eq = bad ? body.indexOf('=') : -1;
    const pair = (eq < 0 ? body : body.slice(0, eq)).trim();
    const m = /^(.+?)\s*(?:->|→|=>)\s*(.+)$/.exec(pair);
    if (!m) throw new Error(`「${raw}」：写成 词 -> 它连着的词，比如 who -> brother`);
    const from = findWrong(text, m[1].trim());
    const to = findWrong(text, m[2].trim());
    if (from === to) throw new Error(`「${raw}」：两头是同一个词`);
    if (bad) wrongs.push({ from, to, why: eq < 0 ? '' : body.slice(eq + 1).trim() });
    else pairs.push({ from, to });
  }
  if (!pairs.length) throw new Error('pairs: 至少写一条：词 -> 它连着的词，比如 who -> brother');
  const seen = new Set();
  for (const p of pairs) { if (seen.has(p.from)) throw new Error(`「${tokens[p.from].w}」连了两条：一个词只连一条`); seen.add(p.from); }
  return { tokens, pairs, wrongs };
}

/** 学生连的 vs 答案：{ ok, right, wrong: [{ from, to, why }], missing（还差几条）} */
export function judgeLinks(mine, { pairs, wrongs = [] }) {
  const right = mine.filter((m) => pairs.some((p) => p.from === m.from && p.to === m.to));
  const wrong = mine.filter((m) => !right.includes(m)).map((m) => ({ ...m, why: wrongs.find((w) => w.from === m.from && w.to === m.to)?.why || '' }));
  const missing = pairs.filter((p) => !mine.some((m) => m.from === p.from && m.to === p.to)).length;
  return { ok: !wrong.length && !missing && right.length === pairs.length, right, wrong, missing };
}

/** 不对时的一句话（不说答案）：「who 连错了：…；还有 1 条没连」 */
export function linkHint(r, tokens) {
  if (r.ok) return '';
  const bits = r.wrong.map((w) => `「${tokens[w.from].w}」连到「${tokens[w.to].w}」不对${w.why ? `：${w.why}` : ''}`);
  if (r.missing) bits.push(`还有 ${r.missing} 条没连`);
  return bits.join('；');
}

// —— 拿不准时问 Claude（drill 整句改写）：页面判错、又不是已知的错答时，可能只是换了个说法 ——

/** 发给 Claude 的一小段：题目、标准答案、学生写的；只要它回一行 JSON（几百个字，一两千 token） */
export function regradePrompt({ q, task = '', alts = [], given }) {
  return [
    '你在帮英语练习的页面复核一道整句改写题（考研英语一的语法）。页面按标准答案逐字比，判了错；请判断学生的句子是不是其实也对（只是换了说法、语序），还是真的错了。',
    task ? `题目要求：${task}` : '',
    `原句：${q}`,
    `标准答案：${alts.join(' / ')}`,
    `学生写的：${given}`,
    '标准：语法正确、完成了题目要求的变换、意思和原句一样，就算对；拼写错、时态语态错、没按要求变换都算错。',
    '只回一行 JSON：{"ok": true 或 false, "why": "一句中文：对的话说为什么也行；错的话指出哪里不对，但不要写出正确答案"}',
  ].filter(Boolean).join('\n');
}

/** Claude 的回答 → { ok, why } 或 null（看不懂就当没复核） */
export function parseRegrade(text) {
  const m = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return typeof j.ok === 'boolean' ? { ok: j.ok, why: String(j.why || '').slice(0, 200) } : null;
  } catch { return null; }
}

/* ---------------- 翻译按要点判 ----------------
 * 翻译判不了通不通顺，但判得了「该译出来的意思译出来没有」：老师写下这句的几个要点（英文那几个词 = 中文里要有的说法，几种说法用 | 隔开），
 * 页面查学生的译文里有没有。没译出来时只说是哪几个英文词（不给中文答案）；!错的说法 = 提示：常见的误译；order：要点在中文里的先后。
 * 通顺、地道交给课堂 Claude 看（作答照常发给它）。
 */

// 去掉空白和标点再比：学生多打一个逗号、空格不算错
const zhNorm = (s) => String(s ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
// 「到…为止」：省略号是中间可以有别的字（最多 15 个）
function zhPattern(alt) {
  const parts = String(alt).split(/…+|\.{3,}|⋯+/).map(zhNorm).filter(Boolean);
  if (!parts.length) return null;
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(parts.map(esc).join('.{0,15}'), 'u');
}

/** 要点那几行（- by 1830 = 到…为止 | 截至；- !开始变成 = 提示）和 order 一行 → { points, wrongs, order, problems } */
export function parsePoints(lines = [], orderLine = '') {
  const points = [];
  const wrongs = [];
  const problems = [];
  for (const raw of lines) {
    const line = String(raw).replace(/^\s*[-*]\s*/, '').trim();
    if (!line) continue;
    const m = /^(.+?)\s*[=＝]\s*(.+)$/.exec(line);
    if (!m) { problems.push(`要点「${line.slice(0, 30)}」要写成「英文那几个词 = 中文说法 | 另一种说法」`); continue; }
    if (m[1].startsWith('!') || m[1].startsWith('！')) {
      const alts = m[1].slice(1).split(/[|｜]/).map((x) => x.trim()).filter(Boolean);
      const re = alts.map(zhPattern).filter(Boolean);
      if (!re.length) problems.push(`误译「${line.slice(0, 30)}」没写错的说法`);
      else wrongs.push({ alts, re, why: m[2].trim() });
      continue;
    }
    const alts = m[2].split(/[|｜]/).map((x) => x.trim()).filter(Boolean);
    const re = alts.map(zhPattern).filter(Boolean);
    if (!re.length) { problems.push(`要点「${m[1]}」没写中文说法`); continue; }
    points.push({ label: m[1].trim(), alts, re });
  }
  const order = [];
  if (String(orderLine || '').trim()) {
    const names = String(orderLine).split(/\s*[<＜]\s*/).map((x) => x.trim()).filter(Boolean);
    const idx = names.map((n) => points.findIndex((p) => p.label.toLowerCase() === n.toLowerCase()));
    if (names.length < 2 || idx.some((i) => i < 0)) problems.push(`order 要写成「要点 < 要点」，用要点左边的英文：${points.map((p) => p.label).join('、') || '（还没有要点）'}`);
    else for (let i = 1; i < idx.length; i++) order.push([idx[i - 1], idx[i]]);
  }
  if (!points.length) problems.push('translate 至少要有一个要点（points: 下面一行一条：- 英文那几个词 = 中文说法）');
  return { points, wrongs, order, problems };
}

/** 判一份译文：{ ok, empty, hits: [bool], missing: [英文 label], misread: 提示 | null, orderBad: [前, 后] | null } */
export function judgeTranslation(text, { points = [], wrongs = [], order = [] } = {}) {
  const t = zhNorm(text);
  if (!t) return { ok: false, empty: true, hits: points.map(() => false), missing: points.map((p) => p.label), misread: null, orderBad: null };
  const at = points.map((p) => { let best = -1; for (const re of p.re) { const m = re.exec(t); if (m && (best < 0 || m.index < best)) best = m.index; } return best; });
  const hits = at.map((x) => x >= 0);
  const missing = points.filter((_, i) => !hits[i]).map((p) => p.label);
  const w = wrongs.find((x) => x.re.some((re) => re.test(t)));
  let orderBad = null;
  for (const [a, b] of order) if (hits[a] && hits[b] && at[a] > at[b]) { orderBad = [points[a].label, points[b].label]; break; }
  return { ok: !missing.length && !w && !orderBad, empty: false, hits, missing, misread: w ? w.why : null, orderBad };
}

/** 给学生看的一句（不给中文答案）：要点几个对了、哪几个英文词的意思没译出来 / 顺序 / 常见误译 */
export function translationHint(r, n) {
  if (r.empty) return '先写出译文。';
  const parts = [];
  if (r.misread) parts.push(r.misread);
  if (r.missing.length) parts.push(`${r.missing.map((x) => `「${x}」`).join('、')}的意思还没译出来`);
  if (r.orderBad) parts.push(`「${r.orderBad[0]}」的意思要译在「${r.orderBad[1]}」前面`);
  return `要点 ${n - r.missing.length} / ${n}${parts.length ? `：${parts.join('；')}` : ''}`;
}

/* ---------------- 生词（点一下看意思） ----------------
 * 课堂 Claude 在段里写一个 gloss 块：一行一个「词 = 意思」。页面在这一段的英文里找到这些词，画一道虚线，点一下当场显示意思，
 * 不调用 Claude；点过的词记一条动作，下课时进「要记的」（记忆点，按 1 → 3 → 7 → 14 → 30 天想一遍）。
 */

/** gloss 块的文字 → { items: [{ word, gloss }], problems } */
export function parseGloss(src) {
  const items = [];
  const problems = [];
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.replace(/^\s*[-*]\s*/, '').trim();
    if (!line || /^(id|title)\s*[:：]/i.test(line)) continue;
    const m = /^([A-Za-z][A-Za-z' .\-/]*?)\s*[=＝:：]\s*(.+)$/.exec(line);
    if (!m) { problems.push(`看不懂「${line.slice(0, 30)}」：一行写一个「英文词 = 中文意思」，比如 breakthrough = 突破`); continue; }
    const word = m[1].trim().replace(/\s+/g, ' ');
    if (items.some((x) => x.word.toLowerCase() === word.toLowerCase())) continue;
    items.push({ word, gloss: m[2].trim() });
  }
  if (!items.length && !problems.length) problems.push('gloss 块是空的：一行写一个「英文词 = 中文意思」');
  return { items, problems };
}

/**
 * 在一段英文里找这些词：返回 [{ index, length, item }]（按出现的先后，不重叠）。
 * 单个词也认常见的变形（predict → predicts / predicted / predicting），词组按原样（中间的空白多少不论），不分大小写
 */
export function glossMatches(text, items = []) {
  const t = String(text ?? '');
  if (!t || !items.length) return [];
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sorted = [...items].sort((a, b) => b.word.length - a.word.length);
  const src = sorted.map((it) => {
    const w = esc(it.word).replace(/\\? /g, '\\s+');
    return /\s/.test(it.word) ? `(${w})` : `(${w}(?:s|es|d|ed|ing)?)`;
  }).join('|');
  const re = new RegExp(`(?<![A-Za-z'])(?:${src})(?![A-Za-z'])`, 'gi');
  const out = [];
  for (let m; (m = re.exec(t));) {
    const k = m.slice(1).findIndex((x) => x !== undefined);
    out.push({ index: m.index, length: m[0].length, item: sorted[k] });
  }
  return out;
}

// —— 平行结构 parallel（视觉第 5 批）：She likes [reading novels], [writing letters], and [to swim]. ——

const COORD = new Set(['and', 'or', 'but', 'nor', 'yet']);
const zhCount = (n) => ['零', '一', '两', '三', '四', '五', '六', '七', '八'][n] || String(n);

/**
 * 方括号括出并列的几项 → { text, tokens, items: [{ from, to }], stem: { from, to } | null（公共的开头）, conj: 最后一项前面那个并列连词的下标（没有是 -1）}。
 * 括号不配对、套了括号、不到两项都报错
 */
export function parseParallel(src) {
  const s = String(src ?? '').trim();
  if (!s) throw new Error('要写 text:（句子，用方括号括出并列的几项）');
  const words = [], marks = [];
  let open = -1;
  for (const m of s.matchAll(/\[|\]|[^\s[\]]+/g)) {
    if (m[0] === '[') { if (open >= 0) throw new Error('括号套了括号：并列的每一项各括一对方括号，不能套'); open = words.length; continue; }
    if (m[0] === ']') { if (open < 0) throw new Error('括号不配对：多了一个 ]'); if (words.length === open) throw new Error('方括号里是空的'); marks.push([open, words.length - 1]); open = -1; continue; }
    for (const t of tokenizeSentence(m[0])) words.push(t.w);
  }
  if (open >= 0) throw new Error('括号不配对：有一个 [ 没有合上');
  if (marks.length < 2) throw new Error('并列的要至少两项：每一项各括一对方括号');
  const tokens = tokenizeSentence(words.join(' '));
  // 项的头尾不含标点
  const items = marks.map(([a, b]) => { let from = a, to = b; while (from < to && !tokens[from].word) from++; while (to > from && !tokens[to].word) to--; return { from, to }; });
  let conj = -1;
  for (let i = items.at(-1).from - 1; i > items.at(-2).to; i--) if (COORD.has(tokens[i].w.toLowerCase())) { conj = i; break; }
  return { text: joinWords(words), tokens, items, stem: items[0].from > 0 ? { from: 0, to: items[0].from - 1 } : null, conj };
}

/**
 * 排成对齐的几行：[{ lead: 这一项前面的词的下标（第一行是公共的开头，后面几行是连接词）, item: { from, to } | null, trail: 跟在后面的标点 }]。
 * 最后一项后面还有话的，另起一行（item 是 null）
 */
export function parallelRows(p) {
  const { tokens, items } = p, rows = [];
  items.forEach((it, k) => {
    const start = k ? items[k - 1].to + 1 : 0, lead = [], prevTrail = [];
    // 上一项后面紧跟的标点归上一行，别的（and、but also……）是这一行的开头
    let i = start;
    if (k) { while (i < it.from && !tokens[i].word) { prevTrail.push(i); i++; } rows.at(-1).trail.push(...prevTrail); }
    for (; i < it.from; i++) lead.push(i);
    rows.push({ lead, item: it, trail: [] });
  });
  const rest = [];
  for (let i = items.at(-1).to + 1; i < tokens.length; i++) rest.push(i);
  const words = rest.filter((i) => tokens[i].word);
  if (!words.length) rows.at(-1).trail.push(...rest);
  else { let i = 0; while (i < rest.length && !tokens[rest[i]].word) { rows.at(-1).trail.push(rest[i]); i++; } rows.push({ lead: rest.slice(i), item: null, trail: [] }); }
  return rows;
}

/** 学生点的「每一项的第一个词」对不对：{ ok: true | false | null（一个都没点）, right, extra, missing, text } */
export function judgeStarts(mine = [], p) {
  const want = new Set(p.items.map((it) => it.from)), got = new Set(mine);
  if (!got.size) return { ok: null, right: 0, extra: 0, missing: want.size, text: '还没点：点出并列的每一项的第一个词。' };
  const right = [...got].filter((i) => want.has(i)).length, extra = got.size - right, missing = want.size - right;
  if (!extra && !missing) return { ok: true, right, extra, missing, text: `对，这${zhCount(want.size)}处是并列的${zhCount(want.size)}项的开头。` };
  const bits = [right ? `点对了 ${right} 项` : '', extra ? `有 ${extra} 处不是并列项的开头` : '', missing ? `还差 ${missing} 项` : ''].filter(Boolean);
  return { ok: false, right, extra, missing, text: `${bits.join('，')}。` };
}
/** 学生挑的「不平行的那一项」（从 0 数）对不对；spec.answer 从 1 数 */
export function judgeOdd(pick, spec) {
  if (pick === Number(spec.answer) - 1) return { ok: true, text: '对，是这一项：它的形式和另外几项不一样。' };
  return { ok: false, text: '这一项的形式和别的一样，再比一比每一项开头的那个词。' };
}
/** 改法的选项：对的（fix）和错的（decoys，| 隔开）打乱。顺序按题目定（同一道题每次一样）。回 { options, right } */
export function fixOptions(spec, seedText = '') {
  const fix = String(spec.fix ?? '').trim(), decoys = parseAlts(spec.decoys).filter((d) => d !== fix);
  const all = [fix, ...decoys];
  let h = 2166136261;
  for (const c of `${seedText}|${all.join('|')}`) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
  const order = all.map((x, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { options: order.map((i) => all[i]), right: order.indexOf(0) };
}

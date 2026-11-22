// 点词查义（2026-11-22 学生要的「设计四」）的纯函数那一半：一个英文词（和它前后的词）→ 词典里的几条意思。
// 词典是 ECDICT 抽出来的 kit/dist/dict/en.json（tools/dict-build.mjs 生成）：{ w: 词 → 意思, p: 词组 → 意思, x: 变形 → 原形 }。
// 以前课上问一个词就是一整轮（10-28「As well as什么意思」「Instance什么意思」，11-12「readers是读者的意思吗？」），
// 老师事先写了 gloss 的词才点得开。现在板上的英文词都能点，页面自己查，不调用 Claude。
// 有测试（tests/dict.test.js）；碰 DOM 的在 wordtap.js。

/** 一个词（字母、撇号、连字符）规范成查词典用的样子：小写、弯撇号换直的、去掉两头的撇号和 's */
export function normWord(w) {
  return String(w ?? '').replace(/[’‘]/g, "'").toLowerCase().replace(/^['-]+|['-]+$/g, '').replace(/'s$/, '');
}

/**
 * 词典里没有这个变形时按规则猜的原形（先猜的在前）：studies → study，stopped → stop，making → make，bigger → big
 */
export function ruleLemmas(w) {
  const out = [];
  const add = (x) => { if (x && x.length > 1 && x !== w && !out.includes(x)) out.push(x); };
  if (w.endsWith('ies')) add(`${w.slice(0, -3)}y`);
  if (w.endsWith('ied')) add(`${w.slice(0, -3)}y`);
  if (/(ses|xes|zes|ches|shes|oes)$/.test(w)) add(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1));
  for (const suf of ['ed', 'ing', 'er', 'est']) {
    if (!w.endsWith(suf) || w.length <= suf.length + 2) continue;
    const stem = w.slice(0, -suf.length);
    add(stem);
    add(`${stem}e`);
    if (/([bcdfghjklmnpqrstvwz])\1$/.test(stem)) add(stem.slice(0, -1)); // stopped → stop
  }
  if (w.endsWith('ly') && w.length > 4) { add(w.slice(0, -2)); if (w.endsWith('ily')) add(`${w.slice(0, -3)}y`); }
  return out;
}

/**
 * 查一个词：返回 [{ head, mean, of? }]（of：这是 head 的变形，原词是 of）。先词本身，再原形；都没有是 []
 */
export function lookupWord(dict, raw) {
  const w = normWord(raw);
  if (!dict || !w || !/[a-z]/.test(w)) return [];
  const out = [];
  const add = (head, of) => { const mean = dict.w?.[head]; if (mean && !out.some((x) => x.head === head)) out.push({ head, mean, ...(of ? { of } : {}) }); };
  add(w);
  const lemma = dict.x?.[w];
  if (lemma) add(lemma, w);
  if (!out.length) for (const l of ruleLemmas(w)) { add(l, w); if (out.length) break; }
  return out;
}

/**
 * 点的那个词和前后的词凑成的词组（as well as、account for、accounted for）：words 是这一句切好的词，i 是点的第几个。
 * 每个连续的 2～4 个词、包含点的那个词都试；第一个词也试原形（accounted for → account for）。长的在前，最多 2 条
 */
export function lookupPhrases(dict, words = [], i = 0) {
  if (!dict?.p) return [];
  const ws = words.map(normWord);
  const out = [];
  for (let len = 4; len >= 2; len--) {
    for (let s = Math.max(0, i - len + 1); s <= i && s + len <= ws.length; s++) {
      const part = ws.slice(s, s + len);
      if (part.some((x) => !/^[a-z][a-z'-]*$/.test(x))) continue;
      const tries = [part.join(' ')];
      const first = dict.x?.[part[0]] || ruleLemmas(part[0]).find((l) => dict.w?.[l]);
      if (first) tries.push([first, ...part.slice(1)].join(' '));
      for (const t of tries) {
        if (dict.p[t] && !out.some((x) => x.head === t)) { out.push({ head: t, mean: dict.p[t] }); break; }
      }
      if (out.length >= 2) return out;
    }
  }
  return out;
}

/** 一段字切成英文词：[{ word, start, end }]（字母开头，可以带撇号、连字符） */
export function wordsOf(text) {
  return [...String(text ?? '').matchAll(/[A-Za-z][A-Za-z'’-]*/g)].map((m) => ({ word: m[0].replace(/[-'’]+$/, ''), start: m.index, end: m.index + m[0].length }));
}

/** 记给老师的那一句意思：第一条的第一行，最多 40 个字 */
export function shortMean(hits = []) {
  const m = String(hits[0]?.mean || '').split('\n')[0];
  return m.length > 40 ? `${m.slice(0, 39)}…` : m;
}

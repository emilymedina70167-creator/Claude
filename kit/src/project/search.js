// 按字找（第十四轮，项目 Claude 的 search 工具）：学习台里没有向量检索，按字找加 Claude 自己换说法再找。纯函数。
// 大小写、全角半角不分；中文没有空格，每个词再切成相邻两个字的片段（「排序增量」→ 排序、序增、增量），命中几成算几分，
// 不然一句不带空格的中文要整句一字不差才找得到。

const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase();
const grams = (w) => { const cs = [...w]; if (cs.length < 3) return [w]; const out = []; for (let i = 0; i + 1 < cs.length; i++) out.push(cs[i] + cs[i + 1]); return out; };

/**
 * sources：[{ path, text }]；q：要找的字。返回 [{ path, snippet, score }]，分高的在前，最多 limit 条；一点都没命中的不要
 */
export function searchDocs(sources, q, { limit = 30 } = {}) {
  const query = norm(q).trim();
  if (!query) return [];
  const words = query.split(/\s+/).filter(Boolean);
  const out = [];
  for (const s of sources || []) {
    const raw = String(s?.text ?? '');
    const hay = norm(raw);
    if (!hay) continue;
    let score = 0;
    let first = -1;
    for (const w of words) {
      const i = hay.indexOf(w);
      if (i >= 0) { score += 1; if (first < 0 || i < first) first = i; continue; }
      const gs = grams(w);
      const hit = gs.filter((g) => hay.includes(g));
      if (hit.length) { score += hit.length / gs.length * 0.8; const j = hay.indexOf(hit[0]); if (first < 0 || j < first) first = j; }
    }
    if (words.length > 1 && hay.includes(words.join(' '))) score += 2;
    if (score <= 0) continue;
    const at = Math.max(0, first);
    const snippet = `${at > 60 ? '…' : ''}${raw.slice(Math.max(0, at - 60), at + 120)}${at + 120 < raw.length ? '…' : ''}`;
    out.push({ path: s.path, snippet, score: Math.round(score * 100) / 100 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

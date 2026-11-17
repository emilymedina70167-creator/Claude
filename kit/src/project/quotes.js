// 核引号：文字里引号括起来的话，能不能在给定的材料里一字不差地找到（第十三轮写在 memory/summary.js，第十四轮搬出来给笔记本共用）。纯函数。

// —— 摘要里引的原话要在记录里找得到（清点第二节第 5 条）——
// 旧系统的守卫核过写进记忆的引号；摘要重写没过这一道：重写时把学生的话改几个字、甚至编一句，会一直留在摘要里，
// 而且带着引号，老师会当成学生亲口说的。核法：重写回来的正文里每一段够长的引号，都要能在「给它的材料」里一字不差地找到
// （上一版摘要、新笔记、这节课的记录、学生打的每一句）。找不到的还给它重来一次；还找不到这一份不收。
// QUOTE_MIN：短的引号多半是术语、题型名（「定语从句」「先讲后练」），不是引的话，不核。
export const QUOTE_MIN = 6;
const squash = (s) => String(s ?? '').normalize('NFKC').toLowerCase();
// 比的时候不管空白、标点、全角半角、大小写：重写时把「，」写成「、」、句末少个句号不算改了原话；改了字才算
const bare = (s) => squash(s).replace(/[^\p{L}\p{N}]+/gu, '');
const QUOTE_RES = [/「([^「」]+)」/g, /“([^“”]+)”/g];

/** 正文里引号括起来、够长的每一段（「…」和弯引号；套在里面的『』算外面那一层的一部分） */
export function quotesIn(text) {
  const src = String(text ?? '');
  const out = [];
  for (const re of QUOTE_RES) for (const m of src.matchAll(re)) out.push({ at: m.index, q: m[1].trim() });
  return out.sort((a, b) => a.at - b.at).map((x) => x.q).filter((q) => [...q.replace(/\s+/g, '')].length >= QUOTE_MIN);
}

/** 这一段引号在材料里找不找得到：整段在；或者中间有省略号时每一段都在、先后不乱 */
export function quoteFound(q, corpus) {
  const hay = bare(corpus);
  const parts = squash(q).split(/\.{3,}/).map(bare).filter(Boolean);
  if (!parts.length) return true;
  // 用省略号拆开的每一段太短（「我……不……懂」），在几十 KB 的材料里按先后几乎一定找得到，等于没核：一段不到 3 个字就不算找到
  if (parts.length > 1 && parts.some((p) => [...p].length < 3)) return false;
  let from = 0;
  for (const p of parts) {
    const i = hay.indexOf(p, from);
    if (i < 0) return false;
    from = i + p.length;
  }
  return true;
}

export function checkQuotes({ next = '', corpus = '' } = {}) {
  const missing = [...new Set(quotesIn(next))].filter((q) => !quoteFound(q, corpus));
  return { ok: !missing.length, missing };
}

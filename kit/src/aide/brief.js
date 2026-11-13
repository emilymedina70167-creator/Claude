// 课前档案（docs/superpowers/specs/2026-11-13-aide-design.md 5.2）：这节课要知道的事。助手跨着这一科所有的学生卡读
// （卡是压过的一层，全部加起来一次读得下），挑和这节课有关的：这一块的、前置块里会冒出来的误解、跨块的习惯、要先测的。
// 首页猜得到下一节讲哪块就提前写好（aide_briefs/{科}）；猜不中或改了块，开课那一刻和老师第一轮同时写一份。
// 档案给别的块写的、依据的卡变了、不是 Opus 写的：不带，老师拿到的就是代码挑的那一套（现在的样子）。
// 纯函数，有测试（tests/aide-brief.test.js、tests/aide-class.test.js）。
import { hashOf } from '../memory/lab.js';
import { todayReviews } from '../memory/views.js';
import { positionId } from '../memory/space.js';
import { cardText, cardIdsFor } from './card.js';

export const BRIEF_MAX_BYTES = 6144;
export const BRIEF_HEAD = '你在给下一节课的老师准备这节课要知道的事';
export const BRIEF_MODEL = 'claude-opus-5-5';
const MAX_LINES = 15;
const enc = new TextEncoder();
const bytes = (s) => enc.encode(String(s ?? '')).length;
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const cut = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/**
 * 提示词。blocks：这节课要讲的块（复现课几块）；cards：这一科所有的学生卡 [{ id, text, block?, space? }]；
 * plan：备好的教案（lessonPlanText 的字，可以空）；position：这一科上一节停在哪；rules：给课堂的规则全文（照着挑）；review：复现组的字
 */
export function briefPrompt({ space = '', blocks = [], cards = [], plan = '', position = null, rules = '', review = '' } = {}) {
  return [
    `${BRIEF_HEAD}。下一节课讲：${list(blocks).join('、') || '（还没定）'}（${space}）。`,
    '下面是学习台给这个学生的全部学生卡（每块一张，跨块的一张：都是助手从错题、弱点、以前的课合并出来的，每行有出处）。',
    '上课的老师（也是 Opus 5.5）只看得到这节课这一块附近的几张卡；你要从全部的卡里挑出它这节课用得上、自己看不到的：',
    '- 这一块、前置块里会冒出来的误解（讲到哪一步时会冒出来）；',
    '- 跨块的思维习惯（这节课在哪一步可能又这样）；',
    '- 上一节没解决、这节开头该先测的；',
    '- 复现课：这几组以前错在哪。',
    '只写事实和发现，不写「老师应该怎么讲」。每行都带出处（错题编号、课的编号 #轮、卡的块编号），没有出处的不写。提到学生写「学生」。',
    '',
    position ? `## 上一节停在哪\n- 学到 ${position.block || ''}${position.next ? `；这一节从哪接：${cut(position.next, 300)}` : ''}\n` : '',
    plan ? `## 备好的教案\n${cut(plan, 4000)}\n` : '',
    review ? `## 这节课要复现的\n${cut(review, 2000)}\n` : '',
    rules ? `## 学生定下的规则（挑的时候照着）\n${cut(rules, 4000)}\n` : '',
    '## 全部学生卡',
    ...list(cards).map((c) => cardText(c)),
    '',
    `## 输出（最多 ${MAX_LINES} 行，每行「要点｜内容（出处）」，不要别的字）`,
  ].filter((x) => x !== '').join('\n');
}

/** 读回：只收「要点｜」开头的行，最多 MAX_LINES 行 */
export function parseBrief(text) {
  const lines = [];
  const problems = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim().replace(/^[-*•]\s*/, '');
    if (!line) continue;
    const m = line.match(/^要点\s*[｜|]\s*(.+)$/);
    if (!m) { problems.push(`看不懂：${cut(line, 60)}`); continue; }
    if (lines.length < MAX_LINES) lines.push(m[1].trim());
  }
  return { lines, problems };
}

/** 档案依据的指纹：给哪几块写的 + 读的卡各是哪一版（块按集合，先后不论） */
export const briefSig = (blocks, cards) => hashOf([...list(blocks)].map(String).sort().join(',') + '|' + list(cards).map((c) => `${c.id}:${c.at || 0}`).sort().join(','));

/** 档案能不能用：有、Opus 写的、给的块和这节课一样（按集合）、读的卡一张都没变 */
export function briefUsable(brief, { blocks = [], cards = [] } = {}) {
  if (!brief?.text || brief.model !== BRIEF_MODEL) return false;
  const a = [...list(brief.blocks)].map(String).sort().join(',');
  const b = [...list(blocks)].map(String).sort().join(',');
  return !!b && a === b && brief.sig === briefSig(blocks, cards);
}

/** 给老师看的那一节：标题 + 每行一条，截到 BRIEF_MAX_BYTES */
export function briefText(brief) {
  const head = '### 这节课要知道的（课前助手读了全部学生卡写的，每行有出处）';
  const out = [head];
  let n = bytes(head);
  for (const l of parseBrief(brief?.text).lines) {
    const line = `- ${l}`;
    if (n + bytes(line) + 1 > BRIEF_MAX_BYTES) break;
    out.push(line);
    n += bytes(line) + 1;
  }
  return out.length > 1 ? out.join('\n') : '';
}

/** 首页猜下一节讲哪几块：这一科备好的教案 > 到期的复现组（这一科排第一的门课挑的那几组的块） > 这一科上一节停在哪 */
export function guessBlocks(mem = {}, space = '', packs = {}) {
  const planned = packs?.[space]?.main?.block;
  if (planned) return [String(planned)];
  const g = todayReviews(mem).find((x) => x.space === space);
  if (g?.pick?.length) {
    const rs = list(mem.reviews);
    const bs = [...new Set(g.pick.flatMap((q) => list(rs.find((r) => String(r.id) === q.id)?.blocks)).map(String))];
    if (bs.length) return bs;
  }
  const pos = list(mem.position).find((p) => p?.id === positionId(space));
  return pos?.block ? [String(pos.block)] : [];
}

/**
 * 老师这一轮带什么（舞台课 classroom.js 的 system() 每一轮现算）：这一块附近的学生卡（cardIdsFor 那几张，按那个先后），
 * 档案能用（给这几块写的、那几张卡一张没变、Opus 写的）才带。blocks：这节课的块（复现课几块），不给就是 [block]。
 * 返回 { brief: briefText 的字（不能用就空）, cards: [cardText 的字] }
 */
export function aideForTurn({ block = '', blocks = null, cards = [], brief = null, curriculum = [], space = '' } = {}) {
  const want = blocks?.length ? blocks : block ? [block] : [];
  const ids = [...new Set(want.flatMap((b) => cardIdsFor(b, curriculum, space)))];
  const byId = new Map(list(cards).map((c) => [String(c.id), c]));
  const near = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!near.length) return { brief: '', cards: [] };
  const title = (id) => list(curriculum).find((d) => d.id === id)?.title || '';
  return {
    brief: briefUsable(brief, { blocks: want, cards: near }) ? briefText(brief) : '',
    cards: near.map((c) => cardText(c, { title: title(c.block) })),
  };
}

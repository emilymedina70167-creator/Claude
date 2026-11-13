// 学生卡（docs/superpowers/specs/2026-11-13-aide-design.md 5.1）：每块一张，外加每科一张跨块的。
// 卡是助手从原始记忆（错题、弱点、证据、以前的课）懂内容地合并出来的一层，老师开课时读它，不用再读几十条原始条目。
// 卡整张重写、不追加（超了 CARD_MAX 说明该合并）；每行带出处，出处对不上的那一行页面直接删掉（不挂起等我放行）。
// 纯函数，有测试（tests/aide-card.test.js）。
import { nearBlocks } from '../memory/digest.js';
import { hashOf } from '../memory/lab.js';
import { findQuotes, turnRefs, containment, normText } from '../memory/guard.js';
import { crossId } from './schema.js';

export const CARD_MAX = 2048;
// 第一行永远是「概括」一句话：教研室跨块合并、写跨块卡时只读每张卡的这一行。「讲法」第 3 批起由页面算的数填
export const CARD_SECTIONS = ['概括', '懂了', '误解', '原话', '考试', '讲法', '先测'];
const MAX_IDS = 8;

const enc = new TextEncoder();
const bytes = (s) => enc.encode(String(s ?? '')).length;
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/** 读卡的字：每行「段名｜内容」（全角竖线，半角也认）。返回 { lines: [{ sec, text }], problems } */
export function parseCard(text) {
  const lines = [];
  const problems = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim().replace(/^[-*•]\s*/, '');
    if (!line) continue;
    const m = line.match(/^([^｜|]{1,6})\s*[｜|]\s*(.+)$/);
    const sec = m?.[1].trim();
    if (!m || !CARD_SECTIONS.includes(sec)) { problems.push(`看不懂：${line.slice(0, 60)}`); continue; }
    lines.push({ sec, text: m[2].trim() });
  }
  return { lines, problems };
}

/** 一组行写回卡的字（存进 cards/{块}.text 的样子），按 CARD_SECTIONS 的先后排 */
export function linesText(lines = []) {
  const rank = (s) => CARD_SECTIONS.indexOf(s);
  return [...lines].sort((a, b) => rank(a.sec) - rank(b.sec)).map((l) => `${l.sec}｜${l.text}`).join('\n');
}

/** 给老师看的样子：card：{ block | space, text, moves（第 3 批页面算的讲法） }；title：块的标题 */
export function cardText(card = {}, { title = '', moves = '' } = {}) {
  const { lines } = parseCard(card.text);
  const head = `### 学生卡：${card.block ? `${card.block}${title ? ` ${title}` : ''}` : `跨块（${card.space || ''}）`}`;
  const body = CARD_SECTIONS.flatMap((sec) => {
    const ls = lines.filter((l) => l.sec === sec).map((l) => l.text);
    if (sec === '讲法' && moves) ls.push(moves);
    return ls.length ? [`- ${sec}：${ls.join('；')}`] : [];
  });
  return [head, ...body].join('\n');
}

/** 这一块开课要读哪几张卡：自己、前置（requires）、课程地图上挨着的、这一科的跨块卡（最后一张，一定在） */
export function cardIdsFor(block, curriculum = [], space = '') {
  const { cur, near } = nearBlocks(curriculum, block);
  const ids = [String(block || ''), ...list(cur?.requires), ...near.map((d) => d.id)].filter(Boolean);
  const uniq = [...new Set(ids)].slice(0, space ? MAX_IDS - 1 : MAX_IDS);
  return space ? [...uniq, crossId(space)] : uniq;
}

/** 这一块相关的原始记录的指纹：卡引的就是这些，变了卡就过时（照 exam/fresh.js 的 profileSrc 的做法） */
export function cardSrc(block, mem = {}) {
  return hashOf(cardParts(block, mem).join('|'));
}

/** 这一块相关的原始记录，一条一个短串（cardSrc 拼它；fill.js 看一块有没有记录） */
export function cardParts(block, mem = {}) {
  const b = String(block || '');
  const get = (c) => (Array.isArray(mem[c]) ? mem[c] : []);
  return [
    ...get('errors').filter((e) => e.block === b).map((e) => `e:${e.id}:${e.date || ''}:${e.void ? 'v' : ''}${e.resolved ? 'r' : ''}`),
    ...get('weaknesses').filter((w) => list(w.blocks).includes(b)).map((w) => `w:${w.id}:${w.status || ''}:${w.last || ''}:${list(w.errors).length}`),
    ...get('mastery').filter((m) => m.id === b || String(m.id).startsWith(`${b}#`)).map((m) => `m:${m.id}:${m.state || ''}:${m.tier || ''}`),
    ...get('recall').filter((k) => k.block === b).map((k) => `k:${k.id}:${k.status || ''}:${k.lapses || 0}`),
    ...get('sessions').filter((s) => s.block === b || list(s.blocks).includes(b)).map((s) => `s:${s.id}`), // 只看有没有这节课：课后整理写的复盘、归类时间不算（卡就是那一次写的，算进去写完马上就过时）
  ].sort();
}

/** 卡过时了没有：存着的指纹和现在算的不一样（跨块卡不按这个算，见 fill.js） */
export const cardStale = (card, mem) => !card?.block || card.src !== cardSrc(card.block, mem);

// 行里像记忆编号的：错题（DS-L8-T09、L2-07、EN-L3-03）、弱点 W19、复现组 R3、记忆点 K12、守则 T-4、课 c-20261102-1、失误 S-…
const ID_RE = /(?<![A-Za-z0-9-])((?:[A-Z]{2}-)?L\d+-T?\d+|W\d+|R\d+|K\d+|T-\d+|c-\d{8}-\d+|S-[A-Za-z0-9-]+)(?![A-Za-z0-9.-])/g;
const BLOCK_RE = /(?<![A-Za-z0-9-])((?:[A-Z]{2}-)?L\d+(?:\.\d+){1,3})(?![A-Za-z0-9-])/g;
const MEM_IDS = ['errors', 'weaknesses', 'reviews', 'recall', 'lessons', 'sessions', 'slips', 'observations', 'mastery'];

/**
 * 每一行的出处核一遍：编号要在记忆里、块要在课程地图里、「c-…#12」「#12」的轮要在那节课（或给了的某节课）的记录里、
 * 引号里的原话（「原话」段里的都算，别的段照守卫的规矩只算引的）要在课的记录或记忆原文里找得到（二字组 ≥ 85%）。
 * corpora：{ 课的编号: buildCorpus 的结果 }。返回 { keep, dropped: [{ line, why }] }
 */
export function checkCardLines(lines = [], { mem = {}, corpora = {}, extraIds = null } = {}) {
  const ids = new Set();
  for (const c of MEM_IDS) for (const d of Array.isArray(mem[c]) ? mem[c] : []) if (d?.id !== undefined) ids.add(String(d.id));
  const blocks = new Set((mem.curriculum || []).map((d) => String(d.id)));
  const memText = normText(['errors', 'weaknesses', 'observations', 'slips', 'recall', 'profile'].flatMap((c) => (Array.isArray(mem[c]) ? mem[c] : []).map((d) => [d.q, d.mine, d.step, d.cause, d.text, d.title, d.a].filter(Boolean).join('\n'))).join('\n'));
  const all = Object.values(corpora || {});
  const keep = [];
  const dropped = [];
  for (const l of lines) {
    const t = String(l.text || '');
    const why = (() => {
      for (const m of t.matchAll(ID_RE)) if (!ids.has(m[1]) && !extraIds?.has(m[1])) return `没有 ${m[1]} 这一条`;
      for (const m of t.matchAll(BLOCK_RE)) if (blocks.size && !blocks.has(m[1])) return `课程地图里没有块 ${m[1]}`;
      // 指了哪节课的哪一轮：c-…#12；只写 #12 的，在给了的哪节课里有就算
      for (const m of t.matchAll(/(c-\d{8}-\d+)\s*[#＃](\d{1,4})/g)) if (!corpora[m[1]]?.bySeq?.has(Number(m[2]))) return `${m[1]} 没有第 ${m[2]} 轮`;
      const bare = turnRefs(t.replace(/c-\d{8}-\d+\s*[#＃]\d{1,4}/g, ''));
      for (const n of bare) if (!all.some((c) => c?.bySeq?.has(n))) return `记录里没有第 ${n} 轮`;
      for (const q of findQuotes(t)) {
        if (l.sec !== '原话' && !q.cited) continue;
        const ok = containment(q.quote, memText) >= 0.85 || all.some((c) => containment(q.quote, c.all) >= 0.85);
        if (!ok) return `原话「${q.quote.slice(0, 20)}」在记录和记忆里都找不到`;
      }
      return '';
    })();
    if (why) dropped.push({ line: `${l.sec}｜${t}`, why });
    else keep.push(l);
  }
  return { keep, dropped };
}

/** 新卡收不收：超了 CARD_MAX 不收；把旧卡整张原样留着再往后加的不收（要整张重写，不累加） */
export function acceptCard(next, old = '') {
  if (bytes(next) > CARD_MAX) return { ok: false, why: `卡有 ${bytes(next)} 字节，超过 ${CARD_MAX}：要合并，不要追加` };
  const o = normText(old);
  const n = normText(next);
  if (o && n.length > o.length && n.includes(o)) return { ok: false, why: '把旧卡原样留着往后加了几行：要整张重写' };
  if (!n) return { ok: false, why: '卡是空的' };
  return { ok: true, why: '' };
}

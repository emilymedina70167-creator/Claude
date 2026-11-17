// 班主任（首页「班主任」那一页，#chat）：第十四轮起就是学习台里的项目 Claude（docs/superpowers/specs/2026-11-17-project-claude-design.md）。
// 每一轮的说明是 project/system.js 拼的那一份：事实、学生写的项目指令、它自己的笔记本、学习台里有什么、工具。
// 开发写的身份、做法、要求、简报那几段都不再给它（底线：不替它做任何事）。纯函数。
import { projectSystem } from '../project/system.js';

export const HEAD_MAX = 150 * 1024;
export const HEAD_HISTORY = 200 * 1024;
// 前台、学生在等它：和课堂老师一样只认 Opus 5.5 high，回的不是就作废、照实说（不加退路）
export const HEAD_MODEL = 'claude-opus-5-5';
export const HEAD = { model: HEAD_MODEL, effort: 'high', modelTier: 'complex' };

const utf8 = (s) => new TextEncoder().encode(String(s ?? '')).length;
const one = (s, n = 300) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** 班主任这一轮的说明：facts、instructions、notes、catalog、toolsDoc 都是页面现取的 */
export function headSystem({ facts = {}, instructions = '', notes = [], catalog = '', toolsDoc = '', max = HEAD_MAX } = {}) {
  return projectSystem({ facts, instructions, notes, catalog, toolsDoc, max }).text;
}

/**
 * 这段对话拼成调用的 turns：说明放第一条（和课堂一样），之后学生 / 班主任一轮一轮；太长先丢最早的（最近 4 条一定留）。
 * history：[{ role: 'me' | 'head', text, void? }]，最后一条要是学生的
 */
export function fitHistory(system, history = [], { maxBytes = HEAD_HISTORY } = {}) {
  const conv = (history || []).filter((h) => h && !h.void && String(h.text ?? '').trim()).map((h) => ({ role: h.role === 'head' ? 'assistant' : 'user', content: String(h.text).trim() }));
  if (!conv.length || conv.at(-1).role !== 'user') throw new Error('fitHistory：最后一条要是学生说的');
  let total = conv.reduce((s, t) => s + utf8(t.content), 0);
  let drop = 0;
  while (total > maxBytes && conv.length - drop > 4) { total -= utf8(conv[drop].content); drop++; }
  const kept = conv.slice(drop);
  // 第一条之后要从学生开始（丢到一半落在班主任那一轮，就再丢一条）
  while (kept.length > 1 && kept[0].role === 'assistant') kept.shift();
  return { turns: [{ role: 'user', content: String(system) }, ...(drop ? [{ role: 'user', content: '（这段对话太长，页面省掉了最早的几轮）' }] : []), ...kept], dropped: drop };
}

/** 新对话的编号：h-YYYYMMDD-n，接着这一天已有的 */
export function nextChatId(ids = [], today = '') {
  const day = String(today).replace(/-/g, '');
  const n = (ids || []).map((x) => String(x?.id ?? x)).filter((x) => x.startsWith(`h-${day}-`)).map((x) => Number(x.split('-')[2]) || 0);
  return `h-${day}-${(n.length ? Math.max(...n) : 0) + 1}`;
}

/** 对话的标题：学生第一句的前 20 个字 */
export const chatTitle = (text) => one(text, 21).replace(/…$/, '') || '新对话';

// 整节课的记录写成文字（第十三轮写在 memory/debrief.js，第十四轮搬出来：课后那一轮、读旧课都用）。纯函数。
import { parseOutput } from '../class/protocol.js';

export const TRANSCRIPT_BUDGET = 150 * 1024;
const BOARD_CUT = 700; // 每段板书原文最多留这么多字：读的是讲了什么、怎么问的，不用整段组件写法
const bytes = (s) => new TextEncoder().encode(String(s ?? '')).length;
const cut = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const one = (s, n) => cut(String(s ?? '').replace(/\s+/g, ' '), n);
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/** 一轮写成记录里的一段：学生的原话和动作照写；老师说的话照写，板书每段留开头；系统的提醒一行 */
function turnText(t) {
  const n = t.seq ? `#${t.seq} ` : '';
  if (t.role === 'student') return `${n}【学生】${String(t.text || '').trim()}`;
  if (t.role === 'system') {
    if (t.kind === 'summary') return `${n}【前半节的摘要】${cut(t.text, 4000)}`;
    if (t.kind === 'react') return `${n}【页面按预案接的】${one(t.text, 300)}`;
    if (t.kind === 'closing') return `${n}【下课小结】${cut(t.text, 3000)}`;
    return `${n}【页面】${one(t.text, 300)}`;
  }
  let segs;
  try { segs = parseOutput(String(t.text || ''), { final: true }).segments; } catch { segs = null; }
  if (!segs) return `${n}【老师】${cut(t.text, 2000)}`;
  const parts = segs.map((sg) => {
    if (sg.type === 'speech') return sg.text.trim();
    if (sg.type !== 'board') return '';
    const op = sg.op?.op || '';
    if (op === 'memo' || op === 'plan') return ''; // 记忆、计划块学生看不到，复盘看的是课本身
    const body = String(sg.body || '').trim();
    return `［board ${one(sg.header, 120)}］${body ? `\n${cut(body, BOARD_CUT)}` : ''}`;
  }).filter(Boolean);
  return `${n}【老师】${parts.join('\n')}`;
}

/**
 * 整节课的记录（class_turns，按 seq 排好）写成文字，不超过 budget：太长时留开头几轮和后面的，中间写一行省略。
 * 作废的轮（平台换了模型、抢跑没用上、出错）不要
 */
export function transcriptText(turns = [], budget = TRANSCRIPT_BUDGET) {
  const live = list(turns).filter((t) => t && !t.discarded && t.kind !== 'spec').sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const parts = live.map(turnText);
  const total = parts.reduce((s, p) => s + bytes(p) + 2, 0);
  if (total <= budget) return parts.join('\n\n');
  const head = parts.slice(0, 6);
  let room = budget - head.reduce((s, p) => s + bytes(p) + 2, 0) - 200;
  const tail = [];
  for (let i = parts.length - 1; i >= head.length && room > 0; i--) {
    room -= bytes(parts[i]) + 2;
    if (room > 0) tail.unshift(parts[i]);
  }
  const skipped = parts.length - head.length - tail.length;
  return [...head, `（中间 ${skipped} 轮太长，省略了）`, ...tail].join('\n\n');
}

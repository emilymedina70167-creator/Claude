// 下课后的复盘（docs/smart-plan.md 第 2 批）：一节课下课以后，学习台首页在后台调用一次 Opus，通读这节课的整段记录，
// 像教研员听完一节课：误解是真消了、还在、还是被绕开了（老师先讲了规则，学生没凭自己的想法做过一次），哪一步讲快了，
// 学生的思维习惯，下一节开头先测什么、拿哪道题测。存在 sessions/{编号}.debrief，下一节课的课堂和备课都带着。
//
// 为什么不并进下课小结：小结在学生点「下课」时写，学生在等；它要同时写整理单，看的是黑板现状和最近几轮。
// 复盘在课外、后台跑（lane: 'bg'），不让人等，可以把整节课从头看一遍。只存在这节课上，不往记忆库里加条目（不累加）。
// 纯函数，有测试（tests/memory-debrief.test.js）；调用在 desk.js 的 fixDebriefs。
import { parseOutput } from '../class/protocol.js';
import { isTeach } from './session.js';

export const DEBRIEF_VERSION = 1;
export const DEBRIEF_HEAD = '你在给一节刚上完的课做复盘';
// 发出去的整段记录最多这么长（Opus 一次能收约 250 KB；课的记录一般 60～200 KB，长板的原文截短就放得下）
export const DEBRIEF_BUDGET = 150 * 1024;
const BOARD_CUT = 700; // 每段板书原文最多留这么多字：复盘看的是讲了什么、怎么问的，不用整段组件写法
export const STATES = ['消了', '还在', '绕开了', '新冒出'];
const CAPS = { mis: 5, pace: 3, habit: 3, advice: 3 };

const bytes = (s) => new TextEncoder().encode(String(s ?? '')).length;
const cut = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const one = (s, n) => cut(String(s ?? '').replace(/\s+/g, ' '), n);
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/** 这节课要不要复盘：下了课（报告不是暂时的）、上过课（课堂或一问一答，不是练一练、不是实时黑板）、还没复盘过或者复盘的规矩改了 */
export function needsDebrief(s) {
  if (!s || !isTeach(s) || s.status !== 'closed') return false;
  if (!s.report || s.report.provisional) return false;
  return !s.debrief || (Number(s.debrief.v) || 0) < DEBRIEF_VERSION;
}

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
export function transcriptText(turns = [], budget = DEBRIEF_BUDGET) {
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

/**
 * 给 Opus 的提示词。session：sessions/{编号}；transcript：transcriptText；report：课后报告的文字（report.js 的 reportText）；
 * weaknesses：这一科还开着的弱点；prev：上一节（同一科）的复盘文字，看误解是不是又出现了
 */
export function debriefPrompt({ session = {}, transcript = '', report = '', weaknesses = [], prev = '', subject = '' } = {}) {
  const weak = list(weaknesses).slice(0, 20).map((w) => `- ${w.id}：${one(w.text || w.title || '', 160)}`).join('\n');
  return [
    `${DEBRIEF_HEAD}。你是教研员，刚把这节课从头到尾听完（下面是整段记录：学生的原话和作答、老师说的话和写的板书，板书原文截了开头）。`,
    '你写的复盘会交给下一节课的老师（也是 Opus 5.5，看不到这节课的记录），让它一开课就知道学生现在真实的状况、该先测什么。下课小结已经有了，不要重复小结，要的是小结看不出来的判断。',
    '',
    `## 这节课：${session.title || ''}${session.block ? `（块 ${session.block}）` : ''}${subject ? `，${subject}` : ''}${session.date ? `，${session.date}` : ''}`,
    '',
    '## 整段记录',
    transcript || '（没有记录）',
    '',
    report ? `## 页面算的课后报告（每道题的作答序列和结果）\n${cut(report, 8000)}\n` : '',
    weak ? `## 学生还开着的弱点（这一科）\n${weak}\n` : '',
    prev ? `## 上一节的复盘（对照：上次说「还在」的误解这节怎么样了）\n${cut(prev, 3000)}\n` : '',
    '## 怎么判',
    '- **误解消了**：要有学生**自己**在一道能把对的想法和错的想法分开的题上做对、或者说出了理由；老师讲完后学生只说「懂了」、只在按错的想法也能做对的题上做对，都不算消了。',
    '- **绕开了**：老师先把规则讲了或写上了黑板，学生没凭自己原来的想法做过一次，所以原来的误解根本没暴露过——看不出消没消。',
    '- **还在**：最后几次相关的作答还有这个错，或者学生的话里还带着这个想法。',
    '- **新冒出**：这节课第一次看到的误解。',
    '- 每条都要有依据：写是哪一轮（#编号）、学生怎么写的。没有依据的不写。记录里看不出的，不要猜。',
    '- 节奏：哪一步学生明显没跟上（连着错、问了好几次、停很久）或者明显太慢（连对还在一格格空转）。',
    '- 思维习惯：这节课里反复出现的做题方式（比如「先套规则不看句子意思」「符号一多就跳步」「没把握也不说」），要有两处以上的依据。',
    '- 开场：下一节开头先测什么，给一道**具体的题**（数值、句子写全），要能分开对的和错的想法；拿上一节还在、绕开了的误解出。',
    '- 提到学生就写「学生」。',
    '',
    '## 输出（只写下面这几种行，一行一条，用全角竖线「｜」分开；没有的就不写那种行，不要别的文字）',
    `误解｜${STATES.join('/')}｜误解是什么（一句话）｜依据（#轮次 + 学生怎么写的）`,
    '节奏｜哪一步｜太快还是太慢、表现',
    '习惯｜思维习惯（一句话）｜依据',
    '开场｜先测什么｜一道具体的题',
    '建议｜给下一节老师的一条做法（具体到怎么问、怎么排）',
    `（误解最多 ${CAPS.mis} 条、节奏 ${CAPS.pace} 条、习惯 ${CAPS.habit} 条、开场 1 条、建议 ${CAPS.advice} 条）`,
  ].filter((x) => x !== '').join('\n');
}

/** 读回复：{ mis: [{ state, text, basis }], pace: [{ where, how }], habit: [{ text, basis }], opening: { what, q } | null, advice: [], problems: [] } */
export function parseDebrief(text) {
  const out = { mis: [], pace: [], habit: [], opening: null, advice: [], problems: [] };
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim().replace(/^[-*•]\s*/, '').replace(/^\*\*(.+?)\*\*/, '$1');
    if (!line) continue;
    const f = line.split(/\s*[｜|]\s*/).map((x) => x.trim());
    const kind = f[0].replace(/[:：]$/, '');
    if (kind === '误解') {
      const state = STATES.find((s) => f[1]?.startsWith(s));
      if (!state || !f[2]) { out.problems.push(`看不懂：${one(line, 80)}`); continue; }
      if (out.mis.length < CAPS.mis) out.mis.push({ state, text: one(f[2], 200), basis: one(f.slice(3).join('｜'), 300) });
    } else if (kind === '节奏') {
      if (f[1] && out.pace.length < CAPS.pace) out.pace.push({ where: one(f[1], 120), how: one(f.slice(2).join('｜'), 240) });
    } else if (kind === '习惯') {
      if (f[1] && out.habit.length < CAPS.habit) out.habit.push({ text: one(f[1], 160), basis: one(f.slice(2).join('｜'), 300) });
    } else if (kind === '开场') {
      if (f[1] && !out.opening) out.opening = { what: one(f[1], 160), q: one(f.slice(2).join('｜'), 600) };
    } else if (kind === '建议') {
      if (f[1] && out.advice.length < CAPS.advice) out.advice.push(one(f.slice(1).join('｜'), 300));
    }
  }
  if (!out.mis.length && !out.pace.length && !out.habit.length && !out.opening && !out.advice.length) out.problems.push('回的不是复盘');
  return out;
}

/** 复盘写成文字（下一节课的课堂、备课带着；上一节的复盘也用它对照） */
export function debriefText(d) {
  if (!d) return '';
  const lines = [];
  for (const m of list(d.mis)) lines.push(`- 误解（${m.state}）：${m.text}${m.basis ? `（${m.basis}）` : ''}`);
  for (const p of list(d.pace)) lines.push(`- 节奏：${p.where}${p.how ? `——${p.how}` : ''}`);
  for (const h of list(d.habit)) lines.push(`- 习惯：${h.text}${h.basis ? `（${h.basis}）` : ''}`);
  if (d.opening) lines.push(`- 下一节开头先测：${d.opening.what}${d.opening.q ? `；题：${d.opening.q}` : ''}`);
  for (const a of list(d.advice)) lines.push(`- 建议：${a}`);
  return lines.join('\n');
}

/** 给我看的几行（「以前的课」那一页、首页「上一节」）：误解的状态、开场先测什么。不放依据里的轮次编号 */
export function debriefView(d) {
  if (!d) return [];
  const out = [];
  const by = (s) => list(d.mis).filter((m) => m.state === s).map((m) => m.text);
  if (by('消了').length) out.push({ kind: 'good', text: `消了：${by('消了').join('；')}` });
  if (by('还在').length) out.push({ kind: 'bad', text: `还在：${by('还在').join('；')}` });
  if (by('绕开了').length) out.push({ kind: 'warn', text: `没真正测过：${by('绕开了').join('；')}` });
  if (by('新冒出').length) out.push({ kind: 'bad', text: `新冒出：${by('新冒出').join('；')}` });
  if (list(d.habit).length) out.push({ kind: 'info', text: `习惯：${list(d.habit).map((h) => h.text).join('；')}` });
  if (d.opening) out.push({ kind: 'next', text: `下节先测：${d.opening.what}` });
  return out;
}

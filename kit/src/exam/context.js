// 舞台课每一轮发给老师的「这一块在考试里」（docs/exam-plan.md 4.2）：档案、这一块的考点和大纲原文、统计（页面算的）、
// 怎么考和坑（教研室写的，带题号）、代表题全文、学生在这一块真题上的情况、其余能用的真题目录、这一节怎么用。
// 按要紧程度装进 EXAM_BUDGET：放不下先压代表题的解析、再压目录；档案、考点、统计、学生的情况、用法一定在。
// 考情的数字都是页面算的——老师引考情只用这里给的。exam= / like= 的写法写在这一节里（不进 stageDoc：数据结构那份快满了）。
// 纯函数，有测试（tests/exam-context.test.js、tests/exam-fit.test.js）。
import { schoolLine, examDateOf } from './target.js';
import { TYPES, HOW } from './taxonomy.js';
import { daysBetween } from '../memory/schema.js';

export const EXAM_BUDGET = 16 * 1024;
const bytes = (s) => new TextEncoder().encode(String(s)).length;
const flat = (s, n = 0) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return n && t.length > n ? `${t.slice(0, n)}…` : t; };
const fmt = (x) => (Math.round(x * 10) / 10).toString();
const COURSE_NAME = { LA: '线代', HM: '高数', PS: '概率', DS: '数据结构', CO: '组成原理', OS: '操作系统', CN: '计网', EN: '英语', PO: '政治' };
const SUBJECT_OF = { LA: '301', HM: '301', PS: '301', DS: '408', CO: '408', OS: '408', CN: '408', EN: '201', PO: '101' };
const TREND = { up: '最近五年考得比以前多', down: '最近五年考得比以前少', flat: '' };
const count = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]);

function head(target, info, today) {
  const sub = SUBJECT_OF[info.course];
  const days = daysBetween(today, examDateOf(target));
  return `目标：${schoolLine(target)} · 考 ${(target.subjects || []).join('、')} · 这门课是${COURSE_NAME[info.course] || info.course}（在 ${sub} 里，${sub} 满分 ${target.full?.[sub] ?? ''} 分）${days >= 0 ? ` · 离考试 ${days} 天` : ''}`;
}
const sylText = (info) => `## 这一块挂的考点（考试大纲原文）\n${info.syl.map((n) => `- ${n.title}${n.level ? `（${n.level}）` : ''}${n.text ? `：${flat(n.text, 300)}` : ''}`).join('\n')}`;
function statsText(info) {
  const s = info.stats;
  if (!s.n) return '## 统计（页面从真题算的）\n- 入库的真题里这一块还没考过。';
  const how = HOW[info.course] || {};
  return ['## 统计（页面从入库的真题算的；考情的数字、年份只用这里的）',
    `- ${info.span[0]}–${info.span[1]} 年考了 ${s.n} 次（${s.years.join('、')}），平均每年 ${fmt(s.perYear)} 分${info.rank ? `，在这门课挂了考点的 ${info.of} 块里排第 ${info.rank}` : ''}${TREND[s.trend] ? `；${TREND[s.trend]}` : ''}`,
    `- 题型：${count(s.types).map(([k, n]) => `${TYPES[k] || k} ${n}`).join('、')}；考法：${count(s.hows).map(([k, n]) => `${how[k] || k} ${n}`).join('、')}`,
    ...(info.reserved ? [`- 另有 ${info.reserved} 道在留作模考的卷里（只算进上面的次数，题课上不用）`] : []),
  ].join('\n');
}
function profileText(info, cut = 0) {
  const lines = [];
  for (const p of info.profiles) {
    if (p.how) lines.push(`- ${flat(p.how, cut || 600)}`);
    for (const t of p.traps || []) lines.push(`- 坑 ${t.id}：${flat(t.text, 200)}${t.qs?.length ? `（${t.qs.join('、')}）` : ''}`);
  }
  return lines.length ? `## 怎么考、典型的坑（教研室归纳的，引的是题号）\n${lines.join('\n')}` : '';
}
function repText(q, info, cut) {
  const how = HOW[info.course]?.[q.tags?.how] || '';
  const opts = q.options ? Object.entries(q.options).map(([k, v]) => `${k}. ${flat(v, 300)}`).join('\n') : '';
  const ana = q.analysis ? (cut ? flat(q.analysis, cut) : String(q.analysis).trim()) : '';
  return [`### ${q.id}（${q.year} 年第 ${q.n} 题，${TYPES[q.type] || q.type}，${q.points} 分${how ? `，${how}` : ''}）`, String(q.stem || '').trim(), opts, q.answer ? `答案：${q.answer}` : '', ana ? `解析：${ana}` : ''].filter(Boolean).join('\n');
}
function mineText(info, bar) {
  const done = bar?.done?.length ? bar.done : info.mine;
  const lines = ['## 学生在这一块真题上的情况（页面按作答算的）'];
  if (!done.length) lines.push('- 还没做过这一块的真题。');
  else lines.push(`- 做过 ${done.length} 道：${done.slice(0, 8).map((d) => `${d.id}（${d.ok ? (d.first === false ? '改对了' : '一次对') : '没做对'}）`).join('、')}`);
  if (bar) lines.push(`- 真题级：${bar.passed ? `过了${bar.timed ? '（在建议用时以内）' : '（超了建议用时）'}` : '还没过'}${bar.traps?.length ? `；踩过的坑：${bar.traps.join('、')}` : ''}`);
  return lines.join('\n');
}
const USAGE = `## 这一节怎么用
- 讲课的难度照上面的真题定：这一块讲完，学生要能做出代表题那样的题。
- 这一块讲完之前，让学生做一道真题级的题：用代表题原题，在那一问写 \`exam=题号\`（\`ask value "…" answer=… exam=Q-…\`；\`goal\`、\`ask tap / pick\` 也能写）；当场换数、照着出的题写 \`like=题号\`（对标哪一道）。页面按它算真题级。
- 引考情（考了几次、哪年、几分）写题号，数字只用这一节给的；这一节没有的考情不说，不凭印象补。
- 留作模考的卷不在这里，课上不用、不提。`;

/**
 * 拼这一节。target：考试档案（targetOf）；info：block.js 的 examForBlock；bar：exam_bar 那一块的一条（没有就是 null）。
 * 没有考情（info 是 null，或者政治）返回 ''
 */
// asked：这节课老师已经用 exam= / like= 写过的题号：在目录里的挪进代表题（老师照题号用了，下一轮就有全文）
export function examForClass({ target, info: info0, bar = null, today, budget = EXAM_BUDGET, asked = [] } = {}) {
  if (!info0 || info0.course === 'PO') return '';
  const want = new Set(asked);
  const info = want.size ? { ...info0, reps: [...info0.reps, ...info0.rest.filter((q) => want.has(q.id))], rest: info0.rest.filter((q) => !want.has(q.id)) } : info0;
  const must = [head(target, info, today), sylText(info), statsText(info), mineText(info, bar), USAGE];
  const used = bytes(must.join('\n\n'));
  let room = budget - used - 64;
  const pick = (text) => { if (!text || bytes(text) + 2 > room) return ''; room -= bytes(text) + 2; return text; };
  let prof = pick(profileText(info)) || pick(profileText(info, 160));
  // 代表题：先放全文；放不下把解析截到 200 字；还不下就少放一道
  let reps = '';
  for (const cut of [0, 200, 60]) {
    const t = info.reps.length ? `## 代表题（题面原文；照这个难度讲）\n${info.reps.map((q) => repText(q, info, cut)).join('\n\n')}` : '';
    if (!t || bytes(t) + 2 <= room) { reps = t; room -= t ? bytes(t) + 2 : 0; break; }
  }
  if (!reps && info.reps.length) {
    for (let k = info.reps.length - 1; k >= 1 && !reps; k--) {
      const t = `## 代表题（题面原文；照这个难度讲）\n${info.reps.slice(0, k).map((q) => repText(q, info, 60)).join('\n\n')}`;
      if (bytes(t) + 2 <= room) { reps = t; room -= bytes(t) + 2; }
    }
  }
  const how = HOW[info.course] || {};
  const restLines = [];
  for (const q of info.rest) {
    const l = `- ${q.id}｜${TYPES[q.type] || q.type}｜${q.points} 分｜${how[q.tags?.how] || ''}`;
    if (bytes(l) + 1 > room - 80) break;
    restLines.push(l);
    room -= bytes(l) + 1;
  }
  const rest = info.rest.length ? `## 其余能用的真题（一行一道；照题号写进 exam= / like= 用了，下一轮这里就有它的全文）\n${restLines.join('\n')}${restLines.length < info.rest.length ? `\n- ……还有 ${info.rest.length - restLines.length} 道` : ''}` : '';
  return [must[0], must[1], must[2], prof, reps, must[3], rest, must[4]].filter(Boolean).join('\n\n');
}

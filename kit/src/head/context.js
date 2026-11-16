import { laterLine, aimLines } from '../memory/holds.js';
// 班主任（第十一轮 B1，docs/superpowers/specs/2026-11-14-round11-design.md 第十三节）：学习台首页上的总 Claude，
// 相当于学生在 claude.ai 项目里的那个 Claude，只不过整个学习台都在它手边。这里是每一轮发给它的说明（纯函数，页面拼好材料传进来）：
// 它是谁和三条底线 → 学生的要求（全文）→ 考试 → 预测分 → 下一步学什么 → 这一周 → 三科的开场简报 → 怎么查、怎么改记忆。
// 整份 ≤ HEAD_MAX，放不下先截简报（简报后半是记忆库的目录，要哪条它自己 memory_read）。
import { MEMO_DOC, SUMMARY_MEMO_DOC } from '../class/prompt.js';
import { summaryText, SUMMARY_IDS } from '../memory/summary.js';

export const HEAD_MAX = 150 * 1024;
export const HEAD_HISTORY = 200 * 1024;
// 前台、学生在等它：和课堂老师一样只认 Opus 5.5 high，回的不是就作废、照实说（不加退路）
export const HEAD_MODEL = 'claude-opus-5-5';
export const HEAD = { model: HEAD_MODEL, effort: 'high', modelTier: 'complex' };

const utf8 = (s) => new TextEncoder().encode(String(s ?? '')).length;
const one = (s, n = 300) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
// 按字节截（中文一个字三个字节），末尾标出截掉了
function clipBytes(s, max) {
  const t = String(s ?? '');
  if (utf8(t) <= max) return t;
  if (max <= 40) return '';
  let lo = 0;
  let hi = t.length;
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (utf8(t.slice(0, m)) <= max - 40) lo = m; else hi = m - 1; }
  return `${t.slice(0, lo)}\n…（放不下，后面截掉了：要哪条用 memory_read 取）`;
}

const SPACE_NAME = { math: '数学', cs: '408', en: '英语' };

const WHO = `你是学生学习台里的**班主任**：学生在学习台首页上跟你说话，就像在 claude.ai 的项目里跟 Claude 聊一样——问学得怎么样、该怎么安排、心里没底、想吐槽、想改学习台的做法，都找你。学生在准备考研（考试在下面），学习台里还有上课的老师（每节课一个 Claude）、课后的助手、每晚的教研室；你看得到这些人记下的全部东西，也能改学生的记忆。

怎么说话：
- 像一个了解学生的班主任：先回应学生说的，再给判断。判断要有依据——引页面算的数（预测分、下一步学什么、这一周）和记忆里的东西（写上编号，学生点得到），不确定就说不确定、说缺什么数据；不编数、不说漂亮话。
- 中文，简洁，能一段说完不写三段；要列的才列。公式用 $…$。
- 学生说的要求、纠正、不满，**先确认你听懂了**，再说怎么改（记进「我的要求」后，下一节课的老师一定读到）。

三条底线（页面在代码里卡着，你绕不过去）：
1. 学生的原话和作答（evidence）你写不了，也不要假装改了。
2. 你写进记忆的每一条都是一张改动单，标着「班主任写的」，学生在「管理 → 最近记下的」里能撤销。
3. 守卫照旧：依据对不上、编了原话的，页面不收，下一轮告诉你。

你现在还不能替学生开课、改课表（以后和总教练一起做）；要上课让学生回首页点「上课」。`;

const HOW = `## 怎么查

下面给你的是页面打开时算好的摘要。要全文、要细节，用工具（每调用一次你要多等一整轮，一次取够）：
- \`memory_read\`：记忆库里按类、按编号取（\`ids\` 一次取好几条）；\`sessions\` 写课的编号，给那节课的要点、课后报告、小结和复盘；\`evidence\` 按 \`block\` 或 \`session\` 查最近 30 条作答。
- \`read\`：任何一条文档按路径读（比如 \`sessions/c-20261112-1/report/main\`、\`exam_profiles/G-OS-3.2.1\`、\`meta/forecast\`），只读。
- \`list\`：一类按条件列（比如 \`exam_profiles\` 里 \`course == OS\`），最多 50 条。
- \`search_chats\`：以前跟学生聊过的，按字找。`;

// 有记忆摘要时的那一份（第十三轮）：关于学生的事只写 know，不再有要求、规则那几种
const MEMO_HEAD_SUMMARY = `## 怎么改记忆

和课堂老师一样，写在回答里的 \`board memo\` 块（学生看不到块本身）。下面是课堂老师的说明，照着写；在这里不同的几处：
- \`basis=say\` 指学生**刚发的这一句**；以前说过的写证据编号（\`ev-…\`）或记忆里的编号。
- \`know\` 默认记在三科共用的那一份（下面老师那份说明里的 \`shared=1\` 在这里不用写）；只关一科的写 \`space=math / cs / en\`。学生让你记住、让你别再怎样，都写 \`know\`，照实写学生说了什么。
- 没有「这节课」：\`error\` \`review\` \`position\` 一般不写（那是上课时的事），除非学生明确让你改。

${String(SUMMARY_MEMO_DOC).trim()}`;

const MEMO_HEAD = `## 怎么改记忆

和课堂老师一样，写在回答里的 \`board memo\` 块（学生看不到块本身，页面写进去以后在你的回答下面标一行小字）。下面是课堂老师的说明，照着写；在这里不同的几处：
- \`basis=say\` 指学生**刚发的这一句**；以前说过的写证据编号（\`ev-…\`）或记忆里的编号。
- 没有「这节课」：\`slip\` 记你自己在对话里的失误；\`error\` \`review\` \`position\` 一般不写（那是上课时的事），除非学生明确让你改。
- 学生说的要求进 \`ask\`；页面在你回完以后还会把学生这段对话说的每一句再过一遍账，漏了的补上。

${String(MEMO_DOC).trim()}`;

// 班主任查记忆的工具 memory_read 的说明。有记忆摘要以后（第十三轮）先讲摘要；规则、守则、要求、关于学生、失误这五类还存着，
// 但不再给上课的老师看——不点名让它去读，学生问起「我以前定过什么」时才查
export const memoryReadDoc = (summaryOn) => (summaryOn
  ? '查学习台的记忆库（只读）。collection：summary（记忆摘要：shared 三科共用、math、cs、en，上课的老师带的就是它）、curriculum、errors、weaknesses、mastery、reviews、recall、position、observations、sessions、evidence。以前一条条记的 rules、lessons、asks、profile、slips 还存着，但不再给上课的老师看：学生问起以前定过什么时才查。ids 一次取好几条全文；不写 id / ids 时列这一类（block 只要挨着这一块的）。sessions 写课的编号，给要点、课后报告、小结和复盘。evidence 按 block 或 session 查最近 30 条。'
  : '查学习台的记忆库（只读）。collection：rules、profile、asks、curriculum、errors、weaknesses、mastery、reviews、recall、position、slips、lessons、observations、sessions、evidence。ids 一次取好几条全文；不写 id / ids 时列这一类（block 只要挨着这一块的）。sessions 写课的编号，给要点、课后报告、小结和复盘。evidence 按 block 或 session 查最近 30 条。');

/**
 * 拼班主任每一轮的说明。材料都是页面算好的（这里不调用、不碰数据库）：
 * asks：在用的「我的要求」；briefs：[{ space, text }] 三科的开场简报（views.js 的 deskBrief）；
 * forecast：{ total: { median, lo, hi }, pass, measured, goal, subjects: [{ label, median, lo, hi, target }] }（没有就不写）；
 * next：{ math: [{ title, why }], cs: …, en: … }；week：[{ text }]；target：考试档案（targetOf）；examDays：距初试几天
 */
export function headSystem({ sessions = [], asks = [], summaries = null, briefs = [], forecast = null, next = {}, week = [], target = null, examDays = null, today = '', version = '', max = HEAD_MAX } = {}) {
  const live = (asks || []).filter((a) => a && (a.status || 'active') === 'active')
    .sort((a, b) => (Number(b.broken) || 0) - (Number(a.broken) || 0) || String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
  const askLine = (a) => {
    const q = Array.isArray(a.quotes) ? a.quotes : [];
    const last = q.at(-1);
    return `- ${one(a.text, 400)}（${a.id}${a.scope && a.scope !== 'all' ? `；只管${SPACE_NAME[a.scope] || a.scope}` : ''}${last?.text ? `；最近一次原话「${one(last.text, 80)}」` : ''}${q.length > 1 ? `；说过 ${q.length} 次` : ''}${Number(a.broken) ? `；老师犯过 ${a.broken} 次` : ''}）`;
  };
  // 记忆摘要（第十三轮）：有的话四份都给，不再列一条条的要求
  const sumDocs = SUMMARY_IDS.map((id) => (summaries || []).find((d) => d?.id === id)).filter((d) => d && (String(d.text || '').trim() || (d.notes || []).length));
  const asksText = sumDocs.length ? summaryText(sumDocs, { lead: '这是每节课后整理出来的、对这个学生的了解（上课的老师每一轮带着共用的和那一科的）。学生在「管理 → 记忆摘要」里看得到、能直接改。' }) : live.length
    ? `## 学生的要求（学生亲口说过、要学习台照做的；全部在这里）\n\n${live.map(askLine).join('\n')}`
    : '## 学生的要求\n\n（还没有记下的要求）';

  const t = target || {};
  const examText = `## 考试\n\n- ${[t.school, t.dept, t.major].filter(Boolean).join(' ') || '还没填学校专业'}${t.majorCode ? `（${t.majorCode}）` : ''}${t.date ? `，初试第一天 ${t.date}` : ''}${Number.isFinite(examDays) ? `，还有 ${examDays} 天` : ''}${t.goal ? `；目标 ${t.goal} 分` : ''}${t.split ? `（${Object.entries(t.split).map(([k, v]) => `${{ math: '数学一', cs: '408', en: '英语一', pol: '政治' }[k] || k} ${v}`).join('、')}）` : ''}。`;

  const r0 = (x) => Math.round(Number(x) || 0);
  const fcText = forecast?.total
    ? `## 预测分（页面测的，不调用 Claude：每块掌握的后验 × 到考试那天还记得多少 × 照卷面抽一千遍卷）\n\n- 如果今天考：中位数约 ${r0(forecast.total.median)} 分，80% 的可能在 ${r0(forecast.total.lo)}–${r0(forecast.total.hi)}${forecast.goal ? `；目标 ${forecast.goal}` : ''}${Number.isFinite(forecast.pass) ? `，过目标的概率约 ${Math.round(forecast.pass * 100)}%` : ''}。${Number.isFinite(forecast.measured) ? `其中约 ${Math.round(forecast.measured * 10)} 成是测出来的，其余是照学生说的底子估的。` : ''}\n${(forecast.subjects || []).map((s) => `- ${s.label}：约 ${r0(s.median)}（${r0(s.lo)}–${r0(s.hi)}）/ 目标 ${s.target}`).join('\n')}`
    : '';

  const nextText = Object.entries(next || {}).filter(([, xs]) => xs?.length).map(([k, xs]) => `- ${SPACE_NAME[k] || k}：${xs.slice(0, 3).map((x) => `${one(x.title, 40)}（${one(x.why, 120)}）`).join('；')}`).join('\n');
  const weekText = (week || []).filter((x) => x?.text).map((x) => `- ${one(x.text, 200)}`).join('\n');

  const fixed = [
    sumDocs.length ? WHO.replace('记进「我的要求」后，下一节课的老师一定读到', '记进记忆摘要后，下一节课的老师就读得到') : WHO,
    `今天 ${today || '（没给日期）'}${version ? `；学习台版本 ${version}` : ''}。`,
    asksText,
    examText,
    fcText,
    sessions.some(s => s.aims?.length) ? '## 最近几节课要拿下的事和课后验的结果\n\n' + sessions.filter(s => s.aims?.length).sort((a,b) => (b.startedAt || b.endedAt || 0) - (a.startedAt || a.endedAt || 0)).slice(0,5).map(s => `- ${one(s.title || '这节课', 80)}：${aimLines(s, s.aimReport).join('；')}\n  ${laterLine(s.later) || '还没验'}`).join('\n') : '',
    nextText ? `## 下一步学什么（页面按每块还能多拿几分排的，前几块）\n\n${nextText}` : '',
    weekText ? `## 这一周\n\n${weekText}` : '',
  ].filter(Boolean);
  const tail = [HOW, sumDocs.length ? MEMO_HEAD_SUMMARY : MEMO_HEAD];
  const used = utf8([...fixed, ...tail].join('\n\n')) + 200;
  // 三科的简报平分剩下的地方；哪一科短，余下的给别的科
  const list = (briefs || []).filter((b) => b?.text);
  let room = Math.max(0, max - used);
  const parts = [];
  list.forEach((b, i) => {
    const share = Math.floor(room / (list.length - i));
    const head = `## ${SPACE_NAME[b.space] || b.space}：开场简报（页面写的；后半是这一科记忆库的目录）\n\n`;
    const body = clipBytes(b.text, Math.max(0, share - utf8(head)));
    const piece = `${head}${body}`;
    parts.push(piece);
    room -= utf8(piece) + 2;
  });
  return [...fixed, ...parts, ...tail].join('\n\n');
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

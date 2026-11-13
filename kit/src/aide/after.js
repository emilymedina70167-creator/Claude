// 下课后的助手（docs/superpowers/specs/2026-11-13-aide-design.md 5.1 第 1 条、5.3）：一节舞台课下课、报告写好以后，
// 首页在后台调用一次 Opus，对着这节课的整段记录同一次写四样：复盘（debrief.js 的那几种行）、归类（skills.js 的格式）、
// 事实（错题、弱点、过程观察、讲错的地方、记忆点：老师课上只写判断，事实交给这里）、相关学生卡的新版本。
// 以前复盘、归类各调一次，这一轮以后开的舞台课（sessions 上 aide: 1）并成这一次；旧课照旧走原来的两次，不重跑。
// 纯函数，有测试（tests/aide-after.test.js）。调用在 aide/aidedesk.js。
import { DEBRIEF_JUDGE, DEBRIEF_OUTPUT, trapsTable, parseDebrief } from '../memory/debrief.js';
import { SKILLS_RULES, skillItemLines, parseSkills } from '../memory/skills.js';
import { parseMemoLines } from '../memory/memo.js';
import { MEMO_DOC } from '../class/prompt.js';
import { parseCard, CARD_SECTIONS, CARD_MAX } from './card.js';
import { MOVES } from './moves.js';

export const AFTER_VERSION = 1;
export const AFTER_HEAD = '你在给一节刚上完的舞台课做课后整理';
export const AFTER_FAILS = 3; // 连着这么多次没成就不在首页做了，交给每晚教研室的补收尾
const FACT_KINDS = new Set(['error', 'weakness', 'note', 'slip', 'recall']);

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const cut = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** 这节课要不要做：这一轮以后开的舞台课（aide）、下了课、报告不是暂时的、没做过或者写法改了、没连着失败 AFTER_FAILS 次 */
export function needsAfter(s) {
  if (!s?.aide || s.status !== 'closed' || !s.report || s.report.provisional) return false;
  if ((Number(s.after?.fails) || 0) >= AFTER_FAILS) return false;
  return !s.after?.at || (Number(s.after.v) || 0) < AFTER_VERSION;
}

/**
 * 提示词。session：sessions/{编号}；transcript：debrief.js 的 transcriptText；report：reportText；weaknesses：这一科开着的弱点；
 * prev：上一节的复盘文字；traps：这一块真题的坑；items：报告的 items（归类用）；curriculum：这一科的块；catalog：用过的知识点；
 * cards：要重写的卡 [{ id, text }]（没有卡的块 text 空）；notes：课上旁听记下的（第 2 批，[{ upTo, text }]）
 */
export function afterPrompt({ session = {}, transcript = '', report = '', weaknesses = [], prev = '', subject = '', traps = [], items = [], curriculum = [], catalog = {}, cards = [], notes = [] } = {}) {
  const trapLines = trapsTable(traps);
  const weak = list(weaknesses).slice(0, 20).map((w) => `- ${w.id}：${cut(w.title || w.text || '', 160)}`).join('\n');
  const blocks = list(curriculum).filter((b) => b && /\.\d+\.\d+$/.test(String(b.id))).slice(0, 120);
  const pts = Object.entries(catalog).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  const itemLines = skillItemLines({ items });
  return [
    `${AFTER_HEAD}。你是教研员兼记录员，刚把这节课从头到尾看完（下面是整段记录：学生的原话和动作、老师写的镜头指令和话）。`,
    '你写的东西学习台会照原样存进学生的记忆（每一句都要有这节课记录或记忆里的依据：写轮次 #编号、那一问的编号 S…、错题编号）。依据对不上的那一行学习台直接删掉。',
    '下课小结已经有了（老师写的），不要重复小结。上课时老师只记了判断（守则、待办、复现结果、下一节从哪接），**事实由你来记**。',
    '',
    `## 这节课：${session.title || ''}${session.block ? `（块 ${session.block}）` : ''}${subject ? `，${subject}` : ''}${session.date ? `，${session.date}` : ''}`,
    '',
    '## 整段记录',
    transcript || '（没有记录）',
    '',
    report ? `## 页面算的课后报告（每道题的作答序列和结果）\n${cut(report, 8000)}\n` : '',
    list(notes).length ? `## 课上旁听记下的（另一个助手边听边写的，当底稿用；以记录为准）\n${list(notes).map((n) => `- （看到第 ${n.upTo} 轮）${cut(n.text, 600)}`).join('\n')}\n` : '',
    weak ? `## 学生还开着的弱点（这一科）\n${weak}\n` : '',
    prev ? `## 上一节的复盘（对照：上次说「还在」的误解这节怎么样了）\n${cut(prev, 3000)}\n` : '',
    trapLines ? `## 这一块真题的典型坑（教研室从真题归纳的）\n${trapLines}\n学生的哪个误解和其中一个坑是一回事，就在那一行误解的依据最后写「坑=编号」（只写上面列着的编号；对不上就不写）。\n` : '',
    '# 输出分五节，节头照抄（一行 `## 复盘`、`## 归类`、`## 事实`、每张卡一行 `## 卡 块编号`、`## 讲法`），节和节之间空一行，不要别的文字',
    '',
    '## 复盘（写法照下面）',
    ...DEBRIEF_JUDGE,
    '输出的几种行：',
    ...DEBRIEF_OUTPUT,
    '',
    '## 归类（把这节课的每道题归到一个知识点）',
    '这节课做的题（题号. ［证据上记的块］「题面」：每次的对错 结果）：',
    ...(itemLines.length ? itemLines : ['（这节课没有页面判得了分的题：这一节写一行 skip 0）']),
    '课程地图（这一科的块）：',
    ...blocks.map((b) => `${b.id} ${cut(b.title, 40)}`),
    '已经用过的知识点（能用就用原来的编号）：',
    ...(pts.length ? pts.map(([id, x]) => `${id} ${x.title || ''}`) : ['（还没有）']),
    '要求：',
    ...SKILLS_RULES,
    '',
    '## 事实（一个 ````board memo 块，写法照下面的说明，但只写 error / weakness / note / slip / recall 这几种）',
    '- error：学生做错的题（题面、学生写的原文、错在哪一步）；同一个误解这节课只记一道。weakness：新的弱点，或者已有的弱点又出现了一次（写已有的编号）。',
    '- note：过程（停了多久、改了几次、怎么试的、卡在哪一下）；slip：老师这节课讲错、演错、没等学生的地方。recall：要反复记的一条。',
    '- 判断（守则又犯、待办、复现组结果、下一节从哪接、偏好、规则）老师课上记过了，你不写。',
    MEMO_DOC,
    '',
    `## 卡（这节课相关的学生卡，每张整张重写，不要在旧卡后面追加；每张不超过 ${CARD_MAX} 字节，超了就合并）`,
    `- 每行「段名｜内容（出处）」，段名只能是 ${CARD_SECTIONS.filter((x) => x !== '讲法').join(' / ')}（讲法由页面按证据算，你不写）。第一行一定是「概括｜」一句话。`,
    '- 同一个误解只写一句，后面列出处；原话只留最要紧的一两句；这节课没碰到的内容照旧卡保留（改写得更准可以）。',
    ...list(cards).flatMap((c) => [`### 卡 ${c.id} 现在是：`, c.text ? String(c.text) : '（还没有卡：照这节课和记忆写第一版）']),
    '',
    '',
    `## 讲法（老师每一轮主要用了哪种讲法：每行「讲法｜#轮｜词」，词只能是 ${MOVES.join(' / ')}；只标在教东西的那几轮，一轮最多两种。有没有用页面按学生之后的作答算，你不判）`,
    '',
    '提到学生就写「学生」。',
  ].filter((x) => x !== '').join('\n');
}

/** 把回答按节头切开：{ debrief, skills, facts, cards: { 块: 字 }, moves } */
export function splitAfter(text) {
  const out = { debrief: '', skills: '', facts: '', cards: {}, moves: '' };
  let cur = null;
  for (const raw of String(text ?? '').split('\n')) {
    // 节头：照抄了提示词里「### 卡 L2.2.2 现在是：」的也认；别的标题当这一节到头了（不把后面的行并进上一节）
    const h = raw.trim().match(/^#{2,3}\s*(复盘|归类|事实|讲法|卡\s+((?:[A-Z]{2}-)?L[\d.]+|x-[a-z]+)(?:\s*现在是\s*[:：]?)?)(?:[（(].*)?\s*$/);
    if (!h && /^#{1,3}\s/.test(raw.trim())) { cur = null; continue; }
    if (h) {
      if (h[2]) { cur = { card: h[2] }; out.cards[h[2]] = out.cards[h[2]] || ''; }
      else cur = { key: { 复盘: 'debrief', 归类: 'skills', 事实: 'facts', 讲法: 'moves' }[h[1]] };
      continue;
    }
    if (!cur) continue;
    if (cur.card) out.cards[cur.card] += `${raw}\n`;
    else out[cur.key] += `${raw}\n`;
  }
  for (const k of ['debrief', 'skills', 'facts', 'moves']) out[k] = out[k].trim();
  for (const k of Object.keys(out.cards)) out.cards[k] = out.cards[k].trim();
  return out;
}

/**
 * 读回答。ctx：parseSkills 的那些（items、blocks、catalog、weaknesses）加 cardIds（只收给了的卡）。
 * 返回 { debrief, skills, memo（只有事实那几种的条目）, cards: { 块: { lines, problems } }, moves（原文，第 3 批读）, problems }
 */
export function parseAfter(text, ctx = {}) {
  const s = splitAfter(text);
  const problems = [];
  const debrief = parseDebrief(s.debrief);
  const skills = parseSkills(s.skills, ctx);
  const body = s.facts.replace(/^`{3,}\s*board\s+memo\s*$/gm, '').replace(/^`{3,}\s*$/gm, '');
  const parsed = parseMemoLines(body);
  const memo = [];
  for (const e of parsed.entries) {
    if (FACT_KINDS.has(e.kind)) memo.push(e);
    else problems.push(`事实那一节只写事实，${e.kind} 不收：${cut(e.line, 60)}`);
  }
  for (const er of parsed.errors || []) problems.push(`事实那一节看不懂：${cut(er.line || er, 60)}`);
  const cards = {};
  const ids = ctx.cardIds || new Set();
  for (const [id, t] of Object.entries(s.cards)) {
    if (!ids.has(id)) { problems.push(`没让写卡 ${id}，不收`); continue; }
    cards[id] = parseCard(t);
  }
  const nothing = debrief.problems.includes('回的不是复盘') && !skills.items.length && !memo.length && !Object.keys(cards).length;
  if (nothing) problems.push('回的不是课后整理');
  return { debrief, skills, memo, cards, moves: s.moves, problems };
}

// 记忆摘要（第十三轮，docs/superpowers/specs/2026-11-16-mirror-design.md 6.1）：照 claude.ai 项目的做法，
// 老师对这个学生的了解是一份会重写的摘要（三科共用一份 + 每科一份），当背景给老师，不是一条条要照做的规矩。
// 以前的做法是规则、守则、要求一条条攒、每轮全文带、写明「冲突时以它为准」：学生随口的一句建议被概括成规矩、
// 永远按原来的分量带着，课越上越死板。摘要每节课后整份重写（旧的自然淡出），学生能直接看、直接改。
// 这里是纯函数：给老师看的字、当场记的新笔记、课后重写的提示词和读回、版本。数据库那一层在 summarydesk.js。
import { similarity } from './memo.js';
import { toDate } from './schema.js';

export const SUMMARY_IDS = ['shared', 'math', 'cs', 'en'];
// 字节上限（汉字 3 字节）：共用约 1300 字，每科约 2700 字。两份一起每轮都带，算在记忆那一节的 28 KiB 里
export const SUMMARY_MAX = { shared: 4096, subject: 8192 };
export const NOTES_MAX = 20;
export const NOTE_CHARS = 300;
export const HISTORY_MAX = 8;
// 重写回来比上一版短了一半以上不收：多半是把没提到的旧内容丢了
export const SHRINK_MIN = 0.5;
// 新笔记和已有的说的是同一件事不收（比 memo.js 拦照抄的那条线松：笔记很短，换几个字的重复也拦）
export const NOTE_ALIKE = 0.6;
// 重写：这节课两分钟内还有动静先不动（另一台设备上还在上）；试满几次这节课先跳过（有新的动静再试）
export const QUIET_MS = 2 * 60 * 1000;
export const REWRITE_FAILS = 2;

const SPACE_NAME = { math: '数学', cs: '408', en: '英语' };
const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
export const utf8 = (s) => (enc ? enc.encode(String(s ?? '')).length : Buffer.byteLength(String(s ?? '')));
const clean = (s) => String(s ?? '').replace(/\r/g, '').trim();
const one = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
// 发给老师的字里不称「他」「她」（和 digest.js 的 neutral 一样）
const neutral = (t) => String(t ?? '').replace(/(?<![其吉利])[他她](?![们人])/g, '学生');
const day = (at) => { const d = toDate(Number(at) || 0); return d ? d.slice(5) : ''; };

export const maxOf = (id) => (id === 'shared' ? SUMMARY_MAX.shared : SUMMARY_MAX.subject);
export const spaceName = (id) => (id === 'shared' ? '三科共用' : SPACE_NAME[id] || id);

/** 这一科的两份：{ shared, subject, on }。on：有一份有字（或有新笔记）就算有摘要 */
export function summaryOf(mem = {}, space = '') {
  const docs = Array.isArray(mem?.summary) ? mem.summary : [];
  const get = (id) => docs.find((d) => d && d.id === id) || null;
  const shared = get('shared');
  const subject = space ? get(space) : null;
  const has = (d) => !!d && (!!clean(d.text) || (Array.isArray(d.notes) && d.notes.length > 0));
  return { shared, subject, on: has(shared) || has(subject) };
}
/** 四份里有没有任何一份有字：记忆库是不是已经换成摘要了 */
export const summaryOn = (mem = {}) => (Array.isArray(mem?.summary) ? mem.summary : []).some((d) => d && SUMMARY_IDS.includes(d.id) && (clean(d.text) || (d.notes || []).length));

const noteLine = (n) => `- ${n.at ? `${day(n.at)}：` : ''}${one(n.text, NOTE_CHARS)}${n.quote ? `（学生的原话「${one(n.quote, 120)}」）` : ''}`;

export const SUMMARY_HEAD = '## 你对这个学生的了解（记忆摘要）';
export const SUMMARY_LEAD = '这是以前的课后整理出来的背景，帮你了解这个学生；它不是规程，怎么教由你当场判断。学生这节课当面说的，照做。';

/** 给老师看的那一节。docs：[{ id, text, notes }]（先共用、后这一科；班主任给四份） */
export function summaryText(docs = [], { lead = SUMMARY_LEAD } = {}) {
  const live = docs.filter(Boolean);
  const parts = [SUMMARY_HEAD, lead];
  for (const d of live) if (clean(d.text)) parts.push(`### ${spaceName(d.id)}\n\n${clean(d.text)}`);
  const notes = live.flatMap((d) => (Array.isArray(d.notes) ? d.notes : [])).filter((n) => n && clean(n.text)).sort((a, b) => (a.at || 0) - (b.at || 0));
  if (notes.length) parts.push(`### 还没并进摘要的新笔记（最近当场记的）\n\n${notes.map(noteLine).join('\n')}`);
  return neutral(parts.join('\n\n'));
}

/** 一条新笔记 */
export function noteOf({ text, quote = '', session = '', by = 'class', at = Date.now() } = {}) {
  const n = { text: one(text, NOTE_CHARS), at, by };
  if (clean(quote)) n.quote = one(quote, 200);
  if (session) n.session = String(session);
  return n;
}

/** 往一份摘要上加一条新笔记：和已有的说的是同一件事不收；满了丢最早的。doc 可以是 null（这一份还没有） */
export function addNote(doc, note, { id = doc?.id } = {}) {
  if (!clean(note?.text)) return { doc, added: false, why: '没有内容' };
  const base = doc || { id, text: '', v: 0, since: note.at || Date.now(), notes: [], history: [] };
  const notes = Array.isArray(base.notes) ? base.notes : [];
  if (notes.some((n) => similarity(n.text, note.text) >= NOTE_ALIKE)) return { doc: base, added: false, why: '和已有的新笔记说的是同一件事' };
  return { doc: { ...base, notes: [...notes, note].slice(-NOTES_MAX) }, added: true };
}

/**
 * 新的一版：旧的那版进 history（最近 HISTORY_MAX 版），已经并进去的新笔记清掉。
 * startedAt：这次重写是什么时候开始的——之后才加的笔记没被读到，留着（重写途中学生又让老师记了一条）。
 * 不给 startedAt（学生自己改的）时笔记不动
 */
export function nextDoc(prev, { id = prev?.id, text, by = 'page', at = Date.now(), startedAt = null, src = '' } = {}) {
  const p = prev || { id, text: '', v: 0, notes: [], history: [] };
  const history = clean(p.text) ? [{ text: p.text, at: p.at || 0, by: p.by || '', v: p.v || 0 }, ...(Array.isArray(p.history) ? p.history : [])].slice(0, HISTORY_MAX) : (Array.isArray(p.history) ? p.history : []);
  const notes = (Array.isArray(p.notes) ? p.notes : []).filter((n) => startedAt === null || (Number(n.at) || 0) > startedAt);
  // since：这一份是什么时候开始有的（只在第一版时记）。它以前的课不再回头并（见 sinceOf）
  return { ...p, id, text: neutral(clean(text)), at, by, v: (Number(p.v) || 0) + 1, since: Number(p.since) || at, notes, history, ...(src ? { src } : {}) };
}

/** 退回上一版（现在这一版进 history 的头上，换下来的那一版从 history 里拿掉）。没有上一版返回 null */
export function rollback(doc, { at = Date.now() } = {}) {
  const prev = Array.isArray(doc?.history) ? doc.history[0] : null;
  if (!prev) return null;
  const rest = doc.history.slice(1);
  const cur = { text: doc.text, at: doc.at || 0, by: doc.by || '', v: doc.v || 0 };
  return { ...doc, text: prev.text, at, by: 'me', v: (Number(doc.v) || 0) + 1, history: [cur, ...rest].slice(0, HISTORY_MAX), src: `退回第 ${prev.v} 版` };
}

/* ---------------- 课后重写 ---------------- */

// 提示词固定的开头：?dev 的模拟 Claude、测试靠它认出这是重写摘要
export const REWRITE_HEAD = '你在替一个备考研究生入学考试的学生维护「记忆摘要」';
const chars = (bytes) => Math.floor(bytes / 3 / 100) * 100;

/**
 * 重写的提示词。space：这一科（空 = 班主任的对话，只重写共用那一份）；shared / subject：现在的两份（可以是 null）；
 * transcript：这节课（这段对话）的记录稿；said：[{ at, text }] 学生打的每一句；report：课后报告的文字；
 * aims：要拿下的事和状态的文字；later：最近的课后验结果的文字；legacy：还没有摘要时，以前一条条攒下的规则、守则、要求（原料）
 */
export function rewritePrompt({ space = '', shared = null, subject = null, transcript = '', said = [], report = '', aims = '', later = '', legacy = '', today = '', title = '' } = {}) {
  const name = SPACE_NAME[space] || '';
  const both = !!name;
  const notes = [...(shared?.notes || []), ...(subject?.notes || [])].filter((n) => n && clean(n.text)).sort((a, b) => (a.at || 0) - (b.at || 0));
  const how = [
    `${both ? '两份都' : ''}整份重写、整份输出。${both ? '这节课' : '这段对话'}没提到的旧内容，仍然成立就原样留着；被新的事实推翻了就改；学生明说不要了的删掉。不要因为这一次没提到就删。`,
    '写事实和看到的情况：学生是谁、目标、底子、手边的材料、学到哪了；学习时的习惯；哪些地方反复出问题（跨了几节课才看得出的规律）。',
    '学生说过的话留**原话**，带日期和当时的情形（老师刚做了什么、学生说了什么、后来怎样）。**不把学生的一句话推广成规矩**：学生说「换一个高效点的测验」，写的是哪天、什么情形下说了这句，不写成「以后都用选择题」。学生明说「以后都……」「别再……」的，或者同一件事在不同的课上说了几次的，照实写清（说过几次、哪几天）。',
    '什么讲法、什么练法对这个学生有效或无效：只写有证据的（学生的作答、隔天验的结果、学生的原话），把证据写出来。',
    '这是背景，不是规程：不写「必须」「每次都要」「一律」这样的话，不给老师排步骤、不规定板怎么排。老师读了以后自己判断怎么教。',
    '不写一节课的流水账；不抄错题、弱点、掌握状态（学习台另有记录，老师看得到）。',
    notes.length ? '「还没并进摘要的新笔记」每一条都要并进去（并到该在的那一份），除非它已经在摘要里了。' : '',
    '提到学生写「学生」，不用「他」「她」。用小标题分节，小标题随内容定。',
    `长度：「共用」不超过 ${chars(SUMMARY_MAX.shared)} 个字${both ? `，「这一科」不超过 ${chars(SUMMARY_MAX.subject)} 个字` : ''}。超了先压旧的、不要紧的；宁可短，不凑字。`,
  ].filter(Boolean);
  const out = both
    ? '<共用>\n（三科共用那一份的全文）\n</共用>\n<这一科>\n（这一科那一份的全文）\n</这一科>'
    : '<共用>\n（三科共用那一份的全文）\n</共用>';
  const sec = (head, body) => (clean(body) ? `## ${head}\n\n${clean(body)}` : '');
  const saidText = (said || []).filter((x) => x && clean(x.text)).map((x) => `- ${x.at ? `${day(x.at)} ` : ''}「${one(x.text, 400)}」`).join('\n');
  // 记录稿里是学生和老师的原话（译文里会有「他」「她」），不替换；摘要和原料写进来之前已经换过了
  return [
    `${REWRITE_HEAD}：一份写给以后给这个学生上课的老师看的背景。学习台里每节课是一个新的 Claude 在讲，它开课前读这份摘要来了解学生。请根据下面${both ? '这节课' : '学生和班主任这段对话'}的记录，把摘要重写一遍。${today ? `今天 ${today}。` : ''}`,
    both
      ? `摘要有两份：「共用」（三科都用得上的：学生是谁、目标、底子、学习的习惯、对老师说过的话）和「这一科」（${name}：手边的材料、学到哪、这一科怎么学有效、在这一科的课上说过的话）。一件事只写在一份里。`
      : '这一次只重写「共用」那一份（三科都用得上的：学生是谁、目标、底子、学习的习惯、对老师说过的话）。',
    `怎么写：\n${how.map((x) => `- ${x}`).join('\n')}`,
    legacy ? '现在还没有摘要。最后一节「以前一条条攒下的记录」是学习台以前的做法留下的规则、守则、要求（很多是学生随口的一句被写成了规矩），当原料用：其中的事实、学生的原话、有证据的经验写进摘要；规定老师每一步怎么做、板怎么排的那些不照搬，只在学生的原话那里照实提一句当时说了什么。' : '',
    `输出格式（只输出${both ? '这两段' : '这一段'}，不要别的话）：\n\n${out}`,
    sec('现在的摘要：共用', shared?.text || '（还没有）'),
    both ? sec(`现在的摘要：这一科（${name}）`, subject?.text || '（还没有）') : '',
    notes.length ? sec('还没并进摘要的新笔记', notes.map(noteLine).join('\n')) : '',
    sec(`${both ? `这节课${title ? `（${one(title, 40)}）` : ''}` : '这段对话'}里学生打的每一句`, saidText || '（学生没打字）'),
    sec(both ? '这节课的记录' : '这段对话', transcript),
    sec('这节课要拿下的事（状态是页面按作答算的）', aims),
    sec('页面算的课后报告', report),
    sec('最近几节课隔天验的结果', later),
    sec('以前一条条攒下的记录（原料）', legacy),
  ].filter(Boolean).join('\n\n');
}

const TAG = { shared: '共用', subject: '这一科' };
const between = (text, tag) => { const m = String(text ?? '').match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`)); return m ? clean(m[1]) : ''; };

/** 读回重写的结果。both：要不要「这一科」那一段 */
export function parseRewrite(text, { both = true } = {}) {
  const shared = between(text, TAG.shared);
  const subject = both ? between(text, TAG.subject) : '';
  const problems = [];
  if (!shared) problems.push('没有「共用」那一段');
  if (both && !subject) problems.push('没有「这一科」那一段');
  return { shared, subject, problems };
}

/** 一份重写回来的能不能收：空的、超上限的、比上一版短了一半以上的不收 */
export function checkRewrite({ prev = '', next = '', id = 'shared' } = {}) {
  const n = utf8(clean(next));
  if (!n) return { ok: false, why: '是空的' };
  if (n > maxOf(id)) return { ok: false, why: `超了上限（${n} > ${maxOf(id)} 字节）` };
  const p = utf8(clean(prev));
  if (p && n < p * SHRINK_MIN) return { ok: false, why: `比上一版短了一半以上（${p} → ${n} 字节），怕是丢了旧内容` };
  return { ok: true, why: '' };
}

/** 第一次重写的原料：现在生效的规则（管记录的不算）、守则、要求、关于学生。只带这一科的和全科的 */
export function legacyText(mem = {}, space = '') {
  const list = (c) => (Array.isArray(mem?.[c]) ? mem[c] : []).filter((d) => d && d.id !== undefined);
  const here = (d) => !d.space || d.space === space;
  const rules = list('rules').filter((r) => (r.status || 'active') === 'active' && r.use !== 'record' && r.for !== 'chat' && here(r));
  const lessons = list('lessons').filter((l) => (l.status || 'active') === 'active' && here(l));
  const asks = list('asks').filter((a) => (a.status || 'active') === 'active' && (!a.scope || a.scope === 'all' || a.scope === space));
  const profile = list('profile').filter((p) => (p.status || 'active') === 'active' && here(p));
  const askLine = (a) => {
    const q = (Array.isArray(a.quotes) ? a.quotes : []).filter((x) => x?.text && x.at);
    return `- ${one(a.text, 300)}${q.length ? `（学生的原话：${q.map((x) => `${day(x.at)}「${one(x.text, 100)}」`).join('；')}）` : '（原话没留下，是以前概括的）'}`;
  };
  return neutral([
    profile.length ? `### 关于学生\n\n${profile.map((p) => `- ${p.topic ? `${one(p.topic, 20)}：` : ''}${one(p.text, 400)}`).join('\n')}` : '',
    asks.length ? `### 学生的要求（以前记法：一条条要照做）\n\n${asks.map(askLine).join('\n')}` : '',
    rules.length ? `### 规则（以前学生定的、老师和开发替学生写的）\n\n${rules.map((r) => `- ${r.cat ? `［${one(r.cat, 8)}］` : ''}${one(r.text, 400)}`).join('\n')}` : '',
    lessons.length ? `### 教学守则（以前的教学失误归纳出来的）\n\n${lessons.map((l) => `- ${one(l.text, 300)}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n'));
}

/**
 * 摘要是从什么时候开始有的（四份里最早的 since）。这以前的课、对话不回头并：第一版是照当时整个记忆库写的，
 * 那些课已经在里面了——一节一节重并，既白花调用，又把早就淡掉的旧事重新写回来。还没有摘要时是 0（都并）
 */
export function sinceOf(mem = {}) {
  const xs = (Array.isArray(mem?.summary) ? mem.summary : []).map((d) => Number(d?.since) || 0).filter((x) => x > 0);
  return xs.length ? Math.min(...xs) : 0;
}

/**
 * 这节课要不要重写摘要：上一次并到的时间以后又有新的证据（作答、学生的话），而且静下来了。
 * 用证据的时间而不是轮次的序号：证据首页本来就订阅着，不用为了判断去读每节课的轮次。
 * session.sum：{ at, upTo（并到哪一条证据的时间）, fails, failUpTo（上次失败时最新的证据时间）}
 */
export function needsRewrite(session, { evidence = [], now = Date.now(), since = 0 } = {}) {
  if (!session || session.deleting) return false;
  const kind = session.kind || 'class';
  if (!['class', 'stage', 'talk'].includes(kind)) return false;
  const sum = session.sum || {};
  const upTo = Math.max(Number(sum.upTo) || 0, Number(since) || 0);
  let last = 0;
  for (const e of evidence) if (e && String(e.session) === String(session.id) && (Number(e.at) || 0) > last) last = Number(e.at) || 0;
  if (last <= upTo) return false;
  if (now - last < QUIET_MS) return false;
  // 试满了：等有新的动静再试
  if ((Number(sum.fails) || 0) >= REWRITE_FAILS && last <= (Number(sum.failUpTo) || 0)) return false;
  return true;
}

// —— 这节课学生打的话（清点第二节第 4 条）——
// 话的账停了以后，对话一长被压缩，学生早先说的那句只剩压缩摘要里的转述（或者老师当时记了 know 才有）。
// 页面把这节课学生自己打的每一句照抄进老师每一轮的说明：不调用模型、不改一个字，课后重写时照旧读整节课的记录。
// 页面替学生发的快捷回答（「继续。」「开始上课。」）不是学生的话，不占地方。
const SAID_SKIP = new Set(['继续。', '开始上课。']);
export const SAID_NOW_MAX = 1536;
const SAID_KEEP = 6;      // 最后几句一定留
const SAID_ONE = 300;     // 一句最多这么多字（再长的截短：全文在对话里，这里只防它一句占满）

export function saidNow(turns = [], { max = SAID_NOW_MAX } = {}) {
  const lines = (Array.isArray(turns) ? turns : [])
    .filter((t) => t && t.role === 'student' && String(t.say ?? '').trim() && !SAID_SKIP.has(String(t.say).trim()))
    .map((t) => {
      const say = String(t.say).replace(/\s+/g, ' ').trim();
      return `第 ${t.seq} 轮：${say.length > SAID_ONE ? `${say.slice(0, SAID_ONE)}…` : say}`;
    });
  if (!lines.length) return '';
  const fit = (ls, cut) => [cut ? `（更早的 ${cut} 句省略了：原话在这节课的记录里）` : '', ...ls].filter(Boolean).join('\n');
  let cut = 0;
  while (lines.length - cut > SAID_KEEP && utf8(fit(lines.slice(cut), cut)) > max) cut += 1;
  let kept = lines.slice(cut);
  // 最后几句自己就超了：一句一句再截短（最后 6 句一句不丢）
  for (let cap = SAID_ONE; utf8(fit(kept, cut)) > max && cap > 20; cap = Math.floor(cap / 2)) {
    kept = kept.map((l) => { const [head, ...rest] = l.split('：'); const body = rest.join('：').replace(/…$/, ''); return body.length > cap ? `${head}：${body.slice(0, cap)}…` : l; });
  }
  return fit(kept, cut);
}

// 核引号搬到 project/quotes.js（第十四轮），这里转发
import { QUOTE_MIN, quotesIn, quoteFound, checkQuotes } from '../project/quotes.js';
export { QUOTE_MIN, quotesIn, quoteFound, checkQuotes };

// —— 重写回来的一份回答核一遍（页面 summarydesk.js 和尺子 tools/summary-ruler 共用，核法只有这一份）——
/**
 * text：模型的回答；prompt：给它的整份提示词（核引号的材料）；space：'' 是只重写共用；shared / subject：上一版。
 * 返回 { got, format（格式不对的原因，对就是空）, over（写长了）, lost（找不到的引号）, fixable（毛病只有写长、引号对不上：值得请它重来一次）, bad（不收的原因，空就是收） }
 */
export function judgeRewrite({ text = '', prompt = '', space = '', shared = null, subject = null } = {}) {
  const both = !!space;
  const got = parseRewrite(text, { both });
  if (got.problems.length) return { got, format: got.problems, over: [], lost: [], fixable: false, bad: [`格式不对：${got.problems.join('；')}`] };
  const checks = [checkRewrite({ prev: shared?.text, next: got.shared, id: 'shared' }), both ? checkRewrite({ prev: subject?.text, next: got.subject, id: space }) : { ok: true }];
  const over = [
    utf8(got.shared) > maxOf('shared') ? `「共用」有 ${utf8(got.shared)} 字节，上限 ${maxOf('shared')}` : '',
    both && utf8(got.subject) > maxOf(space) ? `「这一科」有 ${utf8(got.subject)} 字节，上限 ${maxOf(space)}` : '',
  ].filter(Boolean);
  const lost = checkQuotes({ next: `${got.shared}\n${both ? got.subject : ''}`, corpus: prompt }).missing;
  const bad = checks.map((c, i) => (c.ok ? '' : `${i ? '这一科' : '共用'}那一份${c.why}`)).filter(Boolean);
  const fixable = checks.every((c) => c.ok || /超了上限/.test(c.why));
  if (lost.length) bad.push(`引号里的话在记录里找不到：${lost.map((q) => `「${q}」`).join('、')}`);
  return { got, format: [], over, lost, fixable, bad };
}

/** 能让它自己改好的两种毛病合成同一次重来：把它写的那一版还给它，说清哪里不对 */
export function retryPrompt({ prompt = '', text = '', over = [], lost = [] } = {}) {
  const asks = [
    over.length ? `上面这一版超了上限：${over.join('；')}（一个汉字 3 字节）。把旧的、不要紧的、说了两遍的压掉，事实和学生的原话留着。` : '',
    lost.length ? `上面这一版里这几段带引号的话，在上一版摘要和这节课的记录里都找不到一模一样的：${lost.map((q) => `「${q}」`).join('、')}。引号里只放照抄的话：是原话就照记录抄，一个字不改；不是原话就去掉引号，换成你自己的转述。` : '',
  ].filter(Boolean).join('\n');
  const why = [over.length ? '太长了' : '', lost.length ? '引号里的话对不上记录' : ''].filter(Boolean).join('，');
  return `${prompt}\n\n## 你上一次写的（${why}）\n\n${text}\n\n${asks}\n照同样的格式再整份输出一遍。`;
}

// —— 摘要开始有以前备好的教案 ——
// 备好没上的教案（pack/main…）会在开下一节课时抄进那节课、老师每一轮照着上。摘要开始有以前备的那些，是照当时的规则、守则写的
// （开头复现几组、一步一块板、练习固定几步……），带进课堂等于旧规矩绕回来。有摘要时这样的教案不再当「备好的下一节」：
// 数据不删（管理页、备份里都在），首页照没备课的样子开课，要用就重新备一次。
// 看不出哪天备的（没有 at、updatedAt）不动它。
export function stalePack(main, mem = {}) {
  if (!main || !summaryOn(mem)) return false;
  const since = sinceOf(mem);
  const at = Number(main.at) || Date.parse(main.updatedAt || '') || 0;
  return !!since && !!at && at < since;
}

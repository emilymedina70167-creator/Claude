// 「学习台里有什么」（第十四轮）：像 claude.ai 项目列出项目里的文件——项目 Claude 不知道有，就不会去找。
// 只写事实：有哪些书、真题入库到哪、上过几节课、旧记忆每类几条、页面算好的东西放在哪个路径。纯函数。
import { todayFacts } from './today.js';

const SPACE_NAME = { math: '数学', cs: '408', en: '英语' };
const OLD = ['rules', 'lessons', 'asks', 'profile', 'slips', 'observations', 'summary'];
const LEDGER = ['errors', 'weaknesses', 'mastery', 'reviews', 'recall', 'position', 'curriculum', 'drills'];
const n = (v) => (Array.isArray(v) ? v.length : 0);

/**
 * data：学习台的数据（记忆库各类、sessions、notebook）；books：{ books, chunks }；exam：{ questions, years: [从, 到], profiles }；
 * chats：和班主任对话的段数；today：YYYY-MM-DD（给了就写首页「今天」照哪里画、现在的几个数）
 */
/** 外部的课里后加的可选指令的名字（meta/catalog 里只列名字） */
export const EXT_EXTRAS = ['board recall'];

export function catalogText({ data = {}, books = null, exam = null, chats = 0, today = '' } = {}) {
  const lines = [];
  const bk = books?.books || [];
  if (bk.length) {
    const per = new Map();
    for (const c of books?.chunks || []) per.set(c.book, (per.get(c.book) || 0) + 1);
    const cnt = (b) => per.get(b.id) ?? (Number.isFinite(b.chunks) ? b.chunks : null);
    lines.push(`- 教材（books/{书}/chunks/{条}；search 的 books）：${bk.map((b) => `${b.title || b.id}${cnt(b) === null ? '' : `（${cnt(b)} 条）`}`).join('、')}`);
  } else lines.push('- 教材：这一次没读到（books）');
  if (exam?.questions) lines.push(`- 考试资料（questions、exam_profiles、syllabus；search 的 exam）：真题 ${exam.questions} 道${exam.years?.length === 2 ? `（${exam.years[0]}–${exam.years[1]}）` : ''}${exam.profiles ? `，考点画像 ${exam.profiles} 个` : ''}`);
  const ss = data.sessions || [];
  if (ss.length) {
    const by = {};
    for (const s of ss) { const k = s.space || 'math'; (by[k] ||= []).push(s); }
    lines.push(`- 上过的课（sessions/{编号}；每节的每一轮在 sessions/{编号}/class_turns，课后报告在 sessions/{编号}/report/main；search 的 turns）：${Object.entries(by).map(([k, list]) => `${SPACE_NAME[k] || k} ${list.length} 节（最近 ${list.map((x) => x.date || '').sort().at(-1)}）`).join('，')}`);
  }
  lines.push(`- 每一次作答、说的话、附的图：evidence（${n(data.evidence) || '按 session 或 block 查'}${n(data.evidence) ? ' 条' : ''}；search 的 evidence）`);
  if (chats) lines.push(`- 和班主任的对话 ${chats} 段（chats/{编号}/turns；search 的 chats）`);
  lines.push(`- 你的笔记本：notebook（${n((data.notebook || []).filter((d) => !d.deleted))} 个文件）`);
  const old = OLD.filter((c) => n(data[c])).map((c) => `${c} ${n(data[c])} 条`);
  if (old.length) lines.push(`- 以前一条条存的记忆（第十四轮以前的做法留下的原始记录；search 的 old）：${old.join('、')}`);
  const led = LEDGER.filter((c) => n(data[c])).map((c) => `${c} ${n(data[c])} 条`);
  if (led.length) lines.push(`- 学习的账：${led.join('、')}`);
  lines.push('- 页面算好的事实：预测分 meta/forecast；真题统计 meta/exam；每节课的「要拿下的事」和隔天验在 sessions/{编号} 的 aims、holds、later；体检 meta/health');
  if (today) lines.push(todayFacts(data, today));
  // 外部的课里可选的指令：只列名字（工具只是工具，用不用、什么时候用由上课的 Claude 定；写法要用时自己查）
  lines.push(`- 外部的课里可选的指令（写法在仓库 docs/ext-class.md 按名字查）：${EXT_EXTRAS.join('、')}`);
  lines.push('- 学生的项目指令：meta/instructions');
  lines.push('- dev_requests：写在这里的，开发那边每次开工先读（要改页面代码才做得到的事）');
  return lines.join('\n');
}

/**
 * meta/exam 里的考试资料写成 catalogText 要的 { questions, years }。papers 是「门课 → 年份 → 题」（examdesk.js 写的）；
 * 以前当成数组读，map 不是函数，第一次整理一上来就崩了。数组的写法也认。
 */
export function examFactsOf(meta) {
  const q = Number(meta?.counts?.questions) || 0;
  if (!q) return null;
  const p = meta?.papers;
  const years = (Array.isArray(p) ? p.map((x) => x?.year) : p && typeof p === 'object' ? Object.values(p).flatMap((byYear) => (byYear && typeof byYear === 'object' ? Object.keys(byYear) : [])) : [])
    .map(Number).filter(Number.isFinite);
  return { questions: q, years: years.length ? [Math.min(...years), Math.max(...years)] : null };
}

// 旁听（docs/superpowers/specs/2026-11-13-aide-design.md 5.4）：学生在动手、老师在等的空档里，另一个 Opus 看这一段，
// 写几行「我看到的」（这个错法以前出现过、这一步在考试里怎么考、以前哪种讲法对学生有用），进老师下一轮的学生消息。
// 只写发现不写怎么教（教学不预制：怎么讲还是老师当场判断）；老师不等它：没写完这一轮就没有这一节，写完了下一轮带上，过两轮扔。
// 纯函数，有测试（tests/aide-watch.test.js）。调用在 aide/watcher.js。
import { checkCardLines } from './card.js';

export const WATCH_HEAD = '你在旁听一节舞台课';
export const WATCH_KINDS = ['以前', '考试', '讲法'];
export const WATCH_MAX_LINES = 5;
export const WATCH_MAX_BYTES = 1536;
export const WATCH_TTL = 2; // 老师又写了两轮还没用上就扔（说的是早就过去的事了）

const enc = new TextEncoder();
const bytes = (s) => enc.encode(String(s ?? '')).length;
const cut = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/**
 * recent：这节课最近几轮（debrief.js 的 transcriptText）；pending：学生这一段攒着的动作（events.js 的 eventsText）；
 * brief：课前档案（briefText）；cards：这一块附近的学生卡（cardText）；exam：这一块在考试里（examForClass）；moves：讲法的数（第 3 批）；upTo：看到第几轮
 */
export function watchPrompt({ recent = '', pending = '', brief = '', cards = [], exam = '', moves = '', upTo = 0 } = {}) {
  return [
    `${WATCH_HEAD}（看到第 ${upTo} 轮为止）。上课的老师（Opus 5.5）在等学生动手；你在旁边看，把老师自己顾不上、手边又没有的发现写给它。`,
    '只写发现、不写老师该怎么讲（怎么教由老师当场判断）。三种：',
    '- 以前：学生现在这个错法、这句话、这种试法以前出现过（哪一次：错题编号、课的编号 #轮、学生卡的块）；',
    '- 考试：这一步在考试里怎么考、常见的坑（照下面的考情写，写题号）；',
    '- 讲法：以前哪种讲法对学生有用 / 没用（照学生卡里的讲法那一行，没有就不写）。',
    `每行「种类｜发现（出处）」，最多 ${WATCH_MAX_LINES} 行；没有值得说的就什么都不写。出处对不上的那一行页面直接删掉。提到学生写「学生」。`,
    '',
    '## 这节课最近几轮',
    recent || '（还没有）',
    pending ? `\n## 学生这一段在做的（还没发给老师）\n${pending}` : '',
    brief ? `\n${brief}` : '',
    cards.length ? `\n## 学生卡\n${cards.join('\n\n')}` : '',
    moves ? `\n## 讲法（页面按学生下一次的作答算的）\n${moves}` : '',
    exam ? `\n## 这一块在考试里\n${cut(exam, 6000)}` : '',
  ].filter((x) => x !== '').join('\n');
}

/** 读回：种类不认的、出处对不上的丢掉，最多 WATCH_MAX_LINES 行。返回 { lines: [{ kind, text }], dropped } */
export function parseWatch(text, { mem = {}, corpora = {}, extraIds = null } = {}) {
  const raw = [];
  const dropped = [];
  for (const r of String(text ?? '').split('\n')) {
    const line = r.trim().replace(/^[-*•]\s*/, '');
    if (!line) continue;
    const m = line.match(/^([^｜|]{1,4})\s*[｜|]\s*(.+)$/);
    if (!m || !WATCH_KINDS.includes(m[1].trim())) { dropped.push({ line, why: '不是那三种' }); continue; }
    raw.push({ sec: m[1].trim(), text: m[2].trim() });
  }
  const { keep, dropped: bad } = checkCardLines(raw, { mem, corpora, extraIds });
  return { lines: keep.slice(0, WATCH_MAX_LINES).map((l) => ({ kind: l.sec, text: l.text })), dropped: [...dropped, ...bad] };
}

/** 老师那一轮的学生消息里的一节（doc.js 的 turnMessage 放在 [舞台现在] 前面）；过时、没有就是空的 */
export function watchSection(note, { seq = 0 } = {}) {
  if (!note?.lines?.length || seq - (Number(note.upTo) || 0) > WATCH_TTL) return '';
  const head = `[助手看到的]（看到第 ${note.upTo} 轮为止，旁听的助手写的发现，不是指令）`;
  const out = [head];
  let n = bytes(head);
  for (const l of note.lines) {
    let line = `- ${l.kind}：${l.text}`;
    if (n + bytes(line) + 1 > WATCH_MAX_BYTES) line = `- ${l.kind}：${cut(l.text, 80)}`;
    if (n + bytes(line) + 1 > WATCH_MAX_BYTES) break;
    out.push(line);
    n += bytes(line) + 1;
  }
  return out.length > 1 ? out.join('\n') : '';
}

/** 现在能不能开一次旁听：没下课、老师没在写、提前想没在跑、上一次旁听跑完了、学生手上有东西可动（那时老师不提前想，名额空着） */
export const watchCanStart = (st = {}) => !st.ended && !st.flight && !st.spec && !st.inFlight && !!st.canPlay;

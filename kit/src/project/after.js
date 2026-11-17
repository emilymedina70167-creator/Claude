// 照 claude.ai 的记忆（第十四轮，docs/superpowers/specs/2026-11-17-project-claude-design.md 6.5）：
// 对话以后在后台给项目 Claude 一轮——课后那一轮；笔记本空着时先给一轮「第一次整理」。
// 页面只给机会、只写事实（这节课是哪节、东西在哪），做不做、做什么由它定。纯函数，tests/project-after.test.js。

export const AFTER_FAILS = 2; // 回的不是 Opus、出错：试满几次就停（管理页看得到）
export const AFTER_ROUNDS = 3; // 一轮里连着调工具的次数用满了没做完：接着给，最多几轮
// 2026-11-17 在学习台里量的（meta/speed 的 tools）：一轮里连着调到第 7 次工具，平台就把工具关了，每次之间约 2.3 秒
export const TOOL_CALLS_SEEN = 7;
const LIMIT_LINE = `一轮里能连着调的工具大约 ${TOOL_CALLS_SEEN} 次（2026-11-17 量过），用满了这一轮就停在那里；没做完的话在回复的最后写 [接着]，页面会再给一轮（一共最多 ${AFTER_ROUNDS} 轮）。`;

/** 这一轮没做完：平台说截断了，或者它在回复最后写了 [接着] */
export const afterCont = (res) => !!res?.truncated || /\[接着\]$/.test(String(res?.text ?? '').trim());

const isClass = (s) => !s.kind || s.kind === 'class';

/** 这节课要不要给课后那一轮。since：第一次整理做完的时间（那以前上的课由那一次整理读） */
export function needsAfter(s, { since } = {}) {
  if (!s || !isClass(s) || s.status !== 'closed' || s.deleting) return false;
  if (!Number.isFinite(since) || !(Number(s.endedAt) > since)) return false;
  const a = s.after || {};
  if (a.at) return !!a.cont && (Number(a.rounds) || 1) < AFTER_ROUNDS;
  return (Number(a.fails) || 0) < AFTER_FAILS;
}

/** 课后那一轮的那句话：只写事实 */
export function afterPrompt(s) {
  const id = s.id;
  const lines = [
    `这节课（${s.title || '这节课'}${s.date ? `，${s.date}` : ''}）结束了。课后报告在 sessions/${id}/report/main，每一轮在 sessions/${id}/class_turns，作答和学生说的话在 evidence（session = ${id}）。`,
    LIMIT_LINE,
  ];
  if (s.after?.cont) lines.push(`上一轮没做完，做到了这里：${String(s.after.last || '').slice(0, 600) || '（没留下）'}`);
  return lines.join('\n');
}

/** 第一次整理：笔记本里一个文件也没有（删掉的不算），也还没整理过 */
export function needsOrganize(notes, project) {
  if (project?.since) return false;
  return !(notes || []).some((d) => d && !d.deleted && d.path);
}

/** 第一次整理的那句话：以前的记录在哪、每类几条 */
// prev：meta/project（上一轮没做完时带着 last）
export function organizePrompt(counts = [], prev = null) {
  const list = (counts || []).filter((c) => c?.n).map((c) => `${c.collection} ${c.n} 条`).join('、');
  return [
    prev?.cont ? `第一次整理还没做完，上一轮做到了这里：${String(prev.last || '').slice(0, 600) || '（没留下）'}` : '笔记本还是空的。',
    `学习台以前的记录在这些地方：${list || '（没有）'}；每节课在 sessions，每一次作答和说的话在 evidence，和班主任的对话在 chats。`,
    LIMIT_LINE,
  ].join('\n');
}

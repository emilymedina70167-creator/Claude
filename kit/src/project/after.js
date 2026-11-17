// 照 claude.ai 的记忆（第十四轮，docs/superpowers/specs/2026-11-17-project-claude-design.md 6.5）：
// 对话以后在后台给项目 Claude 一轮——课后那一轮；笔记本空着时先给一轮「第一次整理」。
// 页面只给机会、只写事实（这节课是哪节、东西在哪），做不做、做什么由它定。纯函数，tests/project-after.test.js。

export const AFTER_FAILS = 2; // 回的不是 Opus、出错：试满几次就停（管理页看得到）
export const AFTER_ROUNDS = 3; // 一轮里连着调工具的次数用满了没做完：接着给，最多几轮

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
export function organizePrompt(counts = []) {
  const list = (counts || []).filter((c) => c?.n).map((c) => `${c.collection} ${c.n} 条`).join('、');
  return `笔记本还是空的。学习台以前的记录在这些地方：${list || '（没有）'}；每节课在 sessions，每一次作答和说的话在 evidence，和班主任的对话在 chats。`;
}

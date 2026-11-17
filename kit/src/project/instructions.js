// 项目指令和「笔记」页的纯函数（第十四轮，画面在 notebookview.js）

export const INSTR_HISTORY = 20;

/** 存一版项目指令：没改就原样返回；旧的进 history（新的在前） */
export function saveInstructions(prev, text, at = Date.now()) {
  const t = String(text ?? '').trim();
  if (prev && String(prev.text ?? '').trim() === t) return prev;
  const history = prev ? [{ text: prev.text ?? '', at: prev.at ?? null, by: prev.by ?? null }, ...(prev.history || [])].slice(0, INSTR_HISTORY) : [];
  return { text: t, at, by: 'me', history };
}

/** 「笔记」页列哪些：show 的、没删的，最近改的在前 */
export const shownNotes = (docs) => (docs || []).filter((d) => d && d.show && !d.deleted && d.path).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));

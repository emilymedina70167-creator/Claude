// 舞台课：学生的每一下记成什么证据（纯函数，classroom.js 用；tests/stage-lesson-en1.test.js）。
// 页面判了对错的记成作答（课后报告、错题的依据、掌握都从作答里数）；别的记成动作；打的字记成说的话。
// 第一节真课查出来的：一次点几样（ask pick）页面判了一样不一样，却只记成动作——3 次点错没进报告；
// 按了按钮才判的挑战没做到也只记成动作，老师拿它当依据记错题时页面说「找不到那道题」。

const bool = (x) => (typeof x === 'boolean' ? x : null);

/**
 * a：学生的一下（stage.js 交出来的）；comp：这一问的编号（S21）；q：这一问的题面；goalText(id)：挑战的字。
 * 返回 { records: [作答…], event: 要不要另记一条动作, say: 说的话 }
 */
export function actEvidence(a, { comp, q = '', goalText = (id) => id } = {}) {
  const rec = (x) => ({ type: 'stage', block: comp, ...x });
  if (!a) return { records: [], event: false };
  // 预期的那几个这一刻不在舞台上（right 是 null，页面比不了）：不记对错
  if (a.type === 'tap' && a.expected) return { records: [rec({ q, value: a.value, text: a.ref, ok: bool(a.right) })], event: false };
  // 只收不判、页面没判成的（right 是 null）不记对错：记成 false 会被当成答错算进掌握
  if (a.type === 'value') return { records: [rec({ q, value: a.text, text: a.text, ok: bool(a.right) })], event: false };
  // 一次点几样：和预期的一样不一样页面比过了
  if (a.type === 'pick' && a.expected != null && typeof a.same === 'boolean') {
    const refs = (a.refs || []).join(' ');
    return { records: [rec({ q, value: a.words || refs, text: refs, ok: a.same })], event: false };
  }
  // 按了才判的挑战这一下没做到：记一次没做对（做到了的由 goal 那边记）
  if (a.type === 'next' && (a.onGoals || []).some((g) => g.met === false)) {
    return { records: a.onGoals.filter((g) => g.met === false).map((g) => rec({ q: goalText(g.id), value: 'goal', text: g.id, ok: false })), event: true };
  }
  if (a.type === 'say') return { records: [], event: false, say: a.text };
  return { records: [], event: true };
}

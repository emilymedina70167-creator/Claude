// 舞台课：学生的每一下记成什么证据（纯函数，classroom.js 用；tests/stage-lesson-en1.test.js）。
// 页面判了对错的记成作答（课后报告、错题的依据、掌握都从作答里数）；别的记成动作；打的字记成说的话。
// 第一节真课查出来的：一次点几样（ask pick）页面判了一样不一样，却只记成动作——3 次点错没进报告；
// 按了按钮才判的挑战没做到也只记成动作，老师拿它当依据记错题时页面说「找不到那道题」。

const bool = (x) => (typeof x === 'boolean' ? x : null);

/**
 * a：学生的一下（stage.js 交出来的）；comp：这一问的编号（S21）；q：这一问的题面；goalText(id)：挑战的字。
 * 返回 { records: [作答…], event: 要不要另记一条动作, say: 说的话 }
 */
export function actEvidence(a, { comp, q = '', goalText = (id) => id, sig = null, goalSig = null } = {}) {
  const rec = (x) => ({ type: 'stage', block: comp, ...(sig ? { sig } : {}), ...x });
  if (!a) return { records: [], event: false };
  // 预期的那几个这一刻不在舞台上（right 是 null，页面比不了）：不记对错
  if (a.type === 'tap' && a.expected) return { records: [rec({ q, value: a.value, text: a.ref, ok: bool(a.right) })], event: false };
  // 只收不判、页面没判成的（right 是 null）不记对错：记成 false 会被当成答错算进掌握
  // 答案框里打的是一句问话（asksBack）：不算一次作答，记成说的话
  if (a.type === 'value' && a.asks) return { records: [], event: false, say: a.text };
  if (a.type === 'value') return { records: [rec({ q, value: a.text, text: a.text, ok: bool(a.right) })], event: false };
  // 一次点几样：和预期的一样不一样页面比过了
  if (a.type === 'pick' && a.expected != null && typeof a.same === 'boolean') {
    const refs = (a.refs || []).join(' ');
    return { records: [rec({ q, value: a.words || refs, text: refs, ok: a.same })], event: false };
  }
  // 按了才判的挑战这一下没做到：记一次没做对（做到了的由 goal 那边记）
  if (a.type === 'next' && (a.onGoals || []).some((g) => g.met === false)) {
    return { records: a.onGoals.filter((g) => g.met === false).map((g) => ({ ...rec({ q: goalText(g.id), value: 'goal', text: g.id, ok: false }), ...(goalSig?.(g.id) ? { sig: goalSig(g.id) } : {}) })), event: true };
  }
  if (a.type === 'say') return { records: [], event: false, say: a.text };
  return { records: [], event: true };
}

// —— 这一问是什么（主线第七轮）：报告按它分题，老师换个说法重问同一个空就是同一道题 ——
// 以前一问一个编号（S41、S43），「再填一次：…」重问一次算成新的一道，先错后对成了一错一「一次对」
const objText = (o) => {
  if (!o) return '';
  const v = o.words ? [...o.words].sort((a, b) => a.slot - b.slot).map((w) => w.value) : o.cells ? [...o.cells].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)).map((c) => c.value) : o.nodes ? o.nodes.map((n) => n.value) : null;
  return v ? `${o.type}:${v.join(' ')}`.slice(0, 200) : `${o.type}:${o.id}`;
};
/** 一问的指纹：value 照判法和老师写的答案；tap / pick 照预期的那几处和那样东西现在的字（同一个名字重造成别的句子是另一道） */
export function askSig(w, scene) {
  if (!w) return null;
  if (w.kind === 'value') return `value|${w.type || ''}|${String(w.answer ?? '').trim()}`;
  if (w.kind === 'tap' || w.kind === 'pick') {
    const exp = [].concat(w.expect ?? []).join(' ').trim();
    if (!exp) return null;
    const ids = [...new Set(exp.split(/\s+/).map((r) => r.match(/^[A-Za-z_]\w*/)?.[0]).filter(Boolean))];
    return `${w.kind}|${exp}|${ids.map((id) => objText(scene?.objects?.get(id))).join('｜')}`;
  }
  return null;
}
/** 挑战的指纹：编号、字、条件（同一条挑战先没做到、后做到是一道） */
export const goalSig = (g) => (g ? `goal|${g.id}|${g.text || ''}|${g.when || ''}` : null);
/**
 * 一节课用一个：同一个空**紧挨着**重问（中间没问别的题）才算同一道。只看判法和答案的话，两道不同的题答案都是 4 就并成一道了
 * （收尾审查 3）。返回 (w, scene, at) → 指纹（at 是这一问在第几轮，接不上前一问时用它分开）
 */
export function makeSigger() {
  let last = null;
  return (w, scene, at = 0) => {
    const base = askSig(w, scene);
    if (!base) return null;
    if (last && last.base === base) return last.id;
    last = { base, id: `${base}@S${at}` };
    return last.id;
  };
}

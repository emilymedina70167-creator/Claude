// 拍子：课堂 Claude 一轮里「说一句 → 写一段 → 再说一句 → 圈一下」时，页面一拍一拍地播，
// 学生点「下一拍」往下走、点「‹」倒回去看前面那句话指的是哪儿。只是换了呈现方式：输出格式不变、不多调用。
// 纯函数，不碰 DOM（tests/class-beats.test.js）。

// 会改板面的指令（memo、plan、react 学生看不到，不算拍子里的内容）
export const VISUAL_OPS = new Set(['new', 'add', 'replace', 'hide', 'show', 'move', 'layout', 'pin', 'unpin', 'figure', 'mark', 'unmark']);
// 到了那一拍才执行的：段照常马上画（写错了要马上重写），只是先藏着；这些画了就改了学生正在看的东西
export const DEFERRED_OPS = new Set(['hide', 'show', 'move', 'layout', 'unpin', 'figure', 'mark', 'unmark']);

/**
 * segments：protocol.js parseOutput 的 segments（final）。isOp：闭合了、看得懂的 board 块。
 * 一拍 = 一段话 + 后面跟着的指令；开头的指令算第一拍；后面只有话、没有改板面指令的并进前一拍（话接在后面）。
 * 返回 { talks: [每一拍的话], opBeat: [按 ops 的顺序，每条指令在第几拍（从 0 数）] }。少于两拍时 talks 只有一条（不播）。
 */
export function beatPlan(segments = [], isOp = (s) => s.type === 'board' && s.closed && s.op && !s.op.error) {
  const beats = []; // { talk, visual }
  const opBeat = [];
  for (const s of segments) {
    if (s.type === 'speech') {
      // 开头先写了指令、还没说话：这句话就是第一拍的话
      if (beats.length === 1 && !beats[0].talk) beats[0].talk = s.text;
      else beats.push({ talk: s.text, visual: 0 });
      continue;
    }
    if (!isOp(s)) continue;
    if (!beats.length) beats.push({ talk: '', visual: 0 });
    const b = beats.length - 1;
    opBeat.push(b);
    if (VISUAL_OPS.has(s.op.op)) beats[b].visual++;
  }
  // 并拍：没有改板面指令的拍并进前一拍。记下每一拍并到了哪一拍
  const into = [];
  const merged = [];
  beats.forEach((b, i) => {
    if (i > 0 && !b.visual && merged.length) {
      const last = merged[merged.length - 1];
      last.talk = [last.talk, b.talk].filter(Boolean).join('\n\n');
      into.push(merged.length - 1);
    } else {
      merged.push({ ...b });
      into.push(merged.length - 1);
    }
  });
  return { talks: merged.map((b) => b.talk), opBeat: opBeat.map((b) => into[b]) };
}

/**
 * 这一轮要不要播：至少两拍；第二拍以后不能有 new（换板必须在第一拍：后面的拍子都写在新板上）。
 * ops：和 opBeat 对齐的指令（{ op }）。
 */
export function shouldPlay(plan, ops = []) {
  if (!plan || plan.talks.length < 2) return false;
  return !ops.some((o, i) => o?.op === 'new' && plan.opBeat[i] > 0);
}

/** 第 k 拍（从 0 数）的提示：「2 / 4」 */
export const beatLabel = (k, n) => `${k + 1} / ${n}`;

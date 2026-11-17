// 板边助教（第十五轮，外部主讲的课）：外部在 ext_in 里写 board coach target=题 upto=…，学生在这一题上做错时，
// 页面叫页面里的 Claude（Opus 5.5 high）写一句，接在板上，标「助教」，进下一份 ext_out。
// 助教只拿到事实：这一题的原文、外部写的 upto、学生这次的作答。它没有写板的指令：板上那一段是页面照它那一句拼的。纯函数。

export const COACH_HEAD = '学习台的黑板上，学生刚在一道题上做错了。下面是这道题在板上的原文、主讲（外部的 Claude）给这一题定的提示范围、学生这次的作答。';

/** 给助教的那一条 */
export function coachPrompt({ segment = '', upto = '', answer = '' } = {}) {
  return [
    COACH_HEAD,
    `题（板上的原文）：\n${String(segment).trim()}`,
    `主讲定的提示范围：${String(upto).trim() || '（主讲没写）'}`,
    `学生这次的作答：${String(answer).trim()}`,
    '回一句话（中文，不超过 60 个字），写在这道题下面给学生看。',
  ].join('\n\n');
}

/** 助教那一句拼成板上的一段（接在当前板的最后）：第 n 次给这一题的提示 */
export function coachSegment(target, line, n = 1) {
  const F4 = '````';
  const text = String(line ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return `${F4}board add id=coach-${target}-${n} title="助教"\n> 助教：${text}\n${F4}\n`;
}

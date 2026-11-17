// 课前预演（docs/smart-plan.md 第 2 批）：备好教案以后，学习台在后台再调用一次 Opus，让它按这个学生的真实记录
// （错题、弱点、上一节复盘里还在的误解、习惯）扮演学生，把教案从第 1 步走到最后：每一步学生多半会怎么想、怎么答，
// 教案这一步能不能把误解暴露出来（确认题按错的想法也能做对，就暴露不出来）、题目有没有用到还没讲的规则；
// 缺的地方给一道能把对错两种想法分开的探题。结果写进教案的 rehearsal，课堂老师每一轮都看得到。
//
// 为什么不是「当场写好怎么回应」：教学不预制（硬性规定）。预演只说哪里会卡、拿什么题去探，和备课写的 traps 是一类东西；
// 学生真答了以后怎么接，照旧是老师当场看着写。只在课前、后台跑（lane: 'bg'），不碰上课的速度。
// 纯函数，有测试（tests/books-rehearse.test.js）；调用在 planview.js 的 rehearse。

export const REHEARSE_HEAD = '你在课前预演一份教案';
const CAPS = { steps: 12, fixes: 5 };
const none = (s) => !s || /^(无|没有|—|-|无问题)$/.test(String(s).trim());
const one = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const list = (v) => (Array.isArray(v) ? v : []);

/** 教案写成预演要看的文字：讲解顺序（带每一步怎么讲、怎么确认）、规则、题（放在第几步之后、用到哪几条规则） */
function planOf(main = {}, problems = {}) {
  const out = [];
  if (main.unit || main.goal) out.push(`单元：${main.unit || ''}${main.goal ? `；目标：${main.goal}` : ''}`);
  if (list(main.methods).length) out.push(`### 规则\n${main.methods.map((m) => `- ${m.id} ${m.title || ''}${m.teach ? `（第 ${m.teach} 步讲）` : ''}：${one(m.steps, 600)}`).join('\n')}`);
  if (list(main.sequence).length) out.push(`### 讲解顺序\n${main.sequence.map((x) => `${x.step}. ${one(x.point, 300)}${x.how ? `\n   怎么讲：${one(x.how, 400)}` : ''}${x.check ? `\n   确认：${one(x.check, 300)}` : ''}`).join('\n')}`);
  if (list(main.review).length && !main.reviewClass) out.push(`### 开头复现\n${main.review.map((r) => `- ${r?.id ?? r}：${one(r?.how ?? '', 200)}`).join('\n')}`);
  const items = list(problems?.items);
  if (items.length) out.push(`### 题\n${items.map((p, i) => `${i + 1}. ${one(p.q, 400)}${p.answer ? `\n   答案：${one(p.answer, 200)}` : ''}${p.after ? `\n   放在第 ${p.after} 步之后` : ''}${list(p.needs).length ? `；用到 ${p.needs.join('、')}` : ''}${p.traps ? `\n   备课时想到的陷阱：${one(p.traps, 200)}` : ''}`).join('\n')}`);
  if (main.plan) out.push(`### 补充\n${one(main.plan, 1500)}`);
  return out.join('\n\n');
}

/**
 * 给 Opus 的提示词。main / problems：备好的资料包（pack/main、pack/problems）；memoryText：和备课一样的记忆摘要；
 * debrief：上一节下课后的复盘文字（debrief.js 的 debriefText）；subject：门课
 */
export function rehearsePrompt({ main = {}, problems = {}, memoryText = '', debrief = '', subject = '' } = {}) {
  return [
    `${REHEARSE_HEAD}。下面是给下一节课备好的教案，和这个学生的真实记录。你先扮演这个学生：按记录里的错题、弱点、上一节还没消的误解和做题习惯，把教案从第 1 步走到最后，每一步想清楚学生会怎么理解、题会怎么答（带着这个学生的误解去答，不要替学生答对）。再回到老师的位置，看教案哪里会出问题。`,
    '',
    `## 教案${subject ? `（${subject}）` : ''}`,
    planOf(main, problems) || '（教案是空的）',
    '',
    debrief ? `## 上一节下课后的复盘\n${debrief}\n` : '',
    '## 学生的记录',
    memoryText || '（没有）',
    '',
    '## 要找的问题',
    '- 这一步的确认题，学生按错的想法也能做对：误解暴露不出来。',
    '- 题目用到了这一步之前还没讲的规则：学生会撞墙。',
    '- 讲规则用的几个例子结局都一样：学生会把巧合当成规则。',
    '- 讲之前没让学生先凭自己的理解做一次：误解被绕开了，消没消看不出来。',
    '- 记录里还在的误解、学生的习惯，这份教案哪一步正好会碰上。',
    '',
    '## 输出（只写下面两种行，一行一条，用全角竖线「｜」分开；没有问题的步不写；不要别的文字）',
    '步｜第几步（数字）｜学生多半会怎么想、怎么答｜这一步的问题｜加一道探题（具体的题，数值、句子写全；不用加就写「无」）',
    '改｜对教案的一条修改（具体到哪一步、改成什么）',
    `（步最多 ${CAPS.steps} 条、改最多 ${CAPS.fixes} 条。提到学生就写「学生」。）`,
  ].filter((x) => x !== '').join('\n');
}

/** 读回复：{ steps: [{ step, think, issue, probe }], fixes: [], problems: [] } */
export function parseRehearsal(text) {
  const out = { steps: [], fixes: [], problems: [] };
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim().replace(/^[-*•]\s*/, '');
    if (!line) continue;
    const f = line.split(/\s*[｜|]\s*/).map((x) => x.trim());
    const kind = f[0].replace(/[:：]$/, '');
    if (kind === '步') {
      const step = Number(String(f[1] || '').replace(/[^\d]/g, ''));
      if (!step || !f[3]) { out.problems.push(`看不懂：${one(line, 80)}`); continue; }
      if (out.steps.length < CAPS.steps) out.steps.push({ step, think: one(f[2], 300), issue: one(f[3], 300), ...(none(f[4]) ? {} : { probe: one(f.slice(4).join('｜'), 600) }) });
    } else if (kind === '改') {
      if (f[1] && out.fixes.length < CAPS.fixes) out.fixes.push(one(f.slice(1).join('｜'), 400));
    }
  }
  out.steps.sort((a, b) => a.step - b.step);
  if (!out.steps.length && !out.fixes.length) out.problems.push('回的不是预演');
  return out;
}

/** 预演写成课堂老师看的文字（资料包的「课前预演」一节） */
export function rehearsalText(r) {
  if (!r) return '';
  const lines = list(r.steps).map((s) => `- 第 ${s.step} 步：学生多半「${s.think}」；问题：${s.issue}${s.probe ? `；探题：${s.probe}` : ''}`);
  for (const f of list(r.fixes)) lines.push(`- 建议改：${f}`);
  return lines.join('\n');
}

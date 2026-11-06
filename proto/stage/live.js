// 舞台的样子页里 Opus 5.5 当场上一节（docs/stage-plan.md）：和学习台的舞台课用同一份按事件叫老师的办法（kit/src/stage/loop.js）——
// 学生在画面上随时动，做的事攒着；答了问的、做到了挑战又没有下一件事、打字、点提示、试了好几下、很久没动才叫老师；
// 老师边写边演，核验是 Opus 5.5（不是就整轮作废、再要，最多两次）；以「接着」结尾的一轮先把下一轮要来。
// 以前这里一轮一轮地等「这一问的回答」，遇上挑战（做到了是 cancel，不是回答）就停住、或者给老师发一条空的。
// 地址带 ?mock：照剧本回（不调用 Claude，本地检查这条路通不通）
import { firstMessage } from '../../kit/src/stage/doc.js';
import { createLoop } from '../../kit/src/stage/loop.js';

export const MODEL = 'claude-opus-5-5';
const TEACH = { model: MODEL, effort: 'high', modelTier: 'complex' };

/**
 * 上一节课。stage：舞台；topic：{ title, topic, material }；alive()：变成假就停；
 * status(info)：每一轮的计时、模型、没演的行（样子页画在角上）
 */
export async function liveLesson(stage, topic, { alive, status = () => {}, mock = false, thinking = () => {} } = {}) {
  const history = [];
  const stats = [];
  let seq = 0;
  const addTurn = (t) => { const row = { ...t, seq: ++seq, at: Date.now() }; history.push(row); return row; };
  const messages = ({ next } = {}) => {
    const msgs = [];
    const user = (content) => { if (msgs.at(-1)?.role === 'user') msgs.at(-1).content += `\n\n${content}`; else msgs.push({ role: 'user', content }); };
    user(firstMessage(topic));
    for (const t of history) {
      if (t.discarded || t.pending) continue;
      if (t.role === 'claude') msgs.push({ role: 'assistant', content: t.text });
      else if (t.role === 'student') user(t.msg || t.text);
    }
    if (next) user(next);
    return msgs;
  };
  let round = 0;
  const loop = createLoop({
    stage, mock, model: MODEL, teach: TEACH,
    call: (input, opts) => ask(input, mock, (text) => opts.onText?.({ text })),
    messages, addTurn, putTurn: () => {},
    thinking: (on) => { if (on) round++; thinking(on, round); },
    note: (t) => status({ round, error: t }),
    cost: (c) => {
      // 角上的计时：第一个字、写完；作废的、没用上的提前想也记着
      if (c.why === 'turn') { const row = { round, firstLine: c.first ?? null, total: c.ms, model: mock ? 'mock' : MODEL }; stats.push(row); status({ ...row, errors: [...stage.errors], stats }); }
      else if (c.why === 'failed') status({ round, voided: '不是 Opus 5.5 或者调用出错' });
      return c;
    },
  });
  if (typeof window !== 'undefined') window.LAStageLive = { history, stats, loop, log: stage.log };
  loop.teach('turn');
  // 回到菜单（alive 变假）：不再叫老师
  await new Promise((resolve) => { const t = setInterval(() => { if (!alive()) { clearInterval(t); loop.close(); resolve(); } }, 400); });
}

async function ask(messages, mock, onText) {
  if (mock) return mockAsk(messages, onText);
  const sample = await window.claude?.use?.('sample');
  if (!sample) throw new Error('这里调不了 Claude：要在 claude.ai 里打开这个页面');
  return sample(messages, { ...TEACH, cache: false, onText: ({ text }) => onText(text) });
}

// —— 本地检查用的模拟老师（?mock）：按第几轮回一段，学生点错 / 点对都接得上；第二轮故意有一行写错（看页面跳过它、告诉老师） ——
const MOCK = [
  () => `array a = 49 38 65 97 76 13 27 49′ 55 04
say "这一排要排成从小到大。先看 {a.1}。"
lift a.1
hop a.1 -> a.6 color=g1 label="隔 5 个"
drop a.1
paint a.1 a.6 g1
say "{a.1} 往后隔 5 个是 {a.6}，它俩一组。"
ask tap a "那 {a.2} 和谁一组？" expect=a.7`,
  (last) => (/点对了/.test(last)
    ? `link a.2 a.7 g2
& paint a.2 a.7 g2
swap a.1
say "对。剩下的也这样配。"
group a stride=5
ask next "看看一共几组" button="5 组"`
    : `hop a.2 -> a.7 color=g2
paint a.2 a.7 g2
swap a.1
say "从 {a.2} 跳 5 下，落在 {a.7}。"
group a stride=5
ask next "看看一共几组" button="5 组"`),
  () => `say "每组只在组里排好。蓝色这组你来。"
split a
ask drag a#1 a#6 "把小的拖到前面"`,
  () => `say "好。剩下的我来。"
swap a#2 a#7
swap a#3 a#8
& swap a#4 a#9
& swap a#5 a#10
merge a
glow a#1 a#8
ask tap a#1 a#8 "现在两个 49 谁在前？"`,
  () => `say "一样大的两个数换了先后，这叫 [不稳定]。"
fly say.1 -> key a#1 a#8
ask say "你觉得为什么会换？"`,
  () => `say "（模拟老师讲完了）"
ask next "" button="完"`,
];
async function mockAsk(messages, onText) {
  const k = messages.filter((m) => m.role === 'assistant').length;
  const last = messages.at(-1)?.content || '';
  const text = MOCK[Math.min(k, MOCK.length - 1)](last);
  await new Promise((r) => setTimeout(r, 600));
  let out = '';
  for (const line of text.split('\n')) { out += `${line}\n`; onText(out); await new Promise((r) => setTimeout(r, 140)); }
  return { text, modelApplied: 'mock' };
}

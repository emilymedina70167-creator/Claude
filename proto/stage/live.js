// 舞台 B 段（docs/stage-plan.md）：Opus 5.5 当导演，看着学生在画面上的动作，一轮一轮当场写镜头指令。
// 一轮：拼好发给它的内容（说明 + 对话 + 学生做了什么 + 舞台现在的样子）→ 边写边演（写完一行演一行）→
// 核验是 Opus 5.5（不是就整轮作废、照记录退回去、再要一次）→ 等学生在画面上动手 → 下一轮。
// 地址带 ?mock：照剧本回（不调用 Claude，本地检查这条路通不通）
import { actText } from '../../kit/src/stage/stage.js';
import { firstMessage, turnMessage } from '../../kit/src/stage/doc.js';

export const MODEL = 'claude-opus-5-5';
const TEACH = { model: MODEL, effort: 'high', modelTier: 'complex', cache: false };

/**
 * 上一节课。stage：舞台；topic：{ title, topic, material }；alive()：变成假就停；
 * status(info)：每一轮的计时、模型、没演的行（样子页画在角上）
 */
export async function liveLesson(stage, topic, { alive, status = () => {}, mock = false, thinking = () => {} } = {}) {
  const messages = [{ role: 'user', content: firstMessage(topic) }];
  const stats = [];
  let retried = 0;
  for (let round = 1; alive(); round++) {
    const turn = stage.begin();
    const t0 = performance.now();
    let first = null, firstLine = null;
    stage.onLine = () => { if (firstLine === null) { firstLine = performance.now(); thinking(false); } };
    thinking(true, round);
    let res;
    try {
      res = await ask(messages, mock, (text) => {
        if (first === null && text.trim()) first = performance.now();
        turn.push(text);
      });
    } catch (err) {
      await turn.abort();
      thinking(false);
      status({ round, error: err?.message || String(err) });
      if (!alive()) return;
      // 调用失败（网断了、限流）：学生点一下再试，不自己一直重试
      const again = await stage.play('ask next "老师那边没连上。点一下再试。" button="再试一次"');
      if (!again.act) return;
      round--;
      continue;
    }
    if (!alive()) return;
    // 只能是 Opus 5.5：不是就整轮作废（先画上去的也退回去），再要一次（最多两次，不加退路模型）
    if (!mock && res.modelApplied !== MODEL) {
      await turn.abort();
      thinking(false);
      status({ round, voided: res.modelApplied || '没说是哪个模型' });
      if (retried++ < 2) { round--; continue; }
      await stage.play(`ask next "这一轮不是 Opus 5.5 写的，作废了。点一下再要一次。" button="再要一次"`);
      retried = 0; round--; continue;
    }
    retried = 0;
    const done = performance.now();
    const text = res.text || '';
    // 记成一轮：写完、第一个字、第一个镜头（第一行开演）
    const row = { round, first: first ? first - t0 : null, firstLine: firstLine ? firstLine - t0 : null, total: done - t0, chars: text.length, model: res.modelApplied || 'mock' };
    stats.push(row);
    status({ ...row, errors: [], stats });
    const result = await turn.end(text);
    if (!alive() || result.dead) return;
    status({ ...row, errors: result.errors, stats });
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: turnMessage({ act: actText(result.act, stage.scene), state: stage.scene.stateText(), errors: result.errors }) });
    if (typeof window !== 'undefined') window.LAStageLive = { messages, stats, log: stage.log };
  }
}

async function ask(messages, mock, onText) {
  if (mock) return mockAsk(messages, onText);
  const sample = await window.claude?.use?.('sample');
  if (!sample) throw new Error('这里调不了 Claude：要在 claude.ai 里打开这个页面');
  return sample(messages, { ...TEACH, onText: ({ text }) => onText(text) });
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

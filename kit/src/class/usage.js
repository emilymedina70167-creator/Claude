// 这节课调用 Claude 花了多少（docs/desk-plan.md 第 7 节「省额度」第 1 条）。纯函数，有测试（tests/class-usage.test.js）。
// 页面调用 Claude 不记得上一轮：每调用一次，整份说明（角色、组件手册、记忆摘要、资料包、黑板现状、对话）都要重发一遍。
// 平台不回报 token 数，所以记的是发出去的字节数（fitTurns 算好的那份），换算成「约多少千 token」给人看。
// 每一次调用记在那一轮的 class_turns 上：cost = { bytes, why, tools }。
// - why：turn（学生说话 / 作答引起的一轮，必须的）、closing（下课小结）、lint（组件写错了要它重写）、images（它要看原图，补发一轮）、
//   stuck（停久了提醒老师）、compact（对话太长写摘要）、failed（出错或者平台换了模型，这一轮白花了）
// - tools：这一次调用里它调了几次工具。每调一次工具，平台要再跑一整轮（整份说明再读一遍），按每次一轮估。

// 中文为主的说明：实测大约每 2.8 个字节一个 token（60～160 KB ≈ 2～6 万 token）
export const BYTES_PER_TOKEN = 2.8;
export const approxTokens = (bytes) => Math.round((Number(bytes) || 0) / BYTES_PER_TOKEN);

export const WHY = ['turn', 'closing', 'lint', 'images', 'stuck', 'compact', 'failed'];
export const WHY_TEXT = { lint: '重写', images: '看原图', tools: '工具', stuck: '停久提醒', compact: '摘要', failed: '出错作废' };

/** 一次调用的花费，记在 class_turns 那一轮上 */
export function callCost({ bytes, why = 'turn', tools = 0 }) {
  return { bytes: Math.max(0, Math.round(Number(bytes) || 0)), why: WHY.includes(why) ? why : 'turn', ...(tools > 0 ? { tools: Math.round(tools) } : {}) };
}

/**
 * 整节课的花费：{ calls（估计跑了几轮，含工具轮）, bytes, tokens, avgBytes（平均每轮）, need（必须的：讲课 + 小结）, extra（多跑的轮数，按原因）, extraCalls }。
 * 工具轮按「同样大小再发一遍」估（实际还要加上前面几轮的输出，略多一点）。
 */
export function usageOf(turns = []) {
  const extra = {};
  let calls = 0, bytes = 0, need = 0;
  for (const t of turns || []) {
    const c = t?.cost;
    if (!c || !Number.isFinite(c.bytes)) continue;
    const tools = Number(c.tools) || 0;
    calls += 1 + tools;
    bytes += c.bytes * (1 + tools);
    if (c.why === 'turn' || c.why === 'closing') need++;
    else extra[c.why] = (extra[c.why] || 0) + 1;
    if (tools) extra.tools = (extra.tools || 0) + tools;
  }
  const extraCalls = Object.values(extra).reduce((a, b) => a + b, 0);
  return { calls, bytes, tokens: approxTokens(bytes), avgBytes: calls ? Math.round(bytes / calls) : 0, need, extra, extraCalls };
}

/** 「约 4.2 万 token」「约 800 token」 */
export function tokenText(bytes) {
  const t = approxTokens(bytes);
  if (t >= 10000) return `约 ${(t / 10000).toFixed(t >= 100000 ? 0 : 1).replace(/\.0$/, '')} 万 token`;
  if (t >= 1000) return `约 ${(t / 1000).toFixed(1).replace(/\.0$/, '')} 千 token`;
  return `约 ${t} token`;
}

/** 给人看的一行：这节课调用了几轮、一共和平均每轮花了多少、多跑了几轮为什么。没调用过返回 '' */
export function usageText(u) {
  if (!u?.calls) return '';
  const why = Object.entries(u.extra || {}).filter(([, n]) => n > 0).map(([k, n]) => `${WHY_TEXT[k] || k} ${n}`);
  return `调用 Claude ${u.calls} 轮，共${tokenText(u.bytes)}（每轮平均${tokenText(u.avgBytes)}）${u.extraCalls ? `；多跑 ${u.extraCalls} 轮：${why.join('、')}` : ''}`;
}

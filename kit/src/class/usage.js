// 这节课调用 Claude 花了多少（docs/desk-plan.md 第 7 节「省额度」第 1 条）。纯函数，有测试（tests/class-usage.test.js）。
// 页面调用 Claude 不记得上一轮：每调用一次，整份说明（角色、组件手册、记忆摘要、资料包、黑板现状、对话）都要重发一遍。
// 平台不回报 token 数，所以记的是发出去的字节数（fitTurns 算好的那份），换算成「约多少千 token」给人看。
// 每一次调用记在那一轮的 class_turns 上：cost = { bytes, why, tools }。
// - why：turn（学生说话 / 作答引起的一轮，必须的）、closing（下课小结）、lint（组件写错了要它重写）、images（它要看原图，补发一轮）、
//   stuck（停久了提醒老师）、compact（对话太长写摘要）、failed（出错或者平台换了模型，这一轮白花了）、
//   spec（抢跑没用上：学生做了别的，那次调用白花了；spec.js）。抢跑接上了的那一轮照常是 turn，cost.spec = 'hit'；
//   preview（舞台老师写了 preview，页面带着排好的版面马上再叫一次，第八轮）
// - tools：这一次调用里它调了几次工具。每调一次工具，平台要再跑一整轮（整份说明再读一遍），按每次一轮估。

// 中文为主的说明：实测大约每 2.8 个字节一个 token（60～160 KB ≈ 2～6 万 token）
export const BYTES_PER_TOKEN = 2.8;
export const approxTokens = (bytes) => Math.round((Number(bytes) || 0) / BYTES_PER_TOKEN);

export const WHY = ['turn', 'closing', 'lint', 'images', 'stuck', 'compact', 'failed', 'spec', 'preview'];
export const WHY_TEXT = { lint: '重写', images: '看原图', tools: '工具', stuck: '停久提醒', compact: '摘要', failed: '出错作废', spec: '抢跑没用上', preview: '老师要看版面' };

/** 一次调用的花费，记在 class_turns 那一轮上 */
// ms：从发出到写完一共多久（学生等了多久）；first：从发出到黑板上出现第一个字（边写边显示时学生先看到东西的时候）
export function callCost({ bytes, why = 'turn', tools = 0, ms, first, spec, img }) {
  const t = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
  return {
    bytes: Math.max(0, Math.round(Number(bytes) || 0)), why: WHY.includes(why) ? why : 'turn', ...(tools > 0 ? { tools: Math.round(tools) } : {}),
    ...(t(ms) !== undefined ? { ms: t(ms) } : {}), ...(t(first) !== undefined ? { first: t(first) } : {}),
    ...(spec === 'hit' ? { spec: 'hit' } : {}),
    // img：这一次带的画面图多少字节（舞台第九轮：每轮把画面截图给老师）
    ...(Number(img) > 0 ? { img: Math.round(img) } : {}),
  };
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
  // 页面按预案自己接了几次（react.js）：每一次本来都是一整轮调用
  const local = (turns || []).filter((t) => t?.kind === 'react' && !t.discarded).length;
  // 学生等了多久：讲课的轮（turn）平均从发出到写完、到第一个字出现
  const timed = (turns || []).map((t) => t?.cost).filter((c) => c && c.why === 'turn' && Number.isFinite(c.ms));
  const avg = (k) => { const xs = timed.map((c) => c[k]).filter(Number.isFinite); return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined; };
  const wait = timed.length ? { n: timed.length, ms: avg('ms'), ...(avg('first') !== undefined ? { first: avg('first') } : {}) } : null;
  // 抢跑（spec.js）：接上了几轮、白跑了几次
  const hit = timed.filter((c) => c.spec === 'hit').length;
  const miss = extra.spec || 0;
  return { calls, bytes, tokens: approxTokens(bytes), avgBytes: calls ? Math.round(bytes / calls) : 0, need, extra, extraCalls, ...(local ? { local } : {}), ...(wait ? { wait } : {}), ...(hit || miss ? { spec: { hit, miss } } : {}) };
}

/** 「约 4.2 万 token」「约 800 token」 */
export function tokenText(bytes) {
  const t = approxTokens(bytes);
  if (t >= 10000) return `约 ${(t / 10000).toFixed(t >= 100000 ? 0 : 1).replace(/\.0$/, '')} 万 token`;
  if (t >= 1000) return `约 ${(t / 1000).toFixed(1).replace(/\.0$/, '')} 千 token`;
  return `约 ${t} token`;
}

const secs = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;

/** 给人看的一行：这节课调用了几轮、一共和平均每轮花了多少、多跑了几轮为什么。没调用过返回 '' */
export function usageText(u) {
  if (!u?.calls) return '';
  const why = Object.entries(u.extra || {}).filter(([k, n]) => n > 0 && k !== 'spec').map(([k, n]) => `${WHY_TEXT[k] || k} ${n}`);
  const wasted = u.extraCalls - (u.extra?.spec || 0);
  return `调用 Claude ${u.calls} 轮，共${tokenText(u.bytes)}（每轮平均${tokenText(u.avgBytes)}）${wasted ? `；多跑 ${wasted} 轮：${why.join('、')}` : ''}${u.spec ? `；抢跑接上 ${u.spec.hit} 次（没用上 ${u.spec.miss} 次）` : ''}${u.local ? `；页面按预案接了 ${u.local} 次，没调用` : ''}${u.wait ? `；每轮平均等 ${secs(u.wait.ms)}${u.wait.first !== undefined ? `，${secs(u.wait.first)}后开始出字` : ''}` : ''}`;
}

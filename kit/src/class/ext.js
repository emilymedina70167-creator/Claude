// 外部主 Claude 的课（第十五轮，docs/superpowers/specs/2026-11-17-external-teacher-*.md）：
// 外部每一轮写一条 sessions/{编号}/ext_in/{序号}（和页面里老师的回复同一种写法），页面画上板、写 done；
// 学生这边的现状页面写成 sessions/{编号}/ext_out/{序号} 给它读。这里是不碰 DOM 的那一半。纯函数，tests/class-ext.test.js。

const numOf = (d) => (Number.isFinite(Number(d?.seq)) ? Number(d.seq) : Number(String(d?.id ?? '').replace(/\D/g, '')) || 0);

/** 还没执行的 ext_in：没写 done 的，按序号从小到大 */
export function pendingIns(docs = []) {
  return (docs || []).filter((d) => d && !d.done).sort((a, b) => numOf(a) - numOf(b));
}

/** 一份 ext_out 的正文：要报的错误（写法错误、没执行的、被拦下的）在最前，一条一行；再是这一批的作答和学生说的；最后是黑板现状 */
export function outText({ head = [], message = '', state = '' } = {}) {
  return [(head || []).filter(Boolean).join('\n'), String(message || '').trim(), String(state || '').trim()].filter(Boolean).join('\n\n');
}

/** 下一个 ext_out 的序号 */
export const outSeq = (docs = []) => (docs || []).reduce((m, d) => Math.max(m, numOf(d)), 0) + 1;
/** 文档编号：三位数，按编号排就是按先后 */
export const seqId = (n) => String(n).padStart(3, '0');

/** 来回时间：每条 ext_in（after = 它读过的那份 ext_out 的序号，got = 页面收到的时刻）配上那份 ext_out 写好的时刻。毫秒 */
export function latency(outs = [], ins = []) {
  const at = new Map((outs || []).map((o) => [numOf(o), Number(o.at)]));
  const xs = (ins || []).map((i) => (at.has(Number(i?.after)) && Number.isFinite(Number(i.got)) ? Number(i.got) - at.get(Number(i.after)) : null))
    .filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
  return { n: xs.length, median: mid, p90: xs[Math.min(xs.length - 1, Math.ceil(0.9 * xs.length) - 1)] };
}

/** board coach target=题号 upto=…：外部开了这一题的板边助教，upto 是助教最多给到哪 */
export function parseCoach(head = '') {
  const kv = {};
  for (const m of String(head).matchAll(/([A-Za-z]+)\s*[=＝]\s*(?:"([^"]*)"|“([^”]*)”|(\S+))/g)) kv[m[1]] = m[2] ?? m[3] ?? m[4];
  if (!kv.target) return { error: '要写哪一题：board coach target=题号 upto=…' };
  return { target: kv.target, upto: kv.upto || '' };
}

/**
 * 执行完一条 ext_in 当场写在它上面的 result（需求 R3：外部不用等学生动一下才知道画成了什么样）。
 * boardOps：这一轮每条指令执行的结果；retry：写错没显示的段（和原因）；notes：别的提醒；error：整条没执行成
 */
export function inResult({ boardOps = [], retry = [], notes = [], error = '', shots = [], at = Date.now() } = {}) {
  const ops = (boardOps || []).filter(Boolean).map((o) => ({
    op: o.op, ...(o.id ? { id: o.id } : {}), ...(o.target ? { target: o.target } : {}), ok: !!o.ok,
    ...(o.error ? { error: String(o.error).slice(0, 600) } : {}), ...(o.page ? { page: o.page } : {}),
  }));
  const done = ops.filter((o) => o.ok).length;
  return {
    at, ok: !error && !(retry || []).length && ops.every((o) => o.ok),
    summary: error ? `没执行成：${error}` : `执行了 ${done} 条指令${ops.length - done ? `，${ops.length - done} 条没执行` : ''}${(retry || []).length ? `，${retry.length} 段写错没显示` : ''}`,
    ops, ...(retry?.length ? { errors: retry.map(String) } : {}), ...(notes?.length ? { notes: notes.map(String) } : {}),
    ...(error ? { error: String(error) } : {}), ...(shots?.length ? { shots } : {}),
  };
}

/** sessions/{编号}/meta/now：黑板现状，文字（和 ext_out 最后一段一样）+ 结构化的（undefined 去掉，数据库收得下） */
export function nowDoc({ text = '', board = null, at = Date.now() } = {}) {
  return { at, text: String(text || ''), ...(board ? { board: JSON.parse(JSON.stringify(board)) } : {}) };
}

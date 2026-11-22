// 外部主 Claude 的课（第十五轮）：
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

/**
 * 一条 ext_in 的写法对不对（去限制设计：不发说明书，报错里写正确的写法）。
 * error：执行不了（没有 text）；notes：照样执行，但写法和约定的不一样
 */
export function inProblems(d = {}, id = '') {
  const at = `ext_in/${id || d?.id || '?'}`;
  const n = numOf({ ...d, id: d?.id ?? id }) || 1;
  const notes = [];
  if (typeof d?.text !== 'string') {
    return { error: `${at} 没有 text${d?.text === undefined ? '' : `（写的是 ${Array.isArray(d.text) ? '数组' : typeof d.text}）`}：写成 { seq: ${n}, text: "对学生说的话，加 \`\`\`\`board …\`\`\`\` 块" }`, notes };
  }
  if (!Number.isFinite(Number(d?.seq)) || d?.seq === '' || d?.seq === null) {
    notes.push(`${at} 没写 seq${d?.seq === undefined ? '' : `（写的是 ${JSON.stringify(d.seq)}）`}，按文档编号${/\d/.test(String(id || d?.id || '')) ? '' : '（编号里没有数，排在最前）'}排的先后：写成 { seq: ${n}, text }`);
  }
  return { error: '', notes };
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
export function inResult({ boardOps = [], retry = [], notes = [], error = '', shots = [], shotNote = '', memo = [], at = Date.now() } = {}) {
  const ops = (boardOps || []).filter(Boolean).map((o) => ({
    op: o.op, ...(o.id ? { id: o.id } : {}), ...(o.target ? { target: o.target } : {}), ok: !!o.ok,
    ...(o.error ? { error: String(o.error).slice(0, 600) } : {}), ...(o.page ? { page: o.page } : {}),
  }));
  const done = ops.filter((o) => o.ok).length;
  return {
    at, ok: !error && !(retry || []).length && ops.every((o) => o.ok),
    summary: error ? `没执行成：${error}` : `执行了 ${done} 条指令${ops.length - done ? `，${ops.length - done} 条没执行` : ''}${(retry || []).length ? `，${retry.length} 段写错没显示` : ''}`,
    ops, ...(retry?.length ? { errors: retry.map(String) } : {}), ...(notes?.length ? { notes: notes.map(String) } : {}),
    ...(error ? { error: String(error) } : {}), ...(shots?.length ? { shots } : {}), ...(shotNote ? { shotNote: String(shotNote) } : {}), ...(memo?.length ? { memo } : {}),
  };
}

/** sessions/{编号}/meta/now：黑板现状，文字（和 ext_out 最后一段一样）+ 结构化的（undefined 去掉，数据库收得下） */
export function nowDoc({ text = '', board = null, at = Date.now() } = {}) {
  return { at, text: String(text || ''), ...(board ? { board: JSON.parse(JSON.stringify(board)) } : {}) };
}

const FROM_OPEN = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*board[ \t]+(add|new|replace|pin)\b(.*?)[ \t]+from[ \t]*=[ \t]*("[^"]+"|\S+)(.*)$/i;
/**
 * board add id=b5 from=集合/文档（需求 R2：后台活的结果直接上板）：执行前把那一条的 text（没有就 md）换进块里。
 * get(path) → Promise<文档或 null>。读不到的那一块原样留着、去掉 from=，返回 { text, missing: [路径] }
 */
export async function resolveFrom(text, get) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  const missing = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FROM_OPEN);
    if (!m) { out.push(lines[i]); continue; }
    const [, ind, fence, op, pre, rawPath, post] = m;
    const path = rawPath.replace(/^"|"$/g, '');
    // 找这一块的结尾（和开头同一种、不短于它的围栏）
    let j = i + 1;
    const closeRe = new RegExp(`^[ \\t]{0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
    while (j < lines.length && !closeRe.test(lines[j])) j++;
    const inner = lines.slice(i + 1, j);
    const doc = await Promise.resolve(get(path)).catch(() => null);
    const body = doc && typeof doc === 'object' ? String(doc.text ?? doc.md ?? '') : '';
    if (!body) missing.push(path);
    const all = [...inner, ...(body ? (inner.join('').trim() ? ['', body] : [body]) : [])].join('\n');
    // 换进来的文字里有同样长的围栏：外层加长，免得被它提前闭合
    const longest = Math.max(0, ...[...all.matchAll(new RegExp(`${fence[0] === '`' ? '`' : '~'}+`, 'g'))].map((x) => x[0].length));
    const f = fence[0].repeat(Math.max(fence.length, longest + 1));
    out.push(`${ind}${f}board ${op}${pre}${post}`, ...(all ? [all] : []), `${ind}${f}`);
    i = j;
  }
  return { text: out.join('\n'), missing };
}

/** ext_out 末尾的一句（dr-ext-round2：黑板现状不再每份重写） */
export const NOW_LINE = '黑板现状在这节课的 meta/now（板一变就更新）；外部上一条 ext_in 执行完以后的全部 ext_out 拼在 meta/since。';

/**
 * sessions/{编号}/meta/since（dr-ext-round2）：外部上一条 ext_in 执行完（done.at）以后写的全部 ext_out，按先后拼成一份。
 * ins / outs：库里的 ext_in / ext_out。返回 { at, from（那条 ext_in 的编号，没有是 null）, fromAt, outs: [序号], shots, text }
 */
export function sinceDoc({ ins = [], outs = [], at = Date.now() } = {}) {
  const done = (ins || []).filter((d) => d?.done?.at).sort((a, b) => Number(a.done.at) - Number(b.done.at)).at(-1) || null;
  const fromAt = done ? Number(done.done.at) : 0;
  const list = (outs || []).filter((o) => o && Number(o.at) > fromAt).sort((a, b) => numOf(a) - numOf(b));
  const strip = (t) => String(t || '').replace(NOW_LINE, '').trim();
  return {
    at, from: done ? String(done.id ?? '') || null : null, fromAt, outs: list.map(numOf),
    shots: list.flatMap((o) => o.shots || []),
    text: list.map((o) => `[ext_out ${seqId(numOf(o))}]\n${strip(o.text) || '（只有截图）'}`).join('\n\n') || '外部上一条 ext_in 执行完以后，学生这边还没有新的事。',
  };
}

/**
 * ext_in.said（dr-learning-trail T1）：以前是一个字符串；现在也收数组 [{ text, at, images }]（学生在 claude.ai 对话里说的每一句、贴的每张图）。
 * 返回 [{ text, at（毫秒，没写是 null）, images: [asset 编号] }]，空的去掉
 */
export function saidItems(said) {
  const list = Array.isArray(said) ? said : said == null ? [] : [said];
  return list.map((x) => (typeof x === 'string' ? { text: x } : x && typeof x === 'object' ? x : null)).filter(Boolean)
    .map((x) => ({ text: String(x.text ?? '').trim(), at: Number.isFinite(Number(x.at)) && Number(x.at) > 0 ? Number(x.at) : null, images: (Array.isArray(x.images) ? x.images : x.images ? [x.images] : []).map(String).filter(Boolean) }))
    .filter((x) => x.text || x.images.length);
}

/** 这一轮 memo 每一行记成没有（T2）：runMemo 的结果 { pds, rejected, extra } → [{ line, ok, id, error }] */
export function memoLines(r) {
  if (!r) return [];
  return [
    ...(r.extra || []),
    ...(r.pds || []).map((pd) => ({ line: String(pd.line || ''), ok: true, id: `${pd.coll}/${pd.target}`, ...(pd.status && pd.status !== 'done' ? { status: pd.status } : {}) })),
    ...(r.rejected || []).map((x) => ({ line: String(x.line || ''), ok: false, error: String(x.error || '') })),
  ];
}

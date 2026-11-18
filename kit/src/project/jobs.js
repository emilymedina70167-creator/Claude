// 外部交给页面的后台活（需求 R2，学习台 dev_requests/dr-ext-control）：
//   ext_jobs/{id} 或 sessions/{编号}/ext_jobs/{id} = { prompt, see: ["books/B43/chunks/B43-1", …], out: "集合/文档", tools: ["read","list","search"] }
// 学习台开着时（首页跑全局的；进了课堂跑全局的和这节课的）页面一件一件跑（lane: bg、Opus 5.5 high），结果写到 out，
// 状态 queued → running → done / failed 写回那一件。这里是不碰数据库的那一半。tests/project-jobs.test.js
export const JOB_TOOLS = ['read', 'list', 'search'];
export const JOB_SEE_MAX = 12; // 一件最多先读几条
export const JOB_STALE_MS = 10 * 60 * 1000; // running 了这么久还没写完：当它断了（页面关了），重跑
const okDoc = (p) => { const s = String(p || '').split('/').filter(Boolean); return s.length >= 2 && s.length % 2 === 0 && s.every((x) => /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(x) && x !== '.' && x !== '..') ? s.join('/') : ''; };

/** 一件活写得对不对：{ ok, job: { prompt, see, out, tools } } 或 { error } */
export function checkJob(d = {}) {
  const prompt = String(d.prompt ?? '').trim();
  if (!prompt) return { error: '要写 prompt（交给它做什么）' };
  const out = okDoc(d.out);
  if (!out) return { error: 'out 要写结果存到哪一条（集合/文档，段数是双数），比如 "drafts/b43-adapt"' };
  const see = (Array.isArray(d.see) ? d.see : d.see ? String(d.see).split(/[,，\s]+/) : []).map(String).filter(Boolean);
  const bad = see.filter((p) => !okDoc(p));
  if (bad.length) return { error: `see 里要写一条条的路径（集合/文档）：${bad.slice(0, 3).join('、')} 不是` };
  if (see.length > JOB_SEE_MAX) return { error: `see 一次最多 ${JOB_SEE_MAX} 条（多的让它用 read 自己取）` };
  const tools = (Array.isArray(d.tools) ? d.tools : d.tools ? String(d.tools).split(/[,，\s]+/) : JOB_TOOLS).map((x) => String(x).toLowerCase()).filter(Boolean);
  const badT = tools.filter((t) => !JOB_TOOLS.includes(t));
  if (badT.length) return { error: `tools 只有 ${JOB_TOOLS.join(' / ')}（只读）：${badT.join('、')} 没有` };
  return { ok: true, job: { prompt, see, out, tools } };
}

/** 该跑的：没写状态的、queued 的、running 太久没写完的（页面关了断在中间）。按写的先后 */
export function pendingJobs(docs = [], now = Date.now()) {
  return (docs || []).filter((d) => d && (!d.status || d.status === 'queued' || (d.status === 'running' && now - (Number(d.startedAt) || 0) > JOB_STALE_MS)))
    .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0) || String(a.id).localeCompare(String(b.id)));
}

export const JOB_HEAD = '学习台的主讲（claude.ai 对话里的 Claude）交给你一件后台的活。你没有学生在等，结果会原样存进学习台，主讲之后读。';

/** 给它的那一条：主讲的话 + 先读好的几条（path → 内容）+ 结果存哪 */
export function jobPrompt(job, read = []) {
  return [
    JOB_HEAD,
    `主讲写的：\n${job.prompt}`,
    ...(read || []).map((r) => `学习台里的 ${r.path}：\n${r.data == null ? '（没有这一条）' : typeof r.data === 'string' ? r.data : JSON.stringify(r.data).slice(0, 24000)}`),
    `你回的全文存进 ${job.out} 的 text 字段。${job.tools.length ? `能用的工具：${job.tools.join('、')}（只读）。` : ''}`,
  ].join('\n\n');
}

/** 存进 out 的那一条 */
export const jobOutDoc = ({ id, text, model, at = Date.now(), from = '' }) => ({ text: String(text ?? ''), job: id, by: 'ext-delegate', model, at, ...(from ? { from } : {}) });

/** 这件活现在的数（写进 meta/facts.jobs）：{ queued, running, done, failed } */
export function jobCounts(docs = []) {
  const c = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const d of docs || []) { const s = d?.status || 'queued'; if (s in c) c[s] += 1; }
  return c;
}

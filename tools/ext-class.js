// 外部的预检工具（第十五轮，tools/ext-check.mjs）的纯函数：这节课已有的 ext_in / ext_out 加上这一轮要写的，
// 拼成 check-lesson.mjs 认的 .class.json（{ unit, subject, turns: [{ student, teacher }] }）。tests/ext-class.test.js
const num = (d) => Number(d?.seq) || Number(String(d?.id ?? '').replace(/\D/g, '')) || 0;
const START = '开始上课。';

export function extClass({ ins = [], outs = [], next = '', unit = '外部的课', subject = '' } = {}) {
  const outBy = new Map((outs || []).map((o) => [num(o), String(o.text || '')]));
  const sorted = [...(ins || [])].sort((a, b) => num(a) - num(b));
  const turns = sorted.map((d) => ({ student: outBy.get(Number(d.after)) || START, teacher: String(d.text || '') }));
  if (next) {
    const latest = [...outBy.keys()].sort((a, b) => b - a)[0];
    turns.push({ student: latest ? outBy.get(latest) : START, teacher: String(next) });
  }
  return { unit, ...(subject ? { subject } : {}), turns };
}

/**
 * --session 给的是一个文件（dr-ext-round2）：每行一条 { id, data }（JSON Lines），或者整个文件是一个数组。
 * 哪条是 ext_in、哪条是 ext_out：看 id 的路径（sessions/c-…/ext_in/001）、写了的 coll，或者字段（有 done / after / claim 的是 ext_in）。
 * 返回 { id（课号，路径里读得出时）, ins, outs, bad（读不懂的行号） }
 */
export function sessionFromFile(text = '') {
  const src = String(text).trim();
  let rows = [];
  const bad = [];
  if (src.startsWith('[')) {
    try { rows = JSON.parse(src); } catch { bad.push(1); }
  } else {
    src.split('\n').forEach((l, i) => { if (!l.trim()) return; try { rows.push(JSON.parse(l)); } catch { bad.push(i + 1); } });
  }
  const ins = [], outs = [];
  let sid = '';
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const data = r.data && typeof r.data === 'object' ? r.data : r;
    const path = String(r.path || r.id || '');
    const m = path.match(/sessions\/([^/]+)\/(ext_in|ext_out)\/([^/]+)$/);
    if (m) sid = sid || m[1];
    const coll = m?.[2] || r.coll || r.collection || (data.done || data.after !== undefined || data.claim ? 'ext_in' : data.shots || /黑板现状|\[作答\]/.test(String(data.text || '')) ? 'ext_out' : '');
    const id = m?.[3] || String(r.id || '').split('/').pop() || String(data.seq ?? '');
    if (coll === 'ext_in') ins.push({ id, ...data });
    else if (coll === 'ext_out') outs.push({ id, ...data });
  }
  return { id: sid, ins, outs, bad };
}

// 课后收尾的工具（tools/ext-wrap.mjs）的纯函数。tests/ext-wrap.test.js
// 课后那六件事里，内容（定什么状态、小结写什么、哪条算失误）全是主讲自己写在清单里的，这里一个字不替写；
// 这里只做容易手滑的那一半：排编号、接着已有的 log / notes 往后加、每条改动配一条能撤销的 journal、分批、写完核对。
import { COLLECTIONS, toDate } from '../kit/src/memory/schema.js';

const KNOWN = new Set(['sid', 'space', 'date', 'mastery', 'summary', 'slips', 'notes', 'recall']);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/**
 * wrapPlan({ input, have, versions, now, rand }) → { writes, warnings }
 * have：现有文档 { mastery, slips, recall, summary, curriculum }（每条带 id）；versions：{ 'mastery/EN-G9.1': 3 }
 * writes：ArtifactData batch 的写法，每条改动后面紧跟它的 journal
 */
export function wrapPlan({ input = {}, have = {}, versions = {}, now = Date.now(), rand = Math.random } = {}) {
  const writes = [], warnings = [];
  const sid = String(input.sid || ''), space = String(input.space || '');
  const date = String(input.date || toDate(now));
  const day = date.replace(/-/g, '');
  const used = new Set();
  const tail = () => { let t; do { t = rand().toString(36).slice(2, 7).padEnd(5, '0'); } while (used.has(t)); used.add(t); return t; };
  const stamp = Number(now).toString(36);
  const find = (coll, id) => (have[coll] || []).find((d) => String(d.id) === String(id)) || null;
  // 一条改动 + 它的 journal。before / after 记整条：页面撤销是把 before 整条写回去（kit/src/project/journal.js）
  const put = (op, collection, doc_id, data, old) => {
    const path = `${collection}/${doc_id}`;
    const w = { op, collection, doc_id, data };
    if (old) {
      if (versions[path] != null) w.if_version = Number(versions[path]);
      else warnings.push(`${path} 是已有文档，没给版本号：写入会被拒`);
    }
    writes.push(w);
    writes.push({ op: 'set', collection: 'journal', doc_id: `j-${stamp}-${tail()}`, data: { at: now, by: 'ext', path, op, before: old || null, after: op === 'update' ? { ...(old || {}), ...data } : data } });
  };
  const blocks = new Set((have.curriculum || []).map((d) => String(d.id)));
  const checkBlock = (b) => { if (b && blocks.size && !blocks.has(String(b).split('#')[0])) warnings.push(`${b} 不在课程地图里`); };

  for (const k of Object.keys(input)) if (!KNOWN.has(k)) warnings.push(`清单里有不认识的栏：${k}（没用上）`);
  if (!sid && (list(input.slips).length || list(input.recall).length || input.summary || list(input.notes).length)) warnings.push('清单没写 sid：写出来的文档不带课号');

  const STATES = COLLECTIONS.mastery.enums.state;
  list(input.mastery).forEach((m, i) => {
    if (!m?.block || !m?.state) { warnings.push(`mastery 第 ${i + 1} 条没写 block 或 state，跳过了`); return; }
    const id = String(m.block);
    checkBlock(id);
    if (!STATES.includes(m.state)) warnings.push(`${id} 的「${m.state}」不是掌握状态的取值（${STATES.join('、')}）`);
    const found = find('mastery', id);
    const old = found && { ...found };
    const basis = list(m.basis).length ? list(m.basis) : sid ? [sid] : [];
    const note = String(m.note || '');
    const log = [...(old?.log || []), { basis, by: 'chat', date, field: 'state', from: old?.state ?? null, to: m.state, note: String(m.why || note) }];
    const data = { state: m.state, note, basis, log };
    // 档位是「复现通过」以后隔几天再测的那一档：状态离开复现通过，档位跟着清（和以前手写的一样）
    if (old && old.tier != null && m.state !== '复现通过') { data.tier = null; log.push({ basis, by: 'chat', date, field: 'tier', from: old.tier, to: null, note: `降回${m.state}` }); }
    if (old) put('update', 'mastery', id, data, old);
    else put('set', 'mastery', id, { id, block: id.split('#')[0], ...data }, null);
  });

  if (input.summary && typeof input.summary === 'object') {
    const s = input.summary;
    const text = [`# 课后小结（${[sid, s.title].filter(Boolean).join('，')}）`, `## 1. 这节课讲了什么\n${s.taught || ''}`, `## 2. 学生哪里卡住\n${s.stuck || ''}`, `## 3. 看起来懂了但证据不够\n${s.thin || ''}`, `## 4. 下一节怎么接\n${s.next || ''}`].join('\n\n');
    checkBlock(s.block);
    const id = `ob-${stamp}-${tail()}`;
    put('set', 'observations', id, clean({ id, kind: 'summary', by: 'ext', at: now, session: sid, block: s.block, about: [], text }), null);
  }

  let sn = Math.max(0, ...(have.slips || []).map((d) => Number(new RegExp(`^S-${day}-(\\d+)$`).exec(String(d.id))?.[1]) || 0));
  for (const s of list(input.slips)) {
    if (!s?.text) { warnings.push('slips 里有一条没写 text，跳过了'); continue; }
    const id = `S-${day}-${++sn}`;
    put('set', 'slips', id, clean({ id, by: 'ext', date, space, session: sid, text: String(s.text), lesson: s.lesson }), null);
  }

  const ns = list(input.notes).filter((n) => n?.text);
  if (ns.length) {
    if (!space) warnings.push('清单没写 space：notes 不知道追加进哪一科的摘要，跳过了');
    else {
      const old = find('summary', space);
      const add = ns.map((n) => clean({ at: now, by: 'ext', session: sid, text: String(n.text), quote: n.quote, when: n.when }));
      if (old) put('update', 'summary', space, { notes: [...(old.notes || []), ...add] }, old);
      else { warnings.push(`summary/${space} 还没有：新建了一条，「学到哪」是空的`); put('set', 'summary', space, { id: space, text: '', notes: add, at: now, by: 'ext' }, null); }
    }
  }

  let kn = Math.max(0, ...(have.recall || []).map((d) => Number(/^K(\d+)$/.exec(String(d.id))?.[1]) || 0));
  for (const r of list(input.recall)) {
    if (!r?.q || !r?.a) { warnings.push('recall 里有一条没写 q 或 a，跳过了'); continue; }
    checkBlock(r.block);
    const id = `K${++kn}`;
    const note = `课后补记 ${sid}`.trim();
    const entry = (field, to) => ({ basis: [], by: 'chat', date, field, from: null, to, note });
    put('set', 'recall', id, clean({ q: String(r.q), a: String(r.a), block: r.block, space, session: sid, tier: 1, last: date, status: 'active', lapses: 0, log: [entry('tier', 1), entry('last', date), entry('status', 'active')] }), null);
  }
  return { writes, warnings };
}

/** 一批最多 size 条；一条改动和紧跟着它的 journal 放在同一批 */
export function splitBatches(writes, size = 50) {
  const pairs = [];
  for (const w of writes || []) {
    if (w.collection === 'journal' && pairs.length && pairs.at(-1).length === 1 && pairs.at(-1)[0].collection !== 'journal') pairs.at(-1).push(w);
    else pairs.push([w]);
  }
  const out = [];
  for (const p of pairs) {
    if (!out.length || out.at(-1).length + p.length > size) out.push([]);
    out.at(-1).push(...p);
  }
  return out;
}

// 键的先后不算
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

/** 写完以后重新存一份现状来对：{ ok: ['recall/K1'…], missing: ['recall/K2：a 和要写的不一样'…] } */
export function wrapVerify({ writes = [], have = {} } = {}) {
  const ok = [], missing = [];
  for (const w of writes) {
    const path = `${w.collection}/${w.doc_id}`;
    const doc = (have[w.collection] || []).find((d) => String(d.id) === String(w.doc_id));
    if (!doc) { missing.push(`${path}：没有这一条`); continue; }
    const diff = Object.keys(w.data || {}).filter((k) => !same(w.data[k], doc[k]));
    if (diff.length) missing.push(`${path}：${diff.join('、')} 和要写的不一样`);
    else ok.push(path);
  }
  return { ok, missing };
}

// 记忆库的自检：对话里的 Claude 写进来的东西守不守规矩（纯函数，有测试）。学习台页面打开时跑一遍，结果写回 meta/memcheck，
// 对话里的 Claude 写完读它（和实时黑板的 lint 一样：它看不到页面，错了要有地方告诉它）。查这几样：
// - 编号、必填字段、只能取的值、日期的写法；指向别的条目的 id 找不找得到
// - 结论挂没挂证据：掌握状态（未学以外）要有 basis，弱点要挂错题或 basis
// - 历史类只增不改：错题、观察、失误记下指纹（ledger），内容变了、条目没了就报
// - 状态类改了要记 log：记下上次看到的值，变了而 log 里最新那条没写到这个新值，就报（补上 log 以后不再报）
import { COLLECTIONS, MEMORY_COLLECTIONS, REVIEW_TIERS, ROLES, isDate, reviewDue, dueList, lastLog, same, daysBetween } from './schema.js';

// 只增不改、页面记指纹的几类（证据是页面自己写的，条数多，不记）
export const LEDGER_HISTORY = ['errors', 'observations', 'slips'];
// 「改过历史」这类提醒留几天
export const FLAG_DAYS = 7;

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const empty = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

// 键排好序再序列化：数据库读回来的字段顺序可能变，不能因为顺序不同就当成改过
export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export function fingerprint(doc) {
  const { id: _, ...rest } = doc || {};
  const s = stable(rest);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(36)}.${s.length.toString(36)}`;
}

/**
 * data：{ 集合名: [{ id, ...字段 }] }（缺的集合当空的）；today：YYYY-MM-DD；ledger：上次的 meta/ledger（没有就是 null）。
 * 返回 { counts, problems: [{ coll, id, msg, soft? }], due（复现组到期，按先后）, ledger（新的，要写回）}
 */
export function checkMemory(data = {}, { today, ledger = null } = {}) {
  const problems = [];
  const add = (coll, id, msg, soft = false) => problems.push({ coll, id: String(id ?? ''), msg, ...(soft ? { soft: true } : {}) });
  const docs = {};
  const ids = {};
  for (const c of MEMORY_COLLECTIONS) {
    docs[c] = (Array.isArray(data[c]) ? data[c] : []).filter((d) => d && d.id !== undefined && d.id !== null);
    ids[c] = new Set(docs[c].map((d) => String(d.id)));
  }

  for (const c of MEMORY_COLLECTIONS) {
    const spec = COLLECTIONS[c];
    for (const d of docs[c]) {
      const id = String(d.id);
      if (!spec.id.re.test(id)) add(c, id, `编号「${id}」不对：${spec.label}的编号像 ${spec.id.eg}`);
      for (const f of spec.required) if (empty(d[f])) add(c, id, `缺少 ${f}`);
      for (const [f, vals] of Object.entries(spec.enums || {})) {
        if (d[f] !== undefined && d[f] !== null && !vals.includes(d[f])) add(c, id, `${f} 只能是 ${vals.join(' / ')}，现在是「${d[f]}」`);
      }
      for (const f of spec.dates || []) if (!empty(d[f]) && !isDate(d[f])) add(c, id, `${f} 要写成 YYYY-MM-DD，现在是「${d[f]}」`);
      for (const [f, target] of Object.entries(spec.refs || {})) {
        for (const ref of list(d[f])) {
          const key = String(ref);
          if (ids[target].has(key)) continue;
          // 指向的那一类还整个是空的（还没迁移过来）：只提醒，不算错
          if (!ids[target].size) add(c, id, `${f} 指向的 ${key} 在 ${target} 里没有（${COLLECTIONS[target].label}还是空的）`, true);
          else add(c, id, `${f} 指向的 ${key} 在 ${target}（${COLLECTIONS[target].label}）里找不到`);
        }
      }
      if (spec.kind === 'state' && d.log !== undefined) checkLog(c, id, d.log, add);
    }
  }

  // —— 各类自己的规矩 ——
  for (const d of docs.mastery) {
    const id = String(d.id);
    const block = String(d.block ?? id.split('#')[0]);
    if (!ids.curriculum.has(block)) add('mastery', id, `所在的块 ${block} 在课程地图里${ids.curriculum.size ? '找不到' : '还没有（课程地图是空的）'}`, !ids.curriculum.size);
    // 结论必须挂证据（课堂不能宣布掌握：这一类只有对话里的 Claude 写，依据要写清）
    if (d.state && d.state !== '未学' && empty(d.basis)) add('mastery', id, `「${d.state}」没有依据：basis 里写证据、错题或检验记录的 id`);
    if (d.state === '复现通过' && !REVIEW_TIERS.includes(Number(d.tier))) add('mastery', id, `「复现通过」要写到了第几档：tier 是 ${REVIEW_TIERS.join(' / ')}`);
  }
  for (const d of docs.weaknesses) {
    if (empty(d.errors) && empty(d.basis)) add('weaknesses', d.id, '没挂错题也没有依据：errors 里写错题编号，或者 basis 里写证据 id');
  }
  for (const d of docs.reviews) {
    const r = reviewDue(d, today);
    if (r.error) add('reviews', d.id, r.error);
    if (d.due !== undefined) add('reviews', d.id, '不用写 due：到期日由页面按 last 和 tier 算', true);
  }
  for (const d of docs.rules) {
    if (d.status === 'void' && empty(d.voidedBy) && empty(d.note)) add('rules', d.id, '作废的规则写一下被哪条取代（voidedBy）或者为什么作废（note）', true);
  }
  for (const d of docs.curriculum) {
    const id = String(d.id);
    const depth = id.split('.').length;
    const level = ['lecture', 'section', 'block'][depth - 1];
    if (d.level && d.level !== level) add('curriculum', id, `编号 ${id} 是${{ lecture: '讲', section: '节', block: '块' }[level]}，level 却写成 ${d.level}`);
    if (depth > 1) {
      const parent = id.split('.').slice(0, -1).join('.');
      if (!ids.curriculum.has(parent)) add('curriculum', id, `上一级 ${parent} 还没有`, true);
    }
  }

  // —— 指纹：历史类有没有被改、状态类改了有没有记 log ——
  const next = { hist: {}, state: {}, flags: [] };
  const prev = ledger && typeof ledger === 'object' ? ledger : null;
  const flags = (prev?.flags || []).filter((f) => f && f.date && isDate(f.date) && daysBetween(f.date, today) < FLAG_DAYS);
  const flag = (key, msg) => { if (!flags.some((f) => f.key === key && f.msg === msg)) flags.push({ key, msg, date: today }); };
  for (const c of LEDGER_HISTORY) {
    for (const d of docs[c]) {
      const key = `${c}/${d.id}`;
      const fp = fingerprint(d);
      const was = prev?.hist?.[key];
      if (was && was !== fp) flag(key, `${COLLECTIONS[c].label}只增不改，${d.id} 的内容被改了：要更正就追加一条新的（corrects: ${d.id}），原来那条不动`);
      next.hist[key] = fp;
    }
  }
  for (const key of Object.keys(prev?.hist || {})) {
    if (!(key in next.hist)) flag(key, `${key} 被删掉了：${COLLECTIONS[key.split('/')[0]]?.label || ''}只增不改，不删`);
  }
  for (const c of MEMORY_COLLECTIONS) {
    const tracked = COLLECTIONS[c].tracked;
    if (COLLECTIONS[c].kind !== 'state' || !tracked.length) continue;
    for (const d of docs[c]) {
      const key = `${c}/${d.id}`;
      const was = prev?.state?.[key] || {};
      const keep = {};
      for (const f of tracked) {
        const cur = d[f] ?? null;
        if (!(f in was) || same(was[f], cur)) { keep[f] = cur; continue; }
        const last = lastLog(d, f);
        if (last && same(last.to, cur)) { keep[f] = cur; continue; }
        // 没记 log：一直报，直到补上一条 to 是新值的 log（这之前指纹停在旧值上）
        add(c, d.id, `${f} 从「${fmt(was[f])}」改成了「${fmt(cur)}」，log 里没记：补一条 { date, by, field: "${f}", from, to, basis }`);
        keep[f] = was[f];
      }
      next.state[key] = keep;
    }
  }
  next.flags = flags;
  for (const f of flags) add(f.key.split('/')[0], f.key.split('/').slice(1).join('/'), `${f.msg}（${f.date} 发现）`);

  const counts = Object.fromEntries(MEMORY_COLLECTIONS.map((c) => [c, docs[c].length]));
  return { counts, problems, due: dueList(docs.reviews, today), ledger: next };
}

function checkLog(c, id, log, add) {
  if (!Array.isArray(log)) { add(c, id, 'log 要是数组：[{ date, by, field, from, to, basis }]'); return; }
  log.forEach((e, i) => {
    const at = `log 第 ${i + 1} 条`;
    if (!e || typeof e !== 'object') { add(c, id, `${at}不是 { date, by, field, from, to, basis }`); return; }
    if (!isDate(e.date)) add(c, id, `${at}的 date 要写成 YYYY-MM-DD`);
    if (!ROLES.includes(e.by)) add(c, id, `${at}的 by 只能是 ${ROLES.join(' / ')}`);
    if (empty(e.field)) add(c, id, `${at}缺少 field（改的是哪个字段）`);
    if (e.basis !== undefined && !Array.isArray(e.basis)) add(c, id, `${at}的 basis 要是数组（证据、错题的 id）`);
    // 掌握状态、弱点证据级这两样是结论：改的时候必须写依据
    if (((c === 'mastery' && e.field === 'state') || (c === 'weaknesses' && e.field === 'level')) && empty(e.basis) && empty(e.note)) {
      add(c, id, `${at}（${e.field} 改成「${fmt(e.to)}」）没写依据：basis 里写证据、错题的 id`);
    }
  });
}

const fmt = (v) => (v === null || v === undefined ? '空' : typeof v === 'string' ? v : JSON.stringify(v));

/** 自检结果给对话里的 Claude 看的那份（meta/memcheck）：一条一行，硬的错在前 */
export function memcheckRecord({ counts, problems, due }, { kit = '', today = '' } = {}) {
  const lines = [...problems].sort((a, b) => (a.soft ? 1 : 0) - (b.soft ? 1 : 0)).slice(0, 80)
    .map((p) => `${p.soft ? '[提醒] ' : ''}${p.coll}/${p.id}：${p.msg}`);
  return {
    id: 'memcheck',
    kit: String(kit || ''),
    today,
    ok: !problems.some((p) => !p.soft),
    counts,
    problems: lines,
    more: Math.max(0, problems.length - lines.length),
    // 复现组的到期日（页面按 last + tier 算）：过期的、今天的在前
    due: due.slice(0, 30).map((d) => ({ id: d.id, title: d.title, due: d.due, days: d.days })),
  };
}

// 课堂里的 Claude 改记忆（docs/desk-plan.md 第 4 节）。纯函数，不碰 DOM、不碰数据库，有测试（tests/memory-memo.test.js）。
//
// 写法：不用工具（每调一次工具平台就多跑一整轮），写在它这一轮的输出里，和黑板指令一样：
//   ````board memo
//   error q="求 A²" mine="ααᵀββᵀ" step="第 1 步换括号" cause="把 βᵀα 当矩阵" weakness=W19 basis=q-b5
//   pref topic=讲法 text="先看图再推公式" basis=say
//   slip text="一次出了两道题" lesson="一块板一件事"
//   ````
// 一行一条。页面读懂后按三档处理（TIERS）：
//   直接写（direct）：偏好（profile，topic 只能是「讲法」「习惯」）、它自己的失误（slips）、观察 / 提议（observations）
//   我确认才写（confirm）：错题（errors）、弱点（weaknesses）、复现组（reviews）、下一节从哪接（position）
//   只能提议：掌握（mastery）、规则（rules）——写了就拒绝，告诉它写成 propose
// 每一条先变成一张改动单（pending）。直接写的马上执行；我确认才写的等我在页面上点「确认」（能先改再确认）或「不要」。
// 写进去以后 UNDO_DAYS 天内能撤销：状态类按改动单记下的旧值退回去（退回也记 log），历史类追加一条作废的更正，原条不动。
// 我在页面上自己改（偏好、错题标已解决、复现组暂停）也走同一条路（tier: me），一样能撤销。
import { COLLECTIONS, UNDO_DAYS, assertWrite, applyChange, nextTier, toDate, daysBetween, same } from './schema.js';
import { tokenize } from '../tokens.js';
import { courseOf, prefixOf, positionId, spaceOfId } from './space.js';

export const MEMO_KINDS = {
  pref: { tier: 'direct', coll: 'profile', label: '偏好' },
  slip: { tier: 'direct', coll: 'slips', label: '失误' },
  note: { tier: 'direct', coll: 'observations', label: '观察' },
  propose: { tier: 'direct', coll: 'observations', label: '提议' },
  error: { tier: 'confirm', coll: 'errors', label: '错题' },
  weakness: { tier: 'confirm', coll: 'weaknesses', label: '弱点' },
  review: { tier: 'confirm', coll: 'reviews', label: '复现组' },
  position: { tier: 'confirm', coll: 'position', label: '下一节' },
};
// 只能提议的：拒绝时告诉它怎么写
const PROPOSE_ONLY = { mastery: '掌握状态', rule: '规则', rules: '规则' };
export const PREF_TOPICS = ['讲法', '习惯'];
// 要写依据的几种（偏好、提议、错题、弱点、复现组）：依据是证据，结论才站得住
const NEED_BASIS = new Set(['pref', 'propose', 'error', 'weakness', 'review']);
const LIST_KEYS = new Set(['basis', 'about', 'errors', 'blocks', 'weaknesses', 'debts', 'first']);

const cut = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const newId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
// 列表：逗号、顿号隔开；欠账、先收的题这种句子用分号隔开
const splitList = (v, key) => String(v ?? '').split(['debts', 'first'].includes(key) ? /[;；]/ : /[,，、;；]/).map((x) => x.trim()).filter(Boolean);

/* ---------------- 读：memo 块的每一行 ---------------- */

/**
 * memo 块的内容 → { entries: [{ kind, attrs, line }], errors: [原因] }。只看写法（认不认识这一种、key=value 写得对不对），
 * 记忆里有没有这些编号在 planEntry 里查。
 */
export function parseMemoLines(body) {
  const entries = [];
  const errors = [];
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.trim().replace(/^[-*]\s+/, '');
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const toks = tokenize(line);
    const head = toks[0];
    const kind = head && !head.key ? head.value.toLowerCase() : '';
    if (!kind) { errors.push(`「${cut(line, 40)}」：开头要写这一条是什么（${Object.keys(MEMO_KINDS).join(' / ')}）`); continue; }
    if (PROPOSE_ONLY[kind]) { errors.push(`「${cut(line, 40)}」：${PROPOSE_ONLY[kind]}你只能提议，写成 propose text="…" about=… basis=…，由对话里的 Claude 或学生决定`); continue; }
    if (!MEMO_KINDS[kind]) { errors.push(`「${cut(line, 40)}」：不认识「${head.value}」，只认 ${Object.keys(MEMO_KINDS).join(' / ')}`); continue; }
    const attrs = {};
    const stray = [];
    for (const t of toks.slice(1)) {
      if (!t.key) { stray.push(t.value); continue; }
      attrs[t.key] = LIST_KEYS.has(t.key) ? [...(attrs[t.key] || []), ...splitList(t.value, t.key)] : t.value;
    }
    if (stray.length) { errors.push(`「${cut(line, 40)}」：「${cut(stray.join(' '), 20)}」不是 key=value（有空格的值要加引号）`); continue; }
    entries.push({ kind, attrs, line: cut(line, 300) });
  }
  return { entries, errors };
}

/* ---------------- 依据 ---------------- */

/**
 * basis 里的每一项找到实在的东西：证据 id（ev-…）、记忆里的编号（错题、弱点、观察……）、
 * 黑板上的组件 id 或段 id（换成这节课里那个组件 / 那一段的全部证据）、say（学生最近说的那句话）。
 * ctx：{ evidence（这节课的证据）, mem（记忆库各类的数组）}。返回 { ids, missing }
 */
export function resolveBasis(tokens, { evidence = [], mem = {} } = {}) {
  const ids = [];
  const missing = [];
  const evs = (evidence || []).filter((e) => e && e.id);
  const memIds = new Set();
  for (const c of ['errors', 'weaknesses', 'observations', 'reviews', 'mastery', 'evidence', 'slips']) for (const d of mem[c] || []) if (d?.id) memIds.add(String(d.id));
  for (const raw of tokens || []) {
    const t = String(raw).trim();
    if (!t) continue;
    if (evs.some((e) => e.id === t) || memIds.has(t)) { ids.push(t); continue; }
    if (/^(say|说|学生说的)$/i.test(t)) {
      const s = evs.filter((e) => e.src === 'say').sort((a, b) => (b.at || 0) - (a.at || 0))[0];
      if (s) ids.push(s.id); else missing.push(t);
      continue;
    }
    const hit = evs.filter((e) => e.comp === t || e.step === t).sort((a, b) => (a.at || 0) - (b.at || 0));
    if (hit.length) ids.push(...hit.map((e) => e.id));
    else missing.push(t);
  }
  return { ids: [...new Set(ids)].slice(0, 20), missing };
}

/* ---------------- 编号 ---------------- */

const lectureOf = (block) => /^(?:[A-Z]{2}-)?L(\d+)/.exec(String(block || ''))?.[1] || '';
const maxNum = (ids, re) => Math.max(0, ...ids.map((id) => Number(re.exec(String(id))?.[1]) || 0));

/** 下一个错题编号：同一讲里最大的号 + 1（L2-07 → L2-08；检验题 L2-T03 另算） */
export function nextErrorId(errors, block) {
  const l = lectureOf(block) || '0';
  const pre = `${prefixOf(courseOf(block))}L${l}-`; // 分科：DS-L2-03 和线代的 L2-03 各编各的
  const n = maxNum((errors || []).map((e) => e.id), new RegExp(`^${pre}(\\d+)$`)) + 1;
  return `${pre}${String(n).padStart(2, '0')}`;
}
export const nextWeaknessId = (ws) => `W${maxNum((ws || []).map((w) => w.id), /^W(\d+)$/) + 1}`;
export const nextReviewId = (rs) => `R${maxNum((rs || []).map((r) => r.id), /^R(\d+)$/) + 1}`;
/** 失误的编号：S-日期-节-第几条（S-20261027-1-2），和课堂工具 slip_note 一样 */
export function nextSlipId(slips, session, date) {
  const pre = `S-${String(session || date || '').replace(/^c-/, '')}-`;
  const n = Math.max(0, ...(slips || []).map((x) => String(x.id)).filter((id) => id.startsWith(pre)).map((id) => Number(id.slice(pre.length)) || 0)) + 1;
  return `${pre}${n}`;
}

/* ---------------- 一条 → 改动 ---------------- */

/**
 * 一条 memo → 要做的改动 { kind, tier, coll, op, target, data | patch, reason, basis, label }，或者 { error }。
 * ctx：{ mem, evidence（这节课的）, session, block（这节课的块）, date }。
 * 这里把编号、字段、取值、依据都查一遍；查不过的不进改动单，原因写进 [系统] 提醒让它改。
 */
export function planEntry(entry, ctx = {}) {
  const { kind, attrs: a } = entry;
  const spec = MEMO_KINDS[kind];
  if (!spec) return { error: `不认识「${kind}」` };
  const mem = ctx.mem || {};
  const date = ctx.date || toDate(Date.now());
  const get = (c) => (Array.isArray(mem[c]) ? mem[c] : []);
  const find = (c, id) => get(c).find((d) => String(d.id) === String(id));
  const { ids: basis, missing } = resolveBasis(a.basis, ctx);
  if (missing.length) return { error: `basis 里的 ${missing.join('、')} 找不到（写证据 id、记忆里的编号、黑板上的组件 id 或段 id，或者 say 指学生刚说的话）` };
  if (NEED_BASIS.has(kind) && !basis.length) return { error: `${spec.label}要写依据：basis=组件 id / 证据 id / say（没有依据的结论不记）` };
  const reason = cut(a.reason || a.why || '', 300);
  const base = { kind, tier: spec.tier, coll: spec.coll, basis, reason, label: spec.label };
  const enumOk = (coll, field, v) => v === undefined || COLLECTIONS[coll].enums?.[field]?.includes(v);
  const sid = ctx.session || null;

  switch (kind) {
    case 'pref': {
      if (!PREF_TOPICS.includes(a.topic)) return { error: `偏好的 topic 只能是 ${PREF_TOPICS.join(' / ')}（别的关于学生的事由对话里的 Claude 写）` };
      if (!a.text) return { error: '偏好要写 text' };
      return { ...base, op: 'add', target: `p-c${newId()}`, data: { topic: a.topic, text: cut(a.text, 600), since: date, source: `课堂 ${sid || ''}`.trim(), basis, status: 'active' } };
    }
    case 'slip': {
      if (!a.text) return { error: '失误要写 text' };
      return { ...base, op: 'add', target: nextSlipId(get('slips'), sid, date), data: { by: 'class', date, text: cut(a.text, 1000), ...(a.lesson ? { lesson: cut(a.lesson, 500) } : {}), session: sid, ...(basis.length ? { basis } : {}) } };
    }
    case 'note':
    case 'propose': {
      if (!a.text) return { error: `${spec.label}要写 text` };
      return { ...base, op: 'add', target: `ob-${newId()}`, data: { kind: kind === 'propose' ? 'proposal' : 'note', text: cut(a.text, 2000), about: (a.about || []).slice(0, 20), session: sid, block: ctx.block || null, at: Date.now(), by: 'class', ...(basis.length ? { basis } : {}) } };
    }
    case 'error': {
      // 题面、学生的答案没写：从依据里那次作答补上
      const rec = (ctx.evidence || []).filter((e) => basis.includes(e.id) && e.src === 'record').at(-1);
      const q = a.q || rec?.q || '';
      const mine = a.mine || rec?.value || rec?.last || rec?.text || '';
      for (const [k, v] of [['q', q], ['mine', mine], ['step', a.step], ['cause', a.cause]]) if (!v) return { error: `错题要写 ${k}${k === 'q' || k === 'mine' ? '（或者 basis 写那道题的组件 id，页面从作答里补）' : ''}` };
      const block = a.block || ctx.block || null;
      let id = a.id;
      if (id && !COLLECTIONS.errors.id.re.test(id)) return { error: `错题编号「${id}」不对，像 L2-07；不写 id 页面自动编` };
      if (id && find('errors', id)) return { error: `错题 ${id} 已经有了：错题只增不改，换一个新编号，或者不写 id` };
      if (a.weakness && !find('weaknesses', a.weakness)) return { error: `weakness=${a.weakness} 在弱点表里没有` };
      if (block && get('curriculum').length && !find('curriculum', block)) return { error: `block=${block} 在课程地图里没有` };
      id ||= nextErrorId(get('errors'), block);
      return { ...base, op: 'add', target: id, data: { source: cut(a.source || `课堂 ${sid || ''}`, 120), q: cut(q, 800), mine: cut(mine, 400), step: cut(a.step, 200), cause: cut(a.cause, 300), ...(a.weakness ? { weakness: a.weakness } : {}), ...(block ? { block } : {}), evidence: basis.filter((x) => x.startsWith('ev-')), date, session: sid } };
    }
    case 'weakness': {
      const old = a.id ? find('weaknesses', a.id) : null;
      for (const [f, v] of [['level', a.level], ['scope', a.scope], ['status', a.status]]) if (!enumOk('weaknesses', f, v) || v === 'void') return { error: `${f} 只能是 ${COLLECTIONS.weaknesses.enums[f].filter((x) => x !== 'void').join(' / ')}` };
      const errs = a.errors || [];
      for (const e of errs) if (!find('errors', e)) return { error: `errors 里的 ${e} 在错题档案里没有（新错题要等学生确认了才有编号，先不挂）` };
      if (old) {
        const patch = {};
        if (a.level && a.level !== old.level) patch.level = a.level;
        if (a.scope && a.scope !== old.scope) patch.scope = a.scope;
        if (a.status && a.status !== old.status) patch.status = a.status;
        if (a.title) patch.title = cut(a.title, 120);
        const addE = errs.filter((e) => !(old.errors || []).includes(e));
        if (addE.length) patch.errors = [...(old.errors || []), ...addE];
        const addB = (a.blocks || []).filter((b) => !(old.blocks || []).includes(b));
        if (addB.length) patch.blocks = [...(old.blocks || []), ...addB];
        if (!Object.keys(patch).length) return { error: `${a.id} 没有要改的（level / scope / status / errors / blocks 都和现在一样）` };
        patch.last = date;
        return { ...base, op: 'update', target: old.id, patch };
      }
      if (a.id && !COLLECTIONS.weaknesses.id.re.test(a.id)) return { error: `弱点编号「${a.id}」不对，像 W19；新弱点不写 id 页面自动编` };
      if (a.id) return { error: `弱点表里没有 ${a.id}：新弱点不写 id（页面自动编），要改的写已有的编号` };
      if (!a.title || !a.scope || !a.level) return { error: '新弱点要写 title、scope（通用 / 链条 / 局部）、level（L0～L3）' };
      return { ...base, op: 'add', target: nextWeaknessId(get('weaknesses')), data: { title: cut(a.title, 120), scope: a.scope, level: a.level, last: date, errors: errs, blocks: a.blocks?.length ? a.blocks : ctx.block ? [ctx.block] : [], status: 'active', basis, ...(ctx.block ? { space: spaceOfId(ctx.block) } : {}) } };
    }
    case 'review': {
      const old = a.id ? find('reviews', a.id) : null;
      if (a.id && !old) return { error: `复现组里没有 ${a.id}：新的一组不写 id（页面自动编）` };
      if (old) {
        const patch = {};
        if (a.add) patch.content = [...(Array.isArray(old.content) ? old.content : old.content ? [String(old.content)] : []), cut(a.add, 300)];
        if (a.result) {
          const passed = /^(过|通过|pass|ok|对)$/i.test(a.result);
          if (!passed && !/^(没过|不过|fail|没通过|错)$/i.test(a.result)) return { error: 'result 写「过」或「没过」' };
          patch.result = passed ? '过' : '没过';
          patch.tier = nextTier(old.tier, passed);
          patch.last = date;
        }
        for (const k of ['weaknesses', 'blocks']) {
          const add = (a[k] || []).filter((x) => !(old[k] || []).includes(x));
          if (add.length) patch[k] = [...(old[k] || []), ...add];
        }
        if (!Object.keys(patch).length) return { error: `${a.id} 没有要改的：加题写 add="…"，判结果写 result=过 / 没过` };
        return { ...base, op: 'update', target: old.id, patch };
      }
      if (!a.title) return { error: '新复现组要写 title（还有 family、content、weaknesses、blocks）' };
      for (const w of a.weaknesses || []) if (!find('weaknesses', w)) return { error: `weaknesses 里的 ${w} 在弱点表里没有` };
      // 新的一组：从明天开始（档位 1 天，last 是今天）
      return { ...base, op: 'add', target: nextReviewId(get('reviews')), data: { title: cut(a.title, 120), ...(a.family ? { family: cut(a.family, 120) } : {}), content: a.content ? [cut(a.content, 300)] : [], weaknesses: a.weaknesses || [], blocks: a.blocks?.length ? a.blocks : ctx.block ? [ctx.block] : [], tier: 1, last: date, status: 'active', ...(ctx.block ? { space: spaceOfId(ctx.block) } : {}) } };
    }
    case 'position': {
      // 每科一条「下一节从哪接」：按这节课的块是哪一科
      const pid = positionId(spaceOfId(a.block || ctx.block));
      const old = find('position', pid);
      const patch = {};
      if (a.next) patch.next = cut(a.next, 400);
      if (a.block) {
        if (get('curriculum').length && !find('curriculum', a.block)) return { error: `block=${a.block} 在课程地图里没有` };
        patch.block = a.block;
      }
      if (a.debts) patch.debts = a.debts.map((x) => cut(x, 200));
      if (a.first) patch.first = a.first.map((x) => cut(x, 200));
      if (!Object.keys(patch).length) return { error: 'position 要写 next（下一节从哪接），可以加 block、debts、first' };
      if (old) {
        for (const k of Object.keys(patch)) if (same(old[k], patch[k])) delete patch[k];
        if (!Object.keys(patch).length) return { error: 'position 和现在的一样，不用改' };
        return { ...base, op: 'update', target: pid, patch };
      }
      if (!patch.block && !ctx.block) return { error: '还没有 position：第一次要写 block' };
      return { ...base, op: 'add', target: pid, data: { block: patch.block || ctx.block, next: patch.next || '', ...(patch.debts ? { debts: patch.debts } : {}), ...(patch.first ? { first: patch.first } : {}), log: [] } };
    }
    default:
      return { error: `不认识「${kind}」` };
  }
}

/* ---------------- 改动单 ---------------- */

/** 一个改动 → 一张改动单（pending）。by：class（课堂里的 Claude 写的）/ me（我自己改的） */
export function pendingRecord(change, { session = null, turn = null, by = 'class', line = '' } = {}) {
  const { kind, tier, coll, op, target, data, patch, reason, basis, label } = change;
  return {
    id: `pd-${newId()}`, kind, tier: by === 'me' ? 'me' : tier, by, coll, op, target, ...(data ? { data } : {}), ...(patch ? { patch } : {}),
    reason: reason || '', basis: basis || [], label: label || '', ...(line ? { line } : {}),
    session, ...(turn ? { turn } : {}), status: 'open', at: Date.now(), log: [],
  };
}

const logMeta = (pd, date, note) => ({ date, by: pd.by === 'me' ? 'me' : 'class', basis: (pd.basis || []).filter(Boolean), note });

/**
 * 执行一张改动单（直接写的那档马上执行；我确认才写的，我点「确认」时执行）。
 * mem：记忆库各类的数组（拿现在的那条）；edits：我在「改」里改过的字段（盖在 data / patch 上）。
 * 返回 { writes: [{ coll, id, doc }]（要 set 的文档，写之前已按角色拦过）, pd（新的改动单）}。查不过时抛出中文原因。
 */
export function applyPending(pd, mem = {}, { date = toDate(Date.now()), edits = null, now = Date.now() } = {}) {
  if (pd.status !== 'open') throw new Error(pd.status === 'done' ? '已经写进去了' : pd.status === 'rejected' ? '已经不要了' : '已经撤销了');
  // 谁的名义写：直接写那档是课堂里的 Claude；要我确认的、我自己改的是我
  const role = pd.tier === 'direct' ? 'class' : 'me';
  assertWrite(role, pd.coll);
  if (pd.coll === 'profile' && pd.tier === 'direct' && !PREF_TOPICS.includes(pd.data?.topic)) throw new Error('课堂里的 Claude 只能写「讲法」「习惯」');
  const docs = Array.isArray(mem[pd.coll]) ? mem[pd.coll] : [];
  const old = docs.find((d) => String(d.id) === String(pd.target));
  const note = pd.tier === 'confirm' ? `我确认于 ${date}` : pd.tier === 'me' ? '我在学习台上改的' : `课堂 ${pd.session || ''}`.trim();
  const isState = COLLECTIONS[pd.coll].kind === 'state';
  let doc, applied;
  if (pd.op === 'add') {
    if (old) throw new Error(`${pd.coll} 里已经有 ${pd.target} 了`);
    const data = { ...pd.data, ...(edits || {}) };
    // 新的一条状态类：把带档位、证据级的字段从无到有记一笔 log，自检和以后的撤销都看得到是谁、哪天定的
    doc = isState ? { ...data, log: [...(data.log || []), ...COLLECTIONS[pd.coll].tracked.filter((f) => data[f] !== undefined).map((f) => ({ ...logMeta(pd, date, note), field: f, from: null, to: data[f], ref: pd.id }))] } : data;
    applied = null;
  } else {
    if (!old) throw new Error(`${pd.coll} 里没有 ${pd.target} 了`);
    const patch = { ...pd.patch, ...(edits || {}) };
    const { id: _, ...rest } = old;
    const next = applyChange(rest, patch, logMeta(pd, date, note));
    // 这次加的 log 记上改动单的编号：撤销时按它找
    next.log = next.log.map((e, i) => (i >= (rest.log || []).length ? { ...e, ref: pd.id } : e));
    doc = next;
    applied = Object.keys(patch).filter((k) => !same(old[k], patch[k])).map((k) => ({ field: k, from: old[k] ?? null, to: patch[k] }));
  }
  const npd = { ...pd, ...(edits ? { edited: edits } : {}), status: 'done', doneAt: now, ...(applied ? { applied } : {}), log: [...(pd.log || []), { date, by: role, field: 'status', from: 'open', to: 'done', basis: [] }] };
  return { writes: [{ coll: pd.coll, id: String(pd.target), doc }, { coll: 'pending', id: pd.id, doc: strip(npd) }], pd: npd };
}

/** 我点了「不要」：改动单留着（标成 rejected），课后还看得到 */
export function rejectPending(pd, { date = toDate(Date.now()), now = Date.now(), note = '' } = {}) {
  if (pd.status !== 'open') throw new Error('只有等确认的才能不要');
  const npd = { ...pd, status: 'rejected', rejectedAt: now, ...(note ? { note } : {}), log: [...(pd.log || []), { date, by: 'me', field: 'status', from: 'open', to: 'rejected', basis: [] }] };
  return { writes: [{ coll: 'pending', id: pd.id, doc: strip(npd) }], pd: npd };
}

/** 还能不能撤销：写进去了、没超过 UNDO_DAYS 天 */
export function canUndo(pd, today = toDate(Date.now())) {
  if (pd?.status !== 'done' || !pd.doneAt) return false;
  return daysBetween(toDate(pd.doneAt), today) < UNDO_DAYS;
}

/**
 * 撤销一张已经写进去的改动单。状态类：新加的一条改成 status: void（偏好、弱点、复现组），改过的字段退回旧值（都记 log）；
 * 历史类（错题、失误、观察）：原条不动，追加一条作废的更正（corrects 指向原条）。
 * 后来又被别人改过的字段不退（不然会把后来的改动冲掉），抛出原因。
 */
export function undoPending(pd, mem = {}, { date = toDate(Date.now()), now = Date.now() } = {}) {
  if (!canUndo(pd, date)) throw new Error(pd?.status === 'done' ? `写进去超过 ${UNDO_DAYS} 天了，不能撤：要改请回对话里说` : '这一条没有写进去，不用撤');
  assertWrite('me', pd.coll);
  const get = (c) => (Array.isArray(mem[c]) ? mem[c] : []);
  const cur = get(pd.coll).find((d) => String(d.id) === String(pd.target));
  if (!cur) throw new Error(`${pd.coll} 里没有 ${pd.target} 了`);
  const meta = { date, by: 'me', basis: [], note: `撤销 ${pd.id}` };
  const { id: _, ...rest } = cur;
  const writes = [];
  if (COLLECTIONS[pd.coll].kind === 'state') {
    let patch;
    if (pd.op === 'add') {
      if (pd.coll === 'position') throw new Error('当前位置只有一条，撤销请改「下一节」');
      patch = { status: 'void' };
    } else {
      patch = {};
      for (const a of pd.applied || []) {
        if (!same(cur[a.field], a.to)) throw new Error(`${pd.target} 的 ${a.field} 后来又改过了，不能撤`);
        patch[a.field] = a.from;
      }
    }
    writes.push({ coll: pd.coll, id: String(pd.target), doc: applyChange(rest, patch, meta) });
  } else {
    // 历史类：追加一条作废的更正
    const fix = voidCorrection(pd.coll, cur, get(pd.coll), { date, pd });
    writes.push({ coll: pd.coll, id: fix.id, doc: strip(fix) });
  }
  const npd = { ...pd, status: 'undone', undoneAt: now, log: [...(pd.log || []), { date, by: 'me', field: 'status', from: 'done', to: 'undone', basis: [] }] };
  writes.push({ coll: 'pending', id: pd.id, doc: strip(npd) });
  return { writes, pd: npd };
}

// 历史类的作废更正：新编号，corrects 指向原条，void: true；必填字段照抄原条（自检照样过）
function voidCorrection(coll, orig, all, { date, pd }) {
  const note = `撤销：我在学习台上撤了这一条（${date}${pd ? `，改动单 ${pd.id}` : ''}）`;
  if (coll === 'errors') {
    const { id: _, log: _l, ...rest } = orig;
    return { ...rest, id: nextErrorId(all, orig.block || orig.id), corrects: String(orig.id), void: true, note, date };
  }
  if (coll === 'slips') return { id: `${String(orig.id)}-x`, by: orig.by, date, text: `（作废）${orig.text}`, corrects: String(orig.id), void: true, note, ...(orig.session ? { session: orig.session } : {}) };
  return { id: `ob-${newId()}`, kind: 'note', text: `（作废）${cut(orig.text, 200)}`, corrects: String(orig.id), void: true, note, at: Date.now(), by: 'me', ...(orig.session ? { session: orig.session } : {}) };
}

/** 被作废的条目（status: void，或者有一条 void 的更正指向它）：摘要、页面列表都不再当真 */
export function voidedIds(mem = {}) {
  const out = new Set();
  for (const c of ['errors', 'slips', 'observations', 'profile', 'weaknesses', 'reviews']) {
    for (const d of mem[c] || []) {
      if (!d) continue;
      if (d.status === 'void') out.add(`${c}/${d.id}`);
      if (d.void && d.corrects) { out.add(`${c}/${d.corrects}`); out.add(`${c}/${d.id}`); }
    }
  }
  return out;
}

/* ---------------- 我自己改（tier: me）---------------- */

/**
 * 我在学习台上改记忆：偏好的文字、错题标已解决（追加一条更正，不改原条）、复现组暂停 / 恢复。
 * 返回一张 tier: me 的改动单（status: open），交给 applyPending 执行（一样能撤销）。
 */
export function meChange(what, mem = {}, args = {}) {
  const get = (c) => (Array.isArray(mem[c]) ? mem[c] : []);
  const date = args.date || toDate(Date.now());
  if (what === 'pref') {
    const p = get('profile').find((d) => d.id === args.id);
    if (!p) throw new Error(`没有 ${args.id}`);
    const text = String(args.text || '').trim();
    if (!text) throw new Error('写点什么');
    if (text === p.text) throw new Error('和原来一样');
    return pendingRecord({ kind: 'pref', tier: 'me', coll: 'profile', op: 'update', target: p.id, patch: { text: cut(text, 600) }, label: '偏好', reason: '我改的' }, { by: 'me' });
  }
  if (what === 'resolve') {
    const e = get('errors').find((d) => d.id === args.id);
    if (!e) throw new Error(`没有 ${args.id}`);
    const { id: _, log: _l, ...rest } = e;
    return pendingRecord({ kind: 'error', tier: 'me', coll: 'errors', op: 'add', target: nextErrorId(get('errors'), e.block || e.id), data: { ...rest, corrects: e.id, resolved: true, date, note: `我标了已解决（${date}）${args.note ? `：${cut(args.note, 200)}` : ''}` }, label: '错题已解决', reason: '我标的' }, { by: 'me' });
  }
  if (what === 'pause' || what === 'resume') {
    const r = get('reviews').find((d) => d.id === args.id);
    if (!r) throw new Error(`没有 ${args.id}`);
    const to = what === 'pause' ? 'paused' : 'active';
    if ((r.status || 'active') === to) throw new Error(what === 'pause' ? '已经暂停了' : '没有暂停');
    return pendingRecord({ kind: 'review', tier: 'me', coll: 'reviews', op: 'update', target: r.id, patch: { status: to }, label: what === 'pause' ? '暂停复现组' : '恢复复现组', reason: '我改的' }, { by: 'me' });
  }
  throw new Error(`不认识「${what}」`);
}

/** 已经标了已解决的错题（有一条 resolved 的更正指向它，而且那条更正没被撤销） */
export function resolvedErrors(mem = {}) {
  const gone = voidedIds(mem);
  return new Set((mem.errors || []).filter((e) => e?.resolved && e.corrects && !gone.has(`errors/${e.id}`)).map((e) => String(e.corrects)));
}

/* ---------------- 给人看 ---------------- */

/** 一张改动单一句话：「错题 L2-08：把 βᵀα 当矩阵」 */
export function pendingTitle(pd) {
  const d = pd.data || {}, p = pd.patch || {};
  const what = {
    pref: () => `${d.topic ? `［${d.topic}］` : ''}${d.text || p.text || ''}`,
    slip: () => d.text,
    note: () => d.text,
    propose: () => d.text,
    error: () => (d.resolved ? `${d.corrects} 已解决` : `${pd.target}：${d.cause || d.q || ''}`),
    weakness: () => (pd.op === 'add' ? `${pd.target} ${d.title}（${d.scope}，${d.level}）` : `${pd.target} ${Object.entries(p).filter(([k]) => k !== 'last').map(([k, v]) => `${k} → ${Array.isArray(v) ? v.join('、') : v}`).join('，')}`),
    review: () => (pd.op === 'add' ? `${pd.target} ${d.title}` : `${pd.target} ${p.status ? (p.status === 'paused' ? '暂停' : '恢复') : p.result ? `${p.result}，下次 ${p.tier} 天后` : p.content ? `加题：${p.content.at(-1)}` : '改了'}`),
    position: () => p.next || d.next || (p.block ? `学到 ${p.block}` : '改了'),
  }[pd.kind];
  return `${pd.label || MEMO_KINDS[pd.kind]?.label || pd.kind}${pd.op === 'update' && pd.kind !== 'weakness' && pd.kind !== 'review' ? ` ${pd.target}` : ''}：${cut(what ? what() : '', 80)}`;
}

/** 这一轮记了什么（板顶那句话下面的小字）：「记下了：偏好 1 条；待你确认：错题 1 条」 */
export function memoLine(pds = []) {
  const count = (list) => {
    const m = new Map();
    for (const p of list) m.set(p.label || MEMO_KINDS[p.kind]?.label || p.kind, (m.get(p.label || MEMO_KINDS[p.kind]?.label || p.kind) || 0) + 1);
    return [...m].map(([k, n]) => `${k} ${n} 条`).join('、');
  };
  const done = pds.filter((p) => p.status === 'done' && p.tier === 'direct');
  const open = pds.filter((p) => p.status === 'open');
  const ok = pds.filter((p) => p.status === 'done' && p.tier !== 'direct');
  const parts = [];
  if (done.length) parts.push(`记下了：${count(done)}`);
  if (open.length) parts.push(`待你确认：${count(open)}`);
  if (ok.length) parts.push(`你确认了：${count(ok)}`);
  const gone = pds.filter((p) => p.status === 'rejected' || p.status === 'undone').length;
  if (gone) parts.push(`没要 / 撤了 ${gone} 条`);
  return parts.join('；');
}

const strip = (d) => { const { id: _, ...rest } = d || {}; return rest; };

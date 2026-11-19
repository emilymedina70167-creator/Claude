// 检验（二类组件：学完以后的吸收检验，dev_requests/dr-plan2，设计 docs/superpowers/specs/2026-11-18-check-design.md）：
// board check 和六种探题的写法、自检。不碰 DOM，tests/check-spec.test.js。
//
//   ````board check id=k1 title="…" limit=15m pause=30s
//   block L2.1.1 must=p1,p2
//   block L2.1.4 must=p3,p4 optional=p7 fast=90s
//   spare p8
//   <<<
//   （可选）外部没预料到的错法时，给页面里的 Claude 的话
//   >>>
//   ```construct
//   id: p1
//   …
//   ```
//   ````
//
// 题的 retry: 写同构小题的 id（也写在这个块里，开始时不出现）；没排进 block / spare、也不是谁的 retry 的题报写法错误。
// 题目、要点、错法、补讲、同构题都由外部写；这里只读写法、拿外部写的 example 先验一遍条件（写错了页面报，不静默）。
import { tokenize } from '../tokens.js';
import { compile } from '../expr.js';
import { parseConditions } from '../anscheck.js';
import { parseSolve } from '../solvespec.js';

export const PROBE_TYPES = ['recall', 'construct', 'claim', 'discriminate', 'locate', 'solve'];
export const FACET_OF = { recall: '重建', construct: '能用', claim: '边界', solve: '能用', discriminate: '能辨', locate: '能辨' };
export const FACETS = ['重建', '能用', '边界', '能辨'];
export const LEVELS = ['基础', '方法', '核心'];
export const MUST_MAX = 3; // recall 每题最多几条必写要点（任务书：只问 2～3 个关键点）
export const RETRY_MIN = 2; // 必做题至少几道同构小题
export const PAUSE_DEFAULT = 30000;

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,64}$/;
const BLOCK_RE = /^(?:[A-Z]{2}-)?L\d+(?:\.\d+){0,2}(?:#[A-Za-z0-9_-]+)?$/;
const FIELD = /^\s*([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/;
const POINT = /^\s*(must|may|wrong)(?:\s+([A-Za-z]\w{0,15}))?\s*[:：]\s?(.*)$/;
const TEACH = /^\s*teach\s+(\S+?)\s*[:：]\s?(.*)$/;
const EXPR = /^\s*expr\s+(.+?)\s*[:：]\s*(.+)$/;
const IF = /^\s*if\s*[:：]\s*(.+)$/;
const LET = /^\s*let\s+([A-Za-z]\w*)\s*=\s*(.+)$/;
// 共用的字段、各题型自己的字段（不在里面的报「看不懂」）
const COMMON = ['id', 'q', 'title', 'target', 'level', 'facet', 'family', 'retry', 'note', 'exam', 'like'];
const OWN = {
  recall: ['answer'],
  construct: ['slots', 'example'],
  claim: ['claim', 'truth', 'slots', 'example', 'proof', 'start', 'goal', 'vars'],
  discriminate: ['can', 'result'],
  locate: ['line', 'bug', 'fix'],
  solve: [],
};

/** 2s / 90s / 15m / 1500ms / 15分钟 → 毫秒；读不懂 NaN */
export function msOf(v) {
  const m = String(v ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|秒|m|min|分钟?)?$/i);
  if (!m) return NaN;
  const n = Number(m[1]), u = (m[2] || 's').toLowerCase();
  return Math.round(u === 'ms' ? n : u === 'm' || u === 'min' || u.startsWith('分') ? n * 60000 : n * 1000);
}

const list = (v) => String(v ?? '').split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);

/** slots: A=mat(2) B=mat(2,3) v=vec(3) k=num */
function parseSlots(src) {
  const out = [];
  for (const part of String(src).trim().split(/\s+/).filter(Boolean)) {
    const m = part.match(/^([A-Za-z]\w*)\s*=\s*(mat|vec|num)(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?$/);
    if (!m) throw new Error(`slots 里「${part}」看不懂：写 A=mat(2)、M=mat(2,3)、v=vec(3)、k=num`);
    const [, name, kind, a, b] = m;
    if (kind === 'mat') { if (!a) throw new Error(`${name}=mat 要写阶数：mat(2) 或 mat(2,3)`); out.push({ name, kind, r: Number(a), c: Number(b || a) }); }
    else if (kind === 'vec') { if (!a) throw new Error(`${name}=vec 要写维数：vec(3)`); out.push({ name, kind, n: Number(a) }); }
    else out.push({ name, kind });
  }
  if (!out.length) throw new Error('slots: 要写学生填的东西，比如 A=mat(2) B=mat(2)');
  return out;
}

/** example: A=[[0,1],[0,0]] B=[[1, 0], [0, 0]] k=2（值里可以有空格：按括号配对切） */
export function parseNamed(src) {
  const s = String(src ?? '');
  const out = {};
  const re = /([A-Za-z]\w*)\s*=\s*/g;
  let m;
  const starts = [];
  while ((m = re.exec(s))) {
    // 只认在括号外面的「名字=」
    const before = s.slice(0, m.index);
    const depth = (before.match(/\[/g) || []).length - (before.match(/\]/g) || []).length;
    if (depth === 0) starts.push({ name: m[1], from: m.index + m[0].length, at: m.index });
  }
  starts.forEach((st, i) => {
    const raw = s.slice(st.from, i + 1 < starts.length ? starts[i + 1].at : s.length).trim();
    out[st.name] = compile(raw)({});
  });
  return out;
}

const truthOf = (v, yes, no) => { const t = String(v ?? '').trim().toLowerCase(); if (yes.includes(t)) return true; if (no.includes(t)) return false; return null; };

/**
 * 读一道探题（围栏里的内容）。返回 { probe } 或 { error }。
 * probe 共有：{ id, type, q, target, level, facet, family, teach, retry, lets, src }；各题型另有的见设计 5.1
 */
export function parseProbe(type, src) {
  if (!PROBE_TYPES.includes(type)) return { error: `不认识的题型「${type}」：只认 ${PROBE_TYPES.join(' / ')}` };
  const f = {};
  const teach = {};
  const pts = { must: [], may: [], wrong: [] };
  const ifs = [], exprs = [], lets = [], lines = [];
  const solveLines = [];
  let last = null; // 续行接到哪里
  let n = 0; // 要点自动编号（must、may 共用 m1、m2…）
  const errors = [];
  for (const raw of String(src ?? '').replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) { last = null; continue; }
    let m;
    if ((m = raw.match(TEACH))) { teach[m[1]] = m[2].trim(); last = { into: teach, key: m[1] }; continue; }
    if ((m = raw.match(POINT))) {
      const kind = m[1];
      const id = m[2] || (kind === 'wrong' ? `w${pts.wrong.length + 1}` : `m${++n}`);
      if (m[2] && kind !== 'wrong') { const k = Number(String(m[2]).replace(/^\D+/, '')); if (k > n) n = k; }
      const item = { id, text: m[3].trim() };
      pts[kind].push(item); last = { item }; continue;
    }
    if ((m = raw.match(EXPR))) { const item = { id: `e${exprs.length + 1}`, label: m[1].trim(), expected: m[2].trim() }; exprs.push(item); last = null; continue; }
    if ((m = raw.match(IF))) {
      const [body, msg = ''] = m[1].split('=>').map((x) => x.trim());
      ifs.push({ id: `if${ifs.length + 1}`, text: body, msg }); last = null; continue;
    }
    if ((m = raw.match(LET))) { lets.push({ name: m[1], src: m[2].trim() }); last = null; continue; }
    if ((m = raw.match(FIELD))) {
      const k = m[1].toLowerCase();
      if (type === 'solve' && !COMMON.includes(k) || type === 'solve' && k === 'q') { solveLines.push(raw); last = { solve: true }; continue; }
      if (k === 'line' && type === 'locate') { lines.push(m[2].trim()); last = { line: lines.length - 1 }; continue; }
      if (!COMMON.includes(k) && !OWN[type].includes(k)) { errors.push(`看不懂「${raw.trim().slice(0, 40)}」：${type} 的字段是 ${[...COMMON, ...OWN[type]].join('、')}、must / may / wrong / teach / let / if / expr`); continue; }
      f[k] = m[2].trim(); last = { into: f, key: k }; continue;
    }
    // 续行
    if (last?.solve) { solveLines.push(raw); continue; }
    if (last?.into) { last.into[last.key] += `\n${raw.trim()}`; continue; }
    if (last?.item) { last.item.text += `\n${raw.trim()}`; continue; }
    if (last?.line !== undefined) { lines[last.line] += `\n${raw.trim()}`; continue; }
    errors.push(`看不懂这一行：「${raw.trim().slice(0, 40)}」`);
  }
  if (errors.length) return { error: errors[0] };
  // 自动编号（must: …）和手写编号（must m1: …）撞了：报出来，不静默出两个 m1（teach、判分都按编号对）
  const pointIds = [...pts.must, ...pts.may, ...pts.wrong].map((x) => x.id);
  const twice = pointIds.find((x, i) => pointIds.indexOf(x) !== i);
  if (twice) return { error: `${f.id || type}：要点编号 ${twice} 用了两次（自动编号和手写编号撞了：要么都写编号，要么都不写）` };
  const id = f.id || '';
  if (!id) return { error: `${type} 要写 id:` };
  if (!ID_RE.test(id)) return { error: `id「${id}」不合法：只能用字母、数字和 _ - . ~ : @ +` };
  const at = (msg) => ({ error: `${id}：${msg}` });
  if (!f.target) return at('要写 target:（打的是哪个典型错法：错题、误解的编号或一句话）');
  if (!LEVELS.includes(f.level)) return at(`level: 只能写 ${LEVELS.join(' / ')}`);
  if (f.facet && !FACETS.includes(f.facet)) return at(`facet: 只能写 ${FACETS.join(' / ')}`);
  if (pts.must.length > MUST_MAX && type === 'recall') return at(`must 最多 3 条（现在 ${pts.must.length} 条）`);
  const probe = {
    id, type, q: f.q || '', target: f.target, level: f.level, facet: f.facet || FACET_OF[type], family: f.family || null,
    teach, retry: list(f.retry), lets, src: String(src ?? ''),
  };
  try {
    if (type === 'construct' || (type === 'claim' && truthOf(f.truth, ['假', 'false', 'f', 'no', '错'], ['真', 'true', 't', 'yes', '对']) === true)) {
      if (!f.slots) return at('要写 slots:（学生填的东西，比如 A=mat(2) B=mat(2)）');
      if (!ifs.length) return at('要写 if:（一行一条条件）');
      if (!f.example) return at('要写 example:（一组满足全部条件的，页面先拿它验一遍）');
      Object.assign(probe, { slots: parseSlots(f.slots), ifs: ifs.map((c) => ({ ...c })), exprs, example: parseNamed(f.example) });
      parseConditions(ifs.map((c) => c.text).join('\n')); // 写法不对在这里抛
    }
  } catch (e) { return at(e.message); }
  const points = () => ({ must: pts.must, may: pts.may, wrong: pts.wrong });
  if (type === 'recall') {
    if (!pts.must.length) return at('要写 must:（必写要点）');
    Object.assign(probe, points(), { answer: f.answer || '' });
  }
  if (type === 'claim') {
    const truth = truthOf(f.truth, ['真', 'true', 't', 'yes', '对'], ['假', 'false', 'f', 'no', '错']);
    if (truth === null) return at('truth: 写 真 或 假');
    if (!f.claim) return at('要写 claim:（命题）');
    Object.assign(probe, { claim: f.claim, truth });
    if (truth) {
      if (f.proof) {
        if (f.proof !== 'derive') return at('proof: 只能写 derive（照 derive mode: do 逐行核）');
        if (!f.start || !f.goal) return at('proof: derive 要写 start: 和 goal:');
        probe.proof = { start: f.start, goal: f.goal, ...(f.vars ? { vars: f.vars } : {}) };
      } else if (!pts.must.length) return at('判真的命题要写证明要点 must:，或 proof: derive');
      Object.assign(probe, points());
    }
  }
  if (type === 'discriminate') {
    const can = truthOf(f.can, ['能', 'yes', 'true', '可以'], ['不能', 'no', 'false', '不可以']);
    if (can === null) return at('can: 写 能 或 不能');
    if (!pts.must.length) return at('要写理由的要点 must:');
    Object.assign(probe, { can }, points(), f.result ? { result: f.result } : {});
  }
  if (type === 'locate') {
    if (lines.length < 2) return at('locate 至少要有两行 line:');
    const bug = Number(f.bug);
    if (!Number.isInteger(bug) || bug < 1 || bug > lines.length) return at(`bug: 写错的是第几行（1 到 ${lines.length}）`);
    if (!pts.must.length) return at('要写为什么错的要点 must:');
    Object.assign(probe, { lines, bug }, points(), f.fix ? { fix: f.fix } : {});
  }
  if (type === 'solve') {
    const r = parseSolve([`id: ${id}`, ...solveLines].join('\n'));
    if (r.problems.length) return at(r.problems[0]);
    Object.assign(probe, { q: r.fields.q, steps: r.steps, solveFields: r.fields });
  }
  return { probe };
}

const tok = (head) => {
  const kv = {}, loose = [];
  for (const t of tokenize(String(head ?? ''))) { if (t.key) kv[t.key.toLowerCase()] = t.value; else loose.push(t.value); }
  return { kv, loose };
};

/**
 * board check 的开头那行（`check id=k1 …`，前面的 check 可写可不写）+ 块里的内容。
 * 返回 { check, errors }；check 为 null 时 errors 至少一条
 */
export function parseCheck(head, body) {
  const errors = [];
  const { kv, loose } = tok(String(head ?? '').replace(/^\s*check\b/i, ''));
  const id = kv.id || loose[0];
  if (!id || !ID_RE.test(id)) return { check: null, errors: ['要写 id：board check id=k1 …（只能用字母、数字和 _ - . ~ : @ +）'] };
  const limit = kv.limit !== undefined ? msOf(kv.limit) : 0;
  const pause = kv.pause !== undefined ? msOf(kv.pause) : PAUSE_DEFAULT;
  if (!(limit >= 0)) errors.push('limit= 写多久：比如 limit=15m');
  if (!(pause >= 5000)) errors.push('pause= 写停多久算停顿，至少 5s：比如 pause=30s');
  const blocks = [], spare = [], probes = {}, order = [];
  const promptLines = [];
  let inPrompt = false, fence = null;
  const dup = new Set();
  for (const raw of String(body ?? '').replace(/\r/g, '').split('\n')) {
    if (fence) {
      if (/^\s*```\s*$/.test(raw)) {
        const r = parseProbe(fence.type, fence.lines.join('\n'));
        if (r.error) errors.push(r.error);
        else if (probes[r.probe.id]) dup.add(r.probe.id);
        else { probes[r.probe.id] = r.probe; order.push(r.probe.id); }
        fence = null;
      } else fence.lines.push(raw);
      continue;
    }
    if (inPrompt) { if (/^\s*>>>\s*$/.test(raw)) inPrompt = false; else promptLines.push(raw); continue; }
    const line = raw.trim();
    if (!line) continue;
    if (line === '<<<') { inPrompt = true; continue; }
    let m;
    if ((m = line.match(/^```\s*([A-Za-z]\w*)\s*$/))) {
      if (!PROBE_TYPES.includes(m[1])) { errors.push(`块里的「${m[1]}」不是探题：只认 ${PROBE_TYPES.join(' / ')}`); fence = { type: '_skip', lines: [] }; continue; }
      fence = { type: m[1], lines: [] }; continue;
    }
    if ((m = line.match(/^block\s+(\S+)\s*(.*)$/))) {
      const b = m[1];
      if (!BLOCK_RE.test(b)) { errors.push(`block 后面写课程地图的块：比如 block L2.1.4 must=p3,p4（看不懂「${b}」）`); continue; }
      const { kv: bk } = tok(m[2]);
      const fast = bk.fast !== undefined ? msOf(bk.fast) : 0;
      if (!(fast >= 0)) errors.push(`block ${b} 的 fast= 写多久：比如 fast=90s`);
      const must = list(bk.must);
      if (!must.length) errors.push(`block ${b} 要写 must=（必做题的 id，逗号隔开）`);
      blocks.push({ block: b, must, optional: list(bk.optional), fast: fast || 0 });
      continue;
    }
    if ((m = line.match(/^spare\s+(.+)$/))) { spare.push(...list(m[1])); continue; }
    errors.push(`看不懂这一行：「${line.slice(0, 40)}」（块里写 block / spare 行、<<< >>>、探题的围栏）`);
  }
  if (fence && fence.type !== '_skip') errors.push(`${fence.type} 的围栏没有收（少了一行 \`\`\`）`);
  for (const d of dup) errors.push(`${d} 写了两次：一次检验里 id 不能重`);
  if (!blocks.length) errors.push('要写 block 行：block L2.1.4 must=p3,p4 optional=p7');
  // 每道题属于哪一块：block 行里的；retry 跟着本题；spare 照它 retry 的、或第一块
  const blockOf = {};
  for (const b of blocks) for (const pid of [...b.must, ...b.optional]) blockOf[pid] ??= b.block;
  for (let pass = 0; pass < 3; pass++) for (const pid of order) for (const r of probes[pid].retry) if (blockOf[pid] && !blockOf[r]) blockOf[r] = blockOf[pid];
  for (const pid of order) {
    const p = probes[pid];
    p.block = blockOf[pid] || blocks[0]?.block || null;
    p.family = p.family || `${p.block}/${p.target}`;
  }
  const check = { id, title: kv.title || '', limit: limit || 0, pause: pause || PAUSE_DEFAULT, blocks, spare, prompt: promptLines.join('\n').trim(), probes, order, src: String(body ?? '') };
  // 没有 block 行就没法开：整条不收（别的写法错误照列，check 照给，外壳不开、预检照报）
  return { check: blocks.length ? check : null, errors };
}

/** 题里的量：let 一行一行算（浮点，和 answer 的条件一样），base 是整节课的量 */
export function probeVars(probe, base = {}) {
  const vars = { ...base };
  for (const l of probe.lets || []) vars[l.name] = compile(l.src)(vars);
  return vars;
}

/** 条件里的 O、E：没定义时按第一个方阵的阶数给（零矩阵、单位矩阵） */
export function withDefaults(vars, slots = []) {
  const sq = slots.find((s) => s.kind === 'mat' && s.r === s.c);
  const n = sq ? sq.r : 2;
  const out = { ...vars };
  if (out.O === undefined) out.O = Array.from({ length: n }, () => Array(n).fill(0));
  if (out.E === undefined) out.E = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  return out;
}

const close = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => close(x, b[i]));
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
};
const toNum = (x) => (Array.isArray(x) ? x.map(toNum) : Number(x));

/** 一组值逐条代进 if 里：[{ id, ok, error? }]（judge.js 判学生的也用它） */
export function evalIfs(ifs, values, vars = {}, slots = []) {
  const scope = withDefaults({ ...vars, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, toNum(v)])) }, slots);
  return ifs.map((c) => {
    const [cond] = parseConditions(c.text);
    try { return { id: c.id, ok: close(cond.lhs(scope), cond.rhs(scope)) === (cond.op === '==') }; } catch (e) { return { id: c.id, ok: false, error: e.message }; }
  });
}

/**
 * 自检：外部写的检验自己对不对（每条一句，空数组是好的）。
 * lenient：复测从题库拼的 check（bank.js 的 retestCheck）——备用题本来就可以没有 retry、teach，不按「必做题至少 2 道 retry、1 条 teach」要求
 */
export function selfCheck(check, base = {}, { lenient = false } = {}) {
  const out = [];
  const P = check.probes;
  const placed = new Set([...check.blocks.flatMap((b) => [...b.must, ...b.optional]), ...check.spare]);
  for (const b of check.blocks) for (const pid of [...b.must, ...b.optional]) if (!P[pid]) out.push(`block ${b.block} 里的 ${pid} 没写这道题`);
  for (const pid of check.spare) if (!P[pid]) out.push(`spare 里的 ${pid} 没写这道题`);
  const retried = new Set(Object.values(P).flatMap((p) => p.retry));
  // 一道 retry 只给一道题用；retry 不再排进 block / spare（不然出到它时已经交过，学生卡住）
  const usedBy = new Map();
  for (const pid of check.order) for (const r of P[pid].retry) usedBy.set(r, [...(usedBy.get(r) || []), pid]);
  for (const [r, by] of usedBy) {
    if (by.length > 1) out.push(`${r} 是 ${by.join('、')} 两道题的 retry：一道 retry 只给一道题用`);
    if (placed.has(r)) out.push(`${r} 是 ${by[0]} 的 retry，又排进了 block / spare：retry 不单独出`);
  }
  const must = new Set(check.blocks.flatMap((b) => b.must));
  for (const pid of check.order) {
    const p = P[pid];
    if (!placed.has(pid) && !retried.has(pid)) out.push(`${pid} 没排进任何一块，也不是谁的 retry（不出现的题写进 spare）`);
    for (const r of p.retry) {
      if (!P[r]) out.push(`${pid} 的 retry 写了 ${r}，块里没有这道题`);
      else if (P[r].type !== p.type) out.push(`${pid} 的 retry ${r} 是 ${P[r].type}，和本题的题型 ${p.type} 不一样`);
    }
    if (must.has(pid) && !lenient) {
      if (p.retry.length < RETRY_MIN) out.push(`${pid} 是必做题，retry 至少 2 道（现在 ${p.retry.length} 道）`);
      if (!Object.keys(p.teach).length) out.push(`${pid} 是必做题，至少写一条 teach（判出没过时显示的一两句）`);
    }
    let vars;
    try { vars = probeVars(p, base); } catch (e) { out.push(`${pid} 的 let 算不出来：${e.message}`); continue; }
    if (p.ifs && p.example) {
      const missing = p.slots.filter((s) => p.example[s.name] === undefined).map((s) => s.name);
      if (missing.length) out.push(`${pid} 的 example 少了 ${missing.join('、')}`);
      else for (const r of evalIfs(p.ifs, p.example, vars, p.slots)) if (!r.ok) out.push(`${pid} 的 example 不满足 ${r.id}（${p.ifs.find((c) => c.id === r.id).text}）${r.error ? `：${r.error}` : ''}`);
      for (const e of p.exprs || []) {
        try { compile(e.expected)(withDefaults({ ...vars, ...Object.fromEntries(Object.entries(p.example).map(([k, v]) => [k, toNum(v)])) }, p.slots)); } catch (err) { out.push(`${pid} 的 expr「${e.label}」算不了：${err.message}`); }
      }
    }
    if (p.result) { try { compile(p.result)(withDefaults(vars)); } catch (e) { out.push(`${pid} 的 result 算不了：${e.message}`); } }
  }
  return out;
}

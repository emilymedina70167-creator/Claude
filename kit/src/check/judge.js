// 检验的判（设计 5.3）：页面机器能判的当场判、不调 Claude（构造的每一条、式子、真假、能不能、哪一行、逐行证明、结果、改正）；
// 要点、证明要点、理由、solve 的步骤交给页面里的 Opus 5.5 high（下面另一半）。不碰 DOM，tests/check-judge*.test.js。
//
// 每一项的结论都是 { id, ok: true | false | 'missing' | null, why, tag? }（和计划 1 的 board judge / 证据的 steps 一个样子）：
// null 是页面判不了 / 拿不准，待外部核——任何时候都不当成过。
import { compile } from '../expr.js';
import { readCell } from '../anscheck.js';
import { equivalent } from '../ncalg.js';
import { normalizeFormula, FORMULA_FUNCS } from '../formula.js';
import { parseDeriveDo, sampleEnvs, checkLine } from '../derivedo.js';
import { probeVars, evalIfs, withDefaults } from './spec.js';
import { parseJudge, STEP_KINDS, STEP_TAGS } from '../solvespec.js';

/** 还有几格没填（空串、只有空白、null） */
export function blankCells(v) {
  if (Array.isArray(v)) return v.reduce((n, x) => n + blankCells(x), 0);
  return v === null || v === undefined || String(v).trim() === '' ? 1 : 0;
}

const readable = (x) => { try { readCell(x); return true; } catch { return false; } };

/**
 * 交之前还差什么（构造题、判假的反例）：没填的格、读不懂的格（「1/」这种）、空着的式子框。'' 是能交了。
 * 只管格子和式子框（真假、能不能、哪一行、写字的地方由外壳另看）
 */
export function notReady(probe, answer = {}) {
  if (!probe?.slots || !answer?.slots) return '';
  const blank = probe.slots.reduce((n, s) => n + blankCells(answer.slots[s.name] ?? ''), 0);
  if (blank) return `还有 ${blank} 格没填`;
  const bad = probe.slots.filter((s) => [answer.slots[s.name]].flat(2).some((x) => String(x ?? '').trim() && !readable(x))).map((s) => s.name);
  if (bad.length) return `${bad.join('、')} 里有格子读不懂：写数、分数（1/2）或根号（√2）`;
  const empty = (probe.exprs || []).filter((e) => !String(answer.exprs?.[e.id] ?? '').trim()).map((e) => e.label);
  if (empty.length) return `${empty.join('、')}还没写`;
  return '';
}

// 学生格子里写的（'1/2'、'√2'、数）→ 数
const cellNum = (x) => (Array.isArray(x) ? x.map(cellNum) : typeof x === 'number' ? x : Number(readCell(x)));

const close = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => close(x, b[i]));
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
};

/** 学生写的式子（省乘号、上标、希腊字母都认）在 vars 上算，和标准式子比值 */
function sameValue(student, expected, vars) {
  const names = Object.keys(vars);
  try {
    const s = compile(normalizeFormula(String(student), { names, funcs: FORMULA_FUNCS }))(vars);
    const e = compile(normalizeFormula(String(expected), { names, funcs: FORMULA_FUNCS }))(vars);
    return close(s, e);
  } catch { return null; }
}

function ifItems(probe, slots, vars) {
  let values;
  try { values = Object.fromEntries(probe.slots.map((s) => [s.name, cellNum(slots?.[s.name])])); } catch { return probe.ifs.map((c) => ({ id: c.id, ok: false, why: '有格子里写的不是数' })); }
  return evalIfs(probe.ifs, values, vars, probe.slots).map((r) => {
    const c = probe.ifs.find((x) => x.id === r.id);
    return { id: r.id, ok: r.ok, why: r.ok ? '' : r.error ? `代进去算不了：${r.error}` : c.msg || `不满足 ${c.text}` };
  });
}

function exprItems(probe, exprs = {}) {
  return (probe.exprs || []).map((e) => {
    const s = String(exprs?.[e.id] ?? '').trim();
    if (!s) return { id: e.id, ok: false, why: `没写${e.label}` };
    const v = equivalent(s, e.expected);
    return { id: e.id, ok: v === 'unknown' ? null : v, why: v === true ? '' : v === 'unknown' ? '页面判不了这个式子' : `${e.label}不对` };
  });
}

function proofItem(probe, lines = []) {
  const p = probe.proof;
  // 模板取过数的：取到的数也写成 let（derive 照它算）
  const src = [`start: ${p.start}`, `goal: ${p.goal}`, ...(p.vars ? [`vars: ${p.vars}`] : []), ...Object.entries(probe.vals || {}).map(([k, v]) => `let ${k} = ${JSON.stringify(v)}`), ...(probe.lets || []).map((l) => `let ${l.name} = ${l.src}`)].join('\n');
  let spec, envs;
  try { spec = parseDeriveDo(src); envs = sampleEnvs(spec, { seed: probe.id }); } catch (e) { return { id: 'proof', ok: null, why: `页面算不了：${e.message}` }; }
  let prev = p.start;
  let done = false;
  const ls = (lines || []).map((x) => String(x).trim()).filter(Boolean);
  for (let i = 0; i < ls.length; i++) {
    const r = checkLine(spec, envs, prev, ls[i]);
    if (!r.ok) return { id: 'proof', ok: false, why: `第 ${i + 1} 行：${r.why || r.error}` };
    prev = ls[i];
    done = r.done;
  }
  return done ? { id: 'proof', ok: true, why: '' } : { id: 'proof', ok: false, why: `没推到 ${p.goal}` };
}

/**
 * 页面机器判的那一半。answer 的样子见 Task 2：construct { slots, exprs }；claim { truth, slots?, exprs?, text?, ink?, proof? }；
 * discriminate { can, text?, ink?, result? }；locate { line, text?, ink?, fix? }；recall / solve { text?, ink? }。
 * 返回 { items, needsClaude（还有要点 / 步骤要页面里的 Claude 判）, stop（判断错了：真假、能不能、哪一行，后面不用判了）}
 */
export function judgeMachine(probe, answer = {}, base = {}) {
  let vars;
  try { vars = withDefaults(probeVars(probe, base), probe.slots || []); } catch { vars = withDefaults({ ...base }, probe.slots || []); }
  const items = [];
  const hasPoints = (probe.must || []).length > 0;
  switch (probe.type) {
    case 'construct':
      items.push(...ifItems(probe, answer.slots, vars), ...exprItems(probe, answer.exprs));
      return { items, needsClaude: false, stop: false };
    case 'claim': {
      const ok = answer.truth === probe.truth;
      items.push({ id: 'truth', ok, why: ok ? '' : `这个命题是${probe.truth ? '真' : '假'}的` });
      if (!ok) return { items, needsClaude: false, stop: true };
      if (!probe.truth) { items.push(...ifItems(probe, answer.slots, vars), ...exprItems(probe, answer.exprs)); return { items, needsClaude: false, stop: false }; }
      if (probe.proof) { items.push(proofItem(probe, answer.proof)); return { items, needsClaude: false, stop: false }; }
      return { items, needsClaude: hasPoints, stop: false };
    }
    case 'discriminate': {
      const ok = answer.can === probe.can;
      items.push({ id: 'can', ok, why: ok ? '' : `这里${probe.can ? '能' : '不能'}用` });
      if (!ok) return { items, needsClaude: false, stop: true };
      if (probe.result) {
        const s = String(answer.result ?? '').trim();
        const v = s ? sameValue(s, probe.result, vars) : false;
        items.push({ id: 'result', ok: v, why: v === true ? '' : v === null ? '页面算不了这个结果' : s ? '结果不对' : '没写结果' });
      }
      return { items, needsClaude: hasPoints, stop: false };
    }
    case 'locate': {
      const ok = Number(answer.line) === probe.bug;
      items.push({ id: 'line', ok, why: ok ? '' : `第 ${Number(answer.line) || '?'} 行是对的` });
      if (!ok) return { items, needsClaude: false, stop: true };
      if (probe.fix) {
        const s = String(answer.fix ?? '').trim();
        const v = s ? sameValue(s, probe.fix, vars) : false;
        items.push({ id: 'fix', ok: v, why: v === true ? '' : v === null ? '页面判不了这个改法' : s ? '改得不对' : '没写改成什么' });
      }
      return { items, needsClaude: hasPoints, stop: false };
    }
    default: // recall、solve：全交给页面里的 Claude
      return { items, needsClaude: true, stop: false };
  }
}

// —— 页面里的 Claude 判的那一半 ——
// 要点（recall、claim 的证明要点、discriminate / locate 的理由）和 solve 的步骤：每交一次调一次 Opus 5.5 high（调用方 classroom.js 做），
// 给它的只有事实，回的 [判] 那几行和计划 1 的 board judge 同一种写法，用计划 1 的 parseJudge 读。读不出来的一律待核，绝不当成过。

export const JUDGE_WAIT = 90000; // 一次最多等多久：到了这道题待核（设计 5.6′）
// 外部没写 <<< >>> 时给页面里的 Claude 的话：外部在任务书里写的原话
export const DEFAULT_FALLBACK = '指出错在哪、只补缺的那一点（不给整段答案）。';

// 两条的开头（?dev 的模拟老师按它认出来，devteacher.js）
export const VERDICT_HEAD = '学习台上，学生在课后的检验里交了一道题（合书、第一次作答）。下面是题、主讲（外部的 Claude）写好的判分要点、学生交的。页面按你回的结论接着走：过了出下一道，没过显示主讲写的补讲、再出一道同类的题。';
export const FALLBACK_HEAD = '学习台上，学生在课后的检验里做错了一道题，主讲（外部的 Claude）写的补讲里没有对上这一次的错法。你写的话会原样显示在这道题下面当补讲，之后页面出一道同类的题让学生自己做。';

/** 要它判的项的编号：solve 是参考步骤，别的是 must、may、wrong */
export function claudeIds(probe) {
  if (probe.type === 'solve') return (probe.steps || []).map((s) => s.id);
  return [...(probe.must || []), ...(probe.may || []), ...(probe.wrong || [])].map((x) => x.id);
}

const VERDICT_LINE = /^\s*[-*]?\s*([A-Za-z]\w{0,15})\s+(ok|right|wrong|bad|missing|miss|unsure|对|错|缺|没写|待核|✓|✗|\?|？)(\s|$)/i;
const SCRIPT_LINE = /^\s*L(\d+)\s*(\[划掉\])?\s*[:：]\s?(.*)$/;

/**
 * 读它回的：[转写] 下的 L1 / L2 [划掉] 行，[判] 下的一行一项。ids 里没写到的 → ok: null、「没判这一项」；不在 ids 里的丢掉；
 * 一项都读不出来 → unread: true、全部 ok: null。steps：判的是 solve 的步骤（missing 照计划 1 带 tag 步骤缺）
 * 返回 { lines: [{ n, text, struck }], items: [{ id, ok, why, tag, unsure? }], unread }
 */
export function parseVerdict(text, ids = [], { steps = false } = {}) {
  const lines = [];
  const judged = [];
  for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
    let m;
    if ((m = raw.match(SCRIPT_LINE))) { lines.push({ n: Number(m[1]), text: m[3].trim(), struck: !!m[2] }); continue; }
    if ((m = raw.match(VERDICT_LINE)) && ids.includes(m[1])) judged.push(raw.trim());
  }
  const r = judged.length ? parseJudge(judged.join('\n'), ids.map((id) => ({ id }))) : { steps: ids.map((id) => ({ id, ok: null, why: '', tag: '' })) };
  const items = r.steps.map((s) => {
    const got = judged.some((l) => l.match(VERDICT_LINE)?.[1] === s.id);
    const it = { ...s, why: got ? s.why : '没判这一项', tag: !steps && s.tag === '步骤缺' ? '' : s.tag || '' };
    return it;
  });
  return { lines, items, unread: judged.length === 0 };
}

const mayIds = (probe) => new Set((probe.may || []).map((x) => x.id));

/** 一道题过没过：may 不算；有 false / missing → fail；没有失败、有 null → pending；都过 → pass。guessed：过了但点的是「蒙的」 */
export function outcomeOf(probe, items = [], { sure } = {}) {
  const skip = mayIds(probe);
  const req = items.filter((x) => !skip.has(x.id));
  const failed = req.filter((x) => x.ok === false || x.ok === 'missing').map((x) => x.id);
  const outcome = failed.length ? 'fail' : req.some((x) => x.ok !== true) ? 'pending' : 'pass';
  return { outcome, failed, guessed: outcome === 'pass' && sure === 'guess' };
}

/** 判出没过以后显示哪一条补讲：先按失败项的编号，再按失败项的 tag=…，想不出来时 giveup，最后 default；都没有 null */
export function teachFor(probe, failed = [], items = [], { giveup = false } = {}) {
  const t = probe.teach || {};
  const hit = (key) => (t[key] ? { key, text: t[key] } : null);
  if (giveup) return hit('giveup') || hit('default');
  for (const id of failed) { const h = hit(id); if (h) return h; }
  for (const it of items) if (failed.includes(it.id) && it.tag) { const h = hit(`tag=${it.tag}`); if (h) return h; }
  return hit('default');
}

const OK_TEXT = { must: '必写要点', may: '可选要点（不影响过没过）', wrong: '常见错说法' };

/** 学生这次交的，写成几行事实 */
function answerText(probe, answer = {}, images = 0) {
  const out = [];
  if (probe.type === 'claim') out.push(`学生判这个命题是：${answer.truth ? '真' : '假'}`);
  if (probe.type === 'discriminate') out.push(`学生判：${answer.can ? '能' : '不能'}用`, ...(answer.result ? [`学生写的结果：${answer.result}`] : []));
  if (probe.type === 'locate') out.push(`学生点的错的那一行：第 ${answer.line} 行`, ...(answer.fix ? [`学生写的改法：${answer.fix}`] : []));
  if (answer.text) out.push('学生打的字：', '<<<', String(answer.text), '>>>');
  if (images) out.push(`附图 ${images} 张：学生在页面上手写的整页（左边淡色的 L1、L2… 是页面写的行号；灰色带一道线的是学生划掉的）。`);
  if (!answer.text && !images) out.push('学生这次没写字。');
  return out;
}

/** 给页面里的 Claude 判分的那一条：题、要点或参考步骤、学生交的、要回的写法。只写事实 */
export function verdictPrompt({ probe, answer = {}, ids = claudeIds(probe), images = 0 } = {}) {
  const head = [VERDICT_HEAD, ''];
  const q = [`题（${probe.type}）：`, probe.claim ? `命题：${probe.claim}` : '', probe.q || '', ...(probe.lines || []).map((l, i) => `第 ${i + 1} 行：${l}`)].filter(Boolean);
  const pts = [];
  if (probe.type === 'solve') {
    pts.push('参考步骤：', ...(probe.steps || []).map((s) => `${s.id}（${STEP_KINDS[s.kind] || s.kind}）：${s.text}`));
    pts.push(`错法的词（tag=）：${STEP_TAGS.join('、')}`);
  } else {
    for (const k of ['must', 'may', 'wrong']) if ((probe[k] || []).length) pts.push(`${OK_TEXT[k]}：`, ...probe[k].filter((x) => ids.includes(x.id)).map((x) => `${x.id}：${x.text}`));
  }
  const fmt = [
    '回的写法：',
    ...(images ? ['[转写]', '照图一行一行写，行号照图左边的；划掉的行在行号后面写 [划掉]，比如：', 'L1: …', 'L2 [划掉]: …'] : []),
    '[判]',
    `每个编号一行（${ids.join('、')}）：`,
    probe.type === 'solve'
      ? '`s1 ok`（这一步写了、对）、`s3 wrong tag=规则用错 why="…"`（写了、错）、`s4 missing`（没写这一步）'
      : '`m1 ok`（写到了、写对了）、`m2 missing`（没写到）、`m3 wrong why="…"`（写了、写错了）；常见错说法 w 开头的：`w1 ok` 是学生没写这个错说法，`w1 wrong why="…"` 是写了',
    '看不清、拿不准对错的写 unsure，页面会标待主讲核：`m2 unsure why="…"`。',
  ];
  return [...head, ...q, '', ...pts, '', ...answerText(probe, answer, images), '', ...fmt].join('\n');
}

/** 外部没写到的错法（没有对上的 teach）：叫页面里的 Claude 写一段补讲。extPrompt 是 board check 里 <<< >>> 外部写给它的话 */
export function fallbackPrompt({ probe, answer = {}, items = [], extPrompt = '' } = {}) {
  const failed = items.filter((x) => x.ok === false || x.ok === 'missing');
  return [
    FALLBACK_HEAD,
    '',
    `主讲写给你的话：${String(extPrompt || '').trim() || DEFAULT_FALLBACK}`,
    '',
    `题（${probe.type}）：${probe.claim || probe.q || ''}`,
    ...['must', 'may', 'wrong'].flatMap((k) => (probe[k] || []).map((x) => `${OK_TEXT[k]} ${x.id}：${x.text}`)),
    ...(probe.steps || []).map((s) => `参考步骤 ${s.id}：${s.text}`),
    ...Object.entries(probe.teach || {}).map(([k, v]) => `主讲写的补讲（${k}）：${v}`),
    '',
    ...answerText(probe, answer, 0),
    '',
    '页面判出来没过的项：',
    ...(failed.length ? failed.map((x) => `${x.id}：${x.ok === 'missing' ? '没写到' : '不对'}${x.why ? `（${x.why}）` : ''}`) : ['（想不出来，没交）']),
  ].join('\n');
}

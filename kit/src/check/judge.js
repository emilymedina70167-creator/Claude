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

/** 还有几格没填（空串、只有空白、null） */
export function blankCells(v) {
  if (Array.isArray(v)) return v.reduce((n, x) => n + blankCells(x), 0);
  return v === null || v === undefined || String(v).trim() === '' ? 1 : 0;
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
  const src = [`start: ${p.start}`, `goal: ${p.goal}`, ...(p.vars ? [`vars: ${p.vars}`] : []), ...(probe.lets || []).map((l) => `let ${l.name} = ${l.src}`)].join('\n');
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

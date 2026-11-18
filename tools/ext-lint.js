// 外部的预检（需求 R4）：不开浏览器，一秒以内只查写法——board 块的围栏和指令、组件名、组件 id 重复、
// 指令的 target 存不存在、\calc 算不算得出、stage / widget 段的写法。画出来什么样、冲没冲出版面要跑 ext-check.mjs（开浏览器）。
// 纯函数（读源码文件拿组件名的那一个除外），tests/ext-lint.test.js。
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOutput } from '../kit/src/class/protocol.js';
import { parseLets, calcValue, letValue, expandCalc } from '../kit/src/exact.js';
import { parseDeriveDo, sampleEnvs, checkLine } from '../kit/src/derivedo.js';
import { parseSolve } from '../kit/src/solvespec.js';
import { selfCheck } from '../kit/src/check/spec.js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../kit/src');
const num = (d) => Number(d?.seq) || Number(String(d?.id ?? '').replace(/\D/g, '')) || 0;

/** 组件名：读 blocks/index.js 的 blocks 对象、content.js 的提示框和折叠、engines/registry.js 的演示组件（浏览器那份和这里同一个来源） */
export async function blockNames() {
  const names = new Set();
  const idx = readFileSync(resolve(SRC, 'blocks/index.js'), 'utf8');
  const body = idx.slice(idx.indexOf('export const blocks = {'), idx.indexOf('\n};', idx.indexOf('export const blocks = {')));
  for (const line of body.split('\n').slice(1)) {
    if (/^\s*\/\//.test(line)) continue;
    for (const m of line.matchAll(/(?:^\s*|[,{]\s*)([A-Za-z_]\w*)\s*(?=:|,|$)/g)) names.add(m[1]);
  }
  const content = readFileSync(resolve(SRC, 'blocks/content.js'), 'utf8');
  for (const obj of ['CALLOUTS', 'FOLDS']) {
    const m = content.match(new RegExp(`const ${obj} = \\{([^}]*)\\}`));
    if (m) for (const k of m[1].matchAll(/([A-Za-z_]\w*)\s*:/g)) names.add(k[1]);
  }
  const { ENGINES } = await import('../kit/src/engines/registry.js');
  for (const k of Object.keys(ENGINES)) names.add(k);
  for (const x of ['callouts', 'folds', 'ENGINES', 'Object', 'fromEntries', 'entries', 'filter', 'map', 'k', 'e', 'stepperBlock', 'elimBlock', 'doBlock', 'pvBlock', 'enLink', 'letBlock']) names.delete(x);
  for (const x of ['let', 'link']) names.add(x);
  return names;
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** 一段 Markdown 里的组件：[{ name, body, line }]（line 是在段里第几行，从 1 数） */
export function fencesOf(md) {
  const out = [];
  const lines = String(md ?? '').split('\n');
  let open = null;
  lines.forEach((line, i) => {
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)(.*)$/);
    if (open) {
      if (f && f[1][0] === open.fence[0] && f[1].length >= open.fence.length && !f[2] && !f[3].trim()) { out.push({ name: open.name, body: open.body.join('\n'), line: open.line }); open = null; }
      else open.body.push(line);
    } else if (f && f[2]) open = { fence: f[1], name: f[2].toLowerCase(), body: [], line: i + 1 };
  });
  if (open) out.push({ name: open.name, body: open.body.join('\n'), line: open.line, unclosed: true });
  return out;
}

const idOf = (body) => body.match(/^\s*id\s*[:：]\s*([\w\-.~:@+]+)\s*$/m)?.[1] || '';
const TARGET_OPS = new Set(['mark', 'figure', 'react', 'why', 'coach', 'claude']);

/**
 * 查一轮（外加这节课以前的几轮，用来认已有的段和组件 id）：
 * lintTurn({ prior: [以前的 ext_in.text…], text, names }) → { problems: [{ where, msg }], segments: n, components: n }
 */
export function lintTurn({ prior = [], text = '', names = new Set(), stageCheck = null, widgetCheck = null } = {}) {
  const problems = [];
  const segIds = new Set();
  const compIds = new Map(); // 组件 id → 段 id
  const vars = {};
  const addLets = (body) => {
    try { for (const c of parseLets(body)) { try { vars[c.name] = letValue(c.name, calcValue(c.src, vars).value); } catch { /* 下面会报 */ } } } catch { /* 下面会报 */ }
  };
  const segOps = (ops) => ops.filter((o) => ['new', 'add', 'replace', 'pin', 'stage', 'widget', 'queue', 'edit'].includes(o.op));
  for (const t of prior || []) {
    for (const o of segOps(parseOutput(String(t || ''), { final: true }).ops)) {
      segIds.add(o.id);
      for (const f of fencesOf(o.body)) { const id = idOf(f.body); if (id) compIds.set(id, o.id); if (f.name === 'let') addLets(f.body); }
    }
  }
  const out = parseOutput(String(text || ''), { final: true });
  for (const r of out.rejected) problems.push({ where: `board ${r.header.slice(0, 50)}`, msg: `指令看不懂：${r.error}（整块当成了普通文字写在板顶）` });
  for (const u of out.unclosed) problems.push({ where: `board ${u.header.slice(0, 50)}`, msg: '块没有闭合（整块当成了普通文字写在板顶）' });
  let segments = 0, components = 0;
  const here = new Map();
  for (const o of out.ops) {
    if (o.warn) problems.push({ where: `${o.op} ${o.id || ''}`, msg: o.warn });
    if (o.errors?.length) for (const e of o.errors) problems.push({ where: `${o.op}`, msg: e });
    // 检验（计划 2，check/spec.js）：example 照条件验一遍、必做题 retry 至少 2 道、每道题都排进去了……和页面开检验之前查的同一份
    if (o.op === 'check' && o.check) for (const msg of selfCheck(o.check)) problems.push({ where: `check id=${o.id}`, msg });
    if ((o.op === 'add' || o.op === 'new' || o.op === 'stage' || o.op === 'widget') && (segIds.has(o.id) || here.has(o.id))) problems.push({ where: `${o.op} id=${o.id}`, msg: `${o.id} 已经用过了：新的一段换一个 id，改这一段用 board replace id=${o.id}` });
    if ((o.op === 'hide' || o.op === 'show' || o.op === 'move' || o.op === 'edit') && !segIds.has(o.id) && !here.has(o.id)) problems.push({ where: `${o.op} id=${o.id}`, msg: `黑板上没有 ${o.id}` });
    if (segOps([o]).length) {
      here.set(o.id, o);
      segments++;
      if (o.op === 'stage' && stageCheck) for (const msg of stageCheck(`id: ${o.id}\n${o.body}`)) problems.push({ where: `stage id=${o.id}`, msg });
      if (o.op === 'widget' && widgetCheck) for (const msg of widgetCheck(`id: ${o.id}\n---\n${o.body}`)) problems.push({ where: `widget id=${o.id}`, msg });
      if (o.op === 'stage' || o.op === 'widget' || o.op === 'edit') continue;
      const seen = new Set();
      for (const f of fencesOf(o.body)) {
        const where = `${o.op} id=${o.id} 第 ${f.line} 行 ${f.name}`;
        if (f.unclosed) problems.push({ where, msg: '组件的围栏没有闭合' });
        if (!names.has(f.name)) {
          const near = f.name.length >= 3 && [...names].find((b) => editDistance(b, f.name) <= 2);
          if (near) problems.push({ where, msg: `没有「${f.name}」组件，是不是想写 ${near}？` });
          continue;
        }
        components++;
        const id = idOf(f.body);
        if (id) {
          if (seen.has(id)) problems.push({ where, msg: `组件 id「${id}」在这一段里写了两次` });
          else if (compIds.has(id) && compIds.get(id) !== o.id) problems.push({ where, msg: `组件 id「${id}」已经在 ${compIds.get(id)} 里用过了，换一个整节课没用过的` });
          seen.add(id);
          compIds.set(id, o.id);
        }
        if (f.name === 'stage' && stageCheck) for (const msg of stageCheck(f.body)) problems.push({ where, msg });
        if (f.name === 'widget' && widgetCheck) for (const msg of widgetCheck(f.body)) problems.push({ where, msg });
        if (f.name === 'let') { try { parseLets(f.body); } catch (e) { problems.push({ where, msg: e.message }); } addLets(f.body); }
        // derive 的学生版（dr-batch4 第 3 条：queue 里写了页面不认的 E(2)，预检说没问题）：start / goal / let 照页面同一份读一遍、算一遍
        if (f.name === 'derive' && /^\s*mode\s*[:：]\s*do\s*$/m.test(f.body)) for (const msg of deriveDoProblems(f.body)) problems.push({ where, msg });
        if (f.name === 'solve') for (const msg of parseSolve(f.body, { ext: true }).problems) problems.push({ where, msg });
        if (f.body.includes('\\calc')) for (const e of expandCalc(f.body, (x) => calcValue(x, vars).tex).errors) problems.push({ where, msg: `\\calc{${e.expr}} 算不出来：${e.msg}` });
      }
      // 组件外面的正文里的 \calc（整节课的量）
      const prose = String(o.body).replace(/^\s{0,3}(`{3,}|~{3,})[\s\S]*?^\s{0,3}\1\s*$/gm, '');
      if (prose.includes('\\calc')) for (const e of expandCalc(prose, (x) => calcValue(x, vars).tex).errors) problems.push({ where: `${o.op} id=${o.id}`, msg: `\\calc{${e.expr}} 算不出来：${e.msg}` });
    }
  }
  // 指令指的东西在不在：段 id 或组件 id（以前的轮、这一轮写的都算）
  for (const o of out.ops) {
    if (!TARGET_OPS.has(o.op) || !o.target) continue;
    const t = String(o.target);
    if (segIds.has(t) || here.has(t) || compIds.has(t)) continue;
    problems.push({ where: `${o.op} target=${t}`, msg: `板上没有 ${t}（段 id 或组件的 id:）` });
  }
  problems.push(...designHints({ out, prior, here }));
  return { problems, segments, components };
}

// —— 替外部挡出题错误（dr-batch4 第 5 条）：只是提示（level: 'hint'），不算写错 ——
// 页面判得了对错的组件（演示组件的 mode: do / quiz / fill 也算）
const GRADED = new Set(['answer', 'quiz', 'steps', 'cloze', 'errfind', 'parse', 'drill', 'chunk', 'translate', 'recognize', 'findbug', 'code', 'practice', 'link']);
const LIVE_KINDS = new Set(['wrong', 'giveup', 'stuck', 'misread']);
const graded = (f) => GRADED.has(f.name) || (/^\s*mode\s*[:：]\s*(do|quiz|fill)\s*$/m.test(f.body) && f.name !== 'frames');
const fieldOf = (body, k) => body.match(new RegExp(`^\\s*${k}\\s*[:：]\\s*(.+)$`, 'm'))?.[1]?.trim() || '';
const quizOptions = (body) => [...String(body).matchAll(/^\s*-\s*\[([ xX])\]\s*(.*)$/gm)].map((m) => ({ correct: m[1].toLowerCase() === 'x', text: m[2].trim() }));
const plain = (t) => String(t || '').replace(/[$\\{}\s*_`]/g, '').toLowerCase();
const INTERACTIVE = new Set(['answer', 'steps', 'derive', 'elim', 'predict', 'recognize', 'scene', 'sort', 'cloze', 'parse', 'solve']);

export function designHints({ out, prior = [], here = new Map() } = {}) {
  const hints = [];
  const hint = (where, msg) => hints.push({ where, msg, level: 'hint' });
  // 这一轮和以前几轮写的预案、助手：target → 有没有接答错 / 想不出来 / 很久没动
  const covered = new Set();
  const scan = (ops) => { for (const o of ops) { if (o.op === 'react' && (o.cases || []).some((c) => LIVE_KINDS.has(c.kind))) covered.add(String(o.target)); if (o.op === 'claude' && o.target) covered.add(String(o.target)); } };
  for (const t of prior || []) scan(parseOutput(String(t || ''), { final: true }).ops);
  scan(out.ops);
  for (const [segId, o] of here) {
    if (o.op === 'stage' || o.op === 'widget' || o.op === 'edit') continue;
    const fs = fencesOf(o.body);
    fs.forEach((f, i) => {
      const id = idOf(f.body);
      const where = `${o.op} id=${segId} ${f.name}${id ? ` ${id}` : ''}`;
      if (id && graded(f) && !covered.has(id)) hint(where, `学生答错要等你：${id} 没写预案（board react 的 wrong / stuck / giveup），也没挂 board claude`);
      if (f.name !== 'quiz') return;
      const opts = quizOptions(f.body);
      const right = opts.filter((x) => x.correct), wrong = opts.filter((x) => !x.correct);
      // 正确选项明显比别的长：学生看长短就能猜
      if (right.length === 1 && wrong.length >= 2) {
        const long = Math.max(...wrong.map((x) => plain(x.text).length));
        if (plain(right[0].text).length >= Math.max(8, long * 1.5)) hint(where, `正确选项比别的选项长得多（${plain(right[0].text).length} 对 ${long} 个字）：学生看长短就能猜`);
      }
      // 正确选项的字露在题干、或这一段别的组件里（explain 不算）
      const stem = plain(fieldOf(f.body, 'q') || fieldOf(f.body, 'question'));
      for (const r of right) {
        const a = plain(r.text);
        if (a.length < 4) continue;
        if (stem.includes(a)) hint(where, `正确选项「${r.text.slice(0, 30)}」原样写在题干里`);
        else if (fs.some((g, j) => j !== i && g.name !== 'let' && plain(g.body.replace(/^\s*explain\s*[:：].*$/gm, '')).includes(a))) hint(where, `正确选项「${r.text.slice(0, 30)}」原样写在这一段别的组件里：学生不用想就能对上`);
      }
      // 能绕过前面那步：前面让学生自己做的组件的答案，原样出现在这道题的选项或题干里
      for (const g of fs.slice(0, i)) {
        if (!INTERACTIVE.has(g.name)) continue;
        const ans = plain(fieldOf(g.body, 'answer') || fieldOf(g.body, 'goal'));
        if (!ans) continue;
        // 短的答案（一个数）只认选项整个就是它；长的认原样出现在题干、选项里
        const inStem = ans.length >= 3 && stem.includes(ans);
        if (inStem || opts.some((x) => plain(x.text) === ans || (ans.length >= 3 && plain(x.text).includes(ans)))) hint(where, `这题能绕过前面那步：前面 ${g.name}${idOf(g.body) ? ` ${idOf(g.body)}` : ''} 要学生自己得出的「${(fieldOf(g.body, 'answer') || fieldOf(g.body, 'goal')).slice(0, 30)}」写在这道题的${inStem ? '题干' : '选项'}里`);
      }
    });
  }
  return hints;
}

/** derive mode: do 的写法查一遍：读得懂、取得了数、start 算得出、goal 读得懂（和页面 blocks/derivedo.js 同一份函数） */
export function deriveDoProblems(body) {
  let spec, envs;
  try { spec = parseDeriveDo(body); } catch (e) { return [e.message]; }
  try { envs = sampleEnvs(spec); } catch (e) { return [e.message]; }
  const out = [];
  const self = checkLine(spec, envs, spec.start, spec.start);
  if (!self.ok) out.push(`start: ${spec.start} ${self.error || self.why || '算不出来'}`);
  if (spec.goal) { const g = checkLine(spec, envs, spec.goal, spec.goal); if (!g.ok) out.push(`goal: ${spec.goal} ${g.error || g.why || '算不出来'}`); }
  return out;
}

/** 存下来的这节课（ext_in 的文档）按序号排好，取 text */
export const priorTexts = (ins = []) => [...(ins || [])].sort((a, b) => num(a) - num(b)).map((d) => String(d.text || ''));

export const lintAvailable = () => existsSync(resolve(SRC, 'blocks/index.js'));

/** stage / widget 段的写法检查（舞台、widget 接进来以后才有；没有就不查） */
export async function checkers() {
  const out = {};
  try { const m = await import('../kit/src/stage/check.js'); if (m.stageProblems) out.stageCheck = m.stageProblems; } catch { /* 还没有舞台 */ }
  try { const m = await import('../kit/src/widgetspec.js'); if (m.widgetProblems) out.widgetCheck = m.widgetProblems; } catch { /* 还没有 widget */ }
  return out;
}

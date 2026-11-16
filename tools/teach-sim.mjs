// 教学尺子（evals/teaching/，docs/learning-plan.md 第 4 节）：一节模拟课的「页面」。
// 老师（子代理，扮课堂里的 Claude）和学生（子代理，带一个设定好的误解）不直接对话，都经过这个脚本：
// 老师的输出用真的 protocol.js 读、按真的规矩上黑板；学生看到的是去掉答案的板面；学生的作答由这里判分，
// 用真的 actionText 写成课堂里同样的 [作答] / [动作] 行，连同真的「黑板现状」（和教学计划）发回给老师。
//
//   node tools/teach-sim.mjs init  <目录> <场景.json> [--system 文件] [--memory 文件] [--no-plan]   开课：写 system.md（老师读一次）、state.json
//                                                                  （--system 原样抄成 system.md，基线那一版用；--memory 是记忆样例 JSON，照课堂的写法带进说明）
//   node tools/teach-sim.mjs teacher <目录> <老师这一轮的输出文件>    上黑板；写 view.md（学生看的）
//   node tools/teach-sim.mjs student <目录> <学生这一轮的 JSON 文件>  判分；写 to-teacher.md（下一轮发给老师的）
//   node tools/teach-sim.mjs transcript <目录>                         整节课的记录 transcript.md（评卷人看）
//   node tools/teach-sim.mjs posttest <目录>                           写 posttest.md（只有题面）和 posttest-key.md（答案，只给评卷人）
//   node tools/teach-sim.mjs score <目录…>                             页面能算的指标（含按学生用时算的钟）
//
// 钟（tools/teach-sim-lib.mjs）：一节课多长按学生用掉的时间算——读、等老师、点、写、说；老师、学生两种命令算完钟都判，到时间（或老师写满 40 轮）
// 就 over，最后一行打印「到时间了」；over 以后再调用 teacher / student 都报错。
// 学生的 JSON 可带 "note"：这一轮记在笔记本 notebook.md 里的话，课后测验时学生只能看这个。
//
// 预案（board react，docs/board-plan.md）：学生作答落在老师预写的情况里时，页面自己接、不调用老师——
// student 命令打印「页面按预案接了」，这时**不跑老师**，学生接着看 view.md 再答一轮；接过的几轮跟着下一次发给老师。
//
// 学生的 JSON：{ "say": "对老师说的话（可空）", "acts": [{ "comp": "组件 id", "value": "答案或选项的文字" } | { "comp": "…", "giveup": true }],
//               "sure": { "组件 id": true | false } }
import fs from 'node:fs';
import path from 'node:path';
import { componentDocs } from '../kit/build-docs.js';
import { buildSystem, boardStateText, planText, latestPlan, actionsMessage, actionText } from '../kit/src/class/prompt.js';
import { parseOutput } from '../kit/src/class/protocol.js';
import { wordSpan } from '../kit/src/entext.js';
import { parseCloze, matchText, diagnose, tokenizeSentence, findWrong, parseAnswer, parseDecoys, parseBrackets, judgeSpans, spansHint, parseRoles, parseChunk, judgeChunks, chunkHint, chunksOf, parseDrill, textHint } from '../kit/src/entext.js';
import { compile, valueTeX } from '../kit/src/expr.js';
import { ENGINES } from '../kit/src/engines/registry.js';
import { parseFields } from '../kit/src/parse.js';
import { calcFields, commonSpec, resolveAsks, parseAskField, checkAsk, askAnswerText } from '../kit/src/stepperspec.js';
import { textAnswerSpec } from '../kit/src/textspec.js';
import { toExact } from '../kit/src/exact.js';
import { planLocal, markFired, reactNote, dropForSeg, armedText } from '../kit/src/class/react.js';
import { checkScenario, newClock, tick, timeUp, shownChars, lessonMetrics } from './teach-sim-lib.mjs';

const [cmd, dir, arg, ...rest] = process.argv.slice(2);
const read = (f) => fs.readFileSync(f, 'utf8');
const P = (f) => path.join(dir, f);
const load = () => JSON.parse(read(P('state.json')));
const save = (s) => fs.writeFileSync(P('state.json'), JSON.stringify(s, null, 1));
const bytes = (s) => Buffer.byteLength(String(s ?? ''));

/* ---------------- 组件：学生看到什么、怎么判 ---------------- */

function fencesOf(md) {
  const out = [];
  const re = /^(`{3,}|~{3,})[ \t]*([A-Za-z][\w-]*)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm;
  let m;
  while ((m = re.exec(String(md ?? '')))) {
    const body = m[3].replace(/\n$/, '');
    out.push({ lang: m[2].toLowerCase(), body, id: body.match(/^\s*id\s*[:：]\s*(\S+)\s*$/m)?.[1] || '', raw: m[0], at: m.index });
  }
  return out;
}

const KEY = /^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/;
function parseSteps(src) {
  const fields = {}; const steps = []; let target = fields, last = null;
  for (const raw of String(src).split('\n')) {
    const m = raw.match(KEY);
    if (m) {
      const k = m[1].toLowerCase();
      if (k === 'step') { target = { title: m[2].trim() }; steps.push(target); last = null; continue; }
      target[k] = m[2]; last = k;
    } else if (last) target[last] += '\n' + raw;
  }
  for (const o of [fields, ...steps]) for (const k in o) if (typeof o[k] === 'string') o[k] = o[k].trim();
  if (!steps.length) throw new Error('steps 至少要有一个 step:');
  for (const s of steps) s.choices = s.choices ? s.choices.split(/\s*\|\s*/).filter(Boolean) : null;
  return { fields, steps };
}
function parseQuiz(src) {
  const fields = {}; const options = [];
  for (const raw of String(src).split('\n')) {
    const o = raw.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/);
    if (o) { options.push({ correct: o[1].toLowerCase() === 'x', text: o[2].trim() }); continue; }
    const m = raw.match(KEY);
    if (m) fields[m[1].toLowerCase()] = m[2].trim();
  }
  return { fields, options };
}
// 一个字段：这一行，加上后面缩进的续行（cloze 的 text: 常写成好几行）
const field = (body, k) => {
  const m = body.match(new RegExp(`^\\s*${k}\\s*[:：]\\s?(.*(?:\\n[ \\t]+\\S.*)*)`, 'mi'));
  return m ? m[1].replace(/\n[ \t]+/g, '\n').trim() : '';
};
// 隐藏答案：这些字段学生看不到
const HIDDEN = /^\s*(answer|answers|check|explain|show|expected|hint|why|wrong|variants|alts|accept|solution)\s*[:：]/i;

/** 一个组件 → 学生看到的文字（progress：steps 走到第几步了） */
function studentComp(f, progress = 0, st = null) {
  const id = f.id || '（没写 id）';
  try {
    if (f.lang === 'steps') {
      const { fields, steps } = parseSteps(f.body);
      const k = Math.min(progress, steps.length);
      const done = steps.slice(0, k).map((s, i) => `  第 ${i + 1} 步 ${s.title}：${s.show || s.answer || ''}`);
      const cur = steps[k];
      return [`【分步例题 ${id}】${fields.title || ''}`, fields.q ? `  ${fields.q}` : '', ...done,
        cur ? `  第 ${k + 1} 步 ${cur.title}：${cur.ask || '（自己做这一步）'}${cur.choices ? `\n  选项：${cur.choices.join(' / ')}` : cur.do ? '\n  （自己写出这一步的结果）' : '\n  （写一句你的想法）'}` : '  （全部步骤都揭开了）'].filter(Boolean).join('\n');
    }
    if (f.lang === 'quiz') {
      const { fields, options } = parseQuiz(f.body);
      if (!options.length) return `【填空题 ${id}】${fields.title || ''}\n  ${fields.q || ''}\n  （写出答案）`;
      return `【选择题 ${id}】${fields.title || ''}\n  ${fields.q || ''}\n${options.map((o, i) => `  ${String.fromCharCode(65 + i)}. ${o.text}`).join('\n')}${options.filter((o) => o.correct).length > 1 ? '\n  （多选）' : ''}`;
    }
    if (f.lang === 'answer' || f.lang === 'practice') {
      return `【作答题 ${id}】${field(f.body, 'title')}\n  ${field(f.body, 'q')}\n  （写出答案）`;
    }
    // 英语组件（docs/english-plan.md 第 5 批）：学生看到的和页面上一样，答案去掉
    if (f.lang === 'cloze') {
      const { parts } = parseCloze(field(f.body, 'text').replace(/\n\s+/g, ' '));
      const sent = parts.map((p) => (p.text !== undefined ? p.text : `（${p.blank + 1}）${p.choices ? `[${p.choices.map((c) => c.text).join(' / ')}]` : '____'}`)).join('');
      return `【填空 ${id}】${field(f.body, 'title')}\n  ${field(f.body, 'q')}\n  ${sent}\n  （按顺序写每个空，用 | 隔开，比如 "who | has lived"）`;
    }
    if (f.lang === 'errfind') return `【改错 ${id}】${field(f.body, 'q') || '点出用错的那个词并改正'}\n  ${field(f.body, 'text')}\n  （写成 "错的词 → 改成什么"，比如 "are → is"）`;
    if (f.lang === 'parse') {
      const ans = parseBrackets(field(f.body, 'answer'));
      const roles = parseRoles(field(f.body, 'roles'), [...new Set(ans.spans.map((x) => x.role))]);
      if (/^show$/i.test(field(f.body, 'mode'))) return `【句子结构 ${id}】${field(f.body, 'answer')}`;
      const st = field(f.body, 'steps');
      return `【成分标注 ${id}】${field(f.body, 'q')}\n  ${ans.text}\n  成分：${roles.map((r) => `${r.key}=${r.name}`).join('、')}${st ? `\n  分步：${st}（现在是第 ${progress + 1} 步，只标这一步的成分）` : ''}\n  （用括号写，比如 "[S The man] [V gave] …"，从句可以套一层）`;
    }
    if (f.lang === 'chunk') { const c = parseChunk(field(f.body, 'text')); return `【意群断句 ${id}】${field(f.body, 'q') || '把句子切成意群'}\n  ${c.text}\n  （在要切的地方写 /，比如 "The man / gave me a book"）`; }
    if (f.lang === 'drill') {
      const items = parseDrill(f.body.split('\n'));
      const it = items[Math.min(progress, items.length - 1)];
      return `【操练 ${id}】${field(f.body, 'q')}\n  第 ${Math.min(progress, items.length - 1) + 1} / ${items.length} 题：${it.q}`;
    }
    if (['scene', 'graph', 'space', 'plot'].includes(f.lang)) return `【一张图 ${id}】${field(f.body, 'title')}（模拟课里拖不了；可以看图里的标注：${f.body.split('\n').filter((l) => /^\s*show\b|label=/.test(l)).map((l) => l.trim()).slice(0, 3).join('；') || '没有'}）`;
    if (f.lang === 'let') return '';
    if (ENGINES[f.lang] && f.lang !== 'frames') return studentDemo(f, st, progress);
    // 别的组件：去掉答案类字段，原样给
    return `【${f.lang} ${id}】\n${f.body.split('\n').filter((l) => !HIDDEN.test(l) && !/^\s*-\s*\[[xX]\]/.test(l)).map((l) => `  ${l}`).join('\n')}`;
  } catch (e) {
    return `【${f.lang} ${id}】（这个组件写错了，学生看到的是「这段没画出来」：${e.message}）`;
  }
}


/* ---------------- 演示组件（stepper）：用真的引擎出题、判分 ---------------- */
// 模拟课里学生做得了的：mode: quiz（写结果）和 ask:（先猜；在图上点的写出点的那个的名字）。fill 表格判不了
function demoOf(f, st) {
  const e = ENGINES[f.lang];
  const raw = parseFields(e.head ? e.head(f.body) : f.body).fields;
  const ev = {};
  for (const [k, v] of Object.entries(boardVars(st))) { try { ev[k] = toExact(v); } catch { /* 小数照原样 */ } }
  const { fields } = calcFields(raw, ev);
  const common = commonSpec(fields);
  const input = e.parse(fields, f.body);
  if ((fields.ask === undefined || fields.ask === '') && e.defaultAsk) { const d = e.defaultAsk(input); if (d) common.ask = parseAskField(d); }
  const run = e.run(input);
  const quiz = common.mode === 'quiz' ? e.quiz?.(input, run, fields) : null;
  const { asks, which } = resolveAsks(common.ask, run.steps);
  const list = [...asks].map((k) => ({ at: k, ask: which.get(k) }));
  const variants = () => (e.variants?.(input, fields) || []).map((v) => { try { return { label: v.label, input: v.input, run: e.run(v.input) }; } catch { return null; } }).filter(Boolean);
  return { e, fields, input, run, quiz, list, mode: common.mode, variants };
}
const inputText = (fields) => Object.entries(fields).filter(([k]) => !['id', 'title', 'q', 'note', 'ask', 'mode', 'quiz', 'start', 'speed', 'auto', 'hint'].includes(k) && !HIDDEN.test(`${k}:`)).map(([k, v]) => `${k}: ${v}`).join('；');
function studentDemo(f, st, progress) {
  const id = f.id || '（没写 id）';
  const d = demoOf(f, st);
  const head = `【演示 ${f.lang} ${id}】${d.fields.title || d.e.title}${d.fields.q ? `\n  ${d.fields.q}` : ''}\n  输入：${inputText(d.fields)}`;
  if (d.quiz) return `${head}\n  ${d.quiz.q}${d.quiz.qhtml ? '（题面画着开始的样子：就是上面的输入）' : ''}\n  （写出结果）`;
  if (d.mode === 'fill') return `${head}\n  （自己填表：模拟课里填不了，跳过）`;
  if (!d.list.length) return `${head}\n  （演示，一步步看；没有要你答的）`;
  const k = Math.min(progress, d.list.length);
  if (k >= d.list.length) return `${head}\n  （问题都答完了）`;
  const { at, ask } = d.list[k];
  const before = d.run.steps.slice(1, at).map((x, i) => `  第 ${i + 1} 步：${String(x.msg || '').replace(/\$/g, '')}`).slice(-4).join('\n');
  const how = ask.kind === 'choice' ? `选项：${(ask.choices || []).join(' / ')}` : ask.kind === 'pick' ? `在图上点${(ask.count || 1) > 1 ? ` ${ask.count} 个` : ''}（写出点的那个的名字或值）` : ask.kind === 'order' ? '在图上按顺序点（按顺序写出来，空格隔开）' : '写出来';
  return `${head}\n${before ? `${before}\n` : ''}  第 ${k + 1} / ${d.list.length} 问（走到第 ${at} 步之前）：${ask.q}\n  （${how}）`;
}
function judgeDemo(st, act, base, attempts) {
  const { f } = st.compAt[act.comp];
  const d = demoOf(f, st);
  const title = d.fields.title || d.e.title;
  const rec = { ...base, type: 'stepper', engine: f.lang, title, closed: !d.quiz && !act.giveup };
  if (d.quiz) {
    const spec = textAnswerSpec(d.quiz.type || 'seq', d.quiz.answer, { width: d.quiz.width });
    if (act.giveup) return { ...rec, q: d.quiz.q, ok: false, attempts, revealed: true, expected: spec.display, detail: '写出结果', final: true };
    const ok = spec.check(act.value).ok;
    const misread = ok ? '' : d.variants().find((v) => { try { const a = d.e.quiz(v.input, v.run, d.fields); return a && textAnswerSpec(d.quiz.type || 'seq', a.answer, { width: d.quiz.width }).check(act.value).ok; } catch { return false; } })?.label || '';
    return { ...rec, q: d.quiz.q, value: act.value, ok, attempts, detail: '写出结果', misread: misread || undefined, final: ok };
  }
  const k = st.progress[f.id] || 0;
  const item = d.list[k];
  if (!item) return { source: 'page', text: `[系统] ${f.id} 没有要答的了` };
  const next = () => { st.progress[f.id] = k + 1; st.tries[f.id] = 0; };
  if (act.giveup) { next(); return { ...rec, q: item.ask.q, ok: false, attempts, giveup: true, expected: askAnswerText(item.ask), detail: `第 ${item.at} 步`, final: true }; }
  const given = item.ask.kind === 'order' || (item.ask.kind === 'pick' && (item.ask.count || 1) > 1) ? String(act.value).split(/[\s,，、→]+/).filter(Boolean) : act.value;
  const r = checkAsk(item.ask, given);
  let misread = '';
  if (!r.ok) {
    misread = d.variants().find((v) => { const a = v.run.steps[item.at]?.ask; try { return a && a.tag === item.ask.tag && checkAsk(a, given).ok; } catch { return false; } })?.label || '';
  }
  if (r.ok) next();
  return { ...rec, q: item.ask.q, value: Array.isArray(given) ? given.join(' ') : given, ok: r.ok, attempts, detail: `第 ${item.at} 步`, misread: misread || undefined, final: r.ok };
}

// 页面会把 \calc{…} 算好再写上去：学生看到的是数（算不出来的照原样留着）
function expandCalc(md, vars) {
  return String(md).replace(/\\calc\{((?:[^{}]|\{[^{}]*\})*)\}/g, (m, ex) => { const v = evalExpr(ex, vars); try { return v === undefined ? m : valueTeX(v); } catch { return m; } });
}

/** 一段 → 学生看到的文字 */
function studentSeg(seg, st) {
  const md = expandCalc(String(seg.md || ''), boardVars(st));
  const fs_ = fencesOf(md);
  let out = '';
  let pos = 0;
  for (const f of fs_) {
    out += md.slice(pos, f.at);
    out += studentComp(f, st.progress[f.id] || 0, st);
    pos = f.at + f.raw.length;
  }
  out += md.slice(pos);
  return `## ${seg.title || seg.id}\n${out.trim()}`;
}

// 数值比较：表达式算出来的数 / 向量 / 矩阵
function evalExpr(src, vars = {}) {
  try { return compile(String(src).replace(/[（）]/g, (c) => (c === '（' ? '(' : ')')))(vars); } catch { return undefined; }
}
const flat = (v) => (Array.isArray(v) ? v.flat(Infinity) : [v]);
function sameVal(a, b) {
  if (a === undefined || b === undefined) return null;
  const x = flat(a), y = flat(b);
  if (x.length !== y.length || x.some((n) => typeof n !== 'number')) return false;
  return x.every((n, i) => Math.abs(n - y[i]) < 1e-6 * Math.max(1, Math.abs(n)));
}
// 黑板上所有 let 块定义的量（整节课都能用，和页面的 session.vars 一样）
function boardVars(st) {
  const v = {};
  for (const sg of st.segs) for (const f of fencesOf(sg.md)) {
    if (f.lang !== 'let') continue;
    for (const m of f.body.matchAll(/^\s*(?:let\s+)?([A-Za-z_][\w]*)\s*=\s*(.+)$/gm)) { const x = evalExpr(m[2], v); if (x !== undefined) v[m[1]] = x; }
  }
  return v;
}
function answerVars(body, base = {}) {
  const v = { ...base };
  // 组件里的 let 一行一个（scene.js 碰 DOM，这里自己读）
  for (const m of String(body).matchAll(/^\s*let\s+([A-Za-z_][\w]*)\s*=\s*(.+)$/gm)) { const x = evalExpr(m[2], v); if (x !== undefined) v[m[1]] = x; }
  return v;
}
const norm = (s) => String(s ?? '').replace(/\$/g, '').replace(/\s+/g, '').toLowerCase();

// 学生选的是哪一项：写选项文字、字母（A / A. / A、），或者「A. 选项文字」都认
export function pickOption(texts, value) {
  const v = norm(value);
  const byText = texts.findIndex((t) => norm(t) === v);
  if (byText >= 0) return byText;
  const m = String(value ?? '').trim().match(/^([A-Za-z])(?:[.．、:：)）\s]|$)/);
  if (m) { const i = m[1].toUpperCase().charCodeAt(0) - 65; if (i >= 0 && i < texts.length) return i; }
  return texts.findIndex((t) => norm(t) && v.includes(norm(t)));
}

// wordSpan 数的是记号（含标点）：parseBrackets 的 tokens 也含标点，下标一致
const idxOf = (tokens, i) => i;

/** 学生的一个动作 → 课堂里同样的作答记录（交给 actionText） */
function judge(st, act) {
  const where = st.compAt[act.comp];
  if (!where) return { source: 'page', text: `[系统] 学生想答 ${act.comp}，可黑板上没有这个组件` };
  const { seg, f } = where;
  const base = { source: 'record', block: f.id, step: seg.id };
  st.tries[f.id] = (st.tries[f.id] || 0) + (act.giveup ? 0 : 1);
  const attempts = st.tries[f.id];
  if (f.lang === 'steps') {
    const { fields, steps } = parseSteps(f.body);
    const k = st.progress[f.id] || 0;
    const s = steps[k];
    if (!s) return { source: 'page', text: `[系统] ${f.id} 的步骤都揭开了` };
    const detail = `第 ${k + 1} 步`;
    if (act.giveup) { st.progress[f.id] = k + 1; st.tries[f.id] = 0; return { source: 'event', type: 'giveup', block: f.id, step: seg.id, detail: { step: k + 1, title: s.title }, closed: false }; }
    let ok = null;
    if (s.choices) ok = pickOption(s.choices, act.value) === s.choices.indexOf(s.answer);
    else if (s.do && s.answer) { const v = boardVars(st); ok = sameVal(evalExpr(act.value, v), evalExpr(s.answer, v)); }
    // 选择一次定（和真的 steps 一样：选错就揭开）；写的错了可以再试
    if (s.choices || ok !== false) { st.progress[f.id] = k + 1; st.tries[f.id] = 0; }
    return { ...base, type: 'steps', title: fields.title || '', q: `${s.title}｜${s.ask || ''}`, detail, value: s.choices ? act.value : undefined, text: s.choices ? undefined : act.value, ok, attempts, closed: !!s.choices };
  }
  if (f.lang === 'quiz') {
    const { fields, options } = parseQuiz(f.body);
    // 填空题（answer: 2，几个都对用 | 隔开；数按数值比）
    if (!options.length && fields.answer) {
      const v = boardVars(st);
      const ok = fields.answer.split('|').map((x) => x.trim()).some((a) => { const x = sameVal(evalExpr(act.value, v), evalExpr(a, v)); return x === null ? norm(a) === norm(act.value) : x; });
      return { ...base, type: 'quiz', q: fields.q || '', value: act.value, ok, attempts, ...(ok ? {} : { wrong: [act.value] }), final: ok, closed: false };
    }
    const pick = pickOption(options.map((o) => o.text), act.value);
    const ok = pick >= 0 ? options[pick].correct : false;
    return { ...base, type: 'quiz', q: fields.q || '', ok, attempts, ...(ok ? {} : { wrong: [act.value] }), final: ok, closed: true };
  }
  if (f.lang === 'cloze') {
    const { specs } = parseCloze(field(f.body, 'text').replace(/\n\s+/g, ' '));
    const vals = String(act.value ?? '').split('|').map((x) => x.trim());
    const res = specs.map((sp, i) => matchText(vals[i] || '', sp.alts));
    const diags = specs.map((sp, i) => (res[i].ok ? null : diagnose(vals[i] || '', sp.wrongs)));
    const ok = res.every((r) => r.ok);
    return { ...base, type: 'cloze', title: field(f.body, 'title'), q: field(f.body, 'q'), value: vals.join(' | '), ok, attempts, detail: ok ? '' : res.map((r, i) => (r.ok ? '' : `第 ${i + 1} 空${diags[i]?.why ? `：${diags[i].why}` : textHint(r, { what: '' })}`)).filter(Boolean).join('；'), misread: diags.map((d, i) => (d ? `第 ${i + 1} 空写成「${d.text}」${d.why ? `：${d.why}` : ''}` : '')).filter(Boolean).join('；') || undefined, final: ok || undefined, closed: false };
  }
  if (f.lang === 'errfind') {
    const text = field(f.body, 'text');
    const toks = tokenizeSentence(text);
    const wrongAt = findWrong(text, field(f.body, 'wrong'));
    const { alts, wrongs } = parseAnswer(field(f.body, 'fix'));
    const decoys = field(f.body, 'decoys') ? parseDecoys(text, field(f.body, 'decoys')) : [];
    const [w, fix = ''] = String(act.value ?? '').split(/→|->|=>/).map((x) => x.trim());
    const pick = toks.findIndex((t) => t.word && t.w.toLowerCase() === String(w).toLowerCase());
    const spot = pick === wrongAt;
    const fixOk = !alts.length || matchText(fix, alts).ok;
    const decoy = decoys.find((d) => d.i === pick);
    const bad = spot && !fixOk ? diagnose(fix, wrongs) : null;
    return { ...base, type: 'errfind', q: text, value: `点了「${w}」，改成「${fix}」`, ok: spot && fixOk, attempts, detail: spot ? (fixOk ? '' : '找对了，改得不对') : '这个词没错', misread: decoy ? `点了常见的错处「${decoy.w}」：${decoy.why}` : bad ? `改成了常见的错法「${bad.text}」${bad.why ? `：${bad.why}` : ''}` : undefined, final: (spot && fixOk) || undefined, closed: false };
  }
  if (f.lang === 'parse') {
    const ans = parseBrackets(field(f.body, 'answer'));
    const roles = parseRoles(field(f.body, 'roles'), [...new Set(ans.spans.map((x) => x.role))]);
    let mine;
    try {
      // 学生写的括号按词对回答案的句子（学生不一定把整句抄全）
      const got = parseBrackets(String(act.value ?? ''));
      const words = ans.tokens.map((t) => t.w);
      mine = got.spans.map((x) => {
        const text = got.tokens.slice(x.from, x.to + 1).map((t) => t.w).join(' ');
        const r = wordSpan({ kind: 'phrase', text, n: 0 }, words.map((w) => w));
        const at = r.error ? wordSpan({ kind: 'phrase', text, n: 1 }, words) : r;
        return at.error ? null : { role: x.role, from: idxOf(ans.tokens, at.from), to: idxOf(ans.tokens, at.to) };
      }).filter(Boolean);
    } catch (e) { return { source: 'page', text: `[系统] 学生写的成分看不懂（${e.message}）` }; }
    const stepsSrc = field(f.body, 'steps');
    const groups = stepsSrc ? stepsSrc.split('|').map((g) => g.trim().split(/\s+/)) : null;
    const k = st.progress[f.id] || 0;
    const target = groups ? ans.spans.filter((x) => groups[k]?.includes(x.role)) : ans.spans;
    const r = judgeSpans(groups ? mine.filter((x) => groups[k]?.includes(x.role)) : mine, target);
    if (r.ok && groups) { st.progress[f.id] = k + 1; st.tries[f.id] = 0; }
    return { ...base, type: 'parse', q: ans.text, value: act.value, ok: r.ok, attempts, detail: groups ? `第 ${k + 1} 步（${groups[k].join('、')}）` : r.ok ? '' : spansHint(r, roles), check: groups && !r.ok ? spansHint(r, roles) : undefined, closed: false };
  }
  if (f.lang === 'chunk') {
    const c = parseChunk(field(f.body, 'text'));
    // 学生写的 / 换成切口（第几个词前面切）
    const toks = tokenizeSentence(String(act.value ?? ''));
    const cuts = [];
    let n = 0;
    for (const t of toks) { if (t.w === '/') { cuts.push(n); continue; } n++; }
    const r = judgeChunks(cuts.filter((g) => c.gaps.includes(g)), c);
    return { ...base, type: 'chunk', q: c.text, value: chunksOf(c.tokens, cuts).join(' / '), ok: r.ok, attempts, detail: r.ok ? '' : chunkHint(r, c.tokens), final: r.ok || undefined, closed: false };
  }
  if (f.lang === 'drill') {
    const items = parseDrill(f.body.split('\n'));
    const k = st.progress[f.id] || 0;
    const it = items[Math.min(k, items.length - 1)];
    const r = matchText(act.value, it.alts, { sentence: true });
    const d = r.ok ? null : diagnose(act.value, it.wrongs, { sentence: true });
    if (r.ok || attempts >= 2) { st.progress[f.id] = k + 1; st.tries[f.id] = 0; }
    return { ...base, type: 'drill', q: it.q, value: act.value, ok: r.ok, attempts, detail: r.ok ? '' : d?.why || textHint(r), misread: d ? `写成了常见的错法${d.why ? `：${d.why}` : ''}` : undefined, closed: false };
  }
  if (ENGINES[f.lang] && f.lang !== 'frames') {
    try { return judgeDemo(st, act, base, attempts); } catch (e) { return { source: 'page', text: `[系统] ${f.id} 判不了：${e.message}` }; }
  }
  if (f.lang === 'answer') {
    const exp = field(f.body, 'answer');
    const vars = answerVars(f.body, boardVars(st));
    const ok = exp ? sameVal(evalExpr(act.value, vars), evalExpr(exp, vars)) : null;
    return { ...base, type: 'answer', title: field(f.body, 'title'), q: field(f.body, 'q'), value: act.value, ok: ok === null ? null : ok, attempts, closed: false };
  }
  // 自由作答（conjecture、thinkbox……）：真的页面把写的字记在 text 上，actionText 照它写；只给 value 时老师看到的是「没写内容」
  return { ...base, type: f.lang, title: field(f.body, 'title'), q: field(f.body, 'q'), value: act.value, text: act.value, ok: null, attempts, closed: false };
}

/* ---------------- 黑板 ---------------- */

function boardForPrompt(st) {
  return {
    segs: st.segs.map((s) => ({ ...s, blocks: fencesOf(s.md).filter((f) => f.id && f.lang !== 'let').map((f) => ({ id: f.id, kind: f.lang, results: st.results[f.id] || [], react: armedText(st.reacts?.[f.id]) || undefined })) })),
    pages: st.pages, cur: st.cur, view: st.cur, screen: { w: 820, h: 1180, board: { w: 780, h: 900 } },
  };
}

function apply(st, text) {
  const { segments, rejected } = parseOutput(text, { final: true });
  const notes = rejected.map((r) => `[系统] 有一个 board 块看不懂：${r.error || r.header || ''}`);
  const talk = segments.filter((s) => s.type === 'speech').map((s) => s.text).join('\n\n').trim();
  let newPage = false;
  const touched = []; // 这一轮新给学生看的段（读的钟用）
  for (const sg of segments.filter((s) => s.type === 'board')) {
    const op = sg.op || {};
    const seg = (id) => st.segs.find((s) => s.id === id);
    const check = (md, id) => {
      for (const f of fencesOf(md)) {
        try { if (f.lang === 'steps') parseSteps(f.body); } catch (e) { notes.push(`[系统] 段 ${id} 里的 steps ${f.id} 写错了：${e.message}`); }
      }
    };
    if (op.op === 'new') { st.cur = st.pages.length + 1; st.pages.push({ n: st.cur, title: op.title || '', talk: '' }); st.segs.push({ id: op.id, page: st.cur, title: op.title || '', md: sg.body }); newPage = true; touched.push(op.id); check(sg.body, op.id); }
    else if (op.op === 'add') { if (!st.pages.length) { st.cur = 1; st.pages.push({ n: 1, title: op.title || '', talk: '' }); } st.segs.push({ id: op.id, page: st.cur, title: op.title || '', md: sg.body, ...(op.hold ? { held: true } : {}) }); touched.push(op.id); check(sg.body, op.id); }
    else if (op.op === 'replace') { const s = seg(op.id); if (s) { s.md = sg.body; if (op.title) s.title = op.title; for (const f of fencesOf(sg.body)) { delete st.progress[f.id]; delete st.results[f.id]; } dropRules(st, op.id); touched.push(op.id); check(sg.body, op.id); } else notes.push(`[系统] replace 的 ${op.id} 不在黑板上`); }
    else if (op.op === 'hide') { const s = seg(op.id); if (s) s.hidden = true; dropRules(st, op.id); }
    else if (op.op === 'show') { const s = seg(op.id); if (s) { s.held = false; s.hidden = false; touched.push(op.id); } else notes.push(`[系统] show 的 ${op.id} 不在黑板上`); }
    else if (op.op === 'react') {
      const at = st.segs.find((s) => !s.hidden && fencesOf(s.md).some((f) => f.id === op.target));
      st.reacts ||= {};
      if (!at) notes.push(`[系统] 指令 react 没执行：黑板上没有组件 ${op.target}`);
      else if (!op.cases.length) delete st.reacts[op.target];
      else st.reacts[op.target] = { target: op.target, seq: st.seq, seg: at.id, cases: op.cases.map((c) => ({ ...c, used: false })) };
    }
    else if (op.op === 'pin') { const s = seg(op.id); if (s) { s.md = sg.body; s.hidden = false; if (op.title) s.title = op.title; } else st.segs.push({ id: op.id, place: 'pin', title: op.title || '', md: sg.body }); touched.push(op.id); }
    else if (op.op === 'unpin') { const s = seg(op.id); if (s) s.hidden = true; }
    st.ops.push(op.op || 'unknown');
  }
  const page = st.pages.find((p) => p.n === st.cur);
  if (page && talk) page.talk = talk;
  // 组件 id → 所在段（学生作答时找）
  st.compAt = {};
  for (const s of st.segs) if (!s.hidden) for (const f of fencesOf(s.md)) if (f.id) st.compAt[f.id] = { seg: { id: s.id }, f };
  return { talk, notes, newPage, touched };
}

// 段被改写、撤回：之前几轮挂在它上面的预案作废（和课堂一样）
function dropRules(st, segId) {
  const m = new Map(Object.entries(st.reacts || {}));
  dropForSeg(m, segId, st.seq);
  st.reacts = Object.fromEntries(m);
}

function viewText(st, talk) {
  const page = st.pages.find((p) => p.n === st.cur);
  // 藏着的段（add … hold）学生看不到
  const here = st.segs.filter((s) => !s.hidden && !s.held && s.place !== 'pin' && s.page === st.cur);
  const pins = st.segs.filter((s) => !s.hidden && s.place === 'pin');
  return [
    `# 第 ${st.cur || 0} 块板${page?.title ? `「${page.title}」` : ''}`,
    `老师写在板顶的话：${talk || page?.talk || '（没说话）'}`,
    ...here.map((s) => studentSeg(s, st)),
    pins.length ? `# 常驻栏\n${pins.map((s) => studentSeg(s, st)).join('\n')}` : '',
    '\n（回复一个 JSON：{"say": "…", "acts": [{"comp": "组件 id", "value": "…"}], "sure": {"组件 id": true/false}}；不会就 {"comp": "…", "giveup": true}）',
  ].filter(Boolean).join('\n\n');
}

/* ---------------- 命令 ---------------- */

const docs = () => componentDocs(read(new URL('../CLAUDE-PROJECT.md', import.meta.url)));

if (cmd === 'init') {
  const sc = JSON.parse(read(arg));
  const bad = checkScenario(sc);
  if (bad.length) { console.error(`场景 ${arg} 不能用：\n${bad.map((b) => `  - ${b}`).join('\n')}`); process.exit(1); }
  const plan = !rest.includes('--no-plan');
  const optArg = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const systemFile = optArg('--system'), memoryFile = optArg('--memory');
  fs.mkdirSync(dir, { recursive: true });
  // 记忆样例：每类是带 id 的数组；块用场景的 block，没有就空（课堂的 memoryArg 是 { mem, block, space, session }）
  const memory = memoryFile ? { mem: JSON.parse(read(memoryFile)), block: sc.block || '', space: sc.space || '', session: '' } : null;
  const system = systemFile ? read(systemFile) : buildSystem({ componentDocs: docs(), pack: sc.pack, board: { segs: [], pages: [], cur: 0 }, subject: sc.subject, tools: false, memory, planDoc: plan, canvas: true });
  fs.writeFileSync(P('system.md'), system);
  fs.copyFileSync(arg, P('scenario.json')); // posttest 命令靠它出题面和答案
  save({ scenario: sc.id, subject: sc.subject, plan, pack: sc.pack, segs: [], pages: [], cur: 0, progress: {}, tries: {}, results: {}, compAt: {}, ops: [], history: [], turns: [], seq: 0, clock: newClock(), minutes: sc.minutes || 40, shown: 0, over: false });
  fs.writeFileSync(P('to-teacher.md'), `${sc.opening || '学生打开了课堂：「老师好，开始吧。」'}`);
  console.log(`开课：${sc.id}（${sc.subject}，计划块${plan ? '开' : '关'}），说明 ${(bytes(system) / 1024).toFixed(1)} KiB`);
} else if (cmd === 'teacher') {
  const st = load();
  // 已经下课了还调用：跑课的脚本漏看了「到时间了」，报错比悄悄多上一轮好查
  if (st.over) { console.error('到时间了，这节课已经结束，老师不能再写'); process.exit(1); }
  const text = read(arg);
  st.seq++;
  st.history.push({ role: 'claude', seq: st.seq, text });
  const r = apply(st, text);
  // 这一轮新给学生看的字（藏着、撤掉的不算）加板顶的话：学生要读完才能往下
  const seen = [...new Set(r.touched)].map((id) => st.segs.find((s) => s.id === id)).filter((s) => s && !s.hidden && !s.held);
  const read_ = seen.reduce((a, s) => a + shownChars(studentSeg(s, st)), 0) + shownChars(r.talk);
  st.clock = tick(st.clock, { read: read_, wait: true });
  st.shown = (st.shown || 0) + read_;
  const teacherTurns = st.turns.filter((t) => t.role === 'teacher').length + 1;
  if (timeUp(st.clock, st.minutes) || teacherTurns >= 40) st.over = true;
  const view = viewText(st, r.talk);
  fs.writeFileSync(P('view.md'), view);
  st.turns.push({ seq: st.seq, role: 'teacher', bytes: bytes(text), talk: r.talk, ops: st.ops.slice(), notes: r.notes, plan: /board[ \t]+plan/i.test(text), view });
  st.pendingNotes = r.notes;
  st.ops = [];
  save(st);
  console.log(`第 ${st.seq} 轮老师：${bytes(text)} 字节，话 ${r.talk.length} 字，指令 ${st.turns.at(-1).ops.join(' ') || '无'}${r.notes.length ? `，${r.notes.length} 条提醒` : ''}，课上过了 ${(st.clock.s / 60).toFixed(1)} / ${st.minutes} 分钟${st.over ? '\n到时间了' : ''}`);
} else if (cmd === 'student') {
  const st = load();
  if (st.over) { console.error('到时间了，这节课已经结束，学生不能再答'); process.exit(1); }
  let s;
  try { s = JSON.parse(read(arg).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { console.error('学生的回复不是 JSON：', e.message); process.exit(1); }
  st.seq++;
  const acts = [];
  for (const a of s.acts || []) {
    const rec = judge(st, a);
    acts.push(rec);
    if (rec.block) (st.results[rec.block] ||= []).push(rec);
  }
  for (const [comp, sure] of Object.entries(s.sure || {})) {
    const last = (st.results[comp] || []).at(-1);
    const ev = { source: 'event', type: 'sure', block: comp, step: st.compAt[comp]?.seg.id, sure: !!sure, ok: last?.ok ?? null };
    acts.push(ev);
  }
  const say = String(s.say || '').trim();
  // 钟：作答（点选 10 秒、写的按行）和说话；没有 block 的（sure、页面的系统行）不占时间
  st.clock = tick(st.clock, { acts: acts.filter((a) => a.block && a.type !== 'sure'), say });
  if (s.note) fs.appendFileSync(P('notebook.md'), `## 第 ${st.seq} 轮\n${String(s.note).trim()}\n\n`);
  // 预案：页面能自己接就不调用老师（trig 和课堂一样：有把握的标记跟着下一条走；答对了却没把握要叫老师）
  const items = acts.map((a) => ({ a, trig: a.type === 'sure' ? (a.sure === false && a.ok === true ? 'soon' : 'later') : 'soon' }));
  const rules = new Map(Object.entries(st.reacts || {}));
  const held = new Set(st.segs.filter((x) => x.held || x.hidden).map((x) => x.id));
  const local = planLocal({ items, rules, other: !!say, present: (id) => !!st.compAt[id] && !held.has(st.compAt[id].seg.id) });
  if (local) {
    markFired(rules, local);
    st.reacts = Object.fromEntries(rules);
    for (const id of local.show) { const x = st.segs.find((g) => g.id === id); if (x) { x.held = false; x.hidden = false; } }
    const page = st.pages.find((p) => p.n === st.cur);
    if (page && local.talk) page.talk = local.talk;
    const am = actionsMessage(acts);
    const note = reactNote(local);
    st.history.push({ role: 'student', seq: st.seq, text: am }, { role: 'system', seq: st.seq, text: note });
    (st.localMsgs ||= []).push(am, note);
    const view = viewText(st, local.talk);
    // 页面接的这一手揭开的段、写在板顶的话，学生也要读
    const read_ = shownChars(local.talk) + local.show.reduce((a, id) => { const x = st.segs.find((g) => g.id === id); return a + (x ? shownChars(studentSeg(x, st)) : 0); }, 0);
    st.clock = tick(st.clock, { read: read_ });
    st.shown = (st.shown || 0) + read_;
    // 连着几轮被预案接住时老师一直不跑，只在老师那一轮判的话钟会走过头也不下课
    if (timeUp(st.clock, st.minutes)) st.over = true;
    fs.writeFileSync(P('view.md'), view);
    st.turns.push({ seq: st.seq, role: 'student', say, acts: acts.map((a) => ({ comp: a.block, ok: a.ok, type: a.type })), msg: am, local: true }, { seq: st.seq, role: 'page', talk: local.talk, note, view });
    save(st);
    console.log(`第 ${st.seq} 轮学生：${acts.map((a) => (a.block ? `${a.block}${a.ok === true ? '✓' : a.ok === false ? '✗' : '·'}` : a.type || '')).join(' ')}——页面按预案接了（没调用老师）：学生接着看 view.md${st.over ? '\n到时间了' : ''}`);
    process.exit(0);
  }
  // 前面几轮页面按预案接过的，跟着这一次发给老师
  const msg = [...(st.localMsgs || []), say, actionsMessage(acts), ...(st.pendingNotes || [])].filter(Boolean).join('\n') || '（学生没有说话，也没有作答）';
  st.localMsgs = [];
  if (timeUp(st.clock, st.minutes)) st.over = true;
  st.history.push({ role: 'student', seq: st.seq, text: msg });
  st.turns.push({ seq: st.seq, role: 'student', say, acts: acts.map((a) => ({ comp: a.block, ok: a.ok, type: a.type })), msg });
  st.pendingNotes = [];
  const state = `${st.plan ? `${planText(latestPlan(st.history))}\n\n` : ''}${boardStateText(boardForPrompt(st))}`;
  fs.writeFileSync(P('to-teacher.md'), `【页面这一轮发给你的】\n\n# 黑板现状（最新，替换说明里那份）\n\n${state}\n\n# 学生\n\n${msg}\n`);
  save(st);
  console.log(`第 ${st.seq} 轮学生：${acts.map((a) => (a.block ? `${a.block}${a.ok === true ? '✓' : a.ok === false ? '✗' : '·'}` : a.type || '')).join(' ') || '没作答'}${say ? `，说「${say.slice(0, 30)}」` : ''}${st.over ? '\n到时间了' : ''}`);
} else if (cmd === 'transcript') {
  const st = load();
  const out = [`# 模拟课 ${st.scenario}（${st.subject}，计划块${st.plan ? '开' : '关'}）`];
  for (const t of st.turns) {
    if (t.role === 'teacher') out.push(`## 第 ${t.seq} 轮 · 老师\n\n${st.history.find((h) => h.seq === t.seq)?.text || ''}\n\n### 学生看到的\n\n${t.view}`);
    else if (t.role === 'page') out.push(`## 第 ${t.seq} 轮 · 页面按预案接（没调用老师）\n\n${t.note}\n\n### 学生看到的\n\n${t.view}`);
    else out.push(`## 第 ${t.seq} 轮 · 学生\n\n${t.msg}`);
  }
  fs.writeFileSync(P('transcript.md'), out.join('\n\n'));
  console.log(`写了 ${P('transcript.md')}`);
} else if (cmd === 'posttest') {
  const sc = JSON.parse(read(path.join(dir, 'scenario.json')));
  const tests = sc.posttest;
  const aimOf = (id) => sc.aims.find((a) => a.id === id);
  fs.writeFileSync(P('posttest.md'), `# 课后测验\n\n${tests.map((p) => `## ${p.id}\n${p.q}`).join('\n\n')}\n`);
  fs.writeFileSync(P('posttest-key.md'), `# 课后测验标准答案（只给评卷人）\n\n${tests.map((p) => `## ${p.id}（${p.kind}）\n题面：${p.q}\n答案：${p.answer}\n考的是：${aimOf(p.aim)?.can || p.aim}（怎样算会：${aimOf(p.aim)?.proof || ''}）`).join('\n\n')}\n`);
  console.log(`写了 ${P('posttest.md')} 和 ${P('posttest-key.md')}（${tests.length} 道）`);
} else if (cmd === 'score') {
  const rows = [];
  for (const d of [dir, arg, ...rest].filter(Boolean)) {
    const st = JSON.parse(read(path.join(d, 'state.json')));
    const T = st.turns.filter((t) => t.role === 'teacher');
    const S = st.turns.filter((t) => t.role === 'student');
    const judged = S.flatMap((t) => t.acts).filter((a) => a.ok === true || a.ok === false);
    const interactive = T.filter((t) => /```(?:steps|quiz|answer|practice|predict|scene|recognize|cloze|errfind|parse|drill)/.test(st.history.find((h) => h.seq === t.seq)?.text || '')).length;
    rows.push({
      run: path.basename(d), scenario: st.scenario, plan: st.plan, teacherTurns: T.length,
      avgOutBytes: Math.round(T.reduce((a, t) => a + t.bytes, 0) / Math.max(1, T.length)),
      avgTalkChars: Math.round(T.reduce((a, t) => a + t.talk.length, 0) / Math.max(1, T.length)),
      planWrites: T.filter((t) => t.plan).length, boards: T.reduce((a, t) => a + t.ops.filter((o) => o === 'new').length, 0),
      turnsWithTask: interactive, studentActs: judged.length, studentRight: judged.filter((a) => a.ok).length,
      notes: T.reduce((a, t) => a + t.notes.length, 0),
      // 页面按预案接了几轮（每一轮本来都是一次调用）
      localTurns: st.turns.filter((t) => t.role === 'page').length,
      ...(st.clock ? lessonMetrics(st) : {}),
    });
  }
  console.log(JSON.stringify(rows, null, 1));
} else {
  console.log('用法见文件开头');
}

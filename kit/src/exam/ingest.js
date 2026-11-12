// 真题、解析册、大纲的转写格式和切法（docs/exam-plan.md 第二节；格式写在 docs/superpowers/specs/2026-11-12-exam-1-design.md 2.5）。
// 转写由 Claude Code 的转写助手照这个格式写，tools/exam.mjs 用这里的函数切成一道一道、拼成一卷。
// 和教材的「=== 第 N 页」同一个风格，但不加进教材的条目类型（加了所有书的转写提示词都会变）。
// 纯函数，有测试（tests/exam-ingest.test.js）。
import { typeKey } from './taxonomy.js';
import { courseHint, checkPaper } from './structure.js';
import { examSpaceOf } from './schema.js';
import { applyVerify } from './verify.js';

const PAGE = /^===\s*第\s*(\d+)\s*页\s*$/;
const QHEAD = /^---\s*题\s*(\d{1,2})\s*\|\s*([^|]+?)\s*\|\s*([\d.]+)\s*(?:\|\s*篇\s*(\S+))?\s*$/;
const PHEAD = /^---\s*篇\s*([A-Za-z0-9]+)\s*\|\s*([^|]+?)\s*$/;
const AHEAD = /^---\s*答\s*(\d{1,2})\s*$/;
const OPTION = /^([A-D])[.．、]\s*(.*)$/;
const CHECK = /【\s*check\s*[:：]\s*([^|｜】]+?)\s*(?:[|｜]\s*([^】]+?))?\s*】/;
// 「r = 7 0 1 2 ; p = 3」→ { r: [7, 0, 1, 2], p: 3 }
function parseVars(s) {
  const out = {};
  for (const part of String(s).split(/[;；]/)) {
    const m = part.match(/^\s*([A-Za-z]\w*)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const xs = m[2].split(/[\s,，]+/).map(Number);
    out[m[1]] = xs.length === 1 ? xs[0] : xs;
  }
  return out;
}
const trimLines = (ls) => ls.join('\n').replace(/^\s+|\s+$/g, '');

/**
 * 一卷的转写 → { questions: [{ n, type, points, stem, options, pages, passage }], passages: [{ key, kind, text, pages }], problems }。
 * 下一页开头不写新的「--- 题」就接在上一题（或上一篇）后面
 */
export function splitPaper(text) {
  const questions = [];
  const passages = [];
  const problems = [];
  let page = 0;
  let cur = null; // 正在写的题或篇：{ kind: 'q' | 'p', obj, lines }
  let stray = false;
  const seen = new Set();
  const close = () => {
    if (!cur) return;
    if (cur.kind === 'p') cur.obj.text = trimLines(cur.lines);
    else {
      // 验算的式子写在题面里：【check: faults(r, 3, lru) | r = 7 0 1 2 0 3】（转写的时候照题面写，verify.js 算），从题面里拿掉
      let stem = trimLines(cur.lines);
      const cm = stem.match(CHECK);
      if (cm) { cur.obj.check = { expr: cm[1].trim(), ...(cm[2] ? { vars: parseVars(cm[2]) } : {}) }; stem = stem.replace(CHECK, '').replace(/^\s+|\s+$/g, ''); }
      cur.obj.stem = stem;
    }
    cur = null;
  };
  const touch = () => { if (cur && page && !cur.obj.pages.includes(page)) cur.obj.pages.push(page); };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const pm = line.match(PAGE);
    if (pm) { page = Number(pm[1]); continue; }
    const qm = line.match(QHEAD);
    if (qm) {
      close();
      const n = Number(qm[1]);
      const type = typeKey(qm[2]);
      if (!type) problems.push(`第 ${n} 题的题型「${qm[2]}」认不得`);
      if (seen.has(n)) problems.push(`第 ${n} 题出现了两次`);
      seen.add(n);
      const obj = { n, type, points: Number(qm[3]), stem: '', options: {}, pages: [], passage: qm[4] || '' };
      questions.push(obj);
      cur = { kind: 'q', obj, lines: [], lastOpt: '' };
      touch();
      continue;
    }
    const ph = line.match(PHEAD);
    if (ph) {
      close();
      const obj = { key: ph[1], kind: typeKey(ph[2]) || ph[2], text: '', pages: [] };
      passages.push(obj);
      cur = { kind: 'p', obj, lines: [] };
      touch();
      continue;
    }
    if (!cur) { if (line.trim()) stray = true; continue; }
    if (!line.trim() && !cur.lines.length) continue;
    touch();
    const om = cur.kind === 'q' ? line.match(OPTION) : null;
    if (om) { cur.obj.options[om[1]] = om[2].trim(); cur.lastOpt = om[1]; continue; }
    // 选项后面接着的一行（选项太长换了行）接在那个选项后面；还没有选项的是题面
    if (cur.kind === 'q' && cur.lastOpt && line.trim()) { cur.obj.options[cur.lastOpt] += ` ${line.trim()}`; continue; }
    cur.lines.push(line);
  }
  close();
  if (stray) problems.push('第一题前面有不认得的字（每道题要以「--- 题 N | 题型 | 分值」开头）');
  for (const q of questions) if (!Object.keys(q.options).length) delete q.options;
  return { questions, passages, problems };
}

/** 解析册 → { answers: Map<n, { answer, analysis }>, problems }。「答案：」那一行可以没有（综合题），整段都是解析 */
export function splitAnswers(text) {
  const answers = new Map();
  const problems = [];
  let cur = null;
  const close = () => { if (cur) answers.set(cur.n, { answer: cur.answer, analysis: trimLines(cur.lines) }); cur = null; };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (PAGE.test(line)) continue;
    const am = line.match(AHEAD);
    if (am) {
      close();
      const n = Number(am[1]);
      if (answers.has(n)) problems.push(`解析册里第 ${n} 题出现了两次`);
      cur = { n, answer: '', lines: [] };
      continue;
    }
    if (!cur) continue;
    const ans = !cur.answer && !cur.lines.some((l) => l.trim()) ? line.match(/^\s*答案[：:]\s*(.+?)\s*$/) : null;
    if (ans) { cur.answer = ans[1]; continue; }
    cur.lines.push(line);
  }
  close();
  return { answers, problems };
}

/**
 * 一卷拼好：{ paper, questions, passages, problems, notes }。题号、空间、门课（408 先照结构表的草稿）、答案、解析、
 * verified（只照书：引擎验算在第 2 批加）；再和结构表比（checkPaper）。有 problems 的卷 tools/exam.mjs check 不放行
 */
export function buildPaper({ subject, year, paperText, answersText, source = '' }) {
  const subj = String(subject);
  const y = Number(year);
  const sp = splitPaper(paperText);
  const sa = splitAnswers(answersText);
  const problems = [...sp.problems, ...sa.problems];
  const notes = [];
  const paperId = `X-${subj}-${y}`;
  const space = examSpaceOf({ id: paperId });
  const passages = sp.passages.map((p) => ({ id: `PA-${subj}-${y}-${p.key}`, paper: paperId, kind: p.kind, text: p.text, pages: p.pages, space, course: courseHint(subj, y, 0) || '', year: y }));
  const keys = new Set(sp.passages.map((p) => p.key));
  const questionsRaw = sp.questions.sort((a, b) => a.n - b.n).map((q) => {
    const a = sa.answers.get(q.n);
    if (!a) problems.push(`第 ${q.n} 题在解析册里没有答案`);
    if (q.passage && !keys.has(q.passage)) problems.push(`第 ${q.n} 题挂的篇 ${q.passage} 在卷子里没有`);
    const course = courseHint(subj, y, q.n);
    const out = {
      id: `Q-${subj}-${y}-${q.n}`, paper: paperId, year: y, n: q.n, type: q.type, points: q.points, stem: q.stem,
      ...(q.options ? { options: q.options } : {}), answer: a?.answer || '', analysis: a?.analysis || '', pages: q.pages,
      ...(q.passage ? { passage: `PA-${subj}-${y}-${q.passage}` } : {}), ...(q.check ? { check: q.check } : {}), space, course, verified: { how: 'book' },
    };
    return out;
  });
  // 能算的再算一遍（verify.js）：对不上的不进库，列出来给我看
  const ver = applyVerify(questionsRaw);
  questionsRaw.splice(0, questionsRaw.length, ...ver.questions);
  for (const m of ver.mismatched) problems.push(`${m.id}：答案是 ${m.answer}，算出来是 ${m.got}（对一下解析册和转写）`);
  for (const q of questionsRaw) if (q.verified?.how === 'none') problems.push(`${q.id}：验算的式子算不出来：${q.verified.why}`);
  if (subj === '301') notes.push('数学一的门课是先猜的（都写高数）：打了标签以后照主考点改');
  const questions = questionsRaw;
  const total = questions.reduce((n, q) => n + Number(q.points || 0), 0);
  const paper = { id: paperId, subject: subj, year: y, space, total, count: questions.length, ...(source ? { source } : {}) };
  const cp = checkPaper(paper, questions);
  problems.push(...cp.problems);
  notes.push(...cp.notes);
  return { paper, questions, passages, problems, notes };
}

const LEVELS = ['了解', '理解', '掌握', '会用'];
const NUMBERING = /^(?:[一二三四五六七八九十]+[、.．]|（[一二三四五六七八九十\d]+）|\(\d+\)|\d+[.．、])\s*/;

/**
 * 大纲 → 考点树：「#」是 G-DS-1、「##」是 G-DS-1.1、「###」是 G-DS-1.1.1；「-」开头的行是上一节点的大纲原文，
 * 第一句开头是「了解 / 理解 / 掌握 / 会用」时记成 level。返回 { nodes, problems }
 */
export function parseSyllabus(text, { course, year }) {
  const nodes = [];
  const problems = [];
  const space = examSpaceOf({ course });
  const count = [0, 0, 0];
  const stack = []; // 每一层现在是哪个节点
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const hm = line.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      const depth = hm[1].length - 1;
      if (depth > 0 && !stack[depth - 1]) { problems.push(`「${line}」没有上一层`); continue; }
      count[depth]++;
      for (let d = depth + 1; d < 3; d++) count[d] = 0;
      stack.length = depth;
      const id = `G-${course}-${count.slice(0, depth + 1).join('.')}`;
      const title = hm[2].replace(NUMBERING, '').trim();
      const node = { id, course, space, title, path: [...stack.map((n) => n.title), title], parent: depth ? stack[depth - 1].id : '', level: '', text: '', year: Number(year) };
      stack[depth] = node;
      nodes.push(node);
      continue;
    }
    const tm = line.match(/^[-*]\s+(.+)$/);
    const node = stack.at(-1);
    if (!node) { problems.push(`「${line}」前面还没有标题`); continue; }
    const body = tm ? tm[1] : line;
    if (!node.text) node.level = LEVELS.find((l) => body.startsWith(l)) || '';
    node.text = node.text ? `${node.text}\n${body}` : body;
  }
  return { nodes, problems };
}

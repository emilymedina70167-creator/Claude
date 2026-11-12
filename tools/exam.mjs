#!/usr/bin/env node
// 真题入库（docs/exam-plan.md 第二节；转写格式见 docs/superpowers/specs/2026-11-12-exam-1-design.md 2.5）。
// 真题和解析的 PDF 只放在我的私有仓库里，不存成学习台的书（存成书会被当成教材带进课堂）。这边：
//   1. 转写：照教材那一套画页、裁白边（tools/books.mjs render），转写助手看图照真题的格式写成「真题.txt」「解析.txt」，大纲写成「大纲.txt」
//   2. node tools/exam.mjs split --subject 408 --year 2019 --paper 真题.txt --answers 解析.txt --out 目录 [--source 私有仓库里的路径]
//      → 目录/X-408-2019.json：{ paper, questions, passages, problems, notes }；切出来和结构表对不上的打印出来、退出码 1
//   3. node tools/exam.mjs syllabus --course DS --year 2026 --text 大纲.txt --out 目录
//      → 目录/syllabus-DS-2026.json：{ course, year, nodes, problems }
//   4. node tools/exam.mjs check 目录
//      → 每个文件过一遍规矩（exam/schema.js）、结构表（structure.js）、标签（taxonomy.js，有 tags 时）；打印每卷几题几分、对不上的地方
//   5. node tools/exam.mjs apply 目录 --out 收件箱目录 [--by dev]
//      → 先 check（不过就停）；每个文件一条收件箱记录 收件箱目录/*.json，照学习台同一个 planInbox 预演一遍会不会收；
//        batches.json 是 ArtifactData batch 的 writes（一批 ≤ 50 条、≤ 900 KiB），照它一批批写进 exam_inbox。
//      学习台打开时（exam/examdesk.js）查过再并进 papers / questions / passages / syllabus，回执在 exam_inbox_log/{同号}。
import fs from 'node:fs';
import path from 'node:path';
import { buildPaper, parseSyllabus } from '../kit/src/exam/ingest.js';
import { validateExam } from '../kit/src/exam/schema.js';
import { checkPaper } from '../kit/src/exam/structure.js';
import { checkTags } from '../kit/src/exam/taxonomy.js';
import { planInbox } from '../kit/src/exam/inbox.js';
import { restoreBatches, BACKUP_FORMAT, BACKUP_VERSION } from '../kit/src/memory/backup.js';

const [cmd, ...rest] = process.argv.slice(2);
const opt = { _: [] };
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) opt[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[++i];
  else opt._.push(rest[i]);
}
const need = (k) => { if (!opt[k] || opt[k] === true) { console.error(`要写 --${k}`); process.exit(2); } return opt[k]; };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify(x, null, 1)}\n`); };
const files = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'batches.json').map((f) => path.join(dir, f)).sort();
const strip = ({ id: _, ...d }) => d;

function split() {
  const subject = need('subject'), year = Number(need('year')), out = need('out');
  const r = buildPaper({ subject, year, paperText: fs.readFileSync(need('paper'), 'utf8'), answersText: fs.readFileSync(need('answers'), 'utf8'), source: opt.source === true ? '' : opt.source || '' });
  const f = path.join(out, `${r.paper.id}.json`);
  writeJson(f, r);
  console.log(`${r.paper.id}：${r.questions.length} 题 ${r.paper.total} 分 → ${f}`);
  for (const n of r.notes) console.log(`  提醒：${n}`);
  for (const p of r.problems) console.log(`  ✗ ${p}`);
  process.exit(r.problems.length ? 1 : 0);
}

function syllabus() {
  const course = need('course'), year = Number(need('year')), out = need('out');
  const r = parseSyllabus(fs.readFileSync(need('text'), 'utf8'), { course, year });
  const f = path.join(out, `syllabus-${course}-${year}.json`);
  writeJson(f, { course, year, ...r });
  console.log(`${course} ${year}：${r.nodes.length} 个考点 → ${f}`);
  for (const p of r.problems) console.log(`  ✗ ${p}`);
  process.exit(r.problems.length ? 1 : 0);
}

/** 查一个目录：返回 { bad（有问题的条数）, items: [{ file, kind, rec }] } */
function checkDir(dir) {
  const items = [];
  let bad = 0;
  const list = files(dir).map((f) => ({ f, j: readJson(f) }));
  const sylIds = new Set(list.filter((x) => x.j.nodes).flatMap((x) => x.j.nodes.map((n) => n.id)));
  for (const { f, j } of list) {
    const name = path.basename(f);
    if (j.paper) {
      const problems = [
        ...validateExam('papers', j.paper.id, strip(j.paper)),
        ...j.questions.flatMap((q) => validateExam('questions', q.id, strip(q))),
        ...(j.passages || []).flatMap((x) => validateExam('passages', x.id, strip(x))),
        ...checkPaper(j.paper, j.questions).problems,
        ...(sylIds.size ? j.questions.filter((q) => q.tags).flatMap((q) => checkTags(q.tags, { course: q.course, syllabusIds: sylIds }).map((m) => `${q.id}：${m}`)) : []),
      ];
      console.log(`${j.paper.id}：${j.questions.length} 题 ${j.questions.reduce((n, q) => n + Number(q.points || 0), 0)} 分${j.passages?.length ? `，${j.passages.length} 篇` : ''}`);
      for (const p of problems) console.log(`  ✗ ${p}`);
      bad += problems.length;
      items.push({ file: name, rec: { kind: 'paper', paper: j.paper, questions: j.questions, passages: j.passages || [] } });
    } else if (j.nodes) {
      const problems = [...(j.problems || []), ...j.nodes.flatMap((n) => validateExam('syllabus', n.id, strip(n)))];
      console.log(`${j.course} ${j.year}：${j.nodes.length} 个考点`);
      for (const p of problems) console.log(`  ✗ ${p}`);
      bad += problems.length;
      items.push({ file: name, rec: { kind: 'syllabus', course: j.course, year: j.year, nodes: j.nodes } });
    } else console.log(`${name}：不认得（不是 split 或 syllabus 写的），跳过`);
  }
  return { bad, items };
}

function check() {
  const dir = opt._[0] || need('dir');
  const { bad } = checkDir(dir);
  console.log(bad ? `\n${bad} 处不对：改好转写再切一遍。` : '\n都对得上。');
  process.exit(bad ? 1 : 0);
}

function apply() {
  const dir = opt._[0] || need('dir');
  const out = need('out');
  const by = opt.by === true || !opt.by ? 'dev' : opt.by;
  const { bad, items } = checkDir(dir);
  if (bad) { console.log(`\n${bad} 处不对，不写收件箱。`); process.exit(1); }
  const docs = [];
  for (const { file, rec } of items) {
    const id = file.replace(/\.json$/, '');
    const r = { ...rec, by, at: Date.now() };
    const pre = planInbox(r, { have: new Map() });
    if (!pre.log.ok) { console.log(`  ✗ ${id}：学习台不会收：${pre.log.problems.join('；')}`); process.exit(1); }
    writeJson(path.join(out, `${id}.json`), r);
    docs.push({ collection: 'exam_inbox', doc_id: id, data: r });
  }
  const batches = restoreBatches({ format: BACKUP_FORMAT, v: BACKUP_VERSION, docs });
  writeJson(path.join(out, 'batches.json'), batches);
  console.log(`\n${docs.length} 条收件箱记录，${batches.length} 批 → ${path.join(out, 'batches.json')}（照它用 ArtifactData batch 写进 exam_inbox）`);
}

const CMDS = { split, syllabus, check, apply };
if (!CMDS[cmd]) { console.error('用法：node tools/exam.mjs split | syllabus | check | apply …（见文件开头）'); process.exit(2); }
CMDS[cmd]();

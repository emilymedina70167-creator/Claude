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
//   打标签（split 和 apply 之间）：
//   a. node tools/exam.mjs tagprep 目录 --syllabus 考点目录 --course DS [--curriculum 课程地图.json] --out 打标签目录 [--per 12]
//      → 每批 bNNN.prompt.txt（同一份交给两个互不知道的助手，各写 bNNN.a.txt、bNNN.b.txt）、bNNN.json（这批的题号）
//   b. node tools/exam.mjs tagmerge 打标签目录 → 主考点一致率（≥ 90% 才合格）、merged.json、conflicts.prompt.txt（交第三个助手，写 conflicts.out.txt）
//   c. node tools/exam.mjs tagapply 打标签目录 目录 → 定下来的标签写进每道题（门课照主考点改），再 check 一遍
//   做成练习（打完标签以后，apply 之前）：
//   d. node tools/exam.mjs drills 目录 [--reserve 2024,2025,2026] → 每卷 drills-X-….json；每道都在两种 iPad 尺寸下画一遍
//      （tools/check-lesson.mjs，要先 npm run build），有写法错误的不收；apply 时一起写成 kind: drills 的收件箱记录
//   抽查：node tools/exam.mjs sample 目录 [--n 20] → 随机 n 道，一行「题号｜主考点｜考法｜坑」（给我看，我说不对的改了以后整批同类再查）
//   补章：node tools/exam.mjs skeleton 考点目录 --course CO --curriculum 课程地图.json → 课程地图缺的章（ArtifactData batch 的 writes，开发那边写）
import fs from 'node:fs';
import path from 'node:path';
import { buildPaper, parseSyllabus } from '../kit/src/exam/ingest.js';
import { validateExam } from '../kit/src/exam/schema.js';
import { checkPaper } from '../kit/src/exam/structure.js';
import { checkTags } from '../kit/src/exam/taxonomy.js';
import { planInbox, courseOfTags } from '../kit/src/exam/inbox.js';
import { drillOf } from '../kit/src/exam/drillgen.js';
import { skeleton as skeletonOf } from '../kit/src/exam/skeleton.js';
import { HOW } from '../kit/src/exam/taxonomy.js';
import { reserveYears } from '../kit/src/exam/reserve.js';
import { toDate } from '../kit/src/memory/schema.js';
import { execFileSync } from 'node:child_process';
import { tagPrompt, parseTags, mergeTags, settlePrompt, settle, AGREE_MIN } from '../kit/src/exam/tagging.js';
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
function checkDir(dir, extraNodes = []) {
  const items = [];
  let bad = 0;
  const list = files(dir).map((f) => ({ f, j: readJson(f) }));
  const sylIds = new Set([...list.filter((x) => x.j.nodes).flatMap((x) => x.j.nodes.map((n) => n.id)), ...extraNodes.map((n) => n.id)]);
  for (const { f, j } of list) {
    const name = path.basename(f);
    if (j.paper && Array.isArray(j.questions)) {
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
    } else if (j.drills) {
      const pre = planInbox({ kind: 'drills', drills: j.drills, by: 'dev' }, { have: new Map() });
      const problems = j.drills.length ? pre.log.problems : [];
      console.log(`${j.paper || name}：${j.drills.length} 道练习`);
      for (const p of problems) console.log(`  ✗ ${p}`);
      bad += problems.length;
      if (j.drills.length) items.push({ file: name, rec: { kind: 'drills', drills: j.drills } });
    } else console.log(`${name}：不认得（不是 split、syllabus、drills 写的），跳过`);
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


const papersIn = (dir) => files(dir).map((f) => ({ f, j: readJson(f) })).filter((x) => x.j.paper && Array.isArray(x.j.questions));
const nodesIn = (dir) => files(dir).map(readJson).filter((j) => j.nodes).flatMap((j) => j.nodes);

function tagprep() {
  const dir = opt._[0] || need('dir');
  const out = need('out');
  const course = need('course');
  const per = Number(opt.per && opt.per !== true ? opt.per : 12);
  const syllabus = nodesIn(need('syllabus')).filter((n) => n.course === course);
  if (!syllabus.length) { console.error(`--syllabus 里没有 ${course} 的考点`); process.exit(1); }
  const curriculum = opt.curriculum && opt.curriculum !== true ? readJson(opt.curriculum) : [];
  const qs = papersIn(dir).flatMap((x) => x.j.questions).filter((q) => q.course === course);
  fs.mkdirSync(out, { recursive: true });
  writeJson(path.join(out, 'meta.json'), { dir: path.resolve(dir), syllabus: path.resolve(opt.syllabus), course });
  let k = 0;
  for (let i = 0; i < qs.length; i += per) {
    const b = `b${String(++k).padStart(3, '0')}`;
    const part = qs.slice(i, i + per);
    fs.writeFileSync(path.join(out, `${b}.prompt.txt`), tagPrompt({ questions: part, syllabus, curriculum, course }));
    writeJson(path.join(out, `${b}.json`), { ids: part.map((q) => q.id), course });
  }
  console.log(`${course}：${qs.length} 道题，${k} 批 → ${out}（每批交给两个互不知道的助手，各写 bNNN.a.txt / bNNN.b.txt）`);
}

function tagmerge() {
  const tg = opt._[0] || need('dir');
  const meta = readJson(path.join(tg, 'meta.json'));
  const batches = fs.readdirSync(tg).filter((f) => /^b\d{3}\.json$/.test(f)).sort();
  const all = { agreed: {}, conflicts: [] };
  let problems = 0;
  for (const b of batches) {
    const { ids, course } = readJson(path.join(tg, b));
    const base = b.replace(/\.json$/, '');
    const side = (x) => { const f = path.join(tg, `${base}.${x}.txt`); if (!fs.existsSync(f)) { console.log(`  ✗ ${base}.${x}.txt 还没有`); problems++; return {}; } const r = parseTags(fs.readFileSync(f, 'utf8'), { ids, course }); for (const p of r.problems) console.log(`  ${base}.${x}：${p}`); return r.tags; };
    const r = mergeTags(side('a'), side('b'));
    Object.assign(all.agreed, r.agreed);
    all.conflicts.push(...r.conflicts);
    console.log(`${base}：主考点一致率 ${(r.rate * 100).toFixed(0)}%（${Object.keys(r.agreed).length} / ${Object.keys(r.agreed).length + r.conflicts.length}）${r.rate < AGREE_MIN ? ' ✗ 这批不合格：先改说明、改词表再重打' : ''}`);
  }
  const n = Object.keys(all.agreed).length + all.conflicts.length;
  const rate = n ? Object.keys(all.agreed).length / n : 1;
  console.log(`\n合起来一致率 ${(rate * 100).toFixed(1)}%，${all.conflicts.length} 道要第三个人定${rate < AGREE_MIN ? '（不到 90%：这一门课的说明、词表要改）' : ''}`);
  writeJson(path.join(tg, 'merged.json'), { ...all, rate });
  if (all.conflicts.length) {
    const qs = papersIn(meta.dir).flatMap((x) => x.j.questions);
    const syllabus = nodesIn(meta.syllabus).filter((x) => x.course === meta.course);
    fs.writeFileSync(path.join(tg, 'conflicts.prompt.txt'), settlePrompt({ conflicts: all.conflicts, questions: qs, syllabus, course: meta.course }));
    console.log(`→ ${path.join(tg, 'conflicts.prompt.txt')}（交第三个助手，写 conflicts.out.txt）`);
  }
  process.exit(problems ? 1 : 0);
}

function tagapply() {
  const [tg, dir] = opt._;
  if (!tg || !dir) { console.error('用法：tagapply 打标签目录 目录'); process.exit(2); }
  const meta = readJson(path.join(tg, 'meta.json'));
  const m = readJson(path.join(tg, 'merged.json'));
  const third = fs.existsSync(path.join(tg, 'conflicts.out.txt')) ? settle(m.conflicts, fs.readFileSync(path.join(tg, 'conflicts.out.txt'), 'utf8'), { course: meta.course }) : {};
  const left = m.conflicts.filter((c) => !third[c.id]).map((c) => c.id);
  if (left.length) console.log(`还有 ${left.length} 道没定：${left.slice(0, 10).join('、')}${left.length > 10 ? '…' : ''}（这几道不写标签）`);
  const tags = { ...m.agreed, ...third };
  let n = 0;
  for (const { f, j } of papersIn(dir)) {
    let touched = false;
    for (const q of j.questions) {
      if (!tags[q.id]) continue;
      q.tags = tags[q.id];
      q.course = courseOfTags(q.tags) || q.course;
      touched = true;
      n++;
    }
    if (touched) writeJson(f, j);
  }
  console.log(`写了 ${n} 道题的标签。\n`);
  const { bad } = checkDir(dir, nodesIn(meta.syllabus));
  process.exit(bad ? 1 : 0);
}

function drills() {
  const dir = opt._[0] || need('dir');
  const years = opt.reserve && opt.reserve !== true ? String(opt.reserve).split(/[,，\s]+/).map(Number) : reserveYears(null, toDate(Date.now()));
  const tmp = path.join(dir, '.drills-check');
  for (const { j } of papersIn(dir)) {
    const passages = new Map((j.passages || []).map((p) => [p.id, p]));
    let list = j.questions.map((q) => drillOf(q, { years, passage: passages.get(q.passage) })).filter(Boolean);
    if (!opt['no-render'] && list.length) {
      // 每道一个课件，check-lesson 一次画完（两种 iPad 尺寸）；有「✗」的那几道不收
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      for (const d of list) fs.writeFileSync(path.join(tmp, `${d.id}.md`), `---\nmode: guided\nunit: ${d.title}\n---\n\n## ${d.title}\n\n${d.md}\n`);
      let outText = '';
      try { outText = execFileSync('node', [path.join(path.dirname(new URL(import.meta.url).pathname), 'check-lesson.mjs'), ...list.map((d) => path.join(tmp, `${d.id}.md`))], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { outText = String(e.stdout || ''); }
      const bad = new Set([...outText.matchAll(/^✗ \S*\/(d-q-[\w-]+)\.md/gm)].map((m) => m[1]));
      for (const id of bad) console.log(`  ✗ ${id}：画出来有写法错误，不收（${outText.split('\n').find((l, i, a) => a[i - 1]?.includes(id) && /^\s+/.test(l))?.trim() || ''}）`);
      list = list.filter((d) => !bad.has(d.id));
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    writeJson(path.join(dir, `drills-${j.paper.id}.json`), { paper: j.paper.id, drills: list });
    console.log(`${j.paper.id}：${list.length} 道能做成练习${years.includes(j.paper.year) ? '（留作模考的卷，一道都不做）' : ''}`);
  }
}

function sample() {
  const dir = opt._[0] || need('dir');
  const n = Number(opt.n && opt.n !== true ? opt.n : 20);
  const nodes = new Map(nodesIn(dir).map((x) => [x.id, x]));
  const qs = papersIn(dir).flatMap((x) => x.j.questions).filter((q) => q.tags?.syl?.length);
  // 不用随机数：照题号的哈希挑，同一批每次抽到的一样（我说不对的那几道改了以后还能对上）
  const h = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const pick = [...qs].sort((a, b) => h(a.id) - h(b.id)).slice(0, n);
  for (const q of pick) console.log(`${q.id}｜${nodes.get(q.tags.syl[0])?.title || q.tags.syl[0]}｜${HOW[q.course]?.[q.tags.how] || q.tags.how}｜${(q.tags.traps || []).join('；') || '（没写坑）'}`);
  console.log(`\n抽了 ${pick.length} 道（一共 ${qs.length} 道打了标签）。`);
}

function skeleton() {
  const dir = opt._[0] || need('dir');
  const course = need('course');
  const curriculum = readJson(need('curriculum'));
  const out = skeletonOf({ course, nodes: nodesIn(dir), curriculum });
  console.log(`${course}：课程地图缺 ${out.length} 章${out.length ? '（下面是 ArtifactData batch 的 writes，collection 是 curriculum）' : ''}`);
  console.log(JSON.stringify(out.map(({ id, ...data }) => ({ op: 'set', collection: 'curriculum', doc_id: id, data })), null, 1));
}

const CMDS = { split, syllabus, check, apply, tagprep, tagmerge, tagapply, drills, sample, skeleton };
if (!CMDS[cmd]) { console.error('用法：node tools/exam.mjs split | syllabus | check | apply …（见文件开头）'); process.exit(2); }
CMDS[cmd]();

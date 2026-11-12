// 考试资料的收件箱（docs/exam-plan.md 1.2 的 exam_inbox）：开发那边用 tools/exam.mjs 切好、写进 exam_inbox，
// 页面照规矩查过再并进 papers / questions / passages / syllabus（examdesk.js 挂在首页）。
// 一条记录一种东西：一卷（paper）、一门课的考点树（syllabus）、一批标签（tags）。**整条要么全收、要么全不收**：
// 一卷里有一题不对就整卷不收（半卷进库，统计就错了），回执写哪一题哪里不对。
// 纯函数，有测试（tests/exam-inbox.test.js）。
import { validateExam } from './schema.js';
import { checkPaper } from './structure.js';
import { checkTags } from './taxonomy.js';
import { validateWrite } from '../memory/writer.js';
import { usable } from './reserve.js';

const STRONG = ['engine', 'exact', 'double'];
/** 题自带的标签照主考点算门课（G-LA-2.1 → LA） */
export const courseOfTags = (tags) => String(tags?.syl?.[0] || '').match(/^G-([A-Z]{2})-/)?.[1] || '';
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const strip = (d) => { const { id: _, ...rest } = d || {}; return rest; };

/** 这条记录要碰哪几条（examdesk 先读它们现在的样子交给 planInbox 当 have） */
export function touches(rec = {}) {
  if (rec.kind === 'paper') return [`papers/${rec.paper?.id}`, ...(rec.questions || []).map((q) => `questions/${q.id}`), ...(rec.passages || []).map((p) => `passages/${p.id}`)];
  if (rec.kind === 'syllabus') return (rec.nodes || []).map((n) => `syllabus/${n.id}`);
  if (rec.kind === 'tags') return Object.keys(rec.tags || {}).map((id) => `questions/${id}`);
  if (rec.kind === 'drills') return (rec.drills || []).map((d) => `drills/${d.id}`);
  return [];
}

/** 标签变了：往这一条自己的 tagLog 里加一条（不走 meta/ledger：上千道题会撑爆一个文档） */
function withTags(cur, tags, { at, by }) {
  if (tags === undefined) return cur?.tags !== undefined ? { tags: cur.tags, ...(cur.tagLog ? { tagLog: cur.tagLog } : {}) } : {};
  const log = Array.isArray(cur?.tagLog) ? [...cur.tagLog] : [];
  if (!same(cur?.tags, tags)) log.push({ at, by, from: cur?.tags ?? null, to: tags });
  return { tags, ...(log.length ? { tagLog: log } : {}) };
}

/**
 * 一条收件箱记录 → { writes: [{ path, data }], log }。have：'集合/编号' → 现在那条（没有就是新的）；
 * syllabusIds：标签记录要核的考点编号（不给就不核考点）。
 * log：{ kind, at, ok, counts（每类写几条）, added（每类新加几条）, problems, rejected: [{ id, error }], notes }
 */
// years：留作模考的年份（档案里现在的）：那几年的真题做成的练习不收（改了档案、开发那边没带 --reserve 都拦得住）
export function planInbox(rec = {}, { have = new Map(), at = Date.now(), syllabusIds = null, years = [] } = {}) {
  const by = String(rec.by || 'dev');
  const log = { kind: String(rec.kind || ''), at, ok: false, counts: {}, added: {}, problems: [], rejected: [], notes: [] };
  const writes = [];
  const put = (coll, doc) => {
    const path = `${coll}/${doc.id}`;
    writes.push({ path, data: doc.data });
    log.counts[coll] = (log.counts[coll] || 0) + 1;
    if (!have.has(path)) log.added[coll] = (log.added[coll] || 0) + 1;
  };
  const bad = (coll, d) => validateExam(coll, d?.id, strip(d));

  if (rec.kind === 'paper') {
    const p = rec.paper || {};
    const qs = rec.questions || [];
    const ps = rec.passages || [];
    log.problems.push(...bad('papers', p), ...qs.flatMap((q) => bad('questions', q)), ...ps.flatMap((x) => bad('passages', x)));
    for (const q of qs) if (q.paper !== p.id) log.problems.push(`${q.id}：挂的卷是 ${q.paper}，不是 ${p.id}`);
    const cp = checkPaper(p, qs);
    log.problems.push(...cp.problems);
    log.notes.push(...cp.notes);
    if (log.problems.length) return { writes: [], log };
    const curP = have.get(`papers/${p.id}`);
    // 留不留作模考是我在页面上定的：收件箱再来同一卷不盖掉
    put('papers', { id: p.id, data: { ...strip(p), ...(curP?.reserve !== undefined ? { reserve: curP.reserve } : {}), by, at } });
    for (const q of qs) {
      const cur = have.get(`questions/${q.id}`);
      const { tags, ...rest } = strip(q);
      // 门课：题自带标签就照主考点；没带、库里那条打过标签的留着库里的（重切一遍不把打标签改过的门课退回题号猜的）
      const course = courseOfTags(tags) || (cur?.tags ? cur.course : '') || rest.course;
      // 验算：库里那条验过（引擎 / 精确 / 双人），这一份只照书，留着库里的
      const verified = STRONG.includes(cur?.verified?.how) && (!rest.verified || rest.verified.how === 'book') ? cur.verified : rest.verified;
      put('questions', { id: q.id, data: { ...rest, course, ...(verified ? { verified } : {}), ...withTags(cur, tags, { at, by }), by, at } });
    }
    for (const x of ps) put('passages', { id: x.id, data: { ...strip(x), by, at } });
  } else if (rec.kind === 'syllabus') {
    const nodes = rec.nodes || [];
    log.problems.push(...nodes.flatMap((n) => bad('syllabus', n)));
    for (const n of nodes) if (n.course !== rec.course) log.problems.push(`${n.id}：门课是 ${n.course}，这一份是 ${rec.course} 的大纲`);
    if (!nodes.length) log.problems.push('考点树是空的');
    if (log.problems.length) return { writes: [], log };
    const fresh = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      const cur = have.get(`syllabus/${n.id}`);
      // 挂到课程地图的哪几块是后来映射上的（教研室 / 页面），重新切大纲不抹掉——但编号是按出现顺序数的，
      // 中间补了一节以后同一个编号可能是另一节：标题变了的不带走原来挂的块，回执里写一句（教研室会重新挂）
      const moved = cur?.title && cur.title !== n.title;
      if (moved && cur.blocks?.length) log.notes.push(`${n.id} 的标题变了（「${cur.title}」→「${n.title}」）：原来挂的块 ${cur.blocks.join('、')} 没带过来`);
      const keep = cur && !moved ? Object.fromEntries(['blocks', 'mapAt', 'mapSig', 'changed'].filter((k) => cur[k] !== undefined).map((k) => [k, cur[k]])) : {};
      put('syllabus', { id: n.id, data: { ...strip(n), ...keep, status: 'active', by, at } });
    }
    // 这一份大纲里没有了的旧考点：编号不删（以前的标签还指着它），标作废
    for (const [path, cur] of have) {
      const id = path.split('/')[1];
      if (!path.startsWith('syllabus/') || fresh.has(id) || !id.startsWith(`G-${rec.course}-`) || cur?.status === 'void') continue;
      put('syllabus', { id, data: { ...cur, status: 'void', by, at } });
      log.notes.push(`${id}（${cur?.title || ''}）这一份大纲里没有了：标作废${cur?.blocks?.length ? `，原来挂着 ${cur.blocks.join('、')}` : ''}`);
    }
  } else if (rec.kind === 'tags') {
    for (const [id, tags] of Object.entries(rec.tags || {})) {
      const cur = have.get(`questions/${id}`);
      if (!cur) { log.rejected.push({ id, error: '库里没有这道题' }); continue; }
      const course = courseOfTags(tags) || cur.course;
      const why = syllabusIds ? checkTags(tags, { course, syllabusIds }) : [];
      if (why.length) { log.rejected.push({ id, error: why.join('；') }); continue; }
      put('questions', { id, data: { ...strip(cur), course, ...withTags(cur, tags, { at, by }), at } });
    }
  } else if (rec.kind === 'drills') {
    // 真题做成的练习（drillgen.js）：题库是记忆库的一类，照记忆库的规矩查
    const ds = rec.drills || [];
    for (const d of ds) log.problems.push(...validateWrite(`drills/${d.id}`, strip(d)), ...(d.src === 'exam' && d.exam ? [] : [`${d.id}：不是真题做的练习（要 src: exam、exam: 题号）`]), ...(d.exam && !usable({ id: d.exam }, years) ? [`${d.id}：${d.exam} 是留作模考的卷，不做成练习`] : []));
    if (!ds.length) log.problems.push('没有题');
    if (log.problems.length) return { writes: [], log };
    for (const d of ds) {
      const cur = have.get(`drills/${d.id}`);
      // 我标了作废的不复活
      put('drills', { id: d.id, data: { ...strip(d), status: cur?.status === 'void' ? 'void' : 'active', by, at } });
    }
  } else {
    log.problems.push(`不认得的记录种类「${rec.kind}」（只认 paper / syllabus / tags / drills）`);
    return { writes: [], log };
  }
  log.ok = true;
  return { writes, log };
}

/** meta/exam 的计数：照回执加新加的（首页不为了计数去读整类） */
export function countsAfter(meta, log, at = Date.now()) {
  const counts = { ...(meta?.counts || {}) };
  if (log?.ok) for (const [c, n] of Object.entries(log.added || {})) counts[c] = (counts[c] || 0) + n;
  return { ...(meta || {}), counts, at };
}

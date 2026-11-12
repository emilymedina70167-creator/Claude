// 导出备份（docs/desk-plan.md 3.4）：整个记忆库（可选带不带证据、各节课的黑板）存成一个 JSON 文件，用 downloads 能力让我保存。
// 恢复：学习台首页「从备份恢复」，页面自己写回（restorePlan；学习台自己管自己，不经过外部 Claude，docs/autonomy-plan.md）。
// 文件里每一条也是 ArtifactData batch 要的样子（collection、doc_id、data），开发那边修数据时照 restoreBatches 切成一批批写回。
// 纯函数，有测试（tests/memory-report.test.js）。
import { MEMORY_COLLECTIONS } from './schema.js';
import { packIds } from './space.js';
import { EXAM_COLLECTIONS } from '../exam/schema.js';

// 考试的资料（exam/schema.js）：入库要花额度和人工核对，丢了重做不划算，备份带上。收件箱和回执是过路的，不带
export const EXAM_BACKUP = Object.keys(EXAM_COLLECTIONS).filter((c) => !c.startsWith('exam_inbox'));

export const BACKUP_FORMAT = 'la-desk-backup';
export const BACKUP_VERSION = 1;
// 每节课下面的集合（memory/session.js 的 SESSION_SCOPED）：「带各节课的黑板」时才导出，pack 和课后报告总是带上
export const BOARD_COLLECTIONS = ['steps', 'class_pages', 'class_turns', 'uploads'];
export const SESSION_EXTRA = ['pack', 'report'];
const BATCH_MAX = 50;
const BATCH_BYTES = 900 * 1024; // batch 整个不能超过 1 MiB，留点余量

const strip = (d) => { const { id: _, ...rest } = d || {}; return rest; };

/**
 * memory：{ 集合名: [{ id, ...字段 }] }（页面订阅着的那份）；pack：{ main, problems }（下一节课的资料包）；
 * sessions：{ 编号: { 集合名: [{ id, ... }] } }（每节课下面的）。evidence：带不带证据。
 * 返回要存成文件的对象：{ format, v, kit, at, today, include, counts, docs: [{ collection, doc_id, data }] }
 */
// books：{ books, chunks }，教材板块（转写要花额度，丢了重转不划算，所以备份带上文字；原页图在 assets 里，不进备份）
// exam：{ 集合名: [{ id, ... }] }（真题、考点、篇章、画像、考情动态；原页图照旧在 assets 里）
export function backupFile({ memory = {}, pack = {}, packs = null, sessions = {}, books = null, exam = null, evidence = true, boards = false, kit = '', today = '', at = Date.now() } = {}) {
  const docs = [];
  const counts = {};
  const add = (collection, d) => {
    if (!d || d.id === undefined || d.id === null) return;
    docs.push({ collection, doc_id: String(d.id), data: strip(d) });
    const top = /^(sessions|books)\//.test(collection) ? `${collection.split('/')[0]}/*/${collection.split('/')[2]}` : collection;
    counts[top] = (counts[top] || 0) + 1;
  };
  for (const c of MEMORY_COLLECTIONS) {
    if (c === 'evidence' && !evidence) continue;
    for (const d of [...(memory[c] || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)))) add(c, d);
  }
  // packs：{ math: { main, problems }, cs: …, en: … } 三科的资料包各按自己的编号存（pack/main-cs…）；
  // 只给 pack 时是老的写法（数学那一份）
  if (packs) {
    for (const [sp, p] of Object.entries(packs)) {
      const ids = packIds(sp);
      for (const k of ['main', 'problems']) if (p?.[k]) add('pack', { ...p[k], id: ids[k] });
    }
  } else for (const k of ['main', 'problems']) if (pack?.[k]) add('pack', { ...pack[k], id: k });
  for (const c of EXAM_BACKUP) for (const d of [...(exam?.[c] || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)))) add(c, d);
  for (const b of books?.books || []) add('books', b);
  for (const c of books?.chunks || []) add(`books/${c.book}/chunks`, c);
  for (const sid of Object.keys(sessions || {}).sort()) {
    for (const c of [...SESSION_EXTRA, ...(boards ? BOARD_COLLECTIONS : [])]) {
      for (const d of sessions[sid]?.[c] || []) add(`sessions/${sid}/${c}`, d);
    }
  }
  return { format: BACKUP_FORMAT, v: BACKUP_VERSION, kit, at, today, include: { evidence: !!evidence, boards: !!boards }, counts, docs };
}

export const backupName = (today) => `学习台备份-${String(today || '').replace(/-/g, '')}.json`;

/** 读回来的文件对不对：返回出错的原因，对就返回 '' */
export function backupProblem(b) {
  if (!b || b.format !== BACKUP_FORMAT) return '这不是学习台的备份文件';
  if (b.v !== BACKUP_VERSION) return `备份文件的版本是 ${b.v}，这一版只认 ${BACKUP_VERSION}`;
  if (!Array.isArray(b.docs)) return '备份文件里没有 docs';
  return '';
}

/**
 * 页面自己恢复：返回要写的 [{ path, data }] 和几条会覆盖现在的。have：数据库里已经有的 'collection/doc_id'（Set）。
 * overwrite：已有的也用备份里的覆盖；不覆盖时只补缺的（默认，不会把这段时间新写的冲掉）
 */
export function restorePlan(b, { have = new Set(), overwrite = false } = {}) {
  const why = backupProblem(b);
  if (why) throw new Error(why);
  const writes = [];
  let clash = 0;
  for (const d of b.docs) {
    if (!d || !d.collection || d.doc_id === undefined || !d.data || typeof d.data !== 'object') continue;
    const path = `${d.collection}/${d.doc_id}`;
    const exists = have.has(path);
    if (exists) clash++;
    if (exists && !overwrite) continue;
    writes.push({ path, data: d.data });
  }
  return { writes, clash, total: b.docs.length };
}

/**
 * 按 ArtifactData batch 的限制切成几批：每批最多 50 条、整批不过 1 MiB。
 * existing：数据库里已经有的文档（'collection/doc_id' → version）：有的带上 if_version（覆盖要带版本），skipExisting 时干脆不写。
 */
export function restoreBatches(b, { existing = {}, skipExisting = false } = {}) {
  const why = backupProblem(b);
  if (why) throw new Error(why);
  const out = [];
  let cur = [], size = 0;
  for (const d of b.docs) {
    const key = `${d.collection}/${d.doc_id}`;
    const ver = existing[key];
    if (ver !== undefined && skipExisting) continue;
    const w = { op: 'set', collection: d.collection, doc_id: d.doc_id, data: d.data, ...(ver !== undefined ? { if_version: ver } : {}) };
    const n = new TextEncoder().encode(JSON.stringify(w)).length;
    if (cur.length && (cur.length >= BATCH_MAX || size + n > BATCH_BYTES)) { out.push(cur); cur = []; size = 0; }
    cur.push(w);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

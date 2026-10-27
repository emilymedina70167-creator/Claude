// 导出备份（docs/desk-plan.md 3.4）：整个记忆库（可选带不带证据、各节课的黑板）存成一个 JSON 文件，用 downloads 能力让我保存。
// 恢复不做成按钮：外部的 Claude 照说明书第七节「备份和恢复」，用 ArtifactData 的 batch 按文件里的 docs 一批批写回。
// 所以文件里每一条都已经是 batch 要的样子（collection、doc_id、data），一次最多 50 条、1 MiB，restoreBatches 就是照这个切的。
// 纯函数，有测试（tests/memory-report.test.js）。
import { MEMORY_COLLECTIONS } from './schema.js';

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
export function backupFile({ memory = {}, pack = {}, sessions = {}, evidence = true, boards = false, kit = '', today = '', at = Date.now() } = {}) {
  const docs = [];
  const counts = {};
  const add = (collection, d) => {
    if (!d || d.id === undefined || d.id === null) return;
    docs.push({ collection, doc_id: String(d.id), data: strip(d) });
    const top = collection.startsWith('sessions/') ? `sessions/*/${collection.split('/')[2]}` : collection;
    counts[top] = (counts[top] || 0) + 1;
  };
  for (const c of MEMORY_COLLECTIONS) {
    if (c === 'evidence' && !evidence) continue;
    for (const d of [...(memory[c] || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)))) add(c, d);
  }
  for (const k of ['main', 'problems']) if (pack?.[k]) add('pack', { ...pack[k], id: k });
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

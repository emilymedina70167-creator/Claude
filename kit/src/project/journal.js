// 项目 Claude 每一次写都记下来（第十四轮）：journal/{编号} = { at, by, path, op, before, after }。
// 保护靠「看得见、能撤销」，不靠拦。纯函数（tests/project-write.test.js）。

/** 一条 journal 的编号：时间在前，按编号排就是按时间排 */
export const journalId = (at = Date.now()) => `j-${Number(at).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** 撤销这一条要做的写：改之前没有这一条就删掉，有就整条写回改之前的样子 */
export function undoJournal(entry) {
  if (!entry?.path) return null;
  return entry.before == null ? { op: 'delete', path: entry.path } : { op: 'set', path: entry.path, data: entry.before };
}

// 键的先后不算（数据库读回来的键可能换了顺序）
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
/** 撤销之前：那一条现在的样子和这一次改完的不一样（后来又被改过），撤销会把后来的也盖掉 */
export function changedSince(entry, current) {
  return JSON.stringify(canon(current ?? null)) !== JSON.stringify(canon(entry?.after ?? null));
}

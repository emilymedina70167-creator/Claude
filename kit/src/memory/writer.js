// 写数据库走同一个出口（2026-11-04：学习台要成熟、不犯错）。
// 以前首页、要想起来的、练一练、补记各写各的：有的失败了重试、有的不重试；有的会把同一份连写两次；
// 写进去的东西缺了必填字段，要等自检报出来。现在学习台首页和练一练拿到的数据库包一层（guardDb），每一次写：
// - 写之前按记忆库的规矩看一遍（schema.js：必填、编号、只能取的值），不守规矩的照样写（拦住会丢我的数据），但记进 errlog，
//   自动测试（tools/desk-e2e.mjs）看到 meta/errors 里有这一条就报红——开发时就改掉，不等上线以后被自检报；
// - 同一个文档的几次写按先后排队（后一次不会被前一次盖掉）；
// - 网络抖、被限流这类一会儿就好的失败自己重试两次（没网先等网回来）；还是不行的记进 errlog，照旧抛给调用的地方（它的按钮放开、提示没成）。
// 谁能写哪一类（assertWrite）照旧由调用的地方查：它知道自己是 page 还是 me。
//
// 课堂讲课那一边不包（classroom.js 拿的是自己那份数据库，写证据走 sync.js 的 sink，本来就会重试）：不碰回话的速度。
import { COLLECTIONS, isDate } from './schema.js';
import { reportError } from '../errlog.js';

// 这几种失败重试也没用
const PERMANENT = new Set(['invalid_argument', 'permission_denied', 'not_granted', 'revoked', 'quota_exceeded', 'not_found', 'failed_precondition']);
export const RETRY_WAITS = [800, 2000];

/**
 * 一次写（set 的整份文档）守不守记忆库的规矩（纯函数）。path 是 'coll/id'，只看记忆库的那几类（两段的路径）；
 * 返回问题的列表（空的就是没问题）
 */
export function validateWrite(path, data) {
  const parts = String(path || '').split('/');
  if (parts.length !== 2) return [];
  const [coll, id] = parts;
  const c = COLLECTIONS[coll];
  if (!c || !data || typeof data !== 'object') return [];
  const out = [];
  if (c.id?.re && !c.id.re.test(id)) out.push(`编号「${id}」不对（${c.label}的编号像 ${c.id.eg}）`);
  for (const f of c.required || []) if (data[f] === undefined || data[f] === null || data[f] === '') out.push(`缺了必填的 ${f}`);
  for (const [f, vals] of Object.entries(c.enums || {})) if (data[f] !== undefined && data[f] !== null && !vals.includes(data[f])) out.push(`${f} 是「${data[f]}」，只能是 ${vals.join(' / ')}`);
  for (const f of c.dates || []) if (data[f] !== undefined && data[f] !== null && data[f] !== '' && !isDate(data[f])) out.push(`${f}「${data[f]}」不是 YYYY-MM-DD`);
  return out.map((m) => `${c.label} ${id}：${m}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function online(max = 10000) {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return;
  await Promise.race([new Promise((r) => addEventListener('online', r, { once: true })), wait(max)]);
}

/** 包一层：返回的东西和原来的数据库用法一样（doc / collection / where / onSnapshot…），只有写变了 */
export function guardDb(db, { waits = RETRY_WAITS } = {}) {
  if (!db || db.__guarded) return db;
  const chains = new Map();

  async function attempt(path, op, run) {
    for (let i = 0; ; i++) {
      try { return await run(); } catch (err) {
        const code = String(err?.code || '');
        if (PERMANENT.has(code) || i >= waits.length) {
          reportError(err, { what: `写数据库没成（${op}）`, path });
          throw err;
        }
        await online();
        await wait(waits[i]);
      }
    }
  }
  function guarded(path, op, run, data) {
    if (op === 'set') {
      const bad = validateWrite(path, data);
      if (bad.length) reportError(bad.join('；'), { what: '写进去的不守记忆库的规矩', path });
    }
    const prev = chains.get(path) || Promise.resolve();
    const p = prev.catch(() => {}).then(() => attempt(path, op, run));
    chains.set(path, p);
    p.finally(() => { if (chains.get(path) === p) chains.delete(path); }).catch(() => {});
    return p;
  }
  const bind = (t, k) => { const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; };
  function wrapDoc(ref, path) {
    return new Proxy(ref, {
      get(t, k) {
        if (k === 'set') return (data, ...rest) => guarded(path, 'set', () => t.set(data, ...rest), data);
        if (k === 'update') return (data, ...rest) => guarded(path, 'update', () => t.update(data, ...rest), null);
        if (k === 'delete') return (...rest) => guarded(path, 'delete', () => t.delete(...rest), null);
        if (k === 'collection') return (c) => wrapColl(t.collection(c), `${path}/${c}`);
        return bind(t, k);
      },
    });
  }
  function wrapQuery(q, path) {
    return new Proxy(q, {
      get(t, k) {
        if (k === 'where' || k === 'orderBy' || k === 'limit') return (...a) => wrapQuery(t[k](...a), path);
        if (k === 'doc') return (id) => (id === undefined ? wrapDoc(t.doc(), `${path}/?`) : wrapDoc(t.doc(id), `${path}/${id}`));
        // add：没有编号，失败重试会多写一份，所以只记、不重试
        if (k === 'add') return (data) => t.add(data).catch((err) => { reportError(err, { what: '写数据库没成（add）', path }); throw err; });
        return bind(t, k);
      },
    });
  }
  const wrapColl = wrapQuery;
  return new Proxy(db, {
    get(t, k) {
      if (k === '__guarded') return true;
      if (k === 'doc') return (p) => wrapDoc(t.doc(p), String(p));
      if (k === 'collection') return (c) => wrapColl(t.collection(c), String(c));
      return bind(t, k);
    },
  });
}


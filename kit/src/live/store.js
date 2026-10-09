// 实时黑板的存储：claude.ai 里用 artifact 的 db / assets；
// 本地打开（地址带 ?dev）时用存在 localStorage 里的替身，接口是真 db 的一个子集。

export async function getStore({ title = 'dev' } = {}) {
  const c = window.claude;
  if (c && typeof c.use === 'function') {
    let db = null, assets = null;
    try { db = await c.use('db'); } catch { db = null; }
    if (db) {
      try { assets = await c.use('assets'); } catch { assets = null; }
      return { db, assets, dev: false };
    }
  }
  if (isDev()) {
    const db = fakeDb(`la-devdb:${title}`);
    return { db, assets: fakeAssets(`la-devasset:${title}`), dev: true };
  }
  return null;
}

export const isDev = () => /[?&#]dev\b/.test(location.search + location.hash);

// 资源地址：真 assets 用 /_blob/<id>；替身存的是 data URL
export function assetUrl(id) {
  if (id.startsWith('dev-')) { try { return localStorage.getItem(`la-devasset:${id}`) || ''; } catch { return ''; } }
  return '/_blob/' + id;
}

/* ---------------- 本地替身 ---------------- */

const snapDoc = (id, data) => ({ id, exists: data !== undefined, data: () => (data === undefined ? undefined : clone(data)), metadata: { fromCache: false, hasPendingWrites: false } });
const clone = (x) => JSON.parse(JSON.stringify(x));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function fakeDb(key) {
  let all = load();
  const subs = new Set();
  function load() { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
  function persist() { try { localStorage.setItem(key, JSON.stringify(all)); } catch { /* 存不下就只留在内存里 */ } }
  function changed() { persist(); const list = [...subs]; setTimeout(() => list.forEach((f) => subs.has(f) && f()), 0); }
  // 另一个标签页（比如开发面板开在别处）改了数据
  window.addEventListener('storage', (e) => { if (e.key === key) { all = load(); [...subs].forEach((f) => f()); } });

  const parent = (p) => p.split('/').slice(0, -1).join('/');
  const check = (p, even) => {
    const n = p.split('/').length;
    if (!p || p.split('/').some((s) => !/^[\w\-.~:@+]+$/.test(s))) throw new TypeError(`路径不合法：${p}`);
    if ((n % 2 === 0) !== even) throw new TypeError(`${p} 有 ${n} 段，${even ? '文档要偶数段' : '集合要奇数段'}`);
  };

  function docRef(path) {
    check(path, true);
    const id = path.split('/').pop();
    return {
      id, path,
      async get() { return snapDoc(id, all[path]); },
      async set(data) { all[path] = clone(data); changed(); },
      async update(data) {
        if (!all[path]) throw { code: 'invalid_argument', message: 'document does not exist' };
        all[path] = merge(all[path], clone(data)); changed();
      },
      async delete() { delete all[path]; changed(); },
      onSnapshot(next) {
        let last;
        const f = () => { const s = JSON.stringify(all[path]); if (s !== last) { last = s; next(snapDoc(id, all[path])); } };
        subs.add(f); setTimeout(f, 0);
        return () => subs.delete(f);
      },
      collection: (sub) => collRef(`${path}/${sub}`),
    };
  }

  function query(path, filters = [], order = null, lim = 0) {
    const run = () => {
      let docs = Object.keys(all).filter((p) => parent(p) === path).map((p) => ({ id: p.split('/').pop(), data: all[p] }));
      for (const [f, op, v] of filters) docs = docs.filter((d) => cmp(d.data[f], op, v));
      if (order) docs.sort((a, b) => ((a.data[order[0]] ?? Infinity) > (b.data[order[0]] ?? Infinity) ? 1 : -1) * (order[1] === 'desc' ? -1 : 1));
      else docs.sort((a, b) => (a.id > b.id ? 1 : -1));
      if (lim) docs = docs.slice(0, lim);
      return docs;
    };
    const qs = (docs, prev) => {
      const snaps = docs.map((d) => snapDoc(d.id, d.data));
      return {
        docs: snaps, size: snaps.length, empty: !snaps.length, metadata: { fromCache: false, hasPendingWrites: false },
        docChanges() {
          const out = [];
          snaps.forEach((s, i) => {
            const old = prev.get(s.id);
            if (!old) out.push({ type: 'added', doc: s, oldIndex: -1, newIndex: i });
            else if (old.json !== JSON.stringify(s.data())) out.push({ type: 'modified', doc: s, oldIndex: old.i, newIndex: i });
          });
          prev.forEach((o, id) => { if (!docs.some((d) => d.id === id)) out.push({ type: 'removed', doc: snapDoc(id, o.data), oldIndex: o.i, newIndex: -1 }); });
          return out;
        },
      };
    };
    return {
      where: (f, op, v) => query(path, [...filters, [f, op, v]], order, lim),
      orderBy: (f, dir = 'asc') => query(path, filters, [f, dir], lim),
      limit: (n) => query(path, filters, order, n),
      async get() { return qs(run(), new Map()); },
      onSnapshot(next) {
        let prev = new Map(), last = null;
        const f = () => {
          const docs = run();
          const json = JSON.stringify(docs);
          if (json === last) return;
          last = json;
          const s = qs(docs, prev);
          prev = new Map(docs.map((d, i) => [d.id, { i, json: JSON.stringify(d.data), data: d.data }]));
          next(s);
        };
        subs.add(f); setTimeout(f, 0);
        return () => subs.delete(f);
      },
    };
  }

  function collRef(path) {
    check(path, false);
    return Object.assign(query(path), {
      path,
      doc: (id) => docRef(`${path}/${id || newId()}`),
      async add(data) { const r = docRef(`${path}/${newId()}`); await r.set(data); return r; },
    });
  }

  return {
    doc: docRef,
    collection: collRef,
    // 开发面板用：清空 / 导出
    _dump: () => clone(all),
    _clear: () => { all = {}; changed(); },
  };
}

function merge(a, b) {
  const out = { ...a };
  for (const k in b) out[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? merge(a[k], b[k]) : b[k];
  return out;
}

function cmp(x, op, v) {
  switch (op) {
    case '==': return x === v;
    case '!=': return x !== v;
    case '<': return x < v;
    case '<=': return x <= v;
    case '>': return x > v;
    case '>=': return x >= v;
    case 'in': return v.includes(x);
    case 'not-in': return !v.includes(x);
    case 'array-contains': return Array.isArray(x) && x.includes(v);
    default: throw { code: 'invalid_argument', message: `bad op ${op}` };
  }
}

function fakeAssets() {
  return {
    async upload(blob) {
      const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
      const id = 'dev-' + newId();
      try { localStorage.setItem(`la-devasset:${id}`, url); } catch { /* 太大就只留在内存 */ }
      return { id, url, sizeBytes: blob.size, contentType: blob.type || 'image/png' };
    },
    async list() { return { assets: [], usage: {} }; },
    async delete() {},
  };
}

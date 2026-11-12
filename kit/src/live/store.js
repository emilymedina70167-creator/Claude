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

// 给我存一个文件（学习台的导出备份）：claude.ai 里用 downloads 能力（我确认后才存）；本地 ?dev 用一个下载链接代替。
// 都没有返回 null（发布时没声明 downloads）
export async function getDownloads() {
  const c = window.claude;
  if (c && typeof c.use === 'function') {
    try { const d = await c.use('downloads'); if (d) return d; } catch { /* 没声明 */ }
  }
  if (!isDev()) return null;
  return {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
      const a = Object.assign(document.createElement('a'), { href: url, download: filename });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { status: 'saved' };
    },
  };
}

// 资源地址：真 assets 用 /_blob/<id>；替身存的是 data URL
export function assetUrl(id) {
  if (id.startsWith('dev-')) { try { return localStorage.getItem(`la-devasset:${id}`) || ''; } catch { return ''; } }
  return '/_blob/' + id;
}

/* ---------------- 本地替身 ---------------- */

const snapDoc = (id, data) => ({ id, exists: data !== undefined, data: () => (data === undefined ? undefined : clone(data)), metadata: { fromCache: false, hasPendingWrites: false } });
const clone = (x) => JSON.parse(JSON.stringify(x));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// 本地替身的「故障」：整条流程的自动测试（tools/desk-e2e.mjs）用它模拟网络不好——接下来几次写失败、每次写慢一点。
// 只在 ?dev 的替身里有，真的数据库不受影响。window.LAKitDev.failWrites(1, 'evidence/') 让下一次写 evidence 失败
const faults = { left: 0, match: '', code: 'unavailable', lag: 0, writes: 0, failed: 0 };
if (typeof window !== 'undefined') {
  window.LAKitDev = Object.assign(window.LAKitDev || {}, {
    faults,
    failWrites(n = 1, match = '', code = 'unavailable') { Object.assign(faults, { left: n, match, code }); },
    slowWrites(ms = 0) { faults.lag = ms; },
    // 订阅过、整类读过哪些集合（e2e 查首页不读考试资料的整类）：'questions' 是整类，'questions?' 是带条件的
    reads: new Set(),
  });
}
const noteRead = (path, filters) => { try { window.LAKitDev?.reads?.add(`${path}${filters.length ? '?' : ''}`); } catch { /* 不在浏览器里 */ } };
async function faultGate(path) {
  faults.writes++;
  if (faults.lag) await new Promise((r) => setTimeout(r, faults.lag));
  if (faults.left > 0 && (!faults.match || path.includes(faults.match))) {
    faults.left--;
    faults.failed++;
    throw { code: faults.code, message: `模拟的写入失败（${path}）` };
  }
}

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

  // 和 claude.ai 真的数据库一样：数据库、文档引用、集合引用都是冻住的对象（属性改不了、不能重新配置）。
  // 包一层 Proxy 去换掉它们的方法会撞上 Proxy 的规矩，真机上整页报错（2026-11-05 晚上学习台打不开就是这样）；替身也冻上，本地就能报出来
  function docRef(path) {
    check(path, true);
    const id = path.split('/').pop();
    return Object.freeze({
      id, path,
      async get() { return snapDoc(id, all[path]); },
      async set(data) { await faultGate(path); all[path] = clone(data); changed(); },
      async update(data) {
        await faultGate(path);
        if (!all[path]) throw { code: 'invalid_argument', message: 'document does not exist' };
        all[path] = merge(all[path], clone(data)); changed();
      },
      async delete() { await faultGate(path); delete all[path]; changed(); },
      onSnapshot(next) {
        let last;
        const f = () => { const s = JSON.stringify(all[path]); if (s !== last) { last = s; next(snapDoc(id, all[path])); } };
        subs.add(f); setTimeout(f, 0);
        return () => subs.delete(f);
      },
      collection: (sub) => collRef(`${path}/${sub}`),
    });
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
    return Object.freeze({
      where: (f, op, v) => query(path, [...filters, [f, op, v]], order, lim),
      orderBy: (f, dir = 'asc') => query(path, filters, [f, dir], lim),
      limit: (n) => query(path, filters, order, n),
      async get() { noteRead(path, filters); return qs(run(), new Map()); },
      onSnapshot(next) {
        noteRead(path, filters);
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
    });
  }

  function collRef(path) {
    check(path, false);
    return Object.freeze({
      ...query(path),
      path,
      doc: (id) => docRef(`${path}/${id || newId()}`),
      async add(data) { const r = docRef(`${path}/${newId()}`); await r.set(data); return r; },
    });
  }

  return Object.freeze({
    doc: docRef,
    collection: collRef,
    // 开发面板用：清空 / 导出
    _dump: () => clone(all),
    _clear: () => { all = {}; changed(); },
  });
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
      // ?dev&uplag=1000：每次上传先等这么多毫秒，本地模拟真实网络（量教材存页有多快）
      const lag = Number(new URLSearchParams(location.search).get('uplag')) || 0;
      if (lag) await new Promise((r) => setTimeout(r, lag));
      const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
      const id = 'dev-' + newId();
      try { localStorage.setItem(`la-devasset:${id}`, url); } catch { /* 太大就只留在内存 */ }
      return { id, url, sizeBytes: blob.size, contentType: blob.type || 'image/png' };
    },
    // 本地替身：只数这次存进 localStorage 的原图（学习台首页的「用量」看）
    async list() {
      let files = 0, bytes = 0;
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('la-devasset:dev-')) { files++; bytes += Math.round((localStorage.getItem(k) || '').length * 0.75); } } } catch { /* 无痕模式 */ }
      return { assets: [], usage: { files, bytes, maxFiles: 1000, maxBytes: 100 * 1024 * 1024 } };
    },
    async delete() {},
  };
}

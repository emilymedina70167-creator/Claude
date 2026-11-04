// 页面出错自己记下来（2026-11-04：学习台要成熟、不犯错，出了错得有人知道）。
// 以前页面出错只在控制台里：我在 iPad 上看不到，开发那边也看不到，只能等我撞上、截图、描述。
// 现在没接住的错误、没接住的 Promise、代码里主动报的（写数据库失败、体检拿不准的）都记一条：
// 在哪一页、出错前点了什么、什么版本，攒几秒在空闲时写进学习台数据库的 meta/errors（最近 60 种，同一种只记次数）。
// 「管理 → 自检」里能看到；开发那边（Claude Code）开工先读这一份（CLAUDE.md 写着）。
//
// 不碰上课的速度：只是在页面上挂两个监听、记一个数组；写数据库是空闲时的一次 set，不在调用 Claude 的那条路上，
// 也不进发给 Claude 的任何东西。
import { VERSION } from './version.js';

export const ERR_MAX = 60;   // meta/errors 里最多留几种
const TRAIL = 8;             // 出错前最近几下操作
const FLUSH_MS = 3000;       // 攒几秒再写

/** 一条错误的「种类」：同一处、同一句话算一种（数字、编号换成 #，不然每次的课号不同就成了好几种） */
export const errKey = (e) => `${e.where || ''}|${String(e.msg || '').replace(/\d+/g, '#').slice(0, 160)}`;

/**
 * 把新的几条并进已有的列表（纯函数）：同一种只加次数、更新最后一次的时间和现场；新的在前；最多 cap 种。
 * 已经「看过」（seen）的那种又出现了：重新算没看过
 */
export function mergeErrors(list = [], entries = [], { cap = ERR_MAX } = {}) {
  const out = (Array.isArray(list) ? list : []).map((x) => ({ ...x }));
  for (const e of entries) {
    const k = errKey(e);
    const i = out.findIndex((x) => errKey(x) === k);
    if (i >= 0) {
      const old = out.splice(i, 1)[0];
      out.unshift({ ...old, ...e, first: old.first || old.at, count: (Number(old.count) || 1) + (Number(e.count) || 1), seen: false });
    } else out.unshift({ ...e, first: e.at, count: Number(e.count) || 1 });
  }
  return out.slice(0, cap);
}

/** 错误对象 → 一条记录里的字（纯函数） */
export function describe(err) {
  if (err == null) return { msg: '（空的错误）', stack: '' };
  if (typeof err === 'string') return { msg: err.slice(0, 400), stack: '' };
  const msg = String(err.message || err.reason?.message || err.code || err).slice(0, 400);
  const stack = String(err.stack || err.reason?.stack || '').split('\n').slice(0, 8).join('\n').slice(0, 1200);
  return { msg, stack, ...(err.code ? { code: String(err.code) } : {}) };
}

// —— 页面上的部分 ——
const state = { db: null, buf: [], trail: [], timer: 0, installed: false, writing: false, listeners: new Set() };

/** 现在在哪：学习台首页 / 某一页 / 某节课（地址的 # 后面），模式 */
function whereNow() {
  if (typeof location === 'undefined') return '';
  const h = decodeURIComponent(String(location.hash || '').slice(1));
  return h ? `#${h.replace(/c-\d{8}-\d+/, 'c-…')}` : '首页';
}

/** 主动报一条（代码里接住了、但应该让人知道的：写数据库失败、体检拿不准……）。ctx：{ what, path, soft } */
export function reportError(err, ctx = {}) {
  try {
    const d = describe(err);
    const e = { at: Date.now(), where: ctx.where || whereNow(), ...d, ...(ctx.what ? { what: String(ctx.what).slice(0, 200) } : {}), ...(ctx.path ? { path: String(ctx.path).slice(0, 200) } : {}), ...(ctx.soft ? { soft: true } : {}), trail: state.trail.slice(-TRAIL), kit: VERSION };
    state.buf.push(e);
    for (const f of state.listeners) { try { f(e); } catch { /* */ } }
    schedule();
  } catch { /* 记错误的时候自己别再出错 */ }
}

/** 页面一开就挂上（main.js）：没接住的错误、Promise；最近几下点了什么。数据库还没连上之前先攒着 */
export function installErrlog() {
  if (state.installed || typeof window === 'undefined') return;
  state.installed = true;
  window.addEventListener('error', (ev) => {
    // 图片、脚本加载失败（ev.target 是元素）也会冒到这里：有原因的才记
    if (ev?.target && ev.target !== window && ev.target.tagName) { reportError(`${ev.target.tagName.toLowerCase()} 加载失败：${ev.target.src || ev.target.href || ''}`, { soft: true }); return; }
    reportError(ev?.error || ev?.message || ev);
  }, true);
  window.addEventListener('unhandledrejection', (ev) => reportError(ev?.reason ?? ev, { what: '没接住的 Promise' }));
  // 出错前点了什么：按钮、链接上的字（不记输入框里写的内容）
  document.addEventListener('click', (ev) => {
    const b = ev.target?.closest?.('button, a, [role="button"], .dk-trow');
    if (!b) return;
    const label = (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    state.trail.push(`${whereNow()} 点「${label || b.className}」`);
    if (state.trail.length > TRAIL * 2) state.trail.splice(0, state.trail.length - TRAIL);
  }, true);
  window.addEventListener('hashchange', () => { state.trail.push(`到 ${whereNow()}`); });
  // 要关页面了：攒着的赶紧写
  window.addEventListener('pagehide', () => flush());
}

/** 数据库连上了（学习台首页、课堂、练习）：攒着的写进去 */
export function attachErrlog(db) {
  if (!db || state.db) return;
  state.db = db;
  schedule();
}

/** 管理页要知道「刚又出了一条」（不等数据库订阅回来） */
export function onError(f) { state.listeners.add(f); return () => state.listeners.delete(f); }

function schedule() {
  if (!state.db || state.timer || !state.buf.length) return;
  state.timer = setTimeout(() => {
    state.timer = 0;
    const go = () => flush();
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 4000 }); else go();
  }, FLUSH_MS);
}

async function flush() {
  if (!state.db || state.writing || !state.buf.length) return;
  state.writing = true;
  const batch = state.buf.splice(0);
  try {
    const ref = state.db.doc('meta/errors');
    const cur = await ref.get().then((s) => (s.exists ? s.data() : null)).catch(() => null);
    await ref.set({ list: mergeErrors(cur?.list, batch), at: Date.now(), kit: VERSION });
  } catch {
    // 写不进去（没网、被限流）：放回去，下次再写；别让它报出新的错来
    state.buf.unshift(...batch.slice(-20));
  } finally {
    state.writing = false;
    if (state.buf.length) schedule();
  }
}

/** 管理页的「看过了」：都标成看过（下次同一种又出现会重新亮）；clear 是整份清掉 */
export async function markSeen(db, { clear = false } = {}) {
  const ref = db.doc('meta/errors');
  const cur = await ref.get().then((s) => (s.exists ? s.data() : null)).catch(() => null);
  await ref.set({ list: clear ? [] : (cur?.list || []).map((x) => ({ ...x, seen: true })), at: Date.now(), kit: VERSION });
}

/** 给测试用：清掉页面上的状态 */
export function _resetErrlog() { Object.assign(state, { db: null, buf: [], trail: [], timer: 0, writing: false }); }

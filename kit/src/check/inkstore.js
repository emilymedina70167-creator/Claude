// 检验手写板没交的笔画存在这台设备上（localStorage），刷新、熄屏回来接着写（inkpad.js）。不碰 DOM，tests/check-minors.test.js。
// 空的不存（以前每秒存一份空的：题一打开就占一个 key，下次打开这道题还被当成「写过」硬切到手写）；
// 交了、想不出来了删掉（shell.js）；剩下的（做到一半不做了）存了 7 天就清（上一版存的没有 wall：补上现在，从现在算）。
export const INK_PREFIX = 'la-ck-';
export const INK_KEEP = 7 * 86400000;

const live = (strokes) => Array.isArray(strokes) && strokes.length > 0;

/** 存一份：没有笔画就删掉（撤完了也一样）；wall 是存的那一刻（清过期的用） */
export function saveInk(storage, key, data, wall = Date.now()) {
  if (!storage || !key) return;
  try {
    if (!live(data?.strokes)) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ ...data, wall }));
  } catch { /* 存不下就不存 */ }
}

export function loadInk(storage, key) {
  if (!storage || !key) return null;
  try { const v = JSON.parse(storage.getItem(key) || 'null'); return v && live(v.strokes) ? v : null; } catch { return null; }
}

/** 这道题在这台设备上有没交的笔画（有才默认打开手写） */
export const hasInk = (storage, key) => !!loadInk(storage, key);

export function dropInk(storage, key) {
  if (!storage || !key) return;
  try { storage.removeItem(key); } catch { /* 无 */ }
}

/** 清掉存了 INK_KEEP 以上的笔画（只动 la-ck- 开头、存着 strokes 的；标签页的锁 la-ck-lock- 不动） */
export function sweepInk(storage, now = Date.now(), keep = INK_KEEP) {
  if (!storage) return;
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(INK_PREFIX) && !k.startsWith(`${INK_PREFIX}lock-`)) keys.push(k); }
    for (const k of keys) {
      let v = null;
      try { v = JSON.parse(storage.getItem(k) || 'null'); } catch { v = null; }
      if (!v || !Array.isArray(v.strokes)) continue;
      if (!live(v.strokes)) { storage.removeItem(k); continue; }
      if (!Number(v.wall)) { storage.setItem(k, JSON.stringify({ ...v, wall: now })); continue; }
      if (Number(v.wall) < now - keep) storage.removeItem(k);
    }
  } catch { /* 读不了就不清 */ }
}

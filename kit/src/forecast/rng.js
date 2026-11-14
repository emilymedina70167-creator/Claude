// 固定种子的随机数：同样的数据算出一模一样的预测，首页刷新一下不会变一个数（spec 6.4）。纯函数。

/** mulberry32：一个 32 位种子出一串 [0, 1) 的数 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 几段字拼成一个种子（FNV-1a 32 位） */
export function seedOf(...parts) {
  let h = 0x811c9dc5;
  const s = parts.map(String).join('\u0001');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

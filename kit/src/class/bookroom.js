// 整份说明还剩多少地方给教材原文（books/textbook.js 的 textbookForClass 的 room）。纯函数，有测试（tests/books-preload.test.js）。
// 先按原来的放法拼一份说明，量出离 SYSTEM_MAX、离资料包预算还差多少，再把这一块所在的整章往里补到差不多满：
// 每调一次 textbook_read 平台多跑一整轮（多等 10 秒以上），说明长到 160 KiB 出第一个字的时间却看不出变化（docs/talk-plan.md 的测速）。
// 补的是资料包里「教材原文」那一节，别的部分（组件说明、记忆、黑板现状）一个字不少；资料包整份仍在预算里，packText 不会截。
import { buildSystem, packText, PACK_BUDGET, SYSTEM_MAX } from './prompt.js';

const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const bytes = (s) => (enc ? enc.encode(String(s)).length : Buffer.byteLength(String(s)));

// 按 8 KiB 一档往下取整：黑板现状里「约 N」这类数字每轮差几个字节，不取整的话补进去的条目会跟着一条一条地变——
// 抢跑（spec.js）比的是整份内容，说明的开头不稳也不利于平台对重复的开头打折
export const ROOM_STEP = 8 * 1024;
// 留一点余量：补进去的条目之间的空行、开头那句说明
export const ROOM_MARGIN = 2 * 1024;

/**
 * args：buildSystem 的参数（不含 pack）；packWith(room)：拼资料包，room 是「教材原文」能再多放的字节数（0 就是原来的放法）。
 * 返回 { system, room }
 */
export function systemWithBooks(args, packWith) {
  const base = packWith(0);
  const sys0 = buildSystem({ ...args, pack: base });
  const budget = args.packBudget ?? PACK_BUDGET;
  const packNow = bytes(packText(base, Infinity).text);
  // buildSystem 给资料包的预算是 min(packBudget, SYSTEM_MAX − 别的部分 − 3 KiB)：两头都不能超
  const free = Math.min(SYSTEM_MAX - 3 * 1024 - bytes(sys0), budget - packNow) - ROOM_MARGIN;
  const room = Math.floor(free / ROOM_STEP) * ROOM_STEP;
  if (room <= 0) return { system: sys0, room: 0 };
  const more = packWith(room);
  if (more === base) return { system: sys0, room: 0 };
  return { system: buildSystem({ ...args, pack: more }), room };
}

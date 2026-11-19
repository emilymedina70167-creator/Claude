// 判分、传图、复测几处共用的小判断（整体审查查出来的几处，tests/check-review.test.js、check-minors.test.js）
import { step } from './flow.js';
import { claudeIds } from './judge.js';
import { parseJudge } from '../solvespec.js';

export const UPLOAD_WAIT = 10000; // 一张图最多等多久

/**
 * 外部的 board judge target=题（检验里的那道）：一行一项（计划 1 的写法），result=pass|fail 改整道题。
 * 返回 { state（改判以后的进度）, items, result, errors（写错、没读懂的行：照实回报，不静默丢）} 或 { error }
 */
export function judgeOp(op, state, { at = Date.now() } = {}) {
  const r = state?.results?.[op.target];
  if (!r?.submitted) return { error: `${op.target} 还没交` };
  const lines = String(op.body || '').split('\n');
  const result = lines.map((l) => l.trim().match(/^result\s*=\s*(pass|fail)$/i)?.[1]?.toLowerCase()).find(Boolean) || null;
  const rest = lines.filter((l) => !/^\s*result\s*=/.test(l)).join('\n');
  const ids = [...new Set([...(r.items || []).map((x) => x.id), ...claudeIds(state.check.probes[op.target])])];
  const parsed = rest.trim() ? parseJudge(rest, ids.map((id) => ({ id }))) : { steps: [], errors: [] };
  // 只收写到了的那几项（parseJudge 把没写的补成 null，那是「没判」，不是外部改判成待核）
  const named = new Set(rest.split('\n').map((l) => l.trim().replace(/^[-*]\s+/, '').split(/\s+/)[0]).filter(Boolean));
  const items = parsed.steps.filter((x) => named.has(x.id));
  if (!items.length && !result) return { error: `board judge ${op.target} 里没有读得懂的一行：${(parsed.errors || []).slice(0, 2).join('；') || '写成 m1 ok / s3 wrong why="…"，或 result=pass'}` };
  return { state: step(state, { type: 'ext', id: op.target, items, result, at }), items, result, errors: parsed.errors || [] };
}

/** 页面里的 Claude 用谁：claude.ai 里是真的（ai），?dev 才用模拟老师；都没有就不判（待核，不拿模拟的冒充） */
export const callerFor = ({ dev = false, ai = null } = {}) => (dev ? 'mock' : ai?.call ? 'ai' : null);

/** 几张图一起传，每张最多等 ms；传不上、超时、图是空的都是 null */
export function uploadAll(blobs = [], upload, { ms = UPLOAD_WAIT } = {}) {
  return Promise.all(blobs.map((b) => {
    if (!b) return Promise.resolve(null);
    let timer;
    return Promise.race([
      Promise.resolve().then(() => upload(b)).catch(() => null),
      new Promise((res) => { timer = setTimeout(() => res(null), ms); }),
    ]).then((x) => { clearTimeout(timer); return x || null; });
  }));
}

/** 能不能判：手写的题手上要有整页图，或者另外打了字；拿不到就不判（待核），不让页面里的 Claude 只看文字猜 */
export function canJudge(answer = {}, images = []) {
  if (!answer?.ink) return true;
  return images.length > 0 || !!String(answer.text || '').trim();
}

/** 复测每块过没过：没出题的块（缺新题、题被拿掉）不记；待核的 ok 是 null；一次过（成功）是 true，别的 false */
export function retestResults(absorbs = {}, retests = []) {
  return retests.filter((r) => absorbs[r.block]?.state).map((r) => ({ block: r.block, days: r.days, ok: absorbs[r.block].state === '成功' ? true : absorbs[r.block].state === '待核' ? null : false }));
}

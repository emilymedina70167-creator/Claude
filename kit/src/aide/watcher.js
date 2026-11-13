// 课上的旁听（docs/superpowers/specs/2026-11-13-aide-design.md 5.4）：stage/loop.js 在学生动手时（onIdle）报一下状态，
// 能开就发一次 Opus（走后台：讲课、提前想在跑时 lane.js 不让它开），回来的发现存成 note，老师下一轮的学生消息带上（watchSection）。
// 一次只跑一个；学生、老师都没有新动作就不重发；回的不是 Opus、出错：note 不动，记一条（record）。老师从来不等它。
// 不碰 DOM，有测试（tests/aide-watcher.test.js）。
import { watchCanStart } from './watch.js';

export const WATCH_MODEL = 'claude-opus-5-5';

/**
 * call(input, opts) → { text, modelApplied }；material(state) → 提示词；check(text) → { lines, dropped }（watch.js 的 parseWatch 包一层）；
 * record(row)：记一次（{ text, lines, upTo, dropped, ms } 或 { error, upTo }）
 */
export function createWatcher({ call, material, check, record = () => {}, effort = 'high', now = () => Date.now() }) {
  let note = null;
  let inFlight = false;
  let lastKey = '';
  function kick(state = {}) {
    if (!call || !watchCanStart({ ...state, inFlight })) return;
    const key = `${state.upTo}|${state.pending || ''}`;
    if (key === lastKey) return; // 和上一次看的一样：没有新东西
    lastKey = key;
    inFlight = true;
    const upTo = Number(state.upTo) || 0;
    const t0 = now();
    let input;
    try { input = material(state); } catch (err) { inFlight = false; record({ error: `拼旁听的材料出错：${err?.message || err}`, upTo }); return; }
    Promise.resolve(call(input, { model: WATCH_MODEL, effort, modelTier: 'complex', cache: false, lane: 'bg' }))
      .then((res) => {
        if (res?.modelApplied !== WATCH_MODEL) { record({ error: `回的不是 Opus 5.5（${res?.modelApplied || '没写'}），不用`, upTo, ms: now() - t0 }); return; }
        const r = check(res.text || '');
        note = { upTo, lines: r.lines || [], at: now() };
        record({ text: (r.lines || []).map((l) => `${l.kind}｜${l.text}`).join('\n'), lines: r.lines || [], upTo, dropped: (r.dropped || []).length, ms: now() - t0, bytes: String(input).length });
      }, (err) => { record({ error: `旁听没做成：${err?.message || err?.code || err}`, upTo, ms: now() - t0 }); })
      .finally(() => { inFlight = false; });
  }
  return {
    kick,
    note: () => note,
    /** 刷新以后照记录放回最后一次的发现 */
    set: (n) => { note = n; },
    get busy() { return inFlight; },
  };
}

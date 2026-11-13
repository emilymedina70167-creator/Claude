// 课上的旁听（docs/superpowers/specs/2026-11-13-aide-design.md 5.4）：stage/loop.js 在学生动手时（onIdle）报一下状态，
// 能开就发一次 Opus（走后台：讲课、提前想在跑时 lane.js 不让它开），回来的发现存成 note，老师下一轮的学生消息带上（watchSection）。
// 一次只跑一个；学生、老师都没有新动作就不重发；回的不是 Opus、出错：note 不动，记一条（record）。老师从来不等它。
// 不碰 DOM，有测试（tests/aide-watcher.test.js）。
import { watchCanStart, watchSection } from './watch.js';

export const WATCH_MODEL = 'claude-opus-5-5';

/**
 * call(input, opts) → { text, modelApplied }；material(state) → 提示词；check(text) → { lines, dropped }（watch.js 的 parseWatch 包一层）；
 * record(row)：记一次（{ text, lines, upTo, dropped, ms } 或 { error, upTo }）
 */
// timeoutMs：一次旁听最多等这么久（挂住了不回：算失败，下一次还能开；不然这节课再也不旁听）
export const WATCH_TIMEOUT = 180 * 1000;
export function createWatcher({ call, material, check, record = () => {}, effort = 'high', now = () => Date.now(), timeoutMs = WATCH_TIMEOUT }) {
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
    let timer = null;
    const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${Math.round(timeoutMs / 1000)} 秒没回`)), timeoutMs); });
    Promise.race([Promise.resolve(call(input, { model: WATCH_MODEL, effort, modelTier: 'complex', cache: false, lane: 'bg' })), late])
      .then((res) => {
        if (res?.modelApplied !== WATCH_MODEL) { record({ error: `回的不是 Opus 5.5（${res?.modelApplied || '没写'}），不用`, upTo, ms: now() - t0 }); return; }
        const r = check(res.text || '');
        note = { upTo, lines: r.lines || [], at: now() };
        record({ text: (r.lines || []).map((l) => `${l.kind}｜${l.text}`).join('\n'), lines: r.lines || [], upTo, dropped: (r.dropped || []).length, ms: now() - t0, bytes: String(input).length });
      }, (err) => { record({ error: `旁听没做成：${err?.message || err?.code || err}`, upTo, ms: now() - t0 }); })
      .finally(() => { clearTimeout(timer); inFlight = false; });
  }
  return {
    kick,
    note: () => note,
    /**
     * 老师这一轮（第 turn 轮）带不带旁听那一节：一份发现只带进一轮——第一次要的那一轮记下来，同一轮再要（提前想、真发的那一条）照样给，
     * 下一轮就不给了（整支审查：以前同一份连着塞进三轮）
     */
    section(turn) {
      if (!note) return '';
      if (note.usedAt !== undefined && note.usedAt !== turn) return '';
      const s = watchSection(note, { seq: turn });
      if (s) note.usedAt = turn;
      return s;
    },
    /** 刷新以后照记录放回最后一次的发现 */
    set: (n) => { note = n; },
    get busy() { return inFlight; },
  };
}

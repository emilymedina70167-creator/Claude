// 模拟课的钟、课后测验的检查（evals/teaching/）：不碰子进程的纯函数，tests/teach-sim-lib.test.js 守着。
// 一节课多长按学生真的用掉的时间算，不按轮数：读要时间、点一下要时间、写要时间，
// 这样「只看不动」和「动手写」在钟上不一样，量得出老师有没有让学生动手。

export const COSTS = { readPerMin: 400, pick: 10, line: 30, lineChars: 30, sayPer10: 5, wait: 8 };

/** 学生看到的字数（不数空白） */
export const shownChars = (text) => String(text ?? '').replace(/\s+/g, '').length;

/** 点一下、选一个（quiz 有选项、steps 的选择步、演示组件的 ask）；judge() 给记录补了 closed */
export const isClosed = (rec) => !!rec?.closed;

const writtenOf = (rec) => String(rec?.text ?? rec?.value ?? '').replace(/\s+/g, '');

/** 学生自己写出了东西（放弃、点选、只写一个字都不算产出） */
export function isProduce(rec) {
  if (!rec || rec.closed || rec.giveup || rec.type === 'giveup') return false;
  return writtenOf(rec).length >= 2;
}

/** 这次作答花学生多少秒：点选固定；写的按每行 lineChars 个字算行，至少一行 */
export function actSeconds(rec) {
  if (isClosed(rec)) return COSTS.pick;
  return Math.max(1, Math.ceil(writtenOf(rec).length / COSTS.lineChars)) * COSTS.line;
}

export const newClock = () => ({ s: 0, firstProduce: null, lastProduce: 0, longestPassive: 0, produce: 0, stops: 0, wasted: 0 });

/** 钟往前走：读、等老师、作答、说话。返回新对象 */
export function tick(clock, { read = 0, wait = false, acts = [], say = '' } = {}) {
  const c = { ...clock };
  c.s += (read / COSTS.readPerMin) * 60;
  if (wait) c.s += COSTS.wait;
  c.s += Math.ceil(shownChars(say) / 10) * COSTS.sayPer10;
  for (const a of acts) {
    const sec = actSeconds(a);
    c.stops += 1;
    // 一上来就选对：停了一下却没产生信息（没暴露任何误解）
    if (isClosed(a) && a.ok === true && a.attempts === 1) c.wasted += 1;
    if (isProduce(a)) {
      c.longestPassive = Math.max(c.longestPassive, c.s - c.lastProduce);
      if (c.firstProduce === null) c.firstProduce = c.s;
      c.produce += sec;
      c.s += sec;
      c.lastProduce = c.s;
    } else c.s += sec;
  }
  return c;
}

const r1 = (x) => Math.round(x * 10) / 10;

/** 一节课能算的指标（分钟保留一位小数） */
export function lessonMetrics(st) {
  const c = st.clock;
  const minutes = c.s / 60;
  return {
    minutes: r1(minutes),
    teacherTurns: (st.turns || []).filter((t) => t.role === 'teacher').length,
    firstProduceMin: c.firstProduce === null ? null : r1(c.firstProduce / 60),
    // 最后一次产出到下课也是一段被动
    longestPassiveMin: r1(Math.max(c.longestPassive, c.s - c.lastProduce) / 60),
    produceMin: r1(c.produce / 60),
    stops: c.stops,
    wastedStops: c.wasted,
    charsPerMin: minutes > 0 ? Math.round((st.shown || 0) / minutes) : 0,
  };
}

/** 场景文件的检查：返回问题列表（空 = 可以用） */
export function checkScenario(sc) {
  const bad = [];
  for (const k of ['id', 'subject', 'persona', 'know']) if (typeof sc?.[k] !== 'string' || !sc[k].trim()) bad.push(`缺 ${k}（字符串）`);
  if (!sc?.pack || typeof sc.pack !== 'object') bad.push('缺 pack');
  const aims = Array.isArray(sc?.aims) ? sc.aims : [];
  if (aims.length < 2 || aims.length > 5) bad.push(`aims 要 2～5 件，现在 ${aims.length} 件`);
  aims.forEach((a, i) => { for (const k of ['id', 'can', 'proof']) if (!a?.[k]) bad.push(`aims[${i}] 缺 ${k}`); });
  const tests = Array.isArray(sc?.posttest) ? sc.posttest : [];
  if (tests.length < 3 || tests.length > 5) bad.push(`posttest 要 3～5 道，现在 ${tests.length} 道`);
  const aimIds = new Set(aims.map((a) => a?.id));
  tests.forEach((p, i) => {
    for (const k of ['id', 'q', 'answer']) if (!p?.[k]) bad.push(`posttest[${i}] 缺 ${k}`);
    if (p?.kind !== 'near' && p?.kind !== 'far') bad.push(`posttest[${i}] 的 kind 要是 near 或 far`);
    if (!aimIds.has(p?.aim)) bad.push(`posttest[${i}] 的 aim「${p?.aim}」不是 aims 里的一件`);
  });
  if (tests.length && !tests.some((p) => p?.kind === 'far')) bad.push('posttest 至少要有一道 far（迁移）');
  if (sc?.minutes !== undefined && !(Number(sc.minutes) > 0)) bad.push('minutes 要是正数（不写按 40）');
  return bad;
}

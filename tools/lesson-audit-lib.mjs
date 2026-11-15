// 量真课（纯函数，不碰文件系统）：一节课按分钟看——老师写了多少字、停了几次、
// 学生第几分钟第一次有要想的产出、最长被动了多久。读文件的是 tools/lesson-audit.mjs。
export const FAST_S = 15;          // 封闭作答离上一件事不到这么多秒就对了：当成白停
export const PASSIVE_GAP_MIN = 10; // 中间空了这么久当成人走开了，不算进时长（和 memory/report.js 算时长的规矩一样）

const MIN = 60_000;
const num = (x) => (Number.isFinite(x) ? x : null);
const round1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
// 真数据里作答的类型放在 kind（toEvidence 把 type 当 kind），任务说明里写的是 type：两处都认
const names = (ev) => [ev?.type, ev?.kind].filter(Boolean).map(String);
const has = (ev, set) => names(ev).some((n) => set.includes(n));

/** 老师这一轮写给学生的字（去空白）。黑板课去掉记忆、计划、预案、为什么这几种块和围栏行；舞台课数引号里的字，{…} 算一个字 */
export function teacherChars(turn, kind) {
  const text = String(turn?.text || '');
  let s;
  if (kind === 'stage') {
    const out = [];
    for (const line of text.split('\n')) {
      if (!/^\s*(say|ask|label|card|goal)\b/.test(line)) continue;
      for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) out.push(m[1].replace(/\{[^}]*\}/g, '□'));
    }
    s = out.join('');
  } else {
    s = text.replace(/^`{3,}board[ \t]+(?:memo|plan|react|why)\b[\s\S]*?^`{3,}[ \t]*$/gm, '').replace(/^`{3,}.*$/gm, '');
  }
  return s.replace(/\s+/g, '').length;
}

const CLOSED = ['quiz', 'tap', 'pick', 'ask', 'stage-tap', 'stage-pick'];
const FREE = ['conjecture', 'thinkbox', 'work', 'translate'];

/** 点一下、选一个的作答（想的东西很少） */
export function isClosedEv(ev) {
  if (!ev) return false;
  if (has(ev, CLOSED)) return true;
  return has(ev, ['steps']) && ev.value != null && ev.value !== '' && !ev.text;
}

/** 学生自己发起的问 */
export function isSelfAsk(ev) {
  if (!ev || (ev.src !== 'say' && ev.src !== 'record' && ev.src)) return false;
  const t = String(ev.text || '').trim();
  if (/^\[指着问\]/.test(t)) return true;
  return ev.src === 'say' && /[？?]$/.test(t);
}

/** 没被页面判的自由作答 */
export const isOpenEv = (ev) => !!ev && ev.src !== 'say' && has(ev, FREE) && typeof ev.ok !== 'boolean';

/** 要想的产出：页面判的非封闭作答、自由作答、带板书图的话、十个字以上且不以问号结尾的话 */
export function isProduceEv(ev) {
  if (!ev || ev.src === 'draft' || ev.src === 'manual') return false;
  if (ev.src === 'say') {
    if (isSelfAsk(ev)) return false;
    if (ev.ink) return true;
    const t = String(ev.text || '').trim();
    return t.length >= 10 && !/[？?]$/.test(t);
  }
  if (ev.src === 'event') return false;
  if (isClosedEv(ev)) return false;
  if (has(ev, FREE)) return true;
  return typeof ev.ok === 'boolean';
}

/** 去掉长空档以后的时间：把相邻时间点的差累加，超过 PASSIVE_GAP_MIN 的当人走开了 */
function activeGaps(times) {
  const ts = [...times].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < ts.length; i++) {
    const d = (ts[i] - ts[i - 1]) / MIN;
    gaps.push(d >= PASSIVE_GAP_MIN ? 0 : d);
  }
  return { ts, gaps };
}

export function auditLesson({ session = {}, turns = [], evidence = [] } = {}) {
  const kind = session.kind === 'stage' ? 'stage' : 'class';
  const teach = turns.filter((t) => t.role === 'claude' && !t.discarded && !t.pending);
  const evs = evidence.filter((e) => e.session === session.id && num(e.at) !== null).sort((a, b) => a.at - b.at);
  // 时间线：老师的轮 + 这节课的证据
  const line = [...teach.filter((t) => num(t.at) !== null).map((t) => ({ at: t.at, ev: null })), ...evs.map((e) => ({ at: e.at, ev: e }))].sort((a, b) => a.at - b.at);
  const { ts, gaps } = activeGaps(line.map((x) => x.at));
  const minutes = ts.length >= 2 ? round1(gaps.reduce((a, b) => a + b, 0)) : null;
  const t0 = ts.length ? ts[0] : null;
  // 某个时间点是开课后第几分钟（扣掉长空档）
  const at = (time) => { let m = 0; for (let i = 1; i < ts.length && ts[i] <= time; i++) m += gaps[i - 1]; return m; };

  const chars = teach.reduce((n, t) => n + teacherChars(t, kind), 0);
  const firsts = teach.map((t) => num(t.cost?.first)).filter((x) => x !== null);
  const writes = teach.map((t) => num(t.cost?.ms)).filter((x) => x !== null);

  // 停了几次：封闭作答；白停 = 第一次就对、离上一件事不到 FAST_S 秒
  const stops = { total: 0, wasted: 0, byKind: {} };
  line.forEach((x, i) => {
    const e = x.ev;
    if (!e || !isClosedEv(e)) return;
    stops.total++;
    const k = e.type && e.type !== 'answer' ? e.type : e.kind || 'answer';
    stops.byKind[k] = (stops.byKind[k] || 0) + 1;
    const prev = i ? line[i - 1].at : null;
    if (e.ok === true && (e.attempts == null || e.attempts <= 1) && prev !== null && (e.at - prev) / 1000 < FAST_S) stops.wasted++;
  });

  const prod = evs.filter(isProduceEv);
  const prodMin = prod.map((e) => at(e.at));
  let longest = null;
  if (minutes !== null) {
    const pts = [0, ...prodMin, minutes];
    longest = 0;
    for (let i = 1; i < pts.length; i++) longest = Math.max(longest, pts[i] - pts[i - 1]);
  }
  const prodMs = prod.map((e) => num(e.ms)).filter((x) => x !== null);

  return {
    id: session.id ?? null, kind, title: session.title ?? null, space: session.space ?? session.subject ?? null, closedBy: session.closedBy ?? null,
    minutes,
    teacher: {
      turns: teach.length, chars,
      charsPerMin: minutes ? round1(chars / minutes) : null,
      firstS: round1(avg(firsts) === null ? null : avg(firsts) / 1000),
      writeS: round1(avg(writes) === null ? null : avg(writes) / 1000),
      waitMin: writes.length ? round1(writes.reduce((a, b) => a + b, 0) / MIN) : null,
    },
    stops,
    produce: {
      count: prod.length,
      firstMin: prod.length && t0 !== null ? round1(prodMin[0]) : null,
      longestPassiveMin: round1(longest),
      minutes: prodMs.length ? round1(prodMs.reduce((a, b) => a + b, 0) / MIN) : null,
    },
    asks: { self: evs.filter(isSelfAsk).length },
    open: { count: evs.filter(isOpenEv).length },
    aims: null, later: null,
  };
}

const f = (x, unit = '') => (x === null || x === undefined ? '没记' : `${x}${unit}`);

/** 一节课一段的文字表 */
export function auditText(audits) {
  return audits.map((a) => [
    `${a.id}  ${a.kind === 'stage' ? '舞台课' : '黑板课'}  ${a.space || ''} ${a.title || ''}${a.closedBy === 'idle' ? '（挂着被页面当下课）' : ''}`.trimEnd(),
    `  时长 ${f(a.minutes, ' 分钟')}；老师 ${a.teacher.turns} 轮、${a.teacher.chars} 字（每分钟 ${f(a.teacher.charsPerMin)} 字）；出第一个字 ${f(a.teacher.firstS, ' 秒')}、写完 ${f(a.teacher.writeS, ' 秒')}、一共等了 ${f(a.teacher.waitMin, ' 分钟')}`,
    `  停了 ${a.stops.total} 次（白停 ${a.stops.wasted}）${Object.keys(a.stops.byKind).length ? '：' + Object.entries(a.stops.byKind).map(([k, v]) => `${k}×${v}`).join(' ') : ''}`,
    `  学生要想的产出 ${a.produce.count} 次；第一次在第 ${f(a.produce.firstMin)} 分钟；最长被动 ${f(a.produce.longestPassiveMin, ' 分钟')}；产出花了 ${f(a.produce.minutes, ' 分钟')}`,
    `  自己发起的问 ${a.asks.self} 次；没被页面判的自由作答 ${a.open.count} 次`,
  ].join('\n')).join('\n\n');
}

// 抽卷算分布、首页要的整张表（spec 6.3、6.4）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecast, forecastBoard } from '../kit/src/forecast/forecast.js';
import { toEvidence } from '../kit/src/memory/session.js';
import { toAnswer } from '../kit/src/live/sync.js';

const DAY = 86400000;
const T0 = Date.parse('2026-11-01T10:00:00');
const at = (d, min = 0) => T0 + d * DAY + min * 60000;
let n = 0;
function rec({ comp, ok, d = 0, min = 0, session = 'c-1', block = 'DS-L2.1.1', extra = {} }) {
  const ev = toEvidence('record', toAnswer({ type: 'answer', block: comp, q: '题', ok, attempts: 1, final: true, at: at(d, min) }), { session, block });
  return { ...ev, id: `ev-${++n}`, ...extra };
}
const curriculum = [
  { id: 'DS-L2', level: 'lecture', title: '线性表' },
  { id: 'DS-L2.1.1', level: 'block', title: '顺序表' },
  { id: 'DS-L2.1.2', level: 'block', title: '链表' },
  { id: 'L1', level: 'lecture', title: '第1讲 行列式' },
  { id: 'L1.1.1', level: 'block', title: '排列' },
];
const OPT = { day: '2026-11-14', seed: 42 };
const ok = (x) => Number.isFinite(x);

test('空记忆库也出数', () => {
  const f = forecast({}, OPT);
  assert.equal(f.subjects.length, 4);
  for (const s of f.subjects) assert.ok(ok(s.median) && s.lo <= s.median && s.median <= s.hi && s.hi <= s.full, s.key);
  assert.ok(ok(f.total.median) && f.total.median > 0, '猜对的底不是 0');
  assert.equal(f.measured, 0);
  assert.ok(f.pGoal >= 0 && f.pGoal <= 1);
  assert.equal(f.pLines, null);
});

test('同样的数据一样的数', () => {
  const m = { curriculum, evidence: [rec({ comp: 'a', ok: true })] };
  assert.deepEqual(forecast(m, OPT), forecast(m, OPT));
});

test('真题做对的块涨分', () => {
  const base = forecast({ curriculum }, OPT);
  const ex = (i) => rec({ comp: `q${i}`, ok: true, min: i, extra: { exam: `Q-408-2015-0${i}` } });
  const f = forecast({ curriculum, evidence: [ex(1), ex(2), ex(3)] }, OPT);
  const cs = (x) => x.subjects.find((s) => s.key === 'cs').median;
  assert.ok(cs(f) > cs(base));
  assert.ok(f.measured > 0);
  assert.ok(f.units['DS-L2.1.1'].measured && f.units['DS-L2.1.1'].n === 3);
});

test('一道题动不了大局', () => {
  const evs = [1, 2, 3].map((i) => rec({ comp: `q${i}`, ok: true, min: i, extra: { exam: `Q-408-2015-0${i}` } }));
  const a = forecast({ curriculum, evidence: evs }, OPT);
  const b = forecast({ curriculum, evidence: [...evs, rec({ comp: 'q9', ok: false, min: 9, extra: { exam: 'Q-408-2016-01' } })] }, OPT);
  assert.ok(Math.abs(a.total.median - b.total.median) <= a.units['DS-L2.1.1'].points + 1e-9);
});

test('到考试那天不高于今天', () => {
  const evs = [rec({ comp: 'a', ok: true }), rec({ comp: 'b', ok: true, d: 3, session: 'c-2' }), rec({ comp: 'c', ok: true, d: 9, session: 'c-3' })];
  const m = { curriculum, evidence: evs };
  const b = forecastBoard(m, { today: '2026-11-14' });
  assert.ok(b.exam.total.median <= b.now.total.median);
  assert.ok(b.exam.units['DS-L2.1.1'].r < b.now.units['DS-L2.1.1'].r);
  assert.ok(ok(b.week.delta));
  assert.ok(b.gain.length && b.gain.every((g) => g.gain >= 0));
});

test('考试那天以后', () => {
  const m = { curriculum, evidence: [rec({ comp: 'a', ok: true })] };
  const b = forecastBoard(m, { today: '2028-01-05' });
  assert.ok(ok(b.exam.total.median));
  for (const u of Object.values(b.exam.units)) assert.ok(u.r <= 1);
});

test('够快', () => {
  const cur = [];
  for (let c = 1; c <= 20; c++) { cur.push({ id: `DS-L${c}`, level: 'lecture', title: `第${c}章` }); for (let b = 1; b <= 10; b++) cur.push({ id: `DS-L${c}.1.${b}`, level: 'block', title: `块${b}` }); }
  const evs = [];
  for (let i = 0; i < 2000; i++) evs.push(rec({ comp: `q${i}`, ok: i % 3 !== 0, d: Math.floor(i / 20), session: `c-${Math.floor(i / 20)}`, block: `DS-L${1 + (i % 20)}.1.${1 + (i % 10)}` }));
  const m = { curriculum: cur, evidence: evs };
  forecastBoard(m, { today: '2026-11-14' });
  // 量这个进程用的 CPU 时间、取三次里最少的一次：整套测试是并行跑的，别的文件抢 CPU 时墙上的用时说明不了代码本身
  // （单独跑墙上约 75 毫秒、CPU 约 90 毫秒；iPad 的要求是 200 毫秒以内）
  let ms = Infinity;
  for (let i = 0; i < 3; i++) { const c0 = process.cpuUsage(); forecastBoard(m, { today: '2026-11-14' }); const c = process.cpuUsage(c0); ms = Math.min(ms, (c.user + c.system) / 1000); }
  assert.ok(ms < 120, `用了 ${ms.toFixed(0)} 毫秒`);
});

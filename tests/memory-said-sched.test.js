// 第十一轮 A2：话的账什么时候跑（said.js 的 saidTimer：课上隔 20 秒）、试满两次交教研室（sentry.js 的 workOrder）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saidTimer } from '../kit/src/memory/said.js';
import { workOrder } from '../kit/src/memory/sentry.js';

function clock() {
  let t = 0;
  const timers = new Map();
  let n = 0;
  return {
    setTimer: (fn, ms) => { const id = ++n; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    // 到点的就叫起来，不等它跑完（跑得久的那一次要测「在跑的时候又来一句」）
    async tick(ms) { t += ms; for (const [id, x] of [...timers]) if (x.at <= t) { timers.delete(id); x.fn(); } await new Promise((r) => setTimeout(r, 0)); },
  };
}

test('隔 20 秒没再打才跑，连打两句只跑一次', async () => {
  const c = clock();
  let runs = 0;
  const tm = saidTimer({ run: async () => { runs++; }, wait: 20000, setTimer: c.setTimer, clearTimer: c.clearTimer });
  tm.poke();
  await c.tick(5000);
  tm.poke();
  await c.tick(19000);
  assert.equal(runs, 0);
  await c.tick(1000);
  assert.equal(runs, 1);
});

test('在跑的时候又打了一句：跑完再跑一次', async () => {
  const c = clock();
  let runs = 0;
  let release;
  const tm = saidTimer({ run: () => { runs++; return runs === 1 ? new Promise((r) => { release = r; }) : Promise.resolve(); }, wait: 20000, setTimer: c.setTimer, clearTimer: c.clearTimer });
  tm.poke();
  await c.tick(20000);
  assert.equal(runs, 1);
  tm.poke();
  await c.tick(20000);
  assert.equal(runs, 1, '还在跑，不另开一次');
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(runs, 2);
});

test('flush 立刻跑（下课、离开课堂）', async () => {
  const c = clock();
  let runs = 0;
  const tm = saidTimer({ run: async () => { runs++; }, wait: 20000, setTimer: c.setTimer, clearTimer: c.clearTimer });
  tm.poke();
  await tm.flush();
  assert.equal(runs, 1);
  await c.tick(20000);
  assert.equal(runs, 1, 'flush 以后定时器取消了');
});

test('过账试满两次：工作单出一张 said 单子；一次不出', () => {
  const base = { sessions: [{ id: 'c-20261114-2', kind: 'stage', status: 'open', space: 'en', block: 'EN-L1.2.1', date: '2026-11-14', said: { fails: 2, upTo: 0 } }], evidence: [{ id: 'ev-a', session: 'c-20261114-2', src: 'say', text: '别重叠', at: 100 }] };
  const wo = workOrder(base, { today: '2026-11-14', now: 200 });
  assert.ok(wo.some((x) => x.kind === 'said' && x.ref === 'c-20261114-2'));
  const one = workOrder({ ...base, sessions: [{ ...base.sessions[0], said: { fails: 1 } }] }, { today: '2026-11-14', now: 200 });
  assert.ok(!one.some((x) => x.kind === 'said'));
});

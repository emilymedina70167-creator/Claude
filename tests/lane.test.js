import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLane } from '../kit/src/lane.js';

const later = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

test('lane：讲课的调用马上发；后台的等讲课的跑完再发，一次一个', async () => {
  const lane = createLane();
  const log = [];
  const t = later();
  const teach = lane.run('fg', () => { log.push('teach'); return t.p; });
  const b1 = later(), b2 = later();
  const bg1 = lane.run('bg', () => { log.push('bg1'); return b1.p; });
  const bg2 = lane.run('bg', () => { log.push('bg2'); return b2.p; });
  await tick();
  assert.deepEqual(log, ['teach'], '讲课在跑：后台不开');
  t.resolve('ok');
  assert.equal(await teach, 'ok');
  await tick();
  assert.deepEqual(log, ['teach', 'bg1'], '一次只开一个后台');
  // 后台在跑时来了讲课的：照样马上发
  const t2 = later();
  lane.run('fg', () => { log.push('teach2'); return t2.p; });
  assert.deepEqual(log, ['teach', 'bg1', 'teach2']);
  b1.resolve(1);
  assert.equal(await bg1, 1);
  await tick();
  assert.deepEqual(log, ['teach', 'bg1', 'teach2'], '讲课的还在跑：下一个后台等着');
  t2.resolve();
  await tick(); await tick();
  assert.deepEqual(log, ['teach', 'bg1', 'teach2', 'bg2']);
  b2.resolve(2);
  assert.equal(await bg2, 2);
  await tick();
  assert.deepEqual(lane.state, { fg: 0, bg: 0, waiting: 0 });
});

test('lane：排队时取消就不发；失败不卡住后面的', async () => {
  const lane = createLane();
  const t = later();
  lane.run('fg', () => t.p);
  const ctl = new AbortController();
  let sent = false;
  const q = lane.run('bg', () => { sent = true; }, { signal: ctl.signal });
  ctl.abort();
  await assert.rejects(q, (e) => e.code === 'cancelled');
  const bad = lane.run('bg', () => Promise.reject(new Error('坏了')));
  const good = lane.run('bg', () => 'ok');
  t.resolve();
  await assert.rejects(bad, /坏了/);
  assert.equal(await good, 'ok');
  assert.equal(sent, false);
  // 讲课的出错也放行后台
  const lane2 = createLane();
  await assert.rejects(lane2.run('fg', () => { throw new Error('x'); }));
  assert.equal(await lane2.run('bg', () => 5), 5);
});

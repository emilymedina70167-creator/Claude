import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COSTS, shownChars, isProduce, actSeconds, newClock, tick, lessonMetrics, checkScenario } from '../tools/teach-sim-lib.mjs';

test('读 400 个字是一分钟，等一轮 8 秒', () => {
  const c = tick(newClock(), { read: 400, wait: true });
  assert.equal(c.s, 68);
});
test('选一下 10 秒；一上来就选对算一次没产生信息的停，不算产出', () => {
  const c = tick(newClock(), { acts: [{ closed: true, ok: true, attempts: 1, value: 'B' }] });
  assert.deepEqual([c.s, c.stops, c.wasted, c.firstProduce], [10, 1, 1, null]);
});
test('选错、第二次才选对都不算白停', () => {
  const a = tick(newClock(), { acts: [{ closed: true, ok: false, attempts: 1, value: 'A' }] });
  const b = tick(newClock(), { acts: [{ closed: true, ok: true, attempts: 2, value: 'B' }] });
  assert.deepEqual([a.wasted, b.wasted], [0, 0]);
});
test('写 65 个字是三行 90 秒，算产出；之前被动了多久记下来', () => {
  let c = tick(newClock(), { read: 2000, wait: true }); // 308 秒
  c = tick(c, { acts: [{ closed: false, ok: null, attempts: 1, text: '字'.repeat(65) }] });
  assert.deepEqual([c.firstProduce, c.longestPassive, c.produce, c.s], [308, 308, 90, 398]);
});
test('放弃、只写一个字不算产出', () => {
  assert.equal(isProduce({ closed: false, giveup: true }), false);
  assert.equal(isProduce({ closed: false, value: '对' }), false);
  assert.equal(actSeconds({ closed: false, value: '对' }), COSTS.line);
});
test('下课前最后一段没产出也算进最长被动', () => {
  let c = tick(newClock(), { acts: [{ closed: false, attempts: 1, text: '一行推导一行推导' }] }); // 30 秒
  c = tick(c, { read: 4000 }); // 再读 10 分钟
  const m = lessonMetrics({ clock: c, turns: [{ role: 'teacher', bytes: 0 }], shown: 4000 });
  assert.equal(m.longestPassiveMin, 10);
  assert.equal(m.firstProduceMin, 0);
});
test('shownChars 不数空白', () => assert.equal(shownChars(' 甲 乙\n丙 '), 3));
test('场景要有 2～5 件要拿下的事、3～5 道课后题、至少一道要迁移', () => {
  const ok = { id: 'x', subject: '操作系统', pack: {}, persona: 'p', know: 'k',
    aims: [{ id: 'a1', can: 'c', proof: 'p' }, { id: 'a2', can: 'c', proof: 'p' }],
    posttest: [{ id: 'p1', q: 'q', answer: 'a', kind: 'near', aim: 'a1' }, { id: 'p2', q: 'q', answer: 'a', kind: 'far', aim: 'a2' }, { id: 'p3', q: 'q', answer: 'a', kind: 'near', aim: 'a1' }] };
  assert.deepEqual(checkScenario(ok), []);
  assert.ok(checkScenario({ ...ok, aims: [ok.aims[0]] }).length);
  assert.ok(checkScenario({ ...ok, posttest: ok.posttest.map((p) => ({ ...p, kind: 'near' })) }).length);
  assert.ok(checkScenario({ ...ok, posttest: [{ ...ok.posttest[0], aim: 'a9' }, ...ok.posttest.slice(1)] }).length);
});
test('放弃一道题按点一下算（10 秒），不按写一行', () => {
  assert.equal(actSeconds({ closed: false, giveup: true }), COSTS.pick);
  assert.equal(actSeconds({ type: 'giveup', closed: false }), COSTS.pick);
});

// 到时间不只在老师那一轮判：学生连着几轮被预案接住、或者说了很长一段话，钟一样走到头
const SIM = new URL('../tools/teach-sim.mjs', import.meta.url).pathname;
test('学生那一轮用完了时间：打印「到时间了」，之后老师再调用报错', () => {
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'tsim-'));
  const sc = { id: 'x', subject: '操作系统', pack: { main: { unit: 'LRU' } }, persona: 'p', know: 'k', minutes: 0.2,
    aims: [{ id: 'a1', can: 'c', proof: 'p' }, { id: 'a2', can: 'c', proof: 'p' }],
    posttest: [{ id: 'p1', q: 'q', answer: 'a', kind: 'near', aim: 'a1' }, { id: 'p2', q: 'q', answer: 'a', kind: 'far', aim: 'a2' }, { id: 'p3', q: 'q', answer: 'a', kind: 'near', aim: 'a1' }] };
  fs.writeFileSync(path.join(D, 'sc.json'), JSON.stringify(sc));
  fs.writeFileSync(path.join(D, 't1.txt'), '看。\n\n```board new id=b1 title=LRU\n换最久没用的。\n```\n');
  fs.writeFileSync(path.join(D, 's1.json'), JSON.stringify({ say: '我想再问一下这个到底是怎么回事，'.repeat(4), acts: [] }));
  const run = D + '/run';
  execFileSync('node', [SIM, 'init', run, D + '/sc.json']);
  const t = execFileSync('node', [SIM, 'teacher', run, D + '/t1.txt'], { encoding: 'utf8' });
  assert.ok(!t.includes('到时间了'));
  const s = execFileSync('node', [SIM, 'student', run, D + '/s1.json'], { encoding: 'utf8' });
  assert.equal(s.trim().split('\n').at(-1), '到时间了');
  assert.equal(JSON.parse(fs.readFileSync(run + '/state.json', 'utf8')).over, true);
  assert.equal(spawnSync('node', [SIM, 'teacher', run, D + '/t1.txt']).status, 1);
  fs.rmSync(D, { recursive: true, force: true });
});
test('自由作答（conjecture）写的字原样发给老师，不是「没写内容」', () => {
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'tsim-'));
  const sc = { id: 'x', subject: '操作系统', pack: { main: { unit: 'LRU' } }, persona: 'p', know: 'k',
    aims: [{ id: 'a1', can: 'c', proof: 'p' }, { id: 'a2', can: 'c', proof: 'p' }],
    posttest: [{ id: 'p1', q: 'q', answer: 'a', kind: 'near', aim: 'a1' }, { id: 'p2', q: 'q', answer: 'a', kind: 'far', aim: 'a2' }, { id: 'p3', q: 'q', answer: 'a', kind: 'near', aim: 'a1' }] };
  fs.writeFileSync(path.join(D, 'sc.json'), JSON.stringify(sc));
  fs.writeFileSync(path.join(D, 't1.txt'), '说说看。\n\n````board new id=b1 title=LRU\n```conjecture\nid: cj1\nq: 为什么换 2？\n```\n````\n');
  fs.writeFileSync(path.join(D, 's1.json'), JSON.stringify({ say: '', acts: [{ comp: 'cj1', value: '页 1 刚被访问过' }] }));
  const run = D + '/run';
  execFileSync('node', [SIM, 'init', run, D + '/sc.json']);
  execFileSync('node', [SIM, 'teacher', run, D + '/t1.txt']);
  execFileSync('node', [SIM, 'student', run, D + '/s1.json']);
  const msg = fs.readFileSync(run + '/to-teacher.md', 'utf8');
  assert.ok(msg.includes('页 1 刚被访问过') && !msg.includes('没写内容'), msg.slice(-300));
  fs.rmSync(D, { recursive: true, force: true });
});

// 计划 2 最后的整体审查查出来的几处（一处一条测试，先红后绿）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck, selfCheck } from '../kit/src/check/spec.js';
import { createFlow, step, view } from '../kit/src/check/flow.js';
import { evidenceOf, flushIds } from '../kit/src/check/record.js';
import { fitStrokes, decodeStrokes } from '../kit/src/check/inktime.js';
import { guardCandidate, buildCorpus } from '../kit/src/memory/guard.js';
import { tickMs, screenKey, tooSoon, lockState } from '../kit/src/check/shellkit.js';
import { uploadAll, canJudge, callerFor, retestResults } from '../kit/src/check/judgekit.js';

const F = '```';
const rec = (id, { retry = [], teach = 'teach default: 先乘开。' } = {}) => `${F}recall\nid: ${id}\nq: 写 ${id}\ntarget: T-${id}\nlevel: 核心\nmust m1: 要点\n${teach}\n${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const con = (id, { retry = [] } = {}) => `${F}construct\nid: ${id}\nq: 造 ${id}\ntarget: L2-14\nlevel: 基础\nslots: A=mat(2)\nif: A != O => 零矩阵不算\nexample: A=[[1,0],[0,0]]\nteach if1: 不要零矩阵。\n${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const OK = { items: [{ id: 'if1', ok: true }], needsClaude: false, stop: false };
const BAD = { items: [{ id: 'if1', ok: false, why: '零矩阵不算' }], needsClaude: false, stop: false };
const CL = { items: [], needsClaude: true, stop: false };

test('审查 1：复测拿不到页面里的 Claude 时不用模拟老师（只在 ?dev 用）', () => {
  assert.equal(callerFor({ dev: false, ai: null }), null);
  assert.equal(callerFor({ dev: false, ai: { call() {} } }), 'ai');
  assert.equal(callerFor({ dev: true, ai: null }), 'mock');
});

test('审查 2：熄屏回来的那一下不把整段熄屏时间算进限时', () => {
  assert.equal(tickMs(1000, 2000), 1000);
  assert.equal(tickMs(1000, 1000 + 10 * 60000), 2000);
  assert.equal(tickMs(5000, 4000), 0);
});

test('审查 3：补讲的字到了要重画（画面的键带着补讲在不在写）', () => {
  const a = screenKey({ show: 'teach', id: 'p1', teach: { key: 'claude', text: null } });
  const b = screenKey({ show: 'teach', id: 'p1', teach: { key: 'claude', text: '先乘开。' } });
  assert.notEqual(a, b);
  assert.equal(screenKey({ show: 'probe', id: 'p2' }), screenKey({ show: 'probe', id: 'p2', left: 3 }));
});

test('审查 5：检验记的错题，守卫认得出「我写的」就是挂的那条证据', () => {
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p1', con('p1', { retry: ['p1a', 'p1b'] }), con('p1a'), con('p1b')].join('\n'));
  let s = step(createFlow(check), { type: 'start', at: 1 });
  s = step(s, { type: 'submit', id: 'p1', answer: { slots: { A: [['0', '0'], ['0', '0']] } }, sure: 'sure', ms: 1, machine: BAD, at: 2 });
  const ev = evidenceOf(s, 'p1', { ctx: { session: 'c-1' } });
  assert.equal(ev.text, ev.first);
  const mem = { evidence: [ev], curriculum: [{ id: 'L2.1.1' }] };
  const g = guardCandidate({ coll: 'errors', id: 'L2-60', doc: { q: '造', mine: ev.first, step: 'if1', cause: 'L2-14', evidence: [ev.id], date: '2026-11-18', block: 'L2.1.1' }, author: 'class', session: 'c-1' }, { mem, corpus: buildCorpus({ evidence: [ev] }) });
  assert.ok(!g.checks.some((c) => c.code === 'mine-mismatch'), JSON.stringify(g.checks));
});

test('审查 7：停下、下课时交了还没定下来的题也要写证据', () => {
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p1,p2', con('p1', { retry: ['p1a', 'p1b'] }), con('p1a'), con('p1b'), rec('p2', { retry: ['p2a', 'p2b'] }), rec('p2a'), rec('p2b')].join('\n'));
  let s = step(createFlow(check), { type: 'start', at: 1 });
  s = step(s, { type: 'submit', id: 'p1', answer: {}, sure: 'sure', ms: 1, machine: BAD, at: 2 }); // 在补讲
  assert.deepEqual(flushIds(s), ['p1']);
  s = step(s, { type: 'teachSeen', id: 'p1', at: 3 });
  s = step(s, { type: 'submit', id: 'p1a', answer: {}, sure: 'sure', ms: 1, machine: OK, at: 4 });
  s = step(s, { type: 'submit', id: 'p2', answer: { text: 'x' }, sure: 'sure', ms: 1, machine: CL, at: 5 }); // 在判
  s = step(s, { type: 'recorded', ids: ['p1', 'p1a'] });
  assert.deepEqual(flushIds(s), ['p2']);
});

test('审查 9：传图有超时，一张卡住不卡住交卷；拿到的是 null', async () => {
  const never = () => new Promise(() => {});
  const r = await uploadAll([new Uint8Array(1), new Uint8Array(2)], async (b) => (b.length === 1 ? 'a1' : never()), { ms: 50 });
  assert.deepEqual(r, ['a1', null]);
  assert.deepEqual(await uploadAll([null], async () => 'x', { ms: 50 }), [null]);
});

test('审查 10：笔画存档压得进 200 KiB（三千笔），读回来是原来的样子', () => {
  const strokes = Array.from({ length: 3000 }, (_, i) => {
    const pts = [];
    for (let k = 0; k < 20; k++) pts.push(10.37 + i % 50 * 12 + k * 0.5, 20.91 + Math.floor(i / 50) * 30 + Math.sin(k), 2.21);
    return { color: 'white', pts, bbox: [0, 0, 1, 1], t0: i * 1000, t1: i * 1000 + 800, ...(i % 7 === 0 ? { struck: i * 1000 + 900 } : {}) };
  });
  const r = fitStrokes(strokes);
  assert.ok(JSON.stringify(r).length <= 200 * 1024, String(JSON.stringify(r).length));
  const back = decodeStrokes(r);
  assert.equal(back.length, 3000);
  assert.equal(back[7].struck, 7900);
  assert.ok(back[0].pts.length >= 6 && back[0].bbox.length === 4);
  // 小的照原样（不抽样）
  const small = decodeStrokes(fitStrokes(strokes.slice(0, 3)));
  assert.equal(small[0].pts.length, 60);
});

test('审查 11：同一道 retry 给两道题用、retry 又排进了 block：自检拦住', () => {
  const shared = parseCheck('check id=k1', ['block L2.1.1 must=p1,p2', con('p1', { retry: ['x1', 'x2'] }), con('p2', { retry: ['x1', 'x3'] }), con('x1'), con('x2'), con('x3')].join('\n')).check;
  assert.ok(selfCheck(shared).some((e) => /x1/.test(e) && /两道题/.test(e)), selfCheck(shared).join('\n'));
  const placed = parseCheck('check id=k1', ['block L2.1.1 must=p1,x1', con('p1', { retry: ['x1', 'x2'] }), con('x1'), con('x2')].join('\n')).check;
  assert.ok(selfCheck(placed).some((e) => /x1/.test(e) && /retry/.test(e) && /block|spare/.test(e)), selfCheck(placed).join('\n'));
});

test('审查 12：复测只记出了题的块；待核的 ok 是 null', () => {
  const absorbs = { 'L2.1.4': { state: '成功' }, 'L2.1.1': { state: '待核' } };
  const r = retestResults(absorbs, [{ block: 'L2.1.4', days: 1 }, { block: 'L2.1.1', days: 1 }, { block: 'L3.1.1', days: 7 }]);
  assert.deepEqual(r, [{ block: 'L2.1.4', days: 1, ok: true }, { block: 'L2.1.1', days: 1, ok: null }]);
  assert.deepEqual(retestResults({ 'L2.1.4': { state: '部分' } }, [{ block: 'L2.1.4', days: 1 }]), [{ block: 'L2.1.4', days: 1, ok: false }]);
});

test('审查 13：手写的题图取不到、又没打字：不判（待核）；上传失败 final 是 null 也一样', () => {
  assert.equal(canJudge({ ink: { final: 'a1' } }, []), false);
  assert.equal(canJudge({ ink: { final: null } }, []), false);
  assert.equal(canJudge({ ink: { final: null } }, [new Uint8Array(1)]), true);
  assert.equal(canJudge({ ink: { final: 'a1' }, text: '也打了字' }, []), true);
  assert.equal(canJudge({ text: '打字的' }, []), true);
});

test('审查 14：两个标签页：别的页刚写过心跳就不开', () => {
  assert.equal(lockState(null, 'me', 1000), 'mine');
  assert.equal(lockState({ id: 'other', at: 900 }, 'me', 1000), 'other');
  assert.equal(lockState({ id: 'other', at: 900 }, 'me', 900 + 10000), 'mine');
  assert.equal(lockState({ id: 'me', at: 900 }, 'me', 1000), 'mine');
});

test('审查 16：换屏以后马上的那一下点不算（连点两下「想不出来」不放弃下一道）', () => {
  assert.equal(tooSoon(1000, 1300), true);
  assert.equal(tooSoon(1000, 1600), false);
});

test('审查（升格）：外部改判拿走了等着的最后一道，不停在「还在判」', () => {
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p1', rec('p1', { retry: ['p1a', 'p1b'] }), rec('p1a'), rec('p1b')].join('\n'));
  let s = step(createFlow(check), { type: 'start', at: 1 });
  s = step(s, { type: 'submit', id: 'p1', answer: { text: 'x' }, sure: 'sure', ms: 1, machine: CL, at: 2 });
  assert.equal(view(s).show, 'wait');
  s = step(s, { type: 'ext', id: 'p1', items: [{ id: 'm1', ok: true }], result: 'pass', at: 3 });
  assert.equal(view(s).show, 'done');
});

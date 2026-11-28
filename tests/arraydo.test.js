import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doStart, doTap, doApply, doUndo, doOpText, doEncode, doDecode, doSeq, doCheck } from '../kit/src/arraydo.js';

const F = { array: "49 38 65 97 76 13 27 49'", ptrs: 'low=1 high=8', temp: 'pivot', goal: "27 38 13 49 76 97 65 49'" };
const run = (state, taps) => taps.reduce((s, [a, b]) => doApply(s, doTap(s, a, b)), state);
const c = (p) => ({ cell: p });
const p = (name) => ({ ptr: name });

test('两个都有数：交换', () => {
  const s0 = doStart({ array: '3 1 2' });
  const op = doTap(s0, c(1), c(3));
  assert.deepEqual(op, { kind: 'swap', i: 1, j: 3 });
  assert.equal(doOpText(op, s0), '交换 A[1]、A[3]（3 和 2）');
  assert.equal(doSeq(doApply(s0, op)), '2 1 3');
});

test('填坑：拿到暂存格，别的挪进空位，再放回来', () => {
  const s0 = doStart(F);
  const take = doTap(s0, c(1), c(0));
  assert.deepEqual(take, { kind: 'move', from: 1, to: 0 });
  assert.equal(doOpText(take, s0), 'A[1] 的 49 挪到 pivot');
  const s1 = doApply(s0, take);
  assert.equal(doSeq(s1), "_ 38 65 97 76 13 27 49′");
  const fill = doTap(s1, c(7), c(1));
  assert.equal(doOpText(fill, s1), 'A[7] 的 27 挪到 A[1]');
  const s2 = doApply(s1, fill);
  const back = doTap(s2, c(0), c(7));
  assert.equal(doOpText(back, s2), 'pivot 的 49 挪到 A[7]');
  assert.equal(doSeq(doApply(s2, back)), "27 38 65 97 76 13 49 49′");
});

test('指针：点指针再点格子', () => {
  const s0 = doStart(F);
  const op = doTap(s0, p('high'), c(7));
  assert.deepEqual(op, { kind: 'ptr', name: 'high', from: 8, to: 7 });
  assert.equal(doOpText(op, s0), 'high：8 → 7');
  assert.equal(doApply(s0, op).ptrs.find((x) => x.name === 'high').at, 7);
  assert.throws(() => doTap(s0, p('high'), c(0)), /暂存/);
});

test('点得不成一步的：报出来', () => {
  const s0 = doStart(F);
  assert.throws(() => doTap(s0, c(2), c(2)), /同一个/);
  assert.throws(() => doTap(s0, c(0), c(3)), /空的/);
  assert.throws(() => doTap(s0, p('low'), p('high')), /格子/);
  assert.throws(() => doTap(s0, c(2), p('low')), /格子/);
});

test('撤回、编码来回', () => {
  const s0 = doStart(F);
  const s3 = run(s0, [[c(1), c(0)], [p('high'), c(7)], [c(7), c(1)]]);
  assert.equal(s3.history.length, 3);
  const s2 = doUndo(s3);
  assert.equal(doSeq(s2), "_ 38 65 97 76 13 27 49′");
  assert.equal(doUndo(doUndo(doUndo(s2))).history.length, 0);
  const codes = s3.history.map(doEncode);
  assert.deepEqual(codes, ['m1>0', 'p:high:8>7', 'm7>1']);
  const again = codes.reduce((s, t) => doApply(s, doDecode(t)), s0);
  assert.equal(doSeq(again), doSeq(s3));
  assert.equal(doEncode({ kind: 'swap', i: 2, j: 5 }), 's2-5');
  assert.deepEqual(doDecode('s2-5'), { kind: 'swap', i: 2, j: 5 });
  assert.equal(doDecode('乱写'), null);
});

test('做完了：有空位、暂存格没放回、和要的不一样、对了', () => {
  const s0 = doStart(F);
  const s1 = run(s0, [[c(1), c(0)]]);
  assert.match(doCheck(s1).why, /空/);
  assert.equal(doCheck(s1).ok, false);
  assert.equal(doCheck(s0).ok, false);
  assert.match(doCheck(s0).why, /不一样/);
  const done = run(s0, [[c(1), c(0)], [c(7), c(1)], [c(3), c(7)], [c(6), c(3)], [c(4), c(6)], [c(0), c(4)]]);
  assert.equal(doSeq(done), '27 38 13 49 76 97 65 49′');
  assert.deepEqual(doCheck(done), { ok: true, why: '' });
  // 没写 goal：不判
  const free = doStart({ array: '3 1 2' });
  assert.equal(doCheck(free).ok, null);
  // 没写 goal 也不能留着空位
  const hole = run(doStart({ array: '3 1 2', temp: 't' }), [[c(1), c(0)]]);
  assert.equal(doCheck(hole).ok, false);
});

test('字段写错：中文报错', () => {
  assert.throws(() => doStart({ array: '3 1 2', ptrs: 'i=9' }), /i.*1 到 3/);
  assert.throws(() => doStart({ array: '3 1 2', ptrs: 'i i' }), /重复/);
  assert.throws(() => doStart({ array: '3 1 2', ptrs: 'a b c d e' }), /最多 4 个/);
  assert.throws(() => doStart({ array: '3 1 2', goal: '1 2 4' }), /goal/);
  assert.throws(() => doStart({ array: '3 1 2', goal: '1 2' }), /goal/);
  assert.equal(doStart({ array: '3 1 2', ptrs: 'i j=3' }).ptrs[0].at, 1);
});

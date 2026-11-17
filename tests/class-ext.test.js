// 第十五轮：外部主 Claude 的课。ext_in（外部写）按序号执行一次；ext_out（页面写）错误在最前；来回时间；三条新指令
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingIns, outText, outSeq, seqId, latency, parseCoach } from '../kit/src/class/ext.js';
import { parseCommand } from '../kit/src/class/protocol.js';

test('pendingIns：没 done 的按序号升序', () => {
  const got = pendingIns([{ id: '003', seq: 3 }, { id: '001', seq: 1, done: { at: 1 } }, { id: '002', seq: 2 }, { id: '010' }]);
  assert.deepEqual(got.map((d) => d.id), ['002', '003', '010']);
});

test('outText：要报的错误在最前，再是这一批的作答，最后是黑板现状；空的段不写', () => {
  const t = outText({ head: ['b4 写错：看不懂这一行'], message: '[作答] q1 选了 B（错）', state: '板 1：可交换' });
  assert.ok(t.startsWith('b4 写错：看不懂这一行'));
  assert.ok(t.indexOf('[作答]') < t.indexOf('板 1'));
  assert.equal(outText({ head: [], message: '', state: '板 1' }), '板 1');
});

test('序号：下一个 ext_out、三位数的编号', () => {
  assert.equal(outSeq([]), 1);
  assert.equal(outSeq([{ seq: 4 }, { seq: 2 }]), 5);
  assert.equal(seqId(7), '007');
});

test('来回时间：每条 ext_in 配它读过的那份 ext_out', () => {
  const r = latency([{ seq: 1, at: 0 }, { seq: 2, at: 100 }], [{ after: 1, got: 30000 }, { after: 2, got: 70100 }, { after: 9, got: 5 }]);
  assert.deepEqual(r, { n: 2, median: 50000, p90: 70000 });
  assert.equal(latency([], []), null);
});

test('三条新指令：snap、close、coach', () => {
  assert.deepEqual(parseCommand('snap'), { op: 'snap' });
  assert.deepEqual(parseCommand('close'), { op: 'close' });
  assert.deepEqual(parseCommand('coach target=q1 upto=2'), { op: 'coach', target: 'q1', upto: '2' });
  assert.ok(parseCommand('coach upto=2').error);
  assert.ok(parseCoach('target=q1').target === 'q1');
});

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

// 需求 R3：执行完立刻回报
import { inResult as inResult3, nowDoc as nowDoc3 } from '../kit/src/class/ext.js';
test('ext_in 的 result：执行了哪些、没执行的、写错的段、截图', () => {
  const r = inResult3({ boardOps: [{ op: 'new', id: 'b1', ok: true, page: 1 }, { op: 'figure', target: 'f1', ok: false, error: '没有 f1' }], retry: ['b2「例」有写法错误'], shots: ['a1'], at: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.summary, '执行了 1 条指令，1 条没执行，1 段写错没显示');
  assert.deepEqual(r.ops[1], { op: 'figure', target: 'f1', ok: false, error: '没有 f1' });
  assert.deepEqual(r.shots, ['a1']);
  assert.equal(inResult3({ boardOps: [{ op: 'add', id: 'b1', ok: true }] }).ok, true);
  assert.match(inResult3({ error: '炸了' }).summary, /没执行成：炸了/);
});
test('meta/now 去掉 undefined', () => {
  const d = nowDoc3({ text: '黑板', board: { segs: [{ id: 'b1', hidden: undefined }] }, at: 1 });
  assert.deepEqual(d, { at: 1, text: '黑板', board: { segs: [{ id: 'b1' }] } });
});

import { resolveFrom } from '../kit/src/class/ext.js';
test('board add … from=：后台活的结果换进块里，围栏加长', async () => {
  const docs = { 'drafts/x': { text: '````answer\nid: j1\nq: 1\nanswer: 1\n````' } };
  const r = await resolveFrom('说\n````board add id=b5 from=drafts/x title="改编"\n````\n````board add id=b6 from=drafts/none\n````', (p) => docs[p] || null);
  assert.deepEqual(r.missing, ['drafts/none']);
  assert.match(r.text, /^`````board add id=b5 title="改编"\n````answer\nid: j1/m);
  assert.match(r.text, /````\n`````\n````board add id=b6\n````$/);
});

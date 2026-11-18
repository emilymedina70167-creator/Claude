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

// dr-ext-round2：meta/since、ext_out 只写增量、屏幕照真的报
import { sinceDoc, NOW_LINE } from '../kit/src/class/ext.js';
import { boardStateText as bst2 } from '../kit/src/class/prompt.js';
test('meta/since：外部上一条 ext_in 执行完以后的全部 ext_out', () => {
  const ins = [{ id: '001', done: { at: 100 } }, { id: '002', done: { at: 300 } }, { id: '003' }];
  const outs = [{ seq: 1, at: 150, text: '早的' }, { seq: 2, at: 350, text: `[作答] q1 对\n\n${NOW_LINE}`, shots: ['a1'] }, { seq: 3, at: 400, text: '[作答] q2 错' }];
  const d = sinceDoc({ ins, outs, at: 500 });
  assert.equal(d.from, '002');
  assert.deepEqual(d.outs, [2, 3]);
  assert.deepEqual(d.shots, ['a1']);
  assert.match(d.text, /\[ext_out 002\]\n\[作答\] q1 对/);
  assert.doesNotMatch(d.text, /meta\/now/);
  assert.match(sinceDoc({ ins, outs: [] }).text, /还没有新的事/);
});
test('分屏照实写', () => {
  const t = bst2({ segs: [], pages: [], cur: 0, screen: { w: 860, h: 734, landscape: true, split: true, full: { w: 1180, h: 820 } } });
  assert.match(t, /横屏 860×734（分屏：这个页面只占屏幕的一部分，整个屏幕 1180×820）/);
});

// dr-learning-trail T1、T2、T6
import { saidItems, memoLines, inResult as inR4 } from '../kit/src/class/ext.js';
import { helperEvidence } from '../kit/src/memory/session.js';
test('said：字符串或数组，每一句一条', () => {
  assert.deepEqual(saidItems('就这样'), [{ text: '就这样', at: null, images: [] }]);
  assert.deepEqual(saidItems([{ text: '第一句', at: 5 }, { text: '', images: ['a1'] }, { text: '  ' }, null]), [{ text: '第一句', at: 5, images: [] }, { text: '', at: null, images: ['a1'] }]);
  assert.deepEqual(saidItems(undefined), []);
});
test('result.memo：每一行写成没有', () => {
  const m = memoLines({ pds: [{ line: 'error q=…', coll: 'errors', target: 'L2-60' }], rejected: [{ line: 'weakness …', error: '守卫拒了' }], extra: [{ line: 'block L2.1.4', ok: true, id: 'sessions/c-1.block' }] });
  assert.deepEqual(m.map((x) => [x.ok, x.id || x.error]), [[true, 'sessions/c-1.block'], [true, 'errors/L2-60'], [false, '守卫拒了']]);
  assert.deepEqual(inR4({ memo: m }).memo.length, 3);
  assert.deepEqual(memoLines(null), []);
});
test('页面里的 Claude 说的话记成证据 src: helper', () => {
  const e = helperEvidence('看第二步', { session: 's1', block: 'L2.1.4' }, { role: 'coach', target: 'q1' });
  assert.equal(e.src, 'helper');
  assert.equal(e.role, 'coach');
  assert.equal(e.target, 'q1');
  assert.equal(e.session, 's1');
});

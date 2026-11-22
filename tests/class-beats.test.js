// 拍子（kit/src/class/beats.js）：一轮输出怎么分拍
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beatPlan, shouldPlay, beatLabel } from '../kit/src/class/beats.js';
import { parseOutput } from '../kit/src/class/protocol.js';
import { createDevTeacher } from '../kit/src/class/devteacher.js';

const F = '````';
const blk = (cmd, body = '') => `${F}board ${cmd}\n${body}${body ? '\n' : ''}${F}`;
const plan = (text) => {
  const { segments, ops } = parseOutput(text, { final: true });
  return { ...beatPlan(segments), ops };
};

test('一拍 = 一段话 + 后面的指令；开头的指令算第一拍', () => {
  const p = plan([blk('new id=b1 title="t"', 'x'), '先看这个矩阵。', blk('mark target=b1'), '第二行是第一行的 2 倍。', blk('add id=b2', 'y'), '所以能拆开。'].join('\n\n'));
  // 第三段话后面没有指令：并进前一拍
  assert.equal(p.talks.length, 2);
  assert.equal(p.talks[0], '先看这个矩阵。');
  assert.equal(p.talks[1], '第二行是第一行的 2 倍。\n\n所以能拆开。');
  assert.deepEqual(p.opBeat, [0, 0, 1]);
  assert.equal(shouldPlay(p, p.ops), true);
});

test('常见的「说一句、写一块板、再补一句」不分拍', () => {
  const p = plan(['先猜一猜。', blk('new id=b5 title="猜"', 'x'), '放好了点确定。'].join('\n\n'));
  assert.equal(p.talks.length, 1);
  assert.equal(shouldPlay(p, p.ops), false);
});

test('memo、plan、react 不算改板面的指令', () => {
  const p = plan(['讲一句。', blk('new id=b1', 'x'), '记一下。', blk('react target=q1', 'right: 对')].join('\n\n'));
  assert.equal(p.talks.length, 1);
});

test('第二拍以后换板：不播', () => {
  const p = plan(['第一句。', blk('add id=b1', 'x'), '第二句。', blk('new id=b2', 'y')].join('\n\n'));
  assert.equal(p.talks.length, 2);
  assert.equal(shouldPlay(p, p.ops), false);
  assert.equal(beatLabel(1, 4), '2 / 4');
});

test('模拟老师「测试:拍子」分成四拍，「测试:预案」写了两条预案', async () => {
  const t = createDevTeacher({ pace: 0 });
  const r = await t([{ role: 'user', content: '课堂说明' }, { role: 'user', content: '测试:拍子' }], {});
  const p = plan(r.text);
  assert.equal(p.talks.length, 4);
  assert.equal(shouldPlay(p, p.ops), true);
  const q = await t([{ role: 'user', content: '课堂说明' }, { role: 'user', content: '测试:预案' }], {});
  const { ops, rejected } = parseOutput(q.text, { final: true });
  assert.deepEqual(rejected, []);
  assert.deepEqual(ops.map((o) => o.op), ['new', 'add', 'react', 'react']);
  assert.equal(ops[1].hold, true);
  assert.deepEqual(ops[2].cases.map((c) => c.kind), ['right'], '答错、想不出来不预写');
});

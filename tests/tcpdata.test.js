// TCP 传数据（kit/src/engines/net4.js 的 tcp send: / lens:）：谢希仁 5-23（王道同款）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tcpEngine as T } from '../kit/src/engines/net4.js';

test('序号 70、100，最后确认号 180：各段长度、确认号；第一段丢了时', () => {
  const ok = T.run(T.parse({ send: '70 100', last: 180 }));
  assert.deepEqual(ok.steps.filter((s) => s.ask?.tag === 'len').map((s) => s.ask.answer), [30, 80]);
  assert.deepEqual(ok.acks, [100, 180]);
  // 第一段丢了、第二段到了：B 发回的确认号还是 70；重传以后一起确认到 180
  const input = T.parse({ send: '70 100', last: 180, lost: 1 });
  const r = T.run(input);
  assert.deepEqual(r.acks, [70, 180]);
  assert.equal(T.quiz(input, r, {}).answer, '70 180');
  assert.deepEqual(T.variants(input, {}).map((v) => v.input.mistake), ['ackLast', 'noBuffer', 'lossAck']);
  // 另一种写法：第一个序号 + 长度
  const b = T.run(T.parse({ seq: 1000, lens: '200 300 100', lost: 2 }));
  assert.deepEqual(b.acks, [1200, 1200, 1600]);
  assert.throws(() => T.parse({ send: '100 70', last: 180 }), /一个比一个大/);
});

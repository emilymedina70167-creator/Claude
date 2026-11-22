// 2026-11-22：预案挂的组件不在板上时照实说是哪一段没画出来（以前一律「黑板上没有组件 X」）
import test from 'node:test';
import assert from 'node:assert/strict';
import { missingTarget } from '../kit/src/class/extboard.js';

const md = (id) => `讲一句\n\n\`\`\`answer\nid: ${id}\nq: 1+1\nanswer: 2\n\`\`\``;

test('组件写在没画出来的段里：说哪一段、为什么', () => {
  const t = missingTarget('q1', [{ id: 'b7', md: md('q1'), failed: true, error: 'answer：缺 answer' }]);
  assert.match(t, /q1 写在 b7 里/);
  assert.match(t, /没画出来/);
  assert.match(t, /缺 answer/);
});

test('有写法错误还在等重写、藏着的段各说各的', () => {
  assert.match(missingTarget('q1', [{ id: 'b7', md: md('q1'), pending: true }]), /写法错误还没画出来/);
  assert.match(missingTarget('q1', [{ id: 'b7', md: md('q1'), hidden: true }]), /藏着/);
});

test('写成段的 id、真没有：照旧', () => {
  assert.match(missingTarget('b7', [{ id: 'b7', md: md('q1') }]), /是段的 id/);
  assert.equal(missingTarget('zz', [{ id: 'b7', md: md('q1'), failed: true }]), '黑板上没有组件 zz');
  assert.equal(missingTarget('q1', [{ id: 'b7', md: md('q1') }]), '黑板上没有组件 q1');
});

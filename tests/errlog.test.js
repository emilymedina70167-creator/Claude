// 页面出错自己记下来（kit/src/errlog.js）：并进已有的列表、同一种只加次数
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeErrors, errKey, describe, ERR_MAX } from '../kit/src/errlog.js';

test('mergeErrors：同一处同一句话算一种，只加次数，挪到最前，看过的重新亮', () => {
  const a = { at: 1, where: '首页', msg: '读不到 c-20261104-1 的报告' };
  const b = { at: 2, where: '#manage', msg: '别的错' };
  let list = mergeErrors([], [a, b]);
  assert.equal(list.length, 2);
  assert.equal(list[0].msg, '别的错');
  list = list.map((x) => ({ ...x, seen: true }));
  list = mergeErrors(list, [{ at: 9, where: '首页', msg: '读不到 c-20261105-2 的报告' }]);
  assert.equal(list.length, 2, '课号不同还是同一种');
  assert.equal(list[0].count, 2);
  assert.equal(list[0].first, 1);
  assert.equal(list[0].at, 9);
  assert.equal(list[0].seen, false);
});

test('mergeErrors：最多留 ERR_MAX 种，旧的先丢', () => {
  const many = Array.from({ length: ERR_MAX + 10 }, (_, i) => ({ at: i, where: 'x', msg: `第 ${'一二三四五六七八九十'[i % 10]}${'甲乙丙丁戊己庚辛壬癸'[Math.floor(i / 10) % 10]} 种` }));
  const list = mergeErrors([], many);
  assert.equal(list.length, ERR_MAX);
  assert.equal(list[0].at, ERR_MAX + 9);
});

test('describe：Error、字符串、带 code 的对象、空', () => {
  assert.equal(describe(new Error('坏了')).msg, '坏了');
  assert.match(describe(new Error('坏了')).stack, /坏了/);
  assert.equal(describe('一句话').msg, '一句话');
  assert.equal(describe({ code: 'unavailable', message: '网络' }).code, 'unavailable');
  assert.equal(describe(null).msg, '（空的错误）');
  assert.notEqual(errKey({ where: 'a', msg: 'x' }), errKey({ where: 'b', msg: 'x' }));
});

test('浏览器自己的提示（ResizeObserver 送不完）不记', async () => {
  const { isNoise } = await import('../kit/src/errlog.js');
  assert.ok(isNoise('ResizeObserver loop completed with undelivered notifications.'));
  assert.ok(isNoise('ResizeObserver loop limit exceeded'));
  assert.ok(!isNoise('TypeError: x is undefined'));
});


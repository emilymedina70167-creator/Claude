// 「今天」按上海时间算：学生的 iPad 时区不是上海时，本地日期会早一天（2026-11-24 上午写出的 today 是 11-23）
import test from 'node:test';
import assert from 'node:assert/strict';
import { toDate } from '../kit/src/memory/schema.js';
import { msToNextDay } from '../kit/src/memory/journey.js';

test('时间戳按上海时间取日期，不看设备时区', () => {
  assert.equal(toDate(Date.UTC(2026, 10, 24, 3, 31)), '2026-11-24'); // 上海 11:31
  assert.equal(toDate(Date.UTC(2026, 10, 23, 16, 0)), '2026-11-24'); // 上海 0:00
  assert.equal(toDate(Date.UTC(2026, 10, 23, 15, 59)), '2026-11-23');
  assert.equal(toDate(new Date(Date.UTC(2026, 11, 31, 16, 0))), '2027-01-01');
  assert.equal(toDate('2026-11-24'), '2026-11-24');
  assert.equal(toDate('不是日期'), '');
});
test('到上海下一个零点还有多久', () => {
  assert.equal(msToNextDay(Date.UTC(2026, 10, 23, 15, 59)), 60 * 1000 + 1000);
  assert.equal(msToNextDay(Date.UTC(2026, 10, 23, 16, 0, 0, 500)), 24 * 3600 * 1000 + 500);
});

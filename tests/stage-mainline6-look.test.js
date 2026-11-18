// 主线第六轮 B：学生翻回去看一幕——事实跟着下一条告诉老师，不叫老师（events.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventOf, triggers, eventsText } from '../kit/src/stage/events.js';

test('回看是不叫老师的那一类', () => {
  const e = eventOf({ type: 'look', n: 2, title: '进行时', ms: 40000 });
  assert.equal(e.kind, 'look');
  assert.equal(triggers(e), false);
});

test('下一条里写一句；同一幕看了两次合起来', () => {
  const evs = [eventOf({ type: 'look', n: 2, title: '进行时', ms: 20000 }), eventOf({ type: 'look', n: 2, title: '进行时', ms: 20000 }), eventOf({ type: 'next', button: '接着' })];
  const t = eventsText(evs, { goals: new Map() });
  assert.match(t, /学生翻回去看了第 2 幕「进行时」（40 秒）/);
  assert.equal(t.match(/翻回去看了/g).length, 1);
});

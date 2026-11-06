// 舞台上的题卡（kit/src/stage/types/card.js）：把题拿上舞台，一行一个部件
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { card, rowsOf } from '../kit/src/stage/types/card.js';

const run = (s, src) => { for (const c of parseScript(src)) s.apply(c); return s; };

test('造一张题卡：一行一对引号；行是部件（q.2），能扣着、翻开、点亮', () => {
  const s = run(new Scene(), 'card q = "已知 n = 10" "第一次比较的是哪个数？" "提示：mid = 5"\ncover q.3\nglow q.2');
  const o = s.objects.get('q');
  assert.equal(o.lines.length, 3);
  assert.deepEqual(o.lines.map((l) => [l.covered, l.glow]), [[false, false], [false, true], [true, false]]);
  assert.match(s.stateText(), /q\.3（扣着）：提示：mid = 5/);
  s.apply(parseScript('uncover q.3')[0]);
  assert.equal(o.lines[2].covered, false);
});

test('加一行、改一行；写错的说清楚', () => {
  const s = run(new Scene(), 'card q = "题面"');
  s.apply(parseScript('addline q "提示" covered=on')[0]);
  assert.equal(s.objects.get('q').lines[1].covered, true);
  s.apply(parseScript('rewrite q.1 "新的题面"')[0]);
  assert.equal(s.objects.get('q').lines[0].text, '新的题面');
  const errs = dryRun(s, 'card r =\nglow q.9\nrewrite q.1\naddline nope "x"\ncard r = "{a.1}"').map((e) => e.error);
  assert.match(errs[0], /每一行一对引号/);
  assert.match(errs[1], /q 只有 2 行/);
  assert.match(errs[2], /rewrite 要有新的字/);
  assert.match(errs[3], /没有叫「nope」的题卡/);
  assert.match(errs[4], /舞台上没有「a」/);
});

test('题卡和一排格子一起：放在格子下面、居中；行的框一行接一行往下排', () => {
  const s = run(new Scene(), 'array a = 1 2 3 4 5\ncard q = "一" "二"');
  const a = s.objectBox('a'), q = s.objectBox('q');
  assert.ok(q.y > a.y + a.h);
  assert.ok(Math.abs((q.x + q.w / 2) - (a.x + a.w / 2)) < 1);
  const [l1, l2] = s.objects.get('q').lines.map((l) => s.partBox(l));
  assert.ok(l2.y > l1.y + l1.h - 1);
  assert.ok(rowsOf('一'.repeat(90)) >= 3 && rowsOf('abc') === 1);
});

test('说明里的例子照抄能演', () => {
  assert.deepEqual(dryRun(new Scene(), card.example), []);
});

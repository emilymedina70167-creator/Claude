// 舞台主线第三轮 C：底座第二轮留下的条目（docs/stage-gaps.md「留到下一步的」），一条一个测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { eventsText, hasWork } from '../kit/src/stage/events.js';

const run = (s, src, extra = {}) => { for (const c of parseScript(src)) s.apply({ ...c, ...extra }); return s; };
const make = (src) => run(new Scene(), src);

test('第 7 条：watch——只叫老师、不打勾、不给学生看的条件；成立时照挑战那样交出来，写给老师的话不说「做到了挑战」', () => {
  const s = make('tree t = 50 30 tray="60 20"\nopen t insert\nwatch w1 when="count(t) = 3"');
  const g = s.goals.get('w1');
  assert.deepEqual([g.watch, g.call, g.met], [true, 'now', false]);
  assert.match(s.stateText(), /盯着 w1 when="count\(t\) = 3"：还没成立（count\(t\) = 3 ✗）（学生看不到；成立时马上叫你一次）/);
  assert.doesNotMatch(s.stateText(), /挑战 w1/);
  const fx = s.apply(parseScript('insert t 60')[0], { by: 'student', open: 'insert' });
  assert.deepEqual(fx.goalsMet, ['w1']);
  assert.match(s.stateText(), /盯着 w1[^\n]*：成立过/);
  // 写给老师的那一句
  const text = eventsText([{ kind: 'goal', ids: ['w1'], reacted: 0, at: 1 }], { goals: s.goals });
  assert.match(text, /你盯着的 w1 成立了（count\(t\) = 3）/);
  assert.doesNotMatch(text, /做到了挑战|预写/);
  // 不能预写、不能和挑战撞名、要写 when=、不写给学生看的字
  assert.match(dryRun(s, '@w1 say "停"')[0].error, /watch 成立时页面只叫你/);
  assert.match(dryRun(s, 'watch w2')[0].error, /when=/);
  assert.match(dryRun(s, 'watch w2 "给学生看的" when="count(t) = 4"')[0].error, /不写给学生看的字/);
  assert.match(dryRun(s, 'watch w2 when="count(t) = 4" on="就这样"')[0].error, /on=/);
  // 学生手上有没有事不看它（学生不知道有这个条件）
  const p = make('tree t = 50 30 tray="60"\nwatch w1 when="count(t) = 3"');
  assert.equal(hasWork(p).some((x) => /w1/.test(x)), false);
  // ungoal 也收得掉
  run(s, 'ungoal w1');
  assert.equal(s.goals.has('w1'), false);
});

// 第九轮第 2 批：记录分工——带 aide 的舞台课，老师的记忆块说明只教判断，事实交给课后助手
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESK_STAGE, DESK_STAGE_JUDGE, buildStageSystem } from '../kit/src/stage/doc.js';
import { afterPrompt } from '../kit/src/aide/after.js';
import { sampleMemory } from '../kit/src/memory/sample.js';

const bytes = (s) => new TextEncoder().encode(s).length;

test('只教判断的说明比原来短，讲了交给助手，判断那几种的例子还在', () => {
  assert.ok(bytes(DESK_STAGE_JUDGE) < bytes(DESK_STAGE));
  assert.match(DESK_STAGE_JUDGE, /事实交给课后助手/);
  for (const k of ['lesson id=', 'todo text=', 'review id=', 'position next=', 'pref topic=']) assert.ok(DESK_STAGE_JUDGE.includes(k), k);
  for (const k of ['error step=', 'recall q=', 'note text=', 'slip text=']) assert.ok(!DESK_STAGE_JUDGE.includes(k), k);
});

test('舞台课的说明：带 aide 的课用只教判断的那份，别的照旧', () => {
  const memory = { mem: sampleMemory('2026-11-13'), block: 'L2.2.2', space: 'math', session: 'c-1' };
  assert.ok(buildStageSystem({ memory, factsByAide: true }).includes('事实交给课后助手'));
  assert.ok(!buildStageSystem({ memory }).includes('事实交给课后助手'));
});

test('下课后的助手：课上旁听记下的当底稿带上', () => {
  const p = afterPrompt({ session: { id: 'c-1' }, transcript: 'x', notes: [{ upTo: 3, text: '以前｜这一步以前也停过很久' }] });
  assert.match(p, /课上旁听记下的/);
  assert.match(p, /看到第 3 轮/);
});

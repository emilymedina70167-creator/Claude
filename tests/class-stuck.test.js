import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNudge, stuckText, STUCK_MS } from '../kit/src/class/stuck.js';
import { actionText, actionsMessage } from '../kit/src/class/prompt.js';
import { devReply } from '../kit/src/class/devteacher.js';

const waiting = [{ id: 'q-5', kind: 'answer', seg: 'b5' }];
const base = { now: 1_000_000, lastActive: 1_000_000 - STUCK_MS, waiting };

test('shouldNudge：题还没做、很久没动静才提醒，一轮只提醒一次', () => {
  assert.equal(STUCK_MS, 4 * 60 * 1000);
  assert.equal(shouldNudge(base), true);
  assert.equal(shouldNudge({ ...base, lastActive: base.now - STUCK_MS + 1000 }), false, '还没到时间');
  assert.equal(shouldNudge({ ...base, waiting: [] }), false, '板上没有等着做的题：学生只是在看');
  assert.equal(shouldNudge({ ...base, nudged: true }), false, '这一轮提醒过了');
  assert.equal(shouldNudge({ ...base, enabled: false }), false, '学生关掉了');
  assert.equal(shouldNudge({ ...base, busy: true }), false, 'Claude 正在讲');
  assert.equal(shouldNudge({ ...base, hidden: true }), false, '页面在后台');
  assert.equal(shouldNudge({ ...base, started: false }), false, '还没开课');
});

test('stuckText：发给课堂 Claude 的一行，原样进动作消息', () => {
  const t = stuckText({ minutes: 4, waiting: [...waiting, { id: 'ex-2', kind: 'steps', seg: 'b5' }, { id: 'x', kind: 'quiz' }] });
  assert.equal(t, '[动作] 学生在当前板上 4 分钟没有动静（b5 里的 answer q-5、b5 里的 steps ex-2 还没作答）：可能卡住了，也可能在纸上算。');
  assert.doesNotMatch(t, /他|她/);
  assert.equal(actionText({ source: 'page', type: 'stuck', text: t }), t);
  assert.equal(actionsMessage([{ source: 'page', text: t }]), t);
});

test('模拟老师：没有动静时轻轻问一句，只有板书时说收到了', () => {
  // 第一条是课堂说明，之后已经讲过一轮
  const convo = (last) => [{ role: 'user', content: '（课堂说明）' }, { role: 'user', content: '开始上课。' }, { role: 'assistant', content: '我们开始。' }, { role: 'user', content: last }];
  const nudge = devReply(convo(stuckText({ minutes: 4, waiting })), { seq: 1, broken: 1 });
  assert.equal(nudge.kind, 'nudge');
  assert.doesNotMatch(nudge.text, /board/);
  const ink = devReply(convo('[板书] 学生用 Pencil 在黑板上写了东西（写在 b5 上），附在这一轮：1 张图。'), { seq: 1, broken: 1 });
  assert.equal(ink.kind, 'ink');
});

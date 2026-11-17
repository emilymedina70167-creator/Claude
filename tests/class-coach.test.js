// 第十五轮：板边助教。外部主讲在 ext_in 里写 board coach target=题 upto=…，学生在这一题上做错，页面叫页面里的 Claude 写一句，
// 写在这一题下面，标「助教」。助教拿到的只有事实：这一题的原文、外部写的 upto、学生这次的作答
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachPrompt, coachSegment, COACH_HEAD } from '../kit/src/class/coach.js';
import { parseOutput } from '../kit/src/class/protocol.js';
import { FORBIDDEN } from '../kit/src/project/system.js';

test('助教的提示只写事实：题的原文、upto、学生的作答', () => {
  const p = coachPrompt({ segment: '```answer\nq: 2+2=\nanswer: 4\n```', upto: '只提示看清加法', answer: '填了 5（错）' });
  assert.ok(p.startsWith(COACH_HEAD));
  for (const x of ['2+2', '只提示看清加法', '填了 5']) assert.ok(p.includes(x), x);
  for (const w of [...FORBIDDEN, '他', '她']) assert.ok(!p.includes(w), w);
});

test('助教那一句写成接在题后面的一段', () => {
  const t = coachSegment('q1', '先看 AB 和 BA 哪个先乘', 2);
  const ops = parseOutput(t, { final: true }).ops;
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'add');
  assert.equal(ops[0].id, 'coach-q1-2');
  assert.match(t, /助教：先看 AB 和 BA 哪个先乘/);
});

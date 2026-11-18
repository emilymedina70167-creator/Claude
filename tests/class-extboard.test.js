// 外部的课：预备板 board queue（R7）、改字不丢作答 board edit（R9）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQueue, queueDue, parseEdits, applyEdits, keptComponents } from '../kit/src/class/extboard.js';

test('queue 的写法', () => {
  assert.deepEqual(parseQueue('id=b5 title="下一块" after=q-b4:right|done|button'), { op: 'queue', id: 'b5', title: '下一块', after: { target: 'q-b4', kinds: ['right', 'done'], button: true } });
  assert.deepEqual(parseQueue('id=b6 after=button').after, { target: '', kinds: [], button: true });
  assert.match(parseQueue('id=b6').error, /什么时候翻/);
  assert.match(parseQueue('id=b6 after=right').error, /哪一题/);
  assert.match(parseQueue('id=b6 after=q1:wrong').error, /只认/);
});

test('到没到', () => {
  const q = parseQueue('id=b5 after=q-b4:right|button');
  assert.equal(queueDue(q, { kind: 'right', target: 'q-b4' }), true);
  assert.equal(queueDue(q, { kind: 'right', target: 'q-b3' }), false);
  assert.equal(queueDue(q, { kind: 'done', target: 'q-b4' }), false);
  assert.equal(queueDue(q, { kind: 'button' }), true);
  assert.equal(queueDue({ ...q, opened: true }, { kind: 'button' }), false);
});

test('edit：读改动、照改、正好一次', () => {
  const e = parseEdits('<<<\n秩是 3\n===\n秩是 2\n>>>\n<<<错字\n===\n对字>>>');
  assert.deepEqual(e.edits, [{ from: '秩是 3', to: '秩是 2' }, { from: '错字', to: '对字' }]);
  assert.match(parseEdits('改一下').error, /<<</);
  assert.deepEqual(applyEdits('A 的秩是 3，有错字', e.edits), { md: 'A 的秩是 2，有对字' });
  assert.match(applyEdits('秩是 3 秩是 3', [{ from: '秩是 3', to: 'x' }]).error, /出现了 2 次/);
});

test('原文没变的组件留着', () => {
  const before = '说明 a\n```answer\nid: q1\nq: 1\nanswer: 1\n```\n```answer\nid: q2\nq: 2\nanswer: 2\n```';
  const after = before.replace('说明 a', '说明 b').replace('q: 2', 'q: 3');
  assert.deepEqual(keptComponents(before, after), ['q1']);
});

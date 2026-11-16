// 以前开的舞台课、一问一答接着上（清点第二节第 6 条）：说明里是摘要，但老师的记忆块说明还是旧的，
// 它写的 ask / pref / lesson 以前照旧进旧的几类——那几类已经不发给任何人，等于丢。
// 现在两种课堂（class/classroom.js：黑板课和一问一答；stage/classroom.js：舞台课）走同一个分法：关于学生的事 → 摘要的新笔记。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { knowNotes } from '../kit/src/memory/memo.js';
import { parseMemoLines } from '../kit/src/memory/memo.js';

const entries = () => parseMemoLines([
  'ask text=画面别压着字 scope=all basis=say',
  'pref topic=讲法 text=喜欢先看结论',
  'error block=EN-2-01 text=把同位语从句当成定语从句 basis=qz-1',
  'position block=EN-2-01 note=接着做第3题',
].join('\n')).entries;
const history = [
  { role: 'student', seq: 1, say: '开始上课。' },
  { role: 'claude', seq: 2, text: '……' },
  { role: 'student', seq: 3, say: '画面别压着字' },
  { role: 'claude', seq: 4, text: '……', discarded: true },
  { role: 'student', seq: 5, say: '', actions: ['答对了'] },
];

test('有摘要：关于学生的事成了新笔记（带这节课、这一科），学习的账照旧走改动单', () => {
  const r = knowNotes(entries(), { on: true, history, space: 'en', session: 'c-20261106-2' });
  assert.equal(r.notes.length, 2);
  assert.deepEqual(r.notes[0], { text: '画面别压着字', quote: '画面别压着字', space: 'shared', session: 'c-20261106-2', by: 'class' });
  assert.equal(r.notes[1].text, '讲法：喜欢先看结论');
  assert.equal(r.notes[1].quote, '', '没写 say 的不挂原话');
  assert.deepEqual(r.rest.map((e) => e.kind), ['error', 'position']);
});

test('没有摘要：一条不动，全走老路', () => {
  const es = entries();
  const r = knowNotes(es, { on: false, history, space: 'en', session: 'c-1' });
  assert.equal(r.notes.length, 0);
  assert.deepEqual(r.rest, es);
});

test('两种课堂都走这一个分法、都把新笔记交给摘要', () => {
  for (const f of ['kit/src/class/classroom.js', 'kit/src/stage/classroom.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.match(src, /knowNotes\(/, `${f} 用 knowNotes`);
    assert.match(src, /desk\.summary\.note\(/, `${f} 把新笔记交给摘要`);
  }
});

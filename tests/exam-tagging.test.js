// 双人打标签（kit/src/exam/tagging.js）：出题单、读回、比一致率、第三个人定
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagPrompt, parseTags, mergeTags, settlePrompt, settle } from '../kit/src/exam/tagging.js';

const syllabus = [
  { id: 'G-OS-2', title: '进程管理', course: 'OS' }, { id: 'G-OS-2.1', title: '进程与线程', course: 'OS', level: '理解', text: '理解进程的概念' },
  { id: 'G-OS-2.3', title: '同步与互斥', course: 'OS', level: '掌握', text: '掌握信号量' },
];
const curriculum = [{ id: 'OS-L2.1.1', level: 'block', title: '进程的概念' }, { id: 'DS-L1.1.1', level: 'block', title: '别的课' }];
const qs = [{ id: 'Q-408-2019-23', n: 23, type: 'single', points: 2, stem: '下列关于进程的说法', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, answer: 'C', course: 'OS' },
  { id: 'Q-408-2019-24', n: 24, type: 'single', points: 2, stem: '信号量 S 的初值', options: { A: '1', B: '2', C: '3', D: '4' }, answer: 'A', course: 'OS' }];

test('出题单：词表、考点树、这门课的块、题面都在；回答格式写清；不提他她', () => {
  const p = tagPrompt({ questions: qs, syllabus, curriculum, course: 'OS' });
  assert.match(p, /同步互斥（PV）/);
  assert.match(p, /G-OS-2\.3 同步与互斥（掌握）/);
  assert.match(p, /OS-L2\.1\.1 进程的概念/);
  assert.doesNotMatch(p, /DS-L1\.1\.1/);
  assert.match(p, /Q-408-2019-24[\s\S]*信号量 S 的初值/);
  assert.match(p, /题 Q-…｜主考点,次考点｜考法｜难度｜难度的依据｜坑：/);
  assert.doesNotMatch(p, /[他她]/);
});

test('读回：一题一行；格式不对、不在这批里的题号报出来', () => {
  const text = '题 Q-408-2019-23｜G-OS-2.1｜concept｜2｜比 2019-24 简单｜坑：把进程当程序\n题 Q-408-2019-24 | G-OS-2.3, G-OS-2.1 | 同步互斥（PV） | 3 | 要算初值 | 坑：\n乱写的一行\n题 Q-408-2019-99｜G-OS-2.1｜concept｜2｜x｜坑：';
  const r = parseTags(text, { ids: qs.map((q) => q.id), course: 'OS' });
  assert.deepEqual(r.tags['Q-408-2019-23'], { syl: ['G-OS-2.1'], how: 'concept', difficulty: { est: 2, basis: '比 2019-24 简单' }, traps: ['把进程当程序'] });
  assert.deepEqual(r.tags['Q-408-2019-24'].syl, ['G-OS-2.3', 'G-OS-2.1']);
  assert.equal(r.tags['Q-408-2019-24'].how, 'sync', '中文的考法认成键');
  assert.deepEqual(r.tags['Q-408-2019-24'].traps, []);
  assert.match(r.problems.join(), /看不懂：乱写的一行/);
  assert.match(r.problems.join(), /Q-408-2019-99 不在这一批里/);
});

test('比两份：主考点一样算一致；考法取 a、记一笔；难度取平均；一致率', () => {
  const a = { Q1: { syl: ['G-1'], how: 'calc', difficulty: { est: 2 } }, Q2: { syl: ['G-2'], how: 'concept', difficulty: { est: 3 } }, Q3: { syl: ['G-3'], how: 'calc' } };
  const b = { Q1: { syl: ['G-1', 'G-9'], how: 'process', difficulty: { est: 3 } }, Q2: { syl: ['G-5'], how: 'concept' } };
  const r = mergeTags(a, b);
  assert.deepEqual(r.agreed.Q1.syl, ['G-1']);
  assert.equal(r.agreed.Q1.how, 'calc');
  assert.equal(r.agreed.Q1.difficulty.est, 3);
  assert.equal(r.agreed.Q1.disagree, 'how');
  assert.deepEqual(r.conflicts.map((c) => c.id), ['Q2', 'Q3']);
  assert.equal(r.rate, 1 / 3);
});

test('第三个人定：出题单带两份；读回按它的', () => {
  const conflicts = [{ id: 'Q-408-2019-23', a: { syl: ['G-OS-2.1'], how: 'concept' }, b: { syl: ['G-OS-2.3'], how: 'sync' } }];
  const p = settlePrompt({ conflicts, questions: qs, syllabus, course: 'OS' });
  assert.match(p, /甲：G-OS-2\.1[\s\S]*乙：G-OS-2\.3/);
  const r = settle(conflicts, '题 Q-408-2019-23｜G-OS-2.3｜sync｜3｜x｜坑：', { course: 'OS' });
  assert.deepEqual(r['Q-408-2019-23'].syl, ['G-OS-2.3']);
  assert.equal(r['Q-408-2019-23'].settled, true);
});

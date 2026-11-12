// 每块的考情（kit/src/exam/block.js）和过时（fresh.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examForBlock, pickReps } from '../kit/src/exam/block.js';
import { profileSrc, staleProfiles, staleMaps } from '../kit/src/exam/fresh.js';
import { mapSig } from '../kit/src/exam/mapping.js';

const syllabus = [
  { id: 'G-OS-3.2', course: 'OS', title: '页面置换', level: '掌握', text: '掌握 FIFO、LRU、CLOCK', blocks: ['OS-L3.2.1'] },
  { id: 'G-OS-2.3', course: 'OS', title: 'PV', blocks: ['OS-L2.3.1'] },
];
const qq = (id, year, how, extra = {}) => ({ id, year, n: Number(id.split('-').at(-1)), paper: `X-408-${year}`, type: 'single', points: 2, stem: `题 ${id}`, course: 'OS', tags: { syl: ['G-OS-3.2'], how }, ...extra });
const questions = [
  qq('Q-408-2015-26', 2015, 'concept'), qq('Q-408-2019-26', 2019, 'calc'), qq('Q-408-2023-45', 2023, 'process', { type: 'comp', points: 8 }),
  qq('Q-408-2023-26', 2023, 'calc'), qq('Q-408-2025-26', 2025, 'calc', { reserve: true }),
  { ...qq('Q-408-2020-30', 2020, 'sync'), tags: { syl: ['G-OS-2.3'], how: 'sync' } },
];
const exam = { course: 'OS', syllabus, questions, profiles: [{ id: 'G-OS-3.2', how: '常考 LRU 缺页次数', traps: [{ id: 'G-OS-3.2#t1', text: '把 FIFO 当 LRU', qs: ['Q-408-2019-26'] }] }] };

test('没挂考点的块：null', () => {
  assert.equal(examForBlock({ block: 'OS-L9.1.1', exam, years: [2024, 2025, 2026] }), null);
  assert.equal(examForBlock({ block: 'OS-L3.2.1', exam: null }), null);
});

test('一块的考情：考点和大纲原文、统计、画像、代表题、其余的、做过的', () => {
  const r = examForBlock({ block: 'OS-L3.2.1', exam, years: [2024, 2025, 2026], evidence: [{ exam: 'Q-408-2019-26', ok: false, attempts: 1, at: 5, session: 'c-1' }] });
  assert.deepEqual(r.syl.map((x) => [x.id, x.level]), [['G-OS-3.2', '掌握']]);
  assert.equal(r.stats.n, 5, '留着的卷也算进统计');
  assert.equal(r.rank, 1);
  assert.equal(r.of, 2);
  assert.equal(r.profiles[0].traps[0].id, 'G-OS-3.2#t1');
  assert.ok(!r.reps.some((x) => x.reserve), '代表题不挑留着的');
  assert.ok(!r.rest.some((x) => x.reserve), '目录里也没有留着的');
  assert.deepEqual(r.mine, [{ id: 'Q-408-2019-26', at: 5, ok: false, first: true, session: 'c-1' }]);
  assert.equal(r.reserved, 1);
});

test('代表题：不同考法各一道，新的年份先，做过的往后', () => {
  const usableQs = questions.filter((q) => !q.reserve && q.tags.syl[0] === 'G-OS-3.2');
  assert.deepEqual(pickReps(usableQs, { n: 3 }).map((q) => q.id), ['Q-408-2023-45', 'Q-408-2023-26', 'Q-408-2015-26']);
  assert.deepEqual(pickReps(usableQs, { n: 3, done: new Set(['Q-408-2023-26']) }).map((q) => q.id), ['Q-408-2023-45', 'Q-408-2019-26', 'Q-408-2015-26']);
});

test('过时：画像的上游（题和标签）变了；课程地图变了映射过时', () => {
  const src = profileSrc('G-OS-3.2', questions);
  const profiles = [{ id: 'G-OS-3.2', src }, { id: 'G-OS-2.3', src: 'old' }];
  assert.deepEqual(staleProfiles(profiles, questions, syllabus), ['G-OS-2.3']);
  const changed = questions.map((q) => (q.id === 'Q-408-2019-26' ? { ...q, tagLog: [{ at: 1 }] } : q));
  assert.deepEqual(staleProfiles(profiles, changed, syllabus).sort(), ['G-OS-2.3', 'G-OS-3.2']);
  assert.deepEqual(staleProfiles([], questions, syllabus).sort(), ['G-OS-2.3', 'G-OS-3.2'], '没有画像的考点也要写');
  const cur = [{ id: 'OS-L3.2.1', level: 'block', title: '页面置换' }];
  const sig = mapSig(cur, 'OS');
  assert.deepEqual(staleMaps([{ ...syllabus[0], mapSig: sig }], cur), []);
  assert.deepEqual(staleMaps([{ ...syllabus[0], mapSig: sig }], [{ ...cur[0], title: '改了' }]), ['G-OS-3.2']);
});

// 考情第 2～7 批整支审查修的（一条一个测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barOf } from '../kit/src/exam/bar.js';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { examForClass } from '../kit/src/exam/context.js';
import { examForBlock } from '../kit/src/exam/block.js';
import { DEFAULT_TARGET } from '../kit/src/exam/target.js';
import { scoreBoard } from '../kit/src/memory/score.js';
import { statsCache } from '../kit/src/exam/stats.js';
import { planInbox } from '../kit/src/exam/inbox.js';
import { pickDrills } from '../kit/src/memory/drills.js';
import { profileSrc } from '../kit/src/exam/fresh.js';
import { mergeIntel } from '../kit/src/exam/lab.js';

const qs = [{ id: 'Q-408-2019-26', year: 2019, points: 2 }];
const run = (scene, src) => { for (const c of parseScript(src)) scene.apply(c); return scene; };

test('审查 1：舞台上点了「给个提示」之后才做到（下一问才做到也算）：不算真题级', () => {
  const evs = [
    { kind: 'stage-next', session: 'c-1', comp: 'S21', detail: { button: '给个提示' }, at: 2000 },
    { kind: 'answer', exam: 'Q-408-2019-26', comp: 'S22', ok: true, attempts: 1, ms: 5000, session: 'c-1', at: 5000 },
  ];
  assert.equal(barOf({ block: 'b', questions: qs, evidence: evs }).passed, false);
  const before = [{ ...evs[0], at: 10 }, { ...evs[1], ms: 1000 }];
  assert.equal(barOf({ block: 'b', questions: qs, evidence: before }).passed, true, '这一问亮出来之前点的提示不算');
});

test('审查 2：挑战上不收 exam=（中间试错不记作答，第一次永远是做对）；like= 照收', () => {
  assert.throws(() => run(new Scene(), 'matrix A = 1 1 / 0 1\ngoal g1 "化成单位阵" when="A = I" exam=Q-301-2021-17'), /挑战.*exam=/);
  assert.equal(run(new Scene(), 'matrix A = 1 1 / 0 1\ngoal g1 "化成单位阵" when="A = I" like=Q-301-2021-17').goals.get('g1').like, 'Q-301-2021-17');
});

test('审查 3：页面没判的一问（ok: null）不占「第一次」', () => {
  const evs = [{ kind: 'answer', exam: 'Q-408-2019-26', ok: null, session: 'c-1', at: 1 }, { kind: 'answer', exam: 'Q-408-2019-26', ok: true, attempts: 1, session: 'c-1', at: 2 }];
  const b = barOf({ block: 'b', questions: qs, evidence: evs });
  assert.equal(b.passed, true);
  assert.equal(b.done.length, 1);
});

test('审查 4：大题多、画像长：代表题至少一道（题面截短也要放）', () => {
  const syllabus = [1, 2, 3].map((i) => ({ id: `G-DS-${i}`, course: 'DS', title: `考点${i}`, level: '掌握', text: '大纲'.repeat(100), blocks: ['DS-L1.1.1'] }));
  const questions = [2019, 2021, 2023].map((y, i) => ({ id: `Q-408-${y}-41`, year: y, n: 41, paper: `X-408-${y}`, type: 'comp', points: 10, stem: '很长的题面'.repeat(240), answer: '很长的答案'.repeat(120), analysis: '解析'.repeat(400), course: 'DS', tags: { syl: [`G-DS-${i + 1}`], how: 'design' } }));
  const profiles = syllabus.map((n) => ({ id: n.id, how: '怎么考'.repeat(200), traps: [1, 2, 3, 4, 5, 6].map((k) => ({ id: `${n.id}#t${k}`, text: '坑'.repeat(200), qs: [questions[0].id] })) }));
  const info = examForBlock({ block: 'DS-L1.1.1', exam: { course: 'DS', syllabus, questions, profiles }, years: [] });
  const t = examForClass({ target: DEFAULT_TARGET, info, today: '2026-11-12' });
  assert.ok((t.match(/^### Q-/gm) || []).length >= 1, '至少一道代表题');
  assert.ok(new TextEncoder().encode(t).length <= 16 * 1024);
});

test('审查 5：有真题、可一道能用的都没有的块（只在留着的几年考过）不封顶', () => {
  const syllabus = [{ id: 'G-OS-9', course: 'OS', title: '新考点', blocks: ['OS-L3.1.1'] }];
  const c = statsCache({ course: 'OS', questions: [{ id: 'Q-408-2025-30', year: 2025, points: 2, course: 'OS', tags: { syl: ['G-OS-9'] } }], syllabus, curriculum: [], years: [2024, 2025, 2026] });
  assert.ok(c.blockPerYear['OS-L3.1.1'] > 0);
  assert.equal(c.blockUsable['OS-L3.1.1'] || 0, 0);
  const cur = [{ id: 'OS-L3', level: 'lecture', title: '第3章' }, { id: 'OS-L3.1', level: 'section', title: '§1' }, { id: 'OS-L3.1.1', level: 'block', title: 'a' }];
  const mastery = [{ id: 'OS-L3.1.1', state: '复现通过', tier: 30, log: [] }];
  const capped = scoreBoard({ curriculum: cur, mastery }, { today: '2026-11-12', exam: c.blockPerYear });
  const free = scoreBoard({ curriculum: cur, mastery }, { today: '2026-11-12', exam: c.blockPerYear, usable: c.blockUsable });
  assert.ok(free.total > capped.total);
});

test('审查 6：like= 指着留着的卷、别的块的题：不算', () => {
  const e = { kind: 'answer', like: 'Q-408-2025-26', comp: 'd-lab-1', ok: true, attempts: 1, session: 'c-1', at: 1 };
  assert.equal(barOf({ block: 'b', questions: [{ id: 'Q-408-2025-26', year: 2025, points: 2 }], evidence: [e], years: [2025] }).passed, false);
});

test('审查 7：留作模考那几年的练习：收件箱不收、练一练不挑；画像的指纹跟着留的年份变', () => {
  const d = { id: 'd-q-408-2025-23', md: '```quiz\nq: x\n- [x] a\n```', src: 'exam', exam: 'Q-408-2025-23', space: 'cs', status: 'active' };
  assert.equal(planInbox({ kind: 'drills', drills: [d], by: 'dev' }, { have: new Map(), years: [2024, 2025, 2026] }).log.ok, false);
  const mem = { drills: [d, { ...d, id: 'd-q-408-2019-23', exam: 'Q-408-2019-23' }], exam: [{ id: 'target', school: '南京大学', reserve: [2025] }] };
  const picked = pickDrills(mem, { space: 'cs', today: '2026-11-12' }).items.map((x) => x.id);
  assert.ok(!picked.includes('d-q-408-2025-23'));
  const q2 = [{ id: 'Q-408-2019-26', tags: { syl: ['G-1'] } }, { id: 'Q-408-2025-26', tags: { syl: ['G-1'] } }];
  assert.notEqual(profileSrc('G-1', q2, [2025]), profileSrc('G-1', q2, [2024]));
});

test('审查 minor：两年的复试线是同一个数，不并成一条', () => {
  const a = mergeIntel([], { kind: 'line', text: '2025 年复试线 330', value: 330, url: 'https://a/1', date: '2025-03-01' }, { at: 1 });
  const b = mergeIntel([{ id: a.id, ...a.doc }], { kind: 'line', text: '2026 年复试线 330', value: 330, url: 'https://a/2', date: '2026-03-01' }, { at: 2e9 });
  assert.equal(b.isNew, true);
  assert.ok(!('id' in a.doc));
});

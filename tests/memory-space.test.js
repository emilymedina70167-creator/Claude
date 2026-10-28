// 学习台分科（数学 / 408 / 英语）：编号前缀、每科的「下一节」和资料包、按科目过滤、课堂按门课带说明。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { courseOf, spaceOfId, subjectOf, positionId, packIds, spaceOfDoc, filterSpace, spaceSummary } = await import('../kit/src/memory/space.js');
const { sampleMemory, sampleSpaces } = await import('../kit/src/memory/sample.js');
const { checkMemory } = await import('../kit/src/memory/check.js');
const { memoryDigest } = await import('../kit/src/memory/digest.js');
const { parseMemoLines, planEntry, nextErrorId } = await import('../kit/src/memory/memo.js');
const { subjectKey } = await import('../kit/src/subject.js');

const TODAY = '2026-10-28';
const M = () => {
  const a = sampleMemory(TODAY), b = sampleSpaces(TODAY);
  for (const [c, docs] of Object.entries(b)) a[c] = [...(a[c] || []), ...docs];
  return a;
};

test('编号前缀定门课和科目：不带前缀的是线代；课堂按门课带说明', () => {
  assert.equal(courseOf('L2.2.1'), 'LA');
  assert.equal(courseOf('DS-L2.1.1'), 'DS');
  assert.equal(courseOf('EN-L1-01'), 'EN');
  assert.equal(courseOf('XX-L1'), 'LA'); // 不认识的前缀当线代
  assert.equal(spaceOfId('OS-L3.1'), 'cs');
  assert.equal(spaceOfId('EN-L1.1.1#past'), 'en');
  assert.equal(subjectOf('CN-L4.2.1'), '计网');
  assert.equal(subjectKey(subjectOf('EN-L1.1.1')), '英语');
  assert.equal(positionId('math'), 'now');
  assert.equal(positionId('en'), 'now-en');
  assert.deepEqual(packIds('cs'), { main: 'main-cs', problems: 'problems-cs' });
  assert.deepEqual(packIds('math'), { main: 'main', problems: 'problems' });
});

test('每一条记忆属于哪一科：弱点、复现组顺着块和错题找；关于我、规则全科共用', () => {
  const m = M();
  assert.equal(spaceOfDoc('weaknesses', m.weaknesses[0], m), 'math');
  assert.equal(spaceOfDoc('weaknesses', { id: 'W30', errors: ['EN-L1-01'] }, m), 'en');
  assert.equal(spaceOfDoc('reviews', { id: 'R9', weaknesses: ['W19'] }, m), 'math');
  assert.equal(spaceOfDoc('reviews', { id: 'R9', space: 'cs' }, m), 'cs');
  assert.equal(spaceOfDoc('position', { id: 'now-en' }, m), 'en');
  assert.equal(spaceOfDoc('profile', m.profile[0], m), null);
  const en = filterSpace(m, 'en');
  assert.deepEqual(en.curriculum.map((d) => d.id), ['EN-L1', 'EN-L1.1', 'EN-L1.1.1']);
  assert.deepEqual(en.errors.map((d) => d.id), ['EN-L1-01']);
  assert.deepEqual(en.position.map((d) => d.id), ['now-en']);
  assert.equal(en.profile.length, m.profile.length);
  assert.deepEqual(spaceSummary(m).map((x) => [x.key, x.blocks]), [['math', 4], ['cs', 3], ['en', 3]]);
});

test('分科的记忆照样过自检', () => {
  const hard = checkMemory(M(), { today: TODAY }).problems.filter((p) => !p.soft);
  assert.deepEqual(hard, []);
});

test('记忆摘要只带这一科：英语课不带线代的弱点、错题，「下一节」用这一科的', () => {
  const en = memoryDigest(M(), { block: 'EN-L1.1.1', budget: 16 * 1024 }).text;
  assert.match(en, /EN-L1-01/);
  assert.match(en, /五种基本句型，从找谓语开始/);
  assert.ok(!en.includes('W19') && !en.includes('L2-07'));
  const la = memoryDigest(M(), { block: 'L2.2.2', budget: 16 * 1024 }).text;
  assert.match(la, /W19/);
  assert.ok(!la.includes('EN-L1-01'));
});

test('课堂里的 memo：错题按门课编号，下一节写进这一科的 position', () => {
  const m = M();
  const ctx = { mem: m, evidence: [{ id: 'ev-1', src: 'say', text: 'x', at: 1 }], session: 'c-20261028-1', block: 'EN-L1.1.1', date: TODAY };
  const e = planEntry(parseMemoLines('error q=x mine=y step=s cause=c basis=say').entries[0], ctx);
  assert.equal(e.target, 'EN-L1-02');
  const p = planEntry(parseMemoLines('position next="定语从句"').entries[0], ctx);
  assert.equal(p.target, 'now-en');
  assert.equal(nextErrorId(m.errors, 'DS-L2.1.1'), 'DS-L2-01');
  assert.equal(nextErrorId(m.errors, 'L2.2.1'), 'L2-08');
  const w = planEntry(parseMemoLines('weakness title="主谓一致" scope=局部 level=L1 basis=say').entries[0], ctx);
  assert.equal(w.data.space, 'en');
});

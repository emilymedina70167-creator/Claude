// 离考研多少天、「这一周」、课前热身、积压几次清完（docs/journey-plan.md）：都是页面按记录算的，不调用 Claude
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { EXAM_DATE, daysLeft, countdownText, studyDays, streak, weekMinutes, improvements, progress, warmupDrills, backlogDays, weekLines } = await import('../kit/src/memory/journey.js');
const { drillId } = await import('../kit/src/memory/drills.js');
const { lessonLines } = await import('../kit/src/memory/skills.js');

const at = (d, h = 10) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00`);

test('倒计时：考研是 2027-12-21；今天 2026-11-03 还有 413 天；当天写「今天考研」，过了不写', () => {
  assert.equal(EXAM_DATE, '2027-12-21');
  assert.equal(daysLeft('2026-11-03'), 413);
  assert.equal(countdownText('2026-11-03'), '离考研 413 天');
  assert.equal(countdownText('2027-12-21'), '今天考研');
  assert.equal(countdownText('2027-12-22'), '');
});

test('连着学了几天：今天还没学就从昨天往回数；点进课看一眼不算学', () => {
  const ev = ['2026-11-01', '2026-11-02', '2026-11-03'].map((d) => ({ src: 'record', at: at(d) }));
  assert.equal(streak(studyDays(ev), '2026-11-03'), 3);
  assert.equal(streak(studyDays(ev), '2026-11-04'), 3, '今天还没开始：数到昨天');
  assert.equal(streak(studyDays(ev), '2026-11-06'), 0);
  assert.equal(studyDays([{ src: 'event', kind: 'open', at: at('2026-11-05') }]).size, 0);
});

test('这 7 天和前 7 天各学了几分钟', () => {
  const mem = { sessions: [
    { date: '2026-11-02', report: { activeMs: 90 * 60000 } }, { date: '2026-10-28', report: { activeMs: 74 * 60000 } },
    { date: '2026-10-20', report: { activeMs: 30 * 60000 } },
  ], evidence: [{ src: 'say', at: at('2026-11-02') }, { src: 'say', at: at('2026-10-28') }] };
  const w = weekMinutes(mem, '2026-11-03');
  assert.deepEqual(w, { now: 164, before: 0, daysNow: 2, daysBefore: 0 });
});

function memWithClasses() {
  return {
    curriculum: [{ id: 'EN-L1.1.1', title: '五种句型' }, { id: 'EN-L1.2.1', title: '时态' }, { id: 'L2.1.1', title: '矩阵乘法' }, { id: 'DS-L8.2.1', title: '插入排序' }],
    sessions: [
      { id: 'c-20261102-1', date: '2026-11-02', startedAt: 1, report: { activeMs: 1 }, skills: { points: { 'EN-L1.1.1#dobj-oc': '双宾和宾补的区分' }, items: [{ k: 'qz-b9|题', p: 'EN-L1.1.1#dobj-oc' }, { k: 'ps-b17|题', p: 'EN-L1.1.1#dobj-oc' }], sum: { 'EN-L1.1.1#dobj-oc': { n: 11, first: 4, fail: 5, end: 'fail' } } } },
      { id: 'c-20261104-1', date: '2026-11-04', startedAt: 2, report: { activeMs: 40 * 60000 }, skills: { items: [], sum: { 'EN-L1.1.1#dobj-oc': { n: 2, first: 2, fail: 0, end: 'clean' } } } },
    ],
    mastery: [{ id: 'EN-L1.2.1', state: '基础题过', log: [{ date: '2026-11-04', by: 'page', field: 'state', from: '讲过', to: '基础题过' }] }, { id: 'L2.1.1', state: '讲过' }],
    drills: [{ id: drillId('c-20261102-1', 'qz-b9'), status: 'active' }, { id: drillId('c-20261102-1', 'ps-b17'), status: 'active' }],
  };
}

test('真实的进步：以前错过、最近一上来就对了的知识点；升了档的块', () => {
  const xs = improvements(memWithClasses(), { today: '2026-11-04' });
  assert.deepEqual(xs.map((x) => x.text), [
    '双宾和宾补的区分：11/02 错了 5 道，今天一上来就对了',
    '时态：两道不同的题一次做对，基础题过了',
  ]);
  assert.deepEqual(improvements(memWithClasses(), { today: '2026-11-04', space: 'math' }), [], '只看这一科');
  assert.deepEqual(improvements(memWithClasses(), { today: '2026-12-30' }), [], '两周以前的不说');
});

test('每科讲到哪：块数、讲过几块、过了几块', () => {
  const p = progress(memWithClasses());
  assert.deepEqual(p.map((x) => [x.space, x.label, x.total, x.taught, x.passed]), [['math', '线代', 1, 1, 0], ['cs', '数据结构', 1, 0, 0], ['en', '英语', 2, 1, 1]]);
  // 一科里有好几门课的块时写科目名
  const two = progress({ curriculum: [{ id: 'DS-L1.1.1' }, { id: 'OS-L1.1.1' }] });
  assert.equal(two[0].label, '408');
});

test('课前热身：上一节没稳的点在题库里有原题就挑出来（最多 3 道）；没有就不出', () => {
  const mem = memWithClasses();
  const last = mem.sessions[0];
  const next = lessonLines(last.skills).next;
  assert.deepEqual(warmupDrills(mem, last, next), [drillId('c-20261102-1', 'qz-b9'), drillId('c-20261102-1', 'ps-b17')]);
  assert.deepEqual(warmupDrills({ ...mem, drills: [] }, last, next), []);
  assert.deepEqual(warmupDrills(mem, last, []), []);
});

test('积压：3 组以内不说；18 组一次 3 组 6 次清完', () => {
  assert.equal(backlogDays(3), 0);
  assert.equal(backlogDays(18), 6);
  assert.equal(backlogDays(19), 7);
});

test('「这一周」那几句：只说真发生了的事，没有可说的就是空的', () => {
  assert.deepEqual(weekLines({}, { today: '2026-11-04' }), []);
  const mem = { ...memWithClasses(), evidence: ['2026-11-02', '2026-11-03', '2026-11-04'].map((d) => ({ src: 'record', at: at(d) })) };
  // 今天没做过复现、没想过记忆点：不说「都做完了」（全新的学习台上完第一节课也是这样）
  assert.ok(!weekLines(mem, { today: '2026-11-04', space: 'en' }).some((l) => l.k === 'done'));
  mem.evidence.push({ src: 'recall', at: at('2026-11-04') });
  const lines = weekLines(mem, { today: '2026-11-04', space: 'en' });
  assert.deepEqual(lines.map((l) => l.k), ['streak', 'week', 'done', 'better', 'better']);
  assert.equal(lines[0].text, '连着学了 3 天');
  assert.doesNotMatch(lines.map((l) => l.text).join(''), /太棒|厉害|加油|真棒/, '不夸');
  assert.ok(!weekLines(mem, { today: '2026-11-04', space: 'en', dueToday: 2 }).some((l) => l.k === 'done'), '还有到期的就不说「都做完了」');
});

test('msToNextDay：到下一个本地午夜（过 1 秒），至少 1 秒', async () => {
  const { msToNextDay } = await import('../kit/src/memory/journey.js');
  const t = new Date(2026, 10, 4, 23, 59, 0).getTime();
  assert.equal(msToNextDay(t), 61 * 1000);
  const noon = new Date(2026, 10, 4, 12, 0, 0).getTime();
  assert.equal(msToNextDay(noon), 12 * 3600 * 1000 + 1000);
  assert.equal(msToNextDay(new Date(2026, 10, 5, 0, 0, 0, 500).getTime()) > 23 * 3600 * 1000, true);
  assert.equal(msToNextDay(new Date(2026, 10, 5, 0, 0, 0, 999).getTime()) >= 1000, true);
});

// 课后数据处理：删课、试出来的选择题、知识点归类、按课算掌握、页面自己的结论重算、弱点出现次数、这节课的三行
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { purgePlan, purgeText } = await import('../kit/src/memory/purge.js');
const { buildReport, guessed, REPORT_VERSION } = await import('../kit/src/memory/report.js');
const { skillsPrompt, parseSkills, skillSummary, retagEvidence, weaknessHits, hitText, lessonLines, lessonLinesText, pointCatalog, needsSkills, SKILLS_HEAD, SKILLS_VERSION } = await import('../kit/src/memory/skills.js');
const { walk, masteryProposals } = await import('../kit/src/memory/mastery.js');
const { toEvidence } = await import('../kit/src/memory/session.js');
const { toAnswer } = await import('../kit/src/live/sync.js');
const { checkMemory } = await import('../kit/src/memory/check.js');
const { memoryDigest } = await import('../kit/src/memory/digest.js');
const { weaknessRows, curriculumTree } = await import('../kit/src/memory/views.js');
const { createDevAI } = await import('../kit/src/books/devmock.js');

const DAY = 86400000;
const T0 = Date.parse('2026-10-01T10:00:00');
const at = (d, min = 0) => T0 + d * DAY + min * 60000;
const rec = ({ comp, q = '题', ok, attempts = 1, d = 0, min = 0, session = 'c-20261001-1', block = 'EN-L3.1.1', type = 'answer', ...rest }) =>
  toEvidence('record', toAnswer({ type, block: comp, q, ok, attempts, final: true, at: at(d, min), ...rest }), { session, block });

test('删课：这节课的证据、笔记、改动单、题库、错题删掉；守则用到的失误、弱点挂着的错题留着；别的课不动', () => {
  const sid = 'c-20261102-2';
  const mem = {
    sessions: [{ id: sid }, { id: 'c-20261102-1' }],
    evidence: [{ id: 'ev-1', session: sid }, { id: 'ev-2', session: 'c-20261102-1' }],
    observations: [{ id: 'ob-1', session: sid }, { id: 'ob-2', session: 'c-20261102-1' }],
    pending: [{ id: 'pd-1', session: sid }],
    drills: [{ id: 'd-1', fromSession: sid }, { id: 'd-2', fromSession: 'c-20261102-1' }],
    slips: [{ id: 'S-1', session: sid }, { id: 'S-2', session: sid }],
    lessons: [{ id: 'T-1', slips: ['S-2'] }],
    errors: [{ id: 'EN-L1-01', session: sid }, { id: 'EN-L1-02', session: sid }, { id: 'EN-L1-03', session: sid }, { id: 'EN-L1-04', corrects: 'EN-L1-03' }],
    weaknesses: [{ id: 'W1', errors: ['EN-L1-02'] }],
  };
  const p = purgePlan(mem, sid);
  assert.deepEqual(p.docs.sort(), ['drills/d-1', 'errors/EN-L1-01', 'evidence/ev-1', 'observations/ob-1', 'pending/pd-1', `sessions/${sid}`, 'slips/S-1'].sort());
  assert.deepEqual(p.kept.map((k) => k.path).sort(), ['errors/EN-L1-02', 'errors/EN-L1-03', 'slips/S-2']);
  assert.ok(p.scoped.includes('steps') && p.scoped.includes('class_turns') && p.scoped.includes('report'));
  assert.deepEqual(p.ledger.sort(), ['errors/EN-L1-01', 'observations/ob-1', 'slips/S-1']);
  const t = purgeText(p, { title: '11/02 测试' });
  assert.match(t, /删掉「11\/02 测试」/);
  assert.match(t, /留着 3 条/);
  // 删完以后自检不报「指向的找不到」
  assert.deepEqual(p.unlink, [{ path: 'slips/S-2', doc: { wasSession: sid } }]);
  const after = Object.fromEntries(Object.entries(mem).map(([c, ds]) => [c, ds.filter((d) => !p.docs.includes(`${c}/${d.id}`)).map((d) => { const u = p.unlink.find((x) => x.path === `${c}/${d.id}`); return u ? { id: d.id, ...u.doc } : d; })]));
  const res = checkMemory(after, { today: '2026-11-03' });
  assert.ok(!res.problems.some((x) => /找不到/.test(x.msg) && /c-20261102-2|S-1|EN-L1-01/.test(x.msg)), JSON.stringify(res.problems));
});

test('试出来的：三个选项第二次才对、四个选项第三次才对是试出来的；多选、填空、一次对不算', () => {
  assert.ok(guessed({ kind: 'quiz', options: 3, attempts: 2, ok: true }));
  assert.ok(!guessed({ kind: 'quiz', options: 4, attempts: 2, ok: true }));
  assert.ok(guessed({ kind: 'quiz', options: 4, attempts: 3, ok: true }));
  assert.ok(guessed({ kind: 'quiz', options: 2, attempts: 2, ok: true }));
  assert.ok(!guessed({ kind: 'quiz', options: 3, attempts: 1, ok: true }));
  assert.ok(!guessed({ kind: 'quiz', options: 3, attempts: 2, ok: true, multi: true }));
  assert.ok(!guessed({ kind: 'answer', attempts: 3, ok: true }));
  assert.ok(guessed({ kind: 'quiz', attempts: 3, ok: true }), '旧记录没有选项数：三次以上算');
  assert.ok(!guessed({ kind: 'quiz', attempts: 2, ok: true }));
  const r = buildReport({ session: { id: 'c-20261001-1' }, evidence: [rec({ comp: 'qz-1', type: 'quiz', ok: true, attempts: 3, options: 3, wrong: ['A', 'B'] }), rec({ comp: 'qz-2', type: 'quiz', ok: true, attempts: 1, options: 3 })] });
  assert.equal(r.v, REPORT_VERSION);
  assert.equal(r.items.find((x) => x.comp === 'qz-1').guess, true);
  assert.equal(r.items.find((x) => x.comp === 'qz-1').outcome, 'ok');
  assert.equal(r.totals.guess, 1);
});

// 11-02 那节课的样子：先两道简单题一次对，后面难的错了，又在最后做对一道
function realClass() {
  const sid = 'c-20261102-1';
  const evs = [
    rec({ comp: 'qz-b3', ok: true, min: 0, session: sid, d: 32 }),
    rec({ comp: 'qz-b4', ok: true, min: 2, session: sid, d: 32 }),
    rec({ comp: 'qz-b9', ok: true, attempts: 2, min: 10, session: sid, d: 32, type: 'quiz', options: 3 }),
    rec({ comp: 'ps-b17', ok: false, min: 30, session: sid, d: 32 }),
    rec({ comp: 'ps-b19', ok: true, min: 40, session: sid, d: 32 }),
    rec({ comp: 'qz-b29', ok: true, attempts: 2, min: 60, session: sid, d: 32, type: 'quiz' }),
    rec({ comp: 'qz-b30', ok: true, min: 62, session: sid, d: 32 }),
  ];
  return { sid, evs, report: buildReport({ session: { id: sid }, evidence: evs }) };
}

test('按课算掌握：一节课里先对后错不算基础题过（不再一会儿过、一会儿掉）；当堂最后一次失手以后对的才攒', () => {
  const { report } = realClass();
  const items = report.items.map((it) => ({ ...it, session: 'c-20261102-1' }));
  assert.equal(walk(items, { state: '讲过' }).state, '讲过', '最后一次失手（qz-b29）以后只有一道干净题');
  // 下一节课又一上来做对两道不同的 → 基础题过
  const next = ['x1', 'x2'].map((k, i) => ({ key: k, outcome: 'first', first: at(34, i), session: 'c-20261104-1', evidence: [`ev-${k}`] }));
  assert.equal(walk([...items, ...next], { state: '讲过' }).state, '基础题过');
  // 过了以后：复现只看那节课一上来那道
  const passed = { state: '基础题过', last: '2026-10-01' };
  const g = (outcomes, d, sid) => outcomes.map((o, i) => ({ key: `k${d}-${i}`, outcome: o, first: at(d, i), session: sid, evidence: [`ev-${d}-${i}`] }));
  assert.equal(walk(g(['first', 'wrong'], 2, 's2'), passed).state, '复现通过', '一上来做对：后面错的是当堂的事');
  assert.equal(walk(g(['wrong', 'first', 'first'], 2, 's2'), passed).state, '掉了', '一上来就错：掉了，后面做对留到下一节');
  assert.equal(walk([...g(['wrong', 'first'], 2, 's2'), ...g(['first'], 3, 's3')], passed).state, '基础题过', '掉了以后当堂对的那道和下一节的一道攒够两道');
  // 没有课号的旧数据照原来的一道道算
  const it = (key, outcome, d) => ({ key, outcome, first: at(d), evidence: [`ev-${key}`] });
  assert.equal(walk([it('a', 'first', 0), it('b', 'first', 0)]).state, '基础题过');
});

test('页面以前算的结论按新规则重算：退回到页面算之前的状态；我和对话里定下的不动', () => {
  const { evs } = realClass();
  const mem = {
    curriculum: [{ id: 'EN-L3.1.1', title: '非谓语', level: 'block' }],
    evidence: evs,
    sessions: [{ id: 'c-20261102-1', date: '2026-11-02' }],
    mastery: [{ id: 'EN-L3.1.1', state: '掉了', log: [
      { date: '2026-10-28', by: 'chat', field: 'state', from: '未学', to: '讲过', basis: ['旧'] },
      { date: '2026-11-02', by: 'page', field: 'state', from: '讲过', to: '掉了', basis: ['ev-x'], ref: 'pd-1' },
    ] }],
    pending: [{ id: 'pd-1', by: 'page', kind: 'mastery', status: 'done', doneAt: at(32, 90) }],
  };
  const ps = masteryProposals(mem);
  const p = ps.find((x) => x.target === 'EN-L3.1.1');
  assert.ok(p, '有一条把它改回来的');
  assert.equal(p.patch.state, '讲过');
  assert.match(p.reason, /重算/);
  // 对话里的 Claude 定的「掉了」：不动
  const mem2 = { ...mem, mastery: [{ id: 'EN-L3.1.1', state: '掉了', log: [{ date: '2026-11-02', by: 'chat', field: 'state', from: '讲过', to: '掉了', basis: ['x'] }] }] };
  assert.ok(!masteryProposals(mem2).some((x) => x.target === 'EN-L3.1.1' && x.patch?.state === '讲过'));
});

test('归类：提示词带题、课程地图、用过的知识点、弱点、小结；读回来按题号对上题，写错的行丢掉', () => {
  const { report } = realClass();
  const curriculum = [{ id: 'EN-L1.1.1', title: '五种句型' }, { id: 'EN-L1.2.1', title: '时态' }, { id: 'EN-L3.1.1', title: '非谓语' }];
  const catalog = { 'EN-L1.1.1#basic': { title: '简单句一主一谓', block: 'EN-L1.1.1', n: 1 } };
  const weaknesses = [{ id: 'W40', title: '谓语认不准' }, { id: 'W43', title: '双宾宾补分不开' }];
  const p = skillsPrompt({ report, session: { id: 'c-20261102-1', date: '2026-11-02', blocks: ['EN-L3.1.1', 'EN-L1.2.1'] }, curriculum, catalog, weaknesses, summary: '双宾和宾补分不开' });
  assert.ok(p.startsWith(SKILLS_HEAD));
  assert.match(p, /^1\. ［EN-L3\.1\.1］「题」：✓ 一次对/m);
  assert.match(p, /^3\. .*把选项试遍了才对/m);
  assert.match(p, /EN-L1\.1\.1#basic 简单句一主一谓/);
  assert.match(p, /W43 双宾宾补分不开/);
  assert.match(p, /老师写的下课小结/);
  assert.match(p, /课上讲过的块：EN-L3\.1\.1、EN-L1\.2\.1/);
  const out = [
    '```', 'point EN-L1.1.1#dobj-oc 双宾和宾补的区分',
    'item 1 EN-L1.1.1#basic', 'item 2 EN-L1.1.1#basic', 'item 3 EN-L1.1.1#dobj-oc W43', 'item 4 EN-L1.1.1#dobj-oc W43',
    'item 5 EN-L1.1.1#dobj-oc', 'item 6 EN-L1.2.1#pred-whole W40', 'point EN-L1.2.1#pred-whole 谓语圈全', 'item 7 EN-L1.2.1#tense W40',
    'item 9 EN-L1.1.1#basic', 'item 2 EN-L9.9.9#x', 'item 1 EN-L1.1.1#basic W43', 'point EN-L1.1.1#BAD 大写不行', '```',
  ].join('\n');
  const got = parseSkills(out, { items: report.items, blocks: curriculum.map((b) => b.id), catalog, weaknesses });
  const by = Object.fromEntries(got.items.map((x) => [x.k, x]));
  assert.equal(by[report.items[2].key].p, 'EN-L1.1.1#dobj-oc');
  assert.equal(by[report.items[2].key].w, 'W43');
  assert.equal(by[report.items[5].key].p, 'EN-L1.2.1#pred-whole', '先写 item 后写 point 也认');
  assert.equal(by[report.items[0].key].w, undefined, '一次对的题不挂弱点');
  assert.ok(!by[report.items[6].key], '没先定义的新知识点丢掉');
  assert.deepEqual(got.points, { 'EN-L1.1.1#dobj-oc': '双宾和宾补的区分', 'EN-L1.2.1#pred-whole': '谓语圈全' });
  assert.ok(got.problems.some((x) => /第 9/.test(x)));
  assert.ok(got.problems.some((x) => /EN-L9\.9\.9/.test(x)));
  assert.ok(got.problems.some((x) => /BAD/.test(x)));
  assert.ok(got.problems.some((x) => /tense/.test(x)));
  const sum = skillSummary(report, got.items);
  assert.deepEqual(sum['EN-L1.1.1#basic'], { n: 2, first: 2, fail: 0, end: 'clean', w: [] });
  assert.deepEqual(sum['EN-L1.1.1#dobj-oc'], { n: 3, first: 1, fail: 2, end: 'clean', w: ['W43'] });
  const ll = lessonLines({ sum, points: got.points }, catalog);
  assert.deepEqual(ll.solid.map((x) => x.name), ['简单句一主一谓']);
  assert.equal(ll.shaky[0].name, '双宾和宾补的区分');
  assert.ok(ll.shaky[0].fixed);
  const text = lessonLinesText(ll).join('\n');
  assert.match(text, /会了：简单句一主一谓/);
  assert.match(text, /下次先测：双宾和宾补的区分/);
});

test('归类以后：证据换上真正的块和知识点，掌握按知识点算；要不要再归按报告的时间', () => {
  const { sid, evs, report } = realClass();
  const items = [
    { k: report.items[0].key, p: 'EN-L1.1.1#basic' }, { k: report.items[1].key, p: 'EN-L1.1.1#basic2' },
    { k: report.items[2].key, p: 'EN-L1.1.1#dobj-oc', w: 'W43' },
  ];
  const sessions = [{ id: sid, date: '2026-11-02', report: { at: 5, items: 7 }, skills: { v: SKILLS_VERSION, reportAt: 5, items, points: { 'EN-L1.1.1#basic': '简单句', 'EN-L1.1.1#basic2': '及物', 'EN-L1.1.1#dobj-oc': '双宾宾补' }, sum: skillSummary(report, items) } }];
  const re = retagEvidence(evs, sessions);
  assert.deepEqual(re[0].tags, ['EN-L1.1.1', 'EN-L1.1.1#basic']);
  assert.deepEqual(re[3].tags, ['EN-L3.1.1'], '没归类的照旧');
  const cat = pointCatalog(sessions);
  assert.equal(cat['EN-L1.1.1#dobj-oc'].title, '双宾宾补');
  assert.ok(!needsSkills(sessions[0]));
  assert.ok(needsSkills({ ...sessions[0], report: { at: 6, items: 7 } }), '报告重算过就再归');
  assert.ok(!needsSkills({ id: 'x', kind: 'drill', report: { at: 1, items: 3 } }));
  assert.ok(!needsSkills({ id: 'x', report: { at: 1, items: 0 } }));
  const mem = { curriculum: [{ id: 'EN-L1.1.1', level: 'block' }, { id: 'EN-L3.1.1', level: 'block' }], evidence: evs, sessions, mastery: [], pending: [] };
  const ps = masteryProposals(mem);
  assert.ok(!ps.some((x) => x.target.startsWith('EN-L1.1.1#basic')), '每个知识点只有一道干净题，还不够');
  // 下一节课 basic 又做对两道不同的 → 这个知识点基础题过，带标题
  const s2 = 'c-20261104-1';
  const more = [rec({ comp: 'q1', ok: true, d: 34, session: s2 }), rec({ comp: 'q2', ok: true, d: 34, min: 1, session: s2 })];
  const r2 = buildReport({ session: { id: s2 }, evidence: more });
  const sessions2 = [...sessions, { id: s2, date: '2026-11-04', skills: { items: r2.items.map((it) => ({ k: it.key, p: 'EN-L1.1.1#basic' })), points: {}, sum: {} } }];
  const add = masteryProposals({ ...mem, evidence: [...evs, ...more], sessions: sessions2 }).find((x) => x.target === 'EN-L1.1.1#basic');
  assert.equal(add?.data.state, '基础题过');
  assert.equal(add.data.title, '简单句');
  assert.ok(!ps.some((x) => x.target === 'EN-L3.1.1' && x.data?.state === '基础题过'), '简单题不再算进 EN-L3.1.1');
  // 课程地图上块里的知识点带标题
  const tree = curriculumTree({ ...mem, curriculum: [{ id: 'EN-L1', title: '一' }, { id: 'EN-L1.1', title: '节' }, { id: 'EN-L1.1.1', title: '块' }] });
  const blk = tree[0].children[0].children[0];
  assert.deepEqual(blk.points.map((p) => p.title), ['简单句', '及物', '双宾宾补']);
});

test('弱点出现几次：错题档案 + 归类挂上的，同一节课不重数；之后做对几道；弱点表和记忆摘要都带', () => {
  const mem = {
    errors: [{ id: 'EN-L1-01', weakness: 'W40', date: '2026-08-28' }, { id: 'EN-L3-03', weakness: 'W40', date: '2026-10-28', session: 'c-20261028-1' }, { id: 'EN-L3-09', weakness: 'W40', date: '2026-11-02', session: 'c-20261102-1' }],
    sessions: [
      { id: 'c-20261102-1', date: '2026-11-02', skills: { items: [{ k: 'a', p: 'EN-L1.2.1#pred', w: 'W40' }], sum: { 'EN-L1.2.1#pred': { n: 1, first: 0, fail: 1 } } } },
      { id: 'c-20261104-1', date: '2026-11-04', skills: { items: [{ k: 'b', p: 'EN-L1.2.1#pred' }], sum: { 'EN-L1.2.1#pred': { n: 2, first: 2, fail: 0 } } } },
    ],
    weaknesses: [{ id: 'W40', title: '谓语认不准', scope: '通用', level: 'L0', errors: ['EN-L1-01'], space: 'en' }],
  };
  const h = weaknessHits(mem).get('W40');
  assert.equal(h.n, 3, '08-28、10-28 的错题 + 11-02 归类挂上的（11-02 的错题不重数）');
  assert.equal(h.last, '2026-11-02');
  assert.equal(h.after, 2);
  assert.equal(hitText(h), '出现 3 次（2 节课），最近 2026-11-02；之后一次做对 2 道');
  assert.equal(weaknessRows(mem)[0].hits.n, 3);
  const d = memoryDigest({ ...mem, curriculum: [{ id: 'EN-L1.2.1', title: '时态' }], position: [{ id: 'now-en', block: 'EN-L1.2.1', next: '接着' }] }, { block: 'EN-L1.2.1' });
  assert.match(d.text, /W40 谓语认不准（通用，证据级 L0，出现 3 次/);
});

test('记忆摘要：上一节归过类的，带「下次先测」', () => {
  const mem = {
    curriculum: [{ id: 'EN-L1.1.1', title: '五种句型' }],
    sessions: [{ id: 'c-20261102-1', date: '2026-11-02', block: 'EN-L1.1.1', status: 'closed', report: { line: '28 题' }, skills: { points: { 'EN-L1.1.1#dobj-oc': '双宾和宾补的区分' }, items: [{ k: 'a', p: 'EN-L1.1.1#dobj-oc' }], sum: { 'EN-L1.1.1#dobj-oc': { n: 3, first: 1, fail: 2, end: 'fail', w: [] } } } }],
    position: [{ id: 'now-en', block: 'EN-L1.1.1', next: '接着' }],
  };
  const d = memoryDigest(mem, { block: 'EN-L1.1.1', session: 'c-20261104-1' });
  assert.match(d.text, /页面按知识点算的：还不稳：双宾和宾补的区分（错 2 道）。下次先测：双宾和宾补的区分/);
});

test('本地试用的模拟 Claude 也会归类（?dev 能走通）', async () => {
  const { report } = realClass();
  const curriculum = [{ id: 'EN-L1.1.1', title: '五种句型' }];
  const prompt = skillsPrompt({ report, session: { id: 's' }, curriculum, weaknesses: [{ id: 'W43', title: 'x' }] });
  const res = await createDevAI().call(prompt);
  const got = parseSkills(res.text, { items: report.items, blocks: ['EN-L1.1.1'], weaknesses: [{ id: 'W43' }] });
  assert.equal(got.items.length, report.items.length);
  assert.ok(got.items.some((x) => x.w === 'W43'));
  assert.deepEqual(got.problems, []);
});

// 学习台自己管自己（docs/autonomy-plan.md）：课堂里的 Claude 管记忆（错题、弱点、复现组、位置直接写，规则要确认，掌握不收），
// 记忆不冗杂（几乎一样的不收、每类有上限、每几节课下课时顺带合并），待办进备课，从备份恢复。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  parseMemoLines, planEntry, pendingRecord, applyPending, undoPending, voidedIds, overCaps, liveDocs, tidyDue, tidyText, CAPS, TIDY_EVERY,
} = await import('../kit/src/memory/memo.js');
const { sampleMemory } = await import('../kit/src/memory/sample.js');
const { checkMemory } = await import('../kit/src/memory/check.js');
const { memoryDigest } = await import('../kit/src/memory/digest.js');
const { closingPrompt } = await import('../kit/src/class/prompt.js');
const { openTodos, prepPrompt, parsePrep, lessonPlanText } = await import('../kit/src/books/plan.js');
const { backupFile, restorePlan } = await import('../kit/src/memory/backup.js');

const TODAY = '2026-10-27';
const SID = 'c-20261027-1';
const evidence = [
  { id: 'ev-1', src: 'record', kind: 'answer', comp: 'q-b5', step: 'b5', q: '求 A²', value: '3A', ok: false, session: SID, at: 1 },
  { id: 'ev-3', src: 'say', kind: 'say', text: '以后出题前先把规则讲完', session: SID, at: 3 },
];
const ctx = (mem) => ({ mem, evidence, session: SID, block: 'L2.2.2', date: TODAY });
const run = (body, mem = sampleMemory(TODAY)) => planEntry(parseMemoLines(body).entries[0], ctx(mem));
function apply(mem, writes) {
  const m = structuredClone(mem);
  for (const w of writes) { m[w.coll] = (m[w.coll] || []).filter((d) => String(d.id) !== String(w.id)); m[w.coll].push({ id: w.id, ...w.doc }); }
  return m;
}
const write = (mem, body) => { const ch = run(body, mem); assert.ok(!ch.error, ch.error); const r = applyPending(pendingRecord(ch, { session: SID }), mem, { date: TODAY }); return { mem: apply(mem, r.writes), pd: r.pd }; };
const hard = (m) => checkMemory(m, { today: TODAY }).problems.filter((p) => !p.soft);

test('掌握不收；别的（规则也）直接写', () => {
  const r = parseMemoLines('mastery id=L2.2.2 state=基础题过\nrules text=x');
  assert.equal(r.entries.length, 0);
  assert.match(r.errors[0], /页面按证据算/);
  assert.match(r.errors[1], /写 rule/);
  for (const [body, tier] of [['error step=a cause=b basis=q-b5', 'direct'], ['weakness id=W19 level=L0 basis=q-b5', 'direct'], ['review id=R3 result=没过 basis=q-b5', 'direct'], ['position next="x"', 'direct'], ['rule text="出题前先把规则讲完" basis=say', 'direct']]) {
    assert.equal(run(body).tier, tier, body);
  }
});

test('几乎一样的不收：弱点、复现组、偏好、规则；改那一条', () => {
  assert.match(run('weakness title="内积和外积分不清" scope=链条 level=L0 basis=q-b5').error, /和 W19.*同一个弱点/);
  assert.match(run('review title="秩一：拆 αβᵀ、求 Aⁿ" basis=q-b5').error, /和 R3.*同一组/);
  assert.match(run('pref topic=目标 text="考研数学一 + 408。" basis=say').error, /和 p-goal.*同一件事/);
  assert.match(run('rule text="交互优先：能拖、能猜的先让我动手，再讲结论" basis=say').error, /和 rule-02.*同一件事/);
  // 不一样的照收
  assert.equal(run('weakness title="分块时行列数对不上" scope=局部 level=L0 basis=q-b5').target, 'W20');
});

test('每类到了那个数：照样收新的（2026-11-14 起不挡），overCaps 报出来让下课整理', () => {
  const mem = sampleMemory(TODAY);
  for (let i = 0; i < CAPS.weaknesses; i++) mem.weaknesses.push({ id: `W${100 + i}`, title: `毛病 ${i} ${'甲乙丙丁戊己庚辛'.repeat(i % 3 + 1)}${i}`, scope: '局部', level: 'L0', status: 'active', blocks: ['L2.2.1'] });
  assert.ok(liveDocs(mem, 'weaknesses', 'math').length > CAPS.weaknesses);
  assert.ok(!run('weakness title="完全不同的一件事" scope=局部 level=L0 basis=q-b5', mem).error);
  assert.deepEqual(overCaps(mem, 'math').map((x) => x.coll), ['weaknesses']);
  assert.deepEqual(overCaps(mem, 'cs'), []); // 408 的弱点不算数学的
});

test('合并：status=merged into=…，被并的摘要里不再带，能撤销；自检照样过', () => {
  let mem = sampleMemory(TODAY);
  ({ mem } = write(mem, 'weakness title="分块时行列数对不上" scope=局部 level=L0 basis=q-b5'));
  assert.match(run('weakness id=W20 status=merged into=W99', mem).error, /要写一条还在用的/);
  const { mem: m2, pd } = write(mem, 'weakness id=W20 status=merged into=W19');
  assert.equal(m2.weaknesses.find((w) => w.id === 'W20').status, 'merged');
  assert.ok(voidedIds(m2).has('weaknesses/W20'));
  assert.ok(!memoryDigest(m2, { block: 'L2.2.1' }).text.includes('分块时行列数对不上'));
  assert.deepEqual(hard(m2), []);
  const u = undoPending(pd, m2, { date: TODAY });
  assert.equal(apply(m2, u.writes).weaknesses.find((w) => w.id === 'W20').status, 'active');
  // 复现组、偏好也能并
  const { mem: m3 } = write(m2, 'review id=R5 status=merged into=R3');
  assert.equal(m3.reviews.find((r) => r.id === 'R5').into, 'R3');
  assert.match(run('review id=R4 status=done', m3).error, /why/);
  const { mem: m4 } = write(m3, 'pref id=p-lang status=merged into=p-goal');
  assert.ok(voidedIds(m4).has('profile/p-lang'));
  assert.deepEqual(hard(m4), []);
});

test('同一道题不记两次错题', () => {
  const { mem } = write(sampleMemory(TODAY), 'error step=a cause=b basis=q-b5');
  assert.match(run('error step=c cause=d basis=q-b5', mem).error, /这道题已经记过 L2-08/);
});

test('规则：学生说了就直接写（新编号 rule-c…），改、作废也直接写；要有依据', () => {
  const mem = sampleMemory(TODAY);
  const ch = run('rule cat=讲解 text="出题前先把要用到的规则讲完" basis=say', mem);
  assert.equal(ch.target, 'rule-c1');
  assert.equal(ch.data.basis[0], 'ev-3');
  const r = applyPending(pendingRecord(ch), mem, { date: TODAY });
  assert.equal(r.pd.status, 'done');
  const m = apply(mem, r.writes);
  assert.equal(m.rules.find((x) => x.id === 'rule-c1').log.at(-1).by, 'class');
  assert.deepEqual(hard(m), []);
  assert.equal(run('rule id=rule-01 text="课堂不能宣布我掌握了：掌握由页面按证据算。" basis=say', m).tier, 'direct');
  assert.match(run('rule id=rule-01 status=void', m).error, /why/);
});

test('下课顺带整理：每 5 节一次、或者到了上限；目录一条一行；closingPrompt 带上', () => {
  const mem = sampleMemory(TODAY);
  mem.sessions = Array.from({ length: TIDY_EVERY - 1 }, (_, i) => ({ id: `c-2026102${i}-1`, kind: 'class', status: 'closed', block: 'L2.2.1', date: TODAY }));
  assert.match(tidyDue(mem, 'math', SID), /第 5 节/);
  assert.equal(tidyDue(mem, 'cs', 'c-x'), ''); // 408 一节没上
  mem.sessions.pop();
  assert.equal(tidyDue(mem, 'math', SID), '');
  const t = tidyText(mem, 'math');
  assert.match(t, /- W19 内积和外积分不清/);
  assert.match(t, /- R3 /);
  assert.match(t, /- p-goal/);
  const p = closingPrompt({ report: '报告', tidy: { why: '到了上限', text: t } });
  assert.match(p, /顺带整理记忆（到了上限）/);
  assert.match(p, /status=merged into=/);
  assert.ok(!closingPrompt({ report: '报告' }).includes('顺带整理'));
});

test('待办：课上记、备课带上、补上了写进教案，课堂看得到', () => {
  const { mem } = write(sampleMemory(TODAY), 'todo text="学生问了相似对角化的几何意义"');
  const todo = mem.observations.find((o) => o.kind === 'todo');
  assert.equal(todo.status, 'open');
  assert.deepEqual(hard(mem), []);
  const open = openTodos(mem, 'math');
  assert.equal(open.length, 1);
  assert.equal(openTodos(mem, 'math', [todo.id]).length, 0);
  assert.equal(openTodos(mem, 'en').length, 0);
  const prompt = prepPrompt({ block: { id: 'L2.2.2', title: 'x' }, todos: open });
  assert.ok(prompt.includes(todo.id) && prompt.includes('"todos"'));
  const raw = JSON.stringify({ goal: 'g', sequence: [{ step: 1, point: 'p' }], todos: [todo.id, 'ob-nope'] });
  const { main } = parsePrep(raw, { block: { id: 'L2.2.2' }, todos: open });
  assert.deepEqual(main.todos, [{ id: todo.id, text: '学生问了相似对角化的几何意义' }]);
  assert.match(lessonPlanText(main).todos, /相似对角化/);
});

test('从备份恢复：默认只补缺的，覆盖要明说', () => {
  const mem = sampleMemory(TODAY);
  const file = backupFile({ memory: mem, today: TODAY });
  const have = new Set(['weaknesses/W19', 'reviews/R3']);
  const keep = restorePlan(file, { have });
  assert.equal(keep.clash, 2);
  assert.ok(!keep.writes.some((w) => w.path === 'weaknesses/W19'));
  assert.equal(restorePlan(file, { have, overwrite: true }).writes.length, keep.writes.length + 2);
  assert.throws(() => restorePlan({ format: 'x' }), /不是学习台的备份/);
});

test('待确认分批：同一批凑够三条合成一组；给我看的标题不写编号', async () => {
  const { groupPending, pendingTitle } = await import('../kit/src/memory/memo.js');
  const rule = (i) => ({ id: `pd-r${i}`, kind: 'rule', by: 'chat', status: 'open', op: 'update', target: `rule-${i}`, patch: { text: `第 ${i} 条` } });
  const err = (i, s) => ({ id: `pd-e${i}`, kind: 'error', by: 'class', session: s, status: 'open', op: 'add', target: `L2-0${i}`, data: { cause: '把内积当外积' } });
  const g = groupPending([rule(1), err(1, 'c-20261027-1'), rule(2), rule(3), err(2, 'c-20261028-1')]);
  assert.deepEqual(g.map((x) => [x.label, x.items.length]), [['整理规则', 3], ['', 1], ['', 1]]);
  const g2 = groupPending([1, 2, 3].map((i) => err(i, 'c-20261027-1')));
  assert.equal(g2[0].label, '10 月 27 日那节课提的');
  // 编号换成名字；不给 nameOf（发给课堂 Claude 的）照旧写编号
  const w = { id: 'pd-w', kind: 'weakness', label: '弱点', op: 'update', target: 'W19', patch: { level: 'L0', last: '2026-11-03' } };
  const names = { W19: '内积和外积分不清' };
  assert.equal(pendingTitle(w, (c, id) => names[id] || ''), '弱点：「内积和外积分不清」 证据级 → L0');
  assert.equal(pendingTitle(w), '弱点：W19 level → L0');
  assert.equal(pendingTitle(err(1, 'c'), () => ''), '错题：把内积当外积');
});

test('别一丁点小事都记、别反复累加：同一件事不另记，列表不越堆越长；一节课的条数不挡（2026-11-14）', async () => {
  const { SESSION_CAPS, LIST_CAPS } = await import('../kit/src/memory/memo.js');
  let mem = sampleMemory(TODAY);
  // 同一个毛病一节课只记一道错题
  ({ mem } = write(mem, 'error q="求 A² 的形状" mine="3×3" step=a cause="把内积当外积" weakness=W19 basis=say'));
  assert.match(run('error q="另一道：αβᵀ 是几行几列" mine="数" step=b cause="又把外积当数" weakness=W19 basis=say', mem).error, /同一个毛病只记一道/);
  // 失误和已有的一条说的是同一件事
  ({ mem } = write(mem, 'slip text="出题前没先把要用到的规则讲完，学生撞墙后才补"'));
  assert.match(run('slip text="出题前没把规则讲完，学生撞墙了才补"', mem).error, /已经记过了|守则/);
  // 观察：和已经记的一样的不收；说的是不同的事，第四条照样收
  ({ mem } = write(mem, 'note text="形状判断要停很久，先数行列再判断"'));
  assert.match(run('note text="形状判断停很久，先数行列"', mem).error, /同一件事/);
  for (const t of ['换括号那一步总要提示', '图看懂了但写不出式子']) ({ mem } = write(mem, `note text="${t}"`));
  assert.ok(!run('note text="完全不同的第四条观察内容在这里"', mem).error);
  assert.ok(SESSION_CAPS.note > 0);
  // 待办一样的不收
  ({ mem } = write(mem, 'todo text="学生问了相似对角化的几何意义"'));
  assert.match(run('todo text="学生问相似对角化的几何意义是什么"', mem).error, /一样的待办/);
  // 欠账整张换掉、最多 5 条、每条截短
  const pos = run(`position next="x" debts="${Array.from({ length: 8 }, (_, i) => `第 ${i} 条欠账${'很长'.repeat(60)}`).join('；')}"`, mem);
  assert.equal(pos.patch.debts.length, LIST_CAPS.debts);
  assert.ok(pos.patch.debts.every((d) => d.length <= 80));
  // 复现组的题：一样的不加，最多 6 道
  const r3 = mem.reviews.find((r) => r.id === 'R3');
  r3.content = Array.from({ length: 6 }, (_, i) => `旧题 ${i}：${'子丑寅卯'.repeat(i + 1)}`);
  assert.match(run(`review id=R3 add="${r3.content[2]}" basis=say`, mem).error, /一样的题/);
  assert.equal(run('review id=R3 add="新的一道：秩一矩阵的 n 次方" basis=say', mem).patch.content.length, LIST_CAPS.content);
});

// 学习台第 2 批（docs/desk-plan.md 第 4 节）：课堂里的 Claude 用 memo 块改记忆，分档、改动单、确认 / 不要 / 撤销、我自己改。
// 学习台自己管自己（docs/autonomy-plan.md）：错题、弱点、复现组、位置改成直接写，规则要确认，掌握不收。
// 课堂里实际走一遍在真浏览器里另外验（desk-demo.html?dev + 「测试:整理」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem0 = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem0.has(k) ? mem0.get(k) : null), setItem: (k, v) => mem0.set(k, String(v)), removeItem: (k) => mem0.delete(k), key: () => null, length: 0 };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };

const {
  parseMemoLines, resolveBasis, planEntry, pendingRecord, applyPending, rejectPending, undoPending, canUndo, meChange, voidedIds, resolvedErrors,
  nextErrorId, nextSlipId, memoLine, pendingTitle,
} = await import('../kit/src/memory/memo.js');
const { createMemOps } = await import('../kit/src/memory/memops.js');
const { parseOutput } = await import('../kit/src/class/protocol.js');
const { sampleMemory } = await import('../kit/src/memory/sample.js');
const { checkMemory } = await import('../kit/src/memory/check.js');
const { assertWrite, addDays, toDate, UNDO_DAYS, dueList } = await import('../kit/src/memory/schema.js');
const { fakeDb } = await import('../kit/src/live/store.js');
const { memoryDigest } = await import('../kit/src/memory/digest.js');

const TODAY = '2026-10-27';
const SID = 'c-20261027-1';
const evidence = [
  { id: 'ev-1', src: 'record', kind: 'answer', comp: 'q-b5', step: 'b5', q: '求 A²', value: 'ααᵀββᵀ', ok: false, session: SID, at: 1 },
  { id: 'ev-2', src: 'record', kind: 'answer', comp: 'q-b5', step: 'b5', q: '求 A²', value: '3A', ok: true, session: SID, at: 2 },
  { id: 'ev-3', src: 'say', kind: 'say', text: '能不能先画图', session: SID, at: 3 },
];
const ctx = (mem = sampleMemory(TODAY)) => ({ mem, evidence, session: SID, block: 'L2.2.2', date: TODAY });
const memo = (body) => parseMemoLines(body).entries[0];
const run = (body, c = ctx()) => planEntry(memo(body), c);

// 把写入用到记忆副本上（模拟数据库）
function apply(mem, writes) {
  const m = structuredClone(mem);
  for (const w of writes) {
    m[w.coll] = (m[w.coll] || []).filter((d) => String(d.id) !== String(w.id));
    m[w.coll].push({ id: w.id, ...w.doc });
  }
  return m;
}
const hard = (m) => checkMemory(m, { today: TODAY }).problems.filter((p) => !p.soft);

test('memo 块：一行一条，认识的几种；掌握不收；读不懂的行说清原因', () => {
  const r = parseMemoLines([
    'error q="求 A²" step="第 1 步" cause="把 βᵀα 当矩阵" weakness=W19 basis=q-b5',
    '- pref topic=讲法 text="先看图再推公式" basis=say',
    'mastery id=L2.2.2 state=基础题过',
    'hello world',
    'slip text=一次出了两道题 lesson="一块板一件事"',
    'note text=先看 图',
    '',
  ].join('\n'));
  assert.deepEqual(r.entries.map((e) => e.kind), ['error', 'pref', 'slip']);
  assert.deepEqual(r.entries[0].attrs.basis, ['q-b5']);
  assert.equal(r.errors.length, 3);
  assert.match(r.errors[0], /掌握状态由页面按证据算/);
  assert.match(r.errors[1], /不认识「hello」/);
  assert.match(r.errors[2], /「图」不是 key=value/); // 有空格的值没加引号
  // 协议：board memo 是一种指令；一条也没读懂时整块算看不懂
  const out = parseOutput('好。\n\n````board memo\npref topic=讲法 text="先看图" basis=say\n````\n', { final: true });
  assert.equal(out.ops[0].op, 'memo');
  assert.equal(out.ops[0].entries.length, 1);
  assert.equal(parseOutput('````board memo\nmastery id=L2.2.2 state=讲过\n````\n', { final: true }).rejected.length, 1);
});

test('依据：证据 id、记忆里的编号、组件 / 段 id 换成证据、say 是学生最近说的话；找不到的报出来', () => {
  const r = resolveBasis(['q-b5', 'W19', 'say', 'ev-1', 'b9'], ctx());
  assert.deepEqual(r.ids, ['ev-1', 'ev-2', 'W19', 'ev-3']);
  assert.deepEqual(r.missing, ['b9']);
  assert.match(run('error q=x mine=y step=s cause=c basis=b9').error, /b9 找不到/);
  assert.match(run('error q=x mine=y step=s cause=c').error, /要写依据/);
});

test('分档：都直接写（规则也是，2026-11-03）；偏好什么 topic 都行', () => {
  const pref = run('pref topic=讲法 text="先看图再推公式" basis=say');
  assert.equal(pref.tier, 'direct');
  assert.equal(pref.coll, 'profile');
  assert.equal(run('pref topic=目标 text="考 130 以上" basis=say').tier, 'direct');
  assert.equal(run('todo text="学生问了相似对角化的几何意义"').data.kind, 'todo');
  const rule = run('rule cat=讲解 text="出题前先把要用到的规则讲完" basis=say');
  assert.equal(rule.tier, 'direct');
  assert.equal(rule.coll, 'rules');
  assert.match(run('rule text="x"').error, /要写依据/);
  assert.match(run('rule cat=随便 text="x" basis=say').error, /cat 只能是/);
  assert.equal(run('slip text="一次出了两道题"').target, 'S-20261027-1-1');
  assert.equal(run('note text="换括号还是慢"').data.kind, 'note');
  assert.equal(run('propose text="W19 可以降一级" about=W19 basis=q-b5').data.kind, 'proposal');
  // 错题：题面、答案从依据的作答里补；编号按这一讲往下编
  const err = run('error step="第 1 步换括号" cause="把 βᵀα 当矩阵" weakness=W19 basis=q-b5');
  assert.equal(err.tier, 'direct');
  assert.equal(err.target, 'L2-08');
  assert.equal(err.data.q, '求 A²');
  assert.equal(err.data.mine, '3A'); // 依据里最后那次作答
  assert.deepEqual(err.data.evidence, ['ev-1', 'ev-2']);
  assert.match(run('error id=L2-07 q=x mine=y step=s cause=c basis=q-b5').error, /已经有了/);
  assert.match(run('error q=x mine=y step=s cause=c weakness=W99 basis=q-b5').error, /W99 在弱点表里没有/);
  // 弱点：改已有的（证据级）只记改了的字段；新的自动编号
  const w = run('weakness id=W19 level=L0 basis=q-b5');
  assert.deepEqual(w.patch, { level: 'L0', last: TODAY });
  // 证据级没变、只带了新依据（又出现了一次）：接上依据、记最近一次，不拒掉
  const again = run('weakness id=W19 level=L1 basis=q-b5');
  assert.equal(again.patch.last, TODAY);
  assert.ok(again.patch.basis.length > 0);
  assert.match(run('weakness id=W19 level=L9 basis=q-b5').error, /level 只能是/);
  assert.equal(run('weakness title="分不清行列" scope=局部 level=L1 basis=q-b5').target, 'W20');
  // 复现组：判结果按档位走；加题；新组从明天开始
  const rv = run('review id=R3 result=过 basis=q-b5');
  assert.deepEqual(rv.patch, { result: '过', tier: 7, last: TODAY });
  assert.equal(run('review id=R4 add="分块乘一道" basis=q-b5').patch.content.at(-1), '分块乘一道');
  const nr = run('review title="换括号" weaknesses=W19 basis=q-b5');
  assert.equal(nr.target, 'R6');
  assert.equal(nr.data.tier, 1);
  // 位置
  assert.deepEqual(run('position next="先收 L2-08 的同类题" debts="例 2.3；例 2.4"').patch, { next: '先收 L2-08 的同类题', debts: ['例 2.3', '例 2.4'] });
});

test('直接写的：课堂里的 Claude 的身份写；越权的（掌握）在代码层面拦住', () => {
  const mem = sampleMemory(TODAY);
  const pd = pendingRecord(run('pref topic=习惯 text="晚上学，别太长" basis=say'), { session: SID, turn: 4 });
  const r = applyPending(pd, mem, { date: TODAY });
  assert.equal(r.pd.status, 'done');
  const m = apply(mem, r.writes);
  assert.ok(m.profile.some((p) => p.text === '晚上学，别太长' && p.status === 'active'));
  assert.deepEqual(hard(m), []);
  // 课堂里的 Claude 宣布掌握、直接改规则：assertWrite 拦住
  assert.throws(() => assertWrite('class', 'mastery'), /不能写 mastery/);
  assert.throws(() => applyPending({ ...pendingRecord(run('weakness id=W19 level=L0 basis=q-b5')), coll: 'mastery' }, mem), /不能写 mastery/);
  // 错题、弱点直接写进去，自检照样过
  const e = applyPending(pendingRecord(run('error step="第 1 步" cause="把 βᵀα 当矩阵" weakness=W19 basis=q-b5'), { session: SID }), m, { date: TODAY });
  const m2 = apply(m, e.writes);
  assert.equal(m2.errors.find((x) => x.id === 'L2-08').cause, '把 βᵀα 当矩阵');
  assert.deepEqual(hard(m2), []);
});

test('直接写的状态类记 log（by: class）；以前留下、还开着的改动单照旧能确认（能先改再确认）、能不要', () => {
  const mem = sampleMemory(TODAY);
  const w = pendingRecord(run('weakness id=W19 level=L0 basis=q-b5'), { session: SID });
  const r = applyPending(w, mem, { date: TODAY });
  const m = apply(mem, r.writes);
  const W19 = m.weaknesses.find((x) => x.id === 'W19');
  assert.equal(W19.level, 'L0');
  const log = W19.log.at(-1);
  assert.equal(log.by, 'class');
  assert.equal(log.note, `课堂 ${SID}`);
  assert.equal(log.ref, w.id);
  assert.deepEqual(log.basis, ['ev-1', 'ev-2']);
  assert.deepEqual(r.pd.applied, [{ field: 'level', from: 'L1', to: 'L0' }, { field: 'last', from: addDays(TODAY, -6), to: TODAY }]);
  assert.deepEqual(hard(m), []);
  assert.throws(() => applyPending(r.pd, m), /已经写进去了/);
  // 以前留下的等确认的（confirm 档）：改了再确认
  const rl = { ...pendingRecord(run('rule cat=讲解 text="出题前先把要用到的规则讲完" basis=say'), { session: SID }), tier: 'confirm' };
  assert.equal(rl.status, 'open');
  assert.equal(rl.target, 'rule-c1');
  const r2 = applyPending(rl, m, { date: TODAY, edits: { text: '出一组题之前，逐题列出要用到的规则，没讲过的先讲完' } });
  const m2 = apply(m, r2.writes);
  const nr = m2.rules.find((x) => x.id === 'rule-c1');
  assert.equal(nr.text, '出一组题之前，逐题列出要用到的规则，没讲过的先讲完');
  assert.equal(nr.log.at(-1).note, `我确认于 ${TODAY}`);
  assert.deepEqual(hard(m2), []);
  // 作废一条规则
  const rv = run('rule id=rule-c1 status=void why="和 rule-01 重复"', { ...ctx(m2) });
  assert.deepEqual(rv.patch, { status: 'void', note: '和 rule-01 重复' });
  // 不要
  const n = rejectPending({ ...pendingRecord(run('rule cat=讲解 text="每块板先写这段要回答什么" basis=say')), tier: 'confirm' }, { date: TODAY });
  assert.equal(n.pd.status, 'rejected');
  assert.equal(n.writes.length, 1); // 只改改动单，位置没动
  assert.deepEqual(hard(apply(m2, n.writes)), []);
});

test('撤销：状态类退回旧值（也记 log）；历史类追加作废的更正；超时、后来又改过的不能撤', () => {
  const mem = sampleMemory(TODAY);
  const w = applyPending(pendingRecord(run('weakness id=W19 level=L0 basis=q-b5')), mem, { date: TODAY });
  let m = apply(mem, w.writes);
  const u = undoPending(w.pd, m, { date: TODAY });
  m = apply(m, u.writes);
  const W19 = m.weaknesses.find((x) => x.id === 'W19');
  assert.equal(W19.level, 'L1');
  assert.equal(W19.log.at(-1).by, 'me');
  assert.match(W19.log.at(-1).note, /撤销 pd-/);
  assert.equal(u.pd.status, 'undone');
  assert.deepEqual(hard(m), []);
  // 错题：原条不动，加一条 void 的更正；摘要不再带它
  const e = applyPending(pendingRecord(run('error step=s cause=c weakness=W19 basis=q-b5')), m, { date: TODAY });
  m = apply(m, e.writes);
  const ue = undoPending(e.pd, m, { date: TODAY });
  m = apply(m, ue.writes);
  assert.ok(m.errors.find((x) => x.id === 'L2-08'));
  const fix = m.errors.find((x) => x.corrects === 'L2-08');
  assert.equal(fix.void, true);
  assert.equal(fix.id, 'L2-09');
  assert.ok(voidedIds(m).has('errors/L2-08'));
  assert.deepEqual(hard(m), []);
  const dg = memoryDigest(m, { block: 'L2.2.2', budget: 16 * 1024 });
  assert.ok(!dg.text.includes('L2-08') && !dg.text.includes('L2-09'));
  // 新加的偏好：撤销就是 status: void
  const p = applyPending(pendingRecord(run('pref topic=讲法 text="先看图" basis=say')), m, { date: TODAY });
  m = apply(m, p.writes);
  m = apply(m, undoPending(p.pd, m, { date: TODAY }).writes);
  assert.equal(m.profile.find((x) => x.id === p.pd.target).status, 'void');
  assert.ok(!memoryDigest(m, { block: 'L2.2.2' }).text.includes('先看图'));
  // 超时
  // 按写进去那天算（doneAt 是真实的时间戳）
  const day = toDate(p.pd.doneAt);
  assert.ok(canUndo(p.pd, day));
  assert.ok(canUndo(p.pd, addDays(day, UNDO_DAYS - 1)));
  assert.ok(!canUndo(p.pd, addDays(day, UNDO_DAYS)));
  assert.throws(() => undoPending({ ...p.pd, status: 'done' }, m, { date: addDays(day, UNDO_DAYS + 1) }), /超过 7 天/);
  // 后来又改过
  const w2 = applyPending(pendingRecord(run('weakness id=W19 level=L2 basis=q-b5')), m, { date: TODAY });
  let m3 = apply(m, w2.writes);
  m3.weaknesses.find((x) => x.id === 'W19').level = 'L3';
  assert.throws(() => undoPending(w2.pd, m3, { date: TODAY }), /后来又改过了/);
});

test('我自己改：偏好的文字、错题标已解决（加更正）、复现组暂停 / 恢复，都能撤', () => {
  let m = sampleMemory(TODAY);
  const p = applyPending(meChange('pref', m, { id: 'p-lang', text: '术语附英文，括号里写' }), m, { date: TODAY });
  m = apply(m, p.writes);
  assert.equal(m.profile.find((x) => x.id === 'p-lang').text, '术语附英文，括号里写');
  assert.equal(p.pd.tier, 'me');
  const r = applyPending(meChange('resolve', m, { id: 'L2-07' }), m, { date: TODAY });
  m = apply(m, r.writes);
  assert.ok(resolvedErrors(m).has('L2-07'));
  assert.equal(m.errors.find((x) => x.id === 'L2-07').resolved, undefined); // 原条不动
  const s = applyPending(meChange('pause', m, { id: 'R4' }), m, { date: TODAY });
  m = apply(m, s.writes);
  assert.ok(!dueList(m.reviews, TODAY).some((x) => x.id === 'R4'));
  assert.equal(m.reviews.find((x) => x.id === 'R4').log.at(-1).by, 'me');
  assert.deepEqual(hard(m), []);
  m = apply(m, undoPending(r.pd, m, { date: TODAY }).writes);
  assert.ok(!resolvedErrors(m).has('L2-07'));
  assert.throws(() => meChange('pause', m, { id: 'R4' }), /已经暂停了/);
  assert.deepEqual(hard(m), []);
});

test('一轮记了什么：板顶下面那一行；改动单的标题', () => {
  const pds = [
    { kind: 'pref', label: '偏好', tier: 'direct', status: 'done' },
    { kind: 'error', label: '错题', tier: 'confirm', status: 'open' },
    { kind: 'error', label: '错题', tier: 'confirm', status: 'open' },
    { kind: 'weakness', label: '弱点', tier: 'confirm', status: 'rejected' },
  ];
  assert.equal(memoLine(pds), '记下了：偏好 1 条；待你确认：错题 2 条；没要 / 撤了 1 条');
  assert.match(pendingTitle(pendingRecord(run('weakness id=W19 level=L0 basis=q-b5'))), /^弱点：W19 level → L0$/);
  assert.equal(nextErrorId([{ id: 'L2-T03' }, { id: 'L2-11' }], 'L2.2.1'), 'L2-12');
  assert.equal(nextSlipId([{ id: 'S-20261027-1-2' }], SID, TODAY), 'S-20261027-1-3');
});

test('数据库这一层：直接写的马上写；同一道题不记两次；一个 memo 块最多 12 条', async () => {
  const db = fakeDb('memo-test');
  db._clear();
  const seed = sampleMemory(TODAY);
  for (const [c, docs] of Object.entries(seed)) for (const d of docs) { const { id, ...rest } = d; await db.doc(`${c}/${id}`).set(rest); }
  for (const e of evidence) { const { id, ...rest } = e; await db.doc(`evidence/${id}`).set(rest); }
  const read = async () => {
    const out = {};
    for (const c of [...Object.keys(seed), 'pending']) out[c] = (await db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    return out;
  };
  let mem = await read();
  const ops = createMemOps({ db, mem: () => mem });
  const { entries } = parseMemoLines([
    'pref topic=讲法 text="先看图" basis=say',
    'error step=a cause=b basis=q-b5',
    'error step=c cause=d basis=q-b5',
    'weakness id=W19 level=L9 basis=q-b5',
    'rule cat=讲解 text="出题前先把要用到的规则讲完" basis=say',
  ].join('\n'));
  const { pds, rejected } = await ops.applyMemo(entries, { session: SID, block: 'L2.2.2', turn: 6 });
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].error, /这道题已经记过 L2-08/);
  assert.deepEqual(pds.map((p) => [p.kind, p.status, p.target]), [['pref', 'done', pds[0].target], ['error', 'done', 'L2-08'], ['rule', 'done', 'rule-c1']]);
  mem = await read();
  assert.ok(mem.profile.some((p) => p.text === '先看图'));
  assert.ok(mem.errors.some((e) => e.id === 'L2-08'));
  assert.ok(mem.rules.some((r) => r.id === 'rule-c1'));
  // 一节课里一种记几条不再按条数挡：说的不是同一件事就都收
  const notes = parseMemoLines(['甲乙丙', '丁戊己', '庚辛壬', '子丑寅'].map((t, i) => `note text="第 ${i} 条：${t.repeat(4)}的观察"`).join('\n')).entries;
  const capped = await ops.applyMemo(notes, { session: SID, block: 'L2.2.2', turn: 7 });
  assert.equal(capped.pds.length, 4);
  // 一个 memo 块最多 12 条（归纳守则不算；不在课上的不按一节课数）
  const many = parseMemoLines(Array.from({ length: 14 }, (_, i) => `note text="观察 ${'子丑寅卯辰巳午未申酉戌亥'.slice(i % 12)}${i}${'金木水火土'.repeat(i % 5 + 1)}"`).join('\n')).entries;
  const big = await ops.applyMemo(many, { session: null, block: 'L2.2.2', turn: 7 });
  assert.equal(big.pds.length + big.rejected.length, 14);
  assert.ok(big.rejected.some((r) => /最多记 12 条/.test(r.error)));
  mem = await read();
  await ops.undo(pds[0]);
  mem = await read();
  assert.equal(mem.profile.find((p) => p.text === '先看图').status, 'void');
  await ops.me('pause', { id: 'R3' });
  mem = await read();
  assert.equal(mem.reviews.find((r) => r.id === 'R3').status, 'paused');
  assert.deepEqual(hard(mem), []);
});

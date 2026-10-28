// 学习台第 2 批（docs/desk-plan.md 第 4 节）：课堂里的 Claude 用 memo 块改记忆，分三档、改动单、确认 / 不要 / 撤销、我自己改。
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

test('memo 块：一行一条，认识的几种；掌握、规则只能提议；读不懂的行说清原因', () => {
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
  assert.match(r.errors[0], /掌握状态你只能提议.*propose/);
  assert.match(r.errors[1], /不认识「hello」/);
  assert.match(r.errors[2], /「图」不是 key=value/); // 有空格的值没加引号
  // 协议：board memo 是一种指令；一条也没读懂时整块算看不懂
  const out = parseOutput('好。\n\n````board memo\npref topic=讲法 text="先看图" basis=say\n````\n', { final: true });
  assert.equal(out.ops[0].op, 'memo');
  assert.equal(out.ops[0].entries.length, 1);
  assert.equal(parseOutput('````board memo\nrule text=x\n````\n', { final: true }).rejected.length, 1);
});

test('依据：证据 id、记忆里的编号、组件 / 段 id 换成证据、say 是学生最近说的话；找不到的报出来', () => {
  const r = resolveBasis(['q-b5', 'W19', 'say', 'ev-1', 'b9'], ctx());
  assert.deepEqual(r.ids, ['ev-1', 'ev-2', 'W19', 'ev-3']);
  assert.deepEqual(r.missing, ['b9']);
  assert.match(run('error q=x mine=y step=s cause=c basis=b9').error, /b9 找不到/);
  assert.match(run('error q=x mine=y step=s cause=c').error, /要写依据/);
});

test('三档：偏好、失误、观察直接写；错题、弱点、复现组、位置等确认；偏好只能是讲法 / 习惯', () => {
  const pref = run('pref topic=讲法 text="先看图再推公式" basis=say');
  assert.equal(pref.tier, 'direct');
  assert.equal(pref.coll, 'profile');
  assert.match(run('pref topic=目标 text=x basis=say').error, /只能是 讲法 \/ 习惯/);
  assert.equal(run('slip text="一次出了两道题"').target, 'S-20261027-1-1');
  assert.equal(run('note text="换括号还是慢"').data.kind, 'note');
  assert.equal(run('propose text="W19 可以降一级" about=W19 basis=q-b5').data.kind, 'proposal');
  // 错题：题面、答案从依据的作答里补；编号按这一讲往下编
  const err = run('error step="第 1 步换括号" cause="把 βᵀα 当矩阵" weakness=W19 basis=q-b5');
  assert.equal(err.tier, 'confirm');
  assert.equal(err.target, 'L2-08');
  assert.equal(err.data.q, '求 A²');
  assert.equal(err.data.mine, '3A'); // 依据里最后那次作答
  assert.deepEqual(err.data.evidence, ['ev-1', 'ev-2']);
  assert.match(run('error id=L2-07 q=x mine=y step=s cause=c basis=q-b5').error, /已经有了/);
  assert.match(run('error q=x mine=y step=s cause=c weakness=W99 basis=q-b5').error, /W99 在弱点表里没有/);
  // 弱点：改已有的（证据级）只记改了的字段；新的自动编号
  const w = run('weakness id=W19 level=L0 basis=q-b5');
  assert.deepEqual(w.patch, { level: 'L0', last: TODAY });
  assert.match(run('weakness id=W19 level=L1 basis=q-b5').error, /没有要改的/);
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

test('直接写的：课堂里的 Claude 的身份写；越权的在代码层面拦住', () => {
  const mem = sampleMemory(TODAY);
  const pd = pendingRecord(run('pref topic=习惯 text="晚上学，别太长" basis=say'), { session: SID, turn: 4 });
  const r = applyPending(pd, mem, { date: TODAY });
  assert.equal(r.pd.status, 'done');
  const m = apply(mem, r.writes);
  assert.ok(m.profile.some((p) => p.text === '晚上学，别太长' && p.status === 'active'));
  assert.deepEqual(hard(m), []);
  // 课堂里的 Claude 直接写错题、宣布掌握：assertWrite 拦住
  assert.throws(() => assertWrite('class', 'errors'), /不能写 errors/);
  assert.throws(() => applyPending({ ...pendingRecord(run('error step=s cause=c basis=q-b5')), tier: 'direct' }, mem), /不能写 errors/);
  assert.throws(() => applyPending({ ...pd, data: { ...pd.data, topic: '目标' } }, mem), /只能写「讲法」「习惯」/);
});

test('等确认的：不点确认不写；确认后照规矩写（状态类记 log，by: class，note 写我确认的）；不要的留痕', () => {
  const mem = sampleMemory(TODAY);
  const w = pendingRecord(run('weakness id=W19 level=L0 basis=q-b5'), { session: SID });
  assert.equal(w.status, 'open');
  const r = applyPending(w, mem, { date: TODAY });
  const m = apply(mem, r.writes);
  const W19 = m.weaknesses.find((x) => x.id === 'W19');
  assert.equal(W19.level, 'L0');
  const log = W19.log.at(-1);
  assert.equal(log.by, 'class');
  assert.equal(log.note, `我确认于 ${TODAY}`);
  assert.equal(log.ref, w.id);
  assert.deepEqual(log.basis, ['ev-1', 'ev-2']);
  assert.deepEqual(r.pd.applied, [{ field: 'level', from: 'L1', to: 'L0' }, { field: 'last', from: addDays(TODAY, -6), to: TODAY }]);
  assert.deepEqual(hard(m), []);
  assert.throws(() => applyPending(r.pd, m), /已经写进去了/);
  // 改了再确认
  const e = pendingRecord(run('error step="第 1 步" cause="把 βᵀα 当矩阵" weakness=W19 basis=q-b5'), { session: SID });
  const r2 = applyPending(e, m, { date: TODAY, edits: { cause: '没看出 βᵀα 是数' } });
  const m2 = apply(m, r2.writes);
  assert.equal(m2.errors.find((x) => x.id === 'L2-08').cause, '没看出 βᵀα 是数');
  assert.deepEqual(hard(m2), []);
  // 不要
  const n = rejectPending(pendingRecord(run('position next="x"')), { date: TODAY });
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

test('数据库这一层：直接写的马上写，等确认的只写改动单；两道新错题确认时不撞号', async () => {
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
  ].join('\n'));
  const { pds, rejected } = await ops.applyMemo(entries, { session: SID, block: 'L2.2.2', turn: 6 });
  assert.equal(rejected.length, 1);
  assert.deepEqual(pds.map((p) => [p.kind, p.status, p.target]), [['pref', 'done', pds[0].target], ['error', 'open', 'L2-08'], ['error', 'open', 'L2-09']]);
  mem = await read();
  assert.ok(mem.profile.some((p) => p.text === '先看图'));
  assert.ok(!mem.errors.some((e) => e.id === 'L2-08')); // 没确认就没写
  // 先确认第二道（占了 L2-09），再确认第一道
  await ops.confirm(pds[2]);
  mem = await read();
  const first = await ops.confirm(pds[1]);
  assert.equal(first.target, 'L2-08');
  mem = await read();
  assert.deepEqual(mem.errors.map((e) => e.id).sort(), ['L2-07', 'L2-08', 'L2-09']);
  await assert.rejects(ops.confirm(pds[1]), /已经写进去了/);
  await ops.undo(pds[0]);
  mem = await read();
  assert.equal(mem.profile.find((p) => p.text === '先看图').status, 'void');
  await ops.me('pause', { id: 'R3' });
  mem = await read();
  assert.equal(mem.reviews.find((r) => r.id === 'R3').status, 'paused');
  assert.deepEqual(hard(mem), []);
});

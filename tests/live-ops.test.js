// 实时黑板的教具指令（ops 集合）和黑板现状里新加的三项：不碰 DOM 的部分。
// 等段画出来、在板上画、刷新后放回去在真浏览器里另外验（Playwright，见 docs/live-tools-spec.md 第 4 节）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveOp, opTargets, nextOps, resultLine, segSig, opKey, restorePlan, cmdText, OPS_KEEP } from '../kit/src/live/ops.js';
import { statusRecord, sameStatus, NOW_LIMITS } from '../kit/src/live/layout.js';
import { blockCommand, parseOutput } from '../kit/src/class/protocol.js';
import { markText } from '../kit/src/markspec.js';

// —— 读懂一条指令 ——

test('parseLiveOp：mark / unmark / figure 和课堂 board 块的第一行写法一样', () => {
  const m = parseLiveOp({ id: 'o7', seq: 7, cmd: 'mark target=s3 term=key note="只看这一条"', body: '' });
  assert.equal(m.error, undefined);
  assert.equal(m.op.op, 'mark');
  assert.equal(m.op.marks.length, 1);
  assert.deepEqual(m.op.marks[0].sel, { kind: 'term', name: 'key' });
  assert.equal(m.op.marks[0].note, '只看这一条');
  assert.equal(m.seq, 7);

  const f = parseLiveOp({ id: 'o8', seq: 8, cmd: 'figure target=m-prod play t 0 1 2s' });
  assert.deepEqual({ op: f.op.op, target: f.op.target, action: f.op.action, name: f.op.name, ms: f.op.ms }, { op: 'figure', target: 'm-prod', action: 'play', name: 't', ms: 2000 });
  assert.deepEqual(parseLiveOp({ id: 'o9', seq: 9, cmd: 'figure target=fig-1 set x=[1, 2] k=2' }).op.assigns, { x: '[1, 2]', k: '2' });
  assert.equal(parseLiveOp({ id: 'o10', seq: 10, cmd: 'figure target=m-cut highlight 1' }).op.index, 1);

  const u = parseLiveOp({ id: 'o11', seq: 11, cmd: 'unmark id=m1' });
  assert.deepEqual(u.op.ids, ['m1']);
  assert.equal(parseLiveOp({ id: 'o12', seq: 12, cmd: 'unmark all' }).op.all, true);
});

test('parseLiveOp：mark 的 body 一行一条，沿用开头那行的 target、颜色；写错的行单独报', () => {
  const r = parseLiveOp({ id: 'o1', seq: 1, cmd: 'mark target=m-b6 color=pink', body: 'row 1 note="×(−1)"\nrow 2 note="×2"\n\nrow x' });
  assert.equal(r.op.marks.length, 2);
  assert.deepEqual(r.op.marks.map((m) => [m.target, m.color, m.sel.i]), [['m-b6', 'pink', 1], ['m-b6', 'pink', 2]]);
  assert.equal(r.op.errors.length, 1);
  assert.match(r.op.errors[0], /第 3 行/);
  // 和课堂里闭合的 board mark 块一模一样（同一个 blockCommand）
  const cls = parseOutput('````board mark target=m-b6 color=pink\nrow 1 note="×(−1)"\nrow 2 note="×2"\n\nrow x\n````', { final: true }).ops[0];
  assert.deepEqual({ ...cls, body: undefined }, { ...blockCommand('mark target=m-b6 color=pink', 'row 1 note="×(−1)"\nrow 2 note="×2"\n\nrow x'), body: undefined });
});

test('parseLiveOp：抄课堂写法时多写的 board、围栏的反引号都认', () => {
  assert.equal(parseLiveOp({ id: 'o1', seq: 1, cmd: 'board mark target=s1' }).op.op, 'mark');
  assert.equal(parseLiveOp({ id: 'o1', seq: 1, cmd: '````board figure target=f play t````' }).op.action, 'play');
  assert.equal(cmdText('board  mark   target=s1\n'), 'mark target=s1');
});

test('parseLiveOp：段的指令不收（说明「段用 steps 写」）；看不懂的、写错的、缺 seq 的都说原因', () => {
  for (const cmd of ['new id=b1', 'add id=b2 title="x"', 'replace id=s3', 'hide id=s3', 'pin id=k1', 'unpin id=k1']) {
    const r = parseLiveOp({ id: 'o1', seq: 1, cmd });
    assert.equal(r.op, undefined, cmd);
    assert.match(r.error, /段用 steps 写/, cmd);
  }
  assert.match(parseLiveOp({ id: 'o1', seq: 1, cmd: 'circle target=s1' }).error, /ops 里只收 mark \/ unmark \/ figure/);
  assert.match(parseLiveOp({ id: 'o1', seq: 1, cmd: '' }).error, /cmd 是空的/);
  assert.match(parseLiveOp({ id: 'o1', seq: 1, cmd: 'mark term=x' }).error, /缺少 target/);
  assert.match(parseLiveOp({ id: 'o1', seq: 1, cmd: 'mark target=s1 color=gold2' }).error, /color 只认/);
  assert.match(parseLiveOp({ id: 'o1', seq: 1, cmd: 'figure target=f jump' }).error, /只认 set \/ play \/ highlight/);
  assert.match(parseLiveOp({ id: 'o1', seq: 1, cmd: 'unmark' }).error, /unmark 后面写/);
  assert.match(parseLiveOp({ id: 'o1', cmd: 'mark target=s1' }).error, /缺少 seq/);
  // 字符串的 seq 也认（数据库里偶尔写成字符串）
  assert.equal(parseLiveOp({ id: 'o1', seq: '3', cmd: 'mark target=s1' }).seq, 3);
});

test('opTargets：mark 等每条标注的 target（去重），figure 等图，unmark 不用等', () => {
  const m = parseLiveOp({ id: 'o1', seq: 1, cmd: 'mark target=s5 term=a', body: 'term=b\ntarget=m-cut row 1' }).op;
  assert.deepEqual(opTargets(m), ['s5', 'm-cut']);
  assert.deepEqual(opTargets(parseLiveOp({ id: 'o2', seq: 2, cmd: 'figure target=m-cut highlight 1' }).op), ['m-cut']);
  assert.deepEqual(opTargets(parseLiveOp({ id: 'o3', seq: 3, cmd: 'unmark target=s5' }).op), []);
  assert.deepEqual(opTargets(null), []);
});

// —— 先后、执行过没有 ——

test('nextOps：没执行过的按 seq 排，seq 一样按 id；done 可以是 Set 或函数', () => {
  const docs = [{ id: 'o3', seq: 9 }, { id: 'o1', seq: 7 }, { id: 'o2', seq: 7 }, { id: 'o4', seq: 8 }];
  assert.deepEqual(nextOps(docs).map((d) => d.id), ['o1', 'o2', 'o4', 'o3']);
  assert.deepEqual(nextOps(docs, new Set(['o1', 'o4'])).map((d) => d.id), ['o2', 'o3']);
  assert.deepEqual(nextOps(docs, (d) => d.seq < 9).map((d) => d.id), ['o3']);
  assert.deepEqual(nextOps(null), []);
});

test('opKey：同一条指令一样；改了 cmd、body、seq 就算新的一版', () => {
  const a = { id: 'o1', seq: 1, cmd: 'mark target=s1', body: '' };
  assert.equal(opKey(a), opKey({ ...a }));
  assert.notEqual(opKey(a), opKey({ ...a, cmd: 'mark target=s2' }));
  assert.notEqual(opKey(a), opKey({ ...a, body: 'row 1' }));
  assert.notEqual(opKey(a), opKey({ ...a, seq: 2 }));
});

// —— 结果写成一行 ——

test('resultLine：画上了几条、擦掉了哪些、执行了、没执行的原因', () => {
  assert.equal(resultLine('o7', 'mark target=s3 term=key', { op: 'mark', ok: true, marks: [{ id: 'm2' }] }), 'o7 mark target=s3 term=key：画上了 m2');
  assert.equal(resultLine('o7', 'mark target=s3', { op: 'mark', ok: true, marks: [{ id: 'm2' }, { id: 'm3' }], error: 's3 里第 9 行：矩阵只有 3 行' }), 'o7 mark target=s3：画上了 m2、m3；没画上的：s3 里第 9 行：矩阵只有 3 行');
  assert.equal(resultLine('o8', 'figure target=m-prod play t', { op: 'figure', ok: false, error: 'm-prod 在第 2 块板上，不在当前板上' }), 'o8 figure target=m-prod play t：没执行（m-prod 在第 2 块板上，不在当前板上）');
  assert.equal(resultLine('o9', 'unmark id=m1', { op: 'unmark', ok: true, ids: ['m1'] }), 'o9 unmark id=m1：擦掉了 m1');
  assert.equal(resultLine('o9', 'unmark all', { op: 'unmark', ok: true, ids: [] }), 'o9 unmark all：板上没有标注，没擦什么');
  assert.equal(resultLine('o10', 'figure target=f play t', { op: 'figure', action: 'play', ok: true, jumped: true }), 'o10 figure target=f play t：执行了（学生在看旧板，直接跳到了终点）');
  assert.equal(resultLine('o11', 'figure target=f highlight 1', { op: 'figure', action: 'highlight', ok: true }, ['第 1 条命令不画东西']), 'o11 figure target=f highlight 1：执行了；第 1 条命令不画东西');
  assert.ok(resultLine('o1', 'x', { ok: false, error: '很长'.repeat(400) }).length <= 300);
});

// —— 刷新后放回去 ——

test('segSig：板、位置、标题、内容任何一样变了指纹就变', () => {
  const s = { page: 2, place: 'board', title: 't', md: 'a' };
  assert.equal(segSig(s), segSig({ ...s }));
  for (const ch of [{ page: 3 }, { place: 'pin' }, { title: 'u' }, { md: 'b' }]) assert.notEqual(segSig(s), segSig({ ...s, ...ch }));
});

test('restorePlan：按 seq 重放 mark / unmark；段变了（指纹对不上）、撤回了的标注不放回去', () => {
  const sig = { s3: 'A', s5: 'B', s6: 'C2' };
  const spec = (t) => ({ target: t, sel: { kind: 'all' }, style: 'box', color: 'yellow' });
  const recs = [
    { id: 'o9', seq: 9, kind: 'unmark', ids: ['m1'] },
    { id: 'o7', seq: 7, kind: 'mark', marks: [{ id: 'm1', seg: 's3', spec: spec('s3'), sig: 'A' }, { id: 'm2', seg: 's3', spec: spec('s3'), sig: 'A' }] },
    { id: 'o8', seq: 8, kind: 'mark', marks: [{ id: 'm3', seg: 's5', spec: spec('m-cut'), sig: 'B' }] },
    { id: 'o10', seq: 10, kind: 'mark', marks: [{ id: 'm4', seg: 's6', spec: spec('s6'), sig: 'C1' }] }, // s6 后来改了
    { id: 'o11', seq: 11, kind: 'mark', marks: [{ id: 'm5', seg: 's7', spec: spec('s7'), sig: 'D' }] }, // s7 撤回了
    { id: 'o12', seq: 12, kind: 'mark', ok: false, marks: [] },
  ];
  const r = restorePlan(recs, (id) => sig[id]);
  assert.deepEqual(r.marks.map((m) => m.id), ['m2', 'm3']);
  assert.deepEqual(r.marks[1], { id: 'm3', seg: 's5', spec: spec('m-cut') });
  assert.deepEqual(r.ids, ['m1', 'm2', 'm3', 'm4', 'm5'], '用过的 id 都算（自动编号接着往下）');
});

test('restorePlan：同一个标注 id 再标一次排到最后；没记指纹的不放回去', () => {
  const spec = { target: 's1', sel: { kind: 'all' } };
  const r = restorePlan([
    { seq: 1, kind: 'mark', marks: [{ id: 'm1', seg: 's1', spec, sig: 'X' }, { id: 'm2', seg: 's1', spec, sig: 'X' }] },
    { seq: 2, kind: 'mark', marks: [{ id: 'm1', seg: 's1', spec: { ...spec, note: '新' }, sig: 'X' }, { id: 'm3', seg: 's1', spec }] },
  ], () => 'X');
  assert.deepEqual(r.marks.map((m) => m.id), ['m2', 'm1']);
  assert.equal(r.marks[1].spec.note, '新');
});

test('restorePlan：figure 只还原 set / play（play 到终点由页面做），段变了的不还原；highlight 不还原', () => {
  const r = restorePlan([
    { seq: 3, kind: 'figure', action: 'play', target: 'm-pow', args: { name: 'k', from: 1, to: 3 }, seg: 's1', sig: 'A' },
    { seq: 1, kind: 'figure', action: 'set', target: 'm-pow', args: { assigns: { k: '2' } }, seg: 's1', sig: 'A' },
    { seq: 2, kind: 'figure', action: 'set', target: 'fig', args: { assigns: { x: '1' } }, seg: 's2', sig: 'old' },
    { seq: 4, kind: 'figure', action: 'highlight', target: 'm-pow', args: { index: 1 }, seg: 's1', sig: 'A' },
  ], (id) => ({ s1: 'A', s2: 'new' })[id]);
  assert.deepEqual(r.figures, [
    { target: 'm-pow', action: 'set', args: { assigns: { k: '2' } } },
    { target: 'm-pow', action: 'play', args: { name: 'k', from: 1, to: 3 } },
  ]);
  assert.deepEqual(restorePlan(null), { marks: [], figures: [], ids: [] });
});

// —— 黑板现状里的三项 ——

test('statusRecord：ops 留最近 10 条，marks 一段一行（markText 的写法），figures 列图和变量', () => {
  const lines = Array.from({ length: 14 }, (_, i) => `o${i + 1} mark target=s1：画上了 m${i + 1}`);
  const spec = { target: 's3', sel: { kind: 'term', name: 'key' }, style: 'circle', color: 'yellow', note: '只看这一条' };
  const rec = statusRecord({
    cur: 2,
    ops: lines,
    marks: [{ step: 's3', list: [markText('m1', spec), markText('m2', { target: 's3', sel: { kind: 'row', i: 2 }, style: 'box', color: 'yellow' })] }, { step: 's4', list: [] }],
    figures: [{ id: 'm-cut', kind: 'matrix', step: 's5', vars: ['A', 'k'] }, { kind: 'scene' }],
  });
  assert.equal(OPS_KEEP, NOW_LIMITS.ops);
  assert.equal(rec.ops.length, 10);
  assert.equal(rec.ops[0], 'o5 mark target=s1：画上了 m5');
  assert.equal(rec.ops.at(-1), 'o14 mark target=s1：画上了 m14');
  assert.deepEqual(rec.marks, ['s3：m1：s3 里\\hl{key}（圈）「只看这一条」；m2：s3 里第 2 行（框）']);
  assert.deepEqual(rec.figures, [{ id: 'm-cut', kind: 'matrix', step: 's5', vars: ['A', 'k'] }]);
  // 不给就是空的（旧调用照常）
  const bare = statusRecord({});
  assert.deepEqual([bare.ops, bare.marks, bare.figures], [[], [], []]);
});

test('sameStatus：指令结果、标注、图的变量变了都算有变化', () => {
  const base = { cur: 1, ops: ['o1 mark target=s1：画上了 m1'], marks: [{ step: 's1', list: ['m1：整个 s1（框）'] }], figures: [{ id: 'f', kind: 'scene', step: 's1', vars: ['t'] }] };
  const a = statusRecord(base);
  assert.ok(sameStatus(a, statusRecord(base)));
  assert.ok(!sameStatus(a, statusRecord({ ...base, ops: [...base.ops, 'o2 unmark all：擦掉了 m1'] })));
  assert.ok(!sameStatus(a, statusRecord({ ...base, marks: [] })));
  assert.ok(!sameStatus(a, statusRecord({ ...base, figures: [{ id: 'f', kind: 'scene', step: 's1', vars: ['t', 'x'] }] })));
});

// —— 说明书（CLAUDE-PROJECT.md）里的写法照抄就能用 ——

test('说明书：第五节 ops 的例子、第六节「教具指令」的例子都读得懂；画法、颜色和 markspec.js 一致', async () => {
  const { readFileSync } = await import('node:fs');
  const { MARK_STYLES, MARK_COLORS } = await import('../kit/src/markspec.js');
  const doc = readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8');
  const live = doc.slice(doc.indexOf('### 标注、让图动、板顶的话'), doc.indexOf('### 黑板现状'));
  const cmds = [...live.matchAll(/"cmd": ("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]));
  assert.ok(cmds.length >= 4, '第五节有 ops 的例子');
  cmds.forEach((cmd, i) => assert.equal(parseLiveOp({ id: `o${i}`, seq: i + 1, cmd }).error, undefined, cmd));
  const tools = doc.slice(doc.indexOf('### 教具指令：figure、mark / unmark'), doc.indexOf('### 课后：读课堂记录'));
  assert.ok(tools.length > 500, '第六节有「教具指令」这一小节');
  const lines = [...tools.matchAll(/`((?:figure|mark) target=[^`]+|unmark [^`]+)`/g)].map((m) => m[1]);
  assert.ok(lines.length >= 6);
  for (const l of lines) assert.equal(parseLiveOp({ id: 'o1', seq: 1, cmd: l }).error, undefined, l);
  for (const s of MARK_STYLES) assert.ok(tools.includes(`\`${s}\``), `style ${s}`);
  for (const c of MARK_COLORS) assert.ok(tools.includes(`\`${c}\``), `color ${c}`);
});

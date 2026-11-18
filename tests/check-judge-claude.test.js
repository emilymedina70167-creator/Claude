// 检验：给页面里的 Claude 判要点的那一条、读回、过没过、找补讲（kit/src/check/judge.js 的另一半）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProbe } from '../kit/src/check/spec.js';
import { JUDGE_WAIT, DEFAULT_FALLBACK, claudeIds, verdictPrompt, parseVerdict, outcomeOf, teachFor, fallbackPrompt } from '../kit/src/check/judge.js';

const P = (type, src) => { const r = parseProbe(type, src); if (r.error) throw new Error(r.error); return r.probe; };
const recall = P('recall', `id: p3\nq: 写出 (A+B)^2 的展开\ntarget: L2-56\nlevel: 核心
must m1: 四项，AB、BA 分开
must m2: 条件 AB = BA
may m3: 举一个反例
wrong w1: 对所有方阵都成立
teach m2: 只有 AB = BA 时才能并。
teach tag=规则用错: 规则用错了。
teach default: 先乘开。`);

test('常量', () => {
  assert.equal(JUDGE_WAIT, 90000);
  assert.equal(DEFAULT_FALLBACK, '指出错在哪、只补缺的那一点（不给整段答案）。');
});

test('claudeIds：must、may、wrong 的编号', () => {
  assert.deepEqual(claudeIds(recall, []), ['m1', 'm2', 'm3', 'w1']);
});

test('parseVerdict 读四种', () => {
  const r = parseVerdict('[判]\nm1 ok\nm2 missing\nw1 wrong why="写了恒成立"\nm3 unsure why="看不清"', ['m1', 'm2', 'm3', 'w1']);
  assert.deepEqual(r.items.map((x) => x.ok), [true, 'missing', null, false]);
  assert.equal(r.items.find((x) => x.id === 'w1').why, '写了恒成立');
  assert.equal(r.items.find((x) => x.id === 'm3').unsure, true);
  assert.equal(r.unread, false);
  // 要点不是步骤：missing 不带「步骤缺」
  assert.equal(r.items.find((x) => x.id === 'm2').tag, '');
});

test('parseVerdict：多写的编号丢掉，没写到的是没判', () => {
  const r = parseVerdict('m1 ok\nm9 ok', ['m1', 'm2']);
  assert.deepEqual(r.items.map((x) => x.id), ['m1', 'm2']);
  assert.deepEqual(r.items[1], { id: 'm2', ok: null, why: '没判这一项', tag: '' });
});

test('parseVerdict：一整段话读不出来 → unread，过没过是 pending，绝不是 pass', () => {
  const r = parseVerdict('学生写得很好，基本都对了，可以算过。', ['m1', 'm2']);
  assert.equal(r.unread, true);
  assert.ok(r.items.every((x) => x.ok === null));
  assert.equal(outcomeOf(recall, r.items, { sure: 'sure' }).outcome, 'pending');
});

test('parseVerdict 读转写', () => {
  const r = parseVerdict('[转写]\nL1: (A+B)^2=(A+B)(A+B)\nL2 [划掉]: (A+B)^2=A^2+2AB+B^2\n[判]\nm1 ok', ['m1']);
  assert.deepEqual(r.lines, [{ n: 1, text: '(A+B)^2=(A+B)(A+B)', struck: false }, { n: 2, text: '(A+B)^2=A^2+2AB+B^2', struck: true }]);
});

test('outcomeOf：may 不算、有 null 是 pending、蒙对标出来', () => {
  const it = (o) => Object.entries(o).map(([id, ok]) => ({ id, ok }));
  assert.equal(outcomeOf(recall, it({ m1: true, m2: true, m3: false, w1: true })).outcome, 'pass');
  assert.deepEqual(outcomeOf(recall, it({ m1: true, m2: 'missing', m3: true, w1: false })).failed, ['m2', 'w1']);
  assert.equal(outcomeOf(recall, it({ m1: true, m2: null, w1: true })).outcome, 'pending');
  const g = outcomeOf(recall, it({ m1: true, m2: true, w1: true }), { sure: 'guess' });
  assert.equal(g.outcome, 'pass');
  assert.equal(g.guessed, true);
  // 有失败又有拿不准：算失败
  assert.equal(outcomeOf(recall, it({ m1: false, m2: null, w1: true })).outcome, 'fail');
});

test('teachFor：先编号、再 tag、想不出来、最后 default', () => {
  assert.equal(teachFor(recall, ['m2'], []).key, 'm2');
  assert.equal(teachFor(recall, ['m1'], [{ id: 'm1', ok: false, tag: '规则用错' }]).key, 'tag=规则用错');
  assert.equal(teachFor(recall, ['m1'], [{ id: 'm1', ok: false }]).key, 'default');
  assert.equal(teachFor(recall, [], [], { giveup: true }).key, 'default');
  const bare = P('recall', 'id: q\nq: 写\ntarget: x\nlevel: 基础\nmust m1: 一\nteach m1: 一');
  assert.equal(teachFor(bare, ['w1'], []), null);
  assert.equal(teachFor(bare, ['m1'], []).text, '一');
});

test('verdictPrompt：只写事实、有 unsure 那一句、不提他她、不写宽严', () => {
  const t = verdictPrompt({ probe: recall, answer: { text: '(A+B)^2=A^2+AB+BA+B^2' }, ids: claudeIds(recall, []) });
  assert.match(t, /看不清、拿不准对错的写 unsure，页面会标待主讲核/);
  assert.match(t, /m2/);
  assert.match(t, /条件 AB = BA/);
  assert.match(t, /\(A\+B\)\^2=A\^2\+AB\+BA\+B\^2/);
  assert.doesNotMatch(t, /[他她]/);
  assert.doesNotMatch(t, /宽|严/);
  assert.doesNotMatch(t, /\[转写\]/);
  const img = verdictPrompt({ probe: recall, answer: {}, ids: ['m1'], images: 1 });
  assert.match(img, /\[转写\]/);
});

test('verdictPrompt：solve 带参考步骤和错法词表', () => {
  const s = P('solve', 'id: p2\nq: 求 |−3Aᵀ|\ntarget: L2-50\nlevel: 基础\nsteps:\ns1 rule: |kA| = k^n |A|\ns2 calc: 54');
  const t = verdictPrompt({ probe: s, answer: { text: '…' }, ids: claudeIds(s, []) });
  assert.match(t, /s1（用规则）：\|kA\| = k\^n \|A\|/);
  assert.match(t, /规则用错/);
  assert.deepEqual(claudeIds(s, []), ['s1', 's2']);
  // solve 的步骤 missing 照计划 1 带「步骤缺」
  assert.equal(parseVerdict('s1 ok\ns2 missing', ['s1', 's2'], { steps: true }).items[1].tag, '步骤缺');
});

test('fallbackPrompt：带外部写的话，没写用默认的那句', () => {
  const t = fallbackPrompt({ probe: recall, answer: { text: '…' }, items: [{ id: 'm2', ok: 'missing' }], extPrompt: '' });
  assert.ok(t.includes(DEFAULT_FALLBACK));
  assert.match(t, /m2/);
  const t2 = fallbackPrompt({ probe: recall, answer: { text: '…' }, items: [], extPrompt: '只说一句。' });
  assert.ok(t2.includes('只说一句。'));
  assert.doesNotMatch(t2, /[他她]/);
});

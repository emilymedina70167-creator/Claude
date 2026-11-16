// 要拿下的事（docs/superpowers/specs/2026-11-15-root-design.md 6.2）：每节课 2～5 件，老师写 board aims，
// 板上的题用 aim=a1 挂到某一件上，每件的状态由页面按作答算，进课后报告。这里测不碰界面的那一半。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAims, checkAims, aimStatus, aimsSummary, aimsLine, aimsText, STATUS_TEXT, AIMS_MIN, AIMS_MAX } from '../kit/src/class/aims.js';
import { parseOutput, parseCommand } from '../kit/src/class/protocol.js';
import { toEvidence } from '../kit/src/memory/session.js';
import { buildReport, reportText, REPORT_VERSION } from '../kit/src/memory/report.js';

const body = 'a1 | 给一个引用串，手算 LRU 的缺页次数 | 独立做一道没见过的同类题 | exam=Q-408-2023-45\na2 | 说得出 LRU 和 FIFO 换出的页为什么不同';
test('一行一件，认出真题题号和什么算做到', () => {
  const { aims, errors } = parseAims(body);
  assert.deepEqual(errors, []);
  assert.deepEqual(aims[0], { id: 'a1', can: '给一个引用串，手算 LRU 的缺页次数', proof: '独立做一道没见过的同类题', exam: 'Q-408-2023-45' });
  assert.deepEqual(aims[1], { id: 'a2', can: '说得出 LRU 和 FIFO 换出的页为什么不同' });
});
test('读不懂的行报出来，别的照收', () => {
  const r = parseAims('a1 | 手算 LRU 的缺页次数\n乱写的一行\na2 | 说得出两种算法的差别');
  assert.equal(r.aims.length, 2); assert.equal(r.errors.length, 1);
});
test('件数、重号、太短、题号不能用', () => {
  const one = parseAims('a1 | 手算 LRU 的缺页次数').aims;
  assert.ok(checkAims(one).length);
  assert.ok(checkAims([...one, { id: 'a1', can: '说得出两种算法的差别' }]).length);
  assert.ok(checkAims([{ id: 'a1', can: '会' }, { id: 'a2', can: '说得出两种算法的差别' }]).length);
  const two = parseAims(body).aims;
  assert.deepEqual(checkAims(two, { examCheck: () => '' }), []);
  assert.equal(checkAims(two, { examCheck: (id) => (id === 'Q-408-2023-45' ? '留作模考' : '') }).length, 1);
  assert.ok(checkAims(Array.from({ length: 6 }, (_, i) => ({ id: `a${i + 1}`, can: '说得出两种算法的差别' }))).length);
});
test('状态：独立做到、带着做到、做了没到、还没证据', () => {
  const a = { id: 'a1', can: 'x' };
  assert.equal(aimStatus(a, []), 'none');
  assert.equal(aimStatus(a, [{ aim: 'a2', outcome: 'first' }]), 'none');
  assert.equal(aimStatus(a, [{ aim: 'a1', outcome: 'wrong' }]), 'miss');
  assert.equal(aimStatus(a, [{ aim: 'a1', outcome: 'wrong' }, { aim: 'a1', outcome: 'ok' }]), 'led');
  assert.equal(aimStatus(a, [{ aim: 'a1', outcome: 'first', reveals: 1 }]), 'led');
  assert.equal(aimStatus(a, [{ aim: 'a1', outcome: 'first' }]), 'solo');
});
test('一行摘要和给老师的几行', () => {
  const s = aimsSummary(parseAims(body).aims, [{ aim: 'a1', outcome: 'first' }]);
  assert.equal(aimsLine(s), '这节课要拿下的 · 1/2 有证据');
  assert.ok(aimsText(s).includes('独立做到') && aimsText(s).includes('还没证据') && aimsText(s).includes('Q-408-2023-45'));
  assert.equal(aimsLine(aimsSummary(undefined, [])), '');
});
test('board aims 是一种指令；段能写 aim=', () => {
  const out = parseOutput('好。\n\n```board aims\n' + body + '\n```\n\n```board add id=b2 aim=a1\n题\n```', { final: true });
  const ops = out.segments.filter((s) => s.type === 'board').map((s) => s.op);
  assert.equal(ops[0].op, 'aims'); assert.equal(ops[0].aims.length, 2);
  assert.equal(ops[1].aim, 'a1');
});
test('证据带 aim，不进 tags', () => {
  const e = toEvidence('record', { block: 'q1', ok: true }, { session: 'c-1', block: 'OS-L3.2.1', aim: 'a1' });
  assert.equal(e.aim, 'a1'); assert.deepEqual(e.tags, ['OS-L3.2.1']);
});
test('报告里有每件事的状态；没有要拿下的事的课是空的', () => {
  assert.equal(REPORT_VERSION, 3);
  const ev = [{ id: 'e1', src: 'record', kind: 'answer', comp: 'q1', ok: true, attempts: 1, aim: 'a1', session: 'c-1', at: 2 }];
  const r = buildReport({ session: { id: 'c-1', date: '2026-11-16', aims: parseAims(body).aims }, evidence: ev, turns: [], steps: [], now: 10 });
  assert.equal(r.aims.find((x) => x.id === 'a1').status, 'solo');
  assert.equal(r.aims.find((x) => x.id === 'a2').status, 'none');
  assert.deepEqual(buildReport({ session: { id: 'c-2', date: '2026-11-16' }, evidence: [], turns: [], steps: [], now: 10 }).aims, []);
});

/* ---------- 老师真会写出来的样子 ---------- */

test('全角的「｜」、末尾的空行、大写的编号、列表记号、表格那样两头的竖线都读得懂', () => {
  const r = parseAims('A1｜手算 LRU 的缺页次数｜独立做一道｜exam＝Q-408-2023-45\n- a10 | 说得出两种算法的差别\n| a3 | 判断一个引用串会不会抖动 |\n\n');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.aims, [
    { id: 'a1', can: '手算 LRU 的缺页次数', proof: '独立做一道', exam: 'Q-408-2023-45' },
    { id: 'a10', can: '说得出两种算法的差别' },
    { id: 'a3', can: '判断一个引用串会不会抖动' },
  ]);
});
test('能做的事里的 |A| 不当成分隔（半角竖线两边有空格才分格）', () => {
  const r = parseAims('a1 | 给一个三阶方阵，算出 |A| 和 |A*| | 独立算一道');
  assert.deepEqual(r.aims, [{ id: 'a1', can: '给一个三阶方阵，算出 |A| 和 |A*|', proof: '独立算一道' }]);
});
test('没写能做的事、编号不是 a 加数字的行报出来；空的块什么都没有', () => {
  const r = parseAims('a1 |\nb2 | 说得出两种算法的差别\n目标一 | 手算 LRU 的缺页次数');
  assert.equal(r.aims.length, 0); assert.equal(r.errors.length, 3);
  assert.match(r.errors[0], /a1/);
  assert.deepEqual(parseAims(''), { aims: [], errors: [] });
  assert.deepEqual(parseAims(undefined), { aims: [], errors: [] });
});
test('同一件写了两次：两条都读出来，checkAims 报重号（只报一条）', () => {
  const { aims } = parseAims('a1 | 手算 LRU 的缺页次数\na1 | 手算 LRU 的缺页次数\na2 | 说得出两种算法的差别');
  assert.equal(aims.length, 3);
  const ps = checkAims(aims);
  assert.equal(ps.length, 1); assert.match(ps[0], /a1/);
});
test('checkAims：件数的上下限就是 2 和 5；太长的也报；不是数组不出错', () => {
  assert.equal(AIMS_MIN, 2); assert.equal(AIMS_MAX, 5);
  const n = (k) => Array.from({ length: k }, (_, i) => ({ id: `a${i + 1}`, can: '说得出两种算法的差别' }));
  assert.deepEqual(checkAims(n(2)), []); assert.deepEqual(checkAims(n(5)), []);
  assert.equal(checkAims(n(1)).length, 1); assert.equal(checkAims(n(6)).length, 1);
  assert.equal(checkAims([{ id: 'a1', can: '长'.repeat(81) }, { id: 'a2', can: '说得出两种算法的差别' }]).length, 1);
  assert.equal(checkAims([{ id: 'a1', can: '长'.repeat(80) }, { id: 'a2', can: '四个字的' }]).length, 0);
  assert.equal(checkAims(undefined).length, 1);
  // 没写题号的不问 examCheck
  let asked = 0;
  checkAims(n(2), { examCheck: () => { asked++; return '没有这道题'; } });
  assert.equal(asked, 0);
});
test('页面没判的作答不算「做了没到」；把选项试遍了才对的不算做到', () => {
  const a = { id: 'a1', can: 'x' };
  assert.equal(aimStatus(a, [{ aim: 'a1', outcome: 'open' }]), 'none');
  assert.equal(aimStatus(a, [{ aim: 'a1', outcome: 'open' }, { aim: 'a1', outcome: 'giveup', giveup: true }]), 'miss');
  assert.equal(aimStatus(a, [{ aim: 'a1', outcome: 'revealed', revealed: true }]), 'miss');
  assert.equal(aimStatus(a, [{ aim: 'a1', outcome: 'ok', guess: true }]), 'miss');
  assert.equal(aimStatus(a, [{ aim: 'a1', outcome: 'ok', guess: true }, { aim: 'a1', outcome: 'ok' }]), 'led');
  // 给老师的那几行照实说：挂了题、页面判不了
  const s = aimsSummary([a, { id: 'a2', can: 'y' }], [{ aim: 'a1', outcome: 'open' }]);
  assert.deepEqual(s.map((x) => [x.status, x.n]), [['none', 1], ['none', 0]]);
  assert.match(aimsText(s).split('\n')[0], /还没证据.*1 道题.*没判/);
});
test('给老师的几行：一件一行，状态只有那四个词，不出现「他」「她」', () => {
  assert.deepEqual(Object.keys(STATUS_TEXT), ['none', 'led', 'solo', 'miss']);
  const s = aimsSummary(parseAims(body).aims, [{ aim: 'a1', outcome: 'wrong' }, { aim: 'a1', outcome: 'first' }, { aim: 'a2', outcome: 'wrong' }]);
  const lines = aimsText(s).split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '- a1（独立做到，2 道题）：给一个引用串，手算 LRU 的缺页次数｜算做到：独立做一道没见过的同类题｜对着 Q-408-2023-45');
  assert.equal(lines[1], '- a2（做了没到，1 道题）：说得出 LRU 和 FIFO 换出的页为什么不同');
  assert.doesNotMatch(aimsText(s), /[他她]/);
  assert.equal(aimsText([]), ''); assert.equal(aimsText(undefined), '');
  assert.equal(aimsLine(s), '这节课要拿下的 · 1/2 有证据');
});
test('board aims：一件都没读出来整块算看不懂；有读不懂的行放在 errors 里；没闭合时只认得出是 aims', () => {
  const bad = parseOutput('```board aims\n随便写的\n```', { final: true });
  assert.equal(bad.ops.length, 0); assert.equal(bad.rejected.length, 1);
  const empty = parseOutput('```board aims\n```', { final: true });
  assert.equal(empty.rejected.length, 1);
  const part = parseOutput('```board aims\n' + body + '\n这一行读不懂\n```', { final: true }).ops[0];
  assert.equal(part.aims.length, 2); assert.equal(part.errors.length, 1);
  assert.deepEqual(parseOutput('```board aims\n' + body + '\n```', { final: true }).ops[0].errors, []);
  assert.deepEqual(parseCommand('aims'), { op: 'aims' });
  const draft = parseOutput('```board aims\n' + body, { final: false }).segments.at(-1);
  assert.equal(draft.closed, false); assert.equal(draft.op.op, 'aims');
  assert.match(parseCommand('page id=b1').error, /aims/);
});
test('段上的 aim=：写错只丢掉 aim、段照常写；大写的编号认成小写；hide 这些不带', () => {
  assert.equal(parseCommand('new id=b1 title="LRU" aim=A2 point=lru').aim, 'a2');
  assert.equal(parseCommand('new id=b1 title="LRU" aim=A2 point=lru').point, 'lru');
  const w = parseCommand('add id=b2 aim=第一件');
  assert.equal(w.op, 'add'); assert.equal(w.id, 'b2'); assert.equal(w.aim, undefined);
  assert.match(w.warn, /aim/);
  assert.equal(parseCommand('hide id=b2 aim=a1').aim, undefined);
  // point 和 aim 都写错：两句都告诉老师
  const both = parseCommand('add id=b2 point=复现R19 aim=目标1');
  assert.match(both.warn, /point/); assert.match(both.warn, /aim/);
});
test('证据：没有 aim 的上下文不多这个字段；动作也带', () => {
  assert.equal('aim' in toEvidence('record', { block: 'q1', ok: true }, { session: 'c-1', block: 'OS-L3.2.1' }), false);
  const e = toEvidence('event', { type: 'reveal', block: 'ex1' }, { session: 'c-1', block: 'OS-L3.2.1', point: 'lru', aim: 'a2' });
  assert.equal(e.aim, 'a2'); assert.deepEqual(e.tags, ['OS-L3.2.1', 'OS-L3.2.1#lru']);
});
test('报告：题上带 aim（没挂的题没有这个键）；揭开过的只算带着做到；给老师的报告里多一段', () => {
  const ctx = (aim) => ({ session: 'c-1', block: 'OS-L3.2.1', ...(aim ? { aim } : {}) });
  const rec = (r, aim, at) => ({ ...toEvidence('record', { ...r, at }, ctx(aim)), id: `e${at}` });
  const ev = [
    rec({ block: 'q1', kind: 'answer', q: '缺页几次', ok: true, attempts: 1 }, 'a1', 2),
    // 同一步先揭开、再答对：第一次就对，但不算独立
    { ...toEvidence('event', { type: 'reveal', block: 'ex1', detail: { step: 1 }, at: 3 }, ctx('a2')), id: 'e3' },
    rec({ block: 'ex1', kind: 'steps', q: '换出哪一页', detail: '第 1 步', ok: true }, 'a2', 4),
    rec({ block: 'q9', kind: 'quiz', q: '没挂的题', ok: true, attempts: 1 }, null, 5),
  ];
  const aims = parseAims(body).aims;
  const r = buildReport({ session: { id: 'c-1', date: '2026-11-16', aims }, evidence: ev, turns: [], steps: [], now: 10 });
  assert.deepEqual(r.items.map((it) => [it.comp, it.aim]), [['q1', 'a1'], ['ex1', 'a2'], ['q9', undefined]]);
  assert.equal('aim' in r.items[2], false);
  assert.deepEqual(r.aims.map((x) => [x.id, x.status, x.n]), [['a1', 'solo', 1], ['a2', 'led', 1]]);
  assert.equal(r.aims[0].exam, 'Q-408-2023-45');
  const t = reportText(r);
  assert.match(t, /这节课要拿下的事/); assert.match(t, /a1（独立做到，1 道题）/); assert.match(t, /a2（带着做到，1 道题）/);
  // 没有要拿下的事的课：给老师的报告里没有这一段
  const plain = buildReport({ session: { id: 'c-1', date: '2026-11-16' }, evidence: ev, turns: [], steps: [], now: 10 });
  assert.deepEqual(plain.aims, []);
  assert.doesNotMatch(reportText(plain), /要拿下的事/);
  // 旧报告（没有 aims 这一节）也照常写得出来
  const { aims: _, ...old } = plain;
  assert.doesNotMatch(reportText(old), /要拿下的事/);
});
test('挂的那件事这节课没有（aim= 写了不存在的编号）：题照常进报告，哪件事都不算它的', () => {
  const ev = [{ id: 'e1', src: 'record', kind: 'answer', comp: 'q1', ok: true, attempts: 1, aim: 'a9', session: 'c-1', at: 2 }];
  const r = buildReport({ session: { id: 'c-1', date: '2026-11-16', aims: parseAims(body).aims }, evidence: ev, turns: [], steps: [], now: 10 });
  assert.equal(r.items[0].aim, 'a9');
  assert.deepEqual(r.aims.map((x) => [x.status, x.n]), [['none', 0], ['none', 0]]);
});

/* ---------- 宁可说少不可说满：只看最后一次失手以后的；分步例题的一步最多算带着做到 ---------- */

test('只看最后一次失手以后的：先独立做对、后来另一道做错是做了没到；先错后对按后面那道算', () => {
  const a = { id: 'a1', can: 'x' };
  const it = (outcome, first, more = {}) => ({ aim: 'a1', kind: 'answer', outcome, first, ...more });
  assert.equal(aimStatus(a, [it('first', 1), it('wrong', 2)]), 'miss');
  assert.equal(aimStatus(a, [it('wrong', 1), it('first', 2)]), 'solo');
  assert.equal(aimStatus(a, [it('wrong', 1), it('ok', 2)]), 'led');
  // 改对了（同一道题先错后对）算做对、不算失手，够不上独立；它前面独立做对的那道照样算数
  assert.equal(aimStatus(a, [it('first', 1), it('ok', 2)]), 'solo');
  assert.equal(aimStatus(a, [it('ok', 1)]), 'led');
  // 想不出来、看了答案、把选项试遍了才对，都是失手
  assert.equal(aimStatus(a, [it('first', 1), it('giveup', 2, { giveup: true })]), 'miss');
  assert.equal(aimStatus(a, [it('first', 1), it('revealed', 2, { revealed: true })]), 'miss');
  assert.equal(aimStatus(a, [it('first', 1), it('ok', 2, { guess: true })]), 'miss');
  assert.equal(aimStatus(a, [it('first', 1), it('ok', 2, { guess: true }), it('first', 3, { reveals: 1 })]), 'led');
  // 页面没判的不算失手，也挡不住前面做对的
  assert.equal(aimStatus(a, [it('first', 1), it('open', 2)]), 'solo');
  // 按时间排，不按传进来的先后（题上的 first 是第一条证据的时间）
  assert.equal(aimStatus(a, [it('wrong', 9), it('first', 3)]), 'miss');
  assert.equal(aimStatus(a, [it('first', 9), it('wrong', 3)]), 'solo');
  // 别的事上的失手不相干
  assert.equal(aimStatus(a, [it('first', 1), { ...it('wrong', 2), aim: 'a2' }]), 'solo');
});
test('没有 first 的题照传进来的先后；有的没有时，没有的留在原来的位置', () => {
  const a = { id: 'a1', can: 'x' };
  assert.equal(aimStatus(a, [{ aim: 'a1', outcome: 'first' }, { aim: 'a1', outcome: 'wrong' }]), 'miss');
  assert.equal(aimStatus(a, [{ aim: 'a1', outcome: 'wrong' }, { aim: 'a1', outcome: 'first' }]), 'solo');
  // 中间那道没有时间：留在第二个；两头有时间的按时间换了位置
  assert.equal(aimStatus(a, [{ aim: 'a1', outcome: 'first', first: 9 }, { aim: 'a1', outcome: 'ok' }, { aim: 'a1', outcome: 'wrong', first: 3 }]), 'solo');
  assert.equal(aimStatus(a, [{ aim: 'a1', outcome: 'wrong', first: 9 }, { aim: 'a1', outcome: 'ok' }, { aim: 'a1', outcome: 'first', first: 3 }]), 'miss');
});
test('分步例题的一步最多算带着做到（路是老师铺好的）；别的种类的题一次对才算独立', () => {
  const a = { id: 'a1', can: 'x' };
  const step = (outcome, first, more = {}) => ({ aim: 'a1', kind: 'steps', outcome, first, ...more });
  assert.equal(aimStatus(a, [step('first', 1), step('giveup', 2, { giveup: true })]), 'miss');
  assert.equal(aimStatus(a, [step('first', 1), step('first', 2)]), 'led');
  assert.equal(aimStatus(a, [step('first', 1), { aim: 'a1', kind: 'quiz', outcome: 'first', first: 2 }]), 'solo');
  assert.equal(aimStatus(a, [step('first', 1), { aim: 'a1', kind: 'answer', outcome: 'first', first: 2 }]), 'solo');
  // 例题的一步失手在后：前面那道独立做对的也不算了
  assert.equal(aimStatus(a, [{ aim: 'a1', kind: 'quiz', outcome: 'first', first: 1 }, step('wrong', 2)]), 'miss');
  // 题数照数，不因为是分步的少算
  assert.deepEqual(aimsSummary([a], [step('first', 1), step('first', 2)]).map((x) => [x.status, x.n]), [['led', 2]]);
});

test('一次对但学生标了没把握：不算独立，算带着做到', () => {
  const aim = { id: 'a1', can: '手算 LRU 的缺页次数' };
  assert.equal(aimStatus(aim, [{ aim: 'a1', kind: 'answer', outcome: 'first', sure: false }]), 'led');
  assert.equal(aimStatus(aim, [{ aim: 'a1', kind: 'answer', outcome: 'first', sure: true }]), 'solo');
  assert.equal(aimStatus(aim, [{ aim: 'a1', kind: 'answer', outcome: 'first', sure: null }]), 'solo');
});

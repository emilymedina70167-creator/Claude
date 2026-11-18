// 检验：一次检验怎么走（kit/src/check/flow.js）。纯函数，时间都从事件里来
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck } from '../kit/src/check/spec.js';
import { createFlow, step, view, resumeJobs, absorbOf, needsFallback } from '../kit/src/check/flow.js';

const F = '```';
const rec = (id, { retry = [], teach = 'teach default: 先乘开。' } = {}) => `${F}recall\nid: ${id}\nq: 写 ${id}\ntarget: T-${id.replace(/[ab]$/, '')}\nlevel: 核心\nmust m1: 要点\n${teach}\n${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const con = (id, { retry = [] } = {}) => `${F}construct\nid: ${id}\nq: 造 ${id}\ntarget: T-${id.replace(/[ab]$/, '')}\nlevel: 基础\nslots: A=mat(2)\nif: A != O => 零矩阵不算\nexample: A=[[1,0],[0,0]]\nteach if1: 不要零矩阵。\n${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const fam = (mk, id) => [mk(id, { retry: [`${id}a`, `${id}b`] }), mk(`${id}a`), mk(`${id}b`)].join('\n');

function mkCheck({ limit = '' } = {}) {
  const body = [
    'block L2.1.1 must=p1,p2',
    'block L2.1.4 must=p3,p4 optional=p7 fast=90s',
    fam(con, 'p1'), fam(con, 'p2'), fam(rec, 'p3'), fam(con, 'p4'), fam(con, 'p7'),
  ].join('\n');
  const { check, errors } = parseCheck(`check id=k1${limit ? ` limit=${limit}` : ''}`, body);
  assert.deepEqual(errors, []);
  return check;
}

// 学生交一道：机器判的结论跟着 submit 一起来
const OK = { items: [{ id: 'if1', ok: true }], needsClaude: false, stop: false };
const BAD = { items: [{ id: 'if1', ok: false, why: '零矩阵不算' }], needsClaude: false, stop: false };
const CLAUDE = { items: [], needsClaude: true, stop: false };
let t = 0;
const go = (s, ev) => step(s, { at: (t += 1000), ...ev });
const submit = (s, id, machine, sure = 'sure', ms = 20000) => go(s, { type: 'submit', id, answer: { x: id }, sure, ms, msTotal: ms, machine });
const cur = (s) => view(s).id;

function allRight(c) {
  let s = go(createFlow(c), { type: 'start' });
  for (const id of ['p1', 'p2']) s = submit(s, id, OK);
  s = submit(s, 'p3', CLAUDE);
  // 判回来时学生在做 p4（到可选题时 p3 已经判完，才能跳过）
  s = go(s, { type: 'verdict', id: 'p3', items: [{ id: 'm1', ok: true }], judgedBy: 'claude' });
  s = submit(s, 'p4', OK);
  return s;
}

test('开始以前是 intro，开始以后是第一道', () => {
  const s = createFlow(mkCheck());
  assert.equal(view(s).show, 'intro');
  assert.equal(cur(go(s, { type: 'start' })), 'p1');
});

test('全部一次过、很确定：可选跳过，两块都是成功', () => {
  const s = allRight(mkCheck());
  assert.equal(view(s).show, 'done');
  assert.equal(s.results.p7?.skipped, true);
  assert.equal(absorbOf(s, 'L2.1.1').state, '成功');
  assert.equal(absorbOf(s, 'L2.1.4').state, '成功');
  assert.deepEqual(absorbOf(s, 'L2.1.4').facets, { 重建: 'ok', 能用: 'ok' });
});

test('必做有一道是「大概」：可选照做', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = submit(s, 'p1', OK); s = submit(s, 'p2', OK);
  s = submit(s, 'p3', CLAUDE);
  s = go(s, { type: 'verdict', id: 'p3', items: [{ id: 'm1', ok: true }], judgedBy: 'claude' });
  s = submit(s, 'p4', OK, 'maybe');
  assert.equal(cur(s), 'p7');
});

test('fast：必做的第一次作答超过 90 秒，可选照做', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = submit(s, 'p1', OK); s = submit(s, 'p2', OK);
  s = submit(s, 'p3', CLAUDE);
  s = go(s, { type: 'verdict', id: 'p3', items: [{ id: 'm1', ok: true }], judgedBy: 'claude' });
  s = submit(s, 'p4', OK, 'sure', 120000);
  assert.equal(cur(s), 'p7');
});

test('交了要 Claude 判的马上做下一道；判回来没过，下一道做完先补讲、再 retry', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = submit(s, 'p1', OK); s = submit(s, 'p2', OK);
  s = submit(s, 'p3', CLAUDE);
  assert.equal(cur(s), 'p4');
  assert.equal(view(s).waiting, 1);
  s = go(s, { type: 'verdict', id: 'p3', items: [{ id: 'm1', ok: 'missing' }], judgedBy: 'claude' });
  assert.equal(cur(s), 'p4', '判回来时不打断正在做的那一道');
  s = submit(s, 'p4', OK);
  assert.deepEqual({ show: view(s).show, id: view(s).id }, { show: 'teach', id: 'p3' });
  assert.equal(view(s).teach.key, 'default');
  s = go(s, { type: 'teachSeen', id: 'p3' });
  assert.equal(cur(s), 'p3a');
  assert.equal(view(s).kind, 'retry');
});

test('retry 两道都错：那一道没吸收，块是「未」，欠账是它的 target', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = submit(s, 'p1', BAD);
  assert.equal(view(s).show, 'teach');
  s = go(s, { type: 'teachSeen', id: 'p1' });
  s = submit(s, 'p1a', BAD);
  s = go(s, { type: 'teachSeen', id: 'p1a' });
  assert.equal(cur(s), 'p1b');
  s = submit(s, 'p1b', BAD);
  s = go(s, { type: 'teachSeen', id: 'p1b' });
  assert.equal(s.results.p1.final, 'fail');
  assert.equal(cur(s), 'p2');
  s = submit(s, 'p2', OK);
  const a = absorbOf(s, 'L2.1.1');
  assert.equal(a.state, '未');
  assert.deepEqual(a.debt, ['T-p1']);
  assert.deepEqual(a.confidentWrong, ['p1']);
});

test('retry 做对了：补上，块是「部分」', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = submit(s, 'p1', BAD); s = go(s, { type: 'teachSeen', id: 'p1' });
  s = submit(s, 'p1a', OK);
  assert.equal(s.results.p1.final, 'fixed');
  s = submit(s, 'p2', OK);
  assert.equal(absorbOf(s, 'L2.1.1').state, '部分');
  assert.equal(absorbOf(s, 'L2.1.1').facets.能用, 'fixed');
});

test('蒙对：出 retry 确认，对了算补上', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = submit(s, 'p1', OK, 'guess');
  assert.equal(view(s).show, 'teach');
  assert.equal(view(s).teach.guessed, true);
  s = go(s, { type: 'teachSeen', id: 'p1' });
  s = submit(s, 'p1a', OK);
  assert.equal(s.results.p1.final, 'fixed');
});

test('判分超时：那道待核、不补讲，块是「待核」', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = submit(s, 'p1', OK); s = submit(s, 'p2', OK);
  s = submit(s, 'p3', CLAUDE);
  s = go(s, { type: 'timeout', id: 'p3' });
  s = submit(s, 'p4', OK);
  assert.notEqual(view(s).show, 'teach');
  assert.equal(s.results.p3.final, 'pending');
  // 还有可选：p3 待核，不是都一次过 → 可选照做
  assert.equal(cur(s), 'p7');
  s = submit(s, 'p7', OK);
  assert.equal(absorbOf(s, 'L2.1.4').state, '待核');
});

test('最后一道交完还有在判的：wait，判回来没过再补讲', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = submit(s, 'p1', OK); s = submit(s, 'p2', OK);
  s = submit(s, 'p3', CLAUDE);
  s = submit(s, 'p4', OK);
  // p3 还在判：可选照做
  assert.equal(cur(s), 'p7');
  s = submit(s, 'p7', OK);
  assert.equal(view(s).show, 'wait');
  s = go(s, { type: 'verdict', id: 'p3', items: [{ id: 'm1', ok: false }], judgedBy: 'claude' });
  assert.equal(view(s).show, 'teach');
});

test('同一道交两次：只算第一次', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = submit(s, 'p1', OK);
  const again = submit(s, 'p1', BAD);
  assert.deepEqual(again.results, s.results);
  // 不是现在这一道的也不收
  assert.deepEqual(submit(s, 'p4', OK).results, s.results);
});

test('限时：补讲时不走表；过了 limit 交对的记 late，最多补上', () => {
  let s = go(createFlow(mkCheck({ limit: '60s' })), { type: 'start' });
  s = submit(s, 'p1', BAD);
  const before = s.visibleMs;
  s = go(s, { type: 'tick', ms: 5000 });
  assert.equal(s.visibleMs, before, '补讲时不算');
  s = go(s, { type: 'teachSeen', id: 'p1' });
  s = go(s, { type: 'tick', ms: 5000 });
  assert.equal(s.visibleMs, before, 'retry 不算');
  s = submit(s, 'p1a', OK);
  s = go(s, { type: 'tick', ms: 70000 });
  assert.equal(view(s).left, 0);
  s = submit(s, 'p2', OK);
  assert.equal(s.results.p2.late, true);
  assert.equal(s.results.p2.final, 'fixed');
});

test('在判的时候存起来再读回：要重判的是它', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = submit(s, 'p1', OK); s = submit(s, 'p2', OK);
  s = submit(s, 'p3', CLAUDE);
  const back = JSON.parse(JSON.stringify(s));
  assert.deepEqual(resumeJobs(back), ['p3']);
  assert.equal(cur(back), 'p4');
});

test('外部改判：待核判成没过 → 未，它的 retry 记给复测', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = submit(s, 'p1', OK); s = submit(s, 'p2', OK);
  s = submit(s, 'p3', CLAUDE);
  s = go(s, { type: 'timeout', id: 'p3' });
  s = submit(s, 'p4', OK); s = submit(s, 'p7', OK);
  s = go(s, { type: 'ext', id: 'p3', items: [{ id: 'm1', ok: false, why: '没写' }], result: 'fail' });
  assert.equal(s.results.p3.final, 'fail');
  assert.equal(s.results.p3.judgedBy, 'ext');
  assert.equal(absorbOf(s, 'L2.1.4').state, '未');
  assert.deepEqual(s.owed, ['p3a', 'p3b']);
});

test('暂停再接着：还在那一道', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = submit(s, 'p1', OK);
  s = go(s, { type: 'pause' });
  assert.equal(view(s).show, 'paused');
  s = go(s, { type: 'resume' });
  assert.equal(cur(s), 'p2');
});

test('想不出来：算没过、补讲用 giveup（没有就 default）', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = go(s, { type: 'giveup', id: 'p1', ms: 30000 });
  assert.equal(view(s).show, 'teach');
  // p1 只写了 teach if1：没有 giveup、default → 要页面里的 Claude 写
  assert.deepEqual(needsFallback(s), ['p1']);
  assert.equal(s.results.p1.giveup, true);
  assert.deepEqual(s.results.p1.failed, ['giveup']);
});

test('外部没写到的错法：要页面里的 Claude 写补讲，写回来才显示', () => {
  const body = ['block L2.1.1 must=p1', `${F}recall\nid: p1\nq: 写\ntarget: x\nlevel: 核心\nmust m1: 要点\nteach m1: 只有这一条\nretry: p1a, p1b\n${F}`, rec('p1a'), rec('p1b')].join('\n');
  const { check } = parseCheck('check id=k1', body);
  let s = go(createFlow(check), { type: 'start' });
  s = submit(s, 'p1', CLAUDE);
  s = go(s, { type: 'verdict', id: 'p1', items: [{ id: 'm1', ok: true }, { id: 'zz', ok: false }], judgedBy: 'claude' });
  // m1 过了，zz 不是要点：丢掉 → 过了
  assert.equal(s.results.p1.final, 'pass');
  let s2 = go(createFlow(check), { type: 'start' });
  s2 = go(s2, { type: 'giveup', id: 'p1', ms: 1000 });
  assert.deepEqual(needsFallback(s2), ['p1']);
  assert.equal(view(s2).teach.text, null);
  s2 = go(s2, { type: 'teachText', id: 'p1', text: '先把两项乘开。' });
  assert.deepEqual(needsFallback(s2), []);
  assert.equal(view(s2).teach.text, '先把两项乘开。');
});

test('没做完的块不出吸收', () => {
  let s = go(createFlow(mkCheck()), { type: 'start' });
  s = submit(s, 'p1', OK);
  assert.equal(absorbOf(s, 'L2.1.1').state, null);
  assert.equal(absorbOf(s, 'L2.1.1').done, 1);
  assert.equal(absorbOf(s, 'L2.1.1').must, 2);
});

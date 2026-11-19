// 计划 4 的两份样板（kit/src/check/devsample.js：408 希尔排序、英语语态；?dev 的「测试:检验408」「测试:检验英语」、示例页、e2e 都用它们）：
// 自检干净；照 flow.js 走一遍，机器判用 judgeMachine，要页面里的 Claude 判的给模拟的「都对」
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck, selfCheck, seeded, traceTable } from '../kit/src/check/spec.js';
import { materialize } from '../kit/src/check/template.js';
import { createFlow, step, absorbOf } from '../kit/src/check/flow.js';
import { judgeMachine, claudeIds, parseItemIds } from '../kit/src/check/judge.js';
import { toRecord, evidenceOf } from '../kit/src/check/record.js';
import { measure, variantValues } from '../kit/src/engines/measures.js';
import { DEV_CHECK_408_HEAD, DEV_CHECK_408_BODY, DEV_CHECK_EN_HEAD, DEV_CHECK_EN_BODY } from '../kit/src/check/devsample.js';

const load = (head, body) => {
  const r = parseCheck(head, body);
  assert.deepEqual(r.errors, []);
  return r.check;
};

test('两份样板：parseCheck、selfCheck 都干净；408 的 predict 带错答案（=>）和 against', () => {
  const c408 = load(DEV_CHECK_408_HEAD, DEV_CHECK_408_BODY);
  const cen = load(DEV_CHECK_EN_HEAD, DEV_CHECK_EN_BODY);
  assert.deepEqual(selfCheck(c408), []);
  assert.deepEqual(selfCheck(cen), []);
  assert.match(c408.probes.p3.src, /^wrong w1: .+ => /m);
  assert.match(c408.probes.p3.src, /^against: shellBlock$/m);
  assert.deepEqual(Object.values(c408.probes).map((p) => p.type).filter((x, i, a) => a.indexOf(x) === i), ['trace', 'construct', 'predict', 'tradeoff']);
  assert.deepEqual(Object.values(cen.probes).map((p) => p.type).filter((x, i, a) => a.indexOf(x) === i), ['parse', 'rewrite', 'discriminate', 'errfind']);
});

// 走一遍：交了 → 机器判；要 Claude 判的给「都对」；补讲看完接着做
function walker(check) {
  let s = step(createFlow(check), { type: 'start', at: 1 });
  let t = 1;
  const probe = (id) => s.check.probes[id];
  return {
    get s() { return s; },
    probe,
    cur: () => s.cur?.id,
    submit(id, answer, { sure = 'sure' } = {}) {
      assert.equal(s.phase, 'probe');
      assert.equal(s.cur.id, id);
      const machine = judgeMachine(probe(id), answer);
      s = step(s, { type: 'submit', id, answer, machine, sure, ms: 20000, at: (t += 1000) });
      if (s.judging[id] !== undefined) s = step(s, { type: 'verdict', id, items: claudeIds(probe(id)).map((x) => ({ id: x, ok: true, why: '', tag: '' })), at: (t += 1000) });
      return s.results[id];
    },
    teachSeen(id) { assert.equal(s.phase, 'teach'); assert.equal(s.teaching.id, id); s = step(s, { type: 'teachSeen', id }); },
  };
}

const rowsOf = (p) => traceTable(p).table.rows.map((r) => r.cells.map((c) => [].concat(c.v)[0]));

test('408 样板：trace 全对、construct 错一次 retry 对、predict 写了 shellBlock 的数组 → tag，retry 对；吸收「部分」、证据条数', () => {
  const m = materialize(load(DEV_CHECK_408_HEAD, DEV_CHECK_408_BODY), { rand: seeded('samples') });
  assert.deepEqual(m.errors, []);
  const w = walker(m.check);

  // trace：引擎的整张表照抄 → 一次过（模板，不出 retry）
  const tr = w.submit('p1', { cells: rowsOf(w.probe('p1')), extra: [] });
  assert.equal(tr.outcome, 'pass');
  assert.ok(tr.items.every((x) => x.ok === true));

  // construct：一排有序的数，排完稳定 → 两条都不满足；补讲、retry p2a 写对 → 补上
  const c1 = w.submit('p2', { slots: { A: '1 2 3 4 5 6 7 8', P: '1 1' } });
  assert.equal(c1.outcome, 'fail');
  assert.deepEqual(c1.items.filter((x) => x.ok === false).map((x) => x.id), ['if1', 'if2']);
  w.teachSeen('p2');
  assert.equal(w.cur(), 'p2a');
  assert.equal(w.submit('p2a', { slots: { A: '13 97 49 49 27 38', P: '49 49' } }).outcome, 'pass');
  assert.equal(w.s.results.p2.final, 'fixed');

  // predict：位置写对、数组写成「相邻的分成一组」算出来的 → 那一项 tag shellBlock，补讲 tag=shellBlock
  const p3 = w.probe('p3');
  const arr = p3.runs[0].fields.array;
  const right = measure('sort', { algo: 'shell', gaps: '3', array: arr }).values.pass1;
  const bad = variantValues('sort', { algo: 'shell', gaps: '3', array: arr }, 'shellBlock').values.pass1;
  assert.notDeepEqual(bad, right);
  const pr = w.submit('p3', { expects: { x1: '2 5 8', x2: [].concat(bad).join(' ') }, text: '相隔 3 的是一组' });
  assert.equal(pr.outcome, 'fail');
  const x2 = pr.items.find((x) => x.id === 'x2');
  assert.equal(x2.ok, false);
  assert.equal(x2.tag, 'shellBlock');
  assert.equal(pr.items.find((x) => x.id === 'x1').ok, true);
  assert.equal(pr.teach.key, 'tag=shellBlock');
  w.teachSeen('p3');
  assert.equal(w.cur(), 'p3~2'); // retry: self × 2 → 换一组数的同一道题
  const p32 = w.probe('p3~2');
  const right2 = measure('sort', { algo: 'shell', gaps: '3', array: p32.runs[0].fields.array }).values.pass1;
  assert.equal(w.submit('p3~2', { expects: { x1: '2 5 8', x2: [].concat(right2).join(' ') }, text: '相隔 3 的是一组：第 2、5、8 个' }).outcome, 'pass');
  assert.equal(w.s.results.p3.final, 'fixed');

  // tradeoff：要点交给页面里的 Claude（模拟都对）
  assert.equal(w.submit('p4', { text: '大间隔先消掉远的逆序；链表不能随机访问' }).outcome, 'pass');
  assert.equal(w.s.phase, 'done');

  const a = absorbOf(w.s, 'DS-L8.2.3');
  assert.equal(a.state, '部分');
  assert.deepEqual(a.debt, []);
  assert.deepEqual(a.probes, ['p1', 'p2', 'p2a', 'p3', 'p3~2', 'p4']);
  const ids = toRecord(w.s);
  assert.equal(ids.length, 6);
  const evs = ids.map((id) => evidenceOf(w.s, id, { ctx: { session: 'c-20261119-1' } }));
  assert.ok(evs.every((e) => e.src === 'check' && e.block === 'DS-L8.2.3'));
  assert.equal(evs.filter((e) => e.retryOf).length, 2);
  assert.ok(evs.find((e) => e.probe === 'p1').picked, '模板取的数记在证据上');
  assert.equal(evs.find((e) => e.probe === 'p3').items.find((x) => x.id === 'x2').tag, 'shellBlock');
});

test('英语样板：parse 一次过、rewrite / discriminate 一次过、errfind 写成常见错法再 retry 对；吸收「部分」', () => {
  const check = load(DEV_CHECK_EN_HEAD, DEV_CHECK_EN_BODY);
  const w = walker(check);
  // parse：照 key 的两个成分标（parseItemIds 给的就是 key 的那几段，下标是 probe.tokens 里的）
  const spans = parseItemIds(w.probe('p1')).map((x) => x.span);
  assert.deepEqual(spans.map((x) => x.role), ['S', 'V']);
  const r1 = w.submit('p1', { spans });
  assert.equal(r1.outcome, 'pass', JSON.stringify(r1.items));
  assert.equal(w.submit('p2', { text: 'The bridge was built by the villagers in 1990.' }).outcome, 'pass');
  assert.equal(w.submit('p3', { pick: '非谓语', text: '句子的谓语是 show，collected 修饰 data' }).outcome, 'pass');
  // errfind：点对了词、改成 knew（外部写的常见错法）→ 没过，补讲；retry p4a 对
  const e1 = w.submit('p4', { word: w.probe('p4').wordAt, fix: 'knew' });
  assert.equal(e1.outcome, 'fail', JSON.stringify(e1.items));
  w.teachSeen('p4');
  assert.equal(w.submit('p4a', { word: w.probe('p4a').wordAt, fix: 'written' }).outcome, 'pass');
  assert.equal(w.s.phase, 'done');
  const a = absorbOf(w.s, 'EN-L1.2.3');
  assert.equal(a.state, '部分');
  assert.equal(toRecord(w.s).length, 5);
});

test('?dev 的暗号：「测试:检验408」「测试:检验英语」写这两份样板，「测试:检验」照旧是数学那一份', async () => {
  const { devReply } = await import('../kit/src/class/devteacher.js');
  const { DEV_CHECK, DEV_CHECK_408, DEV_CHECK_EN } = await import('../kit/src/check/devsample.js');
  const say = (text) => devReply([{ role: 'user', content: '课堂说明' }, { role: 'user', content: text }]);
  assert.ok(say('测试:检验408').text.includes(DEV_CHECK_408));
  assert.ok(say('测试：检验英语').text.includes(DEV_CHECK_EN));
  const m = say('测试:检验');
  assert.ok(m.text.includes(DEV_CHECK) && !m.text.includes(DEV_CHECK_408));
});

test('记忆库的检验题库认全部题型（和 PROBE_TYPES 一样）：408、英语的题存进题库不报「不守规矩」', async () => {
  const { COLLECTIONS } = await import('../kit/src/memory/schema.js');
  const { PROBE_TYPES } = await import('../kit/src/check/spec.js');
  assert.deepEqual([...COLLECTIONS.probes.enums.type].sort(), [...PROBE_TYPES].sort());
});

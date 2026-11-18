// 外部的课里预案全开（需求 R6）：wrong（match= 分错法）、giveup、stuck；页面里的老师照旧只收 right / done
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReact, planLocal, matchAnswer, stuckDue } from '../kit/src/class/react.js';
import { parseOutput } from '../kit/src/class/protocol.js';

const body = 'right: 对\nwrong match="x=3": 是不是把 2 乘错了？\nwrong: 再看一眼第二行\ngiveup show=b4: 看提示\nstuck=90s: 卡在哪一步？';

test('默认（页面里的老师）照旧不收', () => {
  assert.match(parseReact('target=q1', 'wrong: x').error, /当场写/);
});

test('宽读：live 标出来、match / stuck 读懂', () => {
  const r = parseReact('target=q1', body, { lenient: true });
  assert.equal(r.cases.length, 5);
  assert.deepEqual(r.cases[1], { kind: 'wrong', show: [], text: '是不是把 2 乘错了？', match: 'x=3', live: true });
  assert.equal(r.cases[4].kind, 'stuck');
  assert.equal(r.cases[4].after, 90000);
  assert.equal(r.cases[0].live, undefined);
  assert.match(parseReact('target=q1', 'stuck=3s: x', { lenient: true }).error, /至少 10s/);
  // board 块里走的是宽读
  const op = parseOutput(`\`\`\`\`board react target=q1\n${body}\n\`\`\`\``, { final: true }).ops[0];
  assert.equal(op.cases.length, 5);
});

test('按错法接：match 对得上的先用，对不上的用没写 match 的', () => {
  const r = parseReact('target=q1', body, { lenient: true });
  const rules = new Map([['q1', { target: 'q1', seq: 1, cases: r.cases.map((c) => ({ ...c })) }]]);
  const wrong = (value) => [{ a: { source: 'record', block: 'q1', ok: false, value }, trig: 'now' }];
  assert.equal(planLocal({ items: wrong('x = 3'), rules, ext: true }).talk, '是不是把 2 乘错了？');
  assert.equal(planLocal({ items: wrong('x=5'), rules, ext: true }).talk, '再看一眼第二行');
  assert.equal(planLocal({ items: wrong('x=5'), rules }), null); // 不是外部的课：叫老师
  const give = [{ a: { source: 'record', block: 'q1', giveup: true }, trig: 'now' }];
  assert.deepEqual(planLocal({ items: give, rules, ext: true }).show, ['b4']);
});

test('match 的写法、stuck 到点', () => {
  assert.equal(matchAnswer('X＝3', 'x = 3'), true);
  assert.equal(matchAnswer('/^-?\\d+$/', '-12'), true);
  assert.equal(matchAnswer('/[/', 'x'), false);
  const rule = { cases: [{ kind: 'stuck', after: 90000 }] };
  assert.equal(stuckDue(rule, { now: 100000, armed: 0, touched: 20000 }), -1);
  assert.equal(stuckDue(rule, { now: 120000, armed: 0, touched: 20000 }), 0);
});

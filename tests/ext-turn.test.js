// 写一轮的工具（tools/ext-turn.mjs）的纯函数：序号、after、时间自己填；一轮执行了没有照实说
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { nextTurn, turnStatus } from '../tools/ext-turn-lib.js';

test('序号、after、时间自己填', () => {
  const r = nextTurn({ ins: [{ id: '001', seq: 1 }, { id: '002', seq: 2 }], outs: [{ id: '007', seq: 7 }], text: 'x', now: 1795500000000 });
  assert.equal(r.id, '003');
  assert.deepEqual(r.doc, { seq: 3, text: 'x', after: 7, at: 1795500000000 });
});
test('第一轮', () => { const r = nextTurn({ ins: [], outs: [], text: 'x', now: 1 }); assert.equal(r.doc.after, 0); assert.equal(r.id, '001'); });
test('学生说的话、模型名照写；没给就不写这两栏', () => {
  const r = nextTurn({ ins: [], outs: [], text: 'x', said: [{ text: '好', at: 5 }], model: 'm', now: 1 });
  assert.deepEqual(r.doc.said, [{ text: '好', at: 5 }]);
  assert.equal(r.doc.model, 'm');
});
test('没执行的明说', () => { assert.equal(turnStatus({ seq: 3 }).state, 'pending'); assert.deepEqual(turnStatus({ seq: 3 }).lines, ['还没执行：学生的页面没开着这节课，或还没轮到']); });
test('执行了的把每一行摊开', () => {
  const s = turnStatus({ done: { at: 1 }, result: { errors: ['b3 写错'], notes: [], memo: [{ line: 'recall …', ok: true, id: 'recall/K9' }, { line: 'error …', ok: false, error: '超了条数' }] } });
  assert.equal(s.state, 'done');
  assert.deepEqual(s.lines, ['b3 写错', '记上了：recall/K9', '没记上：超了条数']);
});
test('执行了但 result 是空的也说出来', () => { assert.deepEqual(turnStatus({ done: { at: 1 }, result: null }).lines, ['执行了，但页面没有回报 result']); });

test('命令行：--next 写出文档、打出该写到哪；--status 逐条说；--link 给入口', () => {
  const root = mkdtempSync(join(tmpdir(), 'ext-turn-'));
  const sid = 'c-20261128-1';
  mkdirSync(join(root, 'sessions', sid, 'ext_in'), { recursive: true });
  mkdirSync(join(root, 'sessions', sid, 'ext_out'), { recursive: true });
  writeFileSync(join(root, 'sessions', sid, 'ext_in', '001.json'), JSON.stringify({ seq: 1, text: '~~~~~~board new id=b1\n你好\n~~~~~~', after: 0, done: { at: 2 }, result: { errors: [], notes: ['recall b9：没有到期的记忆点，没画这一段'] } }));
  writeFileSync(join(root, 'sessions', sid, 'ext_out', '001.json'), JSON.stringify({ seq: 1, text: '黑板现状' }));
  const next = join(root, 'next.txt');
  writeFileSync(next, '~~~~~~board add id=b1\n重了\n~~~~~~');
  const cli = resolve('tools/ext-turn.mjs');
  const out = execFileSync('node', [cli, '--session', root, '--sid', sid, '--next', next, '--out', join(root, 'o')], { encoding: 'utf8' });
  assert.match(out, /b1 已经用过了/, '带着这节课的现状查写法');
  assert.match(out, new RegExp(`sessions/${sid}/ext_in`));
  const doc = JSON.parse(readFileSync(join(root, 'o', 'ext_in-002.json'), 'utf8'));
  assert.equal(doc.seq, 2); assert.equal(doc.after, 1); assert.ok(doc.at > 0);
  const st = execFileSync('node', [cli, '--session', root, '--sid', sid, '--status'], { encoding: 'utf8' });
  assert.match(st, /001.*执行了/); assert.match(st, /没有到期的记忆点/);
  assert.match(execFileSync('node', [cli, '--link', sid], { encoding: 'utf8' }), /artifact\/BCAMUUkMWc2rt5hSS1ULHo#c-20261128-1/);
});

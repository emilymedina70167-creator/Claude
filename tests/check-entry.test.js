// 检验接进数据和写法的入口：absorb、probes 两类，sessions 下的 check / ink，board check 指令（Task 7）
import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS, assertWrite } from '../kit/src/memory/schema.js';
import { validateWrite } from '../kit/src/memory/writer.js';
import { SESSION_SCOPED, SESSION_KINDS } from '../kit/src/memory/session.js';
import { blockCommand, parseCommand } from '../kit/src/class/protocol.js';

const goodAbsorb = { block: 'L2.1.4', state: '部分', checked: false, by: 'page', log: [{ at: 1, state: '部分', checked: false, by: 'page' }] };

test('absorb、probes 两类', () => {
  assert.equal(COLLECTIONS.absorb.kind, 'state');
  assert.deepEqual(COLLECTIONS.absorb.tracked, ['state', 'checked']);
  assert.equal(COLLECTIONS.probes.label, '检验题库');
  assert.ok(COLLECTIONS.absorb.id.re.test('L2.1.4'));
  assert.ok(COLLECTIONS.absorb.id.re.test('L2.1.4~comm'));
  assert.ok(COLLECTIONS.probes.id.re.test('pr-0123456789ab'));
  assert.ok(!COLLECTIONS.probes.id.re.test('pr-xyz'));
});

test('validateWrite：好的 absorb 没问题，state 不认识报', () => {
  assert.deepEqual(validateWrite('absorb/L2.1.4', goodAbsorb), []);
  assert.ok(validateWrite('absorb/L2.1.4', { ...goodAbsorb, state: '好' }).length > 0);
  assert.deepEqual(validateWrite('probes/pr-0123456789ab', { fence: '```recall\n```', type: 'recall', block: 'L2.1.4' }), []);
  assert.ok(validateWrite('probes/pr-0123456789ab', { fence: '```quiz\n```', type: 'quiz', block: 'L2.1.4' }).length > 0);
});

test('页面能写 absorb、probes；外部（chat）也能写 absorb', () => {
  assert.doesNotThrow(() => assertWrite('page', 'absorb'));
  assert.doesNotThrow(() => assertWrite('page', 'probes'));
  assert.doesNotThrow(() => assertWrite('chat', 'absorb'));
  assert.throws(() => assertWrite('class', 'absorb'));
});

test('sessions 下多 check、ink；课多一种 check', () => {
  assert.ok(SESSION_SCOPED.includes('check'));
  assert.ok(SESSION_SCOPED.includes('ink'));
  assert.equal(SESSION_KINDS.check, '检验');
});

test('board check 指令', () => {
  assert.deepEqual(parseCommand('check id=k1 limit=15m').op, 'check');
  const body = 'block L2.1.1 must=p1\n```recall\nid: p1\nq: 写\ntarget: x\nlevel: 基础\nmust m1: 一\nteach default: 二\nretry: p1a, p1b\n```\n```recall\nid: p1a\nq: 写\ntarget: x\nlevel: 基础\nmust m1: 一\n```\n```recall\nid: p1b\nq: 写\ntarget: x\nlevel: 基础\nmust m1: 一\n```';
  const r = blockCommand('check id=k1 limit=15m', body);
  assert.equal(r.op, 'check');
  assert.equal(r.check.id, 'k1');
  assert.deepEqual(r.errors, []);
  assert.match(blockCommand('check id=k1', '```recall\nid: p1\nq: 写\ntarget: x\nlevel: 基础\nmust m1: 一\n```').error, /block/);
  assert.ok(blockCommand('check id=k1', '```recall\nid: p1\n```').error);
  assert.match(parseCommand('check').error, /id/);
});

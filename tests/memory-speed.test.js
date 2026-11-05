// 测速（memory/speed.js，docs/talk-plan.md 第 0 批）：条件、垫长、拼出来的对话、汇总
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchConds, shuffled, padText, benchMessages, inputBytes, benchSummary, summaryText, SPEED_MODEL } from '../kit/src/memory/speed.js';

const SRC = '### sort：排序演示\n页面按王道的代码走。'.repeat(200);

test('条件：快速 6 次、完整 15 次；打乱不丢', () => {
  assert.equal(benchConds('quick').length, 6);
  assert.equal(benchConds('full').length, 15);
  const s = shuffled(benchConds('full'), 42);
  assert.equal(s.length, 15);
  assert.deepEqual(new Set(s.map((c) => `${c.kb}/${c.turns}`)).size, 15);
});

test('垫长：按字节垫到 kb，不切坏中文；说明加对话大小对得上', () => {
  const t = padText(40, SRC);
  assert.ok(Math.abs(new TextEncoder().encode(t).length - 40 * 1024) <= 3);
  assert.ok(!t.includes(String.fromCharCode(0xfffd)));
  for (const c of [{ kb: 4, turns: 2 }, { kb: 160, turns: 30 }]) {
    const m = benchMessages(c, SRC);
    assert.equal(m[0].role, 'user');
    assert.equal(m.at(-1).role, 'user');
    assert.ok(m.every((x, i) => i === 0 || x.role !== m[i - 1].role), '一问一答交替');
    const kb = inputBytes(m) / 1024;
    assert.ok(kb >= c.kb - 1 && kb < c.kb + 8, `${c.kb} KB 拼出来 ${kb.toFixed(1)} KB`);
    assert.ok(!/[他她]/.test(m.map((x) => x.content).join('')), '提示词里不称呼学生他她');
  }
});

test('汇总：只算 Opus 5.5 回的，按说明长短、对话长短分', () => {
  const rows = [
    { kb: 4, turns: 2, first: 5000, total: 7000, model: SPEED_MODEL },
    { kb: 160, turns: 2, first: 9000, total: 12000, model: SPEED_MODEL },
    { kb: 160, turns: 30, first: 11000, total: 14000, model: SPEED_MODEL },
    { kb: 4, turns: 30, first: 1000, total: 2000, model: 'claude-sonnet-5-5' },
    { kb: 40, turns: 2, error: 'rate_limited' },
  ];
  const s = benchSummary(rows);
  assert.equal(s.n, 3);
  assert.equal(s.notOpus, 1);
  assert.equal(s.failed, 1);
  assert.deepEqual(s.byKb.map((g) => [g.kb, g.first]), [[4, 5000], [160, 10000]]);
  assert.deepEqual(s.byTurns.map((g) => [g.turns, g.first]), [[2, 7000], [30, 11000]]);
  assert.match(summaryText(s), /4 KB 5\.0 秒.*160 KB 10\.0 秒/);
});

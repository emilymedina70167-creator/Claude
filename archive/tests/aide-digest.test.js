// 第九轮第 1 批：记忆那一节先放课前档案和学生卡，总量不变（memory/digest.js、stage/doc.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDigest, AIDE_SHARE } from '../kit/src/memory/digest.js';
import { sampleMemory } from '../kit/src/memory/sample.js';
import { buildStageSystem, STAGE_SYSTEM_MAX } from '../kit/src/stage/doc.js';

const mem = sampleMemory('2026-11-13');
const block = 'L2.2.2';
const bytes = (s) => new TextEncoder().encode(s).length;
const aide = {
  brief: '### 这节课要知道的（课前助手读了全部学生卡写的，每行有出处）\n- 讲到外积时先探 βᵀα（L2-07）\n- 学生一多符号就跳步（x-math）',
  cards: ['### 学生卡：L2.2.2 外积\n- 概括：外积还没和内积分开\n- 误解：βᵀα 当矩阵（L2-07）', '### 学生卡：跨块（math）\n- 概括：符号一多就跳步'],
};

test('没有助手的东西时，和现在一字不差', () => {
  assert.deepEqual(memoryDigest(mem, { block, budget: 28 * 1024 }), memoryDigest(mem, { block, budget: 28 * 1024, aide: null }));
});

test('有档案和卡：带上了，总量不超 28 KiB，规则那部分不变', () => {
  const a = memoryDigest(mem, { block, budget: 28 * 1024 });
  const b = memoryDigest(mem, { block, budget: 28 * 1024, aide });
  assert.ok(b.text.includes('讲到外积时先探'));
  assert.ok(b.text.includes('### 学生卡：L2.2.2'));
  assert.ok(b.bytes <= 28 * 1024);
  assert.equal(b.rules, a.rules);
  assert.ok(b.text.indexOf('这节课要知道的') < b.text.indexOf('## 学生（profile）') || !b.text.includes('## 学生（profile）'));
  assert.ok(AIDE_SHARE > 0 && AIDE_SHARE <= 0.4);
});

test('预算小的时候，助手的两节最多占 AIDE_SHARE', () => {
  const big = { brief: `### x\n${Array.from({ length: 40 }, (_, i) => `- 第 ${i} 条${'字'.repeat(80)}`).join('\n')}`, cards: [] };
  const r = memoryDigest(mem, { block, budget: 8 * 1024, aide: big });
  const start = r.text.indexOf('## 这节课要知道的');
  assert.ok(start >= 0);
  const end = r.text.indexOf('\n## ', start + 5);
  assert.ok(bytes(r.text.slice(start, end < 0 ? undefined : end)) <= 8 * 1024 * AIDE_SHARE + 200);
});

test('舞台课的整份说明带上以后不超上限', () => {
  const s = buildStageSystem({ memory: { mem, block, space: 'math', session: 'c-1' }, aide, subject: '线性代数' });
  assert.ok(bytes(s) <= STAGE_SYSTEM_MAX);
  assert.ok(s.includes('讲到外积时先探'));
});

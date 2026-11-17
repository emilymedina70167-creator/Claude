// 第九轮第 1 批：课前档案（kit/src/aide/brief.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRIEF_MAX_BYTES, BRIEF_HEAD, briefPrompt, parseBrief, briefSig, briefUsable, briefText, guessBlocks } from '../kit/src/aide/brief.js';

const cards = [{ id: 'DS-L8.2.1', at: 10, text: '概括｜稳定性没过关' }, { id: 'x-cs', at: 11, text: '概括｜下标从 1 数' }];
const blocks = ['DS-L8.2.1'];
const good = { space: 'cs', blocks, sig: briefSig(blocks, cards), model: 'claude-opus-5-5', text: '要点｜先探稳定（DS-L8-T09）', at: 12 };

test('档案能不能用：块一样、卡没变、是 Opus 写的', () => {
  assert.equal(briefUsable(good, { blocks, cards }), true);
  assert.equal(briefUsable(null, { blocks, cards }), false);
  assert.equal(briefUsable({ ...good, blocks: ['DS-L8.2.2'] }, { blocks, cards }), false);
  assert.equal(briefUsable(good, { blocks, cards: [{ ...cards[0], at: 99 }, cards[1]] }), false);
  assert.equal(briefUsable({ ...good, model: 'claude-sonnet-5-5' }, { blocks, cards }), false);
  // 复现课几块：按集合比，先后不论
  const two = ['L2.1.4', 'L1.1.1'];
  assert.equal(briefUsable({ ...good, blocks: ['L1.1.1', 'L2.1.4'], sig: briefSig(['L1.1.1', 'L2.1.4'], cards) }, { blocks: two, cards }), true);
});

test('读回只收「要点｜」开头的行，最多 15 行', () => {
  const r = parseBrief(['要点｜一', '随便写的', ...Array.from({ length: 20 }, (_, i) => `要点｜${i}`)].join('\n'));
  assert.equal(r.lines.length, 15);
  assert.equal(r.lines[0], '一');
  assert.ok(r.problems.length >= 1);
});

test('给老师看的那一节不超过 6 KiB', () => {
  const t = briefText({ text: Array.from({ length: 15 }, () => `要点｜${'字'.repeat(300)}`).join('\n') });
  assert.ok(new TextEncoder().encode(t).length <= BRIEF_MAX_BYTES);
  assert.match(t, /^### 这节课要知道的/);
});

test('猜下一节讲哪块：教案 > 到期的复现组 > 上一节停在哪', () => {
  const mem = { position: [{ id: 'now-cs', block: 'DS-L8.2.2' }], reviews: [], curriculum: [] };
  assert.deepEqual(guessBlocks(mem, 'cs', { cs: { main: { block: 'DS-L8.2.1' } } }), ['DS-L8.2.1']);
  assert.deepEqual(guessBlocks(mem, 'cs', {}), ['DS-L8.2.2']);
  assert.deepEqual(guessBlocks({}, 'cs', {}), []);
});

test('提示词不用他她', () => {
  const p = briefPrompt({ space: 'cs', blocks, cards, plan: '先讲稳定', position: { block: 'DS-L8.2.1', next: '接着讲' }, rules: '' });
  assert.ok(p.startsWith(BRIEF_HEAD));
  assert.ok(!/[他她](?!们)/.test(p));
});

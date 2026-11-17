// 规则的 use（根本规则这一轮的任务 2）：管记录和复现的规则（use: record）讲新课时用不上，每一轮带着只是让老师多读、
// 还会去照着「规定形式」；只在下课、复现课、备课、事后补写时带。不写 use 当 teach（讲课时带）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { sampleMemory } = await import('../kit/src/memory/sample.js');
const { memoryDigest, classView } = await import('../kit/src/memory/digest.js');
const { validateWrite } = await import('../kit/src/memory/writer.js');
const { checkMemory } = await import('../kit/src/memory/check.js');
const { buildSystem } = await import('../kit/src/class/prompt.js');

const TODAY = '2026-11-16';
const REC = { id: 'rule-rec', cat: '来源', text: '错题只增不改：更正另记一条，指向原条。', since: TODAY, source: '我定的', status: 'active', use: 'record' };
const TEA = { id: 'rule-tea', cat: '教法', text: '讲法自造：不照搬教材的讲法，例子自己挑。', since: TODAY, source: '我定的', status: 'active' };
const withRules = () => { const m = sampleMemory(TODAY); m.rules.push(REC, TEA); return m; };
const src = (p) => readFileSync(new URL(`../kit/src/${p}`, import.meta.url), 'utf8');

test('讲课时（默认 teach）不带 use: record 的规则，all 都带', () => {
  const mem = withRules();
  const teach = memoryDigest(mem, { block: 'L2.2.2', today: TODAY });
  assert.ok(teach.rules.includes('讲法自造') && !teach.rules.includes('错题只增不改'));
  assert.ok(!teach.text.includes('错题只增不改') && !teach.text.includes('rule-rec'));
  assert.deepEqual(memoryDigest(mem, { block: 'L2.2.2', today: TODAY, use: 'teach' }), teach, '不写就是 teach');
  const all = memoryDigest(mem, { block: 'L2.2.2', today: TODAY, use: 'all' });
  assert.ok(all.rules.includes('讲法自造') && all.rules.includes('错题只增不改'));
  // 写了 use: teach 的和不写一样带
  const m2 = withRules();
  m2.rules.find((r) => r.id === 'rule-tea').use = 'teach';
  assert.ok(memoryDigest(m2, { block: 'L2.2.2', today: TODAY }).rules.includes('讲法自造'));
});

test('目录里也不列：讲课时用不上的规则列了老师会去取', () => {
  const mem = withRules();
  // 规则多到全文放不下：排在后面的（来源）进目录
  for (let i = 0; i < 30; i++) mem.rules.push({ id: `rule-long-${i}`, cat: '红线', text: `第 ${i} 条：${'每一轮都要守住的一句很长的话；'.repeat(8)}`, since: TODAY, source: 'x', status: 'active' });
  const all = memoryDigest(mem, { block: 'L2.2.2', today: TODAY, budget: 12 * 1024, use: 'all' });
  assert.ok(!all.rules.includes('错题只增不改') && all.text.includes('rule-rec'), '带全部时它在目录里');
  assert.ok(all.cut.find((c) => c.coll === 'rules').ids.includes('rule-rec'));
  const teach = memoryDigest(mem, { block: 'L2.2.2', today: TODAY, budget: 12 * 1024 });
  assert.ok(!teach.rules.includes('错题只增不改') && !teach.text.includes('rule-rec'));
  assert.ok(!teach.cut.find((c) => c.coll === 'rules').ids.includes('rule-rec'));
  assert.ok(teach.cut.find((c) => c.coll === 'rules').ids.length > 0, '别的规则照旧在目录里');
});

test('没有 use: record 的规则时，teach 和 all 逐字一样（舞台课、一问一答不传 use，照旧）', () => {
  const mem = sampleMemory(TODAY);
  mem.rules.push(TEA);
  for (const budget of [4096, 12 * 1024, 28 * 1024]) for (const tools of [true, false]) {
    assert.deepEqual(memoryDigest(mem, { block: 'L2.2.2', today: TODAY, budget, tools }), memoryDigest(mem, { block: 'L2.2.2', today: TODAY, budget, tools, use: 'all' }));
  }
  // classView 自己不滤（对话里的 Claude 的开场简报、班主任从它出发，全都要）
  assert.ok(classView(withRules(), { block: 'L2.2.2' }).get('rules').some((r) => r.id === 'rule-rec'));
  assert.ok(!classView(withRules(), { block: 'L2.2.2', use: 'teach' }).get('rules').some((r) => r.id === 'rule-rec'));
});

test('规则的 use 只能是 teach / record：写数据库的出口和自检都认', () => {
  const doc = { cat: '来源', text: 'x', since: TODAY, source: '我' };
  assert.deepEqual(validateWrite('rules/rule-x', { ...doc, use: 'teach' }), []);
  assert.deepEqual(validateWrite('rules/rule-x', { ...doc, use: 'record' }), []);
  assert.deepEqual(validateWrite('rules/rule-x', doc), []);
  assert.match(validateWrite('rules/rule-x', { ...doc, use: 'other' }).join('\n'), /use 是「other」，只能是 teach \/ record/);
  const hard = (m) => checkMemory(m, { today: TODAY }).problems.filter((p) => !p.soft && p.coll === 'rules');
  const ok = withRules();
  ok.rules = ok.rules.map((r) => ({ log: [], ...r }));
  assert.deepEqual(hard(ok), []);
  const bad = withRules();
  bad.rules = bad.rules.map((r) => ({ log: [], ...r, ...(r.id === 'rule-rec' ? { use: 'other' } : {}) }));
  assert.ok(hard(bad).some((p) => /use/.test(p.msg || p.text || JSON.stringify(p))));
});

test('黑板课的说明：memory.use 原样传下去，规则接在根本规则后面的是滤过的', () => {
  const mem = withRules();
  const args = { componentDocs: '', pack: {}, board: { segs: [], pages: [], cur: 0 }, subject: '线代' };
  const teach = buildSystem({ ...args, memory: { mem, block: 'L2.2.2' } });
  assert.ok(teach.includes('讲法自造') && !teach.includes('错题只增不改') && !teach.includes('rule-rec'));
  assert.equal(buildSystem({ ...args, memory: { mem, block: 'L2.2.2', use: 'teach' } }), teach);
  const all = buildSystem({ ...args, memory: { mem, block: 'L2.2.2', use: 'all' } });
  assert.ok(all.includes('讲法自造') && all.includes('错题只增不改'));
  // 在「这个学生另外定的规则」那一段里（memoryRules），不是别处
  const at = all.indexOf('这个学生另外定的规则');
  assert.ok(at > 0 && all.indexOf('错题只增不改') > at && all.indexOf('错题只增不改') < all.indexOf('# 二、'));
  // 没有工具的查看方式一样
  assert.ok(!buildSystem({ ...args, tools: false, memory: { mem, block: 'L2.2.2' } }).includes('错题只增不改'));
  assert.ok(buildSystem({ ...args, tools: false, memory: { mem, block: 'L2.2.2', use: 'all' } }).includes('错题只增不改'));
});

test('哪一轮带全部：下课那一次、复现课的每一轮；平时上课只带讲课用的', async () => {
  const { rulesUse } = await import('../kit/src/class/prompt.js');
  assert.equal(rulesUse(), 'teach');
  assert.equal(rulesUse({ review: null }), 'teach');
  assert.equal(rulesUse({ review: [] }), 'teach', '备课写的开头复现记在 opening，不是复现课');
  assert.equal(rulesUse({ all: true }), 'all');
  assert.equal(rulesUse({ review: ['R3', 'R4'] }), 'all');
  assert.equal(rulesUse({ review: 'R3' }), 'all', '以前的课 review 是一个编号');
  // 课堂真这么用：每一轮 memoryArg()，下课那一次 memoryArg({ all: true })，复现课看 desk.review
  const cls = src('class/classroom.js');
  assert.match(cls, /function memoryArg\(\{ all = false \} = \{\}\) \{[^}]*use: rulesUse\(\{ all, review: desk\.review \}\)/);
  const closing = cls.slice(cls.indexOf('const sheet = sheetMd('), cls.indexOf('closingPrompt({ report'));
  assert.match(closing, /buildSystem\(\{[^\n]*memory: memoryArg\(\{ all: true \}\)/, '下课小结那一次');
  const turn = cls.slice(cls.indexOf('function buildInput('), cls.indexOf('function buildInput(') + 900);
  assert.match(turn, /memory: memoryArg\(\)/, '平时的每一轮');
});


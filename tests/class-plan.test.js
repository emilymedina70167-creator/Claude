// 课堂老师的教学计划 board plan：学生看不到，最新一份放进说明，历史里去掉
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseOutput, blockCommand, PLAN_MAX } = await import('../kit/src/class/protocol.js');
const { latestPlan, stripPlan, planText, buildSystem, buildTurns, closingPrompt, PLAN_DOC } = await import('../kit/src/class/prompt.js');

const out = (plan, extra = '') => `好，先看这一题。\n\n\`\`\`\`board plan\n${plan}\n\`\`\`\`\n${extra}`;

test('protocol：board plan 读成 { op: plan, text }；空的报错；太长截断', () => {
  const { segments } = parseOutput(out('目标：A^n\n猜：把内积当矩阵'), { final: true });
  const b = segments.find((s) => s.type === 'board');
  assert.deepEqual(b.op, { op: 'plan', text: '目标：A^n\n猜：把内积当矩阵' });
  assert.match(blockCommand('plan', '  ').error, /plan 里没写内容/);
  const long = blockCommand('plan', '字'.repeat(PLAN_MAX + 50));
  assert.equal(long.text.length, PLAN_MAX);
  assert.equal(long.cut, PLAN_MAX + 50);
  // 学生看到的话里没有计划
  assert.equal(segments.filter((s) => s.type === 'speech').map((s) => s.text).join(''), '好，先看这一题。');
});

test('latestPlan：从后往前找最近的一份；作废的轮不算；stripPlan 去掉 plan 块、别的指令原样', () => {
  const history = [
    { role: 'claude', seq: 1, text: out('计划一') },
    { role: 'student', seq: 2, text: '好' },
    { role: 'claude', seq: 3, text: out('计划二', '\n````board new id=b2 title="x"\n内容\n````') },
    { role: 'claude', seq: 5, text: out('作废的'), discarded: true },
    { role: 'claude', seq: 6, text: '只说话' },
  ];
  assert.deepEqual(latestPlan(history), { text: '计划二', seq: 3 });
  assert.equal(latestPlan([{ role: 'claude', text: '没有计划' }]), null);
  const s = stripPlan(history[2].text);
  assert.ok(!s.includes('计划二'));
  assert.ok(s.includes('````board new id=b2 title="x"\n内容\n````'));
  assert.equal(stripPlan('没有块'), '没有块');
  const turns = buildTurns({ system: 'S', history: [...history, { role: 'student', seq: 7, text: '嗯' }] });
  assert.ok(!turns.turns.some((t) => t.content.includes('计划一') || t.content.includes('计划二')), '历史里不重复带');
});

test('buildSystem：说明里有 plan 的写法，黑板现状前面是最新一份；关掉时都不带；下课小结对照计划', () => {
  const sys = buildSystem({ componentDocs: '', pack: {}, plan: { text: '目标：tr', seq: 4 } });
  assert.ok(sys.includes('### plan：你的教学计划'));
  assert.match(sys, /你的教学计划（你第 4 轮写的[^\n]*\n\n目标：tr/);
  assert.ok(sys.indexOf('目标：tr') > sys.indexOf('# 五、黑板现状') || sys.indexOf('目标：tr') > sys.indexOf('黑板现状'));
  const none = buildSystem({ componentDocs: '', pack: {} });
  assert.match(none, /还没写。开课时用 `board plan` 写一份/);
  const off = buildSystem({ componentDocs: '', pack: {}, plan: { text: '目标：tr' }, planDoc: false });
  assert.ok(!off.includes('board plan') && !off.includes('目标：tr'));
  assert.match(planText('x'), /你之前写的/);
  assert.match(closingPrompt({ plan: { text: '目标：tr' } }), /你最后写的教学计划[\s\S]*目标：tr/);
  assert.ok(!closingPrompt({}).includes('教学计划'));
  assert.ok(!/他|她/.test(PLAN_DOC.replace(/其他|其它/g, '')));
});

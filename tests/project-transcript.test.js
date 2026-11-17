// 记录稿（project/transcript.js）：从 memory/debrief.js 搬来的
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptText } from '../kit/src/project/transcript.js';

test('transcriptText：学生原话照写；老师的板书截开头，memo 不要；作废的轮不要；太长留头尾', () => {
  const long = 'x'.repeat(3000);
  const turns = [
    { seq: 1, role: 'student', text: '开始上课。' },
    { seq: 2, role: 'claude', text: `先看这个。\n\n\`\`\`\`board new id=b1 title="主谓"\n${long}\n\`\`\`\`\n\n\`\`\`\`board memo\nslip text="x"\n\`\`\`\`` },
    { seq: 3, role: 'system', kind: 'spec', discarded: true, text: '抢跑没用上' },
    { seq: 4, role: 'student', text: '[作答] b1 里的 quiz：选错了' },
  ];
  const t = transcriptText(turns);
  assert.match(t, /#1 【学生】开始上课。/);
  assert.match(t, /#2 【老师】先看这个。\n［board new id=b1 title="主谓"］\nx+…/);
  assert.ok(!t.includes('slip text'), 'memo 块不进复盘');
  assert.ok(!t.includes('抢跑'), '作废的轮不要');
  assert.ok(t.length < 1500, '板书原文截短了');
  // 太长：留开头 6 轮和后面的
  const many = Array.from({ length: 80 }, (_, i) => ({ seq: i + 1, role: i % 2 ? 'claude' : 'student', text: `第${i + 1}轮 ${'字'.repeat(400)}` }));
  const short = transcriptText(many, 20 * 1024);
  assert.ok(new TextEncoder().encode(short).length <= 20 * 1024);
  assert.match(short, /#1 【学生】第1轮/);
  assert.match(short, /中间 \d+ 轮太长，省略了/);
  assert.match(short, /#80 【老师】第80轮/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsDebrief, transcriptText, debriefPrompt, parseDebrief, debriefText, debriefView, DEBRIEF_VERSION } from '../kit/src/memory/debrief.js';

const closed = { id: 'c-20261104-1', kind: 'class', status: 'closed', report: { at: 1, items: 3 } };

test('needsDebrief：下了课、报告不是暂时的、还没复盘过才要', () => {
  assert.equal(needsDebrief(closed), true);
  assert.equal(needsDebrief({ ...closed, status: 'open' }), false);
  assert.equal(needsDebrief({ ...closed, report: { at: 1, provisional: true } }), false);
  assert.equal(needsDebrief({ ...closed, report: null }), false);
  assert.equal(needsDebrief({ ...closed, kind: 'drill' }), false);
  assert.equal(needsDebrief({ ...closed, debrief: { v: DEBRIEF_VERSION } }), false);
  assert.equal(needsDebrief({ ...closed, debrief: { v: 0 } }), true);
  assert.equal(needsDebrief({ ...closed, kind: undefined }), true, '以前的课没写 kind，就是课堂');
});

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

test('debriefPrompt：带整段记录、报告、弱点、上一节复盘；提到学生不用他她', () => {
  const p = debriefPrompt({ session: { title: '简单句', block: 'EN-L1.1.1', date: '2026-11-04' }, transcript: '#1 【学生】开始', report: '1. quiz 一次对', weaknesses: [{ id: 'W1', text: 'that 万能' }], prev: '- 误解（还在）：that 万能', subject: '英语' });
  assert.match(p, /你在给一节刚上完的课做复盘/);
  assert.match(p, /#1 【学生】开始/);
  assert.match(p, /W1：that 万能/);
  assert.match(p, /上一节的复盘/);
  assert.match(p, /误解｜消了\/还在\/绕开了\/新冒出｜/);
  assert.ok(!/[他她]/.test(p), '提示词里不称呼他、她');
});

test('parseDebrief：读五种行，别的字不要；状态不认得的报出来；有上限', () => {
  const d = parseDebrief([
    '好的，复盘如下：',
    '误解｜还在｜以为 that 能引导非限制性从句｜#8 学生在逗号后填 that',
    '- 误解 | 绕开了 | 把 nextval 当成 next | 老师先写了规则',
    '误解｜大概消了｜x｜y',
    '节奏｜第三块板的宾补｜太快：连错三次',
    '习惯｜先套规则不看句意｜#5、#12',
    '开场｜非限制性从句的关系词｜He has two sons, ___ are doctors.（填 who 还是 that）',
    '开场｜第二个｜不要',
    '建议｜先让学生凭感觉填一次，再讲规则',
  ].join('\n'));
  assert.deepEqual(d.mis.map((m) => m.state), ['还在', '绕开了']);
  assert.equal(d.mis[0].basis, '#8 学生在逗号后填 that');
  assert.equal(d.pace[0].where, '第三块板的宾补');
  assert.equal(d.habit[0].text, '先套规则不看句意');
  assert.equal(d.opening.what, '非限制性从句的关系词');
  assert.match(d.opening.q, /who 还是 that/);
  assert.equal(d.advice.length, 1);
  assert.equal(d.problems.length, 1);
  assert.match(parseDebrief('今天上得不错').problems[0], /回的不是复盘/);
});

test('debriefText / debriefView：给老师的全文、给我看的几行（不带轮次依据）', () => {
  const d = parseDebrief('误解｜消了｜A｜#3\n误解｜还在｜B｜#9 写错\n误解｜绕开了｜C｜老师先讲\n习惯｜跳步｜#2 #4\n开场｜B｜一道题');
  const t = debriefText(d);
  assert.match(t, /误解（还在）：B（#9 写错）/);
  assert.match(t, /下一节开头先测：B；题：一道题/);
  const v = debriefView(d).map((x) => x.text);
  assert.deepEqual(v, ['消了：A', '还在：B', '没真正测过：C', '习惯：跳步', '下节先测：B']);
  assert.ok(!v.join('').includes('#'));
  assert.equal(debriefText(null), '');
});

test('记忆摘要：这一块最近那节课的复盘带进下一节（误解、开场）', async () => {
  const { memoryDigest } = await import('../kit/src/memory/digest.js');
  const { sampleMemory } = await import('../kit/src/memory/sample.js');
  const mem = sampleMemory('2026-11-04');
  const block = mem.curriculum.find((b) => /\.\d+\.\d+$/.test(b.id)).id;
  const d = parseDebrief('误解｜还在｜以为秩看非零元个数｜#9 学生数了非零元\n开场｜秩的定义｜给一个有零行的矩阵求秩');
  mem.sessions = [...(mem.sessions || []), { id: 'c-20261104-9', kind: 'class', block, status: 'closed', startedAt: Date.now(), date: '2026-11-04', report: { at: 1, items: 2, line: '2 道题' }, debrief: { v: 1, ...d } }];
  const text = memoryDigest(mem, { block, session: 'c-20261105-1' }).text;
  assert.match(text, /下课后的复盘：\n\s+- 误解（还在）：以为秩看非零元个数/);
  assert.match(text, /下一节开头先测：秩的定义；题：给一个有零行的矩阵求秩/);
});

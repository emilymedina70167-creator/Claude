import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARTER, DIAGNOSE, CHARTER_MAX, SUBJECT_FACTS, charterFor } from '../kit/src/class/charter.js';
import { defaultRules, memoryRules, buildSystem, PROTOCOL_DOC, buildTalkSystem } from '../kit/src/class/prompt.js';

const bytes = (s) => Buffer.byteLength(s);
test('根本规则连同诊断的经验不超过上限', () => assert.ok(bytes(CHARTER) + bytes(DIAGNOSE) <= CHARTER_MAX, `${bytes(CHARTER) + bytes(DIAGNOSE)}`));
test('三问、保险四条都在', () => {
  for (const s of ['终点：', '差距：', '动作：', '事实照资料', '不宣布掌握', '这节课要拿下的事开课先告诉学生', '让页面算']) assert.ok(CHARTER.includes(s), s);
});
test('不写规定形式、带方向的话', () => {
  for (const s of ['一次只推进一件事', '停下来等学生', '学生没有作答，就不往下推', '话要短', '给提示，不给答案', '三轮', '必须以', '主要花在', '先让学生动手', '最多']) {
    assert.ok(!defaultRules('线代').includes(s) && !defaultRules('操作系统').includes(s) && !defaultRules('英语').includes(s), s);
  }
});
test('提到学生不用他、她', () => { for (const k of Object.keys(SUBJECT_FACTS)) assert.ok(!/[他她]/.test(charterFor(k))); });
test('每门课的事实不超过 900 字节', () => { for (const [k, v] of Object.entries(SUBJECT_FACTS)) assert.ok(bytes(v) <= 900, k); });
test('记忆库有规则时根本规则还在，学生另外定的接在后面', () => {
  const r = memoryRules('线代', '- ［检验］复现要隔天、新题');
  assert.ok(r.indexOf('每一刻只问三件事') >= 0 && r.indexOf('每一刻只问三件事') < r.indexOf('这个学生另外定的规则'));
  assert.ok(r.includes('和上面冲突时以这里为准') && r.includes('复现要隔天、新题'));
});
test('说明里别处的形式话去掉了，字写在哪的那一句还在', () => {
  assert.ok(!PROTOCOL_DOC.includes('然后就停下') && !PROTOCOL_DOC.includes('一块板只放一件要学生动脑的事'));
  const s = buildSystem({ componentDocs: '', pack: {}, board: { segs: [], pages: [], cur: 0 }, subject: '线代', canvas: true });
  assert.ok(s.includes('讲解写在板上') && s.includes('# 一、你的角色和根本规则') && !s.includes('给提示，不给答案'));
});
test('一问一答的说明还是旧的红线', () => {
  const s = buildTalkSystem({ componentDocs: '', pack: {}, board: {}, subject: '线代' });
  assert.ok(s.includes('红线') && !s.includes('每一刻只问三件事'));
});

// 设计 6.1「防止再长出来」：守则只收事实和判断上的教训，不收形式
test('守则不写形式：黑板课的记忆说明、下课整理的提示里都有这一句', async () => {
  const { LESSON_NO_FORM, CLASS_MEMO_DOC, MEMO_DOC, closingPrompt } = await import('../kit/src/class/prompt.js');
  const s = buildSystem({ componentDocs: '', pack: {}, board: [], subject: '线代', memory: { mem: {}, block: 'L2.1' } });
  assert.ok(s.includes(LESSON_NO_FORM) && CLASS_MEMO_DOC.includes(LESSON_NO_FORM));
  assert.ok(!s.includes('lesson="一块板一件事"') && s.includes('判错之前先看清学生写的是什么'), '例子换成判断上的教训');
  assert.ok(closingPrompt({ report: '报告', noForm: true }).includes(LESSON_NO_FORM));
  // 舞台课、一问一答、教研室用的那几份不变
  assert.ok(!MEMO_DOC.includes(LESSON_NO_FORM) && !closingPrompt({ report: '报告' }).includes(LESSON_NO_FORM));
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../kit/src/class/classroom.js', import.meta.url), 'utf8'), /noForm: !TALK/, '黑板课下课时传 noForm');
});
test('快捷按钮只说明是学生点的，不写怎么接', () => {
  for (const s of ['退一步', '先请学生试试', '缺思路']) assert.ok(!PROTOCOL_DOC.includes(s), s);
  assert.ok(PROTOCOL_DOC.includes('这四句是学生点底下的快捷按钮发来的'));
  assert.ok(!PROTOCOL_DOC.includes('学生跟上了') && PROTOCOL_DOC.includes('一轮写一块'));
});

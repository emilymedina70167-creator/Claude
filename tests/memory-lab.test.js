// 云端教研室（kit/src/memory/lab.js、docs/lab-plan.md）：页面拼工作单子、读回答，不碰 DOM
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefId, hashOf, backfillBrief, parseBackfill, problemsBrief, parseProblems, problemLint, twinOf, prepBrief, checkReply, receipt, receiptLine, LAB_CAPS } from '../kit/src/memory/lab.js';
import { parseOutput } from '../kit/src/class/protocol.js';
import { closingPrompt } from '../kit/src/class/prompt.js';

test('briefId / hashOf：单子编号能当文档编号，指纹跟着材料变', () => {
  assert.equal(briefId({ kind: 'prep', ref: 'L2.2.3' }), 'prep-L2_2_3');
  assert.equal(briefId({ kind: 'recheck', ref: 'weaknesses/W1' }), 'recheck-weaknesses_W1');
  assert.notEqual(hashOf('a|1'), hashOf('a|2'));
  assert.deepEqual(Object.keys(LAB_CAPS).sort(), ['after', 'backfill', 'card', 'intel', 'map', 'newproblems', 'prep', 'probe', 'profile']);
});

test('补收尾的单子：带着整节课的记录和课堂下课时那份要求；说明里不用他 / 她', () => {
  const closing = closingPrompt({ report: '（报告）' });
  const b = backfillBrief({ session: { id: 'c-20261101-1', date: '2026-11-01', status: 'closed', block: 'L2.2.2' }, transcript: '#1 学生：内积是数吗', memory: '（记忆）', closing });
  assert.ok(b.includes('#1 学生：内积是数吗') && b.includes(closing) && b.includes('（记忆）'));
  assert.ok(!/[他她]/.test(b.replace(/「[他她]」/g, '')));
});

test('parseBackfill：小结是 memo 块以外的字，整理单是 memo 块的条目', () => {
  const r = parseBackfill('1. 讲了内积，用了一道选择题。\n2. 学生把内积当成矩阵。\n3. 只做过一道。\n4. 下一节换数再测。\n\n````board memo\nnote text="下一节换数再测"\nweird 一行看不懂\n````', { parseOutput });
  assert.ok(r.summary.startsWith('1. 讲了内积'));
  assert.ok(!r.summary.includes('board memo'));
  assert.equal(r.entries.length, 1);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.problems, []);
  assert.ok(parseBackfill('就一句', { parseOutput }).problems.length === 2);
});

test('出新题：读回答、换成题库编号、let 块跟着题；答案手写数字的、和原题一样的不收', () => {
  const target = { kind: 'review', id: 'R9', title: '内积的形状', blocks: ['L2.2.2'] };
  const brief = problemsBrief({ target, originals: [{ id: 'd-1', md: '```quiz\nid: d-1\nq: βᵀα\n```' }], errors: [{ id: 'L2-07', q: 'βᵀα', mine: '矩阵', cause: '形状' }], docs: '#### quiz', subject: '线性代数' });
  assert.ok(brief.includes('=== 题 1') && brief.includes('L2-07') && brief.includes('\\calc'));
  const text = '=== 题 1\n针对：形状\n```let\na = [1;2;3]\n```\n```answer\nid: x\nq: aᵀa\nanswer: \\calc{a\'*a}\n```\n=== 题 2\n针对：手写\n```answer\nid: y\nq: 1+1\nanswer: 2\n```\n=== 题 3\n没有组件';
  const { items, problems } = parseProblems(text, { brief: 'newproblems-R9', block: 'L2.2.2', target, at: 5 });
  assert.equal(items.length, 2);
  assert.equal(problems.length, 1);
  assert.equal(items[0].id, 'd-lab-newproblems-R9-5-1');
  assert.ok(items[0].doc.md.startsWith('```let') && items[0].doc.md.includes('id: d-lab-newproblems-R9-5-1'));
  assert.deepEqual([items[0].doc.src, items[0].doc.review, items[0].doc.block, items[0].doc.space], ['lab', 'R9', 'L2.2.2', 'math']);
  assert.deepEqual(problemLint(items[0], { subject: '线性代数' }), []);
  assert.equal(problemLint(items[1], { subject: '线性代数' }).length, 1, '手写的数字页面没法再算');
  assert.equal(problemLint(items[1], { subject: '英语' }).length, 0, '英语的答案本来就是字');
  assert.equal(problemLint(items[1], { subject: '数据结构' }).length, 0, '408 的答案常常本来就是一串（序列、表）');
  assert.equal(twinOf(items[0], [{ id: 'd-old', md: items[0].doc.md.replace('d-lab-newproblems-R9-5-1', 'd-old') }])?.id, 'd-old');
  assert.equal(twinOf(items[0], [{ id: 'd-old', md: '```quiz\nq: 完全不一样\n```' }]), null);
  assert.equal(parseProblems('随便写的', {}).problems[0], '回的不是题（没有「=== 题 1」这样的段）');
});

test('备课的单子把首页备课那份原样带上', () => {
  assert.ok(prepBrief({ prompt: 'PROMPT-原文', block: 'L2.2.3' }).includes('PROMPT-原文'));
});

test('checkReply / receipt：单子没了、指纹对不上、空的都不收；回执一行给我看', () => {
  const brief = { kind: 'backfill', ref: 'c-1', key: 'k1' };
  assert.equal(checkReply({ brief: 'b', key: 'k1', text: '很长很长很长很长很长很长很长很长很长很长' }, brief).ok, true);
  assert.match(checkReply({ brief: 'b', key: 'k0', text: 'x'.repeat(30) }, brief).why, /材料变了/);
  assert.match(checkReply({ brief: 'b', text: 'x'.repeat(30) }, null).why, /已经没了/);
  assert.match(checkReply({ brief: 'b', key: 'k1', text: ' ' }, brief).why, /空的/);
  const r = receipt({ inbox: { brief: 'b' }, brief, result: 'partial', took: { summary: 1, memo: 2 }, rejected: [{ line: 'slip …', error: '守卫：原话对不上' }], held: 1, now: 7 });
  assert.equal(r.at, 7);
  assert.match(receiptLine(r), /补收尾.*小结 1、整理单 2.*暂存 1.*没收 1/);
});

test('复查出来的几处：memo 块没闭合整份不收；段头带字也认；四个反引号的组件不截断；没抄 key 不收；题号每批不同', async () => {
  const bad = parseBackfill('1. 讲了内积，用了一道选择题，学生选错了两次。\n2. 卡在形状上。\n\n````board memo\nnote text="下一节换数再测"\n', { parseOutput });
  assert.equal(bad.fatal, true);
  assert.equal(bad.summary, '');
  assert.equal(bad.entries.length, 0);
  const two = parseProblems('=== 题 1：简单\n针对：a\n```quiz\nq: 一\n- [x] 对\n```\n=== 题 2 难一点\n针对：b\n````steps\nid: s\nq: 二\nshow: 看 ```x```\n````', { brief: 'b', block: 'L2.2.2', batch: 36 });
  assert.equal(two.items.length, 2);
  assert.deepEqual(two.items.map((x) => x.id), ['d-lab-b-10-1', 'd-lab-b-10-2']);
  assert.ok(two.items[1].doc.md.startsWith('````steps') && two.items[1].doc.md.trimEnd().endsWith('````'));
  assert.notEqual(parseProblems('=== 题 1\n```quiz\nq: x\n```', { brief: 'b', batch: 1 }).items[0].id, parseProblems('=== 题 1\n```quiz\nq: x\n```', { brief: 'b', batch: 2 }).items[0].id);
  assert.match(checkReply({ brief: 'b', text: 'x'.repeat(30) }, { key: 'k' }).why, /key/);
  // 守卫：挂着的失误原文只给没写轮次的引号用；挂在 Claude 自己写的弱点上的不算出处
  const { guardCandidate, buildCorpus } = await import('../kit/src/memory/guard.js');
  const corpus = buildCorpus({ turns: [{ seq: 1, role: 'student', say: '开始上课' }, { seq: 2, role: 'claude', text: '好' }] });
  const mem = { slips: [{ id: 'S-1', text: '对学生说「要背的已经圈出来」' }], weaknesses: [{ id: 'W1', title: '学生说「我早就会了」' }], sessions: [{ id: 'c-1' }] };
  const lesson = (text, extra) => ({ coll: 'lessons', id: 'T-1', author: 'lab', session: 'c-1', doc: { text, ...extra } });
  assert.equal(guardCandidate(lesson('说「要背的已经圈出来」之前先核对', { slips: ['S-1'] }), { mem, corpus }).checks.some((c) => c.code === 'quote-miss'), false);
  assert.ok(guardCandidate(lesson('#2 老师说「要背的已经圈出来」', { slips: ['S-1'] }), { mem, corpus }).checks.some((c) => c.code === 'quote-miss'), '写了轮次就只认这节课');
  assert.ok(guardCandidate(lesson('学生说「我早就会了」', { about: ['W1'] }), { mem, corpus }).checks.some((c) => c.code === 'quote-miss'), '自己写的弱点不算出处');
  // 自检：log 里 by: lab 是合法的
  const { checkMemory } = await import('../kit/src/memory/check.js');
  const r = checkMemory({ weaknesses: [{ id: 'W1', title: 't', scope: '局部', level: 'L1', status: 'active', log: [{ date: '2026-11-05', by: 'lab', field: 'level', from: 'L0', to: 'L1' }] }] });
  assert.ok(!JSON.stringify(r).includes('by 只能是'));
});

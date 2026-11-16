import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cliArgs, studentSystem, posttestSystem, extractJson, graderPrompt, parseGrade, studentReply, summaryRow, summaryMd } from '../tools/teach-run-lib.mjs';

const sc = { id: 'x', persona: '大三，学过一点操作系统', know: '知道缺页是什么；不知道 LRU', aims: [{ id: 'a1', can: '手算 LRU', proof: '独立做一道' }], misconception: '以为换出最早进来的', rubric: 'r' };

test('第一轮带系统提示词文件，之后带 resume；不带退路模型', () => {
  const a = cliArgs({ model: 'claude-opus-5-5', effort: 'high', systemFile: '/t/system.md' });
  const b = cliArgs({ model: 'claude-opus-5-5', effort: 'high', resume: 'abc' });
  assert.ok(a.includes('-p') && a.includes('/t/system.md') && !a.includes('--resume'));
  assert.ok(b.includes('--resume') && b.includes('abc') && !b.includes('/t/system.md'));
  assert.ok(![...a, ...b].includes('--fallback-model'));
});
test('命令行参数：JSON 输出、指定模型、关掉全部工具；没给 effort 就不带', () => {
  const a = cliArgs({ model: 'claude-sonnet-5-5', systemFile: '/t/s.md' });
  assert.deepEqual(a.slice(a.indexOf('--output-format'), a.indexOf('--output-format') + 2), ['--output-format', 'json']);
  assert.equal(a[a.indexOf('--model') + 1], 'claude-sonnet-5-5');
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.ok(!a.includes('--effort'));
  const b = cliArgs({ model: 'claude-opus-5-5', effort: 'high', systemFile: '/t/s.md' });
  assert.equal(b[b.indexOf('--effort') + 1], 'high');
});
test('学生的说明带人设和会什么，提到学生不用他、她', () => {
  const s = studentSystem(sc);
  assert.ok(s.includes(sc.persona) && s.includes(sc.know) && s.includes('note'));
  assert.ok(!/[他她]/.test(s.replace(sc.persona, '').replace(sc.know, '')));
});
test('课后测验的学生只拿到人设、会什么、笔记', () => {
  const s = posttestSystem(sc, '第 3 轮：LRU 换最久没用的');
  assert.ok(s.includes('LRU 换最久没用的') && s.includes('不会'));
  assert.ok(!s.includes(sc.misconception) && !s.includes(sc.rubric));
  assert.ok(!/[他她]/.test(s.replace(sc.persona, '').replace(sc.know, '')));
});
test('从回复里取 JSON', () => {
  assert.deepEqual(extractJson('好的。\n```json\n{"say":"嗯","acts":[]}\n```\n'), { say: '嗯', acts: [] });
  assert.deepEqual(extractJson('{"a":{"b":1}} 多余的话'), { a: { b: 1 } });
  assert.equal(extractJson('没有 JSON'), null);
  assert.deepEqual(extractJson('先说一句 {不是 JSON} 再给 {"s":"有 } 括号"}'), { s: '有 } 括号' });
});
test('评卷的说明不透露是哪一版规则', () => {
  const p = graderPrompt({ transcript: 'T', scenario: sc, key: 'K', answers: 'A', metrics: { minutes: 30 } });
  assert.ok(p.includes('T') && p.includes('K') && p.includes('A') && p.includes(sc.misconception));
  assert.ok(!/基线|根本规则|baseline|charter/.test(p));
  assert.ok(!/[他她]/.test(p));
});
test('读评卷的结果；分数不在 0、0.5、1 里的不收', () => {
  const g = parseGrade('```json\n{"post":[{"id":"p1","score":1},{"id":"p2","score":0.5}],"found":6.5,"targeted":3,"onlyGap":true,"contentErrors":0,"verdictAgree":null,"skipped":null,"overall":4,"why":"…"}\n```');
  assert.equal(g.post[1].score, 0.5);
  assert.equal(parseGrade('{"post":[{"id":"p1","score":0.7}],"overall":4,"why":""}'), null);
  assert.equal(parseGrade('乱写'), null);
});
test('评卷结果：总体分要是 1～5 的整数，targeted 只能 1～3 或 null', () => {
  const ok = { post: [{ id: 'p1', score: 1 }], found: null, targeted: null, onlyGap: null, contentErrors: 0, verdictAgree: null, skipped: null, overall: 3, why: 'w' };
  assert.ok(parseGrade(JSON.stringify(ok)));
  assert.equal(parseGrade(JSON.stringify({ ...ok, overall: 6 })), null);
  assert.equal(parseGrade(JSON.stringify({ ...ok, targeted: 4 })), null);
  assert.equal(parseGrade(JSON.stringify({ ...ok, verdictAgree: 1.5 })), null);
});
test('学生的回复：读得出就规范成 say / acts，读不出给原因', () => {
  assert.deepEqual(studentReply('```json\n{"say":"嗯","acts":[{"comp":"q1","value":"B"}],"note":"记"}\n```').value, { say: '嗯', acts: [{ comp: 'q1', value: 'B' }], note: '记' });
  assert.deepEqual(studentReply('{"say":"嗯"}').value, { say: '嗯', acts: [] });
  assert.ok(studentReply('我不知道').error);
  assert.ok(studentReply('{"say":"嗯","acts":"B"}').error);
  assert.ok(studentReply('{"acts":[{"value":"B"}]}').error);
});
test('一整套的表：同类、迁移分开数；没跑完的写停在第几轮', () => {
  const scen = { id: 'x', posttest: [{ id: 'p1', kind: 'near' }, { id: 'p2', kind: 'near' }, { id: 'p3', kind: 'far' }] };
  const r = summaryRow({ scenario: scen, run: { ok: true, costUsd: 1.234 }, metrics: { minutes: 31.5, wastedStops: 2, firstProduceMin: 3.1, longestPassiveMin: 6, produceMin: 4.2 }, grade: { post: [{ id: 'p1', score: 1 }, { id: 'p2', score: 0.5 }, { id: 'p3', score: 0 }], overall: 4 } });
  assert.deepEqual([r.near, r.nearOf, r.far, r.farOf, r.overall], [1.5, 2, 0, 1, 4]);
  const bad = summaryRow({ scenario: scen, run: { ok: false, stoppedAt: 7, stoppedWhat: '学生' } });
  assert.match(bad.failed, /没跑完：停在第 7 轮/);
  const md = summaryMd([r, bad], 'new');
  assert.ok(md.includes('1.5 / 2') && md.includes('没跑完：停在第 7 轮'));
});

// 用假的回复走通一节：不调用模型，确认 teach-run 把 teach-sim 的各命令接上了
const RUN = new URL('../tools/teach-run.mjs', import.meta.url).pathname;
test('假的回复走通一节：两轮老师、学生答对，留下记录、指标、评卷', () => {
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'trun-'));
  const scen = { id: 'mini', subject: '操作系统', pack: { main: { unit: 'LRU' } }, persona: '学过 FIFO', know: '会 FIFO，不会 LRU', misconception: 'm',
    aims: [{ id: 'a1', can: '手算 LRU', proof: '独立做一道' }, { id: 'a2', can: '说出区别', proof: '一句话' }],
    posttest: [{ id: 'p1', q: '换谁', answer: '1', kind: 'near', aim: 'a1' }, { id: 'p2', q: '区别', answer: '看访问', kind: 'far', aim: 'a2' }, { id: 'p3', q: '再换谁', answer: '2', kind: 'near', aim: 'a1' }] };
  fs.writeFileSync(path.join(D, 'sc.json'), JSON.stringify(scen));
  const F = path.join(D, 'fake');
  fs.mkdirSync(F);
  const quiz = (id) => `先做一道。\n\n\`\`\`\`board new id=b${id} title=LRU\n\`\`\`quiz\nid: q${id}\nq: LRU 换出哪一页？\n- [x] 最久没被访问的\n- [ ] 最早调进来的\n\`\`\`\n\`\`\`\`\n`;
  fs.writeFileSync(path.join(F, 't-1.txt'), quiz(1));
  fs.writeFileSync(path.join(F, 't-2.txt'), quiz(2));
  fs.writeFileSync(path.join(F, 's-1.json'), '```json\n{"say":"","acts":[{"comp":"q1","value":"最久没被访问的"}],"note":"LRU 换最久没被访问的"}\n```');
  fs.writeFileSync(path.join(F, 's-2.json'), '{"say":"懂了","acts":[{"comp":"q2","value":"A"}]}');
  fs.writeFileSync(path.join(F, 'post.md'), '## p1\n1\n## p2\n看访问\n## p3\n不会');
  fs.writeFileSync(path.join(F, 'grade.txt'), '{"post":[{"id":"p1","score":1},{"id":"p2","score":1},{"id":"p3","score":0}],"found":null,"targeted":null,"onlyGap":null,"contentErrors":0,"verdictAgree":null,"skipped":null,"overall":3,"why":"假的"}');
  const R = path.join(D, 'run');
  execFileSync('node', [RUN, R, path.join(D, 'sc.json'), '--fake', F], { encoding: 'utf8' });
  const run = JSON.parse(fs.readFileSync(path.join(R, 'run.json'), 'utf8'));
  assert.equal(run.ok, true);
  assert.equal(run.teacherTurns, 2);
  for (const f of ['grade.json', 'metrics.json', 'transcript.md', 'posttest-answers.md', 't-1.txt', 's-2.json']) assert.ok(fs.existsSync(path.join(R, f)), f);
  assert.equal(JSON.parse(fs.readFileSync(path.join(R, 'grade.json'), 'utf8')).overall, 3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(R, 'metrics.json'), 'utf8')).studentRight, 2);
  assert.ok(fs.readFileSync(path.join(R, 'notebook.md'), 'utf8').includes('LRU 换最久没被访问的'));
  fs.rmSync(D, { recursive: true, force: true });
});

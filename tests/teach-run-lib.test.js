import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { cliArgs, studentSystem, posttestSystem, extractJson, graderPrompt, parseGrade, studentReply, summaryRow, summaryMd, cleanEnv, isUsageLimit, projectDirOf, resumeAction } from '../tools/teach-run-lib.mjs';

const sc = { id: 'x', persona: '大三，学过一点操作系统', know: '知道缺页是什么；不知道 LRU', aims: [{ id: 'a1', can: '手算 LRU', proof: '独立做一道' }], misconception: '以为换出最早进来的', rubric: 'r' };

test('第一轮带系统提示词文件，之后带 resume；不带退路模型', () => {
  const a = cliArgs({ model: 'claude-opus-5-5', effort: 'high', systemFile: '/t/system.md' });
  const b = cliArgs({ model: 'claude-opus-5-5', effort: 'high', resume: 'abc' });
  assert.ok(a.includes('-p') && a.includes('/t/system.md') && !a.includes('--resume'));
  assert.ok(b.includes('--resume') && b.includes('abc') && !b.includes('/t/system.md'));
  assert.ok(![...a, ...b].includes('--fallback-model'));
  // 续会话一律分叉：失败的那一次只留在它自己的分叉里
  assert.equal(b[b.indexOf('--resume') + 2], '--fork-session');
  assert.ok(!a.includes('--fork-session'));
  // 隔离：没有工具、没有 MCP、不读设置、不挂技能
  for (const x of [a, b]) {
    assert.equal(x[x.indexOf('--tools') + 1], '');
    assert.equal(x[x.indexOf('--setting-sources') + 1], '');
    assert.ok(x.includes('--strict-mcp-config') && x.includes('--disable-slash-commands'));
  }
});
test('子进程的环境变量只留登录、代理要的，不带开发会话自己的', () => {
  const e = cleanEnv({ PATH: '/bin', HOME: '/root', HTTPS_PROXY: 'p', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CODE_USER_EMAIL: 'e', SESSION_INGRESS_URL: 'u', CLAUDECODE: '1', GH_TOKEN: 't' });
  assert.deepEqual(e, { PATH: '/bin', HOME: '/root', HTTPS_PROXY: 'p' });
});
test('认得出用量上限；会话目录名照命令行的规矩换', () => {
  assert.ok(isUsageLimit("You've hit your usage limit · resets 3am"));
  assert.ok(isUsageLimit('API Error: 429 {"type":"rate_limit_error"}'));
  assert.ok(!isUsageLimit('退出码 1：Invalid model'));
  assert.equal(projectDirOf('/tmp/teach-teacher-a.B_1'), '-tmp-teach-teacher-a-B-1');
});
test('一整套重跑：跑完的跳过，停下、失败的接着跑，别的从头', () => {
  assert.equal(resumeAction(null), 'fresh');
  assert.equal(resumeAction({ ok: true, phase: 'done' }), 'skip');
  assert.equal(resumeAction({ ok: true, phase: 'done' }, 1), 'fresh');
  assert.equal(resumeAction({ ok: false, paused: true }), 'continue');
  assert.equal(resumeAction({ ok: false, failed: true }), 'continue');
  assert.equal(resumeAction({ ok: false }), 'fresh');
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
  // 目录名、计划块开没开可能带着是哪一版规则
  const q = graderPrompt({ transcript: 'T', scenario: sc, key: 'K', answers: 'A', metrics: { run: 'old-rules-x', plan: true, minutes: 30 } });
  assert.ok(!q.includes('old-rules-x') && !q.includes('"plan"') && q.includes('"minutes"'));
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
  assert.match(summaryRow({ scenario: scen, run: { ok: false, paused: true, stoppedAt: 3, stoppedWhat: '第 3 轮老师' } }).failed, /暂停（用量上限）：停在第 3 轮/);
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

/* ---------- 假的命令行：和 claude 同样的参数、同样的 JSON 输出，按会话存历史（--fork-session 分叉、不带它就写回同一个会话） ---------- */
const FAKE_CLI = `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const home = path.dirname(fs.realpathSync(process.argv[1]));
const args = process.argv.slice(2);
const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const model = val('--model'), resume = val('--resume'), fork = args.includes('--fork-session'), sys = val('--system-prompt-file');
const msg = fs.readFileSync(0, 'utf8');
const sdir = path.join(home, 'sessions'); fs.mkdirSync(sdir, { recursive: true });
const load = (id) => JSON.parse(fs.readFileSync(path.join(sdir, id + '.json'), 'utf8'));
const roles = { 'system.md': 'teacher', 'student-system.md': 'student', 'posttest-system.md': 'posttest', 'grader-system.md': 'grader' };
const base = resume ? load(resume) : { role: roles[path.basename(sys)], msgs: [] };
const n = base.msgs.filter((m) => m.u).length + 1;
fs.appendFileSync(path.join(home, 'calls.jsonl'), JSON.stringify({ role: base.role, n, resume: resume || null, fork, history: base.msgs, message: msg }) + '\\n');
const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
const cntF = path.join(home, 'counts.json');
const counts = fs.existsSync(cntF) ? JSON.parse(fs.readFileSync(cntF, 'utf8')) : {};
const rule = (cfg.fail || []).find((f) => f.role === base.role && f.n === n);
const key = base.role + ':' + n;
counts[key] = (counts[key] || 0) + 1; fs.writeFileSync(cntF, JSON.stringify(counts));
const id = resume && !fork ? resume : crypto.randomUUID();
const save = (reply) => fs.writeFileSync(path.join(sdir, id + '.json'), JSON.stringify({ role: base.role, msgs: [...base.msgs, { u: msg }, { a: reply }] }));
if (rule && counts[key] <= (rule.times || 1)) {
  if (rule.kind === 'limit') { process.stdout.write(JSON.stringify({ is_error: true, result: "You've hit your usage limit · resets 3am", session_id: id, total_cost_usd: 0 })); process.exit(1); }
  save('作废的回复 FAILED-REPLY');
  process.stdout.write(JSON.stringify({ is_error: false, result: '作废的回复 FAILED-REPLY', session_id: id, total_cost_usd: 0.01, modelUsage: { 'claude-other-model': {} } }));
  process.exit(0);
}
let reply;
if (base.role === 'teacher') reply = '先做一道。\\n\\n\`\`\`\`board new id=b' + n + ' title=LRU\\n\`\`\`quiz\\nid: q' + n + '\\nq: LRU 换出哪一页？\\n- [x] 最久没被访问的\\n- [ ] 最早调进来的\\n\`\`\`\\n\`\`\`\`\\n';
else if (base.role === 'student') { const m = msg.match(/【选择题 (\\S+)】/); reply = JSON.stringify({ say: '', acts: m ? [{ comp: m[1], value: 'A' }] : [], note: '第 ' + n + ' 题：LRU 换最久没被访问的' }); }
else if (base.role === 'posttest') reply = '## p1\\n1\\n## p2\\n看访问\\n## p3\\n不会';
else reply = JSON.stringify({ post: [{ id: 'p1', score: 1 }, { id: 'p2', score: 1 }, { id: 'p3', score: 0 }], found: null, targeted: null, onlyGap: null, contentErrors: 0, verdictAgree: null, skipped: null, overall: 3, why: '假的' });
save(reply);
process.stdout.write(JSON.stringify({ is_error: false, result: reply, session_id: id, total_cost_usd: 0.01, modelUsage: { [model]: {} } }));
`;
function fakeCli(fail) {
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'trun-cli-'));
  const cli = path.join(D, 'claude-fake.cjs');
  fs.writeFileSync(cli, FAKE_CLI, { mode: 0o755 });
  fs.writeFileSync(path.join(D, 'config.json'), JSON.stringify({ fail }));
  const scen = { id: 'mini', subject: '操作系统', pack: { main: { unit: 'LRU' } }, persona: '学过 FIFO', know: '会 FIFO，不会 LRU', misconception: 'm', minutes: 1.5,
    aims: [{ id: 'a1', can: '手算 LRU', proof: '独立做一道' }, { id: 'a2', can: '说出区别', proof: '一句话' }],
    posttest: [{ id: 'p1', q: '换谁', answer: '1', kind: 'near', aim: 'a1' }, { id: 'p2', q: '区别', answer: '看访问', kind: 'far', aim: 'a2' }, { id: 'p3', q: '再换谁', answer: '2', kind: 'near', aim: 'a1' }] };
  fs.writeFileSync(path.join(D, 'sc.json'), JSON.stringify(scen));
  const calls = () => fs.readFileSync(path.join(D, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const go = (dir, ...extra) => spawnSync('node', [RUN, path.join(D, dir), ...(extra.includes('--continue') ? [] : [path.join(D, 'sc.json')]), '--cli', cli, ...extra], { encoding: 'utf8' });
  return { D, cli, calls, go, setFail: (f) => fs.writeFileSync(path.join(D, 'config.json'), JSON.stringify({ fail: f })) };
}

test('重试不带作废的那一轮：第 2 轮老师第一次模型不对、第二次成了，第 3 轮发出去的上下文里没有作废的回复', () => {
  const f = fakeCli([{ role: 'teacher', n: 2, kind: 'model', times: 1 }]);
  const r = f.go('run');
  assert.equal(r.status, 0, r.stderr);
  const T = f.calls().filter((c) => c.role === 'teacher');
  assert.equal(T.filter((c) => c.n === 2).length, 2); // 第 2 轮发了两次
  const third = T.find((c) => c.n === 3);
  assert.ok(third, '跑到了第 3 轮');
  assert.ok(third.fork && third.resume);
  assert.equal(third.history.length, 4); // 两条老师收到的话、两条成功的回复
  assert.ok(!JSON.stringify(third.history).includes('FAILED-REPLY'));
  assert.ok(T.every((c) => c.n === 1 || c.fork)); // 续会话一律分叉
  const run = JSON.parse(fs.readFileSync(path.join(f.D, 'run', 'run.json'), 'utf8'));
  assert.equal(run.ok, true);
  // 跑完了：这一节的临时目录删掉
  for (const { cwd } of Object.values(run.sessions)) assert.ok(!fs.existsSync(cwd), cwd);
  fs.rmSync(f.D, { recursive: true, force: true });
});

test('撞用量上限：停下不重试、不算失败，--continue 接着跑完，指标和一次跑完的一样', () => {
  const f = fakeCli([]);
  assert.equal(f.go('a').status, 0);
  const once = fs.readFileSync(path.join(f.D, 'a', 'metrics.json'), 'utf8');
  f.setFail([{ role: 'teacher', n: 3, kind: 'limit', times: 99 }]);
  const before = f.calls().length;
  const p = f.go('b');
  assert.equal(p.status, 2, p.stderr);
  const paused = JSON.parse(fs.readFileSync(path.join(f.D, 'b', 'run.json'), 'utf8'));
  assert.deepEqual([paused.ok, paused.paused, paused.failed, paused.phase, paused.next, paused.teacherTurns, paused.stoppedAt], [false, true, false, 'lesson', 'teacher', 2, 3]);
  assert.ok(paused.sessions.teacher.session && paused.sessions.student.session && paused.costUsd > 0);
  assert.equal(f.calls().slice(before).filter((c) => c.role === 'teacher' && c.n === 3).length, 1); // 上限不重试
  assert.ok(fs.existsSync(paused.sessions.teacher.cwd)); // 暂停的不删，接着跑要用
  f.setFail([]);
  const c = f.go('b', '--continue');
  assert.equal(c.status, 0, c.stderr);
  const done = JSON.parse(fs.readFileSync(path.join(f.D, 'b', 'run.json'), 'utf8'));
  assert.deepEqual([done.ok, done.paused, done.phase], [true, false, 'done']);
  assert.equal(fs.readFileSync(path.join(f.D, 'b', 'metrics.json'), 'utf8').replace('"run": "b"', '"run": "a"'), once);
  fs.rmSync(f.D, { recursive: true, force: true });
});

test('别的失败两次都不成：记下停在哪，--continue 从那一步重试', () => {
  const f = fakeCli([{ role: 'grader', n: 1, kind: 'model', times: 2 }]);
  const r = f.go('run');
  assert.equal(r.status, 1);
  const failed = JSON.parse(fs.readFileSync(path.join(f.D, 'run', 'run.json'), 'utf8'));
  assert.deepEqual([failed.ok, failed.failed, failed.phase, failed.stoppedWhat], [false, true, 'grade', '评卷']);
  assert.ok(!fs.existsSync(path.join(f.D, 'run', 'grade.json')));
  const c = f.go('run', '--continue');
  assert.equal(c.status, 0, c.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.D, 'run', 'grade.json'), 'utf8')).overall, 3);
  fs.rmSync(f.D, { recursive: true, force: true });
});

test('--fake 一轮老师都没有不算跑完', () => {
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'trun-'));
  fs.mkdirSync(path.join(D, 'fake'));
  const f = fakeCli([]);
  const r = spawnSync('node', [RUN, path.join(D, 'run'), path.join(f.D, 'sc.json'), '--fake', path.join(D, 'fake')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(D, 'run', 'run.json'), 'utf8')).ok, false);
  fs.rmSync(D, { recursive: true, force: true }); fs.rmSync(f.D, { recursive: true, force: true });
});

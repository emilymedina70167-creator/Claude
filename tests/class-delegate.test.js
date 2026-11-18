// 外部叫页面里的 Claude 来接（需求 R1）：board claude 的写法、什么时候叫、按 can 过滤
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaude, parseClaudeOff, shouldFire, eventsOf, filterOps, handBack, helperPrompt, helperLines, rebuildHelpers } from '../kit/src/class/delegate.js';
import { parseOutput } from '../kit/src/class/protocol.js';

test('读全一条：on / target / turns / see / can / 话', () => {
  const r = parseClaude('id=cl1 on=wrong target=q1 turns=2', 'see: target, board, evidence=last3\ncan: say, mark\n<<<\n学生错了就指出哪一步\n>>>');
  assert.equal(r.op, 'claude');
  assert.equal(r.when, 'on');
  assert.deepEqual(r.on, ['wrong']);
  assert.equal(r.target, 'q1');
  assert.equal(r.turns, 2);
  assert.deepEqual(r.see, { target: true, board: true, evidence: 'last3' });
  assert.deepEqual(r.can, ['say', 'mark']);
  assert.equal(r.prompt, '学生错了就指出哪一步');
  assert.deepEqual(r.to, { kind: 'board' });
});

test('默认：when=now、叫一次、只能 say、只看 target', () => {
  const r = parseClaude('id=cl2', '讲一下这一步');
  assert.equal(r.when, 'now');
  assert.equal(r.turns, 1);
  assert.deepEqual(r.can, ['say']);
  assert.deepEqual(r.see, { target: true });
  assert.equal(r.prompt, '讲一下这一步');
});

test('stuck= 和 to=', () => {
  const r = parseClaude('id=cl3 stuck=90s target=q2 to=db:drafts/cl3', '<<<\nx\n>>>');
  assert.equal(r.stuck, 90000);
  assert.deepEqual(r.on, ['stuck']);
  assert.deepEqual(r.to, { kind: 'db', path: 'drafts/cl3' });
  assert.deepEqual(parseClaude('id=c to=ext', 'x').to, { kind: 'ext' });
});

test('写错的报原因', () => {
  assert.match(parseClaude('', 'x').error, /要写 id/);
  assert.match(parseClaude('id=c on=wrong', 'x').error, /target/);
  assert.match(parseClaude('id=c on=boom target=q', 'x').error, /on= 只认/);
  assert.match(parseClaude('id=c', 'can: fly\n<<<\nx\n>>>').error, /can: 只认/);
  assert.match(parseClaude('id=c', '<<<\nx').error, />>>/);
  assert.match(parseClaude('id=c to=db:a', 'x').error, /路径/);
  assert.match(parseClaude('id=c stuck=3s target=q', 'x').error, /至少 10s/);
  assert.deepEqual(parseClaudeOff('all'), { op: 'claude-off', id: 'all' });
});

test('在 board 块里', () => {
  const t = '````board claude id=cl1 on=wrong target=q1\ncan: say, mark\n<<<\n指出错在哪\n>>>\n````\n````board claude-off id=cl0\n````';
  const ops = parseOutput(t, { final: true }).ops;
  assert.equal(ops[0].op, 'claude');
  assert.equal(ops[0].prompt, '指出错在哪');
  assert.deepEqual(ops[1], { op: 'claude-off', id: 'cl0', body: '' });
});

test('什么时候叫', () => {
  const r = { ...parseClaude('id=c on=wrong|giveup target=q1 turns=2 until=right', 'x'), fired: 0 };
  assert.equal(shouldFire(r, { kind: 'wrong', target: 'q1' }), true);
  assert.equal(shouldFire(r, { kind: 'wrong', target: 'q2' }), false);
  assert.equal(shouldFire(r, { kind: 'submit', target: 'q1' }), false);
  assert.equal(shouldFire(r, { kind: 'wrong', target: 'q1' }, { stopped: true }), false);
  assert.equal(shouldFire({ ...r, fired: 2 }, { kind: 'wrong', target: 'q1' }), false);
  assert.equal(shouldFire({ ...r, gotRight: true }, { kind: 'wrong', target: 'q1' }), false);
  assert.equal(shouldFire({ ...r, off: true }, { kind: 'wrong', target: 'q1' }), false);
  const say = { ...parseClaude('id=s on=say', 'x'), fired: 0 };
  assert.equal(shouldFire(say, { kind: 'say' }), true);
});

test('一条作答是哪几件事', () => {
  assert.deepEqual(eventsOf({ source: 'record', block: 'q1', ok: false }).map((e) => e.kind), ['submit', 'wrong']);
  assert.deepEqual(eventsOf({ source: 'record', block: 'q1', ok: true }).map((e) => e.kind), ['submit', 'right']);
  assert.deepEqual(eventsOf({ source: 'record', block: 'q1', giveup: true }).map((e) => e.kind), ['submit', 'giveup']);
  assert.deepEqual(eventsOf({ source: 'record', block: 'q1', ok: false, liveOnly: true }), []);
});

test('按 can 过滤：越权的不执行、说清楚', () => {
  const ops = [{ op: 'mark', target: 'q1' }, { op: 'new', id: 'b9' }, { op: 'aims' }];
  const r = filterOps(ops, ['say', 'mark']);
  assert.deepEqual(r.allow.map((o) => o.op), ['mark']);
  assert.match(r.refused[0].why, /没给它 new/);
  assert.match(r.refused[1].why, /不归助手写/);
});

test('交回、给它的那一条、写进 ext_out 的行', () => {
  assert.equal(handBack('好的\n[交回] 学生问的是下一章'), '学生问的是下一章');
  assert.equal(handBack('没事'), '');
  const rule = parseClaude('id=c on=wrong target=q1', 'can: say, mark\n<<<\n指出错在哪\n>>>');
  const p = helperPrompt({ rule, ev: { kind: 'wrong', target: 'q1' }, materials: ['题：1+1'], doc: 'DOC' });
  assert.match(p, /指出错在哪/);
  assert.match(p, /q1 上：答错了/);
  assert.match(p, /DOC/);
  assert.doesNotMatch(p, /[他她]/);
  const lines = helperLines({ id: 'c', ev: { kind: 'wrong', target: 'q1' }, text: '看第二行', done: ['mark q1'], refused: [{ op: 'new', id: 'b9', why: '外部这一次没给它 new' }], usage: { bytes: 4096, ms: 3200, tools: 1 } });
  assert.match(lines.join('\n'), /\[助手 c\]（wrong q1） 回了：\n  看第二行/);
  assert.match(lines.join('\n'), /没执行（越权）：new b9/);
  assert.match(lines.join('\n'), /发出 4 KiB，等了 3.2 秒，调了 1 次工具/);
});

test('刷新以后放回：叫过几次、收回过', () => {
  const rule = parseClaude('id=c on=wrong target=q1 turns=3', 'x');
  const h = rebuildHelpers([
    { boardOps: [{ op: 'claude', ok: true, rule }] },
    { kind: 'helper', helper: 'c' },
    { kind: 'helper', helper: 'c' },
  ]);
  assert.equal(h.get('c').fired, 2);
  const h2 = rebuildHelpers([{ boardOps: [{ op: 'claude', ok: true, rule }] }, { boardOps: [{ op: 'claude-off', id: 'all', ok: true }] }]);
  assert.equal(h2.get('c').off, true);
});

// 计算机网络的演示引擎（engines/net4.js）：子网、TCP、滑动窗口
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subnetEngine, tcpEngine, windowEngine, parseIp, ipText } from '../kit/src/engines/net4.js';
import { checkAsk, misreadAnswer, misreadFill, cellOk } from '../kit/src/stepperspec.js';

const go = (eng, f) => { const input = eng.parse(f); return { input, r: eng.run(input) }; };

// 和 stepper.js 一样拿常见错法比（答错了才比）：先猜比题面一样的那一问，quiz 比答案，填表逐格比
const vruns = (eng, input, fields) => eng.variants(input, fields).map((v) => ({ label: v.label, input: v.input, run: eng.run(v.input) }));
const askAns = (a) => (Array.isArray(a.alts) ? a.alts.map((z) => [].concat(z).join(' ')).join(' | ') : [].concat(a.answer).join(' '));
function askDiag(eng, input, ask, given, fields = {}) {
  if (checkAsk(ask, given).ok) return '';
  return misreadAnswer(given, vruns(eng, input, fields).map((v) => { const a = v.run.steps.flatMap((x) => [x.ask, ...(x.asks || [])]).find((y) => y && y.q === ask.q && y.kind === ask.kind); return a ? { label: v.label, answer: askAns(a) } : null; }).filter(Boolean));
}
function quizDiag(eng, input, given, fields = {}) {
  const q = eng.quiz(input, eng.run(input), fields);
  const same = q.type === 'num' ? (a, b) => cellOk({ v: a, num: true }, b) : undefined;
  if (misreadAnswer(given, [{ label: 'ok', answer: String(q.answer) }], same)) return '';
  return misreadAnswer(given, vruns(eng, input, fields).map((v) => ({ label: v.label, answer: String(eng.quiz(v.input, v.run, fields).answer) })), same);
}
const fillAs = (eng, inp, fields = {}) => eng.table(inp, eng.run(inp), fields).rows.map((row) => row.cells.map((c) => [].concat(c.v)[0]));
const fillDiag = (eng, input, values, fields = {}) => misreadFill(eng.table(input, eng.run(input), fields), values, vruns(eng, input, fields).map((v) => ({ label: v.label, table: eng.table(v.input, v.run, fields) })));
const pick = (eng, input, re, fields = {}) => { const v = eng.variants(input, fields).find((x) => re.test(x.label)); assert.ok(v, `没有「${re}」这种错法`); return v; };
const askOf = (r, tag, k = 0) => r.steps.filter((s) => s.ask?.tag === tag)[k].ask;

test('IP 和子网：一个地址、等分、按主机数划分、最长前缀匹配、聚合', () => {
  assert.equal(ipText(parseIp('192.168.10.130')), '192.168.10.130');
  assert.throws(() => parseIp('192.168.1.300'), /0～255/);
  let { input, r } = go(subnetEngine, { ip: '192.168.10.130/26' });
  assert.deepEqual([ipText(r.net), ipText(r.bc), r.n], ['192.168.10.128', '192.168.10.191', 62]);
  assert.equal(subnetEngine.quiz(input, r, { quiz: 'mask' }).answer, '255.255.255.192');
  assert.ok(checkAsk(r.steps.find((s) => s.ask?.tag === 'net').ask, '192.168.10.128').ok);
  assert.deepEqual(go(subnetEngine, { split: '192.168.1.0/24', into: '4' }).r.subs.map((s) => `${ipText(s.ip)}/${s.len}`), ['192.168.1.0/26', '192.168.1.64/26', '192.168.1.128/26', '192.168.1.192/26']);
  assert.deepEqual(go(subnetEngine, { split: '192.168.1.0/24', hosts: '20, 60, 10' }).r.subs.map((s) => `${ipText(s.ip)}/${s.len}`), ['192.168.1.0/26', '192.168.1.64/27', '192.168.1.96/28']);
  assert.throws(() => subnetEngine.run(subnetEngine.parse({ split: '192.168.1.0/26', hosts: '60, 30' })), /地址不够/);
  ({ input, r } = go(subnetEngine, { table: '192.168.1.0/24 -> R1, 192.168.1.128/25 -> R2, 0.0.0.0/0 -> R3', dst: '192.168.1.200' }));
  assert.equal(r.hop, 'R2');
  assert.equal(subnetEngine.quiz(input, r, {}).answer, 'R2');
  assert.equal(go(subnetEngine, { table: '10.0.0.0/8 -> A', dst: '192.168.1.1' }).r.hop, null);
  assert.equal(`${ipText(go(subnetEngine, { aggregate: '212.56.132.0/24, 212.56.133.0/24, 212.56.134.0/24, 212.56.135.0/24' }).r.agg.ip)}`, '212.56.132.0');
  for (const f of [{ ip: '10.1.2.3/8' }, { split: '10.0.0.0/24', into: '2' }, { aggregate: '10.0.0.0/24 10.0.1.0/24' }]) {
    const x = go(subnetEngine, f);
    for (const s of x.r.steps) assert.ok(subnetEngine.view(s.view, x.input).length > 0);
  }
});

test('TCP 拥塞控制：慢开始到 ssthresh、拥塞避免、3 个重复确认（Reno / Tahoe）、超时', () => {
  const c = (f) => go(tcpEngine, f).r.series.map((x) => x.cwnd).join(' ');
  assert.equal(c({ ssthresh: '16', rounds: '22', events: '3dup@12, timeout@16' }), '1 2 4 8 16 17 18 19 20 21 22 23 11 12 13 14 1 2 4 7 8 9');
  assert.equal(c({ ssthresh: '12', rounds: '8' }), '1 2 4 8 12 13 14 15', '翻倍不超过 ssthresh');
  assert.equal(c({ ssthresh: '16', rounds: '16', events: '3dup@12', variant: 'tahoe' }), '1 2 4 8 16 17 18 19 20 21 22 23 1 2 4 8');
  const { input, r } = go(tcpEngine, { ssthresh: '16', rounds: '10' });
  assert.equal(tcpEngine.quiz(input, r, { at: '6' }).answer, '17');
  for (const s of r.steps) assert.match(tcpEngine.view(s.view, input), /cn-cwnd/);
  assert.throws(() => tcpEngine.parse({ ssthresh: '16', events: 'lost@3' }), /events/);
});

test('TCP 三次握手、四次挥手的序号和确认号', () => {
  const h = go(tcpEngine, { handshake: 'x=100, y=300' });
  assert.deepEqual(h.r.steps.filter((s) => s.ask).map((s) => [s.ask.tag, s.ask.answer]), [['ack', 101], ['seq', 101]]);
  const c = go(tcpEngine, { close: 'u=500, v=800, w=900' });
  assert.deepEqual(c.r.steps.filter((s) => s.ask).map((s) => s.ask.answer), [501, 901]);
  for (const s of c.r.steps) assert.match(tcpEngine.view(s.view, c.input), /cn-seq/);
  assert.throws(() => tcpEngine.parse({ handshake: 'x=1' }), /y=/);
});

test('滑动窗口：GBN 超时后从出错的那一帧起全部重传；SR 只重传超时的；确认丢了靠累积确认', () => {
  const gbn = go(windowEngine, { proto: 'gbn', frames: '6', window: '4', lost: '2' });
  assert.equal(gbn.r.total, 10);
  assert.equal(gbn.r.steps.find((s) => s.ask?.tag === 'resend').ask.answer, '2 3 4 5');
  assert.equal(windowEngine.quiz(gbn.input, gbn.r).answer, '10');
  const sr = go(windowEngine, { proto: 'sr', frames: '6', window: '4', lost: '2' });
  assert.equal(sr.r.total, 7);
  assert.equal(sr.r.steps.find((s) => s.ask?.tag === 'resend').ask.answer, '2');
  assert.match(sr.r.steps.map((s) => s.msg).join('\n'), /连同缓存的 3、4、5 号一起交给上层/);
  assert.equal(go(windowEngine, { proto: 'sw', frames: '3', lost: '1' }).r.total, 4);
  assert.equal(go(windowEngine, { proto: 'gbn', frames: '5', window: '3', acklost: '1' }).r.total, 5, 'ACK1 丢了，ACK2 累积确认，不用重传');
  for (const s of gbn.r.steps) assert.match(windowEngine.view(s.view, gbn.input), /cn-win/);
  assert.throws(() => windowEngine.parse({ proto: 'gbn', frames: '4', lost: '9' }), /帧号/);
  assert.throws(() => windowEngine.parse({ proto: 'gbn', timeout: '3' }), /超时/);
});

test('子网的常见错法：主机数没减 2、广播地址只改最后一段、旧规定的子网号、广播地址多 1、没从大到小分', () => {
  // 一个地址：192.168.10.130/26 → 主机数 62，广播 192.168.10.191
  const ip = go(subnetEngine, { ip: '192.168.10.130/26' });
  const no2 = pick(subnetEngine, ip.input, /主机数忘了减 2/), last = pick(subnetEngine, ip.input, /最后一段写成了 255/);
  assert.equal(askDiag(subnetEngine, ip.input, askOf(ip.r, 'hosts'), '64'), no2.label);
  assert.equal(askDiag(subnetEngine, ip.input, askOf(ip.r, 'hosts'), '62'), '');
  assert.equal(askDiag(subnetEngine, ip.input, askOf(ip.r, 'bcast'), '192.168.10.255'), last.label);
  assert.equal(quizDiag(subnetEngine, ip.input, '64', { quiz: 'hosts' }), no2.label);
  assert.equal(fillDiag(subnetEngine, ip.input, fillAs(subnetEngine, last.input)), last.label);
  assert.equal(fillDiag(subnetEngine, ip.input, fillAs(subnetEngine, ip.input)), '');
  // /20 也认得出（第三段要写成二进制）；/24 的广播本来就是 .255，这种错法不列
  const ip20 = go(subnetEngine, { ip: '172.16.20.5/20' });
  assert.equal(quizDiag(subnetEngine, ip20.input, '172.16.16.255', { quiz: 'bcast' }), pick(subnetEngine, ip20.input, /最后一段/, { quiz: 'bcast' }).label);
  assert.ok(!subnetEngine.variants(go(subnetEngine, { ip: '192.168.1.5/24' }).input, {}).some((v) => /最后一段/.test(v.label)));
  // 等分：旧规定（子网号不能全 0 全 1）分 4 个要借 3 位，第 1 个子网是 .32/27
  const eq = go(subnetEngine, { split: '192.168.1.0/24', into: '4' });
  const old = pick(subnetEngine, eq.input, /旧规定/), plus1 = pick(subnetEngine, eq.input, /广播地址多算了 1/);
  assert.equal(askDiag(subnetEngine, eq.input, askOf(eq.r, 'subnet'), '192.168.1.32'), old.label);
  assert.equal(askDiag(subnetEngine, eq.input, askOf(eq.r, 'subnet'), '192.168.1.0'), '');
  assert.equal(fillDiag(subnetEngine, eq.input, fillAs(subnetEngine, old.input)), old.label);
  assert.equal(fillDiag(subnetEngine, eq.input, fillAs(subnetEngine, plus1.input)), plus1.label);
  assert.equal(fillDiag(subnetEngine, eq.input, fillAs(subnetEngine, eq.input)), '');
  // 按主机数：63 台要 /25（2^6 − 2 = 62 不够）；不减 2 就成了 /26
  const v1 = go(subnetEngine, { split: '192.168.1.0/24', hosts: '63, 30' });
  assert.equal(askDiag(subnetEngine, v1.input, askOf(v1.r, 'subnet'), '192.168.1.0/26'), pick(subnetEngine, v1.input, /忘了减 2/).label);
  const v2 = go(subnetEngine, { split: '192.168.1.0/24', hosts: '20, 60, 10' });
  assert.equal(askDiag(subnetEngine, v2.input, askOf(v2.r, 'subnet', 1), '192.168.1.0/27'), pick(subnetEngine, v2.input, /按题目给的顺序/).label);
  assert.equal(fillDiag(subnetEngine, v2.input, fillAs(subnetEngine, pick(subnetEngine, v2.input, /广播地址多算了 1/).input)), pick(subnetEngine, v2.input, /广播地址多算了 1/).label);
  assert.ok(!subnetEngine.variants(v2.input, {}).some((v) => /忘了减 2/.test(v.label)), '20、60、10 都不在 2 的幂边上，不减 2 也一样，不列');
});

test('最长前缀匹配、路由聚合的常见错法：第一个匹配、按十进制整段比、前缀多数 / 少数一位、网络地址没清 0', () => {
  const T = '192.168.1.0/24 -> R1, 192.168.1.128/25 -> R2, 0.0.0.0/0 -> R3';
  const a = go(subnetEngine, { table: T, dst: '192.168.1.200' });
  const up = pick(subnetEngine, a.input, /点分十进制整段比/);
  assert.equal(askDiag(subnetEngine, a.input, askOf(a.r, 'match', 1), '不匹配'), up.label, '200 ≠ 128 就说不匹配：/25 只比第四段的最高位');
  assert.equal(askDiag(subnetEngine, a.input, askOf(a.r, 'match', 1), '匹配'), '');
  assert.equal(askDiag(subnetEngine, a.input, askOf(a.r, 'hop'), '1'), '像是用了第一个匹配的表项，没比前缀长短');
  assert.equal(fillDiag(subnetEngine, a.input, fillAs(subnetEngine, up.input)), up.label);
  assert.equal(fillDiag(subnetEngine, a.input, fillAs(subnetEngine, a.input)), '');
  const b = go(subnetEngine, { table: T, dst: '192.168.1.100' });
  const down = pick(subnetEngine, b.input, /不满 8 位的那一段没比/);
  assert.equal(askDiag(subnetEngine, b.input, askOf(b.r, 'match', 1), '匹配'), down.label);
  assert.equal(quizDiag(subnetEngine, b.input, 'R2'), down.label);
  assert.equal(quizDiag(subnetEngine, b.input, 'R1'), '');
  // 聚合 172.18.129/130/132/133.0/24 → 172.18.128.0/21
  const g = go(subnetEngine, { aggregate: '172.18.129.0/24, 172.18.130.0/24, 172.18.132.0/24, 172.18.133.0/24' });
  const ask = askOf(g.r, 'agg');
  assert.equal(ask.answer, '172.18.128.0/21');
  assert.equal(askDiag(subnetEngine, g.input, ask, '172.18.129.0/21'), pick(subnetEngine, g.input, /没把共同前缀后面的位清 0/).label);
  assert.equal(askDiag(subnetEngine, g.input, ask, '172.18.128.0/22'), pick(subnetEngine, g.input, /多数了一位/).label);
  assert.equal(askDiag(subnetEngine, g.input, ask, '172.18.128.0/20'), pick(subnetEngine, g.input, /少数了一位/).label);
  assert.equal(askDiag(subnetEngine, g.input, ask, '172.18.128.0/21'), '');
  assert.equal(fillDiag(subnetEngine, g.input, fillAs(subnetEngine, pick(subnetEngine, g.input, /多数了一位/).input)), pick(subnetEngine, g.input, /多数了一位/).label);
  // 第一个网络的地址本来就对齐：「没清 0」和对的一样，不列
  assert.ok(!subnetEngine.variants(go(subnetEngine, { aggregate: '212.56.132.0/24, 212.56.133.0/24, 212.56.134.0/24, 212.56.135.0/24' }).input, {}).some((v) => /清 0/.test(v.label)));
});

test('TCP 拥塞控制的常见错法：慢开始越过 ssthresh、ssthresh 自己减半、超时也快恢复', () => {
  const c = go(tcpEngine, { ssthresh: '12', rounds: '8' });
  const cap = pick(tcpEngine, c.input, /越过了 ssthresh/);
  assert.equal(askDiag(tcpEngine, c.input, askOf(c.r, 'cwnd', 4), '16'), cap.label);
  assert.equal(askDiag(tcpEngine, c.input, askOf(c.r, 'cwnd', 4), '12'), '');
  assert.equal(quizDiag(tcpEngine, c.input, '19', { at: '8' }), cap.label);
  assert.deepEqual(tcpEngine.variants(go(tcpEngine, { ssthresh: '16', rounds: '8' }).input, {}), [], 'ssthresh 正好是 2 的幂、又没有拥塞：怎么错都一样');
  // 第 12 轮 cwnd = 23 收到 3 个重复确认：ssthresh = 11（不是 16 / 2 = 8）；第 16 轮超时：cwnd 回到 1（不是 7）
  const e = go(tcpEngine, { ssthresh: '16', rounds: '22', events: '3dup@12, timeout@16' });
  const half = pick(tcpEngine, e.input, /原来的 ssthresh 减半/), fast = pick(tcpEngine, e.input, /超时也做了快恢复/);
  assert.equal(askDiag(tcpEngine, e.input, askOf(e.r, 'cwnd', 12), '8'), half.label);
  assert.equal(askDiag(tcpEngine, e.input, askOf(e.r, 'cwnd', 12), '1'), '像是按 Tahoe 算的（3 个重复确认也让 cwnd 回到 1）');
  assert.equal(askDiag(tcpEngine, e.input, askOf(e.r, 'cwnd', 16), '7'), fast.label);
  assert.equal(askDiag(tcpEngine, e.input, askOf(e.r, 'cwnd', 16), '1'), '');
  assert.equal(fillDiag(tcpEngine, e.input, fillAs(tcpEngine, half.input)), half.label);
  assert.equal(fillDiag(tcpEngine, e.input, fillAs(tcpEngine, e.input)), '');
  assert.ok(!tcpEngine.variants(go(tcpEngine, { ssthresh: '16', rounds: '16', events: '3dup@12', variant: 'tahoe' }).input, {}).some((v) => /超时也做了快恢复/.test(v.label)));
});

test('滑动窗口的常见错法：GBN 只重传超时的那一帧、SR 把后面的也重传、累积确认和单独确认弄混', () => {
  const gbn = go(windowEngine, { proto: 'gbn', frames: '6', window: '4', lost: '2' });
  const one = pick(windowEngine, gbn.input, /只重传了超时的那一帧/);
  assert.equal(askDiag(windowEngine, gbn.input, askOf(gbn.r, 'resend'), '2'), one.label, '换成 SR 算的那一问题面不一样，对不上；这一种对得上');
  assert.equal(askDiag(windowEngine, gbn.input, askOf(gbn.r, 'resend'), '2 3 4 5'), '');
  assert.equal(quizDiag(windowEngine, gbn.input, '7'), '像是按选择重传协议（SR）算的');
  const sr = go(windowEngine, { proto: 'sr', frames: '6', window: '4', lost: '2' });
  assert.equal(askDiag(windowEngine, sr.input, askOf(sr.r, 'resend'), '2 3 4 5'), pick(windowEngine, sr.input, /后面已经发出的也重传了/).label);
  assert.equal(askDiag(windowEngine, sr.input, askOf(sr.r, 'resend'), '2'), '');
  // 确认帧丢了：GBN 靠累积确认不用重传（发 5 个）；以为要重传就是 8 个
  const ga = go(windowEngine, { proto: 'gbn', frames: '5', window: '3', acklost: '1' });
  const noCum = pick(windowEngine, ga.input, /没用上累积确认/);
  assert.equal(quizDiag(windowEngine, ga.input, '8'), noCum.label);
  assert.equal(fillDiag(windowEngine, ga.input, fillAs(windowEngine, noCum.input)), noCum.label);
  assert.equal(quizDiag(windowEngine, ga.input, '5'), '');
  // SR 的确认丢了要重传那一帧（6 个）；当成累积确认就是 5 个
  const sa = go(windowEngine, { proto: 'sr', frames: '5', window: '3', acklost: '1' });
  assert.equal(quizDiag(windowEngine, sa.input, '5'), pick(windowEngine, sa.input, /当成了累积确认/).label);
  assert.equal(fillDiag(windowEngine, sa.input, fillAs(windowEngine, sa.input)), '');
  // 停止-等待：确认丢了也要重传
  const sw = go(windowEngine, { proto: 'sw', frames: '3', acklost: '1' });
  assert.equal(quizDiag(windowEngine, sw.input, '3'), pick(windowEngine, sw.input, /确认帧丢了就不用重传/).label);
  assert.equal(quizDiag(windowEngine, sw.input, '4'), '');
  assert.deepEqual(windowEngine.variants(go(windowEngine, { proto: 'sw', frames: '3', lost: '1' }).input, {}), []);
});

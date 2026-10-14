// 计算机网络的演示引擎（engines/net4.js）：子网、TCP、滑动窗口
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subnetEngine, tcpEngine, windowEngine, parseIp, ipText } from '../kit/src/engines/net4.js';
import { checkAsk } from '../kit/src/stepperspec.js';

const go = (eng, f) => { const input = eng.parse(f); return { input, r: eng.run(input) }; };

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

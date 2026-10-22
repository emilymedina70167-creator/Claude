// 计网（二）：csma、switch（kit/src/engines/netmac.js）、dv（netdv.js）、util、rtt（netperf.js）和量的写法（netunits.js）。
// 答案和王道 / 408 真题 / 教材的例子对一遍（出处写在每个测试里）；每种错法都要和对的算得不一样；说明草稿和示例页的例子照抄就能用。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFields } from '../kit/src/parse.js';
import { resolveAsks, commonSpec, trackFields, fillSpec, fillOrder, checkAsk } from '../kit/src/stepperspec.js';
import { csmaEngine, switchEngine } from '../kit/src/engines/netmac.js';
import { dvEngine } from '../kit/src/engines/netdv.js';
import { utilEngine, rttEngine } from '../kit/src/engines/netperf.js';
import { parseRate, parseBits, parseTime, parseDist, parseSpeed, parsePercent, timeText, ansText } from '../kit/src/engines/netunits.js';

const ENGINES = { csma: csmaEngine, switch: switchEngine, dv: dvEngine, util: utilEngine, rtt: rttEngine };
const go = (e, f) => { const input = e.parse(f); return { input, r: e.run(input) }; };
const asks = (r) => r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter(Boolean);
const ask = (r, tag) => asks(r).filter((a) => a.tag === tag);
const mistakes = (e, input) => e.variants(input).map((v) => v.input.mistake);

test('量的写法：数据率、长度、时间、距离、传播速率、百分数', () => {
  assert.equal(parseRate('10Mb/s'), 1e7);
  assert.equal(parseRate('100Mbps'), 1e8);
  assert.equal(parseRate('128kb/s'), 128000);
  assert.equal(parseRate('2MB/s'), 1.6e7, 'B 是字节');
  assert.equal(parseRate('10^7 b/s'), 1e7);
  assert.equal(parseBits('1518B'), 12144);
  assert.equal(parseBits('48', 'jam', { bare: 'bit' }), 48);
  assert.equal(parseTime('51.2μs'), 51.2e-6);
  assert.equal(parseTime('51.2us'), 51.2e-6);
  assert.equal(parseTime('270ms'), 0.27);
  assert.equal(parseDist('2km'), 2000);
  for (const v of ['200m/μs', '2×10^8 m/s', '2*10^8m/s', '200000km/s', '2×10⁸m/s', '2e8 m/s']) assert.equal(parseSpeed(v), 2e8, v);
  assert.equal(parsePercent('80%'), 0.8);
  assert.equal(parsePercent('0.4'), 0.4);
  assert.throws(() => parseRate('10M'), /rate:.*10Mb\/s/);
  assert.throws(() => parseBits('100', 'frame: 帧长'), /要写单位/);
  assert.throws(() => parseTime('5', 'delay:'), /要写单位/);
  // 写成人看的：挑整齐的单位（1214.4μs 不写成 1.2144ms）；答案留四位小数
  assert.equal(timeText(1.2144e-3), '1214.4μs');
  assert.equal(timeText(0.0625), '62.5ms');
  assert.equal(ansText(79.93605115907274), '79.9361');
});

test('csma：2010 年 47 题（10Mb/s、2km、200000km/s）：τ = 10μs，最短帧长 200bit；同时发 10μs、最晚 20μs 都检测到冲突', () => {
  const f = { rate: '10Mb/s', dist: '2km', v: '200000km/s' };
  const a = go(csmaEngine, { ...f, bsend: '0' });
  assert.equal(ask(a.r, 'tau')[0].answer, 10);
  assert.equal(ask(a.r, 'period')[0].answer, 20);
  assert.equal(ask(a.r, 'minframe')[0].answer, 200);
  assert.equal(ask(a.r, 'bdetect')[0].answer, 10);
  assert.equal(ask(a.r, 'detect')[0].answer, 10);
  const b = go(csmaEngine, { ...f, bsend: 'last' });
  assert.equal(ask(b.r, 'detect')[0].answer, 20);
  assert.equal(csmaEngine.quiz(b.input, b.r).answer, '20');
  // 一般的：B 在 8μs 发，相遇在 9μs，A 在 18μs 检测到
  const c = go(csmaEngine, { ...f, bsend: '8μs' });
  assert.deepEqual(['meet', 'bdetect', 'detect'].map((t) => ask(c.r, t)[0].answer), [9, 10, 18]);
  assert.deepEqual(mistakes(csmaEngine, c.input), ['oneTau', 'bytes', 'meet', 'always2']);
  // B 在 τ 以后才发：听到忙，不冲突
  const d = go(csmaEngine, { ...f, bsend: '12μs' });
  assert.equal(ask(d.r, 'idle')[0].answer, '忙，B 推迟发送');
  assert.equal(ask(d.r, 'detect').length, 0);
});

test('csma：2019 年（100Mb/s、最短帧长 128B）单程传播时延最多 5.12μs；2009 年 37 题（1Gb/s，帧长少 800bit）距离减少 80m', () => {
  const a = go(csmaEngine, { rate: '100Mb/s', minframe: '128B' });
  assert.equal(ask(a.r, 'period')[0].answer, 10.24);
  assert.equal(ask(a.r, 'tau')[0].answer, 5.12);
  assert.deepEqual(mistakes(csmaEngine, a.input), ['oneTau', 'bytes']);
  const b = go(csmaEngine, { rate: '1Gb/s', v: '200000km/s', dframe: '-800bit' });
  const q = ask(b.r, 'dchange')[0];
  assert.equal(q.answer, '减少 80m');
  assert.ok(q.choices.includes('减少 160m') && q.choices.includes('增加 80m'));
  assert.equal(csmaEngine.quiz(b.input, b.r).answer, '-80');
  assert.deepEqual(mistakes(csmaEngine, b.input), ['oneTau', 'sign']);
});

test('csma：二进制指数退避（王道：11 次碰撞以后 r 在 0～1023 里选；r × 争用期）', () => {
  const a = go(csmaEngine, { rate: '10Mb/s', slot: '51.2μs', retry: '11' });
  assert.equal(ask(a.r, 'range')[0].answer, 1023);
  assert.equal(ask(a.r, 'k')[0].answer, 10);
  assert.equal(ask(a.r, 'maxwait')[0].answer, 52377.6);
  assert.deepEqual(mistakes(csmaEngine, a.input), ['noCap', 'range2k']);
  // 默认基本退避时间是争用期 2τ = 51.2μs：第 2 次重传取到 r = 3，推迟 153.6μs
  const b = go(csmaEngine, { rate: '10Mb/s', delay: '25.6μs', r: '1, 3' });
  assert.deepEqual(ask(b.r, 'wait').map((x) => x.answer), [51.2, 153.6]);
  assert.ok(mistakes(csmaEngine, b.input).includes('tauSlot'));
  assert.throws(() => csmaEngine.parse({ rate: '10Mb/s', delay: '25.6μs', r: '4' }), /r 只能在 0～1/);
  assert.throws(() => csmaEngine.parse({ rate: '10Mb/s', slot: '51.2μs', retry: '16', r: '1, 2' }), /最多 16 次/);
  assert.throws(() => csmaEngine.parse({ dist: '2km' }), /rate:/);
  assert.throws(() => csmaEngine.parse({ rate: '10Mb/s', r: '1' }), /基本退避时间/);
});

test('switch：2014 年（a1 → c1，c1 → a1，原表里有 b1 在端口 2）：两帧分别从 {2,3} 和 {1} 转发', () => {
  const { input, r } = go(switchEngine, { hosts: 'a1 1, b1 2, c1 3', init: 'b1 2', frames: 'a1→c1, c1→a1' });
  assert.deepEqual(r.log.map((x) => x.out), [[2, 3], [1]]);
  assert.deepEqual(ask(r, 'out').map((x) => x.answer), ['端口 2、3', '端口 1']);
  assert.ok(ask(r, 'out').every((x) => x.choices.includes(x.answer)));
  assert.equal(switchEngine.quiz(input, r).answer, '1 2 3');
  // 在图上点：点的是 data-pick 的端口号
  const pick = ask(r, 'port')[0];
  assert.ok(checkAsk(pick, ['3', '2']).ok);
  assert.deepEqual(mistakes(switchEngine, input), ['noLearn', 'floodAll']);
});

test('switch：同一个集线器上的两台互发——过滤；广播扩散；第二次只走一个端口', () => {
  const { input, r } = go(switchEngine, { hosts: 'A 1, B 1, C 2, D 3', frames: 'A→B, B→A, C→*, D→C, A→D' });
  assert.deepEqual(r.log.map((x) => x.how), ['flood', 'filter', 'bcast', 'known', 'known']);
  assert.deepEqual(r.log.map((x) => x.out), [[2, 3], [], [1, 3], [2], [3]]);
  assert.equal(ask(r, 'learn')[4].answer, '什么也不用记');
  const t = switchEngine.table(input, r);
  assert.deepEqual(t.rows[1].cells.map((c) => c.v), ['', '', '', '√']);
  assert.deepEqual(mistakes(switchEngine, input), ['noLearn', 'floodAll', 'noFilter']);
  assert.throws(() => switchEngine.parse({ hosts: 'A 1, B 2', frames: 'A→E' }), /不在 hosts:/);
  assert.throws(() => switchEngine.parse({ hosts: 'A 1, B 2', frames: 'A B' }), /源→目的/);
});

test('dv：谢希仁 4-38（王道 RIP 例题）：B 收到 C 的报文，更新后 N1 7 A、N2 5 C、N3 9 C、N6 5 C、N8 4 E、N9 4 F', () => {
  const { input, r } = go(dvEngine, { router: 'B', table: 'N1 7 A, N2 2 C, N6 8 F, N8 4 E, N9 4 F', from: 'C', recv: 'N2 4, N3 8, N6 4, N8 3, N9 5' });
  assert.deepEqual(r.final.map((x) => `${x.dest} ${x.d} ${x.hop}`), ['N1 7 A', 'N2 5 C', 'N3 9 C', 'N6 5 C', 'N8 4 E', 'N9 4 F']);
  assert.deepEqual(ask(r, 'rule').map((x) => x.answer), ['下一跳相同，替换', '添加新的一项', '经它更短，替换', '不变', '不变']);
  assert.equal(dvEngine.quiz(input, r).answer, '7 5 9 5 4 4');
  assert.deepEqual(mistakes(dvEngine, input), ['noPlus', 'noSame', 'always']);
  // 谢希仁 4-37：R6 收到 R4 的报文 → Net1 4 R4、Net2 5 R4、Net3 2 R4
  const b = go(dvEngine, { router: 'R6', table: 'Net2 3 R4, Net3 4 R5', from: 'R4', recv: 'Net1 3, Net2 4, Net3 1' });
  assert.deepEqual(b.r.final.map((x) => `${x.dest} ${x.d} ${x.hop}`), ['Net1 4 R4', 'Net2 5 R4', 'Net3 2 R4']);
  // 2010 年：收到 <net1, 16>（不可达），经它到不了，距离还是 16
  const c = go(dvEngine, { router: 'R1', table: 'net1 3 R2', from: 'R2', recv: 'net1 16' });
  assert.equal(c.r.final[0].d, 16);
  assert.throws(() => dvEngine.parse({ table: 'N1 7 A', recv: 'N1 2' }), /from:/);
  assert.throws(() => dvEngine.parse({ table: 'N1 7', from: 'C', recv: 'N1 2' }), /目的网络 距离 下一跳/);
});

test('dv：Tanenbaum（王道习题）：C 收到 B、D、E 的向量，延迟 6、3、5 → 新表 (11, 6, 0, 3, 5, 8)，下一跳 B B - D E B', () => {
  const { input, r } = go(dvEngine, { router: 'C', vectors: 'B (5,0,8,12,6,2), D (16,12,6,0,9,10), E (7,6,3,9,0,4)', cost: 'B 6, D 3, E 5' });
  assert.deepEqual(r.best.map((x) => x.d), [11, 6, 0, 3, 5, 8]);
  assert.deepEqual(r.best.map((x) => x.hops.join('')), ['B', 'B', '', 'D', 'E', 'B']);
  assert.equal(dvEngine.quiz(input, r).answer, '11 6 0 3 5 8');
  assert.deepEqual(mistakes(dvEngine, input), ['noCost', 'greedy']);
  assert.throws(() => dvEngine.parse({ router: 'C', vectors: 'B (1,2), D (1,2,3)', cost: 'B 1, D 1' }), /要一样多/);
  assert.throws(() => dvEngine.parse({ router: 'C', vectors: 'B (1,2,3)', cost: 'D 1' }), /没写到 B/);
});

test('dv：一轮轮交换；A-B-C 的 B–C 断了以后 A 到 C 2、2、4、4……一直数到 16（坏消息传得慢）', () => {
  const { input, r } = go(dvEngine, { links: 'A-B, B-C', cut: 'B-C', watch: 'A' });
  const seq = r.rounds.filter((x) => x.label.startsWith('断后')).map((x) => x.table.get('A').get('C').d);
  assert.deepEqual(seq.slice(0, 6), [2, 4, 4, 6, 6, 8]);
  assert.equal(seq.at(-1), 16);
  assert.equal(dvEngine.quiz(input, r).answer, '1 16');
  assert.deepEqual(mistakes(dvEngine, input), ['instant']);
  // 有别的路（A-C 5）：涨到 5 就停，改走 A-C
  const b = go(dvEngine, { links: 'A-B 1, B-C 1, A-C 5', cut: 'B-C' });
  assert.equal(b.r.final.at(-1).d, 5);
  assert.equal(b.r.final.at(-1).hop, 'C');
  assert.deepEqual(mistakes(dvEngine, b.input), ['instant', 'hop']);
  // 没断链：四台路由器两轮收敛，A 到 D 从 7 变成 4（经 B）
  const c = go(dvEngine, { links: 'A-B 1, B-C 2, C-D 1, A-D 7' });
  assert.deepEqual(c.r.final.map((x) => x.d), [1, 3, 4]);
  assert.equal(c.r.rounds.length, 4);
  assert.deepEqual(mistakes(dvEngine, c.input), ['oneRound', 'hop']);
  assert.throws(() => dvEngine.parse({ links: 'A-B', cut: 'A-C' }), /cut:/);
  assert.throws(() => dvEngine.parse({ links: 'A-B', table: 'N1 1 A' }), /只写一种/);
});

test('util：2014 年（GBN 窗口 1000、帧 1000B、100Mb/s、单程 50ms）最大平均数据传输速率约 80Mb/s', () => {
  const { input, r } = go(utilEngine, { proto: 'gbn', window: '1000', frame: '1000B', rate: '100Mb/s', delay: '50ms' });
  assert.equal(ask(r, 'tframe')[0].answer, 80);
  assert.equal(ask(r, 'cycle')[0].answer, 100.08);
  assert.ok(Math.abs(ask(r, 'thru')[0].answer - 79.936) < 0.001);
  assert.ok(checkAsk(ask(r, 'thru')[0], '79.94').ok);
  assert.deepEqual(mistakes(utilEngine, input), ['oneWay', 'noTf']);
});

test('util：2015 年（128kb/s、单程 250ms、帧 1000B、利用率 ≥ 80%）窗口至少 8，帧序号至少 4 位；2012 年（16kb/s、270ms、128B、确认帧等长）窗口 11、4 位', () => {
  const a = go(utilEngine, { proto: 'gbn', frame: '1000B', rate: '128kb/s', delay: '250ms', target: '80%' });
  assert.equal(ask(a.r, 'cycle')[0].answer, 562.5);
  assert.equal(ask(a.r, 'wmin')[0].answer, 8);
  assert.equal(ask(a.r, 'seqbits')[0].answer, 4);
  assert.equal(utilEngine.quiz(a.input, a.r).answer, '4');
  const b = go(utilEngine, { proto: 'gbn', frame: '128B', ack: 'same', rate: '16kb/s', delay: '270ms' });
  assert.equal(ask(b.r, 'cycle')[0].answer, 668);
  assert.equal(ask(b.r, 'wmin')[0].answer, 11);
  assert.equal(ask(b.r, 'seqbits')[0].answer, 4);
  assert.deepEqual(mistakes(utilEngine, b.input), ['oneWay', 'noTf', 'noAck', 'bitsSwap']);
  // SR 3 位序号：发送窗口最大 4（GBN 是 7）
  const c = go(utilEngine, { proto: 'sr', seqbits: '3', frame: '1000B', rate: '1Mb/s', delay: '10ms' });
  assert.equal(ask(c.r, 'window')[0].answer, 4);
  assert.equal(ask(c.r, 'u')[0].answer, 100);
  assert.ok(mistakes(utilEngine, c.input).includes('noCap'));
});

test('util：2018 年（停止-等待、3kb/s、单程 200ms、利用率 40%）帧长 800 比特；2020 年（数据帧、确认帧都 1000B、10kb/s、200ms）利用率 40%；2010 年 47 题（2）有效数据传输速率约 9.33Mb/s', () => {
  const a = go(utilEngine, { rate: '3kb/s', delay: '200ms', target: '40%' });
  assert.equal(ask(a.r, 'lmin')[0].answer, 800);
  assert.equal(utilEngine.quiz(a.input, a.r).answer, '800');
  const b = go(utilEngine, { frame: '1000B', ack: '1000B', rate: '10kb/s', delay: '200ms' });
  assert.equal(ask(b.r, 'u')[0].answer, 40);
  assert.equal(utilEngine.quiz(b.input, b.r).answer, '40');
  assert.deepEqual(mistakes(utilEngine, b.input), ['oneWay', 'noTf', 'noAck']);
  const c = go(utilEngine, { frame: '1518B', ack: '64B', data: '1500B', rate: '10Mb/s', delay: '10μs' });
  assert.equal(ask(c.r, 'cycle')[0].answer, 1285.6);
  assert.equal(utilEngine.quiz(c.input, c.r).answer, '9.3342');
  assert.equal(utilEngine.quiz(c.input, c.r, { want: 'u' }).answer, '94.4617');
  assert.throws(() => utilEngine.quiz(c.input, c.r, { want: 'xx' }), /want:/);
  assert.throws(() => utilEngine.parse({ rate: '1Mb/s', delay: '1ms' }), /frame:/);
  assert.throws(() => utilEngine.parse({ proto: 'abc', rate: '1Mb/s', delay: '1ms' }), /proto:/);
  assert.throws(() => utilEngine.parse({ frame: '1000B', rate: '1Mb/s' }), /delay:/);
});

test('rtt：Kurose 习题 P8（8 个小对象）：非持久 18 个 RTT、并行 5 个 6 个、持久非流水线 10 个、流水线 3 个；DNS 另算', () => {
  const total = (f) => { const { r } = go(rttEngine, f); return r.total; };
  assert.equal(total({ objects: 8, http: 'non' }), 18);
  assert.equal(total({ objects: 8, http: 'non', parallel: 5 }), 6);
  assert.equal(total({ objects: 8, http: 'persist' }), 10);
  assert.equal(total({ objects: 8, http: 'pipeline' }), 3);
  const { input, r } = go(rttEngine, { objects: 8, http: 'pipeline', dns: 2, rtt: '20ms', dnsrtt: '10ms' });
  assert.equal(ask(r, 'time')[0].answer, 80);
  assert.equal(rttEngine.quiz(input, r).answer, '80');
  assert.deepEqual(mistakes(rttEngine, input), ['noSyn', 'noBase', 'swapPipe']);
  const p = go(rttEngine, { objects: 8, http: 'non', parallel: 5 });
  assert.deepEqual(mistakes(rttEngine, p.input), ['noSyn', 'noBase', 'noCeil', 'allPar']);
  assert.throws(() => rttEngine.parse({ objects: 8, http: 'persist', parallel: 3 }), /parallel:/);
  assert.throws(() => rttEngine.parse({ objects: 8, http: 'xx' }), /http:/);
});

// —— 共同的约定：说明草稿、示例页的例子照抄就能用 ——
const blocksOf = (file) => [...readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').matchAll(/^(`{3,})(\w+)\n([\s\S]*?)^\1\s*$/gm)].filter((m) => ENGINES[m[2]]).map((m) => [m[2], m[3]]);

function checkBlock(name, src) {
  const e = ENGINES[name];
  const where = `${name}（${src.split('\n').find((l) => /^id:/.test(l)) || src.split('\n')[0]}）`;
  const tracked = trackFields(parseFields(src).fields);
  const { fields } = tracked;
  const input = e.parse(fields, src);
  const r = e.run(input);
  assert.ok(r.steps.length >= 2, `${where}：至少两步`);
  assert.ok(!r.steps[0].ask && !r.steps[0].asks, `${where}：第 0 步挂了问题`);
  const spec = commonSpec(fields);
  assert.deepEqual(resolveAsks(spec.ask, r.steps).errors, [], `${where}：ask 写的问不到`);
  assert.deepEqual(e.problems?.(input, r) || [], [], `${where}：自检有提醒`);
  const qz = e.quiz(input, r, fields);
  assert.ok(qz.q && qz.answer !== undefined && qz.answer !== '', `${where}：quiz 没有答案`);
  const t = e.table(input, r, fields);
  if (t) {
    for (const row of t.rows) assert.equal(row.cells.length, t.head.length, `${where}：表的一行 ${row.cells.length} 格，表头 ${t.head.length} 个`);
    const fs = fillSpec(t, spec.mode === 'fill' ? fields : {});
    assert.deepEqual(fs.errors, [], `${where}：填表的字段不对`);
    assert.ok(fillOrder(fs.table).length + (fs.table.extra || []).length > 0, `${where}：表里没有要填的格子`);
  } else assert.notEqual(spec.mode, 'fill', `${where}：mode: fill 却没有表`);
  // 每一步都画得出来；每个问题的答案自己判自己是对的；错法也走得完
  r.steps.forEach((s) => assert.equal(typeof e.view(s.view, input, {}), 'string'));
  for (const a of asks(r)) {
    const given = a.kind === 'pick' ? a.answer : String(a.alts?.[0] ?? a.answer);
    assert.ok(checkAsk(a, given).ok, `${where}：「${a.q}」的答案判成错`);
    if (a.kind === 'choice') assert.ok(a.choices.includes(a.answer), `${where}：「${a.q}」的选项里没有答案`);
  }
  for (const v of e.variants(input, fields)) { const vr = e.run(v.input); e.quiz(v.input, vr, fields); e.table(v.input, vr, fields); assert.match(v.label, /^像是.*（王道：.*）$/, `${where}：错法的说法`); }
  assert.deepEqual(tracked.unknown(), [], `${where}：有用不上的字段`);
}

test('说明草稿和示例页里的例子：照抄就能用', () => {
  const doc = blocksOf('docs/drafts/cn2.md');
  assert.deepEqual([...new Set(doc.map(([n]) => n))].sort(), Object.keys(ENGINES).sort(), '每个组件说明里都有例子');
  for (const [name, src] of doc) checkBlock(name, src);
  const page = blocksOf('kit/examples/cn2-demo.html');
  assert.ok(page.length >= 18);
  for (const [name, src] of page) checkBlock(name, src);
});

test('说明草稿：每节的精简版不超过 500 字节，标题带组件名，写了 mode: quiz、mode: fill 和错法诊断', () => {
  const md = readFileSync(new URL('../docs/drafts/cn2.md', import.meta.url), 'utf8');
  const parts = md.split(/^### /m).slice(1);
  assert.deepEqual(parts.map((p) => p.split('：')[0]).sort(), Object.keys(ENGINES).sort());
  for (const part of parts) {
    const cut = part.indexOf('<!-- 完整写法 -->');
    assert.ok(cut > 0, `${part.split('\n')[0]}：没有「完整写法」`);
    assert.ok(Buffer.byteLength(`### ${part.slice(0, cut)}`.trim()) <= 500, `${part.split('\n')[0]}：精简版 ${Buffer.byteLength(part.slice(0, cut))} 字节`);
    assert.match(part, /<!-- 科目：计网 -->/);
    for (const w of ['mode: quiz', 'mode: fill', '错法诊断']) assert.ok(part.includes(w), `${part.split('\n')[0]}：没写 ${w}`);
    assert.doesNotMatch(part, /[他她]/, '说明里不用「他」「她」称呼学生');
  }
});

test('随便写几组输入：都走得完，第 0 步不问', () => {
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let k = 0; k < 30; k++) {
    checkBlock('csma', `rate: ${[10, 100, 1000][rnd(3)]}Mb/s\ndist: ${1 + rnd(5)}km\nbsend: ${rnd(9)}μs\nr: ${rnd(2)}, ${rnd(4)}, ${rnd(8)}`);
    const n = 3 + rnd(4);
    const names = 'ABCDEFG'.slice(0, n).split('');
    const hosts = names.map((x) => `${x} ${1 + rnd(3)}`).join(', ');
    const frames = Array.from({ length: 4 }, () => { const a = names[rnd(n)]; let b = names[rnd(n)]; if (b === a) b = '*'; return `${a}→${b}`; }).join(', ');
    checkBlock('switch', `hosts: ${hosts}\nports: 4\nframes: ${frames}`);
    const links = names.slice(1).map((x, i) => `${names[rnd(i + 1)]}-${x} ${1 + rnd(4)}`).join(', ');
    checkBlock('dv', `links: ${links}\ncut: ${links.split(', ')[rnd(n - 1)].split(' ')[0]}`);
    checkBlock('util', `proto: ${['sw', 'gbn', 'sr'][rnd(3)]}\nframe: ${100 * (1 + rnd(20))}B\nrate: ${[64, 128, 1000][rnd(3)]}kb/s\ndelay: ${10 * (1 + rnd(30))}ms`);
    checkBlock('rtt', `objects: ${rnd(12)}\nhttp: ${['non', 'persist', 'pipeline'][rnd(3)]}\ndns: ${rnd(3)}`);
  }
});

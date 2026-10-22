// 计算机网络的「算时间」题（纯函数，不碰 DOM；tests/cn2-engine.test.js）：
//   util  信道利用率：停止-等待 / GBN / SR，一个周期（发完第一帧到收到它的确认）的时间线；
//         U = 窗口 × 发送时延 ÷ (发送时延 + RTT + 确认帧的发送时延)，最大是 1；吞吐率；要多大的窗口、几位序号；反过来求最短帧长
//   rtt   HTTP 时间线：非持久（可以并行几个连接）/ 持久非流水线 / 持久流水线，取一个基本页面 + N 个对象要几个 RTT
// 口径按王道：RTT = 2 × 单程传播时延；不考虑确认帧和处理时间，除非题目给了（ack:）；GBN 窗口 ≤ 2^n − 1，SR 窗口 ≤ 2^(n−1)；
// HTTP 不算传输时间，TCP 握手 1 个 RTT（第三次握手捎带 HTTP 请求），请求 + 响应 1 个 RTT。
import { esc, chips } from './arrayview.js';
import { differing } from './netmac.js';
import { parseRate, parseBits, parseTime, parseDist, parseSpeed, parsePercent, clean, num, ansText, timeUnit, inUnit, timeText, rateText, rateUnit, bitsText, distText, speedText, pct } from './netunits.js';

const numAsk = (tag, q, answer, display) => ({ tag, kind: 'number', q, answer: clean(answer), display });
const ceil = (x) => Math.ceil(clean(x) - 1e-9);

// ================= util：信道利用率 =================

const PROTO = { sw: '停止-等待协议', gbn: '后退 N 帧协议（GBN）', sr: '选择重传协议（SR）' };
const PROTO_ALIAS = { sw: 'sw', 停止等待: 'sw', '停止-等待': 'sw', 停等: 'sw', 'stop-and-wait': 'sw', gbn: 'gbn', 后退n帧: 'gbn', sr: 'sr', 选择重传: 'sr', 滑动窗口: 'gbn' };
const bitsFor = (proto, w) => { if (proto === 'sw') return 1; let n = 1; while ((proto === 'sr' ? 2 ** (n - 1) : 2 ** n - 1) < w) n++; return n; };
const winFor = (proto, n) => (proto === 'sr' ? 2 ** (n - 1) : 2 ** n - 1);

function utilParse(fields) {
  const proto = PROTO_ALIAS[String(fields.proto ?? 'sw').trim().toLowerCase().replace(/\s+/g, '')];
  if (!proto) throw new Error(`proto: 写 sw（停止-等待）、gbn（后退 N 帧）或 sr（选择重传）（现在是「${fields.proto}」）`);
  if (fields.rate === undefined) throw new Error('util 要写 rate:（数据率，如 100Mb/s）');
  const rate = parseRate(fields.rate);
  let delay;
  if (fields.delay !== undefined) delay = parseTime(fields.delay, 'delay: 单程传播时延');
  else if (fields.dist !== undefined) delay = clean(parseDist(fields.dist) / (fields.v !== undefined ? parseSpeed(fields.v) : 2e8));
  else throw new Error('写 delay:（单程传播时延，如 270ms），或者 dist:（距离，配 v: 传播速率）');
  const input = { proto, rate, delay, frame: null, window: null, seqbits: null, ack: 0, ackSame: false, data: null, target: null, mistake: '' };
  if (fields.frame !== undefined) { input.frame = parseBits(fields.frame, 'frame: 帧长'); if (!(input.frame > 0)) throw new Error('frame: 帧长要大于 0'); }
  if (proto !== 'sw') {
    if (fields.window !== undefined && fields.seqbits !== undefined) throw new Error('window:（发送窗口）和 seqbits:（序号几位）只写一个');
    if (fields.window !== undefined) {
      input.window = Number(fields.window);
      if (!Number.isInteger(input.window) || input.window < 1 || input.window > 1e6) throw new Error(`window: 发送窗口写正整数（现在是「${fields.window}」）`);
    } else if (fields.seqbits !== undefined) {
      input.seqbits = Number(fields.seqbits);
      if (!Number.isInteger(input.seqbits) || input.seqbits < 1 || input.seqbits > 20) throw new Error('seqbits: 帧序号几位（1～20）');
      input.window = winFor(proto, input.seqbits);
    }
  } else input.window = 1;
  if (fields.ack !== undefined) {
    if (/^(same|等长|frame|一样长|和数据帧等长)$/i.test(String(fields.ack).trim())) input.ackSame = true;
    else input.ack = parseBits(fields.ack, 'ack: 确认帧长度');
  }
  if (fields.data !== undefined) {
    if (input.frame === null) throw new Error('data:（每帧里的有效数据）要配 frame:（帧长）');
    input.data = parseBits(fields.data, 'data: 每帧的有效数据');
    if (input.data > input.frame) throw new Error('data: 有效数据不能比帧还长');
  }
  if (fields.target !== undefined) input.target = parsePercent(fields.target);
  if (input.frame === null) {
    if (input.target === null) throw new Error('写 frame:（帧长）；要反过来求最短帧长，就写 target:（要达到的利用率），不写 frame:');
    if (input.window === null) throw new Error('求最短帧长时要知道窗口：写 window: 或 seqbits:（停止-等待是 1）');
  } else if (input.window === null && input.target === null) input.target = 1; // GBN / SR 没给窗口：求利用率 100% 要多大的窗口
  return input;
}

function utilRun(input) {
  const { proto, rate, delay, mistake } = input;
  const steps = [], vals = [], known = {};
  const rtt = mistake === 'oneWay' ? delay : clean(2 * delay);
  const ackOf = (L) => (mistake === 'noAck' ? 0 : input.ackSame ? L : input.ack);
  const put = (hi, msg, ask, asks, extra = {}) => steps.push({ view: { hi, known: { ...known }, ...extra }, msg, ask, asks });
  const T = (x) => timeText(x);
  const ctx = [`${PROTO[proto]}，数据率 ${rateText(rate)}，单程传播时延 ${T(delay)}`];
  if (input.frame !== null) ctx.push(`帧长 ${bitsText(input.frame)}`);
  if (proto !== 'sw' && input.seqbits !== null) ctx.push(`帧序号 ${input.seqbits} 位`);
  else if (proto !== 'sw' && input.window !== null) ctx.push(`发送窗口 ${input.window}`);
  if (input.ackSame) ctx.push('确认帧和数据帧一样长'); else if (input.ack) ctx.push(`确认帧 ${bitsText(input.ack)}`); else ctx.push('确认帧的发送时延不计');
  put('', `${ctx.join('，')}。算一个周期：从开始发第一帧，到收到它的确认，发送方能发多少。`);

  let L = input.frame;
  let W = input.window;
  if (input.seqbits !== null) {
    const w = mistake === 'bitsSwap' ? winFor(proto === 'sr' ? 'gbn' : 'sr', input.seqbits) : W;
    known['窗口'] = String(W);
    vals.push({ label: '发送窗口最大', v: w });
    put('w', `帧序号 ${input.seqbits} 位：${proto === 'sr' ? `选择重传的发送窗口最大 2^(n−1) = 2^${input.seqbits - 1} = ${W}（发送窗口 + 接收窗口 ≤ 2^n）` : `后退 N 帧的发送窗口最大 2^n − 1 = ${W}（留一个序号，免得新旧帧分不清）`}。`, numAsk('window', `序号 ${input.seqbits} 位，发送窗口最大是多少？`, w));
    W = w;
  }
  // 反过来：帧长多短，利用率还够 target
  if (L === null) {
    const t = input.target;
    const a = input.ackSame ? 2 : 1;
    const den = W - a * t;
    if (!(den > 0)) throw new Error(`窗口 ${W} 达不到 ${pct(t)} 的利用率（确认帧和数据帧一样长时，帧再长也最多 ${pct(Math.min(1, W / 2))}）`);
    const extra = input.ackSame ? 0 : input.ack / rate;
    L = clean(t * rate * (rtt + extra) / den);
    known['最短帧长'] = bitsText(L);
    vals.push({ label: '最短帧长（bit）', v: L });
    put('u', `设帧长 L，发送时延 L ÷ ${rateText(rate)}。要 ${W > 1 ? `${W} × ` : ''}(L/C) ÷ (L/C${input.ackSame ? ' × 2' : ''} + RTT${input.ack ? ' + 确认帧时延' : ''}) ≥ ${pct(t)}，RTT = 2 × ${T(delay)} = ${T(rtt)}：L ≥ ${bitsText(L)}。帧越长，一个周期里在发的时间占得越多。`, numAsk('lmin', `帧长至少是多少比特？`, L, bitsText(L)));
  }
  const tf = clean(L / rate), ta = clean(ackOf(L) / rate);
  const tfu = timeUnit(tf);
  known['发送时延'] = T(tf);
  vals.push({ label: `数据帧发送时延（${tfu}）`, v: inUnit(tf, tfu) });
  put('tf', `数据帧的发送时延 = 帧长 ÷ 数据率 = ${L} bit ÷ ${rateText(rate)} = ${T(tf)}。`, numAsk('tframe', `一个数据帧的发送时延是多少 ${tfu}？`, inUnit(tf, tfu), T(tf)));
  if (input.ack || input.ackSame) {
    const tau = timeUnit(clean((input.ackSame ? L : input.ack) / rate));
    known['确认帧'] = T(clean((input.ackSame ? L : input.ack) / rate));
    vals.push({ label: `确认帧发送时延（${tau}）`, v: inUnit(ta, tau) });
    put('ack', `确认帧的发送时延 = ${input.ackSame ? L : input.ack} bit ÷ ${rateText(rate)} = ${known['确认帧']}${input.ackSame ? '（和数据帧一样长）' : ''}：接收方收完数据帧才开始发确认，要算进周期里。`, numAsk('tack', `确认帧的发送时延是多少 ${tau}？`, inUnit(ta, tau), known['确认帧']));
  }
  const cyc = clean((mistake === 'noTf' ? 0 : tf) + rtt + ta);
  const right = clean(tf + 2 * delay + (input.ackSame ? tf : input.ack / rate));
  const cu = timeUnit(right);
  known['周期'] = T(right);
  vals.push({ label: `一个周期（${cu}）`, v: inUnit(cyc, cu) });
  put('cycle', `一个周期 = 发送时延 + RTT${input.ack || input.ackSame ? ' + 确认帧发送时延' : ''} = ${T(tf)} + 2 × ${T(delay)}${input.ack || input.ackSame ? ` + ${known['确认帧']}` : ''} = ${T(right)}：第一帧开始发，过这么久它的确认才回来。`, numAsk('cycle', `从开始发第一帧到收到它的确认，要多少 ${cu}？`, inUnit(cyc, cu), T(right)));
  // 利用率、吞吐率（GBN / SR 没给窗口：先求要多大的窗口）
  let rightU = null;
  if (W !== null) {
    const busy = clean(W * tf);
    const rawU = clean(busy / cyc), U = mistake === 'noCap' ? rawU : Math.min(1, rawU);
    rightU = Math.min(1, clean(W * tf / right));
    known['利用率'] = pct(rightU);
    vals.push({ label: '信道利用率（%）', v: clean(U * 100) });
    put('u', `一个周期里，发送方${W > 1 ? `最多连发 ${W} 帧，在发的时间 ${W} × ${T(tf)} = ${T(W * tf)}` : `只发 1 帧，在发的时间 ${T(tf)}`}${clean(W * tf) >= right ? `，已经不比周期短：确认在窗口用完之前就回来了，可以一直发，利用率 100%` : `，剩下的时间空等确认`}。U = ${W > 1 ? `${W} × ` : ''}${T(tf)} ÷ ${T(right)} ${num(rightU * 100).exact ? '=' : '≈'} ${pct(rightU)}${clean(W * tf / right) > 1 ? '（算出来大于 1，取 100%）' : ''}。`,
      numAsk('u', '信道利用率是百分之几？（写百分数里的数，如 40）', U * 100, pct(rightU)), [], { busy: true });
    const eff = input.data !== null ? input.data / L : 1;
    const thr = clean(U * rate * eff);
    const [ru, rk] = rateUnit(rightU * rate * eff);
    known[input.data !== null ? '有效数据率' : '吞吐率'] = rateText(clean(rightU * rate * eff));
    vals.push({ label: `${input.data !== null ? '有效数据传输速率' : '最大平均数据传输速率'}（${ru}）`, v: clean(thr / rk) });
    put('u', `${input.data !== null ? `每帧 ${L} bit 里有效数据 ${input.data} bit：有效数据传输速率 = 一个周期的有效数据 ÷ 周期 = ${W > 1 ? `${W} × ` : ''}${input.data} bit ÷ ${T(right)}` : `最大平均数据传输速率 = 利用率 × 数据率 = ${pct(rightU)} × ${rateText(rate)}`} ${num(rightU * rate * eff / rk).exact ? '=' : '≈'} ${rateText(clean(rightU * rate * eff))}。`,
      numAsk('thru', `${input.data !== null ? '有效数据传输速率' : '最大平均数据传输速率'}是多少 ${ru}？（除不尽写到两位小数）`, thr / rk, rateText(clean(rightU * rate * eff))), [], { busy: true });
  }
  // 要多大的窗口、几位序号
  if (input.target !== null && input.frame !== null && proto !== 'sw') {
    const t = input.target;
    const need = ceil(t * cyc / tf), needR = ceil(t * right / tf);
    known[`窗口至少`] = String(needR);
    vals.push({ label: `利用率 ≥ ${pct(t)} 的窗口至少`, v: need });
    put('w', `要利用率 ≥ ${pct(t)}：W × ${T(tf)} ≥ ${pct(t)} × ${T(right)}，W ≥ ${num(clean(t * right / tf)).text}，窗口至少 ${needR}。`, numAsk('wmin', `发送窗口至少是多少？`, need), [], { busy: true, win: needR });
    const nb = bitsFor(mistake === 'bitsSwap' ? (proto === 'sr' ? 'gbn' : 'sr') : proto, need), nbR = bitsFor(proto, needR);
    known['序号位数'] = String(nbR);
    vals.push({ label: '帧序号至少几位', v: nb });
    put('w', `${proto === 'sr' ? `选择重传：窗口 ≤ 2^(n−1)，2^${nbR - 1} = ${2 ** (nbR - 1)} ≥ ${needR}` : `后退 N 帧：窗口 ≤ 2^n − 1，2^${nbR} − 1 = ${2 ** nbR - 1} ≥ ${needR}`}${nbR > 1 ? `（${nbR - 1} 位只够 ${winFor(proto, nbR - 1)}）` : ''}，帧序号至少 ${nbR} 位。`, numAsk('seqbits', '帧序号至少要几位？', nb), [], { busy: true, win: needR });
  } else if (input.target !== null && input.frame !== null && proto === 'sw') {
    put('u', `停止-等待的利用率是 ${pct(rightU)}，${rightU + 1e-12 >= input.target ? '达到了' : '没达到'} ${pct(input.target)}。${rightU + 1e-12 >= input.target ? '' : '要提高：帧长一点、或者改用滑动窗口连续发。'}`,
      { tag: 'reach', kind: 'choice', q: `利用率能达到 ${pct(input.target)} 吗？`, choices: ['能', '不能'], answer: U + 1e-12 >= input.target ? '能' : '不能' }, [], { busy: true });
  }
  return { steps, vals, known, L, tf, ta, cycle: right, W, U: rightU };
}

function utilView(s, input, r0) {
  const r = r0 || utilRun({ ...input, mistake: '' });
  const { tf, ta, cycle } = r;
  const W = s.win || r.W || 1;
  const d = input.delay;
  const busyEnd = Math.min(W * tf, cycle);
  // 最后一帧的最后一位到接收方是 busyEnd + τ：时间轴要画到那里，不然那一条斜带会冲出图的下沿
  const Tend = Math.max(cycle, busyEnd + d) * 1.04;
  const Wd = 560, top = 40, hgt = 320, xs = 150, xr = 430;
  const Y = (t) => top + (t / Tend) * hgt;
  let g = `<defs><marker id="n2-arr2" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" class="n2-arrowhead"/></marker></defs>`;
  g += `<text class="n2-who" x="${xs}" y="22">发送方</text><text class="n2-who" x="${xr}" y="22">接收方</text><line class="n2-life" x1="${xs}" y1="${top - 8}" x2="${xs}" y2="${top + hgt + 4}"/><line class="n2-life" x1="${xr}" y1="${top - 8}" x2="${xr}" y2="${top + hgt + 4}"/>`;
  const band = (a, b, cls, label, cmd) => {
    const y1 = Y(a), y2 = Math.max(Y(b), Y(a) + 3);
    return `<g class="${cls}" ${cmd ? `data-cmd="${cmd}" data-label="${esc(label)}"` : ''}><polygon points="${xs},${y1} ${xs},${y2} ${xr},${y2 + Y(d) - top} ${xr},${y1 + Y(d) - top}"/>${label && y2 - y1 >= 12 ? `<text class="n2-bandt" x="${(xs + xr) / 2}" y="${(y1 + y2) / 2 + Y(d) / 2 - top / 2 + 4}">${esc(label)}</text>` : ''}</g>`;
  };
  const many = W > 6 || W * tf > cycle || Y(tf) - Y(0) < 6;
  if (!many) for (let i = 0; i < W; i++) g += band(i * tf, (i + 1) * tf, `n2-fband${i === 0 && s.hi === 'tf' ? ' n2-hi' : ''}`, `帧 ${i + 1}`, i + 1);
  else {
    g += band(0, tf, `n2-fband${s.hi === 'tf' ? ' n2-hi' : ''}`, '', 1);
    g += band(tf, busyEnd, 'n2-fband n2-more', W * tf > cycle ? '窗口够大：一直在发' : `一共 ${W} 帧`, 2);
  }
  // 第一帧的确认
  const t1 = tf + d;
  if (ta > 0) g += `<g class="n2-aband${s.hi === 'ack' || s.hi === 'cycle' ? ' n2-hi' : ''}" data-cmd="${W + 1}" data-label="确认"><polygon points="${xr},${Y(t1)} ${xr},${Y(t1 + ta)} ${xs},${Y(cycle)} ${xs},${Y(cycle - ta)}"/></g>`;
  else g += `<line class="n2-ackl${s.hi === 'cycle' ? ' n2-hi' : ''}" x1="${xr}" y1="${Y(t1)}" x2="${xs}" y2="${Y(cycle)}" marker-end="url(#n2-arr2)" data-cmd="${W + 1}" data-label="确认"/>`;
  g += `<text class="n2-ackt" x="${(xs + xr) / 2 + 30}" y="${(Y(t1) + Y(cycle)) / 2 + 18}">确认 1</text>`;
  // 左边：在发（实线）、空等（虚线）
  const show = s.busy || s.hi === 'u';
  if (show) g += `<line class="n2-busy" x1="${xs - 14}" y1="${Y(0)}" x2="${xs - 14}" y2="${Y(busyEnd)}"/>${busyEnd < cycle ? `<line class="n2-idle" x1="${xs - 14}" y1="${Y(busyEnd)}" x2="${xs - 14}" y2="${Y(cycle)}"/><text class="n2-idlet" x="${xs - 20}" y="${(Y(busyEnd) + Y(cycle)) / 2}">空等</text>` : ''}<text class="n2-busyt" x="${xs - 20}" y="${Math.max(Y(busyEnd) / 2 + Y(0) / 2, Y(0) + 12)}">在发</text>`;
  // 刻度
  const L = [[0, '0'], [tf, `T_f = ${timeText(tf)}`], [cycle, `${timeText(cycle)}：确认到了`]];
  if (many && busyEnd > tf && busyEnd < cycle) L.push([busyEnd, `${timeText(busyEnd)}：窗口发完`]);
  L.sort((a, b) => a[0] - b[0]);
  let last = -99;
  for (const [t, text] of L) { const y = Y(t); if (y - last < 13) continue; last = y; g += `<text class="n2-tk" x="${xs - (show ? 46 : 10)}" y="${y + 4}">${esc(text)}</text>`; }
  g += `<text class="n2-tk n2-r" x="${xr + 10}" y="${Y(d) + 4}">τ = ${esc(timeText(d))}</text>`;
  if (Y(t1) - Y(d) >= 13) g += `<text class="n2-tk n2-r" x="${xr + 10}" y="${Y(t1) + 4}">${esc(timeText(t1))}</text>`;
  if (s.hi === 'cycle') g += `<line class="n2-span" x1="${xs - 6}" y1="${Y(0)}" x2="${xs - 6}" y2="${Y(cycle)}"/>`;
  const svg = `<svg class="n2-svg n2-ut" viewBox="0 0 ${Wd} ${top + hgt + 16}" style="max-width:${Wd}px" role="img" aria-label="一个周期的时间线">${g}</svg>`;
  return svg + chips(Object.entries(s.known));
}

export const utilEngine = {
  name: 'util', title: '信道利用率', parse: utilParse, run: utilRun,
  view: (s, input) => utilView(s, input),
  // 只写一个数：want: 指定（u、thru、cycle、tframe、wmin、seqbits、lmin），不写就是题目最后问的（求帧长 / 序号位数，或者利用率）
  quiz(input, r, fields = {}) {
    const asks = r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter((a) => a && a.kind === 'number');
    const last = asks.filter((a) => ['lmin', 'seqbits'].includes(a.tag)).at(-1);
    const want = fields.want !== undefined ? String(fields.want).trim().toLowerCase() : last ? last.tag : input.data !== null ? 'thru' : 'u';
    const a = asks.find((x) => x.tag === want);
    if (!a) throw new Error(`want: 写 ${[...new Set(asks.map((x) => x.tag))].join('、')} 里的一个（现在是「${fields.want}」）`);
    const ctx = [`${PROTO[input.proto]}，数据率 ${rateText(input.rate)}，单程传播时延 ${timeText(input.delay)}`];
    if (input.frame !== null) ctx.push(`帧长 ${bitsText(input.frame)}`);
    if (input.seqbits !== null) ctx.push(`帧序号 ${input.seqbits} 位`); else if (input.proto !== 'sw' && input.window !== null) ctx.push(`发送窗口 ${input.window}`);
    if (input.data !== null) ctx.push(`每帧有效数据 ${bitsText(input.data)}`);
    ctx.push(input.ackSame ? '确认帧和数据帧一样长' : input.ack ? `确认帧 ${bitsText(input.ack)}` : '忽略确认帧的发送时延');
    if (input.target !== null) ctx.push(`要求利用率不低于 ${pct(input.target)}`);
    return { q: `${ctx.join('，')}。${a.q}`, type: 'num', answer: ansText(a.answer) };
  },
  table(input, r) {
    return { q: '把每个量算出来填进表里（单位见每一行）。', qhtml: '', dir: 'row', head: ['值'], rows: r.vals.map((x) => ({ label: x.label, cells: [{ v: ansText(x.v), num: true }] })) };
  },
  // 常见错法：周期里只算了单程传播时延、忘了发送时延、忘了确认帧的时延、利用率没封顶、GBN 和 SR 的序号公式弄混
  variants(input) {
    return differing(utilEngine, input, [
      { label: '像是周期里只算了单程传播时延（王道：要等确认回来，是一来一回 RTT = 2 × 传播时延）', input: { ...input, mistake: 'oneWay' } },
      { label: '像是周期里忘了数据帧的发送时延（王道：周期 = 发送时延 + RTT，发完第一帧最后一位以后还要再走 RTT 确认才回来）', input: { ...input, mistake: 'noTf' } },
      ...(input.ack || input.ackSame ? [{ label: '像是忘了确认帧的发送时延（王道：题目给了确认帧长度，就要算进周期）', input: { ...input, mistake: 'noAck' } }] : []),
      { label: '像是利用率算出了超过 100%（王道：窗口够大、能一直发时，利用率就是 100%）', input: { ...input, mistake: 'noCap' } },
      ...(input.proto !== 'sw' ? [{ label: input.proto === 'gbn' ? '像是按选择重传的公式算了窗口和序号（王道：GBN 发送窗口 ≤ 2^n − 1）' : '像是按后退 N 帧的公式算了窗口和序号（王道：SR 发送窗口 ≤ 2^(n−1)）', input: { ...input, mistake: 'bitsSwap' } }] : []),
    ]);
  },
};

// ================= rtt：HTTP 时间线 =================

const HTTP = { non: '非持久连接', persist: '持久连接（非流水线）', pipeline: '持久连接（流水线）' };
const HTTP_ALIAS = { non: 'non', nonpersist: 'non', nonpersistent: 'non', 非持久: 'non', 非持续: 'non', persist: 'persist', persistent: 'persist', 持久: 'persist', 持续: 'persist', 非流水线: 'persist', 持久非流水线: 'persist', pipeline: 'pipeline', pipelining: 'pipeline', 流水线: 'pipeline', 持久流水线: 'pipeline' };

function rttParse(fields) {
  const http = HTTP_ALIAS[String(fields.http ?? 'non').trim().toLowerCase().replace(/[\s（）()]/g, '')];
  if (!http) throw new Error(`http: 写 non（非持久）、persist（持久、非流水线）或 pipeline（持久、流水线）（现在是「${fields.http}」）`);
  const n = Number(fields.objects ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 20) throw new Error('objects: 基本 HTML 文件引用了几个对象（0～20，都在同一台服务器上）');
  let parallel = 1;
  if (fields.parallel !== undefined) {
    if (http !== 'non') throw new Error('parallel:（并行几个 TCP 连接）只用在非持久连接上');
    parallel = Number(fields.parallel);
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > 20) throw new Error('parallel: 浏览器同时开几个 TCP 连接（1～20）');
  }
  const dns = fields.dns === undefined ? 0 : Number(fields.dns);
  if (!Number.isInteger(dns) || dns < 0 || dns > 6) throw new Error('dns: 解析域名要访问几次 DNS 服务器（每次一个 RTT_DNS；0～6，默认 0：已经解析过）');
  const rtt = fields.rtt === undefined ? null : parseTime(fields.rtt, 'rtt: 到 Web 服务器的往返时间');
  const dnsrtt = dns && fields.dnsrtt !== undefined ? parseTime(fields.dnsrtt, 'dnsrtt: 访问一次 DNS 服务器的往返时间') : null;
  return { http, n, parallel, dns, rtt, dnsrtt, mistake: '' };
}

// 每一段：{ lane, at, len, kind: 'dns' | 'syn' | 'base' | 'obj', text }，时间以 RTT 为单位（DNS 另算）
function rttPlan(input) {
  const { http, n, parallel, mistake } = input;
  const syn = mistake === 'noSyn' ? 0 : 1;
  const base = mistake === 'noBase' ? 0 : 1;
  const segs = [];
  const phases = []; // { text, rtts, segs: [下标] }
  let t = 0;
  const add = (lane, at, len, kind, text) => { segs.push({ lane, at, len, kind, text }); return segs.length - 1; };
  const conn = syn ? [add(0, t, syn, 'syn', '握手')] : [];
  t += syn;
  phases.push({ text: '建立 TCP 连接', rtts: syn, segs: conn });
  const b = base ? [add(0, t, base, 'base', '基本页')] : [];
  t += base;
  phases.push({ text: '请求基本 HTML 文件', rtts: base, segs: b });
  const mode = mistake === 'swapPipe' ? (http === 'pipeline' ? 'persist' : 'pipeline') : http;
  if (n) {
    if (mode === 'non') {
      const M = mistake === 'allPar' ? n : parallel;
      const batches = mistake === 'noCeil' ? n / M : Math.ceil(n / M);
      for (let k = 0; k < Math.ceil(batches - 1e-9); k++) {
        const ids = [];
        const first = k * M, cnt = Math.min(M, n - first);
        for (let j = 0; j < cnt; j++) {
          if (syn) ids.push(add(j, t, 1, 'syn', '握手'));
          ids.push(add(j, t + syn, 1, 'obj', `对象 ${first + j + 1}`));
        }
        const frac = mistake === 'noCeil' && k === Math.ceil(batches) - 1 ? batches - k : 1;
        t += (syn + 1) * frac;
        phases.push({ text: M > 1 ? `对象 ${first + 1}～${first + cnt}（${cnt} 个连接并行）` : `对象 ${first + 1}（新开一个连接）`, rtts: (syn + 1) * frac, segs: ids });
      }
    } else if (mode === 'persist') {
      for (let k = 0; k < n; k++) { phases.push({ text: `对象 ${k + 1}`, rtts: 1, segs: [add(0, t, 1, 'obj', `对象 ${k + 1}`)] }); t += 1; }
    } else {
      phases.push({ text: `对象 1～${n}（流水线：连着发 ${n} 个请求）`, rtts: 1, segs: [add(0, t, 1, 'obj', n > 1 ? `对象 1～${n}` : '对象 1')] });
      t += 1;
    }
  }
  return { segs, phases, total: clean(t) };
}

function rttRun(input) {
  const plan = rttPlan(input);
  const right = rttPlan({ ...input, mistake: '' });
  const { http, n, parallel, dns, rtt, dnsrtt } = input;
  const steps = [];
  const v = (upto, extra = {}) => ({ upto, ...extra });
  const dnsText = dns ? `先解析域名：访问 ${dns} 次 DNS 服务器（${dns} 个 RTT_DNS）；` : '';
  steps.push({ view: v(-1), msg: `点开一个网页：基本 HTML 文件引用了 ${n} 个对象（都在同一台服务器上），用${HTTP[http]}${http === 'non' && parallel > 1 ? `，浏览器最多同时开 ${parallel} 个 TCP 连接` : ''}。${dnsText}不算传输时间，只数 RTT：建 TCP 连接 1 个 RTT（第三次握手捎带 HTTP 请求），请求一个对象再收到它 1 个 RTT。` });
  if (dns) steps.push({ view: v(-1, { dns: true }), msg: `DNS：本地没有缓存，依次访问 ${dns} 个 DNS 服务器才拿到 IP 地址：${dns} 个 RTT_DNS${dnsrtt !== null ? ` = ${dns} × ${timeText(dnsrtt)} = ${timeText(dns * dnsrtt)}` : ''}。之后才能和 Web 服务器建连接。` });
  let sofar = 0, sofarR = 0;
  plan.phases.forEach((p, i) => {
    sofar = clean(sofar + p.rtts);
    sofarR = clean(sofarR + (right.phases[i]?.rtts ?? 0));
    const rp = right.phases[i] || p;
    let msg, ask;
    if (i === 0) msg = `和服务器建立 TCP 连接：SYN、SYN+ACK 一来一回，1 个 RTT。`;
    else if (i === 1) { msg = `第三次握手的报文段捎带「GET 基本 HTML 文件」，再过 1 个 RTT 收到它，一共 ${sofarR} 个 RTT。浏览器这才知道还要 ${n} 个对象。`; ask = numAsk('base', `从开始建连接算，收到基本 HTML 文件时一共用了几个 RTT？`, sofar); }
    else if (http === 'non') { msg = `${rp.text}：非持久连接每个对象都要新建 TCP 连接，握手 1 个 RTT + 请求响应 1 个 RTT = 2 个 RTT${parallel > 1 ? `，${parallel} 个连接一起走也是 2 个 RTT` : ''}（到这里 ${sofarR} 个）。`; if (i === 2) ask = numAsk('obj', `${parallel > 1 ? `并行的这一批` : '取一个对象'}要几个 RTT？`, p.rtts); }
    else if (http === 'persist') { msg = `${rp.text}：持久连接不用再握手；非流水线要等上一个响应回来才发下一个请求，每个对象 1 个 RTT（到这里 ${sofarR} 个）。`; if (i === 2) ask = numAsk('obj', '取一个对象要几个 RTT？', p.rtts); }
    else { msg = `${rp.text}：持久连接不用再握手；流水线不等响应，连着把 ${n} 个请求发出去，${n} 个对象一共 1 个 RTT（到这里 ${sofarR} 个）。`; ask = numAsk('obj', `${n} 个对象一共要几个 RTT？`, p.rtts); }
    steps.push({ view: v(i), msg, ask });
  });
  const total = plan.total, totalR = right.total;
  const time = rtt !== null ? clean(total * rtt + (dns ? dns * (dnsrtt ?? rtt) : 0)) : null;
  const timeR = rtt !== null ? clean(totalR * rtt + (dns ? dns * (dnsrtt ?? rtt) : 0)) : null;
  const tu = timeR !== null ? timeUnit(timeR) : 'ms';
  const formula = http === 'non' ? (parallel > 1 ? `2 + 2 × ⌈${n} ÷ ${parallel}⌉ = ${totalR}` : `2 + 2 × ${n} = ${totalR}`) : http === 'persist' ? `1 + 1 + ${n} = ${totalR}` : `1 + 1 + 1 = ${totalR}`;
  steps.push({
    view: v(plan.phases.length, { done: true }),
    msg: `一共 ${formula} 个 RTT${dns ? `，再加 DNS 的 ${dns} 个 RTT_DNS` : ''}${timeR !== null ? `：${dns ? `${dns} × ${timeText(dnsrtt ?? rtt)} + ` : ''}${totalR} × ${timeText(rtt)} = ${timeText(timeR, tu)}` : ''}。${http === 'non' ? '非持久连接每个对象都多花一个 RTT 握手；' : http === 'persist' ? '持久连接省掉了每个对象的握手，但还是一个一个等；' : '持久 + 流水线最快：一次握手，请求连着发；'}三种比一比：非持久 ${2 + 2 * n}${parallel > 1 && http === 'non' ? `（并行 ${parallel} 个：${2 + 2 * Math.ceil(n / parallel)}）` : ''}、持久非流水线 ${2 + n}、持久流水线 ${n ? 3 : 2} 个 RTT。`,
    ask: numAsk('total', `从建立 TCP 连接到收到全部对象，和 Web 服务器之间一共几个 RTT？${dns ? '（不算 DNS）' : ''}`, total),
    asks: time !== null ? [numAsk('time', `从点链接到收到全部对象，一共要多少 ${tu}？`, inUnit(time, tu), timeText(timeR, tu))] : [],
  });
  return { steps, plan: right, total: totalR, time: timeR, tu, said: { total, time } };
}

function rttView(s, input) {
  const plan = rttPlan({ ...input, mistake: '' });
  const dnsN = input.dns;
  const lanes = Math.max(1, ...plan.segs.map((x) => x.lane + 1));
  const units = dnsN + plan.total;
  const u = Math.max(28, Math.min(58, 600 / Math.max(1, units)));
  const left = 74, top = 26, laneH = 34;
  const Wd = left + u * units + 16;
  const rows = (dnsN ? 1 : 0) + lanes;
  const H = top + rows * (laneH + 6) + 26;
  const x0 = left + u * dnsN;
  const shown = new Set(plan.phases.slice(0, s.upto + 1).flatMap((p) => p.segs));
  const curSet = new Set(plan.phases[s.upto]?.segs || []);
  let g = '';
  let row = 0;
  if (dnsN) {
    g += `<text class="n2-lane" x="${left - 8}" y="${top + laneH / 2 + 5}">DNS</text>`;
    if (s.dns || s.upto >= 0) for (let i = 0; i < dnsN; i++) g += `<g class="n2-seg n2-dns${s.dns ? ' n2-on sv-new' : ''}"><rect x="${left + i * u + 1}" y="${top}" width="${u - 2}" height="${laneH}" rx="6"/><text x="${left + i * u + u / 2}" y="${top + laneH / 2 + 5}">DNS</text></g>`;
    row = 1;
  }
  for (let l = 0; l < lanes; l++) g += `<text class="n2-lane" x="${left - 8}" y="${top + (row + l) * (laneH + 6) + laneH / 2 + 5}">${lanes > 1 ? `连接 ${l + 1}` : 'TCP'}</text>`;
  plan.segs.forEach((x, i) => {
    if (!shown.has(i)) return;
    const y = top + (row + x.lane) * (laneH + 6);
    const short = u < 40 ? { 握手: '握', 基本页: '页' }[x.text] ?? x.text.replace('对象 ', '') : x.text;
    g += `<g class="n2-seg n2-${x.kind}${curSet.has(i) ? ' n2-on sv-new' : ''}" data-cmd="${i + 1}" data-label="${esc(x.text)}"><rect x="${x0 + x.at * u + 1}" y="${y}" width="${x.len * u - 2}" height="${laneH}" rx="6"/><text x="${x0 + (x.at + x.len / 2) * u}" y="${y + laneH / 2 + 5}">${esc(short)}</text></g>`;
  });
  // RTT 刻度
  const yAxis = top + rows * (laneH + 6) + 2;
  g += `<line class="n2-life" x1="${left}" y1="${yAxis}" x2="${left + u * units}" y2="${yAxis}"/>`;
  for (let k = 0; k <= plan.total; k++) if (plan.total <= 16 || k % 2 === 0 || k === plan.total) g += `<text class="n2-tk n2-mid" x="${x0 + k * u}" y="${yAxis + 16}">${k}</text>`;
  g += `<text class="n2-tk" x="${left - 8}" y="${yAxis + 16}">RTT</text>`;
  const svg = `<svg class="n2-svg n2-rtt" viewBox="0 0 ${Wd} ${H}" style="max-width:${Wd}px" role="img" aria-label="HTTP 时间线">${g}</svg>`;
  const so = plan.phases.slice(0, s.upto + 1).reduce((a, p) => a + p.rtts, 0);
  return `<div class="sv-gtbl-wrap">${svg}</div>${chips([['方式', HTTP[input.http]], ['对象', input.n], ...(input.http === 'non' && input.parallel > 1 ? [['并行', input.parallel]] : []), ['已用', s.upto >= 0 ? `${clean(so)} 个 RTT${dnsN ? ` + ${dnsN} 个 RTT_DNS` : ''}` : dnsN && s.dns ? `${dnsN} 个 RTT_DNS` : '0']])}`;
}

export const rttEngine = {
  name: 'rtt', title: 'HTTP 要几个 RTT', parse: rttParse, run: rttRun, view: rttView,
  quiz(input, r) {
    const ctx = `基本 HTML 文件引用了 ${input.n} 个对象（同一台服务器），${HTTP[input.http]}${input.http === 'non' && input.parallel > 1 ? `，最多 ${input.parallel} 个并行连接` : ''}，不算传输时间`;
    if (input.rtt !== null) return { q: `${ctx}${input.dns ? `，先访问 ${input.dns} 次 DNS 服务器（每次 ${timeText(input.dnsrtt ?? input.rtt)}）` : ''}，RTT = ${timeText(input.rtt)}。从点链接到收到全部对象要多少 ${r.tu}？`, type: 'num', answer: ansText(inUnit(r.said.time, r.tu)) };
    return { q: `${ctx}。从建立 TCP 连接到收到全部对象一共几个 RTT？`, type: 'num', answer: String(r.said.total) };
  },
  // 考卷上那张表：每一段几个 RTT，下面写总数
  table(input, r) {
    const plan = rttPlan(input);
    return { q: '每一段要几个 RTT？', qhtml: '', dir: 'row', head: ['几个 RTT'], rows: plan.phases.map((p) => ({ label: p.text, cells: [{ v: String(p.rtts), num: true }] })), extra: [{ label: '一共几个 RTT', v: String(r.said.total), num: true }] };
  },
  // 常见错法：忘了 TCP 握手、忘了基本页面那一个 RTT、流水线和非流水线弄混、并行连接的批数没向上取整、没管并行数的上限
  variants(input) {
    const list = [
      { label: '像是忘了 TCP 建立连接的那个 RTT（王道：每建一个 TCP 连接先握手，1 个 RTT）', input: { ...input, mistake: 'noSyn' } },
      { label: '像是忘了请求基本 HTML 文件的那个 RTT（王道：先拿到基本页面，才知道要哪些对象）', input: { ...input, mistake: 'noBase' } },
    ];
    if (input.http !== 'non' && input.n > 1) list.push({ label: input.http === 'pipeline' ? '像是按非流水线算了（王道：流水线不等响应，N 个请求连着发，一共 1 个 RTT）' : '像是按流水线算了（王道：非流水线要等上一个响应回来才发下一个请求，每个对象 1 个 RTT）', input: { ...input, mistake: 'swapPipe' } });
    if (input.http === 'non' && input.parallel > 1) list.push({ label: '像是并行连接的批数没向上取整（王道：⌈N ÷ 并行数⌉ 批，最后一批不满也要一整批的时间）', input: { ...input, mistake: 'noCeil' } }, { label: '像是没管并行数的上限，所有对象一起取了（王道：最多同时开 parallel 个连接）', input: { ...input, mistake: 'allPar' } });
    // 表格的格子数会跟着变：只拿 ask / quiz 比
    return differing(rttEngine, input, list);
  },
};

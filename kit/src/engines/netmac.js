// 计算机网络的介质访问控制和交换机（纯函数，不碰 DOM；tests/cn2-engine.test.js）：
//   csma    CSMA/CD：τ、争用期 2τ、最短帧长；两个站的冲突时间线（谁先发、什么时候检测到冲突）；二进制指数退避
//   switch  交换机自学习：每来一帧先记下源地址在哪个端口，再按目的地址转发、扩散或丢弃（过滤）
// 口径按王道：最短帧长 = 2τ × 数据率；A 在 0 时刻发、B 在 t 时刻发（t < τ），B 在 τ 检测到冲突、A 在 t + τ 检测到；
// 退避：k = min[重传次数, 10]，r 从 {0, 1, …, 2^k − 1} 里随机取，推迟 r × 争用期（基本退避时间，默认 2τ；以太网写 slot: 51.2μs）。
import { esc, chips } from './arrayview.js';
import { parseRate, parseBits, parseTime, parseDist, parseSpeed, clean, num, ansText, timeUnit, inUnit, timeText, rateText, bitsText, distText, speedText } from './netunits.js';

// 一个 run 里学生能答的：每个 ask、quiz、填表。错法算出来和对的一样就不列
function answersOf(engine, input, r) {
  const asks = r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter(Boolean).map((a) => [a.q, a.alts ?? a.answer]);
  const get = (f) => { try { return f() ?? null; } catch { return null; } };
  const t = get(() => engine.table(input, r));
  return JSON.stringify([asks, get(() => engine.quiz(input, r).answer), t && t.rows.map((row) => row.cells.map((c) => c.v))]);
}
export function differing(engine, input, list) {
  let base;
  try { base = answersOf(engine, input, engine.run(input)); } catch { return []; }
  return list.filter((v) => { try { return answersOf(engine, v.input, engine.run(v.input)) !== base; } catch { return false; } });
}
const numAsk = (tag, q, answer, display) => ({ tag, kind: 'number', q, answer: clean(answer), display });

// ================= csma =================

function csmaParse(fields) {
  if (fields.rate === undefined) throw new Error('csma 要写 rate:（数据率，如 10Mb/s）');
  const rate = parseRate(fields.rate);
  const input = { rate, tau: null, dist: null, v: null, minframe: null, dframe: null, tb: null, last: false, jam: null, backoff: [], slot: null, mistake: '' };
  // 信号传播速率只在用得上时读（只写了 delay: 又写 v: 时，外壳会报「v: 没有用上」）
  const speed = () => (fields.v !== undefined ? parseSpeed(fields.v) : 2e8);
  if (fields.dist !== undefined) {
    input.dist = parseDist(fields.dist);
    input.v = speed();
    input.tau = clean(input.dist / input.v);
  }
  if (fields.delay !== undefined) {
    if (input.tau !== null) throw new Error('dist:（距离）和 delay:（单程传播时延）只写一个');
    input.tau = parseTime(fields.delay, 'delay: 单程传播时延 τ');
    if (!(input.tau > 0)) throw new Error('delay: 单程传播时延要大于 0');
  }
  if (fields.minframe !== undefined) {
    if (input.tau !== null) throw new Error('minframe: 是由最短帧长反过来求 τ（和最远距离）的，和 dist: / delay: 只写一边');
    input.minframe = parseBits(fields.minframe, 'minframe: 最短帧长');
    if (!(input.minframe > 0)) throw new Error('minframe: 最短帧长要大于 0');
    input.tau = clean(input.minframe / rate / 2);
    input.minUnit = /B|字节/.test(String(fields.minframe)) ? 'B' : 'bit';
    input.v = fields.v !== undefined ? parseSpeed(fields.v) : null;
  }
  if (fields.dframe !== undefined) {
    // 最短帧长变了多少（-800bit 是减少 800 比特）→ 最远距离变多少
    const s = String(fields.dframe).trim();
    const neg = /^[-−－]|^减少/.test(s);
    const b = parseBits(s.replace(/^[-−－+]|^(减少|增加)/, ''), 'dframe: 最短帧长的变化', { bare: 'bit' });
    if (!(b > 0)) throw new Error('dframe: 写最短帧长变了多少，比如 -800bit（减少 800 比特）');
    input.dframe = neg ? -b : b;
    input.v = input.v ?? speed();
  }
  if (fields.bsend !== undefined) {
    if (input.tau === null) throw new Error('bsend: 要先知道 τ：写 dist:（和 v:）、delay: 或 minframe:');
    const s = String(fields.bsend).trim();
    if (/^(last|最晚|快到时)$/i.test(s)) { input.tb = input.tau; input.last = true; }
    else if (/^(0|同时)$/.test(s)) input.tb = 0;
    else input.tb = parseTime(s, 'bsend: B 开始发送的时刻（A 在 0 时刻开始发）');
    if (fields.jam !== undefined) input.jam = parseBits(fields.jam, 'jam: 干扰信号长度', { bare: 'bit' });
  }
  if (fields.r !== undefined || fields.retry !== undefined) {
    const from = fields.retry === undefined ? 1 : Number(fields.retry);
    if (!Number.isInteger(from) || from < 1 || from > 16) throw new Error(`retry: 写第几次重传（1～16），现在是「${fields.retry}」`);
    const rs = fields.r === undefined ? [null] : String(fields.r).split(/[\s,，、]+/).filter(Boolean).map((x) => {
      const n = Number(x);
      if (!Number.isInteger(n) || n < 0) throw new Error(`r: 写每次随机取到的整数（如 r: 1, 3, 6），「${x}」不对`);
      return n;
    });
    if (from + rs.length - 1 > 16) throw new Error(`重传最多 16 次：从第 ${from} 次起只能再写 ${17 - from} 个 r`);
    rs.forEach((r, i) => {
      const n = from + i, k = Math.min(n, 10);
      if (r !== null && r > 2 ** k - 1) throw new Error(`r: 第 ${n} 次重传 k = ${k}，r 只能在 0～${2 ** k - 1} 里取（现在是 ${r}）`);
      input.backoff.push({ n, r });
    });
    if (fields.slot !== undefined) input.slot = parseTime(fields.slot, 'slot: 基本退避时间');
    else if (input.tau === null) throw new Error('退避要知道基本退避时间：写 slot: 51.2μs，或者写 dist: / delay: / minframe:（默认取争用期 2τ）');
  }
  if (input.tau === null && input.dframe === null && !input.backoff.length) throw new Error('csma 写 dist:（距离，配 v:）、delay:（τ）、minframe:（反过来求 τ）、dframe:（帧长变了多少）、bsend:（冲突时间线）或 r: / retry:（退避）');
  return input;
}

function csmaRun(input) {
  const { rate, mistake } = input;
  const steps = [];
  const vals = []; // 填表：每个要算的量
  const known = {}; // 画面上的小牌子
  const tau = input.tau;
  const two = tau === null ? null : clean(mistake === 'oneTau' ? tau : 2 * tau); // 争用期
  const U = tau !== null ? timeUnit(tau) : 'μs';
  const T = (sec, u = U) => timeText(sec, u);
  const put = (part, extra, msg, ask, asks) => steps.push({ view: { part, known: { ...known }, ...extra }, msg, ask, asks });
  const intro = [`数据率 ${rateText(rate)}`];
  if (input.dist !== null) intro.push(`两站相距 ${distText(input.dist)}，信号传播速率 ${speedText(input.v)}`);
  else if (input.minframe !== null) intro.push(`最短帧长 ${bitsText(input.minframe)}`);
  else if (tau !== null) intro.push(`单程传播时延 τ = ${T(tau)}`);
  put('start', {}, `CSMA/CD：先听后发、边发边听，冲突停发。${intro.join('，')}。`);

  // —— τ、争用期、最短帧长 ——
  if (input.minframe !== null) {
    const p = clean(input.minframe / rate);
    const pm = mistake === 'bytes' && input.minUnit === 'B' ? clean(p / 8) : p; // 错法：128B 当成 128 bit
    const pu = timeUnit(p);
    known['2τ'] = T(p, pu);
    vals.push({ label: `争用期 2τ（${pu}）`, v: inUnit(pm, pu) });
    put('basic', {}, `最短帧长 = 2τ × 数据率，反过来：争用期 2τ = 最短帧长 ÷ 数据率 = ${input.minframe} bit ÷ ${rateText(rate)} = ${T(p, pu)}。`, numAsk('period', `争用期 2τ 是多少 ${pu}？`, inUnit(pm, pu), T(p, pu)));
    const t1 = mistake === 'oneTau' ? pm : clean(pm / 2);
    known.τ = T(tau);
    vals.push({ label: `τ 最多（${U}）`, v: inUnit(t1, U) });
    put('basic', {}, `单程传播时延最多是 τ = 2τ ÷ 2 = ${T(tau)}：两站再远，A 发完最短的帧之前，B 那头的冲突信号就传不回来了。`, numAsk('tau', `两站之间的单程传播时延最多是多少 ${U}？`, inUnit(t1, U), T(t1)));
    if (input.v !== null) {
      const d = clean(t1 * input.v);
      known['最远'] = distText(clean(tau * input.v));
      vals.push({ label: '最远距离（m）', v: d });
      put('basic', {}, `最远距离 = τ × 传播速率 = ${T(tau)} × ${speedText(input.v)} = ${distText(clean(tau * input.v))}。`, numAsk('dist', '两站最远相距多少米？', d, `${num(d).text}m`));
    }
  } else if (tau !== null) {
    if (input.dist !== null) {
      known.τ = T(tau);
      vals.push({ label: `τ（${U}）`, v: inUnit(tau, U) });
      put('basic', {}, `单程传播时延 τ = 距离 ÷ 传播速率 = ${distText(input.dist)} ÷ ${speedText(input.v)} = ${T(tau)}。`, numAsk('tau', `单程传播时延 τ 是多少 ${U}？`, inUnit(tau, U), T(tau)));
    }
    known['2τ'] = T(2 * tau);
    vals.push({ label: `争用期 2τ（${U}）`, v: inUnit(two, U) });
    put('basic', {}, `争用期 = 2τ = ${T(2 * tau)}：A 发出以后，最坏要过 2τ 才知道有没有冲突（B 在 A 的信号快到时才开始发，B 的信号再走 τ 回到 A）。`, numAsk('period', `争用期是多少 ${U}？`, inUnit(two, U), T(2 * tau)));
    const L = clean(2 * tau * rate);
    const said = mistake === 'oneTau' ? clean(tau * rate) : mistake === 'bytes' ? clean(L / 8) : L;
    known['最短帧长'] = bitsText(L);
    vals.push({ label: '最短帧长（bit）', v: said });
    put('basic', {}, `最短帧长 = 2τ × 数据率 = ${T(2 * tau)} × ${rateText(rate)} = ${bitsText(L)}。帧再短，A 发完了还没收到冲突信号，就会以为发成功了。`, numAsk('minframe', '最短帧长是多少比特？', said, bitsText(L)));
  }

  // —— 最短帧长变了，最远距离跟着变 ——
  if (input.dframe !== null) {
    const dd = clean(input.dframe * input.v / (2 * rate));
    const a = Math.abs(dd);
    const word = (x) => (x > 0 ? `增加 ${distText(Math.abs(x))}` : `减少 ${distText(Math.abs(x))}`);
    const said = mistake === 'oneTau' ? clean(2 * dd) : mistake === 'sign' ? -dd : dd;
    known['距离变化'] = word(dd);
    vals.push({ label: '距离变化（m，减少写负数）', v: said });
    const choices = [`增加 ${distText(2 * a)}`, `增加 ${distText(a)}`, `减少 ${distText(2 * a)}`, `减少 ${distText(a)}`];
    put('dframe', {}, `最短帧长 = 2 × 距离 ÷ 传播速率 × 数据率，帧长和距离成正比：距离变化 = 帧长变化 × 传播速率 ÷ (2 × 数据率) = ${input.dframe} bit × ${speedText(input.v)} ÷ (2 × ${rateText(rate)}) = ${num(dd).text}m，${word(dd)}。`,
      { tag: 'dchange', kind: 'choice', q: `最短帧长${input.dframe < 0 ? '减少' : '增加'} ${Math.abs(input.dframe)} bit，最远的两个站之间的距离至少要怎么变？`, choices, answer: word(said) });
  }

  // —— 冲突时间线：A 在 0 时刻发，B 在 tb 时刻发 ——
  let line = null;
  if (input.tb !== null) {
    const tb = input.tb;
    const busy = !input.last && tb >= tau;
    const tbText = input.last ? 'τ − δ（A 的信号快到、还没到 B）' : tb === 0 ? '0（和 A 同时）' : T(tb);
    line = { tb, busy };
    put('line', { now: 0 }, `t = 0：A 侦听到信道空闲，开始发送。A 的信号要走 τ = ${T(tau)} 才到 B。`);
    if (busy) {
      put('line', { now: tb, busyB: true }, `t = ${T(tb)}：B 想发，先侦听——A 的信号在 t = ${T(tau)} 就到了，现在信道忙，B 推迟发送，不会冲突。A 发出 2τ 以后还没冲突，就不会再冲突了。`,
        { tag: 'idle', kind: 'choice', q: `B 在 t = ${T(tb)} 侦听信道，听到的是？`, choices: ['空闲，B 开始发送', '忙，B 推迟发送'], answer: '忙，B 推迟发送' });
      return { steps, vals, line, known };
    }
    put('line', { now: tb }, `t = ${tbText}：B 侦听信道——A 的信号还没到，听起来空闲，B 也开始发送。`,
      { tag: 'idle', kind: 'choice', q: `B 在 t = ${tbText} 侦听信道，听到的是？`, choices: ['空闲，B 开始发送', '忙，B 推迟发送'], answer: '空闲，B 开始发送' });
    const tm = clean((tau + tb) / 2);
    const tmText = input.last ? '就在 B 跟前' : `在离 A ${input.dist !== null ? distText(clean(input.dist * tm / tau)) : `全程约 ${Math.round(tm / tau * 100)}%`}的地方`;
    put('line', { now: tm }, `t = (τ + ${input.last ? 'τ − δ' : 't_B'}) ÷ 2 ${input.last ? '≈ τ' : `= ${T(tm)}`}：两个信号相遇，冲突发生了（${tmText}）。可是 A、B 都还不知道——冲突的信号还得传回各自那里。`,
      numAsk('meet', `两个信号在什么时刻相遇？（${U}）`, inUnit(tm, U), T(tm)));
    const tB = mistake === 'meet' ? tm : tau;
    const tA = mistake === 'meet' ? tm : mistake === 'always2' ? clean(2 * tau) : clean(tb + tau);
    const jam = input.jam !== null ? `发 ${input.jam} bit 的干扰信号（jam，要 ${T(input.jam / rate)}），` : '再发一小段干扰信号（jam，32 或 48 bit），让大家都知道冲突了，';
    known['B 检测到'] = T(tau);
    vals.push({ label: `B 检测到冲突（${U}）`, v: inUnit(tB, U) });
    put('line', { now: tau }, `t = τ = ${T(tau)}：A 的信号到了 B，B 检测到冲突，立刻停止发送，${jam}然后退避。`, numAsk('bdetect', `B 在什么时刻检测到冲突？（${U}）`, inUnit(tB, U), T(tau)));
    const ta = clean(tb + tau);
    known['A 检测到'] = input.last ? `≈ ${T(2 * tau)}` : T(ta);
    vals.push({ label: `A 检测到冲突（${U}）`, v: inUnit(tA, U) });
    put('line', { now: ta }, `t = t_B + τ = ${input.last ? `(τ − δ) + τ ≈ 2τ = ${T(2 * tau)}` : `${T(tb)} + ${T(tau)} = ${T(ta)}`}：B 的信号传回 A，A 检测到冲突，停止发送${input.jam !== null ? `，发 jam 到 ${T(ta + input.jam / rate)}` : '、发 jam'}，然后退避。`,
      numAsk('detect', `A 在什么时刻检测到冲突？（从 A 开始发送算，${U}）`, inUnit(tA, U), input.last ? `${T(2 * tau)}（2τ，差一点点）` : T(ta)));
    put('line', { now: ta, done: true }, `从 A 开始发送到两边都检测到冲突用了${input.last ? `约 2τ = ${T(2 * tau)}` : ` ${T(ta)}`}。B 和 A 同时发时最短（τ = ${T(tau)}），B 在 A 的信号快到时才发最长（2τ = ${T(2 * tau)}，就是争用期）：A 发出 2τ 还没检测到冲突，这一帧就不会再冲突了。`);
  }

  // —— 二进制指数退避 ——
  if (input.backoff.length) {
    const slot = input.slot ?? (mistake === 'tauSlot' ? tau : clean(2 * tau));
    const su = timeUnit(input.slot ?? 2 * tau);
    const slotText = input.slot !== null ? `基本退避时间 ${T(input.slot, su)}` : `基本退避时间取争用期 2τ = ${T(2 * tau, su)}`;
    const rows = [];
    put('backoff', { rows: [] }, `二进制指数退避：第 n 次重传前，k = min[n, 10]，从 {0, 1, …, 2^k − 1} 里随机取一个 r，推迟 r × 基本退避时间再侦听信道（${slotText}）。冲突越多，可选的 r 越多，再撞上的机会越小；重传 16 次还不成功就丢弃这一帧，报告上层。`);
    for (const { n, r } of input.backoff) {
      const k = Math.min(n, 10), kk = mistake === 'noCap' ? n : k;
      const hi = mistake === 'range2k' ? 2 ** kk : 2 ** kk - 1;
      const row = { n, k, hi: 2 ** k - 1, r, wait: r === null ? null : clean(r * (input.slot ?? 2 * tau)) };
      rows.push(row);
      const capNote = n > 10 ? `（n = ${n} 超过 10，k 封顶取 10）` : '';
      const kAsk = numAsk('k', `第 ${n} 次重传，k 取多少？`, kk);
      const hiAsk = numAsk('range', `第 ${n} 次重传，r 最大能取几？`, hi);
      vals.push({ label: `第 ${n} 次重传：k`, v: kk }, { label: `第 ${n} 次重传：r 最大`, v: hi });
      if (r === null) {
        const most = clean(hi * slot);
        vals.push({ label: `第 ${n} 次重传：最多推迟（${su}）`, v: inUnit(most, su) });
        put('backoff', { rows: rows.slice(), cur: rows.length - 1 }, `第 ${n} 次重传：k = min[${n}, 10] = ${k}${capNote}，r 从 0～${2 ** k - 1} 里随机取；最多推迟 ${2 ** k - 1} × ${T(input.slot ?? 2 * tau, su)} = ${T((2 ** k - 1) * (input.slot ?? 2 * tau), su)}。`,
          hiAsk, [kAsk, numAsk('maxwait', `第 ${n} 次重传最多要推迟多久？（${su}）`, inUnit(most, su), T((2 ** k - 1) * (input.slot ?? 2 * tau), su))]);
      } else {
        const w = clean(r * slot);
        vals.push({ label: `第 ${n} 次重传：推迟（${su}）`, v: inUnit(w, su) });
        put('backoff', { rows: rows.slice(), cur: rows.length - 1 }, `第 ${n} 次重传：k = min[${n}, 10] = ${k}${capNote}，r 从 0～${2 ** k - 1} 里随机取，这次取到 ${r}：推迟 ${r} × ${T(input.slot ?? 2 * tau, su)} = ${T(row.wait, su)} 再侦听信道${r === 0 ? '（r = 0：马上重新侦听）' : ''}。`,
          numAsk('wait', `第 ${n} 次重传取到 r = ${r}，要推迟多久再重传？（${su}）`, inUnit(w, su), T(row.wait, su)), [hiAsk, kAsk]);
      }
    }
  }
  return { steps, vals, line, known };
}

// —— 画面 ——
function linkSvg(input) {
  const W = 520, H = 70;
  const lab = input.dist !== null ? `${distText(input.dist)}，τ = ${timeText(input.tau)}` : input.tau !== null ? `τ = ${timeText(input.tau)}` : '';
  return `<svg class="n2-svg n2-cd-link" viewBox="0 0 ${W} ${H}" role="img" aria-label="两个站"><line class="n2-bus" x1="70" y1="40" x2="${W - 70}" y2="40"/>`
    + `<g data-cmd="1" data-label="A"><rect class="n2-host" x="22" y="22" width="48" height="36" rx="8"/><text class="n2-hname" x="46" y="45">A</text></g>`
    + `<g data-cmd="2" data-label="B"><rect class="n2-host" x="${W - 70}" y="22" width="48" height="36" rx="8"/><text class="n2-hname" x="${W - 46}" y="45">B</text></g>`
    + (lab ? `<text class="n2-note" x="${W / 2}" y="30">${esc(lab)}</text>` : '') + '</svg>';
}

function lineSvg(s, input) {
  const tau = input.tau, tb = input.tb;
  const U = timeUnit(tau);
  const busy = !input.last && tb >= tau;
  const end = Math.max(2 * tau, busy ? tb : tb + tau) * 1.08;
  const W = 540, top = 44, hgt = 300, xa = 120, xb = 400;
  const Y = (t) => top + (t / end) * hgt;
  const now = s.now;
  const H = top + hgt + 20;
  let g = `<text class="n2-who" x="${xa}" y="22">A</text><text class="n2-who" x="${xb}" y="22">B</text>`;
  g += `<line class="n2-life" x1="${xa}" y1="${top - 10}" x2="${xa}" y2="${top + hgt + 6}"/><line class="n2-life" x1="${xb}" y1="${top - 10}" x2="${xb}" y2="${top + hgt + 6}"/>`;
  // 时刻刻度：0、t_B、τ、t_B + τ、2τ
  const marks = [[0, '0'], [tau, `τ = ${timeText(tau, U)}`], [2 * tau, `2τ = ${timeText(2 * tau, U)}`]];
  if (!busy && tb > 0 && !input.last) marks.push([tb, `t_B = ${timeText(tb, U)}`]);
  if (!busy && !input.last && tb > 0) marks.push([tb + tau, `${timeText(tb + tau, U)}`]);
  marks.sort((a, b) => a[0] - b[0]);
  let lastY = -99;
  for (const [t, text] of marks) {
    const y = Y(t);
    g += `<line class="n2-tick" x1="${xa - 6}" y1="${y}" x2="${xb + 6}" y2="${y}"/>`;
    if (y - lastY >= 14) { g += `<text class="n2-tk" x="${xa - 12}" y="${y + 4}">${esc(text)}</text>`; lastY = y; }
  }
  // A 的信号（发到检测到冲突为止）
  const tA = busy ? end : tb + tau;
  const fa = Math.min(now, tau) / tau;
  g += `<line class="n2-send n2-a" x1="${xa}" y1="${Y(0)}" x2="${xa}" y2="${Y(Math.min(now, tA))}"/>`;
  if (now > 0) g += `<line class="n2-sig n2-a" x1="${xa}" y1="${Y(0)}" x2="${xa + (xb - xa) * fa}" y2="${Y(Math.min(now, tau))}"/>`;
  if (!busy && now >= tb) {
    const fb = Math.min(now - tb, tau) / tau;
    g += `<line class="n2-send n2-b" x1="${xb}" y1="${Y(tb)}" x2="${xb}" y2="${Y(Math.min(now, tau))}"/>`;
    if (now > tb) g += `<line class="n2-sig n2-b" x1="${xb}" y1="${Y(tb)}" x2="${xb - (xb - xa) * fb}" y2="${Y(tb + Math.min(now - tb, tau))}"/>`;
    const tm = (tau + tb) / 2;
    // 相遇点贴着 B 时（B 最晚才发），「冲突」写在左边，不压着「B 检测到冲突」
    if (now >= tm) { const x = xa + (xb - xa) * (tm / tau); const nearB = xb - x < 40; g += `<g class="n2-boom" data-cmd="3" data-label="冲突"><circle cx="${x}" cy="${Y(tm)}" r="9"/><text class="n2-boomt" x="${nearB ? x - 34 : x}" y="${nearB ? Y(tm) + 4 : Y(tm) - 14}">冲突</text></g>`; }
    if (now >= tau) g += `<g class="n2-det"><circle cx="${xb}" cy="${Y(tau)}" r="6"/><text class="n2-dett n2-r" x="${xb + 12}" y="${Y(tau) + 4}">B 检测到冲突</text></g>`;
    if (now >= tb + tau) g += `<g class="n2-det"><circle cx="${xa}" cy="${Y(tb + tau)}" r="6"/><text class="n2-dett n2-r" x="${xa + 12}" y="${Y(tb + tau) + 16}">A 检测到冲突</text></g>`;
  }
  if (busy && now >= tb) g += `<text class="n2-dett n2-r" x="${xb + 10}" y="${Y(tb) + 4}">B：信道忙，推迟</text>`;
  if (!s.done) g += `<line class="n2-now" x1="${xa - 6}" y1="${Y(now)}" x2="${xb + 6}" y2="${Y(now)}"/>`;
  g += `<text class="n2-axis-t" x="${xa - 12}" y="${top + hgt + 16}">时间 ↓</text>`;
  return `<svg class="n2-svg n2-cd-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="冲突时间线">${g}</svg>`;
}

function backoffTable(s) {
  if (!s.rows.length) return '';
  return `<table class="sv-tab n2-tab"><thead><tr><th>第几次重传</th><th>k</th><th>r 的范围</th><th>取到的 r</th><th>推迟</th></tr></thead><tbody>${s.rows.map((x, i) => `<tr class="${i === s.cur ? 'n2-on sv-new' : ''}" data-cmd="${i + 1}" data-label="第 ${x.n} 次"><td>${x.n}</td><td>${x.k}</td><td>0～${x.hi}</td><td>${x.r ?? '?'}</td><td>${x.wait === null ? `最多 ${x.hi} 个` : esc(timeText(x.wait))}</td></tr>`).join('')}</tbody></table>`;
}

function csmaView(s, input) {
  let h = '';
  if (s.part === 'line') h += lineSvg(s, input);
  else if (s.part === 'backoff') h += backoffTable(s) || '<div class="n2-note-b">每次冲突以后，退避时间翻倍地变得更「随机」。</div>';
  else if (input.tau !== null || input.dist !== null) h += linkSvg(input);
  return h + chips(Object.entries(s.known));
}

export const csmaEngine = {
  name: 'csma', title: 'CSMA/CD', parse: csmaParse, run: csmaRun, view: csmaView,
  // 只写一个结果：有时间线问 A 什么时候检测到冲突；不然问最短帧长 / τ / 最后一次推迟多久
  quiz(input, r) {
    const pick = (tag) => r.steps.map((s) => [s.ask, ...(s.asks || [])]).flat().filter((a) => a && a.tag === tag).at(-1);
    const a = pick('detect') || pick('minframe') || pick('tau') || pick('dist') || pick('wait') || pick('maxwait') || pick('range');
    if (!a && input.dframe !== null) {
      const v = r.vals.find((x) => x.label.startsWith('距离变化'));
      return { q: `CSMA/CD，数据率 ${rateText(input.rate)}，信号传播速率 ${speedText(input.v)}。最短帧长${input.dframe < 0 ? '减少' : '增加'} ${Math.abs(input.dframe)} bit，最远的两个站之间的距离要变多少米？（增加写正数，减少写负数）`, type: 'num', answer: ansText(v.v) };
    }
    if (!a) throw new Error('这组参数没有可以写的数');
    const ctx = [`数据率 ${rateText(input.rate)}`];
    if (input.dist !== null) ctx.push(`两站相距 ${distText(input.dist)}，信号传播速率 ${speedText(input.v)}`);
    else if (input.minframe !== null) ctx.push(`最短帧长 ${bitsText(input.minframe)}${input.v !== null ? `，信号传播速率 ${speedText(input.v)}` : ''}`);
    else if (input.tau !== null) ctx.push(`单程传播时延 ${timeText(input.tau)}`);
    if (a.tag === 'detect') ctx.push(`A 在 0 时刻开始发送，B ${input.last ? '在 A 的信号快到时' : input.tb === 0 ? '和 A 同时' : `在 ${timeText(input.tb)} 时`}开始发送`);
    if (input.slot !== null) ctx.push(`基本退避时间 ${timeText(input.slot)}`);
    return { q: `CSMA/CD，${ctx.join('，')}。${a.q}`, type: 'num', answer: ansText(a.answer) };
  },
  // 考卷上那张表：每个要算的量一行
  table(input, r) {
    if (!r.vals.length) return null;
    return { q: '把每个量算出来填进表里（单位见每一行）。', qhtml: '', dir: 'row', head: ['值'], rows: r.vals.map((x) => ({ label: x.label, cells: [{ v: ansText(x.v), num: true }] })) };
  },
  // 常见错法：争用期当成 τ、最短帧长写成字节、以为信号相遇就检测到、以为 A 总在 2τ 检测到、k 没封顶、r 的范围多一个、退避按 τ 算
  variants(input) {
    return differing(csmaEngine, input, [
      { label: '像是把争用期当成了 τ（王道：争用期是往返的 2τ，最短帧长 = 2τ × 数据率）', input: { ...input, mistake: 'oneTau' } },
      { label: input.minframe !== null ? '像是把字节当成了比特（王道：最短帧长 × 8 才是比特数，再除以数据率得争用期）' : '像是把最短帧长写成了字节数（王道：最短帧长 = 2τ × 数据率，算出来是比特，这里问的也是比特）', input: { ...input, mistake: 'bytes' } },
      { label: '像是把方向弄反了（王道：最短帧长和距离成正比，帧变短，最远距离也要变短）', input: { ...input, mistake: 'sign' } },
      { label: '像是以为两个信号相遇时就检测到冲突了（王道：冲突的信号要传回自己这里才检测得到：B 在 τ，A 在 t_B + τ）', input: { ...input, mistake: 'meet' } },
      { label: '像是以为 A 总是在 2τ 时检测到冲突（王道：2τ 是 B 最晚才发的情况，一般是 B 开始发送以后再过 τ）', input: { ...input, mistake: 'always2' } },
      { label: '像是 k 没有封顶（王道：k = min[重传次数, 10]，第 10 次以后 r 都在 0～1023 里取）', input: { ...input, mistake: 'noCap' } },
      { label: '像是 r 的范围多算了一个（王道：r 从 0, 1, …, 2^k − 1 里取，最大是 2^k − 1）', input: { ...input, mistake: 'range2k' } },
      ...(input.slot === null ? [{ label: '像是退避按 τ 算了（王道：基本退避时间是争用期 2τ）', input: { ...input, mistake: 'tauSlot' } }] : []),
    ]);
  },
};

// ================= switch：交换机自学习 =================

const BCAST = /^(\*|广播|all|ff(-ff){5}|ff(:ff){5})$/i;
const portsText = (ps) => (ps.length ? `端口 ${ps.join('、')}` : '不转发（丢弃）');
// 主机名太长（MAC 地址）时图上只写最后几位，表里写全
const shortName = (n) => (n.length > 6 ? `…${n.slice(-5)}` : n);

function swParse(fields) {
  if (fields.hosts === undefined) throw new Error('switch 要写 hosts:（主机接在几号端口，如 hosts: A 1, B 2, C 3），和 frames:（如 frames: A→C, C→A）');
  const hosts = new Map();
  for (const part of String(fields.hosts).split(/[,，、;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\S+?)\s*(?:@|\s|:|：)\s*(\d+)$/.exec(part);
    if (!m) throw new Error(`hosts: 每台主机写「名字 端口」，如 A 1（同一个端口接了集线器就写几台同样的端口号），「${part}」不对`);
    if (hosts.has(m[1])) throw new Error(`hosts: ${m[1]} 写了两次`);
    if (BCAST.test(m[1])) throw new Error(`hosts: 「${m[1]}」是广播地址，不能当主机名`);
    hosts.set(m[1], Number(m[2]));
  }
  if (hosts.size < 2) throw new Error('hosts: 至少两台主机');
  const maxPort = Math.max(...hosts.values());
  const ports = fields.ports === undefined ? maxPort : Number(fields.ports);
  if (!Number.isInteger(ports) || ports < maxPort || ports > 12) throw new Error(`ports: 交换机有几个端口（${maxPort}～12，主机已经接到了 ${maxPort} 号）`);
  for (const p of hosts.values()) if (p < 1) throw new Error('hosts: 端口从 1 编号');
  if (hosts.size > 12) throw new Error('hosts: 最多 12 台主机');
  const known = (n, what) => { if (!hosts.has(n)) throw new Error(`${what}：「${n}」不在 hosts: 里（有 ${[...hosts.keys()].join('、')}）`); return n; };
  const frames = String(fields.frames ?? '').split(/[,，、;；\n]+/).map((x) => x.trim()).filter(Boolean).map((part) => {
    const m = /^(\S+?)\s*(?:->|→|=>|>|＞|\s+to\s+)\s*(\S+)$/.exec(part);
    if (!m) throw new Error(`frames: 每一帧写「源→目的」，如 A→C（广播写 A→*），「${part}」不对`);
    const src = known(m[1], 'frames: 源地址');
    const bcast = BCAST.test(m[2]);
    const dst = bcast ? '*' : known(m[2], 'frames: 目的地址');
    if (dst === src) throw new Error(`frames: ${part} 自己发给自己？`);
    return { src, dst };
  });
  if (!frames.length) throw new Error('frames: 写要发的帧，如 frames: A→C, C→A, B→*');
  if (frames.length > 12) throw new Error('frames: 最多 12 帧');
  const init = [];
  if (fields.init !== undefined) for (const part of String(fields.init).split(/[,，、;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\S+?)\s*(?:@|\s|:|：)\s*(\d+)$/.exec(part);
    if (!m) throw new Error(`init: 转发表里原有的项写「名字 端口」，如 init: B 2，「${part}」不对`);
    const p = Number(m[2]);
    if (p < 1 || p > ports) throw new Error(`init: 端口 ${p} 不存在（1～${ports}）`);
    init.push([known(m[1], 'init: '), p]);
  }
  return { hosts, ports, frames, init, mistake: '' };
}

function swRun(input) {
  const { hosts, ports, frames, mistake } = input;
  const all = Array.from({ length: ports }, (_, i) => i + 1);
  const table = new Map(input.init);
  const steps = [];
  const log = [];
  const v = (extra = {}) => ({ table: [...table.entries()], ...extra });
  const hostsOn = (p) => [...hosts.entries()].filter(([, q]) => q === p).map(([n]) => n);
  steps.push({ view: v({ cur: -1 }), msg: `交换机有 ${ports} 个端口。${table.size ? `转发表里原来有：${[...table.entries()].map(([n, p]) => `${n} → 端口 ${p}`).join('，')}。` : '刚开机，转发表是空的。'}每来一帧：先看源地址，记下它从哪个端口进来（自学习）；再查目的地址：查到了就只从那个端口转发（和进来的是同一个端口就丢弃），查不到或是广播就从别的端口都发一份（扩散）。` });
  frames.forEach((f, i) => {
    const inP = hosts.get(f.src);
    const before = table.get(f.src);
    const learn = before === inP ? 'have' : before === undefined ? 'new' : 'move';
    if (mistake !== 'noLearn') table.set(f.src, inP);
    let out, how;
    const flood = () => (mistake === 'floodAll' ? all.slice() : all.filter((p) => p !== inP));
    if (f.dst === '*') { out = flood(); how = 'bcast'; }
    else if (table.has(f.dst) && mistake !== 'noLearn') {
      const p = table.get(f.dst);
      if (p === inP && mistake !== 'noFilter') { out = []; how = 'filter'; } else { out = [p]; how = 'known'; }
    } else { out = flood(); how = 'flood'; }
    // 实际收到这一帧的主机：转发出去的端口上的，加上和源接在同一个集线器上的
    const rx = [...hosts.keys()].filter((n) => n !== f.src && (out.includes(hosts.get(n)) || hosts.get(n) === inP));
    const got = f.dst === '*' ? true : rx.includes(f.dst);
    log.push({ f, inP, out, how, learn });
    const learnText = learn === 'new' ? `转发表里没有 ${f.src}，记下「${f.src} → 端口 ${inP}」` : learn === 'move' ? `表里 ${f.src} 原来是端口 ${before}，现在从端口 ${inP} 进来，改成端口 ${inP}` : `表里已经有「${f.src} → 端口 ${inP}」，不用改（刷新一下计时）`;
    const fwdText = how === 'bcast' ? `目的是广播地址：除了进来的端口 ${inP}，从${portsText(out)} 都发出去` : how === 'flood' ? `表里查不到 ${f.dst}，不知道它在哪：除了进来的端口 ${inP}，从${portsText(out)} 都发一份（扩散）` : how === 'filter' ? `表里 ${f.dst} 在端口 ${inP}，就是进来的那个端口：${f.dst} 已经收到了（同一个集线器上），交换机不转发，丢弃（过滤）` : `表里查到 ${f.dst} 在端口 ${out[0]}，只从端口 ${out[0]} 转发出去`;
    const others = rx.filter((n) => n !== f.dst);
    const rxText = f.dst === '*' ? `${rx.join('、')} 都收到了。` : `${got ? `${f.dst} 收到了` : `${f.dst} 没收到（表里的端口过时了）`}${others.length ? `；${others.join('、')} 也收到了，看目的地址不是自己，丢掉` : ''}。`;
    const choices = [...new Map([out, all.filter((p) => p !== inP), all, f.dst !== '*' ? [hosts.get(f.dst)] : null, []].filter(Boolean).map((ps) => [portsText(ps), ps])).entries()]
      .sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0])).map(([t]) => t);
    const ask = { tag: 'out', kind: 'choice', q: `第 ${i + 1} 帧 ${f.src} → ${f.dst === '*' ? '广播' : f.dst}：交换机从哪些端口转发出去？`, choices, answer: portsText(out) };
    const asks = [];
    if (out.length) asks.push({ tag: 'port', kind: 'pick', q: `第 ${i + 1} 帧 ${f.src} → ${f.dst === '*' ? '广播' : f.dst}：在图上点出转发出去的端口。`, count: out.length, answer: out.length > 1 ? out.map(String) : String(out[0]), display: portsText(out) });
    const lc = [`记下 ${f.src} 在端口 ${inP}`, ...(f.dst !== '*' ? [`记下 ${f.dst} 在端口 ${inP}`] : []), '什么也不用记'];
    asks.push({ tag: 'learn', kind: 'choice', q: `第 ${i + 1} 帧 ${f.src} → ${f.dst === '*' ? '广播' : f.dst} 从端口 ${inP} 进来，交换机的转发表要怎么变？`, choices: learn === 'move' ? [`把 ${f.src} 改成端口 ${inP}`, ...lc.slice(1)] : lc, answer: mistake === 'noLearn' ? '什么也不用记' : learn === 'have' ? '什么也不用记' : learn === 'move' ? `把 ${f.src} 改成端口 ${inP}` : `记下 ${f.src} 在端口 ${inP}` });
    steps.push({ view: v({ cur: i, inP, out, how, rx, fresh: learn !== 'have' && mistake !== 'noLearn' ? f.src : null }), msg: `第 ${i + 1} 帧 ${f.src} → ${f.dst === '*' ? '广播' : f.dst}，从端口 ${inP} 进来。先学：${learnText}。再转发：${fwdText}。${rxText}`, ask, asks });
  });
  steps.push({ view: v({ cur: frames.length, done: true }), msg: `${frames.length} 帧发完。转发表：${[...table.entries()].map(([n, p]) => `${n} → 端口 ${p}`).join('，') || '（空）'}${[...hosts.keys()].filter((n) => !table.has(n)).length ? `；${[...hosts.keys()].filter((n) => !table.has(n)).join('、')} 还没发过帧，交换机还不知道它在哪` : ''}。` });
  return { steps, log, table: [...table.entries()], hostsOn };
}

function swView(s, input) {
  const { hosts, ports, frames } = input;
  const colW = Math.max(104, Math.min(150, 560 / ports));
  const W = 40 + colW * ports, H = 222;
  const px = (p) => 20 + colW * (p - 0.5);
  const cur = s.cur >= 0 && s.cur < frames.length ? frames[s.cur] : null;
  let g = `<defs><marker id="n2-arr" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" class="n2-arrowhead"/></marker></defs>`;
  g += `<rect class="n2-switch" x="14" y="14" width="${W - 28}" height="52" rx="10"/><text class="n2-swname" x="${W / 2}" y="40">交换机</text>`;
  const hostXY = new Map();
  for (let p = 1; p <= ports; p++) {
    const on = [...hosts.entries()].filter(([, q]) => q === p).map(([n]) => n);
    const x = px(p);
    const live = cur && s.out.includes(p), isIn = cur && s.inP === p;
    const cable = live ? ' n2-live' : isIn ? ' n2-inl' : '';
    if (on.length > 1) {
      // 一个端口接了集线器：一条横杠，几台主机挂在下面
      const span = colW - 16;
      g += `<line class="n2-cable${cable}" x1="${x}" y1="80" x2="${x}" y2="118"${live ? ' marker-end="url(#n2-arr)"' : ''}/><line class="n2-hub${cable}" x1="${x - span / 2}" y1="120" x2="${x + span / 2}" y2="120"/><text class="n2-hubt" x="${x + span / 2}" y="114">集线器</text>`;
      on.forEach((n, i) => { const hx = x - span / 2 + (span * (i + 0.5)) / on.length; hostXY.set(n, hx); g += `<line class="n2-cable${cable}" x1="${hx}" y1="120" x2="${hx}" y2="150"/>`; });
    } else if (on.length === 1) { hostXY.set(on[0], x); g += `<line class="n2-cable${cable}" x1="${x}" y1="80" x2="${x}" y2="${live ? 148 : 150}"${live ? ' marker-end="url(#n2-arr)"' : ''}/>`; }
    if (isIn && cur) { const sx = hostXY.get(cur.src) ?? x; g += `<line class="n2-cable n2-inl" x1="${on.length > 1 ? x : sx}" y1="${on.length > 1 ? 118 : 148}" x2="${x}" y2="82" marker-end="url(#n2-arr)"/>`; }
    g += `<g class="n2-port${live ? ' n2-out' : ''}${isIn ? ' n2-in' : ''}" data-pick="${p}" data-cmd="${p}" data-label="端口 ${p}"><rect x="${x - 19}" y="56" width="38" height="26" rx="6"/><text x="${x}" y="74">${p}</text></g>`;
    if (isIn && s.how === 'filter') g += `<text class="n2-drop" x="${x + 26}" y="76">✗ 丢弃</text>`;
  }
  let k = ports;
  for (const [n] of hosts) {
    const x = hostXY.get(n);
    const w = Math.min(70, Math.max(40, (colW - 16) / Math.max(1, [...hosts.values()].filter((q) => q === hosts.get(n)).length) - 10));
    const cls = cur ? (n === cur.src ? ' n2-src' : s.rx.includes(n) ? (n === cur.dst || cur.dst === '*' ? ' n2-dst' : ' n2-rx') : '') : '';
    g += `<g class="n2-hostg${cls}" data-cmd="${++k}" data-label="${esc(n)}"><title>${esc(n)}</title><rect class="n2-host" x="${x - w / 2}" y="152" width="${w}" height="34" rx="8"/><text class="n2-hname" x="${x}" y="174">${esc(shortName(n))}</text></g>`;
  }
  if (cur) g += `<text class="n2-note" x="${W / 2}" y="${H - 10}">${esc(`${cur.src} → ${cur.dst === '*' ? '广播' : cur.dst}`)}</text>`;
  const svg = `<svg class="n2-svg n2-sw-svg" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img" aria-label="交换机和主机">${g}</svg>`;
  const list = `<div class="n2-frames">${frames.map((f, i) => `<span class="n2-fr${i === s.cur ? ' n2-fr-cur' : i < s.cur ? ' n2-fr-done' : ''}">${i + 1}. ${esc(f.src)} → ${f.dst === '*' ? '广播' : esc(f.dst)}</span>`).join('')}</div>`;
  const tab = `<table class="sv-tab n2-tab n2-mac"><thead><tr><th>MAC 地址</th><th>端口</th></tr></thead><tbody>${s.table.length ? s.table.map(([n, p]) => `<tr class="${n === s.fresh ? 'n2-on sv-new' : ''}"><td>${esc(n)}</td><td>${p}</td></tr>`).join('') : '<tr><td colspan="2" class="muted">（空）</td></tr>'}</tbody></table>`;
  return `${list}<div class="n2-sw">${svg}<div class="n2-mac-wrap"><div class="n2-h">转发表</div>${tab}</div></div>`;
}

export const switchEngine = {
  name: 'switch', title: '交换机自学习', parse: swParse, run: swRun, view: swView,
  // 只写结果：最后转发表里每台主机在几号端口（还不知道的写 -）
  quiz(input, r) {
    const t = new Map(r.table);
    const names = [...input.hosts.keys()];
    return { q: `交换机${input.init.length ? `的转发表里原来有 ${input.init.map(([n, p]) => `${n} → ${p}`).join('，')}` : '刚开机'}，主机：${names.map((n) => `${n} 在端口 ${input.hosts.get(n)}`).join('，')}。依次发送 ${input.frames.map((f) => `${f.src}→${f.dst === '*' ? '广播' : f.dst}`).join('，')}。按 ${names.join('、')} 的顺序写出最后转发表里各自的端口（表里没有的写 -）。`, type: 'seq', answer: names.map((n) => (t.has(n) ? String(t.get(n)) : '-')).join(' ') };
  },
  // 考卷上那张表：每一帧从哪些端口转发（点一下打 √），转发表有没有新记一项
  table(input, r) {
    const all = Array.from({ length: input.ports }, (_, i) => i + 1);
    return {
      q: '每一帧从哪些端口转发出去？（点格子打 √）转发表这一帧新记（或改）了一项吗？', dir: 'row',
      head: [...all.map((p) => `端口 ${p}`), '新记一项'],
      rows: r.log.map((x, i) => ({ label: `${i + 1}. ${x.f.src}→${x.f.dst === '*' ? '广播' : x.f.dst}`, cells: [...all.map((p) => ({ v: x.out.includes(p) ? '√' : '', mark: true })), { v: x.learn !== 'have' && input.mistake !== 'noLearn' ? '√' : '', mark: true }] })),
    };
  },
  // 常见错法：不学地址（每帧都扩散）、扩散时连进来的端口也发、目的在同一个端口还转发
  variants(input) {
    return differing(switchEngine, input, [
      { label: '像是交换机没有记源地址，每一帧都扩散（王道：交换机每收到一帧都先记下源地址和进来的端口，以后发往它的帧就只走那个端口）', input: { ...input, mistake: 'noLearn' } },
      { label: '像是扩散时连进来的那个端口也发了（王道：扩散是除了进来的端口以外都发）', input: { ...input, mistake: 'floodAll' } },
      { label: '像是目的主机和源在同一个端口也转发了（王道：目的地址对应的就是进来的端口时，交换机丢弃这一帧，这就是过滤）', input: { ...input, mistake: 'noFilter' } },
    ]);
  },
};

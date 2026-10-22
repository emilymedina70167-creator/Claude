// 计算机网络的演示引擎（纯函数，不碰 DOM；tests/cn-engine.test.js）：
//   subnet  IP 地址和子网：一个地址 /前缀（网络地址、广播地址、可用主机）、划分子网（等分或按主机数）、最长前缀匹配、路由聚合
//   tcp     TCP 的拥塞控制（cwnd 每个 RTT 怎么变，Reno / Tahoe）、三次握手和四次挥手的序号
//   window  滑动窗口协议：停止-等待、后退 N 帧（GBN）、选择重传（SR），时序图
import { chips, esc } from './arrayview.js';
import { bitFields } from './bitview.js';

// 一个 run 里学生能答的：每个 ask（题面 → 答案）、quiz 和填表的答案。
// 错法算出来和对的完全一样就不列（differing）：列着也认不出什么，还让人以为这组数能诊断出它
function answersOf(engine, input, r, fields) {
  const asks = r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter(Boolean).map((a) => [a.q, a.alts ?? a.answer]);
  const get = (f) => { try { return f() ?? null; } catch { return null; } };
  const quiz = get(() => engine.quiz(input, r, fields).answer);
  const t = get(() => engine.table(input, r, fields));
  return JSON.stringify([asks, quiz, t && t.rows.map((row) => row.cells.map((c) => c.v))]);
}
function differing(engine, input, list, fields = {}) {
  let base;
  try { base = answersOf(engine, input, engine.run(input), fields); } catch { return list; }
  return list.filter((v) => { try { return answersOf(engine, v.input, engine.run(v.input), fields) !== base; } catch { return false; } });
}

// ================= subnet =================

export function parseIp(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s).trim());
  if (!m || m.slice(1).some((x) => Number(x) > 255)) throw new Error(`IP 地址写成 192.168.1.10（四段，每段 0～255），「${s}」不对`);
  return m.slice(1).reduce((a, x) => a * 256 + Number(x), 0);
}
export function parseCidr(s) {
  const m = /^(.+?)\/(\d{1,2})$/.exec(String(s).trim());
  if (!m || Number(m[2]) > 32) throw new Error(`写成 192.168.1.0/24（地址 / 前缀长度），「${s}」不对`);
  return { ip: parseIp(m[1]), len: Number(m[2]) };
}
export const ipText = (v) => [24, 16, 8, 0].map((k) => Math.floor(v / 2 ** k) % 256).join('.');
const maskOf = (len) => (len === 0 ? 0 : (2 ** 32 - 2 ** (32 - len)));
const netOf = (ip, len) => ip - (ip % 2 ** (32 - len));
const bcastOf = (ip, len) => netOf(ip, len) + 2 ** (32 - len) - 1;
const bin32 = (v) => v.toString(2).padStart(32, '0');
const dotted = (b) => b.match(/.{8}/g).join('.');

function subnetParse(fields) {
  if (fields.ip) return { mode: 'ip', ...parseCidr(fields.ip) };
  if (fields.split) {
    const base = parseCidr(fields.split);
    if (fields.hosts) {
      const hosts = String(fields.hosts).split(/[\s,，、]+/).filter(Boolean).map((x) => { if (!/^\d+$/.test(x) || Number(x) < 1) throw new Error('hosts: 写每个子网要的主机数，如 60, 30, 10'); return Number(x); });
      return { mode: 'vlsm', base, hosts };
    }
    const n = Number(fields.into ?? fields.n);
    if (!Number.isInteger(n) || n < 2 || (n & (n - 1))) throw new Error('划分子网：写 into: 4（等分成几个，2 的整数次幂），或者 hosts: 60, 30, 10（每个子网要几台主机）');
    return { mode: 'equal', base, n };
  }
  if (fields.table) {
    const rows = String(fields.table).split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
      const m = /^(\S+)\s*(?:->|→|:|：)\s*(.+)$/.exec(x);
      if (!m) throw new Error(`table: 写成 192.168.1.0/24 -> R1（目的网络 -> 下一跳 / 接口），「${x}」不对`);
      const c = parseCidr(m[1]);
      return { ...c, text: m[1], hop: m[2].trim() };
    });
    if (!fields.dst) throw new Error('路由表要写 dst:（要转发的目的地址）');
    return { mode: 'route', rows, dst: parseIp(fields.dst), dstText: String(fields.dst).trim() };
  }
  if (fields.aggregate) {
    const nets = String(fields.aggregate).split(/[,，;；\s]+/).filter(Boolean).map(parseCidr);
    if (nets.length < 2) throw new Error('aggregate: 至少写两个网络');
    return { mode: 'agg', nets };
  }
  throw new Error('subnet 要写 ip:（看一个地址）、split:（划分子网）、table: + dst:（最长前缀匹配）或 aggregate:（路由聚合）');
}

// 常见错法的标记（只在算错法时用）：
//   noMinus2   主机数没减 2（ip：2^h；vlsm：子网大小只要能放下主机数）
//   lastOctet  ip：广播地址只把最后一段写成 255
//   oldRule    equal：按旧规定不用全 0、全 1 的子网号（借 k 位要 2^k − 2 ≥ 子网数，子网号从 1 起）
//   asGiven    vlsm：没有从大到小，按题目给的顺序分
//   bcPlus1    equal / vlsm 的填表：广播地址 = 网络地址 + 地址数（多了 1），最后一个可用跟着多 1
//   firstMatch route：匹配到第一项就用；octet：'up' 按点分十进制整段比，'down' 只比前面的整段
//   aggOff     agg：共同前缀多数（+1）/ 少数（−1）一位；noClear：网络地址没把后面的位清 0
function subnetRun(input) {
  const steps = [];
  if (input.mode === 'ip') {
    const { ip, len } = input;
    const net = netOf(ip, len), h = 32 - len;
    const bc = input.lastOctet ? Math.floor(net / 256) * 256 + 255 : bcastOf(ip, len);
    const v = (extra) => ({ ip, len, ...extra });
    steps.push({ view: v({}), msg: `${ipText(ip)}/${len}：/${len} 是网络前缀的长度。写成二进制看。` });
    steps.push({ view: v({}), msg: `${ipText(ip)}/${len}：前 ${len} 位是网络号，后 ${h} 位是主机号。子网掩码 = ${len} 个 1 后面跟 ${h} 个 0 = ${ipText(maskOf(len))}。`, ask: { tag: 'mask', kind: 'text', q: '子网掩码（点分十进制）是什么？', answer: ipText(maskOf(len)) } });
    steps.push({ view: v({ show: 'net' }), msg: `网络地址：主机号全写 0（也就是地址和掩码按位与）= ${ipText(net)}。`, ask: { tag: 'net', kind: 'text', q: '网络地址是什么？', answer: ipText(net) } });
    steps.push({ view: v({ show: 'bcast' }), msg: `广播地址：主机号全写 1 = ${ipText(bc)}。`, ask: { tag: 'bcast', kind: 'text', q: '广播地址是什么？', answer: ipText(bc) } });
    const n = h >= 2 ? 2 ** h - (input.noMinus2 ? 0 : 2) : 0;
    steps.push({ view: v({ show: 'range' }), msg: h >= 2 ? `可分配的主机地址：${ipText(net + 1)} ～ ${ipText(bc - 1)}，一共 2^${h} − 2 = ${n} 个（去掉网络地址和广播地址）。` : `主机号只有 ${h} 位，没有可分配的主机地址（/31、/32 是特殊用法）。`, ask: { tag: 'hosts', kind: 'number', q: '最多能分配给多少台主机？', answer: n } });
    return { steps, net, bc, n };
  }
  if (input.mode === 'equal' || input.mode === 'vlsm') {
    const { ip, len } = input.base;
    const base = netOf(ip, len);
    const subs = [];
    if (input.mode === 'equal') {
      let k = Math.log2(input.n);
      if (input.oldRule) { k = 2; while (2 ** k - 2 < input.n) k++; }
      const first = input.oldRule ? 1 : 0;
      if (len + k > 30) throw new Error(`/${len} 分成 ${input.n} 个子网，主机号不够了`);
      steps.push({ view: { base, len, subs: [] }, msg: `${ipText(base)}/${len} 等分成 ${input.n} 个子网：从主机号里借 ${k} 位当子网号，每个子网的前缀是 /${len + k}，各有 2^${32 - len - k} 个地址。` });
      for (let i = 0; i < input.n; i++) {
        const s = { ip: base + (i + first) * 2 ** (32 - len - k), len: len + k };
        subs.push(s);
        steps.push({ view: { base, len, subs: subs.slice(), cur: i }, msg: `子网 ${i + 1}（子网号 ${(i + first).toString(2).padStart(k, '0')}）：${ipText(s.ip)}/${s.len}，可用 ${ipText(s.ip + 1)} ～ ${ipText(bcastOf(s.ip, s.len) - 1)}，广播 ${ipText(bcastOf(s.ip, s.len))}。`, ask: { tag: 'subnet', kind: 'text', q: `第 ${i + 1} 个子网的网络地址是什么？`, answer: ipText(s.ip) } });
      }
    } else {
      // asGiven（只在算常见错法时用）：没有从大到小，按题目给的顺序分
      const order = input.hosts.map((x, i) => ({ x, i })).sort((a, b) => (input.asGiven ? a.i - b.i : b.x - a.x || a.i - b.i));
      steps.push({ view: { base, len, subs: [] }, msg: `${ipText(base)}/${len} 按主机数划分（变长子网掩码）：先给要求多的子网分，每个子网的大小是能放下「主机数 + 2」的最小的 2 的幂，地址从小往大依次分。` });
      let next = base;
      const end = bcastOf(base, len);
      for (const { x, i } of order) {
        let h = 2;
        while (2 ** h - (input.noMinus2 ? 0 : 2) < x) h++;
        if (32 - h < len) throw new Error(`第 ${i + 1} 个子网要 ${x} 台主机，整个 /${len} 都放不下`);
        const s = { ip: next, len: 32 - h, need: x, idx: i };
        if (s.ip + 2 ** h - 1 > end) throw new Error(`地址不够了：分到第 ${i + 1} 个子网（${x} 台）时超出了 ${ipText(base)}/${len}`);
        subs.push(s);
        next = s.ip + 2 ** h;
        steps.push({ view: { base, len, subs: subs.slice(), cur: subs.length - 1 }, msg: `${x} 台主机：需要主机号 ${h} 位（2^${h} − 2 = ${2 ** h - 2} ≥ ${x}），前缀 /${32 - h}。分到 ${ipText(s.ip)}/${32 - h}（${ipText(s.ip)} ～ ${ipText(bcastOf(s.ip, s.len))}）。`, ask: { tag: 'subnet', kind: 'text', q: `要 ${x} 台主机的子网分到的网络地址是什么？（写 a.b.c.d/前缀）`, answer: `${ipText(s.ip)}/${32 - h}` } });
      }
      steps.push({ view: { base, len, subs: subs.slice() }, msg: `分完了，剩下 ${ipText(next)} ～ ${ipText(end)} 还没用。` });
    }
    return { steps, subs };
  }
  if (input.mode === 'route') {
    const { rows, dst } = input;
    const hits = [];
    // 比前几位：正确是前缀长度；错法 octet 按 8 位一段取整（'up' 不满的那段整段比，'down' 不满的那段不比）
    const cmp = (len) => (input.octet === 'up' ? Math.ceil(len / 8) * 8 : input.octet === 'down' ? Math.floor(len / 8) * 8 : len);
    steps.push({ view: { rows, dst, checked: [] }, msg: `目的地址 ${input.dstText}：拿它和路由表的每一项比，看前缀（前「长度」位）一不一样；能匹配的有好几项时，选前缀最长的（最长前缀匹配）。` });
    rows.forEach((r, i) => {
      const ok = netOf(dst, cmp(r.len)) === netOf(r.ip, cmp(r.len));
      if (ok) hits.push(i);
      steps.push({ view: { rows, dst, checked: rows.slice(0, i + 1).map((_, j) => j), hits: hits.slice(), cur: i }, msg: `${r.text}：目的地址的前 ${r.len} 位是 ${ipText(netOf(dst, r.len))}，${ok ? '和它一样，匹配' : `不等于 ${ipText(netOf(r.ip, r.len))}，不匹配`}。`, ask: { tag: 'match', kind: 'choice', q: `${input.dstText} 和 ${r.text} 匹配吗？`, choices: ['匹配', '不匹配'], answer: ok ? '匹配' : '不匹配' } });
    });
    // firstMatch（只在算常见错法时用）：匹配到第一项就用，没比前缀长短
    const best = hits.length ? (input.firstMatch ? hits[0] : hits.reduce((a, b) => (rows[b].len > rows[a].len ? b : a))) : -1;
    steps.push({ view: { rows, dst, checked: rows.map((_, j) => j), hits, best }, msg: best >= 0 ? `匹配的有 ${hits.map((j) => rows[j].text).join('、')}，前缀最长的是 ${rows[best].text}：从 ${rows[best].hop} 转发。` : '一项都不匹配，又没有默认路由（0.0.0.0/0）：丢弃，发 ICMP 终点不可达。', ask: best >= 0 ? { tag: 'hop', kind: 'pick', q: '最后从哪一项转发？在路由表里点出来。', answer: String(best + 1) } : undefined });
    return { steps, hop: best >= 0 ? rows[best].hop : null, matches: rows.map((_, i) => hits.includes(i)) };
  }
  // 路由聚合：最长的共同前缀
  const { nets } = input;
  let k0 = 0;
  const bins = nets.map((x) => bin32(x.ip));
  while (k0 < Math.min(...nets.map((x) => x.len)) && bins.every((b) => b[k0] === bins[0][k0])) k0++;
  const k = Math.max(0, Math.min(32, k0 + (input.aggOff || 0)));
  // 错法（多数、少数一位）的地址从最小的那个网络截：学生一般拿第一个（最小的）网络来写
  const low = Math.min(...nets.map((x) => x.ip));
  const agg = { ip: input.noClear ? low : netOf(low, k), len: k };
  steps.push({ view: { nets, k: 0 }, msg: `把 ${nets.length} 个网络写成二进制，从左往右找它们共同的前缀。` });
  steps.push({ view: { nets, k }, msg: `前 ${k} 位都一样（第 ${k + 1} 位开始不同${k === Math.min(...nets.map((x) => x.len)) ? '，或者到了最短的那个前缀' : ''}），聚合成 ${ipText(agg.ip)}/${k}。`, ask: { tag: 'agg', kind: 'text', q: '聚合以后的网络是什么？（写 a.b.c.d/前缀）', answer: `${ipText(agg.ip)}/${k}` } });
  return { steps, agg };
}

function ipBits(ip, len, { label } = {}) {
  return `<div class="cn-ip">${label ? `<span class="cn-h">${esc(label)}</span>` : ''}${bitFields(BigInt(ip), [{ name: `网络号 /${len}`, bits: len, cls: 'bv-a' }, { name: '主机号', bits: 32 - len, cls: 'bv-c' }].filter((f) => f.bits > 0), { values: false })}</div>`;
}

function subnetView(s, input) {
  if (input.mode === 'ip') {
    let h = ipBits(s.ip, s.len, { label: `${ipText(s.ip)}/${s.len}` });
    const net = netOf(s.ip, s.len), bc = bcastOf(s.ip, s.len);
    const rows = [['子网掩码', ipText(maskOf(s.len))], ...(s.show ? [['网络地址', ipText(net)]] : []), ...(['bcast', 'range'].includes(s.show) ? [['广播地址', ipText(bc)]] : []), ...(s.show === 'range' && s.len <= 30 ? [['可用地址', `${ipText(net + 1)} ～ ${ipText(bc - 1)}`]] : [])];
    return h + `<div class="cn-kv">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
  }
  if (input.mode === 'equal' || input.mode === 'vlsm') {
    let h = ipBits(s.base, s.len, { label: `${ipText(s.base)}/${s.len}` });
    // 地址条：整个块按比例画出各个子网
    const total = 2 ** (32 - s.len);
    h += `<div class="cn-bar">${s.subs.map((x, i) => `<div class="cn-seg${s.cur === i ? ' cn-cur' : ''}" style="left:${((x.ip - s.base) / total) * 100}%;width:${(2 ** (32 - x.len) / total) * 100}%" data-cmd="${i + 1}" data-label="${ipText(x.ip)}"><span>/${x.len}</span></div>`).join('')}</div>`;
    h += `<div class="sv-gtbl-wrap"><table class="sv-gtbl"><thead><tr><th>子网</th>${input.mode === 'vlsm' ? '<th>主机数</th>' : ''}<th>网络地址</th><th>可用地址</th><th>广播地址</th></tr></thead><tbody>${s.subs.map((x, i) => `<tr class="${s.cur === i ? 'cn-row-cur' : ''}"><td>${input.mode === 'vlsm' ? `第 ${x.idx + 1} 个` : i + 1}</td>${input.mode === 'vlsm' ? `<td>${x.need}</td>` : ''}<td>${ipText(x.ip)}/${x.len}</td><td>${ipText(x.ip + 1)} ～ ${ipText(bcastOf(x.ip, x.len) - 1)}</td><td>${ipText(bcastOf(x.ip, x.len))}</td></tr>`).join('')}</tbody></table></div>`;
    return h;
  }
  if (input.mode === 'route') {
    let h = `<div class="cn-ip"><span class="cn-h">目的地址 ${esc(input.dstText)}</span><div class="cn-dst">${dotted(bin32(s.dst))}</div></div>`;
    h += `<div class="sv-gtbl-wrap"><table class="sv-gtbl cn-rt"><thead><tr><th>#</th><th>目的网络</th><th>下一跳</th><th>匹配</th></tr></thead><tbody>${s.rows.map((r, i) => { const seen = s.checked.includes(i); const hit = s.hits?.includes(i); return `<tr class="${s.best === i ? 'cn-best' : s.cur === i ? 'cn-row-cur' : ''}"><td data-pick="${i + 1}" data-cmd="${i + 1}">${i + 1}</td><td>${esc(r.text)}</td><td>${esc(r.hop)}</td><td>${seen ? (hit ? `✓（/${r.len}）` : '✗') : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
    return h;
  }
  const lines = s.nets.map((x) => { const b = bin32(x.ip); return `<div class="cn-agg"><span>${ipText(x.ip)}/${x.len}</span><code><b>${dotted(b).slice(0, s.k + Math.floor(s.k / 8))}</b>${dotted(b).slice(s.k + Math.floor(s.k / 8))}</code></div>`; });
  return `<div class="cn-aggs">${lines.join('')}</div>${s.k ? chips([['共同前缀', `${s.k} 位`]]) : ''}`;
}

export const subnetEngine = {
  name: 'subnet',
  title: 'IP 和子网',
  parse: subnetParse,
  run: subnetRun,
  view: subnetView,
  quiz(input, r, fields) {
    if (input.mode === 'ip') {
      const what = String(fields.quiz || 'net').toLowerCase();
      const q = { net: '网络地址', bcast: '广播地址', hosts: '可分配的主机地址个数', mask: '子网掩码' }[what];
      if (!q) throw new Error('quiz: 写 net、bcast、hosts 或 mask');
      return { q: `${ipText(input.ip)}/${input.len} 的${q}是什么？`, type: 'seq', answer: what === 'net' ? ipText(r.net) : what === 'bcast' ? ipText(r.bc) : what === 'hosts' ? String(r.n) : ipText(maskOf(input.len)) };
    }
    if (input.mode === 'route') return { q: `目的地址 ${input.dstText}，按最长前缀匹配，从哪个下一跳转发？`, qhtml: `<div class="sv-gtbl-wrap"><table class="sv-gtbl"><thead><tr><th>目的网络</th><th>下一跳</th></tr></thead><tbody>${input.rows.map((x) => `<tr><td>${esc(x.text)}</td><td>${esc(x.hop)}</td></tr>`).join('')}</tbody></table></div>`, type: 'seq', answer: r.hop ?? '丢弃' };
    if (input.mode === 'agg') return { q: `把 ${input.nets.map((x) => `${ipText(x.ip)}/${x.len}`).join('、')} 聚合成一个网络。`, type: 'seq', answer: `${ipText(r.agg.ip)}/${r.agg.len}` };
    throw new Error('划分子网没有 quiz 模式，用 mode: fill（自己填表）或 ask: subnet 一个个问');
  },
  // 考卷上那张表
  table(input, r) {
    if (input.mode === 'ip') {
      return {
        q: `${ipText(input.ip)}/${input.len}：写出子网掩码、网络地址、广播地址和最多能分配的主机数。`,
        qhtml: '', dir: 'row', head: ['写出来'],
        rows: [
          { label: '子网掩码', cells: [{ v: ipText(maskOf(input.len)) }] },
          { label: '网络地址', cells: [{ v: ipText(r.net) }] },
          { label: '广播地址', cells: [{ v: ipText(r.bc) }] },
          { label: '可分配主机数', cells: [{ v: String(r.n), num: true }] },
        ],
      };
    }
    if (input.mode === 'equal' || input.mode === 'vlsm') {
      const label = (s, i) => (input.mode === 'vlsm' ? `${s.need} 台` : `子网 ${i + 1}`);
      return {
        q: input.mode === 'vlsm' ? `把 ${ipText(input.base.ip)}/${input.base.len} 按主机数 ${input.hosts.join('、')} 划分（主机数多的先分，地址从小往大）。每个子网写网络地址（a.b.c.d/前缀）、子网掩码、第一个和最后一个可分配地址、广播地址。` : `把 ${ipText(input.base.ip)}/${input.base.len} 等分成 ${input.n} 个子网，每个子网写网络地址（a.b.c.d/前缀）、子网掩码、第一个和最后一个可分配地址、广播地址。`,
        qhtml: '', dir: 'row',
        head: ['网络地址', '子网掩码', '第一个可用', '最后一个可用', '广播地址'],
        rows: r.subs.map((s, i) => { const bc = bcastOf(s.ip, s.len) + (input.bcPlus1 ? 1 : 0); return { label: label(s, i), cells: [{ v: `${ipText(s.ip)}/${s.len}` }, { v: ipText(maskOf(s.len)) }, { v: ipText(s.ip + 1) }, { v: ipText(bc - 1) }, { v: ipText(bc) }] }; }),
      };
    }
    if (input.mode === 'route') return { q: `目的地址 ${input.dstText}：哪几项匹配？最后从哪个下一跳转发？`, qhtml: '', dir: 'row', head: ['匹配吗', '前缀长度'], rows: input.rows.map((x, i) => ({ label: x.text, cells: [{ v: r.matches[i] ? '√' : '', mark: true }, { v: String(x.len), given: true }] })).concat([{ label: '下一跳', cells: [{ v: r.hop ?? '丢弃' }, { v: '', given: true }] }]) };
    return { q: `把 ${input.nets.map((x) => `${ipText(x.ip)}/${x.len}`).join('、')} 聚合成一个网络。`, qhtml: '', dir: 'row', head: ['写出来'], rows: [{ label: '共同前缀有几位', cells: [{ v: String(r.agg.len), num: true }] }, { label: '聚合后', cells: [{ v: `${ipText(r.agg.ip)}/${r.agg.len}` }] }] };
  },
  // 常见错法：主机数忘了减 2；广播地址只改了最后一段；旧规定的全 0 全 1 子网号；广播地址多 1；没有从大到小分；
  // 最长前缀匹配用成了「第一个匹配的」、按点分十进制整段比；聚合时前缀多数 / 少数一位、网络地址没清 0
  variants(input, fields) {
    const bcPlus1 = { label: '像是广播地址多算了 1，写成了下一个子网的网络地址（王道：广播地址 = 网络地址 + 地址数 − 1，最后一个可用地址再减 1）', input: { ...input, bcPlus1: true } };
    const out = {
      ip: [
        { label: '像是主机数忘了减 2（王道：主机号全 0 是网络地址、全 1 是广播地址，都不能分给主机，2^主机位数 − 2）', input: { ...input, noMinus2: true } },
        { label: '像是广播地址只把最后一段写成了 255（王道：主机号的每一位都写 1，前缀不是 24 时要写成二进制看）', input: { ...input, lastOctet: true } },
      ],
      equal: [
        { label: '像是按旧规定去掉了全 0、全 1 的子网号（现在 CIDR 允许用：分成 2^k 个子网借 k 位就够，子网号从 0 起）', input: { ...input, oldRule: true } },
        bcPlus1,
      ],
      vlsm: [
        { label: '像是算主机位时忘了减 2（网络地址和广播地址不能分给主机）', input: { ...input, noMinus2: true } },
        { label: '像是没有先给主机多的子网分（按题目给的顺序分了）', input: { ...input, asGiven: true } },
        bcPlus1,
      ],
      route: [
        { label: '像是用了第一个匹配的表项，没比前缀长短', input: { ...input, firstMatch: true } },
        { label: '像是按点分十进制整段比的（王道：前缀不是 8 的倍数时，那一段要写成二进制，只比前面几位）', input: { ...input, octet: 'up' } },
        { label: '像是只比了前面完整的几段，不满 8 位的那一段没比（王道：要写成二进制，比满前缀长度那么多位）', input: { ...input, octet: 'down' } },
      ],
      agg: [
        { label: '像是共同前缀多数了一位（王道：写成二进制，从左往右数到第一个不一样的位为止）', input: { ...input, aggOff: 1 } },
        { label: '像是共同前缀少数了一位（王道：写成二进制，从左往右数到第一个不一样的位为止）', input: { ...input, aggOff: -1 } },
        { label: '像是网络地址没把共同前缀后面的位清 0（直接写了第一个网络的地址）', input: { ...input, noClear: true } },
      ],
    }[input.mode] || [];
    return differing(subnetEngine, input, out, fields);
  },
};

// ================= tcp =================

function tcpParse(fields) {
  if (fields.send !== undefined || fields.lens !== undefined) return dataParse(fields);
  if (fields.handshake !== undefined || fields.close !== undefined) {
    const nums = {};
    for (const m of String(fields.handshake ?? fields.close ?? '').matchAll(/([xyuvw])\s*=\s*(\d+)/gi)) nums[m[1].toLowerCase()] = Number(m[2]);
    const close = fields.close !== undefined;
    const need = close ? ['u', 'v', 'w'] : ['x', 'y'];
    for (const k of need) if (nums[k] === undefined) throw new Error(close ? 'close: 写客户端、服务器的序号，如 close: u=500, v=800, w=900' : 'handshake: 写两边的初始序号，如 handshake: x=100, y=300');
    return { mode: close ? 'close' : 'hand', ...nums };
  }
  const ssthresh = Number(fields.ssthresh);
  if (!(ssthresh >= 2)) throw new Error('tcp 要写 ssthresh:（慢开始门限，如 16），或者 handshake: x=100, y=300（三次握手）、close: u=…, v=…, w=…（四次挥手）、send: 70 100 配 last: 180（传数据）');
  const rounds = fields.rounds === undefined ? 20 : Number(fields.rounds);
  if (!Number.isInteger(rounds) || rounds < 2 || rounds > 40) throw new Error('rounds: 看几个传输轮次（2 到 40，默认 20）');
  const events = {};
  for (const part of String(fields.events || '').split(/[,，;；\s]+/).filter(Boolean)) {
    const m = /^(3dup|dup|timeout|超时|三个重复确认)@(\d+)$/i.exec(part);
    if (!m) throw new Error(`events: 写成 3dup@12（第 12 轮收到 3 个重复确认）或 timeout@16（第 16 轮超时），「${part}」不对`);
    events[Number(m[2])] = /^(3dup|dup|三个重复确认)$/i.test(m[1]) ? '3dup' : 'timeout';
  }
  const variant = String(fields.variant || 'reno').trim().toLowerCase();
  if (!['reno', 'tahoe'].includes(variant)) throw new Error('variant: 写 reno（快重传 + 快恢复，默认）或 tahoe');
  return { mode: 'cwnd', ssthresh, rounds, events, variant, init: Number(fields.init || 1) };
}

// mistake（只在算常见错法时用）：'noCap' 慢开始翻倍不封顶（越过 ssthresh）；'halfSs' 拥塞时把原来的 ssthresh 减半（应该是 cwnd 的一半）；
// 'timeoutFast' 超时也按快恢复处理（cwnd = 新的 ssthresh，不回到 1）
function cwndRun({ ssthresh: s0, rounds, events, variant, init, mistake }) {
  const steps = [];
  const series = [];
  let cwnd = init, ss = s0;
  steps.push({ view: { series: [], ss }, msg: `一开始 cwnd = ${init}，ssthresh = ${s0}。cwnd < ssthresh 时慢开始（每个轮次翻倍，不超过 ssthresh），到了 ssthresh 就拥塞避免（每个轮次加 1）。${variant === 'reno' ? '收到 3 个重复确认：快重传 + 快恢复，ssthresh 和 cwnd 都变成一半；超时：ssthresh 变成一半、cwnd 回到 1。' : 'Tahoe：收到 3 个重复确认和超时一样，ssthresh 变成一半、cwnd 回到 1。'}` });
  for (let k = 1; k <= rounds; k++) {
    const phase = cwnd < ss ? '慢开始' : '拥塞避免';
    series.push({ k, cwnd, ss, phase, ev: events[k] });
    const ask = { tag: 'cwnd', kind: 'number', q: `第 ${k} 个传输轮次的 cwnd 是多少？`, answer: cwnd };
    const ev = events[k];
    let msg = `第 ${k} 轮：cwnd = ${cwnd}（${phase}${phase === '慢开始' ? '' : `，cwnd ≥ ssthresh = ${ss}`}）。`;
    let next;
    if (ev) {
      const half = Math.max(Math.floor((mistake === 'halfSs' ? ss : cwnd) / 2), 2);
      if ((ev === 'timeout' && mistake !== 'timeoutFast') || (ev !== 'timeout' && variant === 'tahoe')) { msg += `这一轮${ev === 'timeout' ? '超时' : '收到 3 个重复确认（Tahoe 当成超时）'}：ssthresh = cwnd / 2 = ${half}，cwnd 回到 1，重新慢开始。`; ss = half; next = 1; }
      else { msg += `这一轮收到 3 个重复确认：快重传；快恢复：ssthresh = cwnd / 2 = ${half}，cwnd = ssthresh = ${half}，接着拥塞避免。`; ss = half; next = half; }
    } else next = cwnd < ss ? (mistake === 'noCap' ? cwnd * 2 : Math.min(cwnd * 2, ss)) : cwnd + 1;
    steps.push({ view: { series: series.slice(), ss }, msg, ask });
    cwnd = next;
  }
  steps.push({ view: { series: series.slice(), ss }, msg: `一共 ${rounds} 轮，cwnd 依次是 ${series.map((x) => x.cwnd).join(' ')}。` });
  return { steps, series };
}

function handRun(input) {
  const steps = [];
  const msgs = [];
  const v = (extra = {}) => ({ msgs: msgs.slice(), ...extra });
  if (input.mode === 'hand') {
    const { x, y } = input;
    steps.push({ view: v({ st: ['CLOSED', 'LISTEN'] }), msg: `三次握手：客户端初始序号 x = ${x}，服务器初始序号 y = ${y}。SYN 报文段不带数据，但要消耗一个序号。` });
    msgs.push({ dir: 1, text: `SYN=1, seq=${x}` });
    steps.push({ view: v({ st: ['SYN-SENT', 'LISTEN'] }), msg: `① 客户端 → 服务器：SYN = 1，seq = ${x}（连接请求）。客户端进入 SYN-SENT。` });
    msgs.push({ dir: -1, text: `SYN=1, ACK=1, seq=${y}, ack=${x + 1}` });
    steps.push({ view: v({ st: ['SYN-SENT', 'SYN-RCVD'] }), msg: `② 服务器 → 客户端：SYN = 1，ACK = 1，seq = ${y}，ack = x + 1 = ${x + 1}（同意连接，期望收到客户端的下一个序号是 ${x + 1}）。服务器进入 SYN-RCVD。`, ask: { tag: 'ack', kind: 'number', q: '服务器的确认报文段里，确认号 ack 是多少？', answer: x + 1 } });
    msgs.push({ dir: 1, text: `ACK=1, seq=${x + 1}, ack=${y + 1}` });
    steps.push({ view: v({ st: ['ESTABLISHED', 'ESTABLISHED'] }), msg: `③ 客户端 → 服务器：ACK = 1，seq = ${x + 1}，ack = y + 1 = ${y + 1}。这个报文段可以带数据（不带数据就不消耗序号）。双方进入 ESTABLISHED。`, ask: { tag: 'seq', kind: 'number', q: '第三次握手的报文段，序号 seq 是多少？', answer: x + 1 } });
    return { steps };
  }
  const { u, v: vv, w } = input;
  steps.push({ view: v({ st: ['ESTABLISHED', 'ESTABLISHED'] }), msg: `四次挥手：客户端已经发完数据，最后一个字节的序号是 ${u - 1}（所以 FIN 的序号 u = ${u}）；服务器这边的序号 v = ${vv}。` });
  msgs.push({ dir: 1, text: `FIN=1, seq=${u}` });
  steps.push({ view: v({ st: ['FIN-WAIT-1', 'ESTABLISHED'] }), msg: `① 客户端 → 服务器：FIN = 1，seq = ${u}。FIN 不带数据也消耗一个序号。客户端进入 FIN-WAIT-1。` });
  msgs.push({ dir: -1, text: `ACK=1, seq=${vv}, ack=${u + 1}` });
  steps.push({ view: v({ st: ['FIN-WAIT-2', 'CLOSE-WAIT'] }), msg: `② 服务器 → 客户端：ACK = 1，seq = ${vv}，ack = u + 1 = ${u + 1}。服务器进入 CLOSE-WAIT（半关闭：服务器还能继续发数据），客户端收到后进入 FIN-WAIT-2。`, ask: { tag: 'ack', kind: 'number', q: '服务器确认客户端的 FIN，确认号 ack 是多少？', answer: u + 1 } });
  msgs.push({ dir: -1, text: `FIN=1, ACK=1, seq=${w}, ack=${u + 1}` });
  steps.push({ view: v({ st: ['FIN-WAIT-2', 'LAST-ACK'] }), msg: `③ 服务器也发完了：FIN = 1，ACK = 1，seq = ${w}，ack = ${u + 1}（还是 u + 1：这期间客户端没再发数据）。服务器进入 LAST-ACK。` });
  msgs.push({ dir: 1, text: `ACK=1, seq=${u + 1}, ack=${w + 1}` });
  steps.push({ view: v({ st: ['TIME-WAIT', 'CLOSED'] }), msg: `④ 客户端 → 服务器：ACK = 1，seq = ${u + 1}，ack = w + 1 = ${w + 1}。服务器收到就关闭；客户端进入 TIME-WAIT，等 2MSL 才关闭（防止最后这个 ACK 丢了，服务器重发 FIN 时还能再确认）。`, ask: { tag: 'ack', kind: 'number', q: '客户端最后一个确认报文段的确认号 ack 是多少？', answer: w + 1 } });
  return { steps };
}

// —— 传数据：序号、确认号（累积确认），中间丢了一个时接收方先暂存失序的报文段 ——
// 两种写法：send: 70 100 配 last: 180（各报文段的序号 + 最后的确认号，要算每段多长），或 seq: 70 配 lens: 30 80（第一个序号 + 每段的长度）
function dataParse(fields) {
  const nums = (src, what) => String(src ?? '').split(/[\s,，、]+/).filter(Boolean).map((x) => { const n = Number(x); if (!Number.isInteger(n) || n < 0) throw new Error(`${what}写非负整数，「${x}」不对`); return n; });
  let segs, given;
  if (fields.send !== undefined) {
    const seqs = nums(fields.send, 'send: 各报文段的序号');
    const last = Number(fields.last);
    if (seqs.length < 1 || seqs.length > 8) throw new Error('send: 写 1～8 个报文段的序号（依次发送，连续的）');
    if (!Number.isInteger(last)) throw new Error('send: 要配 last:（最后一个报文段到达后的确认号），才算得出最后一段多长');
    const all = [...seqs, last];
    for (let i = 1; i < all.length; i++) if (all[i] <= all[i - 1]) throw new Error(`序号要一个比一个大：${all[i - 1]} 后面是 ${all[i]}`);
    segs = seqs.map((q, i) => ({ i: i + 1, seq: q, len: all[i + 1] - q }));
    given = 'seq';
  } else {
    const lens = nums(fields.lens, 'lens: 每个报文段的数据长度');
    const seq0 = Number(fields.seq);
    if (!Number.isInteger(seq0) || seq0 < 0) throw new Error('lens: 要配 seq:（第一个报文段的序号）');
    if (lens.length < 1 || lens.length > 8 || lens.some((x) => x < 1)) throw new Error('lens: 写 1～8 个报文段的长度（字节，至少 1）');
    let q = seq0;
    segs = lens.map((len, i) => { const x = { i: i + 1, seq: q, len }; q += len; return x; });
    given = 'len';
  }
  const lost = new Set(nums(fields.lost, 'lost: 第一次发送时丢了的报文段（第几个）'));
  for (const k of lost) if (k < 1 || k > segs.length) throw new Error(`lost: 写第几个报文段（1～${segs.length}）`);
  return { mode: 'data', segs, given, lost };
}

// mistake：'ackLast' 确认号写成收到的最后一个字节的序号（少 1）；'noBuffer' 接收方丢掉失序的报文段（重传后只确认到重传的那一段）；
// 'lossAck' 失序的报文段到了也确认到它的末尾（当成了选择确认）
function dataRun({ segs, given, lost, mistake }) {
  const steps = [];
  const msgs = [];
  const v = (extra = {}) => ({ msgs: msgs.slice(), ...extra });
  let exp = segs[0].seq;
  const buf = [];
  const acks = [];
  const ackOut = (n) => (mistake === 'ackLast' ? n - 1 : n);
  // 收到一段：按序的往前推，失序的暂存；返回发回的确认号
  const receive = (g) => {
    if (g.seq === exp) {
      exp = g.seq + g.len;
      for (let moved = true; moved;) { moved = false; const k = buf.findIndex((b) => b.seq === exp); if (k >= 0 && mistake !== 'noBuffer') { exp += buf[k].len; buf.splice(k, 1); moved = true; } }
      return ackOut(exp);
    }
    if (g.seq > exp && mistake !== 'noBuffer') buf.push(g);
    return mistake === 'lossAck' ? ackOut(g.seq + g.len) : ackOut(exp);
  };
  steps.push({ view: v(), msg: `主机 A 向 B 连续发送 ${segs.length} 个报文段${given === 'seq' ? `，序号依次是 ${segs.map((g) => g.seq).join('、')}；最后一个到达后 B 的确认号是 ${segs.at(-1).seq + segs.at(-1).len}` : `，第一个的序号是 ${segs[0].seq}，数据依次是 ${segs.map((g) => g.len).join('、')} 字节`}。TCP 的序号按字节编，确认号是「期望收到的下一个字节的序号」（累积确认）。${lost.size ? `第 ${[...lost].join('、')} 个第一次发送时丢了。` : ''}` });
  for (const g of segs) {
    const isLost = lost.has(g.i);
    msgs.push({ dir: 1, text: `seq=${g.seq}，${g.len} 字节`, lost: isLost });
    const sendAsk = given === 'seq' ? { tag: 'len', kind: 'number', q: `第 ${g.i} 个报文段带多少字节数据？`, answer: g.len } : g.i > 1 ? { tag: 'seq', kind: 'number', q: `第 ${g.i} 个报文段的序号是多少？`, answer: g.seq } : undefined;
    steps.push({ view: v({ cur: msgs.length - 1 }), msg: `A 发第 ${g.i} 个：seq = ${g.seq}，带 ${g.len} 字节（第 ${g.seq}～${g.seq + g.len - 1} 号字节）${given === 'seq' ? `：长度 = 下一个序号 − 这个序号 = ${g.seq + g.len} − ${g.seq}` : ''}。${isLost ? '这个报文段在路上丢了。' : ''}`, ask: sendAsk });
    if (isLost) continue;
    const inOrder = g.seq === exp;
    const a = receive(g);
    acks.push(a);
    msgs.push({ dir: -1, text: `ACK，ack=${a}` });
    steps.push({ view: v({ cur: msgs.length - 1 }), msg: inOrder ? `B 收到第 ${g.i} 个（正是期望的 ${g.seq}）：期望的下一个字节是 ${g.seq} + ${g.len} = ${g.seq + g.len}${a !== g.seq + g.len && mistake !== 'ackLast' ? `，再接上暂存的，确认到 ${a}` : ''}，发回 ack = ${a}。` : `B 收到第 ${g.i} 个，可它期望的是 ${exp}（前面的还没到）：失序，先暂存；确认号还是 ${exp}（重复确认）。`, ask: { tag: 'ack', kind: 'number', q: `B 收到第 ${g.i} 个报文段以后，发回的确认号是多少？`, answer: a } });
  }
  // 丢了的，超时以后重传；B 收到后连同暂存的一起确认
  for (const g of segs.filter((x) => lost.has(x.i))) {
    msgs.push({ dir: 1, text: `重传 seq=${g.seq}，${g.len} 字节`, re: true });
    const before = exp;
    const a = receive(g);
    acks.push(a);
    msgs.push({ dir: -1, text: `ACK，ack=${a}` });
    steps.push({ view: v({ cur: msgs.length - 1 }), msg: `A 等不到第 ${g.i} 个的确认（超时，或收到 3 个重复确认），重传 seq = ${g.seq}。B 收到后从 ${before} 接上${a > g.seq + g.len ? `暂存的报文段，一直确认到 ${a}` : ''}：发回 ack = ${a}。`, ask: { tag: 'ack', kind: 'number', q: `B 收到重传的第 ${g.i} 个报文段以后，发回的确认号是多少？`, answer: a } });
  }
  steps.push({ view: v({ done: true }), msg: `B 发回的确认号依次是 ${acks.join('、')}。` });
  return { steps, acks, exp };
}

function dataSvg(s) {
  const W = 520, top = 40, gap = 48;
  const H = top + gap * Math.max(s.msgs.length, 3) + 24;
  let g = `<text class="cn-who" x="90" y="20">主机 A</text><text class="cn-who" x="${W - 90}" y="20">主机 B</text><line class="cn-life" x1="90" y1="28" x2="90" y2="${H - 10}"/><line class="cn-life" x1="${W - 90}" y1="28" x2="${W - 90}" y2="${H - 10}"/>`;
  s.msgs.forEach((m, i) => {
    const y1 = top + i * gap, y2 = y1 + gap - 14;
    const [x1, x2] = m.dir > 0 ? [90, W - 90] : [W - 90, 90];
    const end = m.lost ? [x1 + (x2 - x1) * 0.6, y1 + (y2 - y1) * 0.6] : [x2, y2];
    g += `<line class="cn-msg${m.lost ? ' cn-lost' : ''}${m.re ? ' cn-re' : ''}${i === s.cur ? ' cn-new' : ''}" x1="${x1}" y1="${y1}" x2="${end[0]}" y2="${end[1]}"${m.lost ? '' : ' marker-end="url(#cn-arrow2)"'} data-cmd="${i + 1}"/>${m.lost ? `<text class="cn-x" x="${end[0]}" y="${end[1] + 5}">✗</text>` : ''}<text class="cn-msgt" x="${W / 2}" y="${(y1 + y2) / 2 - 6}">${esc(m.text)}</text>`;
  });
  return `<svg class="cn-seq" viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%" role="img" aria-label="时序图"><defs><marker id="cn-arrow2" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" class="cn-arrowhead"/></marker></defs>${g}</svg>`;
}

function cwndSvg(series, ss, rounds) {
  const W = 600, H = 260, pad = 32;
  const maxY = Math.max(ss, ...series.map((x) => Math.max(x.cwnd, x.ss)), 4) + 2;
  const X = (k) => pad + ((k - 1) / Math.max(1, rounds - 1)) * (W - 2 * pad);
  const Y = (v) => H - pad - (v / maxY) * (H - 2 * pad);
  let g = `<line class="cn-axis" x1="${pad}" y1="${H - pad}" x2="${W - pad / 2}" y2="${H - pad}"/><line class="cn-axis" x1="${pad}" y1="${pad / 2}" x2="${pad}" y2="${H - pad}"/>`;
  for (let k = 1; k <= rounds; k++) if (rounds <= 24 || k % 2 === 1) g += `<text class="cn-tk" x="${X(k)}" y="${H - pad + 16}">${k}</text>`;
  for (let v = 0; v <= maxY; v += maxY > 30 ? 8 : 4) g += `<text class="cn-tk cn-tky" x="${pad - 6}" y="${Y(v) + 4}">${v}</text>`;
  // ssthresh：每一段画一条虚线
  series.forEach((x, i) => { const nx = series[i + 1]; g += `<line class="cn-ss" x1="${X(x.k)}" y1="${Y(x.ss)}" x2="${X(nx ? nx.k : x.k + 0.5)}" y2="${Y(x.ss)}"/>`; });
  g += `<polyline class="cn-line" points="${series.map((x) => `${X(x.k)},${Y(x.cwnd)}`).join(' ')}"/>`;
  g += series.map((x, i) => `<circle class="cn-pt ${x.phase === '慢开始' ? 'cn-ss1' : 'cn-ca'}${x.ev ? ' cn-ev' : ''}" cx="${X(x.k)}" cy="${Y(x.cwnd)}" r="${i === series.length - 1 ? 6 : 4}" data-cmd="${x.k}" data-label="${x.k}"/>${x.ev ? `<text class="cn-evt" x="${X(x.k)}" y="${Y(x.cwnd) - 10}">${x.ev === 'timeout' ? '超时' : '3 个重复 ACK'}</text>` : ''}`).join('');
  return `<svg class="cn-cwnd" viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%" role="img" aria-label="拥塞窗口">${g}</svg>`;
}

function handSvg(s) {
  const W = 520, top = 40, gap = 54;
  const H = top + gap * Math.max(s.msgs.length, 3) + 40;
  let g = `<text class="cn-who" x="90" y="20">客户端</text><text class="cn-who" x="${W - 90}" y="20">服务器</text><line class="cn-life" x1="90" y1="28" x2="90" y2="${H - 10}"/><line class="cn-life" x1="${W - 90}" y1="28" x2="${W - 90}" y2="${H - 10}"/>`;
  s.msgs.forEach((m, i) => {
    const y1 = top + i * gap, y2 = y1 + gap - 14;
    const [x1, x2] = m.dir > 0 ? [90, W - 90] : [W - 90, 90];
    g += `<line class="cn-msg${i === s.msgs.length - 1 ? ' cn-new' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#cn-arrow)"/><text class="cn-msgt" x="${W / 2}" y="${(y1 + y2) / 2 - 6}">${esc(m.text)}</text>`;
  });
  if (s.st) g += `<text class="cn-st" x="84" y="${H - 16}" text-anchor="end">${s.st[0]}</text><text class="cn-st" x="${W - 84}" y="${H - 16}" text-anchor="start">${s.st[1]}</text>`;
  return `<svg class="cn-seq" viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%" role="img" aria-label="时序图"><defs><marker id="cn-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" class="cn-arrowhead"/></marker></defs>${g}</svg>`;
}

export const tcpEngine = {
  name: 'tcp',
  title: 'TCP',
  parse: tcpParse,
  run: (input) => (input.mode === 'cwnd' ? cwndRun(input) : input.mode === 'data' ? dataRun(input) : handRun(input)),
  view: (s, input) => (input.mode === 'cwnd' ? cwndSvg(s.series, s.ss, input.rounds) + chips(s.series.length ? [['cwnd', s.series.at(-1).cwnd], ['ssthresh', s.series.at(-1).ss], ['阶段', s.series.at(-1).phase]] : [['ssthresh', s.ss]]) : input.mode === 'data' ? dataSvg(s) : handSvg(s)),
  quiz(input, r, fields) {
    if (input.mode === 'data') return { q: `主机 A 向 B 连续发送 ${input.segs.length} 个报文段，${input.given === 'seq' ? `序号依次是 ${input.segs.map((g) => g.seq).join('、')}` : `第一个序号 ${input.segs[0].seq}，数据依次 ${input.segs.map((g) => g.len).join('、')} 字节`}${input.lost.size ? `，第 ${[...input.lost].join('、')} 个第一次发送时丢了（之后重传）` : ''}。按顺序写出 B 发回的确认号（用空格隔开）。`, type: 'seq', answer: r.acks.join(' ') };
    if (input.mode !== 'cwnd') throw new Error('三次握手、四次挥手没有 quiz 模式，用 ask 问序号和确认号');
    const k = Number(fields.at || input.rounds);
    if (!(k >= 1 && k <= input.rounds)) throw new Error(`at: 写第几轮（1 到 ${input.rounds}）`);
    return { q: `TCP（${input.variant === 'reno' ? 'Reno' : 'Tahoe'}），一开始 cwnd = ${input.init}，ssthresh = ${input.ssthresh}${Object.keys(input.events).length ? `，${Object.entries(input.events).map(([kk, e]) => `第 ${kk} 轮${e === 'timeout' ? '超时' : '收到 3 个重复确认'}`).join('，')}` : ''}。第 ${k} 个传输轮次的 cwnd 是多少？`, type: 'num', answer: String(r.series[k - 1].cwnd) };
  },
  // 考卷上那张表：每一轮的 cwnd 和 ssthresh（一轮一列）
  table(input, r) {
    if (input.mode === 'data') {
      // 每个报文段：序号、长度、B 收到后发回的确认号（丢了的那次不填）；重传的另起一行
      let k = 0;
      const rows = input.segs.map((g) => ({ label: `第 ${g.i} 个`, cells: [{ v: String(g.seq), num: true, given: input.given === 'seq' && true }, { v: String(g.len), num: true, given: input.given === 'len' }, input.lost.has(g.i) ? { v: '丢失', given: true } : { v: String(r.acks[k++]), num: true }] }));
      for (const g of input.segs.filter((x) => input.lost.has(x.i))) rows.push({ label: `重传第 ${g.i} 个`, cells: [{ v: String(g.seq), given: true }, { v: String(g.len), given: true }, { v: String(r.acks[k++]), num: true }] });
      return { q: '填出每个报文段的序号、数据长度，和 B 收到它以后发回的确认号。', qhtml: '', dir: 'row', head: ['序号', '数据长度', 'B 的确认号'], rows };
    }
    if (input.mode !== 'cwnd') return null;
    return {
      q: `TCP（${input.variant === 'reno' ? 'Reno：3 个重复确认时快重传、快恢复' : 'Tahoe：3 个重复确认和超时一样'}），一开始 cwnd = ${input.init}，ssthresh = ${input.ssthresh}${Object.keys(input.events).length ? `，${Object.entries(input.events).map(([kk, e]) => `第 ${kk} 轮${e === 'timeout' ? '超时' : '收到 3 个重复确认'}`).join('，')}` : ''}。填出每一轮的 cwnd 和这一轮的 ssthresh。`,
      qhtml: '', dir: 'col', head: ['cwnd', 'ssthresh'],
      rows: r.series.map((x) => ({ label: x.k, cells: [{ v: String(x.cwnd), num: true }, { v: String(x.ss), num: true }] })),
    };
  },
  // 常见错法：Reno / Tahoe 弄混；慢开始不封顶（越过 ssthresh 还翻倍）；ssthresh 自己减半；超时也快恢复
  variants(input, fields) {
    if (input.mode === 'data') return differing(tcpEngine, input, [
      { label: '像是确认号写成了收到的最后一个字节的序号（确认号是期望收到的下一个字节：序号 + 长度）', input: { ...input, mistake: 'ackLast' } },
      { label: '像是接收方把失序到达的报文段丢掉了（TCP 通常先暂存，重传的那段到了以后一起确认）', input: { ...input, mistake: 'noBuffer' } },
      { label: '像是失序的报文段到了也确认到它的末尾（TCP 是累积确认：前面缺着，确认号就停在缺的那个字节）', input: { ...input, mistake: 'lossAck' } },
    ], fields);
    if (input.mode !== 'cwnd') return [];
    return differing(tcpEngine, input, [
      { label: input.variant === 'reno' ? '像是按 Tahoe 算的（3 个重复确认也让 cwnd 回到 1）' : '像是按 Reno 算的（3 个重复确认时快恢复）', input: { ...input, variant: input.variant === 'reno' ? 'tahoe' : 'reno' } },
      { label: '像是慢开始翻倍越过了 ssthresh（王道：翻倍不超过 ssthresh，到了 ssthresh 就改成每轮加 1）', input: { ...input, mistake: 'noCap' } },
      { label: '像是把原来的 ssthresh 减半了（王道：新的 ssthresh = 出现拥塞时 cwnd 的一半）', input: { ...input, mistake: 'halfSs' } },
      ...(input.variant === 'reno' ? [{ label: '像是超时也做了快恢复（王道：超时 cwnd 一律回到 1、重新慢开始；只有 3 个重复确认才快恢复）', input: { ...input, mistake: 'timeoutFast' } }] : []),
    ], fields);
  },
};

// ================= window：滑动窗口 =================

const PROTO = { sw: '停止-等待协议', gbn: '后退 N 帧协议（GBN）', sr: '选择重传协议（SR）' };

function winParse(fields) {
  const proto = String(fields.proto || '').trim().toLowerCase();
  if (!PROTO[proto]) throw new Error('window 要写 proto:（sw 停止-等待、gbn 后退 N 帧、sr 选择重传）');
  const frames = Number(fields.frames ?? 6);
  if (!Number.isInteger(frames) || frames < 1 || frames > 12) throw new Error('frames: 要发几个数据帧（1 到 12，从 0 编号）');
  const window = proto === 'sw' ? 1 : Number(fields.window ?? 4);
  if (!Number.isInteger(window) || window < 1 || window > 8) throw new Error('window: 发送窗口大小（1 到 8）');
  const list = (src, what) => String(src || '').split(/[\s,，、]+/).filter(Boolean).map((x) => { const n = Number(x); if (!Number.isInteger(n) || n < 0 || n >= frames) throw new Error(`${what}: 写帧号（0 到 ${frames - 1}），「${x}」不对`); return n; });
  const delay = Number(fields.delay ?? 2);
  if (!Number.isInteger(delay) || delay < 1 || delay > 4) throw new Error('delay: 单程传播用几个时间单位（1 到 4，默认 2）');
  const timeout = Number(fields.timeout ?? 2 * delay + 2);
  if (!Number.isInteger(timeout) || timeout <= 2 * delay) throw new Error(`timeout: 超时时间要比一来一回（${2 * delay}）长`);
  return { proto, frames, window, lost: new Set(list(fields.lost, 'lost')), acklost: new Set(list(fields.acklost, 'acklost')), delay, timeout };
}

// 常见错法（只在算错法时用）：resendOne GBN 超时只重传超时的那一帧（像 SR）；resendAll SR 超时把这一帧起已经发出的都重传（像 GBN）；
// cumAck SR 的发送方把确认当成累积确认（前面丢了的确认算被后面的 ACK 带上了）
function winRun({ proto, frames: N, window: W, lost, acklost, delay: D, timeout: TO, resendOne, resendAll, cumAck }) {
  const steps = [];
  const sent = []; // 发过的数据帧：{ f, t, lost }
  const acks = []; // 发过的确认：{ n, t, lost }
  const lostLeft = new Set(lost), ackLostLeft = new Set(acklost);
  let base = 0, next = 0; // 发送窗口：[base, base + W)
  const acked = new Set(); // SR：单独确认过的帧
  const timer = new Map(); // 帧 → 超时的时刻
  const resend = []; // 要重传的帧（按顺序）
  let expect = 0; // 接收方期望的下一个帧（GBN、SW）
  const buf = new Set(); // SR 接收窗口里缓存的帧
  const inflight = []; // { kind: 'data' | 'ack', n, arrive, lost }
  let total = 0;
  const v = (t, extra = {}) => ({ t, sent: sent.map((x) => ({ ...x })), acks: acks.map((x) => ({ ...x })), base, next, acked: [...acked], expect, buf: [...buf], ...extra });
  const name = PROTO[proto];
  steps.push({ view: v(0), msg: `${name}：发 ${N} 个数据帧（0～${N - 1}），发送窗口 ${W}${proto === 'sr' ? `，接收窗口 ${W}` : ''}。每个时间单位最多发一帧，单程传播 ${D} 个单位，超时 ${TO} 个单位（从发出算起）。${proto === 'gbn' ? '接收方只按顺序收，失序的丢掉，回的是累积确认（ACK n：n 号以前都收到了）。' : proto === 'sr' ? '接收方缓存窗口里失序的帧，每个帧单独确认；发送方只重传超时的那一个。' : '每发一帧就等它的确认，等不到就超时重传。'}${lost.size ? `第一次发的 ${[...lost].join('、')} 号帧会丢。` : ''}${acklost.size ? `${[...acklost].join('、')} 号帧的确认第一次会丢。` : ''}` });
  for (let t = 0; t < 200; t++) {
    const ev = [];
    let ask;
    // 1. 到达接收方的数据帧
    for (const x of inflight.filter((y) => y.kind === 'data' && y.arrive === t)) {
      if (x.lost) { ev.push(`${x.n} 号帧在路上丢了`); continue; }
      let ackN = null;
      if (proto === 'sr') {
        if (x.n >= expect && x.n < expect + W) {
          if (x.n === expect) {
            const up = [];
            buf.add(x.n);
            while (buf.has(expect)) { buf.delete(expect); up.push(expect); expect++; }
            ev.push(`接收方收到 ${x.n} 号帧，${up.length > 1 ? `连同缓存的 ${up.slice(1).join('、')} 号一起` : ''}交给上层，回 ACK${x.n}`);
          } else { buf.add(x.n); ev.push(`接收方收到 ${x.n} 号帧（失序，在接收窗口里，先缓存），回 ACK${x.n}`); }
        } else ev.push(`接收方收到 ${x.n} 号帧（已经收过了），再回 ACK${x.n}`);
        ackN = x.n;
      } else if (x.n === expect) { expect++; ackN = x.n; ev.push(`接收方收到 ${x.n} 号帧，按顺序，交给上层，回 ACK${x.n}`); }
      else { ackN = expect - 1; ev.push(`接收方收到 ${x.n} 号帧，不是期望的 ${expect} 号，${proto === 'gbn' ? '丢掉' : '重复的，丢掉'}${ackN >= 0 ? `，再回一次 ACK${ackN}` : ''}`); }
      if (ackN !== null && ackN >= 0) {
        const lostAck = ackLostLeft.has(ackN) && (ackLostLeft.delete(ackN), true);
        acks.push({ n: ackN, t, lost: lostAck });
        inflight.push({ kind: 'ack', n: ackN, arrive: t + D, lost: lostAck });
      }
    }
    // 2. 到达发送方的确认
    for (const x of inflight.filter((y) => y.kind === 'ack' && y.arrive === t)) {
      if (x.lost) { ev.push(`ACK${x.n} 在路上丢了`); continue; }
      if (proto === 'sr') {
        const cover = cumAck ? acks.filter((a) => a.lost && a.n < x.n).map((a) => a.n) : [];
        for (const k of [x.n, ...cover]) { acked.add(k); timer.delete(k); }
        const old = base;
        while (acked.has(base)) base++;
        ev.push(`发送方收到 ACK${x.n}${base !== old ? `，窗口滑到 ${base}` : ''}`);
      } else if (x.n >= base) {
        for (let k = base; k <= x.n; k++) timer.delete(k);
        base = x.n + 1;
        ev.push(`发送方收到 ACK${x.n}：${x.n} 号以前都确认了，窗口滑到 ${base}`);
        // 已经确认的不用再重传
        for (let i = resend.length - 1; i >= 0; i--) if (resend[i] < base) resend.splice(i, 1);
      } else ev.push(`发送方收到 ACK${x.n}（重复的，不管）`);
    }
    if (base >= N && !inflight.some((y) => y.arrive > t)) {
      if (ev.length) steps.push({ view: v(t), msg: `t = ${t}：${ev.join('；')}。` });
      break;
    }
    // 3. 超时
    const expired = [...timer.entries()].filter(([, at]) => at === t).map(([f]) => f).sort((a, b) => a - b);
    if (expired.length) {
      if (proto === 'sr' && resendAll) {
        const again = [];
        for (let k = expired[0]; k < next; k++) { again.push(k); timer.delete(k); if (!resend.includes(k)) resend.push(k); }
        resend.sort((a, b) => a - b);
        ev.push(`${expired[0]} 号帧超时：从它起已经发出的都重传（${again.join('、')}）`);
        ask = { tag: 'resend', kind: 'text', q: `t = ${t}：超时了，要重传哪几个帧？`, answer: again.join(' ') };
      } else if (proto === 'sr') {
        for (const f of expired) { timer.delete(f); resend.push(f); }
        ev.push(`${expired.join('、')} 号帧超时：只重传${expired.length > 1 ? '这几个' : '它'}`);
        ask = { tag: 'resend', kind: 'text', q: `t = ${t}：超时了，要重传哪几个帧？`, answer: expired.join(' ') };
      } else if (resendOne) {
        for (const f of expired) { timer.delete(f); resend.push(f); }
        ev.push(`${expired.join('、')} 号帧超时：只重传${expired.length > 1 ? '这几个' : '它'}`);
        ask = { tag: 'resend', kind: 'text', q: `t = ${t}：${expired[0]} 号帧超时了，接下来要重传哪几个帧？`, answer: expired.join(' ') };
      } else {
        const first = expired[0];
        if (first === base || proto === 'sw') {
          const again = [];
          for (let k = base; k < next; k++) { again.push(k); timer.delete(k); }
          resend.splice(0, resend.length, ...again);
          ev.push(`${first} 号帧超时：${proto === 'gbn' ? `后退 N 帧，从 ${base} 号起，已经发出、还没确认的都重传（${again.join('、')}）` : `重传 ${first} 号帧`}`);
          ask = { tag: 'resend', kind: 'text', q: `t = ${t}：${first} 号帧超时了，接下来要重传哪几个帧？`, answer: again.join(' ') };
        } else for (const f of expired) timer.delete(f);
      }
    }
    // 4. 发一帧：先重传，再发新的
    let f = null, re = false;
    if (resend.length) { f = resend.shift(); re = true; }
    else if (next < N && next < base + W) { f = next++; }
    if (f !== null) {
      const isLost = lostLeft.has(f) && !re && (lostLeft.delete(f), true);
      sent.push({ f, t, lost: isLost, re });
      inflight.push({ kind: 'data', n: f, arrive: t + D, lost: isLost });
      timer.set(f, t + TO);
      total++;
      ev.push(`发送方${re ? '重传' : '发出'} ${f} 号帧`);
    } else if (next < N && next >= base + W && !resend.length && proto !== 'sw') ev.push(`窗口满了（${base}～${base + W - 1}），等确认`);
    if (ev.length) steps.push({ view: v(t), msg: `t = ${t}：${ev.join('；')}。`, ask });
  }
  steps.push({ view: v(steps.at(-1)?.view.t ?? 0, { end: true }), msg: `全部确认了。一共发了 ${total} 个数据帧（其中重传 ${total - N} 个）。`, ask: { tag: 'total', kind: 'number', q: '一共发了多少个数据帧（包括重传）？', answer: total } });
  return { steps, total };
}

function winView(s, input) {
  const { frames: N, window: W, delay: D } = input;
  const T = Math.max(12, ...s.sent.map((x) => x.t + D + 1), ...s.acks.map((x) => x.t + D + 1));
  const Wd = 520, top = 34, row = 22, H = top + row * T + 20;
  const L = 110, R = Wd - 110;
  const Y = (t) => top + t * row;
  let g = `<text class="cn-who" x="${L}" y="18">发送方</text><text class="cn-who" x="${R}" y="18">接收方</text><line class="cn-life" x1="${L}" y1="${top - 6}" x2="${L}" y2="${H - 6}"/><line class="cn-life" x1="${R}" y1="${top - 6}" x2="${R}" y2="${H - 6}"/>`;
  for (let t = 0; t <= Math.min(T, s.t); t += 2) g += `<text class="cn-tk" x="${L - 34}" y="${Y(t) + 4}">t=${t}</text>`;
  for (const x of s.sent) {
    const y1 = Y(x.t), y2 = Y(x.t + D);
    const x2 = x.lost ? (L + R) / 2 : R, yy = x.lost ? (y1 + y2) / 2 : y2;
    g += `<line class="cn-msg cn-data${x.re ? ' cn-re' : ''}${x.lost ? ' cn-lost' : ''}" x1="${L}" y1="${y1}" x2="${x2}" y2="${yy}"${x.lost ? '' : ' marker-end="url(#cn-arrow2)"'}/>${x.lost ? `<text class="cn-x" x="${x2}" y="${yy + 5}">✗</text>` : ''}<text class="cn-lbl" x="${L - 8}" y="${y1 + 4}">${x.re ? '重' : ''}${x.f}</text>`;
  }
  for (const x of s.acks) {
    const y1 = Y(x.t), y2 = Y(x.t + D);
    const x2 = x.lost ? (L + R) / 2 : L, yy = x.lost ? (y1 + y2) / 2 : y2;
    g += `<line class="cn-msg cn-ackl${x.lost ? ' cn-lost' : ''}" x1="${R}" y1="${y1}" x2="${x2}" y2="${yy}"${x.lost ? '' : ' marker-end="url(#cn-arrow2)"'}/>${x.lost ? `<text class="cn-x" x="${x2}" y="${yy + 5}">✗</text>` : ''}<text class="cn-lbl cn-lbl-r" x="${R + 8}" y="${y1 + 4}">ACK${x.n}</text>`;
  }
  g += `<line class="cn-now" x1="${L - 10}" y1="${Y(s.t)}" x2="${R + 10}" y2="${Y(s.t)}"/>`;
  const svg = `<svg class="cn-seq cn-win" viewBox="0 0 ${Wd} ${H}" width="${Wd}" style="max-width:100%" role="img" aria-label="滑动窗口时序图"><defs><marker id="cn-arrow2" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" class="cn-arrowhead"/></marker></defs>${g}</svg>`;
  // 发送窗口：每个帧一格
  const cells = Array.from({ length: N }, (_, f) => {
    const done = input.proto === 'sr' ? s.acked.includes(f) || f < s.base : f < s.base;
    const inWin = f >= s.base && f < s.base + W;
    const out = f < s.next;
    return `<div class="sv-cell ${done ? 'sv-done' : inWin ? (out ? 'sv-cmp' : 'sv-cur') : 'sv-out'}" data-cmd="${f + 1}" data-pick="${f}">${f}</div>`;
  }).join('');
  const win = `<div class="cn-wnd"><span class="cn-h">发送窗口 ${s.base}～${Math.min(N - 1, s.base + W - 1)}</span><div class="sv-row" style="--cols:${N}">${cells}</div><span class="muted cn-legend">绿：已确认；黄框：已发出、等确认；蓝：窗口里还没发；灰：窗口外</span></div>`;
  return win + `<div class="sv-gtbl-wrap">${svg}</div>` + chips([['t', s.t], ['接收方期望', s.expect], ...(input.proto === 'sr' && s.buf.length ? [['接收方缓存', s.buf.join(' ')]] : [])]);
}

export const windowEngine = {
  name: 'window',
  title: '滑动窗口',
  parse: winParse,
  run: winRun,
  view: winView,
  quiz(input, r) {
    return { q: `${PROTO[input.proto]}，发送窗口 ${input.window}，发 ${input.frames} 个帧（0～${input.frames - 1}）${input.lost.size ? `，${[...input.lost].join('、')} 号帧第一次丢失` : ''}${input.acklost.size ? `，${[...input.acklost].join('、')} 号帧的确认第一次丢失` : ''}。一共要发多少个数据帧（包括重传）？`, type: 'num', answer: String(r.total) };
  },
  // 考卷上那张表：每个帧一共发了几次
  table(input, r) {
    const last = r.steps.at(-1).view.sent;
    return {
      q: `${PROTO[input.proto]}，发送窗口 ${input.window}，发 ${input.frames} 个帧（0～${input.frames - 1}）${input.lost.size ? `，${[...input.lost].join('、')} 号帧第一次丢失` : ''}${input.acklost.size ? `，${[...input.acklost].join('、')} 号帧的确认第一次丢失` : ''}。每个帧一共发了几次（包括重传）？`,
      qhtml: '', dir: 'col', head: ['发了几次'],
      rows: Array.from({ length: input.frames }, (_, f) => ({ label: `${f} 号`, cells: [{ v: String(last.filter((x) => x.f === f).length), num: true }] })),
    };
  },
  // 常见错法：GBN 和 SR 弄混（换协议算一遍；GBN、SR 问「重传哪几个」的题面不一样，换协议对不上这一问，
  // 所以在本协议里再按另一种重传法算一遍）；累积确认和单独确认弄混（确认帧丢了要不要重传）
  variants(input, fields) {
    const ackLost = input.acklost.size > 0;
    const out = [];
    if (input.proto === 'sw') {
      if (ackLost) out.push({ label: '像是以为确认帧丢了就不用重传（王道：发送方收不到确认就超时重传，接收方丢掉重复的帧、再确认一次）', input: { ...input, acklost: new Set() } });
    } else {
      const other = input.proto === 'gbn' ? 'sr' : 'gbn';
      // 答案一样时先列的说了算：只丢了确认的 SR，「当成累积确认」和「按 GBN 算」答案相同，前者说得更准，排前面
      if (input.proto === 'sr' && ackLost) out.push({ label: '像是把选择重传的确认当成了累积确认（王道：SR 每一帧单独确认，哪一帧的确认丢了，那一帧就要超时重传）', input: { ...input, cumAck: true } });
      out.push({ label: `像是按${PROTO[other]}算的`, input: { ...input, proto: other } });
      if (input.proto === 'gbn') {
        out.push({ label: '像是只重传了超时的那一帧（王道：GBN 要从这一帧起，把已经发出、还没确认的都重传）', input: { ...input, resendOne: true } });
        if (ackLost) out.push({ label: '像是没用上累积确认，以为确认帧丢了就要超时重传（王道：GBN 是累积确认，后面的 ACK 及时到了，前面丢的确认就不碍事）', input: { ...input, lost: new Set([...input.lost, ...input.acklost]), acklost: new Set() } });
      } else {
        out.push({ label: '像是把超时那一帧后面已经发出的也重传了（王道：SR 只重传超时的那一帧）', input: { ...input, resendAll: true } });
      }
    }
    return differing(windowEngine, input, out, fields);
  },
};

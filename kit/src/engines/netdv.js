// 计算机网络的距离向量路由（RIP）：dv。纯函数，不碰 DOM（tests/cn2-engine.test.js）。三种用法：
//   table: + from: + recv:   一台路由器收到邻居发来的 RIP 报文，一项一项更新路由表（王道的 RIP 例题）
//   vectors: + cost:         收到几个邻居的距离向量，按 Bellman-Ford 算出新表（经哪个邻居最近）
//   links:（+ cut:）         整个网络每一轮交换一次，看距离向量怎么收敛；断一条链路，看坏消息传得慢（数到 16）
// 口径按王道：RIP 的距离就是跳数，16 表示不可达；收到邻居 X 的报文先把每一项距离加 1、下一跳写成 X，再逐项比：
// 原表没有 → 添加；原来的下一跳就是 X → 用新的替换（变大了也换）；下一跳不是 X → 新的更小才替换，否则不变。
import { esc, chips } from './arrayview.js';
import { differing } from './netmac.js';

const natCmp = (a, b) => String(a).localeCompare(String(b), 'zh', { numeric: true });
const INF_RE = /^(∞|inf|infinity|无穷|不可达)$/i;
const DIRECT = /^(-|—|–|直接|直接交付|直连|direct)$/i;
const hopText = (h) => (h === '' ? '直接交付' : h);
const list = (s) => String(s ?? '').split(/[,，、;；\n]+/).map((x) => x.trim()).filter(Boolean);

// ================= 解析 =================

function readDist(x, what, cap) {
  const s = String(x).trim();
  if (INF_RE.test(s)) return cap;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what}：距离写非负整数（不可达写 16 或 ∞），「${x}」不对`);
  return Math.min(n, cap);
}

function parse(fields) {
  const modes = ['table', 'vectors', 'links'].filter((k) => fields[k] !== undefined);
  if (modes.length !== 1) throw new Error(modes.length ? `table:、vectors:、links: 只写一种（现在写了 ${modes.join('、')}）` : 'dv 写一种：table: + from: + recv:（收到邻居的 RIP 报文，更新路由表）、vectors: + cost:（几个邻居的距离向量，算新表）、links:（整个网络一轮轮交换，配 cut: 断链路）');
  if (modes[0] === 'table') return ripParse(fields);
  if (modes[0] === 'vectors') return vecParse(fields);
  return netParse(fields);
}

function ripParse(fields) {
  const router = String(fields.router ?? '').trim() || '本路由器';
  const from = String(fields.from ?? '').trim();
  if (!from) throw new Error('from: 写发来 RIP 报文的邻居路由器（如 from: C）');
  const cost = fields.cost === undefined ? 1 : Number(fields.cost);
  if (!Number.isInteger(cost) || cost < 1 || cost > 15) throw new Error('cost: 到这个邻居的距离（RIP 是 1，默认 1）');
  const table = [];
  for (const part of list(fields.table)) {
    const m = /^(\S+)\s+(\S+)\s+(\S+)$/.exec(part);
    if (!m) throw new Error(`table: 每一项写「目的网络 距离 下一跳」，如 N1 7 A（直接交付写 -），「${part}」不对`);
    if (table.some((x) => x.dest === m[1])) throw new Error(`table: ${m[1]} 写了两次`);
    table.push({ dest: m[1], d: readDist(m[2], 'table:', 16), hop: DIRECT.test(m[3]) ? '' : m[3] });
  }
  if (!table.length) throw new Error('table: 写这台路由器原来的路由表，如 table: N1 7 A, N2 2 C');
  const recv = [];
  for (const part of list(fields.recv)) {
    const m = /^(\S+)\s+(\S+)$/.exec(part);
    if (!m) throw new Error(`recv: 每一项写「目的网络 距离」，如 N2 4，「${part}」不对`);
    if (recv.some((x) => x.dest === m[1])) throw new Error(`recv: ${m[1]} 写了两次`);
    recv.push({ dest: m[1], d: readDist(m[2], 'recv:', 16) });
  }
  if (!recv.length) throw new Error(`recv: 写 ${from} 发来的各项（目的网络 距离），如 recv: N2 4, N3 8`);
  if (recv.length > 12 || table.length > 12) throw new Error('table: / recv: 各最多 12 项');
  return { mode: 'rip', router, from, cost, table, recv, mistake: '' };
}

function vecParse(fields) {
  const router = String(fields.router ?? '').trim();
  if (!router) throw new Error('router: 写算新表的那台路由器（如 router: C）');
  const vecs = [];
  for (const m of String(fields.vectors).matchAll(/([^\s,，、;；()（）]+)\s*[(（]([^)）]*)[)）]/g)) {
    const vals = m[2].split(/[\s,，、]+/).filter(Boolean).map((x) => readDist(x, `vectors: ${m[1]}`, Infinity));
    vecs.push({ nb: m[1], vals });
  }
  if (!vecs.length) throw new Error('vectors: 写成「邻居 (到各目的的距离)」，如 vectors: B (5,0,8,12,6,2), D (16,12,6,0,9,10)');
  const n = vecs[0].vals.length;
  for (const v of vecs) if (v.vals.length !== n) throw new Error(`vectors: ${v.nb} 的向量有 ${v.vals.length} 项，${vecs[0].nb} 的有 ${n} 项，要一样多`);
  const dests = fields.dests === undefined ? Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i)) : String(fields.dests).split(/[\s,，、]+/).filter(Boolean);
  if (dests.length !== n) throw new Error(`dests: 写了 ${dests.length} 个目的，向量有 ${n} 项`);
  if (!dests.includes(router)) throw new Error(`dests: 里要有 ${router} 自己（它到自己是 0）`);
  const costs = new Map();
  for (const part of list(fields.cost)) {
    const m = /^(\S+?)\s*(?:\s|=|:|：)\s*(\d+(?:\.\d+)?)$/.exec(part);
    if (!m) throw new Error(`cost: 写到每个邻居的代价（延迟），如 cost: B 6, D 3, E 5，「${part}」不对`);
    costs.set(m[1], Number(m[2]));
  }
  for (const v of vecs) if (!costs.has(v.nb)) throw new Error(`cost: 没写到 ${v.nb} 的代价`);
  for (const k of costs.keys()) if (!vecs.some((v) => v.nb === k)) throw new Error(`cost: 写了 ${k}，可 vectors: 里没有它发来的向量`);
  return { mode: 'vec', router, dests, vecs, costs, mistake: '' };
}

function netParse(fields) {
  const inf = fields.inf === undefined ? 16 : Number(fields.inf);
  if (!Number.isInteger(inf) || inf < 3 || inf > 64) throw new Error('inf: 不可达记成多少（RIP 是 16，默认 16）');
  const links = [];
  const routers = [];
  for (const part of list(fields.links)) {
    const m = /^(\S+?)\s*[-—–]\s*(\S+?)(?:\s+(\d+))?$/.exec(part);
    if (!m) throw new Error(`links: 每条链路写「路由器-路由器 代价」，如 A-B 1（代价不写就是 1），「${part}」不对`);
    const c = m[3] === undefined ? 1 : Number(m[3]);
    if (!(c >= 1 && c < inf)) throw new Error(`links: ${part} 的代价要在 1～${inf - 1} 之间`);
    if (m[1] === m[2]) throw new Error(`links: ${part} 连到了自己`);
    if (links.some((l) => (l.a === m[1] && l.b === m[2]) || (l.a === m[2] && l.b === m[1]))) throw new Error(`links: ${m[1]}-${m[2]} 写了两次`);
    links.push({ a: m[1], b: m[2], c });
    for (const r of [m[1], m[2]]) if (!routers.includes(r)) routers.push(r);
  }
  if (links.length < 1 || routers.length < 2) throw new Error('links: 至少一条链路，如 links: A-B 1, B-C 1');
  if (routers.length > 7) throw new Error('links: 最多 7 台路由器');
  let cut = null;
  if (fields.cut !== undefined) {
    const m = /^(\S+?)\s*[-—–]\s*(\S+)$/.exec(String(fields.cut).trim());
    const l = m && links.find((x) => (x.a === m[1] && x.b === m[2]) || (x.a === m[2] && x.b === m[1]));
    if (!l) throw new Error(`cut: 写 links: 里的一条链路，如 cut: B-C（现在是「${fields.cut}」）`);
    cut = l;
  }
  const watch = fields.watch === undefined ? routers[0] : String(fields.watch).trim();
  if (!routers.includes(watch)) throw new Error(`watch: 写一台路由器（${routers.join('、')}）`);
  return { mode: 'net', links, routers, cut, watch, inf, mistake: '' };
}

// ================= table + recv：RIP 报文更新路由表 =================

function ripRun(input) {
  const { router, from, cost, mistake } = input;
  const plus = mistake === 'noPlus' ? 0 : cost;
  const cur = new Map(input.table.map((x) => [x.dest, { d: x.d, hop: x.hop }]));
  const recvMap = new Map(input.recv.map((x) => [x.dest, x.d]));
  const dests = [...new Set([...input.table.map((x) => x.dest), ...input.recv.map((x) => x.dest)])].sort(natCmp);
  const done = new Map(); // dest → { d, hop, how }
  const steps = [];
  const v = (extra = {}) => ({ done: new Map(done), ...extra });
  const hops = [...new Set(input.table.map((x) => x.hop))];
  steps.push({ view: v({ plus: false }), msg: `${router} 收到相邻路由器 ${from} 发来的 RIP 报文（${from} 到各网络的距离）。RIP 的距离是跳数，16 表示不可达。` });
  steps.push({ view: v({ plus: true }), msg: `先改 ${from} 发来的每一项：距离加 ${cost}（从 ${router} 出发要先到 ${from}），下一跳都写成 ${from}。${input.recv.map((x) => `${x.dest} ${x.d} → ${Math.min(16, x.d + cost)}`).join('，')}。` });
  input.recv.forEach((x) => {
    const nd = Math.min(16, x.d + plus);
    const old = cur.get(x.dest);
    let how, d, hop;
    if (!old) { how = 'new'; d = nd; hop = from; }
    else if (old.hop === from && mistake !== 'noSame') { how = 'same'; d = nd; hop = from; }
    else if (nd < old.d || mistake === 'always') { how = 'less'; d = nd; hop = from; }
    else { how = 'keep'; d = old.d; hop = old.hop; }
    done.set(x.dest, { d, hop, how });
    const un = d >= 16 ? '（16：不可达）' : '';
    const msg = how === 'new' ? `${x.dest}：原来的表里没有，添加「${x.dest} ${nd} ${from}」${un}。`
      : how === 'same' ? `${x.dest}：原来就经 ${from} 走（${old.d} ${from}）。下一跳说的算：${from} 现在到 ${x.dest} 是 ${x.d}，就改成 ${nd}${nd > old.d ? '——变大了也要换，路由器只能信下一跳的最新消息' : nd === old.d ? '（没变）' : ''}${un}。`
        : how === 'less' ? `${x.dest}：原来是 ${old.d}（下一跳 ${hopText(old.hop)}），经 ${from} 只要 ${nd}，更短，换成「${x.dest} ${nd} ${from}」。`
          : `${x.dest}：原来是 ${old.d}（下一跳 ${hopText(old.hop)}），经 ${from} 要 ${nd}，不比原来短，不变。`;
    const hopChoices = [...new Set([from, ...hops.filter(Boolean), ...hops.filter((h) => h === '').map(() => '直接交付')])].slice(0, 4);
    steps.push({
      view: v({ plus: true, cur: x.dest }), msg,
      ask: { tag: 'dist', kind: 'number', q: `更新以后，${router} 到 ${x.dest} 的距离是多少？`, answer: d },
      asks: [
        { tag: 'hop', kind: 'choice', q: `更新以后，${router} 到 ${x.dest} 的下一跳是？`, choices: hopChoices.includes(hopText(hop)) ? hopChoices : [...hopChoices.slice(0, 3), hopText(hop)], answer: hopText(hop) },
        { tag: 'rule', kind: 'choice', q: `${router} 怎么处理 ${from} 发来的「${x.dest} ${x.d}」？`, choices: ['添加新的一项', '下一跳相同，替换', '经它更短，替换', '不变'], answer: { new: '添加新的一项', same: '下一跳相同，替换', less: '经它更短，替换', keep: '不变' }[how] },
      ],
    });
  });
  const final = dests.map((dest) => {
    if (done.has(dest)) return { dest, ...done.get(dest) };
    const o = cur.get(dest);
    return { dest, d: o.d, hop: o.hop, how: 'none' };
  });
  const untouched = final.filter((x) => x.how === 'none');
  steps.push({ view: v({ plus: true, end: true }), msg: `${untouched.length ? `${untouched.map((x) => x.dest).join('、')}：${from} 没提到，不变。` : ''}更新后的路由表：${final.map((x) => `${x.dest} ${x.d} ${hopText(x.hop)}`).join('；')}。` });
  return { steps, final, dests, recvMap };
}

function ripView(s, input) {
  const old = new Map(input.table.map((x) => [x.dest, x]));
  const recv = new Map(input.recv.map((x) => [x.dest, x.d]));
  const dests = [...new Set([...input.table.map((x) => x.dest), ...input.recv.map((x) => x.dest)])].sort(natCmp);
  const rows = dests.map((d, i) => {
    const o = old.get(d), x = recv.get(d), n = s.done.get(d);
    const upd = n ? `${n.d} ${hopText(n.hop)}` : s.end && o ? `${o.d} ${hopText(o.hop)}` : '';
    const cls = [s.cur === d ? 'n2-on' : '', n && n.how !== 'keep' ? 'n2-chg' : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}" data-cmd="${i + 1}" data-label="${esc(d)}"><th>${esc(d)}</th><td>${o ? `${o.d}` : ''}</td><td>${o ? esc(hopText(o.hop)) : ''}</td><td class="n2-recv">${x === undefined ? '' : s.plus ? `${x} + ${input.cost} = <b>${Math.min(16, x + input.cost)}</b>` : x}</td><td class="n2-upd${n && s.cur === d ? ' sv-new' : ''}">${esc(upd)}</td></tr>`;
  }).join('');
  return `<table class="sv-tab n2-tab n2-dv"><thead><tr><th rowspan="2">目的网络</th><th colspan="2">${esc(input.router)} 原来的表</th><th>${esc(input.from)} 发来的</th><th>更新后</th></tr><tr><th>距离</th><th>下一跳</th><th>距离${s.plus ? ` + ${input.cost}` : ''}</th><th>距离 下一跳</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ================= vectors + cost：收到几个邻居的距离向量，算新表 =================

function vecCompute(input) {
  const { router, dests, vecs, costs, mistake } = input;
  const via = vecs.map((v) => ({ nb: v.nb, c: costs.get(v.nb), vals: v.vals.map((x) => (mistake === 'noCost' ? x : x + costs.get(v.nb))) }));
  // 错法 greedy：只看哪条链路最近，全都走那个邻居
  const nearest = [...via].sort((a, b) => a.c - b.c || natCmp(a.nb, b.nb))[0];
  const best = dests.map((d, j) => {
    if (d === router) return { dest: d, d: 0, hops: [] };
    const pool = mistake === 'greedy' ? [nearest] : via;
    const m = Math.min(...pool.map((x) => x.vals[j]));
    return { dest: d, d: m, hops: m === Infinity ? [] : pool.filter((x) => x.vals[j] === m).map((x) => x.nb) };
  });
  return { via, best };
}
const dText = (x) => (x === Infinity ? '∞' : String(x));

function vecRun(input) {
  const { router, dests } = input;
  const { via, best } = vecCompute(input);
  const right = vecCompute({ ...input, mistake: '' });
  const steps = [];
  steps.push({ view: { shown: 0, upto: -1 }, msg: `${router} 收到邻居 ${input.vecs.map((v) => v.nb).join('、')} 的距离向量（它们到 ${dests.join('、')} 的距离），${router} 到它们的代价是 ${input.vecs.map((v) => `${v.nb} ${input.costs.get(v.nb)}`).join('、')}。新表不看旧表：经每个邻居各算一遍，取最小的。` });
  via.forEach((x, i) => {
    // 问经它到哪个目的：挑一个经它正好最近的（没有就第一个），到不了的不问
    const ok = (jj) => dests[jj] !== router && right.via[i].vals[jj] !== Infinity && x.vals[jj] !== Infinity;
    const j = dests.findIndex((d, jj) => ok(jj) && right.best[jj].hops.includes(x.nb));
    const jj = j >= 0 ? j : dests.findIndex((d, q) => ok(q));
    steps.push({ view: { shown: i + 1, upto: -1 }, msg: `经 ${x.nb}：${x.nb} 的向量每一项加上 ${router} 到 ${x.nb} 的代价 ${x.c}：(${right.via[i].vals.map(dText).join(', ')})。`, ask: jj >= 0 ? { tag: 'via', kind: 'number', q: `经 ${x.nb} 到 ${dests[jj]}，要多少？`, answer: x.vals[jj], display: dText(right.via[i].vals[jj]) } : undefined });
  });
  dests.forEach((d, j) => {
    if (d === router) return;
    const b = best[j], rb = right.best[j];
    const cand = right.via.map((x) => `经 ${x.nb} ${dText(x.vals[j])}`).join('，');
    steps.push({
      view: { shown: via.length, upto: j }, msg: `到 ${d}：${cand}；最小是 ${dText(rb.d)}${rb.hops.length ? `，下一跳 ${rb.hops.join(' 或 ')}` : '（到不了）'}。`,
      ask: b.d === Infinity || rb.d === Infinity ? { tag: 'dist', kind: 'choice', q: `${router} 的新表里，到 ${d} 的距离是多少？`, choices: ['∞（到不了）', ...[...new Set(right.via.map((y) => y.vals[j]).filter((y) => y !== Infinity))].slice(0, 3).map(String)], answer: dText(b.d) === '∞' ? '∞（到不了）' : String(b.d) } : { tag: 'dist', kind: 'number', q: `${router} 的新表里，到 ${d} 的距离是多少？`, answer: b.d, display: dText(rb.d) },
      asks: rb.hops.length ? [{ tag: 'hop', kind: 'choice', q: `${router} 到 ${d} 的下一跳是？`, choices: input.vecs.map((v) => v.nb), answer: b.hops[0] ?? '', alts: b.hops, display: rb.hops.join(' 或 ') }] : [],
    });
  });
  steps.push({ view: { shown: via.length, upto: dests.length }, msg: `${router} 的新路由表：${right.best.map((x) => `${x.dest} ${dText(x.d)} ${x.dest === router ? '—' : x.hops.join('/') || '—'}`).join('；')}。` });
  return { steps, best };
}

function vecView(s, input) {
  const { router, dests } = input;
  const { via, best } = vecCompute({ ...input, mistake: '' });
  const head = `<tr><th></th>${dests.map((d) => `<th>${esc(d)}</th>`).join('')}</tr>`;
  const recvRows = input.vecs.map((v) => `<tr><th>${esc(v.nb)} 发来的</th>${v.vals.map((x) => `<td>${dText(x)}</td>`).join('')}</tr>`).join('');
  const viaRows = via.slice(0, s.shown).map((x, i) => `<tr class="${i === s.shown - 1 && s.upto < 0 ? 'n2-on' : ''}"><th>经 ${esc(x.nb)}（+${x.c}）</th>${x.vals.map((y, j) => `<td class="${s.upto >= 0 && j === s.upto && best[j].hops.includes(x.nb) ? 'n2-best' : ''}">${dText(y)}</td>`).join('')}</tr>`).join('');
  const newRow = s.upto >= 0 ? `<tr class="n2-newrow"><th>${esc(router)} 的新表</th>${dests.map((d, j) => `<td class="${j === s.upto ? 'n2-on sv-new' : ''}" data-cmd="${j + 1}" data-label="${esc(d)}">${j <= s.upto ? `${dText(best[j].d)}<small>${d === router ? '—' : esc(best[j].hops.join('/')) || '—'}</small>` : ''}</td>`).join('')}</tr>` : '';
  return `<div class="sv-gtbl-wrap"><table class="sv-tab n2-tab n2-vec"><thead>${head}</thead><tbody>${recvRows}${viaRows ? `<tr class="n2-sep"><td colspan="${dests.length + 1}"></td></tr>${viaRows}` : ''}${newRow}</tbody></table></div>`;
}

// ================= links：整个网络一轮一轮交换 =================

function bf(routers, links, inf, start, hopCost = false) {
  const nb = (x) => links.filter((l) => l.a === x || l.b === x).map((l) => ({ v: l.a === x ? l.b : l.a, c: hopCost ? 1 : l.c }));
  const next = new Map();
  for (const x of routers) {
    const row = new Map();
    for (const y of routers) {
      if (y === x) { row.set(y, { d: 0, hop: '' }); continue; }
      let best = { d: inf, hop: '' };
      const prevHop = start.get(x)?.get(y)?.hop;
      for (const { v, c } of nb(x).sort((a, b) => natCmp(a.v, b.v))) {
        const d = Math.min(inf, c + start.get(v).get(y).d);
        if (d < best.d || (d === best.d && d < inf && v === prevHop)) best = { d, hop: d < inf ? v : '' };
      }
      row.set(y, best);
    }
    next.set(x, row);
  }
  return next;
}
function initTables(routers, links, inf, hopCost = false) {
  const t = new Map();
  for (const x of routers) {
    const row = new Map();
    for (const y of routers) {
      const l = links.find((k) => (k.a === x && k.b === y) || (k.a === y && k.b === x));
      row.set(y, y === x ? { d: 0, hop: '' } : l ? { d: hopCost ? 1 : l.c, hop: y } : { d: inf, hop: '' });
    }
    t.set(x, row);
  }
  return t;
}
const same = (a, b) => [...a].every(([x, row]) => [...row].every(([y, e]) => b.get(x).get(y).d === e.d && b.get(x).get(y).hop === e.hop));
const copy = (t) => new Map([...t].map(([x, row]) => [x, new Map([...row].map(([y, e]) => [y, { ...e }]))]));
// 一张表的「最终样子」：一直交换到不变
function settle(routers, links, inf, start, hopCost) {
  let t = start;
  for (let k = 0; k < 80; k++) { const n = bf(routers, links, inf, t, hopCost); if (same(n, t)) return t; t = n; }
  return t;
}

function netRun(input) {
  const { routers, links, cut, watch, inf, mistake } = input;
  const hopCost = mistake === 'hop';
  const steps = [];
  const rounds = []; // { label, table }（填表用）
  let t = initTables(routers, links, inf, hopCost);
  let live = links;
  const dT = (d) => (d >= inf ? `${inf}（不可达）` : String(d));
  const others = routers.filter((y) => y !== watch);
  steps.push({ view: { t: copy(t), live, phase: 'init', k: 0 }, msg: `一开始每台路由器只知道自己（距离 0）和直接相连的邻居（距离就是链路的代价），别的都是 ${inf}（不可达）。之后每一轮，每台路由器把自己的距离向量发给邻居，再算：到 Y 的距离 = min（到邻居 V 的代价 + V 到 Y 的距离）。` });
  rounds.push({ label: '开始', table: copy(t), given: true });
  const roundStep = (k, label, prev, now, after) => {
    const ch = [];
    for (const x of routers) for (const y of routers) { const a = prev.get(x).get(y), b = now.get(x).get(y); if (a.d !== b.d || a.hop !== b.hop) ch.push({ x, y, a, b }); }
    const focus = ch.find((c) => c.x === watch) || ch[0];
    const desc = ch.slice(0, 6).map((c) => `${c.x} 到 ${c.y}：${dT(c.a.d)} → ${dT(c.b.d)}${c.b.d < inf ? `（经 ${c.b.hop}）` : ''}`).join('；') + (ch.length > 6 ? `……（一共 ${ch.length} 处）` : '');
    const ask = focus ? { tag: 'dist', kind: 'number', q: `${label}以后，${focus.x} 到 ${focus.y} 的距离是多少？`, answer: focus.b.d } : { tag: 'stable', kind: 'choice', q: `${label}：各路由器的表还会变吗？`, choices: ['还会变', '不变了（收敛了）'], answer: '不变了（收敛了）' };
    const nbs = live.filter((l) => focus && (l.a === focus.x || l.b === focus.x)).map((l) => (l.a === focus.x ? l.b : l.a)).sort(natCmp);
    const asks = focus && focus.b.d < inf && nbs.length > 1 ? [{ tag: 'hop', kind: 'choice', q: `${label}以后，${focus.x} 到 ${focus.y} 的下一跳是？`, choices: nbs, answer: focus.b.hop }] : [];
    steps.push({ view: { t: copy(now), live, phase: after ? 'after' : 'round', k, ch: ch.map((c) => `${c.x}>${c.y}`) }, msg: ch.length ? `${label}：大家交换一次距离向量。变了的：${desc}。` : `${label}：交换以后谁的表都没变——收敛了。`, ask, asks });
    return ch.length;
  };
  // 断链之前：交换到收敛（错法 oneRound：以为交换一次就全知道了）
  let k = 0;
  for (; k < 20; k++) {
    const n = mistake === 'oneRound' ? settle(routers, live, inf, t, hopCost) : bf(routers, live, inf, t, hopCost);
    const changed = roundStep(k + 1, `第 ${k + 1} 轮`, t, n, false);
    t = n;
    rounds.push({ label: `第 ${k + 1} 轮`, table: copy(t) });
    if (!changed) break;
  }
  const before = copy(t);
  let afterCount = 0;
  if (cut) {
    live = links.filter((l) => l !== cut);
    const ends = [cut.a, cut.b];
    const lost = ends.flatMap((x) => routers.filter((y) => y !== x && t.get(x).get(y).hop === (x === cut.a ? cut.b : cut.a)).map((y) => `${x} 到 ${y}`));
    steps.push({ view: { t: copy(t), live, phase: 'cut', k: 0 }, msg: `${cut.a}–${cut.b} 这条链路断了。${cut.a}、${cut.b} 自己发现了：${lost.length ? `${lost.join('、')} 原来走这条链路，` : ''}下一轮要从剩下的邻居那里重新算。麻烦在于：邻居们的表还是旧的，它们写着的路也许正绕经这条断了的链路，自己却不知道。` });
    if (mistake === 'instant') {
      // 错法：以为坏消息一下子就传遍了
      const n = settle(routers, live, inf, initTables(routers, live, inf, hopCost), hopCost);
      roundStep(1, '断了以后第 1 轮', t, n, true);
      t = n;
      rounds.push({ label: '断后第 1 轮', table: copy(t) });
      roundStep(2, '断了以后第 2 轮', t, t, true);
      rounds.push({ label: '断后第 2 轮', table: copy(t) });
    } else {
      for (let j = 0; j < 40; j++) {
        const n = bf(routers, live, inf, t, hopCost);
        const changed = roundStep(j + 1, `断了以后第 ${j + 1} 轮`, t, n, true);
        t = n;
        afterCount++;
        rounds.push({ label: `断后第 ${j + 1} 轮`, table: copy(t) });
        if (!changed) break;
      }
    }
  }
  const final = others.map((y) => t.get(watch).get(y));
  steps.push({ view: { t: copy(t), live, phase: 'end', k: 0 }, msg: cut ? `断了以后交换了 ${afterCount || 2} 轮才稳定：${others.map((y, i) => `${watch} 到 ${y} ${dT(final[i].d)}`).join('，')}。好消息（新链路、更短的路）一轮传一跳，传得快；坏消息（链路断了）要一点点「数」上去，直到 ${inf} 才知道不可达——坏消息传得慢。` : `收敛了：${others.map((y, i) => `${watch} 到 ${y} ${dT(final[i].d)}${final[i].d < inf ? `（下一跳 ${final[i].hop}）` : ''}`).join('，')}。消息每一轮只往外传一跳，网络越「宽」，要的轮数越多。` });
  return { steps, rounds, final, before, others };
}

function layout(routers) {
  const n = routers.length;
  if (n <= 3) return new Map(routers.map((r, i) => [r, [80 + (i * 360) / Math.max(1, n - 1), 70]]));
  return new Map(routers.map((r, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [r, [260 + 170 * Math.cos(a), 125 + 92 * Math.sin(a)]]; }));
}

function netView(s, input) {
  const { routers, links, cut, watch, inf } = input;
  const P = layout(routers);
  const H = routers.length <= 3 ? 130 : 250, W = 520;
  let g = '';
  for (const l of links) {
    const [x1, y1] = P.get(l.a), [x2, y2] = P.get(l.b);
    const dead = cut === l && !s.live.includes(l);
    g += `<line class="n2-link${dead ? ' n2-dead' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><text class="n2-cost" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}">${dead ? '✗' : l.c}</text>`;
  }
  routers.forEach((r, i) => { const [x, y] = P.get(r); g += `<g class="n2-rt${r === watch ? ' n2-watch' : ''}" data-cmd="${i + 1}" data-label="${esc(r)}"><circle cx="${x}" cy="${y}" r="20"/><text x="${x}" y="${y + 5}">${esc(r)}</text></g>`; });
  const svg = `<svg class="n2-svg n2-dv-net" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img" aria-label="网络拓扑">${g}</svg>`;
  const ch = new Set(s.ch || []);
  const rows = routers.map((x) => `<tr class="${x === watch ? 'n2-watchrow' : ''}"><th>${esc(x)}</th>${routers.map((y) => { const e = s.t.get(x).get(y); return `<td class="${ch.has(`${x}>${y}`) ? 'n2-chg sv-new' : ''}${e.d >= inf ? ' n2-inf' : ''}">${x === y ? '0' : e.d >= inf ? String(inf) : `${e.d}<small>${esc(e.hop)}</small>`}</td>`; }).join('')}</tr>`).join('');
  const tab = `<div class="sv-gtbl-wrap"><table class="sv-tab n2-tab n2-dvt"><thead><tr><th>从 \\ 到</th>${routers.map((y) => `<th>${esc(y)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const phase = { init: '开始', round: `第 ${s.k} 轮`, cut: '链路断了', after: `断了以后第 ${s.k} 轮`, end: '最后' }[s.phase];
  return `<div class="n2-dvbox">${svg}${tab}</div>${chips([['现在', phase], ['小字', '下一跳']])}`;
}

// ================= 引擎 =================

export const dvEngine = {
  name: 'dv', title: '距离向量路由', parse,
  run: (input) => (input.mode === 'rip' ? ripRun(input) : input.mode === 'vec' ? vecRun(input) : netRun(input)),
  view: (s, input) => (input.mode === 'rip' ? ripView(s, input) : input.mode === 'vec' ? vecView(s, input) : netView(s, input)),
  quiz(input, r) {
    if (input.mode === 'rip') return { q: `${input.router} 原来的路由表：${input.table.map((x) => `${x.dest} ${x.d} ${hopText(x.hop)}`).join('；')}。收到 ${input.from} 发来的 RIP 报文：${input.recv.map((x) => `${x.dest} ${x.d}`).join('；')}。按 ${r.final.map((x) => x.dest).join('、')} 的顺序写出更新后的距离。`, type: 'seq', answer: r.final.map((x) => x.d).join(' ') };
    if (input.mode === 'vec') return { q: `${input.router} 收到 ${input.vecs.map((v) => `${v.nb} (${v.vals.map(dText).join(', ')})`).join('，')}（到 ${input.dests.join('、')} 的距离），到它们的代价 ${input.vecs.map((v) => `${v.nb} ${input.costs.get(v.nb)}`).join('、')}。按 ${input.dests.join('、')} 的顺序写出 ${input.router} 的新距离向量。`, type: 'seq', answer: r.best.map((x) => dText(x.d)).join(' ') };
    return { q: `链路 ${input.links.map((l) => `${l.a}-${l.b} ${l.c}`).join('，')}，用距离向量算法（不可达记 ${input.inf}）${input.cut ? `，收敛以后 ${input.cut.a}-${input.cut.b} 断了` : ''}。最后稳定时，${input.watch} 到 ${r.others.join('、')} 的距离依次是多少？`, type: 'seq', answer: r.final.map((x) => String(x.d)).join(' ') };
  },
  // 考卷上那张表：RIP / 新表填每个目的的距离和下一跳；整个网络填 watch 那台路由器每一轮的距离
  table(input, r) {
    if (input.mode === 'rip') return { q: `把 ${input.router} 更新后的路由表填完整。`, qhtml: '', dir: 'row', head: ['距离', '下一跳'], rows: r.final.map((x) => ({ label: x.dest, cells: [{ v: String(x.d), num: true }, { v: x.hop === '' ? ['直接交付', '-', '直接'] : x.hop }] })) };
    if (input.mode === 'vec') return { q: `把 ${input.router} 的新路由表填完整（下一跳写邻居的名字）。`, qhtml: '', dir: 'row', head: ['距离', '下一跳'], rows: r.best.map((x) => ({ label: x.dest, cells: x.dest === input.router ? [{ v: '0', given: true }, { v: '—', given: true }] : [{ v: dText(x.d), num: x.d !== Infinity }, { v: x.hops.length ? x.hops : '' }] })) };
    return { q: `${input.watch} 每一轮交换以后到各路由器的距离（不可达写 ${input.inf}）。`, qhtml: '', dir: 'row', head: r.others, rows: r.rounds.map((x) => ({ label: x.label, cells: r.others.map((y) => ({ v: String(x.table.get(input.watch).get(y).d), num: true, ...(x.given ? { given: true } : {}) })) })) };
  },
  // 常见错法：RIP 忘了加 1、下一跳相同却没替换（只比大小）、不管大小一律替换；新表忘了加代价、只走最近的邻居；
  // 整个网络：以为交换一次就全知道了、以为断链马上全网都知道、代价当成跳数
  variants(input) {
    const L = {
      rip: [['noPlus', '像是忘了把邻居发来的距离加 1（王道：先把报文里每一项的距离加 1、下一跳改成发来的邻居）'], ['noSame', '像是下一跳相同时只比了大小（王道：原来的下一跳就是发来的邻居，不管变大变小都要替换）'], ['always', '像是不管大小一律换成了邻居的（王道：下一跳不同时，只有更短才替换）']],
      vec: [['noCost', '像是忘了加上到邻居的代价（王道：经邻居 V 到 Y 的距离 = 到 V 的代价 + V 到 Y 的距离）'], ['greedy', '像是全都走了链路最近的那个邻居（王道：每个目的分别比较经各邻居的总距离，取最小的）']],
      net: [['oneRound', '像是以为交换一次就全知道了（王道：每一轮消息只往外传一跳）'], ['instant', '像是以为链路一断，全网马上都知道了（王道：坏消息传得慢，要一轮轮数到 16 才知道不可达）'], ['hop', '像是把链路代价当成了跳数（王道：这里每条链路有自己的代价，距离是代价加起来）']],
    }[input.mode];
    return differing(dvEngine, input, L.map(([m, label]) => ({ label, input: { ...input, mistake: m } })));
  },
};

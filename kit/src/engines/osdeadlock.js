// 操作系统的死锁检测：deadlock（资源分配图的化简）。
// 口径按王道：圆圈是进程，方框是一类资源，框里一个点是一个资源；资源 → 进程是分配边，进程 → 资源是请求边。
// 化简：找一个请求都能满足的进程（不阻塞、也不是孤点），去掉它所有的边（它运行完、把占着的资源还回来），再接着找；
// 死锁定理：能完全化简就没有死锁，化简不掉的那些进程就是死锁的。每类资源不止一个时，有环不一定死锁。
// 纯函数（tests/osdeadlock-engine.test.js）。
import { esc, chips } from './arrayview.js';

const vec = (a) => `(${a.join(', ')})`;
const le = (a, b) => a.every((x, i) => x <= b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);

// res: R1 3, R2 2（名字和个数），或者只写个数 res: 3 2（名字是 R1、R2……）
function parseRes(src) {
  const s = String(src ?? '').trim();
  if (!s) throw new Error('deadlock 要写 res:（每类资源有几个，如 res: R1 3, R2 2）');
  if (/^[\d\s]+$/.test(s)) return s.split(/\s+/).map((x, j) => ({ name: `R${j + 1}`, total: Number(x) }));
  return s.split(/[,，;；]+/).map((x) => x.trim()).filter(Boolean).map((part) => {
    const m = /^([A-Za-z]\w*)\s*(?:[=:：×x*]|\s)\s*(\d+)$/.exec(part);
    if (!m) throw new Error(`res: 看不懂「${part}」，写成「R1 3」（资源名和个数）`);
    return { name: m[1], total: Number(m[2]) };
  });
}

// 矩阵：一行一个进程「P1 1 0 1」（按 res 的顺序），用分号或换行隔开
function parseMatrix(src, what, m) {
  const rows = [];
  for (const [k, r] of String(src ?? '').split(/[;；\n]+/).map((x) => x.trim()).filter(Boolean).entries()) {
    const t = r.split(/[\s,，]+/).filter(Boolean);
    const name = /^\d+$/.test(t[0]) ? `P${k + 1}` : t.shift();
    if (t.length !== m || !t.every((x) => /^\d+$/.test(x))) throw new Error(`${what}: 「${r}」要写进程名和 ${m} 个数（每类资源一个，按 res: 的顺序）`);
    rows.push({ name, v: t.map(Number) });
  }
  return rows;
}

function parse(fields) {
  const res = parseRes(fields.res);
  const m = res.length;
  if (m < 1 || m > 5) throw new Error('res: 写 1～5 类资源');
  for (const r of res) if (r.total < 1 || r.total > 6) throw new Error(`res: ${r.name} 写 1～6 个（画成框里的点）`);
  const rnames = res.map((r) => r.name);
  if (new Set(rnames).size !== m) throw new Error('res: 资源名有重复');
  const procs = [];
  const alloc = new Map(), req = new Map();
  const proc = (name) => {
    if (rnames.includes(name)) throw new Error(`${name} 是资源，不能当进程`);
    if (!procs.includes(name)) { procs.push(name); alloc.set(name, Array(m).fill(0)); req.set(name, Array(m).fill(0)); }
  };
  const hasEdges = fields.edges !== undefined && String(fields.edges).trim() !== '';
  const hasMat = (fields.alloc ?? '') !== '' || (fields.request ?? '') !== '';
  if (hasEdges && hasMat) throw new Error('edges:（一条条边）和 alloc: / request:（矩阵）只写一种');
  for (const p of String(fields.procs ?? '').split(/[\s,，、]+/).filter(Boolean)) proc(p);
  if (hasEdges) {
    // 边：R1->P1（分配给 P1 一个 R1），P1->R2（P1 请求一个 R2）；后面写 2 或 ×2 是几条
    for (const part of String(fields.edges).split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
      const e = /^([A-Za-z]\w*)\s*(?:->|→)\s*([A-Za-z]\w*)(?:\s*[×x*]?\s*(\d+))?$/.exec(part);
      if (!e) throw new Error(`edges: 看不懂「${part}」，写成 R1->P1（分配）、P1->R2（请求），几条写 R1->P1 2`);
      const [a, b, c] = [e[1], e[2], Number(e[3] ?? 1)];
      if (rnames.includes(a) && !rnames.includes(b)) { proc(b); alloc.get(b)[rnames.indexOf(a)] += c; } else if (!rnames.includes(a) && rnames.includes(b)) { proc(a); req.get(a)[rnames.indexOf(b)] += c; } else throw new Error(`edges: 「${part}」要一头是进程、一头是资源（资源是 res: 里的 ${rnames.join('、')}）`);
    }
    // 边是想到哪写到哪的：没用 procs: 定顺序时按名字排（P1、P2……P10），画图、按编号找都按它
    if (!String(fields.procs ?? '').trim()) procs.sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
  } else if (hasMat) {
    for (const r of parseMatrix(fields.alloc, 'alloc', m)) { proc(r.name); alloc.set(r.name, r.v); }
    for (const r of parseMatrix(fields.request, 'request', m)) { proc(r.name); req.set(r.name, r.v); }
  } else throw new Error('deadlock 要写 edges:（如 R1->P1, P1->R2），或者 alloc: 和 request:（矩阵，一行一个进程）');
  if (!procs.length) throw new Error('deadlock 至少要有一个进程');
  if (procs.length > 8) throw new Error('最多 8 个进程');
  const A = procs.map((p) => alloc.get(p)), Q = procs.map((p) => req.get(p));
  res.forEach((r, j) => {
    const used = A.reduce((s, row) => s + row[j], 0);
    if (used > r.total) throw new Error(`${r.name} 一共 ${r.total} 个，分配出去了 ${used} 个：分多了`);
  });
  const show = String(fields.show ?? 'both').trim().toLowerCase() || 'both';
  if (!['graph', 'table', 'both'].includes(show)) throw new Error('show: 写 graph（只画图）、table（只画表）或 both（默认）');
  return { procs, res, alloc: A, req: Q, show, mistake: '' };
}

// 资源分配图里有没有环（进程 → 资源：请求；资源 → 进程：分配）
export function hasCycle(input) {
  const n = input.procs.length, m = input.res.length;
  const out = (u) => (u < n ? input.res.map((_, j) => (input.req[u][j] > 0 ? n + j : -1)) : input.procs.map((_, i) => (input.alloc[i][u - n] > 0 ? i : -1))).filter((x) => x >= 0);
  const color = Array(n + m).fill(0);
  const dfs = (u) => { color[u] = 1; for (const v of out(u)) { if (color[v] === 1) return true; if (!color[v] && dfs(v)) return true; } color[u] = 2; return false; };
  for (let u = 0; u < n + m; u++) if (!color[u] && dfs(u)) return true;
  return false;
}

// mistake（只在算常见错法时用）：
//   total      拿资源总数（而不是剩下可用的）和请求比
//   noRelease  化简一个进程以后没把它占着的资源还回去
//   cycle      看到有环就判死锁
function run(input) {
  const { procs, res, alloc, req, mistake } = input;
  const total = res.map((r) => r.total);
  let avail = total.map((t, j) => t - alloc.reduce((s, row) => s + row[j], 0));
  const avail0 = avail.slice();
  const done = Array(procs.length).fill(false);
  const order = [];
  const steps = [];
  const v = (extra = {}) => ({ avail: avail.slice(), done: done.slice(), order: order.slice(), ...extra });
  const rn = res.map((r) => r.name).join(' ');
  steps.push({ view: v({ stage: 'start' }), msg: `${procs.length} 个进程，${res.map((r) => `${r.name} ${r.total} 个`).join('、')}。实线箭头（资源 → 进程）是分配边，虚线箭头（进程 → 资源）是请求边。化简：找请求都能满足的进程，去掉它的边、还回它占着的资源，一直做下去。` });
  steps.push({ view: v({ stage: 'avail' }), msg: `每类资源还剩：总数 ${vec(total)} − 分配出去的 ${vec(total.map((t, j) => t - avail0[j]))} = ${vec(avail0)}（框里空心的点）。`, ask: { tag: 'avail', kind: 'text', q: `一开始每类资源还剩几个？按 ${rn} 的顺序写，空格隔开。`, answer: avail0.join(' ') } });
  for (;;) {
    const cmp = mistake === 'total' ? total : avail;
    const can = procs.map((_, i) => i).filter((i) => !done[i] && le(req[i], cmp));
    if (!can.length) break;
    const i = can[0];
    const before = avail.slice();
    done[i] = true;
    order.push(i);
    if (mistake !== 'noRelease') avail = add(avail, alloc[i]);
    const reqText = req[i].some(Boolean) ? `请求 ${vec(req[i])} ≤ 可用 ${vec(before)}，能拿到资源运行完` : '没有请求边，不阻塞，能运行完';
    const relText = alloc[i].some(Boolean) ? `还回它占着的 ${vec(alloc[i])}，可用变成 ${vec(avail)}` : '它没占资源，可用还是 ' + vec(avail);
    steps.push({ view: v({ stage: 'reduce', cur: i, before }), msg: `${procs[i]} ${reqText}。化简：去掉 ${procs[i]} 的所有边，${relText}。${can.length > 1 ? `（这时能化简的有 ${can.map((x) => procs[x]).join('、')}，先化简哪个都行，这里按编号从小到大。）` : ''}`, ask: { tag: 'next', kind: 'pick', q: '下一个能化简的进程是？（它的请求现在都能满足）在图里点出来。', alts: can.map((x) => procs[x]) } });
  }
  const left = procs.map((_, i) => i).filter((i) => !done[i]);
  const cyc = hasCycle(input);
  const says = mistake === 'cycle' ? cyc : left.length > 0;
  const deadAsk = { tag: 'dead', kind: 'choice', q: '这个状态有死锁吗？', choices: ['有死锁', '没有死锁'], answer: says ? '有死锁' : '没有死锁' };
  const seq = order.map((i) => procs[i]).join(' → ');
  if (!left.length) {
    steps.push({ view: v({ stage: 'end' }), msg: `所有进程都化简掉了（${seq}）：资源分配图能完全化简，没有死锁。${cyc ? '图里是有环的：资源不止一个时，有环不一定死锁。' : ''}`, ask: deadAsk });
  } else {
    const names = left.map((i) => procs[i]);
    steps.push({ view: v({ stage: 'stuck' }), msg: `可用 ${vec(avail)}，剩下的 ${names.join('、')} 的请求都满足不了：图不能完全化简，有死锁（死锁定理）。`, ask: deadAsk });
    steps.push({ view: v({ stage: 'dead', dead: left }), msg: `死锁的就是化简不掉的 ${names.join('、')}${order.length ? `（化简掉的 ${order.map((i) => procs[i]).join('、')} 能运行完）` : ''}。`, ask: { tag: 'who', kind: 'pick', q: '哪些进程死锁了？在图里点出来。', ...(names.length > 1 ? { count: names.length, alts: [names] } : { answer: names[0] }) } });
  }
  return { steps, order, left, avail0, cyc };
}

// ================= 画面 =================
// 一段带箭头的线（箭头画成三角形，不用 marker：一页里好几张图时 marker 的 id 会撞）
function arrow(x1, y1, x2, y2, cls, extra = '') {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const bx = x2 - ux * 10, by = y2 - uy * 10;
  const f = (x) => Math.round(x * 10) / 10;
  return `<g class="dk-e ${cls}"${extra}><line x1="${f(x1)}" y1="${f(y1)}" x2="${f(bx)}" y2="${f(by)}"/><path d="M ${f(x2)} ${f(y2)} L ${f(bx - uy * 4.5)} ${f(by + ux * 4.5)} L ${f(bx + uy * 4.5)} ${f(by - ux * 4.5)} z"/></g>`;
}

function graph(s, input) {
  const { procs, res, alloc, req } = input;
  const n = procs.length, m = res.length;
  const step = 96;
  const W = Math.max(320, Math.max(n, m) * step + 24);
  const xs = (k, cnt) => W / 2 + (k - (cnt - 1) / 2) * Math.min(step, (W - 24) / cnt);
  const PY = 40, R = 22, BY = 172, BH = 36;
  const bw = (j) => Math.max(48, res[j].total * 16 + 16);
  const gone = (i) => s.done[i] && i !== s.cur; // 前面已经化简掉的：边不画了
  let edges = '', nodes = '', labels = '';
  res.forEach((r, j) => {
    const bx = xs(j, m), w = bw(j);
    // 框里的点：从左往右先分给还没化简掉的进程（实心），剩下的是可用的（空心）
    let d = 0;
    const dotX = (k) => bx - ((r.total - 1) * 16) / 2 + k * 16;
    const owner = [];
    procs.forEach((_, i) => { if (gone(i)) return; for (let a = 0; a < alloc[i][j]; a++) owner[d++] = i; });
    for (let k = 0; k < r.total; k++) {
      const i = owner[k];
      // 这一步化简掉的进程：它的点已经空出来了（空心），淡掉的边还从这些点连过去
      const free = i === undefined || i === s.cur;
      nodes += `<circle class="dk-dot${free ? ' dk-free' : ''}${(s.stage === 'avail' && i === undefined) || (i !== undefined && i === s.cur) ? ' sv-new' : ''}" cx="${dotX(k)}" cy="${BY}" r="5"/>`;
      if (i !== undefined) {
        const px = xs(i, n), dx = px - dotX(k), dy = PY - (BY - 6), L = Math.hypot(dx, dy);
        edges += arrow(dotX(k), BY - 6, px - (dx / L) * R, PY - (dy / L) * R, `dk-al${i === s.cur ? ' dk-gone' : ''}`);
      }
    }
    nodes = `<g class="dk-r" data-cmd="${n + j + 1}" data-label="${esc(r.name)}"><rect x="${bx - w / 2}" y="${BY - BH / 2}" width="${w}" height="${BH}" rx="6"/><text class="dk-rname" x="${bx}" y="${BY + BH / 2 + 17}">${esc(r.name)}</text></g>` + nodes;
  });
  procs.forEach((p, i) => {
    if (gone(i)) return;
    const px = xs(i, n);
    res.forEach((r, j) => {
      const c = req[i][j];
      if (!c) return;
      const bx = xs(j, m), w = bw(j);
      const tx = Math.max(bx - w / 2 + 8, Math.min(bx + w / 2 - 8, bx + (px - bx) * 0.35));
      const ty = BY - BH / 2;
      const dx = tx - px, dy = ty - PY, L = Math.hypot(dx, dy);
      // 同一对进程、资源之间也有分配边时，请求边往旁边挪一点，不叠在一起
      const off = alloc[i][j] ? 9 : 0;
      const ox = (-dy / L) * off, oy = (dx / L) * off;
      edges += arrow(px + (dx / L) * R + ox, PY + (dy / L) * R + oy, tx + ox, ty + oy, `dk-rq${i === s.cur ? ' dk-gone' : ''}`);
      if (c > 1) labels += `<text class="dk-cnt" x="${(px + tx) / 2 + ox + 10}" y="${(PY + ty) / 2 + oy}">×${c}</text>`;
    });
  });
  procs.forEach((p, i) => {
    const cls = ['dk-p', i === s.cur ? 'dk-cur' : '', gone(i) ? 'dk-done' : '', s.dead?.includes(i) ? 'dk-dead' : ''].filter(Boolean).join(' ');
    // 化简掉的进程不再能点（图上它已经没有边了）
    nodes += `<g class="${cls}"${s.done[i] ? '' : ` data-pick="${esc(p)}"`} data-cmd="${i + 1}" data-label="${esc(p)}"><circle cx="${xs(i, n)}" cy="${PY}" r="${R}"/><text x="${xs(i, n)}" y="${PY}">${esc(p)}</text>${s.done[i] ? `<text class="dk-k" x="${xs(i, n) + R + 2}" y="${PY - R + 4}">${s.order.indexOf(i) + 1}</text>` : ''}</g>`;
  });
  return `<svg class="dk-svg" viewBox="0 0 ${W} ${BY + BH / 2 + 26}" width="${W}" style="max-width:100%" role="img" aria-label="资源分配图">${edges}${labels}${nodes}</svg>`;
}

function table(s, input, withCmd) {
  const { procs, res, alloc, req } = input;
  const rn = res.map((r) => esc(r.name)).join(' ');
  const rows = procs.map((p, i) => {
    const state = s.done[i] ? `第 ${s.order.indexOf(i) + 1} 个化简` : s.dead?.includes(i) ? '死锁' : '';
    const cls = [i === s.cur ? 'dk-currow' : '', s.done[i] && i !== s.cur ? 'dk-donerow' : '', s.dead?.includes(i) ? 'dk-deadrow' : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}"><td${s.done[i] ? '' : ` data-pick="${esc(p)}"`}${withCmd ? ` data-cmd="${i + 1}" data-label="${esc(p)}"` : ''}><b>${esc(p)}</b></td><td>${alloc[i].join(' ')}</td><td>${req[i].join(' ')}</td><td>${state}</td></tr>`;
  }).join('');
  return `<div class="sv-gtbl-wrap"><table class="sv-gtbl sv-tab dk-tab"><thead><tr><th>进程</th><th>已分配<small>${rn}</small></th><th>请求<small>${rn}</small></th><th>化简</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function view(s, input) {
  let h = '';
  if (input.show !== 'table') h += graph(s, input);
  if (input.show !== 'graph') h += table(s, input, input.show === 'table');
  const showAvail = s.stage !== 'start';
  return h + chips([['总数', vec(input.res.map((r) => r.total))], ...(showAvail ? [['可用', vec(s.avail)]] : []), ...(s.order.length ? [['化简顺序', s.order.map((i) => input.procs[i]).join(' → ')]] : [])]);
}

// 一个 run 里学生能答的：错法算出来和对的一样就不列
function answersOf(input, r) {
  const asks = r.steps.map((s) => s.ask).filter(Boolean).map((a) => [a.q, JSON.stringify(a.alts ?? a.answer)]);
  let t = null;
  try { t = deadlockEngine.table(input, r); } catch { /* */ }
  return JSON.stringify([asks, t && t.rows.map((row) => row.cells.map((x) => x.v)), t?.extra?.map((x) => x.v)]);
}

// 几个进程的所有排法（死锁的进程写哪个顺序都对）
const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));

export const deadlockEngine = {
  name: 'deadlock', title: '死锁检测', parse, run, view,
  quiz(input, r) {
    const left = r.left.map((i) => input.procs[i]);
    return {
      q: '这个状态有没有死锁？没有写「无」；有就写出死锁的进程（如 P1 P2）。',
      qhtml: view(r.steps[0].view, input),
      type: 'seq',
      answer: left.length ? perms(left).slice(0, 40).map((p) => p.join(' ')).join(' | ') : '无 | 没有 | 没有死锁',
    };
  },
  // 考卷上那张表：一开始的可用；每次化简掉谁（编号小的先）、之后的可用；最后有没有死锁
  table(input, r) {
    const rows = [{ label: '一开始', cells: [{ v: '', given: true }, { v: r.avail0.join(' '), vec: true }] }];
    const red = r.steps.filter((x) => x.view.stage === 'reduce');
    red.forEach((x, k) => rows.push({ label: `第 ${k + 1} 个化简`, cells: [{ v: input.procs[x.view.cur] }, { v: x.view.avail.join(' '), vec: true }] }));
    // 化简不完（死锁）时后面几行空着：行数不泄露能化简几个
    for (let k = red.length; k < input.procs.length; k++) rows.push({ label: `第 ${k + 1} 个化简`, cells: [{ v: '' }, { v: '', vec: true }] });
    return {
      q: `先算一开始每类资源还剩几个（按 ${input.res.map((x) => x.name).join(' ')} 的顺序，写成「1 0 2」）；再一个个化简（能化简的有几个时选编号小的），写出化简掉的进程和之后的可用（化简不下去了，后面就空着）；最后写有没有死锁。`,
      qhtml: view(r.steps[0].view, input), dir: 'row', head: ['进程', '可用'], rows,
      extra: [{ label: '有没有死锁', v: r.left.length ? ['有', '有死锁', '是', '死锁'] : ['没有', '无', '没有死锁', '否'] }],
    };
  },
  // 常见错法：有环就判死锁、拿资源总数和请求比、化简以后没把资源还回去
  variants(input) {
    const list = [
      { label: '像是看到有环就判了死锁（每类资源不止一个时，有环不一定死锁：要看能不能完全化简）', input: { ...input, mistake: 'cycle' } },
      { label: '像是拿资源的总数和请求比了（要和现在剩下可用的比）', input: { ...input, mistake: 'total' } },
      { label: '像是化简一个进程以后没把它占着的资源还回去（去掉它的分配边，这些资源就空出来了）', input: { ...input, mistake: 'noRelease' } },
    ];
    let base;
    try { base = answersOf(input, run(input)); } catch { return []; }
    return list.filter((v) => { try { return answersOf(v.input, run(v.input)) !== base; } catch { return false; } });
  },
  problems(input) {
    const out = [];
    input.procs.forEach((p, i) => input.res.forEach((r, j) => { if (input.req[i][j] + input.alloc[i][j] > r.total) out.push(`${p} 占着加请求的 ${r.name} 一共 ${input.req[i][j] + input.alloc[i][j]} 个，比 ${r.name} 的总数 ${r.total} 还多：永远满足不了`); }));
    return out;
  },
};

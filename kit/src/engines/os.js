// 操作系统的演示引擎（纯函数，不碰 DOM；tests/os-engine.test.js）：
//   sched   进程调度：FCFS、SJF、SRTF（抢占式短作业）、HRRN（高响应比）、优先级（非抢占 / 抢占）、RR（时间片轮转），甘特图 + 周转时间表
//   paging  页面置换：FIFO、LRU、OPT、CLOCK，王道那种一列一个访问的表
//   banker  银行家算法：Need、（请求）、安全性算法，找安全序列
//   disk    磁盘调度：FCFS、SSTF、SCAN、C-SCAN、LOOK、C-LOOK，磁头移动的折线图
// 教材之间有不同约定的地方（同时到达谁先、优先级数字大还是小高……）都写在说明里，并按王道的写法默认。
import { chips, esc } from './arrayview.js';

const frac = (a, b) => { const g = gcd(a, b); return b / g === 1 ? `${a / g}` : `${a / g}/${b / g}`; };
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; }
const round2 = (x) => Math.round(x * 100) / 100;
const avgText = (sum, n) => { const v = sum / n; return Number.isInteger(v) ? String(v) : `${frac(sum, n)} ≈ ${round2(v)}`; };
const table = (head, rows, cls = '') => `<div class="sv-gtbl-wrap"><table class="sv-gtbl ${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => (c && typeof c === 'object' ? `<td class="${c.cls || ''}"${c.attrs || ''}>${c.html}</td>` : `<td>${c ?? ''}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;

// ================= 进程调度 =================

const SCHED = { fcfs: '先来先服务 FCFS', sjf: '短作业优先 SJF（非抢占）', srtf: '最短剩余时间优先 SRTF（抢占式短作业优先）', hrrn: '高响应比优先 HRRN', prio: '优先级调度（非抢占）', pprio: '优先级调度（抢占）', rr: '时间片轮转 RR' };
const SCHED_ALIAS = { fcfs: 'fcfs', fifo: 'fcfs', 先来先服务: 'fcfs', sjf: 'sjf', spf: 'sjf', 短作业优先: 'sjf', srtf: 'srtf', srtn: 'srtf', 抢占式短作业优先: 'srtf', hrrn: 'hrrn', 高响应比: 'hrrn', 高响应比优先: 'hrrn', prio: 'prio', priority: 'prio', 优先级: 'prio', pprio: 'pprio', 抢占式优先级: 'pprio', rr: 'rr', 时间片轮转: 'rr' };

function schedParse(fields) {
  const raw = String(fields.procs ?? '').split(/[;；\n]+|,(?=\s*[A-Za-z一-龥])/).map((x) => x.trim()).filter(Boolean);
  if (!raw.length) throw new Error('sched 要写 procs:（一个进程一组：名字 到达时间 运行时间 [优先级]，用逗号或分号隔开，如 P1 0 3, P2 2 6）');
  const procs = raw.map((x, k) => {
    const t = x.split(/[\s,，]+/).filter(Boolean);
    if (t.length < 3 || t.length > 4 || !t.slice(1).every((v) => /^\d+(\.\d+)?$/.test(v))) throw new Error(`procs: 看不懂「${x}」，写成「P1 0 3」（到达 0、运行 3），要优先级再加一个数「P1 0 3 2」`);
    const [name, a, b, p] = t;
    if (Number(b) <= 0) throw new Error(`procs: ${name} 的运行时间要大于 0`);
    return { name, arrive: Number(a), burst: Number(b), prio: p === undefined ? null : Number(p), k };
  });
  if (procs.length > 10) throw new Error('procs: 最多 10 个进程');
  if (new Set(procs.map((p) => p.name)).size !== procs.length) throw new Error('procs: 进程名字不能重复');
  const m = /^(\S+)(?:\s+q\s*=\s*(\d+(?:\.\d+)?))?$/i.exec(String(fields.algo || '').trim());
  const algo = m && SCHED_ALIAS[m[1].toLowerCase()];
  if (!algo) throw new Error(`sched 要写 algo:（${Object.keys(SCHED).join('、')}；时间片轮转写 rr q=2）`);
  const q = algo === 'rr' ? Number(m[2] ?? fields.q) : null;
  if (algo === 'rr' && !(q > 0)) throw new Error('时间片轮转要写时间片：algo: rr q=2');
  if ((algo === 'prio' || algo === 'pprio') && procs.some((p) => p.prio === null)) throw new Error('优先级调度要给每个进程写优先级（procs: P1 0 3 2，最后一个数是优先级）');
  const prioSmall = !/^(large|大|big|数大优先|大的优先)$/i.test(String(fields.prio || '').trim());
  return { procs, algo, q, prioSmall };
}

function schedRun({ procs, algo, q, prioSmall, rrOld = false }) {
  const P = procs.map((p) => ({ ...p, rem: p.burst, done: null, first: null }));
  const segs = []; // { name, s, e }（name 为 null 是空闲）
  const steps = [];
  let t = 0;
  let ready = []; // 就绪队列（名字），RR 里是真正的先进先出队列
  const arrived = new Set();
  const byName = Object.fromEntries(P.map((p) => [p.name, p]));
  const v = (extra = {}) => ({ t, segs: segs.map((x) => ({ ...x })), ready: ready.slice(), rem: Object.fromEntries(P.map((p) => [p.name, p.rem])), done: Object.fromEntries(P.map((p) => [p.name, p.done])), ...extra });
  const admit = (upTo) => { // 到达时间 ≤ upTo 的进程进就绪队列（同时到达按写的顺序）
    const fresh = P.filter((p) => !arrived.has(p.name) && p.arrive <= upTo).sort((a, b) => a.arrive - b.arrive || a.k - b.k);
    for (const p of fresh) { arrived.add(p.name); ready.push(p.name); }
    return fresh.map((p) => p.name);
  };
  const better = (a, b) => { // a 比 b 更该先运行（非 RR）
    const A = byName[a], B = byName[b];
    if (algo === 'sjf') return A.burst - B.burst || A.arrive - B.arrive || A.k - B.k;
    if (algo === 'srtf') return A.rem - B.rem || A.arrive - B.arrive || A.k - B.k;
    if (algo === 'prio' || algo === 'pprio') return (prioSmall ? A.prio - B.prio : B.prio - A.prio) || A.arrive - B.arrive || A.k - B.k;
    if (algo === 'hrrn') { const ra = (t - A.arrive + A.burst) / A.burst, rb = (t - B.arrive + B.burst) / B.burst; return rb - ra || A.arrive - B.arrive || A.k - B.k; }
    return A.arrive - B.arrive || A.k - B.k;
  };
  const pickBest = () => ready.slice().sort(better)[0];
  const why = (name) => {
    const p = byName[name];
    if (algo === 'fcfs') return `最先到的是 ${name}（${p.arrive} 时到达）`;
    if (algo === 'sjf') return `运行时间最短的是 ${name}（${p.burst}）`;
    if (algo === 'srtf') return `剩余时间最短的是 ${name}（还剩 ${p.rem}）`;
    if (algo === 'hrrn') return `响应比 =（等待 + 运行）/ 运行：${ready.map((x) => { const y = byName[x]; return `${x} = (${t - y.arrive} + ${y.burst})/${y.burst} = ${round2((t - y.arrive + y.burst) / y.burst)}`; }).join('，')}，最高的是 ${name}`;
    return `优先级最高的是 ${name}（${p.prio}，${prioSmall ? '数越小越高' : '数越大越高'}）`;
  };
  const preempt = algo === 'srtf' || algo === 'pprio';
  steps.push({ view: v(), msg: `${SCHED[algo]}${algo === 'rr' ? `，时间片 ${q}` : ''}。${algo === 'rr' ? '就绪队列先进先出；时间片用完的进程排到队尾（同一时刻有新进程到达时，新进程先入队，用完时间片的再排在后面）。' : preempt ? '新进程到达时重新比较，更合适的就抢占。' : '一个进程开始运行就一直运行到结束（非抢占）。'}` });
  const total = P.length;
  let finished = 0;
  admit(t);
  while (finished < total) {
    if (!ready.length) {
      // CPU 空闲，等下一个进程到达
      const nx = Math.min(...P.filter((p) => !arrived.has(p.name)).map((p) => p.arrive));
      segs.push({ name: null, s: t, e: nx });
      t = nx;
      const fresh = admit(t);
      steps.push({ view: v(), msg: `就绪队列是空的，CPU 空闲到 ${t}，${fresh.join('、')} 到达。` });
      continue;
    }
    const name = algo === 'rr' ? ready[0] : pickBest();
    const p = byName[name];
    const ask = { tag: 'next', kind: 'pick', q: `t = ${t}：接下来运行哪个进程？在就绪队列里点出来。`, answer: name };
    const queueText = ready.map((x) => `${x}${algo === 'srtf' ? `(剩${byName[x].rem})` : ''}`).join('、');
    ready = ready.filter((x) => x !== name);
    if (p.first === null) p.first = t;
    // 这一段运行多久
    let run = p.rem;
    if (algo === 'rr') run = Math.min(q, p.rem);
    if (preempt) {
      // 有更合适的进程在运行结束前到达，就在那一刻抢占
      for (const o of P.filter((x) => !arrived.has(x.name) && x.arrive < t + p.rem).sort((a, b) => a.arrive - b.arrive || a.k - b.k)) {
        const remAt = p.rem - (o.arrive - t);
        const beats = algo === 'srtf' ? o.burst < remAt : prioSmall ? o.prio < p.prio : o.prio > p.prio;
        if (beats) { run = o.arrive - t; break; }
      }
    }
    const start = t;
    t += run;
    p.rem -= run;
    segs.push({ name, s: start, e: t });
    // 错法「用完时间片的先排、新到的后排」（rrOld）只在算常见错法时用
    if (algo === 'rr' && rrOld && p.rem > 0) ready.push(name);
    const fresh = admit(t);
    let tail = '';
    if (p.rem === 0) { p.done = t; finished++; tail = `${name} 运行完（完成时间 ${t}）。`; }
    else if (algo === 'rr') { if (!rrOld) ready.push(name); tail = `时间片用完，${name} 还剩 ${p.rem}，${fresh.length ? `先让新到的 ${fresh.join('、')} 入队，再` : ''}排到队尾。`; }
    else { tail = `${fresh.join('、')} 到达，${name} 还剩 ${p.rem}，被抢占，回到就绪队列。`; ready.push(name); }
    steps.push({ view: v({ run: name }), msg: `t = ${start}：就绪队列 ${queueText}。${algo === 'rr' ? `队头是 ${name}` : why(name)}，运行 ${name}（${start}～${t}）。${tail}${fresh.length && (p.rem === 0 || algo !== 'rr') && !tail.includes('到达') ? `${fresh.join('、')} 在这期间到达。` : ''}`, ask });
  }
  // 统计
  const rows = P.map((p) => { const turn = p.done - p.arrive; return { name: p.name, arrive: p.arrive, burst: p.burst, done: p.done, turn, weighted: turn / p.burst, wait: turn - p.burst }; });
  const n = rows.length;
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const avgW = rows.reduce((a, r) => a + r.weighted, 0) / n;
  steps.push({ view: v({ stats: true }), msg: `全部完成。周转时间 = 完成时间 − 到达时间，带权周转 = 周转 / 运行时间，等待时间 = 周转 − 运行时间。平均周转时间 = ${sum('turn')}/${n} = ${avgText(sum('turn'), n)}，平均等待时间 = ${avgText(sum('wait'), n)}，平均带权周转时间 ≈ ${round2(avgW)}。`, ask: { tag: 'avg', kind: 'number', q: '平均周转时间是多少？', answer: sum('turn') / n, display: avgText(sum('turn'), n) } });
  return { steps, segs, rows, avgTurn: sum('turn') / n, avgWait: sum('wait') / n, avgWeighted: avgW, order: segs.filter((x) => x.name).map((x) => x.name) };
}

// 甘特图：同一个进程的每一段颜色一样（names 给出进程的顺序）
function gantt(segs, end, names = []) {
  if (!segs.length) return '<div class="os-gantt os-empty muted">（还没有进程运行）</div>';
  const T = Math.max(end, segs.at(-1).e);
  const ticks = [...new Set([0, ...segs.flatMap((x) => [x.s, x.e])])].sort((a, b) => a - b);
  const color = (n) => (n ? ` os-c${names.indexOf(n) % 5}` : ' os-idle');
  return `<div class="os-gantt"><div class="os-bars">${segs.map((x) => `<div class="os-bar${color(x.name)}" style="left:${(x.s / T) * 100}%;width:${((x.e - x.s) / T) * 100}%" data-label="${esc(x.name || '空闲')}">${esc(x.name || '空闲')}</div>`).join('')}</div><div class="os-ticks">${ticks.map((x) => `<span class="${x === 0 ? 'os-t0' : x === T ? 'os-tend' : ''}" style="left:${(x / T) * 100}%">${x}</span>`).join('')}</div></div>`;
}

function schedView(s, input) {
  const P = input.procs;
  let h = gantt(s.segs, s.t || 1, P.map((p) => p.name));
  h += `<div class="os-ready"><span class="os-label">t = ${s.t}　就绪队列</span>${s.ready.length ? s.ready.map((x) => `<span class="os-proc" data-pick="${esc(x)}" data-label="${esc(x)}">${esc(x)}</span>`).join('<i>←</i>') : '<span class="muted">（空）</span>'}</div>`;
  const head = ['进程', '到达', '运行', ...(P.some((p) => p.prio !== null) ? ['优先级'] : []), '剩余', '完成', ...(s.stats ? ['周转', '带权周转', '等待'] : [])];
  const rows = P.map((p, i) => {
    const done = s.done[p.name];
    const turn = done !== null ? done - p.arrive : null;
    return [{ html: `<b>${esc(p.name)}</b>`, attrs: ` data-cmd="${i + 1}" data-label="${esc(p.name)}"`, cls: s.run === p.name ? 'sv-pickcell' : '' }, p.arrive, p.burst, ...(P.some((x) => x.prio !== null) ? [p.prio ?? ''] : []), s.rem[p.name], done ?? '', ...(s.stats ? [turn, round2(turn / p.burst), turn - p.burst] : [])];
  });
  return h + table(head, rows);
}

export const schedEngine = {
  name: 'sched',
  title: '进程调度',
  parse: schedParse,
  run: schedRun,
  view: schedView,
  quiz(input, r, fields) {
    const what = String(fields.quiz || 'order').toLowerCase();
    const head = `用${SCHED[input.algo]}${input.q ? `（时间片 ${input.q}）` : ''}调度这几个进程。`;
    if (what === 'avg' || what === 'turn') return { q: `${head}平均周转时间是多少？（写分数或小数）`, qhtml: schedProcTable(input), type: 'num', answer: frac(r.rows.reduce((a, x) => a + x.turn, 0), r.rows.length) };
    if (what === 'wait') return { q: `${head}平均等待时间是多少？（写分数或小数）`, qhtml: schedProcTable(input), type: 'num', answer: frac(r.rows.reduce((a, x) => a + x.wait, 0), r.rows.length) };
    return { q: `${head}按时间顺序写出 CPU 上依次运行的进程（同一个进程被打断后再运行要再写一次，空闲不写）。`, qhtml: schedProcTable(input), type: 'seq', answer: r.order.join(' ') };
  },
  // 考卷上那张表：每个进程的完成时间、周转时间、带权周转时间、等待时间
  table(input, r) {
    return {
      q: `用${SCHED[input.algo]}${input.q ? `（时间片 ${input.q}）` : ''}调度这几个进程。先在纸上画甘特图，再填每个进程的完成时间、周转时间、带权周转时间（除不尽写分数）、等待时间。`,
      qhtml: schedProcTable(input),
      dir: 'row',
      head: ['完成时间', '周转时间', '带权周转', '等待时间'],
      rows: r.rows.map((x) => ({ label: x.name, cells: [{ v: String(x.done), num: true }, { v: String(x.turn), num: true }, { v: frac(x.turn, x.burst), num: true }, { v: String(x.wait), num: true }] })),
    };
  },
  // 常见错法：换成别的调度算法；抢占 / 非抢占弄反；RR 里新到的和用完时间片的谁先入队弄反
  variants(input) {
    const hasPrio = input.procs.some((p) => p.prio !== null);
    const algos = ['fcfs', 'sjf', 'srtf', 'hrrn', ...(hasPrio ? ['prio', 'pprio'] : []), ...(input.q ? ['rr'] : [])].filter((a) => a !== input.algo);
    const out = algos.map((a) => ({ label: `像是按${SCHED[a]}排的`, input: { ...input, algo: a, q: a === 'rr' ? input.q : null } }));
    if (input.algo === 'rr') out.unshift({ label: '像是把用完时间片的进程排在了新到达的进程前面（王道：同一时刻新到的先入队）', input: { ...input, rrOld: true } });
    return out;
  },
};
const schedProcTable = (input) => table(['进程', '到达时间', '运行时间', ...(input.procs.some((p) => p.prio !== null) ? ['优先级'] : [])], input.procs.map((p) => [p.name, p.arrive, p.burst, ...(p.prio !== null ? [p.prio] : [])]));

// ================= 页面置换 =================

const PAGING = { fifo: '先进先出 FIFO', lru: '最近最久未使用 LRU', opt: '最佳置换 OPT', clock: '简单 CLOCK（NRU）' };

function pagingParse(fields) {
  const refs = String(fields.refs ?? '').trim().split(/[\s,，、]+/).filter(Boolean);
  if (!refs.length) throw new Error('paging 要写 refs:（页面引用串，如 7 0 1 2 0 3 0 4）');
  if (refs.length > 24) throw new Error('refs: 最多 24 个');
  const frames = Number(fields.frames);
  if (!Number.isInteger(frames) || frames < 1 || frames > 6) throw new Error('paging 要写 frames:（分给进程的物理块数，1 到 6）');
  const algo = String(fields.algo || '').trim().toLowerCase();
  if (!PAGING[algo]) throw new Error(`paging 要写 algo:（${Object.entries(PAGING).map(([k, v]) => `${k} ${v}`).join('、')}）`);
  return { refs, frames, algo };
}

function pagingRun({ refs, frames, algo }) {
  const slots = Array(frames).fill(null);
  const use = Array(frames).fill(0);
  let ptr = 0;
  const loadedAt = Array(frames).fill(-1), usedAt = Array(frames).fill(-1);
  const cols = []; // 每次访问之后：{ slots, fault, victim, use, ptr, order }
  const steps = [];
  let faults = 0;
  const victims = [];
  const order = () => {
    // 换出的先后：FIFO 按进入的先后，LRU 按最近一次用的先后（最前面的最先换出）
    const idx = slots.map((x, i) => i).filter((i) => slots[i] !== null);
    if (algo === 'fifo') return idx.sort((a, b) => loadedAt[a] - loadedAt[b]).map((i) => slots[i]);
    if (algo === 'lru') return idx.sort((a, b) => usedAt[a] - usedAt[b]).map((i) => slots[i]);
    return null;
  };
  const snap = (k, extra = {}) => ({ k, cols: cols.slice(), ...extra });
  steps.push({ view: snap(-1), msg: `${PAGING[algo]}，分 ${frames} 个物理块，一开始都空着。依次访问 ${refs.join(' ')}（一开始调入也算缺页）。` });
  refs.forEach((pg, k) => {
    const at = slots.indexOf(pg);
    let msg, victim = null, slot = at;
    if (at >= 0) {
      usedAt[at] = k;
      if (algo === 'clock') use[at] = 1;
      msg = `访问 ${pg}：已经在内存里，命中。${algo === 'lru' ? `${pg} 变成最近用过的。` : algo === 'clock' ? `访问位置 1（指针不动）。` : ''}`;
    } else {
      faults++;
      const empty = slots.indexOf(null);
      if (empty >= 0) {
        slot = empty;
        msg = `访问 ${pg}：不在内存里，缺页。还有空的物理块，直接调入。`;
        if (algo === 'clock') ptr = (empty + 1) % frames;
      } else {
        if (algo === 'fifo') slot = loadedAt.indexOf(Math.min(...loadedAt));
        else if (algo === 'lru') slot = usedAt.indexOf(Math.min(...usedAt));
        else if (algo === 'opt') {
          const next = slots.map((x) => { const j = refs.indexOf(x, k + 1); return j < 0 ? Infinity : j; });
          // 以后都不再用的有好几个时，换先调入的那个
          const far = Math.max(...next);
          const cand = slots.map((_, i) => i).filter((i) => next[i] === far);
          slot = cand.sort((a, b) => loadedAt[a] - loadedAt[b])[0];
        } else {
          const scanned = [];
          for (;;) {
            if (use[ptr] === 0) { slot = ptr; ptr = (ptr + 1) % frames; break; }
            use[ptr] = 0; scanned.push(slots[ptr]); ptr = (ptr + 1) % frames;
          }
          if (scanned.length) msg = `（指针扫过 ${scanned.join('、')}，把它们的访问位清 0）`;
        }
        victim = slots[slot];
        victims.push(victim);
        const reason = algo === 'fifo' ? `${victim} 最先进入内存` : algo === 'lru' ? `${victim} 最久没被访问` : algo === 'opt' ? (() => { const j = refs.indexOf(victim, k + 1); return j < 0 ? `${victim} 以后再也不用` : `${victim} 要到第 ${j + 1} 个访问才再用，最远`; })() : `${victim} 的访问位是 0`;
        msg = `访问 ${pg}：不在内存里，缺页。物理块满了，${reason}，换出 ${victim}。${msg || ''}`;
      }
      slots[slot] = pg;
      loadedAt[slot] = k;
      usedAt[slot] = k;
      if (algo === 'clock') use[slot] = 1;
    }
    cols.push({ ref: pg, slots: slots.slice(), fault: at < 0, victim, use: use.slice(), ptr, order: order() });
    const ask = at >= 0 ? { tag: 'hit', kind: 'choice', q: `访问 ${pg}：命中还是缺页？`, choices: ['命中', '缺页'], answer: '命中' }
      : victim !== null ? { tag: 'victim', kind: 'pick', q: `访问 ${pg} 缺页了，物理块已满：换出哪一页？在表里最右边那一列点出来。`, answer: victim }
        : { tag: 'hit', kind: 'choice', q: `访问 ${pg}：命中还是缺页？`, choices: ['命中', '缺页'], answer: '缺页' };
    steps.push({ view: snap(k, { slot }), msg, ask });
  });
  const n = refs.length;
  steps.push({ view: snap(n - 1, { end: true }), msg: `一共缺页 ${faults} 次（包括一开始调入的 ${Math.min(frames, new Set(refs).size)} 次），缺页率 ${faults}/${n}${Number.isInteger((faults / n) * 100) ? ` = ${(faults / n) * 100}%` : ` ≈ ${round2((faults / n) * 100)}%`}。被换出的页依次是 ${victims.join(' ') || '（没有）'}。`, ask: { tag: 'faults', kind: 'number', q: '一共缺页多少次？', answer: faults } });
  return { steps, faults, victims };
}

function pagingView(s, input) {
  const { refs, frames, algo } = input;
  const cur = s.k;
  const head = ['', ...refs.map((r, k) => `<span class="${k === cur ? 'os-cur' : ''}">${esc(r)}</span>`)];
  const rows = [];
  for (let f = 0; f < frames; f++) {
    rows.push([`块 ${f + 1}`, ...refs.map((_, k) => {
      const c = s.cols[k];
      if (!c) return '';
      const x = c.slots[f];
      const isNew = c.fault && s.cols[k].slots[f] !== (k ? s.cols[k - 1].slots[f] : null);
      // 最新的那一列可以点（先猜「换出哪一页」时，学生看的是换页之前的这一列）
      const pickable = k === cur && x !== null ? ` data-pick="${esc(x)}" data-label="${esc(x)}"` : '';
      return { html: `${esc(x ?? '')}${algo === 'clock' && x !== null ? `<sup>${c.use[f]}</sup>` : ''}${algo === 'clock' && c.ptr === f && x !== null ? '<i class="os-ptr">◀</i>' : ''}`, cls: [isNew ? 'os-in' : '', k === cur ? 'os-curcol' : ''].join(' '), attrs: pickable };
    })]);
  }
  rows.push(['缺页', ...refs.map((_, k) => (s.cols[k] ? { html: s.cols[k].fault ? '✓' : '', cls: s.cols[k].fault ? 'os-fault' : '' } : ''))]);
  if (algo === 'fifo' || algo === 'lru') rows.push([algo === 'fifo' ? '进入的先后' : '最近使用', ...refs.map((_, k) => (s.cols[k]?.order ? { html: s.cols[k].order.join('<br>'), cls: 'os-order' } : ''))]);
  let h = table(head, rows, 'os-pt');
  const faults = s.cols.filter((c) => c.fault).length;
  h += chips([['已访问', `${s.cols.length} / ${refs.length}`], ['缺页', faults]]);
  return h;
}

export const pagingEngine = {
  name: 'paging',
  title: '页面置换',
  parse: pagingParse,
  run: pagingRun,
  view: pagingView,
  quiz(input, r, fields) {
    const what = String(fields.quiz || 'faults').toLowerCase();
    const head = `页面引用串 ${input.refs.join(' ')}，分 ${input.frames} 个物理块，用${PAGING[input.algo]}。`;
    if (what === 'victims') return { q: `${head}依次写出被换出的页。`, type: 'seq', answer: r.victims.join(' ') || '无' };
    // 错法「一开始调入不算缺页」：缺页次数少算了开头那几次
    const faults = input.noInitial ? r.faults - Math.min(input.frames, new Set(input.refs).size) : r.faults;
    return { q: `${head}一共缺页多少次（一开始调入也算）？`, type: 'seq', answer: String(faults) };
  },
  // 考卷上那张表：每次访问一列，各物理块里是哪页（同一列里的物理块不管顺序）、缺没缺页、换出谁
  table(input, r) {
    const cols = r.steps.filter((x) => x.view.k >= 0 && !x.view.end).map((x) => x.view.cols.at(-1));
    const head = [...Array.from({ length: input.frames }, (_, f) => `块 ${f + 1}`), '缺页', '换出'];
    return {
      q: `页面引用串 ${input.refs.join(' ')}，分 ${input.frames} 个物理块，用${PAGING[input.algo]}。每访问一页，写出各物理块里的页（同一列里先后不论）、缺页打 √、被换出的页。`,
      dir: 'col',
      copy: true,
      head,
      rows: cols.map((c) => ({ label: c.ref, cells: [...c.slots.map((x) => ({ v: x ?? '', group: 'f' })), { v: c.fault ? '√' : '', mark: true }, { v: c.victim ?? '' }] })),
      qhtml: '',
    };
  },
  // 常见错法：换成别的置换算法；「一开始调入不算缺页」
  variants(input) {
    const out = Object.keys(PAGING).filter((a) => a !== input.algo).map((a) => ({ label: `像是按 ${PAGING[a]} 换的`, input: { ...input, algo: a } }));
    out.push({ label: '像是没把一开始调入算成缺页', input: { ...input, noInitial: true } });
    return out;
  },
  problems(input) {
    const out = [];
    if (new Set(input.refs).size <= input.frames) out.push('refs 里不同的页不多于 frames，根本不会发生置换');
    return out;
  },
};

// ================= 银行家算法 =================

// 矩阵：一行一个进程「P0 7 5 3」，用分号或换行隔开
function procMatrix(src, what, width) {
  const rows = String(src ?? '').split(/[;；\n]+/).map((x) => x.trim()).filter(Boolean);
  if (!rows.length) throw new Error(`banker 要写 ${what}:（一行一个进程：P0 7 5 3，用分号隔开）`);
  return rows.map((r) => {
    const t = r.split(/[\s,，]+/).filter(Boolean);
    const name = /^\d/.test(t[0]) ? null : t.shift();
    if (!t.length || !t.every((x) => /^\d+$/.test(x))) throw new Error(`${what}: 看不懂「${r}」，写成「P0 7 5 3」`);
    if (width && t.length !== width) throw new Error(`${what}: 「${r}」有 ${t.length} 种资源，avail 写的是 ${width} 种`);
    return { name, v: t.map(Number) };
  });
}
const le = (a, b) => a.every((x, i) => x <= b[i]);
const vec = (a) => `(${a.join(', ')})`;

function bankerParse(fields) {
  const avail = String(fields.avail ?? '').trim().split(/[\s,，]+/).filter(Boolean);
  if (!avail.length || !avail.every((x) => /^\d+$/.test(x))) throw new Error('banker 要写 avail:（现在可用的各种资源数，如 3 3 2）');
  const w = avail.length;
  const max = procMatrix(fields.max, 'max', w), alloc = procMatrix(fields.alloc ?? fields.allocation, 'alloc', w);
  if (max.length !== alloc.length) throw new Error(`max 有 ${max.length} 个进程，alloc 有 ${alloc.length} 个`);
  if (max.length > 8) throw new Error('最多 8 个进程');
  const names = max.map((r, i) => r.name || alloc[i].name || `P${i}`);
  max.forEach((r, i) => { if (!le(alloc[i].v, r.v)) throw new Error(`${names[i]} 已分配的 ${vec(alloc[i].v)} 比它的最大需求 ${vec(r.v)} 还多`); });
  let request = null;
  if (fields.request) {
    const t = String(fields.request).trim().split(/[\s,，]+/).filter(Boolean);
    const who = t.shift();
    const i = names.indexOf(who);
    if (i < 0 || t.length !== w || !t.every((x) => /^\d+$/.test(x))) throw new Error(`request: 写成「P1 1 0 2」（进程名和请求的各种资源数），进程要在 max 里`);
    request = { i, v: t.map(Number) };
  }
  return { names, avail: avail.map(Number), max: max.map((r) => r.v), alloc: alloc.map((r) => r.v), request };
}

// 所有安全序列（quiz 里写哪一个都算对）
export function safeSequences(avail, need, alloc, limit = 200) {
  const n = need.length, out = [];
  const rec = (work, done, seq) => {
    if (out.length >= limit) return;
    if (seq.length === n) { out.push(seq.slice()); return; }
    for (let i = 0; i < n; i++) if (!done[i] && le(need[i], work)) { done[i] = true; seq.push(i); rec(work.map((x, j) => x + alloc[i][j]), done, seq); seq.pop(); done[i] = false; }
  };
  rec(avail.slice(), Array(n).fill(false), []);
  return out;
}

function bankerRun(input) {
  const { names } = input;
  let avail = input.avail.slice();
  let alloc = input.alloc.map((r) => r.slice());
  const need = () => input.max.map((r, i) => r.map((x, j) => x - alloc[i][j]));
  const steps = [];
  const v = (extra = {}) => ({ avail: avail.slice(), alloc: alloc.map((r) => r.slice()), need: need(), ...extra });
  steps.push({ view: v(), msg: `银行家算法：Need = Max − Allocation。${input.request ? `先检查 ${names[input.request.i]} 的请求，再` : ''}用安全性算法找安全序列：Work = Available，每次找一个 Need ≤ Work 的进程，假设它运行完、把资源还回来（Work += Allocation）。这里每次从编号小的开始找（能满足的有好几个时，选别的也对）。` });
  if (input.request) {
    const { i, v: r } = input.request;
    const N = need();
    if (!le(r, N[i])) {
      steps.push({ view: v({ hl: i }), msg: `${names[i]} 请求 ${vec(r)}，超过了它还需要的 Need = ${vec(N[i])}：出错，不能分配。`, ask: { tag: 'request', kind: 'choice', q: `${names[i]} 请求 ${vec(r)}，能不能分配？`, choices: ['能分配', '不能：超过它声明的需求', '不能：现在资源不够，等待', '不能：分配了就不安全'], answer: '不能：超过它声明的需求' } });
      return { steps, safe: null, seqs: [] };
    }
    if (!le(r, avail)) {
      steps.push({ view: v({ hl: i }), msg: `${names[i]} 请求 ${vec(r)}，比现在可用的 ${vec(avail)} 多：资源不够，${names[i]} 等待。`, ask: { tag: 'request', kind: 'choice', q: `${names[i]} 请求 ${vec(r)}，能不能分配？`, choices: ['能分配', '不能：超过它声明的需求', '不能：现在资源不够，等待', '不能：分配了就不安全'], answer: '不能：现在资源不够，等待' } });
      return { steps, safe: null, seqs: [] };
    }
    avail = avail.map((x, j) => x - r[j]);
    alloc[i] = alloc[i].map((x, j) => x + r[j]);
    const ok = safeSequences(avail, need(), alloc).length > 0;
    steps.push({ view: v({ hl: i }), msg: `${names[i]} 请求 ${vec(r)} ≤ Need ${vec(input.max[i].map((x, j) => x - input.alloc[i][j]))}，也 ≤ Available：先试着分给它，Available 变成 ${vec(avail)}，再看这样安不安全。`, ask: { tag: 'request', kind: 'choice', q: `${names[i]} 请求 ${vec(r)}，能不能分配？`, choices: ['能分配', '不能：超过它声明的需求', '不能：现在资源不够，等待', '不能：分配了就不安全'], answer: ok ? '能分配' : '不能：分配了就不安全' } });
  }
  const N = need();
  let work = avail.slice();
  const done = Array(names.length).fill(false);
  const seq = [];
  while (seq.length < names.length) {
    const can = names.map((_, i) => i).filter((i) => !done[i] && le(N[i], work));
    if (!can.length) {
      steps.push({ view: v({ work: work.slice(), done: done.slice(), seq: seq.slice() }), msg: `Work = ${vec(work)}，剩下的 ${names.filter((_, i) => !done[i]).join('、')} 的 Need 都满足不了：不安全${input.request ? `，所以不能分给 ${names[input.request.i]}（要恢复原来的状态，让它等待）` : ''}。` });
      return { steps, safe: false, seqs: [] };
    }
    const i = can[0];
    const w0 = work.slice();
    work = work.map((x, j) => x + alloc[i][j]);
    done[i] = true;
    seq.push(i);
    steps.push({ view: v({ work: work.slice(), w0, done: done.slice(), seq: seq.slice(), hl: i }), msg: `Work = ${vec(w0)}，${names[i]} 的 Need ${vec(N[i])} ≤ Work：让它运行完，还回 Allocation ${vec(alloc[i])}，Work 变成 ${vec(work)}。`, ask: { tag: 'next', kind: 'pick', q: `Work = ${vec(w0)}：下一个能运行完的进程是？在表里点出来。`, alts: can.map((x) => names[x]) } });
  }
  const seqs = safeSequences(avail, N, alloc);
  steps.push({ view: v({ work: work.slice(), done: done.slice(), seq: seq.slice() }), msg: `所有进程都能运行完：安全。一个安全序列是 ${seq.map((i) => names[i]).join(' → ')}${seqs.length > 1 ? `（一共有 ${seqs.length >= 200 ? '很多' : seqs.length} 种安全序列）` : ''}。${input.request ? `所以可以分给 ${names[input.request.i]}。` : ''}` });
  return { steps, safe: true, seqs: seqs.map((x) => x.map((i) => names[i])) };
}

function bankerView(s, input) {
  const { names } = input;
  const head = ['进程', 'Max', 'Allocation', 'Need', ...(s.work ? ['Work + Allocation', '完成'] : [])];
  const rows = names.map((n, i) => {
    const order = s.seq ? s.seq.indexOf(i) : -1;
    return [{ html: `<b>${esc(n)}</b>`, attrs: ` data-pick="${esc(n)}" data-cmd="${i + 1}" data-label="${esc(n)}"`, cls: s.hl === i ? 'sv-pickcell' : '' }, input.max[i].join(' '), s.alloc[i].join(' '), s.need[i].join(' '), ...(s.work ? [order >= 0 ? `第 ${order + 1} 个` : '', s.done?.[i] ? '✓' : ''] : [])];
  });
  return table(head, rows, 'os-banker') + chips([['Available', s.avail.join(' ')], ...(s.work ? [['Work', s.work.join(' ')]] : []), ...(s.seq?.length ? [['序列', s.seq.map((i) => names[i]).join(' → ')]] : [])]);
}

export const bankerEngine = {
  name: 'banker',
  title: '银行家算法',
  parse: bankerParse,
  run: bankerRun,
  view: bankerView,
  quiz(input, r) {
    if (input.request) return { q: `${input.names[input.request.i]} 请求 ${vec(input.request.v)}，能不能分配？写「能」或「不能」。`, qhtml: bankerView({ avail: input.avail, alloc: input.alloc, need: input.max.map((x, i) => x.map((y, j) => y - input.alloc[i][j])) }, input), type: 'seq', answer: r.safe === true ? '能' : '不能' };
    return { q: '这个状态安全吗？安全就写出一个安全序列（如 P1 P3 P4 P2 P0），不安全写「不安全」。', qhtml: bankerView({ avail: input.avail, alloc: input.alloc, need: input.max.map((x, i) => x.map((y, j) => y - input.alloc[i][j])) }, input), type: 'seq', answer: r.safe ? r.seqs.map((x) => x.join(' ')).join(' | ') : '不安全' };
  },
  // 考卷上那张表：每个进程的 Need；再按「每次选编号最小的能运行完的进程」写安全性检查每一步之后的 Work
  table(input, r) {
    const N = input.max.map((x, i) => x.map((y, j) => y - input.alloc[i][j]));
    const rows = input.names.map((n, i) => ({ label: n, cells: [{ v: N[i].join(' '), vec: true }, { v: '', given: true }] }));
    // 安全性检查（没有请求、或请求已经试分配之后）：第几个运行完的是谁、之后的 Work
    const runs = r.steps.filter((x) => x.view.w0 && x.view.hl !== undefined);
    runs.forEach((x, k) => rows.push({ label: `第 ${k + 1} 个`, cells: [{ v: input.names[x.view.hl] }, { v: x.view.work.join(' '), vec: true }] }));
    return {
      q: `先算每个进程的 Need = Max − Allocation；再做安全性检查（Work 从 Available${input.request ? '（试分配之后的）' : ''}开始，每次选编号最小的、Need ≤ Work 的进程），写出每次运行完的进程和之后的 Work。向量写成「3 3 2」。`,
      qhtml: bankerView({ avail: input.avail, alloc: input.alloc, need: input.max.map(() => input.avail.map(() => '?')) }, input),
      dir: 'row',
      head: ['Need / 进程', 'Work'],
      rows,
    };
  },
  // 常见错法：Need 直接用了 Max（忘了减 Allocation）
  variants(input) {
    return [{ label: '像是把 Max 当成了 Need（忘了减 Allocation）', input: { ...input, alloc: input.alloc.map((row) => row.map(() => 0)), max: input.max } }];
  },
};

// ================= 磁盘调度 =================

const DISK = { fcfs: '先来先服务 FCFS', sstf: '最短寻找时间优先 SSTF', scan: '扫描 SCAN（电梯）', cscan: '循环扫描 C-SCAN', look: 'LOOK', clook: 'C-LOOK' };
const DISK_ALIAS = { fcfs: 'fcfs', sstf: 'sstf', scan: 'scan', 电梯: 'scan', cscan: 'cscan', 'c-scan': 'cscan', look: 'look', clook: 'clook', 'c-look': 'clook' };

function diskParse(fields) {
  const req = String(fields.requests ?? fields.req ?? '').trim().split(/[\s,，、]+/).filter(Boolean);
  if (!req.length || !req.every((x) => /^\d+$/.test(x))) throw new Error('disk 要写 requests:（请求的磁道号，如 98 183 37 122 14 124 65 67）');
  if (req.length > 16) throw new Error('requests: 最多 16 个');
  const head = Number(fields.head);
  if (!Number.isInteger(head) || head < 0) throw new Error('disk 要写 head:（磁头现在在第几号磁道，如 53）');
  const algo = DISK_ALIAS[String(fields.algo || '').trim().toLowerCase()];
  if (!algo) throw new Error(`disk 要写 algo:（${Object.keys(DISK).join('、')}）`);
  const tr = /^(\d+)\s*[-~～]\s*(\d+)$/.exec(String(fields.tracks || '0-199').trim());
  if (!tr) throw new Error('tracks: 写磁道的范围，如 0-199');
  const lo = Number(tr[1]), hi = Number(tr[2]);
  const reqs = req.map(Number);
  if ([head, ...reqs].some((x) => x < lo || x > hi)) throw new Error(`磁头和请求都要在 tracks: ${lo}-${hi} 里`);
  const dir = /^(down|小|向小|减小|内|-)$/i.test(String(fields.dir || 'up').trim()) ? -1 : 1;
  const jump = /^(count|计|算|yes|true)$/i.test(String(fields.jump || '').trim());
  return { reqs, head, algo, lo, hi, dir, jump };
}

function diskRun({ reqs, head, algo, lo, hi, dir, jump }) {
  const steps = [];
  let pos = head, dist = 0;
  const path = [head]; // 磁头经过的磁道（含走到头、跳回）
  const served = [];
  let left = reqs.map((x, k) => ({ x, k }));
  const v = (extra = {}) => ({ path: path.slice(), served: served.slice(), pos, dist, left: left.map((r) => r.x), ...extra });
  const rule = { fcfs: '按请求到来的顺序', sstf: '每次去离磁头最近的请求（一样近时去编号小的方向……这里按先到的那个）', scan: `先往${dir > 0 ? '大' : '小'}的方向一直扫到磁盘的尽头（${dir > 0 ? hi : lo}），再掉头`, cscan: `只往${dir > 0 ? '大' : '小'}的方向服务：扫到尽头（${dir > 0 ? hi : lo}）后直接跳回另一头（${dir > 0 ? lo : hi}）再接着往同一个方向扫${jump ? '（跳回的距离也算）' : '（跳回的距离不算）'}`, look: `往${dir > 0 ? '大' : '小'}的方向走到最远的请求就掉头（不走到尽头）`, clook: `只往${dir > 0 ? '大' : '小'}的方向服务：到最远的请求后直接跳回另一边最远的请求${jump ? '（跳回的距离也算）' : '（跳回的距离不算）'}` }[algo];
  steps.push({ view: v(), msg: `${DISK[algo]}：磁头在 ${head}，${rule}。` });
  const go = (target, { serve = true, jumpTo = false } = {}) => {
    const d = Math.abs(target - pos);
    if (!jumpTo || jump) dist += d;
    pos = target;
    path.push(target);
    if (serve) { const i = left.findIndex((r) => r.x === target); served.push(target); left.splice(i, 1); }
    return d;
  };
  const serveStep = (target) => {
    const from = pos;
    const d = go(target);
    steps.push({ view: v({ last: target }), msg: `${from} → ${target}，移动 ${d} 个磁道（累计 ${dist}）。`, ask: { tag: 'next', kind: 'number', q: `磁头在 ${from}，接下来去哪个磁道？`, answer: target } });
  };
  if (algo === 'fcfs') for (const r of reqs) serveStep(r);
  else if (algo === 'sstf') {
    while (left.length) {
      const best = left.slice().sort((a, b) => Math.abs(a.x - pos) - Math.abs(b.x - pos) || a.k - b.k)[0];
      serveStep(best.x);
    }
  } else {
    const side = (d) => left.filter((r) => (d > 0 ? r.x >= pos : r.x <= pos)).sort((a, b) => d * (a.x - b.x));
    for (const r of side(dir)) serveStep(r.x);
    if (left.length) {
      if (algo === 'scan' || algo === 'cscan') {
        const end = dir > 0 ? hi : lo;
        if (pos !== end) { const from = pos; const d = go(end, { serve: false }); steps.push({ view: v(), msg: `这个方向没有请求了，${algo === 'scan' ? '但' : ''}还要走到尽头：${from} → ${end}，移动 ${d}（累计 ${dist}）。` }); }
      }
      if (algo === 'cscan' || algo === 'clook') {
        const other = algo === 'cscan' ? (dir > 0 ? lo : hi) : side(-dir).at(-1).x;
        const from = pos;
        const d = go(other, { serve: false, jumpTo: true });
        // C-LOOK 跳到的那个请求在下面第一个服务：这里先撤回它的「已服务」
        steps.push({ view: v(), msg: `直接跳回 ${other}（${from} → ${other}，${jump ? `算 ${d} 个磁道，累计 ${dist}` : '跳回的距离不算'}），接着往${dir > 0 ? '大' : '小'}的方向服务。` });
        if (algo === 'clook') { const r = left.find((x) => x.x === other); if (r) { served.push(other); left = left.filter((x) => x !== r); steps.at(-1).view = v(); } }
        for (const r of left.slice().sort((a, b) => dir * (a.x - b.x))) serveStep(r.x);
      } else {
        for (const r of side(-dir)) serveStep(r.x);
      }
    }
  }
  steps.push({ view: v({ end: true }), msg: `服务顺序：${served.join(' → ')}。磁头一共移动 ${dist} 个磁道，平均寻找长度 ${dist}/${reqs.length}${Number.isInteger(dist / reqs.length) ? ` = ${dist / reqs.length}` : ` ≈ ${round2(dist / reqs.length)}`}。`, ask: { tag: 'total', kind: 'number', q: '磁头一共移动了多少个磁道？', answer: dist } });
  return { steps, dist, order: served };
}

function diskView(s, input) {
  const { lo, hi } = input;
  const W = 600, rowH = 26, pad = 42;
  const X = (t) => pad + ((t - lo) / (hi - lo)) * (W - 2 * pad);
  const n = s.path.length;
  const H = pad + rowH * Math.max(n, input.reqs.length + 2) + 10;
  const pts = s.path.map((t, i) => `${X(t).toFixed(1)},${pad + i * rowH}`).join(' ');
  const marks = [...new Set([lo, hi, input.head, ...input.reqs])].sort((a, b) => a - b);
  let svg = `<svg class="os-disk" viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%" role="img" aria-label="磁头移动">`;
  svg += `<line class="os-axis" x1="${X(lo)}" y1="${pad - 12}" x2="${X(hi)}" y2="${pad - 12}"/>`;
  // 挨得近的两个磁道号：后一个往上挪一行，不叠在一起
  let lastX = -1e9, up = false;
  svg += marks.map((t) => { const x = X(t); up = x - lastX < 22 ? !up : false; lastX = x; return `<g class="os-tick${input.reqs.includes(t) ? (s.served.includes(t) ? ' os-served' : ' os-req') : ''}"><line x1="${x}" y1="${pad - 16}" x2="${x}" y2="${pad - 8}"/><text x="${x}" y="${pad - (up ? 32 : 20)}">${t}</text></g>`; }).join('');
  svg += `<polyline class="os-path" points="${pts}"/>`;
  svg += s.path.map((t, i) => `<circle class="os-dot${i === n - 1 ? ' os-now' : ''}" cx="${X(t).toFixed(1)}" cy="${pad + i * rowH}" r="${i === n - 1 ? 6 : 4}"/>`).join('');
  svg += '</svg>';
  return `<div class="sv-gtbl-wrap">${svg}</div>` + chips([['磁头', s.pos], ['已服务', s.served.join(' → ') || '（还没有）'], ['还没服务', s.left.join(' ') || '（没有了）'], ['移动', s.dist]]);
}

export const diskEngine = {
  name: 'disk',
  title: '磁盘调度',
  parse: diskParse,
  run: diskRun,
  view: diskView,
  quiz(input, r, fields) {
    const head = `磁头在 ${input.head}${['scan', 'cscan', 'look', 'clook'].includes(input.algo) ? `，正往${input.dir > 0 ? '大' : '小'}的方向移动` : ''}，请求队列 ${input.reqs.join(' ')}，用${DISK[input.algo]}${['cscan', 'clook'].includes(input.algo) ? `（跳回的距离${input.jump ? '算' : '不算'}）` : ''}。`;
    if (String(fields.quiz || 'total').toLowerCase() === 'order') return { q: `${head}写出服务的顺序。`, type: 'seq', answer: r.order.join(' ') };
    return { q: `${head}磁头一共移动多少个磁道？`, type: 'num', answer: String(r.dist) };
  },
  // 考卷上那张表：依次访问的磁道、每次移动的距离（走到尽头、跳回算进紧接着的那一次）
  table(input, r) {
    const rows = [];
    let prev = 0;
    for (const x of r.steps) {
      if (x.view.last === undefined) continue;
      rows.push({ label: `第 ${rows.length + 1} 个`, cells: [{ v: String(x.view.last), num: true }, { v: String(x.view.dist - prev), num: true }] });
      prev = x.view.dist;
    }
    return {
      q: `磁头在 ${input.head}${['scan', 'cscan', 'look', 'clook'].includes(input.algo) ? `，正往${input.dir > 0 ? '大' : '小'}的方向移动` : ''}，请求队列 ${input.reqs.join(' ')}（磁道 ${input.lo}～${input.hi}），用${DISK[input.algo]}${['cscan', 'clook'].includes(input.algo) ? `（跳回的距离${input.jump ? '算' : '不算'}）` : ''}。依次写出被访问的磁道和移动距离（走到尽头、跳回的那一段算进紧接着的那一次）。`,
      qhtml: '',
      dir: 'row',
      head: ['被访问的磁道', '移动距离'],
      rows,
    };
  },
  // 常见错法：换成别的算法；方向弄反；SCAN 走不走到尽头（LOOK）、C-SCAN 跳回算不算
  variants(input) {
    const out = Object.keys(DISK).filter((a) => a !== input.algo).map((a) => ({ label: `像是按${DISK[a]}做的`, input: { ...input, algo: a } }));
    if (['scan', 'cscan', 'look', 'clook'].includes(input.algo)) out.unshift({ label: '像是方向弄反了', input: { ...input, dir: -input.dir } });
    if (['cscan', 'clook'].includes(input.algo)) out.unshift({ label: input.jump ? '像是没把跳回的距离算进去' : '像是把跳回的距离也算进去了', input: { ...input, jump: !input.jump } });
    return out;
  },
};

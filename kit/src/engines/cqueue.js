// 循环队列（组件 cqueue）：入队、出队一步步走，画成一圈（或一排），标出 front、rear。按王道 3.2.2 的口径：
//   rear 指向队尾元素的下一个位置；front 指向队头元素；初始 front = rear = 0。
//   区分队空、队满三种办法（full:）：spare 牺牲一个单元（默认）、count 增设 size 成员、tag 增设 tag 标志。
// 纯函数，不碰 DOM（tests/cqueue-engine.test.js）。
import { esc, chips, arrayView } from './arrayview.js';

const FULL = { spare: '牺牲一个单元', count: '增设 size 成员', tag: '增设 tag 标志' };
const FULL_ALIAS = { spare: 'spare', 牺牲: 'spare', 牺牲一个单元: 'spare', 空一格: 'spare', count: 'count', size: 'count', 计数: 'count', tag: 'tag', 标志: 'tag' };

export function parse(fields) {
  const size = Number(String(fields.size ?? '').trim());
  if (!Number.isInteger(size) || size < 2 || size > 16) throw new Error(`cqueue 要写 size:（MaxSize，2～16 的整数），现在是「${fields.size ?? ''}」`);
  const fullSrc = String(fields.full ?? '').trim().toLowerCase();
  const full = fullSrc ? FULL_ALIAS[fullSrc] : 'spare';
  if (!full) throw new Error(`full: 写 spare（牺牲一个单元，默认）、count（增设 size 成员）或 tag（增设 tag 标志），现在是「${fields.full}」`);
  const ops = parseOps(fields.ops);
  const ptr = (k) => {
    if (fields[k] === undefined || String(fields[k]).trim() === '') return 0;
    const v = Number(String(fields[k]).trim());
    if (!Number.isInteger(v) || v < 0 || v >= size) throw new Error(`${k}: 写一开始的 ${k}（0～${size - 1}），现在是「${fields[k]}」`);
    return v;
  };
  const front = ptr('front'), rear = ptr('rear');
  const drawSrc = String(fields.draw ?? '').trim().toLowerCase();
  if (drawSrc && !['ring', 'row', '一圈', '一排'].includes(drawSrc)) throw new Error(`draw: 写 ring（画成一圈，默认）或 row（画成一排），现在是「${fields.draw}」`);
  const draw = drawSrc === 'row' || drawSrc === '一排' || (!drawSrc && size > 12) ? 'row' : 'ring';
  return { size, full, ops, front, rear, draw };
}

// ops: enqueue a b c, dequeue, enqueue d, dequeue 2 → 一个元素一步
function parseOps(src) {
  const parts = String(src ?? '').split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) throw new Error('cqueue 要写 ops:（如 enqueue a b c, dequeue, enqueue d）');
  const out = [];
  for (const p of parts) {
    let m = /^(enqueue|enq|en|入队|进队)\s*(.*)$/i.exec(p);
    if (m) {
      const xs = m[2].split(/\s+/).filter(Boolean);
      if (!xs.length) throw new Error(`ops: 「${p}」要写入队的元素，如 enqueue a b`);
      for (const x of xs) out.push({ op: 'in', x });
      continue;
    }
    m = /^(dequeue|deq|de|出队)\s*(\d*)$/i.exec(p);
    if (m) {
      const k = m[2] ? Number(m[2]) : 1;
      if (k < 1 || k > 20) throw new Error(`ops: 「${p}」出队几个写 1～20`);
      for (let i = 0; i < k; i++) out.push({ op: 'out' });
      continue;
    }
    throw new Error(`ops: 看不懂「${p}」，写成 enqueue a b c 或 dequeue（出队几个：dequeue 2）`);
  }
  if (out.length > 30) throw new Error('ops: 最多 30 步（一个元素算一步）');
  return out;
}

// 开始的状态：front、rear 之间原来就有的元素画成「·」
function initState(input) {
  const { size, front, rear, full } = input;
  const slots = Array(size).fill(null);
  const n = (rear - front + size) % size;
  for (let k = 0; k < n; k++) slots[(front + k) % size] = { v: '·', key: `q0-${k}`, old: true };
  return { slots, front, rear, count: n, tag: full === 'tag' && n > 0 ? 1 : 0 };
}

// 一步（入队 / 出队）。mistake（只在算常见错法时用）：
//   useAll   把 rear == front 当队满，牺牲的那一格也放了（spare 时）
//   asSpare  增设了 size / tag，却还按牺牲一个单元判满（count、tag 时）
//   noModPtr 指针加 1 以后没取模（指针可以长到 MaxSize 以上；存放的位置还是取模的）
function step(st, o, input, mistake, key) {
  const { size, full } = input;
  const inc = (p) => (mistake === 'noModPtr' ? p + 1 : (p + 1) % size);
  const at = (p) => ((p % size) + size) % size;
  const s = { ...st, slots: st.slots.slice() };
  if (o.op === 'in') {
    let isFull;
    if (full === 'spare') isFull = mistake === 'useAll' ? st.count >= size : at(st.rear + 1) === at(st.front);
    else isFull = mistake === 'asSpare' ? at(st.rear + 1) === at(st.front) || st.count >= size : full === 'count' ? st.count >= size : at(st.front) === at(st.rear) && st.tag === 1;
    if (isFull) return { st: s, ok: false };
    s.slots[at(st.rear)] = { v: o.x, key };
    s.rear = inc(st.rear);
    s.count = st.count + 1;
    s.tag = 1;
    return { st: s, ok: true };
  }
  const isEmpty = full === 'count' ? st.count === 0 : full === 'tag' ? at(st.front) === at(st.rear) && st.tag === 0 : at(st.front) === at(st.rear) && !(mistake === 'useAll' && st.count === size);
  if (isEmpty) return { st: s, ok: false };
  const x = s.slots[at(st.front)];
  s.slots[at(st.front)] = null;
  s.front = inc(st.front);
  s.count = st.count - 1;
  s.tag = 0;
  return { st: s, ok: true, x };
}

// 队列长度：spare 用公式；count 就是 size 成员；tag 在 front == rear 时看 tag。
// lenNoMod：公式忘了先加 MaxSize（C 里负数取模还是负数）。useAll 把最后一格也放满时 rear == front，学生的公式算出来是 0
function lenOf(st, input, mistake) {
  const { size, full } = input;
  if (full === 'count') return st.count;
  if (full === 'tag' && st.front % size === st.rear % size) return st.tag ? size : 0;
  if (mistake === 'lenNoMod') return (st.rear - st.front) % size;
  return (st.rear - st.front + size) % size;
}

function simulate(input, mistake) {
  let st = initState(input);
  const out = [{ st, ok: true }];
  input.ops.forEach((o, k) => { const r = step(st, o, input, mistake, `q${k + 1}`); st = r.st; out.push(r); });
  return out;
}

export function run(input) {
  const { size, full, ops, mistake } = input;
  const right = simulate(input, null);
  const wrong = mistake ? simulate(input, mistake) : right;
  const M = size;
  const steps = [];
  const v = (st, extra = {}) => ({ slots: st.slots, front: st.front, rear: st.rear, len: lenOf(st, input, null), tag: st.tag, count: st.count, ...extra });
  const intro = {
    spare: `牺牲一个单元来区分队空和队满：**队空** front == rear；**队满** (rear + 1) % ${M} == front；**长度** (rear − front + ${M}) % ${M}。最多放 ${M - 1} 个。`,
    count: `增设 size 成员记元素个数：**队空** size == 0；**队满** size == ${M}。${M} 个单元都能用，front == rear 时队空、队满都有可能。`,
    tag: `增设 tag 标志：入队成功 tag = 1，出队成功 tag = 0。**队空** front == rear 且 tag == 0；**队满** front == rear 且 tag == 1。${M} 个单元都能用。`,
  }[full];
  steps.push({ view: v(right[0].st), msg: `循环队列，MaxSize = ${M}（下标 0～${M - 1}）。front 指向队头元素，rear 指向队尾元素的**下一个位置**；入队放进 Q[rear]，rear = (rear + 1) % ${M}；出队取出 Q[front]，front = (front + 1) % ${M}。${intro}${right[0].st.count ? `一开始 front = ${input.front}、rear = ${input.rear}，队里已经有 ${right[0].st.count} 个元素（画成 ·）。` : `一开始 front = rear = ${input.front}，队空。`}` });
  const rows = [];
  ops.forEach((o, k) => {
    const before = right[k].st, now = right[k + 1];
    const n = k + 1;
    // 每一问的答案：在正确的上一步上按错法走这一步（学生看着的是正确的画面）
    const mine = mistake ? step(before, o, input, mistake, 'x') : now;
    const what = o.op === 'in' ? `${o.x} 入队` : '出队';
    const asks = [
      { tag: o.op === 'in' ? 'rear' : 'front', kind: 'number', q: `第 ${n} 步（${what}）以后，${o.op === 'in' ? 'rear' : 'front'} 是多少？`, answer: o.op === 'in' ? mine.st.rear : mine.st.front },
      { tag: o.op === 'in' ? 'front' : 'rear', kind: 'number', q: `第 ${n} 步（${what}）以后，${o.op === 'in' ? 'front' : 'rear'} 是多少？`, answer: o.op === 'in' ? mine.st.front : mine.st.rear },
      { tag: 'len', kind: 'number', q: `第 ${n} 步（${what}）以后，队列长度是多少？`, answer: lenOf(mine.st, input, mistake) },
      o.op === 'in'
        ? { tag: 'full', kind: 'choice', q: `第 ${n} 步要让 ${o.x} 入队：队列满了吗？`, choices: ['没满，能入队', '满了，入队失败'], answer: mine.ok ? '没满，能入队' : '满了，入队失败' }
        : { tag: 'empty', kind: 'choice', q: `第 ${n} 步要出队：队列空吗？`, choices: ['不空，能出队', '空了，出队失败'], answer: mine.ok ? '不空，能出队' : '空了，出队失败' },
    ];
    const ws = wrong[k + 1].st;
    rows.push({ label: `${n}. ${what}`, front: ws.front, rear: ws.rear, len: lenOf(ws, input, mistake) });
    steps.push({ view: v(now.st, { op: o, ok: now.ok, at: o.op === 'in' ? before.rear : before.front, fresh: o.op === 'in' && now.ok ? `q${n}` : null }), msg: stepMsg(o, before, now, input), ask: asks[0], asks: asks.slice(1) });
  });
  const last = wrong.at(-1).st;
  return { steps, rows, final: { front: last.front, rear: last.rear, len: lenOf(last, input, mistake) } };
}

function stepMsg(o, b, now, input) {
  const M = input.size, a = now.st;
  if (o.op === 'in') {
    if (!now.ok) {
      return {
        spare: `${o.x} 入队：(rear + 1) % ${M} = ${(b.rear + 1) % M}，等于 front = ${b.front}——**队满**，入队失败（还空着的那一格是牺牲掉的，不能放）。`,
        count: `${o.x} 入队：size = ${b.count} == ${M}——**队满**，入队失败。`,
        tag: `${o.x} 入队：front == rear = ${b.rear} 且 tag == 1——**队满**，入队失败。`,
      }[input.full];
    }
    const check = { spare: `(rear + 1) % ${M} = ${(b.rear + 1) % M} ≠ front，没满`, count: `size = ${b.count} < ${M}，没满`, tag: b.front === b.rear ? 'front == rear 但 tag == 0，是队空，没满' : 'front ≠ rear，没满' }[input.full];
    return `${o.x} 入队：${check}。放进 Q[${b.rear}]，rear = (${b.rear} + 1) % ${M} = ${a.rear}${input.full === 'count' ? `，size = ${a.count}` : input.full === 'tag' ? '，tag = 1' : ''}。`;
  }
  if (!now.ok) return `出队：${{ spare: 'front == rear', count: 'size == 0', tag: 'front == rear 且 tag == 0' }[input.full]}——**队空**，出队失败。`;
  return `出队：${{ spare: 'front ≠ rear，不空', count: `size = ${b.count} > 0，不空`, tag: b.front === b.rear ? 'front == rear 但 tag == 1，是队满，不空' : 'front ≠ rear，不空' }[input.full]}。取出 Q[${b.front}] = ${now.x?.old ? '原来就有的元素' : now.x?.v}，front = (${b.front} + 1) % ${M} = ${a.front}${input.full === 'count' ? `，size = ${a.count}` : input.full === 'tag' ? '，tag = 0' : ''}。`;
}

// —— 画面：一圈（扇形格子，下标写在里圈，front / rear 的箭头在外圈）或一排 ——
const R1 = 104, R0 = 58;
const pt = (r, deg, c) => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
const f1 = (x) => Math.round(x * 10) / 10;
function ring(s, input) {
  const n = input.size;
  const W = 400, H = 340, c = [W / 2, H / 2];
  const span = 360 / n;
  const mid = (i) => -90 + i * span;
  let h = '';
  for (let i = 0; i < n; i++) {
    const a0 = mid(i) - span / 2 + 0.8, a1 = mid(i) + span / 2 - 0.8;
    const [x0, y0] = pt(R1, a0, c), [x1, y1] = pt(R1, a1, c), [x2, y2] = pt(R0, a1, c), [x3, y3] = pt(R0, a0, c);
    const x = s.slots[i];
    const cls = ['ln-slot', x ? 'ln-full' : '', i === s.front % n ? 'ln-front' : '', i === s.rear % n ? 'ln-rear' : '', x && x.key === s.fresh ? 'sv-new' : '', s.at === i && !s.ok ? 'ln-bad' : ''].filter(Boolean).join(' ');
    const [tx, ty] = pt((R1 + R0) / 2, mid(i), c), [ix, iy] = pt(R0 - 13, mid(i), c);
    h += `<g class="${cls}" data-cmd="${i + 1}" data-label="${esc(x ? x.v : String(i))}"><path d="M${f1(x0)} ${f1(y0)} A${R1} ${R1} 0 0 1 ${f1(x1)} ${f1(y1)} L${f1(x2)} ${f1(y2)} A${R0} ${R0} 0 0 0 ${f1(x3)} ${f1(y3)} Z"/>`;
    if (x) h += `<text class="ln-slot-v${x.old ? ' ln-old' : ''}" x="${f1(tx)}" y="${f1(ty)}">${esc(x.v)}</text>`;
    h += `<text class="ln-slot-i" x="${f1(ix)}" y="${f1(iy)}">${i}</text></g>`;
  }
  // 指针：同一格两个就上下两行
  const ptrs = {};
  const add = (p, name) => { const i = ((p % n) + n) % n; (ptrs[i] ||= []).push(name); };
  add(s.front, 'front');
  add(s.rear, 'rear');
  for (const [i, names] of Object.entries(ptrs)) {
    const deg = mid(Number(i));
    const [ax, ay] = pt(R1 + 30, deg, c), [bx, by] = pt(R1 + 6, deg, c), [lx, ly] = pt(R1 + 40, deg, c);
    const cos = Math.cos((deg * Math.PI) / 180), sin = Math.sin((deg * Math.PI) / 180);
    const anchor = cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle';
    const y0 = ly + (sin < -0.35 ? -(names.length - 1) * 17 - 4 : sin > 0.35 ? 8 : -((names.length - 1) * 17) / 2);
    h += `<g class="ln-ptr" data-key="ptr:${names.join('+')}"><line x1="${f1(ax)}" y1="${f1(ay)}" x2="${f1(bx)}" y2="${f1(by)}" marker-end="url(#ln-arrow)"/>${names.map((nm, k) => `<text class="ln-ptr-${nm}" x="${f1(lx)}" y="${f1(y0 + k * 17)}" text-anchor="${anchor}">${nm}</text>`).join('')}</g>`;
  }
  return `<svg class="ln-ring" viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%" role="img" aria-label="循环队列"><defs><marker id="ln-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs>${h}</svg>`;
}

export function view(s, input) {
  const M = input.size;
  let pic;
  if (input.draw === 'row') {
    const ptr = {};
    const add = (p, name) => { const i = ((p % M) + M) % M; ptr[i] = ptr[i] ? `${ptr[i]},${name}` : name; };
    add(s.front, 'front');
    add(s.rear, 'rear');
    const cls = {};
    s.slots.forEach((x, i) => { if (x && x.key === s.fresh) cls[i] = 'sv-cur'; });
    pic = arrayView(s.slots.map((x) => (x ? x.v : null)), { base: 0, ptr, cls, fresh: s.fresh ? s.slots.map((x, i) => (x && x.key === s.fresh ? i : -1)).filter((i) => i >= 0) : [], pick: false, label: 'Q' });
  } else pic = ring(s, input);
  const lenText = input.full === 'count' ? `${s.count}（就是 size）` : input.full === 'tag' && s.front === s.rear ? `${s.len}（front == rear，tag = ${s.tag}）` : `(${s.rear} − ${s.front} + ${M}) % ${M} = ${s.len}`;
  const ch = chips([['front', s.front], ['rear', s.rear], ['长度', lenText], ...(input.full === 'count' ? [['size', s.count]] : input.full === 'tag' ? [['tag', s.tag]] : [])]);
  const op = s.op ? `<div class="ln-op-line${s.ok ? '' : ' ln-bad'}">${s.op.op === 'in' ? `入队 ${esc(s.op.x)}` : '出队'}${s.ok ? '' : '：失败'}</div>` : '';
  return `<div class="ln-cq">${op}${pic}${ch}</div>`;
}

const opsText = (input) => input.ops.reduce((acc, o) => {
  const last = acc.at(-1);
  if (o.op === 'in' && last?.op === 'in') last.xs.push(o.x);
  else if (o.op === 'out' && last?.op === 'out') last.k++;
  else acc.push(o.op === 'in' ? { op: 'in', xs: [o.x] } : { op: 'out', k: 1 });
  return acc;
}, []).map((g) => (g.op === 'in' ? `${g.xs.join('、')} 依次入队` : g.k > 1 ? `出队 ${g.k} 个` : '出队')).join('，');
const setup = (input) => `循环队列 MaxSize = ${input.size}（${FULL[input.full]}区分队空队满），rear 指向队尾元素的下一个位置，一开始 front = ${input.front}、rear = ${input.rear}。`;

export function quiz(input, r) {
  return { q: `${setup(input)}依次做：${opsText(input)}。做完以后 front、rear 和队列长度各是多少？依次写出三个数，空格隔开。`, type: 'seq', answer: `${r.final.front} ${r.final.rear} ${r.final.len}` };
}

export function table(input, r) {
  return {
    q: `${setup(input)}依次做：${opsText(input)}。写出每一步之后的 front、rear 和队列长度（入队失败、出队失败的那一步照抄上一步）。`,
    dir: 'row', head: ['front', 'rear', '长度'],
    rows: r.rows.map((x) => ({ label: x.label, cells: [{ v: String(x.front), num: true }, { v: String(x.rear), num: true }, { v: String(x.len), num: true }] })),
  };
}

export function problems(input) {
  const out = [];
  const st = simulate(input, null);
  // 一开始 front > rear（元素已经跨过最后一格）也算看得出循环
  const wraps = input.rear < input.front || st.some((x, k) => k > 0 && ((x.st.rear % input.size) < (st[k - 1].st.rear % input.size) || (x.st.front % input.size) < (st[k - 1].st.front % input.size)));
  if (!wraps) out.push('ops: 指针一次都没有绕回 0，看不出「循环」，多入队几个或者先出队几个再入队');
  return out;
}

const VARIANTS = [
  ['lenNoMod', '像是队长公式忘了先加 MaxSize 再取模，rear 绕回来以后算成了负数（王道：长度 = (rear − front + MaxSize) % MaxSize）'],
  ['useAll', '像是把 rear == front 当成了队满，牺牲的那一格也放了元素（王道：(rear + 1) % MaxSize == front 就是队满，front == rear 是队空）'],
  ['asSpare', '像是增设了 size / tag 以后还按「牺牲一个单元」判满，少放了一个（王道：增设 size 或 tag 以后所有单元都能用）'],
  ['noModPtr', '像是指针加 1 以后没对 MaxSize 取模（王道：rear = (rear + 1) % MaxSize，到最后一格要绕回 0）'],
];
const answersOf = (input, r) => JSON.stringify([r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter(Boolean).map((a) => [a.q, a.answer]), quiz(input, r).answer, table(input, r).rows.map((x) => x.cells.map((c) => c.v))]);
export function variants(input) {
  const ok = { spare: ['lenNoMod', 'useAll', 'noModPtr'], count: ['asSpare', 'noModPtr'], tag: ['asSpare', 'lenNoMod', 'noModPtr'] }[input.full];
  const base = answersOf(input, run(input));
  return VARIANTS.filter(([m]) => ok.includes(m)).map(([mistake, label]) => ({ label, input: { ...input, mistake } })).filter((v) => { try { return answersOf(v.input, run(v.input)) !== base; } catch { return false; } });
}

export const cqueueEngine = { name: 'cqueue', title: '循环队列', parse, run, view, quiz, table, problems, variants };

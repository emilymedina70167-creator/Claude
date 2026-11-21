// 双端队列（组件 deque，数据结构，视觉第 6 批）：push: 的元素按顺序进，问能不能得到 seq: 这样的出队序列。
//   kind: in   输入受限：右端能进能出，左端只能出（王道：一端能插入删除，另一端只能删除）
//         out  输出受限：右端能进能出，左端只能进（一端能插入删除，另一端只能插入）
//         both 两端都能进能出
// 页面找一种做法（能出就先出，再试进右边、进左边；回溯），一步一个操作；得不到时走到卡住的那一步说清楚。
// options: 几个序列：mode: quiz 时挑出得到的那几个。纯函数，不碰 DOM（tests/engines-deque.test.js）。
import { esc } from './arrayview.js';

const KIND = { in: '输入受限', out: '输出受限', both: '双端队列' };
const KIND_ALIAS = { in: 'in', input: 'in', 输入受限: 'in', out: 'out', output: 'out', 输出受限: 'out', both: 'both', 双端: 'both' };
const canPush = (kind, end) => kind !== 'in' || end === 'R';
const canPop = (kind, end) => kind !== 'out' || end === 'R';

const toks = (src) => String(src ?? '').trim().split(/[\s,，、]+/).filter(Boolean);

export function parse(fields) {
  const kind = KIND_ALIAS[String(fields.kind ?? '').trim().toLowerCase()];
  if (!kind) throw new Error('deque 要写 kind: in（输入受限：只能从一端进）、out（输出受限：只能从一端出）或 both（两端都能进出）');
  const push = toks(fields.push);
  if (push.length < 2 || push.length > 8) throw new Error('push: 写 2～8 个依次进队的元素，如 push: 1 2 3 4');
  if (new Set(push).size < push.length) throw new Error('push: 里的元素不要重复');
  const isPerm = (xs) => xs.length === push.length && [...xs].sort().join(' ') === [...push].sort().join(' ');
  const seq = fields.seq ? toks(fields.seq) : null;
  if (seq && !isPerm(seq)) throw new Error(`seq: 要是 push: 里那 ${push.length} 个元素换个顺序（每个出一次）`);
  const options = fields.options ? String(fields.options).split(/[,，;；\n]+/).map((x) => (/\s/.test(x.trim()) ? toks(x) : [...x.trim()])).filter((x) => x.length) : null;
  if (options) options.forEach((o) => { if (!isPerm(o)) throw new Error(`options: 「${o.join(' ')}」不是 push: 里那几个元素的一个排列`); });
  if (!seq && !options) throw new Error('deque 写 seq:（要得到的出队序列）或 options:（几个序列，挑得到的）');
  const ask = toks(fields.ask);
  for (const a of ask) if (!['possible', 'op'].includes(a)) throw new Error(`ask: 能问 possible（得不得到）、op（下一步做什么），没有「${a}」`);
  return { kind, push, seq: seq || options[0], options, ask, mistake: null };
}

// 找一种做法：能出就出（目标的下一个在能出的那一头），不然进下一个（先右后左）。回溯找到底；找不到返回走得最远的那条
function search(kind, push, seq) {
  let best = { ops: [], out: 0 };
  const dfs = (i, dq, k, ops) => {
    if (k === seq.length) return ops;
    if (k > best.out || (k === best.out && ops.length > best.ops.length)) best = { ops, out: k };
    const want = seq[k];
    for (const end of ['R', 'L']) {
      if (!canPop(kind, end) || !dq.length) continue;
      const x = end === 'R' ? dq[dq.length - 1] : dq[0];
      if (x !== want) continue;
      const r = dfs(i, end === 'R' ? dq.slice(0, -1) : dq.slice(1), k + 1, [...ops, { op: 'pop', end, x }]);
      if (r) return r;
    }
    if (i < push.length) for (const end of ['R', 'L']) {
      if (!canPush(kind, end)) continue;
      if (end === 'L' && !dq.length) continue; // 空的时候进左边和进右边一样
      const r = dfs(i + 1, end === 'R' ? [...dq, push[i]] : [push[i], ...dq], k, [...ops, { op: 'push', end, x: push[i] }]);
      if (r) return r;
    }
    return null;
  };
  const ops = dfs(0, [], 0, []);
  return ops ? { ok: true, ops } : { ok: false, ops: best.ops, out: best.out };
}

/** 能不能得到（纯判断，给测验、错法用） */
export function feasible(kind, push, seq) { return search(kind, push, seq).ok; }
/** push 依次进，能得到的全部出队序列 */
export function allOutputs(kind, push) {
  const out = new Set();
  const go = (i, dq, res) => {
    if (res.length === push.length) { out.add(res.join(' ')); return; }
    for (const end of ['R', 'L']) if (canPop(kind, end) && dq.length) go(i, end === 'R' ? dq.slice(0, -1) : dq.slice(1), [...res, end === 'R' ? dq.at(-1) : dq[0]]);
    if (i < push.length) for (const end of ['R', 'L']) if (canPush(kind, end) && !(end === 'L' && !dq.length)) go(i + 1, end === 'R' ? [...dq, push[i]] : [push[i], ...dq], res);
  };
  go(0, [], []);
  return [...out];
}

const SIDE = { L: '左', R: '右' };

export function run(input) {
  const kind = input.mistake === 'swap' ? (input.kind === 'in' ? 'out' : input.kind === 'out' ? 'in' : 'both') : input.kind;
  const { push, seq } = input;
  const res = search(kind, push, seq);
  const steps = [];
  let dq = [], i = 0;
  const out = [];
  const view = (extra = {}) => ({ dq: dq.slice(), rest: push.slice(i), out: out.slice(), ...extra });
  const rule = { in: '右端能进能出，左端只能出', out: '右端能进能出，左端只能进', both: '两端都能进、能出' }[kind];
  const first = { view: view(), msg: `${KIND[kind]}的双端队列（${rule}）。${push.join(' ')} 依次进队，想得到出队序列 ${seq.join(' ')}。${res.ok ? '' : ''}` };
  steps.push(first);
  // 「得不得到」问在第 1 步之前（外壳在走到一步之前问；第 0 步问不到）：这时一步操作还没看到
  const possible = input.ask.includes('possible') ? { tag: 'possible', kind: 'choice', q: `${push.join(' ')} 依次进这个${KIND[kind]}的双端队列，得得到 ${seq.join(' ')} 吗？`, choices: ['得到', '得不到'], answer: res.ok ? '得到' : '得不到' } : null;
  for (const o of res.ops) {
    const choices = ['右端进', '左端进', '右端出', '左端出'].filter((c) => (c.endsWith('进') ? canPush(kind, c[0] === '右' ? 'R' : 'L') : canPop(kind, c[0] === '右' ? 'R' : 'L')));
    const what = `${SIDE[o.end]}端${o.op === 'push' ? '进' : '出'}`;
    if (o.op === 'push') { if (o.end === 'R') dq.push(o.x); else dq.unshift(o.x); i++; } else { if (o.end === 'R') dq.pop(); else dq.shift(); out.push(o.x); }
    const why = o.op === 'pop' ? `要出的下一个是 ${o.x}，正好在${SIDE[o.end]}端` : `要出的 ${seq[out.length]} 还没进队，${o.x} 先进${o.end === 'L' ? '（放左边，免得挡住右边要先出的）' : ''}`;
    steps.push({ view: view({ last: o }), msg: `${o.x} ${what}：${why}。`, ...(input.ask.includes('op') ? { ask: { tag: 'op', kind: 'choice', q: `出了 ${out.length - (o.op === 'pop' ? 1 : 0)} 个，下一步做什么？`, choices, answer: what } } : {}) });
  }
  if (!res.ok) {
    const want = seq[out.length];
    const where = dq.includes(want) ? `${want} 在队里，可两头${kind === 'out' ? '能出的只有右端' : '都'}不是它（队里从左到右是 ${dq.join(' ')}）` : `${want} 还没进队，可再进只会把它挡在后面`;
    steps.push({ view: view({ stuck: want }), msg: `卡住了：要出 ${want}，${where}。所以得不到 ${seq.join(' ')}。` });
  } else steps.push({ view: view({ done: true }), msg: `出队序列是 ${out.join(' ')}，和要的一样：得到。` });
  if (possible) { const s1 = steps[1]; if (s1.ask) s1.asks = [s1.ask, ...(s1.asks || [])]; s1.ask = possible; }
  return { steps, ok: res.ok, ops: res.ops };
}

export function view(s, input) {
  const kind = input.kind;
  const wallL = kind === 'in' ? '只能出' : kind === 'out' ? '只能进' : '能进能出';
  const cells = s.dq.map((x, k) => `<div class="sv-cell${s.last && s.last.op === 'push' && ((s.last.end === 'R' && k === s.dq.length - 1) || (s.last.end === 'L' && k === 0)) ? ' sv-new' : ''}${s.stuck === x ? ' sv-bad' : ''}" data-pick="${esc(x)}">${esc(x)}</div>`).join('') || '<div class="dq-empty muted">（空）</div>';
  return `<div class="dq">
    <div class="dq-row"><span class="dq-lab muted">还没进</span>${s.rest.map((x) => `<span class="dq-tok">${esc(x)}</span>`).join('') || '<span class="muted">—</span>'}</div>
    <div class="dq-mid"><span class="dq-end">左端<small>${wallL}</small></span><div class="dq-cells${kind === 'in' ? ' is-noin-l' : kind === 'out' ? ' is-noout-l' : ''}">${cells}</div><span class="dq-end">右端<small>能进能出</small></span></div>
    <div class="dq-row"><span class="dq-lab muted">出队序列</span>${s.out.map((x, k) => `<span class="dq-tok is-out${k === s.out.length - 1 && s.last?.op === 'pop' ? ' sv-new' : ''}">${esc(x)}</span>`).join('') || '<span class="muted">—</span>'}</div>
  </div>`;
}

export function quiz(input) {
  const kind = input.mistake === 'swap' ? (input.kind === 'in' ? 'out' : input.kind === 'out' ? 'in' : 'both') : input.kind;
  const rule = { in: '一端能进能出、另一端只能出', out: '一端能进能出、另一端只能进', both: '两端都能进能出' }[input.kind];
  if (input.options) {
    const ok = input.options.filter((o) => feasible(kind, input.push, o));
    return { q: `${input.push.join(' ')} 依次进一个${KIND[input.kind]}的双端队列（${rule}）。下面的出队序列哪些得到？按题里列的先后写出得到的（每个序列连着写，如 4132；都得不到写 无）：${input.options.map((o) => o.join('')).join('、')}`, type: 'seq', answer: ok.length ? ok.map((o) => o.join('')).join(' ') : '无' };
  }
  return { q: `${input.push.join(' ')} 依次进一个${KIND[input.kind]}的双端队列（${rule}），得得到出队序列 ${input.seq.join(' ')} 吗？（写 得到 或 得不到）`, type: 'seq', answer: feasible(kind, input.push, input.seq) ? '得到' : '得不到' };
}

export function variants(input) {
  if (input.kind === 'both') return [];
  const v = { label: input.kind === 'in' ? '像是把输入受限当成了输出受限（只能进的那一头和只能出的那一头弄反了）' : '像是把输出受限当成了输入受限', input: { ...input, mistake: 'swap' } };
  return JSON.stringify(quiz(v.input).answer) !== JSON.stringify(quiz(input).answer) ? [v] : [];
}

export const dequeEngine = { name: 'deque', title: '双端队列', parse, run, view, quiz, variants };

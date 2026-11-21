// 静态链表（组件 slist，数据结构，视觉第 6 批）：一张结构体数组（下标、data、next），照王道：
//   a[0] 是头结点（data 不用），next = −1 是表尾，next = −2 是空闲的格（备用）。
//   插入第 i 个位置：从 1 往后找第一个 next = −2 的格放新结点；从头走 i − 1 步找到前驱 p；
//     a[new].next = a[p].next，a[p].next = new（先连后断：先让新结点接上后面，再改前驱）。
//   删除第 i 个：找到前驱 p，q = a[p].next；a[p].next = a[q].next；a[q].next = −2（还回去）。
// 一步一个操作：改的两格标出来，旁边按 next 连出来的链。纯函数，不碰 DOM（tests/engines-slist.test.js）。
import { esc, chips } from './arrayview.js';
import { miniTable, panels } from './forestview.js';

const toks = (src) => String(src ?? '').trim().split(/[\s,，、]+/).filter(Boolean);

export function parse(fields) {
  const size = Number(String(fields.size ?? '').trim());
  const list = toks(fields.list);
  if (!Number.isInteger(size) || size < 3 || size > 12) throw new Error('slist 要写 size:（数组一共几格，含 a[0] 头结点，3～12）');
  if (list.length > size - 1) throw new Error(`size: ${size} 放不下 ${list.length} 个元素（a[0] 是头结点，最多放 ${size - 1} 个）`);
  const ops = [];
  for (const p of String(fields.ops ?? '').split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
    let m = /^(insert|ins|插入)\s+(\d+)\s+(\S+)$/i.exec(p);
    if (m) { ops.push({ op: 'insert', i: Number(m[2]), x: m[3] }); continue; }
    m = /^(delete|del|删除)\s+(\d+)$/i.exec(p);
    if (m) { ops.push({ op: 'delete', i: Number(m[2]) }); continue; }
    throw new Error(`ops: 看不懂「${p}」，写成 insert 2 x（插到第 2 个位置）、delete 3（删第 3 个）`);
  }
  if (ops.length > 8) throw new Error('ops: 最多 8 个操作');
  const ask = toks(fields.ask);
  for (const a of ask) if (!['slot', 'next', 'pre'].includes(a)) throw new Error(`ask: 能问 slot（新结点放哪一格）、next（前驱的 next 改成几）、pre（前驱是哪一格），没有「${a}」`);
  return { size, list, ops, ask, mistake: null };
}

const clone = (a) => a.map((c) => ({ ...c }));
const chainOf = (a) => { const out = []; const seen = new Set(); for (let p = a[0].next; p !== -1 && p >= 0 && !seen.has(p); p = a[p].next) { seen.add(p); out.push(p); } return out; };

export function run(input) {
  const { size, list } = input;
  const a = Array.from({ length: size }, (_, k) => ({ data: '', next: -2 }));
  a[0] = { data: '', next: list.length ? 1 : -1 };
  list.forEach((x, k) => { a[k + 1] = { data: x, next: k + 1 < list.length ? k + 2 : -1 }; });
  const steps = [];
  const view = (extra = {}) => ({ a: clone(a), chain: chainOf(a), ...extra });
  steps.push({ view: view(), msg: `静态链表：一共 ${size} 格，a[0] 是头结点，next 写下一个结点在第几格；表尾的 next = −1，空闲的格 next = −2。现在链是 ${chainOf(a).map((p) => a[p].data).join(' → ') || '（空）'}。` });
  input.ops.forEach((o, k) => {
    const chain = chainOf(a);
    if (o.op === 'insert') {
      if (o.i < 1 || o.i > chain.length + 1) throw new Error(`ops: insert ${o.i} 的位置不对：现在有 ${chain.length} 个，能插在第 1～${chain.length + 1} 个位置`);
      const slot = a.findIndex((c, idx) => idx > 0 && c.next === -2);
      if (slot < 0) throw new Error(`ops: insert ${o.i} ${o.x}：数组没有空闲的格了（size 再大一点）`);
      const pre = o.i === 1 ? 0 : chain[o.i - 2];
      // 一步一件事、一步一个问题（外壳一步只问一个；问题在走到那一步之前问，所以答案在那一步才说）
      steps.push({ view: view({ at: [slot] }), msg: `插入 ${o.x} 到第 ${o.i} 个位置：先从 1 往后找第一个 next = −2 的格，是 a[${slot}]，${o.x} 放在这里。`, ...(input.ask.includes('slot') ? { ask: { tag: 'slot', kind: 'number', q: `插入 ${o.x}：新结点放在第几格？`, answer: slot } } : {}) });
      steps.push({ view: view({ at: [slot, pre] }), msg: `再从头结点走 ${o.i - 1} 步找到前驱：a[${pre}]${pre ? `（${a[pre].data}）` : '（头结点）'}。`, ...(input.ask.includes('pre') ? { ask: { tag: 'pre', kind: 'number', q: `插到第 ${o.i} 个位置：前驱是第几格？（头结点是 0）`, answer: pre } } : {}) });
      const oldNext = a[pre].next;
      if (input.mistake === 'order') { a[pre].next = slot; a[slot] = { data: o.x, next: a[pre].next }; }
      else { a[slot] = { data: o.x, next: oldNext }; a[pre].next = slot; }
      steps.push({ view: view({ changed: [slot, pre], done: true }), msg: `插入：先 a[${slot}].next = a[${pre}].next = ${oldNext}（新结点接上后面），再 a[${pre}].next = ${slot}（前驱指向新结点）。链：${chainOf(a).map((p) => a[p].data).join(' → ')}。`, ...(input.ask.includes('next') ? { ask: { tag: 'next', kind: 'number', q: `插入以后，前驱 a[${pre}] 的 next 是几？`, answer: a[pre].next } } : {}) });
    } else {
      if (o.i < 1 || o.i > chain.length) throw new Error(`ops: delete ${o.i} 的位置不对：现在有 ${chain.length} 个`);
      const pre = o.i === 1 ? 0 : chain[o.i - 2], q = chain[o.i - 1];
      steps.push({ view: view({ at: [pre, q] }), msg: `删除第 ${o.i} 个：前驱是 a[${pre}]${pre ? `（${a[pre].data}）` : '（头结点）'}，要删的是 a[${q}]（${a[q].data}）。`, ...(input.ask.includes('pre') ? { ask: { tag: 'pre', kind: 'number', q: `删第 ${o.i} 个：前驱是第几格？（头结点是 0）`, answer: pre } } : {}) });
      a[pre].next = a[q].next;
      const was = a[q].data;
      a[q] = { data: was, next: -2 };
      steps.push({ view: view({ changed: [pre, q], done: true, freed: q }), msg: `删除：a[${pre}].next = a[${q}].next = ${a[pre].next}（前驱跳过它），a[${q}].next = −2（这一格空出来）。链：${chainOf(a).map((p) => a[p].data).join(' → ') || '（空）'}。`, ...(input.ask.includes('next') ? { ask: { tag: 'next', kind: 'number', q: `删除以后，前驱 a[${pre}] 的 next 是几？`, answer: a[pre].next } } : {}) });
    }
    void k;
  });
  return { steps, order: chainOf(a).map((p) => a[p].data) };
}

export function view(s) {
  const ch = new Set(s.changed || []), at = new Set(s.at || []);
  const rows = s.a.map((c, k) => [{ html: String(k), cls: 'sl-i' }, { html: k === 0 ? '<span class="muted">头</span>' : c.next === -2 ? `<span class="muted">${esc(c.data)}</span>` : esc(c.data), cls: ch.has(k) ? 'sv-new' : at.has(k) ? 'sv-cmp' : '' }, { html: String(c.next), cls: ch.has(k) ? 'sv-new sl-hit' : c.next === -2 ? 'muted' : '' }]);
  const tab = miniTable(['下标', 'data', 'next'], rows, { cls: 'sl-tab' });
  const chain = `<div class="sl-chain"><span class="sl-node is-head">头 a[0]</span>${s.chain.map((p) => `<span class="sl-arrow">→</span><span class="sl-node${ch.has(p) ? ' sv-new' : ''}">${esc(s.a[p].data)}<small>a[${p}]</small></span>`).join('')}<span class="sl-arrow">→</span><span class="sl-nil">−1</span></div>`;
  return panels([['数组', tab], ['按 next 连起来', chain]]) + chips([['空闲的格', s.a.map((c, k) => (k && c.next === -2 ? k : null)).filter((x) => x !== null).join(' ') || '没有']]);
}

export function quiz(input, r) {
  const ops = input.ops.map((o) => (o.op === 'insert' ? `在第 ${o.i} 个位置插入 ${o.x}` : `删除第 ${o.i} 个`)).join('，');
  return { q: `静态链表一共 ${input.size} 格，a[0] 是头结点，依次放着 ${input.list.join(' ')}；${ops || '不做操作'}。按链的顺序写出现在的元素。`, qhtml: view(run({ ...input, ops: [] }).steps[0].view), type: 'seq', answer: r.order.join(' ') };
}

export function variants(input) {
  const v = { label: '像是插入时先改了前驱的 next，再让新结点指向「前驱的 next」——那时已经是它自己，后面的链断了', input: { ...input, mistake: 'order' } };
  if (!input.ops.some((o) => o.op === 'insert')) return [];
  try { return JSON.stringify(run(v.input).order) !== JSON.stringify(run(input).order) ? [v] : []; } catch { return []; }
}

export const slistEngine = { name: 'slist', title: '静态链表', parse, run, view, quiz, variants };

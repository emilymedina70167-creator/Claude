// 组成原理的多重中断：irq（中断屏蔽字、处理次序、CPU 执行程序的轨迹）。
// 口径按王道 / 唐朔飞：
//   屏蔽字每个中断源一位，按硬件响应优先级的顺序从左往右写，1 = 屏蔽、0 = 开放；主程序的屏蔽字全 0；
//   要把处理次序改成 order: 那样：X 的屏蔽字里，处理次序不比 X 高的（包括 X 自己）写 1，比 X 高的写 0；
//   请求先挂着（中断请求触发器），当前屏蔽字没屏蔽它就响应：保存现场、换上它的屏蔽字、开中断；
//   同时有几个没被屏蔽的请求，按硬件排队先响应优先级高的（它刚换上屏蔽字、开中断，处理优先级更高的那个会马上打断它）；
//   服务程序做完，恢复被打断的程序的现场和屏蔽字，再看挂着的请求。现场保护、换屏蔽字的时间不计。
// 纯函数（tests/co2-engine.test.js）。
import { esc } from './arrayview.js';
import { keepDiffering } from './coea.js';

const NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,3}$/;
const splitNames = (s) => String(s ?? '').split(/[\s>＞,，、→]+/).map((x) => x.trim()).filter(Boolean);

function parse(fields) {
  const prio = splitNames(fields.prio);
  if (prio.length < 2) throw new Error('irq 要写 prio:（中断源按硬件响应优先级从高到低），比如 prio: A > B > C > D');
  if (prio.length > 8) throw new Error('prio: 最多 8 个中断源');
  for (const x of prio) if (!NAME_RE.test(x)) throw new Error(`prio: 中断源的名字写字母开头的 1～4 个字母数字（A、L0、IRQ1），现在有「${x}」`);
  if (new Set(prio).size !== prio.length) throw new Error('prio: 有中断源写了两次');
  const n = prio.length;
  const idx = (x, what) => { const i = prio.indexOf(x); if (i < 0) throw new Error(`${what}没有中断源「${x}」（prio: 里有：${prio.join('、')}）`); return i; };
  let order = null, given = null;
  if (fields.order !== undefined && String(fields.order).trim()) {
    order = splitNames(fields.order);
    order.forEach((x) => idx(x, 'order: '));
    if (order.length !== n || new Set(order).size !== n) throw new Error(`order: 要把 ${n} 个中断源都排上，各写一次（处理次序从高到低）`);
  }
  if (fields.mask !== undefined && String(fields.mask).trim()) {
    if (order) throw new Error('order:（要的处理次序）和 mask:（直接给屏蔽字）只写一个');
    given = new Map();
    for (const part of String(fields.mask).split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
      const m = /^([A-Za-z]\w*)\s*[=:：]\s*([01\s]+)$/.exec(part);
      if (!m) throw new Error(`mask: 一项写成「A=1110」（每个中断源一位，按 prio: 的顺序，1 屏蔽），现在有「${part}」`);
      const bits = m[2].replace(/\s/g, '');
      idx(m[1], 'mask: ');
      if (bits.length !== n) throw new Error(`mask: ${m[1]} 的屏蔽字要写 ${n} 位（现在 ${bits.length} 位）`);
      given.set(m[1], bits);
    }
    const miss = prio.filter((x) => !given.has(x));
    if (miss.length) throw new Error(`mask: 还缺 ${miss.join('、')} 的屏蔽字`);
  }
  // 服务时间：一个数（都一样）或者 A=20, B=10
  const unitM = /(μs|us|ms|ns|s)\s*$/i.exec(String(fields.time ?? ''));
  const unit = unitM ? unitM[1].replace(/^us$/i, 'μs') : '';
  const time = new Map();
  const tsrc = String(fields.time ?? '').replace(/(μs|us|ms|ns|s)/gi, '').trim();
  if (tsrc) {
    if (/^\d+(\.\d+)?$/.test(tsrc)) prio.forEach((x) => time.set(x, Number(tsrc)));
    else for (const part of tsrc.split(/[,，;；]+/).map((x) => x.trim()).filter(Boolean)) {
      const m = /^([A-Za-z]\w*)\s*[=:：]\s*(\d+(?:\.\d+)?)$/.exec(part);
      if (!m) throw new Error(`time: 写一个数（每个服务程序都一样长），或者「A=20, B=10」（现在有「${part}」）`);
      idx(m[1], 'time: ');
      time.set(m[1], Number(m[2]));
    }
  }
  // 请求：B@5, C@5, D@30；几个同时请求写 B C@5；全部同时写 all@0
  const reqs = [];
  if (fields.req !== undefined && String(fields.req).trim()) {
    for (const part of String(fields.req).split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
      const m = /^(.+?)\s*(?:@|在)\s*(\d+(?:\.\d+)?)\s*(?:μs|us|ms|ns|s)?$/i.exec(part);
      if (!m) throw new Error(`req: 一项写成「名字@时刻」，比如 B@5；同时请求的写 B C@5，全部同时写 all@0（现在有「${part}」）`);
      const names = /^(all|全部|都)$/i.test(m[1].trim()) ? prio : splitNames(m[1].replace(/[+＋和]/g, ' '));
      for (const x of names) { idx(x, 'req: '); reqs.push({ name: x, t: Number(m[2]) }); }
    }
    const dup = reqs.find((r, i) => reqs.findIndex((y) => y.name === r.name) !== i);
    if (dup) throw new Error(`req: ${dup.name} 请求了两次：一个演示里每个中断源只请求一次`);
    const noT = [...new Set(reqs.map((r) => r.name))].filter((x) => !(time.get(x) > 0));
    if (noT.length) throw new Error(`time: 要写服务程序要多长时间（${noT.join('、')} 还没有），比如 time: 20`);
    reqs.sort((a, b) => a.t - b.t || prio.indexOf(a.name) - prio.indexOf(b.name));
  } else if (tsrc) throw new Error('time: 只在写了 req:（什么时候请求）时有用');
  const input = { prio, n, order, given, reqs, time, unit, mistake: '' };
  const info = maskInfo(input);
  if (given && !info.consistent) input.loose = true;
  return input;
}

/** 屏蔽字：{ masks: Map(名字 → '1110'), rank（处理次序，从高到低）, consistent（屏蔽字排得出一个处理次序）} */
export function maskInfo(input) {
  const { prio, n, mistake } = input;
  let masks;
  let rank = input.order || prio;
  if (input.given && mistake !== 'hw') masks = new Map(input.given);
  else {
    if (mistake === 'hw') rank = prio; // 错法：照硬件响应优先级写屏蔽字（像是没改处理次序）
    masks = new Map(prio.map((x) => [x, prio.map((y) => (rank.indexOf(y) >= rank.indexOf(x) ? '1' : '0')).join('')]));
  }
  if (mistake === 'noSelf') masks = new Map([...masks].map(([x, b]) => [x, [...b].map((c, i) => (prio[i] === x ? '0' : c)).join('')]));
  if (mistake === 'rev') masks = new Map([...masks].map(([x, b]) => [x, [...b].map((c) => (c === '1' ? '0' : '1')).join('')]));
  // 从屏蔽字读处理次序：1 越多处理优先级越高；读出来的次序要和每一位都对得上才算
  const ones = (x) => [...masks.get(x)].filter((c) => c === '1').length;
  const byMask = [...prio].sort((a, b) => ones(b) - ones(a) || prio.indexOf(a) - prio.indexOf(b));
  const consistent = prio.every((x) => prio.every((y, i) => (masks.get(x)[i] === '1') === (byMask.indexOf(y) >= byMask.indexOf(x))));
  return { masks, rank: input.given && mistake !== 'hw' ? byMask : rank, consistent, n };
}

/**
 * 模拟：acts [{ t, kind: 'arrive' | 'enter' | 'done', ... }]、track（CPU 在哪条线上：[{ t, lane, a（第几个 act 之后）}]）、
 * finish（处理完的先后）、start / done（每个中断源开始处理、处理完的时刻）
 */
export function simulate(input) {
  const { prio, reqs, time, mistake } = input;
  const { masks } = maskInfo(input);
  const maskOf = (name) => (name ? masks.get(name) : '0'.repeat(prio.length));
  const blocked = (top, x) => (mistake === 'noNest' && top.name) || maskOf(top.name)[prio.indexOf(x)] === '1';
  const acts = [];
  const track = [{ t: Math.min(0, reqs[0]?.t ?? 0), lane: null, a: -1 }];
  const stack = [{ name: null, rem: Infinity }];
  let pending = [];
  const finish = [], start = {}, done = {};
  let t = track[0].t, ri = 0;
  for (let guard = 0; guard < 400; guard++) {
    const arrived = [];
    const before = [...pending];
    while (ri < reqs.length && reqs[ri].t <= t + 1e-9) { const x = reqs[ri++].name; if (!pending.includes(x)) pending.push(x); arrived.push(x); }
    if (arrived.length) {
      const top = stack.at(-1);
      acts.push({ t, kind: 'arrive', names: arrived, before, top: top.name, mask: maskOf(top.name), masked: arrived.filter((x) => blocked(top, x)) });
    }
    for (;;) {
      const top = stack.at(-1);
      const cands = pending.filter((x) => !blocked(top, x)).sort((a, b) => prio.indexOf(a) - prio.indexOf(b));
      if (!cands.length) break;
      const x = cands[0];
      pending = pending.filter((y) => y !== x);
      stack.push({ name: x, rem: time.get(x) });
      if (start[x] === undefined) start[x] = t;
      acts.push({ t, kind: 'enter', name: x, from: top.name, cands, pending: [...pending], mask: maskOf(x) });
      track.push({ t, lane: top.name, a: acts.length - 1 }, { t, lane: x, a: acts.length - 1 });
    }
    const top = stack.at(-1);
    const nextReq = ri < reqs.length ? reqs[ri].t : Infinity;
    const fin = top.name ? t + top.rem : Infinity;
    if (fin === Infinity && nextReq === Infinity) break;
    const t2 = Math.min(fin, nextReq);
    if (top.name) top.rem -= t2 - t;
    t = t2;
    if (top.name && top.rem <= 1e-9) {
      stack.pop();
      const back = stack.at(-1).name;
      finish.push(top.name);
      done[top.name] = t;
      acts.push({ t, kind: 'done', name: top.name, back, mask: maskOf(back), pending: [...pending] });
      track.push({ t, lane: top.name, a: acts.length - 1 }, { t, lane: back, a: acts.length - 1 });
    }
  }
  return { acts, track, finish, start, done, end: t, masks };
}

const prog = (x) => (x ? `${x} 服务程序` : '主程序');
const who = (x) => x ?? '主程序';
const tt = (t, input) => `${Math.round(t * 1000) / 1000}${input.unit}`;

function run(input) {
  const { prio, n } = input;
  const info = maskInfo(input);
  const steps = [];
  const colText = `（按 ${prio.join(' ')} 的顺序，1 屏蔽、0 开放）`;
  steps.push({ view: { phase: 'mask', k: input.given ? n : 0, intro: true }, msg: `${n} 个中断源，硬件响应优先级 ${prio.join(' > ')}。${input.order ? `要把处理次序改成 ${input.order.join(' > ')}：用屏蔽字。` : input.given ? `屏蔽字已经给了${colText}。` : '屏蔽字按响应优先级设：每个中断源屏蔽自己和比自己低的。'}${input.reqs.length ? `每个服务程序要 ${[...new Set(prio.filter((x) => input.time.has(x)).map((x) => tt(input.time.get(x), input)))].join(' / ')}。` : ''}` });
  if (!input.given) {
    // 一个个写屏蔽字：处理次序不比它高的写 1
    const rank = info.rank;
    prio.forEach((x, i) => {
      const bits = info.masks.get(x);
      const low = rank.slice(rank.indexOf(x) + 1), high = rank.slice(0, rank.indexOf(x));
      steps.push({ view: { phase: 'mask', k: i + 1, cur: x }, msg: `${x} 的屏蔽字：处理次序 ${rank.join(' > ')}，${x} 要屏蔽自己${low.length ? `和比它低的 ${low.join('、')}` : ''}（写 1）${high.length ? `，不屏蔽比它高的 ${high.join('、')}（写 0）` : '：它最高，全部屏蔽'}。按 ${prio.join(' ')} 写：${bits}。`, ask: { tag: 'mask', kind: 'bin', width: n, q: `${x} 的屏蔽字是？（${n} 位，按 ${prio.join(' ')} 的顺序，1 屏蔽）`, answer: BigInt(`0b${bits}`), display: bits } });
    });
  } else if (!input.loose) {
    steps.push({ view: { phase: 'mask', k: n, rank: true }, msg: `从屏蔽字读处理次序：1 越多，屏蔽的越多，处理优先级越高：${info.rank.join(' > ')}。`, ask: { tag: 'rank', kind: 'text', q: '从屏蔽字看，处理次序从高到低是？', answer: [info.rank.join(' '), info.rank.join('')].join(' | ') } });
  }
  const sim = input.reqs.length ? simulate(input) : null;
  if (sim) {
    // 同一时刻的事按「一直到响应了一个」分成一步：每一步问「接下来 CPU 执行哪个程序」
    const groups = [];
    let g = [];
    sim.acts.forEach((a, j) => {
      if (g.length && g[0].t !== a.t) { groups.push(g); g = []; }
      g.push({ ...a, j });
      if (a.kind === 'enter') { groups.push(g); g = []; }
    });
    if (g.length) groups.push(g);
    const choices = [...prio, '主程序'];
    groups.forEach((grp) => {
      const t = grp[0].t;
      const last = grp.at(-1);
      const after = last.kind === 'enter' ? last.name : last.kind === 'done' ? last.back : last.top;
      const parts = [];
      const frags = [];
      let ctx = '', q = '';
      for (const a of grp) {
        const at = a === grp[0] ? `t = ${tt(t, input)}：` : '';
        if (a.kind === 'arrive') {
          const on = a === grp[0] ? (a.top ? `正在执行 ${prog(a.top)}，屏蔽字 ${a.mask}` : `CPU 在执行主程序（屏蔽字全 0）`) : `这时恢复的是${a.top ? ` ${prog(a.top)}，屏蔽字 ${a.mask}` : '主程序，屏蔽字全 0'}`;
          parts.push(`${at}${a.names.join('、')} 请求。${on}${a.masked.length ? `：${a.masked.map((x) => `${x} 那一位是 1`).join('、')}，被屏蔽，先挂着` : ''}${a.masked.length && a.masked.length < a.names.length ? `；${a.names.filter((x) => !a.masked.includes(x)).join('、')} 没被屏蔽` : ''}。`);
          frags.push(`${a.names.join('、')}${a.names.length > 1 ? ' 同时' : ' '}请求${a.before.length && a === grp[0] ? `（还挂着 ${a.before.join('、')}）` : ''}`);
          if (a === grp[0]) ctx = a.top ? `正在执行 ${prog(a.top)}` : 'CPU 在执行主程序';
        } else if (a.kind === 'done') {
          parts.push(`${at}${a.name} 处理完，恢复${a.back ? ` ${prog(a.back)}` : '主程序'}的现场和屏蔽字${a.back ? ` ${a.mask}` : '（全 0）'}。${a.pending.length ? `还挂着：${a.pending.join('、')}。` : ''}`);
          frags.push(`${a.name} 处理完${a.pending.length ? `（还挂着 ${a.pending.join('、')}）` : ''}`);
        } else if (grp.length > 1) {
          parts.push(`${a.cands.length > 1 ? `${a.cands.join('、')} 都没被屏蔽，硬件排队 ${a.name} 优先，先响应 ${a.name}` : `响应 ${a.name}`}：保存${a.from ? ` ${prog(a.from)}` : '主程序'}的现场，换上 ${a.name} 的屏蔽字 ${a.mask}，开中断。`);
        } else {
          // 同一时刻接着响应的：上一个刚换上屏蔽字、开中断，挂着的处理次序更高，马上打断它
          parts.push(`${a.from} 刚进入服务程序、换上屏蔽字 ${sim.masks.get(a.from)}，开中断：挂着的 ${a.name} 那一位是 0（${a.name} 的处理次序比 ${a.from} 高），${a.name} 马上打断 ${a.from}，换上 ${a.name} 的屏蔽字 ${a.mask}。`);
          q = `${a.from} 刚进入服务程序、换上屏蔽字 ${sim.masks.get(a.from)}，${[a.name, ...a.pending].join('、')} 还挂着。接下来 CPU 执行哪个程序？`;
        }
      }
      if (!q) q = `t = ${tt(t, input)}：${frags.join('，')}${ctx ? `，${ctx}` : ''}。接下来 CPU 执行哪个程序？`;
      if (last.kind !== 'enter' && last.kind === 'done' && !last.back && !last.pending.length && last.j === sim.acts.length - 1) parts.push('全部处理完，回到主程序。');
      else if (last.kind === 'done') parts.push(`${who(after) === '主程序' ? '回到主程序' : `回到 ${after}，接着做`}。`);
      else if (last.kind === 'arrive') parts.push(`${who(after) === '主程序' ? '主程序' : after} 接着执行。`);
      steps.push({ view: { phase: 'run', a: last.j, t }, msg: parts.join(''), ask: { tag: 'next', kind: 'choice', choices, q, answer: who(after) } });
    });
    const fin = sim.finish;
    steps.push({ view: { phase: 'run', a: sim.acts.length - 1, t: sim.end, done: true }, msg: `处理完的先后：${fin.join('、')}（${fin.map((x) => `${x} 在 ${tt(sim.done[x], input)}`).join('，')}）。${input.order || input.given ? '' : ''}`, ask: { tag: 'finish', kind: 'text', q: '各中断服务程序处理完的先后次序是？', answer: [fin.join(' '), fin.join('')].join(' | ') } });
  }
  return { steps, info, sim };
}

// 题目给的几样（第 0 步、quiz 和填表的题面）
function givenHtml(input) {
  const { prio } = input;
  const items = [`硬件响应优先级 <b>${esc(prio.join(' > '))}</b>`];
  if (input.order) items.push(`要的处理次序 <b>${esc(input.order.join(' > '))}</b>`);
  if (input.reqs.length) {
    const at = new Map();
    for (const r of input.reqs) at.set(r.t, [...(at.get(r.t) || []), r.name]);
    items.push(`请求 <b>${[...at].map(([t, xs]) => `${esc(xs.join('、'))} 在 ${esc(tt(t, input))}`).join('，')}</b>`);
    const ts = [...new Set(prio.filter((x) => input.time.has(x)).map((x) => input.time.get(x)))];
    items.push(`${ts.length === 1 ? '每个' : ''}服务程序 <b>${ts.length === 1 ? esc(tt(ts[0], input)) : esc(prio.filter((x) => input.time.has(x)).map((x) => `${x} ${tt(input.time.get(x), input)}`).join('，'))}</b>`);
  }
  return `<div class="iq-given">${items.map((x) => `<span>${x}</span>`).join('')}</div>`;
}

function view(st, input) {
  const { prio, n } = input;
  const info = maskInfo(input);
  const sim = input.reqs.length ? simulate(input) : null;
  const k = st.phase === 'mask' ? st.k : n;
  const upto = st.phase === 'run' ? st.a : -1;
  // 运行到这一步时：谁在执行、栈、挂着的
  let running = null;
  const stack = [null];
  let pending = [];
  if (sim) for (const a of sim.acts.slice(0, upto + 1)) {
    if (a.kind === 'arrive') pending.push(...a.names.filter((x) => !pending.includes(x)));
    if (a.kind === 'enter') { stack.push(a.name); pending = pending.filter((x) => x !== a.name); }
    if (a.kind === 'done') stack.pop();
  }
  running = stack.at(-1);
  const doneSet = new Set(sim ? sim.acts.slice(0, upto + 1).filter((a) => a.kind === 'done').map((a) => a.name) : []);
  // 屏蔽字表：每个中断源一行，每一位一格
  const rows = prio.map((x, i) => {
    const bits = i < k ? info.masks.get(x) : null;
    const cls = [x === st.cur ? 'iq-on' : '', st.phase === 'run' && x === running ? 'iq-run' : '', pending.includes(x) ? 'iq-wait' : '', doneSet.has(x) ? 'iq-done' : ''].filter(Boolean).join(' ');
    const state = st.phase !== 'run' ? '' : x === running ? '执行中' : stack.includes(x) ? '被打断' : pending.includes(x) ? '挂着' : doneSet.has(x) ? `做完 ${tt(sim.done[x], input)}` : '';
    return `<tr class="${cls}" data-cmd="${i + 1}" data-label="${esc(x)}"><th scope="row">${esc(x)}</th><td class="iq-r">${i + 1}</td>${prio.map((y, j) => `<td class="iq-b${bits && bits[j] === '1' ? ' iq-1' : ''}">${bits ? bits[j] : ''}</td>`).join('')}${sim ? `<td class="iq-s">${esc(state)}</td>` : ''}</tr>`;
  }).join('');
  let h = `${st.intro ? givenHtml(input) : ''}<div class="iq-wrap"><table class="sv-tab iq-tab"><thead><tr><th>中断源</th><th>响应</th>${prio.map((y) => `<th class="iq-bh">${esc(y)}</th>`).join('')}${sim ? '<th>状态</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
  if (st.rank || (st.phase === 'run' && (input.order || input.given))) h += `<div class="iq-rank">处理次序：${esc(info.rank.join(' > '))}</div>`;
  h += '</div>';
  if (!sim) return h;
  // CPU 执行程序的轨迹（王道的画法）：一条横线一个程序，往下走是被打断、去执行服务程序
  const lanes = [null, ...[...info.rank].reverse()];
  const T = Math.max(sim.end, sim.acts.at(-1)?.t ?? 0) * 1.06 + 1;
  const t0 = sim.track[0].t;
  const W = 640, L = 78, R = 14, top = 30, lh = 32;
  const x = (t) => L + ((t - t0) / (T - t0)) * (W - L - R);
  const y = (lane) => top + lanes.indexOf(lane) * lh + lh / 2;
  const H = top + lanes.length * lh + 26;
  const now = st.phase === 'run' ? st.t : t0;
  let s = `<svg class="iq-svg" viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="CPU 执行程序的轨迹">`;
  lanes.forEach((ln, i) => { s += `<g class="iq-lane" data-cmd="${n + i + 1}" data-label="${esc(ln ? `${ln} 服务程序` : '主程序')}"><line class="iq-guide" x1="${L}" y1="${y(ln)}" x2="${W - R}" y2="${y(ln)}"/><text class="iq-ln" x="${L - 8}" y="${y(ln)}">${esc(ln ? `${ln} 服务` : '主程序')}</text></g>`; });
  // 请求：顶上一个小三角，走到那个时刻才画
  const reqAt = new Map();
  for (const r of input.reqs) if (r.t <= now + 1e-9 && st.phase === 'run') reqAt.set(r.t, [...(reqAt.get(r.t) || []), r.name]);
  for (const [t, names] of reqAt) s += `<g class="iq-req"><path d="M${x(t) - 6} ${top - 14} L${x(t) + 6} ${top - 14} L${x(t)} ${top - 4} Z"/><text x="${x(t)}" y="${top - 18}">${esc(names.join(' '))}</text></g>`;
  // 轨迹：到这一步为止
  if (st.phase === 'run') {
    const pts = sim.track.filter((p) => p.a <= upto);
    const cur = pts.at(-1);
    // 全部处理完：主程序接着往后走到头
    const all = [...pts, { t: now, lane: cur.lane }, ...(st.done ? [{ t: T, lane: null }] : [])];
    s += `<polyline class="iq-path" points="${all.map((p) => `${x(p.t).toFixed(1)},${y(p.lane).toFixed(1)}`).join(' ')}"/>`;
    for (let i = 1; i < all.length; i++) if (all[i].lane === all[i - 1].lane && all[i].t > all[i - 1].t) s += `<line class="iq-run${all[i].lane ? '' : ' iq-main'}" x1="${x(all[i - 1].t).toFixed(1)}" y1="${y(all[i].lane)}" x2="${x(all[i].t).toFixed(1)}" y2="${y(all[i].lane)}"/>`;
    // 刚进去马上被打断的（时长 0）：画一个点
    sim.acts.filter((a, j) => j <= upto && a.kind === 'enter').forEach((a) => { s += `<circle class="iq-dot" cx="${x(a.t).toFixed(1)}" cy="${y(a.name)}" r="3.5"/>`; });
    s += `<line class="iq-now" x1="${x(now).toFixed(1)}" y1="${top - 4}" x2="${x(now).toFixed(1)}" y2="${H - 22}"/>`;
  }
  // 时间轴：事件发生的时刻
  const ticks = [...new Set([t0, ...input.reqs.map((r) => r.t), ...sim.acts.map((a) => a.t)])].sort((a, b) => a - b);
  let lastX = -99;
  s += `<line class="iq-axis" x1="${L}" y1="${H - 22}" x2="${W - R}" y2="${H - 22}"/>`;
  for (const t of ticks) { if (x(t) - lastX < 22) continue; lastX = x(t); s += `<text class="iq-tk" x="${x(t).toFixed(1)}" y="${H - 6}">${esc(tt(t, input))}</text>`; }
  s += '</svg>';
  const info2 = st.phase === 'run' ? `<div class="iq-info"><span>t = <b>${esc(tt(now, input))}</b></span><span>正在执行：<b>${esc(who(running))}</b></span><span>现场栈：${esc(stack.map(who).join(' → '))}</span><span>挂着：${pending.length ? esc(pending.join('、')) : '无'}</span></div>` : '';
  return `${h}${info2}<div class="iq-tl">${s}</div>`;
}

export const irqEngine = {
  name: 'irq', title: '中断屏蔽与处理次序', parse, run, view,
  quiz(input, r) {
    const qhtml = input.given ? view({ phase: 'mask', k: input.n, intro: true }, input) : givenHtml(input);
    if (r.sim) return { qhtml, q: '按时间先后，写出各中断服务程序处理完的次序（空格隔开）。', type: 'seq', answer: r.sim.finish.join(' ') };
    return { qhtml, q: `按 ${input.prio.join('、')} 的顺序写出各中断源的屏蔽字（每个 ${input.n} 位，空格隔开）。`, type: 'seq', answer: input.prio.map((x) => r.info.masks.get(x)).join(' ') };
  },
  table(input, r) {
    const head = ['屏蔽字', ...(r.sim ? ['开始处理', '处理完'] : [])];
    return {
      q: r.sim ? '填每个中断源的屏蔽字、开始处理和处理完的时刻，再写处理完的先后次序。' : '填每个中断源的屏蔽字（按响应优先级的顺序写各位，1 屏蔽）。', qhtml: input.given ? view({ phase: 'mask', k: input.n, intro: true }, input) : givenHtml(input), dir: 'row', head,
      rows: input.prio.map((x) => ({ label: x, cells: [{ v: r.info.masks.get(x), given: !!input.given }, ...(r.sim ? [r.sim.start[x] === undefined ? { v: '', given: true } : { v: String(r.sim.start[x]), num: true }, r.sim.done[x] === undefined ? { v: '', given: true } : { v: String(r.sim.done[x]), num: true }] : [])] })),
      extra: r.sim ? [{ label: '处理完的次序', v: ['', ',', '→', '>', '、'].map((sep) => r.sim.finish.join(sep)) }] : input.given && !input.loose ? [{ label: '处理次序（从高到低）', v: ['', ',', '→', '>', '、'].map((sep) => r.info.rank.join(sep)) }] : undefined,
    };
  },
  problems(input) {
    return input.loose ? ['mask: 这几个屏蔽字排不出一个处理次序（比如两个中断源互相屏蔽，或者不屏蔽自己）：照着模拟，但不问处理次序'] : [];
  },
  // 常见错法：照硬件优先级写屏蔽字、屏蔽字没屏蔽自己、1 和 0 弄反、当成单重中断（服务程序不让打断）
  variants(input) {
    const list = [
      ['hw', '像是照硬件响应优先级处理了（屏蔽字没按要的处理次序改）'],
      ['noSelf', '像是屏蔽字没屏蔽自己（自己那一位也要写 1）'],
      ['rev', '像是把 1 和 0 弄反了（1 是屏蔽）'],
      ['noNest', '像是当成单重中断了（服务程序开中断以后，处理优先级高的可以打断它）'],
    ].map(([m, label]) => ({ label, input: { ...input, mistake: m } }));
    return keepDiffering(irqEngine, input, list);
  },
};

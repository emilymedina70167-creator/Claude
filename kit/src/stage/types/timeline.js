// 舞台上的时间轴（主线第三轮 B）：一排等距的停靠点（年份、「过去 现在 将来」），上面有小人、事件点、事件条。
// 数据和指令，不碰 DOM（画法在 timeline.view.js）。纯函数，有测试（tests/stage-timeline.test.js）。
//
// 以前老师拿坐标平面凑（带 y 轴的方格纸、箭头只能从原点出发、事实只有坐标）或者拿一排年份格子凑（小人拖不动、一摆全就排坏），
// 两种凑法里句子都跟不了轴。做法：**轴上能动的东西就是拨词的拨盘的把手**——小人 me 是拨盘 me（能拨到的就是这些停靠点），
// 事件条能动的那一头是它自己的拨盘。句子跟着变（{me: had | has | will have}）、挑战里比词（when="me = 现在"、"e < me"）、
// 学生拨的路写给老师，都照第二轮拨盘的规矩，不另做一遍。
const MAX_STOPS = 10;
export const TL = { STEP: 108, PAD: 54, BAR_H: 30, BAR_GAP: 6, DOT_ROW: 30, AXIS: 26, STAND: 58 };
const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };
const NAME = /^[A-Za-z_]\w*$/;

const flags = () => ({ paint: null, glow: false, lift: false, dim: false, covered: false });
/** 第几个停靠点（1 起）；没有是 0 */
export const stopIndex = (o, word) => o.stops.indexOf(String(word)) + 1;
const stopName = (o, i) => o.stops[i - 1] ?? '?';
// 一样东西现在在哪（小人、条的两头：绑了拨盘的照拨盘）
const dialAt = (scene, name, fallback) => scene?.vars?.get(name)?.v ?? fallback;
export function itemPos(scene, o, it) {
  if (it.kind === 'stand') return { at: dialAt(scene, it.name, it.at) };
  if (it.kind === 'point') return { at: it.at };
  return { from: it.startDial ? dialAt(scene, it.startDial, it.from) : it.from, to: it.endDial ? dialAt(scene, it.endDial, it.to) : it.to };
}
// 条排在第几层（两条有重叠就错开；照造的先后）：画法、排版都用
export function barLanes(o) {
  const lanes = [];
  const out = new Map();
  for (const it of o.items.filter((x) => x.kind === 'bar')) {
    // 能动的头会伸到哪不知道：当它占满整条轴（不然一拖就压到别的条上）
    const lo = it.startDial ? 1 : it.from, hi = it.endDial ? o.stops.length : it.to;
    let k = lanes.findIndex((ls) => ls.every((r) => hi < r.lo || lo > r.hi));
    if (k < 0) { k = lanes.length; lanes.push([]); }
    lanes[k].push({ lo, hi });
    out.set(it.name, k);
  }
  return { of: out, n: lanes.length };
}
export const stopX = (o, i) => o.origin.x + TL.PAD + (i - 1) * TL.STEP;
/** 各层的 y：条（从下往上一层层）→ 事件点那一行 → 轴 → 刻度的字 → 小人 */
export function rowsY(o) {
  const n = barLanes(o).n;
  const bars = n * (TL.BAR_H + TL.BAR_GAP);
  const dots = o.items.some((x) => x.kind === 'point') ? TL.DOT_ROW : 0;
  const axis = o.origin.y + bars + dots + 8;
  return { bars: o.origin.y, barsH: bars, dots: o.origin.y + bars, axis, labels: axis + 8, stand: axis + TL.AXIS + 4, bottom: axis + TL.AXIS + 4 + (o.items.some((x) => x.kind === 'stand') ? TL.STAND : 0) };
}
function sizeOf(o) {
  const r = rowsY(o);
  return { w: 2 * TL.PAD + (o.stops.length - 1) * TL.STEP, h: r.bottom - o.origin.y };
}
function objectBox(o) { return { x: o.origin.x, y: o.origin.y, ...sizeOf(o) }; }
// 部件的框要现在的位置：拨盘在场景里，画法、场景都从 o.at（场景每一行之后写回的那一份）读
function partBox(o, it) {
  const r = rowsY(o);
  const p = o.at?.[it.name] || (it.kind === 'bar' ? { from: it.from, to: it.to } : { at: it.at });
  if (it.kind === 'stand') return { x: stopX(o, p.at) - 22, y: r.stand, w: 44, h: TL.STAND - 4 };
  if (it.kind === 'point') return { x: stopX(o, p.at) - 22, y: r.dots, w: 44, h: TL.DOT_ROW - 2 };
  const lane = barLanes(o).of.get(it.name) || 0;
  const n = barLanes(o).n;
  return { x: stopX(o, p.from) - 10, y: r.bars + (n - 1 - lane) * (TL.BAR_H + TL.BAR_GAP), w: stopX(o, p.to) - stopX(o, p.from) + 20, h: TL.BAR_H };
}

// 这一行写的是哪条时间轴（第一个词是它的名字）
function axisIn(scene, h, eg) {
  const o = scene.objects.get(h.words[0]);
  if (!o || o.type !== 'timeline') throw new Error(`要写成 ${eg}`);
  return o;
}
// 新造的名字：不能和舞台上的东西、拨盘、这条轴上别的东西撞
function freshName(scene, o, name, eg) {
  if (!name || !NAME.test(name)) throw new Error(`要写成 ${eg}（名字用字母开头）`);
  if (o.items.some((x) => x.name === name) || scene.vars.has(name) || scene.objects.has(name)) throw new Error(`已经有叫「${name}」的了（舞台上的东西、拨盘、时间轴上的东西名字不能重）：换一个名字`);
}
function stopOf(o, word) {
  const i = stopIndex(o, word);
  if (!i) throw new Error(`${o.id} 上没有「${word}」这个停靠点（有：${o.stops.join('、')}）`);
  return i;
}
// 一个把手 = 一个拨词的拨盘：能拨到的就是这些停靠点；不另画 ‹ ›（shown: false），owner 记着是哪条轴的
const mkDial = (scene, o, name, v) => scene.vars.set(name, { v, lo: 1, hi: o.stops.length, at: null, shown: false, options: [...o.stops], owner: o.id });
// 每一行之后把各样东西现在的位置抄到 o.at（partBox 是纯函数、拿不到场景里的拨盘）
export function syncAt(scene, o) {
  const at = {};
  for (const it of o.items) at[it.name] = itemPos(scene, o, it);
  o.at = at;
}
/** 条和小人的关系写成半句 */
export function relation(p, me, name) {
  if (p.to < me) return `整条在 ${name} 之前`;
  if (p.from > me) return `整条在 ${name} 之后`;
  if (p.to === me && p.from < me) return `右端正好到 ${name}`;
  if (p.from === me && p.to > me) return `从 ${name} 开始`;
  if (p.from === me && p.to === me) return `就在 ${name} 那一处`;
  return `${name} 在这一条中间`;
}

export const timeline = {
  type: 'timeline',
  label: '时间轴',
  create: ['timeline'],
  options: { timeline: ['now'], bar: ['start', 'end'] },
  hint: '（时间轴：名字.me 是上面叫 me 的那一样东西（小人、事件条、事件点）；小人、条能动的那一头是拨词的拨盘，set me 现在 就走过去）',
  make(scene, c, h, old) {
    const id = h.words[0];
    const eq = h.args.findIndex((a) => a.t === 'eq');
    const eg = `timeline ${id || 'tl'} = 过去 现在 将来 now=现在（等号后面一个个停靠点：年份、词）`;
    if (eq < 0) throw new Error(`要写成 ${eg}`);
    const stops = h.args.slice(eq + 1).filter((a) => a.t === 'word' || a.t === 'str').map((a) => String(a.v).trim());
    if (stops.length < 2) throw new Error(`时间轴至少两个停靠点：${eg}`);
    if (stops.length > MAX_STOPS) throw new Error(`一条时间轴最多 ${MAX_STOPS} 个停靠点（写了 ${stops.length} 个）`);
    const dup = stops.find((w, i) => stops.indexOf(w) !== i);
    if (dup) throw new Error(`停靠点「${dup}」写了两次`);
    const odd = stops.find((w) => /[="「」“”{}|\s]/.test(w));
    if (odd) throw new Error(`停靠点的名字里不能有 = 、引号、花括号、空格（「${odd}」）：学生一拖交的是 set me ${odd}，读不成`);
    let now = null;
    if (h.opts.now != null) { now = String(h.opts.now).trim(); if (!stops.includes(now)) throw new Error(`now= 写一个停靠点（${stops.join('、')}），没有「${now}」`); }
    const o = { stops, now, items: [], at: {}, origin: { x: 0, y: 0 } };
    o.origin = old?.type === 'timeline' ? { ...old.origin } : scene.slotFor(sizeOf(o).w);
    return o;
  },
  parts(o) { return o.items; },
  pick(o, mark, sel, word) {
    const it = mark === '.' ? o.items.find((x) => x.name === sel) : null;
    if (!it) throw new Error(`「${word}」：时间轴 ${o.id} 上没有「${sel}」（有：${o.items.map((x) => x.name).join('、') || '还什么都没放'}；写成 ${o.id}.名字）`);
    return [it];
  },
  ref(p) { return `${p.obj}.${p.name}`; },
  partBox,
  objectBox,
  obstacles(o) { return [objectBox(o)]; },
  // 每一行之后：各样东西现在在哪抄一份（拨盘变了位置跟着变；scene.js 的 afterLine）
  afterLine(scene, o) { syncAt(scene, o); },
  // 拨盘要换成 v 之前问一声（scene.js 的 set）：条的右端不能跑到左端前面
  checkVar(scene, o, name, v) {
    for (const it of o.items) {
      if (it.kind !== 'bar') continue;
      const p = itemPos(scene, o, it);
      if (it.endDial === name && v < p.from) throw new Error(`${it.name} 的右端不能在左端（${stopName(o, p.from)}）前面`);
      if (it.startDial === name && v > p.to) throw new Error(`${it.name} 的左端不能在右端（${stopName(o, p.to)}）后面`);
    }
  },
  // 拿下舞台、同名重造：它的拨盘跟着没了（scene.js 的 dropObject 照 owner 清）
  canOpen(scene, o, action, h) {
    const ref = h.words[0];
    const it = ref.includes('.') ? scene.parts(ref)[0] : null;
    if (action === 'move') {
      if (it ? it.kind !== 'stand' : !o.items.some((x) => x.kind === 'stand')) throw new Error(it ? `move 拖的是小人（open ${o.id}.小人的名字 move），${it.name} 不是` : `${o.id} 上还没有小人：先 stand ${o.id} me = ${o.stops[0]}`);
    }
    if (action === 'stretch') {
      const bars = it ? [it] : o.items.filter((x) => x.kind === 'bar');
      if (it && it.kind !== 'bar') throw new Error(`stretch 拖的是事件条能动的那一头，${it.name} 不是事件条`);
      if (!bars.some((b) => b.startDial || b.endDial)) throw new Error(`${it ? it.name : `${o.id} 上的事件条`}没有能动的一头：造的时候写 end=e（右端是拨盘 e）或 start=a`);
    }
  },
  commands: {
    // stand tl me = 1830：一个小人站在 1830。同时有了拨词的拨盘 me（set me 现在、{me}、{me: … | …}、when="me = 现在"）
    stand(scene, c, h) {
      const eg = 'stand tl me = 1830（时间轴的名字，小人的名字，站在哪个停靠点）';
      const o = axisIn(scene, h, eg);
      const name = h.words[1];
      freshName(scene, o, name, eg);
      const at = stopOf(o, h.words[2] ?? o.stops[0]);
      o.items.push({ obj: o.id, key: name, name, kind: 'stand', at, value: name, label: h.str ?? '', ...flags() });
      mkDial(scene, o, name, at);
      return { id: o.id, added: name };
    },
    // event tl sent = 1830 "sent"：轴上方一个事件点，带一句字（不叫 point：那是平面上的点）
    event(scene, c, h) {
      const eg = 'event tl sent = 1830 "sent"（时间轴的名字，这一点的名字，在哪个停靠点，写什么）';
      const o = axisIn(scene, h, eg);
      const name = h.words[1];
      freshName(scene, o, name, eg);
      if (h.words[2] == null) throw new Error(`要写成 ${eg}`);
      const at = stopOf(o, h.words[2]);
      o.items.push({ obj: o.id, key: name, name, kind: 'point', at, value: h.str ?? name, label: h.str ?? '', ...flags() });
      return { id: o.id, added: name };
    },
    // bar tl war = 1800..1830 "成为独立国家" end=e：有起止的一条；end= / start= 给能动的那一头一个拨盘的名字
    bar(scene, c, h) {
      const eg = 'bar tl war = 1800..1830 "成为独立国家"（起止用 .. 连着；end=e 右端能动，是拨盘 e）';
      const o = axisIn(scene, h, eg);
      const name = h.words[1];
      freshName(scene, o, name, eg);
      const m = String(h.words[2] ?? '').match(/^(.+?)\.\.(.+)$/);
      if (!m) throw new Error(`起止写成 起点..终点：bar ${o.id} ${name} = ${o.stops[0]}..${o.stops[1]} "…"`);
      const from = stopOf(o, m[1]), to = stopOf(o, m[2]);
      if (from > to) throw new Error(`起点（${m[1]}）在终点（${m[2]}）后面：从早的写到晚的`);
      const it = { obj: o.id, key: name, name, kind: 'bar', from, to, value: h.str ?? name, label: h.str ?? '', startDial: null, endDial: null, ...flags() };
      for (const [k, side] of [['start', 'startDial'], ['end', 'endDial']]) {
        const d = h.opts[k];
        if (d == null) continue;
        if (d === name) throw new Error(`${k}= 的名字要和这一条不一样（${name} 是条的名字）`);
        freshName(scene, { items: [...o.items, it] }, d, `${k}=e（给这一头一个拨盘的名字）`);
        it[side] = d;
      }
      if (it.startDial && it.startDial === it.endDial) throw new Error('start= 和 end= 要两个不一样的名字');
      o.items.push(it);
      if (it.startDial) mkDial(scene, o, it.startDial, from);
      if (it.endDial) mkDial(scene, o, it.endDial, to);
      return { id: o.id, added: name };
    },
  },
  describe(o, scene) {
    const lines = [`时间轴 ${o.id}：${o.stops.map((s) => (s === o.now ? `${s}（now）` : s)).join(' · ')}`];
    const pos = (it) => (scene ? itemPos(scene, o, it) : o.at?.[it.name] || it);
    const stands = o.items.filter((x) => x.kind === 'stand');
    const look = (it) => { const b = [it.paint && COLOR_NAMES[it.paint], it.glow && '亮', it.dim && '灰', it.covered && '扣着'].filter(Boolean); return b.length ? `（${b.join('、')}）` : ''; };
    for (const it of o.items) {
      const p = pos(it);
      if (it.kind === 'stand') lines.push(`  小人 ${it.name} 在 ${stopName(o, p.at)}（拨盘 ${it.name}）${look(it)}`);
      else if (it.kind === 'point') lines.push(`  事件点 ${it.name} 在 ${stopName(o, p.at)}${it.label ? `「${it.label}」` : ''}${look(it)}`);
      else {
        const ends = [it.startDial && `左端是拨盘 ${it.startDial}`, it.endDial && `右端是拨盘 ${it.endDial}`].filter(Boolean).join('、');
        const rel = stands.map((s) => relation(p, pos(s).at, s.name)).join('、');
        lines.push(`  事件条 ${it.name}：${stopName(o, p.from)} → ${stopName(o, p.to)}${it.label ? `「${it.label}」` : ''}${ends ? `（${ends}）` : ''}${rel ? `，${rel}` : ''}${look(it)}`);
      }
    }
    return lines;
  },
  summary(o) { return o.stops.join(' '); },
  docSetup: 'timeline tl = 1800 1830 1900 现在 将来 now=现在\nstand tl me = 1830\nbar tl war = 1800..1830 "成为独立国家" end=e',
  doc: `时间轴（时态：一排停靠点，上面有小人、事件条、事件点）：
timeline tl = 1800 1830 1900 现在 将来 now=现在  等号后面是停靠点（年份、词，最多 10 个，等距）；now= 那一个画一道竖线
stand tl me = 1830  小人。同时是拨词的拨盘 me：set me 现在 走过去；{me} 写它在哪；句子里 {me: had | had | had | has | will have}（一个停靠点一段）跟着变；when="me = 现在"
event tl sent = 1830 "sent"  事件点
bar tl war = 1800..1830 "成为独立国家"  事件条；end=e 右端能动（是拨盘 e），start=a 左端能动
写法：tl.me、tl.war、tl.sent（paint、glow、dim 都能用）
open tl.me move  学生按住小人拖到一个停靠点 = set me 现在
open tl.war stretch  学生拖条能动的那一头 = set e 现在
比先后（when=）：e < me、me >= 1830（同一条轴上的拨盘，或者和一个停靠点比）；现状里写每条在小人之前 / 之后 / 小人在中间`,
  example: `timeline tl = 1800 1830 1900 现在 将来 now=现在
stand tl me = 现在
bar tl war = 1800..1830 "成为独立国家"
sentence s = "Belgium {me: will become | had become | had become | has become | will have become} independent."
say "把小人拖到 1900 年，回头看这件事。"
open tl.me move
goal g1 "站到 1900" when="me = 1900"`,
};

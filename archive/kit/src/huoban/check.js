// 活板的教学检查（docs/talk-plan.md）：板能画出来还不够，要「这道题出得对」。纯函数，tests/huoban-check.test.js 守着。
// 学生看到之前，页面先把每一处能作答的地方查一遍：
//   答案算不出来               error  （页面让老师当场重写这一轮）
//   目标一上来就做到了 / 拨遍、拖遍、折遍都做不到   warn / error
//   when 那一行永远出不来      warn
//   空的答案已经写在板上       warn   （白问）
//   按常见错法做也得同样的答案  warn   （分不开对错两种想法；引擎的 variants）
//   一整块板学生没有能动手的地方 info
// error 让老师重写；warn、info 跟着下一轮的消息告诉老师（不多跑一轮，不拖慢）。
import { Runtime } from './runtime.js';
import { idents } from './lang.js';
import { text, same, f, Q } from './values.js';
import { variantAnswers } from './objects.js';

const MAX_COMBOS = 600; // 输入组合最多试这么多（拨的、拖的、折的一起）

/** 一个能动的输入有哪些取值：拨的整个范围、拖的一圈格点、句子的每种折法 */
function inputSpace(rt, name) {
  const cell = rt.cells.get(name);
  if (!cell) return null;
  if (cell.input?.type === 'scrub') {
    const { lo, hi, step } = cell.input;
    const out = [];
    for (let v = lo; v <= hi + 1e-9 && out.length < 200; v += step) out.push({ set: (r) => r.setInput(name, v), text: `${name} = ${v}` });
    return out;
  }
  if (cell.input?.type === 'drag') {
    const s = cell.input.snap || 0.5;
    const R = 4;
    const out = [];
    for (let x = -R; x <= R + 1e-9; x += s) for (let y = -R; y <= R + 1e-9; y += s) out.push({ set: (r) => r.setInput(name, [x, y]), text: `${name} = (${x}, ${y})` });
    return out;
  }
  let v;
  try { v = rt.get(name); } catch { return null; }
  if (v && v.kind === 'sentence') {
    const n = v.parts.filter((p) => p.fold).length;
    if (n > 8) return null;
    const out = [];
    for (let m = 0; m < 1 << n; m++) {
      out.push({
        set: (r) => { const s = r.get(name); s.folded.clear(); for (let i = 0; i < n; i++) if (m & (1 << i)) s.folded.add(i); r.fresh(); },
        text: `折起第 ${[...Array(n).keys()].filter((i) => m & (1 << i)).map((i) => i + 1).join('、') || '（不折）'} 段`,
      });
    }
    return out;
  }
  return null;
}

// 一个条件依赖哪些能动的输入（顺着 let 往上找）
function inputsOf(rt, ast) {
  const seen = new Set(), out = new Set();
  const walk = (names) => {
    for (const n of names) {
      if (seen.has(n)) continue;
      seen.add(n);
      const cell = rt.cells.get(n);
      if (!cell) continue;
      if (cell.input) { out.add(n); continue; }
      let v; try { v = rt.get(n); } catch { v = null; }
      if (v && v.kind === 'sentence') { out.add(n); continue; }
      if (cell.ast) walk(idents(cell.ast));
      if (cell.find) walk([...idents(cell.find.cond), ...idents(cell.find.dom)].filter((x) => x !== cell.find.v));
    }
  };
  walk(idents(ast));
  return [...out];
}

/** 把几个输入的取值组合起来一个个试：cond 成立的第一个组合，或 null。试的是一份拷贝，学生手上的不动 */
function search(src, inputs, cond, from) {
  const rt = new Runtime();
  rt.load(src);
  // 从学生现在的状态出发（没动的输入用初值）
  for (const [k, v] of from.inputs) rt.inputs.set(k, v);
  const spaces = inputs.map((n) => inputSpace(rt, n)).filter(Boolean);
  if (!spaces.length) return { tried: 0, hit: null };
  let total = spaces.reduce((m, s) => m * s.length, 1);
  // 组合太多：每个输入均匀抽一些
  const pick = (s, k) => (s.length <= k ? s : Array.from({ length: k }, (_, i) => s[Math.floor((i * s.length) / k)]));
  const per = Math.max(2, Math.floor(Math.pow(MAX_COMBOS, 1 / spaces.length)));
  const lists = total > MAX_COMBOS ? spaces.map((s) => pick(s, per)) : spaces;
  total = lists.reduce((m, s) => m * s.length, 1);
  for (let c = 0; c < total; c++) {
    let r = c;
    const chosen = lists.map((s) => { const x = s[r % s.length]; r = Math.floor(r / s.length); return x; });
    chosen.forEach((x) => x.set(rt));
    rt.fresh();
    let ok = false;
    try { ok = !!rt.eval(cond); } catch { ok = false; }
    if (ok) return { tried: c + 1, hit: chosen.map((x) => x.text).join('，') };
  }
  return { tried: total, hit: null };
}

/**
 * 查一整块板。rt：已经 load 好、带着学生输入的 Runtime。
 * 返回 [{ n, level: 'error' | 'warn' | 'info', code, msg }]，msg 是写给老师看的一句话（带行号，好改）。
 */
export function checkBoard(rt) {
  const out = [];
  const lines = rt.board.lines;
  const say = (n, level, code, msg) => out.push({ n, level, code, msg: `第 ${n} 行：${msg}` });
  rt.fresh();

  // 板上现在看得到的活的值（when 没成立的那一行不算）：key → [行号]
  const shown = new Map();
  const visible = (ln) => { if (ln.kind !== 'when') return true; try { return !!rt.eval(ln.cond); } catch { return false; } };
  for (const ln of lines) {
    if ((ln.kind === 'prose' || ln.kind === 'when') && visible(ln)) {
      for (const sg of ln.segs) if (sg.k === 'value') { const k = sg.src.replace(/\s+/g, ''); if (!shown.has(k)) shown.set(k, []); shown.get(k).push(ln.n); }
    }
  }

  let doable = 0;
  for (const ln of lines) {
    if (ln.kind === 'let' && ln.cell.input) doable++;
    if (ln.kind === 'draw') {
      for (const it of ln.items) { try { const v = rt.eval(it.ast); if (v && v.kind === 'sentence') doable++; } catch { /* 画的时候报 */ } }
    }
    if (ln.kind === 'goal') {
      doable++;
      let now = false;
      try { now = !!rt.eval(ln.cond); } catch (e) { say(ln.n, 'error', 'goal-error', `目标算不出来：${e.message}`); continue; }
      if (now) { say(ln.n, 'warn', 'goal-already', '目标一上来就已经做到了（学生不用动手）。换一个初值，或者改条件'); continue; }
      const ins = inputsOf(rt, ln.cond);
      if (!ins.length) { say(ln.n, 'error', 'goal-fixed', '目标不依赖任何学生能动的东西（拨、拖、折），永远做不到'); continue; }
      const r = search(rt.src, ins, ln.cond, rt);
      if (r.tried && !r.hit) say(ln.n, 'error', 'goal-unreachable', `学生把 ${ins.join('、')} 试遍了（${r.tried} 种）也做不到这个目标。改条件或改拨的范围`);
    }
    if (ln.kind === 'when') {
      let now = false;
      try { now = !!rt.eval(ln.cond); } catch (e) { say(ln.n, 'error', 'when-error', `when 的条件算不出来：${e.message}`); continue; }
      if (!now) {
        const ins = inputsOf(rt, ln.cond);
        const r = ins.length ? search(rt.src, ins, ln.cond, rt) : { tried: 0, hit: null };
        if (!r.hit) say(ln.n, 'warn', 'when-never', ins.length ? `这一行学生怎么动都出不来（试了 ${r.tried} 种）` : '这一行的条件不依赖学生能动的东西，永远出不来');
      }
    }
    if (ln.kind !== 'prose' && ln.kind !== 'when') continue;
    for (const sg of ln.segs) {
      if (sg.k === 'choice') { doable++; continue; }
      if (sg.k === 'value' && sg.bare && rt.cells.get(sg.bare)?.input) continue;
      if (sg.k !== 'blank') continue;
      doable++;
      let exp;
      try { exp = rt.eval(sg.ast); } catch (e) {
        if (ln.kind === 'when' && !visible(ln)) continue;
        say(ln.n, 'error', 'blank-error', `空 {${sg.src}?} 的答案算不出来：${e.message}`);
        continue;
      }
      if (exp === undefined || exp === null || (typeof exp === 'object' && exp.kind && !['alts'].includes(exp.kind))) {
        say(ln.n, 'error', 'blank-kind', `空 {${sg.src}?} 的答案是一个${exp?.kind === 'process' ? '过程' : exp?.kind === 'sentence' ? '句子' : '对象'}，学生没法写；问它的成员，比如 r.faults`);
        continue;
      }
      const k = sg.src.replace(/\s+/g, '');
      const at = shown.get(k) || [];
      if (at.length && visible(ln)) say(ln.n, 'warn', 'giveaway', `空 {${sg.src}?} 的答案在第 ${at.join('、')} 行已经写出来了（{${sg.src}}），等于白问`);
      // 常见错法：按错的想法做也得同样的答案，这一问分不开
      const pm = rt.processRef(sg.ast);
      if (pm) {
        const same0 = variantAnswers(pm.proc, pm.name, pm.idx).filter((v) => same(v.value, exp));
        if (same0.length) say(ln.n, 'warn', 'not-telling', `空 {${sg.src}?}：按「${same0.map((v) => v.label).join('」「')}」做也得 ${text(exp)}，分不开对错两种想法。换一组数（可以 find 一组让它们不一样）`);
      }
    }
  }
  // 有写错的行时先改错（写错的那一行可能就是作答的地方），不说「没有能动手的」
  if (!doable && !lines.some((l) => l.kind === 'error') && lines.length) out.push({ n: 0, level: 'info', code: 'no-action', msg: '这块板上学生没有能动手的地方（没有空、选择、拨、拖、折、目标）' });
  return out;
}

/** 给老师看的几行（下一轮的消息里带上，或者要它重写时附上） */
export function checkText(list) {
  return list.map((x) => `- ${x.level === 'error' ? '要改' : x.level === 'warn' ? '提醒' : '注意'}：${x.msg}`).join('\n');
}

export { Q, f };

// 函数图的写法怎么读（视觉交互第 1 批；纯函数，tests/graphspec.test.js）。画和交互在 graph.js。
//
//   x: -4 4                         横向窗口（y: 不写就按曲线取）
//   f(x) = x^3 - 3x                 定义函数：后面写 f(x)、f'(x)、f''(x)（fx/defs.js）
//   slider h 0.01 2 = 1             滑块
//   let a = 1 drag [on=f(x)]        可以拖的竖线；写了 on= 把手骑在这条曲线上
//   plot f(x) [for x 0 4]           曲线（间断点自己断开，fx/curve.js）
//   shade f(x) a b                  曲线和 x 轴之间涂色
//   area [S =] f(x), g(x) from a to b       两条曲线之间涂色（S 是面积）
//   riemann [S =] f(x) from a to b n=8 [left|right|mid]   黎曼和的矩形（S 是和）
//   tangent f(x) at a               切线（斜率页面求导）      secant f(x) at a, a + h   割线
//   dots a(n) for n 1 30 [join]     数列的点                  bars p(k) for k 0 10      柱子
//   point [x, y] [hollow]、vline、hline、segment、text、show
//   goal 左 = 右 [tol=]  /  goal 条件       学生拖到、调到算做到
//   pick "题目" [on f(x) | on x] at 值, …   学生在图上点出来，页面判
// 图里的式子一律弧度。
import { splitMods, splitTop } from './mods.js';
import { parseDef, makeDefs, addDef, compileWith, expandSrc } from './fx/defs.js';
import { evaluate } from './expr.js';
import { diffAst } from './fx/diff.js';

export const CMDS = ['let', 'slider', 'plot', 'shade', 'bars', 'point', 'vline', 'hline', 'segment', 'text', 'show', 'area', 'riemann', 'tangent', 'secant', 'dots', 'goal', 'pick'];
// 这几个修饰只有函数图有，不放进 mods.js 的公共表（那张表 scene、space、matrix 都在用）
const OWN_FLAGS = ['hollow', 'join', 'left', 'right', 'mid'];
const OWN_RE = new RegExp(`\\s+(${OWN_FLAGS.join('|')})$`, 'i');

// 行尾的修饰：公共的（color= label= dashed……）和自己的旗标可以混着写，先后不限
function mods(line) {
  let { body, mods: m } = splitMods(line);
  for (;;) {
    const f = OWN_RE.exec(body);
    if (!f) return { body, mods: m };
    m[f[1].toLowerCase()] = true;
    const more = splitMods(body.slice(0, f.index));
    body = more.body;
    m = { ...more.mods, ...m };
  }
}

// 前面的「名字 = 」（area S = …、riemann S = …）
function named(body) {
  const m = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.*)$/.exec(body);
  return m ? { name: m[1], rest: m[2] } : { name: undefined, rest: body };
}

export function parseGraph(src) {
  const fields = {};
  const cmds = [];
  const defs = makeDefs();
  const C = (s) => compileWith(s, defs);
  const num = (s) => (/^-?inf$/i.test(s) ? () => (s[0] === '-' ? -Infinity : Infinity) : C(s));
  let last = null;
  const re = new RegExp(`^(${CMDS.join('|')})\\s+(.*)$`, 'i');
  for (const raw of String(src).split('\n')) {
    const line = raw.replace(/\s+#\s.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const c = line.trim().match(re);
    if (c) { cmds.push({ ...parseCmd(c[1].toLowerCase(), c[2], { C, num, defs }), srcLine: line.trim() }); last = null; continue; }
    const def = parseDef(line);
    if (def) { addDef(defs, def); last = null; continue; }
    const f = line.match(/^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/);
    if (f) { last = f[1].toLowerCase(); fields[last] = f[2]; continue; }
    if (last) fields[last] += '\n' + line;
    else throw new Error(`看不懂这一行：${line.trim()}`);
  }
  for (const k in fields) fields[k] = fields[k].trim();
  const win = (s, d) => { const m = String(s || '').trim().split(/[\s,，]+/).map(Number); return m.length === 2 && m.every(Number.isFinite) && m[1] > m[0] ? m : d; };
  return { fields, cmds, defs, xr: win(fields.x, [-5, 5]), yr: fields.y ? win(fields.y, null) : null };
}

function parseCmd(kind, rest, { C, num, defs }) {
  if (kind === 'show') return { kind, text: rest.trim(), mods: {} };
  if (kind === 'text') {
    const m = rest.match(/^"([^"]*)"\s+at\s+(.*)$/) || rest.match(/^“([^”]*)”\s+at\s+(.*)$/);
    if (!m) throw new Error('text 的写法：text "文字" at [x, y]');
    const { body, mods: md } = mods(m[2]);
    return { kind, label: m[1], at: C(body), mods: md };
  }
  if (kind === 'pick') return parsePick(rest, { C });
  const { body, mods: md } = mods(rest);
  if (kind === 'let') {
    const m = body.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (!m) throw new Error('let 的写法：let 名字 = 表达式');
    return { kind, name: m[1], expr: C(m[2]), mods: md, ...(md.on ? { onF: C(md.on) } : {}) };
  }
  if (kind === 'slider') {
    const m = body.match(/^([A-Za-z_]\w*)\s+(\S+)\s+(\S+)(?:\s*=\s*(\S+))?$/);
    if (!m) throw new Error('slider 的写法：slider p 0 1 = 0.5');
    const min = Number(m[2]), max = Number(m[3]);
    return { kind, name: m[1], min, max, init: m[4] !== undefined ? Number(m[4]) : min, step: Number(md.step) || (max - min) / 100, mods: md };
  }
  if (kind === 'plot') {
    const m = body.match(/^(.*\S)\s+for\s+x\s+(\S+)\s+(\S+)$/);
    return m ? { kind, f: C(m[1]), lo: num(m[2]), hi: num(m[3]), mods: md } : { kind, f: C(body), mods: md };
  }
  if (kind === 'shade') {
    // shade f(x) a b：x 从 a 到 b，曲线和 x 轴之间涂色（a、b 可以写 -inf / inf）
    const m = body.match(/^(.*\S)\s+(\S+)\s+(\S+)$/);
    if (!m) throw new Error('shade 的写法：shade f(x) 下限 上限');
    return { kind, f: C(m[1]), a: num(m[2]), b: num(m[3]), mods: md };
  }
  if (kind === 'area') {
    const { name, rest: r } = named(body);
    const m = r.match(/^(.*\S)\s+from\s+(\S+)\s+to\s+(\S+)$/);
    const fs = m ? splitTop(m[1]) : [];
    if (!m || fs.length !== 2) throw new Error('area 的写法：area x, x^2 from 0 to 1（两条曲线之间；前面可以起名 area S = …）');
    return { kind, name, f: C(fs[0]), g: C(fs[1]), a: num(m[2]), b: num(m[3]), mods: md };
  }
  if (kind === 'riemann') {
    const { name, rest: r } = named(body);
    const m = r.match(/^(.*\S)\s+from\s+(\S+)\s+to\s+(\S+)$/);
    if (!m || md.n === undefined) throw new Error('riemann 的写法：riemann x^2 from 0 to 1 n=8（可加 left / right / mid；前面可以起名 riemann S = …）');
    return { kind, name, f: C(m[1]), a: num(m[2]), b: num(m[3]), n: C(String(md.n)), rule: md.mid ? 'mid' : md.right ? 'right' : 'left', mods: md };
  }
  if (kind === 'tangent') {
    const m = body.match(/^(.*\S)\s+at\s+(.+)$/);
    if (!m) throw new Error('tangent 的写法：tangent f(x) at a');
    let dAst;
    try { dAst = diffAst(expandSrc(m[1], defs), 'x', 1); } catch (e) { throw new Error(`tangent：${e.message}`); }
    return { kind, f: C(m[1]), df: (vars = {}) => evaluate(dAst, vars), at: C(m[2]), mods: md };
  }
  if (kind === 'secant') {
    const m = body.match(/^(.*\S)\s+at\s+(.+)$/);
    const ps = m ? splitTop(m[2]) : [];
    if (ps.length !== 2) throw new Error('secant 的写法：secant f(x) at a, a + h（过曲线上这两点的直线）');
    return { kind, f: C(m[1]), a: C(ps[0]), b: C(ps[1]), mods: md };
  }
  if (kind === 'bars' || kind === 'dots') {
    const [what, range] = body.split(/\s+for\s+/);
    const m = (range || '').trim().match(/^([A-Za-z_]\w*)\s+(\S+)\s+(\S+)$/);
    if (!m) throw new Error(kind === 'bars' ? 'bars 的写法：bars binompmf(k, 10, 0.3) for k 0 10' : 'dots 的写法：dots 1 + 1/n for n 1 30');
    return { kind, f: C(what), param: m[1], from: C(m[2]), to: C(m[3]), mods: md };
  }
  if (kind === 'vline' || kind === 'hline') return { kind, at: C(body), mods: md };
  if (kind === 'point') return { kind, at: C(body), mods: md };
  if (kind === 'segment') {
    const parts = body.split(/\s*,\s*(?=\[)/);
    if (parts.length !== 2) throw new Error('segment 的写法：segment [x1, y1], [x2, y2]');
    return { kind, a: C(parts[0]), b: C(parts[1]), mods: md };
  }
  if (kind === 'goal') {
    const parts = body.split(/(?<![<>=!])=(?!=)/);
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) return { kind, lhs: C(parts[0]), rhs: C(parts[1]), mods: md };
    if (parts.length === 1 && body.trim()) return { kind, cond: C(body), mods: md };
    throw new Error('goal 的写法：goal 表达式 = 目标，或者 goal 条件（如 goal f\'(a) = 0、goal a >= 2）');
  }
  throw new Error(`不认识的命令 ${kind}`);
}

// pick "题目" [on 式子 | on x] at 值, …
function parsePick(rest, { C }) {
  const { body, mods: md } = mods(rest);
  const m = body.match(/^(?:"([^"]*)"|“([^”]*)”)\s+(?:on\s+(.+?)\s+)?at\s+(.+)$/);
  if (!m) throw new Error('pick 的写法：pick "点出极值点" on f(x) at -1, 1（on x 是点在 x 轴上；不写 on 是随便点，目标写 [x, y]）');
  const on = m[3] === undefined ? 'free' : m[3].trim() === 'x' ? 'axis' : 'curve';
  const each = splitTop(m[4]).map((s) => C(s));
  // 目标：curve / axis 是 x 的值（一个式子回一串就摊开，如 roots(…)）；free 是 [x, y]
  const targets = (vars = {}) => {
    const out = [];
    for (const f of each) {
      const v = f(vars);
      if (on === 'free') {
        if (!Array.isArray(v) || v.length !== 2 || v.some((x) => typeof x !== 'number')) throw new Error('pick 不写 on 时，目标要写成 [x, y]');
        out.push(v);
      } else if (Array.isArray(v)) { for (const x of v) { if (typeof x !== 'number') throw new Error('pick 的目标要是数'); out.push(x); } } else if (typeof v === 'number') out.push(v);
      else throw new Error('pick 的目标要是数');
    }
    return out;
  };
  return { kind: 'pick', q: m[1] ?? m[2], on, ...(on === 'curve' ? { onF: C(m[3]) } : {}), targets, tol: Number(md.tol) || undefined, mods: md };
}

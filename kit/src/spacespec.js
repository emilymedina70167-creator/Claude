// 三维图的写法解析（纯函数，tests/spacespec.test.js；画在 space.js）。照 graphspec.js 的样子从 space.js 里拆出来。
//
//   let u = [1, 0, 1]
//   slider t 0 1 = 0.5
//   span u, v color=blue                 # 过原点的平面（两个向量线性相关时画成直线）
//   vector t*u + v color=yellow label=w
//   plane normal [0, 0, 1] at [0, 0, 1]  # 过某点、给定法向量的平面
//   box u, v, [0, 0, 1]                  # 平行六面体（体积 = |det|）
//   quadric [[2,0,0],[0,3,2],[0,2,3]] = 6     # 二次曲面 xᵀAx = 6 的线框
//   f(x, y) = x^2 - y^2                  # 函数定义（fx/defs.js）：后面能写 f(…)、f_x(…)、f_grad(…)
//   goal 左 = 右 / goal 条件              # 学生拖到、调到算做到（和 graph 一样）
//
// 角度还是弧度：老的三维图（线代）三角函数按角度——rot(…)、cos(60)。高数的图要弧度（曲面 z = sin x cos y 按角度画出来是平的）。
// 规矩：图里有微积分的东西（函数定义、CALC_CMDS 里的命令）就整张按弧度，别的照旧按角度；`angle: rad` / `angle: deg` 明着定。
import { splitMods, splitTop } from './mods.js';
import { parseDef, makeDefs, addDef, compileWith, expandSrc } from './fx/defs.js';
import { evaluate } from './expr.js';
import { diffAst } from './fx/diff.js';

export const SPACE_CMDS = ['let', 'slider', 'vector', 'point', 'segment', 'line', 'span', 'plane', 'box', 'grid', 'quadric', 'text', 'show', 'goal', 'pick',
  'meet', 'angle', 'foot', 'eigen', 'surface', 'curve', 'section', 'tangent', 'revolve', 'disk', 'shell', 'region', 'solid', 'column', 'slice', 'field', 'normals'];
// 写了这些命令的图按弧度（平面、直线、特征方向是线代的，不算）
export const CALC_CMDS = ['surface', 'curve', 'section', 'tangent', 'revolve', 'disk', 'shell', 'region', 'solid', 'column', 'slice', 'field', 'normals'];

export function parseSpace(src) {
  const lines = [];
  for (const raw of String(src).split('\n')) { const line = raw.replace(/\s+#\s.*$/, '').trimEnd(); if (line.trim()) lines.push(line); }
  const re = new RegExp(`^(${SPACE_CMDS.join('|')})\\s+(.*)$`, 'i');
  // 先过一遍定角度还是弧度：定义、命令都要按它编译
  let angle = null, calc = false;
  for (const line of lines) {
    const t = line.trim(), c = t.match(re);
    if (c) { if (CALC_CMDS.includes(c[1].toLowerCase())) calc = true; continue; }
    if (isDef(t)) { calc = true; continue; }
    const f = t.match(/^angle\s*[:：]\s*(.*)$/i);
    if (f) { angle = f[1].trim().toLowerCase(); if (angle !== 'rad' && angle !== 'deg') throw new Error('angle: 只能写 rad 或者 deg'); }
  }
  const rad = angle ? angle === 'rad' : calc;
  const defs = makeDefs();
  const C = (s) => compileWith(s, defs, rad ? undefined : { deg: true });
  const fields = {};
  const cmds = [];
  let last = null;
  for (const line of lines) {
    const t = line.trim(), c = t.match(re);
    if (c) { cmds.push({ ...parseCmd(c[1].toLowerCase(), c[2], { C, cmds, defs, rad }), srcLine: t }); last = null; continue; }
    const def = parseDef(t);
    if (def) { addDef(defs, def); last = null; continue; }
    const f = line.match(/^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/);
    if (f) { last = f[1].toLowerCase(); fields[last] = f[2]; continue; }
    if (last) fields[last] += '\n' + line;
    else throw new Error(`看不懂这一行：${t}`);
  }
  for (const k in fields) fields[k] = fields[k].trim();
  return { fields, cmds, defs, rad, notes: !angle && rad ? degreeNotes(lines, cmds) : [] };
}

// 整张按弧度的图里，滑块的范围像是角度（到 90、180、360），又写进了三角函数：多半是按角度想的。只提醒，不拦
const TRIG = /(?<![A-Za-z_])(?:sin|cos|tan|cot|sec|csc)\s*\(/g;
function degreeNotes(lines, cmds) {
  const inTrig = [];
  for (const line of lines) {
    for (const m of line.matchAll(TRIG)) {
      let depth = 1, i = m.index + m[0].length;
      const from = i;
      for (; i < line.length && depth; i++) { if (line[i] === '(') depth++; else if (line[i] === ')') depth--; }
      inTrig.push(line.slice(from, i - 1));
    }
  }
  const out = [];
  for (const c of cmds) {
    if (c.kind !== 'slider' || !(c.max >= 45) || c.max % 15 !== 0) continue;
    if (!inTrig.some((a) => new RegExp(`(?<![A-Za-z0-9_])${c.name}(?![A-Za-z0-9_])`).test(a))) continue;
    out.push(`这张图的三角函数按弧度算；滑块 ${c.name} 的范围 ${c.min} 到 ${c.max} 像是角度（范围写成 0 2pi，或者式子里写 ${c.name}*pi/180；整张按角度算写 angle: deg）`);
  }
  return out;
}

// 像不像一条函数定义（名字撞了页面自带的函数会抛：留到正式那一遍去抛）
function isDef(line) { try { return !!parseDef(line); } catch { return true; } }

// —— 小工具 ——
// 按最外层的空白切（括号里的空格不拆）
function words(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of String(s)) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
// 「名字 = 后面的」：后面的还得像一条内容（有等号、或者是 [ 开头的），不然 z = 2 会被当成起名叫 z
function named(body, ok = (r) => /(?<![<>=!])=(?!=)/.test(r) || r.startsWith('[')) {
  const m = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.*)$/.exec(body);
  return m && ok(m[2].trim()) ? { name: m[1], rest: m[2].trim() } : { name: undefined, rest: body };
}
// 左 = 右 → (左) - (右)
function eqToZero(src, what) {
  const parts = String(src).split(/(?<![<>=!])=(?!=)/);
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) throw new Error(what);
  return `(${parts[0].trim()}) - (${parts[1].trim()})`;
}
// for x a b, y c d → [{ name, lo, hi }]：下限是一个不带空格的式子，后面的都是上限（y 0 1 - x）
function forPairs(str, C, what) {
  return splitTop(str).map((part) => {
    const w = words(part);
    if (w.length < 3 || !/^[A-Za-z_]\w*$/.test(w[0])) throw new Error(what);
    return { name: w[0], lo: C(w[1]), hi: C(w.slice(2).join(' ')) };
  });
}
// 底：over D（前面起了名字的区域）/ for x a b, y c(x) d(x) / for r 内 外, t α β（极坐标）
function parseBase(over, forStr, C, cmds, what) {
  if (over) {
    if (!cmds.some((c) => c.kind === 'region' && c.name === over)) throw new Error(`over ${over}：没有叫 ${over} 的区域（前面先写 region ${over} = y from … to … for x … …）`);
    return { kind: 'region', of: over };
  }
  const ps = forPairs(forStr, C, what);
  if (ps.length !== 2) throw new Error(what);
  // 极坐标：一个叫 r、一个叫 t / theta，不论先写哪个（累次积分常先写 θ）。直角坐标只认 x、y——别的名字以前被静默当成 x、y 的矩形
  const r = ps.find((q) => q.name === 'r'), t = ps.find((q) => q.name === 't' || q.name === 'theta');
  if (r && t) return { kind: 'polar', lo: r.lo, hi: r.hi, a: t.lo, b: t.hi, param: t.name };
  const names = ps.map((q) => q.name).sort().join();
  if (names !== 'x,y') throw new Error(`for 后面的两个范围：直角坐标写 x、y（for x 0 1, y 0 1 - x），极坐标写 r、t（for r 0 2, t 0 2pi）；现在写的是 ${ps[0].name}、${ps[1].name}`);
  return { kind: 'xy', u: ps[0].name, v: ps[1].name, a: ps[0].lo, b: ps[0].hi, lo: ps[1].lo, hi: ps[1].hi };
}
const SURFACE_EG = 'surface 的写法：surface z = f(x, y)（可加 for x a b, y c d / for r 0 2, t 0 2pi / over D）、surface [x(u, v), y(u, v), z(u, v)] for u a b, v c d、surface x^2 + y^2 - z^2 = 1；前面可以起名 surface S = …';
const SOLID_EG = 'solid 的写法：solid T = z from 下 to 上 over D（或 for x a b, y c d）、solid T = rho from 0 to 2 for phi 0 pi/4, t 0 2pi（球面坐标）';

function parseCmd(kind, rest, { C, cmds = [], defs, rad }) {
  const need = (k, name, word) => { const c = cmds.find((x) => [].concat(k).includes(x.kind) && x.name === name); if (!c) throw new Error(`${kind}：没有叫 ${name} 的${word}（前面先起名字）`); return c; };
  // 显式曲面 z = f(x, y) [for … | over D]
  const explicitSurface = (name, r) => {
    const sm = splitMods(rest).mods;
    const m = r.match(/^z\s*=\s*(.+?)(?:\s+over\s+([A-Za-z_]\w*)|\s+for\s+(.+))?$/);
    if (!m) throw new Error(SURFACE_EG);
    return { kind, name, form: 'z', f: C(m[1]), base: m[2] || m[3] ? parseBase(m[2], m[3], C, cmds, SURFACE_EG) : null, mods: sm };
  };
  if (kind === 'show') {
    // 读数末尾的 after / before：做到以后才显示（或者做到以前显示）；别的修饰读数没有
    const m = /^(.*\S)\s+(after|before)$/i.exec(rest.trim());
    return m ? { kind, text: m[1], mods: { [m[2].toLowerCase()]: true } } : { kind, text: rest.trim(), mods: {} };
  }
  if (kind === 'text') {
    const m = rest.match(/^"([^"]*)"\s+at\s+(.*)$/) || rest.match(/^“([^”]*)”\s+at\s+(.*)$/);
    if (!m) throw new Error('text 的写法：text "文字" at [x, y, z]');
    const { body, mods } = splitMods(m[2]);
    return { kind, label: m[1], at: C(body), mods };
  }
  if (kind === 'pick') {
    const { body, mods } = splitMods(rest);
    if (mods.after || mods.before) throw new Error('pick 不能写 after / before（它自己就是要学生做到的事）');
    const m = body.match(/^(?:"([^"]*)"|“([^”]*)”)\s+(?:on\s+([A-Za-z_]\w*)\s+)?at\s+(.+)$/);
    if (!m) throw new Error('pick 的写法：pick "点出驻点" at [1, 0], [-1, 0]（学生在地面上点，目标写 [x, y]；on S 是点在曲面 S 上）');
    if (m[3]) { const S = cmds.find((x) => x.kind === 'surface' && x.name === m[3]); if (!S) throw new Error(`pick：没有叫 ${m[3]} 的曲面（前面先起名字）`); if (S.form !== 'z') throw new Error('pick … on S：S 要是 z = f(x, y) 的曲面'); }
    const each = splitTop(m[4]).map((x) => C(x));
    const targets = (vars = {}) => each.map((e) => { const p = e(vars); if (!Array.isArray(p) || p.length !== 2 || !p.every((x) => typeof x === 'number')) throw new Error('pick 的目标要写成 [x, y]（地面上的点）'); return p; });
    // 写成一个数的当场报；用到变量（滑块、能拖的点）的这里算不出来，留到画的时候
    try { targets({ __probe: 1 }); } catch (e) { if (/^pick 的目标/.test(e.message)) throw e; }
    return { kind, q: m[1] ?? m[2], on: m[3], targets, tol: mods.tol !== undefined ? Number(mods.tol) : undefined, mods };
  }
  let { body, mods } = splitMods(rest);
  if (kind === 'goal') {
    if (mods.after || mods.before) throw new Error('goal 不能写 after / before（它自己就是要学生做到的事）');
    const parts = body.split(/(?<![<>=!])=(?!=)/);
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) return { kind, lhs: C(parts[0]), rhs: C(parts[1]), mods };
    if (parts.length === 1 && body.trim()) return { kind, cond: C(body), mods };
    throw new Error('goal 的写法：goal 表达式 = 目标，或者 goal 条件（如 goal t = 1、goal dot(u, v) > 0）');
  }
  if (kind === 'let') {
    const m = body.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (!m) throw new Error('let 的写法：let 名字 = 表达式');
    return { kind, name: m[1], expr: C(m[2]), mods };
  }
  if (kind === 'slider') {
    const m = body.match(/^([A-Za-z_]\w*)\s+(\S+)\s+(\S+)(?:\s*=\s*(\S+))?$/);
    if (!m) throw new Error('slider 的写法：slider t 0 1 = 0');
    const min = Number(m[2]), max = Number(m[3]);
    return { kind, name: m[1], min, max, init: m[4] !== undefined ? Number(m[4]) : min, step: Number(mods.step) || (max - min) / 100, mods };
  }
  if (kind === 'vector') {
    const [what, from] = body.split(/\s+from\s+/);
    return { kind, expr: C(what), from: from ? C(from) : null, mods };
  }
  if (kind === 'line') {
    const { name, rest: r } = named(body);
    const [p, d] = r.split(/\s+dir\s+/);
    if (!d) throw new Error('line 的写法：line 点 dir 方向（前面可以起名 line l1 = 点 dir 方向）');
    return { kind, name, p: C(p), d: C(d), mods };
  }
  if (kind === 'plane') {
    const m = body.match(/^normal\s+(.+?)(?:\s+at\s+(.+))?$/);
    if (m) return { kind, n: C(m[1]), at: m[2] ? C(m[2]) : null, mods };
    // 写方程：plane 2x + y - z = 3；前面可以起名 plane p1 = …
    const { name, rest: r } = named(body, (x) => /(?<![<>=!])=(?!=)/.test(x));
    const what = 'plane 的写法：plane 2x + y - z = 3（前面可以起名 plane p1 = …），或者 plane normal [a, b, c] at [x, y, z]（at 可省略，默认过原点）';
    return { kind, name, eq: C(eqToZero(r, what)), mods };
  }
  if (kind === 'meet' || kind === 'angle') {
    const names = splitTop(body);
    if (kind === 'meet') {
      if (names.length < 2 || names.length > 3) throw new Error('meet 的写法：meet p1, p2（两个平面的交线）或 meet p1, p2, p3（三个平面），都是前面起了名字的平面');
      names.forEach((n) => need('plane', n, '平面'));
    } else {
      if (names.length !== 2) throw new Error('angle 的写法：angle p1, p2（两个起了名字的平面 / 直线的夹角）');
      names.forEach((n) => need(['plane', 'line'], n, '平面或直线'));
    }
    return { kind, names, mods };
  }
  if (kind === 'foot') {
    const m = body.match(/^(.*\S)\s+on\s+([A-Za-z_]\w*)$/);
    if (!m) throw new Error('foot 的写法：foot [1, 2, 3] on p1（点到起了名字的平面 / 直线的垂足）');
    need(['plane', 'line'], m[2], '平面或直线');
    return { kind, pt: C(m[1]), on: m[2], mods };
  }
  if (kind === 'eigen') return { kind, A: C(body), mods };
  if (kind === 'surface') {
    if (/^z\s*=(?!=)/.test(body)) return explicitSurface(undefined, body);
    const { name, rest: r } = named(body);
    if (/^z\s*=(?!=)/.test(r)) return explicitSurface(name, r);
    if (r.startsWith('[')) {
      const m = r.match(/^\[(.*)\]\s+for\s+(.+)$/);
      if (!m) throw new Error(SURFACE_EG);
      const comps = splitTop(m[1]), ps = forPairs(m[2], C, SURFACE_EG);
      if (comps.length !== 3) throw new Error('surface 的参数曲面要三个分量：surface [x(u, v), y(u, v), z(u, v)] for u a b, v c d');
      if (ps.length !== 2) throw new Error(SURFACE_EG);
      return { kind, name, form: 'param', p: C(`[${m[1]}]`), params: ps.map((q) => q.name), ranges: ps.map((q) => [q.lo, q.hi]), mods };
    }
    return { kind, name, form: 'eq', F: C(eqToZero(r, SURFACE_EG)), mods };
  }
  if (kind === 'curve') {
    const { name, rest: r } = named(body);
    const m = r.match(/^(\[.*\])\s+for\s+([A-Za-z_]\w*)\s+(.+)$/);
    const w = m ? words(m[3]) : [];
    if (w.length !== 2) throw new Error('curve 的写法：curve [cos(t), sin(t), t/3] for t 0 4pi（前面可以起名 curve C = …）');
    return { kind, name, p: C(m[1]), param: m[2], from: C(w[0]), to: C(w[1]), mods };
  }
  if (kind === 'section') {
    const m = body.match(/^(x|y|z)\s*=\s*(.+?)\s+of\s+([A-Za-z_]\w*)$/);
    if (!m) throw new Error('section 的写法：section x = a of S（曲面 S 被平面 x = a 截出来的曲线；也可以是 y = b、z = c）');
    need('surface', m[3], '曲面');
    return { kind, axis: m[1], at: C(m[2]), of: m[3], mods };
  }
  if (kind === 'tangent') {
    const pl = /\s+plane$/i.test(body);
    if (pl) { body = body.replace(/\s+plane$/i, ''); mods = { ...mods, plane: true }; }
    const m = body.match(/^([A-Za-z_]\w*)\s+at\s+(.+)$/);
    if (!m) throw new Error('tangent 的写法：tangent S at [a, b]（曲面 S 在这一点的切平面和法线）、tangent C at t0（曲线 C 的切线；末尾加 plane 画法平面）');
    need(['surface', 'curve'], m[1], '曲面或曲线');
    return { kind, of: m[1], at: C(m[2]), mods };
  }
  if (kind === 'revolve') {
    const { name, rest: r } = named(body, () => true);
    const m = r.match(/^(.*\S)\s+for\s+x\s+(.+)\s+about\s+(\S+)$/);
    const w = m ? words(m[2]) : [];
    if (w.length !== 2) throw new Error('revolve 的写法：revolve sqrt(x) for x 0 4 about x（y = f(x) 绕 x 轴转；about y 绕 y 轴；前面可以起名 revolve V = …，V 是体积）');
    if (m[3] !== 'x' && m[3] !== 'y') throw new Error('revolve：about 后面是 x 或者 y（绕哪根轴转）');
    // area=S：侧面积 2π∫|f|√(1 + f′²)（只算绕 x 轴的；f′ 页面求）
    let df = null;
    if (mods.area !== undefined) {
      if (m[3] !== 'x') throw new Error('revolve … area=：侧面积只算绕 x 轴的');
      let d1; try { d1 = diffAst(expandSrc(m[1], defs), 'x', 1); } catch (e) { throw new Error(`revolve：${e.message}`); }
      df = (vars = {}) => evaluate(d1, vars, rad ? undefined : { deg: true });
    }
    return { kind, name, f: C(m[1]), df, areaName: mods.area, a: C(w[0]), b: C(w[1]), axis: m[3], upto: mods.upto !== undefined ? C(String(mods.upto)) : null, mods };
  }
  if (kind === 'disk' || kind === 'shell') {
    const m = body.match(/^([A-Za-z_]\w*)\s+at\s+(.+)$/);
    if (!m) throw new Error(`${kind} 的写法：${kind} V at x0（V 是前面起了名字的旋转体）`);
    need('revolve', m[1], '旋转体');
    return { kind, of: m[1], at: C(m[2]), mods };
  }
  if (kind === 'region') {
    const hide = /\s+hide$/i.test(body);
    if (hide) { body = body.replace(/\s+hide$/i, ''); mods = { ...mods, hide: true }; }
    const { name, rest: r } = named(body, () => true);
    const t = r.match(/^(y|x|r)\s+from\s+(.+?)\s+to\s+(.+?)\s+for\s+([A-Za-z_]\w*)\s+(.+)$/);
    const w = t ? words(t[5]) : [];
    if (w.length !== 2) throw new Error('region 的写法（地面上的区域）：region D = y from x^2 to x for x 0 1（X 型）、region D = x from … to … for y c d（Y 型）、region D = r from 0 to 2 for t 0 2pi（极坐标）');
    return { kind, name, shape: t[1], lo: C(t[2]), hi: C(t[3]), param: t[4], a: C(w[0]), b: C(w[1]), mods };
  }
  if (kind === 'solid') {
    const { name, rest: r } = named(body, () => true);
    const m = r.match(/^(z|rho)\s+from\s+(.+?)\s+to\s+(.+?)\s+(?:over\s+([A-Za-z_]\w*)|for\s+(.+))$/);
    if (!m) throw new Error(SOLID_EG);
    if (m[1] === 'rho') {
      const ps = m[5] ? forPairs(m[5], C, SOLID_EG) : [];
      const phi = ps.find((q) => q.name === 'phi'), th = ps.find((q) => q !== phi);
      if (ps.length !== 2 || !phi) throw new Error(SOLID_EG);
      return { kind, name, form: 'sph', lo: C(m[2]), hi: C(m[3]), phi: [phi.lo, phi.hi], t: [th.lo, th.hi], tName: th.name, mods };
    }
    return { kind, name, form: 'z', lo: C(m[2]), hi: C(m[3]), base: parseBase(m[4], m[5], C, cmds, SOLID_EG), mods };
  }
  if (kind === 'column' || kind === 'slice') {
    const m = body.match(/^([A-Za-z_]\w*)\s+at\s+(.+)$/);
    if (!m) throw new Error(kind === 'column' ? 'column 的写法：column T at P lo=z1 hi=z2（区域 T 里过地面上的点 P 竖着的一根）' : 'slice 的写法：slice T at z0 area=A（平面 z = z0 截区域 T 的那一块）');
    const of = need('solid', m[1], '区域（solid）');
    if (of.form === 'sph') throw new Error(`${kind}：球面坐标的区域没有${kind === 'column' ? '竖着的一根' : '水平的截面'}（写成 z from … to … 的才有）`);
    return kind === 'column' ? { kind, of: m[1], at: C(m[2]), loName: mods.lo, hiName: mods.hi, mods } : { kind, of: m[1], at: C(m[2]), areaName: mods.area, mods };
  }
  if (kind === 'field') {
    const comps = /^\[.*\]$/.test(body) ? splitTop(body.slice(1, -1)) : [];
    if (comps.length !== 3) throw new Error('field 的写法：field [P, Q, R]（空间向量场的三个分量，用 x、y、z 写）');
    return { kind, P: C(comps[0]), Q: C(comps[1]), R: C(comps[2]), mods };
  }
  if (kind === 'normals') {
    if (!/^[A-Za-z_]\w*$/.test(body)) throw new Error('normals 的写法：normals S n=5（起了名字的曲面上的法向量）');
    need('surface', body, '曲面');
    return { kind, of: body, mods };
  }
  if (kind === 'quadric') {
    // quadric A = c（不写 = c 就是 = 1）
    const m = body.match(/^(.+?)(?:\s*=\s*([^=\]]+))?$/);
    return { kind, A: C(m[1]), c: m[2] !== undefined ? C(m[2]) : () => 1, mods };
  }
  return { kind, exprs: splitTop(body).map(C), mods };
}

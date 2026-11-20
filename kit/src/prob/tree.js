// 概率树的计算（概率第 4 批）。纯函数，不碰 DOM，全是精确的分数。
// 两种写法：
//   「A1 0.5: B 0.02」一行一个原因：先验 P(Aᵢ)，冒号后面是结果和 P(B | Aᵢ)（form: 'bayes'，全概率、贝叶斯用）
//   缩进写的多层树，一行「名字 概率」（form: 'levels'，不放回地摸几次这类）
import { Q0, Q1, qInt, qSum, readQ } from './num.js';

const HOW = '概率树一行一个原因：「A1 0.5: B 0.02」（先验，冒号后面是结果和条件概率）；多层的树用缩进，一行「名字 概率」';
const prob = (s, line) => {
  const v = readQ(s);
  if (!v) throw new Error(`「${line.trim()}」：概率要是一个数（0.2、1/5、20%）`);
  return v;
};

/** 读概率树。写法不对抛出（说怎么写）；数对不对（和是不是 1）不在这里管，见 checkTree */
export function parseTree(src) {
  const lines = String(src ?? '').split('\n').map((l) => l.replace(/\t/g, '  ').replace(/#.*$/, '')).filter((l) => l.trim());
  if (!lines.length) throw new Error(`概率树是空的。${HOW}`);
  if (lines.some((l) => /[:：]/.test(l))) {
    const causes = [], cond = [];
    let effect = null;
    for (const line of lines) {
      const m = /^\s*(\S+)\s+(\S+)\s*[:：]\s*(\S+)\s+(\S+)\s*$/.exec(line);
      if (!m) throw new Error(`「${line.trim()}」读不懂。${HOW}`);
      if (effect != null && m[3] !== effect) throw new Error(`「${line.trim()}」：冒号后面要是同一个结果（前面写的是 ${effect}）`);
      effect = m[3];
      causes.push({ name: m[1], p: prob(m[2], line) });
      cond.push(prob(m[4], line));
    }
    return bayes(causes, effect, cond);
  }
  // 缩进的多层树：缩进比上一行多就是它的孩子
  const root = { name: '', children: [] };
  const stack = [{ indent: -1, node: root }];
  let depth = 0;
  for (const line of lines) {
    const m = /^(\s*)(\S+)\s+(\S+)\s*$/.exec(line);
    if (!m) throw new Error(`「${line.trim()}」读不懂。${HOW}`);
    const indent = m[1].length;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const top = stack[stack.length - 1];
    // 和兄弟对不齐（比父亲深、又和已有的孩子不一样深）
    const sib = top.node.children.length ? top.node.childIndent : indent;
    if (sib !== indent || (stack.length === 1 && indent !== 0)) throw new Error(`「${line.trim()}」的缩进对不上：同一层的要对齐，第一层顶格写`);
    top.node.childIndent = indent;
    const node = { name: m[2], p: prob(m[3], line), children: [] };
    top.node.children.push(node);
    stack.push({ indent, node });
    depth = Math.max(depth, stack.length - 1);
  }
  return { form: 'levels', depth, children: root.children };
}

function bayes(causes, effect, cond) {
  return {
    form: 'bayes', depth: 2, causes, effect, cond,
    children: causes.map((c, i) => ({
      name: c.name, p: c.p,
      children: [{ name: effect, p: cond[i], children: [] }, { name: effect, not: true, p: Q1.sub(cond[i]), children: [] }],
    })),
  };
}

const inUnit = (p) => p.cmp(Q0) >= 0 && p.cmp(Q1) <= 0;
/** 数对不对：回一组给写的人看的话（空的就是没问题） */
export function checkTree(t) {
  const out = [];
  const walk = (kids, where) => {
    if (!kids.length) return;
    if (kids.length < 2) out.push(`${where}要至少两支（现在只有 ${kids[0].name}）`);
    const names = kids.filter((k) => !k.not).map((k) => k.name);
    if (new Set(names).size < names.length) out.push(`${where}有两支名字重了`);
    for (const k of kids) if (!inUnit(k.p)) out.push(`${k.name} 的概率 ${k.p} 不在 0 到 1 之间`);
    const sum = qSum(kids.map((k) => k.p));
    if (sum.cmp(Q1) !== 0) out.push(`${where}几支的概率加起来是 ${sum}，不是 1`);
    for (const k of kids) walk(k.children, `${k.name} 下面`);
  };
  if (t.form === 'bayes') {
    if (t.causes.length < 2) out.push(`原因要至少两支（现在只有 ${t.causes[0].name}）`);
    if (new Set(t.causes.map((c) => c.name)).size < t.causes.length) out.push('有两个原因名字重了');
    for (const c of t.causes) if (!inUnit(c.p)) out.push(`P(${c.name}) = ${c.p} 不在 0 到 1 之间`);
    t.cond.forEach((p, i) => { if (!inUnit(p)) out.push(`P(${t.effect} | ${t.causes[i].name}) = ${p} 不在 0 到 1 之间`); });
    const sum = qSum(t.causes.map((c) => c.p));
    if (sum.cmp(Q1) !== 0) out.push(`几个原因的概率加起来是 ${sum}，不是 1`);
  } else walk(t.children, '第一层');
  return out;
}

/** 全概率和贝叶斯（form: 'bayes'）：joint P(AᵢB)、total P(B)、post P(Aᵢ | B)；带 Not 的是 B 不发生那一边。分母是 0 的后验是 null */
export function treeNumbers(t) {
  if (t.form !== 'bayes') throw new Error('全概率、贝叶斯要「A1 0.5: B 0.02」这种写法的树');
  const joint = t.causes.map((c, i) => c.p.mul(t.cond[i]));
  const jointNot = t.causes.map((c, i) => c.p.mul(Q1.sub(t.cond[i])));
  const total = qSum(joint), totalNot = qSum(jointNot);
  return {
    joint, jointNot, total, totalNot,
    post: total.zero ? null : joint.map((x) => x.div(total)),
    postNot: totalNot.zero ? null : jointNot.map((x) => x.div(totalNot)),
  };
}

/** 每条从根到叶子的路：{ path: 名字, nots: 哪几步是「不发生」, p: 一路乘下来 } */
export function leaves(t) {
  const out = [];
  const walk = (kids, path, nots, p) => {
    for (const k of kids) {
      const q = p.mul(k.p), pa = [...path, k.name], no = [...nots, !!k.not];
      if (k.children.length) walk(k.children, pa, no, q); else out.push({ path: pa, nots: no, p: q });
    }
  };
  walk(t.children, [], [], Q1);
  return out;
}
/** 第 level 层（从 0 数）走到叫 name 的结点的概率（几条路加起来） */
export function levelProb(t, level, name) {
  let sum = Q0;
  const walk = (kids, d, p) => {
    for (const k of kids) {
      const q = p.mul(k.p);
      if (d === level) { if (k.name === name && !k.not) sum = sum.add(q); } else walk(k.children, d + 1, q);
    }
  };
  walk(t.children, 0, Q1);
  return sum;
}

// 拖出来的数取到 1/100（分数还是精确的，树上的数好读）
const SNAP = 100;
const snap = (x) => qInt(Math.round(Math.min(1, Math.max(0, Number(x) || 0)) * SNAP)).div(qInt(SNAP));
const clampQ = (x, lo, hi) => (x.cmp(lo) < 0 ? lo : x.cmp(hi) > 0 ? hi : x);

/** 面积图上第 i 条竖的分界（Aᵢ 和 Aᵢ₊₁ 之间）拖到横坐标 x：只动挨着的两块，和不变。回新的树 */
export function moveBoundary(t, i, x) {
  const ps = t.causes.map((c) => c.p);
  const before = qSum(ps.slice(0, i)), after = qSum(ps.slice(0, i + 2));
  const at = clampQ(snap(x), before, after);
  const next = ps.slice();
  next[i] = at.sub(before); next[i + 1] = after.sub(at);
  return bayes(t.causes.map((c, k) => ({ name: c.name, p: next[k] })), t.effect, t.cond);
}
/** 第 i 列里 P(B | Aᵢ) 改成 v */
export function setCond(t, i, v) {
  const cond = t.cond.slice();
  cond[i] = snap(v);
  return bayes(t.causes, t.effect, cond);
}

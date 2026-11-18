// 式子的规则（接口见 rules.js）：只给照代数写的式子（tex … alg=on，tex.alg.js）。纯函数，有测试（tests/stage-tex-alg.test.js）。
//
// 页面不判学生「做得好不好」（right 永远是 null，下一步怎么化是老师的事），只判这个世界做不做得到：
//   - 手势表：按住一项拖（open e move：拖到两项之间换顺序、拖到另一项上合并同类项、拖一个因子到同一项的因子之间换先后）、
//     点一项展开括号（open e expand）；
//   - 做不做得到：变了以后和原来数学上相等才做（非交换多项式，ncalg.js）——矩阵的因子换先后、AB 和 BA 合并都弹回去、说为什么，
//     含逆、转置的判不了，照实说、弹回去；
//   - 事实：这一下以后式子是什么；
//   - 判断式：e expanded / merged / same=… / equals=…（挑战用）。
import { reorder, merge, expand, judge, swapWhy, locate, algShown as algText, isExpanded, isMerged, sameForm, equalsTo } from './tex.alg.js';

const shownItem = (it) => `${it.sign < 0 ? '−' : ''}${it.factors.map((f) => f.text).join('')}`;
const factorOf = (o, key) => o.alg?.items.some((it) => it.factors.length > 1 && it.factors.some((f) => f.key === key));

/** 一个动作 → 学生那一行镜头指令 */
export function actSrc(o, act) {
  if (act.type === 'reorder') return `reorder ${o.id} ${act.key} ${act.before ?? 'end'}`;
  if (act.type === 'merge') return `merge ${o.id} ${act.a} ${act.b}`;
  if (act.type === 'expand') return `expand ${o.id} ${act.key}`;
  throw new Error(`式子没有「${act.type}」这个动作`);
}
const made = (o, act) => ({ act, src: actSrc(o, act) });

// 按住一项拖（open e move）。落点是画法交的：另一项（部件）、或者空隙 { gap: { level: 'sum' | 'prod', item（prod：哪一项）, before（空隙后面那一项 / 因子的名字；最后是 null） } }
function moveAct(o, { from, to } = {}) {
  if (!o.alg) return { error: '这个式子不是照代数写的（alg=on），拖不了' };
  const at = locate(o.alg, from?.key);
  if (!at) return { error: '按住一项再拖' };
  const g = to?.gap;
  if (g) {
    if (g.level === 'prod') {
      if (g.item !== at.item.key || !factorOf(o, from.key)) return { error: '因子只能在它自己那一项里换先后' };
      const act = { type: 'reorder', key: from.key, before: g.before ?? null, level: 'prod' };
      const r = reorder(o.alg, act.key, act.before, { level: 'prod' });
      return r.error ? { error: r.error, quiet: !!r.quiet } : made(o, act);
    }
    const act = { type: 'reorder', key: at.item.key, before: g.before ?? null, level: 'sum' };
    const r = reorder(o.alg, act.key, act.before);
    return r.error ? { error: r.error, quiet: !!r.quiet } : made(o, act);
  }
  if (to?.key != null) {
    const B = locate(o.alg, to.key);
    if (!B) return { error: '拖到另一项上（合并两项）' };
    if (B.i === at.i) {
      // 同一项里拖一个因子到另一个因子上：挪到它那里（两个因子就是换先后）
      const fs = at.item.factors.map((f) => f.key);
      const a = fs.indexOf(from.key), b = fs.indexOf(to.key);
      if (a < 0 || b < 0 || a === b) return { error: '拖到另一项上（合并两项）', quiet: true };
      const act = { type: 'reorder', key: from.key, before: a < b ? fs[b + 1] ?? null : fs[b], level: 'prod' };
      return made(o, act);
    }
    return made(o, { type: 'merge', a: B.item.key, b: at.item.key });
  }
  return { error: '拖到两项之间（换顺序），或拖到另一项上（合并同类项）' };
}
// 点一项展开括号（open e expand）
function expandAct(o, { from } = {}) {
  if (!o.alg) return { error: '这个式子不是照代数写的（alg=on），展开不了' };
  const at = locate(o.alg, from?.key);
  if (!at) return { error: '点一项展开括号' };
  return made(o, { type: 'expand', key: at.item.key });
}

const gestures = {
  move: { gesture: 'drop-at', from: 'term', to: ['term', 'gap'], makes: ['reorder', 'merge'], toAct: moveAct, brief: '按住一项拖：放到两项之间换顺序，放到另一项上合并同类项', text: '按住一项拖：放到两项之间换顺序，放到另一项上合并同类项；一个因子拖到同一项的因子之间换先后' },
  expand: { gesture: 'tap', on: 'term', makes: ['expand'], toAct: expandAct, brief: '点一项展开括号', text: '点一项，展开它的括号' },
};

/** 一行镜头指令 → check 认的动作。只认学生从 open e move / expand 做的那一下（老师自己写的 reorder / merge / expand 照演，不过裁判） */
function actOf(o, c, h, { by = null, open = null } = {}) {
  if (by !== 'student' || (open !== 'move' && open !== 'expand') || !o.alg) return null;
  const w = h.words;
  if (c.cmd === 'reorder' && w[1]) return { type: 'reorder', key: w[1], before: w[2] == null || w[2] === 'end' ? null : w[2], level: factorOf(o, w[1]) ? 'prod' : 'sum' };
  if (c.cmd === 'merge' && w[1] && w[2]) return { type: 'merge', a: w[1], b: w[2] };
  if (c.cmd === 'expand' && w[1]) return { type: 'expand', key: w[1] };
  return null;
}

/** 这一下做不做得到（right 永远是 null：页面不判学生化得好不好）；why 写这一下做了什么、为什么没让做 */
// 没让做的原因（外部主讲的 @e.miss why=… 按它挑）：不交换、没有括号、不是同类项、还有括号没展开、判不了、不相等
export function reasonOf(why = '') {
  const w = String(why);
  if (/判不了/.test(w)) return 'unknown';
  if (/不交换/.test(w)) return 'noncommute';
  if (/没有括号可展开/.test(w)) return 'noparen';
  if (/括号没展开/.test(w)) return 'unexpanded';
  if (/不是同类项/.test(w)) return 'notlike';
  return 'unequal';
}
function check(o, act, scene = null) {
  const no = (why) => ({ legal: false, right: null, misread: null, why, next: null, reason: reasonOf(why) });
  const ok = (why) => ({ legal: true, right: null, misread: null, why, next: null });
  if (!o.alg) return ok(null);
  if (act.type === 'reorder') {
    const r = reorder(o.alg, act.key, act.before, { level: act.level });
    if (r.error) return no(r.error);
    const j = judge(o.alg, r.alg, { what: '换了先后' });
    if (!j.legal) return no(j.unknown ? j.why : act.level === 'prod' ? swapWhy(o.alg, act.key, r.alg) : j.why);
    const it = locate(o.alg, act.key)?.item;
    return ok(act.level === 'prod' ? `${shownItem(it)} 里的因子换了先后，现在是 ${algText(r.alg)}` : `${shownItem(it)} 挪了位置，现在是 ${algText(r.alg)}（加法交换，和原来相等）`);
  }
  if (act.type === 'merge') {
    const r = merge(o.alg, act.a, act.b);
    if (r.error) return no(r.error);
    const j = judge(o.alg, r.alg, { what: '合并' });
    if (!j.legal) return no(j.why);
    return ok(`${shownItem(locate(o.alg, act.b).item)} 并进 ${shownItem(locate(o.alg, act.a).item)}，合成 ${r.text}；现在是 ${algText(r.alg)}`);
  }
  if (act.type === 'expand') {
    const r = expand(o.alg, act.key);
    // 展开完了还在点（dr-ext-live-fixes 3：学生连点 13 下，一次都没发现能按住拖）：开了 move 时告诉学生能按住拖去合并
    const canMove = !!scene && [...(scene.opens?.values?.() || [])].some((e) => e.obj === o.id && e.action === 'move');
    if (r.error) return no(r.error === '这一项没有括号可展开' && canMove ? '这一项没有括号可展开；要合并就按住这一项拖到另一项上' : r.error);
    const j = judge(o.alg, r.alg, { what: '展开' });
    if (!j.legal) return no(j.why);
    return ok(`${shownItem(locate(o.alg, act.key).item)} 展开成 ${r.count} 项；现在是 ${algText(r.alg)}`);
  }
  return ok(null);
}

/** 学生这一下以后写给老师的事实：式子现在是什么、都展开了没有、还有没有同类项 */
function facts(before, after) {
  if (!after?.alg) return [];
  const out = [`${after.id} 现在是 ${algText(after.alg)}`];
  if (isExpanded(after.alg) && !isExpanded(before.alg)) out.push('括号都展开了');
  if (isMerged(after.alg) && !isMerged(before.alg)) out.push('同类项都合并了');
  return out;
}

const need = (o) => { if (!o.alg) throw new Error(`${o.id} 不是照代数写的式子（tex ${o.id} = "…" alg=on），页面判不了`); };
const target = (args) => (args || []).join('').trim();
const predicates = {
  expanded: (o) => { need(o); return isExpanded(o.alg); },
  merged: (o) => { need(o); return isMerged(o.alg); },
  // same=A^2+AB+BA+B^2：一项一项、照先后和它一样（2*A*B 和 2AB 算一样）；写错了的式子当场报
  same: (o, args) => { need(o); const t = target(args); if (!t) throw new Error(`要写成 ${o.id} same=A^2+AB+BA+B^2`); const r = sameForm(o.alg, t); if (r == null) throw new Error(`same= 后面的式子读不懂：${t}`); return r; },
  // equals=…：数学上相等（判不了是 null）
  equals: (o, args) => { need(o); const t = target(args); if (!t) throw new Error(`要写成 ${o.id} equals=(A+B)^2`); return equalsTo(o.alg, t); },
};

/** 这一下改了哪几项（ask pick 交了以后和真变了的比）：新冒出来的、换了位置的都算变了；前后都在的才算 */
function changed(before, after) {
  if (!before?.alg || !after?.alg) return [];
  const pos = (alg) => new Map(alg.items.flatMap((it, i) => it.factors.map((f, j) => [f.key, `${i}.${j}.${f.text}`])));
  const a = pos(before.alg), b = pos(after.alg);
  return [...b].filter(([k, v]) => a.has(k) && a.get(k) !== v).map(([k]) => k);
}

export const texRules = { check, facts, predicates, gestures, changed, actOf };

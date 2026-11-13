// 照 look 画（第九轮，画面那一半）：老师写的样子换成行内样式写到每个画面元素上。
// 默认样式表（DEFAULT_LOOK）垫底，老师写的照档、照先后盖上去；部件（s.3）的盖在整样东西上。
// 底座的反馈规则是 !important 的副本（look/css.js），所以这里写的行内样式盖不掉它们。
// 底线 1：学生要点的东西（底下那一条、交出去的部件）不能藏、不能淡到 0.6 以下——那一项不写，记进 refused 告诉老师。

import { resolveLook, DEFAULT_LOOK, lookName } from './spec.js';
import { lookStyle, COLOR_VAR } from './css.js';

const SVG = (n) => typeof SVGElement !== 'undefined' && n instanceof SVGElement;
/**
 * 一个节点算哪一类（第一次见到时照它原来的样子定，记在节点上：之后写了行内样式也不变）：
 * SVG 是线；有影子或圆角的是「有框的小件」（格子、结点、题卡的底）——frame / bg 只改这些；
 * 别的（时间轴的轴、刻度、括号的横线这种用底色画的线、光秃秃的字）只收颜色、字体这类，不去掉它的底色
 */
function roleOf(n) {
  if (SVG(n)) return 'line';
  if (n.__lkRole) return n.__lkRole;
  let role = 'text';
  try {
    const cs = getComputedStyle(n);
    if ((cs.boxShadow && cs.boxShadow !== 'none') || parseFloat(cs.borderTopLeftRadius) >= 4 || (cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0)) role = 'box';
  } catch { role = 'box'; }
  n.__lkRole = role;
  return role;
}

/** 写一个元素的行内样式：上一次写过、这一次没有的拿掉（不碰画法自己写的 transform、width……） */
function put(node, style) {
  const was = node.__lk || {};
  for (const k of Object.keys(was)) if (!(k in style)) node.style.removeProperty(k);
  for (const [k, v] of Object.entries(style)) if (was[k] !== v) node.style.setProperty(k, v);
  node.__lk = style;
}

/**
 * stage：舞台。返回 { changed, refused: [句子] }
 */
export function applyLooks(stage) {
  const sc = stage.scene;
  const looks = [...DEFAULT_LOOK, ...(stage.baseLooks || []), ...(sc.looks || [])];
  const refused = [];
  let changed = false;
  const write = (node, style) => {
    const before = JSON.stringify(node.__lk || {});
    put(node, style);
    if (JSON.stringify(style) !== before) changed = true;
  };
  // 学生要点的部件：交出去的（open）、这一问点的
  const needed = new Set();
  for (const e of sc.opens?.values?.() || []) for (const r of e.refs?.length ? e.refs : [e.obj]) { try { for (const p of sc.parts(r)) needed.add(stage.nodeOf?.(p)); } catch { /* 没了 */ } }
  const floor = (name, props) => {
    if (props.opacity && Number(props.opacity) < 0.6) { refused.push(`${lookName(name)} 不能淡到 ${props.opacity}（学生要点它；最淡 0.6）`); const { opacity, ...rest } = props; return rest; }
    return props;
  };

  // 话：一整块；字号改话那两档变量（这一轮的、前几轮淡下去的）
  {
    const { props, hide } = resolveLook(looks, { name: 'say' });
    const st = lookStyle(props, 'block');
    delete st['font-size'];
    if (props.text) { st['--st-fs-talk'] = `calc(${props.text}px * var(--ts, 1))`; st['--st-fs-body'] = `calc(${Math.round(props.text * 0.8)}px * var(--ts, 1))`; }
    if ((props.frame === 'card' || props.frame === 'line') && !props.pad) st.padding = '10px 14px';
    if (props.font) st['--lk-font'] = st['font-family'];
    if (hide) st.visibility = 'hidden';
    write(stage.caption, st);
    stage.caption.classList.toggle('lk-boxed', props.frame === 'card' || props.frame === 'line');
  }
  // 挑战：框在每一条上，字号在整块上
  {
    const { props, hide } = resolveLook(looks, { name: 'goals' });
    const block = {};
    if (props.text) block['--st-fs-body'] = `calc(${props.text}px * var(--ts, 1))`;
    if (hide) block.visibility = 'hidden';
    write(stage.goalsEl, block);
    const item = lookStyle(props, 'box');
    for (const g of stage.goalsEl.children) write(g, item);
  }
  // 底下那一条：学生要在这里点、打字——不能藏、不能太淡
  {
    let { props, hide } = resolveLook(looks, { name: 'dock' });
    if (hide) refused.push('底下那一条不能藏（学生要在这里点按钮、打字）');
    props = floor('dock', props);
    const st = lookStyle(props, 'block');
    delete st['font-size'];
    write(stage.dock, st);
  }
  // 整个画面的底（look page bg=…，设计要求单 r21：「背景干净一点」）
  {
    const { props } = resolveLook(looks, { name: 'page' });
    const st = {};
    if (props.bg) st.background = lookStyle({ bg: props.bg }, 'box').background;
    write(stage.root, st);
  }
  // 顶上那一条（课堂里才有）：返回、下课在上面——不能藏、不能太淡
  if (stage.barEl) {
    let { props, hide } = resolveLook(looks, { name: 'bar' });
    if (hide) refused.push('顶上那一条不能藏（上面有回学习台、下课）');
    props = floor('bar', props);
    const st = lookStyle(props, 'block');
    delete st['font-size'];
    write(stage.barEl, st);
  }
  // 贴的字、拨盘
  for (const [id, cur] of stage.labelNodes || []) {
    const lab = sc.labels.get(id);
    if (!lab || !cur.node) continue;
    const kind = lab.dial ? 'dial' : 'label';
    let { props, hide } = resolveLook(looks, { name: id, kind });
    if (lab.dial) props = floor(id, props);
    const st = lookStyle(props, lab.dial ? 'box' : 'block');
    if (hide && !lab.dial) st.visibility = 'hidden';
    if (hide && lab.dial) refused.push(`拨盘 ${id} 不能藏（学生要拨它）`);
    write(cur.node, st);
  }
  // 老师画的（draw）：颜色、粗细、淡、藏
  for (const [name, g] of stage.drawNodes || []) {
    const { props, hide } = resolveLook(looks, { name, kind: 'draw' });
    const st = {};
    const c = props.color || props.edge;
    if (c && COLOR_VAR[c]) st.color = COLOR_VAR[c];
    if (props.edge === 'thick') st['--draw-w'] = '3.6';
    if (props.edge === 'thin') st['--draw-w'] = '1.6';
    if (props.opacity) st.opacity = props.opacity;
    if (hide) st.visibility = 'hidden';
    write(g, st);
  }
  // 东西的每个节点（部件的盖在整样东西上）
  const partLooks = looks.filter((l) => l.rank === 3);
  const byNode = new Map();
  for (const o of sc.objects.values()) {
    if (o.hidden) continue;
    const { props } = resolveLook(looks.filter((l) => l.rank < 3), { name: o.id, kind: o.type });
    for (const n of stage.root.querySelectorAll(`[data-obj="${CSS.escape(o.id)}"]`)) byNode.set(n, { name: o.id, props: { ...props } });
  }
  for (const l of partLooks) {
    let parts = [];
    try { parts = sc.parts(l.target); } catch { parts = []; }
    for (const p of parts) {
      const n = stage.nodeOf?.(p);
      const cur = n && byNode.get(n);
      if (cur) Object.assign(cur.props, l.props);
    }
  }
  for (const [n, { name, props }] of byNode) {
    const p = needed.has(n) ? floor(name, props) : props;
    write(n, lookStyle(p, roleOf(n)));
  }
  return { changed, refused: [...new Set(refused)] };
}

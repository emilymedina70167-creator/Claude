// 舞台的动作（docs/stage-plan.md）：动作曲线、弧线、时长、先后错开。纯函数，有测试（tests/stage.test.js）。
// 画面好不好看，大半在这里：老师只说「交换 3 和 6」，走多快、走什么弧、几个东西怎么错开，都是这里定的，
// 所以老师怎么写都拍得顺（像游戏引擎自带物理和动作，玩家只下指令）

/** 动作曲线：move 两头慢中间快（挪位置）、out 一出手就快（出现、落下）、spring 冲过一点再回来（抬起、点亮）、in 越走越快（离场） */
export const EASE = {
  move: 'cubic-bezier(.65,0,.35,1)',
  out: 'cubic-bezier(.22,1,.36,1)',
  spring: 'cubic-bezier(.34,1.45,.64,1)',
  in: 'cubic-bezier(.55,0,1,.45)',
};

/** 挪一段距离要多久（毫秒）：短的利落、长的也不拖 */
export function moveDuration(dist) {
  return Math.round(Math.min(900, 380 + Math.abs(dist) * 0.55));
}

/** 第 i 个东西晚多久出发（一组东西不同时动，像一排人依次起身） */
export function stagger(i, { step = 70, max = 420 } = {}) {
  return Math.min(max, Math.max(0, i) * step);
}

/**
 * 从 a 到 b 走一道弧（交换、跳格、飞过去都用它）。返回 n+1 个点 { x, y, t }（t 是 0～1 的进度）。
 * dir：-1 往上拱、1 往下拱；弧高按两点距离算（近的低、远的高，有上下限），走得像抛过去而不是滑过去
 */
export function arcPoints(a, b, { dir = -1, lift = 0.32, min = 22, max = 150, n = 16 } = {}) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const h = Math.max(min, Math.min(max, dist * lift)) * (dir < 0 ? -1 : 1);
  // 法线方向：两点连线转 90°；水平走时就是竖直方向
  const nx = dist ? -dy / dist : 0, ny = dist ? dx / dist : 1;
  const sgn = ny >= 0 ? 1 : -1; // 让 dir = -1 永远是屏幕上的「上」
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bump = 4 * t * (1 - t) * h * sgn;
    out.push({ x: a.x + dx * t + nx * bump, y: a.y + dy * t + ny * bump, t });
  }
  return out;
}

/** 弧线画成 SVG 路径（连线、跳格留下的那道弧）：二次贝塞尔，控制点在弧顶的两倍高处 */
export function arcPath(a, b, { dir = -1, lift = 0.32, min = 22, max = 150 } = {}) {
  const mid = arcPoints(a, b, { dir, lift, min, max, n: 2 })[1];
  const cx = 2 * mid.x - (a.x + b.x) / 2, cy = 2 * mid.y - (a.y + b.y) / 2;
  const r = (v) => Math.round(v * 10) / 10;
  return `M${r(a.x)} ${r(a.y)} Q${r(cx)} ${r(cy)} ${r(b.x)} ${r(b.y)}`;
}

/**
 * 一句话一个字一个字出来：每个字晚多久出现。短句也要看得出是「写出来」的，长句不拖（总时长有上限）。
 * 返回每个字的延迟（毫秒）
 */
export function revealDelays(n, { per = 22, max = 900 } = {}) {
  if (n <= 0) return [];
  const step = Math.min(per, max / n);
  return Array.from({ length: n }, (_, i) => Math.round(i * step));
}

/** 一句话出来以后留多久给人读：按字数，有上下限（中文大约一秒八到十个字，画面同时在动，不用等读完） */
export function readHold(chars) {
  return Math.round(Math.max(250, Math.min(1400, chars * 35)));
}

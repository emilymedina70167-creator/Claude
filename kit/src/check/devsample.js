// ?dev 的检验：模拟老师的暗号「测试:检验」写这一条 board check（两块、五种题型，每道必做两道同构题）；
// 模拟的判分（devVerdict）：学生写的字里有「错」→ 第一个要点没写到，别的都对；有图时转写一行。不调用 Claude。
import { VERDICT_HEAD, FALLBACK_HEAD } from './judge.js';

const F = '```';
const fam = (id, make) => [make(id, [`${id}a`, `${id}b`]), make(`${id}a`, []), make(`${id}b`, [])].join('\n');
const retry = (r) => (r.length ? `retry: ${r.join(', ')}\n` : '');
// 同构题和本题题面不一样（题库按原文认同一道题）
const v = (id) => (/a$/.test(id) ? '（再来一道）' : /b$/.test(id) ? '（换一道）' : '');
const construct = (id, r) => `${F}construct\nid: ${id}\nq: 造两个同型但不相等的 2 阶矩阵 $A$、$B$${v(id)}\ntarget: L2-14\nlevel: 基础\nslots: A=mat(2) B=mat(2)\nif: A != B => 这两个相等了，题要的是不相等\nexample: A=[[1,0],[0,0]] B=[[0,0],[0,1]]\nteach if1: 同型只是行数、列数一样；相等还要每个元素都一样。\n${retry(r)}${F}`;
const recall = (id, r) => `${F}recall\nid: ${id}\nq: 不看板书，写出 $(A${id.length > 2 ? '-' : '+'}B)^2$ 的展开；什么时候能并成两项，为什么${v(id)}\ntarget: L2-56\nlevel: 核心\nmust m1: 四项，AB、BA 分开\nmust m2: 条件 AB = BA\nwrong w1: 对所有方阵都成立\nteach m2: 只有 AB = BA 时 AB + BA 才能并。\nteach default: 先把两个括号乘开，四项都写出来。\n${retry(r)}${F}`;
const claim = (id, r) => `${F}claim\nid: ${id}\nclaim: $A$、$B$ 都是对称矩阵，则 $(A+B)^2 = A^2+2AB+B^2$${v(id)}\ntruth: 假\ntarget: 对称不等于可交换\nlevel: 核心\nslots: A=mat(2) B=mat(2)\nif: A == A' => A 不对称\nif: B == B' => B 不对称\nif: (A+B)^2 != A^2+2*A*B+B^2 => 这一组两边相等了，不是反例\nexample: A=[[1,0],[0,0]] B=[[0,1],[1,0]]\nteach truth: 对称不等于可交换。\nteach default: 找两个对称但不可交换的。\n${retry(r)}${F}`;
const locate = (id, r) => `${F}locate\nid: ${id}\nq: 这份解答错在哪一行？${v(id)}\nline: $(A+B)^2=(A+B)(A+B)$\nline: $=A^2+2AB+B^2$\nline: 所以对任意方阵都成立\nbug: 2\ntarget: L2-56\nlevel: 方法\nmust m1: AB 和 BA 不一定相等，不能并成 2AB\nteach default: 乘开是 $A^2+AB+BA+B^2$。\n${retry(r)}${F}`;
const disc = (id, r) => `${F}discriminate\nid: ${id}\nq: $A=\\begin{bmatrix}0&1\\\\0&0\\end{bmatrix}$，$(E+A)^5$ 能不能直接用二项式展开？${v(id)}\ncan: 能\ntarget: 看着可疑其实能用\nlevel: 核心\nlet A = [[0,1],[0,0]]\nmust m1: E 和任何方阵可交换\nresult: E+5*A\nteach can: E 和谁都可交换，二项式定理能用。\nteach default: 先看 E 和 A 交不交换。\n${retry(r)}${F}`;

export const DEV_CHECK_HEAD = 'check id=k1 title="第二讲第一节" limit=15m';
export const DEV_CHECK_BODY = [
  'block L2.1.1 must=p1',
  'block L2.1.4 must=p3,p5,p6 optional=p7',
  fam('p1', construct), fam('p3', recall), fam('p5', claim), fam('p6', locate), fam('p7', disc),
].join('\n');
export const DEV_CHECK = [`\`\`\`\`board ${DEV_CHECK_HEAD}`, DEV_CHECK_BODY, '````'].join('\n');

/** 模拟判分：照提示词里的编号回 [判] 行 */
export function devVerdict(prompt) {
  const ids = (String(prompt).match(/每个编号一行（([^）]*)）/)?.[1] || '').split('、').filter(Boolean);
  const said = String(prompt).match(/<<<\n([\s\S]*?)\n>>>/)?.[1] || '';
  const wrong = /错/.test(said);
  const img = /附图 \d+ 张/.test(prompt);
  return [...(img ? ['[转写]', 'L1: （模拟转写）'] : []), '[判]', ...ids.map((id, i) => (wrong && i === 0 && !id.startsWith('w') ? `${id} missing` : `${id} ok`))].join('\n');
}

export const isVerdict = (t) => String(t).startsWith(VERDICT_HEAD);
export const isFallback = (t) => String(t).startsWith(FALLBACK_HEAD);

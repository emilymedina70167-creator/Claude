// let 块：整节课都要用的量（黑板上不显示）。后面的段、组件（answer、scene、matrix……）、公式里的 \calc 都能直接用这些名字，
// 不用每个组件再写一遍 let，也就不会这块板写一个 A、那块板写成另一个 A。
//   ```let
//   A = [[-1, -1, 2], [2, 2, -4], [1, 1, -2]]
//   a = [-1, 2, 1]
//   ```
// 按出现的先后算：后面的行可以用前面的名字；同一个名字再定义一次就换成新的（以后画的组件用新的）
import { session } from '../session.js';
import { parseLets, calcValue } from '../exact.js';

export function letBlock(el, src) {
  const defs = parseLets(src);
  const done = [];
  for (const { name, src: expr } of defs) {
    let r;
    try {
      r = calcValue(expr, session.vars);
    } catch (e) {
      throw new Error(`${name} = ${expr.slice(0, 60)} 算不出来：${e.message}`);
    }
    // 精确的存精确值；开方、三角这类存小数
    session.vars[name] = r.value;
    done.push(name);
  }
  el.dataset.lets = done.join(',');
  el.hidden = true;
}

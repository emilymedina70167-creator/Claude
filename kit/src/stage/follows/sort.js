// 排序的对应关系（follow a sort shell gaps="5 3 1"）：黑板的排序引擎（engines/sort.js，七种，照王道的代码走）接到一排格子上。
// 这里只写「对得上」：引擎的输入怎么从这一排来、引擎每一步的样子怎么写成和这一排一样的一串。排序本身一行都不写
import { registerFollow } from '../follow.js';
import { sortEngine, ALGOS } from '../../engines/sort.js';

// 49′ 和 49' 是同一个写法
const norm = (t) => String(t ?? '').replace(/['’]/g, '′').trim();
const raw = (o) => [...o.cells].sort((a, b) => a.slot - b.slot).map((c) => norm(c.value));
// 和引擎比的写法：数照数写（09 → 9：引擎读成数再写出来没有前面的零），撇留着
const canon = (t) => { const m = /^(-?\d+(?:\.\d+)?)(′*)$/.exec(t); return m ? `${Number(m[1])}${m[2]}` : t; };
const row = (o) => raw(o).map(canon);
const textOf = (x) => `${x.v}${'′'.repeat(x.mark || 0)}`;
const plain = (t) => t.replace(/′/g, '');
const join = (cells) => cells.join(' ');

registerFollow('sort', {
  engine: sortEngine,
  types: ['array'],
  subjects: ['数据结构'],
  head: 'algo',
  known: ['gaps'],
  word: '格',
  // 写 follow 那一刻牌上的字：引擎的 5 给人看时写回 05
  snap: (o) => Object.fromEntries(raw(o).map((t) => [canon(t), t])),
  label: (cell, snap) => snap?.[cell] ?? cell,
  drillOpen: () => 'move', // 自己练的时候开哪种手（课上老师没 open 过时）
  unit: (f) => (/^(quick|快)/.test(String(f.algo || '')) ? '次划分' : '趟'),
  title(f) {
    let algo = String(f.algo || '');
    try { algo = sortEngine.parse({ ...f, array: '1 2' }).algo; } catch { /* 写错的引擎会报 */ }
    return `${ALGOS[algo] || algo}${f.gaps ? `（增量 ${f.gaps}）` : ''}`;
  },
  fields(o, opts) {
    const cells = raw(o);
    if (cells.some((t) => t === '')) throw new Error('这一排还有空着的格：填满了才照得下去');
    return { ...opts, array: join(cells) };
  },
  // 数据 = 这一排有哪些数（不管摆成什么样）：挪牌不算改数据，写了一格才算
  dataOf: (o) => row(o).slice().sort().join(' '),
  // 样子 = 每一格现在的字。带撇的分得开（49 和 49′），两张一模一样的换了先后看不出来——也不该算错
  stateOf: (o) => join(row(o)),
  cellsOf: (o) => row(o),
  nameOf: (i) => `第 ${i + 1} 格`,
  // 引擎认得的错法只交每一趟做完的数（不带撇）：比的时候两边都不看撇
  loose: plain,
  frames(run, spec) {
    const n = spec.items.length;
    const frame = (cells) => ({ state: join(cells), cells });
    const start = spec.items.map(textOf);
    // 错法：只有每一趟做完的数
    if (spec.mistake) return [frame(start), ...run.passes.map((p, k) => ({ ...frame(p.map(String)), mark: [k + 1] }))];
    // 正确的那一遍：只收每张牌都在的步（挪到一半的步里有重复的牌：直接插入往后让、快排填坑）
    const out = [frame(start)];
    for (const s of run.steps) {
      const A = s.view?.A;
      if (!Array.isArray(A) || A.length !== n || A.some((x) => !x) || new Set(A.map((x) => x.id)).size !== n) continue;
      out.push(frame(A.map(textOf)));
    }
    // 检查点：每一趟做完的数（run.passes，不带撇）——路上数和它一样的最后一步；一步都对不上（引擎那一趟没留下整排的步）就照数补一步
    let from = 0;
    run.passes.forEach((p, k) => {
      const want = p.join(' ');
      let at = -1;
      for (let i = out.length - 1; i >= from; i--) if (plain(out[i].state) === want) { at = i; break; }
      if (at < 0) { out.push(frame(p.map(String))); at = out.length - 1; }
      out[at] = { ...out[at], mark: [...(out[at].mark || []), k + 1] }; // 连着几趟没有要动的：同一步是好几趟的检查点
      from = at;
    });
    return out;
  },
  doc: 'follow a sort shell gaps="5 3 1"   页面让排序引擎在 a 现在的数上跑一遍（insert / shell / bubble / select / quick / merge / radix）',
});

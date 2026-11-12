// 堆的对应关系（follow h heap build / sort）：黑板的 tree 引擎（engines/tree.js 的 heap：建堆、堆排序，照王道的做法）接到舞台的树上。
// 这里只写「对得上」：引擎的输入怎么从这棵树来（层序）、引擎每一步的数组怎么写成和这棵树一样的一串。堆本身一行都不写。
// 学生的手是树本来就有的：按住一个结点拖到另一个上，两个换值（open h）。插入、删堆顶要改树的形状，学生没有这只手：不接（用过程表，或者老师演）
import { registerFollow } from '../follow.js';
import { treeEngine } from '../../engines/tree.js';

// 层序的值；不是完全二叉树（中间缺结点）是 null
function levelOf(o) {
  const at = new Map(o.nodes.map((n) => [n.key, n]));
  const out = [];
  const q = [[o.root, 1]];
  while (q.length) {
    const [k, i] = q.shift();
    const n = at.get(k);
    if (!n) continue;
    if (i !== out.length + 1) return null;
    out.push(String(n.value));
    if (n.left != null) q.push([n.left, 2 * i]);
    if (n.right != null) q.push([n.right, 2 * i + 1]);
  }
  return out;
}
const opsOf = (f) => String(f.ops || 'build').trim().toLowerCase();
const isMin = (f) => /^(min|小根)/.test(String(f.type || ''));
const join = (cells) => cells.join(' ');

registerFollow('heap', {
  engine: treeEngine,
  types: ['tree'],
  subjects: ['数据结构'],
  head: 'ops',
  known: ['type'],
  word: '个结点',
  drillOpen: () => 'drag',
  unit: (f) => (opsOf(f) === 'sort' ? '趟' : '次调整'),
  title: (f) => (opsOf(f) === 'sort' ? `堆排序（${isMin(f) ? '小' : '大'}根堆）` : `建${isMin(f) ? '小' : '大'}根堆`),
  fields(o, opts) {
    const ops = opsOf(opts);
    if (ops !== 'build' && ops !== 'sort') throw new Error('照着走只接建堆和堆排序（follow h heap build / sort）：插入、删堆顶要改树的形状，用过程表（table T engine=tree heap=… ops=…）或者你来演');
    const cells = levelOf(o);
    if (!cells) throw new Error('堆要一棵完全二叉树（层序一个不缺）：这棵树中间缺了结点');
    return { heap: join(cells), ops, ...(opts.type != null ? { type: opts.type } : {}) };
  },
  // 数据 = 这棵树里有哪些数（换值不算改数据）
  dataOf: (o) => (levelOf(o) || []).slice().sort().join(' '),
  stateOf: (o) => join(levelOf(o) || []),
  cellsOf: (o) => levelOf(o) || [],
  nameOf: (i) => `层序第 ${i + 1} 个`,
  frames(run, spec) {
    const text = (A) => A.map((x) => (x ? x.text : ''));
    const out = [];
    let mark = 0, open = false; // open：正在调整一棵子树（建堆），调整完的那一步打检查点
    const close = () => { if (open && out.length) { mark += 1; out[out.length - 1] = { ...out.at(-1), mark: [...(out.at(-1).mark || []), mark] }; } open = false; };
    // 错法（一个个插入上浮建的）：引擎只交建完的样子，算一个检查点
    if (spec.mistake) { const A = text(run.steps.at(-1).view.A); return [{ state: join(text(run.steps[0].view.A)), cells: text(run.steps[0].view.A) }, { state: join(A), cells: A, mark: [Math.max(1, spec.items.length >> 1)] }]; }
    const sorting = spec.ops.some((x) => x.op === 'sort');
    let passes = 0;
    for (const s of run.steps) {
      const v = s.view;
      if (!v?.A) continue;
      if (!sorting && (v.sub != null || v.done)) close();
      const cells = text(v.A);
      out.push({ state: join(cells), cells });
      if (!sorting && v.sub != null) open = true;
      // 堆排序：一趟 = 堆顶换到最后、再从堆顶调整完。引擎每趟做完记在 run.passes 里：路上和它一样的那一步是检查点
      if (sorting && passes < run.passes.length && join(cells) === join(run.passes[passes])) { passes += 1; out[out.length - 1].mark = [passes]; }
    }
    close();
    // 堆排序的一趟里先和 run.passes 一样的可能是调整的中间一步：检查点挪到这一趟最后一个一样的地方
    return out;
  },
  doc: 'follow h heap build   树照引擎建堆（type=min 小根堆）；follow h heap sort 堆排序（先要已经是堆）。学生的手：open h（按住一个结点拖到另一个上，两个换值）',
});

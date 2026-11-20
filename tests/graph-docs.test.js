// 视觉交互第 1 批 Task 8：手册和示例页里的函数图照抄就能画；高数、概率两门课拿得到函数图的说明
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGraph } from '../kit/src/graphspec.js';
import { subjectKey, docsForSubject, componentDoc } from '../kit/src/subject.js';
import { riemannRects, areaBetween } from '../kit/src/fx/graphgeom.js';

const manual = readFileSync('CLAUDE-PROJECT.md', 'utf8');
const third = manual.slice(manual.indexOf('## 三、组件参考'), manual.indexOf('\n## 四、'));
const graphsIn = (text) => [...text.matchAll(/```graph\n([\s\S]*?)```/g)].map((m) => m[1]);
const demo = graphsIn(readFileSync('kit/examples/graph-demo.html', 'utf8'));
const inManual = graphsIn(third);

// 每张图：读得懂；初始值上每条命令的式子都算得出来（目标、点的目标、读数里用到的名字）
function check(src, where) {
  const g = parseGraph(src);
  const v = {};
  for (const c of g.cmds) if (c.kind === 'slider') v[c.name] = c.init;
  // 和 graph.js 的 env() 一样：let、起了名字的面积和黎曼和按先后算进变量
  const fx = (f) => (x) => f({ ...v, x });
  for (const c of g.cmds) {
    if (c.kind === 'let') v[c.name] = c.expr(v);
    if (c.name && c.kind === 'area') v[c.name] = areaBetween(fx(c.f), fx(c.g), c.a(v), c.b(v));
    if (c.name && c.kind === 'riemann') v[c.name] = riemannRects(fx(c.f), c.a(v), c.b(v), c.n(v), c.rule).sum;
  }
  for (const c of g.cmds) {
    const at = `${where}：${c.srcLine}`;
    if (c.kind === 'pick') {
      const ts = c.targets(v);
      assert.ok(ts.length >= 1, `${at} 的目标一个都没有`);
      // 目标要在窗口里（学生点得到）：页面上这是写法错误
      for (const t of ts) { const x = Array.isArray(t) ? t[0] : t; assert.ok(x >= g.xr[0] && x <= g.xr[1], `${at} 的目标 ${x} 在窗口外`); }
    }
    if (c.kind === 'goal') assert.doesNotThrow(() => (c.cond ? c.cond(v) : [c.lhs(v), c.rhs(v)]), at);
    if (c.kind === 'tangent') assert.ok(Number.isFinite(c.df({ ...v, x: c.at(v) })), at);
    if (c.kind === 'plot') assert.doesNotThrow(() => c.f({ ...v, x: (g.xr[0] + g.xr[1]) / 2 + 0.123 }), at);
  }
  return g;
}

test('示例页：至少 24 张函数图，每张都读得懂、算得出', () => {
  assert.ok(demo.length >= 24, `只有 ${demo.length} 张`);
  demo.forEach((src, i) => check(src, `graph-demo 第 ${i + 1} 张`));
});

test('示例页里学生能动手的图占多数（拖、点、目标）', () => {
  const hands = demo.filter((src) => { const g = parseGraph(src); return g.cmds.some((c) => c.kind === 'goal' || c.kind === 'pick' || c.kind === 'slider' || (c.kind === 'let' && c.mods.drag)); });
  assert.ok(hands.length >= demo.length - 2, `${hands.length}/${demo.length}`);
  assert.ok(demo.filter((src) => parseGraph(src).cmds.some((c) => c.kind === 'goal' || c.kind === 'pick')).length >= 10);
});

test('手册里的函数图例子照抄就能画，新命令每样至少一个例子', () => {
  assert.ok(inManual.length >= 6, `手册里只有 ${inManual.length} 个 graph 例子`);
  const kinds = new Set();
  inManual.forEach((src, i) => check(src, `手册第 ${i + 1} 个例子`).cmds.forEach((c) => kinds.add(c.kind)));
  for (const k of ['plot', 'shade', 'bars', 'tangent', 'secant', 'riemann', 'area', 'dots', 'goal', 'pick']) assert.ok(kinds.has(k), `手册里没有 ${k} 的例子`);
  assert.ok(inManual.some((s) => /^[A-Za-z]\w*\(x\)\s*=/m.test(s)), '手册里没有 f(x) = … 的例子');
});

test('认高数、概率两门课', () => {
  assert.equal(subjectKey('高数'), '高数');
  assert.equal(subjectKey('高等数学'), '高数');
  assert.equal(subjectKey('概率'), '概率');
  assert.equal(subjectKey('概率论'), '概率');
  assert.equal(subjectKey('概率论与数理统计'), '概率');
  assert.equal(subjectKey('线代'), '线代');
});

test('高数、概率的课拿得到函数图和式子作答的说明，拿不到线代专用的和计算机课的', () => {
  for (const s of ['高数', '概率']) {
    const d = docsForSubject(third, s);
    assert.match(d, /### graph：/, `${s} 没有 graph`);
    assert.match(d, /### answer 的高数写法/, `${s} 没有 answer 的高数写法`);
    assert.match(d, /### scene：/, `${s} 没有 scene`);
    assert.doesNotMatch(d, /### elim：/, `${s} 带上了 elim`);
    assert.doesNotMatch(d, /### sort：/, `${s} 带上了 sort`);
    assert.doesNotMatch(d, /### cloze：/, `${s} 带上了 cloze`);
  }
  assert.match(docsForSubject(third, '高数'), /### space：/);
  // 线代照旧有 graph、没有高数的式子作答
  assert.match(docsForSubject(third, '线代'), /### graph：/);
  assert.doesNotMatch(docsForSubject(third, '线代'), /### answer 的高数写法/);
  assert.match(componentDoc(third, 'graph', '高数'), /pick/);
});

test('graph 的精简版不超过 3 KiB（每一轮都带）', () => {
  const sec = third.slice(third.indexOf('### graph：'));
  const brief = sec.slice(0, sec.indexOf('<!-- 完整写法 -->'));
  const bytes = Buffer.byteLength(brief, 'utf8');
  assert.ok(bytes <= 3072, `精简版 ${bytes} 字节`);
  assert.ok(sec.indexOf('<!-- 完整写法 -->') > 0 && sec.indexOf('<!-- 完整写法 -->') < sec.indexOf('\n### ', 5));
});

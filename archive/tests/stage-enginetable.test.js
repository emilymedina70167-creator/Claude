// 引擎的过程表 → 舞台的表（kit/src/stage/enginetable.js，主线第五轮设计第 3 节）：行名列名、给定的格、答案、先后不论的组、错法都从引擎来
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { engineTable, variantsOf, ETABLE_MAX } from '../kit/src/stage/enginetable.js';
import { ENGINES } from '../kit/src/engines/registry.js';
import { parseFields } from '../kit/src/parse.js';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';

const SHELL = { algo: 'shell', array: '49 38 65 97 76 13 27 49', gaps: '5 3 1' };

test('希尔排序：一趟一行、一个数一格；答案是引擎算的；有错法', () => {
  const t = engineTable('sort', SHELL);
  assert.equal(t.name, 'sort');
  assert.equal(t.key.length, t.rowNames.length);
  assert.equal(t.key[0].length, 8);
  assert.equal(t.colNames.length, 8);
  assert.equal(t.key.at(-1).map((x) => x.replace(/[′']/g, '')).join(' '), '13 27 38 49 49 65 76 97');
  // 等学生填的格是空的，给定的格写着值；每格都有答案
  for (let r = 0; r < t.grid.length; r++) for (let c = 0; c < t.grid[r].length; c++) { assert.ok(t.grid[r][c] === '' || t.grid[r][c] === t.key[r][c]); assert.notEqual(t.key[r][c], ''); }
  assert.ok(t.grid.flat().some((x) => x === ''), '有要填的格');
  const vs = variantsOf('sort', t);
  assert.ok(vs.length >= 1);
  for (const v of vs) { assert.ok(v.label); assert.equal(v.key.length, t.key.length); assert.notDeepEqual(v.key, t.key); }
  // 引擎的一行 = 舞台的一行（不是竖着排的）
  assert.equal(t.lines.length, t.key.length);
  assert.deepEqual(t.lines[0].map(([r]) => r), new Array(t.lines[0].length).fill(0));
});

test('页面置换：引擎的表是竖着排的（一次访问一列）——转过来；同一时刻的几个物理块先后不论；缺页是打勾的格', () => {
  const t = engineTable('paging', { algo: 'fifo', frames: '3', refs: '7 0 1 2 0 3 0 4' });
  assert.equal(t.colNames.length, 8, '一次访问一列');
  assert.ok(t.rowNames.length >= 4, '几个物理块 + 缺页');
  assert.ok(t.groups.length > 0);
  // 一组里的格在同一列（同一次访问）
  for (const g of t.groups) assert.equal(new Set(g.map(([, c]) => c)).size, 1);
  assert.ok(t.marks.length > 0);
  for (const [r, c] of t.marks) assert.ok(['√', '×'].includes(t.key[r][c]));
  // 认错法照引擎的一行（这里是一列）
  assert.equal(t.lines.length, 8);
  assert.equal(new Set(t.lines[0].map(([, c]) => c)).size, 1);
});

test('散列表：表下面单独的几格（ASL）交出来，不在表里', () => {
  const t = engineTable('hash', { hash: '19 14 23 01 68 20', p: '13' });
  assert.ok(t.extra.length >= 1);
  assert.ok(t.extra.every((x) => x.label && x.v !== ''));
});

test('Dijkstra：和第四轮接在表上的那条路（follow T net dijkstra on=g）算的是同一个答案', () => {
  const s = new Scene();
  for (const c of parseScript('graph g = 1>2:10 1>5:5 2>3:1 5>2:3 5>3:9\ntable T = _ _ _ _ / _ _ _ _ / _ _ _ _ rows="2 3 5" cols="第1轮 第2轮 第3轮 第4轮"\nfollow T net dijkstra on=g from=1')) s.apply(c);
  const want = s.objects.get('T').key; // 行：顶点 2 3 5；列：四轮
  const t = engineTable('net', { edges: '1->2 10, 1->5 5, 2->3 1, 5->2 3, 5->3 9', run: 'dijkstra from 1' });
  for (const [i, v] of ['2', '3', '5'].entries()) {
    const r = t.rowNames.findIndex((n) => n.includes(v));
    assert.ok(r >= 0, `有顶点 ${v} 的那一行：${t.rowNames.join('、')}`);
    // 引擎的表照教材：已经确定的顶点后面几轮不写（给定的空格，舞台上是「—」）；写了数的那几格两条路一样
    t.key[r].forEach((x, k) => { if (x !== '—') assert.equal(String(x), String(want[i][k]), `顶点 ${v} 第 ${k + 1} 轮`); else assert.equal(t.grid[r][k], '—'); });
  }
});

test('写错的当场报：没有这个引擎、没有表、引擎不收、字段写错、放不下', () => {
  assert.throws(() => engineTable('sorrt', SHELL), /没有「sorrt」这个引擎[^\n]*sort/);
  assert.throws(() => engineTable('sort', { ...SHELL, gap: '5 3 1' }), /gap[^\n]*gaps/);
  assert.throws(() => engineTable('sort', { algo: 'shell' }), /./); // 引擎自己的话（没写 array）
  assert.throws(() => engineTable('sort', { algo: 'bubble', array: '13 12 11 10 9 8 7 6 5 4 3 2 1' }), new RegExp(`这张表有 \\d+ 行 \\d+ 列，舞台上放不下（最多 ${ETABLE_MAX.rows} 行 ${ETABLE_MAX.cols} 列）`));
  assert.throws(() => engineTable('frames', {}), /./);
});

// 每个有表的引擎拿示例页里的例子扫一遍：要么造得出，要么报的是「放不下」，不许是别的错（少数要正文的组件 frames / trace 除外）
test('每个带表的引擎：示例页里的例子都造得出舞台的表（或者照实说放不下）', () => {
  const src = readFileSync(new URL('../kit/examples/408-demo.html', import.meta.url), 'utf8');
  let made = 0, big = 0;
  const seen = new Set();
  for (const m of src.matchAll(/```(\w+)\n([\s\S]*?)```/g)) {
    const e = ENGINES[m[1]];
    if (!e?.table || e.head) continue; // 有正文的（frames）字段不够
    const fields = parseFields(m[2]).fields;
    for (const k of ['id', 'title', 'mode', 'ask', 'q', 'note', 'hint', 'explain', 'given', 'rows', 'cols', 'vary']) delete fields[k];
    let t = null;
    try { const input = e.parse({ ...fields }, m[2]); t = e.table(input, e.run(input), fields); } catch { continue; } // 黑板上都演不了的不算
    if (!t) continue;
    try { const out = engineTable(m[1], fields); made++; seen.add(m[1]); assert.equal(out.key.length, out.rowNames.length); for (const row of out.key) assert.equal(row.length, out.colNames.length); }
    catch (err) { assert.match(err.message, /舞台上放不下|太长了/, `${m[1]}：${err.message}`); big++; }
  }
  assert.ok(made >= 20, `造出了 ${made} 张（${[...seen].join(' ')}），放不下 ${big} 张`);
});

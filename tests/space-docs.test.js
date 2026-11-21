// 视觉交互第 3 批 Task 8：手册和示例页里的三维图照抄就能画；新命令每样在手册里有例子
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSpace } from '../kit/src/spacespec.js';
import { docsForSubject, componentDoc } from '../kit/src/subject.js';

const manual = readFileSync('CLAUDE-PROJECT.md', 'utf8');
const third = manual.slice(manual.indexOf('## 三、组件参考'), manual.indexOf('\n## 四、'));
const spacesIn = (text) => [...text.matchAll(/```space\n([\s\S]*?)```/g)].map((m) => m[1]);
const demo = spacesIn(readFileSync('kit/examples/space-demo.html', 'utf8'));
const inManual = spacesIn(third);

// 每张图：读得懂；滑块取初始值时，不指着别的东西的命令的式子都算得出来
function check(src, where) {
  const g = parseSpace(src);
  const v = {};
  for (const c of g.cmds) if (c.kind === 'slider') v[c.name] = c.init;
  for (const c of g.cmds) {
    const at = `${where}：${c.srcLine}`;
    if (c.kind === 'let') assert.doesNotThrow(() => { v[c.name] = c.expr(v); }, at);
    if (c.kind === 'plane' && c.eq) assert.ok(Number.isFinite(c.eq({ ...v, x: 0.1, y: 0.2, z: 0.3 })), at);
    if (c.kind === 'surface' && c.form === 'z') assert.ok(Number.isFinite(c.f({ ...v, x: 0.123, y: 0.077 })), at);
    if (c.kind === 'surface' && c.form === 'eq') assert.ok(Number.isFinite(c.F({ ...v, x: 0.123, y: 0.077, z: 0.211 })), at);
    if (c.kind === 'surface' && c.form === 'param') { const p = c.p({ ...v, [c.params[0]]: c.ranges[0][0](v) + 0.01, [c.params[1]]: c.ranges[1][0](v) + 0.01 }); assert.ok(p.length === 3 && p.every(Number.isFinite), at); }
    if (c.kind === 'curve') { const p = c.p({ ...v, [c.param]: (c.from(v) + c.to(v)) / 2 }); assert.ok(p.length === 3 && p.every(Number.isFinite), at); }
    if (c.kind === 'revolve') assert.ok(Number.isFinite(c.f({ ...v, x: (c.a(v) + c.b(v)) / 2 })), at);
    if (c.kind === 'field') assert.ok([c.P, c.Q, c.R].every((f) => Number.isFinite(f({ ...v, x: 0.1, y: 0.2, z: 0.3 }))), at);
    if (c.kind === 'pick') { const ts = c.targets(v); assert.ok(ts.length >= 1, at); }
    if (c.kind === 'eigen') assert.equal(c.A(v).length, 3, at);
  }
  return g;
}

test('示例页：至少 20 张三维图，每张都读得懂', () => {
  assert.ok(demo.length >= 20, `只有 ${demo.length} 张`);
  demo.forEach((src, i) => check(src, `space-demo 第 ${i + 1} 张`));
});

test('示例页里学生能动手的图占多数（滑块、拖点），有目标或点一点的至少 18 张', () => {
  const tasks = demo.filter((src) => parseSpace(src).cmds.some((c) => c.kind === 'goal' || c.kind === 'pick'));
  assert.ok(tasks.length >= 18, `${tasks.length}/${demo.length}`);
  assert.ok(demo.every((src) => parseSpace(src).cmds.some((c) => c.kind === 'slider' || c.kind === 'pick' || (c.kind === 'let' && c.mods.drag))));
});

test('手册里三维图的例子照抄读得懂（真的画一遍在 npm run check:pages 的 tools/manual-figs.mjs），第 3 批的命令每样至少一个例子', () => {
  assert.ok(inManual.length >= 6, `手册里只有 ${inManual.length} 个 space 例子`);
  const kinds = new Set();
  inManual.forEach((src, i) => check(src, `手册第 ${i + 1} 个例子`).cmds.forEach((c) => kinds.add(c.kind === 'plane' && c.eq ? 'plane-eq' : c.kind === 'surface' ? `surface-${c.form}` : c.kind)));
  for (const k of ['plane-eq', 'meet', 'angle', 'foot', 'eigen', 'surface-z', 'surface-param', 'surface-eq', 'curve', 'section', 'tangent', 'revolve', 'disk', 'shell', 'region', 'solid', 'column', 'slice', 'field', 'normals', 'goal', 'pick']) assert.ok(kinds.has(k), `手册里没有 ${k} 的例子`);
  for (const w of ['int3(', 'flux(', 'lineint3(', 'angledeg(', 'dist(', 'angle: rad', 'drag on=', 'pick "', 'z: ']) assert.ok(third.includes(w), `手册里没写 ${w}`);
});

test('高数的课拿得到三维图的完整写法；线代的精简版里有指路的那一行', () => {
  assert.match(componentDoc(third, 'space', '高数'), /surface/);
  assert.match(componentDoc(third, 'space', '线代'), /eigen/);
  const brief = docsForSubject(third, '线代');
  assert.match(brief, /### space：/);
  assert.match(brief.slice(brief.indexOf('### space：')), /见完整写法/);
});

test('space 的精简版不超过 1.6 KiB（每一轮都带，线代、高数两门课）', () => {
  const sec = third.slice(third.indexOf('### space：'));
  const brief = sec.slice(0, sec.indexOf('<!-- 完整写法 -->'));
  assert.ok(sec.indexOf('<!-- 完整写法 -->') > 0 && sec.indexOf('<!-- 完整写法 -->') < sec.indexOf('\n### ', 5), 'space 一节要有完整写法');
  assert.ok(Buffer.byteLength(brief, 'utf8') <= 1640, `精简版 ${Buffer.byteLength(brief, 'utf8')} 字节`);
});

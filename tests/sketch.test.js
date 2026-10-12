import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSketch, sketchMarkup, sketchLabels, sketchTexts, sketchDefs } from '../kit/src/svgsafe.js';
import { parseDerive, splitRelation } from '../kit/src/derivespec.js';

const ok = (src) => {
  const r = parseSketch(src);
  assert.deepEqual(r.errors, [], src);
  return r.items;
};
const errs = (src) => parseSketch(src).errors;

test('sketch：认图形元素、文字、公式，顶层元素按顺序编号', () => {
  const items = ok([
    '<rect x="20" y="20" width="120" height="80" class="blue fill"/>',
    '<line x1="20" y1="60" x2="140" y2="60" class="dashed"></line>',
    '<path d="M 20 140 Q 80 100 140 140" class="arrow pink"/>',
    '<g transform="translate(10, 5)"><circle cx="0" cy="0" r="4" fill="yellow"/><ellipse cx="9" cy="0" rx="3" ry="2"/></g>',
    '<text x="80" y="170" text-anchor="middle">分块 <tspan font-size="12">A₁</tspan></text>',
    '<tex x="80" y="10" color="pink">A_{1} = \\calc{1+1}</tex>',
    '<!-- 注释不算 -->',
  ].join('\n'));
  assert.deepEqual(items.map((n) => n.tag), ['rect', 'line', 'path', 'g', 'text', 'tex']);
  const svg = sketchMarkup(items);
  assert.match(svg, /^<rect data-cmd="1" class="sk sk-rect sk-fill" style="--sk:var\(--blue\)" x="20"/);
  assert.match(svg, /<line data-cmd="2" class="sk sk-line sk-dashed"/);
  assert.match(svg, /<path data-cmd="3" class="sk sk-path sk-arrow" style="--sk:var\(--pink\)" d="M 20 140 Q 80 100 140 140" marker-end="url\(#lk-sk-a-pink\)"\/>/);
  assert.match(svg, /<g data-cmd="4" class="sk sk-g" transform="translate\(10, 5\)"><circle class="sk sk-circle" style="fill:var\(--yellow\)" cx="0"/);
  assert.match(svg, /<text data-cmd="5" class="sk sk-text" x="80" y="170" text-anchor="middle" font-size="18">分块 <tspan class="sk sk-tspan" font-size="12">A₁<\/tspan><\/text>/);
  assert.ok(!/<tex[\s>]/.test(svg), '<tex> 不进 SVG，盖在图上画');
  assert.deepEqual(sketchLabels(items), [{ cmd: 6, x: 80, y: 10, anchor: 'middle', color: 'var(--pink)', size: null, tex: 'A_{1} = \\calc{1+1}' }]);
  assert.deepEqual(sketchTexts(items), [{ cmd: 5, text: '分块 A₁' }, { cmd: 6, text: 'A_{1} = \\calc{1+1}' }]);
  assert.match(sketchDefs(), /<marker id="lk-sk-a-blue"[^>]*><path d="M 0 1 L 9 5 L 0 9 z" style="fill:var\(--blue\)"\/><\/marker>/);
});

test('sketch：不安全、不认识的一律报出来', () => {
  assert.match(errs('<script>alert(1)</script>')[0], /不认 <script>/);
  assert.match(errs('<foreignObject><div>x</div></foreignObject>')[0], /不认 <foreignObject>/);
  assert.match(errs('<image href="https://x.com/a.png"/>')[0], /不认 <image>/);
  assert.match(errs('<rect x="0" y="0" width="10" height="10" onclick="x()"/>')[0], /不能写 onclick=/);
  assert.match(errs('<path d="M0 0" style="fill:red"/>')[0], /不能写 style=（颜色写 class="blue"/);
  assert.match(errs('<a href="#"><rect/></a>')[0], /不认 <a>/);
  assert.match(errs('<rect x="0" y="0" width="10" height="10" fill="#ff0000"/>')[0], /颜色只认 yellow \/ pink/);
  assert.match(errs('<rect x="1em" y="0" width="10" height="10"/>')[0], /x="1em" 要写数/);
  assert.match(errs('<path d="M0 0 L url(#x)"/>')[0], /d 只能写路径命令/);
  assert.match(errs('<rect class="wavy" x="0" y="0" width="1" height="1"/>')[0], /class 只认颜色名/);
  assert.match(errs('<circle cx="1" cy="1" r="1" id="c"/>')[0], /不能写 id=/);
  assert.match(errs('<svg viewBox="0 0 1 1"></svg>')[0], /不用写 <svg>/);
  assert.match(errs('<g><rect x="0" y="0" width="1" height="1"/>')[0], /<g> 没有写 <\/g>/);
  assert.match(errs('<g></text>')[0], /<\/text> 和前面的开头对不上/);
  assert.match(errs('写在外面的字')[0], /多出来的文字「写在外面的字」/);
  assert.match(errs('<tspan>x</tspan>')[0], /<tspan> 只能写在 <text> 里/);
  assert.match(errs('')[0], /什么也没画/);
  // 文字里的 < > & 照样转义
  const t = sketchMarkup(ok('<text x="1" y="1">a &lt; b &amp; c</text>'));
  assert.match(t, />a &lt; b &amp; c<\/text>/);
});

test('splitRelation：在第一个最外层的关系符处切开', () => {
  assert.deepEqual(splitRelation('A^2 = (\\alpha\\beta^T)(\\alpha\\beta^T)'), ['A^2', '= (\\alpha\\beta^T)(\\alpha\\beta^T)']);
  assert.deepEqual(splitRelation('= 3A'), ['', '= 3A']);
  assert.deepEqual(splitRelation('\\Rightarrow A^n = 3^{n-1}A'), ['', '\\Rightarrow A^n = 3^{n-1}A']);
  assert.deepEqual(splitRelation('x \\le 3'), ['x', '\\le 3']);
  assert.deepEqual(splitRelation('\\left(x\\right) \\leq y'), ['\\left(x\\right)', '\\leq y']);
  // 大括号、矩阵环境里的 = 不切
  assert.deepEqual(splitRelation('f_{a=1} = 2'), ['f_{a=1}', '= 2']);
  assert.deepEqual(splitRelation('\\begin{bmatrix}a=1\\end{bmatrix} = B'), ['\\begin{bmatrix}a=1\\end{bmatrix}', '= B']);
  assert.deepEqual(splitRelation('\\text{由结合律}'), ['', '\\text{由结合律}']);
  // \le 后面紧跟字母的不是 \le（\left 不能当成 \le + ft）
  assert.deepEqual(splitRelation('\\left( a \\right)'), ['', '\\left( a \\right)']);
});

test('parseDerive：一行一拍，// 后面是旁注', () => {
  const d = parseDerive([
    'id: d-1',
    'title: 推 A²',
    'auto: 1.5',
    'A^2 = (\\alpha\\beta^{\\mathrm T})(\\alpha\\beta^{\\mathrm T})',
    '    = \\alpha(\\beta^{\\mathrm T}\\alpha)\\beta^{\\mathrm T}   // 结合律：中间先乘',
    '    = \\calc{1+2}\\,A',
  ].join('\n'));
  assert.equal(d.fields.id, 'd-1');
  assert.equal(d.auto, 1.5);
  assert.equal(d.start, 1);
  assert.deepEqual(d.lines.map((l) => [l.left, l.note]), [['A^2', ''], ['', '结合律：中间先乘'], ['', '']]);
  assert.equal(d.lines[1].right, '= \\alpha(\\beta^{\\mathrm T}\\alpha)\\beta^{\\mathrm T}');
  assert.equal(parseDerive('start: all\na = 1\n= 2').start, 2);
  assert.equal(parseDerive('auto: on\na = 1').auto, 1.4);
  assert.equal(parseDerive('auto: off\na = 1').auto, 0);
  assert.throws(() => parseDerive('id: d\n'), /至少写一行式子/);
  assert.throws(() => parseDerive('$a = 1$'), /不用 \$/);
  assert.throws(() => parseDerive('start: 5\na = 1'), /start: 写 1 到 1/);
  assert.throws(() => parseDerive('auto: 99\na = 1'), /auto: 写每行之间隔几秒/);
  // 只有旁注没有式子
  assert.throws(() => parseDerive(' // 只有旁注'), /只有旁注/);
});

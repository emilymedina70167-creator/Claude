// 舞台上的式子（kit/src/stage/types/tex.js）：造、部件的写法（对的、写错报什么）、retex / next 改了什么（同名的项从哪来、带着颜色）、
// 放大、划掉、量过的位置怎么用、给老师看的现状、说明里的例子照抄能演
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { tex, scanTerms, parseLine, prepTex, texHtml, texPlain, geometry, zoomBox, MAX_LINES } from '../kit/src/stage/types/tex.js';

const run = (scene, src) => { for (const c of parseScript(src)) scene.apply(c); return scene; };
const err = (scene, line) => dryRun(scene, line)[0]?.error;
const F = 'tex f = "\\hl{a}{x^2} + \\hl{b}{2x} + \\hl{c}{1}"';

test('\\hl{名字}{…} 一项一项找出来：能套括号、不认 \\hline；少括号、名字不对、套着写、重名都报错', () => {
  assert.deepEqual(scanTerms('\\hl{a}{x^{2}} + \\hline \\hl{b}{\\frac{1}{2}}').map((t) => [t.name, t.body]), [['a', 'x^{2}'], ['b', '\\frac{1}{2}']]);
  assert.deepEqual(scanTerms('x + 1'), []);
  assert.throws(() => scanTerms('\\hl{a}x'), /\\hl 要写成 \\hl\{名字\}\{这一项\}/);
  assert.throws(() => scanTerms('\\hl{1a}{x}'), /只用英文字母和数字/);
  assert.throws(() => scanTerms('\\hl{a}{\\hl{b}{x}}'), /不能再套/);
  assert.throws(() => scanTerms('\\hl{a}{x} + \\hl{a}{y}'), /「a」用了两次/);
});

test('交给 KaTeX：大号行内排，& 是对齐点（只认第一个）；写错了用 KaTeX 的话说哪里错，位置照老师写的数', () => {
  assert.equal(prepTex('x &= 1 & 2'), '\\displaystyle x \\htmlData{anchor=1}{}= 1  2');
  assert.equal(prepTex('a \\& b'), '\\displaystyle a \\& b');
  const html = texHtml('\\hl{a}{x^2} = 1');
  assert.match(html, /data-term="a"/);
  assert.match(texHtml('x &= 1'), /data-anchor="1"/);
  assert.throws(() => texHtml('\\frac{1}{'), /公式写错了（KaTeX：.*expected '\}'/);
  assert.throws(() => texHtml('x^2 \\foo y'), /Undefined control sequence: \\foo at position 5/);
  assert.throws(() => parseLine(''), /公式是空的/);
  assert.throws(() => parseLine('x'.repeat(401)), /一行公式太长/);
  assert.deepEqual(parseLine(' \\hl{a}{x} = 2 ').terms, [{ name: 'a', body: 'x' }]);
});

test('话里的小块写成普通的字：分式、根号、上标、希腊字母', () => {
  assert.equal(texPlain('x^2'), 'x²');
  assert.equal(texPlain('\\frac{1}{2}'), '1/2');
  assert.equal(texPlain('\\sqrt{x+1}'), '√(x+1)');
  assert.equal(texPlain('2\\cdot \\pi r'), '2· π r');
  assert.equal(texPlain('(x+1)^{2}'), '(x+1)²');
});

test('造：一行，有名字的项是部件（带普通字的写法）；放在已有东西的下面；写错了说怎么写', () => {
  const s = run(new Scene(), F);
  const o = s.objects.get('f');
  assert.equal(o.type, 'tex');
  assert.equal(o.lines.length, 1);
  assert.deepEqual(o.terms.map((t) => [t.key, t.value, t.label]), [['a', 'x^2', 'x²'], ['b', '2x', '2x'], ['c', '1', '1']]);
  assert.ok(o.terms.every((t) => t.paint === null && t.glow === false && t.covered === false && t.struck === false));
  assert.match(err(new Scene(), 'tex f "x"'), /要写成 tex 名字 = "公式"/);
  assert.match(err(new Scene(), 'tex f = "\\frac{1}{"'), /公式写错了/);
  const two = run(new Scene(), 'array a = 1 2 3\n' + F);
  assert.ok(two.objects.get('f').origin.y > 64);
  assert.ok(Math.abs(two.objects.get('f').origin.cx - (3 * 76 - 12) / 2) < 1, '和上面的东西居中对齐');
});

test('部件的写法：f.a 是现在这一行叫 a 的项；写错了列出有哪些', () => {
  const s = run(new Scene(), F);
  assert.equal(s.parts('f.b')[0].value, '2x');
  assert.equal(tex.ref(s.parts('f.b')[0]), 'f.b');
  assert.equal(s.parts('f').length, 3);
  assert.throws(() => s.parts('f.z'), /f 现在这一行没有叫「z」的项（有的是：a、b、c）/);
  assert.throws(() => s.parts('f#1'), /式子的项写 f\.名字/);
  assert.throws(() => run(new Scene(), 'tex g = "x+1"').parts('g.a'), /用 \\hl\{名字\}\{…\} 给一项起名字/);
});

test('retex：现在这一行换掉，同名的项接着用（带着颜色），新的项是新的；a2=a 从 a 分出来', () => {
  const s = run(new Scene(), F + '\npaint f.a g1\nglow f.b\ncover f.c');
  const o = s.objects.get('f');
  const fx = s.apply(parseScript('retex f "\\hl{c}{1} + \\hl{b}{2x} + \\hl{a}{x^2}"')[0]);
  assert.equal(o.lines.length, 1);
  assert.equal(o.rev, 2);
  assert.equal(fx.mode, 'retex');
  assert.deepEqual(fx.pairs.sort(), [['a', 'a'], ['b', 'b'], ['c', 'c']]);
  assert.equal(o.terms.find((t) => t.key === 'a').paint, 'g1', '颜色跟着项走');
  assert.equal(o.terms.find((t) => t.key === 'c').covered, true, '挖空的还挖着');
  assert.equal(o.terms.find((t) => t.key === 'b').glow, false, '点亮是一时的，换了式子就灭');
  const fx2 = s.apply(parseScript('retex f "\\hl{a}{x}\\cdot\\hl{a2}{x} + \\hl{d}{3}" a2=a')[0]);
  assert.deepEqual(fx2.pairs, [['a2', 'a'], ['a', 'a']]);
  assert.deepEqual(fx2.gone.sort(), ['b', 'c']);
  assert.equal(o.terms.find((t) => t.key === 'a2').paint, 'g1', '分出来的也带着颜色');
  assert.equal(o.terms.find((t) => t.key === 'd').paint, null);
  assert.match(err(s, 'retex f "x" zz=a'), /新的式子里没有叫 zz 的项/);
  assert.match(err(s, 'retex f "\\hl{q}{x}" q=zz'), /原来的式子里没有叫 zz 的项/);
  assert.match(err(s, 'retex f'), /要写成 retex f "新的公式"/);
  assert.match(err(s, 'retex g "x"'), /舞台上没有叫「g」的式子/);
  assert.match(err(s, 'retex f "\\frac{"'), /公式写错了/);
});

test('next：往下写一行，上一行留着；最多留几行，再写最上面那行收掉；放大的收回', () => {
  const s = run(new Scene(), F + '\nmagnify f.a');
  const o = s.objects.get('f');
  const fx = s.apply(parseScript('next f "= \\hl{a}{(x+1)^2}"')[0]);
  assert.equal(fx.mode, 'next');
  assert.equal(o.lines.length, 2);
  assert.deepEqual(o.lines.map((l) => l.id), [1, 2]);
  assert.deepEqual(fx.pairs, [['a', 'a']]);
  assert.deepEqual(o.terms.map((t) => t.key), ['a']);
  assert.equal(o.zoom, null);
  assert.throws(() => s.parts('f.b'), /没有叫「b」的项/, '上一行的项不再能指');
  for (let i = 0; i < MAX_LINES; i++) run(s, `next f "= ${i}"`);
  assert.equal(o.lines.length, MAX_LINES);
  assert.equal(o.lines[0].id, 3, '最上面的几行收掉了');
});

test('magnify / strike：放大一项（写在现在这一行下面）、划掉一项；写错了说清楚', () => {
  const s = run(new Scene(), F);
  const o = s.objects.get('f');
  run(s, 'magnify f.b\nstrike f.c');
  assert.equal(o.zoom, 'b');
  assert.equal(o.terms.find((t) => t.key === 'c').struck, true);
  const z = zoomBox(o), t = tex.partBox(o, o.terms[1]);
  const g = geometry(o);
  assert.ok(z.y > g.lines[0].y + g.lines[0].h, '放大的在式子下面');
  assert.ok(Math.abs(z.x + z.w / 2 - (t.x + t.w / 2)) < 0.5 && z.w > t.w * 1.9, '横着对准那一项、放大两倍');
  assert.ok(tex.objectBox(o).h > g.lines[0].h + z.h, '镜头把放大的也算进去');
  assert.match(err(s, 'magnify f'), /magnify 要指着式子里的一项/);
  assert.match(err(s, 'strike f'), /不是整个式子/);
  assert.match(err(s, 'magnify f.q'), /没有叫「q」的项/);
  run(s, 'unmagnify f\nunstrike f');
  assert.equal(o.zoom, null);
  assert.ok(o.terms.every((t) => !t.struck));
});

test('位置：画面量过（o.geo 和 o.rev 对得上）就用量的；式子一变旧的不算数，先按字数估', () => {
  const s = run(new Scene(), F);
  const o = s.objects.get('f');
  const est = geometry(o);
  assert.equal(est.estimated, true);
  assert.ok(est.lines[0].terms.a.x < est.lines[0].terms.b.x && est.lines[0].terms.b.x < est.lines[0].terms.c.x, '估的位置也是从左到右');
  o.geo = { rev: o.rev, lines: [{ id: 1, x: 10, y: 20, w: 200, h: 50, eq: null, terms: { a: { x: 12, y: 22, w: 30, h: 40 }, b: { x: 80, y: 24, w: 40, h: 36 }, c: { x: 180, y: 24, w: 20, h: 36 } } }] };
  assert.deepEqual(tex.partBox(o, o.terms[0]), { x: 12, y: 22, w: 30, h: 40 });
  assert.deepEqual(tex.objectBox(o), { x: 10, y: 20, w: 200, h: 50 });
  run(s, 'retex f "\\hl{a}{x}"');
  assert.equal(geometry(o).estimated, true, '换了式子，量的作废');
});

test('共用的指令对项都有用：染色、点亮、挖空、灰掉、闪、学生点、连线、贴字、话里的小块', () => {
  const s = run(new Scene(), F);
  assert.deepEqual(dryRun(s, 'paint f.a g2\nglow f.b\ncover f.c\ndim f.a\npulse f.b\nlink f.a f.c g3\nlabel n f.a "平方项" side=above tone=note\nsay "看 {f.a}"\nask tap f "哪一项是一次项？" expect=f.b'), []);
  assert.deepEqual(dryRun(s, 'ask value "x = ?" answer=-1'), []);
  assert.match(err(s, 'ask drag f.a'), /式子不能拖/);
});

test('给老师看的现状：每一行的写法、现在是哪一行、有名字的项和它们的样子', () => {
  const s = run(new Scene(), F + '\npaint f.a g1\nnext f "= \\hl{a}{x^2} + \\hl{b}{2\\cdot x}"\nglow f.b\nstrike f.a\nmagnify f.b');
  const t = s.stateText();
  assert.match(t, /名字\.a 是用 \\hl\{a\}\{…\} 起了名字的那一项/);
  assert.match(t, /式子 f（推导写了 2 行，上面的变淡留着，最下面一行是现在的）/);
  assert.match(t, /第 1 行：\\hl\{a\}\{x\^2\} \+ \\hl\{b\}\{2x\} \+ \\hl\{c\}\{1\}/);
  assert.match(t, /现在：= \\hl\{a\}\{x\^2\} \+ \\hl\{b\}\{2\\cdot x\}/);
  assert.match(t, /f\.a「x\^2」（蓝、划掉），f\.b「2\\cdot x」（亮、放大着）/);
  assert.match(run(new Scene(), 'tex g = "x+1"').stateText(), /现在这一行没有起名字的项/);
});

test('说明里的例子照抄能演（一行不错），每一条指令写法也能演', () => {
  const s = new Scene();
  assert.deepEqual(dryRun(s, tex.example), []);
  run(s, tex.example);
  assert.equal(s.waiting.kind, 'tap');
  const ready = run(new Scene(), tex.example.split('\n')[0]);
  const lines = tex.doc.split('\n').map((l) => l.split(/\s{2,}|\s\/\s/)[0].trim()).filter((l) => /^[a-z]+ /.test(l));
  assert.ok(lines.length >= 6, `说明里的指令 ${lines.length} 条`);
  const bad = [];
  for (const l of lines) { const e = dryRun(ready, l); if (e.length) bad.push(`${l} → ${e[0].error}`); }
  assert.deepEqual(bad, []);
  assert.doesNotMatch(tex.doc + tex.hint + tex.example, /[他她]/);
});

test('扣着的一项：学生看的小块不写它的内容；写给老师的写内容、说一声扣着', async () => {
  const { chipTextOf, tapValueOf } = await import('../kit/src/stage/scene.js');
  const s = run(new Scene(), `${F}\ncover f.c`);
  const o = s.objects.get('f');
  const [c] = s.parts('f.c');
  assert.equal(chipTextOf(c, o), 'f 里扣着的一项');
  assert.equal(tapValueOf(c), '1，扣着');
  assert.equal(chipTextOf(s.parts('f.b')[0], o), '2x', '没扣着的照旧写它的字');
});

// —— 舞台主线第一轮 L3-2：矩阵环境里的 & 以前被当成对齐点吃掉，行列式三列粘在一起 ——
test('L3-2：矩阵环境里的 & 留着；环境外面的第一个 & 照旧是对齐点、别的去掉', () => {
  const det = '|\\lambda E - A| = \\begin{vmatrix}\\lambda-2&-2&2\\\\-2&\\lambda+1&4\\end{vmatrix}';
  assert.equal(prepTex(det), `\\displaystyle ${det}`);
  assert.equal(prepTex('x &= \\begin{pmatrix}1&2\\\\3&4\\end{pmatrix} & y'), '\\displaystyle x \\htmlData{anchor=1}{}= \\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}  y');
  assert.equal(prepTex('f(x) = \\begin{cases}1 & x>0\\\\0 & x\\le 0\\end{cases}'), '\\displaystyle f(x) = \\begin{cases}1 & x>0\\\\0 & x\\le 0\\end{cases}');
  // 照旧的两条
  assert.equal(prepTex('x &= 1 & 2'), '\\displaystyle x \\htmlData{anchor=1}{}= 1  2');
  assert.equal(prepTex('a \\& b'), '\\displaystyle a \\& b');
});

// table T engine=…（主线第五轮，设计第 3 节）：引擎的过程表摆成舞台的表——行名列名、给定的格、答案、先后不论的组、错法都从引擎来
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, dryRun } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { evalMeasure } from '../kit/src/stage/rules.js';

const run = (s, src, opt) => { let fx; for (const c of parseScript(src)) fx = s.apply(c, opt); return fx; };
const make = (src) => { const s = new Scene(); run(s, src); return s; };
const stu = (s, src) => s.apply(parseScript(src)[0], { by: 'student', open: 'edit' });
const said = (fx) => [fx.judged?.verdict?.why, ...(fx.judged?.facts || []), ...(fx.judged?.after || [])].filter(Boolean).join('\n');
const err = (s, src) => dryRun(s, src)[0]?.error || '';
const SHELL = 'table T engine=sort algo=shell array="49 38 65 97 76 13 27 49" gaps="5 3 1"';
const wrong = (s) => evalMeasure(s, 'wrong(T)').value;

test('造表：行名列名、空格、答案都从引擎来；现状里写是照哪个引擎的', () => {
  const s = make(`${SHELL}\nopen T edit`);
  const o = s.objects.get('T');
  assert.equal(o.cols, 8);
  assert.equal(o.rows, o.rowNames.length);
  assert.ok(o.cells.some((x) => x.value === ''));
  assert.match(s.stateText(), /表 T（\d+ 行 8 列）[^\n]*照 sort 的过程表/);
  assert.match(s.stateText(), /答案：收下了/);
  // 照答案填一格：不算不一样
  const blank = o.cells.find((x) => x.value === '');
  stu(s, `write T.${blank.r},${blank.c} ${o.key[blank.r - 1][blank.c - 1].replace(/[′']/g, '')}`);
  assert.equal(wrong(s), 0);
});

test('一组里先后不论（页面置换同一次访问的几个物理块）：调换着填也对；一组没填完不算错', () => {
  const s = make('table T engine=paging algo=fifo frames=3 refs="7 0 1 2 0 3 0 4"\nopen T edit');
  const o = s.objects.get('T');
  const full = (g) => g.every((k) => { const x = o.cells.find((c) => c.key === k); return o.key[x.r - 1][x.c - 1] !== ''; });
  const g = o.engine.groups.find((x) => x.length >= 3 && full(x));
  const cells = g.map((k) => o.cells.find((x) => x.key === k));
  const ans = cells.map((x) => o.key[x.r - 1][x.c - 1]);
  const turned = [...ans.slice(1), ans[0]]; // 轮着换一位
  stu(s, `write T.${cells[0].r},${cells[0].c} ${turned[0]}`);
  assert.equal(wrong(s), 0, '一组没填完：不算不一样');
  for (let i = 1; i < cells.length; i++) stu(s, `write T.${cells[i].r},${cells[i].c} ${turned[i]}`);
  assert.equal(wrong(s), 0, '同一组调换着填：对');
  stu(s, `write T.${cells[0].r},${cells[0].c} 99`);
  assert.ok(wrong(s) >= 1);
});

test('表下面单独的几格（ASL）：现状里写给老师，学生看不到', () => {
  const s = make('table T engine=hash hash="19 14 23 01 68 20" p=13');
  assert.match(s.stateText(), /表外的答案（学生看不到）：ASL成功 = 7\/6；ASL失败 = 23\/13/);
});

test('认错法：学生把一行照引擎认得的错法填完——那一下告诉老师像哪种；填对的那一行不说', () => {
  const s = make(`${SHELL}\nopen T edit`);
  const o = s.objects.get('T');
  const v = o.engine && s.type(o).variantsOf(o)[0];
  assert.ok(v, '希尔有错法');
  // 找一行：错法的这一行和对的不一样
  const line = o.engine.lines.find((ks) => ks.some((k) => { const x = o.cells.find((c) => c.key === k); return v.key[x.r - 1][x.c - 1] !== o.key[x.r - 1][x.c - 1]; }));
  const cells = line.map((k) => o.cells.find((c) => c.key === k));
  let fx;
  for (const x of cells) fx = stu(s, `write T.${x.r},${x.c} ${v.key[x.r - 1][x.c - 1].replace(/[′']/g, '')}`);
  assert.match(said(fx), new RegExp(`像是：${v.label.replace(/^像是/, '').slice(0, 6)}`));
  assert.match(s.stateText(), /像是：/);
  // 另一张：照对的填完同一行，不说像
  const s2 = make(`${SHELL}\nopen T edit`);
  for (const x of cells) fx = stu(s2, `write T.${x.r},${x.c} ${o.key[x.r - 1][x.c - 1].replace(/[′']/g, '')}`);
  assert.doesNotMatch(said(fx), /像是/);
});

test('存档点回去、同名重造：引擎的那一套跟着（答案、组、错法）', () => {
  const s = make(`${SHELL}\nopen T edit`);
  const o = () => s.objects.get('T');
  const b = o().cells.filter((x) => x.value === '');
  stu(s, `write T.${b[0].r},${b[0].c} 1`);
  run(s, 'keep T "k1"');
  stu(s, `write T.${b[1].r},${b[1].c} 2`);
  run(s, 'back T "k1"');
  assert.equal(o().engine.name, 'sort');
  assert.equal(o().cells.find((x) => x.key === b[1].key).value, '');
  // 回去以后引擎的那一套还在、照旧判得出不一样：那一格写的 1 不是答案（审查：以前这里的断言恒真）
  assert.equal(Object.keys(o().engine.cells).length > 0, true);
  const w0 = wrong(s);
  assert.equal(w0, o().key[b[0].r - 1][b[0].c - 1] === '1' ? 0 : 1);
  stu(s, `write T.${b[1].r},${b[1].c} ${o().key[b[1].r - 1][b[1].c - 1]}`);
  assert.equal(wrong(s), w0, '回去以后写对一格：不一样的格数不变');
  const last0 = o().key.at(-1).join(' ');
  run(s, 'table T engine=sort algo=shell array="9 8 7 6 5 4 3 2" gaps="5 3 1"');
  assert.notEqual(o().key.at(-1).join(' '), last0);
  assert.equal(o().key.at(-1).join(' '), '2 3 4 5 6 7 8 9');
});

test('写错的当场报：字段写错、放不下、和 key= rows= cols= 一起写、没有这个引擎', () => {
  const s = new Scene();
  assert.match(err(s, 'table T engine=sort algo=shell array="49 38 65" gap="5 3 1"'), /gap[^\n]*gaps/);
  assert.match(err(s, 'table T engine=sort algo=bubble array="13 12 11 10 9 8 7 6 5 4 3 2 1"'), /舞台上放不下/);
  assert.match(err(s, `${SHELL} key="1 2"`), /engine= 的表[^\n]*不写 key=/);
  assert.match(err(s, `${SHELL} rows="a b"`), /engine= 的表[^\n]*不写 rows=/);
  assert.match(err(s, 'table T engine=sorrt array="1 2"'), /没有「sorrt」这个引擎/);
  assert.match(err(s, 'table T = 1 2 / 3 4 engine=sort'), /engine= 的表不写格子/);
});

test('打勾的格（缺页）：学生点一格是从 √ × 里挑；不是数的答案（进程名）自动给输入框', async () => {
  const { tableRules } = await import('../kit/src/stage/types/table.rules.js');
  const s = make('table T engine=paging algo=fifo frames=3 refs="7 0 1 2 0 3 0 4"\nopen T edit');
  const o = s.objects.get('T');
  const mk = o.cells.find((x) => x.key === o.engine.marks[0]);
  const ask = tableRules.gestures.edit.ask(o, { to: mk, open: {} });
  assert.equal(ask.pick, true);
  assert.deepEqual(ask.choices.map((c) => c.value), ['√', '×']);
  const act = tableRules.gestures.edit.toAct(o, { to: mk, role: '√', open: {} });
  assert.match(act.src, /write T\.\d+,\d+ "√"/);
  const num = o.cells.find((x) => x.value === '' && !o.engine.marks.includes(x.key));
  assert.equal(tableRules.gestures.edit.ask(o, { to: num, open: {} }).input, 'keypad');
});

test('上限：手写的表也能到 10 行 13 列', () => {
  const s = new Scene();
  assert.equal(err(s, `table W rows="${Array.from({ length: 10 }, (_, i) => `r${i}`).join(' ')}" cols="${Array.from({ length: 13 }, (_, i) => `c${i}`).join(' ')}"`), '');
  assert.match(err(s, `table W rows="a" cols="${Array.from({ length: 14 }, (_, i) => `c${i}`).join(' ')}"`), /最多 10 行 13 列/);
});

test('答案是「空着」的格（没有换出谁的那一次）：学生不填才对、不算还空着；填了东西算不一样；不画成给定的（不把答案漏给学生）', () => {
  const s = make('table T engine=paging algo=fifo frames=3 refs="7 0 1 2 0 3 0 4"\nopen T edit');
  const o = s.objects.get('T');
  assert.ok(o.engine.empties.length > 0);
  const lone = o.engine.empties.find((k) => !o.engine.groups.some((g) => g.includes(k))); // 不在哪一组里的（「换出」那一行）
  const e = o.cells.find((x) => x.key === lone);
  assert.equal(e.value, '');
  assert.ok(!e.fixed && !e.given, '学生点得了它');
  const blank0 = evalMeasure(s, 'blank(T)').value;
  assert.ok(blank0 < o.cells.filter((x) => x.value === '').length, '答案是空着的格不算还空着');
  const fx = stu(s, `write T.${e.r},${e.c} 7`);
  assert.match(said(fx), /和答案不一样（这一格该空着）/);
  assert.equal(wrong(s), 1);
  // 该填的都照答案填上、该空的空着：算填满、都对
  stu(s, `write T.${e.r},${e.c} _`);
  for (const x of o.cells) if (x.value === '' && o.key[x.r - 1][x.c - 1] !== '') stu(s, `write T.${x.r},${x.c} "${o.key[x.r - 1][x.c - 1]}"`);
  assert.equal(evalMeasure(s, 'blank(T)').value, 0);
  assert.equal(wrong(s), 0);
  assert.match(s.stateText(), /表 T/);
  assert.doesNotMatch(s.stateText(), /还空着/);
});

test('一组里有还没装进页的物理块（答案里有空着的）：那一页写在哪个块都对，不用把空的块填上', () => {
  const s = make('table T engine=paging algo=fifo frames=3 refs="7 0 1 2 0 3 0 4"\nopen T edit');
  const o = s.objects.get('T');
  // 第 1 次访问：三个块里只有一个 7。写在块 3 上
  const fx = stu(s, 'write T.3,1 7');
  assert.match(said(fx), /和答案一样/);
  assert.equal(wrong(s), 0);
  assert.ok(!s.stateText().match(/还空着：[^\n]*块 1×7/), '这一列的块不再算还空着');
  // 同一列再写一个：多了，不一样
  stu(s, 'write T.1,1 5');
  assert.ok(wrong(s) >= 1);
});

test('列名有重的（访问串 7 0 1 2 0 …）：告诉老师哪一格时带上第几列，不然「块 1×0」分不清是哪一个 0', async () => {
  const { cellName } = await import('../kit/src/stage/types/table.js');
  const s = make('table T engine=paging algo=fifo frames=3 refs="7 0 1 2 0 3 0 4"');
  const o = s.objects.get('T');
  const at = (r, c) => o.cells.find((x) => x.r === r && x.c === c);
  assert.equal(cellName(o, at(1, 2)), '块 1×第 2 列（0）');
  assert.equal(cellName(o, at(1, 5)), '块 1×第 5 列（0）');
  assert.equal(cellName(o, at(1, 1)), '块 1×7'); // 不重的照旧
  const t = make('table U = 1 2 / 3 4 rows="a a" cols="x y"').objects.get('U');
  assert.equal(cellName(t, t.cells.find((x) => x.r === 2 && x.c === 1)), '第 2 行（a）×x');
});

test('散列表走过程表（列名是地址 0～12）：照线性探测填对——都对、不算还空着；照平方探测放一个——那一列像是按平方探测探的', () => {
  const src = 'table H engine=hash hash="19 14 23 01 68 20 84 27" p=13\nopen H edit';
  const s = make(src);
  const o = s.objects.get('H');
  assert.deepEqual(o.colNames.slice(0, 3), ['0', '1', '2']);
  assert.equal(o.rowNames.length, 2);
  const put = (sc, r, c, v) => sc.apply(parseScript(`write H.${r},${c} ${v}`)[0], { by: 'student', open: 'edit' });
  for (const x of o.cells) if (o.key[x.r - 1][x.c - 1] !== '' && x.value === '') put(s, x.r, x.c, o.key[x.r - 1][x.c - 1]);
  assert.equal(evalMeasure(s, 'blank(H)').value, 0);
  assert.equal(evalMeasure(s, 'wrong(H)').value, 0);
  // 错法：照平方探测算出来的表，找一列和对的不一样、两格都有数的，照它填
  const s2 = make(src);
  const o2 = s2.objects.get('H');
  const v = s2.type(o2).variantsOf(o2).find((x) => /平方探测/.test(x.label));
  assert.ok(v, '有「按平方探测探的」这种错法');
  const col = o2.colNames.findIndex((_, c) => v.key[0][c] !== o2.key[0][c] && v.key[0][c] !== '' && v.key[1][c] !== '');
  assert.ok(col >= 0);
  put(s2, 1, col + 1, v.key[0][col]);
  const fx = put(s2, 2, col + 1, v.key[1][col]);
  assert.match([...(fx.judged?.facts || []), ...(fx.judged?.after || [])].join('\n'), /像是：按平方探测探的/);
});

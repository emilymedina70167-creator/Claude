// 特殊矩阵的压缩存储（engines/compress.js）：和王道、408 真题对答案；公式和「一个个数」对得上；常见错法各查一个
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compressEngine as E, locate } from '../kit/src/engines/compress.js';
import { checkAsk, misreadAnswer } from '../kit/src/stepperspec.js';

const go = (f) => { const input = E.parse(f); return { input, r: E.run(input) }; };
const vruns = (input) => E.variants(input).map((v) => ({ label: v.label, input: v.input, run: E.run(v.input) }));
const quizDiag = (input, given) => misreadAnswer(given, vruns(input).map((v) => ({ label: v.label, answer: String(E.quiz(v.input, v.run).answer) })));
const pick = (input, re) => { const v = E.variants(input).find((x) => re.test(x.label)); assert.ok(v, `没有「${re}」这种错法：${E.variants(input).map((x) => x.label).join('；')}`); return v; };
const ans = (f) => { const { input, r } = go(f); return E.quiz(input, r).answer; };

test('408 真题：对称矩阵存上三角（行优先 / 列优先）、三对角矩阵的下标', () => {
  // 2018：12 阶对称矩阵，上三角按行优先存进 C 数组 N，m[6][6] 的下标是 50
  assert.equal(ans({ matrix: 'symmetric 12', store: 'upper', at: '6 6' }), '50');
  // 2020：10 阶对称矩阵，上三角按列优先存，m[7][2] 的下标是 22（换成 m[2][7]）
  assert.equal(ans({ matrix: 'symmetric 10', store: 'upper', order: 'col', at: '7 2' }), '22');
  // 2016：100 阶三对角矩阵按行优先存，m[30][30] 的下标是 87（k = 2i + j − 3）
  assert.equal(ans({ matrix: 'tridiagonal 100', at: '30 30' }), '87');
  // 王道：对称矩阵存下三角，a[i][j]（i ≥ j）在 B[i(i−1)/2 + j − 1]；a[3][4] 换成 a[4][3] → 8
  assert.equal(ans({ matrix: 'symmetric 5', at: '3 4' }), '8');
  // 下三角矩阵：上三角区的常数 c 存在最后 B[n(n+1)/2]
  assert.equal(ans({ matrix: 'lower 5', at: '2 4' }), '15');
});

test('公式和「按存放顺序一个个数」一样（各种矩阵、行 / 列优先、下标起点）', () => {
  for (const kind of ['symmetric', 'lower', 'upper', 'tridiagonal']) {
    for (const order of ['row', 'col']) {
      for (const base of [0, 1]) {
        const input = E.parse({ matrix: `${kind} 6`, order, base: String(base), from: '1' });
        let k = 1;
        const lower = kind === 'symmetric' || kind === 'lower';
        const keep = (I, J) => (kind === 'tridiagonal' ? Math.abs(I - J) <= 1 : lower ? I >= J : I <= J);
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
          const [I, J] = order === 'row' ? [a, b] : [b, a];
          if (!keep(I, J)) continue;
          assert.equal(locate(input, I + base - 1, J + base - 1, null).k, k++, `${kind} ${order} base ${base}：a${I}${J}`);
        }
      }
    }
  }
});

test('压缩存储的错法：行优先当列优先、上三角没换成对称的、B 的下标起点差 1', () => {
  const { input, r } = go({ matrix: 'symmetric 5', at: '3 4' });
  const ask = r.steps.find((s) => s.ask?.tag === 'index').ask;
  assert.ok(checkAsk(ask, '8').ok);
  assert.equal(quizDiag(input, '10'), pick(input, /列优先/).label); // 按列优先存下三角，a43 前面有 5 + 4 + 1 = 10 个
  assert.equal(quizDiag(input, '6'), pick(input, /换成 a\[j\]\[i\]/).label); // 直接代 i(i−1)/2 + j − 1 = 3 + 3
  assert.equal(quizDiag(input, '9'), pick(input, /B 的下标/).label);
  assert.equal(quizDiag(input, '7'), '', '随手写错的不乱说');
});

test('稀疏矩阵：三元组按行优先；错法：按列扫', () => {
  const { input, r } = go({ matrix: 'sparse', data: '0 0 3 0; 0 5 0 0; 7 0 0 2', at: '3 4' });
  assert.equal(E.quiz(input, r).answer, '1 3 3 2 2 5 3 1 7 3 4 2');
  assert.equal(r.steps.at(-1).ask.answer, 3, 'a[3][4] 是表里下标 3 的那个');
  assert.equal(quizDiag(input, '3 1 7 2 2 5 1 3 3 3 4 2'), pick(input, /按列扫描|按列优先/).label);
});

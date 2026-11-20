// 「差不多相等」的写法都要先看是不是有限数（dr-final-fix 第 1 条）：
// Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)) 在有一边是 Infinity 时右边也是 Infinity，∞ <= ∞ 成立，
// 学生写 ∞ / 1/0 / 10^400 就和任何数「相等」了。扫 kit/src（舞台不算）：出现 Math.max(1, Math.abs( 的那一段顶层声明
// （一个顶层的 function / const / export …，到下一个顶层声明之前；嵌套的函数算在外面那一段里）里必须有 Number.isFinite。
// 以后新写的比较漏了，这条就红：先想清楚有一边是 ∞、NaN 时该怎么办，再加 Number.isFinite。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../kit/src/', import.meta.url).pathname;
const SKIP = new Set(['stage']);

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!SKIP.has(relative(ROOT, p))) out.push(...files(p)); } else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

// 顶层声明从第 0 列开始（function、const、let、export、async、class）；注释、空行、闭括号不算新的一段
const TOP = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\b|const\b|let\b|var\b|class\b)/;

/** 一个文件切成顶层的几段：[{ start（行号，从 1 数）, text }] */
function regions(src) {
  const lines = src.split('\n');
  const out = [];
  let cur = { start: 1, lines: [] };
  lines.forEach((line, i) => {
    if (TOP.test(line) && cur.lines.length) { out.push(cur); cur = { start: i + 1, lines: [] }; }
    cur.lines.push(line);
  });
  out.push(cur);
  return out.map((r) => ({ start: r.start, text: r.lines.join('\n') }));
}

test('扫描本身：两段顶层声明分得开，嵌套的算在外面那一段', () => {
  const rs = regions('const a = 1;\nfunction f() {\n  const g = () => 1;\n  return g;\n}\nexport const h = 2;\n');
  assert.equal(rs.length, 3);
  assert.match(rs[1].text, /const g/);
});

test('kit/src 里每一段用 Math.max(1, Math.abs( 比的都带 Number.isFinite（舞台不算）', () => {
  const bad = [];
  for (const f of files(ROOT)) {
    for (const r of regions(readFileSync(f, 'utf8'))) {
      if (r.text.includes('Math.max(1, Math.abs(') && !r.text.includes('Number.isFinite')) bad.push(`${relative(ROOT, f)}:${r.start}`);
    }
  }
  assert.deepEqual(bad, [], `这几段比「差不多相等」却没看有限数：\n${bad.join('\n')}`);
});

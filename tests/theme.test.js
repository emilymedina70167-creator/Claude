import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { themeOf, THEMES } from '../kit/src/theme.js';
import { INK_COLORS } from '../kit/src/ink/engine.js';

const read = (p) => readFileSync(new URL(`../kit/src/${p}`, import.meta.url), 'utf8');

test('themeOf：中英文名都认，默认石墨是空串，不认识的是 null', () => {
  assert.equal(themeOf('paper'), 'paper');
  assert.equal(themeOf(' 纸本 '), 'paper');
  assert.equal(themeOf('Chalk'), 'chalk');
  assert.equal(themeOf('墨绿黑板'), 'chalk');
  assert.equal(themeOf('深蓝'), 'midnight');
  assert.equal(themeOf('白板'), 'white');
  assert.equal(themeOf('石墨'), '');
  assert.equal(themeOf('graphite'), '');
  assert.equal(themeOf(''), '');
  assert.equal(themeOf(undefined), '');
  assert.equal(themeOf('粉色'), null);
  assert.equal(themeOf('toString'), null, '原型上的名字不算');
});

test('每种风格都把颜色的 RGB 变量写全（不然会混进默认石墨的颜色）', () => {
  const styles = read('styles.css');
  const root = styles.slice(styles.indexOf(':root {'), styles.indexOf('}', styles.indexOf(':root {')));
  const names = [...root.matchAll(/(--[\w-]+-rgb):/g)].map((m) => m[1]);
  assert.ok(names.length >= 12, names.join(' '));
  const themes = read('themes.css');
  const values = new Set(Object.values(THEMES).filter(Boolean));
  for (const t of values) {
    const at = themes.indexOf(`:root[data-theme="${t}"] {`);
    assert.ok(at >= 0, `themes.css 里没有 ${t}`);
    const block = themes.slice(at, themes.indexOf('\n}', at));
    for (const n of names) assert.match(block, new RegExp(`${n}:\\s*\\d+ \\d+ \\d+;`), `${t} 没写 ${n}`);
    for (const n of ['--ink-white', '--ink-yellow', '--ink-pink', '--ink-blue', '--page-bg']) assert.ok(block.includes(`${n}:`), `${t} 没写 ${n}`);
  }
});

test('组件样式里不再写死颜色：都从主题变量取', () => {
  for (const f of ['styles.css', 'class/class.css', 'class/board.css']) {
    let css = read(f);
    if (f === 'styles.css') css = css.slice(css.indexOf('}', css.indexOf(':root {')) + 1);
    const lit = [...css.matchAll(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g)].map((m) => m[0]);
    assert.deepEqual(lit, [], `${f} 里还有写死的颜色`);
  }
});

test('板书笔色：拿不到页面样式时用默认石墨的颜色', () => {
  assert.deepEqual({ ...INK_COLORS }, { white: '#eae8e3', yellow: '#f0be5c', pink: '#f092b0', blue: '#80c4f0' });
  assert.deepEqual(Object.keys(INK_COLORS), ['white', 'yellow', 'pink', 'blue']);
});

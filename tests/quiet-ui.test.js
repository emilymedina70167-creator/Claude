// 页面简洁（2026-11-21 我说的）：不要「没懂 / 换个说法」这种快捷话、不要截图粘贴的提示、不要教人怎么操作的小字。
// 判对错的反馈、老师自己写的题面和提示不算；这里扫源码，新加的组件再写操作说明会红
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURES } from '../kit/src/features.js';

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js')) files.push(p); } };
walk('kit/src');

test('快捷回答、点着问都关着', () => {
  assert.equal(FEATURES.quick, false);
  assert.equal(FEATURES.askHere, false);
});

test('源码里没有教人怎么操作的小字', () => {
  const BAD = [/拖动圆点可以移动/, /拖动图可以旋转/, /拖动箭头末端的圆点/, /点错了再点一下去掉/, /长按下面的框选「粘贴」/, /长按这里，选「粘贴」/,
    /也可以粘贴截图/, /点右边结果矩阵里的任意一个数/, /点乘积里的任意一个数/, /变换完成后可以直接拖动/, /填在表里的格子里（分数、小数都行）/,
    /在上面的图里点那个进程/, /面积图上的分界线可以拖/, /写完点「附上」/, /这是以前的课：只能翻看/];
  const hits = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    for (const re of BAD) if (re.test(src)) hits.push(`${f}：${re}`);
  }
  assert.deepEqual(hits, []);
});

// 2026-11-22 我说「有把握吗」没用：掌握看做题的事实，不靠我一句话
test('作答后不问有没有把握；检验交题不用先点把握', async () => {
  assert.equal(FEATURES.confidence, false);
  const shell = readFileSync('kit/src/check/shell.js', 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(shell, /有多大把握|先点有多大把握|ck-sure-btn/);
});

// 2026-11-22 我说「这节课要拿下的事」固定在不影响看东西的地方，别一直跟着：不吸顶，跟着板顶滚走
test('「这节课要拿下的」那一条不吸顶', () => {
  const css = readFileSync('kit/src/class/class.css', 'utf8');
  const rule = /\.class-aims \{([^}]*)\}/.exec(css)?.[1] || '';
  assert.doesNotMatch(rule, /sticky|fixed/);
});

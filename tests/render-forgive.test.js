// 板书写法的容错：\chalk、\hl 写在公式外面、粗体贴着中文标点，照作者的意思显示，不报错也不让 Claude 重写
// （重写要多跑一整轮。2026-11-02 一节课学生看到 \chalk{yellow}{to} 的源码、粗体两边露星号）
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { mdToHtml } = await import('../kit/src/render.js');
const r = (s) => mdToHtml(s, { inline: true });

test('\\chalk、\\hl 写在公式外面：照样上色、起名字；颜色不认识就只写字', () => {
  assert.equal(r('gave positions \\chalk{yellow}{to} justices'), 'gave positions <span data-lkc="yellow">to</span> justices');
  assert.equal(r('看 \\hl{s}{the subject} 这一块'), '看 <span data-lkmark="s">the subject</span> 这一块');
  assert.equal(r('\\chalk{nocolor}{bad}'), 'bad');
  assert.match(r('x \\chalk{pink}{$a^2$ 和 b}'), /^x <span data-lkc="pink"><span class="katex">.*<\/span> 和 b<\/span>$/);
  // 公式里的照旧由 KaTeX 处理
  assert.match(r('$\\chalk{yellow}{x}$'), /class="katex"/);
});

test('粗体贴着中文标点也认；代码里不动；普通粗体照旧', () => {
  assert.equal(r('**判断步骤：**①先找谓语'), '<strong>判断步骤：</strong>①先找谓语');
  assert.equal(r('普通 **加粗** 文字'), '普通 <strong>加粗</strong> 文字');
  assert.equal(r('**例外**（书上没写）'), '<strong>例外</strong>（书上没写）');
  assert.equal(r('`**判断：**x` 代码'), '<code>**判断：**x</code> 代码');
  // 英文标点贴着粗体（插入语连逗号一起加粗）：11-23、11-24 两节课板上露了星号
  assert.equal(r('You can**, Mr. Menand points out,** become a lawyer.'), 'You can<strong>, Mr. Menand points out,</strong> become a lawyer.');
  assert.equal(r('a **b** c'), 'a <strong>b</strong> c');
});

test('代码里的比较 dk==2 && i==5 不当成荧光笔', () => {
  assert.doesNotMatch(r('条件是 dk==2 && i==5 的那一步'), /<mark/);
  assert.match(r('文字==要背==文字'), /<mark class="lk-bei">要背<\/mark>/);
});

test('==要背== 粉色、=={yellow}关键== 换颜色：写板时就涂荧光笔，里面能有公式、加粗；不配对、===、贴着空格的不算', () => {
  assert.equal(mdToHtml('规则：==谓语动词加 -s==。', { inline: true }), '规则：<mark class="lk-bei">谓语动词加 -s</mark>。');
  assert.match(mdToHtml('=={yellow}关键说明==', { inline: true }), /<mark class="hl-mark hl-yellow">关键说明<\/mark>/);
  assert.match(mdToHtml('=={蓝}要理解==', { inline: true }), /hl-mark hl-blue">要理解</);
  assert.match(mdToHtml('=={pink}只有这四类==', { inline: true }), /<mark class="lk-bei">只有这四类<\/mark>/);
  assert.match(mdToHtml('=={yellow}**be** 除外 $x^2$==', { inline: true }), /<mark class="hl-mark hl-yellow"><strong>be<\/strong> 除外 <span class="katex/);
  assert.doesNotMatch(mdToHtml('a == b', { inline: true }), /<mark/);
  assert.doesNotMatch(mdToHtml('只有开头==没有结尾', { inline: true }), /<mark/);
  assert.doesNotMatch(mdToHtml('$a==b$', { inline: true }), /<mark/);
  assert.doesNotMatch(mdToHtml('x === y === z', { inline: true }), /<mark/);
});

// 课堂的黑板上老师写的字照它的意思显示（第十三轮：2026-11-16 真课的板上看到的两处）
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { mdToHtml, setLineBreaks } = await import('../kit/src/render.js');

test('整条公式只是一句上色的话：画成能折行的彩色字，不进 KaTeX', () => {
  const h = mdToHtml('$\\chalk{blue}{\\text{考研不单独考情态动词。要做到两件事：读懂它在句子里是哪种意思；把它当成一个谓语整体找出来。}}$');
  assert.match(h, /<span data-lkc="blue">考研不单独考情态动词。/);
  assert.doesNotMatch(h, /katex/);
  // 真的公式、公式里夹着 \text 的照旧
  assert.match(mdToHtml('$\\chalk{blue}{x^2}$'), /katex/);
  assert.match(mdToHtml('$\\chalk{red}{\\text{秩}}+1$'), /katex/);
  assert.match(mdToHtml('$$\\chalk{red}{\\text{整行的公式}}$$'), /katex/);
});

test('课堂的黑板一行就是一行；不开时照旧并成一段', () => {
  const src = '**must 必须**：we must act.\n译：我们必须行动。\n\n下一段';
  assert.doesNotMatch(mdToHtml(src), /<br>/);
  setLineBreaks(true);
  try {
    const h = mdToHtml(src);
    assert.match(h, /we must act\.<br>\n译：我们必须行动。<\/p>\n<p>下一段/);
    // 列表、表格不受影响
    assert.match(mdToHtml('- 甲\n- 乙'), /<li>甲<\/li>\n<li>乙<\/li>/);
  } finally { setLineBreaks(false); }
});

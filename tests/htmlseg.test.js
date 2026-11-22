// 自由段 html 的纯函数部分（kit/src/htmlseg.js）：开头的字段、框里的整页、桥上的作答、页面替它判
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtmlSeg, frameDoc, recordOf, bridgeCalc, bridgeSame, judgeCheck } from '../kit/src/htmlseg.js';

test('字段只认开头几行，HTML / CSS / JS 里同样的字不当字段', () => {
  const r = parseHtmlSeg('id: h1\nexam: 2019-10\n<div>\n<script>\nconst o = {\nid: x\n}\n</script>');
  assert.deepEqual(r.fields, { id: 'h1', exam: '2019-10' });
  assert.ok(r.html.startsWith('<div>'));
  assert.ok(r.html.includes('id: x'));
  assert.deepEqual(parseHtmlSeg('<p>id: 3</p>').fields, {});
});

test('框里的整页：带暗号和刷新前的状态，主讲的 HTML 原样放进 body，状态里的 </script> 断不开脚本', () => {
  const doc = frameDoc({ html: '<p>hi</p><script>lab.record({q:"a"})</script>', nonce: 'n1', state: { s: '</script><b>' }, look: { color: 'rgb(1, 2, 3)', font: 'X; }', dark: true } });
  assert.ok(doc.startsWith('<!doctype html>'));
  assert.ok(doc.includes('"n1"'));
  assert.ok(doc.includes('<body><p>hi</p><script>lab.record({q:"a"})</script></body>'));
  // 底座的 script 只在 head 里闭合一次（状态里的 </script> 转义了）
  const head = doc.slice(0, doc.indexOf('<body>'));
  assert.equal(head.split('</script>').length, 2);
  assert.ok(head.includes('\\u003c/script>'));
  assert.ok(!head.includes('color-scheme'), '不写 color-scheme（和外面不一样时框会铺一层不透明的底）');
  assert.ok(!head.includes('X; }'), '字体里的 ; } 去掉，断不开样式');
  assert.ok(!doc.includes('__N__') && !doc.includes('__S__'));
});

test('桥上的作答：主讲代码写的 ok 标 judgedBy: author，没写 ok 就是没判', () => {
  assert.deepEqual(recordOf({ q: '第一问', value: [1, 2], ok: true, text: '拖完了' }), { type: 'html', q: '第一问', ok: true, value: '[1,2]', text: '拖完了', judgedBy: 'author' });
  assert.deepEqual(recordOf({ q: 'x', value: 3 }), { type: 'html', q: 'x', ok: null, value: '3' });
  assert.equal(recordOf({ q: 'x', ok: 'yes' }).ok, null);
});

test('lab.calc 精确地算，lab.same 判矩阵式子相等', () => {
  assert.deepEqual(bridgeCalc('1/3+1/6'), { value: '1/2' });
  assert.ok(bridgeCalc('1/').error);
  assert.deepEqual(bridgeSame('A*B+B*A', '2*A*B'), { value: false });
  assert.deepEqual(bridgeSame('2*A', 'A+A'), { value: true });
});

test('lab.check：页面判的四种', () => {
  assert.equal(judgeCheck('1/2', '1/3+1/6').ok, true);
  assert.equal(judgeCheck('0.5', '1/2').ok, true);
  assert.equal(judgeCheck('2/3', '1/2').ok, false);
  assert.equal(judgeCheck('', '1/2').ok, false);
  assert.equal(judgeCheck('1/', '1/2').ok, false);
  assert.equal(judgeCheck('A+A', '2*A', 'expr').ok, true);
  assert.equal(judgeCheck('sin^2 x + cos^2 x', '1', 'fx').ok, true);
  assert.equal(judgeCheck('2x', 'x^2', 'fx').ok, false);
  assert.equal(judgeCheck(' The Cat ', 'the  cat', 'text').ok, true);
  const odd = judgeCheck('1', '1', 'nope');
  assert.equal(odd.ok, null);
  assert.match(odd.why, /value/);
});

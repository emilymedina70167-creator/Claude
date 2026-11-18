// 舞台主线第三轮 D：排版留下的几条（docs/superpowers/specs/2026-11-11-stage-mainline-3-design.md）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { layout } from '../kit/src/stage/types/sentence.js';

const make = (src) => { const s = new Scene(); for (const c of parseScript(src)) s.apply(c); return s; };

// 更深一层括号的竖线（没断开的那一头）落在这行字的横向范围里、又从它那一高度穿过去
function crossed(L) {
  const out = [];
  for (const l of L.marks) for (const b of L.brackets) {
    if (b.line !== l.line || b.depth <= l.depth || b.mark === l.mark) continue;
    const xs = [b.openL ? null : b.x, b.openR ? null : b.x + b.w].filter((x) => x != null);
    for (const x of xs) if (x > l.x + 1 && x < l.x + l.w - 1) out.push(`${l.text} 被 ${b.mark} 的竖线穿过`);
  }
  return out;
}

test('E1-7：两道括号交叠在一个词上（不是一道套一道），深一层那道的竖线不从浅一层的字上穿过去', () => {
  const s = make('sentence z = "have been doing"\nmark z.1-2 完成\nmark z.2-3 进行');
  const L = layout(s.objects.get('z'));
  assert.deepEqual(crossed(L), []);
  // 字还在它那道括号下面（没被推到括号外面去）
  for (const l of L.marks) assert.ok(l.x >= l.seg.x - 1 && l.x + l.w <= l.seg.x + l.seg.w + 1, `${l.text} 还在自己的括号下面`);
  // 三道：1-2、2-4、4-5 连着交叠
  const t = make('sentence z = "They have been waiting here"\nmark z.1-2 主语\nmark z.2-4 谓语\nmark z.4-5 状语');
  assert.deepEqual(crossed(layout(t.objects.get('z'))), []);
});

test('E1-7：一道套一道的照旧（里面那道的字不动）', () => {
  const s = make('sentence z = "The man who lives here is a doctor"\nmark z.3-5 从句\nmark z.1-5 主语');
  const L = layout(s.objects.get('z'));
  assert.deepEqual(crossed(L), []);
  const inner = L.marks.find((m) => m.text === '从句');
  assert.ok(Math.abs(inner.x + inner.w / 2 - (inner.seg.x + inner.seg.w / 2)) < 1, '里面那道的字还在正中');
});

test('横屏挑战多：镜头能把左边一列让给挑战（left=），不用把整排的高都让出去', async () => {
  const { fitCamera } = await import('../kit/src/stage/layout.js');
  const view = { w: 1180, h: 820 }, box = { x: 0, y: 0, w: 700, h: 520 };
  // 上面让：五条挑战 290 + 三行话 150，只剩 248 高 → 缩到不到五成
  const top = fitCamera(box, view, { top: 150 + 290, bottom: 76, pad: 28, maxScale: 1.5 });
  // 左边让一列 260：高只让话的 150
  const side = fitCamera(box, view, { top: 150, bottom: 76, left: 260, pad: 28, maxScale: 1.5 });
  assert.ok(top.s < 0.5 && side.s > 0.95, `${top.s} → ${side.s}`);
  // 画面落在挑战那一列的右边、居中
  const x0 = box.x * side.s + side.tx, x1 = (box.x + box.w) * side.s + side.tx;
  assert.ok(x0 >= 260 + 28 - 1 && x1 <= view.w - 28 + 1);
  assert.ok(Math.abs((x0 + x1) / 2 - (260 + (view.w - 260) / 2)) < 1);
  // 不写 left 和以前一样
  assert.deepEqual(fitCamera(box, view, { top: 150, bottom: 76, pad: 28 }), fitCamera(box, view, { top: 150, bottom: 76, pad: 28, left: 0 }));
});

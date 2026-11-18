# 黑板组件 widget：一小段 JS 调 la.*

外部的课里写 `board widget id=w1 title="…"`，块里是一小段 JS；页面包成 `widget` 组件画在当前板上（组件的 id 就是段的 id）。在别的段里也能直接写：

```widget
id: w1
title: 把四项按左右顺序排
---
const d = la.drag({ items: ['$A^2$', '$AB$', '$BA$', '$B^2$'], slots: 4 });
la.button('排好了', () => {
  const r = la.compare(d.order(), ['$A^2$', '$AB$', '$BA$', '$B^2$']);
  la.goal('(A+B)(A+B) 拆开的四项按左右顺序排', r.ok, { value: d.order(), say: r.ok ? '对。' : `第 ${r.first + 1} 格不对` });
}, { primary: true });
```

「---」上面只写 `id:`、`title:`；下面是代码（最多 16 KiB），代码里能用的只有 `la`：

- `la.md(文字)`：一段 Markdown（`$…$` 是公式）；`la.tex(TeX)`：一个公式（`\\calc{…}`、`\\chalk{颜色}{…}` 照用）；`la.matrix([[1, 2], [3, 4]], { name: 'A' })`：矩阵。都返回那个元素，第二个参数（或 `parent`）给了就放进那个元素里。
- `la.row(元素, 元素…)`：横着排（窄屏折行）。
- `la.button(字, fn, { primary })`：按钮（至少 44px 高），点了跑 fn。`la.input({ placeholder, onEnter })`：输入框（16px），回车跑 `onEnter(值)`，返回 `{ el, value() }`。
- `la.drag({ items, slots, shuffle = true, onChange })`：一张张卡（文字或 `$公式$`）拖进几个空格（`slots` 是数，或每格的小标题数组）；也能先点卡再点格子；格子里的卡能拖回下面、拖到别的格子（两张对换）。返回 `{ order()（每格里的卡原文，空格是 null）, reset() }`。
- `la.calc(式子)`：精确计算（和 `\\calc` 同一套，整节课 `let` 的量能用），返回 `{ tex, text }`。
- `la.same(a, b)`：两个式子相等不相等——大写字母是矩阵（不交换），小写字母和数是标量，`E` / `I` 是单位矩阵，`O` 是零矩阵；`AB+BA` 和 `2AB` 不相等、`AE` 和 `A` 相等、`(kE)A` 和 `A(kE)` 相等。返回 `true` / `false` / `'unknown'`（含逆、转置、函数、读不懂的写法：判不了）。默认严：矩阵的式子里单独写的数不当 `kE`（`(A-E)(A-2E)` 和 `A^2-3A+2` 不相等）、数 `0` 不当零矩阵（`A-A` 和 `0` 不相等），`la.same(a, b, { loose: true })` 照宽的比。`la.whyNot(a, b, { loose })`：不相等的原因（「常数项少了 E」「零矩阵写成了数 0」「展开、合并同类项以后两边不一样」），相等或判不了是 null。
- `la.compare(got, want)`：比顺序，返回 `{ ok, right, n, first }`（`first` 是第一处不对的格，从 0 数）。
- `la.goal(这件事, ok, { value, text, say })`：记一条作答（`type: widget`，进证据、进 `ext_out`），这一段下面显示 `say`（不写是「✓ 做到了」/「✗ 还不对」）。`la.record({ q, value, ok, text })`：只记不显示。`la.event(一句话)`：记一条动作进 `ext_out`。
- `la.say(一句话, 'ok' | 'bad')`：这一段下面的一句话。
- `la.animate(元素, keyframes, 毫秒)`：动画（`Element.animate`），返回结束的 Promise。
- `la.anchor(名字, 元素)`：给这个元素一个 id「组件 id-名字」，之后 `board mark target=w1-名字` 能指到它。
- `la.el`：这一段的容器（要自己加元素时用）。

页面会怎么做：

- 一上来就跑不起来（语法错、抛错）：这一段不显示，像组件写错一样报在下一份 `ext_out` 最前面（`ext-check --lint` 也查语法）。
- 学生点了按钮以后代码出的错：记一条动作 `widget-error` 进 `ext_out`，只坏这一段。
- 外部的课里组件下面没有截图入口（见 `board set upload=`）。
- 刷新以后从头跑一遍（学生拖过的不放回；记下的作答在）。

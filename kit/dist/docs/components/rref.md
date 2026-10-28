### rref / matmul：线代的演示组件

行化简用 `elim`（能问、能填表、能自己做）；`rref` 是旧的演示，还能用。`matmul` 是矩阵乘法演示（新课件用 `matrix` 的 `product`）。

- `rref`：写 `matrix: [[…]]`、`augmented: true`、可选 `vars: x, y, z`、`mode: ref`。用精确分数逐步演示，最后判断解的情况。
- `matmul`：写 `A: [[…]]` 和 `B: [[…]]`。点结果里的元素会高亮对应的行和列。
- 旧组件 `transform2d`、`vectors` 仍然可用，但新课件优先用 `scene`。

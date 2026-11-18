### solve：解答题，按步骤判

```solve
id: p1
q: 设 $A=\begin{bmatrix}1&1\\0&1\end{bmatrix}$，求 $A^n$。
steps:
s1 setup: 写成 A = E + B，B = [[0,1],[0,0]]
s2 rule: B² = O，E 和 B 可交换，用二项式定理
s3 calc: A^n = E + nB
s4 conclude: A^n = [[1,n],[0,1]]
```

- 我在纸上写过程，打字或交照片交整道题（照片照截图入口的规矩：外部的课默认关，`board set upload=on` 或组件写 `upload: on` 才有）。参考步骤判完才给我看。
- `steps:` 一行一步 `编号 kind: 内容`，kind 是 `setup`（设、列式）`rule`（用规则）`calc`（计算）`conclude`（结论）；也可以写一行 JSON `steps: [{"id":"s1","kind":"setup","text":"…"}]`。
- 谁来判 `judge:`：`ext`（外部的课默认：外部看 `ext_out` 里的字和照片编号，写 `board judge`）、`claude`（别的课默认：页面里的老师判；外部的课里要配 `board claude … can: judge`）、`none`（只收不判）。判法见第四节 `judge`。

- 交上来的那一下记成作答 `type: solve`（`value` 是打的字，`photos` 是照片的 asset 编号）；判了以后另一条 `judged: true, steps: [{ id, ok: true | false | "missing" | null, unsure, why, tag }]`（`ok: null` 加 `unsure: true` 是判的人拿不准、待核；只有 `ok: null` 是没判），`ok` 是整道题对不对。刷新以后打的字和判定都放回来。
- `solve`、`board judge`、证据里的 `steps` 这几样的写法和字段名是定下来的，以后的探题也照它们用。

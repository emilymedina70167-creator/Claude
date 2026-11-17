# fix1：修好的页面毛病不许回来

舞台主线第一轮（`docs/superpowers/specs/2026-11-11-stage-mainline-1-design.md` 第 3 节）修的 50 条页面毛病里，要放到真的舞台上才看得出的那些：一条一个文件，文件名就是编号（`report3/` 里那一块「页面的毛病」单子的第几条，`D4-2.txt`），写最小的一幕（从报告指的那一幕里剪）。能用单元测试守住的不放这里。

表在 `tools/stage-try-lib.js` 的 `FIX1`：每个文件，老师看得到的地方必须有 / 不许有什么，排版那一栏必须报 / 不许报什么。

```bash
node tools/stage-must.mjs evals/stage-gaps/fix1 --table fix1
```

有 ✗ 退出码 1。加一条毛病：建文件、表里加一行、先跑一遍看它红。

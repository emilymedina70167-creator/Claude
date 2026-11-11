# 舞台主线第一轮：做的时候自己定的事

设计 `2026-11-11-stage-mainline-1-design.md`，计划 `../plans/2026-11-11-stage-mainline-1.md`。每条：定了什么、为什么、错了的代价。

## 尺子

- **指令表不只是 `script.js` 的 `COMMANDS`**：各种东西自己的指令（`swap`、`rowop`、`mark`……）在 `types/*.js` 的 `commands`，造东西的在 `types/index.js` 的 `CREATE`，都不进 `COMMANDS`。测试守的是三处合起来的每一条都归了类。
- **`un` 开头的归「收拾」，三条例外**：`uncover`（揭开）归「指给学生看」，`unfold`（展开）、`untransform`（变回去）归「老师演」——这三样是演给学生看的，不是收拾。
- **拿不准的几条**：`group`、`visit`、`search` 归「指给学生看」，`split`、`merge`、`traverse`、`next`（公式的下一行）归「老师演」。错了的代价：两类都算「教」，不影响搭占几成。
- **`hide`（把一样东西藏起来）归「收拾」**，带 `hide=on` 造的归「藏着的辅助」。
- **试演文件里舞台不认得的指令**（量的人试过的 `run g prim`、`table`、`lock`……）记成「没归类」单列，不进教也不进搭。
- **「乘」怎么认**：`{…}` 里有 `*`、`·`、`×`，或者两个名字挨着（`J Va`、`(A - E)(A - 2 E)`）。

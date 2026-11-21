# 视觉六批以后：矛盾和留下的毛病一次修完（2026-11-21）

> 我说：「然后把矛盾点 bug 这些全都修复，老内容给新内容让路」。
> 范围：六批做完时记下没修的小毛病（`.superpowers/visual-rulings.md` 里的 `minor (deferred)`，36 条），加上几批之间、新组件和老组件之间互相矛盾的地方。矛盾一律照新的做（老组件、老说明、CLAUDE.md 里过时的话改成新的）。
> 依据：`docs/superpowers/specs/2026-11-20-visual-design.md`（五条标准），各批的计划和复查记录。

## 一、矛盾（照新的）

1. **「看答案」几次出**：第 4 批起是「检查三次没对」；老组件（answer、conjecture、elimdo、encodedo、英语七种、findbug、parallel、pvdo、演示外壳的问和填表）是两次。统一成三次，一个常量 `kit/src/tries.js` 的 `REVEAL_TRIES`；手册里写「两次」的地方跟着改。
2. **同一个错答案连点不算新的一次**：第 4 批起的规矩，第 5、6 批补到了 answer、演示外壳的问。老组件（英语七种、conjecture、elimdo、encodedo、findbug、pvdo、演示外壳的填表、quiz、practice）一律照做（`tries.js` 的 `sameWrong`）。
3. **概率四个组件问法的写法**：venn / ptree / joint 写 `ask: "题目" 式子`，sim 写 `ask: "题目" = 式子`。四个都认两种。
4. **大分母什么时候写小数**：概率的表里和读数里两个门槛，统一成一个（`prob/num.js`）。
5. **ptree 的事件写法**照 venn（`−`、`Ω`、`U`）。
6. **CLAUDE.md 里过时的现状**（线代说明「约 39 KiB，最紧」等）改成现在的。

## 二、留下的毛病（36 条，照批次）

第 1 批（graph）3 条、第 2 批（graph 平面）6 条、第 3 批（space）10 条、第 4 批（概率）11 条、第 5 批（英语）5 条，原文照 `.superpowers/visual-rulings.md`。

## 三、做法

- 纯函数的修法先写会红的测试；只在画面上的（DOM）用真手指脚本 `.superpowers/audit-visual/fix/*.mjs` 验，结构上的约定（每个组件都用 `tries.js`）用扫源码的测试守着。
- 做完一次独立复查（一个子代理），Critical / Important 一次修完；`npm test`、`npm run build`、`npm run check:pages`、`npm run e2e`；版本号、CLAUDE.md；合进 main、发布学习台。

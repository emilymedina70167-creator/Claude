# 舞台的缺口尺子

量「Claude 想做的视觉交互和判定，现在的舞台接不接得住」。

- 设计：`docs/superpowers/specs/2026-11-06-stage-gap-ruler-design.md`
- 计划：`docs/superpowers/plans/2026-11-06-stage-gap-ruler.md`
- 产出的缺口单：`docs/stage-gaps.md`

## 目录里有什么

| 文件 | 是什么 |
|---|---|
| `brief-ideal.md` | 写理想演法的助手读的说明：怎么教、唯一的限制、交什么。不给它看舞台。 |
| `brief-try.md` | 对照舞台的助手读的说明：工具怎么用、怎么打标、两条纪律、交什么 |
| `stage-doc.txt` | 舞台的说明：全带的那一份（8 种东西都在；真上课时推得出科目就只带这门课用得上的几种，推不出来发的就是这一份）。由 `kit/src/stage/doc.js` 的 `STAGE_TEACH` + `stageDoc()` 生成 |
| `materials/{块}.md` | 每一块的教材原文、学生的错题和弱点、学生现在在哪（从学习台读的） |
| `ideal/{块}.md` | 理想演法：主线几幕 + 2～3 个分支 |
| `try/{块}/*.txt` | 对照时写的一幕一幕的镜头指令 |
| `try/{块}/shots/` | 报告里引用到的截图 |
| `report/{科目}.md` | 每一幕每一项打的标：✅ / ⚠️ / ❌，后两种带证据 |
| `try2/{块}/*.txt` | 底座做完以后重新量时写的镜头指令（D2、L1、L2、E2、E3 里和三个样板相关的几幕）；截图在各自的 `shots/`，不进仓库 |
| `report2/{科目}.md` | 重新量的打标：只有量了的块和幕，每节最后「和上次比」；和 `report/` 同一批项的对比、还没接住的缺口写在 `docs/stage-gaps.md` 末尾 |

十块：
- 线代：`L1` 块 4（可交换、方阵的幂、f(A)）、`L2` 线性方程组、`L3` 特征值和相似对角化
- 数据结构：`D1` 希尔排序、`D2` AVL、`D3` Dijkstra 和最小生成树、`D4` 快排划分和堆排序
- 英语：`E1` 时态、`E2` 多层从句的长难句、`E3` 非谓语动词

## 怎么重跑

舞台改了以后，拿同一批理想演法再量一次：

```bash
node proto/stage/build.mjs
```

```bash
node tools/stage-try.mjs evals/stage-gaps/try/L1/幕1.txt --shots /tmp/shots
```

```bash
node tools/stage-gaps-check.mjs report
```

只重新量了几块几幕的，写进 `report2/`，用 `node tools/stage-gaps-check.mjs report2` 查（只查报告里有的块、打了标的幕）。

`stage-doc.txt` 要按新的说明重新生成：

```bash
node -e "import('./kit/src/stage/doc.js').then(m=>process.stdout.write(m.STAGE_TEACH+'\n\n'+m.stageDoc()+'\n'))" > evals/stage-gaps/stage-doc.txt
```

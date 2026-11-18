### recall、construct、claim、discriminate、locate：检验题（二类，学完以后的吸收检验）

五种探题和 `solve` 只在 `board check`（第五节）里能作答，单独写在板上只画预览；字段在完整写法里。

合书、第一次作答算数、没有提示和「看答案」，错了显示你写的补讲再出一道同构题。每道题都要写 `target`（打的哪个典型错法）、`level`，必做题至少 2 道 `retry`、至少 1 条 `teach`。

共用的字段：

| 字段 | 意思 |
|---|---|
| `id` | 这一次检验里唯一 |
| `q` | 题面（Markdown，可以有 `$公式$`）；claim 的命题写 `claim:` |
| `target` | 打的是哪个典型错法：错题、误解的编号或一句话 |
| `level` | `基础` / `方法` / `核心` |
| `facet` | 测吸收的哪一面：`重建` / `能用` / `边界` / `能辨`。不写按题型：recall 重建、construct 能用、claim 边界、solve 能用、discriminate 能辨、locate 能辨 |
| `teach 键: 话` | 判出这一项没过时显示的一两句。键是没过的那一项：`if2`、`m1`、`s3`、`tag=规则用错`、`truth`、`can`、`line`、`fix`、`result`、`giveup`（想不出来）、`default`（兜底）。先按编号找，再按 tag，最后 default；都没有时页面里的 Claude 写（第五节） |
| `retry` | 同构小题的 id（写在同一个 `board check` 块里、同一种题型），按先后用 |
| `family` | 同类的键，复测按它挑没见过的题；不写是 `块/target` |
| `let 名字 = 式子` | 题里用的量（写法同 `answer`） |

各题型：

- **recall**：`must m1: 要点`（每题最多 3 条）、`may m4: 可选要点`（不影响过没过）、`wrong w1: 常见错说法`、`answer: 参考答案`（判完给我看）。编号不写页面自动编（m1、m2…，w1…）。我打字或手写；页面里的 Claude 照要点判。过 = `must` 全写到、没写 `wrong` 里的错说法。
- **construct**：`slots: A=mat(2) B=mat(2)`（`mat(r,c)` `vec(n)` `num`）；`if: 条件 => 不满足时说的话`，一行一条，编号 if1、if2…（条件写法同 `answer` 的 `check:`，名字是 slots 里的；`O`、`E` 没定义时是第一个方阵那么大的零矩阵、单位矩阵）；`expr 标签: 标准式子`（要我再写一个用 slots 名字的式子，按非交换多项式严格判相等，编号 e1…）；`example:`（必填：一组满足全部条件的，页面先验一遍）。页面逐条核，每条不满足的显示那一条自己的话、全部列出来；格子没填完交不了。
- **claim**：`claim: 命题`、`truth: 真 | 假`。我先点「真」或「假」：判假要给反例（字段同 construct：`slots` `if` `example`）；判真要写证明要点（`must` `may` `wrong`），或 `proof: derive` 配 `start:` `goal:` `vars:`（逐行核，同 `derive mode: do`）。过 = 真假对、依据也过。
- **solve**：照上面 `solve` 的写法（`q` `steps`），加共用的字段。在检验里一律由页面里的 Claude 逐步判（结论是 `steps`），我打字或手写，不交照片。
- **discriminate**：`can: 能 | 不能`、`must m1: 理由要点`（「为什么」「能用怎么用 / 不能用用什么」都写成要点）、`result: 式子`（可选，最后结果，精确判）。过 = 能不能对、理由过、result 对；能不能对、理由没过 = 没过。
- **locate**：`line:` 几行、`bug: 第几行`、`must m1: 为什么错的要点`、`fix: 式子`（可选，改成什么）。过 = 哪一行对、理由过、fix 对。

```construct
id: p4
q: 造一组 2 阶 $A$、$B$，使 $(A+B)(A-B) \ne A^2-B^2$，并写出两边差的那一项
target: L2-56
level: 核心
slots: A=mat(2) B=mat(2)
if: (A+B)*(A-B) != A^2-B^2 => 这一组两边相等了：A、B 可交换
expr 两边差: (A+B)*(A-B) - (A^2-B^2)
example: A=[[0,1],[0,0]] B=[[1,0],[0,0]]
teach if1: 可交换的两个矩阵两边一定相等，换一组不可交换的。
retry: p4a, p4b
```

我写字的地方有「手写 / 打字」两个页签（这台设备用过 Pencil 默认手写）。手写板记每一笔的时间；改错用「划掉」（留痕），「撤一下」只撤 5 秒内的一笔、3 秒内的划掉；「下一步」记一个分步的时刻；「加一页」往下加。交的时候页面从笔画算：整页图（划掉的灰色带线、左边行号 L1、L2…）、关键时刻的快照（停顿超过 `pause`、每次划掉之前、每次下一步，最多 6 张）、一段时间线文字，图传进 assets。

# 板书标注：mark / unmark（教具指令，不是组件）

**mark：指着讲（圈、框、划、写旁注）。**对板上**已经有的东西**做标注，留在板上直到撤掉，或者它所在的段被改写、撤回。

- 画法和效果：一组（几条规则、一张清单）可以用**一个**大括号（`mark target=b5 li=1-4 style=brace color=pink note="要背"`）或一个大圈（`mark target=b5 li=1-4`）把整组圈在一起；一句里的关键词、结论 `highlight`（荧光笔，涂在字下面）或 `underline`；例外、易错圈红加旁注（`mark target=b5 text="be 动词除外" color=red note="例外"`）；着重的几个字 `dots`（着重号）；要理解的说明 `wave`；正误例句 `tick` / `cross`；约掉的项 `strike`；两处的关系画箭头（`mark target=b5 text="The boy" to="walks" note="主语 → 谓语"`）。
- 一条：`mark target=b5 term=mid note="1×1：一个数"`。好几条：第一行写 `mark target=m-b6`，块里每行一条（`row 1 note="×(−1)"`、`row 2 note="×2" color=pink`），`target=`、`color=`、`style=` 不写就沿用第一行的。
- `target=`：段的 id，或者组件的 `id:`。只能标当前板和常驻栏上的东西。
- 标哪里（不写就是整个 target）：
  - `text="板上的字"`：板上任何一段字，中文英文都行（不管空格、大小写、全角半角）；长的写头尾，中间用「…」：`text="主语是…除外"`；出现几次时 `text="例外#2"`（不写就标第一次，黑板现状里提醒你）。跨几行的半句话，圈会沿着字的形状圈。
  - `li=1-4`（列表的第 1–4 条，一组画一个形状，大圈连序号一起圈）、`para=2`（第 2 段）、`tr=2`（Markdown 表格的第 2 行）。
  - `term=名字`：公式里用 `\hl{名字}{…}` 包起来的那一项（写公式时就给以后要指的项起好名字；`\hl` 本身不画任何东西）。普通文字直接用 `text=`，不要塞进公式起名字。
  - `row=2`、`col=3`、`diag`（主对角线）、`entry=2,3`、`block=1,2`（子块，要先在 `matrix` 组件里 `split`）：矩阵的部位。`matrix` 组件和公式里的 `bmatrix` 都能标；一处有好几个矩阵时加 `of=名字`（`matrix` 的 `name=`，或者公式里用 `\hl{名字}{…}` 包起来的矩阵）。
  - `step=2`：`steps` 的第 2 步（学生已经走到的）。
  - `label=Ax`、`item=4`：图里标签是 Ax 的东西、第 4 条命令画的东西（演示组件里是第 4 个格子 / 结点）；`at=[1, 2]`：`scene` 里坐标 (1, 2) 那个点。图被拖动、`figure set` 之后，标注跟着挪。
  - `word=3`（第 3 个英文词）、`words=4-7`（第 4 到 7 个词）、`phrase="who lives next door"`（这几个词；出现几次时 `phrase="that#2"`）、`blank=2`（`cloze` 的第 2 个空）：英语句子里按词数。target 是英语组件时数的是那句英文，target 是一段时数的是整段的英文。phrase 里可以带标点（`phrase=", which"`、只圈逗号 `phrase=",#2"`）。
  - `part=2`、`part=2-4`：这一段的第 2 部分、第 2 到 4 部分（一个段落、一个列表、一张表、一个框、一个组件各算一部分，标题不算），默认框起来，框在字外面。要背的一大块一个框圈住，不要一项一项去圈。
- `style=`：`circle` 圈（宽的、几行的是一个圆角长圈，留白躲开旁边的字）、`box` 框、`brace` 大括号（右边，`side=left` 在左边，旁注写在括号尖外面）、`underline` 下划线、`double` 双下划线、`wave` 波浪线、`dots` 着重号、`highlight` 荧光笔、`strike` 划掉、`tick` ✓、`cross` ✗（写在句子后面）、`arrow` 箭头（从旁注指过去；写了 `to="…"` 就从这里指到那里，同一行的从上面或下面拱过去）。不写时：几个字、项、元素、点用圈，长句划线，一组列表大圈，行、列、子块、整段用框，对角线用斜着的长圈。
- `color=`：`yellow`（默认）`pink` `blue` `green` `orange` `purple` `red` `white`（`tick` 默认绿、`cross` 默认红）。`note="…"`：旁边写一句（要短，最多 80 个字，可以有 `$公式$`）；`side=right|left|above|below` 指定写在哪边。`id=` 不写时页面自动编 m1、m2……
- 写板时就知道是重点的，直接写进字里：`==只有这四类==` 是要背的（粉色荧光底，不压字），`=={yellow}谓语动词加 -s==` 换一种颜色标关键说明（`yellow` `blue` `green` `red`）；公式里 `\boxed{…}`、`\cancel{…}`、彩色粉笔 `\chalk{pink}{…}`。讲着讲着才要指的，用 mark。

**unmark：撤掉标注。**`unmark id=m3`（一条）、`unmark target=b5`（这个目标上的全部）、`unmark all`。

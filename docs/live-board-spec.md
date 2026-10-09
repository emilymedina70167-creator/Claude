# 需求：实时黑板与「带着动脑」组件

给 Claude Code 的实现说明。写给实现组件库的人；课程内容由项目对话里的 Claude 来写，不在这次范围内。

## 0. 为什么要做

现在的课件是一次写完的：13 节内容提前排好，学生做对一节就出现「继续」。实际用下来有两个问题：

1. **学生在「看」，没在「想」。** 页面把讲解、公式、图一次摆出来，学生能看懂多少算多少。想要的是每一屏只让学生做一件需要动脑的事：先猜下一步、拖一下图、指出错在哪，然后才往下走。
2. **真正的老师插不上手。** 项目对话里的 Claude 有学生的弱点表、错题档案、教学规则和教材文稿，能判断「答对了但理解歪了」「缺的是知识还是思路」。页面里的 Claude 每次调用都从零开始，只看得到课件里的一小段背景。现在却由页面做决定：答对就放行。学生在第 1 节卡住，后面 12 节也照样摆在那里。

这次要做两件事：

- **实时黑板**（第 1 节）：课件不再一次写完。对话里的 Claude 一段一段往黑板上写，学生在黑板上作答，作答（包括手写原图）存进数据库，对话里的 Claude 直接读，再决定下一段写什么。**往下走的决定权在对话里，不在页面里。**
- **四个「带着动脑」的组件**（第 2 节）：一步步揭开的例题、跟着步骤动的图、认方法快练、找错。

页面里的 Claude 降级为助手：转写手写、给小提示、算对错。它不判定学生「过没过」，也不控制推进。

## 1. 实时黑板：`mode: live`

### 1.1 页面

课件页面只有一个壳，内容全在数据库里：

```html
<title>秩一方阵</title>
<script src="la-kit.js"></script>
<script type="text/markdown">
---
mode: live
unit: 第2讲 §2 · 秩一方阵
---
</script>
```

发布参数：`capabilities: {"sample": {"images": true}, "db": {}, "assets": {}}`。

- `db`：存黑板内容和作答。
- `assets`：存手写原图（数据库单个文档上限 256 KiB，图片放不下）。声明 `assets` 后这个 artifact 只能在组织内部分享，这里本来就只给学生自己看，没问题。

### 1.2 数据结构

路径都放在共享区。不要用 `data/users/...`：那里连 owner 都读不到，对话里的 Claude 是以学生（owner）的身份读数据库的，会读不到。

| 路径 | 谁写 | 内容 |
|---|---|---|
| `meta/board` | 对话里的 Claude | `{ unit, context, updatedAt }`。`context` 等同现在的 `context` 块：给页面里 Claude 的背景资料 |
| `steps/{stepId}` | 对话里的 Claude | `{ seq: number, md: string, title?: string, hidden?: boolean }`。`md` 是一段课件 Markdown（和现在一样，可以含任何组件代码块） |
| `answers/{answerId}` | 页面 | 每次作答一条，字段见 1.4 |
| `events/{eventId}` | 页面 | 学生点「这段做完了」、揭开一步、提问等，字段见 1.5 |

### 1.3 渲染

- 页面用 `onSnapshot` 订阅 `steps`，按 `seq` 排序渲染。数据库还没有任何 step 时，显示等待状态：「黑板还是空的，回对话里让 Claude 开始。」
- **新增的 step 追加到末尾，不重新渲染已有的 step**，否则学生已经写的内容、拖到一半的图会丢。某个 step 的 `md` 被改了：如果那段还没有作答，就重新渲染那一段；已有作答，就在那段末尾显示「这段已更新」，学生点了才重新渲染。
- `hidden: true` 的 step 不显示（对话里的 Claude 用它撤回写错的内容）。
- 新内容出现时：平滑滚到新内容，进度条上闪一下，显示「新内容」提示。
- 每个 step 末尾一个按钮「这段做完了」，点了写一条 `events`（`type: 'done'`），并提示「回对话说一声，Claude 会看你的作答」。页面没法通知对话，只能靠学生回对话说。
- 没有「继续」按钮，也没有关卡锁。推进完全由对话里的 Claude 加 step 决定。
- 每个 step 是一个独立小节：沿用现在的小节样式，粉笔圈编号、「问 Claude」入口都保留。

### 1.4 作答写进数据库

现在所有组件都通过 `session.record(...)` 记录作答。live 模式下，`session.record` 同时写一条 `answers/{id}`：

```js
{
  step: 'rank1-1',          // 所在 step 的 id
  block: 'ex-rank1',        // 组件的 id（见 1.6）
  kind: 'answer' | 'conjecture' | 'quiz' | 'predict' | 'steps' | 'recognize' | 'findbug' | 'draft' | 'ask',
  q: '题面（纯文本，截短）',
  text: '学生写的文字（打字的，或手写转出来的）',
  value: '学生填的值（数值题）',
  ok: true | false | null,   // 程序能判的才填；判不了填 null
  attempts: 2,
  first: '第一次的作答',
  transcript: '手写转写结果',
  images: ['assetId1', ...], // 手写 / 截图原图，存在 assets 里
  aiFeedback: '页面里 Claude 给的反馈（如有）',
  ms: 41000,                 // 从组件出现到提交的时间
  at: 1700000000000
}
```

- **手写原图一定要存。** 凡是手写或截图交给页面 Claude 识别的地方（✎ 手写作答、✎ 手写、截图作答、草稿「拿给 Claude 看」、`steps` 和 `findbug` 里的手写），同时用 `assets.upload(blob)` 存原图，把 id 放进 `images`。对话里的 Claude 要看的是学生的原始手写，转写可能有错。
- 每次尝试都写一条，不只写最后一次。第一次错的答案最有诊断价值。
- 写入失败不影响学生继续作答；在页面角落标一个小提示「这条没存上」，重试一次。

### 1.5 events

```js
{ type: 'done' | 'reveal' | 'giveup' | 'ask' | 'open', step, block, detail, at }
```

`reveal` / `giveup` 来自 `steps` 组件（见 2.1），`ask` 是学生在「问 Claude」里问了什么（问题和回答都记）。

### 1.6 组件 id

live 模式下，每个会产生作答的组件都要有稳定的 `id:` 字段（由写课件的 Claude 填）。没写就按「step id + 组件序号」生成，并在写法自检里提示。数据库记录和本地保存都按这个 id 对应。

### 1.7 本地开发

真实的 `db` 和 `assets` 只在 claude.ai 里有。请做一个开发用的替身：`claude.use('db')` 拿不到时，如果页面地址带 `?dev`，就用一个存在 localStorage 里的假数据库（同样的 `doc / collection / onSnapshot / set / update` 接口子集），外加一个小面板，可以粘贴 Markdown 新增 step、查看 `answers`。这样在 iPad 上开本地页面就能完整试一遍。

## 2. 带着动脑的组件

四个组件都要支持 Apple Pencil：凡是让学生写理由的地方，都同时提供打字框和「✎ 手写」（沿用现有的手写板和转写），也都要支持粘贴截图。

### 2.1 `steps`：一步步揭开的例题

学生不再看一整道写好的例题，而是**每一步揭开前，先写下一步要做什么、为什么**，然后才看到真实的一步。

```steps
id: ex-rank1
title: 例2.1 求 Aⁿ
q: 设 $\boldsymbol\alpha=[a_1,a_2,a_3]^{\mathrm T}$，$\boldsymbol\beta=[b_1,b_2,b_3]^{\mathrm T}$，$A=\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$，求 $A^n$。

step: 写出 $A^2$
ask: 先别算矩阵。$A^2$ 用 $\boldsymbol\alpha$、$\boldsymbol\beta$ 怎么写？
show: $A^2=(\boldsymbol\alpha\boldsymbol\beta^{\mathrm T})(\boldsymbol\alpha\boldsymbol\beta^{\mathrm T})$

step: 换个括号
ask: 中间哪两个可以先乘？乘出来是什么形状？
choices: 一个数 | 一个 3×3 矩阵 | 一个 1×3 行向量
answer: 一个数
show: 结合律：$=\boldsymbol\alpha(\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha)\boldsymbol\beta^{\mathrm T}$，$\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha$ 是 $1\times1$，是一个数。

step: 推到 n 次
do: true
answer: (b·a)^(n-1) A
show: $A^n=(\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha)^{n-1}A$
```

字段：

- 开头的 `q:` 是题目，一直显示。
- 每个 `step:` 开始一步，`step:` 后面是这一步的小标题。
- `ask:` 是揭开前问学生的问题。学生必须先提交一次（打字、手写或选择），才能点「揭开这一步」。
- `choices:` 有的话，就给选项按钮（用 `|` 分隔）；`answer:` 是正确选项，选完立刻显示对错，但不管对错都可以揭开。没有 `choices:` 就是自由回答，不判对错，只记录。
- 自由回答旁边有一个「想不出来」按钮：点了直接揭开，记一条 `giveup` 事件。**想不出来是有用的信息，不能强迫学生瞎写。**
- `show:` 是揭开后显示的真实步骤。
- `do: true`：这一步不揭开，要学生自己做出来。学生作答（填值、打字或手写），之后可以点「对照答案」。这用来做「逐步撤掉脚手架」：同一个结构，第一道全部揭开，第二道最后一步 `do: true`，第三道全部 `do: true`。
- 揭开后，学生刚才写的预测留在原处，和真实步骤并排，方便对照。
- 每一步的预测、选项、对错、是否放弃、用时都记到 `answers`（`kind: 'steps'`，`detail` 里标是第几步）。

### 2.2 图跟着步骤动

`scene` 现在一次把所有东西都画出来。改成可以和 `steps` 联动，图随步骤一步步变化：

- `scene` 新增字段 `link: ex-rank1`，绑定一个 `steps` 组件。
- 绑定后，表达式里可以用变量 `step`（当前揭开到第几步，从 0 开始）。
- 命令新增修饰词 `from=k` / `until=k`：从第 k 步起显示、显示到第 k 步为止。
- 揭开新的一步时，变量 `t` 自动从 0 动到 1（约 0.8 秒），可以用来做过渡动画，例如 `grid lerp(I, A, t) from=2`。
- 绑定的图固定在 `steps` 组件旁边：屏幕够宽就在右侧，窄屏放在上方并吸顶，保证学生做题时看得到图。
- 没写 `link` 的 `scene` 行为不变。

例子：秩一矩阵把平面压成一条线。第 1 步只有向量 $\mathbf x$；第 2 步出现 $A\mathbf x$，网格动画压到 $\boldsymbol\alpha$ 那条线上；第 3 步出现 $A^2\mathbf x$，沿着这条线伸长。

### 2.3 `recognize`：认方法快练

只认方法，不计算。这是学生最大的问题：学完了，做题时认不出该用哪个方法。

```recognize
id: rec-power-1
title: 认方法
methods: 秩一公式 | 试算低次幂 | 拆 kE+B 二项展开 | 分块对角 | 其他
reason: true
shuffle: true

item: $A=\begin{bmatrix}1&-1&1\\-1&1&-1\\1&-1&1\end{bmatrix}$，求 $A^{10}$
answer: 秩一公式
why: 三行成比例（每个分量都核过），$A^n=[\operatorname{tr}A]^{n-1}A$

item: $A=\begin{bmatrix}2&1\\0&2\end{bmatrix}$，求 $A^{8}$
answer: 拆 kE+B 二项展开 | 试算低次幂
why: $A=2E+N$，$N^2=O$
```

- 一次只出一题，题干大字居中。
- 学生点一个方法；`reason: true` 时还要写一句「凭题目里的什么特征」（打字或手写，可以很短）。
- 提交后马上显示：对不对、标准方法、`why:`。学生点「下一题」继续。
- `answer:` 可以用 `|` 写多个可接受的方法。
- 每题都计时，显示已用时间但不扣分，记进 `answers`（`ms` 字段）。认出来要多久，本身就是诊断信息。
- `shuffle: true` 时打乱题目顺序。
- 全部做完显示一个小结：几题对、平均用时、错在哪几题，可以「只重做错的」。

### 2.4 `findbug`：找错

给出一份有错的解答，学生找出第一处错在哪一步，再说清楚错在哪。题源是学生自己错题档案里的真实错误。

```findbug
id: bug-ata
title: 这份解答错在哪？
q: $A$ 为 $5\times3$，三列长 1、2、3，第 1、2 列垂直，第 2、3 列垂直，第 1、3 列夹角 $120^\circ$。写出 $A^{\mathrm T}A$。
line: $A^{\mathrm T}A$ 的 $(i,j)$ 位是第 $i$ 列和第 $j$ 列的内积
line: 对角线是每列和自己的内积，填 $1, 2, 3$
line: $(1,3)$ 位 $=1\cdot3\cdot\cos120^\circ=-\tfrac32$
line: 其余非对角位是 $0$
bug: 2
why: 每列和自己的内积是长度的**平方**，对角线应为 $1, 4, 9$。
```

- 每个 `line:` 是一行，带编号显示。
- 学生先点他认为第一处错的那一行，再写错在哪（打字或手写）。
- 点对了行，就显示 `why:` 供对照；点错了，提示「这一行是对的，再看看」，记一次尝试，第二次错后可以看答案。
- 「错在哪」的文字只记录，不需要页面 Claude 判对错（对话里的 Claude 会看）。如果写了 `rubric:`，页面 Claude 可以给一句提示。

## 3. 现有组件在 live 模式下的调整

- `conjecture` 新增 `grade: off`：只记录不批改，提交后显示「已交，回对话等 Claude 看」。live 模式下默认 `grade: off`。页面批改容易给出「抓住要点了」这种结论，而这个判断应该留给对话里的 Claude。
- `answer` / `practice`：数值对错照常即时显示，因为程序判对错是可靠的。答对后**不显示**「过关」之类的推进字样。
- `summary` 在 live 模式下不需要。保留「复制学习记录」按钮作为备用。
- 页面 Claude 的所有提示词里，加一条：「只给提示，不给答案；不要说学生已经掌握。」

## 4. 对话里的 Claude 怎么用（写进 CLAUDE-PROJECT.md 新的一节）

- 每个单元发布一个 live artifact（上面的壳页面 + `files` 复制 `la-kit.js` + 三个 capabilities）。
- 往黑板写：用 `ArtifactData` 的 `set` 写 `steps/{id}`，`seq` 递增，`md` 是这一段的课件 Markdown。每段只放一件要学生动脑的事。
- 读作答：学生说「做完了」，就用 `ArtifactData` 的 `list` / `query` 读 `answers`（按 `step` 过滤）和 `events`；需要看手写原图，就用 Artifact 的 `read` 加 asset id 取图。
- 根据作答决定下一段：补讲、换一道、加一道追问，或进入新内容。写错了就把那段设 `hidden: true`。

## 5. 验收

1. `mode: guided` 的旧课件完全不受影响（现有测试和示范单元照常）。
2. `?dev` 本地模式：空黑板显示等待状态；在开发面板里新增 step，页面不刷新就出现新内容，已有内容（写了一半的作答、手写、拖过的图）不丢。
3. 每个组件作答后，`answers` 里出现一条完整记录；手写作答带 `images`，图能取回。
4. `steps`：没交预测之前点不了「揭开」；「想不出来」能直接揭开并记一条 `giveup`；`do: true` 的步骤要求作答；绑定的 `scene` 在第 k 步出现对应元素，并有过渡动画。
5. `recognize`：乱序出题、计时、记录理由，只重做错题。
6. `findbug`：选行、两次后可看答案、错在哪的说明（手写或打字）都记下来。
7. 在 iPad 上用 Apple Pencil 走一遍：所有新输入都能手写，防手掌误触照常。
8. 新组件的解析写单元测试；`npm test` 通过；重新打包并更新组件库 artifact（同一地址），capabilities 改为 `{"sample": {"images": true}, "db": {}, "assets": {}}`，再加一个 live 模式的示范页 `kit/examples/live-demo.html`。

## 6. 第一次试用

实现好以后，对话里的 Claude 用第2讲文稿04 的「秩一方阵」这一个单元试第一次：一道 `steps` 例题（带联动的图），两道逐步撤脚手架的题，一轮 `recognize`，一道用学生错题做的 `findbug`。试完再根据学生的体验调整组件。

# 线代学习台

让 Claude 在对话里用 **artifact** 给我上线性代数课。重点不是「看 Claude 讲」，而是**自己动手、自己得出结论**：Claude 负责设计推进的路径，组件库负责图形、计算和判分。

示范单元（也是组件库本身）：https://claude.ai/artifact/5ZUhFR5T5i1wMysQmthoAF

## 外观

风格：默认是「石墨」，中性深灰的底、线条干净，标题、标签、按钮和手写数字用手写体（数字和字母用 Caveat，中文用龙藏体，都来自 Google Fonts），正文用系统字体。讲解和图形直接写在板上，需要动手的地方圈出来。图里的向量第一次出现时会一笔一笔画出来。颜色含义固定：蓝 = 第一列，粉 = 第二列，黄（琥珀）= 结果和重点。还有四种风格可以换：课件开头的 front matter 写 `theme: chalk`（原来的墨绿黑板，带粉笔颗粒）、`paper`（纸本）、`midnight`（深蓝）、`white`（白板）。

## Apple Pencil

- **板书**：左下角「板书」按钮。打开后用 Pencil 在整页课件上书写，压感控制粗细，笔身倾斜写出粉笔侧锋的宽笔画；手指照常滚动和点按（防误触）；笔尖悬停时显示落笔位置。两指轻点撤销、三指轻点重做，橡皮按整笔擦除。笔迹跟着所在小节走，保存在这台设备上。课堂模式里，在当前板上新写的板书会跟着你下一条消息（或下一次作答）变成图片发给课堂里的 Claude，它看得到你在板上算了什么；只想给它看板书、不想打字，写完直接点发送（输入框空着也行，有没发的板书时发送键是亮的）。
- **作答框里直接写**：用 iPadOS 的「随手写」（用笔点输入框时不弹数字键盘）。
- **草稿区**：`draft` 可以用 Pencil 演算，内容保存在这台设备上。
- **Notability 手写粘贴**：在 Notability 里圈选「拷贝」（或者系统截图「拷贝并删除」），回到作答框下面的粘贴框长按「粘贴」，Claude 转写后你核对再提交。课堂模式里点输入框左边的图片按钮，在弹出的小框里粘贴。
- **暂时关掉的**：页面上的手写板（「✎ 手写作答」、手写猜想、草稿「拿给 Claude 看」、提问附手写）。在 `kit/src/features.js` 里打开。
- 网页拿不到 Pencil Pro 的双击、捏压和触感反馈（Apple 只开放给原生 App），所以用两指 / 三指轻点代替最常用的撤销 / 重做。

## 一个单元是怎么学的

```
发资料 → Claude 拆分知识单元 → 每次发布一个探究式课件 artifact
  课件里：动手算 → 拖动图形 → 说出猜想（Claude 批改、追问）→ 先猜再揭晓
         → 这时才给出定理 → 程序出题练习 → 单元检测
         → 哪里没懂，点「问 Claude」：它看得到当前小节和你的作答，还能直接改图演示
  学完：复制「学习记录」粘贴回对话 → Claude 根据错题和猜想追问、补讲
```

课件分成几个小节，完成本节的练习才会出现「继续」。进度和学习记录保存在这台设备的浏览器里。

### 实时黑板（mode: live）

另一种学法：课件页面只是一块黑板，对话里的 Claude（有你的记忆）一段一段往上写（写进这个 artifact 的数据库）。黑板和课堂模式一样一屏一块板：讲新的一件事就换一块新板，旧板在底部的翻板条上翻回去看；整个单元要用的记号和结论放在常驻栏里。说话都在对话框里，黑板上只有讲课内容。你在黑板上作答，每次尝试、揭开、放弃都存进数据库；在笔记软件里写的过程，用底部的「交截图」交上来。你回对话说「好了」，Claude 读一份「黑板现状」（最近的作答、还没点检查的草稿、写法错误、屏幕放不放得下、交来的截图），再决定下一段写什么：补讲、换一道、追问，或者换一块新板往下走。往下走的决定权在对话里。底部的「⋯」里是板书、复制学习记录和组件库版本号。说明见 `CLAUDE-PROJECT.md` 第五节、需求原文见 [`docs/live-board-spec.md`](docs/live-board-spec.md)。

### 课堂模式（mode: class）

页面底部只有一个输入框，用来跟「课堂里的 Claude」（只用 Opus 5.5、effort high）说话。黑板一屏一块板：讲新的一件事它就换一块新板，旧板在底部的翻页条上翻回去看，不用上下滑；它说的话写在当前板最上面一行，你发的消息不显示；整节课要用的记号和结论放在常驻栏里（横屏在右边，竖屏在上方）。你在黑板上作答，它马上接着教。板书、复制学习记录、「停久了提醒老师」（题还没做、4 分钟没动静时提醒它轻轻问一句，可以关）、下课在输入框右边的「⋯」里。板顶那句话后面的「Opus 5.5 ✓」表示这句话是平台核验过、由 Opus 5.5 回答的，「⋯」里写着这节课核验了几轮、作废了几轮。

它手里的教具：在板上圈、框、划、写旁注（`board mark`），会动的矩阵（`matrix`：幂次、分块、乘积，格子变了会闪、数挪了会飞），一行行写出来的推导（`derive`），当场画的示意图（`sketch`），讲义原图（`image`），黑板上的数让页面精确地算（公式里的 `\calc{…}`），换着数出题判分（`practice` 的自定义题型），判含 $n$ 的式子（`formula: n`，代几组 $n$ 比较，告诉你哪个 $n$ 对不上）。需求和设计见 [`docs/teaching-tools-spec.md`](docs/teaching-tools-spec.md)。项目对话里的 Claude 课前写资料包（`pack/main`、`pack/problems`），课后读课堂记录（`class_turns`、`class_notes`）。说明见 `CLAUDE-PROJECT.md` 第六节，需求原文见 [`docs/classroom-spec.md`](docs/classroom-spec.md)。本地试用：把 `kit/dist/la-kit.js` 放在同一个文件夹，打开 `kit/examples/class-demo.html?dev`（模拟老师按剧本回放，不花额度）。

本地试用实时黑板：打开 `kit/examples/live-demo.html?dev`（`la-kit.js` 放在同一目录），右上角的「开发面板」可以扮演对话里的 Claude 往黑板上写（第几块板、放不放常驻栏）、查看作答和页面写回的信息。

## 设置

1. 打开 Claude 里的项目，进入 **Project instructions（项目指令）**。
2. 以前贴进去的那一大段学习台说明删掉，换成下面这一段（你自己写的其他指令留着）：

   ```
   【线代学习台】做和学习台有关的任何事之前（做课件、写实时黑板、备课堂资料包、读课堂记录或学习记录），先用 Artifact 工具读最新说明：action: "read"，url: https://claude.ai/artifact/5ZUhFR5T5i1wMysQmthoAF ，path: "CLAUDE-PROJECT.md"。完全照它做；它和你记忆里的旧做法冲突时，以它为准。读不到就告诉我，不要凭记忆做。同一个对话里读一次就够，我说「说明更新了」再重读。
   ```

   说明的全文（[`CLAUDE-PROJECT.md`](CLAUDE-PROJECT.md)）跟着组件库一起发布，每次更新组件库它也一起更新，所以项目指令里只放这一段，以后不用再改。
3. 发资料给 Claude，或者说「按学习台格式做单元 2」。问它「学习台说明是哪个版本」，答的版本号应该和组件库页面「⋯」里写的一样。

## 组件

| 类别 | 组件 |
|---|---|
| 动手 | `answer` 作答判分（认可等价答案：分数/小数、不同的基、差倍数的特征向量；`formula: n` 写含 n 的式子、代值判分），`practice` 程序出题（`type: custom` 按模板随机取数出题） |
| 图形 | `scene` 描述式交互图（可拖动的点、滑块、变换网格、张成空间、目标），`predict` 先猜再揭晓 |
| 思考 | `conjecture` 用自己的话写下发现（页面 Claude 批改，或 `grade: off` 留给对话里的 Claude） |
| 带着动脑 | `steps` 一步步揭开的例题（先写下一步再看，图跟着步骤动），`recognize` 认方法快练（计时、只重做错的），`findbug` 找错 |
| 更多图形 | `graph` 函数图（密度、分布律、可拖的竖线、面积），`space` 可旋转的三维图（平面、张成、平行六面体），`scene` 里的 `curve` 参数曲线和 `eigen` 特征方向 |
| 检测 | `quiz` 选择/填空，`summary` 复制学习记录 |
| 演示 | `matrix` 会动的矩阵（滑块、分块、乘积点选、标注），`derive` 分拍板书，`sketch` 示意图，`image` 讲义原图，`rref` 逐步行化简（精确分数），`matmul` 矩阵乘法，`transform2d`、`vectors` |
| 验算 | `let` 定义整节课的量，公式里 `\calc{…}` 页面精确地算，`\hl{名字}{…}` 给一项起名字（课堂里用来圈它），`\chalk{颜色}{…}` 彩色粉笔 |
| 内容 | `definition` `theorem` `key` `warning` `example` `intuition`，`hint` `solution` `proof`，`card` |

完整写法见 [`CLAUDE-PROJECT.md`](CLAUDE-PROJECT.md)。

## artifact 怎么加载组件库

artifact 不能从 GitHub 加载脚本，也不能加载外部样式和字体。所以组件库打包成一个完全自包含的文件 `kit/dist/la-kit.js`（含 markdown-it、KaTeX 和内嵌字体），作为附带文件发布在上面那个示范 artifact 里。Claude 发布课件时，用 `files` 参数在服务器端把它复制过去，并声明 `capabilities: {"sample": {"images": true}}`，页面里的「问 Claude」、猜想批改和截图作答就能用了。实时黑板还要加上 `"db": {}, "assets": {}`。

## 仓库结构

```
CLAUDE-PROJECT.md        教 Claude 写课件的说明（跟着组件库发布；第三节打包进 la-kit.js 当组件手册）
CLAUDE.md                给 Claude Code 的开发说明（架构、命令、硬性规定）
docs/                    需求原文：实时黑板、课堂模式、课堂教具；数据结构组件的方案（待定）
kit/src/
  main.js                入口：渲染 <script type="text/markdown"> 里的课件，按 mode 分发
  guided.js              一次写完的课件：分节解锁、进度条
  live/                  实时黑板：分板（layout）、底部翻板条（livebar）、数据库连接、本地替身（?dev）、开发面板、作答和写法错误写回
  class/                 课堂模式：控制器（classroom）、输出解析（protocol）、提示词（prompt）、底部输入框（bar）、
                         一屏一块板（boardview、pagenav）、察觉卡住（stuck）、模拟老师和开发面板（?dev）
  render.js              Markdown + KaTeX + 组件 → 页面
  blocks/                各个组件（answer、steps、matrix、derive、sketch、image、practice……）
  scene.js  expr.js      图形描述语言、表达式求值
  graph.js  space.js     函数图、三维图
  link.js  mods.js       steps 和图的联动、命令行末尾的修饰
  exact.js  linalg.js    精确分数（\calc、let 块）、行化简
  markspec.js  markdraw.js  marks.js   板书标注：写法、手绘的圈框箭头和旁注位置、画到页面上
  matrixspec.js          会动的矩阵：写法、精确求值、哪些格子变了
  formula.js  formulainput.js  含 n 的式子：读懂写法、代值判分、输入框
  practicespec.js        自定义练习题型：模板、随机取数、自检
  derivespec.js  svgsafe.js    分拍板书；示意图的 SVG 清理
  check.js  mathinput.js 判分（等价答案）、作答输入和数字小键盘
  generators.js          练习题生成器
  drafts.js              还没提交的草稿（课堂 Claude 和实时黑板都看得到）
  ai.js  tutor.js        页面里调用 Claude、助教面板
  ink/                   Apple Pencil 板书、手写板
  photo.js  flatten.js   截图作答；截图转白底 PNG
  session.js  record.js  关卡、作答、图形注册；学习记录
  features.js            功能开关（页面手写板暂时关着）
  styles.css  themes.css 样式（默认石墨）和另外四种风格
kit/dist/la-kit.js       打包好的单文件（自包含）
kit/examples/            示范单元、组件展示页、实时黑板和课堂的本地试用页（?dev）
tests/                   单元测试（node --test）
.github/workflows/       GitHub 上每次推送自动跑测试、检查打包文件和源码一致
```

## 修改组件库之后

```bash
npm install
npm test          # 单元测试
npm run build     # 重新生成 kit/dist/la-kit.js（DEBUG=1 时不压缩）
```

然后重新发布组件库 artifact（同一个地址，页面是 `kit/examples/unit-matrix-vector.html`，附带文件 `la-kit.js` 来自 `kit/dist/la-kit.js`，`capabilities: {"sample": {"images": true}, "db": {}, "assets": {}}`）。之后新发布的课件会自动用上新版；已经发布的课件保留当时复制的版本。

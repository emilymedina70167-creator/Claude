# 线代学习台

让 Claude 在对话里用 **artifact** 给我上线性代数课。重点不是「看 Claude 讲」，而是**自己动手、自己得出结论**：Claude 负责设计推进的路径，组件库负责图形、计算和判分。

示范单元（也是组件库本身）：https://claude.ai/artifact/5ZUhFR5T5i1wMysQmthoAF

## 外观

黑板风格：墨绿黑板带粉笔灰质感，标题、标签、按钮和手写数字用粉笔手写体（数字和字母用 Caveat，中文用龙藏体，都来自 Google Fonts），正文用系统字体。讲解和图形直接写在黑板上，需要动手的地方用粉笔圈出来。图里的向量第一次出现时会一笔一笔画出来。粉笔颜色含义固定：蓝 = 第一列，粉 = 第二列，黄 = 结果和重点。

## Apple Pencil

- **板书**：左下角「板书」按钮。打开后用 Pencil 在整页课件上书写，压感控制粗细，笔身倾斜写出粉笔侧锋的宽笔画；手指照常滚动和点按（防误触）；笔尖悬停时显示落笔位置。两指轻点撤销、三指轻点重做，橡皮按整笔擦除。笔迹跟着所在小节走，保存在这台设备上。
- **手写作答**：作答框旁「✎ 手写作答」，写完由页面里的 Claude 识别并填进格子，确认后再提交。也可以直接在作答框里用 iPadOS 的「随手写」（用笔点输入框时不弹数字键盘）。
- **手写猜想 / 草稿 / 提问附图**：`conjecture` 可以手写后转文字；`draft` 草稿区可以演算并「拿给 Claude 看」；助教面板可以附手写内容。
- 网页拿不到 Pencil Pro 的双击、捏压和触感反馈（Apple 只开放给原生 App），所以用两指 / 三指轻点代替最常用的撤销 / 重做。

## 一个单元是怎么学的

```
发资料 → Claude 拆分知识单元 → 每次发布一个探究式课件 artifact
  课件里：动手算 → 拖动图形 → 说出猜想（Claude 批改、追问）→ 先猜再揭晓
         → 这时才给出定理 → 程序出题练习 → 单元检测
         → 哪里没懂，点「问 Claude」：它看得到当前小节和你的作答，还能直接改图演示
         → 不想打字：在笔记软件里手写，截图上传，Claude 转写后你核对再提交
  学完：复制「学习记录」粘贴回对话 → Claude 根据错题和猜想追问、补讲
```

课件分成几个小节，完成本节的练习才会出现「继续」。进度和学习记录保存在这台设备的浏览器里。

### 实时黑板（mode: live）

另一种学法：课件页面只是一个壳，对话里的 Claude 一段一段往黑板上写（写进这个 artifact 的数据库）。你在黑板上作答，每次尝试、手写原图、揭开 / 放弃 / 做完都存进数据库；你回对话说「做完了」，Claude 读你的作答，再决定下一段写什么：补讲、换一道、追问，或者往下走。往下走的决定权在对话里。说明见 `CLAUDE-PROJECT.md` 第五节、需求原文见 [`docs/live-board-spec.md`](docs/live-board-spec.md)。

### 课堂模式（mode: class）

页面底部是对话框，「课堂里的 Claude」（只用 Opus 5.5、effort high）一边说话，一边用组件库现场画黑板；你在黑板上作答，它马上接着教。项目对话里的 Claude 课前写资料包（`pack/main`、`pack/problems`），课后读课堂记录（`class_turns`、`class_notes`）。说明见 `CLAUDE-PROJECT.md` 第六节，需求原文见 [`docs/classroom-spec.md`](docs/classroom-spec.md)。本地试用：`kit/examples/class-demo.html?dev`（模拟老师按剧本回放，不花额度）。

本地试用实时黑板：打开 `kit/examples/live-demo.html?dev`（`la-kit.js` 放在同一目录），右上角的「开发面板」可以扮演对话里的 Claude 往黑板上写、查看作答。

## 设置

1. 打开 Claude 里的线性代数项目，进入 **Project instructions（项目指令）**。
2. 把 [`CLAUDE-PROJECT.md`](CLAUDE-PROJECT.md) 的全部内容粘贴进去，放在原有指令后面。
3. 发资料给 Claude，或者说「按学习台格式做单元 2」。

## 组件

| 类别 | 组件 |
|---|---|
| 动手 | `answer` 作答判分（认可等价答案：分数/小数、不同的基、差倍数的特征向量），`practice` 程序出题 |
| 图形 | `scene` 描述式交互图（可拖动的点、滑块、变换网格、张成空间、目标），`predict` 先猜再揭晓 |
| 思考 | `conjecture` 用自己的话写下发现（页面 Claude 批改，或 `grade: off` 留给对话里的 Claude） |
| 带着动脑 | `steps` 一步步揭开的例题（先写下一步再看，图跟着步骤动），`recognize` 认方法快练（计时、只重做错的），`findbug` 找错 |
| 更多图形 | `graph` 函数图（密度、分布律、可拖的竖线、面积），`space` 可旋转的三维图（平面、张成、平行六面体），`scene` 里的 `curve` 参数曲线和 `eigen` 特征方向 |
| 检测 | `quiz` 选择/填空，`summary` 复制学习记录 |
| 演示 | `rref` 逐步行化简（精确分数），`matmul` 矩阵乘法，`transform2d`、`vectors` |
| 内容 | `definition` `theorem` `key` `warning` `example` `intuition`，`hint` `solution` `proof`，`card` |

完整写法见 [`CLAUDE-PROJECT.md`](CLAUDE-PROJECT.md)。

## artifact 怎么加载组件库

artifact 不能从 GitHub 加载脚本，也不能加载外部样式和字体。所以组件库打包成一个完全自包含的文件 `kit/dist/la-kit.js`（含 markdown-it、KaTeX 和内嵌字体），作为附带文件发布在上面那个示范 artifact 里。Claude 发布课件时，用 `files` 参数在服务器端把它复制过去，并声明 `capabilities: {"sample": {"images": true}}`，页面里的「问 Claude」、猜想批改、截图作答和 Apple Pencil 手写识别就能用了。实时黑板还要加上 `"db": {}, "assets": {}`。

## 仓库结构

```
CLAUDE-PROJECT.md        放进 Claude 项目指令的教学说明
kit/src/
  main.js                入口：渲染 <script type="text/markdown"> 里的课件
  guided.js              分节解锁、进度条
  live/                  实时黑板：数据库连接、本地替身（?dev）、开发面板、作答写回
  class/                 课堂模式：输出解析（protocol）、提示词（prompt）、底部对话条（bar）、控制器（classroom）、模拟老师
  graph.js  space.js     函数图、三维图
  link.js                steps 和图的联动
  session.js             关卡、学习记录、图形注册
  scene.js  expr.js      图形描述语言、表达式求值
  check.js  mathinput.js 判分（等价答案）、作答输入和数字小键盘
  generators.js          练习题生成器
  ai.js  tutor.js        页面里调用 Claude、助教面板
  photo.js               截图作答：上传/粘贴手写截图，Claude 转写、读出最终答案
  record.js              学习记录
  blocks/                各个组件
  linalg.js              精确分数、行化简
  styles.css             样式（自动适配深色模式）
kit/dist/la-kit.js       打包好的单文件
kit/examples/            示范单元、组件展示页
tests/                   单元测试
```

## 修改组件库之后

```bash
npm install
npm test          # 单元测试
npm run build     # 重新生成 kit/dist/la-kit.js（DEBUG=1 时不压缩）
```

然后重新发布组件库 artifact（同一个地址，页面是 `kit/examples/unit-matrix-vector.html`，附带文件 `la-kit.js` 来自 `kit/dist/la-kit.js`，`capabilities: {"sample": {"images": true}, "db": {}, "assets": {}}`）。之后新发布的课件会自动用上新版；已经发布的课件保留当时复制的版本。

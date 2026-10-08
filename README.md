# 线代学习台

让 Claude 在对话里用 **artifact** 给我上线性代数课。重点不是「看 Claude 讲」，而是**自己动手、自己得出结论**：Claude 负责设计推进的路径，组件库负责图形、计算和判分。

示范单元（也是组件库本身）：https://claude.ai/artifact/5ZUhFR5T5i1wMysQmthoAF

## 外观

黑板风格：墨绿黑板带粉笔灰质感，标题、标签、按钮和手写数字用粉笔手写体（数字和字母用 Caveat，中文用龙藏体，都来自 Google Fonts），正文用系统字体。讲解和图形直接写在黑板上，需要动手的地方用粉笔圈出来。图里的向量第一次出现时会一笔一笔画出来。粉笔颜色含义固定：蓝 = 第一列，粉 = 第二列，黄 = 结果和重点。

## 一个单元是怎么学的

```
发资料 → Claude 拆分知识单元 → 每次发布一个探究式课件 artifact
  课件里：动手算 → 拖动图形 → 说出猜想（Claude 批改、追问）→ 先猜再揭晓
         → 这时才给出定理 → 程序出题练习 → 单元检测
         → 哪里没懂，点「问 Claude」：它看得到当前小节和你的作答，还能直接改图演示
  学完：复制「学习记录」粘贴回对话 → Claude 根据错题和猜想追问、补讲
```

课件分成几个小节，完成本节的练习才会出现「继续」。进度和学习记录保存在这台设备的浏览器里。

## 设置

1. 打开 Claude 里的线性代数项目，进入 **Project instructions（项目指令）**。
2. 把 [`CLAUDE-PROJECT.md`](CLAUDE-PROJECT.md) 的全部内容粘贴进去，放在原有指令后面。
3. 发资料给 Claude，或者说「按学习台格式做单元 2」。

## 组件

| 类别 | 组件 |
|---|---|
| 动手 | `answer` 作答判分（认可等价答案：分数/小数、不同的基、差倍数的特征向量），`practice` 程序出题 |
| 图形 | `scene` 描述式交互图（可拖动的点、滑块、变换网格、张成空间、目标），`predict` 先猜再揭晓 |
| 思考 | `conjecture` 用自己的话写下发现，由页面里的 Claude 按评分要点批改 |
| 检测 | `quiz` 选择/填空，`summary` 复制学习记录 |
| 演示 | `rref` 逐步行化简（精确分数），`matmul` 矩阵乘法，`transform2d`、`vectors` |
| 内容 | `definition` `theorem` `key` `warning` `example` `intuition`，`hint` `solution` `proof`，`card` |

完整写法见 [`CLAUDE-PROJECT.md`](CLAUDE-PROJECT.md)。

## artifact 怎么加载组件库

artifact 不能从 GitHub 加载脚本，也不能加载外部样式和字体。所以组件库打包成一个完全自包含的文件 `kit/dist/la-kit.js`（含 markdown-it、KaTeX 和内嵌字体），作为附带文件发布在上面那个示范 artifact 里。Claude 发布课件时，用 `files` 参数在服务器端把它复制过去，并声明 `capabilities: {"sample": {}}`，页面里的「问 Claude」和猜想批改就能用了。

## 仓库结构

```
CLAUDE-PROJECT.md        放进 Claude 项目指令的教学说明
kit/src/
  main.js                入口：渲染 <script type="text/markdown"> 里的课件
  guided.js              分节解锁、进度条
  session.js             关卡、学习记录、图形注册
  scene.js  expr.js      图形描述语言、表达式求值
  check.js  mathinput.js 判分（等价答案）、作答输入和数字小键盘
  generators.js          练习题生成器
  ai.js  tutor.js        页面里调用 Claude、助教面板
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

然后重新发布组件库 artifact（同一个地址，页面是 `kit/examples/unit-matrix-vector.html`，附带文件 `la-kit.js` 来自 `kit/dist/la-kit.js`，`capabilities: {"sample": {}}`）。之后新发布的课件会自动用上新版；已经发布的课件保留当时复制的版本。

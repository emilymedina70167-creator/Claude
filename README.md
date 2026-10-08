# 线代学习台

让 Claude 在对话里用 **artifact** 给我上线性代数课。课件里可以有：

- **线性变换动画**：网格从单位矩阵平滑变成 $A$，能拖动 î、ĵ 改矩阵，能看行列式面积和特征向量方向
- **可拖动的向量**：向量加法、线性组合（滑块调系数去命中目标点）、张成空间
- **逐步行化简**：自动用精确分数算出 RREF 的每一步，判断无解/唯一解/无穷多解并写出通解
- **矩阵乘法**：点结果里任意一个数，高亮对应的行和列，显示计算过程
- **练习题**：单选、多选、填空（分数和小数都能判对），带解析
- **定义 / 定理 / 易错点**提示框，可折叠的**提示 / 解答 / 证明**，可翻面的**记忆卡**

Claude 只负责写课件内容（Markdown 加组件标记），画图、互动和计算都由这个仓库里的组件库完成，所以每节课的样式一致，计算也不会出错。

## 怎么用

1. 打开 Claude 里的线性代数项目，进入 **Project instructions（项目指令）**。
2. 把 [`CLAUDE-PROJECT.md`](CLAUDE-PROJECT.md) 的全部内容粘贴进去，放在原有指令后面即可。
   也可以在项目知识库里用「Add from GitHub」添加这个文件，然后在项目指令里写一句「做课件时遵循知识库中的 CLAUDE-PROJECT.md」。
3. 在项目里新开对话，比如说「讲特征值和特征向量」，Claude 就会生成一个互动 artifact。

示例课件：[`kit/examples/demo.html`](kit/examples/demo.html)，用到了所有组件。

## artifact 是怎么加载组件库的

claude.ai 的 artifact 不能从 GitHub 加载脚本，也不能加载外部样式和字体，所以组件库打包成一个完全自包含的文件 `kit/dist/la-kit.js`（含 markdown-it、KaTeX 和内嵌字体），发布在 artifact「线代学习台」里：

https://claude.ai/artifact/5ZUhFR5T5i1wMysQmthoAF

这个 artifact 的页面是示例课，`la-kit.js` 是它的附带文件。Claude 发布每节课时，用 `files` 参数在服务器端把 `la-kit.js` 复制进新的课件 artifact，页面里只需要 `<script src="la-kit.js">`。

## 仓库结构

```
CLAUDE-PROJECT.md      放进 Claude 项目指令的课件格式说明
kit/src/               组件库源码
  linalg.js            分数运算、行化简、矩阵乘法、特征值
  render.js            Markdown + KaTeX 公式渲染，挂载组件
  blocks/              各个互动组件
  styles.css           样式（自动适配深色模式）
kit/dist/la-kit.js     打包好的单文件（artifact 加载的就是它，需要提交到仓库）
kit/examples/          示例课件
tests/                 单元测试
```

## 修改组件库之后

```bash
npm install
npm test          # 单元测试
npm run build     # 重新生成 kit/dist/la-kit.js
```

然后重新发布组件库 artifact（同一个地址，页面是 `kit/examples/demo.html`，附带文件 `la-kit.js` 来自 `kit/dist/la-kit.js`）。之后新生成的课件会自动用上新版；已经生成的课件保留当时复制的版本。

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

`CLAUDE-PROJECT.md` 模板里的这一行会通过 jsDelivr 从本仓库加载组件库：

```html
<script src="https://cdn.jsdelivr.net/gh/emilymedina70167-creator/Claude@<提交号>/kit/dist/la-kit.js"></script>
```

`@` 后面是一个**提交号（commit hash）**，指向固定的一份代码，不需要版本标签，也永远不会变。组件库加载后，会自动把 `<script type="text/markdown">` 里的课件渲染出来。

组件库更新时，`CLAUDE-PROJECT.md` 里的提交号也会一起更新，把新的内容重新粘贴到 Claude 项目指令即可。

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

提交并推送后，把 `CLAUDE-PROJECT.md` 里的提交号换成包含新 `la-kit.js` 的那次提交。

# 学习台

考研（数学一、408、英语一、政治，目标 410 分）用的学习台：一个 claude.ai artifact，https://claude.ai/artifact/BCAMUUkMWc2rt5hSS1ULHo 。在 iPad 上用。

- 学习台是教学环境（黑板、能拖的图、一步步揭开的例题、当场判分、Apple Pencil 手写）加学习数据的存储（artifact 数据库：每一次作答、说的话、错题、掌握、复现、教材、真题）。
- 上课：claude.ai「学习」项目里每节课开一个新任务，任务直接读写学习台，在黑板上讲（写法 `docs/ext-class.md`，最简的接口在学习台数据库的 `meta/interface`）。
- 项目聊天里的协调者排课、看进度、做评估。
- 课上在 Safari 单独的标签页里全屏开学习台：学生打字、交作答时页面发一条评论叫醒上课的任务（Claude App 里嵌着的视图发不了）。

## 仓库

```
CLAUDE.md            给 Claude Code 的开发说明（现状、命令、发布）
kit/components.md    组件写法（构建时打包进 la-kit.js）
kit/src/             组件库源码；kit/desk.html 是发布到学习台的页面
kit/dist/la-kit.js   打包好的单文件（自包含，提交在仓库里）
kit/examples/        组件示例页（?dev 用替身数据库）
docs/ext-class.md    外部的课（上课的任务在黑板上讲课）的完整写法
docs/exam-ingest.md  真题入库手册
tools/               预检（ext-check）、页面检查、e2e、真题和教材入库工具
tests/               单元测试（node --test）
evals/               几把尺子的数据（模拟课、预测分）
```

```bash
npm install
npm test
npm run build
```

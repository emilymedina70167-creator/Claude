# 给 Claude Code 的开发说明

这个仓库是「学习台」：我（考研，目标 410 分，数学一、408、英语一、政治）在 iPad 上用的一个 claude.ai artifact，https://claude.ai/artifact/BCAMUUkMWc2rt5hSS1ULHo 。学习台是教学环境（黑板、组件、当场判分）加学习数据的存储（artifact 数据库）。这里只写现状；以前各轮的计划、设计都删了，要查看 git 历史。

## 现在的分工

- **上课**：claude.ai「学习」项目里每节课开一个新任务（线程），任务直接读写学习台（`ArtifactData`）和这个仓库，在学习台的黑板上讲课（`kind: ext` 的课）。主讲不在 claude.ai 的旧项目对话里了。
- **学习大脑**：项目聊天里的协调者，负责排课、进度和评估。
- **页面里的 Claude**（练习教练、板边助教、`board claude`）是可选的，不是必需。
- **教材**：只用来备课的放仓库就行；要上黑板（贴原页）才传进学习台。
- **开发**：只做我明确要求的改动，不顺手加功能。

## 上课要用的参考

- 最简的接口：学习台数据库里的 `meta/interface`（页面照代码写，`kit/src/project/iface.js`）。
- 外部的课的完整写法（开一节、`ext_in` / `ext_out`、预备板、预案、`board claude`、`ext_jobs`、`board check`、预检工具）：`docs/ext-class.md`。
- board 块的通用写法：`kit/src/class/prompt.js` 的 `PROTOCOL_DOC`、`PROJECT_CLASS_DOC`。
- 组件写法：`kit/components.md`（构建时打包进 `la-kit.js`）。舞台、widget 的写法：`kit/src/stage/doc.js` 的 `stageManual`、`kit/src/widgetspec.js` 的 `WIDGET_DOC`。
- 每一类数据的字段、编号、谁能写：`kit/src/memory/schema.js`（`COLLECTIONS`），考试资料 `kit/src/exam/schema.js`（`EXAM_COLLECTIONS`）。
- 预检一轮：`node tools/ext-check.mjs --next 一轮.txt --lint`（不开浏览器）或 `--shots 目录`（真浏览器截图）。
- 真题入库：`docs/exam-ingest.md`（408 的 2009–2026 已入库，数学一、英语一、政治还没有）。
- 教材转写进学习台：`tools/books.mjs` 文件开头写着步骤。

## 开工先看

学习台的 `meta/errors`（页面出过的错）、`meta/health`（体检拿不准的），`dev_requests` 里 `status: open` 的（做完写 `done`），`exam_uploads` 里 `status: waiting` 的（告诉我有几份等入库）。

## 分支

- `main` 是主干，永远能用。新改动从 `main` 开分支，做完合回 `main`。
- 合回 `main` 之前：`npm test` 全过，`npm run build` 之后提交 `kit/dist/la-kit.js`（产物要和源码一致，build 之后 `git status` 干净）。CI（`.github/workflows/test.yml`）会查这一点，另外跑 e2e。

## 命令

```bash
npm install
npm test          # tests/ 下全部单元测试（node --test，纯函数为主）
npm run build     # 生成 kit/dist/la-kit.js（DEBUG=1 时不压缩），还有 kit/dist/pdf/
npm run e2e       # 先 build；真浏览器里把学习台整条流程走一遍（tools/desk-e2e.mjs，--only 段名、--shots 目录）
npm run check:pages   # 全部示例页在两种 iPad 尺寸下渲染、走一遍（改了组件要跑）
npm run docs:size     # 每门课的组件说明离 40 KiB 上限还剩多少
```

- 改了学习台、课堂的任何东西，合进 `main` 之前跑 `npm run e2e`；新加会写数据库的流程在里面加一段。
- 页面检查：`node tools/check-lesson.mjs 文件…`（`.md` 课件、`.html` 示例页、`.class.json` 课堂输出），`--shots 目录` 存截图。
- 组件画廊：`npm run gallery -- --out 目录 kit/examples/408-demo.html`。
- 预测分：改了 `kit/src/forecast/`、`kit/src/memory/score.js` 先跑 `node tools/forecast-sim.mjs`。
- 浏览器里看：一个目录里放 `kit/dist/la-kit.js` 和 `kit/examples/*.html`，起静态服务器。`desk-demo.html?dev` 是学习台（替身数据库，「填入示例记忆」），`class-demo.html?dev` 是课堂（模拟老师）。示例页开头的 `<!doctype html>`、`<meta charset="utf-8">` 不能删。
- iPad 尺寸：竖屏 820×1180，横屏 1180×820。云端会话里用预装的 Playwright + Chromium 截图。
- 私人数据（`ArtifactData list` 存下来的）放 `.superpowers/` 下面，不进 git。

## 架构

页面只有几行：`<script src="la-kit.js">` 加一段 `<script type="text/markdown">`。`kit/src/main.js` 按 front matter 的 `mode` 分发；学习台是 `mode: desk`（`kit/desk.html`），每节课开在它里面（`sessions/{编号}`）。

- `render.js`：Markdown（markdown-it + KaTeX）+ 围栏组件 → DOM；组件在 `blocks/`，注册在 `blocks/index.js`。演示组件是 `stepper.js` 外壳加 `engines/` 里的纯函数引擎（`engines/registry.js` 登记）。
- 图形和计算：`scene.js`、`graph.js` + `graphspec.js`、`space.js` + `spacespec.js`、`expr.js`（表达式，默认弧度）、`exact.js`（精确分数、`\calc`、`let`）、`fx/`（求导、极限、积分、平面和三维几何）、`prob/`（概率组件，精确分数）。
- 课堂：`class/`（`classroom.js` 控制器，`protocol.js` 解析 board 块，`prompt.js` 发给页面里的 Claude 的说明，`ext.js` 外部的课，`boardview.js` 板）。检验 `check/`，标注 `markspec.js` `markdraw.js` `marks.js`。
- 学习台和数据：`memory/`（`schema.js` 分类和谁能写、`desk.js` 首页、`writer.js` 写数据库的出口、`check.js` 自检、`health.js` 体检、`report.js` 课后报告、`mastery.js`、`state.js`）、`live/store.js` + `sync.js`（数据库和证据）、`project/`（接口卡、事实、笔记本、journal）、`exam/`（考试资料）、`forecast/`（预测分）、`books/`（教材）。
- 组件手册：`kit/build-docs.js` 从 `kit/components.md` 截出「## 组件参考」打包（`virtual:component-docs`），`subject.js` 按科目（小节下的 `<!-- 科目：… -->`）和名字取，`<!-- 完整写法 -->` 以后是不常用的写法。版本号在 `kit/components.md` 开头「版本：YYYY-MM-DD」，构建时打进 `LAKit.version`。
- 样式：`styles.css`、`themes.css`（学习台用紫藤：白天 `ink`、晚上 `inknight`），课堂另有 `class/*.css`。颜色都走 CSS 变量（`tests/theme.test.js` 守着）。
- 能写成纯函数的放在不碰 DOM 的模块里，用 `node --test` 测。

## 硬性规定

- 页面调用的 Claude 只能是 Opus 5.5、effort high；平台回的 `modelApplied` 不是 `claude-opus-5-5` 时整轮作废，不加退路模型。
- `la-kit.js` 必须自包含：artifact 不能从 GitHub / 任意 CDN 加载脚本，也不能加载外部样式和字体（Google Fonts 除外）。
- 组件写错要在页面上报出来，不能静默失败。
- 发给 Claude 的提示词里提到学生不用「他」「她」（有测试守着）。
- 不用 `window.confirm` / `alert` / `prompt`（claude.ai 沙箱里直接当取消），用 `kit/src/dialog.js`（`tests/no-modals.test.js`）。
- 页面简洁：不加教我怎么用的提示、说明小字（`tests/quiet-ui.test.js`）。加东西先问：是功能、数据，还是教我怎么用？是后者就不加。
- 掌握只看做题的事实，不问「有把握吗」。

## 写代码的习惯

- 注释、界面文字、提交说明都用中文；注释写「为什么」。
- 界面以 iPad 为准：触控目标至少 44px，输入框字号 16px，注意软键盘、横竖屏、Apple Pencil。
- 给我看的页面少放编号，换成标题；长列表先列几条、其余收起。

## 发布学习台

合进 `main` 以后重新发布学习台，不用问我。页面是 `kit/desk.html`，附带文件 `la-kit.js`（`kit/dist/la-kit.js`）；`pdf/*`（`kit/dist/pdf/`，`.mjs` 写 `text/javascript`、`.wasm` 写 `application/wasm`）只在 pdf.js 升级时重传；`dict/en.json`（`kit/dist/dict/en.json`）只在重新生成词典时重传。`capabilities` 不传，沿用已有的 `sample`（带图）、`db`、`assets`、`downloads`、`comments`；要改就五个一起写全。数据库、assets 不受发布影响。每次发布前把 `kit/components.md` 的版本号改新（同一天加 b、c），重新 build。

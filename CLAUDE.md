# 给 Claude Code 的开发说明

这个仓库是「线代学习台」：让 Claude 在 claude.ai 的 artifact 里给我上课。对话框只能出文字和简陋的图，所以 Claude 不在对话里讲，而是把课堂搬到一块黑板上：能拖的图、一步步揭开的例题、先猜再揭晓、自动判分、Apple Pencil 手写。Claude 设计「推着我自己得出结论」的路径，组件库 `la-kit` 负责图形、计算和判分。我在 iPad 上用。

- 面向我的说明：`README.md`
- 放进 claude.ai 项目指令、教 Claude 写课件的说明：`CLAUDE-PROJECT.md`（第三节「组件参考」还会在构建时打包进 `la-kit.js`，给课堂里的 Claude 当组件手册，见下文）
- 需求原文：`docs/live-board-spec.md`（实时黑板）、`docs/classroom-spec.md`（课堂模式）

## 分支

- `main` 是主干，永远是能用的最新版本。
- 新功能从 `main` 开分支，做完合回 `main`。不要在旧功能分支上接着叠。
- 合回 `main` 之前：`npm test` 全过，`npm run build` 之后提交 `kit/dist/la-kit.js`。

## 命令

```bash
npm install
npm test          # node --test，tests/ 下全部单元测试（纯函数为主，不开浏览器）
npm run build     # 生成 kit/dist/la-kit.js（DEBUG=1 时不压缩）
```

- 改了 `kit/src/` 或 `CLAUDE-PROJECT.md` 第三节，都要重新 build 并提交 `kit/dist/la-kit.js`。产物要和源码一致（`npm run build` 之后 `git status` 应该是干净的）。
- 浏览器里看效果：在一个目录里放 `kit/dist/la-kit.js` 和 `kit/examples/*.html`，起一个静态服务器打开。
  - `unit-matrix-vector.html`：引导模式示范单元（也是组件库 artifact 的页面）
  - `live-demo.html?dev`：实时黑板，右上角开发面板扮演对话里的 Claude
  - `class-demo.html?dev`：课堂模式，模拟老师按剧本回放（不调用 Claude）；剧本里故意有一段写错的组件（`circle` 那行），控制台报「看不懂这一行」是正常的
  - iPad 尺寸：竖屏 820×1180，横屏 1180×820。云端会话里可以用预装的 Playwright + Chromium 截图检查。

## 架构

页面只有几行：`<script src="la-kit.js">` 加一段 `<script type="text/markdown">` 课件。`kit/src/main.js` 读 front matter 的 `mode` 分发：

| mode | 入口 | 说明 |
|---|---|---|
| `guided` | `guided.js` | 一整个单元，按 `##` 分节解锁；学习记录复制回对话 |
| `live` | `live/` | 对话里的 Claude 一段一段写进 artifact 数据库，页面实时显示；作答写回数据库 |
| `class` | `class/` | 页面底部对话条，课堂里的 Claude 边说边画；学生作答自动发给它 |

- `render.js`：Markdown（markdown-it + KaTeX）+ 围栏组件 → DOM。组件在 `blocks/`，注册在 `blocks/index.js`。
- `session.js`：全局状态（关卡、作答记录、图形注册 `session.scenes`、写法错误 `session.problems`）。
- 图形：`scene.js`（描述式交互图）、`graph.js`（函数图）、`space.js`（三维）、`expr.js`（表达式求值）、`link.js`（steps 和图的联动）。
- 判分：`check.js`、`mathinput.js`；精确分数和行化简：`linalg.js`。
- 页面里调用 Claude：`ai.js`（`window.claude.use('sample')`，旧接口 `window.claude.complete`）。
- 手写：`ink/`（整页板书 overlay、手写板 pad）；截图作答：`photo.js`。
- 样式：`styles.css`（黑板主题，自动适配深色），课堂模式另有 `class/class.css`、`class/board.css`。

### 课堂模式（`kit/src/class/`）

- `classroom.js`：控制器。黑板段落、学生作答排队（1.5 秒合并）、调用课堂 Claude、执行黑板指令、写法自检和自动重写、刷新后恢复。
- `protocol.js`：解析课堂 Claude 的输出。普通文字是对学生说的话；```` ```board ```` 围栏块是黑板指令（add / replace / hide / figure）。纯函数，支持流式前缀。
- `prompt.js`：每一轮发给课堂 Claude 的内容（红线 `DEFAULT_RULES`、黑板指令说明 `PROTOCOL_DOC`、组件手册、资料包、黑板现状、对话历史和压缩）。纯函数。
- `docs.js` + `kit/build-docs.js`：构建时从 `CLAUDE-PROJECT.md` 第三节截出组件手册打包进去。
- `bar.js`：底部对话条（消息区、快捷按钮、附图、手写板、iPad 软键盘）。
- `devteacher.js`：`?dev` 的模拟老师；`devpanel.js`：开发面板。
- 数据（artifact 数据库）：`steps` 黑板段落，`class_turns` 每一轮，`class_notes` 观察和下课小结，`answers` / `events` 作答，`pack/main`、`pack/problems` 资料包。

## 硬性规定（我明确要求过的，不要改）

- 课堂里讲课的 Claude **只能是 Opus 5.5、effort high**（`TEACH` in `classroom.js`）。返回的 `modelApplied` 不是 `claude-opus-5-5` 时整轮作废：不显示、不执行黑板指令、不进对话历史。不要加退路模型。
- 发给 Claude 的提示词里提到学生不用「他」「她」（有测试守着）。
- artifact 不能从 GitHub / 任意 CDN 加载脚本，也不能加载外部样式和字体（Google Fonts 除外）：`la-kit.js` 必须自包含。
- 课件作者（对话里的 Claude）看不到渲染效果，所以组件写错要在页面上自检报出来，不能静默失败。

## 写代码的习惯

- 注释、界面文字、提交说明都用中文；注释写「为什么」，密度和现有代码一致。
- 能写成纯函数的逻辑放在不碰 DOM 的模块里，用 `node --test` 测；DOM 行为靠浏览器里实际操作验证。
- 界面以 iPad 为准：触控目标至少 44px，输入框字号 16px（防止聚焦放大），注意软键盘、横竖屏、Apple Pencil。

## 发布组件库

改完并合进 `main` 后，要重新发布组件库 artifact（https://claude.ai/artifact/5ZUhFR5T5i1wMysQmthoAF）：页面是 `kit/examples/unit-matrix-vector.html`，附带文件 `la-kit.js` 来自 `kit/dist/la-kit.js`，`capabilities: {"sample": {"images": true}, "db": {}, "assets": {}}`。之后新发布的课件自动用新版，已经发布的保留当时复制的版本。发布前先问我。

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
| `live` | `live/` | 一屏一块板：对话里的 Claude 一段一段写进 artifact 数据库（带板号、常驻栏），页面实时显示；作答、写法错误、屏幕大小写回数据库；说话在对话框里 |
| `class` | `class/` | 一屏一块板：课堂里的 Claude 换板、写板、说的话写在板顶；常驻栏；底部只有输入框和翻页条；学生作答自动发给它 |

- `render.js`：Markdown（markdown-it + KaTeX）+ 围栏组件 → DOM。组件在 `blocks/`，注册在 `blocks/index.js`。
- `session.js`：全局状态（关卡、作答记录、图形注册 `session.scenes`、写法错误 `session.problems`）。
- 图形：`scene.js`（描述式交互图）、`graph.js`（函数图）、`space.js`（三维）、`expr.js`（表达式求值）、`link.js`（steps 和图的联动）。
- 判分：`check.js`、`mathinput.js`；精确分数和行化简：`linalg.js`。
- 页面里调用 Claude：`ai.js`（`window.claude.use('sample')`，旧接口 `window.claude.complete`）。
- 手写：`ink/`（整页板书 overlay、手写板 pad）；截图作答：`photo.js`。
- `drafts.js`：草稿。会让学生作答的组件用 `markDraft` 登记「现在写着什么、还没交」（`answer` 系列、理由框 `thinkbox`、`conjecture`、`quiz`、`findbug`、`predict`），课堂模式发下一轮时一起告诉课堂 Claude，学生不点检查它也看得到。新写会作答的组件也要登记。
- `features.js`：功能开关。截图粘贴开着；页面上的手写板（手写识别）暂时关着，入口都不出现，代码保留。
- `flatten.js`：截图 / 手写图转白底 PNG（透明底的浅色笔迹先压暗）。
- iPad 粘贴的坑（实测）：Notability 圈选「拷贝」后粘贴，`paste` 事件里什么都没有，Safari 直接把 `<img src="blob:…">` 插进**可编辑框**（文本框不插）。所以粘贴框必须是 contenteditable，空的 paste 绝不能 `preventDefault`，图从插进来的 `<img>` 里取。系统截图则正常带 `image/png` 文件。
- 样式：`styles.css`（默认石墨风格），课堂模式另有 `class/class.css`、`class/board.css`。别的风格在 `themes.css`（`chalk` 墨绿黑板、`paper` 纸本、`midnight` 深蓝、`white` 白板），front matter 写 `theme:` 选（`theme.js`）。
  - 颜色都是变量：组件样式里写 `rgb(var(--chalk-rgb) / 0.4)`、`var(--yellow)` 这样，不要写死 `rgba(238, 240, 230, …)`（`tests/theme.test.js` 守着）。`--chalk-rgb` 是「写字的颜色」，浅色风格里是墨色。
  - 加了新的颜色变量，`themes.css` 里每种风格都要写上。板书（Apple Pencil）的笔色也跟风格走（`--ink-white` 等）。

### 课堂模式（`kit/src/class/`）

- `classroom.js`：控制器。一屏一块板（`board new` 换板，旧板翻页看）、板顶那句话、常驻栏、一屏放不放得下的测量（`--board-h`）、学生作答排队（1.5 秒合并，拖动跟着下一条一起发；没提交的草稿也跟着下一条发，见 `drafts.js`）、调用课堂 Claude、执行黑板指令、写法自检和自动重写、刷新后恢复。学生发的消息不上黑板。
- `protocol.js`：解析课堂 Claude 的输出。普通文字是对学生说的话（写在板顶）；```` ```board ```` 围栏块是黑板指令（new / add / replace / hide / pin / unpin / figure）。纯函数，支持流式前缀。
- `prompt.js`：每一轮发给课堂 Claude 的内容（红线 `DEFAULT_RULES`、黑板指令说明 `PROTOCOL_DOC`、组件手册、资料包、黑板现状、对话历史和压缩）。纯函数。
- `docs.js` + `kit/build-docs.js`：构建时从 `CLAUDE-PROJECT.md` 第三节截出组件手册打包进去。
- `bar.js`：底部输入框（附图、手写板、「⋯」菜单、iPad 软键盘）和它上面的一条：翻页（上一块 / 下一块 / 板列表 / 回到当前板）、快捷回答。不显示消息。
- `devteacher.js`：`?dev` 的模拟老师；`devpanel.js`：开发面板。
- 数据（artifact 数据库）：`steps` 黑板段落（`page` 在第几块板，`place: 'pin'` 是常驻栏），`class_pages` 每块板（标题、板顶的话、下课小结），`class_turns` 每一轮，`class_notes` 观察和下课小结，`answers` / `events` 作答，`pack/main`、`pack/problems` 资料包。

### 实时黑板（`kit/src/live/`）

- 和课堂模式共用一屏一块板：`class/boardview.js`（板、常驻栏、翻板、一屏放不放得下）、`class/pagenav.js`（翻板条）、`class/selfcheck.js`（额外的写法自检）。改这几个文件，两种模式都要看。
- `live.js`：订阅 `steps`，按 `layout.js` 的 `planBoards` 分板（`page` 不写就接着前一段那块板，`pin: true` 进常驻栏，板号最大的是当前板）；新板翻过去，翻回去看旧板时当前板来了新内容让「回到当前板」闪。学生作答过的段被改了，先提示不替换。
- 对话里的 Claude 看不到页面：写法错误写回 `lint/{段 id}`，屏幕和当前板放不放得下写回 `meta/screen`（`layout.js` 的 `lintRecord`、`screenRecord`，有变化才写）。
- `livebar.js`：底部一条（翻板、连接状态、「⋯」里板书和复制学习记录）。没有输入框、没有「问 Claude」、没有「这段做完了」。
- `store.js`：claude.ai 里用 artifact 的 db / assets，`?dev` 用 localStorage 替身；`sync.js`：作答、事件、原图写进数据库；`devpanel.js`：`?dev` 开发面板（写段、看作答、看写回）。

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

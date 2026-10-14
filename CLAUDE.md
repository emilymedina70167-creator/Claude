# 给 Claude Code 的开发说明

这个仓库是「线代学习台」：让 Claude 在 claude.ai 的 artifact 里给我上课。对话框只能出文字和简陋的图，所以 Claude 不在对话里讲，而是把课堂搬到一块黑板上：能拖的图、一步步揭开的例题、先猜再揭晓、自动判分、Apple Pencil 手写。Claude 设计「推着我自己得出结论」的路径，组件库 `la-kit` 负责图形、计算和判分。我在 iPad 上用。

- 面向我的说明：`README.md`
- 放进 claude.ai 项目指令、教 Claude 写课件的说明：`CLAUDE-PROJECT.md`（第三节「组件参考」还会在构建时打包进 `la-kit.js`，给课堂里的 Claude 当组件手册，见下文）
- 需求原文：`docs/live-board-spec.md`（实时黑板）、`docs/classroom-spec.md`（课堂模式）、`docs/teaching-tools-spec.md`（课堂教具：板书标注、会动的矩阵、页面验算）；数据结构组件的方案（待定）：`docs/ds-components-design.md`

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
- GitHub 上每次推送都会跑 `.github/workflows/test.yml`：`npm test`，再 build 一遍看 `kit/dist/la-kit.js` 和提交的是否一样（忘了重新 build 会红）。
- 浏览器里看效果：在一个目录里放 `kit/dist/la-kit.js` 和 `kit/examples/*.html`，起一个静态服务器打开。
  - 示例页开头的 `<!doctype html>`、`<meta charset="utf-8">` 不能删：`la-kit.js` 的正则和 `String.raw` 里有中文（不能转义，转了课堂说明会变成 `\uXXXX`），浏览器不按 UTF-8 读就整页报错；没有 doctype 时 KaTeX 在怪异模式下排版不对。claude.ai 发布时会自己补上，所以课件模板里不用写。
  - `unit-matrix-vector.html`：引导模式示范单元（也是组件库 artifact 的页面）
  - `live-demo.html?dev`：实时黑板，右上角开发面板扮演对话里的 Claude
  - `class-demo.html?dev`：课堂模式，模拟老师按剧本回放（不调用 Claude）；剧本里故意有一段写错的组件（`circle` 那行），控制台报「看不懂这一行」是正常的。在输入框里打暗号看教具：「测试:教具」（`let` 块 + `matrix` 的乘积 + 逐行 `mark` + `\calc`）、「测试:幂」（滑块和 `figure play` 让矩阵动起来）、「测试:指图」（图上的 `label=` / `at=` 标注）、「测试:出题」（`practice` 的自定义题型）、「测试:公式」（写含 n 的式子）、「测试:示意图」（`sketch`）、「测试:推导」（`derive` + `figure play step`）、「测试:原图」（`image`，本地用一张模拟的讲义图）
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
- 图形：`scene.js`（描述式交互图）、`graph.js`（函数图）、`space.js`（三维）、`expr.js`（表达式求值；向量是列向量，`a'` 是行）、`link.js`（steps 和图的联动）、`mods.js`（命令行末尾的修饰）。
- 精确计算：`exact.js`（BigInt 分数；`\calc{…}` 的展开、`let` 块的解析、`calcValue`）。`render.js` 的 `tex2html` 展开 `\calc`，并带两个 KaTeX 宏 `\hl{名字}{…}`、`\chalk{颜色}{…}`（都展开成 `\htmlData`，`trust` 只放行它）。`let` 块（`blocks/letblock.js`）定义整节课的量（`session.vars`）；`renderLesson` 先把一段里的 `let` 块算一遍，正文的 `\calc` 才用得到。
- 板书标注：`markspec.js`（写法解析）、`markdraw.js`（手绘的圈 / 框 / 箭头，旁注放哪：躲开正文、离远了连线），都是纯函数；`marks.js`（DOM：一个宿主一层 SVG，按 spec 找到公式里的 `\hl` 项、矩阵的行列、steps 的步、图上的东西，尺寸变了、图 `change` 了跟着重新摆）。`tokens.js` 是指令行分词（协议、标注、matrix 共用）。
- 会动的矩阵：`matrixspec.js`（写法、精确求值、哪些格子变了 / 哪个数飞到哪，纯函数）+ `blocks/matrix.js`（画面、闪烁和飞行动画、滑块、点乘积里的数；接 `figureControls`，课堂里能 `figure set / play / highlight` 和 `board mark`）。
- 判分：`check.js`、`mathinput.js`；精确分数和行化简：`linalg.js`。
- 含 n 的式子作答（`answer` / `steps` 的 `formula: n`）：`formula.js`（读懂学生的写法、写成公式预览、代几组 n 比较、指出哪个 n 对不上、不许直接写 A^n，纯函数）+ `formulainput.js`（输入框和符号小键盘；Apple Pencil 点进去用系统的随手写）。
- `practice` 的自定义题型（`type: custom`）：`practicespec.js`（模板解析、随机取数 `pick` / `let` / `where`、先取十几组数自检，纯函数），出题和判分照常走 `answerWidget`。
- 表达空间：`sketch`（当场写的 SVG 示意图；`svgsafe.js` 白名单清理、调色板配色，纯函数）、`derive`（分拍板书：一行行写、等号对齐；`derivespec.js` 纯函数；写到第几行是变量 `step`，接 `figureControls`）、`image`（讲义原图：资料包 `images` 按名字找，课堂工具 `view_image` 让课堂 Claude 自己看）。
- 页面里调用 Claude：`ai.js`（`window.claude.use('sample')`，旧接口 `window.claude.complete`）。
- 手写：`ink/`（整页板书 overlay、手写板 pad）；截图作答：`photo.js`。
- `drafts.js`：草稿。会让学生作答的组件用 `markDraft` 登记「现在写着什么、还没交」（`answer` 系列、理由框 `thinkbox`、`conjecture`、`quiz`、`findbug`、`predict`），课堂模式发下一轮时一起告诉课堂 Claude，学生不点检查它也看得到。新写会作答的组件也要登记。
- `features.js`：功能开关。截图粘贴开着；页面上的手写板（手写识别）暂时关着，入口都不出现，代码保留。
- `flatten.js`：截图 / 手写图转白底 PNG（透明底的浅色笔迹先压暗）。
- iPad 粘贴的坑（实测）：Notability 圈选「拷贝」后粘贴，`paste` 事件里什么都没有，Safari 直接把 `<img src="blob:…">` 插进**可编辑框**（文本框不插）。所以粘贴框必须是 contenteditable，空的 paste 绝不能 `preventDefault`，图从插进来的 `<img>` 里取。系统截图则正常带 `image/png` 文件。
- 样式：`styles.css`（默认石墨风格），课堂模式另有 `class/class.css`、`class/board.css`。别的风格在 `themes.css`（`chalk` 墨绿黑板、`paper` 纸本、`midnight` 深蓝、`white` 白板），front matter 写 `theme:` 选（`theme.js`）。
  - 颜色都是变量：组件样式里写 `rgb(var(--chalk-rgb) / 0.4)`、`var(--yellow)` 这样，不要写死 `rgba(238, 240, 230, …)`（`tests/theme.test.js` 守着）。`--chalk-rgb` 是「写字的颜色」，浅色风格里是墨色。
  - 字体：手写体 `var(--hand)` 只用在标题上（板的标题、组件标题、图上的标注）；按钮、输入框、对错提示、计数、底部那条都用正文字体 `var(--sans)`（小字号的手写体在 iPad 上不好认）。
  - 加了新的颜色变量，`themes.css` 里每种风格都要写上。板书（Apple Pencil）的笔色也跟风格走（`--ink-white` 等）。

### 课堂模式（`kit/src/class/`）

- `classroom.js`：控制器。一屏一块板（`board new` 换板，旧板翻页看）、板顶那句话、常驻栏、一屏放不放得下的测量（`--board-h`）、学生作答排队（1.5 秒合并，拖动跟着下一条一起发；没提交的草稿也跟着下一条发，见 `drafts.js`）、调用课堂 Claude、执行黑板指令、写法自检和自动重写、刷新后恢复。板书标注记在 `marks`（id → 所在段和 spec），段被改写 / 撤回时一起擦掉，刷新后按 `boardOps` 的时间线重放；工具 `calc`（精确计算，查看方式支持工具时才给）。板顶那句话后面标出平台核验的模型（`class_pages.talkBy`），「⋯」菜单写核验 / 作废了几轮，下课小结的最后一行（`foot`）和 `class_notes` 的 `verify` 由页面写。对话太长时的摘要也只用 Opus 5.5 high，在一轮讲完后后台写（不让学生等）；学生附的图直接交给 Claude，不等它传进 assets。学生发的消息不上黑板。学生在当前板、常驻栏上新写的板书（`ink/` 的笔画，按段的位置拼成一张图），跟着下一条消息导出成图发给课堂 Claude（`[板书]` 那一行；有没发的板书时输入框空着也能发，`bar.js` 的 `inkPending`，板书一变 `ink/overlay.js` 发 `ink-change`）；当前板上有题没做、学生很久没动静时，提醒课堂 Claude 轻轻问一句（`stuck.js`，「⋯」里可关，`?dev&stuck=8` 把等待改成 8 秒）。
- `protocol.js`：解析课堂 Claude 的输出。普通文字是对学生说的话（写在板顶）；```` ```board ```` 围栏块是黑板指令（new / add / replace / hide / pin / unpin / figure / mark / unmark）。纯函数，支持流式前缀；`mark` 块闭合以后才把块里的各行拼成 `marks`。
- `prompt.js`：每一轮发给课堂 Claude 的内容（红线 `DEFAULT_RULES`、黑板指令说明 `PROTOCOL_DOC`、组件手册、资料包、黑板现状、对话历史和压缩）。纯函数。
- `docs.js` + `kit/build-docs.js`：构建时从 `CLAUDE-PROJECT.md` 第三节截出组件手册打包进去。
- `bar.js`：底部输入框（附图、手写板、「⋯」菜单、iPad 软键盘）和它上面的一条：翻页（上一块 / 下一块 / 板列表 / 回到当前板）、快捷回答。不显示消息。
- `devteacher.js`：`?dev` 的模拟老师；`devpanel.js`：开发面板（还有本地试用的模拟讲义图 `ensureDemoSlide`）。
- 数据（artifact 数据库）：`steps` 黑板段落（`page` 在第几块板，`place: 'pin'` 是常驻栏），`class_pages` 每块板（标题、板顶的话和 `talkBy`、下课小结和 `foot`），`class_turns` 每一轮（`boardOps` 里有 mark / unmark），`class_notes` 观察和下课小结（带 `verify`），`answers` / `events` 作答，`pack/main`、`pack/problems` 资料包。
- 每一轮的整份说明（`buildSystem`）要在 160 KiB 以内，给对话留地方（`tests/class-prompt.test.js` 守着）。说明再加长时先想办法精简；资料包预算 `PACK_BUDGET` 已经从 120 KiB 调到 104 KiB。

### 实时黑板（`kit/src/live/`）

- 和课堂模式共用一屏一块板：`class/boardview.js`（板、常驻栏、翻板、一屏放不放得下）、`class/pagenav.js`（翻板条）、`class/selfcheck.js`（额外的写法自检）。改这几个文件，两种模式都要看。
- `live.js`：订阅 `steps`，按 `layout.js` 的 `planBoards` 分板（`page` 不写就接着前一段那块板，`pin: true` 进常驻栏，板号最大的是当前板）；新板翻过去，翻回去看旧板时当前板来了新内容让「回到当前板」闪。学生作答过的段被改了，先提示不替换。
- 对话里的 Claude 看不到页面：写法错误写回 `lint/{段 id}`，屏幕和当前板放不放得下写回 `meta/screen`（`layout.js` 的 `lintRecord`、`screenRecord`，有变化才写）。
- 黑板现状 `meta/now`（`layout.js` 的 `statusRecord`）：最近的作答（和课堂模式发给课堂 Claude 的写法一样，`class/prompt.js` 的 `actionText`）、没提交的草稿（`drafts.js`）、写法错误、屏幕、交来的截图。有变化后最多 2 秒写一次。学生说「好了」时对话里的 Claude 只读这一份。
- `livebar.js`：底部一条（翻板、「交截图」、连接状态、「⋯」里板书、复制学习记录和版本号）。「交截图」复用课堂输入条的图片处理（`class/bar.js` 的 `toPng` 等，Notability 的坑一样要绕），图存 assets，记在 `uploads`。没有输入框、没有「问 Claude」、没有「这段做完了」。
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

改完并合进 `main` 后，要重新发布组件库 artifact（https://claude.ai/artifact/5ZUhFR5T5i1wMysQmthoAF）：页面是 `kit/examples/unit-matrix-vector.html`，附带文件 `la-kit.js` 来自 `kit/dist/la-kit.js`、`CLAUDE-PROJECT.md` 来自仓库根目录的同名文件，`capabilities: {"sample": {"images": true}, "db": {}, "assets": {}}`。之后新发布的课件自动用新版，已经发布的保留当时复制的版本。发布前先问我。

- 我的 claude.ai 项目指令里只有一段话：让对话里的 Claude 每个新对话先读组件库里的 `CLAUDE-PROJECT.md`（见 README「设置」）。所以说明的全文要跟着组件库一起发布，不然各个对话里的 Claude 看到的还是旧版。
- 版本号：`CLAUDE-PROJECT.md` 开头「版本：YYYY-MM-DD」（同一天再发布加 b、c）。每次重新发布组件库前都改成新的版本号；构建时打进 `la-kit.js`（`LAKit.version`，课堂和实时黑板的「⋯」菜单里显示），对得上就说明页面和说明是同一版。

# 给 Claude Code 的开发说明

这个仓库是「线代学习台」：让 Claude 在 claude.ai 的 artifact 里给我上课。对话框只能出文字和简陋的图，所以 Claude 不在对话里讲，而是把课堂搬到一块黑板上：能拖的图、一步步揭开的例题、先猜再揭晓、自动判分、Apple Pencil 手写。Claude 设计「推着我自己得出结论」的路径，组件库 `la-kit` 负责图形、计算和判分。我在 iPad 上用。

- 面向我的说明：`README.md`
- 放进 claude.ai 项目指令、教 Claude 写课件的说明：`CLAUDE-PROJECT.md`（第三节「组件参考」还会在构建时打包进 `la-kit.js`，给课堂里的 Claude 当组件手册，见下文）
- 需求原文：`docs/live-board-spec.md`（实时黑板）、`docs/classroom-spec.md`（课堂模式）、`docs/teaching-tools-spec.md`（课堂教具：板书标注、会动的矩阵、页面验算）、`docs/live-tools-spec.md`（实时黑板追上课堂：标注、让图动、板顶的话）、`docs/learner-memory-spec.md`（学习台的系统记忆：分类存储、各管一块，两个 Claude 共用）
- **学习台的下一步（当前重点）：`docs/desk-plan.md`**（记录能力、交互、内部 Claude 改记忆；外内协作的分工；分批和验收）。新对话做学习台先读它。
- 下一步的总计划（线代和 408 一起做到优秀：验收尺子、外壳升级、线代六章、408 加深）和进度：`docs/quality-plan.md`
- 计算机四门课第一轮（第 0～5 批）的计划：`docs/408-plan.md`；数据结构 `trace` / `tree` / `net` 的细节方案：`docs/ds-components-design.md`

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
  - `408-demo.html`：计算机四门课的全部演示组件
  - `desk-demo.html?dev`：学习台（记忆库、在学习台里上课；「测试:记忆」见下文「学习台和记忆库」）
  - `class-demo.html?dev`：课堂模式，模拟老师按剧本回放（不调用 Claude）；剧本里故意有一段写错的组件（`circle` 那行），控制台报「看不懂这一行」是正常的。在输入框里打暗号看教具：「测试:教具」（`let` 块 + `matrix` 的乘积 + 逐行 `mark` + `\calc`）、「测试:幂」（滑块和 `figure play` 让矩阵动起来）、「测试:指图」（图上的 `label=` / `at=` 标注）、「测试:出题」（`practice` 的自定义题型）、「测试:公式」（写含 n 的式子）、「测试:示意图」（`sketch`）、「测试:推导」（`derive` + `figure play step`）、「测试:原图」（`image`，本地用一张模拟的讲义图）、「测试:排序」（演示组件 `sort` + `figure play step` + `mark`）
    - `la-demo.html`：线代的过程组件（elim、det、eig、schmidt、quad、frames）
- iPad 尺寸：竖屏 820×1180，横屏 1180×820。云端会话里可以用预装的 Playwright + Chromium 截图检查。
- 页面检查脚本：`node tools/check-lesson.mjs 文件…`（课件 `.md`、示例页 `.html`、实时黑板 `.board.json`（可带 `ops` 教具指令、`talk` 板顶的话，有指令时按 seq 和段一条条写进去，没执行的指令报成错；例子 `kit/examples/live-tools.board.json`）、课堂输出 `.class.json`）在两种 iPad 尺寸下渲染、把演示走一遍，报写法错误、控制台报错、冲出版面、一屏放不下，课堂用的 `figure set step` 每个演示组件连着跳两次；`--shots 目录` 存截图。`npm run check:pages` 查全部示例页（改了组件要跑）。
- 组件画廊：`npm run gallery -- --out 目录 kit/examples/408-demo.html`：每个组件单独截一张（演示组件停在最后一步），五种风格各一张，拼成联系表 `sheet-*.png`（一行一个组件），视觉统一一眼看完；`--themes paper,white`、`--only id1,id2`、`--width 1180`。
- 验收（扮演老师写真题课，量一次写对率）：`evals/`（说明在 `evals/README.md`，结果在 `evals/results.md`）。

## 架构

页面只有几行：`<script src="la-kit.js">` 加一段 `<script type="text/markdown">` 课件。`kit/src/main.js` 读 front matter 的 `mode` 分发：

| mode | 入口 | 说明 |
|---|---|---|
| `guided` | `guided.js` | 一整个单元，按 `##` 分节解锁；学习记录复制回对话 |
| `live` | `live/` | 一屏一块板：对话里的 Claude 一段一段写进 artifact 数据库（带板号、常驻栏），页面实时显示；作答、写法错误、屏幕大小写回数据库；说话在对话框里 |
| `class` | `class/` | 一屏一块板：课堂里的 Claude 换板、写板、说的话写在板顶；常驻栏；底部只有输入框和翻页条；学生作答自动发给它 |
| `desk` | `memory/` | 学习台：长期存在的 artifact，数据库就是记忆库；首页列今天到期的复现、自检对话里的 Claude 写的记忆 |

- `render.js`：Markdown（markdown-it + KaTeX）+ 围栏组件 → DOM。组件在 `blocks/`，注册在 `blocks/index.js`。
- `session.js`：全局状态（关卡、作答记录、图形注册 `session.scenes`、写法错误 `session.problems`）。
- 图形：`scene.js`（描述式交互图）、`graph.js`（函数图）、`space.js`（三维）、`expr.js`（表达式求值；向量是列向量，`a'` 是行）、`link.js`（steps 和图的联动）、`mods.js`（命令行末尾的修饰）。
- 精确计算：`exact.js`（BigInt 分数；`\calc{…}` 的展开、`let` 块的解析、`calcValue`）。`render.js` 的 `tex2html` 展开 `\calc`，并带两个 KaTeX 宏 `\hl{名字}{…}`、`\chalk{颜色}{…}`（都展开成 `\htmlData`，`trust` 只放行它）。`let` 块（`blocks/letblock.js`）定义整节课的量（`session.vars`）；`renderLesson` 先把一段里的 `let` 块算一遍，正文的 `\calc` 才用得到。
- 板书标注：`markspec.js`（写法解析）、`markdraw.js`（手绘的圈 / 框 / 箭头，旁注放哪：躲开正文、离远了连线），都是纯函数；`marks.js`（DOM：一个宿主一层 SVG，按 spec 找到公式里的 `\hl` 项、矩阵的行列、steps 的步、图上的东西，尺寸变了、图 `change` 了跟着重新摆）。在板上执行 mark / unmark / figure（找目标、只动当前板和常驻栏、板上现有的标注）是 `class/boardtools.js`，课堂和实时黑板共用。`tokens.js` 是指令行分词（协议、标注、matrix 共用）。
- 会动的矩阵：`matrixspec.js`（写法、精确求值、哪些格子变了 / 哪个数飞到哪，纯函数）+ `blocks/matrix.js`（画面、闪烁和飞行动画、滑块、点乘积里的数；接 `figureControls`，课堂里能 `figure set / play / highlight` 和 `board mark`）。
- 判分：`check.js`、`mathinput.js`；`anscheck.js`（`answer` 的 `check:` 按条件判、格子里的根号 `1/√2`，纯函数）；精确分数和行化简：`linalg.js`。
- 含 n 的式子作答（`answer` / `steps` 的 `formula: n`）：`formula.js`（读懂学生的写法、写成公式预览、代几组 n 比较、指出哪个 n 对不上、不许直接写 A^n，纯函数）+ `formulainput.js`（输入框和符号小键盘；Apple Pencil 点进去用系统的随手写）。
- `practice` 的自定义题型（`type: custom`）：`practicespec.js`（模板解析、随机取数 `pick` / `let` / `where`、先取十几组数自检，纯函数），出题和判分照常走 `answerWidget`。
- 表达空间：`sketch`（当场写的 SVG 示意图；`svgsafe.js` 白名单清理、调色板配色，纯函数）、`derive`（分拍板书：一行行写、等号对齐；`derivespec.js` 纯函数；写到第几行是变量 `step`，接 `figureControls`）、`image`（讲义原图：资料包 `images` 按名字找，课堂工具 `view_image` 让课堂 Claude 自己看）。
- 科目：`subject.js`（front matter 的 `subject:`；`CLAUDE-PROJECT.md` 第三节小节下的 `<!-- 科目：… -->` 标记，课堂只带「通用 + 这门课」的组件说明，`prompt.js` 的 `defaultRules` 按科目换教法）。计算机课要的表达式（`0x1F`、`mod`、位运算、`bin` / `hex`）在 `expr.js` 和 `exact.js` 两边都有。
- 文字型答案：`textcheck.js`（序列 `type: seq`、二进制 / 十六进制 `type: bin / hex` 的读法和判分，纯函数）+ `textinput.js`（输入框和回显）。
- 演示组件（一步步走的过程）：`stepper.js` 是外壳（上一步 / 下一步 / 播放、`ask` 先猜再揭晓（含 `order` 按顺序点）、`mode: quiz`、`mode: fill` 自己填表、课堂的 `figure step` 和 `highlight`、记录），`stepperspec.js` 是它不碰 DOM 的部分（问哪几步、判分、填表、错法比对、字段拼写检查 `trackFields`）；`morph.js` 是步与步之间的过渡（`data-key` 一样的滑过去）。每个算法是 `engines/` 里的一个纯函数引擎（`parse` → `run` 出每一步 → `view` 画成 HTML，`data-pick` 给在图上点、`data-cmd` 给 highlight / `board mark item=`），在 `blocks/index.js` 用 `stepperBlock(引擎)` 注册。可选：`table`（fill 的表）、`variants`（常见错法：换成错法的输入，外壳跑一遍拿来和学生的答案比，记录里写「页面看出来：像是……」，只给老师）、`quiz`、`problems`、`head`（字段只在开头一段）。新算法照这个做，引擎配 `node --test`，答案和王道的例子对一遍；错法至少 2 种，答案和对的一样的不列。
  - 通用演示：`engines/frames.js`（`frames`：老师自己写每一帧，能问、能挖空）。
  - 线代：`engines/elim.js`（`elim`：秩、极大无关组、方程组、含参讨论、求逆、矩阵方程；`mode: do` 学生自己做行变换的纯函数也在这里，画面是 `blocks/elimdo.js`）、`det.js`、`eig.js`（`eig`、`schmidt`，根号精确）、`quad.js`；含参数的精确多项式在 `poly.js`。浏览器里看：`kit/examples/la-demo.html`。
  - 数据结构：`engines/sort.js`（`sort`，含希尔）、`stack.js` `cqueue.js` `compress.js`（画法在 `linearview.js`）、`tree.js` + `treeview.js`（`tree`）、`balanced.js`（`avl` `rbt`）、`btree.js`、`huffman.js` `uf.js` `buildtree.js` `thread.js` `forest.js`（画法在 `forestview.js`）、`search.js`（`kmp` `hash` `bsearch`）、`graph.js`（`net`）、`extsort.js`、`trace.js`（`trace`，解释器在 `kit/src/cinterp.js`：C 子集含结构体、指针、malloc / free，一步一行，生成器实现，越界 / 没赋值 / 死循环 / 空指针 / 悬空指针都报行号）。写代码题 `code`：`kit/src/codejudge.js`（跑测试、估复杂度，纯函数）+ `blocks/code.js`。浏览器里看：`kit/examples/ds-*.html`。
  - 操作系统：`os.js`（`sched` `paging`（含改进型 CLOCK、`init:` 开始状态）`banker` `disk`）、`addr.js`（`addr`）、`ospt.js`（`pagetable`）、`osvm.js`（`mem`：快表 → 页表 → 缺页的整条链、EAT）、`osmem.js`（`alloc`）、`osfile.js`（`fileidx`）、`osbitmap.js`（`bitmap`）、`osdeadlock.js`（`deadlock`）、`pv.js`（`pv`：信号量，老师给顺序或页面自己找死锁；学生自己点进程走的画面是 `blocks/pvdo.js`，`pvBlock()` 分流）。组成原理：`co.js`（`bits` `cache` `pipe`）、`comem.js`（`memexp`）、`cofloat.js`（`fadd`）、`comul.js`（`mul`）、`codiv.js`（`div`）、`coasm.js`（`asm`：x86 一条指令一步）、`coea.js`（`ea`）、`coopcode.js`（`opcode`）、`colayout.js`（`layout`）、`coirq.js`（`irq`）、`codes.js`（`crc` `hamming`，计网共用）。计网：`net4.js`（`subnet` `tcp`（含传数据的序号、确认号）`window`）、`netfrag.js`（`frag`）、`netcode.js`（`encode`）、`netmac.js`（`csma` `switch`）、`netdv.js`（`dv`）、`netperf.js`（`util` `rtt`），量的读法（`10Mb/s`、`2km`、`200m/μs`）在 `netunits.js`。浏览器里看：`kit/examples/os2-demo.html`、`pv-demo.html`、`co2-demo.html`、`cn2-demo.html`。
  - 共用的画法：`arrayview.js`（一排格子）、`treeview.js`（二叉树）、`bitview.js`（按字段画二进制位、`1KB` / `0A5CH` 这类写法）。
  - 浏览器里看全部演示：`kit/examples/408-demo.html`。
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

- `classroom.js`：控制器。一屏一块板（`board new` 换板，旧板翻页看）、板顶那句话、常驻栏、一屏放不放得下的测量（`--board-h`）、学生作答排队（1.5 秒合并，拖动跟着下一条一起发；没提交的草稿也跟着下一条发，见 `drafts.js`）、调用课堂 Claude、执行黑板指令、写法自检和自动重写、刷新后恢复。板书标注记在 `marks`（id → 所在段和 spec），段被改写 / 撤回时一起擦掉，刷新后按 `boardOps` 的时间线重放；工具 `calc`（精确计算）、`component_doc`（组件的完整写法），查看方式支持工具时才给。板顶那句话后面标出平台核验的模型（`class_pages.talkBy`），「⋯」菜单写核验 / 作废了几轮，下课小结的最后一行（`foot`）和 `class_notes` 的 `verify` 由页面写。对话太长时的摘要也只用 Opus 5.5 high，在一轮讲完后后台写（不让学生等）；学生附的图直接交给 Claude，不等它传进 assets。学生发的消息不上黑板。学生在当前板、常驻栏上新写的板书（`ink/` 的笔画，按段的位置拼成一张图），跟着下一条消息导出成图发给课堂 Claude（`[板书]` 那一行；有没发的板书时输入框空着也能发，`bar.js` 的 `inkPending`，板书一变 `ink/overlay.js` 发 `ink-change`）；当前板上有题没做、学生很久没动静时，提醒课堂 Claude 轻轻问一句（`stuck.js`；每提醒一次就是一整轮调用，默认关、「⋯」里能开，`?dev&stuck=8` 自动打开并把等待改成 8 秒）。每次调用 Claude 记一条花费 `cost`（`usage.js`：发出去的字节、为什么调用、调了几次工具）在那一轮的 `class_turns` 上，「⋯」里显示这节课一共约多少 token、多跑了几轮为什么，学习台里合计写进 `sessions/{编号}.usage`。
- `protocol.js`：解析课堂 Claude 的输出。普通文字是对学生说的话（写在板顶）；```` ```board ```` 围栏块是黑板指令（new / add / replace / hide / pin / unpin / figure / mark / unmark）。纯函数，支持流式前缀；`mark` 块闭合以后才把块里的各行拼成 `marks`。
- `prompt.js`：每一轮发给课堂 Claude 的内容（红线 `DEFAULT_RULES`、黑板指令说明 `PROTOCOL_DOC`、组件手册、资料包、黑板现状、对话历史和压缩）。纯函数。
- `docs.js` + `kit/build-docs.js`：构建时从 `CLAUDE-PROJECT.md` 第三节截出组件手册打包进去。小节里 `<!-- 完整写法 -->` 以前是精简版（每一轮都带），以后是不常用的写法：课堂 Claude 用工具 `component_doc` 按名字取；某个组件写错要重写时，页面把它的完整写法附在提醒里；资料包 `main.components` 点了名的组件直接带完整写法（`subject.js` 的 `docsForSubject` / `componentDoc`，`prompt.js` 的 `systemDocs` / `lintDocs`）。对话里写课件的 Claude 读整份 `CLAUDE-PROJECT.md`，两部分都看得到。
- `bar.js`：底部输入框（附图、手写板、「⋯」菜单、iPad 软键盘）和它上面的一条：翻页（上一块 / 下一块 / 板列表 / 回到当前板）、快捷回答。不显示消息。
- `devteacher.js`：`?dev` 的模拟老师；`devpanel.js`：开发面板（还有本地试用的模拟讲义图 `ensureDemoSlide`）。
- 数据（artifact 数据库）：`steps` 黑板段落（`page` 在第几块板，`place: 'pin'` 是常驻栏），`class_pages` 每块板（标题、板顶的话和 `talkBy`、下课小结和 `foot`），`class_turns` 每一轮（`boardOps` 里有 mark / unmark），`class_notes` 观察和下课小结（带 `verify`），`answers` / `events` 作答，`pack/main`、`pack/problems` 资料包。
- 每一轮的整份说明（`buildSystem`）要在 160 KiB 以内（`SYSTEM_MAX`），给对话留地方。资料包预算 `PACK_BUDGET` 是 104 KiB，某门课的组件说明长了，`buildSystem` 自动让资料包少占一点，保证整份不超；但每门课至少要给资料包留 96 KiB，每门课系统里的组件说明（精简版）≤ 40 KiB（`tests/subject.test.js` 守着；线代现在约 39 KiB，最紧）。组件说明再加长时先想办法精简：不常用的写法放到 `<!-- 完整写法 -->` 后面，线代、计算机专用的小节打上科目标记。`npm run docs:size` 看每门课离上限还剩多少、哪几节最大（`-- 操作系统 20` 只看一门课）。说明里每个演示组件的例子都要照抄就能用（`tests/engines-common.test.js` 守着）。

### 实时黑板（`kit/src/live/`）

- 和课堂模式共用一屏一块板：`class/boardview.js`（板、常驻栏、翻板、一屏放不放得下）、`class/pagenav.js`（翻板条）、`class/selfcheck.js`（额外的写法自检）、`class/boardtools.js`（教具：标注、让图动）。改这几个文件，两种模式都要看。
- `live.js`：订阅 `steps`，按 `layout.js` 的 `planBoards` 分板（`page` 不写就接着前一段那块板，`pin: true` 进常驻栏，板号最大的是当前板）；新板翻过去，翻回去看旧板时当前板来了新内容让「回到当前板」闪。学生作答过的段被改了，先提示不替换。
- 对话里的 Claude 看不到页面：写法错误写回 `lint/{段 id}`，屏幕和当前板放不放得下写回 `meta/screen`（`layout.js` 的 `lintRecord`、`screenRecord`，有变化才写）。
- 黑板现状 `meta/now`（`layout.js` 的 `statusRecord`）：最近的作答（和课堂模式发给课堂 Claude 的写法一样，`class/prompt.js` 的 `actionText`）、没提交的草稿（`drafts.js`）、写法错误、屏幕、交来的截图、这块黑板用的组件库版本（`kit`，对话里的 Claude 拿它和说明的版本比，旧了先换新版）、教具指令的结果 `ops`、板上的标注 `marks`、能动的图 `figures`。有变化后最多 2 秒写一次。学生说「好了」时对话里的 Claude 只读这一份。
- 教具指令（`docs/live-tools-spec.md`）：对话里的 Claude 往 `ops/{id}` 写 `{ seq, cmd, body }`，`cmd` 和课堂 board 块的第一行一样（`class/protocol.js` 的 `blockCommand`），只收 mark / unmark / figure。`ops.js` 是纯函数（读懂指令、要等哪些目标、结果行、刷新后的时间线 `restorePlan`）；`live.js` 按 seq 依次执行，目标还没画出来先等（最多 5 秒，前一条在等后面的也等），新指令先等 0.4 秒（同一次 batch 里改写的段可能晚到）；学生在看旧板时不播动画。执行过的记在 `ops_done/{id}`（带段的指纹 `segSig`：刷新后段变了的标注、图的状态不放回去；同一个 id 改写成新指令算新的一版，先擦掉旧版画的标注）。板顶的话 `talk/{板号}` = `{ page, md }`，写在 `boardview.js` 的 `talkEl`，不标模型。`?dev` 时 `window.LAKitLive` 给检查脚本看还有几条没执行、结果。
- `livebar.js`：底部一条（翻板、「交截图」、连接状态、「⋯」里板书、复制学习记录和版本号）。「交截图」复用课堂输入条的图片处理（`class/bar.js` 的 `toPng` 等，Notability 的坑一样要绕），图存 assets，记在 `uploads`。没有输入框、没有「问 Claude」、没有「这段做完了」。
- `store.js`：claude.ai 里用 artifact 的 db / assets，`?dev` 用 localStorage 替身；`sync.js`：作答、事件、原图写进数据库；`devpanel.js`：`?dev` 开发面板（写段、看作答、看写回）。

### 学习台和记忆库（`kit/src/memory/`，`docs/learner-memory-spec.md`）

- 分三批做，每一批做完对话里的 Claude 用一节真课验过再做下一批。**现在做完的是第 1、2 批**（记忆库本身；在学习台里上课）。原来的第 3 批并进了 `docs/desk-plan.md`（学习台做强：记录、交互、内部 Claude 改记忆），以它为准；**desk-plan 做完了第 1 批（记录能力）、第 2 批（课堂里的 Claude 改记忆）**。
- `schema.js`（纯函数）：十三类集合（`COLLECTIONS`：中文名、`history` / `state`、谁能写、编号的正则、必填、只能取的值、日期字段、指向别的类的字段、改了要记 log 的字段；第十三类是改动单 `pending`）；四种角色 `chat` / `class` / `page` / `me`（我在页面上点的），`assertWrite` 在代码层面拦住不该写的（课堂里的 Claude 只能写 `observations`、`slips`、`profile`；错题、弱点、复现组、位置只有 `chat` 和 `me`）；撤销时限 `UNDO_DAYS`；复现档位 1 → 3 → 7 → 14 → 30（`nextTier`、`reviewDue`：到期 = last + tier，页面算）；`applyChange` 改状态类时按字段记 log。
- `check.js`（纯函数）：自检对话里的 Claude 写的记忆（编号、字段、日期、指向的 id、结论挂证据），外加指纹 `meta/ledger`：历史类（错题、观察、失误）改了、删了记一条提醒留 7 天；状态类改了 `tracked` 字段却没在 log 里记到新值就一直报（指纹停在旧值，补上 log 才前进）。结果写回 `meta/memcheck` 给对话里的 Claude 读。
- `desk.js`：学习台首页（今天、自检、记忆库每类几条）；页面只写 `meta`。`sample.js` 是一份守规矩的示例记忆（`?dev` 的「填入示例记忆」、测试都用它）。说明书 `CLAUDE-PROJECT.md` 第七节的 JSON 例子拼起来要能过自检（`tests/memory.test.js` 守着）。
- 在学习台里上课（第 2 批）：首页「开新课」→ `sessions/{编号}`（`c-20261027-1`，页面写），`pack/main`、`pack/problems` 抄进 `sessions/{编号}/pack/`；地址带 `#编号` 就进这节课（`desk.js` 的 `classHash` / `enterClass`，进出都整页刷新，课堂挂的全局监听不留）。课堂照旧是 `classroom.js`，多一个 `desk` 参数：
  - 数据：`memory/session.js` 的 `scopeDb` 把 `steps`、`class_pages`、`class_turns`、`pack`、`uploads` 换到 `sessions/{编号}/` 下面（Proxy 转发，方法绑在原对象上；写进去带 `session`），课堂的代码不用改路径。
  - 证据：`sync.js` 的 `createSink(store, { evidence })`：作答、动作只写一份进 `evidence`（`toEvidence`：组件 id 叫 `comp`，`block` 是课程地图的块，`tags` 带段的 `point=`），不再写 `answers` / `events`；刷新后 `fromEvidence` 读回来重放。学生说的话、附的图也是证据（`sayEvidence`）。
  - 课堂 Claude：`prompt.js` 的 `buildSystem({ memory })` 多一节「你对学生的了解」（`memory/digest.js` 的 `memoryDigest`：rules → profile → 当前块 → 相关弱点、错题原文、掌握 → 失误 → position，预算 `MEMORY_BUDGET` 32 KiB、从后往前截，资料包用剩下的）；记忆库有 rules 时替换内置红线（`memoryRules`：角色那一段和教法照旧）。工具：`lesson_note`（kind note / proposal，写 `observations`）、`slip_note`（写 `slips`）、`memory_read`（只读）；写之前 `assertWrite('class', …)`。下课小结写 `observations`（kind summary），`sessions/{编号}` 记 `verify`、`status`、`summary`。
  - `protocol.js` 的段指令认 `point=`（这一段练的知识点），存在段上。
- 记录能力（desk-plan 第 1 批）：
  - 课后报告 `report.js`（纯函数）：下课后 `desk.js` 的 `writeReport` 读这节课的证据、观察、失误、上一节下课以后的补记，算好写进 `sessions/{编号}/report/main`（`SESSION_SCOPED` 里有 `report`），要点记在 `sessions/{编号}.report`；下课时没写成的，首页打开时补写（`fixReports`）。一道题 = 组件 + 第几步（`itemKey`），尝试序列、结果（`OUTCOMES`）、按 `tags` 汇总、时长去掉 10 分钟以上的空档。
  - 证据补全：作答 / 动作带 `turn`（发生时最新一轮的 seq，`evCtx`）；下课那一刻没交的草稿记成 `src: draft`（`draftEvidence`，`classroom.js` 的 `allDrafts`）；板书导出的图在 say 证据里记 `ink`。
  - 补记：首页「补记」（`manual.js` 的表单，贴图照课堂输入条的写法绕 Notability 的坑），记成 `src: manual`（`manualEvidence`，没有 session）。
  - 备份：`backup.js`（纯函数）把记忆库、资料包、每节课的报告（可选证据、黑板）拼成一个 JSON，`docs` 每条就是 ArtifactData batch 的样子；首页「导出备份」用 `downloads` 能力存（`store.js` 的 `getDownloads`，`?dev` 用下载链接）。恢复由外部 Claude 照说明书第七节「备份和恢复」写回（`restoreBatches` 是同样的切法，测试用）。首页还显示 assets 用了多少（`assets.list()` 的 `usage`）。
- 课堂里的 Claude 改记忆（desk-plan 第 2 批）：
  - 写法：输出里的 ```` ```board memo ```` 块，一行一条（`protocol.js` 的 `memoOp` → `memo.js` 的 `parseMemoLines`），不用工具（工具 `lesson_note`、`slip_note` 留着兼容，说明里不再推荐）。说明在 `prompt.js` 的 `MEMO_DOC`（`DESK_DOC` 里）。
  - `memo.js`（纯函数）：三档 `MEMO_KINDS`（direct：pref / slip / note / propose；confirm：error / weakness / review / position；mastery、rule 拒绝）、依据 `resolveBasis`（组件 id / 段 id 换成这节课的证据，`say` 是最近一句话）、`planEntry` 查编号字段取值、改动单 `pendingRecord`、执行 `applyPending`（直接写的用 class 的身份，确认的用 me；状态类记 log，`ref` 是改动单编号）、`rejectPending`、`undoPending`（状态类按 `applied` 退回，新加的改 `void`；历史类追加 `void` 的更正）、我自己改 `meChange`、作废的 `voidedIds`（`digest.js` 跳过它们，并列出还在等确认的）。
  - `memops.js`：数据库这一层（课堂和首页共用）：`applyMemo`、`confirm`（自动编号被占了就换下一个）、`reject`、`undo`、`me`。确认只由 `memoview.js` 里我点的按钮调用。
  - `memoview.js`：改动单的画面（板顶那句话下面的一行小字、小结板上的整理单、首页的「待确认」）：确认 / 改 / 不要 / 撤销，点依据看那次作答原文。`classroom.js` 的 `decoratePage`（`boardview.js` 的 `decorate` 钩子）挂上去，板记着 `memo`（改动单 id，存进 `class_pages`）。
  - 下课：`desk.makeReport` 先算一份报告，`report.js` 的 `reportText` 放进 `closingPrompt({ report })`，小结和整理单同一次写；小结正文是 memo 块以外的文字。
  - 首页：「待确认」「我改记忆」两张卡。
- 浏览器里看：`kit/examples/desk-demo.html?dev`（「填入示例记忆」→「开新课」，输入框打「测试:整理」：模拟老师写一个 memo 块，三档各几条、再故意写两条不对的；下课时模拟小结后面带整理单。打「测试:记忆」：模拟老师真的调用 `memory_read`、`lesson_note`、`slip_note`，写一段标了 `point=tr` 的题；点「下课」后回首页看「上一节」、补记、导出备份）。

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

改完并合进 `main` 后，要重新发布组件库 artifact（https://claude.ai/artifact/5ZUhFR5T5i1wMysQmthoAF）：页面是 `kit/examples/unit-matrix-vector.html`，附带文件 `la-kit.js` 来自 `kit/dist/la-kit.js`、`CLAUDE-PROJECT.md` 来自仓库根目录的同名文件，`capabilities: {"sample": {"images": true}, "db": {}, "assets": {}}`。（学习台另外还要 `"downloads": true`，那是外部 Claude 照说明书第七节发布的，不在这里。）之后新发布的课件自动用新版，已经发布的保留当时复制的版本。**合进 `main`、重新发布组件库都不用问我**（我说过：肯定发），做完一批就合、就发。

- 我的 claude.ai 项目指令里只有一段话：让对话里的 Claude 每个新对话先读组件库里的 `CLAUDE-PROJECT.md`（见 README「设置」）。所以说明的全文要跟着组件库一起发布，不然各个对话里的 Claude 看到的还是旧版。
- 版本号：`CLAUDE-PROJECT.md` 开头「版本：YYYY-MM-DD」（同一天再发布加 b、c）。每次重新发布组件库前都改成新的版本号；构建时打进 `la-kit.js`（`LAKit.version`，课堂和实时黑板的「⋯」菜单里显示），对得上就说明页面和说明是同一版。

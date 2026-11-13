# 舞台主线第九轮：画面归老师 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（我在这个会话里一件件做，用户在睡，不停下来等确认）。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 舞台画面上看得见的一切（样子、大小、位置、自己画的东西）都由课堂里的老师用一行指令定，老师每轮看到画面的截图；页面只守两条底线。

**Architecture:** 眼：`stage/snap.js` 用 html2canvas-pro 在画面静下来时后台截图，课堂循环把最新一张随下一条消息发给老师。手：`stage/look/`（`look` 的写法和默认样式表，纯函数）+ CSS 层叠层（`st-base` < `st-look` < `st-state`，底座反馈永远在最上）；`scale` 让每样东西在自己的一层里整体缩放（场景对外的框乘系数，画法用不缩放的框）；`place` 过的东西钉住（求解器只排没被摆过的，`arrange` 才重排）；`draw` 复用黑板的手绘形状和 SVG 白名单；`look … always` 存 `meta/look`。底座（规则、裁判、手势、挑战、循环）不动。

**Tech Stack:** 原生 JS（ES modules）、html2canvas-pro 2.5.2（MIT，已装）、kiwi.js 1.1.3（第八轮）、`node --test`、Playwright（截图看样子、e2e）。

**Spec:** `docs/superpowers/specs/2026-11-13-stage-canvas-design.md`

## Global Constraints

- 底座不动：已有指令的写法和意思、`types/*` 的规则、`referee.js`、`goal.js`、`loop.js` 的叫老师规则、`scene` / 回看、七张旧验收表（`fix1 new2 new3 new4 new5 first new6`）的结论不变。
- 老师摆过的位置页面不挪（唯一例外：底线 1，学生要点的东西被盖住 / 出了屏幕）。页面不再自己整台缩小（老师从没摆过、没 `scale` 过的东西除外）。
- 底线 1：学生要点的东西（输入框、发送、下课、返回学习台、这一问的按钮和输入、`open` 交出去的部件）不能被藏、被盖、透明度低于 0.6、小于 44 像素；违反的那一部分不照办，告诉老师原因。底线 2：值不在档里当场报。
- 速度：截图、样式、排版不在「学生作答 → 发出去」的路上多等超过 0.5 秒；截图只发最新一张。
- 颜色只用名字（`ink muted brand gold red g1…g6`），每种风格自己定颜色。
- 说明每门课 ≤ 24576 字节（`STAGE_TEACH` + `stageDoc(门课)`）：加的行先压别的。
- 不用 `window.confirm / alert / prompt`；注释、界面文字、提交说明中文；触控目标 ≥ 44px；不在提交说明里写模型名。
- 改了 `kit/src/` 要 `npm run build`、`node proto/stage/build.mjs` 并提交产物；分支 `claude/lucid-ride-ozv77a`。每一批做完：`npm test`、`npm run check:stage`、七张旧表、e2e 舞台段，快进合进 `main`、版本号加一档、重新发布学习台（不用问）。

## Review Focus

1. 一节旧课刷新放回（log 里没有 `look` / `scale` / `draw`、只有第八轮的 `place` / `pos`）：画面和以前一样能放回，不报错（Task 2、5 的测试各放一段旧 log）。
2. 老师写 `look * frame=none` 以后，裁判圈的错、做到挑战的勾、点着的圈照样看得见（Task 3：层叠层的测试量 `.is-slip` 的 outline 还在）。
3. 截图失败（库抛错、超时、看图权限没有）：照常叫老师，那一条写「这一轮没截到图」并带字画版面，不卡住（Task 1）。
4. `scale s 2` 以后学生拖句子里的词、点树的结点：落点和以前一样准（Task 6：真手指检查加一段 `scale`）。
5. 东西在两轮之间长大压住了老师 `open` 交出去的部件：页面挪开没被摆过的那样、或最少地挪那一样，并告诉老师（Task 5）。

---

## 文件

| 文件 | 负责 |
|---|---|
| `kit/src/stage/snap.js`（新） | 截图：静下来后台拍、要的时候拿最新一张、超时兜底；`fitEdge`、`snapNote` 纯函数 |
| `kit/src/stage/look/spec.js`（新） | `look` 的写法：目标、属性档、合并顺序、默认样式表、元素 × 属性表。纯函数 |
| `kit/src/stage/look/css.js`（新） | 层叠层：把舞台的样式分成 `st-base` / `st-state`，生成 `st-look` 的规则。纯函数 |
| `kit/src/stage/look/apply.js`（新） | 画面一侧：给每个元素写 `data-lk-*` 和 CSS 变量；底线 1 的量和退回 |
| `kit/src/stage/draw.js`（新） | `draw` 的写法和几何（复用 `markdraw.js` 的 `shapeFor` / `arrowPath`、`svgsafe.js`）。纯函数 |
| `kit/src/stage/scene.js`（改） | `case 'look' / 'scale' / 'arrange' / 'draw' / 'erase'`；`o.k`、`o.pinned`；缩放后的框；现状的「样子」「压着」「出了屏幕」 |
| `kit/src/stage/stage.js`（改） | `layerOf(id)`、缩放层、截图接上、钉住的排版、`arrange`、画的东西、底线 1、`bar` / `dock` 目标；删掉第六轮收放栏 |
| `kit/src/stage/types/*.view.js`（改） | 画在 `stage.layerOf(o.id)` / `stage.underOf(o.id)` / `stage.inkOf(o.id)` 里，取框用 `sc.localPartBox` / `sc.localObjectBox` |
| `kit/src/stage/loop.js`（改） | 发给老师时带图（`images`），写「[画面]」那一句 |
| `kit/src/stage/classroom.js`（改） | 开课读 `meta/look`、写回 `always`；把顶上那一条交给舞台当 `bar` |
| `kit/src/stage/doc.js`（改） | `STAGE_TEACH` 那一句、「画面归你」一节 |
| `kit/src/memory/pages.js`（改） | 「管理 → 样子」列出一直用的样子，能删 |
| `evals/stage-canvas/`（新） | 设计要求单 30 条、起始画面、评卷结果 |
| `tools/stage-canvas-eval.mjs`（新） | 设计要求单：起始截图 + 现状 → 模拟老师写的行 → 演出来截前后两张 |

---

## 第一批：眼睛和样子（做完合、发布，早上能用）

### Task 1：截图给老师

**Files:** Create `kit/src/stage/snap.js`; Modify `kit/src/stage/stage.js`、`kit/src/stage/loop.js`、`kit/src/stage/classroom.js`、`kit/build.js`（html2canvas-pro 打进去）; Test `tests/stage-snap.test.js`

**Interfaces:**
- Produces: `fitEdge({ w, h }, max = 1024) → { w, h, k }`；`snapNote({ ok, ageMs, reason })` → `'[画面] 附了一张这一刻的画面图'` / `'[画面] 附了一张 3 秒前的画面图'` / `'[画面] 这一轮没截到图（原因）：下面是字画的版面'`；`createSnapper(stage, { quietMs = 600, maxEdge = 1024, timeoutMs = 800, render })` → `{ dirty(), latest() → { blob, at } | null, fresh(maxWait = 500) → Promise<{ blob, at } | null>, stop() }`（`render(el) → Promise<HTMLCanvasElement>`，默认 html2canvas-pro，测试里换假的）。`stage.snapper`；`stage.snapNow()`。
- loop.js：`host.call(input, { ...host.teach, images: [blob] })`，最后一条用户消息末尾加 `snapNote(...)`（没图时再加 `sketchText`）。只在 `host.images` 为真时带图。花费记 `cost.img`（字节）。

- [ ] Step 1：测试 `fitEdge({w:1180,h:820})` → `{w:1024,h:712,k:≈0.868}`；`fitEdge({w:800,h:600})` 不放大；`snapNote` 三种句子一字不差；`createSnapper` 用假 `render` 和假时钟：`dirty()` 后 600 毫秒内不拍、过了拍一次；拍的时候又 `dirty()` 再拍；`fresh(500)` 在没新变化时直接给最新那张、有新变化时等新的、`render` 一直不回来时 500 毫秒后给旧的；`render` 抛错时 `latest()` 是 null、不抛。
- [ ] Step 2：FAIL → 实现 → PASS。
- [ ] Step 3：接上：`stage.js` 在 `sync`、`compose`、`say`、学生每一下之后 `snapper.dirty()`（MutationObserver 也行）；`loop.js` 的 `teach` 在调用前 `await stage.snapper.fresh(500)`；`?dev` 的模拟老师（`devteacher.js` 的 `stageMock`）把收到的图数记在 `window.LAStageDev.lastImages`。
- [ ] Step 4：e2e 舞台段加一条：模拟老师第二轮收到 1 张图（`lastImages === 1`），那一轮 `cost.img > 0`。
- [ ] Step 5：`npm test` 全过；提交「舞台：每轮把画面截图给老师（html2canvas-pro，静下来后台拍）」。

### Task 2：`look` 的写法（纯函数 + 场景）

**Files:** Create `kit/src/stage/look/spec.js`; Modify `kit/src/stage/script.js`、`kit/src/stage/scene.js`、`tools/stage-cost-lib.js`; Test `tests/stage-look-spec.test.js`

**Interfaces:**
- Produces（spec.js）：`FIXED = ['say','goals','dock','bar','*']`；`KINDS = ['card','sentence','array','matrix','tree','graph','table','timeline','plane','tex','node','label','dial','draw']`；`PROPS = { frame:['none','line','card'], bg:['none','soft','card',...COLOR], edge:['none','thin','thick',...COLOR], radius:'0-24', shadow:['on','off'], pad:['0','s','m','l'], text:'10-64', font:['sans','serif','hand','mono'], weight:['normal','bold'], color:COLOR, align:['left','center','right'], opacity:'0.2-1' }`，`COLOR = ['ink','muted','brand','gold','red','g1','g2','g3','g4','g5','g6']`；`parseLook(words, opts, { isObject, isPart, isLabel, isDraw }) → { targets: [{ name, rank }], props, hide: bool|null, always: bool, reset: bool }`（rank：`*`=0 种类=1 固定块和东西、字、画的=2 部件=3；写错抛中文错）；`resolveLook(looks, { name, kind, obj }) → props`（照 rank 再照先后合并）；`DEFAULT_LOOK`（话 `frame=none`，别的不写＝原样）；`APPLIES = { text:[...全部属性], box:['frame','bg','edge','radius','shadow','pad','opacity','hide'], line:['color','edge','opacity','hide'] }` 和元素 → 类别的表 `ROLE_OF`。
- 场景：`scene.looks`（数组 `{ target, rank, props, hide }`，按先后）；`case 'look'`（`look 目标… 属性=值… [hide|show] [always] [reset]`）；`case 'style'` 照旧收（换成等价的 `look`：`frame=on→card`、`off→none`、`size s/m/l/xl→text 15/19/24/30`）；`dropObject` 删掉指着它的；`clone` 带上；`stateText` 一行「样子：话 不带框；q 不带框、字 24」（替换第八轮补的 `styleLine`）；`fx.look = { always: [...] }` 交给画面。
- [ ] Step 1：测试：`look say frame=none text=24` → say 上 `{frame:'none', text:'24'}`；`look * frame=none` + `look q frame=card` → q 得 card、say 得 none；`look card frame=none` 对所有题卡；`look s.3 color=g2` 只给那个部件；`look zz frame=none` 报「舞台上没有「zz」」；`look say frame=maybe` 报「frame= 只能写 none / line / card」；`look say text=200` 报档；`look say hide` → hide；`look * frame=none always` → `fx.look.always` 有它；`look * reset always` → reset；旧课 log（第八轮的 `place`、`pos`、`style`）放回不报错；`style say frame=on size=l` 等价于 `look say frame=card text=24`。
- [ ] Step 2：FAIL → 实现 → PASS；`npm test`（选项全覆盖那条补 `look`）。
- [ ] Step 3：提交「舞台：look 的写法（目标、属性档、合并顺序、默认样式表）」。

### Task 3：照 `look` 画（层叠层、底座反馈在最上）

**Files:** Create `kit/src/stage/look/css.js`、`kit/src/stage/look/apply.js`; Modify `kit/src/stage/stage.js`（`applyStyles` 换成 `applyLooks`）、`kit/src/stage/stage.css`（去掉第八轮补的 `data-look-*` 那几条）、`proto/stage/main.js`、`kit/src/main.js` 或打样式的地方（舞台样式经 `layered(css)` 包一层）; Test `tests/stage-look-css.test.js`

**Interfaces:**
- Produces（css.js）：`STATE_TOKENS = ['is-glow','is-slip','is-pick','is-picking','is-tap','is-press','is-met','is-was','is-wrong','is-right','is-covered','is-drop','is-nodrop','is-lift','is-lifted','is-dim','is-hold','is-over','is-shake','is-focus','data-paint']`；`splitState(css) → { base, state }`（顶层规则的选择器里有这些记号的进 state；`@media` / `@keyframes` 整块留在 base）；`layered(css) → '@layer st-base, st-look, st-state; @layer st-base{…} @layer st-look{…} @layer st-state{…}'`；`LOOK_RULES`（`st-look` 里的规则，只认 `[data-lk-*]` 属性和 `--lk-*` 变量）。
- apply.js：`applyLooks(stage) → { changed, refused: [{ target, prop, why }] }`：给舞台上每个元素写 `data-lk-role`、`data-lk-frame` 等属性和 `--lk-*` 变量（东西的节点照 `data-obj`、部件照 `__pid`，贴的字、拨盘、画的、话、挑战、`dock`、`bar`）；底线 1：学生要点的元素算出来 `hide` / `opacity < 0.6` / 小于 44px 的那一项不写、记进 `refused`。
- 舞台现状：`refused` 写成「没照办：dock 不能藏（学生要在这里打字）」。
- [ ] Step 1：测试 `splitState`：`.st-cell.is-glow{…}` 进 state、`.st-cell{…}` 进 base、`@media(...){…}` 留 base、`.st-label.is-key` 不进 state（`is-key` 不是状态）；`layered` 输出以 `@layer st-base, st-look, st-state;` 开头。
- [ ] Step 2：FAIL → 实现 → PASS。
- [ ] Step 3：接上画面；Playwright 小脚本量（写进 `tools/stage-look-check.mjs`，`npm run check:stage` 里跑）：`look * frame=none` 以后题卡的 `.st-card` 计算出的 `box-shadow` 是 none、背景透明；`.is-slip` 的 outline 还在；`look say text=30` 以后话的字号 30×档；`look dock hide` 不照办、现状里有那一句。
- [ ] Step 4：`npm test`、`npm run check:stage`；提交「舞台：照 look 画（层叠层：底座反馈永远在老师的样子上面；底线 1）」。

### Task 4：位置归老师（钉住、`arrange`、压着 / 出了屏幕照实说）

**Files:** Modify `kit/src/stage/scene.js`（`place` 让主语 `o.pinned = true`；`case 'arrange'`）、`kit/src/stage/compose/solve.js`（`item.pinned`：照 `prev` 定死，不进关系、不缩）、`kit/src/stage/compose/apply.js`（`composeInput` 带 `pinned`）、`kit/src/stage/compose/report.js`（「压着：a 和 b」「出了屏幕：a」）、`kit/src/stage/stage.js`（`composeOnce`：钉住的照 `prev`、`arrange` 时全部进求解、底线 1 的挪）; Test `tests/stage-compose-pin.test.js`

**Interfaces:**
- 场景：`o.pinned`（`place` 的主语、`at=`）；`case 'arrange'`（`arrange` / `arrange s q`）返回 `{ arrange: [ids] | 'all' }`，画面收到后这一次求解里那几样不当钉子，排完照样钉住。
- 求解器：`items[].pinned`（有 `prev` 时当 `fixed`）；整台缩一档只在 `items` 里有没被钉住的东西放不下时，且只缩没钉住的（`unpinnedScale`）——钉住的放不下只报告。
- `layoutLines` 多两种行：`压着：s 和 q`（两两相交的，钉住的才报；没钉住的求解器本来就避开）、`出了屏幕：tl`。
- 底线 1：`openedParts(scene)`（`open` 交出去的部件和这一问的 `refs`）的框被别的东西盖住或出了画布 → 先挪没钉住的盖它的那样（当墙重解）；还不行挪那样东西本身最少的距离；记一句「为了让学生点得到，挪了 …」进现状。
- [ ] Step 1：测试：`place s main` 以后 `s.pinned`；钉住的东西在第二次求解里位置不变（新东西绕开它）；两样钉住的互相压着 → `layoutLines` 有「压着：a 和 b」、位置都不变；`arrange` 以后重排、仍钉住；旧课 log（第八轮的 `place`）放回：`place` 过的照样钉住（行为变化是有意的：写进 rulings）。
- [ ] Step 2：FAIL → 实现 → PASS；`npm test`。
- [ ] Step 3：提交「舞台：老师摆过的归老师（钉住、arrange、压着 / 出了屏幕照实说、底线 1 的挪）」。

### Task 5：说明（第一批的部分）和发布

**Files:** Modify `kit/src/stage/doc.js`、`CLAUDE-PROJECT.md`（版本号）、`docs/stage-mainline.md`、`CLAUDE.md`

- [ ] Step 1：`STAGE_TEACH` 的「你决定教什么、怎么引导；画得好、动得顺、算得对是页面的事」换成「你决定教什么、怎么引导，也决定画面：放哪、多大、什么样子、画什么都由你定；页面只负责算得对、动得顺、照你写的画。学生说不喜欢哪里的样子，当场改，没有「页面画的改不了」」。
- [ ] Step 2：「画面归你」一节（替换第八轮的 place / style / preview 三行）：`look`、`place` / `arrange`（钉住的规矩一句）、「每轮你会收到一张这一刻的画面图：先看图再写」；量六门课都 ≤ 24576，超了压别的行。
- [ ] Step 3：`npm test`、`npm run check:stage`、七张旧表、`node tools/desk-e2e.mjs --only stage`；版本号加一档、build、提交、快进合进 `main`、重新发布学习台。

## 第二批：大小、画的东西、一直用的样子、顶上和底下

### Task 6：`scale`（每样东西自己的一层）

**Files:** Modify `kit/src/stage/scene.js`（`o.k`、`case 'scale'`、`localObjectBox` / `localPartBox`，`objectBox` / `partBox` 按原点乘 `k`）、`kit/src/stage/stage.js`（`layerOf(id)` / `underOf(id)` / `inkOf(id)`、`footprintBoxes` 换算、`toWorldLive` 换到那样东西自己的坐标 `toLocal(id, pt)`）、`kit/src/stage/pointer.js`（拖的落点换算）、每个 `types/*.view.js`（取框用 local、画在自己那一层）; Test `tests/stage-scale.test.js`

**Interfaces:** `scale 名字 系数`（0.5～2.5，写错报档）；`scene.localPartBox(p)`、`scene.localObjectBox(id)`（不缩放）；`scene.partBox` / `objectBox` = `pivot + (local − pivot) × k`（pivot 是 local 框的左上角）；`stage.layerOf(id)` 是 `stage.layer` 里一个 `div.st-objlayer[data-obj]`（`transform-origin` = pivot、`transform: scale(k)`），SVG 两层里各一个 `g`。

- [ ] Step 1：测试（纯）：`scale s 2` 以后 `partBox(s.3)` 的宽是原来的 2 倍、左上角相对 pivot 的距离也是 2 倍；`localPartBox` 不变；`scale s 3` 报「0.5 到 2.5」；`scale` 让 `open` 交出去的部件小于 44px 报底线 1。
- [ ] Step 2：FAIL → 实现（场景） → PASS。
- [ ] Step 3：画法换层（一种东西一次改，改一种跑一次 `npm run check:stage`）；真手指检查（`tools/stage-touch.mjs`）加一段：`scale s 1.6` 后拖句子的词、点树的结点、拨矩阵的格，落点对。
- [ ] Step 4：`npm test`、`npm run check:stage`；提交「舞台：scale（每样东西自己一层整体缩放，点、拖、贴字、排版都跟着）」。

### Task 7：`draw` / `erase`

**Files:** Create `kit/src/stage/draw.js`; Modify `scene.js`（`scene.drawings`、`case 'draw' / 'erase'`、现状一行「画的：d1 箭头 s.3→tl.fr」）、`stage.js`（每次 sync 照框画到 `ink` 层，`pointer-events: none`，贴着部件的并进那样东西的排版框）; Test `tests/stage-draw.test.js`

**Interfaces:** `draw 名字 arrow from=部件 to=部件 | circle on= | box on= | brace under=|over= "字" | underline on= | text at=格 "字" | svg at=格 "<path …/>"` + `color=`；`parseDraw(words, opts, strs) → spec`（写错抛中文）；`drawGeometry(spec, boxOf) → { strokes, fills, texts, bbox }`（`shapeFor` / `arrowPath` / `svgsafe` 的 `parseSketch`，svg 的 viewBox 0 0 100 100 拉到格子框）。

- [ ] Step 1：测试：每种写一条、`drawGeometry` 出 `strokes` 不空、`bbox` 在那几个部件附近；`svg` 里写 `<script>` 被白名单去掉、报一句；`erase d1` 以后没了；部件没了（remove s）画的跟着没；同一个 log 画两次一样（种子按名字）。
- [ ] Step 2：FAIL → 实现 → PASS；画面接上，`check:stage` 不报压着 / 出屏。
- [ ] Step 3：提交「舞台：draw（箭头、圈、框、括号、下划线、字、任意 SVG，跟着东西走）」。

### Task 8：一直用的样子、`bar` / `dock`

**Files:** Modify `kit/src/stage/classroom.js`（开课读 `meta/look`，放回时先叠上；收到 `fx.look.always` 写回）、`kit/src/stage/stage.js`（`new Stage(host, { barEl })`，`bar` 的子元素有名字：`bar.back` `bar.title` `bar.scenes` `bar.talk` `bar.end`）、`kit/src/memory/pages.js` + `desk.js`（「管理 → 样子」）、`kit/src/memory/schema.js`（`meta/look` 页面写）; Test `tests/stage-look-always.test.js`

**Interfaces:** `meta/look = { looks: [{ target, props, hide }], at }`（只收 `*`、种类名、`say goals dock bar`）；`alwaysLooks(prev, change) → next`（加、改、`reset` 撤，纯函数）。

- [ ] Step 1：测试 `alwaysLooks`：加两条、同目标合并、`reset` 撤掉、具体名字（`q`）不收并报「always 只收种类名和 say / goals / dock / bar / *」。
- [ ] Step 2：FAIL → 实现 → PASS；e2e 舞台段：说「测试:不要框」→ 模拟老师写 `look * frame=none always` → 下课开新课，题卡一出来就不带框；「管理 → 样子」里看得到、能删。
- [ ] Step 3：提交「舞台：一直用的样子（look … always 存 meta/look，开课先叠上）、顶上和底下那一条也能改」。

### Task 9：说明（第二批）、删第六轮的收放栏、发布

- [ ] Step 1：说明加 `scale`、`draw`、`always` 各一行；量六门课。
- [ ] Step 2：删掉第六轮的收放栏（`setSide` `sideToggle` `toggleSide` `wideDock` `fitDock` `placeWait` `pickSide` 的调用、`.st-side*` 样式、`?side=open`），回看照旧（`lookback.js` 不传 `side`）；`tests/stage-mainline6-side.test.js` 删掉或改成「自由构图时没有栏」。
- [ ] Step 3：全套检查（同 Task 5 Step 3），合、发布。

## 第三批：设计要求单（验收）

### Task 10：设计要求单和评卷

**Files:** Create `evals/stage-canvas/requests.json`（30 条：`{ id, start: "起始画面的老师行", say: "学生的原话", want: "评卷看什么" }`）、`tools/stage-canvas-eval.mjs`（`prepare`：每条演起始画面、截图、写 `prompt-<id>.md`（舞台说明 + 现状 + 学生原话 + 图的路径）；`apply <id> <行的文件>`：起始 + 老师写的行一起演、截前后两张、记没演上的行）、`evals/stage-canvas/results.md`

- [ ] Step 1：写 30 条（设计第 10 节的几类各几条，「我不想要这个显示了」这种不具体的至少 3 条）。
- [ ] Step 2：`prepare`；每条派一个模拟老师子代理（只给它 `prompt-<id>.md` 和图），写回一轮；`apply`；每条派一个评卷子代理看前后两张图 + `want` 判「做到 / 没做到 / 碰底线且解释了」。
- [ ] Step 3：没做到的每条找原因：说明没写清（改说明）、写法缺（补写法）、页面没照办（修）；再跑没过的那几条，直到 30 条全过。结果写进 `results.md`。
- [ ] Step 4：合、发布；`docs/stage-mainline.md` 第九轮一节、`CLAUDE.md` 舞台那一条、rulings。

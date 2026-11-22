# 外部的课（`kind: ext`）

上课的线程（本项目里每节课开的一个 Claude 任务，代码和数据里叫「外部」）在学习台的黑板上讲课的完整写法：学习台画板、当场判分、记作答。最简的接口在学习台数据库的 `meta/interface`（`kit/src/project/iface.js` 照代码写）。board 块的通用写法在 `kit/src/class/prompt.js` 的 `PROTOCOL_DOC`、`PROJECT_CLASS_DOC`，组件写法在 `kit/components.md`，每一类数据的字段在 `kit/src/memory/schema.js`。


**开一节**：写 `sessions/{编号}` = `{ "date": "YYYY-MM-DD"（上海时间）, "kind": "ext", "status": "open", "block": "L2.1.4", "title": "…", "space": "math" | "cs" | "en", "startedAt": 毫秒 }`。编号 `c-YYYYMMDD-n`（那一天第几节，用没用过的）。可以和第一条 `ext_in` 同一次写；资料包可选（`sessions/{编号}/pack/main`）。页面第一次打开这节课时补上 `subject`、`aims: []`。学生在首页「上课」那一行看到它，点进去是黑板。

**一轮**：写 `sessions/{编号}/ext_in/{三位数序号}` = `{ "seq": 1, "text": "…", "after": 0, "said": "…", "model": "…", "at": 毫秒 }`：

- `text`：说的话 + `board` 块，写法见 `PROTOCOL_DOC`（话写在板顶，块里是板的内容和指令）。
- `after`：读过的最后一份 `ext_out` 的序号（页面拿它算来回时间）。
- `said`（可选）：学生在对话里说的原话，页面记成学生说的话（证据 `src: say, via: "chat"`）。一个字符串，或者每一句一条 `[{ "text": "…", "at": 毫秒, "images": ["asset 编号"] }]`（`at` 照写进证据，图是外部用 `upload_asset` 传的）；都进课后报告。
- `model`（可选）：照存进这一轮的记录，报告里看得到；板上不标。
- 页面按序号执行，执行完在那一条上写 `done: { at }` 和 `got`（收到的时刻）；同一条只执行一次，刷新、开两个标签页都不重复。

**只在外部的课里有用的指令**（board 块的第一行；下面三条，加上后面几节的 `queue`、`edit`、`claude`、`claude-off`、`set`）：

- `board snap`：下一份 `ext_out` 带这块板的截图（`shots`：asset 编号，用读图的工具取）。不写不拍。
- `board close`：这一轮画完就下课（不调用 Claude、不写小结）：页面写 `status: closed`、`closedBy: "ext"`，算课后报告 `sessions/{编号}/report/main`（里面 `ext: { n, median, p90 }` 是来回的毫秒数）。学生在页面上点「下课」也一样。
- `board coach target=题的 id upto=…`：开这一题的板边助教（见文末）。不写就没有。

**执行完当场回报**（不用等学生动一下）：

- 页面执行完一条 `ext_in`，在那一条上写 `result` = `{ at, ok, summary, ops: [{ op, id, target, ok, error, page }], errors: [写错没显示的段和原因], notes: [别的提醒], memo: [{ line, ok, id, error }], shots: [asset 编号], shotNote }`。`memo` 是这一轮 `board memo` 块的每一行：写进去了的 `ok: true`、`id` 是写成的那一条（`errors/L2-60`、`sessions/{编号}.block`、`summary（新笔记）`），没写成的 `ok: false`、`error` 是为什么（读不懂、守卫拒了、超了条数）。这一轮写了 `board snap` 时，页面先等这块板画好（字体载完、段的淡入和别的动画走完、舞台演完、板上 0.35 秒不再变，最多等 6 秒）再拍，整块板拍成一张长图（比 4800 像素还高才切，`shotNote` 写切成几张、各是哪一段；等满 6 秒还在变也写一句）；下一份 `ext_out` 也带同几张。
- `sessions/{编号}/meta/now` = `{ at, text, board }`：黑板现状，`board` 是结构化的（每块板、每段、组件 id、每张图能改的变量、标注、草稿、作答、舞台现状、预备板、助手、屏幕）。板一变就覆盖写（最多一秒一次；写 `ext_out` 的那一刻也跟着写一份）；学生没动也读得到。
- `sessions/{编号}/meta/since` = `{ at, from（外部上一条执行完的 ext_in 的编号）, fromAt, outs: [序号], shots, text }`：那一条执行完以后写的全部 `ext_out` 按先后拼成一份，一次 get 读完；下一条 `ext_in` 执行完时从头攒。
- 屏幕照这个页面真有的地方报（`visualViewport`）：分屏时写「横屏 860×734（分屏：这个页面只占屏幕的一部分，整个屏幕 1180×820）」，`meta/now.board.screen` 里是 `{ w, h, landscape, split, full }`。

**分析游标和这一科没分析的证据**（证据一条都不丢、每一条都被分析过）：

- `meta/cursor-{math|cs|en}` = `{ "at": 毫秒, "by": "ext", "note": "…" }`：外部写，分析到这一刻为止。比的是证据**写进学习台的时刻**（证据上的 `wroteAt`，以前的证据没有就按 `at`），不是事件时间：`said` 写的是学生说话的时候，常常早于写进来。
- `meta/since-analysis-{科}` = `{ at, from, n, shown, more, upTo, text }`：页面写。游标以后写进来的这一科的全部证据（课堂、外部的课、复现课、练一练、页面里的老师和助手、补记、要记的），按事件时间一条一行（开头是证据编号；事件和写入差一分钟以上的那一行末尾标「写入 hh:mm」），一次 get 读完；太长（200 KiB）先放早写进来的，照实写还有几条。`upTo` 是放下的这些里最晚写进来的那一刻：分析完把游标的 `at` 写成它，没放下的下一次照样在。
- 开场简报 `meta/brief*` 最前面两行：笔记本「现状/总览.md」是几天前写的（超过 7 天写「该重写了」）、上次分析以后这一科还有几条证据没分析。
- 和 `sessions/{编号}/meta/since`（一节外部的课里，上一条 `ext_in` 以后的 `ext_out`）是一套：一个按课，一个按科。

**讲过和会了**：

- 板上的段写 `block=L2.1.4`（课程地图的编号）就是这一段讲的块，不写是这节课的块；段画上了页面就记 `coverage/{编号}`（`#` 换成 `~`）= `{ id, kind: block | point, block, space, sessions, first, last, segs }`，有 `point=` 的另记一条知识点。一节课里做过这一块的题（证据、那节课记的错题、掌握的依据是那节课的作答）也算那节课讲过。
- 学习台以前讲的（claude.ai 对话里的课，没有原始作答）记 `coverage/legacy-{编号}` = `{ id, kind: "legacy", block, space, first, last, sessions: [], source, by, note }`：外部写的照用；有错题、掌握的依据是旧记录、可这一块一条 legacy 都没有的，页面照错题本的日期、依据文字里的日期（「09-28」）补一条（`by: "page"`，`source` 写照什么补的）。掌握明写着「未学」的、学习台里的课记的错题不补。
- 掌握状态（`mastery`）的依据：最近一条改 `state` 的 log 的 `basis`，编号在 `evidence`、`errors`（含 T 编号的检验记录）、`observations`、`sessions` 里找。全在证据里的是原始作答：`基础题过` / `复现通过` 还要依据里有做对的作答。依据里有错题本、观察、课的编号，或「旧记录：…」开头的文字，是**旧记录**（没有原始作答）：状态照算，`meta/state-{科}` 里写「（旧记录：错题本 L1-T01，没有原始作答）」。哪里都找不到、也不是「旧记录」开头的，照存，写「依据核不上，不算」。
- `meta/state-{科}` = `{ text, rows: [{ block, title, taught: { first, last, sessions, legacy: { first, last, months, source } }, mastery: { state, ok, legacy, from, why, note }, recent（最近 3 条作答，含错题本里的旧错题、检验记录）, lastSlip（最近一次失手；检验记录写「不计」的不算）, nextReview }], conflicts: [{ kind, block, text }] }`：页面写，每块一行，讲过写「讲过（9 月，旧记录）」「讲过（9 月旧记录；学习台里 2026-11-18，1 节）」。`conflicts` 是记录之间对不上的，只报不改：`slipped`（掌握写着过了，之后同块做错了，或错题本里之后又记了错题）、`maybeKnown`（写着未学 / 讲过，隔天的新题一次做对了）、`weakness`（弱点 L1 以上以后又有挂它的错题）、`review`（复现组判过，依据里没有一次做对的作答）、`untaught`（没讲过却写了掌握）、`unverified`（掌握的依据核不上）。

**页面里的 Claude 说的话**也记成证据 `src: "helper"`（`role`：`helper` 外部叫来的助手、`coach` 板边助教、`teacher` 练习教练和复现课里页面里的老师；`text` 说的话，`did` 执行了哪些，`target` 哪一题），进 `since-analysis`。

**叫醒主讲**：`sessions/{编号}` 写 `"wake": "comments"`（开课时写，或之后 update）。学生在输入框发了话、附了图、交了作答、点了「叫主讲」，页面在那一刻用学生的身份在学习台上发一条「发给 Claude」的评论（同一节课回同一个评论串；8 秒内连着的只发一次），文字是课号、原因和「读 sessions/{编号}/meta/since」；作答本身照旧写进 `ext_out`。正在 watch 学习台这个 artifact 的 Claude 会话被叫醒（watch 只对登记过的会话有效）。只在浏览器里打开的完整页面发得出去（2026-11-22 实测 iPad Safari 能发，Claude App 里嵌着的视图回 `claude_unavailable`）；发不了、学生没同意、出错时，下一份 `ext_out` 最前面写一行原因。学习台的发布要带 `comments` 能力。

**整节课的设置**：`board set upload=on|off`——组件下面的「截图」入口（`answer` 的截图作答、写理由的框里的「截图」）。外部的课默认 `off`；一个组件单独写 `upload: on` / `upload: off` 盖过整节课的。之后画的段照新的设置，刷新以后照旧。

**一轮几块新板、预备板**：

- 一轮里 `board new` 可以写几次，每次开一块新板，最后一块是当前板。
- `board queue id=b5 title="…" after=…`：块里是那块板第一段的内容。先存着、不显示；`after=q-b4:right`（q-b4 答对）、`q-b4:done`（steps 揭开最后一步）、`q-b4:submit`（交了作答）、`button`（板上方出「下一块 →」，学生点）几个用 `|` 连着写，哪个先到就开。开的时候页面照 `board new` 画、翻过去，写进下一份 `ext_out`（`[页面] 预备板 b5 开了`）。没开的列在黑板现状「外部的课里页面记着的」。
- `board react` 的 `target` 可以是还没开的预备板里的组件：先存着（`result` 里写「挂在预备板 b5 的组件上：开板时挂上」），开板时挂上。
- `board unqueue id=b5`：没开的预备板丢掉，挂在它上面的预案一起丢，「下一块 →」跟着收；开过的报「已经开了」（要撤板上的段用 `board hide`）。

**指以前的板**：`mark`、`figure`、`replace`、`edit`、`hide` 的目标在以前的板上也执行；学生不在那块板上时，板上方出一条「主讲在第 N 块板上标了东西 →」，学生点了翻过去。

**改字不丢作答**：`board edit id=b3`，块里写一处或几处

```
<<<
原来的字
===
新的字
>>>
```

旧字要在那一段里正好出现一次。只改那段的文字；改完以后原文一字没变的组件（按 `id:` 对）留着学生的作答、草稿、拖过的图。改到了的组件照 `replace` 重画。

**预案**（`board react`，写法见 `PROTOCOL_DOC`）：外部的课里除了 `right`、`done`，还收：

- `wrong: …`：答错；`wrong match="x=3": …` 学生的答案里有这一段（不管空格、大小写、全角半角）才用这一条，`match="/正则/"` 照正则；同一题先找对得上 `match` 的，再用没写 `match` 的。
- `misread "错法": …`（页面认出来的错法）、`giveup: …`（想不出来、看了答案）。
- `stuck=90s: …`：那一题这么久没有作答（至少 10s）。只算那题在学生屏幕上的时间：学生翻到别的板、切到别的程序、锁屏的时间不算（`board claude … stuck=` 也一样）。
- 每条只用一次；页面接了不调用，写进下一份 `ext_out`（`（预案当场接了：…）`）。

**叫页面里的 Claude 来接：`board claude`**（Opus 5.5 high；平台回的不是它，那一次作废、不写）：

````
````board claude id=cl1 on=wrong target=q1 to=board turns=2
see: target, board, evidence=last3
can: say, mark
<<<
（写给它的话，任意长）
>>>
````
````

- 什么时候叫：不写 `on=` 就是执行这一轮时马上叫一次；`on=` 写学生在 `target` 那题上的事，几件用 `|` 连：`submit`（交了）、`wrong`（答错）、`right`（答对）、`giveup`（想不出来 / 看了答案）、`draft`（写着还没交，写的变了就算一次）、`say`（学生在输入框打了字，不用 `target`）；`stuck=90s`（那题这么久没动静）。
- `see:` 给它看的（不写就是 `target`）：`target`（那道题在板上的原文和学生在上面的全部作答）、`board`（黑板现状）、`evidence=last3`（学生最近几次作答和动作）、`ext`（这节课外部写过的每一段）、`memory=集合/编号,集合/编号`（学习台里那几条，原样）、`books=条目范围`（告诉它用 `textbook_read` 取）。学生这一次的作答总是带着。
- `can:` 它这一次能做的（不写就是 `say`）：`say`（说的话写在板顶）、`add`、`replace`、`hide`、`mark`、`figure`、`react`、`new`、`stage`、`widget`、`memo`、`note`、`judge`（解答题一步一步判，写 `board judge`；`target` 是 `solve` 时学生交的照片原图一起交给它，参考步骤也在它的材料里）。不在里面的指令页面不执行，写进 `ext_out` 的「没执行（越权）」；`pin`、`aims`、`close`、`claude` 这些它一律不能写。
- `to=`：`board`（默认，照 `can` 执行到板上）、`ext`（不上板，全文只写进 `ext_out`）、`db:集合/文档`（全文存进那一条的 `text`，不上板，记一条 `journal`，`by: "ext-delegate"`）。
- `turns=`：这一条最多被叫几次（`on=` 的默认 3，马上叫的默认 1，最多 20）；`until=right`（学生答对那题以后不再叫）/ `turns`（默认，次数用完）/ `me`（外部收回为止）。`board claude-off id=cl1` 收回一条，`board claude-off all` 全收。同一个 `id` 再写一次就换成新的那条（次数从 0 数）。
- 它能用的工具和页面里的老师一样（`calc`、`board_read`、`get_answers`、`view_handwriting`、`textbook_read`、`component_doc`……）。它判断超出了外部给的范围时，最后写一行 `[交回] 原因`：不回学生，板顶写「主讲会接着讲。」，原因进 `ext_out`。
- 每叫一次，下一份 `ext_out` 里有 `[助手 cl1]（wrong q1） 回了：` 加它的全文、执行了哪些、越权没执行的、用量（发出多少、等了几秒、调了几次工具）。黑板现状里列着每一条助手叫过几次、收起没有。
- 学生这边：板上方一直有「叫主讲」；有开着的助手时多一颗「停掉助手」。学生点了以后页面不再叫助手（写进 `ext_out`，这节课记着 `helperOff`），外部再写一条 `board claude` 就重新打开。

**后台的活：`ext_jobs`**：写 `ext_jobs/{id}`（全局）或 `sessions/{编号}/ext_jobs/{id}` = `{ "prompt": "…", "see": ["books/B43/chunks/B43-1", …], "out": "集合/文档", "tools": ["read", "list", "search"], "at": 毫秒 }`：

- 学习台开着时跑：首页开着跑全局的；进了课堂跑全局的和这节课的。一件一件跑（等讲课的调用跑完再发），Opus 5.5 high；`see` 里的几条（最多 12 条）先读好放进给它的话；`tools` 是只读的 `read`、`list`、`search`（不写就三个都给）。
- 状态写回那一件：`queued` → `running`（`startedAt`）→ `done`（`endedAt`、`ms`）或 `failed`（`error`）。`running` 了 10 分钟没写完（页面关了）的下次重跑。
- 结果存进 `out` = `{ text, job, by: "ext-delegate", model, at, from }`，记一条 `journal`（能撤销）。`meta/facts.jobs` 是 `{ queued, running, done, failed }`。
- `board add id=b5 from=集合/文档`（`new`、`replace`、`pin` 也行）：执行前页面把那一条的 `text`（没有就 `md`）换进块里；块里原来写的字留在前面。读不到的那一块照原样执行、`ext_out` 里说一句。

**检验（二类）：`board check`**（学完以后的吸收检验；页面里的老师的课也能写）：

````
````board check id=k1 title="第二讲第一节" limit=15m pause=30s
block L2.1.1 must=p1,p2
block L2.1.4 must=p3,p4,p5 optional=p7 fast=90s
spare p8,p9
<<<
（可选）外部没写到的错法时，给页面里的 Claude 的话
>>>
```construct
id: p1
…
```
（题、它们的 retry、spare 都写在这个块里；题的写法见 `kit/components.md`「检验题」）
````
````

- 块里每个围栏的名字就是探题的题型：`recall` `construct` `claim` `discriminate` `locate` `solve`，408 的 `trace` `predict` `construct` `tradeoff` `code` `calc`，英语的 `parse` `translate` `rewrite` `discriminate` `errfind` `recall`（写法见第三节「检验题」「408 的检验题」「英语的检验题」）。`trace` `predict` `code` `parse` `translate` `errfind` `solve` 单独写在板上是一类组件（第三节同名的那一节）；别的单独写在板上只画预览。
- 检验题的写法：数学的见 `recall` 那一份，408 的见 `tradeoff` 那一份，英语的见 `rewrite` 那一份（`kit/components.md` 里这三节）。
- `block 块 must=… optional=… [fast=]`：一块一行，按写的先后做，块里先必做再可选；`spare`：不出现，只存进题库给复测；没排进任何一行、也不是谁的 `retry` 的题报写法错误。`limit=` 第一次作答一共多久（不写不限时），`pause=` 手写停多久算停顿（默认 30s）。
- 执行时页面先查一遍（写法、每道题的 `example` 代进条件（带着这节课 `let` 过的量；模板先取几组数）、必做题 retry 至少 2 道、至少 1 条 teach、retry 是同一种题型），不过的不开，原因写在 `ext_in.result`；`node tools/ext-check.mjs --next … --lint` 查的是同一份。过了就画一张开始卡，题全部存进题库 `probes`。
- 学生点开始：板、常驻栏、翻板条、整页板书收起来（合书），做完放回来；这时来的 `ext_in` 照常执行，画好的板做完检验才看得到。一道题：作答 → 点「很确定 / 大概 / 蒙的」→ 交；没有提示和「看答案」，「想不出来」一直在。
- 判：构造的每一条、式子、真假、能不能、哪一行、逐行证明、result、fix，408 的表、结果、测试，英语的成分、has / not、选哪个、点的词和改法页面当场判；要点、证明要点、理由、solve 的步骤每交一次调一次页面里的 Opus 5.5 high（给它题、你写的要点或参考步骤、学生交的；手写的带整页图，转写和判同一次），回的不是 Opus、读不出来、超过 90 秒都算拿不准。要它判的题交了学生马上做下一道，判回来没过的在当前这道做完时插进来。
- 判出没过：列出没过的每一项（构造是那一条自己的话，要点是「没写到：要点原文」）→ 你写的 teach → 下一道 retry；做对算补上，又错接着下一道，retry 用完记没吸收。「蒙的」做对也出一道 retry 确认。拿不准的（`unsure`、超时、作废）不补讲、不出 retry，待你核。没有对上的 teach 时叫一次页面里的 Claude 写补讲：给它题、要点、你写的 teach、学生交的、没过的项和 `<<< >>>` 里你写的话；没写 `<<< >>>` 时默认的话是「指出错在哪、只补缺的那一点（不给整段答案）。」（你在任务书里写的那句）。它的话原样显示，记成证据 `src: helper, role: check`。
- 可选题：这一块必做都一次过、都「很确定」、没有在判的（写了 `fast=` 的还要第一次作答都在时间里）就跳过。限时只数第一次作答（题在屏幕上、页面在前台的时间）；过了 `limit` 交的记 `late`，做对最多算补上。
- 刷新、熄屏、切走回来照存着的进度接着做（`sessions/{编号}/check/{检验 id}`），看过没交的照旧算第一次（证据记 `resumed`）；「先停下」板放回来，那一块变成一条「接着做」；下课时还开着照「先停下」存着。没做完的块不写吸收。
- `ext_out`：开始一份「[页面] 检验 k1「…」开始（2 块、5 道必做、限时 15 分钟）」，做完一份：每块的吸收、每道题一行（第一次的作答、没过的项、retry、信心、用时）、手写的整页图和快照的 asset 编号和时间线、待你核的题、记没记错题。中途不一道一道写。
- 改判：任何一轮 `board judge target=题的 id`，块里一行一项（`m1 ok` / `m2 missing` / `if1 wrong why="…"` / `s3 wrong tag=…` / `m3 unsure`），加一行 `result=pass | fail` 改整道题。页面追加一条改判的证据（`rejudged: true`），重算那一块的吸收；待核的判成没过算「未」，它没用上的 retry 记进 `absorb.retryOwed`，复测先出。也可以直接写 `absorb/{块}`（第七节）。
- 做完的那一刻（不等学生点「回到黑板」）：每块写 `absorb/{块}`，排 1 天、7 天两次复测；最后没过的、「很确定却错了」的题各记一道错题（同一个 `target` 一次检验一道，能撤销）。

**外部设计的交互：`board stage`、`board widget`**（底座的完整清单在 `kit/src/stage/doc.js` 的 `stageManual`、`kit/src/widgetspec.js` 的 `WIDGET_DOC`）：

- `board stage id=s1 title="…"`：块里是舞台的镜头指令（东西、交给学生的手、挑战、预写的反应），页面包成 `stage` 组件画在当前板上（一段一块舞台，没有老师、不调用）。学生每一下、挑战做到没做到、叫老师的事都记成作答 / 动作进 `ext_out`。外部的课里预写的反应除了 `@名字` / `.done` / `.right`，还收 `.wrong`（交了 / 动了但没做到）、`.miss`（走偏：被裁判判成错法、手势被弹回）；`.miss` 能按手势分（`@e.miss merge` / `expand` / `reorder`）、按原因分（`@e.miss why=noncommute` / `noparen` / `notlike` …），先找原因对得上的、再找手势、最后用不分的。没写 `height:` 的舞台照演完以后东西实际占的高。学生动过的舞台刷新以后放回刷新前的样子（页面把舞台的记录存在 `sessions/{编号}/stage_logs/{段 id}`，还在等的那一问照样挂着）；段的镜头指令改过（`board replace`、`board edit` 改了指令）就从头演，下面照旧列「刷新前的作答」。
- 判式子相等（`la.same`、舞台上 `tex … alg=on` 的合并 / 展开 / `equals=`）默认严：矩阵的式子里单独写的数不当 `kE`（`(A-E)(A-2E)` 和 `A^2-3A+2` 不相等，`A^2-3A+2E` 才相等），数 `0` 不当零矩阵 `O`；宽的判法自己开：`la.same(a, b, { loose: true })`、`tex e = "…" alg=loose`。展开出来只剩数的项写成 `2E`。
- `board widget id=w1 title="…"`：块里是一小段 JS，调用 `la.*`（画文字公式矩阵、拖着排、按钮、输入、精确计算、式子相等的判定、记作答、动画、给标注留锚点）。在这一段里跑：一上来就跑不起来（语法错、抛错）这一段不显示、像组件写错一样报；点按钮以后出的错记一条动作 `widget-error` 进 `ext_out`，只坏这一段。
- 两种都是一段：`replace`、`hide`、`edit`、`mark target=s1` 照常用；组件的 `id` 就是段的 `id`。

**学生这边**：页面写 `sessions/{编号}/ext_out/{三位数序号}` = `{ "seq": 1, "text": "…", "shots": ["asset 编号"], "at": 毫秒 }`：

- 什么时候写：学生作答、打字、用 Pencil 写字以后 1.5 秒合并写一条；页面切到后台时马上写掉手上的。选择题判完（答对或放弃）才记一条，前面点错的选项写在那一条里。
- `text` 只写这一批新发生的：最前面是页面要报的（写错没显示的段和原因、没执行的指令、memo / note 没记成的、截图的说明）；然后是这一批的作答、草稿、学生打的字、助教和助手写的话；末尾一句指向 `meta/now`、`meta/since`。黑板现状不在 `ext_out` 里（在 `meta/now`）。
- 每一份只写到它那一刻为止；外部上一条 `ext_in` 以后的全部在 `meta/since`。

**解答题**（组件 `solve`）：学生交了整道题，下一份 `ext_out` 里是 `[作答] … 交了整道题：打字：「…」；照片 2 张（asset …，用 read_asset 看）；等你一步一步判`。外部写 `board judge target=p1`（第四节），页面画出逐步的结论、记作答、有错的步记一道错题，`ext_out` 里接着一行 `[页面] 解答题 p1：错题本记了 L2-57（第 3 步（规则用错）…）` 或没记的原因。照片入口照 `board set upload=on`。

**写错了**：写错的那一段不显示，板上原样，下一份 `ext_out` 最前面写清是哪一段、哪一行、为什么；`board replace id=…` 改那一段。

**预检工具**（在仓库里跑）：

```bash
npm install
node tools/ext-check.mjs --next 这一轮.txt --lint
node tools/ext-check.mjs --next 这一轮.txt --shots 截图目录
```

- `--lint`：不开浏览器，一秒以内只查写法——board 块的围栏和指令、组件名、组件 id 重复、指令的 `target` 存不存在（预备板里的组件也认）、`\calc` 算不算得出、`stage` / `widget` 段的写法、`derive` 的 `mode: do` 的 `start` / `goal` / `let` 读不读得懂、算不算得出（`E(2)` 这一类也查）、`solve` 的写法。
- `--lint` 还打出**出题提示**（只是提醒，不算写错、不影响退出码）：页面判得了对错的题没写预案（`react` 的 wrong / stuck / giveup）也没挂 `board claude`（「学生答错要等你」）；`quiz` 的正确选项比别的长得多、原样写在题干或这一段别的组件里；同一段里一道 `quiz` 的题干或选项原样写着前面那道要学生自己得出的答案（「这题能绕过前面那步」，只查原样出现）。
- 不带 `--lint`：用和学习台同一份组件库在真的浏览器里跑一遍，出 iPad 竖屏、横屏的截图和问题列表；这一轮的预备板（`board queue`）也照 `board new` 画一遍。开头打出组件库的版本号，和学习台底部的版本号对得上才是同一版。Playwright、Chromium 用沙盒里预装的。
- 都可以加 `--session 存数据的目录 [--sid 课号]`：这节课已有的 `ext_in` / `ext_out`（`ArtifactData` 的 `out_dir` 存下来的目录），认得已有的段和组件 id。`--session` 也可以是一个文件：每行一条 `{ "id": "sessions/{编号}/ext_in/001", "data": {…} }`，或者整个文件一个这样的数组（`id` 不是路径时写 `"coll": "ext_in"` / `"ext_out"`，或者照字段认：有 `done` / `after` 的是 `ext_in`）。


**改别的数据**（`meta/today`、`reviews`、`drills`、`notebook`……）：直接写，字段见 `kit/src/memory/schema.js`；写的时候在同一次写里多写一条 `journal/j-{毫秒时间戳的 36 进制}-{5 位随机}` = `{ "at", "by": "ext", "path", "op", "before", "after" }`，学生在「管理 → Claude 改过的」里看得到、能撤销。页面不拦外部的写，格式不对照存、在 `meta/health` 里照实报。

## 页面里的 Claude 和页面算的事实

页面调用的 Claude 只用 Opus 5.5（effort high）：平台回的模型不是它，那一次作废、不写。

- **练习教练**：`meta/today` 里 `kind: "coach"` 的一项（`{ "kind": "coach", "block", "why", "focus", "ids" }`）在首页画成一行，学生点开是一节页面里的老师带的课（`kind: class`），资料包里「主讲写的」那一节原样放着 `why`、`focus`、题号。
- **板边助教**：外部写了 `board coach target=… upto=…` 的那一题，学生被页面判错时，页面叫页面里的 Claude 写一句（中文，不超过 60 个字），接在当前板的最后，标「助教」。给它的只有：这道题在板上的原文、外部写的 `upto`、学生这次的作答。那一句进下一份 `ext_out`（`[助教] 在 q1 下面写了：…`）。
- **页面算的事实**（不调用 Claude，变了就重写）：`meta/facts` = `{ today, spaces: { math | cs | en: { due（到期的复现组 [{ id, title, days }]）, recall（要记的到期几条）, open（挂着没下课的课）, minutes7（这 7 天学了几分钟）, last（上一节） } }, health（体检拿不准的几条） }`；`meta/catalog` = `{ text }`（学习台里有什么）；`meta/mastery-calc`（按作答算的掌握参考）。


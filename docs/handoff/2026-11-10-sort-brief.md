# 舞台：一排格子懂排序（数据结构第八章）

仓库 /home/user/Claude，分支 claude/teaching-mode-code-review-vcz66v（已经在上面，别换）。中文项目：注释、界面字、提交说明、报错都用中文。先读 `CLAUDE.md` 里「舞台」「舞台的底座」两条、「硬性规定」「写代码的习惯」。

## 背景

课在「舞台」上上（`kit/src/stage/`）：老师（Claude）每一轮写几行镜头指令，页面画、动、让学生直接上手、算事实、判对错，把学生做了什么整理好发回给老师。树、矩阵、句子各有一份规则文件（`types/*.rules.js`，接口在 `rules.js`，说明在 `docs/stage-types.md`），学生每一下当场判。**一排格子（`types/array.js`）没有规则**：页面不懂排序，老师要自己心算每一趟，学生拖一张牌页面不知道对不对，计数是老师写的死字。用户眼下在学第八章排序（正在学希尔排序），要把这一块做到和树一样。

量出来的现状和缺的东西：`evals/stage-gaps/report3/数据结构.md` 的 `## D1` 一节（重点读最后「说明」里两张单子）；理想的教法 `evals/stage-gaps/ideal/D1.md`（知道老师想怎么用）。

## 原则（不许违反）

- 页面不做教学决定：只算事实、判对错；学生走偏以后怎么办由老师在 `open` 那一行写（`wrong=quiet|mark|block`、`call=`）。预写只收做对 / 做完（`@a.done`、`@a.right`）。
- 事实以页面算的为准。不说假话：认不准的错法给 null，宁可少说。不静默失效：老师写错当场报，报的话要让老师照着改得对。
- 老师没写明在做哪种排序时，页面不猜：只判这个世界做不做得到，不判对错。
- 旧课照 log 放回要和以前一样（重放的行带 lenient，新规矩只管新写的行）。
- iPad：触控目标 44px。不用 confirm / alert / prompt。
- 能写成纯函数的放不碰 DOM 的模块，配 `node --test`。

## 要做的

**1. 规则文件 `kit/src/stage/types/array.rules.js`**，在 `types/index.js` 登记，照规则接口交（学 `tree.rules.js` 的写法）：
- 老师写明这一排在做什么。写法你照现有风格定（先看 `evals/stage-gaps/stage-doc.txt` 里 open 和 array 那几行），比如造的那一行或 `open` 那一行带 `sort=insert`、`sort=shell d=5`（d 能写拨数的名字，跟着拨）、`sort=bubble`、`sort=select`、`sort=quick`、`sort=merge`、`sort=radix`。
- 黑板那边现成的排序引擎 `kit/src/engines/sort.js`（七种排序，照王道的代码走，`run` 给每一趟结束后的序列 `passes`，`variants` 给常见错法每一趟的序列）是标准：**每一趟的结果、常见错法都从它来，不要另写一份**。答案要和它一致，测试里对拍。
- **一趟的粒度（七种都要）**：页面知道现在这一排等于第几趟（快排是第几次划分）结束后的样子；判断式（挑战里写）「排好了」「第 k 趟做完了」；现在的样子正好等于某种常见错法的某一趟时，事实里写「像是：……」（只在对得上时说）。
- **一下的粒度（直接插入、希尔、冒泡、简单选择）**：`next` 给现在正确的下一步，`check` 判学生这一下（对、不对、像哪种错、这个世界做不到）。直接插入和希尔：下一个该插的那张挪到它那条链上该在的位置（插入式的拖）；同一条链上相邻两张前大后小的对调也算对的一步（学生常这么做，结果一样）。希尔一趟里各条链谁先谁后不强求（王道的代码是交错着走的，学生一条链一条链做也对）。快排、归并、基数这一轮只做一趟的粒度，`open` 学生动手时不判每一下的对错，说明里写清。
- **事实**（学生每一下以后写给老师）：挪了哪张、挪了几格；这一趟到现在比了几次、挪了几次（照王道代码的数法；数不准的那种不写）；现在逆序对几对；这一趟（d = 5）做完没有、哪几条链还没排好、坏在哪几对。
- **量**（现状里写、挑战里比、话里跟着变，照 `count(t)` 的风格起名）：逆序对数；隔 d 的链排好了几条 / 没排好的对数。算不了的时候照规矩给 null / 抛错。
- **隔 d 的链**：判断式「隔 d 的每条链都递增」，量里给坏的对数；两张是不是同一条链上相邻。
- `doneBy`、`judges`、`changed`、`brief` 照接口交；`@a.done`（这一趟做完 / 整个排好，哪个算「做完」你定并写清）要能预写。

**2. 学生的手**：
- 插入式的拖：按住一张拖到两格之间，中间的各让一格（翻成现有的 `move a#6 -> a.2`）。现在学生只能两格对调。和「拖到另一张上对调」怎么同时开，照底座的规矩（`gestures.js` 的按法 / 落点；同一处抢手指的要当场报）。
- 试演工具 `tools/stage-try.mjs`（`stage-try-lib.js` 的 `STUDENT_FORMS`）认学生的新写法，走真的手指那条路。

**3. 能空着、能写的格子**：`array h = _ 49 38` 的 `_` 是空格子（现在画成写着「_」的一格）；老师开了以后学生能用键盘往空格子里写、能把牌拖进空格子（「手」格 A[0]）。尽量照矩阵空格子的做法（`types/matrix.js`、`value.js` 的 `evalHoles`、`keypad.js`）。量和判断式碰到空格子照「还空着」的规矩判不了。

**4. 顺手修掉 D1 那张「页面的毛病」单子里和一排格子有关、会说假话或静默失效的**（每条先写会红的测试）：
- 学生把牌错拖到别的泳道，页面记「做到了挑战」（第 1 条）；
- 没分过组就 `split`，现状写「每组下到自己的一排」；跨泳道拖乱以后现状还写「按隔 5 个分了 5 组」（第 8 条）；
- `{inv(a)}` 这种不认识的函数不报错、画成字（第 6 条）——这一轮 `inv` 要么就是你做的量的名字，要么报错；
- 题卡、话、贴字里的 `[…]` 被吃掉，`A[j+dk]=A[j];` 画成「Aj+dk=Aj;」（第 4 条）：方括号里不是舞台上的东西的写法（`[部件]` 才是能飞的词）照原样画出来；
- 只收不判的 `ask value` 按钮写「对吗」（第 9 条）：换成不暗示会判的字；
- `split` 以后整块舞台缩成一小块、下排出屏幕（第 10 条）：能修就修，修不了写进报告。
别的条（贴字的 side、弧被盖住等）不在这一轮。

**5. 给老师的说明**（`types/array.js` 的 `doc`、`doc.js`）：每条新写法一行，例子照抄能演（`tests/stage-doc.test.js` 守着）。长度有硬上限：`STAGE_TEACH + stageDoc(科目)` 每门课 ≤ 24 KiB；现在数据结构约 21.3 KiB、操作系统约 22.7 KiB、线代约 22.6 KiB，这三门都带 array 的说明——**加的字要省，超了就压别的行，解释放进报错的话里**。量一下：
`node -e "import('./kit/src/stage/doc.js').then(m=>{const e=new TextEncoder();for(const s of Object.keys(m.SUBJECT_TYPES))console.log(s,e.encode(m.STAGE_TEACH+m.stageDoc(s)).length)})"`

**6. 样子页试手感**（`proto/stage/feel.js`）加一段排序（不调用 Claude）：学生自己做希尔的一趟，每一下照真的裁判判。

## 不做

堆排序（树那边的事，下一步）；调用栈、划分树、照代码一行一行跑；时间轴；托盘（树有托盘，一排格子这一轮不加）；学生自己划线分组。

## 怎么干、怎么查

- 先读代码再动手：`types/array.js`、`array.view.js`、`rules.js`、`types/tree.rules.js`、`referee.js`、`gestures.js`、`gesturedom.js`、`docs/stage-types.md`、`engines/sort.js`、`sorting.js`。
- 每样先写会红的测试（`tests/stage-array-rules.test.js` 等），再实现。拿王道的例子（49 38 65 97 76 13 27 49′ 55 04，d = 5、3、1）对一遍每趟的结果。
- 做完跑：`npm test` 全过；`npm run build` 和 `node proto/stage/build.mjs`（`kit/dist/`、`proto/stage/dist/` 的产物一起提交，`git status` 要干净）；`npm run check:stage` 过；`npm run e2e -- --only stage,stagestuck` 过。
- 自己拿 `tools/stage-try.mjs` 写一两幕真的演一遍（老师开希尔的一趟、学生做对几下、做错一下、做完），看截图和发给老师的那一条对不对；文件放 `tools/stage-try-examples/`，能当自检的加进 `tools/stage-try-selftest.mjs`。
- 检查从简：不用重放全部旧课（控制者最后统一跑）。但旧写法不许坏：没写 `sort=` 的一排格子行为要和以前一模一样。
- 碰到没写清的地方照原则自己定，记进 `docs/superpowers/specs/2026-11-10-stage-rollout-rulings.md`（新建，每条：定了什么、为什么、代价；照 `2026-11-08-stage-base-2-rulings.md` 的样子）。
- 测试过了就提交（可以分几次），提交说明中文，最后两行固定是：
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014f77bEv6dHb3CuP9CXQj8f
  不要 push，不要派子助手。临时文件放 `/tmp/claude-0/-home-user-Claude/86eb5d01-d579-517d-b19f-fa1d2f75338d/scratchpad/rollout-sort/`。

## 交回

报告写到 `/home/user/Claude/.superpowers/sdd/rollout/sort-report.md`（做了什么、每条新写法一行例子、测试结果、没做成的和为什么）。最后只回：状态（做完 / 做完但有顾虑 / 卡住）、提交号、测试一行、老师的新写法每条一行、顾虑。

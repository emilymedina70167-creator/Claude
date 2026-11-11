# 舞台上的一种东西怎么写（给做 C 段的开发）

舞台（`kit/src/stage/`，计划见 `docs/stage-plan.md`）上能放好几种东西：一排格子、树、图、矩阵、平面、句子、式子……
每一种是两个文件：

- `types/xxx.js`：数据和指令，不碰 DOM，配 `tests/stage-xxx.test.js`（`node --test`）。
- `types/xxx.view.js`：画法，只在浏览器里用。

注册各加一行：`types/index.js` 的 `TYPES`，`types/views.js` 的 `VIEWS`。

**照 `types/array.js` / `types/array.view.js` 写**：那是第一种，接口都在它身上。

## 数据那一半（`types/xxx.js` 导出一个对象）

| 字段 | 是什么 |
|---|---|
| `type` | 名字，和 `VIEWS` 的键一样 |
| `label` | 中文叫法（报错用：「树没有 swap」） |
| `create` | 造它的指令，比如 `['tree']`。一行 `tree t = …` 由 `scene.js` 交给 `make` |
| `make(scene, c, h, old)` | 造出来的数据（不含 `type` / `id`，scene 会加）。`h` 是 `scene.helpers(c)`：`words`、`str`、`strs`、`opts`、`args`、`arrow`、`partsIn(list)`、`refsIn`、`strayRefs`、`isColor`。<br>位置用 `scene.slotFor(宽)`：放在已有东西下面、居中。<br>写错就 `throw new Error('一句给老师看的话')`，要说清楚怎么写才对 |
| `parts(o)` | 全部部件（有顺序）。**每个部件是一个普通对象**，至少有：<br>`obj`（东西的 id）、`key`（在这样东西里唯一、不变）、`value` 或 `label`（话里的小块显示什么）；<br>共用的样子 `paint` / `glow` / `lift` / `dim` / `covered`（造的时候都写上 `null` / `false`） |
| `pick(o, mark, sel, word)` | 部件的写法 → 部件数组。`t.A`：mark 是 `'.'`、sel 是 `'A'`；`m.2,3`：sel 是 `'2,3'`。<br>写错就抛错，告诉老师这种东西的部件怎么写 |
| `ref(p)` | 跟着它走的写法（话里的小块、记录、给老师看的现状都用），比如 `t.A` |
| `partBox(o, p)` | 部件在世界坐标里的框 `{ x, y, w, h }`（像素） |
| `objectBox(o)` | 整样东西占的框（镜头对准它、新东西摆在它下面） |
| `obstacles(o)` | 贴字要让开的框（默认是每个部件的框） |
| `commands` | 自己的指令 `{ 名字: (scene, c, h) => 要点 }`。<br>改 `scene.objects.get(id)` 里的数据，返回画面要用的要点（比如 `{ a, b }`）；写错就抛错。<br>一行的第一个部件是哪种东西，`scene.js` 就交给哪种东西；只有一种东西有这个指令时，没写部件也交给它 |
| `options` | 认得的选项（`名字=值`）`{ 造它的指令或自己的指令: ['名字', /正则/] }`，没列的指令不带选项；造它的那一行另外都认 `hide=`；`'*'` 是那条指令自己查（`tex` 的 `retex … a2=a`）。<br>`scene.js` 的 `checkOptions` 照它查，不认得的当场报、给最像的那个（「hid=on」是不是 hide=on？）；重放旧课（`lenient`）不查。共用的指令在 `script.js` 的 `OPTIONS`。用了新的 `h.opts.xxx` 要在这里加上 |
| `onVar(scene, o, bind, v)` | 跟着拨数变的（`scene.binds` 里 `{ kind, obj, v }`），可选 |
| `describe(o, scene)` | 给老师看的现状（几行字）：值、颜色、亮没亮、扣没扣……要让老师照着它写下一轮 |
| `hint` | 部件写法的一句提示（舞台上有这种东西时给老师看一次） |
| `doc` | 说明书里的一节：怎么造、部件怎么写、自己的每个指令一行（照 `array.doc` 的格式：指令在前，两个以上空格后是说明） |
| `example` | 几行能照抄的例子（第一行造这样东西）：测试照抄来演，一行都不许错 |
| `drag` | 学生能不能拖（`ask drag`），能就是 `true`，view 里要有 `drag` |
| `summary(o)`（可选） | 现在的样子写成一句（「回到了……的样子」用：树写层序、一排格子写一串数）；没交的取 `describe` 的第一行 |
| `pageBits(o, scene)`（可选） | 现状里「页面算的」那一行多交的几句（树的 avl / bst）；量（规则文件的 `measures`）由场景自己算，不用写在这里 |

**场景上的新状态都要进 `clone()`**（`scene.js`）：裁判、`ask pick` 的比较、存档点 `keep` / `back`、试演都拿 clone 出来的舞台先演一遍，漏了的状态在那一份里是空的，判出来就不一样（底座第二轮每加一种状态都照这条做：`preRight`、存档点、收集的进度……）。

场景会对任何部件做共用的指令（`glow` `paint` `dim` `cover` `pulse` `link` `compare` `label` `fly` `ask tap`……），不用各写各的。

## 画面那一半（`types/xxx.view.js` 导出一个对象）

| 字段 | 是什么 |
|---|---|
| `sync(stage, o, ctx)` | 把这样东西的画面对齐到场景：<br>部件的节点用 `stage.partNode(p, () => 新建节点)` 取或造（节点放进 `stage.layer`，HTML 用 `transform: translate(x, y)` 摆，记 `n.__box = 框`）；<br>共用的样子交给 `stage.flagPart(n, p, ctx)`；<br>不属于部件的东西（虚框、序号、树的边、坐标轴、括号）用 `stage.decor(o.id, 名字, () => 新建)`，没了的用 `stage.dropDecor(o.id, 名字 => 要不要删)`。<br>**返回要挪的部件** `[{ part, node, from, to, order, duration }]`：舞台统一演（连线先藏后画），不要自己挪。<br>新出现的要等动画时，把 Promise 推进 `ctx.jobs` |
| `enter(stage, o)` | 刚造出来时怎么出场（照 array：一个一个落下来） |
| `choreo` | 自己指令的专门动作 `{ 名字: async (stage, c, fx, pre) => … }`（`fx` 是 commands 返回的要点，`pre.boxes` 是动之前每个部件的框）。<br>用 `stage.tween(节点, 关键帧, { duration, delay, easing })` 和 `stage.moveNode(部件, 关键帧, 目的框)`；动作曲线、弧线用 `motion.js`。<br>演完舞台会再 `sync` 一次，剩下的交给它 |
| `drag(stage, part, peers, done)` | 学生拖，返回解除监听的函数。拖完调 `done(act, 一行指令)`：舞台照这行指令改场景、记进 log（刷新、作废都照它放回），`act` 是告诉老师的 |
| `rail(o, p)` | 连线画成横线还是拱弧（可选） |
| `css` | 自己的样式（字符串）。**颜色只用变量**（`var(--st-ink)`、`var(--st-card)`、`var(--c)` 组色、`var(--st-brand)`……，见 `stage.css` 开头），白天晚上都要好看 |

线（树的边、坐标轴、矢量）画在 `stage.under`（格子下面那层 SVG）或 `stage.ink`（最上面那层）。
SVG 节点也可以当部件节点：`flagPart` 照样加 class，`pulse` 和翻牌动作对 SVG 跳过。

## 规矩

- **画面质量是这个引擎的全部意义**：动作要顺、要有含义（交换走弧线、插入时别的让开、旋转时子树跟着转），老师只写「做什么」，不写坐标和时长。
- iPad 为准：能点的东西至少 44px；字用 `var(--sans)`；不挡字（贴字由舞台的 `placeLabel` 找地方，`obstacles` 要给全）。
- 注释、报错的话、说明都用中文；说明里提到学生不用「他」「她」。
- 能写成纯函数的都放在数据那一半，测试要覆盖：造、部件的写法（对的、错的报什么）、每个指令改了什么、`describe`、`example` 照抄能演（`dryRun` 一行不错）。
- 在浏览器里看：
  1. `node proto/stage/build.mjs` 之后打开 `proto/stage/dist/local.html?dev&blank`，一块空舞台；
  2. 用 Playwright 在页面里调 `window.LAStage.play(\`…镜头指令…\`)`，iPad 竖屏 820×1180、横屏 1180×820，白天晚上都截图看；
  3. 学生的点、拖用鼠标事件模拟（`window.LAStage.nodes.get('t:A')` 是部件的节点）。
- 不要改舞台共用的文件（`stage.js` `scene.js` `script.js` `layout.js` `motion.js` `stage.css` `doc.js`）。真需要共用的东西缺了，在交回的报告里写清楚缺什么、为什么，由合并的人加。


## 活的舞台要的几样（E 段，可选）

| 字段 | 给谁用 |
|---|---|
| `affords: { 动作: '给老师看的一句' }`（数据模块） | `open 名字 动作` 能开放的动作；`drag: true` 的东西自动有 `drag` |
| `canOpen(scene, o, action)` | 开放之前再查一遍（乘积不能 edit），不行就抛错，错误的话给老师看 |
| `affords: { 动作(stage, o, e, done) }`（画法模块） | 挂上学生直接动的画面，返回收起的函数；学生动了一下调 `done(act, '学生的那一行指令')`（返回 Promise，舞台演完才 resolve） |
| `derive(scene, o)` | 跟着别的东西算出来的（乘积），每一行之后重算，交出变了的 `[{ part, before, after }]` |
| `measure(o)` | 挑战拿来整个比的：矩阵 `{ kind: 'matrix', rows }`、一排 `{ kind: 'list', values }` |
| `anchors(o)` | 排版时和谁是一体的（`reflow` 不拿它们比上下）：和 A、B 排成一行的乘积 |
| `docSetup` | 测试用的舞台（说明里某一行要的、例子里没有的，比如已经是阶梯形的矩阵） |



## 跟着算的量 `{式子}`（底座第 4 节，`kit/src/stage/value.js`）

老师在造东西的那一行（或格子里）写 `{k}`、`{A + B}`、`{A v}`，依赖一变场景当场重算。用了 `{…}` 的东西记着 `o.live`，学生不能 `open` 它。两种接法，挑一种：

| 字段 | 是什么 |
|---|---|
| `remake: true`（数据模块） | 最省事的一种（一排格子、树、图）：造它的那一行里的 `{…}` 先由场景算成数（`fillLine`），再交给 `make`；依赖变了，场景照新的数把这一行重新造一遍（名字、位置不变，连线只留部件还在的）。`o.live = { line, exprs, vals, deps }` 场景写，不用管 |
| `carry(old, o)`（配 `remake`） | 重新造出来的那一份 `o` 上补回老师后来做的（染色、旁边的数、访问号、拿掉的结点……），按部件的 key 从 `old` 抄过去。不交的话拨一下数，老师这几轮做的全没了 |
| `reshape: [指令名]`（配 `remake`） | 做了就不再跟着算的指令（一排格子的 swap / move / write、树的 insert / rotate……：照那一行重新造会把它们冲掉）。场景在这样的指令以后 `unlive`：去掉 `o.live`，舞台现状里写「已经不跟着 {k} 变了：你动过它的结构」。在原地改的（矩阵）自己的指令里叫 `scene.unlive(o, 那一行)` |
| 自己拆 `{…}` | 要在原地改的（矩阵改格、平面上的向量挪过去）：`make` / 指令里用 `h.parseLive(text)` 拆、`h.liveValue(src, { plane })` 算（得 `{ value, deps }`，value 是 `exact.js` 的 Q / 向量 / 矩阵），自己写 `o.live`（或部件上的 `it.live`）。`h.line` 是这一行的原文。写错、算不出来就抛错 |
| `depNodes(o)` | 依赖图里另外的结 `[{ id, deps, key?, live?, rec?, text? }]`：乘积跟着两个因子、平面上的线性组合跟着别的向量。`live: true` 的会被重算（叫 `relive`），别的只拿来排先后、查环 |
| `relive(scene, o, n)` | 重算一个结（整样东西的 `o.live`，或 `depNodes` 给的 `live` 结），在原地改，返回 `{ changed: [{ ref, from, to }], parts }`（parts 是画面闪的部件）。算不出来（不可逆、维数不对）就抛错：场景记下原因写给老师，原来的数不动 |
| `liveText(o)` | 舞台现状里「跟着算的」那一句怎么写（`S = {A + B}`、`M.1,2 = {k}`）；不交就写造它的那一行 |

变了什么由场景汇总进 `fx.derived`，`doc.js` 的 `derivedLines` 写成发给老师的「[跟着变的]」。

## 规则文件（`types/xxx.rules.js`，底座第 1～3 节，`kit/src/stage/rules.js` 定接口）

交了规则的东西，学生和老师在它上面的每一下都过裁判（`referee.js`）。纯函数，配 `tests/stage-xxx-rules.test.js`，在 `types/index.js` 里 `registerRules('xxx', xxxRules)`；没交的照旧能用，只是不判。**页面不做教学决定**：规则只算事实，怎么处理由老师写在 `open` 那一行（`wrong=` 默认 quiet）。

| 字段 | 是什么 |
|---|---|
| `next(o, scene)` | 从现在的样子算正确的下一步 `{ acts: [所有可接受的动作], why }`；`null` 是做完了（`@名字.done`、叫老师）。学生走偏以后也从现在的样子接着算。动作带 `free: true` 是学生做得了、页面不判对错的（一排格子做快排这类：只判到一趟） |
| `check(o, act, scene, { by, open })` | 判一下 `{ legal, right, misread, why, next }`：`legal: false` 是这个世界做不到（永远不演、弹回去）；`right: null` 是不判；`why` 写「这一下做了什么」（「50 右旋」），`next` 写「现在正确的是什么」；`misread` 是像哪种错，认不准就给 `null`，别给老师写错的事实。`open` 是学生这一下从哪一项 open 来的（树的 place 只看摆完是不是二叉排序树、insert 照托盘的先后），老师的一下是 `null` |
| `predicates` | 挑战用的判断式 `{ 名字: (o, args, scene) → true / false / null }`。老师写 `when="M rank=2"`，`goal.js` 拆成名字 `rank`、参数 `['2']`；参数写错抛错（话给老师看），还判不了给 `null` |
| `facts(before, after, act, scene)` | 学生这一下以后写给老师的几行事实（谁转上来了、哪一行变成什么）；`scene` 是这一下所在的舞台（`from=M0` 的矩阵要找 M0），只用前三个的照旧 |
| `measures`（可选） | 页面数得出的量 `{ 名字: (o, parts, scene) → 数 \| null \| undefined }`，写成 `count(t)`、`height(t.50)`、`rank(M)`：现状里写、挑战里比、答案里算、话里跟着变。`parts` 是写了部件时的部件，写整样东西是 `null`。`null` 是现在还数不了（矩阵还空着，之后会有）；`undefined` 是这样东西本来就没有这个量（不是方阵的 det）；这样东西本身数不了（句子没写 key）就抛错，话给老师看。函数上可以挂 `blank`（null 时说什么）、`none`（undefined 时补一句为什么） |
| `brief(o)`（可选） | 现在的要点一句（矩阵：「无穷多解（1 个自由变量）」）；跟着拨数算的东西，现状里把每个能拨到的值都算一遍（`scene.js` 的 `sweep`）。说不出是 `null` |
| `changed(before, after, fx)`（可选） | 这一下改了哪些部件的 key（`ask pick` 交了以后和真变了的比）：树是平衡因子、父亲、哪一边、第几层变了的结点，矩阵是数变了的格，句子是挪了的词；前后都在的才算。`fx` 是指令交的要点（句子的 `moved`）。没交的照部件的值比 |
| `reopen(o, scene)`（可选） | 现在就做完了的东西，学生开着的动作还能不能把它改回没做完（树开着删、摘）：能的话 `@名字.done` 照收、再做完时演 |

| `gestures` | 手势表 `{ 动作: { gesture, from, to, tap, on, toAct, ask?, pick?, choices? } }`。`gesture` 是 `tap` / `drop-on` / `drop-at` / `span` / `line` / `write` 之一或几种；`from`、`to`、`tap`、`on` 是画法里把手的名字；`toAct(o, { from, to, value, role }) → { act, src } \| { error }` 把手指的一下翻成一行学生指令；`ask(o, ctx)` 放下以后先问一个值（倍数框 `{ input: 'keypad', prompt, hint }`），`pick` + `choices(o)` 是拉好一段以后点的那一排；`live: true` 是跟着算的也能开（矩阵整张拖：数照旧由式子定），`makes` 是交的动作和名字不一样时交的是哪种（树的 place 交 insert，`events.js` 的 `hasWork` 拿它看学生做不做得了下一步；能写几种；不走手势表的 open（一排格子的 `open a`）交的是哪种写在规则的 `makes: { drag: ['swap'] }` 里）；`text` 是舞台现状里「学生能直接动的」那一句怎么说；`close: { on, toAct }` 是学生做的东西头上的 ✕（句子收括号、收线，`gestures.js` 的 `closeAct`）。按法照手势分三种（`PRESS_OF`：点、滑、按住再拖），同一处按法不一样的两项能一起开，一样的 `open` 当场报 |
| `actOf(o, c, h)` | 一行镜头指令 → `check` 认的动作，不判的指令给 `null`。学生、老师的每一行都照它过裁判（老师的照演不拦，错了下一轮告诉老师） |
| `judges` | 页面判对错的动作名：只有它们收 `wrong=` / `call=` / `@名字.right`，写在别的动作上当场报错 |
| `doneBy` | open 了这几个动作，`next` 走到 `null` 才算「学生做完了」 |
| `slipRefs(o, act)`（可选） | `wrong=mark` 时那一行没写部件（`rowop M r3 - 2r1`），淡淡圈哪儿 |
| `standard(o)`（可选） | 借 `kit/src/engines/` 的引擎跑出整段标准过程和常见错法，测试拿来和 `next` 对拍 |

画法那一半交 `grips: { 名字: (stage, o, e, { role }) → [把手] }`（名字和手势表里的 `from` / `to` / `tap` / `on` / `close.on` 对上；`role` 是 `'from'`（拿起来、点的地方）或 `'to'`（落点：落点不跟着 `open` 写的部件走，矩阵整张拖的落点是舞台上别的矩阵）。整样东西当把手叫 `whole`：`part()` 交 `{ obj, whole: true }`，按住整张拖到另一样上，落点亮起来、放下以后飞进去或者弹回去，`compare` / `put` / `merge` 都走它），每个把手 `{ key, part(), node(), box(), rect?, area?, light?, show?, lift?, land?, cls?, consumed? }`：`part()` 是交给 `toAct` 的那一样（部件，或者 `{ row: 3 }`、`{ slot: { parent, side } }`、`{ gap: { after } }` 这种自己认的写法）；`rect()` 是按的屏幕框（小的把手用 `atLeast(…, 44)`），`land(L, r, 落点)` 是放下以后拎着的那一份怎么走（弹回去、飞进去）。可选 `gestureHint(stage, o, e, r)`（悬在落点上先说会怎样）、`spanPreview(stage, o, e)`（拉一段时画什么）。接手指、跟着手动、弹回去、键盘、从钩拉线、✕ 都在 `gesturedom.js`，画法不挂监听；同一处几种按法（点、滑、按住 0.35 秒再拖）由 `pointer.js` 照 `choosePress` 分，画法不用管。要学生看得见的把手（句子的钩、✕）在 `sync` 里照 `stage.scene.opens` 画成 `decor`（和矩阵行变换的把手一样）。`open` 的分派：`drag` 走 `dragSpec`；`affords` 里有、没写 `input=` 的走画法自己的；别的走手势表。

说明（`doc`）里每个手势动作写一行 `open 名字 动作 …  学生怎么动 = 翻成哪一行`，判断式写一行 `判断式（when=）：…`：`tests/stage-doc.test.js` 照规则查，漏了就红。

一排格子的规则（`types/array.rules.js`，排序）是第四份，照它看「规则借黑板那边的引擎」怎么写：排序本身都在 `types/array.sort.js`（每一趟的结果、常见错法让 `engines/sort.js` 跑，不另写一份），老师用 `sort a shell d=5` 写明在做哪种排序（记在 `o.sort`），没写明时页面不猜、只判这个世界做不做得到。做的时候定的事在 `docs/superpowers/specs/2026-11-10-stage-rollout-rulings.md`。
## 拖和点、排版（2026-11-06 以后的约定）

- **拖**：画法写 `dragSpec(stage, part, peers)`，返回 `{ rect?(), start(w), move(w), drop(w) → { act, src } | null, cancel() }`（`w` 是世界坐标）。手指的事（挑按到哪个、抓住手指、浏览器取消、镜头和老师的行等手指松开）都在 `pointer.js`，画法不要自己挂 pointer 监听。部件、节点按 key 现取（`stage.scene.partOf(id, key)`、`stage.nodes.get(`${id}:${key}`)`）：拖之前舞台可能刚重放过。
- **点**：`stage.armTap(part, fn)`（正在等的那一问）、`stage.armPress(pid, fn, { cls })`（开放给学生直接动的），也走 `pointer.js`。
- **大小**：`objectBox` 尽量算准，算不准的舞台会量（每个节点 `data-obj` 由 `partNode` / `decor` 自动打上，`measure` 量出来多出去的写回 `o.ext`）。能量的就量了写回场景（题卡 `l.mh`），调 `stage.relayout()`。**存在东西上的位置都要相对它自己的 origin**（乘积的 `band` 就因为存了绝对位置，挪了以后占的地方被拉长）。
- **装饰跟着东西走**：底卡、括号这类 `decor` 的位置每次 `sync` 都要按现在的框重摆，不能只在造出来时摆一次。
- 改完跑 `npm run check:stage`（排版检查 + 手指检查）。

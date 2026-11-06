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
| `onVar(scene, o, bind, v)` | 跟着拨数变的（`scene.binds` 里 `{ kind, obj, v }`），可选 |
| `describe(o, scene)` | 给老师看的现状（几行字）：值、颜色、亮没亮、扣没扣……要让老师照着它写下一轮 |
| `hint` | 部件写法的一句提示（舞台上有这种东西时给老师看一次） |
| `doc` | 说明书里的一节：怎么造、部件怎么写、自己的每个指令一行（照 `array.doc` 的格式：指令在前，两个以上空格后是说明） |
| `example` | 几行能照抄的例子（第一行造这样东西）：测试照抄来演，一行都不许错 |
| `drag` | 学生能不能拖（`ask drag`），能就是 `true`，view 里要有 `drag` |

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

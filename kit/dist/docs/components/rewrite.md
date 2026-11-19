### rewrite：英语的检验题（块里的 parse、translate、discriminate、errfind 也在这一节）

只在 `board check`（第五节）里能作答：parse 标成分、translate 翻译、rewrite 改写、discriminate 二选一配理由、errfind 改错；字段在完整写法里。

外壳、共用的字段（`id` `q` `target` `level` `facet` `teach` `retry` `family`）和数学的检验题（`recall` 那一节）一样；必做题至少 2 道 retry、至少 1 条 teach。英语题不做模板（不写 `pick`）。不写 `facet` 时：parse、translate、rewrite 能用，discriminate 能辨，errfind 边界，recall 重建。

各题型：

- **parse**（标成分）：`key:` 括号写法同第三节 `parse`（`[S …] [V …]`，能套 `[RC …]`），可选 `roles:`（不写照 key 里用到的）。不写 `must` / `may` / `wrong`。我点词标成分，页面照 key 逐个成分判（宽严同一类 `parse`）：一个成分一项，按句子先后，编号是成分名（同一种的第二个是 `RC2`）；话是「这是主语，标成了宾语」「没标出谓语」「谓语的范围不对：标了「were」」；多标的合成一项 `extra`（「多标了：…」）。teach 键：成分名（`V`；`RC2` 找不到退回 `RC`）→ `role=SC` → `default`。
- **translate**（翻译）：`text:` 原句、`must` 采分点（最多 3 条）、可选 `may` `wrong`、`answer:` 参考译文（判完给我看）。页面里的 Claude 照采分点判；我打字或手写。
- **rewrite**（改写）：`text:` 原句；`has: 片段 => 话`（要有的写法，一行一条，h1、h2…）、`not: 片段 => 话`（不该有的，n1…），`=> 话` 可选；`example:`（必填：一句对的改写，页面先拿它验 has / not）；可选 `must`（规则本身，交页面里的 Claude）。至少一条 `has:`；只写 `not:` 时要写 `must`（不然随便一句没有那些字的都算过）。
  - 片段按整词比：大小写、弯引号、缩写（`wasn't` 就是 `was not`）、句末标点、多的空格都不算；`|` 隔开几种写法；贴着字母的 `…`（`…ed`）是一个以 ed 结尾的词，单独的 `…` 是中间隔 0～3 个词；`were …ed` 中间留空格（`were…ed` 是一个词）。`has: is` 不会对上 this。
  - has / not 有一条没过就没过、不交 Claude；都过了、写了 `must` 再交。teach 键 `h1`、`n1`、`default`。
- **discriminate**（两个里选一个）：`options: 谓语 | 非谓语`（只收两个）、`answer:`（两个里的一个）、`must` 理由要点（必填）；不和 `can:` 一起写，不写 `result:`。我点一个、写为什么。选错就没过（理由不判）；选对了理由交页面里的 Claude；选对、理由没过 = 没过。teach 键 `pick`（选错）、`m1`、`default`。
- **errfind**（改错）：`text:` 句子、`word:` 错的那个词（同一个词出现几次：`are#2` 是第二个 are）、`fix:` 改成什么（`known | !knew=为什么`：`|` 隔开几种对的，`!` 开头是常见的错改法和提示；`删掉` 是这个词多了）、可选 `decoys:`（常被误点的对的词：`have=为什么没错; were=…`）、可选 `must`（为什么错，交页面里的 Claude）。我点一个词、写改成什么。点错词：`word` 没过（点的是 decoys 里的显示那句）；词对了再判改法 `fix`（大小写、句末标点、外面的引号不算；写成 `!` 的错改法显示那句提示）。teach 键 `decoy=have`、`word`、`fix`、`default`。
- **recall**：同数学（`must` `may` `wrong` `answer`）。

下面是一个能照抄的 `board check`（第五节）：p1 是必做题，带两道 retry；别的写成可选题只为例子短。

`````
````board check id=ken title="被动语态" limit=15m
block EN-L1.2.3 must=p1 optional=p2,p3,p4,p5
```errfind
id: p1
q: 点出用错的那个词，再写改成什么
text: He was know as the best teacher in the town.
word: know
fix: known | !knew=knew 是过去式，被动要过去分词
decoys: was=被动的 be 没错，错在它后面的动词
target: 被动的过去分词
level: 基础
teach word: 被动是 be + 过去分词：be 后面的动词原形是错的。
teach fix: know 的过去分词是 known，不是 knew。
teach decoy=was: was 没错，错在 was 后面那个词。
retry: p1a, p1b
```
```errfind
id: p1a
q: 点出用错的那个词，再写改成什么
text: The letter was write in English.
word: write
fix: written | !wrote=wrote 是过去式，被动要过去分词
target: 被动的过去分词
level: 基础
```
```errfind
id: p1b
q: 点出用错的那个词，再写改成什么
text: The windows were break by the storm.
word: break
fix: broken | !broke=broke 是过去式，被动要过去分词
target: 被动的过去分词
level: 基础
```
```parse
id: p2
q: 标出这句的主语和谓语（谓语连着助动词一起标），从句也标出来
key: [S The houses [RC that we saw]] [V were painted] in 1990.
roles: S V RC
target: 被动语态的谓语
level: 方法
teach V: 被动的谓语是 be + 过去分词，几个词一起标成谓语。
teach RC: that we saw 修饰 houses，是主语里的定语从句。
teach default: 先找谓语动词（带上前面的 be），再往前找主语。
```
```rewrite
id: p3
q: 把这句改成被动语态，时态不变
text: The villagers built the bridge in 1990.
has: was …ed | was built => 时态要和原句一样：be 的过去式 + 过去分词
not: built the bridge => 还留着主动的谓语
example: The bridge was built by the villagers in 1990.
must m1: be 的时态跟原句（一般过去时用 was / were）+ 过去分词
target: 主动改被动
level: 方法
teach h1: 原句是一般过去时，被动写成 was / were + 过去分词。
```
```discriminate
id: p4
q: “The data collected last year show a clear trend.” 里 collected 是谓语还是非谓语？为什么？
options: 谓语 | 非谓语
answer: 非谓语
must m1: 句子的谓语是 show；collected 是过去分词作后置定语（= which were collected）
target: 过去分词作定语
level: 核心
teach pick: 一句话一个谓语：先找真正的谓语，剩下的 -ed 是定语。
```
```translate
id: p5
q: 翻译成中文
text: It is not until you lose your health that you realize how important it is.
must m1: 「直到……才……」的强调句译出来
must m2: how important it is 译成「它有多重要」
wrong w1: 译成「直到你失去健康，你意识到……」（没有「才」）
answer: 直到失去健康，你才意识到它有多重要。
target: 强调句没译出「才」
level: 核心
```
````
`````

# 黑板组件 stage：在一段里嵌一块舞台

黑板上的一段写成一个 ````stage```` 围栏（board add / new / replace 的段里照写），页面在这一段里嵌一块舞台，照里面的镜头指令一行一行演。学生在舞台上点、拖、拨、填，页面当场算、当场判，演写好的预写；这一块里没有页面的老师。

```stage
id: s1
title: 先排两个
array a = 49 38 65 97 76
open a move
goal g1 "把小的拖到前面" when="a.1 < a.2"
@g1 say "对。"
```

开头几行是字段（都能不写），从第一行不是字段的起往下全是镜头指令：
- `id:` 这一块的名字（作答、动作按它记；同一节课里不重复）
- `title:` 写在舞台上方的一行字
- `prewrite: all` 预写也收「没做到」「走偏」（`@名字.wrong`、`@名字.miss`、`@ask.wrong`，见「预写」）；不写时只收做到了、做对一步、答对、做完了。整节课开着时（课堂设了 session.extPrewrite）每一段都收
- `height:` 舞台多高（像素，240～900，默认 420）；东西多了镜头整块缩小，放得下就不缩

页面会怎么做：
- 写错的行不演、别的行照演；每一行错在哪（这一段的第几行、原文、为什么）报成这一段的写法错误
- 学生做的每一下、挑战做到 / 没做到、答了等着的那一问都记下来（见「页面记下的事」）；这块舞台现在什么样，见「舞台现在」
- 刷新、这一段重画时从头演（学生动过的样子不放回）

## 共用的指令（一行一个动作，页面一行一行演；行首写 & 就和上一行一起演）
部件的写法：名字（整个）、名字.部件（每种东西自己的写法，见各节）
颜色：g1 蓝、g2 粉、g3 绿、g4 金、g5 紫、g6 橙
跟着算的 {式子}：引号外面的 {…} 由页面现算（格子里的数、矩阵、向量、边权、answer=）。能用拨数 k、矩阵 A、一格 A.1,2、平面上的 p.u，能写 + -、乘（A v、2A）、A^-1、A'、det(A)。依赖一变页面当场重算；学生动不了它；算不出来停在上一次的数。引号里（say、label、题卡）的 {a.3}、{d} 是话里的小块
量：页面数的数，写成 名字(东西或部件)（每种东西有哪几个见它那一节）。舞台现在里都写出来；能写进 when=、answer={…}，话和贴的字里写 say "秩是 {rank(m)}" 画成现在的数、跟着变；数不了时挑战写「判不了」、字画「?」

说话（在舞台上方一个字一个字写出来）：
say "从 {a.1} 往后数 5 个，落在 {a.6}。"  {a.1} 画成那个部件的小块（扣着的不露值）；{d} 是拨的数的值；$d$ 是斜体字母（不排公式）

对任何部件都能做：
glow a.1 a.8 / unglow a.1 a.8  点亮
lift a.2 / drop a.2  抬起 / 放下
pulse a.3  闪一下
paint a.1 a.6 g1 / unpaint a.1  染色
dim a.1-5 / undim a.1-5  灰掉
cover a / uncover a.6  扣过去看不见值 / 翻开一个
link a.1 a.6 g1 / unlink a  连一道弧 / 收掉连着 a 的线
compare a.3 a.8  两个比大小；两张矩阵整张逐格比
remove a  拿下舞台
scene "第二幕" keep=a  上一幕整块收起，keep= 带过来
hide a / show a  藏起来（照样算、现状照写，学生看不见）/ 摆出来；造的时候写 hide=on 就先藏着（藏着的一排能当挑战里比的答案）

贴在图上的字：
label t a#1 a#8 "一样大，先后却换了" side=below tone=note  side：above / below / left / right；tone：note 小字、key 重点、soft 淡
retext t "新的字" / unlabel t / unlabel  改字 / 拿掉一张 / 全拿掉

能拨的数：
dial d = 5 range=1-5 at=a  学生拨它；写进 {式子} 里驱动任何量
dial t = 现在 options="过去 现在 将来"  拨词的拨盘：{t} 写现在的词，when="t = 将来"
{t: 做过了 | 正在做 | 还没做}  照拨盘挑一段（贴的字、题卡、挑战的字跟着变）
set d 5  页面替学生拨到 5
camera a.1-7 / camera all  镜头凑近 / 看全部；wait 600  停 600 毫秒

舞台课整屏构图用的几种（place、arrange、preview、look、scale、draw）在这块舞台里写了不报错，东西照摆新东西的规矩自己排、镜头整块缩放，画面不一定照这几行办。

## 交给学生动、挑战
open a  交给学生直接动（每种东西能 open 的动作、学生怎么动、翻成哪一行，见各节）；close a 收回（close a 动作：只收那一种）
同一处按法不一样的（点、滑、按住再拖）能一起开；按法一样的第二项当场报错
页面判对错的动作（树的 rotate insert place、矩阵的 rowop、句子的 mark refer）在 open 那一行写：wrong=quiet 执行、只记下（默认）/ wrong=mark 执行、淡淡圈一下 / wrong=block 不让做、弹回去；call=wrong 一走偏就记一条 stage-call / call=done 做完马上记
做不到的一下（这个世界的规矩不让：式子换了以后不相等、不是同类项、空格子拖不动）弹回去，舞台上浮出一句为什么
undo=on（哪种 open 都能写）：右上角「撤一步」，学生撤回自己的上一下
keep a "换之前" / back a "换之前" / open a back="换之前"  存下样子 / 回到那一刻 / 学生那边一个「回到换之前」按钮
goal g1 "把 {a} 拖成从小到大" when="a sorted"  挑战（左上角一条）；写下就已经成立的不收；做到过就一直算
when= 两边写数、部件、东西的名字、拨数、量、O（零矩阵）、I（单位矩阵）、{式子}，部件比部件也行（a.5 = k.1，k 可以是藏着的一排答案）；比较 = != < <= > >=；a sorted（desc 从大到小）；每种东西自己的判断式写「名字 判断式 [参数]」（见各节）；逗号连着的都要成立，| 隔开的有一组成立就算
挑战后面还能写：call=now 做到就马上记一条 stage-call（不写是学生手上还有事就先攒着）；on="排好了" 学生按这个按钮才判（按了没做到也记下）；collect=a n=3 收齐几种不一样的
watch w1 when="a.1 = 13"  只记事的条件：成立时记一条 stage-call；学生看不到
ungoal g1  拿掉挑战

## 预写（学生做到某件事的那一刻页面马上演的行）
@g1 say "排好了！"  学生做到 g1 的那一刻演：一句话、下一个挑战、一个 ask 都行；写过的一直留着到做到为止；@g1 里出的 goal g2 能接着写 @g2，最多三层
@t.done / @t.right  t 做完了（页面算出没有下一步）/ 学生在 t 上做对一步（页面判对错的动作）时演，只演一次
@ask.right say "对。"  写在最后那个 ask 前面：学生答对它时演；那一问要页面判得了对错（tap、pick 写了 expect=，value 写了 answer=）
开了 prewrite: all 还收这几种（都只演一次；挑战做到了，它的 .wrong / .miss 拿掉）：
@g1.wrong say "…"  学生按了 g1 的按钮、判成没做到时演（g1 要写 on="按钮上的字"）
@g1.miss say "…"  g1 还没做到时学生走偏一下（裁判看出像哪种错法、这一下被弹回）时演
@t.wrong say "…"  学生在 t 上做错一步时演（页面判对错的动作）
@t.miss say "…"  学生在 t 上走偏时演：裁判看出像哪种错法、做不到的一下被弹回（没写 .miss 时，像错法的那一下演 .wrong）
@ask.wrong say "…"  写在最后那个 ask 前面：学生答错它时演
预写的行写下时就在现在的舞台上试一遍：演不了的写不进去（报成写法错误）

## 等学生（一段最多挂一问，写在最后；也可以不写 ask，以一个还没做到的挑战结尾）
ask tap a "那 {a.2} 和谁一组？" expect=a.7  学生点一个（写 a 是哪一个都能点）；expect= 是预期的那一个，页面判点对没点对
ask pick a "哪几格会动？" button="猜好了" expect="a.2 a.6"  学生点几个、按按钮交，页面比多点、漏点（order=on 连先后一起比；reveal=on 之后变了的圈变实线）
ask drag a#1 a#6 "把小的拖到前面"  学生拖
ask next "拨一下 $d$，看出规律点下面" button="看出来了"  学生看完点按钮
ask say "你觉得为什么？"  学生写一句话
ask value "一共比较了几次？" answer=4  学生填一个答案，页面当场判；type= 选判法：num 数、formula 含 n 的式子（加 free=n）、matrix 矩阵（1 2 / 0 1）、set 数集、equation 方程、seq 序列、en 英文；answer={式子} 照舞台现算；wrong="错答=说明"（几条用 ; 隔开）只进记录，学生只看到对不对

## 舞台上能放的东西
一排格子（排序、查找、哈希）：
array a = 49 38 65 97 76 13 27 49′ 55 04  造一排格子（最多 16 格；同一名字再造就换掉）
写法：a 整排；a.3 现在第 3 格；a.2-5 第 2 到 5 格；a#8 一开始在第 8 格的那一个（交换、插入以后跟着它走）
hop a.1 -> a.6 color=g1 label="隔 5 个"  小点一格一格跳过去、数着跳了几下，留一道弧
swap a.1 a.6  交换（走弧线）
move a#6 -> a.2  插入：挪到第 2 格，中间的各让一格
write a.3 99  改一格的值
ptr mid a.5 / unptr mid  格子下面的指针（同名的再写就挪过去）
group a stride=5  按「隔 5 个」分组：每组染色、连起来（stride 可以写拨的数的名字，学生一拨就重新分）
split a / merge a  每组下到自己的一排 / 合回一排
ask drag a#1 a#6 "把小的拖到前面"  学生按住一格拖到同一排另一格上，两格交换（页面执行，再告诉你）
array h = _ 49 38  _ 是空格子（write h.2 _ 空出来）
open a move  学生按住一张拖：到另一张上 = swap a#6 a#1，两张之间 = move a#6 -> a.2（插进去）
open a edit  学生点一格键盘写数 = write a.3 26（只开几格 open a.1-2 edit）
量：inversions(a) 前大后小几对（a.2-5 只数这段）、blank(a) 空几格；这两项页面不判对错，只告诉你做了什么、几对变几对

树（二叉树遍历、二叉排序树、平衡二叉树、堆）：
tree t = 50 30 70 20 40 _ 80  按层序造（_ 是空，空的下面不用再写；最多 31 个结点）
写法：t.40 值是 40 的结点；t#3 层序第 3 个（跟着结点走：值重复、换过值以后用）；t.30* 30 和它整棵子树
insert t 35  二叉排序树插入：从根一路比下去，在空位长出来
insert t.80 left 75  直接长在 80 的左边（right 右边）
append t 15  接在层序最后（堆的插入）
delete t.30  删掉（叶子直接拿掉；一个孩子就顶上来；两个孩子用中序后继顶上，by=pred 用前驱）
search t 40  二叉排序树查找：从根比下去，找到亮一下，找不到落在空位
swap t.20 t.40  两个结点换值（堆的调整）；write t.20 25 改值
rotate t.50 right  右旋（left 左旋）；也能写 LL / RR / LR / RL（t.50 是最小不平衡子树的根）
walk t.50 t.30 t.40  一个圈沿着树枝走过这几个（查找路径）
visit t.50 t.30 / unvisit t  按顺序编访问号（遍历一步一步来）
traverse t in upto=3  整趟遍历：pre / in / post / level，upto 走到第几个停（不写走完）
tag t.50 "h=3" / untag t  结点左上角写个小字（最多 8 个字）
bf t / unbf t  每个结点右上角标平衡因子（跟着树变；舞台现状里写出失衡的是谁、哪一型）
heights t / unheights t  每个结点右下角标子树高（跟着树变；和 tag、bf 一起开着不挡）
ask drag t "把它往上换"  学生把一个结点的值拖到另一个结点上，两个换值（页面执行，再告诉你）
tree t = 50 30 70 tray="20 40 80"  带托盘：待插的数按顺序摆在树下面，插进去一个拿掉一个
tree h = 90 80 70 layout=compact  排法造的时候定：二叉排序树照中序一个结点一列，别的（堆……）紧凑排；layout=inorder / compact 自己定（堆从一两个结点长起来也写 layout=compact）
扣着的结点（cover t.40）话里的小块分不出是哪一个：要学生指着它，用 ask pick 或者说位置
学生自己转、自己插（页面判每一下）：
open t rotate wrong=mark undo=on  学生把一个结点拖到它的父亲上 = 在父亲那里转（左孩子拖上去 = rotate t#1 right）
open t insert  学生把托盘里的数拖进树 = insert t 47（页面从根比下去）
open t place  学生把托盘里的数拖到一个空位 = insert t#2 right 47（学生自己摆，不管托盘先后：摆完还是二叉排序树就对；和 insert 一次开一种）
open t pluck  学生点一片叶子 = delete t#4（点里面的结点：只能摘叶子）
open t delete  学生点哪个删哪个 = delete t.30（照上面 delete 的删法）
@t.done say "插完了，也平了。"  t 做完了马上演（做完 = 平衡了、托盘插完了；只开 insert / place 的是托盘插完了）
判断式（goal 的 when=）：t avl（平衡了）、t bst（还是二叉排序树）、t height=4（有几层）；量：count(t) 结点数、height(t) 层数（写 t.50 是以它为根的那棵子树）、tray(t) 托盘还剩几个

图（BFS / DFS、最小生成树、最短路、拓扑排序）：
graph g = A-B:4 A-C:2 B-C:1 B-D:5 C-D:8 D-E:3  造一张无向图（:4 是权，可以不写，也能写 {式子}：A-B:{k}；有向写 A>B；单独的结点写 E；最多 16 个；自动排好）
graph h = A-B B-C A-C pos="A=0,0 B=2,0 C=1,1"  自己给坐标（每个结点都给，一个单位约一条边长，y 往下）
写法：g.A 结点；g.A~B 边（paint、glow、dim 对边也行：Kruskal 选进来的染色、成环的灰掉）；g.nodes 全部结点；g.edges 全部边
tag g.A 0 / tag g ∞ / untag g  结点旁边写个数（dist、lowcost……，最多 8 个字），改了会换一下
relax g.A -> g.B  松弛：A 的数 + 边权 比 B 的小就改成它（小点带着数沿边过去）；只认数，先 tag g ∞ 再 tag g.A 0（写 ? 会报不是数）
visit g.A g.C / unvisit g  编访问号（和上一个访问的有边，圈就沿边走过去）
walk g.A g.B g.D  一个圈沿着边走过这几个（要相邻）
take g.A  拓扑排序：拿掉 A 和它的边，A 排到下面的序列里
deg g / undeg g  每个结点旁边标入度（无向图是度），拿掉结点跟着变
choose g.A~B / unchoose g.A~B / unchoose g  把边选进来（粗金线）/ 拿掉 / 全拿掉
open g choose  学生点一条边 = choose g.A~B（选着的再点 = unchoose g.A~B）；不判对错，每一下告诉你选了几条、总权、连成几块、成没成圈
open g visit  学生点结点 = visit g.A
open g tag  学生点结点键盘写数 = tag g.A 5（有 ∞ 键）；visit、tag 一次开一项
判断式（when=）：g tree（选的边正好是生成树）、g cyclic（有圈）、g connected（连成一块；有向图都不看箭头）；量：chosen(g) 选了几条、weight(g) 总权、pieces(g) 几块、visited(g) 访问了几个

矩阵（线代：行变换、消元、秩、乘法）：
matrix m = 1 2 3 / 4 5 6 / 7 8 10  造矩阵（/ 分行，最多 6 行 8 列；数能写 -3、1/2；| 是增广矩阵的竖线；beside=p 放在 p 右边）
写法：m.2,3 第 2 行第 3 列；m.r2 第 2 行；m.c3 第 3 列
每张矩阵左上角画着它的名字（跟着算的写式子：JX、Jᵏ、R = ab），话里说的 X 学生找得到；name="α" 换一个，name=off 不画
matrix M1 = _ _ | _ / _ _ | _ from=M0 vars="x y"  _ 是空格子（填满以前判断式、量都判不了；跟着它算的 {A M1} 照样挂得上，跟着空格子变的格空着、填上了跟着算）；from=M0：学生每写满一行（配 open M1 edit input=keypad），页面和 M0 比（像哪一步行变换、哪一格不对、同不同解；不判对错）；vars= 未知数的名字（增广矩阵每行在现状里读回成方程，不写是 x1 x2…）
matrix N = 1 {k} / 0 1  格里的 {…} 写算成一个数的式子（{k}、{A.1,2}、{l - 1}），跟着它变；整张就算跟着算的，学生拨不了，只能 open compare / put / merge
matrix S = {A + B}  整个矩阵跟着算（{A B}、{2A}、{k A}、{A^-1}、{A'}；coef(M) 是增广矩阵竖线左边、rhs(M) 右边一列：{coef(M) P - rhs(M)}）；跟着算的学生拨不了，只能 open compare / put / merge
matrix Sum = collect  收集用的（collect - 是第一张减后面的）：空着是一个空格，put AB Sum 放进一张（学生拖、你写都行）就跟着算 {AA + AB}
rowop m r2 - 3r1  行变换：r1 的副本乘 -3 飘到 r2 上加进去（也能写 r2 = r2 - 3r1、r3 + 1/2 r1；连着几步用逗号：r2 - 4r1, r3 - 7r1）
rowop m r1 <-> r3  交换两行（走弧线）
rowop m 3r2  一行乘倍数（-r1、r2 / 3）；列变换把 r 换成 c
write m.2,3 5  改一个数
pivot m.1,1 / unpivot m  主元框起来
stairs m / unstairs m  画阶梯线（已经是阶梯形才行），全零行淡下去
product C = A B  A、B 排成一行，后面「= C」（C 先空着；再写 product C = B A 就在原处换槽翻成 BA）
mul C.1,2  A 的第 1 行、B 的第 2 列一起亮，逐对相乘再相加，写进 C.1,2（mul C 一格格全算）；算出来的格以后跟着 A、B 自动重算
open B edit range=-3..3  学生点 B 的一格用 ± 拨里面的数（AB、BA 当场跟着变）
open C explain  学生点乘积的一格，页面当场演它怎么一行乘一列算出来（还空着的就当场算上）
open AB compare  学生把 AB 整张拖到另一张上 = compare AB BA（逐格比，两张都不变）
open AB put  学生把 AB 拖进收集用的 Sum = put AB Sum（大小不一样放不进去）
open X merge  学生把 X 拖到 Y 上并同类项 = merge X Y（只认 数 × 同一个矩阵：{-2 A} 并 {-A} 成 {-3 A}，X 拿下舞台，撤不了、不写 undo=on；并成 0 是 O）；三种都不判对错，同一张只开一种；学生按整张哪儿都拎得起来（格上开着 edit 时按括号）
学生自己消元（rowop 页面判每一下；乘积不能 open rowop）：
open m rowop wrong=mark call=wrong  学生把一行左边的把手拖到另一行上 = 倍加（弹倍数框写 -3：rowop m r2 - 3r1）；拖到行号上 = 对调（rowop m r1 <-> r2）；点行号 = 倍乘（rowop m (-1/2)r1）
open m edit input=keypad  学生点一格用数字键盘写（能写 -3/2；写了 range= 才限范围）= write m.2,3 -3/2（页面不判，告诉你的就是这一行；空格子 _ 都写满了算做完，学生手上没事了就叫你）
判断式（when=）：m stairs（阶梯形）、m rref（行最简形）、m rank=2（整张的秩，增广的是 r(A | b)）、m rankA=2（竖线左边的秩 r(A)）、m same B（和 B 行等价）；量：rank(m)、rankA(m)、free(m)（自由变量几个）、det(m)（方阵）；现状里还写解的样子，跟着拨数的把每个能拨的值扫一遍
做完了 = 成了阶梯形（@m.done 这时演）；往上化成行最简形页面不判对错，要的话写 goal … when="m rref"
ask value "A² 是？" type=matrix answer={A^2} wrong="1 1 / 1 1=逐格平方了"  学生按格写一张矩阵（1/3 是一格分数），页面照 A 现算答案；grid=off 不给格子、学生自己写「1 2 / 3 4」（格子会露出答案的形状：想看会不会写成一个数时关掉）
ask value "Aⁿ 是？" type=matrix free=n answer="1 n n(n-1)/2 / 0 1 n / 0 0 1"  每格是含 n 的式子：学生一格一个式子框，页面逐格代 n 判，哪一格不对告诉你（学生只看到整张对不对）；一列（一行）的通解加 solve=on（free=k solve=on answer="-2+4k / 1-k / k"）按集合判：换了参数、特解的同一条线也对
answer={A B}、{A^2}、{3 A}、{A^-1}、{A'} 时页面自己认乘反、逐格乘方、只乘一行或一格、逐格取倒数或没除以行列式、没转置，对上了告诉你（你写的 wrong= 先比）

平面（向量、线性组合、张成、线性变换、特征向量）：
plane p range=-4..4  造坐标平面（网格、坐标轴，y 朝上）
写法：p.u 向量 u（从原点出发的箭头）；p.P 点 P
vec p u = 2 1 color=g1  加向量；再写一次就滑到新坐标
vec p w = 2u - v  线性组合（u、v 变了它跟着变；系数能写拨的数：vec p w = k u）
vec p w = {A v}  跟着算：矩阵 A 乘 v（A、v 一变 w 跟着变；学生拖不动 w）
point p Q = {d} {k}  两个坐标各写一个式子（拨数一拨点跟着走）
point p P = 2 3  加一个点
sum p w = u + v  首尾相接画出和（平行四边形法则）
span p u / span p u v / unspan p  淡淡涂上张成的直线或整个平面（写 stay 就钉住这时的样子，能钉几条）
transform p A  线性变换：网格和向量一起平滑地变过去（A 是舞台上的 2×2 矩阵，也能直接写 transform p = 1 1 / 0 1；再写是接着变）
untransform p  退回原样
unvec p u  拿掉向量或点
ask drag p.u "…"  学生拖向量末端（落在格点上），页面执行，告诉你新坐标

句子（英语长难句：先找谓语，再分主干、从句、非谓语、插入语，按意群断开）：
sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] [P a doctor]."  造一句（标点贴着前一个词，长了自动折行；句子里有 " 就用「」括起来）；key= 是正确拆法：照抄句子，加 [成分 词…]（成分写缩写 S V O P A Attr RC NF……），学生拉的括号页面照它判（key 没拉的段不判），不写不判
写法：s.3 现在第 3 个词；s.2-5 第 2 到 5 个；s.who 这个词（出现几次写 s.that:2）；s.who-door 从 who 到 door；s#3 一开始第 3 个的那个词（挪了、改写了跟着走）
mark s.1-6 主语 / unmark s.1-6  词下面一道括号、下面写成分（套着的一层层往下排；颜色按成分，也能写 g1～g6）
tag s.7 V / untag s.7  词上面的小标签（S、V、谓语1；最多 8 个字）
tally s V / untally s  学生拉的每道括号上标出里面 key 的谓语几个，句尾标括号外的几个（V 换成别的成分就数那一种；只写整句）
fold s.3-6 / unfold s.3  折成一个小方块只留主干（别的词滑过去补位；方块上写这一段的成分，也能 fold s.3-6 "从句"；套着折的 unfold 先展开外层）
move s.3 after s.5  挪到别处讲倒装、还原语序（也能 before s.1、-> s.1），别的词让开
cut s.6 / uncut s  第 6 个词后面断开（意群的斜线）
refer s.3 -> s.2 / unrefer s.3  箭头：which、it 指的是谁（指一段写 s.1-2，指整句写 s）
rewrite s "The man living next door is a doctor."  改写整句：同样的词滑到新位置，新的淡进来
sentence s = "I {t: was holding | am holding | will be holding} it."  句子跟着拨盘 t 变（先 dial t … options=）：一拨就照 rewrite 重排，别的词编号不变、圈着那一整段的括号跟着走；key= 里那一段也写 {t: … | …}；rewrite / move 以后不再跟
sentence v = "It {verb: go on | t | 完成 | 单} for years."  页面拼谓语：{verb: 原形 | 时间 | 状态 | 主语 | 被动 | 否定}，后面的格可以不写（现在、一般、单、主动、肯定）。每格写词，或者一个拨词的拨盘的名字（跟着拨）：时间 过去 现在 将来 过去将来（也能写情态 must can should…；写时间轴上小人的拨盘，停靠点是年份也行：照在 now= 之前、之后分过去、将来），状态 一般 进行 完成 完成进行，主语 I you he she it we they 或 单 / 复。话、贴的字、题卡、answer="{verb: …}" 里也能写。页面只管拼得对（现状写拼的是什么）；该用哪种时态是你教。拨到一般不说的（完成进行的被动）那一段写成「一般不这么说」。表里没有的不规则动词照规则变（现状会说），自己给：{verb: 原形/过去式/过去分词 | …}。疑问句的倒装不拼
ask drag s.7 "把 is 挪到句首"  学生按住一个词拖到别处（页面执行，再告诉你）
学生自己拆（mark 页面照 key 判每一下）：
open s mark wrong=mark  学生从一个词拉到另一个词，再点成分（常用的 8 个加 key 里有的，交中文）= mark s.1-6 主语；「从句」对得上 key 里任何一种从句，「定语」对得上定语从句；key 写 [Attr/NF …] 是两种都对；学生拉的括号上有 ✕，点了 = unmark s.1-6（不判）
open s fold  学生点一道括号或括号里的词 = fold s.3-6，点小方块 = unfold s.3（页面不判；里层折着也能折外层）
open s move  学生按住一道括号拖到两个词之间 = move s.3-6 after s.9（整段挪；按住一个词挪一个，挪到最前面 = move s.7 before s.1）；mark、fold、move 三种能一起开
open s.3 refer  学生从 who 右上角的钩上拉线，松在词、括号、句子外框上 = refer s.3 -> s.2 / s.1-2 / s（整句）；造句子时写 links="who -> s.1-2; !who -> door=连到了从句里的名词" 就照它判（! 是常见的错连）；学生连的线头上有 ✕，点了 = unrefer s.3
判断式（when=）：s parsed（key 里每一段都拉对了，多拉的不管）、s exact（拉对了、也没多拉）、s main（主干拉对了）、s span s.2-5 = V（这一段现在挂着这个成分）、s linked（links= 每一条都连对了）；没写 key / links= 判不了，@s.done 也不收；量：verbs(s.4-9) 这一段里 key 的谓语几个（verbs(s) 整句）、left(s) key 里还没拉对的几段
句子里留空位让学生填词：现在没有写法（要填就 ask value … type=en）

式子（推导一步一步变形）：
tex f = "\hl{a}{x^2} + \hl{b}{2x} + 1"  造一个式子（KaTeX 的写法；\hl{名字}{…} 给一项起名字，部件写 f.a）
retex f "\hl{b}{2x} + \hl{a}{x^2} + 1"  换掉最后一行（原来那一行就没了，要留着就用 next）：同名的项滑到新位置（带着颜色），别的淡出淡进
next f "= \hl{a}{x^2} + \hl{b}{2x}"  往下写一行：上一行变淡留着，同名的项从上一行滑下来；等号自动对齐（也能写 & 指定对齐的地方）
retex f "\hl{a}{x}+\hl{a2}{x}" a2=a  新的项 a2 也从 a 那里分出来（一项拆成几项）
magnify f.a / unmagnify f  这一项单独放大（写在式子下面）
strike f.b / unstrike f  划掉一项（约掉、抵消）
paint、glow、dim、cover（挖空让学生填）、pulse、ask tap f 对项都有用
照代数写、学生能动手的式子：
tex e = "(A+B)(A+B)" alg=on  大写字母是矩阵（不交换）、小写字母和数是标量，E / I 单位矩阵、O 零矩阵；+ − 乘（省乘号、* ·）、括号、正整数次方；页面拆成项，一项只有一个因子时部件是 e.t1，几个因子时每个因子是部件（e.t2f1 e.t2f2）
reorder e t3 t1 / reorder e t3 end  t3 挪到 t1 前面 / 挪到最后；写因子（e 的 t2f2）就在那一项的因子之间挪
merge e t1 t3  t3 并进 t1（同类项才行）
expand e t1  展开 t1 的括号（展开出的项分开写，不合并）
open e move  学生按住一项拖：放到两项之间 = reorder e t3 t1（换顺序），放到另一项上 = merge e t1 t3（合并同类项），一个因子放到同一项的另一个因子上 = reorder e t2f2 t2f1（换先后）
open e expand  学生点一项 = expand e t1（展开它的括号）
数学上相等才让动（非交换多项式的判定：AB+BA 不能并成 2AB、矩阵的因子不能换先后，标量和 E 能）；不相等弹回去、说为什么；含逆、转置、函数的判不了，照实说判不了、弹回去
判断式：e expanded（都展开了）、e merged（都展开了、没有同类项）、e same=A^2+AB+BA+B^2（一项一项、照先后和它一样）、e equals=…（数学上相等）

题卡（把题拿上舞台：题面、已知、一步步的提示）：
card q = "有序表 7 10 13 16 19 29 32 33 37 41 43，折半查找 33。" "第一次比较的是哪个数？" "提示：mid = ⌊(low + high) / 2⌋"
写法：q.2 第 2 行；q.2-3 第 2 到 3 行（一行一对引号，最多 12 行；话里的 {a.3} 照样能写；$x$ 只是斜体字母、不排公式，矩阵（pmatrix）、分式写不了：矩阵就造 matrix，公式用 tex）
cover q.3 / uncover q.3  提示先扣着，到时候翻开（共用的点亮、灰掉对每一行都有用）
addline q "第二次比较的是哪个数？"  下面再加一行（covered=on 加一行扣着的提示）
rewrite q.2 "……"  改一行的字
ask value "第一次比较的是哪个数？" answer=29  学生填答案，页面当场判

表（行名列名，格里放数、∞、字、短语，能空着等填）：
table T = 10 ∞ _ / _ 7 _ rows="顶点2 顶点3" cols="第1轮 第2轮 第3轮"  「 / 」分行，_ 空着，短语写引号里；最多 10 行 13 列
table E rows="最少 最多" cols="1 2 3" key="1 2 4 / 1 3 7"  只写 rows= cols= 是全空的；key= 是答案（同形，不比的写 _）：页面逐格比，只告诉你、不给学生标
写法：T.2,3 一格；T.r2 一行；T.c3 一列
write T.2,3 7 / write T.2,3 "不稳定" / write T.2,3 _  写一格（你写的学生改不了）/ 空出来
tick T.c2 / cross T.1,4 / untick T  打勾 / 打叉 / 都收掉
addrow T "合计" 3 _ 5  加一行
open T edit  学生点一格键盘写（有 ∞）= write T.2,3 7；input=text 写字，choices="能 不能" 点选项；只开一列 open T.c2 edit
判断式：T full（填满）、T right（填满且都对）；量：blank(T)、wrong(T) 和答案不一样几格；写满演 @T.done

时间轴（时态：一排停靠点，上面有小人、事件条、事件点）：
timeline tl = 1800 1830 1900 现在 将来 now=现在  等号后面是停靠点（年份、词，最多 10 个，等距）；now= 那一个画一道竖线
stand tl me = 1830  小人。同时是拨词的拨盘 me：set me 现在 走过去；{me} 写它在哪；句子里 {me: had | had | had | has | will have}（一个停靠点一段）跟着变；when="me = 现在"
event tl sent = 1830 "sent"  事件点
bar tl war = 1800..1830 "成为独立国家"  事件条；end=e 右端能动（是拨盘 e），start=a 左端能动
写法：tl.me、tl.war、tl.sent（paint、glow、dim 都能用）
open tl.me move  学生按住小人拖到一个停靠点 = set me 现在
open tl.war stretch  学生拖条能动的那一头 = set e 现在
比先后（when=）：e < me、me >= 1830（同一条轴上的拨盘，或者和一个停靠点比）；现状里写每条在小人之前 / 之后 / 小人在中间

## 引擎的过程表
引擎的过程表：行名列名、哪些格等填、答案都由页面的引擎算（你不用算、不用写 key=）；学生点一格写（open T edit），页面逐格比、认得常见错法，只告诉你。先后不论的几格（同一次访问的物理块）怎么填都对；该空着的格学生留空
table T engine=sort algo=shell array="49 38 65 97 76 13 27 49" gaps="5 3 1"  别的 名字=值 是引擎的字段（和黑板的演示组件一样；写错了页面说是哪个）
能造表的引擎：sort(algo array gaps) hash(hash p) kmp(pattern show) net(edges run) tree(nodes walk) paging(refs frames algo) sched(algo q procs) banker(avail max alloc) disk(requests head algo) alloc(memory algo ops) pagetable(vbits page pte vaddr) cache(lines ways block addr refs) bits(num) mul(x y algo) div(x y algo) pipe(instrs) hamming(data) crc(data gen) memexp(chip target addr base) subnet(split hosts) encode(bits code) frag(total mtu) tcp(send last lost) window(proto frames window lost)

## 照引擎走
follow a sort shell gaps="5 3 1"  页面让排序引擎在 a 现在的数上跑一遍（insert / shell / bubble / select / quick / merge / radix）
follow g net dijkstra from=1  图：dijkstra 比牌子上的 dist（open g tag），prim / kruskal 比选的边，bfs / dfs 比访问的先后；表 follow T net dijkstra on=g from=1：每一轮的 dist 当答案（一行一个顶点、一列一轮）
follow h heap build  树照引擎建堆（type=min 小根堆）；follow h heap sort 堆排序（先要已经是堆）。学生的手：open h（按住一个结点拖到另一个上，两个换值）
照着走的东西：现状里写着每一趟做完该是什么样；学生做到一趟页面当场知道对不对、像哪种错法（进记录，一趟中间不判）。量 pass(a)，判断式 a pass=2、a done；每到一趟记一条 stage-call（follow … call=done：走完才记）；@a.right 到一趟时演（只演一次），@a.done 走完演；follow a off 不照了

## 舞台现在
黑板现状里这一块写的：每样东西现在的样子（一排格子的每一格、树的结构、矩阵的数、式子现在一行和它的每一项……）、页面算的量、藏着的东西、贴着的字、拨数现在是几、最后说的话、在等学生做什么（哪一问、哪个按钮）、学生能直接动的（哪样东西、哪种动作、怎么按）、每个挑战做没做到、预写的还有哪几组没演、照引擎走的到了第几趟、存着的样子。

## 页面记下的事
- 作答（`type: 'stage'`）：学生做到一个挑战（`ok: true`，`q` 是挑战的话，`goal` 是挑战的名字）、按了 on= 的按钮没做到（`ok: false`）、答了等着的那一问（`q` 是问的话，`value` 是学生答的，`ok` 是页面判的对错，判不了是 null）；`text` 是写成一句的样子，`stage` 是这一块的 id
- 动作 `stage-act`：学生的每一下（`text`：做了什么、页面判这一下对不对、做不到时为什么；`line` 是翻成的那一行指令；`ok` 页面判的对错；`blocked` 被弹回）
- 动作 `stage-call`：舞台课那时会叫老师的那一刻（`why`：answer 答了那一问、goal 做到了挑战、done 做完了、watch 盯着的条件成立、wrong 写了 call=wrong 又走偏、tries 试了好多下还没做到、stuck 很久没动挑战还没做到），`text` 是从上一次以后学生怎么试的一段（拨了哪一格、从几拨到几、拖成什么样）
- 动作 `stage-note`：页面记下的一句（预写的行没演上……）

## 例子（照抄能演）
```stage
id: s-expand
title: 把 (A+B)(A+B) 拆开的四项按先后排进格子
prewrite: all
tex e = "(A+B)(A+B)"
array a = BA B² A² AB _ _ _ _
array k = A² AB BA B² hide=on
say "左边一项乘右边一项，按先后排进后四格。"
open a move
goal g1 "按先后排好四项" when="a.5 = k.1, a.6 = k.2, a.7 = k.3, a.8 = k.4" on="排好了"
@g1 say "对：AB 和 BA 是两项，先后不能换。"
@g1.wrong say "再看先后：第二项是左边的 A 乘右边的 B。"
ask next "排好了点下面" button="排好了"
```

换成 (A−B)²：tex 那一行写 "(A-B)(A-B)"，两排格子换成这几项（array a = A² -BA B² -AB _ _ _ _、array k = A² -AB -BA B²），话改一句。

```stage
id: s-alg
title: 展开 (A+B)²
prewrite: all
tex e = "(A+B)^2" alg=on
open e expand
open e move
goal g1 "展开以后合并能合并的" when="e expanded, e merged"
@g1 say "四项：A² + AB + BA + B²，AB 和 BA 并不起来。"
@e.miss say "AB 和 BA 先后不一样：矩阵乘法不交换。"
```

```stage
array a = 49 38 65 97 76 13 27 49′ 55 04
hop a.1 -> a.6 color=g1
paint a.1 a.6 g1
say "从 {a.1} 往后跳 5 下，落在 {a.6}：这两个是一组。"
open a
goal g1 "把这一组排好：小的拖到前面" when="a.1 < a.6"
@g1 say "对，这一组排好了。"
@g1 ask tap a "那 {a.2} 和谁一组？"
```

```stage
tree t = 50 30 70 20 40 _ 80
say "这是一棵二叉排序树：左边都比根小，右边都比根大。"
insert t 35
search t 65
bf t
insert t 33
rotate t.40 right
traverse t in upto=3
ask tap t "中序遍历的下一个是谁？点它。" expect=t.35
```

```stage
graph g = A-B:4 A-C:2 B-C:1 B-D:5 C-D:8 D-E:3
tag g ∞
tag g.A 0
say "从 {g.A} 出发，先看它的两条边。"
glow g.A~B g.A~C
relax g.A -> g.B
relax g.A -> g.C
paint g.A g3
ask tap g.nodes "下一个该定下来的是谁？" expect=g.C
```

```stage
matrix A = 1 1 / -1 -1
matrix B = 1 -1 / -1 1 beside=A
product C = A B
mul C.1,1
say "{C.1,1} 是 A 的第 1 行乘 B 的第 1 列。剩下三格你来：点一格，看它怎么算出来。"
open C explain
goal g1 "点出 AB 剩下的三格" when="C = O"
@g1 say "A、B 都不是 O，乘出来却是 O。"
@g1 open B edit range=-3..3
@g1 goal g2 "改 B 里的一个数，让 AB 不再是 O" when="C != O"

```

```stage
plane p range=-4..4
vec p u = 2 1
vec p v = -1 2
sum p w = u + v
say "从原点先走 {p.u}，再接着走 {p.v}，就到了 {p.w} 的尖上。"
matrix A = 1 1 / 0 1 beside=p
transform p A
span p w
ask drag p.u "把 {p.u} 拖到别的格点上，看 {p.w} 怎么跟着变。"
```

```stage
sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] [P a doctor]."
mark s.7 V
mark s.8-9 P
say "谓语是 {s.7}。它前面一长串是主语，里面还套着一个从句。"
open s mark wrong=mark
goal g1 "拉出主语，再拉出主语里的从句" when="s parsed"
@g1 fold s.3-6
@g1 ask tap s "对。折起来只剩主干：主语的核心词是哪个？" expect=s.2
```

```stage
tex f = "\hl{a}{x^2} + \hl{b}{2x} + \hl{c}{1}"
paint f.a g1
paint f.c g3
say "这三项能凑成一个完全平方吗？先看两头。"
next f "= \hl{a}{x^2} + \hl{b}{2\cdot x\cdot 1} + \hl{c}{1^2}"
glow f.b
ask tap f "中间这一项里的 x 和 1，分别从哪一项来？点一项。"
```

```stage
card q = "有序表 7 10 13 16 19 29 32 33 37 41 43，折半查找 33。" "第一次比较的是哪个数？" "提示：mid = ⌊(low + high) / 2⌋"
cover q.3
glow q.2
ask value "第一次比较的是哪个数？" answer=29
```

```stage
table T = 10 ∞ _ / _ 7 _ rows="顶点2 顶点3" cols="第1轮 第2轮 第3轮" key="10 ∞ 9 / 5 7 7"
say "第 3 轮以后，到每个顶点最短是多少？填进表里。"
open T edit
@T.done say "填完了，我们一格一格对。"
```

```stage
timeline tl = 1800 1830 1900 现在 将来 now=现在
stand tl me = 现在
bar tl war = 1800..1830 "成为独立国家"
sentence s = "Belgium {me: will become | had become | had become | has become | will have become} independent."
say "把小人拖到 1900 年，回头看这件事。"
open tl.me move
goal g1 "站到 1900" when="me = 1900"
```

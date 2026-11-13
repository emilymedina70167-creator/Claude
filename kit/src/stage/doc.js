// 舞台上的课：发给老师（Opus 5.5）的说明和每一轮的内容（docs/stage-plan.md B 段）。纯函数，有测试（tests/stage-doc.test.js）。
// 说明分两块：怎么教（STAGE_TEACH：像一个会停下来等学生的科普视频——画面是主力，先做后说）和镜头指令（STAGE_DOC）。
// 提到学生不用「他」「她」（tests 守着）
import { followOf, followNames } from './follow.js';
import { TYPES } from './types/index.js';
import { MEMO_DOC, packText, PACK_BUDGET } from '../class/prompt.js';
import { memoryDigest } from '../memory/digest.js';
import { gridText } from './value.js';
import { subjectOf } from '../memory/space.js';
import { subjectKey } from '../subject.js';

const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const bytes = (t) => (enc ? enc.encode(String(t)).length : Buffer.byteLength(String(t)));

export const STAGE_TEACH = `你是一对一的老师，在一块「舞台」上给学生上课。舞台像一个能上手玩的科普动画：画面是活的，学生随时能直接动它，页面当场算、当场变。教什么、怎么引导、画面放哪什么样子都由你定，页面只算得对、动得顺、照你写的画；学生嫌哪里不好看当场改（没有「页面画的改不了」）。
- 画面是讲课的主力。你对画面做事——挪、交换、插入、连线、染色、比较、分组、旋转、变换、拆开、折起来、一项一项变形（每种东西有自己的动作，见「舞台上能放的东西」）——学生看着画面变化自己想明白。话是旁白：短，指着画面说（写 {a.3}，话里会画成和那个部件一样的小块）。
- 挑最能把这个概念演出来的东西：一排格子、树、图（数据结构），矩阵、平面（线代），句子（长难句），式子（推导），题卡（把题拿上来）。一块舞台上可以同时放几样，让它们互相对照（比如 AB 和 BA 摆在一起）。
- 先做后说：先让学生看到、动手，再让学生说出发现，最后才给名字（概念、术语）。不先讲定义，不罗列性质和步骤。
- 让学生动手，别让学生光看——这是舞台和放视频的区别：摆好局面以后用 open 把东西交给学生（拨矩阵里的数、拖格子、拖向量、点乘积的一格看它怎么算），再给一个挑战 goal（比如「改 B 的一个数，让 BA 也是 O」when="D = O"）。学生每动一下页面当场算、当场判，做到的那一刻左上角打勾。新的运算先演一个（mul C.1,1），下一个让学生做；整个一下子演完只拿来对答案。
- 做到了接着做什么先写好：@g1 开头的行在学生做到 g1 的那一刻马上演，不等你（@t.done 是 t 做完了，@t.right 是学生在 t 上做对一步，@ask.right 是学生答对这一问，写在 @g1 的一问前面就跟着那一问）——一句确认，再揭开下一小问或者下一个挑战，学生一路不停。只预写确认和下一小问；走偏不能预写：提示、讲解、纠错要等你看见学生是怎么做的再写。
- 页面不替你教：它只算事实（对不对、像哪种错、正确的下一步、什么跟着变了），只演你事先允许的反应。学生走偏了默认照做、只记下（wrong=quiet）；要圈出来、拦下、马上叫你，在 open 那一行写；页面算的要不要标给学生看（heights、tally、reveal=on），也由你写。
- 一轮的结尾是两种之一：一个 ask（等学生点、拖、填、说），或者一个还没做到的挑战（页面替你在旁边挂「给个提示」）。等学生答了、做到了挑战又没有下一件事、点了提示、试了好几下还没做到、很久没动，页面把这一段学生怎么试的（拨了哪一格、从几拨到几、拖成什么样）一起告诉你。
- 看学生怎么试的再决定下一步。对了：一句确认，往前走一点。错了、卡住了：从学生试的那几下里找出卡在哪，用画面把那一步演给学生看（比如亮出学生改的那一格是怎么影响结果的），再让学生试——不要用一段文字讲道理。学生说不懂：换一个角度演，或者退到更小的一步。
- 学生能自己发现的不要说破；问题要具体到画面上的一格、一组，答案能在画面上点出来、拨出来。
- 一轮写 4～16 行指令，最多 3 句 say，每句不超过 40 个字；字多了就是在念稿，改成让学生动手。
- 学生也可能直接打字：认真回答，同样用画面演。
- 只写指令行，不写别的解释，不加代码块记号。`;

// 各种东西共用的指令（说话、点亮、染色、连线、贴字、拨数、镜头、等学生）；每种东西自己的那一节（types/xxx.js 的 doc）接在后面
export const STAGE_COMMON = `## 舞台的指令（一行一个动作，页面一行一行演；行首写 & 就和上一行一起演）
部件的写法：名字（整个）、名字.部件（每种东西自己的写法，见下面各节）
颜色：g1 蓝、g2 粉、g3 绿、g4 金、g5 紫、g6 橙
跟着算的 {式子}：引号外面的 {…} 由页面现算（格子里的数、矩阵、向量、边权、answer=）。能用拨数 k、矩阵 A、一格 A.1,2、平面上的 p.u，能写 + -、乘（A v、2A）、A^-1、A'、det(A)。依赖一变页面当场重算、告诉你从几变成几；学生动不了它；算不出来告诉你，停在上一次的数。引号里（say、label、题卡）的 {a.3}、{d} 照旧是话里的小块
量：页面数的数，写成 名字(东西或部件)（每种东西有哪几个见它那一节）。舞台现在里都写出来；能写进 when=、answer={…}，话和贴的字里写 say "秩是 {rank(m)}" 画成现在的数、跟着变；数不了（没写 key、有空格）时挑战写「判不了」、答案「页面没判成」、字画「?」

说话（旁白，在画面上方一个字一个字写出来）：
say "从 {a.1} 往后数 5 个，落在 {a.6}。"    {a.1} 画成那个部件的小块（扣着的不露值）；{d} 是拨的数的值；$d$ 是斜体字母（不排公式）；[不稳定] 是能飞到图上的词

对任何部件都能做：
glow a.1 a.8 / unglow a.1 a.8      点亮（提醒注意）
lift a.2 / drop a.2               抬起 / 放下（「这一个要动了」）
pulse a.3                         闪一下
paint a.1 a.6 g1 / unpaint a.1    染色
dim a.1-5 / undim a.1-5           灰掉（排除在外的部分）
cover a / uncover a.6             扣过去看不见值 / 翻开一个（查找、比较时「只能翻开看」就这样演）
link a.1 a.6 g1 / unlink a        连一道弧（写好几个就依次连；写整样东西就连到它身上）/ 收掉连着 a 和它部件的线
compare a.3 a.8                   两个比大小（中间冒出「65 > 49」）；两张矩阵整张逐格比
remove a                          把一样东西拿下舞台
scene "过去完成时" keep=a  换一批东西：上一幕整块收起（能翻回去看）；keep= 带过来的
hide a / show a                   藏起来（照样算、现状照写，学生看不见）/ 摆出来；造的时候写 hide=on 就先藏着（同名重造不写 hide= 照旧）

贴在图上的字（舞台上的东西，能改、能拿掉）：
label t a#1 a#8 "一样大，先后却换了" side=below tone=note     贴在这几个旁边（side：above / below / left / right；tone：note 小字、key 重点、soft 淡）
retext t "新的字" / unlabel t / unlabel（全拿掉）     改字 / 拿掉（拿字用 unlabel，remove 只拿东西）；贴的部件没了，字跟着消失
fly say.1 -> k a#8 a#1           上一句话里第 1 个 [词] 飞到这几个旁边，变成贴着的字（给概念起名字时用）

能拨的数：
dial d = 5 range=1-5 at=a         一个能拨的数，学生拨它；能写进 {式子} 里驱动任何量（格里的 {d}、整个矩阵 {d A}、array a = {d} 3 5），一拨就跟着变；rowop、transform 这类动作只照写下时的数做一次，里面不能写拨数
dial t = 现在 options="过去 现在 将来"  拨词的拨盘：{t} 写现在的词，when="t = 将来"，set t 将来（不是数，进不了式子）
{t: 做过了 | 正在做 | 还没做}  照拨盘挑一段（段数 = 拨盘能拨到的个数；能套一层）：贴的字、题卡、挑战的字跟着变，话是说的那一刻
label n dial:d "{d} 组" side=right   字可以贴在拨数旁边
set d 5                            你来拨
unlabel dial:d                     收起拨数

画面（每轮附一张画面图，先看图再写）：
place a main / place g right-of a align=top gap=s / place A B row / at=6,4-30,12；say "…" near=a.2  摆过的钉住不挪；arrange 重排；版面按 48 列
look say frame=none text=24 color=brand / look card frame=none / look a.3 color=red weight=bold / look goals hide  能写 frame bg edge radius shadow text font weight color align opacity；目标 * 种类名 东西 部件 say goals dock；加 always 以后每节课都这样
scale a 1.4  放大缩小（0.5～2.5）；draw d1 arrow from=a.3 to=b.2 color=g2 / circle on= / box on= / brace under= "字" / underline on= / text at=格 "字" / svg at=格 "<path…/>"；erase d1
镜头：camera a.1-7（凑近）/ camera all；wait 600（毫秒）

让学生自己动、给挑战（每动一下页面当场算、当场判，学生做的每一下下一次都告诉你）：
open a                              交给学生直接动（这里是拖着两格换位置；每种东西能 open 的动作、学生怎么动、翻成哪一行，见各自一节）
close a                             收回来（close a 动作：只收那一种）
同一处按法不一样的（点、滑、按住再拖）能一起开；按法一样的第二项当场报错，先 close 前一项
同一项再开一次是换掉它：再写一遍 open，照新写的 wrong=、range=、undo= 办
页面判对错的动作（树的 rotate insert place、矩阵的 rowop、句子的 mark refer）在 open 那一行写你事先定的：wrong=quiet 照做、只记下（默认）/ wrong=mark 照做、淡淡圈一下 / wrong=block 不让做、弹回去；call=wrong 一走偏就叫你 / call=done 做完马上叫你。这个世界做不到的（一行乘 0）永远弹回去
undo=on（哪种 open 都能写）：右上角「撤一步」，学生撤回自己这一回合的上一下；拨数、做到挑战、做完了、引出过预写的那一下撤不了
keep a "换之前"                     存下 a 现在的样子（最多 6 个，同名的换掉）；keep a "换过" after=swap：以后学生每做完一次 swap 页面替你存成「换过」（after=off 停）
back a "换之前" / back a             回到存着的那一刻 / 回到学生最后那一下之前（隔着你的一轮也行，你后来改的也一起回去）；只回这样东西的数据，挑战照回去的样子重判
open a back="换之前"                 学生那边多一个「回到换之前」按钮 = back a "换之前"（不叫你）
goal g1 "把 {a} 拖成从小到大" when="a sorted"     挑战（左上角一条）；写下就已经成立的不收；做到过就一直算（之后不成立了，现状写「做到过；现在不成立」）
when= 两边写数、部件、东西的名字、拨数、量、O（零矩阵）、I（单位矩阵），部件比部件也行（a.1 < a#6）；比较 = != < <= > >=；a sorted（desc 是从大到小）；每种东西自己的判断式写「名字 判断式 [参数]」（t avl、m rank=2、s parsed，见各节）；逗号连着的都要成立，| 隔开的有一组成立就算（when="a.1 < a.2 | a.9 < a.10"）；不能写坐标、不能写字（比部件）
挑战后面还能写：call=now 做到就马上叫你（不写是学生手上还有事就攒着）；on="就这样" 学生按这一轮 ask next 的「就这样」才判（没做到也叫你）；collect=a n=3 每做到一次、a 和收过的都不一样就收一张、演 @g1，收齐了叫你
watch w1 when="a.1 = 13"  只叫你的条件：成立时马上叫你一次；学生看不到、不打勾、不能预写
when= 两边、collect= 能直接写 {式子}（不用先藏辅助矩阵）：when="{A B - B A} = O"、"{det(A - k I)} = 0"、collect={A B}；现状写它现在的值
@g1 say "排好了！"                  学生做到 g1 的那一刻马上演（不等你；你自己的行让它成立的不演，下一条告诉你）：一句确认、下一个挑战、一个 ask 都行；写过的一直留着到做到为止，下一轮不用再写；@g1 里出的 goal g2 能接着写 @g2，最多三层
@t.done / @t.right 开头的：t 做完了（页面算出没有下一步；学生手上没事了才叫你）/ 学生在 t 上做对一步时马上演（只演一次）；写在 open 页面判对错的动作之后、现在还有下一步时（平了的树开着删、摘也行：删完再修平时演）
@ask.right say "对。"                写在这一轮最后那个 ask 前面：学生答对它时马上演；那一问要页面判得了对错（tap、pick 有预期的，value 有答案），判不了当场报
预写只收确认和揭开下一小问；走偏不能预写（@t.wrong、@ask.wrong 会报错），怎么讲等你看着写。@ 的行写下时就在今天的舞台上试一遍：今天演不了的写不进去；指着还没有的部件只查写法（演时没有就不演）
预写的行照先后演，say 要等读完：换 open、出新 goal 写在 say 前面，不然学生在这句话演着时做的一下还照旧的办
ungoal g1                           拿掉挑战

等学生（每一轮最后一行，一轮只有一个；一轮也可以不写 ask，以一个还没做到的挑战结尾）：
ask tap a "那 {a.2} 和谁一组？"            学生点一个（写 a 是哪一个都能点；写 a#1 a#8 是只能点这几个）
ask tap a "…" expect=a.7                   你预期的那一个（写整样东西或一段，点到里面哪一个都算）：页面告诉你学生点没点对
ask pick a "哪几格会动？都点出来" button="猜好了" expect="a.2 a.6"     学生点几个、按按钮交，页面告诉你多点、漏点的（写一段是里面每个都要点；order=on 连先后一起比）；圈留到你下一轮写完（unpick 收）；reveal=on：之后变了的圈变实线、没变的变虚线
ask drag a#1 a#6 "把小的拖到前面"          学生拖（能拖的东西才行，见各节）
ask next "拨一下 $d$，看出规律点下面" button="看出来了"     学生看完 / 拨完点按钮
ask say "你觉得为什么？"                    学生写一句话
ask end "今天先到这里？"   学生说要下课时写：页面弹出下课的确认，学生点了才下课（你自己下不了课）
ask value "一共比较了几次？" answer=4      学生填一个答案，页面当场判（不写 type= 时数按数比，3/4 = 0.75）；answer= 可以不写（只收不判，这时 type=、wrong= 也不写）
ask value "{a.3} 比 {a.6} 大多少？" answer={a.3-a.6} type=num wrong="-52=减反了"     type= 选判法：num 数、formula 含 n 的式子（加 free=n）、matrix 矩阵（1 2 / 0 1）、set 数集、equation 方程、seq 序列、en 英文（学生的键盘跟着换）；式子里乘号能省（2n）；answer={式子} 页面照舞台现算；wrong="错答=说明了什么"（几条用 ; 隔开）只告诉你，学生只看到对不对`;

/**
 * 每门课用得上的东西（说明里只带这几种，其余的只列一个名字）：题卡、式子哪门课都带。
 * 没写科目（样子页）就全带
 */
export const SUBJECT_TYPES = {
  数据结构: ['array', 'tree', 'graph', 'card', 'tex', 'table'],
  操作系统: ['array', 'graph', 'card', 'tex', 'matrix', 'table'],
  组成原理: ['array', 'card', 'tex', 'matrix', 'table'],
  计网: ['array', 'graph', 'card', 'tex', 'table'],
  线代: ['matrix', 'plane', 'tex', 'card', 'array', 'table'],
  英语: ['sentence', 'card', 'table', 'timeline'],
};

// 照引擎走的那一小节末尾共用的两句（每类算法自己的一行在对应关系的 doc 里）
const FOLLOW_DOC = '照着走的东西：现状里写着每一趟做完该是什么样；学生做到一趟页面当场知道对不对、像哪种错法（只告诉你，一趟中间不判）。量 pass(a)，判断式 a pass=2、a done；每到一趟页面就叫你（follow … call=done：走完才叫）；@a.right 到一趟时演（只演一次，下一趟再写），@a.done 走完演；follow a off 不照了';

/**
 * 共用的那一段里只有个别科目用得上的行（主线第五轮腾地方）：别的科目不带，在「说明没带的」里说一声。
 * test 认的是 STAGE_COMMON 里那一行的开头（tests/stage-doc.test.js 守着每条都认得到行：改了措辞不会悄悄漏带）
 */
export const ONLY_LINES = [
  { subjects: ['英语'], name: '拨词的拨盘和 {t: 甲 | 乙}', test: (l) => /^dial t = 现在 options=|^\{t: 做过了/.test(l) },
  { subjects: ['线代'], name: 'when= 里写 {式子}', test: (l) => /^when= 两边、collect= 能直接写/.test(l) },
];
// 这门课只带这种东西说明的第一段（矩阵的第二段是学生自己消元、键盘写格、判矩阵答案：操作系统、组成原理摆矩阵只是摆数）
const MATRIX_LITE = { cut: /\n学生自己消元[\s\S]*$/, name: '矩阵的 open（rowop / edit：要学生填数用表）' };
const LITE_TYPES = { 操作系统: { matrix: MATRIX_LITE }, 组成原理: { matrix: MATRIX_LITE } };

/**
 * 引擎的过程表（table T engine=…，enginetable.js）：每门课说明里列哪几个引擎。每条是「引擎 字段=值 …」，照抄能造出表
 * （tests/stage-doc.test.js 守着）；说明里第一条写全当例子，别的只写「名字(字段…)」——字段和黑板组件一样，写错了页面当场说是哪个
 */
export const ENGINE_TABLES = {
  数据结构: ['sort algo=shell array="49 38 65 97 76 13 27 49" gaps="5 3 1"', 'hash hash="19 14 23 01 68 20" p=13', 'kmp pattern=abaabc show=nextval', 'net edges="A->B 10, A->C 5, C->B 3" run="dijkstra from A"', 'tree nodes="A(B(D, E), C(, F))" walk=inorder'],
  操作系统: ['paging refs="7 0 1 2 0 3 0 4" frames=3 algo=fifo', 'sched algo="rr q=2" procs="P1 0 5, P2 2 4, P3 4 1"', 'banker avail="3 3 2" max="P0 7 5 3; P1 3 2 2" alloc="P0 0 1 0; P1 2 0 0"', 'disk requests="98 183 37 122 14" head=53 algo=scan', 'alloc memory=640K algo=first ops="alloc 1 130K, alloc 2 60K, free 1"', 'pagetable vbits=32 page=4KB pte=4B vaddr=0x12345678'],
  组成原理: ['cache lines=8 ways=2 block=16B addr=16 refs="0x0010, 0x0124, 0x0010"', 'bits num=-5', 'mul x=-0.1101 y=0.1011 algo=booth', 'div x=-0.1011 y=-0.1101 algo=orig', 'pipe instrs="add r1, r2, r3; sub r4, r1, r5"', 'hamming data=1010', 'crc data=101001 gen="x^3 + x^2 + 1"', 'memexp chip=2K×4 target=8K×8 addr=16 base=6000H'],
  计网: ['subnet split=192.168.1.0/24 hosts="60, 30, 10"', 'encode bits=10110010 code="manchester, diffman"', 'frag total=4000 mtu="1500, 576"', 'tcp send="70 100" last=180 lost=1', 'window proto=gbn frames=6 window=4 lost=2', 'crc data=101001 gen="x^3 + x^2 + 1"'],
};
const ETABLE_DOC = '引擎的过程表：行名列名、哪些格等填、答案都由页面的引擎算（你不用算、不用写 key=）；学生点一格写（open T edit），页面逐格比、认得常见错法，只告诉你。先后不论的几格（同一次访问的物理块）怎么填都对；该空着的格学生留空';
function engineTablesDoc(subject) {
  const list = subject ? ENGINE_TABLES[subject] : Object.values(ENGINE_TABLES).flat();
  if (!list?.length) return '';
  const keys = (eg) => `${eg.split(' ')[0]}(${[...eg.matchAll(/(\w+)=/g)].map((m) => m[1]).join(' ')})`;
  return `${ETABLE_DOC}\ntable T engine=${list[0]}  别的 名字=值 是引擎的字段（和黑板组件一样；写错了页面说是哪个）\n这门课还有：${[...new Set(list.slice(1).map(keys))].join(' ')}`;
}

/** 整份指令说明：共用的 + 舞台上能放的东西（subject：这节课是哪门课，只带用得上的那几种） */
export function stageDoc(subject = '') {
  const want = SUBJECT_TYPES[subject] || null;
  const skipped = [];
  const gone = want ? ONLY_LINES.filter((x) => !x.subjects.includes(subject)) : [];
  const common = gone.length ? STAGE_COMMON.split('\n').filter((l) => !gone.some((x) => x.test(l))).join('\n') : STAGE_COMMON;
  const parts = [common, '## 舞台上能放的东西'];
  const lite = LITE_TYPES[subject] || {};
  for (const t of Object.values(TYPES)) {
    if (!t.doc || !t.create.length) continue;
    if (want && !want.includes(t.type)) { skipped.push(`${t.label}（${t.create.join(' / ')}）`); continue; }
    if (lite[t.type]) { parts.push(t.doc.replace(lite[t.type].cut, '')); skipped.push(lite[t.type].name); continue; }
    parts.push(t.doc);
  }
  skipped.push(...gone.map((x) => x.name));
  if (skipped.length) parts.push(`（这门课一般用不上、说明没带的：${skipped.join('、')}）`);
  // 引擎的过程表：这门课列了引擎、也带着表的才写
  const et = (!want || want.includes('table')) ? engineTablesDoc(subject) : '';
  if (et) parts.push(et);
  // 照引擎走（follow.js）：只带这门课接上了的那几类算法（对应关系的 subjects）；全带的那一份都带
  const follows = followNames().map(followOf).filter((a) => a.doc && (!subject || a.subjects.includes(subject)));
  if (follows.length) parts.push(`## 照引擎走\n${follows.map((a) => a.doc).join('\n')}\n${FOLLOW_DOC}`);
  const exType = want && !want.includes('array') ? TYPES[want.find((k) => TYPES[k]?.example)] : TYPES.array;
  parts.push(`例子（一轮）：\n${(exType || TYPES.array).example}`);
  // 源码里写法和说明之间用一串空格对齐着（好读）；发给老师的那一份压成两个——每门课省约 1 KiB，内容一个字不少
  //（引号里没有这样的空格：tests/stage-doc.test.js 守着）
  return parts.join('\n\n').replace(/ {3,}/g, '  ');
}
export const STAGE_DOC = stageDoc();

// 只有一门课的空间（408 有四门，推不出来）
const SPACE_SUBJECT = { math: '线代', en: '英语' };
/**
 * 这节舞台课是哪门课（说明只带这门课用得上的几种东西，stageDoc(科目)）：照顺序推——这节课的块 → 资料包写的科目或块编号 →
 * 这节课 / 单元记着的科目 → 空间（数学只有线代、英语只有英语）。408 有四门课，前面都没有就推不出来：给 ''，发全带的那份
 * （docs/superpowers/specs/2026-11-08-stage-base-2-rulings.md「推不出科目」那一条）。pack 是 { main, problems }，session 是 sessions/{编号}
 */
export function stageSubject({ block = '', pack = null, session = null, space = '' } = {}) {
  if (block) return subjectOf(block);
  const main = pack?.main || {};
  const named = subjectKey(main.subject);
  if (named) return named;
  if (main.block) return subjectOf(String(main.block));
  const own = subjectKey(session?.subject);
  if (own) return own;
  return SPACE_SUBJECT[space] || '';
}

/** 第一轮：说明 + 这节课学什么 + 资料（subject：这节课是哪门课，只带用得上的；不写就全带） */
export function stageSystem({ topic = '', material = '', subject = '' } = {}) {
  return [
    STAGE_TEACH,
    stageDoc(subject),
    `## 这节课\n${topic}`,
    material ? `## 资料（照这里的口径讲，例子可以自己换）\n${material}` : '',
  ].filter(Boolean).join('\n\n');
}

export function firstMessage(opts) {
  return `${stageSystem(opts)}\n\n舞台现在是空的。写第一轮：先造出要用的东西，让学生看到一个具体的例子、能自己动手试，以一个 ask 或一个挑战 goal 结尾。`;
}

/** [跟着变的] 一块最多多少字节（UTF-8，连每行前面的「- 」）：超了以后后面的东西只写名字，现在的数老师看 [舞台现在] */
export const DERIVED_MAX = 1536;
const CELL_REF = /^([A-Za-z_]\w*)\.(\d+),(\d+)$/;
const lineBytes = (ls) => ls.reduce((n, l) => n + bytes(`- ${l}\n`), 0);

/** 舞台上每张矩阵现在的数：Map<名字, 一行一行的字>（[跟着变的] 写整张时拿它做「之后」）；没有 objects 的场景（测试里的假场景）是空的 */
export function gridsOf(scene) {
  const out = new Map();
  if (!scene?.objects) return out;
  for (const o of scene.objects.values()) {
    if (o?.type !== 'matrix' || !Array.isArray(o.cells)) continue;
    const rows = [];
    for (let r = 1; r <= o.rows; r++) rows.push(o.cells.filter((x) => x.r === r).sort((a, b) => a.c - b.c).map((x) => String(x.value ?? '')));
    out.set(o.id, rows);
  }
  return out;
}

/**
 * 一张矩阵变了的格占一半以上（至少两格）：写成整张「Dd：(2 0; 0 −2) → (0 0; 0 0)」，比一格一行好读（老师要看的是整张成了什么）。
 * 之后的那张是舞台现在的数，之前的那张是现在的数换回变了的格的 from。有一格对不上这张矩阵（式子里的、出了现在的行列）就不写整张
 */
function wholeGrid(id, xs, grids) {
  const g = grids?.get?.(id);
  if (!g || xs.length < 2) return null;
  const total = g.reduce((n, row) => n + row.length, 0);
  if (xs.length * 2 < total) return null;
  const before = g.map((row) => [...row]);
  for (const x of xs) {
    const m = x.expr == null && String(x.ref).match(CELL_REF);
    if (!m || m[1] !== id) return null;
    const r = Number(m[2]) - 1, c = Number(m[3]) - 1;
    if (!before[r] || c >= before[r].length) return null;
    before[r][c] = x.from ?? '';
  }
  return `${id}：${gridText(before)} → ${gridText(g)}`;
}

/**
 * 学生动了以后跟着算的东西变了什么（scene.js 的 fx.derived，两种样子：乘积一格一条 { part, before, after, id, changed }；
 * 跟着算的一样东西一条 { id, changed: [{ ref, expr?, from, to }] }，算不出来 { id, changed: [], error }）→ 一行一行，按东西写。
 * 同一格变了几次写从第一次之前变成最后的，变回原样的不写；算不出来的写最后一次的原因（后来又算出来了就不写）。
 * grids（gridsOf：每张矩阵现在的数）：一张矩阵一半以上的格变了写整张。超过 DERIVED_MAX 以后后面的东西只写名字；
 * 算不出来的那几句一直写（只写名字就成了「也跟着变了」，是假话）
 */
export function derivedLines(derived = [], { grids = null } = {}) {
  const cells = new Map(); // ref（带式子）→ { id, ref, expr, from, to }
  const errs = new Map(); // id → 原因
  const ids = []; // 东西按第一次变的先后
  for (const d of derived || []) {
    if (!d) continue;
    if (d.error) { errs.set(d.id, d.error); continue; }
    for (const x of d.changed || []) {
      const k = `${x.ref}|${x.expr ?? ''}`;
      const had = cells.get(k);
      if (had) had.to = x.to; else cells.set(k, { id: d.id, ref: x.ref, expr: x.expr ?? null, from: x.from, to: x.to });
      if (!ids.includes(d.id)) ids.push(d.id);
      errs.delete(d.id);
    }
  }
  const shown = (v) => (v === '' || v == null ? '空' : String(v));
  const moved = [...cells.values()].filter((x) => shown(x.from) !== shown(x.to));
  const cellLine = (x) => `${x.ref}${x.expr ? ` 里的 {${x.expr}}` : ''} 从 ${shown(x.from)} 变成 ${shown(x.to)}`;
  // 原因前面的「{式子}」和前面写的重了（scene.js 的 stateText 也这样去）
  const errLines = [...errs].map(([id, e]) => `${id} 算不出来：${String(e).replace(/^「\{[^{}]*\}」(算不出来：|里的)?/, '')}`);
  let room = DERIVED_MAX - lineBytes(errLines);
  const out = [], names = [];
  for (const id of ids) {
    const xs = moved.filter((x) => x.id === id);
    if (!xs.length) continue;
    const whole = wholeGrid(id, xs, grids);
    const ls = whole ? [whole] : xs.map(cellLine);
    if (names.length || lineBytes(ls) > room) { names.push(id); continue; }
    out.push(...ls);
    room -= lineBytes(ls);
  }
  return [...out, ...errLines, ...(names.length ? [`${names.join('、')} 也跟着变了（现在的数见舞台现在）`] : [])];
}

/**
 * 学生做完以后发给老师的一条：学生做了什么、跟着变的（页面重算的；grids 是 gridsOf(场景)，矩阵变了一半以上写整张）、
 * 页面核过老师上一轮的几步（不是正确的下一步的那几步）、上一轮哪几行没演（写错了）、哪几行照演了可写错了（errors 里 kept 的）、
 * 舞台现在是什么样（照场景写的，和画面一样）。
 * 后加的两块只在有内容时出现
 */
// aide：课堂助手旁听写的那一节（aide/watch.js 的 watchSection，「[助手看到的]」开头）；空的就没有这一节
export function turnMessage({ act = '', state = '', errors = [], audit = [], derived = [], grids = null, askId = null, aide = '' } = {}) {
  const parts = [];
  // askId：这一问的编号（学习台里上课才有）。老师记错题、弱点的依据写它——以前说明里只说「S5 指第 5 轮」，
  // 页面用的却是数据库里的轮号，老师数的对不上：真课上 4 条被拒收、1 条对到了别的题上
  const head = askId ? `[学生]（这一问的编号 ${askId}）` : '[学生]';
  parts.push(act ? `${head}\n${act}` : `${head} 没有动作`);
  const moved = derivedLines(derived, { grids });
  if (moved.length) parts.push(`[跟着变的]（学生动了以后页面当场重算的）\n${moved.map((l) => `- ${l}`).join('\n')}`);
  if (audit.length) parts.push(`[页面核过你上一轮的几步]（这几步不是正确的下一步；页面照演了、没拦你，是故意演错的就不用管）\n${audit.map((l) => `- ${l}`).join('\n')}`);
  const skipped = errors.filter((e) => !e.kept), kept = errors.filter((e) => e.kept);
  if (skipped.length) parts.push(`[上一轮没演的行]（写错了，页面跳过了，别的行照演）\n${skipped.map((e) => `- 第 ${e.line} 行「${e.src}」：${e.error}`).join('\n')}`);
  // 照演了、可有写错的（话里拼错的 {kk}）：页面不替你改，下一轮你改过来
  if (kept.length) parts.push(`[上一轮照演了、可写错了的行]（页面照演了，学生看到的是原样的字）\n${kept.map((e) => `- 第 ${e.line} 行「${e.src}」：${e.error}`).join('\n')}`);
  if (aide) parts.push(aide);
  parts.push(`[舞台现在]\n${state}`);
  parts.push('写下一轮。');
  return parts.join('\n\n');
}

/** 样子页里能选的几节课（资料是照王道的口径写的提要；真上课时换成学习台的教材原文）；三节都是数据结构，第一轮只带这门课的说明 */
export const TOPICS = {
  shell: {
    subject: '数据结构',
    title: '希尔排序',
    topic: '数据结构 · 希尔排序（缩小增量排序）：为什么要分组、怎么分组、一趟做什么、为什么不稳定。',
    material: '希尔排序：先取一个小于 n 的增量 d，把表中相距 d 的记录分成一组（第 1、1+d、1+2d……个是一组，共 d 组），各组内做直接插入排序；然后缩小 d 重复，直到 d = 1 做最后一趟直接插入排序。王道的例子：49 38 65 97 76 13 27 49′ 55 04，增量取 5、3、1。d = 5 一趟后为 13 27 49′ 55 04 49 38 65 97 76。希尔排序不稳定：相同关键字的记录可能被分到不同组，先后次序会变（例子里 49 和 49′）。时间复杂度依赖增量序列，n 在某个范围内约 O(n^1.3)，最坏 O(n²)；空间 O(1)；只适用于顺序存储。',
  },
  bsearch: {
    subject: '数据结构',
    title: '折半查找',
    topic: '数据结构 · 折半查找：为什么要有序、low / high / mid 怎么动、查找失败时停在哪。',
    material: '折半查找（二分查找）只适用于有序的顺序表。low = 1、high = n；mid = ⌊(low + high) / 2⌋；key 等于 mid 处的值则成功；key 小于它则 high = mid − 1，大于它则 low = mid + 1；low > high 时查找失败。王道的例子：7 10 13 16 19 29 32 33 37 41 43，查 11：mid = 6（29）→ high = 5；mid = 3（13）→ high = 2；mid = 1（7）→ low = 2；mid = 2（10）→ low = 3 > high = 2，失败。',
  },
  insert: {
    subject: '数据结构',
    title: '直接插入排序',
    topic: '数据结构 · 直接插入排序：有序区和无序区、每次拿哪一个、怎么找位置、后面的为什么往后挪、为什么稳定。',
    material: '直接插入排序：把表分成前面的有序区和后面的无序区，初始有序区只有第 1 个元素；每次取无序区的第一个元素，在有序区里从后往前比较，比它大的依次后移一位，空出的位置放入它（相等时不越过，所以稳定）。n 个元素做 n − 1 趟。最好 O(n)（本来有序），最坏、平均 O(n²)；空间 O(1)。例子：49 38 65 97 76 13 27 49′。',
  },
};

// —— 在学习台里上的舞台课（D 段）：每一轮的整份说明 ——
export const STAGE_SYSTEM_MAX = 150 * 1024;

// 记忆的写法：照课堂那份，依据换成舞台上那一问的编号（S5：页面每一轮在 [学生] 后面写给老师的）；不收「point=」（舞台上没有段）
export const STAGE_MEMO_DOC = MEMO_DOC
  .replace(/basis=q-b5,q-b7/g, 'basis=S5,S7')
  .replace(/basis=q-b9/g, 'basis=S9')
  .replace(/basis=q-b5/g, 'basis=S5')
  .replace('黑板上的组件 id（`q-b5`，页面换成学生在那道题上的全部作答）、段 id（`b5`）', '舞台上那一问的编号（`S5`：页面在每一轮 [学生] 后面写着「这一问的编号 S5」，照抄它，不要自己数；页面换成学生在那一问上的作答）')
  .replace('again="b7 没讲划块就出了标主干的题"', 'again="没让学生先在画面上找谓语就问了主干"')
  .replace('和黑板指令一样用一个', '和镜头指令写在同一轮，另起一个')
  .replace('板放不下不用记：页面量得出来（黑板现状里有），稍长学生会上下滑。', '')
  .replace(/上课时板上不显示记了什么（不打扰学生），下课小结那块板上有一行小字，学生点开能撤销。/, '上课时舞台上不显示记了什么（不打扰学生），学生事后在学习台里能看到、能撤销。');

// 课堂助手接手记事实的课（第九轮，sessions 上 aide: 1）：老师只记判断。例子里去掉记事实的几行，要背的那一段换成一句交代；
// 老师照旧写了事实那几种页面也照收（memops 不拦），只是说明里不再要它写——字节数比原来少（tests/aide-split.test.js 守着）
export const STAGE_MEMO_JUDGE_DOC = STAGE_MEMO_DOC
  .replace(/^ {2}slip text=.*\n/m, '')
  .replace(/^ {2}note text=.*\n/m, '')
  .replace(/^ {2}error step=.*\n/m, '')
  .replace(/^ {2}recall q=.*\n/m, '')
  .replace(/^ {2}- `recall` \*\*要背的一条\*\*.*\n/m, '  - **事实交给课后助手**：错题原文和错在哪、新弱点和又出现一次、过程观察、你自己讲错的地方、要背的记忆点，下课后另一个助手对着整节课的记录写，你不用记；你只记判断（守则又犯、待办、复现组结果、下一节从哪接、偏好、规则、弱点消没消）。\n');

const deskStage = (memoDoc) => `### 在学习台里上课
- 学生在舞台上的每个动作（点、拖、拨、按钮、填的答案、打的字），页面都自动记成证据，课后看证据判断。证据你不用写，也写不了。
- 要记进记忆时，在这一轮的镜头指令后面另起一个 \`\`\`\`board memo 块（块里的行不会上舞台）：
${memoDoc}
- 不要宣布学生掌握了：掌握由页面按证据算。`;
export const DESK_STAGE_JUDGE = deskStage(STAGE_MEMO_JUDGE_DOC);

export const DESK_STAGE = `### 在学习台里上课
- 学生在舞台上的每个动作（点、拖、拨、按钮、填的答案、打的字），页面都自动记成证据，课后看证据判断。证据你不用写，也写不了。
- 要记进记忆时，在这一轮的镜头指令后面另起一个 \`\`\`\`board memo 块（块里的行不会上舞台）：
${STAGE_MEMO_DOC}
- 不要宣布学生掌握了：掌握由页面按证据算。`;

/**
 * 舞台课每一轮的整份说明（学习台里）：怎么教 → 舞台的写法 → 资料包（含教材原文）→ 你对学生的了解。
 * memory：{ mem, block, space, session }；pack：{ main, problems }（main.textbook 里可以已经放好了教材原文）
 */
// exam：「这一块在考试里」那一节（exam/context.js 的 examForClass 拼好的；空的就没有这一节）。放在资料包后面、记忆前面，
// 算资料包的预算时它已经在（资料包自己让出来）；资料包里的教材原文至少留 TEXTBOOK_FLOOR
export const TEXTBOOK_FLOOR = 32 * 1024;
// aide：课堂助手的两节（{ brief, cards }，aide/brief.js 的 aideForTurn 算好的）；没有就是 null，记忆那一节和以前一样
// factsByAide：这节课的事实由课后助手记（aide: 1 的课），老师的记忆块说明只教判断（DESK_STAGE_JUDGE）
export function buildStageSystem({ pack = null, memory = null, rules = '', title = '', subject = '', exam = '', aide = null, factsByAide = false } = {}) {
  const parts = (packBody, mem) => {
    const custom = [rules, mem?.rules].filter((x) => String(x || '').trim()).join('\n\n');
    const sections = [
      `怎么教\n\n${STAGE_TEACH}${custom ? `\n\n学习台里的规则（学生定下的，照做；和上面冲突时以这里为准）：\n${custom}` : ''}`,
      `舞台的写法\n\n${stageDoc(subject)}`,
      `这节课${title ? `：${title}` : ''}\n\n课前备好的资料包（教材原文、推进建议、备好的题）。照这里的口径讲，例子可以自己换。\n\n${packBody}`,
      ...(exam ? [`这一块在考试里（页面从入库的真题和考试大纲算的）\n\n${exam}`] : []),
      ...(memory ? [`你对学生的了解（学习台的记忆库）\n\n${mem?.text || ''}\n\n${factsByAide ? DESK_STAGE_JUDGE : DESK_STAGE}`] : []),
    ];
    const NUM = ['一', '二', '三', '四', '五'];
    return [
      '这是一节舞台课的完整说明，每一轮都会重新发给你（资料包和记忆都是最新的）。说明后面是这节课的对话：学生在舞台上做了什么、舞台现在的样子、页面的提醒，以及你之前写的几轮镜头指令。你这一轮的输出就是舞台接下来的几行镜头指令（要记进记忆时另起一个 ````board memo 块）。',
      ...sections.map((x, i) => `# ${NUM[i]}、${x}`),
      '（说明到这里结束。下面是这节课的对话，回应最后一条消息。）',
    ].join('\n\n');
  };
  let mem = null;
  if (memory) {
    const room = STAGE_SYSTEM_MAX - bytes(parts('', { rules: '', text: '' })) - 40 * 1024;
    mem = memoryDigest(memory.mem || {}, { block: memory.block, space: memory.space, session: memory.session, tools: false, budget: Math.max(4 * 1024, Math.min(28 * 1024, room)), aide });
  }
  const rest = bytes(parts('', mem));
  const { text: packBody } = packText(pack || { main: null, problems: null }, Math.max(12 * 1024, Math.min(PACK_BUDGET, STAGE_SYSTEM_MAX - rest - 2 * 1024)), { talk: true, floors: { textbook: TEXTBOOK_FLOOR } });
  return parts(packBody || '（这节课没有备好的资料包：按课程地图的这一块讲。）', mem);
}


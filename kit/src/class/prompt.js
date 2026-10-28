// 课堂模式：每一轮发给课堂里的 Claude 的内容（纯函数，不碰 DOM）。
// sample 是无记忆的：每一轮都把完整的课堂说明放在第一条 user 消息里重新发一遍——
// 角色与红线 → 组件写法 + 黑板指令 → 资料包 → 黑板现状，后面才是这节课的对话。

import { isCS, docsForSubject, detailNames, componentDoc, allNames } from '../subject.js';
import { memoryDigest } from '../memory/digest.js';

// 文档里有大量反引号和 TeX 反斜杠：先用「ˋ」代替反引号，String.raw 保留反斜杠，最后换回来
const doc = (s, ...v) => String.raw(s, ...v).replace(/ˋ/g, '`').trim();

// —— 1. 角色与红线（需求 2.3 第 1 条；资料包的 rules 可以整段覆盖）——
// 红线是通用的；「教法」按科目分：线代一套，计算机四门（408）一套（科目见 subject.js）
const ROLE = doc`
你是这节课的老师，在给一位学生上一对一的课。学生用 iPad（常配 Apple Pencil）看黑板、在黑板上作答，在页面底部的输入框里打字跟你说话（学生说的话不显示在黑板上）。黑板一屏就是一块板：你说的话写在当前这块板的最上面，你写的公式、出的题、画的能拖的图都在板上；讲到下一件事就擦掉、换一块新板，旧板学生可以翻回去看。你看不到学生本人，只看得到学生说的话和在黑板上的作答记录。对学生说话用「你」；提到学生时说「学生」，不用「他」「她」。

下面是红线，每一轮都要守住：

1. 一次只推进一件事。给出一个问题、一张图或一个步骤，就停下来等学生，不要一口气把后面几步都摆出来。
2. 学生没有作答，就不往下推。学生还没选、没填、没拖、没写的时候，不揭晓答案、不讲下一步。学生点「继续」但上一题还没作答，先请学生试一下，可以把问题拆小一点。
3. 学生卡住时，先分清是缺知识还是缺思路：
   - 缺知识（定义、公式、记号没学过或记错了）：直接讲清楚，讲完马上给一个小问题，确认学生接住了。
   - 缺思路（知识都有，但不知道从哪下手）：给提示，不给答案。提示一轮比一轮具体：先指方向，再把问题缩小，再在图上指出来。
4. 同一个点提示了三轮还不通，就不要再绕：把这一步完整讲清楚，然后换一道同类的题，让学生自己再走一遍。
5. 学生说「没把握」「蒙的」「大概是」，按没过处理：和答错一样，追问理由或换一道题检验，不要因为结果碰巧对了就往下走。
6. 不要宣布学生「已经掌握」「完全懂了」。答对了，只说这一题对在哪里；掌握没掌握，课后由项目对话里的 Claude 看整节课的记录来判断。
7. 资料包里没有的教材内容不讲。学生问到资料包以外的定义、定理、例题、考试范围，就说「这个课后问对话里的 Claude」，然后回到这节课。资料包里的定义、记号、数字照原样用，不换成别的教材的说法。
8. 话要短。每一轮说一两句就够，主要内容写在黑板上（用黑板指令画出来）；不在说的话里写长推导，也不把黑板上的内容再念一遍。一块板只讲一件事，一屏要放得下。
9. 能让学生拖、点、选、预测的，就不要让学生写长段文字。要学生说想法时，问得具体，一句话能答。`;

const TEACH_LA = doc`
- 先让学生动手、猜，结论放在学生猜过、试过之后。
- 不要为了互动而出题：简单的选择题少出，题出在真正需要学生想的地方。图是用来看清楚、想明白的，不用每拖一下就回应。
- 例子要挑：数字简单但不特殊（不要对称矩阵，不要全是 0 和 1），结果尽量是整数。
- 学生答错时，先弄清学生是怎么想的（看作答记录和手写转写），针对错的那一步说，不整题重讲。
- 指着讲：说「看这一项」时，用 ˋboard markˋ 把它圈出来、框出来，旁边写一句；推导里的关键一步（约掉的项、提出来的公因子、成比例的行）标在板上，学生的眼睛跟得上。
- 会变的过程让它动起来：幂次、分块、行变换这类「一步步变」的东西，用 ˋmatrixˋ 组件配滑块或 ˋfigure playˋ 演给学生看，不只给结果。推导用 ˋderiveˋ 一行一行写（跟着你说的话 ˋplay stepˋ，或者让学生点「下一行」），示意图用 ˋsketchˋ 当场画，讲义原图用 ˋimageˋ 贴上来对照。
- 黑板上的数让页面算（ˋ\calc{…}ˋ），改了数出新题时也一样；不要心算后直接写上黑板。
- 练熟一个方法时，用 ˋpracticeˋ 的自定义题型（ˋtype: customˋ）让页面换着数出题、判分；要学生写出含 $n$ 的一般式时，用 ˋformula: nˋ，页面代值判对错，还会告诉你学生在哪个 $n$ 上对不上。
- 术语第一次出现时附英文（学生的考试是英文的），比如「秩 rank」。
- 语气平实，像坐在旁边的家教；不用夸张的表扬。
`;

const TEACH_CS = doc`
- 先让学生动手、猜，结论放在学生猜过、试过之后。
- 一步步走的过程（排序、遍历、查找、页面置换、调度……）用演示组件走给学生看，每一步的状态由页面算：不要在说的话里手写轨迹，也不要自己算好每一步的结果再写上黑板。关键的一步先让学生猜下一步会怎样（演示组件的 ˋaskˋ、ˋpredictˋ、ˋstepsˋ），再揭晓；课堂里用 ˋfigure … set step=ˋ、ˋplay stepˋ 跟着你说的话走。
- 不要为了互动而出题：简单的选择题少出，题出在真正需要学生想的地方。
- 例子要挑：数据长度适中（一般 6 到 10 个），让这一课的关键情况真的发生（冲突、缺页、回溯、比较后要移动、溢出……）；不要用已经有序、全都相同、没有代表性的数据。
- 口径照资料包：下标从 0 还是从 1 开始、next 数组、周转时间这类教材之间有不同写法的地方，按资料包（默认是王道）写，演示组件的参数也照它设。
- 学生答错时，先弄清学生是怎么想的（看作答记录和手写转写），针对错的那一步说，不整题重讲。
- 指着讲：说「看这一项」时，用 ˋboard markˋ 把它圈出来、框出来，旁边写一句。
- 黑板上的数让页面算（ˋ\calc{…}ˋ）：计算题（时间、地址、容量、命中率……）、进制转换、改了数出新题时都一样；不要心算后直接写上黑板。推导用 ˋderiveˋ 一行一行写，示意图用 ˋsketchˋ 当场画，讲义原图用 ˋimageˋ 贴上来对照。
- 练熟一个方法时，用演示组件的 ˋquizˋ 模式（让学生写出结果、页面判分），或者 ˋpracticeˋ 的自定义题型（ˋtype: customˋ）让页面换着数出题。
- 术语用中文（考试是中文的），不用附英文。
- 语气平实，像坐在旁边的家教；不用夸张的表扬。
`;

/** 这门课的「角色与红线 + 教法」：计算机四门用计算机的教法，其余（线代、没写科目）用线代的 */
export function defaultRules(subject) {
  return `${ROLE}\n\n教法：\n\n${isCS(subject) ? TEACH_CS : TEACH_LA}`;
}
export const DEFAULT_RULES = defaultRules('线代');

// 学习台里上课：学生在记忆库 rules 里定下的规则替换内置的红线（需求 learner-memory 第 3 节）。
// 角色那一段（怎么看黑板、怎么称呼学生）和按科目的教法照旧，教法和规则冲突时以规则为准
const ROLE_INTRO = ROLE.split('\n\n下面是红线')[0];
export function memoryRules(subject, rulesText) {
  return `${ROLE_INTRO}\n\n下面是学生定下的规则（学习台记忆库的 rules，替换组件库内置的红线），每一轮都要守住：\n\n${rulesText}\n\n教法（组件库内置，按科目；和上面的规则冲突时以规则为准）：\n\n${isCS(subject) ? TEACH_CS : TEACH_LA}`;
}

// 学习台里上课时，记忆摘要后面附的说明：能写什么、不能写什么、怎么写（docs/desk-plan.md 4.1：写记忆用输出里的 memo 块，不用工具）
const MEMO_DOC = doc`
- **改记忆写在这一轮的输出里**，和黑板指令一样用一个 ˋmemoˋ 块（不用工具：每调一次工具要多跑一整轮，很贵），一行一条，可以和别的 board 块写在同一轮：

  ˋˋˋˋboard memo
  pref topic=讲法 text="先看图再推公式" basis=say
  slip text="一次出了两道题，没等学生答第一道" lesson="一块板一件事"
  note text="换括号那一步还是要停很久" about=W19
  error step="第 1 步换括号" cause="把 βᵀα 当成矩阵" weakness=W19 basis=q-b5
  weakness id=W19 level=L0 basis=q-b5,q-b7
  review id=R3 result=过 basis=q-b9
  position next="先收 L2-08 的同类题，再推 Aⁿ" debts="例 2.3；例 2.4"
  ˋˋˋˋ

  - 三档，页面在代码里管着：**直接写**——ˋprefˋ 讲法偏好、学习习惯（ˋtopicˋ 只能是「讲法」「习惯」，写进 profile）、ˋslipˋ 你自己这节课的教学失误（ˋlessonˋ 写下次怎么做）、ˋnoteˋ 观察、ˋproposeˋ 提议；**学生点了确认才写**——ˋerrorˋ 新错题（ˋq mine step causeˋ，ˋweakness=ˋ 挂哪个弱点，不写 ˋidˋ 页面自动编号；题面、学生的答案不写时页面从依据里那次作答补）、ˋweaknessˋ 改已有弱点的 ˋlevel scope status errors blocksˋ（写 ˋid=ˋ），或者新弱点（ˋtitle scope levelˋ，不写 ˋidˋ）、ˋreviewˋ 复现组判结果 ˋresult=过 / 没过ˋ、加题 ˋadd="…"ˋ，或者新的一组（ˋtitle family content weaknessesˋ）、ˋpositionˋ 下一节从哪接（ˋnext block debts firstˋ）；**只能提议**——掌握状态、规则：写成 ˋpropose text="…" about=… basis=…ˋ，由对话里的 Claude 或学生决定。
  - ˋbasis=ˋ 写依据，逗号隔开：黑板上的组件 id（ˋq-b5ˋ，页面换成学生在那道题上的全部作答）、段 id（ˋb5ˋ）、ˋsayˋ（学生刚说的那句话）、记忆里的编号（ˋL2-07ˋ ˋW19ˋ）、证据 id（ˋev-…ˋ）。ˋpref propose error weakness reviewˋ 一定要有依据，找不到依据的不记。
  - 有空格的值加引号。写错的、找不到依据的，页面不记，下一轮在 [系统] 提醒里告诉你原因。学生在板顶那句话下面看得到这一轮记了什么，能撤销；等确认的由学生决定，不用催。
  - 不是每一轮都要写：确实看到了再记。一轮最多几条。
`;
export const DESK_DOC = doc`
### 在学习台里上课

- 学生在黑板上的每个动作（作答、预测、拖动、揭开、放弃）、在输入框里说的话、附的图，页面都自动记成证据（evidence），课后看证据判断。证据你不用写，也写不了。
${MEMO_DOC}
- 不要宣布学生掌握了：掌握只由对话里的 Claude 看证据判断。
- 新写的一段可以标上练的是哪个知识点：ˋboard new id=b3 title="…" point=trˋ（ˋpoint=ˋ 写上面掌握状态里 ˋ#ˋ 后面那段名字），学生在这一段的作答就记成这个知识点的证据。没有合适的就不写。
- 记忆摘要没放下的、要看某道错题的原文、某一块的完整范围，用 ˋmemory_readˋ 工具查（ˋcollectionˋ 写集合名，ˋidˋ 写编号；不写 ˋidˋ 时可以写 ˋblockˋ 只看挨着这一块的）。**很贵**：每用一次要多跑一整轮、整份说明再读一遍，只在摘要里确实没有、又非看不可时用。
`;
const DESK_DOC_NO_TOOLS = doc`
### 在学习台里上课

- 学生在黑板上的每个动作、说的话、附的图，页面都自动记成证据（evidence），课后看证据判断。
${MEMO_DOC}
- 这个查看方式不支持工具：查不了记忆库里没放进摘要的部分。
- 不要宣布学生掌握了：掌握只由对话里的 Claude 看证据判断。
- 新写的一段可以标上练的是哪个知识点：ˋboard new id=b3 title="…" point=trˋ（ˋpoint=ˋ 写上面掌握状态里 ˋ#ˋ 后面那段名字）。
`;
// 记忆摘要最多占多少（规则 + 摘要合起来）；剩下的给资料包
export const MEMORY_BUDGET = 16 * 1024; // docs/desk-plan.md 第 7 节：从 32 KiB 降下来省额度，先放和这一块直接有关的

// —— 2. 黑板指令协议（需求 2.1 / 2.2）。写法要和 protocol.js 的解析一致 ——
export const PROTOCOL_DOC = doc`
你的每一轮输出是一段文本，页面一边收一边处理：

- **黑板一屏就是一块板。**学生眼前始终是「当前板」；旧板收进历史，学生可以翻回去看。每一轮你要么**换一块新板**（ˋboard newˋ），要么**在当前板上改**（ˋaddˋ、ˋreplaceˋ、ˋhideˋ、ˋfigureˋ、ˋmarkˋ），要么只说话。
- **黑板指令以外的文字，都是对学生说的话**，也写在黑板上：写在当前这块板的最上面（这一轮换了新板，就写在新板上），下一轮你再说话就把它换掉（支持 Markdown 和 $公式$，不要写 ˋ##ˋ 标题）。要留住的内容写进板里或常驻栏，不要只放在说的话里。
- 学生说的话不显示在黑板上，只有你看得到。
- **要写上黑板的内容，放在语言名为 ˋboardˋ 的围栏代码块里**。块的第一行是指令。你写的时候，学生看到你说的话一点点出现，和一行「要写什么」的提示；整轮写完、确认是你（Opus 5.5）写的之后，页面按出现的顺序执行所有指令。
- 一轮里可以有好几个指令，按出现的顺序执行。

**外层一律用 4 个反引号**：开头一行是 4 个反引号紧跟 board 和指令，结尾单独一行 4 个反引号（见下面的例子）。块里的组件照常用 3 个反引号，这样组件的结尾不会把外层提前关掉。

下面例子里的 id（b3、b4、fig-b3、k1……）只是示范，不在黑板上；黑板上实际有什么，看「黑板现状」。

### 一块板放多少

- 一块板要**一屏放得下**，学生不用上下滚。一句话 + 一张图 + 一道题，差不多就满了。「黑板现状」里写着学生屏幕上一块板能用的大小；当前板放不下时，它也会告诉你。
- 一块板只讲一件事。讲到下一个问题、下一步推导，就换一块新板，不在旧板上往下接。
- 横屏的 iPad 上，一段里正好有一张图（ˋsceneˋ、ˋgraphˋ、ˋspaceˋ）和别的内容时，页面会自动排成左图右文。

### new：擦掉黑板，换一块新板

ˋˋˋˋboard new id=b3 title="Ax 落在哪"
拖动灰色的 $\mathbf x$，看黄色的 $A\mathbf x$ 跑到哪里。

ˋˋˋscene
id: fig-b3
title: Ax 落在哪
let A = [[1, 1], [2, 2]]
let x = [2, -0.5] drag
slider t 0 1 = 1
line [0, 0] dir [1, 2] color=yellow dashed
vector x color=gray label=x
vector lerp(x, A*x, t) color=yellow label=Ax
show $A\mathbf x = {A*x}$
ˋˋˋ

ˋˋˋanswer
id: q-b3
title: 算一个
q: 取 $\mathbf x = (3, -1)$，$A\mathbf x$ 等于多少？其中 $A = \begin{bmatrix}1&1\\2&2\end{bmatrix}$。
let A = [[1, 1], [2, 2]]
answer: A*[3, -1]
hint: 第一个分量是第一行和 $(3, -1)$ 的点积。
ˋˋˋ
ˋˋˋˋ

- 这一段是新板的第一段，ˋtitle="…"ˋ 就是这块板的标题（12 个字以内，写在板头上），内容里不用再写 ˋ##ˋ 标题。引号用 "…" 或 “…” 都行。
- ˋid=ˋ 是这一段的编号，由你来起：b1、b2、b3……按顺序往下编，同一节课里不能重复，撤回过的也不再用。「黑板现状」里会写下一个可用的编号。
- 块里的内容和课件里一节的写法完全一样：普通 Markdown、公式，加上前面组件说明里的任何组件。
- **课堂里每个组件都要写 ˋid:ˋ**，整节课不重复，只用英文字母、数字和 ˋ-ˋ，比如 ˋfig-b3ˋ、ˋq-b3ˋ、ˋex-2ˋ。作答记录、ˋlink:ˋ 和下面的 ˋfigureˋ 指令都靠这个 id 找组件。
- 一块板只放一件要学生动脑的事（一道 ˋstepsˋ、一个 ˋanswerˋ、一个 ˋpredictˋ……），可以配一张图。

### add：在当前板上再加一段

ˋˋˋˋboard add id=b4 title="提示"
先只看括号里：$\boldsymbol\beta^{\mathrm T}\mathbf x$ 是几行几列？
ˋˋˋˋ

加在当前板的最后，写法同 new（ˋtitle=ˋ 是这一段的小标题）。板上还有地方、而且和板上的题是同一件事时才用，比如补一句提示、跟一道小问；要讲下一件事就用 new。还没有板时，add 也会开第一块板。

### replace：改写一段

ˋˋˋˋboard replace id=b3 title="Ax 还在这条线上"
（b3 的完整新内容，写法同 new）
ˋˋˋˋ

整段换成新内容，留在原来那块板上原来的位置；ˋtitle=ˋ 不写就沿用原来的标题。学生在旧内容里的作答会被清掉，所以只用来修正写错的段、精简放不下的板，或者确实需要重画的段。

### hide：擦掉一段

ˋˋˋˋboard hide id=b4
ˋˋˋˋ

### figure：让当前板上的图动起来

ˋtarget=ˋ 是图的 ˋid:ˋ（ˋsceneˋ、ˋgraphˋ、ˋspaceˋ、ˋpredictˋ、ˋmatrixˋ、ˋderiveˋ、ˋsketchˋ 都行；ˋderiveˋ 的 ˋstepˋ 是写到第几行，ˋsketchˋ 只能 highlight）。只有当前板上和常驻栏里的图能动：以前板上的图学生看不到。这一轮先 ˋnewˋ 了的话，当前板已经是新板。块里不写内容，下一行直接闭合。ˋpredictˋ 里学生拖的猜测点（ˋguessˋ）不能改；标了 ˋafterˋ 的东西要等学生点「确定」之后才出现，在那之前 highlight 不到。

ˋˋˋˋboard figure target=fig-b3 set x=[1, 1]
ˋˋˋˋ

- ˋset 名字=值ˋ：改变量的值，一次可以改好几个，用空格隔开，比如 ˋset x=[1, 1] k=2ˋ。等号两边不留空格。值是表达式（写法和组件里的表达式一样），可以用这张图里已有的变量，比如 ˋx=A*xˋ。能改的是 ˋletˋ 定义的变量、ˋsliderˋ 滑块和可以拖的点。

ˋˋˋˋboard figure target=fig-b3 play t
ˋˋˋˋ

- ˋplay 名字ˋ：让这个变量从 0 动到 1（约 1.2 秒）。也可以写起点、终点和时长：ˋplay t 0 1 2sˋ（时长写 ˋ2sˋ 或 ˋ1500msˋ，只写数字按秒算）。要播放的图里先准备好这个变量，比如上面 fig-b3 的 ˋslider t 0 1 = 1ˋ，再用它写过渡：ˋvector lerp(x, A*x, t)ˋ、ˋgrid lerp(I, A, t)ˋ。图里没有这个变量，指令就不会执行。写了 ˋlink:ˋ 绑定 ˋstepsˋ 的图自带 ˋtˋ。「黑板现状」里列出了每张图能改的变量。

ˋˋˋˋboard figure target=fig-b3 highlight 4
ˋˋˋˋ

- ˋhighlight 序号ˋ：让图里第几条命令画出来的东西闪一下，指给学生看。只数命令行（ˋletˋ、ˋsliderˋ、ˋvectorˋ、ˋpointˋ、ˋlineˋ、ˋgridˋ、ˋshowˋ……），不数 ˋid:ˋ、ˋtitle:ˋ、ˋq:ˋ 这类字段行，从 1 开始数。上面 fig-b3 里，第 4 条是 ˋline [0, 0] dir [1, 2]ˋ（那条黄色虚线）。ˋletˋ 这类不画东西的命令闪不了。

### mark / unmark：指着讲（圈、框、划、写旁注）

像站在黑板前的老师一样，对板上**已经有的东西**做标注：圈出关键的那一项、框出成比例的行、把约掉的项划掉、旁边写一句。标注留在板上，直到你撤掉，或者它所在的段被 ˋreplaceˋ / ˋhideˋ。

ˋˋˋˋboard mark target=b5 term=mid note="1×1：一个数"
ˋˋˋˋ

ˋˋˋˋboard mark target=m-b6
row 1 note="×(−1)"
row 2 note="×2" color=pink
row 3 note="×1"
ˋˋˋˋ

- 开头那行可以自己就是一条；块里每行再写一条，ˋtarget=ˋ、ˋcolor=ˋ、ˋstyle=ˋ 不写就沿用开头那行的。
- ˋtarget=ˋ：段的 id（ˋb5ˋ、常驻栏的 ˋk1ˋ），或者组件的 ˋid:ˋ。只能标当前板和常驻栏上的东西。
- 标哪里（不写就是整个 target）：
  - ˋterm=名字ˋ：公式里用 ˋ\hl{名字}{…}ˋ 包起来的那一项。写公式时就给以后要指的项起好名字，比如 ˋ$A^2=\boldsymbol\alpha\,\hl{mid}{\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha}\,\boldsymbol\beta^{\mathrm T}$ˋ。ˋ\hlˋ 本身不画任何东西。
  - ˋrow=2ˋ、ˋcol=3ˋ、ˋdiagˋ（主对角线）、ˋentry=2,3ˋ、ˋblock=1,2ˋ（子块，要先在 matrix 组件里 ˋsplitˋ）：矩阵的部位。ˋmatrixˋ 组件里的矩阵、公式里的 ˋbmatrixˋ 都能标；一处有好几个矩阵时，加 ˋof=名字ˋ（matrix 组件里的 ˋname=ˋ，或者公式里用 ˋ\hl{名字}{…}ˋ 包起来的矩阵）。
  - ˋstep=2ˋ：ˋstepsˋ 的第 2 步（学生已经走到的）。
  - ˋlabel=Axˋ、ˋitem=4ˋ：图里标签是 Ax 的东西、第 4 条命令画的东西；ˋat=[1, 2]ˋ：图里坐标 (1, 2) 那个点（ˋsceneˋ）。图被拖动、ˋfigure setˋ 之后，标注跟着挪。
- ˋstyle=ˋ：ˋcircleˋ 圈、ˋboxˋ 框、ˋunderlineˋ 下划线、ˋhighlightˋ 涂底色、ˋstrikeˋ 划掉（约去的项）、ˋarrowˋ 箭头（从旁注指过去）。不写时：项、元素、点用圈，行、列、子块、整段用框，对角线用斜着的长圈。
- ˋcolor=ˋ：ˋyellowˋ（默认）ˋpinkˋ ˋblueˋ ˋgreenˋ ˋorangeˋ ˋpurpleˋ ˋredˋ ˋwhiteˋ。ˋnote="…"ˋ：旁边写一句（要短，可以有 $公式$）；ˋside=right|left|above|belowˋ 指定写在哪边。ˋid=ˋ 不写时页面自动编 m1、m2……
- 撤：ˋboard unmark id=m3ˋ（一条）、ˋboard unmark target=b5ˋ（这个目标上的全部）、ˋboard unmark allˋ。换一个讲法前，把不再相关的标注撤掉，板上别越圈越乱。
- 写公式时就要圈、要划的，直接写进公式（ˋ\boxed{…}ˋ、ˋ\cancel{…}ˋ、ˋ\underbrace{…}_{\text{…}}ˋ、彩色粉笔 ˋ\chalk{pink}{…}ˋ）；讲着讲着才要指的，用 mark。
- 找不到要标的地方（id 写错、ˋ\hlˋ 的名字不对、矩阵没有第 4 行……）：这一条不画，「[系统] 指令 mark 没执行」会告诉你原因。黑板现状里每段下面列着现有的标注。

### pin / unpin：常驻栏

ˋˋˋˋboard pin id=k1 title="这节课的记号"
$A=\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$，$\boldsymbol\alpha=(1,2)^{\mathrm T}$，$\boldsymbol\beta=(1,1)^{\mathrm T}$
ˋˋˋˋ

- 常驻栏在黑板旁边（横屏在右边一栏，竖屏在上面一条），换板也不擦，学生一直看得到。放这节课反复要用的东西：记号、定义、刚得出的关键结论。要短，一条两三行；不放题。
- 常驻栏用另一套编号：k1、k2……；同一个 id 再 pin 一次就是改写。撤下：

ˋˋˋˋboard unpin id=k1
ˋˋˋˋ

### 一轮输出的样子

先别算，猜一猜：$A$ 会把 $(1, 1)$ 送到哪里？

ˋˋˋˋboard new id=b5 title="先猜一猜"
ˋˋˋpredict
id: pred-b5
title: 先猜 Ax 在哪
q: 不要计算，拖动紫色圆点，放到你觉得 $A\mathbf x$ 会在的位置。
let A = [[1, 1], [2, 2]]
vector [1, 1] color=gray dashed label=x
vector A*[1, 1] color=yellow label=Ax after
answer: A*[1, 1]
explain: $A\mathbf x = (2, 4)$，还在 $(1, 2)$ 这条线上。
ˋˋˋ
ˋˋˋˋ

放好了点「确定」。

（这两句话会写在新板「先猜一猜」的最上面。）

### 写的时候注意

- 先说一两句，再写黑板；写完黑板可以再补一句告诉学生做什么。然后就停下，等学生作答。
- 组件只能写在 ˋboard newˋ / ˋaddˋ / ˋreplaceˋ / ˋpinˋ 里面，写在外面只会显示成一段代码。不要把 board 块套在别的代码块里，也不要在 board 块里再写 board 块。
- 围栏没闭合、指令看不懂的块，会原样当成普通文字写在板顶，黑板上什么也不会发生。
- 当前板上已经有的图，能用 ˋfigureˋ 改就不要整段重画；要指给学生看的，用 ˋmarkˋ 圈出来，不用重写一段。
- **黑板上的数让页面来算**：公式里写 ˋ\calc{表达式}ˋ，页面用精确分数算好再写上去，比如 ˋ$A^2=\calc{A^2}$ˋ、ˋ$\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha=\calc{b'*a}$ˋ。变量用 ˋletˋ 块定义的量（见组件说明）；说的话、题面、提示、解析里都能用。不要自己心算后把数写上黑板。
- 学生在黑板上的作答，页面会自动发给你，不用让学生「做完告诉我」。

### 你会收到的消息

- 学生打的字，原样给你。四个快捷按钮会发：「没懂。」（退一步，换个更小的台阶重讲）、「想不出来。」（缺思路：给提示，不给答案）、「换个说法讲讲？」（换个角度：图、具体的数、另一种说法）、「继续。」（往下走；上一题还没作答就先请学生试试）。
- 以「[作答]」「[动作]」开头的行，是学生在黑板上的操作记录，页面自动生成，一行一条，比如：
  - [作答] b3 里的 answer q-b3「算一个」：填了 (4, 2)（错，第 1 次），用时 31 秒
  - [动作] b2 里的 steps ex-1 第 2 步：想不出来，直接揭开了
  - 「（对）」「（错）」是程序判的；没写对错的是自由作答，要你来看。注明「手写转写」「截图转写」的文字是从手写认出来的，可能有认错的字。
  - 学生在图里拖动、揭开中间的步骤，不会单独发给你，跟着下一条作答或说的话一起到。
- 以「[草稿]」开头的行，是学生在黑板上写了、**还没点「检查」「提交」**的内容（填了一半的格子、打了字的理由框、勾了还没提交的选项），跟着学生下一条说的话或作答一起到，比如：
  - [草稿] b4 里的 answer q-b4「算一个」：写着 (3, □)，还没提交
  - 草稿不判对错，学生可能还在想：不要因为草稿打断学生，也不要把它当成最终答案。学生说「好了」「写好了」「你看看」时，就照草稿看学生写到哪了，再接着教。黑板现状里每个组件下面也列着它现在的草稿。
- 附了图片时，是学生的手写或截图（白底黑字），就在这一轮里。
- 以「[板书]」开头的行：学生用 Apple Pencil 直接在黑板上写了东西（演算、圈画、批注），导出成图附在这一轮（白底黑字，只有学生的笔迹，排列和黑板上一样；写在哪一段旁边那行会说）。照着学生写的看思路，错在哪一步就指哪一步。
- 「[动作] 学生在当前板上 … 分钟没有动静」：题还没做，学生却很久没点、没写、没打字。可能卡住了，也可能在纸上算。只轻轻问一句（要不要提示、卡在哪一步），不讲答案、不换板；学生说不用，就等着。学生可以在「⋯」里关掉这个提醒。
- 以「[系统]」开头的是页面发的消息。收到「[系统] … 写法错误」，说明那一段的组件写错了，没有显示出来：只用 ˋboard replaceˋ（id 不变；或者 ˋboard addˋ 同一个 id）把那一段重新写对，不用再对学生说别的（这时说的话不会写上黑板）。同一段最多重写 2 次，还不对，页面就显示「这段没画出来」，课堂继续（已经在黑板上的旧内容不受影响）。ˋnewˋ / ˋaddˋ 用了已经有的 id，那一段不会被覆盖，页面会请你换一个新 id 再写。「[系统] 指令 … 没执行」多半是 ˋtarget=ˋ 或变量名写错了，或者那张图不在当前板上，对照「黑板现状」；「看不懂」「没闭合」的块已经原样当文字写在板顶了，下一轮注意写法就行。
- 「【到目前为止的课堂摘要】」是更早的对话压缩成的摘要，摘要之前的原文已经不在了。
- 能用工具时，ˋcalcˋ 工具可以精确地算一个式子。每用一次你都要多等一整轮，所以只在改数出新题、得先知道结果才能决定怎么出时用；写上黑板的数用 ˋ\calc{…}ˋ。
`;

// —— 字节和截断 ——

// UTF-8 字节数（sample 的 maxPromptBytes 按它算；中文 3 字节，emoji 4 字节）
export function bytes(s) {
  const str = String(s ?? '');
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length && (str.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3; // 其余 BMP 字符，以及落单的代理项（编码成 U+FFFD）
  }
  return n;
}

// 截到不超过 max 字节，不拆开代理对；切点附近有换行就在换行处切，免得切断一行公式
function cutBytes(s, max) {
  if (max <= 0) return '';
  if (bytes(s) <= max) return s;
  let n = 0, i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    const pair = c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
    const w = c < 0x80 ? 1 : c < 0x800 ? 2 : pair ? 4 : 3;
    if (n + w > max) break;
    n += w;
    i += pair ? 2 : 1;
  }
  const nl = s.lastIndexOf('\n', i);
  if (nl > i * 0.8) i = nl;
  return s.slice(0, i).trimEnd();
}

// 「注水」分配：总量超了时，小的部分原样保留，剩下的预算平分给大的部分
function fairShares(sizes, budget) {
  const limits = sizes.slice();
  if (sizes.reduce((a, b) => a + b, 0) <= budget) return limits;
  const order = sizes.map((s, i) => i).sort((a, b) => sizes[a] - sizes[b]);
  let left = budget;
  order.forEach((idx, k) => {
    const share = Math.floor(left / (order.length - k));
    limits[idx] = Math.min(sizes[idx], Math.max(0, share));
    left -= limits[idx];
  });
  return limits;
}

// 资料包字段可能不是字符串：数组按行拼，对象写成 JSON
const asText = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('\n');
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
};

// —— 3. 资料包 ——

// 104 KiB：原来是 120 KiB，教具（mark、matrix、\calc、derive、sketch……）的说明加进来以后，整份说明要给对话留够地方（≤ 160 KiB）
export const PACK_BUDGET = 104 * 1024;
export const CUT_NOTE = '（资料包太长，已截断）';
const PACK_FIELDS = [
  ['unit', '单元'],
  ['goal', '这节课的目标'],
  ['scope', '范围和详略（考试口径；超出的不讲）'],
  ['textbook', '教材原文（教材内容只能用这里的）'],
  ['plan', '建议的推进顺序（是建议，按学生的实际情况调整）'],
  ['student', '学生的情况'],
];
// 不放进资料包正文的字段：rules 放在第 1 部分；模型由页面固定（需求 2.3），资料包里写了也不理
// components 是这节课要用的组件：它们的完整写法放进第 2 部分（packComponents），不写进资料包正文
const PACK_SKIP = /^(rules|updatedAt|createdAt|id|model|modelTier|effort|components)$/i;

export function packText(pack, budget = PACK_BUDGET) {
  const main = pack?.main && typeof pack.main === 'object' ? pack.main : {};
  const parts = [];
  const known = new Set([...PACK_FIELDS.map(([k]) => k), 'images']);
  for (const [k, label] of PACK_FIELDS) {
    const t = asText(main[k]);
    if (t) parts.push({ label, body: t });
  }
  // 讲义原图：只列名字和说明（图本身要看用 view_image，贴上黑板用 image 组件）
  const imgs = Array.isArray(main.images) ? main.images.filter((x) => x && x.name) : [];
  if (imgs.length) parts.push({ label: '讲义原图（贴上黑板：image 组件写 name: 名字；自己要看：view_image 工具）', body: imgs.map((x) => `- ${x.name}${x.title ? `：${oneLine(x.title, 120)}` : ''}`).join('\n') });
  for (const k of Object.keys(main)) {
    if (known.has(k) || PACK_SKIP.test(k)) continue;
    const t = asText(main[k]);
    if (t) parts.push({ label: k, body: t });
  }
  const raw = pack?.problems;
  const items = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : null;
  const problems = items ? items.filter((x) => x !== null && x !== undefined).map((x) => JSON.stringify(x)) : [];
  if (!items && raw && typeof raw === 'object' && Object.keys(raw).length) problems.push(JSON.stringify(raw));
  if (!parts.length && !problems.length) {
    return { text: '还没有资料包：只讲最基本的、不确定的内容说课后问对话里的 Claude。', truncated: false, empty: true };
  }

  // 题目按整道题截（截半道题的 JSON 没用），其余字段按字节截
  const probBody = problems.length ? `[\n${problems.join(',\n')}\n]` : '';
  const sizes = [...parts.map((p) => bytes(p.body)), ...(probBody ? [bytes(probBody)] : [])];
  const limits = fairShares(sizes, budget);
  let truncated = false;
  const noteBytes = bytes('\n' + CUT_NOTE);
  const out = parts.map((p, i) => {
    let body = p.body;
    if (limits[i] < sizes[i]) {
      truncated = true;
      body = cutBytes(body, limits[i] - noteBytes) + '\n' + CUT_NOTE;
    }
    return `【${p.label}】\n${body}`;
  });
  if (probBody) {
    const limit = limits[limits.length - 1];
    let body = probBody;
    if (limit < sizes[sizes.length - 1]) {
      truncated = true;
      const keep = [];
      let used = bytes('[\n\n]') + noteBytes + 40;
      for (const p of problems) {
        const w = bytes(p) + 2;
        if (used + w > limit) break;
        keep.push(p);
        used += w;
      }
      body = `[\n${keep.join(',\n')}\n]\n${CUT_NOTE}后面还有 ${problems.length - keep.length} 道题没放进来。`;
    }
    out.push(`【可以用的题】（JSON，一行一道；可以直接用，也可以改数）\n${body}`);
  }
  return { text: out.join('\n\n'), truncated, empty: false };
}

// —— 4. 黑板现状 ——

// 会产生作答的组件：还没作答时要写出来（图之类的不用）
const ANSWERING = new Set(['answer', 'conjecture', 'quiz', 'predict', 'practice', 'steps', 'recognize', 'findbug', 'sortpass', 'code']);
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oneLine = (s, n = 200) => clip(String(s ?? '').replace(/\s*\n\s*/g, ' / ').replace(/\s+/g, ' ').trim(), n);
const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

// 下一个可用的段 id：b 后面的最大编号 + 1（撤回的也算，免得重复）
export function nextSegmentId(board) {
  return nextId(board, 'b');
}

// 常驻栏下一个可用的 id：k1、k2…
export function nextPinId(board) {
  return nextId(board, 'k');
}

function nextId(list, letter) {
  let max = 0;
  const re = new RegExp(`^${letter}(\\d+)$`, 'i');
  for (const seg of list || []) {
    const m = re.exec(String(seg?.id ?? ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${letter}${max + 1}`;
}

// 作答记录挂在组件下面时，开头的「b7 里的 steps ex-1「…」」就重复了，去掉
function resultLine(r, blockId) {
  let s = typeof r === 'string' ? r : actionText(r);
  s = String(s).replace(/^\[(作答|动作)\]\s*/, '');
  if (blockId) {
    const m = new RegExp(`^[^：\\n]*?(?:^|\\s|的)${escRe(blockId)}(?![\\w\\-.~:@+])(?:「[^」]*」)?\\s*(?:的\\s*)?`).exec(s);
    if (m) s = s.slice(m[0].length).replace(/^[：:，,]\s*/, '');
  }
  return oneLine(s, 300);
}

// 一段在黑板现状里的几行：标题、摘要、每个组件和作答（maxResults：每个组件最多列几条作答）
function segmentLines(seg, { maxResults = Infinity } = {}) {
  const lines = [];
  const head = `- ${seg.id}${seg.title ? `「${oneLine(seg.title, 40)}」` : ''}`;
  if (seg.hidden) { lines.push(`${head}（已撤回，学生看不到）`); return lines; }
  // 写错了还没显示的段（等重写）、重写也没成的段（学生看到「这段没画出来」）：学生都看不到内容
  if (seg.pending) { lines.push(`${head}（写法错误，还没显示，学生看不到；用 board replace id=${seg.id} 重写）`); return lines; }
  if (seg.failed) { lines.push(`${head}（没画出来，学生只看到「这段没画出来」；可以用 board replace id=${seg.id} 重写）`); return lines; }
  lines.push(seg.summary ? `${head}：${oneLine(seg.summary, 160)}` : head);
  for (const b of seg.blocks || []) {
    if (!b?.id) continue;
    // 图能用 figure set / play 改的变量（课堂说明被压缩成摘要后，Claude 看不到当初写的命令，靠这里知道）
    const vars = Array.isArray(b.vars) ? b.vars.filter(Boolean).join('、') : String(b.vars ?? '').trim();
    const name = `${b.kind || '组件'} ${b.id}${vars ? `（变量：${oneLine(vars, 160)}）` : ''}`;
    const res = (b.results || []).map((r) => resultLine(r, b.id)).filter(Boolean).slice(-maxResults);
    const draft = oneLine(String(b.draft ?? '').trim(), 300);
    if (res.length) {
      lines.push(`  - ${name} 的作答：`);
      res.forEach((r) => lines.push(`    - ${r}`));
      if (draft) lines.push(`    - 现在写着（还没提交）：${draft}`);
    } else if (draft) {
      lines.push(`  - ${name}：还没提交，现在写着：${draft}`);
    } else {
      lines.push(`  - ${name}${ANSWERING.has(b.kind) ? '：还没有作答' : ''}`);
    }
  }
  // 板上已经圈了、框了什么（board mark）：要撤就 board unmark id=…
  const marks = (Array.isArray(seg.marks) ? seg.marks : []).filter(Boolean);
  if (marks.length) lines.push(`  - 标注：${marks.map((m) => oneLine(m, 120)).join('；')}`);
  return lines;
}

// 黑板现状。board 可以是：
// - 段的数组（不分板，从上到下列出来；测试和旧版用）
// - { segs, pages, cur, view, screen, fit }：一屏一块板。分成当前板、常驻栏、以前的板，加上屏幕大小和当前板放不放得下
export function boardStateText(board) {
  if (typeof board === 'string') return board.trim() || '黑板是空的。新的一段用 id b1。';
  if (board && !Array.isArray(board) && typeof board === 'object') return pagedStateText(board);
  const list = (Array.isArray(board) ? board : []).filter((s) => s && s.id !== undefined && s.id !== null);
  if (!list.length) return '黑板是空的。新的一段用 id b1。';
  const shown = list.filter((s) => !s.hidden).length;
  const hidden = list.length - shown;
  const lines = [shown
    ? `黑板上现在有 ${shown} 段（从上到下）${hidden ? `，另有 ${hidden} 段已撤回` : ''}：`
    : `黑板上现在没有显示的段（${hidden} 段都已撤回）：`];
  for (const seg of list) lines.push(...segmentLines(seg));
  lines.push(`新的一段用 id ${nextSegmentId(list)}（用过的 id，包括撤回的，都不要再用）。`);
  return lines.join('\n');
}

function screenLine(screen) {
  if (!screen || !(screen.w > 0)) return '';
  const orient = screen.landscape ? '横屏' : '竖屏';
  const room = screen.board?.w > 0 && screen.board?.h > 0 ? `，一块板能用的地方大约 ${screen.board.w}×${screen.board.h}（宽×高，像素）` : '';
  return `学生的屏幕：${orient} ${screen.w}×${screen.h}${room}。`;
}

function pagedStateText(board) {
  const list = (Array.isArray(board.segs) ? board.segs : []).filter((s) => s && s.id !== undefined && s.id !== null);
  const pages = (Array.isArray(board.pages) ? board.pages : []).filter((p) => p && Number.isFinite(p.n));
  const cur = Number(board.cur) || 0;
  const ids = `新的一段用 id ${nextSegmentId(list)}，常驻栏新的一条用 id ${nextPinId(list)}（用过的 id，包括撤回的，都不要再用）。`;
  const screen = screenLine(board.screen);
  if (!pages.length && !list.length) return [`黑板是空的：第一块板用 board new 写。${screen}`, ids].filter(Boolean).join('\n');
  const lines = [];
  const curPage = pages.find((p) => p.n === cur);
  const view = Number(board.view) || cur;
  lines.push(`黑板现在是第 ${cur} 块板（一共 ${pages.length} 块${view && view !== cur ? `；学生正翻回去看第 ${view} 块` : ''}）。${screen}`);
  const onPage = (n) => list.filter((s) => (s.place || 'board') !== 'pin' && Number(s.page) === n);
  if (curPage) {
    const title = curPage.title ? `「${oneLine(curPage.title, 40)}」` : '';
    if (curPage.kind === 'closing') lines.push(`当前板${title}是下课小结；接着讲就用 board new 换一块新板。`);
    lines.push(curPage.talk ? `当前板${title}最上面写着你上一句话：「${oneLine(curPage.talk, 160)}」（说新的话会把它换掉）。` : `当前板${title}最上面还没有你说的话。`);
    const here = onPage(cur);
    if (here.length) {
      lines.push('当前板上的段（从上到下）：');
      for (const seg of here) lines.push(...segmentLines(seg));
    } else lines.push('当前板上还没有段。');
    const fit = board.fit;
    if (fit && fit.fits === false && fit.need > 0 && fit.avail > 0) {
      lines.push(`（这块板超出一屏：内容高约 ${fit.need}，一屏只放得下约 ${fit.avail}，学生要往下滚才看得全。下一块板写少一点，或者用 replace 把这块精简。）`);
    }
  }
  const pins = list.filter((s) => s.place === 'pin');
  const shownPins = pins.filter((s) => !s.hidden);
  if (pins.length) {
    lines.push(shownPins.length ? '常驻栏（学生一直看得到）：' : '常驻栏现在是空的（下面的都已撤下）：');
    for (const seg of pins) lines.push(...segmentLines(seg, { maxResults: 3 }));
  } else lines.push('常驻栏现在是空的。');
  const before = pages.filter((p) => p.n !== cur).sort((a, b) => a.n - b.n);
  if (before.length) {
    lines.push('以前的板（学生翻回去才看得到；上面的图不能再用 figure 动）：');
    for (const p of before) {
      const segsHere = onPage(p.n);
      const title = p.title ? `「${oneLine(p.title, 40)}」` : '';
      lines.push(`- 第 ${p.n} 块${title}${p.kind === 'closing' ? '（下课小结）' : ''}${segsHere.length ? '' : '：没有段'}`);
      for (const seg of segsHere) lines.push(...segmentLines(seg, { maxResults: 3 }).map((l) => `  ${l}`));
    }
  }
  // 段落数据里有、但不在任何一块板上的（数据不全时）：也列出来，免得 Claude 以为 id 没用过
  const known = new Set(pages.map((p) => p.n));
  const loose = list.filter((s) => (s.place || 'board') !== 'pin' && !known.has(Number(s.page)));
  if (loose.length) {
    lines.push('不在任何一块板上的段：');
    for (const seg of loose) lines.push(...segmentLines(seg, { maxResults: 3 }));
  }
  // 这节课的量（let 块）：\calc 和组件里都能直接用
  const vars = (Array.isArray(board.vars) ? board.vars : []).filter(Boolean);
  if (vars.length) lines.push(`这节课定义的量（let 块，\\calc 和组件里都能直接用）：${vars.map((v) => oneLine(v, 200)).join('；')}`);
  lines.push(ids);
  if (board.nextMark) lines.push(`新的标注不写 id 时自动编号（下一个是 ${board.nextMark}）。`);
  return lines.join('\n');
}

// —— 拼第一条 user 消息 ——

// packBudget：资料包的字节预算（默认 ≈104 KiB）；整轮超长（prompt_too_large）时页面会调小再试。
// subject：课件开头写的科目。组件说明只带「通用 + 这门课」的小节，教法也按科目选（subject.js）
// 资料包 main.components：这节课要用哪些组件（数组，或用逗号、空格隔开的一串）
export function packComponents(pack) {
  const c = pack?.main?.components;
  const list = Array.isArray(c) ? c : typeof c === 'string' ? c.split(/[\s,，、]+/) : [];
  return [...new Set(list.map((x) => String(x ?? '').trim().replace(/^`|`$/g, '').toLowerCase()).filter(Boolean))];
}
// 资料包点名的组件，完整写法最多放这么多（多了从后面的开始不放，课堂 Claude 照样能用 component_doc 取）
export const DETAIL_BUDGET = 16 * 1024;

// 最常用的组件：资料包点了名时，课堂说明里只带这些 + 点名的（docs/desk-plan.md 第 7 节：组件手册是每轮最大的一块）
export const CORE_COMPONENTS = ['answer', 'quiz', 'steps', 'scene', 'conjecture', 'predict', 'let', 'calc', 'hl', 'chalk', 'draft', 'stepper', 'summary'];

// 组件说明：精简版，资料包点名的组件带完整写法；点了名时别的（不常用的）组件只留标题
export function systemDocs(componentDocs, subject, names = [], { lookup = true } = {}) {
  const src = asText(componentDocs);
  const only = names.length ? [...CORE_COMPONENTS, ...names] : null;
  const base = docsForSubject(src, subject, { lookup, only });
  let keep = names.slice();
  let docs = keep.length ? docsForSubject(src, subject, { full: keep, lookup, only }) : base;
  while (keep.length && bytes(docs) - bytes(base) > DETAIL_BUDGET) {
    keep = keep.slice(0, -1);
    docs = keep.length ? docsForSubject(src, subject, { full: keep, lookup, only }) : base;
  }
  return { docs, names: keep };
}

// 写错了的组件：完整写法附在要求重写的那条提醒后面（只附有完整写法的；精简版本来就在说明里）
export function lintDocs(componentDocs, subject, kinds = []) {
  const src = asText(componentDocs);
  const has = new Set(detailNames(src, subject));
  const out = [];
  for (const k of new Set(kinds.map((x) => String(x ?? '').toLowerCase()))) {
    if (!has.has(k)) continue;
    const d = componentDoc(src, k, subject);
    if (d) out.push(`【${k} 的完整写法】\n${cutBytes(d, DOC_MAX)}`);
  }
  return out.join('\n\n');
}
const DOC_MAX = 12 * 1024;

// component_doc 工具：按名字取一个组件的完整说明；找不到时列出有哪些
export function docLookup(componentDocs, subject, name) {
  const src = asText(componentDocs);
  const d = componentDoc(src, name, subject);
  if (d) return cutBytes(d, DOC_MAX);
  const names = allNames(src, subject);
  throw new Error(`没有叫「${String(name ?? '').trim()}」的组件${names.length ? `（这门课有：${names.join('、')}）` : ''}`);
}

// tools：这个查看方式给不给课堂 Claude 工具（不给就没有 component_doc，说明里不提它）
/**
 * memory（学习台里上课时才有）：{ mem: 记忆库各类的数组, block: 这节课的块, session: 这节课的编号 }。
 * 有记忆时多一节「你对学生的了解」，记忆库 rules 替换内置的红线；记忆先占（最多 MEMORY_BUDGET），资料包用剩下的
 */
export function buildSystem({ rules, componentDocs, pack, board, packBudget = PACK_BUDGET, subject = '线代', tools = true, memory = null } = {}) {
  const custom = asText(rules) || asText(pack?.main?.rules);
  const { docs } = systemDocs(componentDocs, subject, packComponents(pack), { lookup: tools });
  const lookupNote = tools
    ? '要用没写到的字段时用 component_doc 工具按名字取完整写法（要多等一轮）；'
    : '';
  const desk = memory ? (tools ? DESK_DOC : DESK_DOC_NO_TOOLS) : '';
  const parts = (packBody, mem = null) => {
    const role = custom || (mem?.rules ? memoryRules(subject, mem.rules) : defaultRules(subject));
    const sections = [
      `你的角色和红线\n\n${role}`,
      `组件写法和黑板指令\n\n## 组件说明\n\n下面的组件说明原本是学生写给项目对话里的 Claude 的，文中的「我」指学生。说到 guided 课件的关卡、小节结构的地方，课堂里不适用；课堂里的段落由你用黑板指令一段一段写。有的组件这里只写了最常用的写法（末尾写着「更多写法」）：照着写就行；${lookupNote}写错了页面会把那个组件的完整写法附在提醒里。资料包里点了名的组件，完整写法已经放在下面；点了名时，没点名的不常用组件只留了标题（要用就按名字取）。\n\n${docs || '（组件说明没有打包进来。只用最常见的组件：answer、steps、scene、predict，写法要保守。）'}\n\n## 黑板指令\n\n${PROTOCOL_DOC}`,
      ...(memory ? [`你对学生的了解（学习台的记忆库）\n\n${mem?.text || ''}\n\n${desk}`] : []),
      `这节课的资料包\n\n课前由项目对话里的 Claude 准备，课中也可能更新。${memory ? '在学习台里，资料包是这节课的额外安排（推进建议、备好的题），学生的情况看上面的记忆。' : ''}\n\n${packBody}`,
      `黑板现状\n\n${boardStateText(board)}`,
    ];
    const NUM = ['一', '二', '三', '四', '五', '六'];
    return [
      '这是课堂模式的完整说明，每一轮都会重新发给你（资料包和黑板现状都是最新的）。说明后面是这节课的对话：学生说的话、学生在黑板上的作答记录（[作答] / [动作]）、页面的系统消息（[系统]），以及你之前的输出。',
      ...sections.map((x, i) => `# ${NUM[i]}、${x}`),
      '（课堂说明到这里结束。下面是这节课的对话，回应最后一条消息。）',
    ].join('\n\n');
  };
  // 整份说明不超过 SYSTEM_MAX：记忆先占（最多 MEMORY_BUDGET），组件说明（按科目）长一点的课，资料包的预算跟着让一点；资料包至少留 16 KiB
  let mem = null;
  if (memory) {
    const room = SYSTEM_MAX - bytes(parts('', { rules: '', text: '' })) - 16 * 1024 - 3 * 1024;
    mem = memoryDigest(memory.mem || {}, { block: memory.block, session: memory.session, tools, budget: Math.max(4 * 1024, Math.min(MEMORY_BUDGET, room)) });
  }
  const rest = bytes(parts('', mem));
  const { text: packBody } = packText(pack, Math.max(16 * 1024, Math.min(packBudget, SYSTEM_MAX - rest - 3 * 1024)));
  return parts(packBody, mem);
}
// 每一轮的整份说明的上限（给对话留地方；CLAUDE.md 里写的 160 KiB）
export const SYSTEM_MAX = 160 * 1024;

// —— 学生在黑板上的动作 → 一行中文 ——

const BLOCKS = new Set(['page', 'tutor']); // 不是组件 id 的占位
const short = (v, n = 400) => oneLine(v, n);

// 值：数组写成 [1, 2]，小数最多留 3 位
function val(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    const r = Math.round(v * 1000) / 1000;
    return String(r === 0 ? 0 : r); // -0 也写成 0
  }
  if (Array.isArray(v)) return `[${v.map(val).join(', ')}]`;
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'object') { try { return short(JSON.stringify(v), 200); } catch { return ''; } }
  return short(v, 200);
}

// 平面上的点写成 (x, y)
function point(v) {
  if (Array.isArray(v)) return `(${v.map(val).join(', ')})`;
  if (typeof v === 'string' && /^-?[\d.]+\s*,\s*-?[\d.]+$/.test(v.trim())) return `(${v.split(',').map((x) => val(Number(x))).join(', ')})`;
  return val(v);
}

function duration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const s = Math.max(1, Math.round(n / 1000));
  if (s < 60) return `用时 ${s} 秒`;
  return s % 60 ? `用时 ${Math.floor(s / 60)} 分 ${s % 60} 秒` : `用时 ${s / 60} 分钟`;
}

const verdict = (ok) => (ok === true ? '对' : ok === false ? '错' : '');
// （对，第 2 次）/（第 2 次）/（对）
function mark(ok, attempts) {
  const bits = [verdict(ok), Number(attempts) > 0 ? `第 ${attempts} 次` : ''].filter(Boolean);
  return bits.length ? `（${bits.join('，')}）` : '';
}
const viaNote = (via) => (via ? `（${String(via).replace(/转写$/, '')}转写）` : '');

// 「b7 里的 steps ex-1「例2.1」」
function where(a, kind, { title = true } = {}) {
  const seg = typeof a.step === 'string' && a.step ? a.step : '';
  const block = typeof a.block === 'string' && a.block && !BLOCKS.has(a.block) ? a.block : '';
  const t = title && a.title ? `「${short(a.title, 30)}」` : '';
  const sep = /^[A-Za-z]/.test(kind) ? ' ' : ''; // 「b2 里的 steps」「b2 里的图」
  return `${seg ? `${seg} 里的${sep}` : ''}${kind}${block ? ` ${block}` : ''}${t}`;
}

const tail = (...bits) => bits.filter(Boolean).join('，');

function stepsRecord(a) {
  const n = /第\s*(\d+)\s*步/.exec(String(a.detail ?? ''))?.[1];
  const stepTitle = String(a.q ?? '').split('｜')[0].trim();
  const loc = where(a, 'steps');
  const sub = n ? `${loc.endsWith('」') ? '' : ' '}第 ${n} 步${stepTitle ? `（${short(stepTitle, 24)}）` : ''}` : '';
  const head = `[作答] ${loc}${sub}：`;
  const txt = a.text ?? a.answer;
  let what;
  if (a.giveup) what = `想不出来${txt ? `，写了「${short(txt)}」${viaNote(a.via)}` : ''}`;
  else if (a.revealed) what = `没做出来，看了答案${a.attempts ? `（试了 ${a.attempts} 次）` : ''}${a.value ? `，最后填的是 ${val(a.value)}` : ''}`;
  else if (a.final) what = `${a.ok ? '做对了' : '没做对'}${a.attempts ? `（共 ${a.attempts} 次）` : ''}${a.value ? `，最后填的是 ${val(a.value)}` : ''}`;
  else if (a.attempts !== undefined && a.attempts !== null) what = `填了 ${val(a.value)}${mark(a.ok, a.attempts)}${a.check ? `（${short(a.check, 120)}）` : ''}${a.transcript ? `；手写过程（转写）：「${short(a.transcript)}」` : ''}`;
  else if (a.value !== undefined && a.value !== null && a.value !== '') what = `选了『${val(a.value)}』${mark(a.ok)}`;
  else if (txt) what = `写了「${short(txt)}」${viaNote(a.via)}`;
  else what = '交了，但什么也没写';
  return head + tail(what, duration(a.ms));
}

function answerRecord(a, kind) {
  const head = `[作答] ${where(a, kind)}：`;
  const q = kind === 'practice' && a.q ? `题目「${short(a.q, 160)}」，` : '';
  let what;
  if (a.final || a.revealed) {
    if (a.revealed) what = `${a.attempts ? `试了 ${a.attempts} 次没做对，` : '没做出来，'}看了答案${a.expected ? `（正确答案 ${val(a.expected)}）` : ''}`;
    else what = `${a.ok ? '做对了' : '没做对'}${a.attempts ? `（共 ${a.attempts} 次）` : ''}${!a.ok && a.expected ? `，正确答案 ${val(a.expected)}` : ''}`;
    if (a.work || a.transcript) what += `；手写过程（转写）：「${short(a.work || a.transcript)}」`;
  } else {
    const shown = a.value ?? a.text ?? a.last;
    what = `填了 ${val(shown) || '（空）'}${mark(a.ok, a.attempts)}${a.check ? `（${short(a.check, 120)}）` : ''}`;
    if (a.transcript || a.work) what += `；手写过程（转写）：「${short(a.transcript || a.work)}」`;
  }
  return head + q + tail(what, duration(a.ms));
}

function conjectureRecord(a) {
  const txt = a.answer ?? a.text;
  const v = String(a.verdict ?? '');
  // verdict：「已交，等 Claude 看」是给页面看的，不用说；自评、看答案、页面批改要说
  const extra = v.startsWith('自评') ? `，自评「${v.replace(/^自评[:：]\s*/, '')}」`
    : v.startsWith('Claude') ? `，页面批改：${v.replace(/^Claude[:：]\s*/, '')}`
      : v === '看了参考答案' ? '，看了参考答案' : '';
  const times = Number(a.attempts) > 1 ? `（第 ${a.attempts} 次交）` : '';
  const what = txt ? `写了「${short(txt, 600)}」${viaNote(a.via || (a.transcript ? '手写' : ''))}${times}` : `没写内容${times}`;
  return `[作答] ${where(a, 'conjecture')}：${tail(what + extra, duration(a.ms))}`;
}

function recordText(a, type) {
  switch (type) {
    case 'steps': return stepsRecord(a);
    case 'answer':
    case 'practice': return answerRecord(a, type);
    case 'conjecture': return conjectureRecord(a);
    case 'recognize': {
      const redo = a.detail === '重做' ? '（重做）' : '';
      const pick = `选了「${val(a.value)}」${a.ok === false && a.expected ? '（错，应为「' + val(a.expected) + '」）' : mark(a.ok)}`;
      const why = a.text ? `理由：「${short(a.text, 200)}」${viaNote(a.via)}` : '';
      return `[作答] ${where(a, 'recognize')}${redo}：${a.q ? `「${short(a.q, 120)}」` : ''}${tail(pick, why, duration(a.ms))}`;
    }
    case 'recognize-sum':
      return `[作答] ${where(a, 'recognize')}：做完一轮，认对 ${val(a.value)}${a.detail ? `，${short(a.detail, 80)}` : ''}`;
    case 'findbug': {
      if (a.revealed) return `[作答] ${where(a, 'findbug')}：${tail(`${val(a.value) || '看了答案'}${a.expected ? `，第一处错在${val(a.expected)}` : ''}`, a.text ? `写的说明：「${short(a.text, 300)}」` : '')}`;
      const what = `指出错在${val(a.value)}${mark(a.ok, a.attempts)}`;
      return `[作答] ${where(a, 'findbug')}：${tail(what, a.text ? `说明：「${short(a.text, 300)}」${viaNote(a.via)}` : '', duration(a.ms))}`;
    }
    case 'quiz': {
      const wrong = Array.isArray(a.wrong) && a.wrong.length ? `，选错过：${a.wrong.map((w) => `「${short(w, 40)}」`).join('、')}` : '';
      return `[作答] ${where(a, 'quiz')}：${a.q ? `「${short(a.q, 120)}」` : ''}${a.ok ? '做对了' : '没做对，看了解析'}${a.attempts ? `（共 ${a.attempts} 次）` : ''}${wrong}`;
    }
    case 'predict': {
      const guess = a.guess ?? a.value;
      const real = Array.isArray(a.answer) ? a.answer : null;
      const what = `猜在 ${point(guess)}${real ? `，实际在 ${point(real)}` : ''}（${a.ok ? '猜得准' : a.ok === false ? '差得比较远' : '没判'}）`;
      return `[作答] ${where(a, 'predict')}：${what}`;
    }
    case 'scene':
      return `[作答] ${where(a, '图')}：达成了图里的目标`;
    case 'code': {
      // 写代码题：每次运行都记一条（过了几个测试、第一个没过的、复杂度），带上代码，老师看得到写成了什么样
      const head = `[作答] ${where(a, '代码题')}：第 ${Number(a.attempts) || 1} 次运行，过了 ${Number(a.passed) || 0} / ${Number(a.total) || 0} 个测试`;
      const fail = a.fail ? `；第一个没过的：${short(a.fail, 240)}` : '';
      const cx = a.cx ? `；${short(a.cx, 200)}` : '';
      const src = typeof a.value === 'string' && a.value.trim() ? `\n学生的代码：\n\`\`\`c\n${String(a.value).slice(0, 1600)}\n\`\`\`` : '';
      return `${head}${fail}${cx}${src}`;
    }
    case 'stepper': {
      // 演示组件（排序、遍历、置换……）：走到某一步之前先猜（ask），或者 quiz 模式写出结果
      const at = a.detail ? `${short(a.detail, 30)}，` : '';
      const q = a.q ? `「${short(a.q, 120)}」` : '';
      let what;
      if (a.giveup) what = `想不出来，直接看了${a.expected ? `（答案是 ${val(a.expected)}）` : ''}`;
      else if (a.revealed) what = `${a.attempts ? `试了 ${a.attempts} 次没猜对，` : ''}看了答案${a.expected ? `（${val(a.expected)}）` : ''}`;
      else if (a.final) what = `${a.ok ? '做对了' : '没做对'}${a.attempts ? `（共 ${a.attempts} 次）` : ''}`;
      else what = `${val(a.value) ? `${a.pick ? '在图上点了' : '写了'} ${val(a.value)}` : '（空）'}${mark(a.ok, a.attempts)}`;
      // 页面看出来的错法（只给老师看：用它来追问，别直接告诉学生）
      const why = a.misread ? `；页面看出来：${short(a.misread, 60)}` : '';
      return `[作答] ${where(a, a.engine || '演示')}：${at}${q}${tail(what + why, duration(a.ms))}`;
    }
    case 'ask':
      return `[动作] 问了：「${short(a.question ?? a.text ?? a.q, 200)}」`;
    default:
      return null;
  }
}

function eventText(a, type) {
  const d = a.detail && typeof a.detail === 'object' ? a.detail : {};
  const get = (k) => (a[k] !== undefined ? a[k] : d[k]);
  // classroom 会把 detail 摊开到顶层：这时 step 是 steps 里的第几步（数），不是段 id
  const sub = typeof d.step === 'number' ? d.step : typeof a.step === 'number' ? a.step : null;
  const stepTitle = typeof d.title === 'string' ? d.title : typeof a.title === 'string' ? a.title : '';
  const subText = sub ? ` 第 ${sub} 步${stepTitle ? `（${short(stepTitle, 24)}）` : ''}` : '';
  switch (type) {
    case 'giveup': return `[动作] ${where(a, 'steps', { title: false })}${subText}：想不出来，直接揭开了`;
    case 'reveal': return `[动作] ${where(a, 'steps', { title: false })}：揭开第 ${sub ?? '?'} 步${stepTitle ? `（${short(stepTitle, 24)}）` : ''}`;
    case 'drag':
      // 演示、分拍板书的 step：走到第几步
      if (get('name') === 'step' && get('beat') !== undefined) return `[动作] ${where(a, '演示', { title: false })}：走到第 ${val(get('value'))} 步（共 ${val(get('beat'))} 步）`;
      return `[动作] ${where(a, '图', { title: false })}：把 ${get('name') ?? '点'} 拖到 ${val(get('value'))}`;
    case 'done': return `[动作] 点了 ${typeof a.step === 'string' ? a.step : '这一段'}${stepTitle ? `「${short(stepTitle, 30)}」` : ''}的「这段做完了」`;
    case 'ask': return `[动作] 问了：「${short(get('question'), 200)}」`;
    case 'open': return '[动作] 打开了课堂页面';
    case 'end': return '[动作] 点了「下课」';
    default: return null;
  }
}

// 不认识的：类型 + 位置 + 关键字段的 JSON 简写
function unknownText(a, type) {
  const { source, type: _t, kind: _k, at, stage, el, step, block, ...rest } = a;
  const loc = [typeof step === 'string' ? step : '', typeof block === 'string' && !BLOCKS.has(block) ? block : ''].filter(Boolean).join(' 里的 ');
  let json = '';
  try { json = JSON.stringify(rest); } catch { json = ''; }
  return `[动作] ${type || '操作'}${loc ? `（${loc}）` : ''}${json && json !== '{}' ? `：${clip(json.replace(/\s+/g, ' '), 200)}` : ''}`;
}

export function actionText(a) {
  if (typeof a === 'string') return a;
  if (!a || typeof a !== 'object') return '';
  // 页面自己写好的一行（察觉卡住这类）：原样给
  if (a.source === 'page') return String(a.text || '');
  const type = String(a.type ?? a.kind ?? '').replace(/-try$/, '');
  const isEvent = a.source === 'event';
  const out = isEvent ? eventText(a, type) : recordText(a, type) ?? eventText(a, type);
  return out ?? unknownText(a, type);
}

// 一条草稿（学生写了还没提交）→ 一行「[草稿] …」。d：{ step, block, kind, title, label, text }
export function draftLine(d) {
  if (!d || !String(d.text ?? '').trim()) return '';
  const loc = where({ step: d.step, block: d.block, title: d.title }, d.kind || '组件');
  return `[草稿] ${loc}${d.label ? ` ${d.label}` : ''}：写着 ${short(String(d.text).trim(), 300)}，还没提交`;
}

// 一批动作合成一条 user 消息：一行一个
export function actionsMessage(actions) {
  return (actions || []).map(actionText).filter((s) => s && s.trim()).join('\n');
}

// —— 多轮对话 ——

export const KEEP_RECENT = 20;
export const OMITTED = '（更早的对话已省略）';

// history: [{ role: 'student' | 'claude' | 'system', text, discarded?, kind? }]
// 返回 { turns, bytes, historyBytes, dropped }：bytes 是所有 content 的字节数，historyBytes 是其中对话部分（不含第一条说明）
// keepRecent：超长时也保留的最近几条（默认 20）；最近几条本身就太长时，页面可以调小再拼一次
export function buildTurns({ system, history = [], maxBytes = 262144, keepRecent = KEEP_RECENT } = {}) {
  const sys = String(system ?? '').trim();
  if (!sys) throw new Error('buildTurns：缺少课堂说明（system）');
  const conv = [];
  for (const h of history || []) {
    if (!h || h.discarded) continue;
    const role = h.role === 'claude' ? 'assistant' : h.role === 'student' || h.role === 'system' ? 'user' : null;
    if (!role) continue;
    let content = String(h.text ?? '').trim();
    if (!content) continue; // sample 不收空的 content
    if (h.role === 'system' && !content.startsWith('[系统]')) content = `[系统] ${content}`;
    conv.push({ role, content, size: bytes(content), pinned: h.kind === 'summary' });
  }
  if (conv.length && conv[conv.length - 1].role !== 'user') throw new Error('buildTurns：最后一条必须是学生或系统的消息');

  const sysBytes = bytes(sys);
  let total = sysBytes + conv.reduce((s, t) => s + t.size, 0);
  // 太长：从最早的开始丢；最近 keepRecent 条和摘要永远保留
  const keep = Number.isInteger(keepRecent) && keepRecent >= 1 ? keepRecent : KEEP_RECENT;
  const keepFrom = Math.max(0, conv.length - keep);
  const drop = new Set();
  const noteBytes = bytes(OMITTED);
  for (let i = 0; i < keepFrom && total + (drop.size ? noteBytes : 0) > maxBytes; i++) {
    if (conv[i].pinned) continue;
    drop.add(i);
    total -= conv[i].size;
  }
  const turns = [{ role: 'user', content: sys }];
  let noted = false;
  conv.forEach((t, i) => {
    if (drop.has(i)) {
      if (!noted) { turns.push({ role: 'user', content: OMITTED }); noted = true; }
      return;
    }
    turns.push({ role: t.role, content: t.content });
  });
  const all = turns.reduce((s, t) => s + bytes(t.content), 0);
  return { turns, bytes: all, historyBytes: all - sysBytes, dropped: drop.size };
}

// —— 对话太长时的摘要 ——

export const COMPACT_AT = 80 * 1024;

export function needsCompaction(history) {
  const live = (history || []).filter((h) => h && !h.discarded);
  return live.length > KEEP_RECENT && live.reduce((s, h) => s + bytes(h.text), 0) > COMPACT_AT;
}

// 要压缩的那部分（传入 promptHistory 的结果）：最近一次摘要之后、最近 20 条之前的原文
export function compactionSlice(promptHist) {
  const list = promptHist || [];
  const prev = list[0]?.kind === 'summary' ? list[0] : null;
  const body = prev ? list.slice(1) : list;
  return { prev, old: body.slice(0, -KEEP_RECENT) };
}

// 值不值得多花一轮去压缩：能压的只有一两条（最近 20 条本身就很长）时不压，免得每一轮都先等一次摘要；
// 那种情况交给 fitTurns 丢最早的
export function worthCompacting(promptHist) {
  const { old } = compactionSlice(promptHist);
  return old.length >= 6 || old.reduce((s, t) => s + bytes(t.text), 0) >= 16 * 1024;
}

const SPEAKER = { student: '学生', claude: '你（课堂里的 Claude）', system: '系统' };
const COMPACT_BUDGET = 200 * 1024; // 摘要请求本身也要在 256 KiB 以内

export function compactionPrompt({ summary = '', turns = [] } = {}) {
  const list = (turns || []).filter((t) => t && !t.discarded && String(t.text ?? '').trim());
  const bodies = list.map((t) => String(t.text).trim());
  const limits = fairShares(bodies.map(bytes), COMPACT_BUDGET);
  const log = list.map((t, i) => {
    const body = limits[i] < bytes(bodies[i]) ? `${cutBytes(bodies[i], limits[i])}\n（这一条太长，后面省略）` : bodies[i];
    return `[${SPEAKER[t.role] || t.role || '?'}]\n${body}`;
  }).join('\n\n');
  const prev = String(summary ?? '').trim().replace(/^【到目前为止的课堂摘要】\s*/, '');
  return [
    '你是这节课的老师（课堂模式）。课堂对话太长了，需要把较早的一部分压缩成摘要：之后会用这份摘要代替那部分原文接着上课，原文你就看不到了。',
    '请写「到目前为止的课堂摘要」。要求：',
    [
      '- 中文，不超过 1500 字，用短句和条目。',
      '- 写清楚：',
      '  1. 已经讲到哪：讲过哪些内容，用过哪些例题和图（关键的数字、结论照写）。',
      '  2. 学生卡在哪：卡在哪一步、怎么错的、背后可能是什么误解（引用学生的原话或作答）。',
      '  3. 错过什么：提示了没接住的点、看了答案才明白的、说过「没把握」的、点过「想不出来」的。',
      '  4. 黑板上有哪些段：每段的 id、标题、里面组件的 id，学生在每段的作答结果；撤回的段也列出 id。',
      '  5. 接下来打算怎么走（对话里看得出来的话）。',
      '- 只根据下面的记录写，不要编；不确定的写「不确定」。',
      '- 只输出摘要正文：不写黑板指令，不对学生说话。提到学生时写「学生」，不用「他」「她」。',
    ].join('\n'),
    prev ? `【更早的摘要】（把它也并进新的摘要里）\n${prev}` : '',
    `【要压缩的课堂记录】（从早到晚）\n\n${log || '（没有）'}`,
  ].filter(Boolean).join('\n\n');
}

export const SUMMARY_HEAD = '【到目前为止的课堂摘要】';

export function summaryTurn(text) {
  const body = String(text ?? '').trim().replace(/^【到目前为止的课堂摘要】\s*/, '');
  return { role: 'system', kind: 'summary', text: `${SUMMARY_HEAD}\n${body}` };
}

// —— 下课小结（存进 class_notes，给项目对话里的 Claude 课后看）——
// 学习台里（report：页面算好的课后报告，memory/report.js 的 reportText）：同一次调用里接着写整理单（memo 块），不多调用一次（docs/desk-plan.md 4.2）
export function closingPrompt({ report = '', review = '' } = {}) {
  const base = doc`
下课了。请写这节课的小结，给项目对话里的 Claude 课后看：它会据此判断学生掌握得怎么样、下一节从哪里接。

中文，分下面四点，每点几条短句，具体到题目、步骤和学生的原话：

1. 这节课讲了什么：讲到哪里，用了哪些例题和图。
2. 学生哪里卡住：卡在哪一步、怎么错的、可能是什么误解。
3. 哪里看起来懂了但证据不够：比如答对了但没说理由、跟着提示才做出来、说过「没把握」、同类题只做过一道。
4. 建议下一节怎么接：从哪里开始，先补什么，用什么样的题检验。

不写黑板指令，不对学生说话，不要说学生「已经掌握」。提到学生时写「学生」，不用「他」「她」。
`;
  if (!report) return base;
  return `${base}\n\n${doc`
这节课在学习台里上。下面是页面按证据算好的课后报告（每道题的对错、没做完的、没交的草稿、学生说的话）。

小结写完以后，接着写一个 ˋmemoˋ 块当**整理单**（写法和上课时一样，见「在学习台里上课」）：这节课新出现的错题（ˋerrorˋ）、弱点该怎么变（ˋweaknessˋ）、复现组怎么调（ˋreviewˋ）、下一节从哪接（ˋpositionˋ，一定写）、你这节课的教学失误（ˋslipˋ）。每条都写 ˋbasis=ˋ（下面报告里的组件 id 或证据 id）。等确认的那几类学生会在小结那块板上逐条点「确认 / 改 / 不要」；上课时已经记过的不用再写。整理单只写在 memo 块里，小结正文里不用重复。
${review ? `\n这是复现课（复现组 ${review}）：整理单里一定写一行 ˋreview id=${review} result=过ˋ 或 ˋresult=没过ˋ（依据写这节课做的那几道题），学生确认了，档位才按结果变。\n` : ''}
${report}
`}`;
}

// —— 课堂运行时的小规则（纯函数，页面据此决定发什么、什么时候发）——

const typeOf = (a) => String(a?.type ?? a?.kind ?? '').replace(/-try$/, '');

// 学生在黑板上的一个动作要不要告诉课堂 Claude。
// 同一道题的「最终结果」只在看了答案、放弃时说（每次尝试已经说过了）；提问、提示这类不是作答
export function reportable(a) {
  if (!a || typeof a !== 'object') return false;
  const type = typeOf(a);
  if (a.source === 'event') return type === 'reveal' || type === 'drag';
  if (type === 'ask' || type === 'findbug-hint') return false;
  if (a.final && !a.revealed && !a.giveup) return false;
  return true;
}

// 这个动作怎么带动自动的一轮：
//   'now'   想不出来：马上发
//   'soon'  作答：等 1.5 秒，把这期间的动作合成一条
//   'later' 揭开下一步、在图里拖一拖：只是在看、在试，不单独打扰 Claude，跟着下一条一起说
//           （揭开的是最后一步时按 'soon'，学生在等）。学生说过拖一下就回一次没必要，还费额度
//   null    不告诉 Claude
export function actionTrigger(a, { lastStep = false } = {}) {
  const urgent = !!a?.giveup || (a?.source === 'event' && typeOf(a) === 'giveup');
  if (!reportable(a)) return urgent ? 'now' : null;
  if (urgent) return 'now';
  if (a.source === 'event' && typeOf(a) === 'reveal' && !lastStep) return 'later';
  if (a.source === 'event' && typeOf(a) === 'drag') return 'later';
  return 'soon';
}

// 给课堂 Claude 的对话：最近一次摘要 + 摘要之后的原文；作废的轮、下课小结不算
export function promptHistory(history) {
  const live = (history || []).filter((t) => t && !t.discarded && t.kind !== 'closing');
  const s = live.filter((t) => t.kind === 'summary').at(-1);
  if (!s) return live;
  return [s, ...live.filter((t) => t.kind !== 'summary' && t.seq > s.upTo)];
}

// 还在等 Claude 回的那一条：最后一条有效记录是学生的话，或者要它接着回的系统消息（重写、补发它要看的原图）。
// 摘要、提醒（note）、下课小结、作废的轮都不算——它们后面不需要 Claude 接话
export function pendingTurn(history) {
  const last = (history || []).filter((t) => t && !t.discarded && !['summary', 'note', 'closing'].includes(t.kind)).at(-1);
  if (!last) return null;
  return last.role === 'student' || (last.role === 'system' && (last.kind === 'lint' || last.kind === 'images')) ? last : null;
}

// 拼这一轮的对话，保证不超过 maxBytes：先丢最早的；最近 20 条本身就太长时，逐步少留几条原文
export function fitTurns({ system, history, maxBytes = 262144 } = {}) {
  let out = null;
  for (const keepRecent of [KEEP_RECENT, 12, 8, 4, 2, 1]) {
    out = buildTurns({ system, history, maxBytes, keepRecent });
    if (out.bytes <= maxBytes) return { ...out, keepRecent, fits: true };
  }
  return { ...out, keepRecent: 1, fits: false };
}

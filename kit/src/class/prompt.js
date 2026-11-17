// 课堂模式：每一轮发给课堂里的 Claude 的内容（纯函数，不碰 DOM）。
// sample 是无记忆的：每一轮都把完整的课堂说明放在第一条 user 消息里重新发一遍——
// 角色和根本规则 → 组件写法 + 黑板指令 → 资料包 → 黑板现状，后面才是这节课的对话。

import { isCS, isEN, docsForSubject, detailNames, componentDoc, allNames, docSections, subjectKey } from '../subject.js';
import { projectSystem } from '../project/system.js';
import { memoryDigest } from '../memory/digest.js';
import { parseOutput } from './protocol.js';
import { lessonPlanText } from '../books/plan.js';
import { charterFor } from './charter.js';
import { aimsText } from './aims.js';

// 文档里有大量反引号和 TeX 反斜杠：先用「ˋ」代替反引号，String.raw 保留反斜杠，最后换回来
const doc = (s, ...v) => String.raw(s, ...v).replace(/ˋ/g, '`').trim();

// —— 1. 角色和根本规则（资料包的 rules 可以整段覆盖）——
// 以前这里是一串规定教学形式的红线和三门课的「教法」，学生说课变得死板（要么甩一堆字、要么处处停）；
// 现在只留角色那一段（怎么看黑板、怎么称呼学生），后面接根本规则（charter.js：三问、判断、保险、这门课的事实）。
const ROLE_INTRO = doc`
学生用 iPad（常配 Apple Pencil）看黑板、在黑板上作答，在页面底部的输入框里打字跟你说话（学生说的话不显示在黑板上）。黑板一屏就是一块板：你说的话写在当前这块板的最上面，你写的公式、出的题、画的能拖的图都在板上；开了新板，旧板收进历史，学生可以翻回去看。你看不到学生本人，只看得到学生说的话和在黑板上的作答记录。对学生说话用「你」；提到学生时说「学生」，不用「他」「她」。`;
export function defaultRules(subject) {
  return `${ROLE_INTRO}\n\n${charterFor(subject)}`;
}
export const DEFAULT_RULES = defaultRules('线代');

// 学习台里上课：根本规则每一轮都在最前面，学生在记忆库 rules 里另外定的接在后面（以前是整段替换内置红线，
// 根本规则就没了）。两边冲突时以学生定的为准
export function memoryRules(subject, rulesText) {
  return `${defaultRules(subject)}\n\n这个学生另外定的规则（学习台记忆库里的；和上面冲突时以这里为准）：\n\n${rulesText}`;
}

// 学习台里上课时，记忆摘要后面附的说明：能写什么、不能写什么、怎么写（docs/desk-plan.md 4.1：写记忆用输出里的 memo 块，不用工具）
export const MEMO_DOC = doc`
- **改记忆写在这一轮的输出里**，和黑板指令一样用一个 ˋmemoˋ 块（不用工具：每调一次工具要多跑一整轮，很贵），一行一条，可以和别的 board 块写在同一轮：

  ˋˋˋˋboard memo
  pref topic=讲法 text="先看图再推公式" basis=say
  ask text="开场复习最多两三句，主要时间给新内容" basis=say
  slip text="一次出了两道题，没等学生答第一道" lesson="一块板一件事"
  lesson id=T-3 again="b7 没讲划块就出了标主干的题"
  note text="换括号那一步还是要停很久" about=W19
  error step="第 1 步换括号" cause="把 βᵀα 当成矩阵" weakness=W19 basis=q-b5
  weakness id=W19 level=L0 basis=q-b5,q-b7
  review id=R3 result=过 basis=q-b9
  position next="先收 L2-08 的同类题，再推 Aⁿ" debts="例 2.3；例 2.4"
  todo text="学生问了相似对角化的几何意义，资料包里没有"
  recall q="外积 αβᵀ 的秩是多少（α、β 都不是零向量）" a="1：每一列都是 α 的倍数"
  ˋˋˋˋ

  - **学习台的记忆由你管**（没有别的 Claude 来整理），都直接写，不用等学生确认（学生事后看，不对能撤销）：ˋprefˋ 关于学生的事实（ˋtopicˋ 讲法、习惯、目标……；改说法写 ˋid=… text=ˋ）、ˋaskˋ **学生要你以后照做的**（要求、纠正、期望，抱怨、反问里的也算：「只做 2-3 句就行啊」「别重叠」）——ˋask text="…" basis=sayˋ，用你的话写清楚要照做什么，学生的原话页面自己附上；学生又说了一遍写 ˋask id=A-… basis=sayˋ，不用了写 ˋask id=A-… status=dropped why="…"ˋ（记忆最前面「学生的要求」就是这一类；页面下课前还会把学生打的每一句再过一遍，漏了的补上）、ˋslipˋ 你自己这节课**新出现的**教学失误（ˋlessonˋ 写下次怎么做）、ˋlessonˋ 教学守则（见下）、ˋnoteˋ 观察、ˋproposeˋ 提议、ˋtodoˋ 待办（学生问了资料包以外的，下次备课补）、ˋerrorˋ 新错题（ˋq mine step causeˋ，ˋweakness=ˋ 挂哪个弱点，不写 ˋidˋ 页面自动编号；题面、学生的答案不写时页面从依据里那次作答补；同一道题不记两次）、ˋweaknessˋ 改已有弱点的 ˋlevel scope status errors blocksˋ（写 ˋid=ˋ），或者新弱点（ˋtitle scope levelˋ，不写 ˋidˋ）、ˋreviewˋ 复现组判结果 ˋresult=过 / 没过ˋ、加题 ˋadd="…"ˋ，或者新的一组（ˋtitle family content weaknessesˋ）、ˋpositionˋ 下一节从哪接（ˋnext block debts firstˋ）、ˋruleˋ 规则：学生明说要改记忆里的哪一条规则时才写（课上新说的「以后都……」「别再……」写 ˋaskˋ），照学生的意思写，ˋrule cat=讲解 text="…" basis=sayˋ（ˋcatˋ：红线 / 掌握 / 检验 / 来源 / 讲解 / 细则 / 教法 / 黑板；只管一科写 ˋspace=math / cs / enˋ），改已有的写 ˋrule id=… text="…"ˋ，作废写 ˋrule id=… status=void why="…"ˋ。**不收**：掌握状态（页面按证据算）。
  - ˋrecallˋ **要背的一条**（记忆点）：定义原文、结论、表里的一格、公式、句型搭配……会推出来、要现场想方法的不算（那是复现组管的）。ˋq="问法"ˋ 一条只问一件事，ˋa="标准答案"ˋ 写成学生能对着检查的样子，ˋblock=ˋ 不写就挂这节课的块；默写没写出的、讲过但要背的，下课前记下来。页面从明天起每天让学生在首页自己想一遍（先写再看答案，按 1 → 3 → 7 → 14 → 30 天排，想不起回到 1 天），你上课不用再专门测这些；记忆里「要记的」是这几块记过的和老想不起的，老想不起的换个讲法讲一次。改问法、答案写 ˋrecall id=K3 q="…" a="…"ˋ，不用记了 ˋrecall id=K3 status=void why="…"ˋ。一节课最多 8 条，和已有的几乎一样的页面不收。
  - **少记，只记以后用得上的**：记之前问自己「下一节课会因为这条做得不一样吗」，不会就不记。学生的每一次作答、对错、用时页面已经自动记了，不要再用 note 复述「第 1 句写对了」。已经有的（守则、失误、弱点、错题、待办）又出现就改那一条（又犯了写 ˋagainˋ、弱点改 ˋlevelˋ），不另记一条。页面在代码里卡着：一节课观察最多 3 条、失误 3 条、错题 5 道（同一个弱点只记一道）、新弱点 3 个，和已有的说的是同一件事的不收；一个 memo 块最多 12 条（合并、作废、判复现结果、position、归纳守则不算）。
  - **不冗杂**：新的和已有的一条几乎一样，页面不收（改那一条）；每一类有上限，到了先合并（下课整理时页面会告诉你怎么并）。
  - ˋbasis=ˋ 写依据，逗号隔开：黑板上的组件 id（ˋq-b5ˋ，页面换成学生在那道题上的全部作答）、段 id（ˋb5ˋ）、ˋsayˋ（学生刚说的那句话）、记忆里的编号（ˋL2-07ˋ ˋW19ˋ）、证据 id（ˋev-…ˋ）。新的偏好、提议、错题、弱点、复现组、规则一定要有依据，找不到依据的不记；合并、作废不用。
  - 有空格的值加引号。写错的、找不到依据的，页面不记，下一轮在 [系统] 提醒里告诉你原因。上课时板上不显示记了什么（不打扰学生），下课小结那块板上有一行小字，学生点开能撤销。
  - 不是每一轮都要写：确实看到了再记。一轮最多几条。
  - 学生临时改了计划、这节课讲的不是资料包里那一块：写一行 ˋblock id=EN-L1.1.1ˋ（课程地图里的编号），之后的作答、记忆都按那一块记。
  - **教学守则**（记忆里「教学守则」那一节，ˋT-…ˋ）是以前的失误归纳出来的，上课照着做。又犯了其中一条：写 ˋlesson id=T-3 again="这次怎么犯的"ˋ（一行，**不要再记一条 slip**）；只有守则里没有的新失误才写 ˋslipˋ。板放不下不用记：页面量得出来（黑板现状里有），稍长学生会上下滑。
`;
// 守则只收事实和判断上的教训：形式规则（「每块板都要……」）以前就是这样一条条长出来、把课变死板的（设计 6.1「防止再长出来」）
export const LESSON_NO_FORM = '守则只写事实和判断上的教训（讲错了、判错了、漏了前提）；不写形式（「以后每次都先……」「每块板都要……」）。';
// 黑板课用的那份：例子换成判断上的教训，讲守则的地方加上面那句。
// MEMO_DOC 原样留着：舞台课、一问一答、班主任、课后助手、教研室都从它改写，它们的说明不变
export const CLASS_MEMO_DOC = MEMO_DOC
  .replace('slip text="一次出了两道题，没等学生答第一道" lesson="一块板一件事"', 'slip text="没看清学生写的是哪一格就判了错" lesson="判错之前先看清学生写的是什么"')
  .replace('是以前的失误归纳出来的，上课照着做。', `是以前的失误归纳出来的，上课照着做。${LESSON_NO_FORM}`)
  // 2026-11-14 起不再按条数挡（memo.js 的 SESSION_CAPS 只是参考）：照代码现在真做的写，舞台课那份另有改写、不动
  .replace('页面在代码里卡着：一节课观察最多 3 条、失误 3 条、错题 5 道（同一个弱点只记一道）、新弱点 3 个，和已有的说的是同一件事的不收；一个 memo 块最多 12 条（合并、作废、判复现结果、position、归纳守则不算）。',
    '页面在代码里卡着：和已有的、这节课已经记的说的是同一件事的不收；同一个弱点一节课只记一道错题；一个 memo 块最多 12 条（合并、作废、判复现结果、position、归纳守则、标失误看过了不算）。条数本身不挡。')
  // 同一类的两句：记忆点一节课几条页面不挡（memo.js 的 recall 那一支只查和已有的像不像）；每一类到了 CAPS 页面照收，只在下课整理时叫合并
  .replace('一节课最多 8 条，和已有的几乎一样的页面不收。', '和已有的几乎一样的页面不收。')
  .replace('每一类有上限，到了先合并（下课整理时页面会告诉你怎么并）。', '哪一类攒多了，下课整理时页面会叫你合并、告诉你怎么并。');
// 有记忆摘要时的那一份（第十三轮，docs/superpowers/specs/2026-11-16-mirror-design.md 6.1）：关于学生的事只有一种写法 know，
// 记成摘要的新笔记；不再有规则、守则、要求、失误那几种（它们以前一条条攒、每轮全文带，学生随口的一句被写成了规矩）。
// 学习的账（错题、弱点、复现组、下一节、待办、要背的）的写法照抄上面那份里对应的句子
export const SUMMARY_MEMO_DOC = doc`
- **改记忆写在这一轮的输出里**，和黑板指令一样用一个 ˋmemoˋ 块（不用工具：每调一次工具要多跑一整轮，很贵），一行一条，可以和别的 board 块写在同一轮：

  ˋˋˋˋboard memo
  know text="读了十分钟讲解以后来了 9 句、每句写主干加翻译，学生说量太大、叫停了" basis=say
  note text="换括号那一步还是要停很久" about=W19
  error step="第 1 步换括号" cause="把 βᵀα 当成矩阵" weakness=W19 basis=q-b5
  weakness id=W19 level=L0 basis=q-b5,q-b7
  review id=R3 result=过 basis=q-b9
  position next="先收 L2-08 的同类题，再推 Aⁿ" debts="例 2.3；例 2.4"
  todo text="学生问了相似对角化的几何意义，资料包里没有"
  recall q="外积 αβᵀ 的秩是多少（α、β 都不是零向量）" a="1：每一列都是 α 的倍数"
  ˋˋˋˋ

  - ˋknowˋ **关于这个学生、关于怎么教这个学生，值得以后的课知道的事**：学生的情况和习惯、学生对这节课说的话、哪种讲法这次管用或不管用。写你看到的事实，带上当时的情形；学生说的话写 ˋbasis=sayˋ，页面把原话附上。**照实写这一次，不替学生推广成「以后每次都……」**；学生自己明说以后都这样的，把这句也照实写上。三科都用得上的加 ˋshared=1ˋ。页面把它记成记忆摘要的新笔记（下一轮起就在「你对这个学生的了解」里），下课后连同整节课的记录一起并进摘要。
  - **学习的账由你记**，都直接写，不用等学生确认（学生事后看，不对能撤销）：ˋnoteˋ 观察、ˋtodoˋ 待办（学生问了资料包以外的，下次备课补）、ˋerrorˋ 新错题（ˋq mine step causeˋ，ˋweakness=ˋ 挂哪个弱点，不写 ˋidˋ 页面自动编号；题面、学生的答案不写时页面从依据里那次作答补；同一道题不记两次）、ˋweaknessˋ 改已有弱点的 ˋlevel scope status errors blocksˋ（写 ˋid=ˋ），或者新弱点（ˋtitle scope levelˋ，不写 ˋidˋ）、ˋreviewˋ 复现组判结果 ˋresult=过 / 没过ˋ、加题 ˋadd="…"ˋ，或者新的一组（ˋtitle family content weaknessesˋ）、ˋpositionˋ 下一节从哪接（ˋnext block debts firstˋ）。**不收**：掌握状态（页面按证据算）。
  - ˋrecallˋ **要背的一条**（记忆点）：定义原文、结论、表里的一格、公式、句型搭配……会推出来、要现场想方法的不算（那是复现组管的）。ˋq="问法"ˋ 一条只问一件事，ˋa="标准答案"ˋ 写成学生能对着检查的样子，ˋblock=ˋ 不写就挂这节课的块。页面从明天起每天让学生在首页自己想一遍（先写再看答案，按 1 → 3 → 7 → 14 → 30 天排，想不起回到 1 天），你上课不用再专门测这些。改问法、答案写 ˋrecall id=K3 q="…" a="…"ˋ，不用记了 ˋrecall id=K3 status=void why="…"ˋ。和已有的几乎一样的页面不收。
  - **少记，只记以后用得上的**：记之前问自己「下一节课会因为这条做得不一样吗」，不会就不记。学生的每一次作答、对错、用时页面已经自动记了，不要再用 note 复述「第 1 句写对了」。已经有的弱点、错题、待办又出现就改那一条（弱点改 ˋlevelˋ），不另记一条；和已有的说的是同一件事的页面不收。一个 memo 块最多 12 条。
  - ˋbasis=ˋ 写依据，逗号隔开：黑板上的组件 id（ˋq-b5ˋ，页面换成学生在那道题上的全部作答）、段 id（ˋb5ˋ）、ˋsayˋ（学生刚说的那句话）、记忆里的编号（ˋL2-07ˋ ˋW19ˋ）、证据 id（ˋev-…ˋ）。新的错题、弱点、复现组一定要有依据，找不到依据的不记。
  - 有空格的值加引号。写错的、找不到依据的，页面不记，下一轮在 [系统] 提醒里告诉你原因。上课时板上不显示记了什么（不打扰学生）。
  - 学生临时改了计划、这节课讲的不是资料包里那一块：写一行 ˋblock id=EN-L1.1.1ˋ（课程地图里的编号），之后的作答、记忆都按那一块记。
`;
// 这节课要拿下的事（class/aims.js，设计 6.2）：怎么写、题怎么挂上去、状态是谁算的。只写事实和写法；
// 「没定的时候第一轮先写」对应根本规则的保险「这节课要拿下的事开课先告诉学生」。只在学习台里上课时带（单独的课堂页存不了）
export const AIMS_DOC = doc`
- **这节课要拿下的事**（「黑板现状」最前面列着，学生在板的上方也看得到）：2～5 件，每件是学生下课时要能自己做出来的一件事，难度和问法照真题。还没定的时候，第一轮先写：

  ˋˋˋˋboard aims
  a1 ｜ 给一个引用串，手算 LRU 的缺页次数和换出的页 ｜ 独立做一道没见过的同类题，写出每次换出的理由 ｜ exam=Q-408-2023-45
  a2 ｜ 说出 LRU 和 FIFO 各在什么时候吃亏 ｜ 用自己的话讲清一个反例
  ˋˋˋˋ

  一行一件，格子用全角「｜」隔开：编号 ｜ 学生要能做的事（写成动作）｜ 什么算做到 ｜ ˋexam=ˋ 对着的真题题号（后两格可以不写）。这个块不上板。课上发现缺前置、发现哪件早就会了，再写一次整份换掉：没变的那几件编号和话照旧；编号还在、话换了的算另一件事，以前的作答不算它的。
- 板上给某一件用的题，那一段写 ˋaim=a1ˋ（ˋboard add id=b5 aim=a1ˋ），这一段里学生的作答才算到那一件上。每件到了没有由页面按作答算，只看最后一次失手以后的：学生自己写出、做出答案而且一次做对是「独立做到」；改对的、分步带着做的、演示里问一下的是「带着做到」；选择题要 4 个以上选项而且学生点了「有把握」才算独立；学生标了没把握的不算独立。讲过了、学生说懂了都不算。
`;
export const DESK_DOC = doc`
### 在学习台里上课

- 学生在黑板上的每个动作（作答、预测、拖动、揭开、放弃）、在输入框里说的话、附的图，页面都自动记成证据（evidence），课后看证据判断。证据你不用写，也写不了。
${CLASS_MEMO_DOC}
- 新写的一段可以标上练的是哪个知识点：ˋboard new id=b3 title="…" point=trˋ（ˋpoint=ˋ 写上面掌握状态里 ˋ#ˋ 后面那段名字），学生在这一段的作答就记成这个知识点的证据。没有合适的就不写。
${AIMS_DOC}
- 记忆分两层：前面是和这节课直接有关的全文，最后是其余东西的目录（一条一行：编号 + 一句话）。目录里的要看全文，用 ˋmemory_readˋ 按编号取：ˋcollectionˋ 写集合名，ˋidsˋ 写编号数组，**一次取好几条**（同一类的放一起）；以前的课写 ˋcollection: "sessions"ˋ，给你那节课的报告和小结。**很贵**：每用一次要多跑一整轮、整份说明再读一遍。该取的时候：学生的错像目录里某道旧错题（取来对照根因）、要提起或接着以前某节课、要按某条规则做又拿不准原文。别的时候用全文里的就够了。
`;
const DESK_DOC_NO_TOOLS = doc`
### 在学习台里上课

- 学生在黑板上的每个动作、说的话、附的图，页面都自动记成证据（evidence），课后看证据判断。
${CLASS_MEMO_DOC}
- 这个查看方式不支持工具：查不了记忆库里没放进摘要的部分。
- 新写的一段可以标上练的是哪个知识点：ˋboard new id=b3 title="…" point=trˋ（ˋpoint=ˋ 写上面掌握状态里 ˋ#ˋ 后面那段名字）。
${AIMS_DOC}
`;
/** 「在学习台里上课」那一节：有记忆摘要时记忆块的说明换成 SUMMARY_MEMO_DOC */
export const deskDoc = ({ tools = true, summary = false } = {}) => {
  const base = tools ? DESK_DOC : DESK_DOC_NO_TOOLS;
  return summary ? base.replace(CLASS_MEMO_DOC, SUMMARY_MEMO_DOC).replace('、要按某条规则做又拿不准原文', '') : base;
};
// 记忆摘要最多占多少（规则 + 摘要合起来）；剩下的给资料包
// 记忆每一轮都要带，多 1 KB 每一轮都多读 1 KB：只许降、不许涨（tests/memory-digest-fit.test.js 守着）。
// 2026-11-03 从 32 KB 降到 28 KB：装的先后改成先装这一块的（digest.js 的 PACK_ORDER）以后，真数据里三门课每一轮都比原来轻
// （英语 −0.6 KB、数学 −3.8 KB、408 −2.9 KB），这一块的错题、弱点、掌握、关于我照样都在；再低就有二十多条规则进目录，
// 课堂 Claude 要用时得调工具取（多等一整轮），反而更慢
export const MEMORY_BUDGET = 28 * 1024;

// —— 教学计划（docs/learning-plan.md 第 5 节）：老师写给自己看的几行，学生看不到。
// 一节课几十轮、中间还会压缩对话，「我要带学生到哪、我猜卡在哪、怎么证实」很容易断。页面只把最新的一份放进下一轮的说明，
// 对话历史里把 plan 块去掉（不重复付钱）；只在判断变了时改写，平时不写（每写一次多等几秒）。
export const PLAN_DOC = doc`
### plan：你的教学计划（学生看不到）

ˋˋˋˋboard plan
目标：学生自己说出 $A^n$ 为什么等于 $(\operatorname{tr}A)^{n-1}A$
猜：把 $\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha$ 当成矩阵（上一题选了 3×3）
证实：让学生说 $\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha$ 几行几列；对了就推 $A^2$
ˋˋˋˋ

- 写给你自己的：这节课要到哪（目标），你现在猜学生卡在哪种误解（猜），下一步拿什么来证实或推翻（证实）。三四行就够，最多 200 个字。
- 页面不显示它，只把**你最近写的那一份**放进下一轮说明的「黑板现状」前面；对话历史里的 plan 块页面会去掉。
- 猜到了就马上验：「证实」写的是下一两轮就出的那道小题（能把两种想法分开的），不是等讲到那里再说。
- **只在判断变了时写**：开课时写一份；学生的作答让你改了猜测、目标达到了要换目标时再写。没变就不写（每写一次学生要多等几秒）。
`;

// 「你会收到的消息」里的几条
// 只说明这四句是学生点按钮发来的；怎么接由根本规则当场定，不在这里写（以前括号里写着「退一步重讲」「先请学生试试」这类形式）
const MSG_QUICK = doc`- 学生打的字，原样给你。「没懂。」「想不出来。」「换个说法讲讲？」「继续。」这四句是学生点底下的快捷按钮发来的。`;
const MSG_IMAGES = doc`- 附了图片时，是学生的手写或截图（白底黑字），就在这一轮里。`;
const MSG_SUMMARY = doc`- 「【到目前为止的课堂摘要】」是更早的对话压缩成的摘要，摘要之前的原文已经不在了。`;

// —— 2. 黑板指令协议（需求 2.1 / 2.2）。写法要和 protocol.js 的解析一致 ——
export const PROTOCOL_DOC = doc`
你的每一轮输出是一段文本，页面一边收一边处理：

- **黑板一屏就是一块板。**学生眼前始终是「当前板」；旧板收进历史，学生可以翻回去看。每一轮你要么**换一块新板**（ˋboard newˋ），要么**在当前板上改**（ˋaddˋ、ˋreplaceˋ、ˋhideˋ、ˋfigureˋ、ˋmarkˋ），要么只说话。
- **黑板指令以外的文字，都是对学生说的话**，也写在黑板上：写在当前这块板的最上面（这一轮换了新板，就写在新板上），下一轮你再说话就把它换掉（支持 Markdown 和 $公式$，不要写 ˋ##ˋ 标题）。
- 学生说的话不显示在黑板上，只有你看得到。
- **要写上黑板的内容，放在语言名为 ˋboardˋ 的围栏代码块里**。块的第一行是指令。你写的时候，学生看到你说的话一点点出现，写完的段可能先画出来（ˋholdˋ 藏着的不会）；整轮写完、确认是你（Opus 5.5）写的之后，页面按出现的顺序执行所有指令。
- 一轮里可以有好几个指令，按出现的顺序执行。

**外层一律用 4 个反引号**：开头一行是 4 个反引号紧跟 board 和指令，结尾单独一行 4 个反引号（见下面的例子）。块里的组件照常用 3 个反引号，这样组件的结尾不会把外层提前关掉。

下面例子里的 id（b3、b4、fig-b3、k1……）只是示范，不在黑板上；黑板上实际有什么，看「黑板现状」。

### 一块板放多少

- 板比一屏长时学生上下滑着看；学生也能自己调黑板的字号。「黑板现状」里写着学生屏幕上一块板大约多高。
- **一轮最多开一块新板**：这是页面的限制（ˋboard newˋ 一轮只写一个；同一轮里多写的，页面会并到这块板上）。板可以往下长，学生上下滑着看。
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

### add：在当前板上再加一段

ˋˋˋˋboard add id=b4 title="提示"
先只看括号里：$\boldsymbol\beta^{\mathrm T}\mathbf x$ 是几行几列？
ˋˋˋˋ

加在当前板的最后，写法同 new（ˋtitle=ˋ 是这一段的小标题）：在当前板上接着写。ˋnewˋ 是另开一块板、当前板收进历史（学生能翻回去看）。还没有板时，add 也会开第一块板。

### replace：改写一段

ˋˋˋˋboard replace id=b3 title="Ax 还在这条线上"
（b3 的完整新内容，写法同 new）
ˋˋˋˋ

整段换成新内容，留在原来那块板上原来的位置；ˋtitle=ˋ 不写就沿用原来的标题。学生在旧内容里的作答会被清掉，所以只用来修正写错的段、精简放不下的板、确实需要重画的段，或者照学生断的那一步改原来的讲解（在原来的讲解上改给学生看，不另起一段）。

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

在板上已有的字、公式、图上画手绘的记号（圈、框、大括号、下划线、荧光笔、箭头……），像站在黑板前的老师指着讲。标注留着，直到你撤掉，或者所在的段被 ˋreplaceˋ / ˋhideˋ。

ˋˋˋˋboard mark target=b5 li=1-4 style=brace color=pink note="要背"
ˋˋˋˋ

ˋˋˋˋboard mark target=b5
text="be 动词除外" color=red note="例外"
text="谓语动词加 -s" style=highlight
ˋˋˋˋ

- 画法：ˋbraceˋ 大括号、ˋli=1-4ˋ 一个大圈，把一组东西合成一个记号；ˋhighlightˋ / ˋunderlineˋ 标一个词、一句；ˋdotsˋ 着重号；ˋtickˋ / ˋcrossˋ 对错号；ˋstrikeˋ 划掉；ˋto="…"ˋ 画箭头连到另一处；ˋnote=ˋ 在旁边写一句。
- 块里每行一条，ˋtarget=ˋ ˋcolor=ˋ ˋstyle=ˋ 不写沿用开头那行。ˋtarget=ˋ：段的 id（ˋb5ˋ、常驻栏 ˋk1ˋ）或组件的 ˋid:ˋ，只能标当前板和常驻栏。
- 标哪里（不写就是整个 target）：
  - ˋtext="板上的字"ˋ：任何一段字，中文英文都行（空格、全角半角不管）；长的写头尾 ˋtext="主语是…除外"ˋ；出现几次时 ˋ#2ˋ。ˋli=1-4ˋ 列表第几条，ˋpara=2ˋ 第几段，ˋtr=2ˋ 表格第几行。
  - ˋterm=名字ˋ：公式里 ˋ\hl{名字}{…}ˋ 包起来的项（ˋ\hlˋ 只起名字、不画；普通文字用 ˋtext=ˋ，别塞进公式）。
  - ˋrow=2ˋ ˋcol=3ˋ ˋdiagˋ ˋentry=2,3ˋ ˋblock=1,2ˋ（先 ˋsplitˋ）：ˋmatrixˋ 组件或公式里 ˋbmatrixˋ 的部位，几个矩阵时加 ˋof=名字ˋ（ˋname=ˋ 或 ˋ\hlˋ 的名字）。
  - ˋstep=2ˋ：ˋstepsˋ 走到的第 2 步。ˋlabel=Axˋ ˋitem=4ˋ ˋat=[1, 2]ˋ：图里标签是 Ax 的、第 4 条命令画的、坐标 (1, 2)，图动了跟着挪。
- ˋstyle=ˋ：ˋcircleˋ 圈（跨行的沿着字圈）ˋboxˋ 框 ˋbraceˋ 大括号 ˋunderlineˋ ˋdoubleˋ 双线 ˋwaveˋ 波浪线 ˋdotsˋ 着重号 ˋhighlightˋ 荧光笔 ˋstrikeˋ 划掉 ˋtickˋ ✓ ˋcrossˋ ✗ ˋarrowˋ 箭头（从旁注或 ˋto=ˋ 指过去）。不写时：几个字、项、元素圈，长句划线，一组列表大圈，行、列、整段框。
- ˋcolor=ˋ：ˋyellowˋ（默认）ˋpinkˋ ˋblueˋ ˋgreenˋ ˋorangeˋ ˋpurpleˋ ˋredˋ ˋwhiteˋ（✓ 默认绿、✗ 默认红）。ˋnote="…"ˋ 旁边写一句（短，可以有 $公式$），ˋside=right|left|above|belowˋ。
- 写板时就知道是重点的，直接写进字里：ˋ==要背的==ˋ（粉色荧光底）、ˋ=={yellow}关键==ˋ（ˋblueˋ ˋgreenˋ ˋredˋ 也行）；公式里 ˋ\boxed{…}ˋ ˋ\cancel{…}ˋ ˋ\chalk{pink}{…}ˋ。讲着讲着才要指的用 mark。
- 撤：ˋboard unmark id=m3ˋ / ˋtarget=b5ˋ / ˋallˋ，换讲法前撤掉不相关的。找不到要标的地方：这条不画，「[系统] 指令 mark 没执行」说原因；黑板现状里每段下面列着现有的标注。

### pin / unpin：常驻栏

ˋˋˋˋboard pin id=k1 title="这节课的记号"
$A=\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$，$\boldsymbol\alpha=(1,2)^{\mathrm T}$，$\boldsymbol\beta=(1,1)^{\mathrm T}$
ˋˋˋˋ

- 常驻栏在黑板旁边（横屏在右边一栏，竖屏在上面一条），换板也不擦，学生一直看得到。
- 常驻栏用另一套编号：k1、k2……；同一个 id 再 pin 一次就是改写。撤下：

ˋˋˋˋboard unpin id=k1
ˋˋˋˋ

### react：答案固定时页面替你接（不调用你）

ˋˋˋˋboard react target=q-b3
right show=b4: 对。再来一个：乘 $(1,0)$ 呢？
done step=3: 例题看完了，下面这道你来。
ˋˋˋˋ

- 调用你一次学生要等几十秒。**只预写答案固定、你当场写也一样的**：ˋrightˋ 答对（一句确认，ˋshow=ˋ 揭开这一轮写好、ˋboard add id=b4 holdˋ 藏着的下一小问）、ˋdoneˋ steps 看完（可加 ˋstep=3ˋ）。页面把话写到板顶。
- **教学不预写**：答错怎么引导、想不出来怎么提示，要看着这一次的作答当场写；页面不收 wrong / misread / giveup。要听理由、答对了也要追问的题不写 right。每条只用一次，答对整组收起，空块是撤掉。

### why：预写一步的依据

ˋˋˋˋboard why target=ex-1
step=2: 因为 $\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha$ 是一个数，能挪到最前面。
ˋˋˋˋ

学生能点板上任何一处问「为什么 / 没看懂 / 举个例子」。ˋwhyˋ 写一句这一步的依据（哪条性质、哪个定义），点「为什么」时页面当场显示、不调用你（ˋstep=ˋ、ˋterm=ˋ（ˋ\hlˋ 的名字）、ˋallˋ）。

### 一轮输出的样子

下面只是指令格式的示范。

看 $A$ 的两列：它们一样，所以 $A$ 把整个平面压到了一条线上。

ˋˋˋˋboard new id=b5 title="两列一样的矩阵"
$A=\begin{pmatrix}1&1\\2&2\end{pmatrix}$ 的两列都是 $(1,2)$，所以

$$A\begin{pmatrix}x\\y\end{pmatrix}=x\begin{pmatrix}1\\2\end{pmatrix}+y\begin{pmatrix}1\\2\end{pmatrix}=(x+y)\begin{pmatrix}1\\2\end{pmatrix}.$$

不管 $\mathbf x$ 是什么，$A\mathbf x$ 都落在 $(1,2)$ 这条直线上，落在哪只看 $x+y$。

例：$\mathbf x=(2,-1)$ 时 $x+y=\calc{2+(-1)}$，$A\mathbf x=(1,2)$。
ˋˋˋˋ

ˋˋˋˋboard add id=b6
ˋˋˋpredict
id: pred-b6
title: A 把 (1, 1) 送到哪
q: 照上面的写法想，不做矩阵乘法：把紫色圆点拖到 $A\begin{pmatrix}1\\1\end{pmatrix}$ 那里。
let A = [[1, 1], [2, 2]]
vector [1, 1] color=gray dashed label=x
vector A*[1, 1] color=yellow label=Ax after
answer: A*[1, 1]
explain: $x+y=2$，$A\mathbf x = 2\cdot(1, 2) = (2, 4)$，还在 $(1, 2)$ 这条线上。
ˋˋˋ
ˋˋˋˋ

### 写的时候注意

- 你说的话（board 块以外的文字）写在当前板顶上。
- 组件只能写在 ˋboard newˋ / ˋaddˋ / ˋreplaceˋ / ˋpinˋ 里面，写在外面只会显示成一段代码。不要把 board 块套在别的代码块里，也不要在 board 块里再写 board 块。
- 围栏没闭合、指令看不懂的块，会原样当成普通文字写在板顶，黑板上什么也不会发生。
- 当前板上已经有的图能用 ˋfigureˋ 改；板上已有的东西能用 ˋmarkˋ 圈出来。
- **黑板上的数让页面来算**：公式里写 ˋ\calc{表达式}ˋ，页面用精确分数算好再写上去，比如 ˋ$A^2=\calc{A^2}$ˋ、ˋ$\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha=\calc{b'*a}$ˋ。变量用 ˋletˋ 块定义的量（见组件说明）；说的话、题面、提示、解析里都能用。
- 学生在黑板上的作答，页面会自动发给你，不用让学生「做完告诉我」。

### 你会收到的消息

${MSG_QUICK}
- 「[指着问] …——为什么？（要指着讲，可以 mark target=ex-1 step=2）」：学生点着那一处问的。先 mark 出来，就那一处讲，别从头讲。
- 以「[作答]」「[动作]」开头的行，是学生在黑板上的操作记录，页面自动生成，一行一条，比如：
  - [作答] b3 里的 answer q-b3「算一个」：填了 (4, 2)（错，第 1 次），用时 31 秒
  - [动作] b2 里的 steps ex-1 第 2 步：想不出来，直接揭开了
  - 「（对）」「（错）」是程序判的；没写对错的是自由作答，要你来看。注明「手写转写」「截图转写」的文字是从手写认出来的，可能有认错的字。
  - 学生拖图、揭开中间的步骤，跟着下一条一起到。
- 以「[草稿]」开头的行，是学生在黑板上写了、**还没点「检查」「提交」**的内容（填了一半的格子、打了字的理由框、勾了还没提交的选项），跟着学生下一条说的话或作答一起到，比如：
  - [草稿] b4 里的 answer q-b4「算一个」：写着 (3, □)，还没提交
  - 草稿是学生还没提交的，页面不判对错。黑板现状里每个组件下面也列着它现在的草稿。
${MSG_IMAGES}
- 以「[板书]」开头的行：学生用 Apple Pencil 直接在黑板上写了东西（演算、圈画、批注），导出成图附在这一轮（白底黑字，只有学生的笔迹，排列和黑板上一样；写在哪一段旁边那行会说）。
- 「[动作] 学生在当前板上 … 分钟没有动静」：题还没做，学生却很久没点、没写、没打字。学生可以在「⋯」里关掉这个提醒。
- 以「[系统]」开头的是页面发的消息。「[系统] … 写法错误」：那一段没显示，只用 ˋboard replaceˋ（id 不变；或者 ˋboard addˋ 同一个 id）把它重写对，不用对学生说别的（这时说的话不上黑板）；同一段最多重写 2 次，还不对就显示「这段没画出来」，课堂继续。ˋnewˋ / ˋaddˋ 撞了已有的 id 不会覆盖，换个新 id 再写。「[系统] 指令 … 没执行」多半是 ˋtarget=ˋ、变量名写错或图不在当前板上，对照「黑板现状」；「看不懂」「没闭合」的块已当文字写在板顶，下一轮注意写法就行。
${MSG_SUMMARY}
- 能用工具时，ˋcalcˋ 工具可以精确地算一个式子。每用一次你都要多等一整轮，所以只在改数出新题、得先知道结果才能决定怎么出时用；写上黑板的数用 ˋ\calc{…}ˋ。
`;

// —— 老师的眼睛（boardeye.js，第十三轮）：只写事实（你看得见什么、样子归谁定），不规定板该长什么样 ——
// 以前板的样子是记忆里的规则定死的模板（每块板一行图例、重点框、粉框、红圈、黄括号），老师又看不见排出来什么样
export const EYE_DOC = doc`
### 你看得见板

每一轮开头附着页面拍的图：学生现在看到的这块板，是学生屏幕上真实的样子（板比三屏长时只拍前三屏）。板长什么样由你设计：用哪些组件、分不分栏、哪里用图、哪里标重点、字多字少，都看这一处的内容定，没有固定的版式。上一轮排出来不对（字挤在一起、被框切掉、重点淹在字里、和你想的不一样），用 ˋreplaceˋ 改。`;

// —— 版面（canvas.js，docs/canvas-plan.md）：开着时你自己排板 ——
// 版面开着时页面不再自动左图右文（classroom.js 的 renderSeg 不 splitFigure）：这一句不带
const SPLIT_LINE = doc`- 横屏的 iPad 上，一段里正好有一张图（ˋsceneˋ、ˋgraphˋ、ˋspaceˋ）和别的内容时，页面会自动排成左图右文。`;
export const CANVAS_DOC = doc`
### 版面：你自己排板

这节课的黑板是**一整块横屏**。没有模板，也不用写坐标：你说这块板的**结构**，页面按真实内容排（每段多高页面量，不用你估）。

- ˋboard new … cols=7/5ˋ：这块板分两栏，宽 7:5（ˋcols=1/1/1ˋ 三栏等宽，不写就是一栏）。讲到一半要换：ˋboard layout cols=6/6ˋ。
- 每一段写 ˋcol=1ˋ / ˋcol=2ˋ 放第几栏；同一栏里按写的先后**从上往下接**。不写就接着上一段那一栏。ˋcol=allˋ 是横跨整块板的一段：它前面、后面的段各成一层分栏（比如上面一张横跨的图，下面两栏）。
- ˋboard move id=b3 col=2ˋ：挪到别的栏（放到那一栏最下面，不重画，作答都在）。
- 栏和栏之间页面画一道竖线，一栏从上往下读。窄栏里长的句子、大段英文会折成很多行；两栏高矮差得太多页面会改成一栏（黑板现状里会说）；版面里页面不再自动左图右文，图和讲它的话要对着看就各放一栏。
- 黑板现状里写着当前板的版式（几栏、每栏从上往下是哪几段、各多高）和整块板比一屏长多少。
- 藏着的段（ˋadd … holdˋ）揭开时出现在它那一栏它的位置上。
- 要拖、要看细节的图，学生能点角上的 ⤢ 放大铺满整屏。
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
// 带着「这一块在考试里」的课，资料包让出考情占的地方以后教材原文至少留这么多（舞台课一直这样，stage/doc.js 从这里引；
// 黑板课第一问「难度和问法照真题」要考情每一轮都在，但不能把教材原文挤没：事实照资料讲。黑板课资料包紧的时候留一半，见 buildSystem）
export const TEXTBOOK_FLOOR = 32 * 1024;
export const CUT_NOTE = '（资料包太长，已截断）';
const PACK_FIELDS = [
  ['unit', '单元'],
  ['goal', '这节课的目标'],
  ['scope', '范围和详略（考试口径；超出的不讲）'],
  ['route', '给学生看的路线（开课第一块板照着写，可以缩短；学生要改就按学生的）'],
  ['review', '开头的复现'],
  ['methods', '这节课要用的可执行规则（课前定好、写完整了的：讲到时照这里写上黑板，常驻栏里放一份；做题只用这里讲过的）'],
  ['sequence', '讲解顺序（一步一块板：一个点，或者大的点的一部分；大的点分几步讲，不压缩；讲完一个点再出考它的题）'],
  ['prepCheck', '备课检查（页面核出来的问题：上课时绕开，比如先补讲、或者那道题不出）'],
  ['rehearsal', '课前预演（备课以后按学生的记录把教案走了一遍：哪一步多半会卡、确认题暴露不出误解的地方、能分开对错想法的探题。是参考，学生实际怎么答照旧当场看着接）'],
  ['todos', '学生以前上课时问过、这节课要补上的'],
  ['carry', '上一节下课整理单里没收的几条（守卫拦下的，后面写着原因；要紧的这节课顺带补，依据写对：引原话照抄、轮次和板上编号写这节课真有的）'],
  ['textbook', '教材原文（教材内容只能用这里的）'],
  ['plan', '建议的推进顺序（是建议，按学生的实际情况调整）'],
  ['student', '学生的情况'],
  ['examBar', '这节课结束时学生要能做的真题（备课定的，考情）'],
];
// 不放进资料包正文的字段：rules 放在第 1 部分；模型由页面固定（需求 2.3），资料包里写了也不理
// components 是这节课要用的组件：它们的完整写法放进第 2 部分（packComponents），不写进资料包正文
// chunks（备课挑的教材条目，全文已经并进「教材原文」）、by / at / cost / date（学习台备课时记的）也不放
const PACK_SKIP = /^(rules|updatedAt|createdAt|id|model|modelTier|effort|components|chunks|by|at|cost|date|reviewClass)$/i;

// floors：{ 字段: 至少留几个字节 }（舞台课给教材原文留 32 KiB：资料包放不下时 fairShares 先截最大的字段，被截的多半是教材原文）
export function packText(pack, budget = PACK_BUDGET, { floors = null } = {}) {
  const main0 = pack?.main && typeof pack.main === 'object' ? pack.main : {};
  // 学习台备课写的教案（规则清单、讲解顺序、复现、备课检查）是结构化的，写成好读的文字
  const main = { ...main0, ...lessonPlanText(main0) };
  const parts = [];
  const known = new Set([...PACK_FIELDS.map(([k]) => k), 'images']);
  for (const [k, label0] of PACK_FIELDS) {
    const label = label0;
    const t = asText(main[k]);
    if (t) parts.push({ key: k, label, body: t });
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
    return { text: '还没有资料包：只讲最基本的、不确定的内容说「这个下次课讲」。', truncated: false, empty: true };
  }

  // 题目按整道题截（截半道题的 JSON 没用），其余字段按字节截
  const probBody = problems.length ? `[\n${problems.join(',\n')}\n]` : '';
  const sizes = [...parts.map((p) => bytes(p.body)), ...(probBody ? [bytes(probBody)] : [])];
  let limits = fairShares(sizes, budget);
  // 留底的字段：分到的不够底线（和它自己的大小取小的）时先给它，别的在剩下的里面分
  for (const [k, floor] of Object.entries(floors || {})) {
    const i = parts.findIndex((p) => p.key === k);
    if (i < 0) continue;
    const want = Math.min(sizes[i], floor, budget);
    if (limits[i] >= want) continue;
    const others = sizes.map((x, j) => (j === i ? 0 : x));
    limits = fairShares(others, budget - want).map((x, j) => (j === i ? want : x));
  }
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
const ANSWERING = new Set(['answer', 'conjecture', 'quiz', 'predict', 'practice', 'steps', 'recognize', 'findbug', 'sortpass', 'code', 'derive', 'cloze', 'errfind', 'parse', 'drill', 'chunk', 'link', 'translate']);
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
  // 藏着的段（add … hold）：画好了，学生还看不到，等预案的 show= 或 board show 揭开
  const held = seg.held ? '（藏着，学生还看不到；预案的 show= 或 board show 揭开）' : '';
  lines.push(seg.summary ? `${head}${held}：${oneLine(seg.summary, 160)}` : head + held);
  for (const b of seg.blocks || []) {
    if (!b?.id) continue;
    // 图能用 figure set / play 改的变量（课堂说明被压缩成摘要后，Claude 看不到当初写的命令，靠这里知道）
    const vars = Array.isArray(b.vars) ? b.vars.filter(Boolean).join('、') : String(b.vars ?? '').trim();
    const name = `${b.kind || '组件'} ${b.id}${vars ? `（变量：${oneLine(vars, 160)}）` : ''}${b.outline ? `（${oneLine(b.outline, 200)}）` : ''}`;
    const res = (b.results || []).map((r) => resultLine(r, b.id)).filter(Boolean).slice(-maxResults);
    const draft = oneLine(String(b.draft ?? '').trim(), 300);
    // 还没用掉的预案（board react）：学生作答落在这几种情况时页面自己接
    const armed = b.react ? `    - 预案（还没用）：${oneLine(String(b.react), 200)}` : '';
    if (res.length) {
      lines.push(`  - ${name} 的作答：`);
      res.forEach((r) => lines.push(`    - ${r}`));
      if (draft) lines.push(`    - 现在写着（还没提交）：${draft}`);
    } else if (draft) {
      lines.push(`  - ${name}：还没提交，现在写着：${draft}`);
    } else {
      lines.push(`  - ${name}${ANSWERING.has(b.kind) ? '：还没有作答' : ''}`);
    }
    if (armed) lines.push(armed);
  }
  // 板上已经圈了、框了什么（board mark）：要撤就 board unmark id=…
  const marks = (Array.isArray(seg.marks) ? seg.marks : []).filter(Boolean);
  if (marks.length) lines.push(`  - 标注：${marks.map((m) => oneLine(m, 120)).join('；')}`);
  return lines;
}

// 黑板现状。board 可以是：
// - 段的数组（不分板，从上到下列出来；测试和旧版用）
// - { segs, pages, cur, view, screen, fit }：一屏一块板。分成当前板、常驻栏、以前的板，加上屏幕大小和当前板放不放得下
// 这节课要拿下的事那一节的标题（课后报告 memory/report.js 的 reportText 里是同一句：下课时靠它认出报告里已经列过了）
export const AIMS_HEAD = '这节课要拿下的事（状态是页面按学生的作答算的）';
/**
 * 黑板现状最前面的那一节。aims 是 aimsSummary 的结果：
 * 有几件就列出来（每件带页面算的状态）；空数组是「这节课该有、还没定」，提醒老师这一轮先写；
 * 不是数组（旧课、复现课、单独的课堂页、别的调用的人）什么都不写。
 */
export function aimsStateText(aims) {
  if (!Array.isArray(aims)) return '';
  if (!aims.length) return '这节课还没定要拿下的事：这一轮先写 board aims（2～5 件，照真题的难度和问法），再开讲。';
  return `${AIMS_HEAD}：\n${aimsText(aims)}`;
}

export function boardStateText(board) {
  if (typeof board === 'string') return board.trim() || '黑板是空的。新的一段用 id b1。';
  if (board && !Array.isArray(board) && typeof board === 'object') { const head = aimsStateText(board.aims); return `${head ? `${head}\n\n` : ''}${pagedStateText(board)}`; }
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
  const grid = board.canvas ? '版面：整块横屏，这块板分几栏由你定（board new 的 cols=）。' : '';
  if (!pages.length && !list.length) return [`黑板是空的：第一块板用 board new 写。${screen}${grid}`, ids].filter(Boolean).join('\n');
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
      lines.push(board.canvas ? '当前板上的段：' : '当前板上的段（从上到下）：');
      for (const seg of here) lines.push(...segmentLines(seg));
    } else lines.push('当前板上还没有段。');
    // 版式：几栏、每栏从上往下是哪几段、各多高（你自己排板时用）
    if (board.canvas?.text) lines.push(board.canvas.text);
    const fit = board.fit;
    if (!board.canvas && fit && fit.fits === false && fit.need > 0 && fit.avail > 0) {
      // 稍长学生上下滑着看，不用为这个改板、也不用记成失误（改一次就是多写一整块板）；长到两屏多才提一句
      lines.push(fit.need > fit.avail * 2.2
        ? `（这块板很长：内容高约 ${fit.need}，一屏约 ${fit.avail}，学生要滑好几下。不用改这块；下一个点换新板时写紧凑些。）`
        : `（这块板比一屏稍长：内容高约 ${fit.need}，一屏约 ${fit.avail}，学生上下滑一下就看完，不用改。）`);
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

// 黑板指令不是组件：课堂 Claude 拿「mark」「标注」去查组件写法，以前回「没有叫 mark 的组件」，它就以为圈不了（2026-11-03）。
// 这些名字直接给黑板指令说明里那一节
const BOARD_DOC_ALIAS = [
  [/^(board\s+)?(un)?mark$|标注|圈|框|划线|波浪线|着重号|荧光笔|涂色|大括号|^tags?$|^highlight$|^circle$|^underline$|^brace$|^annotat/i, '### mark / unmark'],
  [/^(board\s+)?figure$|让图动/i, '### figure'],
  [/^(board\s+)?react$|预案/i, '### react'],
  [/^(board\s+)?why$/i, '### why'],
  [/^(board\s+)?(un)?pin$|常驻栏/i, '### pin / unpin'],
];
export function boardDocFor(name) {
  const n = String(name ?? '').trim();
  const hit = BOARD_DOC_ALIAS.find(([re]) => re.test(n));
  if (!hit) return '';
  const a = PROTOCOL_DOC.indexOf(hit[1]);
  if (a < 0) return '';
  const b = PROTOCOL_DOC.indexOf('\n### ', a + 4);
  return `「${n}」不是组件，是黑板指令（写在 board 块里），说明里这一节：\n\n${PROTOCOL_DOC.slice(a, b < 0 ? undefined : b).trim()}`;
}

// component_doc 工具：按名字取一个组件的完整说明；是黑板指令的给指令那一节；找不到时列出有哪些
export function docLookup(componentDocs, subject, name) {
  const src = asText(componentDocs);
  const names = allNames(src, subject);
  // 「标注」「圈」这类词先当黑板指令（英语课的 parse 说明里也有「标注」两个字，不能被它截走）；真有这个名字的组件照旧给组件
  const bd = boardDocFor(name);
  if (bd && !names.includes(String(name ?? '').trim().toLowerCase())) return bd;
  const d = componentDoc(src, name, subject);
  if (d) return cutBytes(d, DOC_MAX);
  throw new Error(`没有叫「${String(name ?? '').trim()}」的组件${names.length ? `（这门课有：${names.join('、')}）` : ''}。圈、框、划线、荧光笔这类标注不是组件，是黑板指令 board mark（说明里「mark / unmark」那一节）`);
}

// tools：这个查看方式给不给课堂 Claude 工具（不给就没有 component_doc，说明里不提它）
/**
 * 黑板课老师查记忆的工具说明（classroom.js 每次调用现拼）。没有摘要时和以前一字不差；
 * 有摘要时先说 summary，旧的规则、守则、关于学生、要求、失误写明不再给老师、不是规程（第十三轮）
 */
export function classMemoryReadDoc(sid = '', summaryOn = false) {
  if (!summaryOn) return '查学习台的记忆库（只读）。collection 写集合名：rules、profile、curriculum、errors、weaknesses、mastery、reviews、recall、position、slips、lessons、observations、sessions、evidence。ids 写编号数组，一次取好几条的全文（比如 collection errors、ids ["L2-07","L2-31"]；同一类的放一起取）；id 取一条。sessions 写课的编号，给那节课的要点、课后报告和小结。不写 id / ids 时列出这一类（可以写 block 只要挨着这一块的）。evidence 按 block 或 session（这节课是 ' + sid + '）查最近的 30 条。每调用一次你要多等一整轮：照记忆里的目录挑准了编号，一次取够。';
  return '查学习台的记忆库（只读）。collection 写集合名：summary（记忆摘要：shared 三科共用、math、cs、en；你说明里「你对这个学生的了解」就是它）、curriculum、errors、weaknesses、mastery、reviews、recall、position、observations、sessions、evidence。以前一条条记的 rules、lessons、asks、profile、slips 还存着，但已经并进摘要、不再给你，也不是规程：学生问起以前定过什么时才查。ids 写编号数组，一次取好几条的全文（比如 collection errors、ids ["L2-07","L2-31"]；同一类的放一起取）；id 取一条。sessions 写课的编号，给那节课的要点、课后报告和小结。不写 id / ids 时列出这一类（可以写 block 只要挨着这一块的）。evidence 按 block 或 session（这节课是 ' + sid + '）查最近的 30 条。每调用一次你要多等一整轮：照记忆里的目录挑准了编号，一次取够。';
}

/**
 * memory（学习台里上课时才有）：{ mem: 记忆库各类的数组, block: 这节课的块, session: 这节课的编号, use: 带哪些规则（rulesUse，原样交给 memoryDigest；不写当 teach）}。
 * 有记忆时多一节「你对学生的了解」，记忆库 rules 接在根本规则后面；记忆先占（最多 MEMORY_BUDGET），资料包用剩下的
 */
// canvas：这节课开着版面（你自己排板，canvas.js），说明里多一节 CANVAS_DOC
// exam：「这一块在考试里」那一节（exam/context.js 的 examForClass 拼好的文字，黑板课是 class/examroom.js 的 boardExam；
// 空的就没有这一节，说明和以前一字不差）。放在资料包后面、记忆前面；它占的地方资料包让出来（算资料包的预算时它已经在），
// 这时资料包里的教材原文留底（TEXTBOOK_FLOOR，资料包紧的时候是它这一轮预算的一半，见下面）。一问一答不带（旧的课，说明一字不变）
export function buildSystem({ rules, componentDocs, pack, board, packBudget = PACK_BUDGET, subject = '线代', tools = true, memory = null, plan = null, planDoc = true, canvas = false, exam = '', eye = false, project = null } = {}) {
  if (project) return buildProjectClassSystem({ componentDocs, pack, board, packBudget, subject, tools, canvas, exam, eye, project });
  const examText = String(exam || '').trim();
  const custom = asText(rules) || asText(pack?.main?.rules);
  const { docs } = systemDocs(componentDocs, subject, packComponents(pack), { lookup: tools });
  const lookupNote = tools
    ? '要用没写到的字段时用 component_doc 工具按名字取完整写法（要多等一轮）；'
    : '';
  // 这节课不提要拿下的事（黑板现状里没有 aims：以前开的课、复现课）时，学习台那一节里怎么写 board aims 的两条也不带：
  // 带了老师会照着写，页面又不收
  const hasAims = Array.isArray(board?.aims);
  const deskOf = (mem) => (memory ? deskDoc({ tools, summary: !!mem?.summary }).replace(hasAims ? '\u0000' : `\n${AIMS_DOC}`, '') : '');
  const parts = (packBody, mem = null) => {
    const desk = deskOf(mem);
    // 资料包（或参数）定的规则和记忆库的一样接在根本规则后面：以前整段覆盖，根本规则和保险都没了
    const base = mem?.rules ? memoryRules(subject, mem.rules) : defaultRules(subject);
    const role = custom ? `${base}\n\n这节课的资料包另外定的规则（和上面冲突时以这里为准）：\n\n${custom}` : base;
    const sections = [
      `你的角色和根本规则\n\n${role}`,
      `组件写法和黑板指令\n\n## 组件说明\n\n下面的组件说明原本是学生写的，文中的「我」指学生、「你」指写黑板的 Claude。说到 guided 课件的关卡、小节结构的地方，课堂里不适用；课堂里的段落由你用黑板指令一段一段写。有的组件这里只写了最常用的写法（末尾写着「更多写法」）：照着写就行；${lookupNote}写错了页面会把那个组件的完整写法附在提醒里。资料包里点了名的组件，完整写法已经放在下面；点了名时，没点名的不常用组件只留了标题（要用就按名字取）。\n\n${docs || '（组件说明没有打包进来。只用最常见的组件：answer、steps、scene、predict，写法要保守。）'}\n\n## 黑板指令\n\n${canvas ? PROTOCOL_DOC.replace(`\n${SPLIT_LINE}`, '') : PROTOCOL_DOC}${canvas ? `\n\n${CANVAS_DOC}` : ''}${eye ? `\n\n${EYE_DOC}` : ''}${planDoc ? `\n\n${PLAN_DOC}` : ''}`,
      // 顺序按「一节课里多久变一次」排：组件说明、资料包几乎不变，记忆（等确认的改动）偶尔变，黑板现状每轮都变。
      // 每一轮整份重发；平台要是对重复的开头打折，不变的放前面最省
      `这节课的资料包\n\n课前备好的（学习台备课、复现课由页面拼），课中也可能更新。${memory ? '在学习台里，资料包是这节课的额外安排（推进建议、备好的题），学生的情况看后面的记忆。' : ''}\n\n${packBody}`,
      // 考情：这一块考什么、怎么考、代表题（页面算的；一节课里只在老师用了新题号、学生做了真题时变）
      ...(examText ? [`这一块在考试里（页面从入库的真题和考试大纲算的）\n\n${examText}`] : []),
      ...(memory ? [`你对学生的了解（学习台的记忆库）\n\n${mem?.text || ''}\n\n${desk}`] : []),
      `黑板现状\n\n${planDoc ? `${planText(plan)}\n\n` : ''}${boardStateText(board)}`,
    ];
    const NUM = ['一', '二', '三', '四', '五', '六'];
    return [
      `这是课堂模式的完整说明，每一轮都会重新发给你（资料包和黑板现状都是最新的）。说明后面是这节课的对话：学生说的话、学生在黑板上的作答记录（[作答] / [动作]）、页面的系统消息（[系统]），以及你之前的输出。${tools ? '较早几轮你写的长段原文被页面省略成了一行「[页面省略了这一段的原文……]」（段还在黑板上，要照着原文改写或对记号时用 board_read 按段 id 取回）；那是页面做的，你新写的段照常写完整。' : ''}`,
      ...sections.map((x, i) => `# ${NUM[i]}、${x}`),
      '（课堂说明到这里结束。下面是这节课的对话，回应最后一条消息。）',
    ].join('\n\n');
  };
  // 整份说明不超过 SYSTEM_MAX：记忆先占（最多 MEMORY_BUDGET），组件说明（按科目）长一点的课，资料包的预算跟着让一点；资料包至少留 16 KiB
  let mem = null;
  if (memory) {
    const room = SYSTEM_MAX - bytes(parts('', { rules: '', text: '' })) - 16 * 1024 - 3 * 1024;
    mem = memoryDigest(memory.mem || {}, { block: memory.block, space: memory.space, session: memory.session, tools, budget: Math.max(4 * 1024, Math.min(MEMORY_BUDGET, room)), use: memory.use, saidNow: memory.saidNow });
  }
  const rest = bytes(parts('', mem));
  const packRoom = Math.max(16 * 1024, Math.min(packBudget, SYSTEM_MAX - rest - 3 * 1024));
  // 考情占了地方时教材原文留底（不带考情的课一个字节都不变）：TEXTBOOK_FLOOR，但不超过这一轮资料包预算的一半。
  // 黑板课的组件说明比舞台课长三四十 KiB，记忆装满时资料包连考情只有五十 KiB 上下（数据结构最紧）：整 32 KiB 都留给教材原文，
  // 教案（规则清单、讲解顺序、以前的课）就只剩几 KiB——教材还能按编号再取，教案取不回来
  const floors = examText ? { textbook: Math.min(TEXTBOOK_FLOOR, Math.floor(packRoom / 2)) } : null;
  const { text: packBody } = packText(pack, packRoom, { floors });
  return parts(packBody, mem);
}
// —— 第十四轮：学习台里上课时，老师就是项目 Claude（project/system.js）——
// 这几段只写事实（有什么写法、页面会怎么做），不写该怎么教、该记什么（底线：不替它做任何事）
const EYE_FACT = doc`
### 你看得见板

每一轮开头附着页面拍的图：学生现在看到的这块板，是学生屏幕上真实的样子（板比三屏长时只拍前三屏）。`;
export const PROJECT_CLASS_DOC = doc`
### 在学习台里上课

- 学生在黑板上的每个动作（作答、预测、拖动、揭开、放弃）、在输入框里说的话、附的图，页面都自动记成证据（evidence）。
- **笔记本**也能在这一轮的输出里写（不多跑一轮），用 ˋnoteˋ 块，一行一个操作，正文写在 ˋ<<<ˋ 和 ˋ>>>ˋ 之间；页面在这一轮讲完以后执行，没改成的下一轮告诉你：

  ˋˋˋˋboard note
  create 学生/底子.md
  <<<
  正文
  >>>
  str_replace 学生/底子.md
  <<<
  旧的一段（要恰好出现一次）
  ===
  新的一段
  >>>
  insert 学生/底子.md 3
  <<<
  插在第 3 行后面
  >>>
  rename 学生/底子.md 学生/背景.md
  delete 草稿.md
  set 学生/背景.md pin=on order=1 show=off
  ˋˋˋˋ

  ˋpin=onˋ 的文件每一轮整份放进你的说明；ˋshow=onˋ 的出现在学生的「笔记」页（照课件画，组件能作答）。
- **学习的账**用 ˋmemoˋ 块写，一行一条；首页的复现、错题本、要记的、下一节从哪接就是读这些：

  ˋˋˋˋboard memo
  error step="第 1 步换括号" cause="把 βᵀα 当成矩阵" weakness=W19 basis=q-b5
  weakness id=W19 level=L0 basis=q-b5,q-b7
  review id=R3 result=过 basis=q-b9
  position next="先收 L2-08 的同类题，再推 Aⁿ" debts="例 2.3；例 2.4"
  todo text="学生问了相似对角化的几何意义，资料包里没有"
  recall q="外积 αβᵀ 的秩是多少" a="1：每一列都是 α 的倍数"
  block id=EN-L1.1.1
  ˋˋˋˋ

  ˋerrorˋ 新错题（不写 ˋidˋ 页面自动编号，题面和学生的答案没写时页面从依据里那次作答补）；ˋweaknessˋ 写 ˋid=ˋ 是改已有的弱点、不写是新弱点（ˋtitle scope levelˋ）；ˋreviewˋ 复现组判 ˋresult=过 / 没过ˋ（页面照它排下一次复现）、或者新的一组（ˋtitle family contentˋ）；ˋpositionˋ 下一节从哪接；ˋtodoˋ 待办；ˋrecallˋ 一条要背的（页面每天让学生在首页先写再看答案，按 1 → 3 → 7 → 14 → 30 天排）；ˋblockˋ 这节课讲的换成课程地图里的另一块（之后的作答按那一块记）。ˋbasis=ˋ 是依据：组件 id、段 id、ˋsayˋ（学生刚说的那句）、记忆里的编号、证据 id。掌握页面按证据算，memo 里不收。写错的页面不记，下一轮告诉你原因。
- **这节课要拿下的事**（可用可不用）：写一个 ˋaimsˋ 块，一行一件，格子用全角「｜」隔开：编号 ｜ 学生要能做的事 ｜ 什么算做到 ｜ ˋexam=ˋ 对着的真题题号（后两格可以不写）：

  ˋˋˋˋboard aims
  a1 ｜ 给一个引用串，手算 LRU 的缺页次数 ｜ 独立做一道没见过的同类题 ｜ exam=Q-408-2023-45
  ˋˋˋˋ

  写了的话：板的上方显示给学生、黑板现状最前面列着；题那一段写 ˋaim=a1ˋ，那一段的作答算到这一件上，页面按作答算每件的状态（还没证据 / 带着做到 / 独立做到 / 做了没到，只看最后一次失手以后的）；下课后页面留几道隔天做的题，结果记在这节课的 ˋlaterˋ。再写一次就整份换掉。`;

/** 下课那一次多的一句（只写事实）：学生点了下课；复现课、开头复现的组写明是哪几组、页面靠 review 那一行记结果 */
export function closingFacts({ review = [], opening = [] } = {}) {
  const groups = [...(review || []), ...(opening || [])].filter((g) => g?.id);
  return groups.length
    ? `学生点了下课。这节课复现的组：${groups.map((g) => `${g.id}${g.title ? `（${g.title}）` : ''}`).join('、')}；复现结果写 memo 的 review id=… result=过 / 没过，页面才会记。`
    : '学生点了下课。';
}

/**
 * 学习台里上课的说明（第十四轮）：项目 Claude 的那一份（学生的指令、它的笔记本、学习台里有什么、工具）+ 课堂的几段。
 * project：{ facts, instructions, notes, catalog, toolsDoc }；别的参数和 buildSystem 一样
 */
function buildProjectClassSystem({ componentDocs, pack, board, packBudget = PACK_BUDGET, subject = '线代', tools = true, canvas = false, exam = '', eye = false, project }) {
  const { docs } = systemDocs(componentDocs, subject, packComponents(pack), { lookup: tools });
  const lookupNote = tools ? '要用没写到的字段时用 component_doc 工具按名字取完整写法（要多等一轮）；' : '';
  const hasAims = Array.isArray(board?.aims);
  const deskDocNow = hasAims ? PROJECT_CLASS_DOC : PROJECT_CLASS_DOC.replace(/\n- \*\*这节课要拿下的事\*\*[\s\S]*$/, '');
  const compSec = `## 组件说明\n\n下面的组件说明原本是学生写的，文中的「我」指学生、「你」指写黑板的 Claude。说到 guided 课件的关卡、小节结构的地方，课堂里不适用；课堂里的段落由你用黑板指令一段一段写。有的组件这里只写了最常用的写法（末尾写着「更多写法」）；${lookupNote}写错了页面会把那个组件的完整写法附在提醒里。\n\n${docs || '（组件说明没有打包进来。）'}\n\n## 黑板指令\n\n${canvas ? PROTOCOL_DOC.replace(`\n${SPLIT_LINE}`, '') : PROTOCOL_DOC}${canvas ? `\n\n${CANVAS_DOC}` : ''}${eye ? `\n\n${EYE_FACT}` : ''}\n\n${deskDocNow}`;
  const examText = String(exam || '').trim();
  const sections = (packBody) => [
    { title: '组件写法和黑板指令', text: compSec },
    { title: '这节课的资料（资料包：页面拼的复现课资料、以前备课的 Claude 写的教案、教材原文）', text: packBody || '（没有）' },
    ...(examText ? [{ title: '这一块在考试里（页面从入库的真题和考试大纲算的）', text: examText }] : []),
    { title: '黑板现状', text: boardStateText(board) },
  ];
  const sys = (packBody) => projectSystem({ ...project, sections: sections(packBody), max: SYSTEM_MAX });
  const rest = bytes(sys('').text);
  const packRoom = Math.max(16 * 1024, Math.min(packBudget, SYSTEM_MAX - rest - 3 * 1024));
  const floors = examText ? { textbook: Math.min(TEXTBOOK_FLOOR, Math.floor(packRoom / 2)) } : null;
  const { text: packBody } = packText(pack, packRoom, { floors });
  return sys(packBody).text;
}

/**
 * 这一轮带哪些规则（digest.js 的 use）：下课那一次（all）、复现课的每一轮（review：这节课复现的那几组，sessions.review）
 * 带全部——管记录和复现的规则这时候才用得上；平时上课只带讲课用的
 */
export const rulesUse = ({ all = false, review = null } = {}) => (all || (Array.isArray(review) ? review.length > 0 : !!review) ? 'all' : 'teach');
/** 「你上一轮写的教学计划」那一段：plan 是 latestPlan 的结果（或者直接是文字） */
export function planText(plan) {
  const t = typeof plan === 'string' ? plan : plan?.text || '';
  if (!t.trim()) return '## 你的教学计划\n\n（还没写。开课时用 ˋboard planˋ 写一份：目标、你猜学生卡在哪、拿什么证实。）'.replace(/ˋ/g, '`');
  return `## 你的教学计划（你${plan?.seq ? `第 ${plan.seq} 轮` : '之前'}写的，学生看不到；判断变了就重写一份）\n\n${t.trim()}`;
}

/**
 * 这节课最近一份教学计划：从后往前找 Claude 写过的 plan 块（作废的轮不算）。
 * 看整段历史（不只是压缩后剩下的），压缩了也不丢。返回 { text, seq } 或 null
 */
export function latestPlan(history) {
  const said = (history || []).filter((h) => h && !h.discarded && h.role === 'claude' && h.kind !== 'closing');
  for (let i = said.length - 1; i >= 0; i--) {
    const { segments } = parseOutput(String(said[i].text ?? ''), { final: true });
    const p = segments.filter((sg) => sg.type === 'board' && sg.op?.op === 'plan' && sg.op.text).at(-1);
    if (p) return { text: p.op.text, seq: said[i].seq ?? null };
  }
  return null;
}

/** 对话历史里去掉 plan 块（最新的一份已经在说明里，不重复付钱） */
export function stripPlan(text) {
  const src = String(text ?? '');
  if (!/board[ \t]+plan/i.test(src)) return src;
  const { segments } = parseOutput(src, { final: true });
  if (!segments.some((sg) => sg.type === 'board' && sg.op?.op === 'plan')) return src;
  return segments.filter((sg) => !(sg.type === 'board' && sg.op?.op === 'plan'))
    .map((sg) => (sg.type === 'board' ? `\`\`\`\`board ${sg.header}\n${sg.body}\n\`\`\`\`` : sg.text)).join('\n\n');
}

// 每一轮的整份说明的上限（给对话留地方；CLAUDE.md 里写的 160 KiB）
// 2026-11-17 在学习台里量过（meta/speed）：160 KB 出第一个字 4.4～5.9 秒，300 / 500 KB 平台回 prompt_too_large，所以就是 160 KiB
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
    // 英语组件：一次尝试一条（detail 是页面说的哪里不对），最后一条是结果
    case 'cloze':
    case 'errfind':
    case 'parse':
    case 'drill':
    case 'chunk':
    case 'translate':
    case 'link': {
      const kind = { cloze: '填空', errfind: '改错', parse: '句子成分', drill: '操练', chunk: '意群断句', link: '连线', translate: '翻译' }[type];
      // 翻译：译文原文给老师（要点页面判了，通不通顺老师看）
      if (type === 'translate' && !a.final) return `[作答] ${where(a, kind)}：${a.q ? `「${short(a.q, 160)}」` : ''}译成「${short(a.value, 400) || '（空）'}」${mark(a.ok, a.attempts)}${a.detail ? `（页面按要点判：${short(a.detail, 160)}）` : ''}${a.misread ? `；页面看出来：${short(a.misread, 160)}` : ''}`;
      // 断句后写的译文（判不了分）：原样给老师
      if (type === 'chunk' && a.detail === '译文') return `[作答] ${where(a, kind)}：按意群写的译文：\n${short(a.text, 1200)}`;
      const q = a.q ? `「${short(a.q, 120)}」` : '';
      if (a.final) return `[作答] ${where(a, kind)}：${q}${a.revealed ? `试了 ${a.attempts || 0} 次没做对，看了答案${a.expected ? `（${short(a.expected, 160)}）` : ''}` : a.ok ? `做对了（共 ${a.attempts} 次）` : '没做对'}`;
      // misread：页面认出来的常见错答（只给老师：用它来追问，别直接告诉学生）
      return `[作答] ${where(a, kind)}：${q}写了 ${short(a.value, 300) || '（空）'}${mark(a.ok, a.attempts)}${a.detail ? `（${short(a.detail, 160)}${a.check ? `：${short(a.check, 160)}` : ''}）` : ''}${a.misread ? `；页面看出来：${short(a.misread, 160)}` : ''}`;
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
    case 'derive': {
      // 学生自己一行行推（derive mode: do）：每写一行页面查它和上一行相不相等，不等时写着取哪组数两边各等于什么
      if (a.final) return `[作答] ${where(a, 'derive')}：${a.giveup ? `推到一半想不出来${a.value ? `，写到了 ${short(a.value, 200)}` : ''}` : `推完了（一共改了 ${Math.max(0, (Number(a.attempts) || 0))} 次里${a.ok ? '' : '没'}推到）：${short(a.value, 300)}`}`;
      return `[作答] ${where(a, 'derive')}：${a.detail ? `${short(a.detail, 20)}` : ''}写了 ${short(a.value, 200)}${a.ok ? '（和上一行相等）' : `（和上一行不相等${a.check ? `：${short(a.check, 200)}` : ''}）`}${a.attempts > 1 ? `，这一行第 ${a.attempts} 次` : ''}`;
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
    case 'sure': {
      const sure = get('sure'), ok = get('ok');
      return `[动作] ${where(a, '组件', { title: false })}${subText}：学生标了「${sure ? '有把握' : '没把握'}」${sure === false && ok === true ? '——这题答对了，但没把握：没把握按没会处理' : sure === true && ok === false ? '——答错了却有把握：多半是一个误解，先弄清学生是怎么想的' : ''}`;
    }
    case 'gloss': return `[动作] 点开了生词「${short(get('word'), 40)}」看意思（${short(get('gloss'), 40)}）：这个词学生不认识`;
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

// 省额度、不丢信息（docs/memory-plan.md）：每一轮整段对话都要重发一遍，而 Claude 早先写的段原文（几 KB 一段）还在黑板上。
// 所以最近 STUB_AFTER 轮以前的 Claude 输出里，new / add / replace 的长段换成一行「页面省略了原文」，说的话、指令行、
// 标注、memo 照旧原样；要看原文用工具 board_read 按段 id 取（一次几段）。不支持工具的查看方式不省（取不回来）。
// 省略行故意不写成 board 块的样子，免得 Claude 照着学、新写的段也只写一行。
export const STUB_AFTER = 6;
const STUB_MIN = 400; // 原文比这短的不省
const STUB_OPS = new Set(['new', 'add', 'replace']);
// keep：最近用 board_read 取回过的段 id，这些不省（不然它取回来、下一轮又看不到，接着再取：每取一次多等一整轮）
export function stubBoardText(text, keep = null) {
  const src = String(text ?? '');
  const { segments } = parseOutput(src, { final: true });
  const long = (sg) => sg.type === 'board' && STUB_OPS.has(sg.op?.op) && bytes(sg.body) > STUB_MIN && !(keep && sg.op?.id && keep.has(String(sg.op.id)));
  if (!segments.some(long)) return src;
  return segments.map((sg) => {
    if (sg.type !== 'board') return sg.text;
    if (!long(sg)) return `\`\`\`\`board ${sg.header}\n${sg.body}\n\`\`\`\``;
    return `[页面省略了这一段的原文：这一轮写了 board ${oneLine(sg.header, 120)}（${(bytes(sg.body) / 1024).toFixed(1)} KB）。段还在黑板上，要看原文用 board_read 取 ${sg.op.id || '这一段'}]`;
  }).join('\n\n');
}

// 最近 STUB_AFTER 轮里 board_read 取过的段 id（各轮记下的工具调用 tools）
export function recentlyFetched(said = []) {
  const ids = new Set();
  for (const h of said.slice(-STUB_AFTER)) {
    for (const c of Array.isArray(h?.tools) ? h.tools : []) {
      if (c?.name === 'board_read') for (const id of c.input?.ids || []) ids.add(String(id));
    }
  }
  return ids;
}

// history: [{ role: 'student' | 'claude' | 'system', text, discarded?, kind? }]
// 返回 { turns, bytes, historyBytes, dropped }：bytes 是所有 content 的字节数，historyBytes 是其中对话部分（不含第一条说明）
// keepRecent：超长时也保留的最近几条（默认 20）；最近几条本身就太长时，页面可以调小再拼一次
export function buildTurns({ system, history = [], maxBytes = 262144, keepRecent = KEEP_RECENT, stub = false } = {}) {
  const sys = String(system ?? '').trim();
  if (!sys) throw new Error('buildTurns：缺少课堂说明（system）');
  const conv = [];
  // 最近 STUB_AFTER 轮 Claude 的输出原样，更早的长段省略（stub：能用 board_read 取回时才省）
  const said = (history || []).filter((h) => h && !h.discarded && h.role === 'claude');
  const old = new Set(stub ? said.slice(0, Math.max(0, said.length - STUB_AFTER)) : []);
  // 取回过的段只留最后写它的那一轮的原文（同一段改写过几次，旧版本照旧省略）
  const fetched = stub ? recentlyFetched(said) : null;
  const lastWrite = new Map(); // 段 id → 最后写它的那一轮
  if (fetched?.size) {
    for (const h of said) {
      for (const sg of parseOutput(String(h.text ?? ''), { final: true }).segments) {
        if (sg.type === 'board' && STUB_OPS.has(sg.op?.op) && fetched.has(String(sg.op?.id))) lastWrite.set(String(sg.op.id), h);
      }
    }
  }
  const keepIn = (h) => new Set([...lastWrite].filter(([, t]) => t === h).map(([id]) => id));
  for (const h of history || []) {
    if (!h || h.discarded) continue;
    const role = h.role === 'claude' ? 'assistant' : h.role === 'student' || h.role === 'system' ? 'user' : null;
    if (!role) continue;
    let content = String(h.text ?? '').trim();
    if (h.role === 'claude') content = stripPlan(content).trim();
    if (old.has(h)) content = stubBoardText(content, lastWrite.size ? keepIn(h) : null).trim();
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

// —— 下课小结（存进 class_notes / observations，给以后的课和学生看）——
// 学习台里（report：页面算好的课后报告，memory/report.js 的 reportText）：同一次调用里接着写整理单（memo 块），不多调用一次（docs/desk-plan.md 4.2）
// review：复现课的复现组（一个编号或编号的数组）；opening：新课开头复现了的几组（备课写的，只写做了的）
const idsOf = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x && typeof x === 'object' ? x.id : x)).filter((x) => x && x !== 'undefined');
function reviewDoc(review, opening) {
  const rv = idsOf(review);
  const op = idsOf(opening).filter((x) => !rv.includes(x));
  const out = [];
  if (rv.length) out.push(`这是复现课（复现组 ${rv.join('、')}）：整理单里${rv.length > 1 ? '每组' : ''}一定写一行 ˋreview id=${rv.length > 1 ? '…' : rv[0]} result=过ˋ 或 ˋresult=没过ˋ（依据写这节课测这一组的那几道题），档位按结果变；只测到一部分点的照最弱的那一点判，没测到的点用 ˋadd="…"ˋ 记进那一组。这节课真没测到的组不写，留着下次。`);
  if (op.length) out.push(`这节课开头安排了复现 ${op.join('、')}：做了的那几组在整理单里写 ˋreview id=… result=过 / 没过ˋ（依据写开头那几道题），没做的不写。`);
  return out.length ? `\n${out.join('\n')}\n` : '';
}

// noForm：黑板课的下课整理多一句「守则不写形式」（LESSON_NO_FORM）；舞台课、一问一答、教研室不传，提示一字不变
export function closingPrompt({ report = '', review = '', opening = null, slips = '', plan = null, tidy = null, recheck = '', noForm = false, aims = null, summary = false } = {}) {
  const base0 = doc`
下课了。请写这节课的小结，给以后的课看（下一节课的你会带着它）：学生掌握得怎么样、下一节从哪里接。

中文，分下面四点，每点几条短句，具体到题目、步骤和学生的原话：

1. 这节课讲了什么：讲到哪里，用了哪些例题和图。
2. 学生哪里卡住：卡在哪一步、怎么错的、可能是什么误解。
3. 哪里看起来懂了但证据不够：比如答对了但没说理由、跟着提示才做出来、说过「没把握」、同类题只做过一道。
4. 建议下一节怎么接：从哪里开始，先补什么，用什么样的题检验。

不写黑板指令，不对学生说话，不要说学生「已经掌握」。提到学生时写「学生」，不用「他」「她」。
`;
  // 这节课要拿下的事：对每件写一行。状态是页面算的，老师不改它，只说还差什么、下一节从哪接。
  // 下面的课后报告里已经列着每件事（reportText）时不再列一遍
  const aimList = Array.isArray(aims) && aims.length ? aims : null;
  const listed = aimList && String(report).includes(AIMS_HEAD);
  const base = !aimList ? base0 : `${base0}

小结的第 4 点之前，对这节课要拿下的每一件事各写一行：到了没有、还差什么（状态照页面按作答算的说，不改它；「带着做到」「还没证据」的写清差的是哪一步的证据），没到的写进下一节从哪接。${listed ? '每件事和页面算的状态在下面报告的「这节课要拿下的事」里。' : `\n\n${AIMS_HEAD}：\n${aimsText(aimList)}`}`;
  const pt = typeof plan === 'string' ? plan : plan?.text || '';
  const withPlan = pt.trim() ? `${base}

你最后写的教学计划（对照它写第 2、4 点：目标到了没有，猜的误解证实了没有）：

${pt.trim()}` : base;
  if (!report) return withPlan;
  // 有记忆摘要（第十三轮）：不再把失误归纳成守则、不整理规则和关于学生的条目——关于学生的事写 know，页面下课后并进摘要
  if (summary) {
    return `${withPlan}\n\n${doc`
这节课在学习台里上。下面是页面按证据算好的课后报告（每道题的对错、没做完的、没交的草稿、学生说的话）。

小结写完以后，接着写一个 ˋmemoˋ 块当**整理单**（写法和上课时一样，见「在学习台里上课」）：这节课新出现的错题（ˋerrorˋ，同一个毛病只记一道代表性的）、弱点该怎么变（ˋweaknessˋ）、复现组怎么调（ˋreviewˋ）、这节课要背的（ˋrecallˋ：上课时没记的定义、结论、默写没写出的，一条只问一件事）、下一节从哪接（ˋpositionˋ，一定写）。错题、弱点、复现组都写 ˋbasis=ˋ（下面报告里的组件 id 或证据 id）。**只写要紧的**：除了要背的那几行，整理单一般不超过 8 条；上课时已经记过的不再写。

这节课新知道的、关于这个学生和怎么教这个学生的事（上课时没记的），写几行 ˋknowˋ：照实写看到的和学生说的，带上情形。页面下课后会把它们连同整节课的记录一起并进记忆摘要。整理单只写在 memo 块里，小结正文里不用重复。
${tidy?.text ? `\n${tidyDoc(tidy, { summary: true })}\n` : ''}${recheck ? `\n${recheck}\n` : ''}${reviewDoc(review, opening)}
${report}
`}`;
  }
  return `${withPlan}\n\n${doc`
这节课在学习台里上。下面是页面按证据算好的课后报告（每道题的对错、没做完的、没交的草稿、学生说的话）。

小结写完以后，接着写一个 ˋmemoˋ 块当**整理单**（写法和上课时一样，见「在学习台里上课」）：这节课新出现的错题（ˋerrorˋ，同一个毛病只记一道代表性的）、弱点该怎么变（ˋweaknessˋ）、复现组怎么调（ˋreviewˋ）、这节课要背的（ˋrecallˋ：上课时没记的定义、结论、默写没写出的，一条只问一件事）、下一节从哪接（ˋpositionˋ，一定写）。错题、弱点、复现组都写 ˋbasis=ˋ（下面报告里的组件 id 或证据 id）。**只写要紧的**：除了归纳守则和要背的那几行，整理单一般不超过 8 条；上课时已经记过的不再写。

整理单最后**归纳教学失误**（这是你真正改掉它们的地方，不是再记一遍）：下面「还没归纳进守则的教学失误」每一条（这节课上课时记的也在里面），都要归到一条守则里${noForm ? '（只关乎形式的除外，见下）' : ''}——
- 和已有的一条是同一件事：并进去，并把那条**改写得更能照着做**（同一件事又犯，说明原来的说法不管用）：ˋlesson id=T-3 slips=S-…,S-… text="新的说法"ˋ；
- 是新的一件事：ˋlesson text="…" why="根因" slips=S-…ˋ；这节课新犯、上课时没记的，也直接写成守则，不用先写 slip；
- 守则写成下次照着就能做的动作，带上判断的时机（${noForm ? '「学生的方法和参考答案不一样时，自己把学生的方法完整走一遍再判；走得通就不算错」' : '「出一组题之前，逐题列出要用到的规则，没讲过的先讲完；讲不了的那题不出」'}），不写「注意」「小心」「要清楚」这种做不出来的话；一条只管一件事；
${noForm ? `- ${LESSON_NO_FORM}\n- 只关乎形式的失误（节奏、板面、字数、一次出几道题这类）不并进守则：写 \`slip id=S-… status=seen why="只关乎形式"\`，标成看过了，下课时页面就不再列它。\n` : ''}- 意思重复的两条合成一条：留下的那条改写，另一条 ˋlesson id=T-7 status=retired into=T-3ˋ；不再适用的 ˋlesson id=T-5 status=retired why="…"ˋ。${noForm ? '一科的守则到了 20 条先合并。' : '一科最多 20 条，到了上限页面不收新的，先合并。'}整理单直接写进记忆，学生在小结那块板上点开那行小字能撤销；上课时已经记过的不用再写。整理单只写在 memo 块里，小结正文里不用重复。
${slips ? `\n${slips}\n` : ''}${tidy?.text ? `\n${tidyDoc(tidy)}\n` : ''}${recheck ? `\n${recheck}\n` : ''}${reviewDoc(review, opening)}
${report}
`}`;
}

// 下课时顺带整理（docs/autonomy-plan.md 第 4 节）：每几节课一次、或者某一类到了上限。和小结、整理单同一次写，不多调用
function tidyDoc({ why = '', text = '' }, { summary = false } = {}) {
  const t = `【这次顺带整理记忆（${why}）】学习台的记忆由你管，不整理就会越积越乱、每一轮都多带。看下面这一科还在用的几类，整理单最后加几行：
- 说的是同一件事、同一个毛病的弱点：留一条（必要时改 title），另一条 ˋweakness id=… status=merged into=留下的ˋ，被并的那条挂的错题先写到留下的那条上（ˋweakness id=留下的 errors=…ˋ）；有依据证明修好了的 ˋweakness id=… status=closed basis=…ˋ；
- 同一个机制族的复现组：ˋreview id=… status=merged into=…ˋ；不用再复现的 ˋreview id=… status=done why="…"ˋ；
- 关于学生的记录重复、过时的：改写留下的那条（ˋpref id=… text="…"ˋ），另一条 ˋpref id=… status=merged into=…ˋ，过时的 ˋstatus=void why="…"ˋ；
- 前面「规则」里意思重复的两条：改写一条（ˋrule id=… text="…"ˋ），另一条 ˋrule id=… status=void why="…" by=留下的ˋ。
只合并真重复的，拿不准的不动；没有要整理的就不写。每一条合并都写在 memo 块里，学生在整理单上看得到、能撤销。

${text}`;
  // 有记忆摘要时关于学生的条目、规则不再整理（它们不再发给老师）
  return summary ? t.split('\n').filter((l) => !/^- (关于学生的记录|前面「规则」里)/.test(l)).join('\n') : t;
}

// —— 课堂运行时的小规则（纯函数，页面据此决定发什么、什么时候发）——

const typeOf = (a) => String(a?.type ?? a?.kind ?? '').replace(/-try$/, '');

const sureOf = (a) => (typeof a?.sure === 'boolean' ? a.sure : typeof a?.detail?.sure === 'boolean' ? a.detail.sure : null);
const okOf = (a) => (typeof a?.ok === 'boolean' ? a.ok : typeof a?.detail?.ok === 'boolean' ? a.detail.ok : null);

// 学生在黑板上的一个动作要不要告诉课堂 Claude。
// 同一道题的「最终结果」只在看了答案、放弃时说（每次尝试已经说过了）；提问、提示这类不是作答
export function reportable(a) {
  if (!a || typeof a !== 'object') return false;
  const type = typeOf(a);
  if (a.source === 'event') return type === 'reveal' || type === 'drag' || type === 'sure' || type === 'gloss';
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
  // 点开生词看意思：页面当场显示了，不单独调用，跟着下一条告诉老师（知道学生哪几个词不认识）
  if (a.source === 'event' && typeOf(a) === 'gloss') return 'later';
  // 有没有把握：答对了却说没把握，老师要马上知道（根本规则：没把握按没会处理）；别的跟着下一条一起说，不单独调用
  if (a.source === 'event' && typeOf(a) === 'sure') return sureOf(a) === false && okOf(a) === true ? 'soon' : 'later';
  // 分步的题中间一步做对了、后面还有步：学生接着做下一步，不为这一下单独叫老师（2026-11-16 真课：14 轮里 4 轮是这样叫的，
  // 老师没什么可说，白等七八秒）。做错、整道做完、学生说话时照常叫，这一步跟着一起告诉老师
  if (a.more && okOf(a) === true) return 'later';
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
// stub（能用 board_read 取回）时：整段对话不省略也放得下、一轮不丢、只比省略的多 NOSTUB_EXTRA 以内，就发原文。
// 省略是为了省额度，可它一取原文就多跑一整轮（真课一轮多等 20～60 秒）；额度够了以后速度优先（docs/smart-plan.md）
export const NOSTUB_EXTRA = 40 * 1024;
export function fitTurns({ system, history, maxBytes = 262144, stub = false } = {}) {
  if (stub) {
    const full = buildTurns({ system, history, maxBytes, keepRecent: KEEP_RECENT, stub: false });
    if (full.bytes <= maxBytes && !full.dropped) {
      const short = buildTurns({ system, history, maxBytes, keepRecent: KEEP_RECENT, stub: true });
      if (full.bytes - short.bytes <= NOSTUB_EXTRA) return { ...full, keepRecent: KEEP_RECENT, fits: true, stubbed: false };
    }
  }
  let out = null;
  for (const keepRecent of [KEEP_RECENT, 12, 8, 4, 2, 1]) {
    out = buildTurns({ system, history, maxBytes, keepRecent, stub });
    if (out.bytes <= maxBytes) return { ...out, keepRecent, fits: true };
  }
  return { ...out, keepRecent: 1, fits: false };
}

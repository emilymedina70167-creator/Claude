// 舞台上的课：发给老师（Opus 5.5）的说明和每一轮的内容（docs/stage-plan.md B 段）。纯函数，有测试（tests/stage-doc.test.js）。
// 说明分两块：怎么教（STAGE_TEACH：像一个会停下来等学生的科普视频——画面是主力，先做后说）和镜头指令（STAGE_DOC）。
// 提到学生不用「他」「她」（tests 守着）
import { TYPES } from './types/index.js';
import { MEMO_DOC, packText, PACK_BUDGET } from '../class/prompt.js';
import { memoryDigest } from '../memory/digest.js';

export const STAGE_TEACH = `你是一对一的老师，在一块「舞台」上给学生上课。舞台像一个能上手玩的科普动画：画面是活的，学生随时能直接动它，页面当场算、当场变。你决定教什么、怎么引导；画得好、动得顺、算得对是页面的事。
- 画面是讲课的主力。你对画面做事——挪、交换、插入、连线、染色、比较、分组、旋转、变换、拆开、折起来、一项一项变形（每种东西有自己的动作，见「舞台上能放的东西」）——学生看着画面变化自己想明白。话是旁白：短，指着画面说（写 {a.3}，话里会画成和那个部件一样的小块）。
- 挑最能把这个概念演出来的东西：一排格子、树、图（数据结构），矩阵、平面（线代），句子（长难句），式子（推导），题卡（把题拿上来）。一块舞台上可以同时放几样，让它们互相对照（比如 AB 和 BA 摆在一起、矩阵和它作用的平面）。
- 先做后说：先让学生看到、动手，再让学生说出发现，最后才给名字（概念、术语）。不先讲定义，不罗列性质和步骤。
- 让学生动手，别让学生光看——这是舞台和放视频的区别：摆好局面以后用 open 把东西交给学生（拨矩阵里的数、拖格子、拖向量、点乘积的一格看它怎么算），再给一个挑战 goal（比如「改 B 的一个数，让 BA 也是 O」when="D = O"）。学生每动一下页面当场算、当场判，做到的那一刻左上角打勾。新的运算先演一个（mul C.1,1），下一个让学生做；整个一下子演完只拿来对答案。
- 做到了接着做什么先写好：@g1 开头的行在学生做到 g1 的那一刻马上演，不等你——一句确认，再揭开下一小问或者下一个挑战，学生一路不停。只预写确认和下一小问；提示、讲解、纠错要等你看见学生是怎么做的再写。
- 一轮的结尾是两种之一：一个 ask（等学生点、拖、填、说），或者一个还没做到的挑战（页面替你在旁边挂「给个提示」）。学生动手的时候你看不见；等学生答了、做到了挑战又没有下一件事、点了提示、试了好几下还没做到、很久没动，页面把这一段学生是怎么试的（拨了哪一格、从几拨到几、点开看了哪几格、拖成什么样）一起告诉你。
- 看学生怎么试的再决定下一步。对了：一句确认，往前走一点。错了、卡住了：从学生试的那几下里找出卡在哪，用画面把那一步演给学生看（比如亮出学生改的那一格是怎么影响结果的），再让学生试——不要用一段文字讲道理。学生说不懂：换一个角度演，或者退到更小的一步。
- 学生能自己发现的不要说破；问题要具体到画面上的一格、一组，答案能在画面上点出来、拨出来。
- 一轮写 4～16 行指令，最多 3 句 say，每句不超过 40 个字（一轮里说过的话留在画面上）；字多了就是在念稿，改成让学生动手。
- 学生也可能直接打字（「学生说：……」）：认真回答那个问题，同样用画面演给学生看。
- 只写指令行，不写别的解释，不加代码块记号。`;

// 各种东西共用的指令（说话、点亮、染色、连线、贴字、拨数、镜头、等学生）；每种东西自己的那一节（types/xxx.js 的 doc）接在后面
export const STAGE_COMMON = `## 舞台的指令（一行一个动作，页面一行一行演；行首写 & 就和上一行一起演）
部件的写法：名字（整个）、名字.部件（每种东西自己的写法，见下面各节）
颜色：g1 蓝、g2 粉、g3 绿、g4 金、g5 紫、g6 橙

说话（旁白，在画面上方一个字一个字写出来）：
say "从 {a.1} 往后数 5 个，落在 {a.6}。"    {a.1} 画成那个部件的小块；{d} 是拨的数的值；$d$ 是字母；[不稳定] 是能飞到图上的词

对任何部件都能做：
glow a.1 a.8 / unglow a.1 a.8      点亮（提醒注意）
lift a.2 / drop a.2               抬起 / 放下（「这一个要动了」）
pulse a.3                         闪一下
paint a.1 a.6 g1 / unpaint a.1    染色
dim a.1-5 / undim a.1-5           灰掉（排除在外的部分）
cover a / uncover a.6             扣过去看不见值 / 翻开一个（查找、比较时「只能翻开看」就这样演）
link a.1 a.6 g1 / unlink a        连一道弧（写好几个就依次连）/ 收掉连线
compare a.3 a.8                   两个比大小（中间冒出「65 > 49」）
remove a                          把一样东西拿下舞台

贴在图上的字（舞台上的东西，能改、能拿掉）：
label t a#1 a#8 "一样大，先后却换了" side=below tone=note     贴在这几个旁边（side：above / below / left / right；tone：note 小字、key 重点、soft 淡）
retext t "新的字" / unlabel t / unlabel（全拿掉）
fly say.1 -> k a#8 a#1           上一句话里第 1 个 [词] 飞到这几个旁边，变成贴着的字（给概念起名字时用）

能拨的数：
dial d = 5 range=1-5 at=a         一个能拨的数（学生拨它，跟着它的东西一起变）
label n dial:d "{d} 组" side=right   字可以贴在拨数旁边
set d 5                            你来拨
unlabel dial:d                     收起拨数

镜头：camera a.1-7（凑近这几个）/ camera all（看全部）；wait 600（停一下，毫秒）

让学生自己动、给挑战（每动一下页面当场算、当场判，学生做的每一下下一次都告诉你）：
open a                              交给学生直接动（这里是拖着两格换位置；每种东西能 open 的动作见各自一节：open B edit 拨格子、open C explain 点开看怎么算、open p.u drag 拖向量）
close a                             收回来
goal g1 "把 {a} 拖成从小到大" when="a sorted"     挑战（左上角一条）；when 能写 C = O、D != O、A = B、B.1,2 > 0、a sorted，逗号连着的都要成立；写下就已经成立的不收
@g1 say "排好了！"                  g1 做到的那一刻马上演（不等你）：一句确认、下一个挑战、一个 ask 都行；写过的一直留着到做到为止，下一轮不用再写
ungoal g1                           拿掉挑战

等学生（每一轮最后一行，一轮只有一个；一轮也可以不写 ask，以一个还没做到的挑战结尾）：
ask tap a "那 {a.2} 和谁一组？"            学生点一个（写 a 是哪一个都能点；写 a#1 a#8 是只能点这几个）
ask tap a "…" expect=a.7                   你预期的那一个：页面告诉你学生点没点对
ask drag a#1 a#6 "把小的拖到前面"          学生拖（能拖的东西才行，见各节）
ask next "拨一下 $d$，看出规律点下面" button="看出来了"     学生看完 / 拨完点按钮
ask say "你觉得为什么？"                    学生写一句话
ask value "一共比较了几次？" answer=4      学生填一个答案，页面当场判对错（数按数比，3/4 = 0.75）`;

/**
 * 每门课用得上的东西（说明里只带这几种，其余的只列一个名字）：题卡、式子哪门课都带。
 * 没写科目（样子页）就全带
 */
export const SUBJECT_TYPES = {
  数据结构: ['array', 'tree', 'graph', 'card', 'tex'],
  操作系统: ['array', 'graph', 'card', 'tex', 'matrix'],
  组成原理: ['array', 'card', 'tex', 'matrix'],
  计网: ['array', 'graph', 'card', 'tex'],
  线代: ['matrix', 'plane', 'tex', 'card', 'array'],
  英语: ['sentence', 'card'],
};

/** 整份指令说明：共用的 + 舞台上能放的东西（subject：这节课是哪门课，只带用得上的那几种） */
export function stageDoc(subject = '') {
  const want = SUBJECT_TYPES[subject] || null;
  const parts = [STAGE_COMMON, '## 舞台上能放的东西'];
  const skipped = [];
  for (const t of Object.values(TYPES)) {
    if (!t.doc || !t.create.length) continue;
    if (want && !want.includes(t.type)) { skipped.push(`${t.label}（${t.create.join(' / ')}）`); continue; }
    parts.push(t.doc);
  }
  if (skipped.length) parts.push(`（这门课一般用不上、说明没带的：${skipped.join('、')}）`);
  const exType = want && !want.includes('array') ? TYPES[want.find((k) => TYPES[k]?.example)] : TYPES.array;
  parts.push(`例子（一轮）：\n${(exType || TYPES.array).example}`);
  return parts.join('\n\n');
}
export const STAGE_DOC = stageDoc();

/** 第一轮：说明 + 这节课学什么 + 资料 */
export function stageSystem({ topic = '', material = '' } = {}) {
  return [
    STAGE_TEACH,
    STAGE_DOC,
    `## 这节课\n${topic}`,
    material ? `## 资料（照这里的口径讲，例子可以自己换）\n${material}` : '',
  ].filter(Boolean).join('\n\n');
}

export function firstMessage(opts) {
  return `${stageSystem(opts)}\n\n舞台现在是空的。写第一轮：先造出要用的东西，让学生看到一个具体的例子、能自己动手试，以一个 ask 或一个挑战 goal 结尾。`;
}

/**
 * 学生动了以后跟着算的东西变了什么（scene.js 的 fx.derived，两种样子：乘积一格一条 { part, before, after, id, changed }；
 * 跟着算的一样东西一条 { id, changed: [{ ref, expr?, from, to }] }，算不出来 { id, changed: [], error }）→ 一行一行。
 * 同一格变了几次写从第一次之前变成最后的，变回原样的不写；算不出来的写最后一次的原因（后来又算出来了就不写）
 */
export function derivedLines(derived = []) {
  const cells = new Map(); // ref（带式子）→ { ref, expr, from, to }
  const errs = new Map(); // id → 原因
  for (const d of derived || []) {
    if (!d) continue;
    if (d.error) { errs.set(d.id, d.error); continue; }
    for (const x of d.changed || []) {
      const k = `${x.ref}|${x.expr ?? ''}`;
      const had = cells.get(k);
      if (had) had.to = x.to; else cells.set(k, { ref: x.ref, expr: x.expr ?? null, from: x.from, to: x.to });
      errs.delete(d.id);
    }
  }
  const shown = (v) => (v === '' || v == null ? '空' : String(v));
  const out = [...cells.values()].filter((x) => shown(x.from) !== shown(x.to)).map((x) => `${x.ref}${x.expr ? ` 里的 {${x.expr}}` : ''} 从 ${shown(x.from)} 变成 ${shown(x.to)}`);
  // 原因前面的「{式子}」和前面写的重了（scene.js 的 stateText 也这样去）
  for (const [id, e] of errs) out.push(`${id} 算不出来：${String(e).replace(/^「\{[^{}]*\}」(算不出来：|里的)?/, '')}`);
  return out;
}

/**
 * 学生做完以后发给老师的一条：学生做了什么、跟着变的（页面重算的）、页面核过老师上一轮的几步（不是正确的下一步的那几步）、
 * 上一轮哪几行没演（写错了）、舞台现在是什么样（照场景写的，和画面一样）。后加的两块只在有内容时出现
 */
export function turnMessage({ act = '', state = '', errors = [], audit = [], derived = [] } = {}) {
  const parts = [];
  parts.push(act ? `[学生]\n${act}` : '[学生] 没有动作');
  const moved = derivedLines(derived);
  if (moved.length) parts.push(`[跟着变的]（学生动了以后页面当场重算的）\n${moved.map((l) => `- ${l}`).join('\n')}`);
  if (audit.length) parts.push(`[页面核过你上一轮的几步]（这几步不是正确的下一步；页面照演了、没拦你，是故意演错的就不用管）\n${audit.map((l) => `- ${l}`).join('\n')}`);
  if (errors.length) parts.push(`[上一轮没演的行]（写错了，页面跳过了，别的行照演）\n${errors.map((e) => `- 第 ${e.line} 行「${e.src}」：${e.error}`).join('\n')}`);
  parts.push(`[舞台现在]\n${state}`);
  parts.push('写下一轮。');
  return parts.join('\n\n');
}

/** 样子页里能选的几节课（资料是照王道的口径写的提要；真上课时换成学习台的教材原文） */
export const TOPICS = {
  shell: {
    title: '希尔排序',
    topic: '数据结构 · 希尔排序（缩小增量排序）：为什么要分组、怎么分组、一趟做什么、为什么不稳定。',
    material: '希尔排序：先取一个小于 n 的增量 d，把表中相距 d 的记录分成一组（第 1、1+d、1+2d……个是一组，共 d 组），各组内做直接插入排序；然后缩小 d 重复，直到 d = 1 做最后一趟直接插入排序。王道的例子：49 38 65 97 76 13 27 49′ 55 04，增量取 5、3、1。d = 5 一趟后为 13 27 49′ 55 04 49 38 65 97 76。希尔排序不稳定：相同关键字的记录可能被分到不同组，先后次序会变（例子里 49 和 49′）。时间复杂度依赖增量序列，n 在某个范围内约 O(n^1.3)，最坏 O(n²)；空间 O(1)；只适用于顺序存储。',
  },
  bsearch: {
    title: '折半查找',
    topic: '数据结构 · 折半查找：为什么要有序、low / high / mid 怎么动、查找失败时停在哪。',
    material: '折半查找（二分查找）只适用于有序的顺序表。low = 1、high = n；mid = ⌊(low + high) / 2⌋；key 等于 mid 处的值则成功；key 小于它则 high = mid − 1，大于它则 low = mid + 1；low > high 时查找失败。王道的例子：7 10 13 16 19 29 32 33 37 41 43，查 11：mid = 6（29）→ high = 5；mid = 3（13）→ high = 2；mid = 1（7）→ low = 2；mid = 2（10）→ low = 3 > high = 2，失败。',
  },
  insert: {
    title: '直接插入排序',
    topic: '数据结构 · 直接插入排序：有序区和无序区、每次拿哪一个、怎么找位置、后面的为什么往后挪、为什么稳定。',
    material: '直接插入排序：把表分成前面的有序区和后面的无序区，初始有序区只有第 1 个元素；每次取无序区的第一个元素，在有序区里从后往前比较，比它大的依次后移一位，空出的位置放入它（相等时不越过，所以稳定）。n 个元素做 n − 1 趟。最好 O(n)（本来有序），最坏、平均 O(n²)；空间 O(1)。例子：49 38 65 97 76 13 27 49′。',
  },
};

// —— 在学习台里上的舞台课（D 段）：每一轮的整份说明 ——
const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const bytes = (t) => (enc ? enc.encode(String(t)).length : Buffer.byteLength(String(t)));
export const STAGE_SYSTEM_MAX = 150 * 1024;

// 记忆的写法：照课堂那份，依据换成舞台上那一问的编号（S5 = 第 5 轮最后那个 ask）；不收「point=」（舞台上没有段）
export const STAGE_MEMO_DOC = MEMO_DOC
  .replace(/basis=q-b5,q-b7/g, 'basis=S5,S7')
  .replace(/basis=q-b9/g, 'basis=S9')
  .replace(/basis=q-b5/g, 'basis=S5')
  .replace('黑板上的组件 id（`q-b5`，页面换成学生在那道题上的全部作答）、段 id（`b5`）', '舞台上那一问的编号（`S5` 指第 5 轮最后那个 ask，页面换成学生在那一问上的作答）')
  .replace('again="b7 没讲划块就出了标主干的题"', 'again="没让学生先在画面上找谓语就问了主干"')
  .replace('和黑板指令一样用一个', '和镜头指令写在同一轮，另起一个')
  .replace('板放不下不用记：页面量得出来（黑板现状里有），稍长学生会上下滑。', '')
  .replace(/上课时板上不显示记了什么（不打扰学生），下课小结那块板上有一行小字，学生点开能撤销。/, '上课时舞台上不显示记了什么（不打扰学生），学生事后在学习台里能看到、能撤销。');

const DESK_STAGE = `### 在学习台里上课
- 学生在舞台上的每个动作（点、拖、拨、按钮、填的答案、打的字），页面都自动记成证据，课后看证据判断。证据你不用写，也写不了。
- 要记进记忆时，在这一轮的镜头指令后面另起一个 \`\`\`\`board memo 块（块里的行不会上舞台）：
${STAGE_MEMO_DOC}
- 不要宣布学生掌握了：掌握由页面按证据算。`;

/**
 * 舞台课每一轮的整份说明（学习台里）：怎么教 → 舞台的写法 → 资料包（含教材原文）→ 你对学生的了解。
 * memory：{ mem, block, space, session }；pack：{ main, problems }（main.textbook 里可以已经放好了教材原文）
 */
export function buildStageSystem({ pack = null, memory = null, rules = '', title = '', subject = '' } = {}) {
  const parts = (packBody, mem) => {
    const custom = [rules, mem?.rules].filter((x) => String(x || '').trim()).join('\n\n');
    const sections = [
      `怎么教\n\n${STAGE_TEACH}${custom ? `\n\n学习台里的规则（学生定下的，照做；和上面冲突时以这里为准）：\n${custom}` : ''}`,
      `舞台的写法\n\n${stageDoc(subject)}`,
      `这节课${title ? `：${title}` : ''}\n\n课前备好的资料包（教材原文、推进建议、备好的题）。照这里的口径讲，例子可以自己换。\n\n${packBody}`,
      ...(memory ? [`你对学生的了解（学习台的记忆库）\n\n${mem?.text || ''}\n\n${DESK_STAGE}`] : []),
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
    mem = memoryDigest(memory.mem || {}, { block: memory.block, space: memory.space, session: memory.session, tools: false, budget: Math.max(4 * 1024, Math.min(28 * 1024, room)) });
  }
  const rest = bytes(parts('', mem));
  const { text: packBody } = packText(pack || { main: null, problems: null }, Math.max(12 * 1024, Math.min(PACK_BUDGET, STAGE_SYSTEM_MAX - rest - 2 * 1024)), { talk: true });
  return parts(packBody || '（这节课没有备好的资料包：按课程地图的这一块讲。）', mem);
}


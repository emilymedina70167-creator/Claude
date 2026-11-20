// ?dev 的检验：模拟老师的暗号「测试:检验」写这一条 board check（两块、五种题型，每道必做两道同构题）；
// 模拟的判分（devVerdict）：学生写的字里有「错」→ 第一个要点没写到，别的都对；有图时转写一行。不调用 Claude。
import { VERDICT_HEAD, FALLBACK_HEAD } from './judge.js';

const F = '```';
const fam = (id, make) => [make(id, [`${id}a`, `${id}b`]), make(`${id}a`, []), make(`${id}b`, [])].join('\n');
const retry = (r) => (r.length ? `retry: ${r.join(', ')}\n` : '');
// 同构题和本题题面不一样（题库按原文认同一道题）
const v = (id) => (/a$/.test(id) ? '（再来一道）' : /b$/.test(id) ? '（换一道）' : '');
const construct = (id, r) => `${F}construct\nid: ${id}\nq: 造两个同型但不相等的 2 阶矩阵 $A$、$B$${v(id)}\ntarget: L2-14\nlevel: 基础\nslots: A=mat(2) B=mat(2)\nif: A != B => 这两个相等了，题要的是不相等\nexample: A=[[1,0],[0,0]] B=[[0,0],[0,1]]\nteach if1: 同型只是行数、列数一样；相等还要每个元素都一样。\n${retry(r)}${F}`;
const recall = (id, r) => `${F}recall\nid: ${id}\nq: 不看板书，写出 $(A${id.length > 2 ? '-' : '+'}B)^2$ 的展开；什么时候能并成两项，为什么${v(id)}\ntarget: L2-56\nlevel: 核心\nmust m1: 四项，AB、BA 分开\nmust m2: 条件 AB = BA\nwrong w1: 对所有方阵都成立\nteach m2: 只有 AB = BA 时 AB + BA 才能并。\nteach default: 先把两个括号乘开，四项都写出来。\n${retry(r)}${F}`;
const claim = (id, r) => `${F}claim\nid: ${id}\nclaim: $A$、$B$ 都是对称矩阵，则 $(A+B)^2 = A^2+2AB+B^2$${v(id)}\ntruth: 假\ntarget: 对称不等于可交换\nlevel: 核心\nslots: A=mat(2) B=mat(2)\nif: A == A' => A 不对称\nif: B == B' => B 不对称\nif: (A+B)^2 != A^2+2*A*B+B^2 => 这一组两边相等了，不是反例\nexample: A=[[1,0],[0,0]] B=[[0,1],[1,0]]\nteach truth: 对称不等于可交换。\nteach default: 找两个对称但不可交换的。\n${retry(r)}${F}`;
const locate = (id, r) => `${F}locate\nid: ${id}\nq: 这份解答错在哪一行？${v(id)}\nline: $(A+B)^2=(A+B)(A+B)$\nline: $=A^2+2AB+B^2$\nline: 所以对任意方阵都成立\nbug: 2\ntarget: L2-56\nlevel: 方法\nmust m1: AB 和 BA 不一定相等，不能并成 2AB\nteach default: 乘开是 $A^2+AB+BA+B^2$。\n${retry(r)}${F}`;
const solve = (id, r) => `${F}solve\nid: ${id}\nq: $A$ 是 3 阶方阵，$|A|=-2$，求 $|-3A^{\\mathrm T}|$，每一步写依据${v(id)}\ntarget: L2-50\nlevel: 基础\nsteps:\ns1 rule: |kA| = k^n |A|，n = 3\ns2 rule: |A^T| = |A|\ns3 calc: (-3)^3 · (-2) = 54\nteach s1: 数乘要乘到每一行上，提出来是 k 的 n 次方。\nteach tag=记号: |2B| 不是 2³B：行列式是一个数。\n${retry(r)}${F}`;
const disc = (id, r) => `${F}discriminate\nid: ${id}\nq: $A=\\begin{bmatrix}0&1\\\\0&0\\end{bmatrix}$，$(E+A)^5$ 能不能直接用二项式展开？${v(id)}\ncan: 能\ntarget: 看着可疑其实能用\nlevel: 核心\nlet A = [[0,1],[0,0]]\nmust m1: E 和任何方阵可交换\nresult: E+5*A\nteach can: E 和谁都可交换，二项式定理能用。\nteach default: 先看 E 和 A 交不交换。\n${retry(r)}${F}`;

export const DEV_CHECK_HEAD = 'check id=k1 title="第二讲第一节" limit=15m';
export const DEV_CHECK_BODY = [
  'block L2.1.1 must=p1,p2',
  'block L2.1.4 must=p3,p5,p6 optional=p7',
  fam('p1', construct), fam('p2', solve), fam('p3', recall), fam('p5', claim), fam('p6', locate), fam('p7', disc),
].join('\n');
export const DEV_CHECK = [`\`\`\`\`board ${DEV_CHECK_HEAD}`, DEV_CHECK_BODY, '````'].join('\n');

/** 模拟判分：照提示词里的编号回 [判] 行 */
export function devVerdict(prompt) {
  const ids = (String(prompt).match(/每个编号一行（([^）]*)）/)?.[1] || '').split('、').filter(Boolean);
  const said = String(prompt).match(/<<<\n([\s\S]*?)\n>>>/)?.[1] || '';
  const wrong = /错/.test(said);
  const img = /附图 \d+ 张/.test(prompt);
  return [...(img ? ['[转写]', 'L1: （模拟转写）'] : []), '[判]', ...ids.map((id, i) => (wrong && i === 0 && !id.startsWith('w') ? `${id} missing` : `${id} ok`))].join('\n');
}

export const isVerdict = (t) => String(t).startsWith(VERDICT_HEAD);
export const isFallback = (t) => String(t).startsWith(FALLBACK_HEAD);

// —— 计划 4 的两份样板（任务书第四节：408 希尔排序、英语语态）：?dev 的暗号、示例页 ?sample=408 | en、测试都用这两份 ——

// 408 · 希尔排序：trace 是模板（每次另取 8 个数、分得开「相邻的分成一组」），construct 两道固定的同类题，predict 带一条错答案和 against，tradeoff 照要点判
const shellTrace = `${F}trace
id: p1
pick v = seq(8, 10, 99) distinct
q: 对 \\calc{list(v)} 做希尔排序（增量 4、2、1），写出每一趟以后的序列
target: 希尔排序分组
level: 方法
use: sort
algo: shell
array: \\calc{list(v)}
gaps: 4 2 1
against: shellBlock
teach tag=shellBlock: 相隔 d 的元素才是一组：第 1、1+d、1+2d……个，不是连着的一段。
teach slip: 后面几趟照你写的上一行推都对，是这一处写错了：再对一遍这一趟。
teach default: 一组一组地做直接插入：d = 4 时第 1、5 个一组，第 2、6 个一组……
retry: self × 2
${F}`;
const shellConstruct = (id, { q, n, gaps, example, retry: r = [] }) => `${F}construct
id: ${id}
q: ${q}
target: 希尔排序不稳定
level: 核心
slots: A=seq(${n}) P=seq(2)
run r: sort algo=shell gaps="${gaps}" array=A
if: r.unstable >= 1 => 这一组排完，相同的数先后没变（还是稳定的）
if: P in r.flipped => 写的这一对没有换先后
example: ${example}
teach if1: 让两个相同的数分在不同的组里（相隔不是 d 的倍数），后面那个所在的组把它往前挪过前面那个。
teach if2: 排完看相同的两个数谁在前：先后反过来的那一对才是。
teach default: 先让两个相同的数分在不同的组，再让后一个的组里有更大的数排在它前面。
${retry(r)}${F}`;
const shellPredict = `${F}predict
id: p3
pick v = seq(8, 10, 99) distinct
q: 数组 \\calc{list(v)} 做希尔排序的一趟，d = 3。不推每一步，直接写：这一趟里第 2 组是哪几个位置（从 1 数）、这一趟以后整个数组是什么，再写一句理由
target: 希尔排序分组
level: 方法
run r: sort algo=shell gaps="3" array="\\calc{list(v)}"
expect x1 第 2 组的位置: "2 5 8"
wrong w1: "4 5 6" => 把连着的几个当成了一组
expect x2 这一趟以后的数组: r.pass1
against: shellBlock
must m1: 相隔 d 的元素是一组：第 2、5、8 个
teach w1: 相隔 d = 3 的才是一组：第 2、2+3、2+6 个，不是连着的三个。
teach tag=shellBlock: 一组是相隔 d 的元素，不是连着的一段。
teach default: 先把三组写出来（第 1、4、7 个，第 2、5、8 个，第 3、6 个），每组各做直接插入。
retry: self × 2
${F}`;
const shellTradeoff = (id, { q, retry: r = [] }) => `${F}tradeoff
id: ${id}
q: ${q}
target: 希尔排序的取舍
level: 核心
must m1: 大间隔的几趟让元素一次跨好几位，序列先变得基本有序；最后 d = 1 的直接插入每个元素只挪很少几步
must m2: 要按下标隔 d 取元素（随机访问），链表只能从头顺着走
wrong w1: 希尔排序是稳定的
teach m1: 直接插入一次只挪一位，逆序多就慢；大间隔先把离得远的逆序一下子消掉，最后一趟几乎不用挪。
teach m2: 隔 d 取第 i + d 个，顺序表一步到，链表要从头走。
teach default: 分两半想：前面几趟省了什么；隔 d 取元素在链表上要多少步。
${retry(r)}${F}`;

export const DEV_CHECK_408_HEAD = 'check id=k408 title="希尔排序" limit=20m';
export const DEV_CHECK_408_BODY = [
  'block DS-L8.2.3 must=p1,p2,p3,p4',
  shellTrace,
  shellConstruct('p2', { q: '造一个 8 个数的序列，使希尔排序（增量 4、2、1）不稳定；再写出哪两个相同的数换了先后（写两个一样的数就行，比如 49 49）', n: 8, gaps: '4 2 1', example: "A=4 7 4 1 2 5 7 8 P=4 4'", retry: ['p2a', 'p2b'] }),
  shellConstruct('p2a', { q: '造一个 6 个数的序列，使希尔排序（增量 3、1）不稳定；再写出换了先后的那两个相同的数', n: 6, gaps: '3 1', example: 'A=13 97 49 49 27 38 P=49 49', retry: [] }),
  shellConstruct('p2b', { q: '造一个 5 个数的序列，使希尔排序（增量 2、1）不稳定；再写出换了先后的那两个相同的数', n: 5, gaps: '2 1', example: 'A=49 38 38 27 13 P=38 38', retry: [] }),
  shellPredict,
  shellTradeoff('p4', { q: '为什么希尔排序在 d = 1 那一趟之前先做几趟大间隔的，会比直接插入快？为什么链表上不适合做希尔排序？', retry: ['p4a', 'p4b'] }),
  shellTradeoff('p4a', { q: '希尔排序最后一趟 d = 1 就是直接插入，前面几趟为什么不白做？换成链表还能这样做吗？' }),
  shellTradeoff('p4b', { q: '同样是插入，希尔排序比直接插入多做了几趟，为什么反而快？它对存储结构有什么要求？' }),
].join('\n');
export const DEV_CHECK_408 = [`\`\`\`\`board ${DEV_CHECK_408_HEAD}`, DEV_CHECK_408_BODY, '````'].join('\n');

// 英语 · 语态：parse 标被动的谓语、rewrite 主动改被动（页面核 be 的时态 + 过去分词）、discriminate 谓语还是非谓语、errfind 过去分词写错
const voiceParse = (id, { q = '标出这句的主语和谓语（谓语连着助动词一起标）', key, retry: r = [] }) => `${F}parse
id: ${id}
q: ${q}
target: 被动语态的谓语
level: 方法
key: ${key}
roles: S V O
teach V: 被动的谓语是 be + 过去分词，几个词一起标成谓语。
teach S: 主语是被……的那个东西，整个名词短语一起标。
teach default: 先找谓语动词（带上前面的 be），再往前找主语。
${retry(r)}${F}`;
const voiceRewrite = (id, { text, has, not, example, retry: r = [] }) => `${F}rewrite
id: ${id}
q: 把这句改成被动语态，时态不变
text: ${text}
target: 主动改被动
level: 方法
has: ${has} => 时态要和原句一样：be 的过去式 + 过去分词
not: ${not} => 还留着主动的谓语
example: ${example}
must m1: be 的时态跟原句（一般过去时用 was / were）+ 过去分词
teach h1: 原句是一般过去时，被动写成 was / were + 过去分词。
teach default: 宾语提到前面当主语，谓语换成 be + 过去分词，原来的主语放到 by 后面。
${retry(r)}${F}`;
// must、teach pick 照这一句自己写（dr-plan4-fix 6：以前三道共用 p3 的「谓语是另一个动词」，p3b 答案是谓语，选对、理由写对会被判没过）
const voiceDisc = (id, { q, answer, must, pick, retry: r = [] }) => `${F}discriminate
id: ${id}
q: ${q}
options: 谓语 | 非谓语
answer: ${answer}
target: 过去分词作定语
level: 核心
must m1: ${must}
teach pick: ${pick}
teach default: 先找句子里有没有别的谓语动词：有的话这个 -ed 才可能是定语，再看它修饰谁。
${retry(r)}${F}`;
// teach fix 照这一句的动词写（以前三道都是「know 的过去分词是 known」）
const voiceErr = (id, { text, word, fix, teach, retry: r = [] }) => `${F}errfind
id: ${id}
q: 点出用错的那个词，再写改成什么
text: ${text}
word: ${word}
fix: ${fix}
target: 被动的过去分词
level: 基础
teach word: 被动是 be + 过去分词：be 后面的动词原形是错的。
teach fix: ${teach}
teach default: 被动语态里 be 后面跟过去分词。
${retry(r)}${F}`;

export const DEV_CHECK_EN_HEAD = 'check id=ken title="语态" limit=15m';
export const DEV_CHECK_EN_BODY = [
  'block EN-L1.2.3 must=p1,p2,p3,p4',
  voiceParse('p1', { key: '[S Most of the houses in the old town] [V were surrounded] by high walls during the war.', retry: ['p1a', 'p1b'] }),
  voiceParse('p1a', { key: '[S The new bridge] [V will be opened] to traffic next month.' }),
  voiceParse('p1b', { key: '[S Several reports on the accident] [V have been published] since last week.' }),
  voiceRewrite('p2', { text: 'The villagers built the bridge in 1990.', has: 'was …ed | was built', not: 'built the bridge', example: 'The bridge was built by the villagers in 1990.', retry: ['p2a', 'p2b'] }),
  voiceRewrite('p2a', { text: 'The teacher praised the students yesterday.', has: 'were …ed | were praised', not: 'praised the students', example: 'The students were praised by the teacher yesterday.' }),
  voiceRewrite('p2b', { text: 'Tom cleaned the room last night.', has: 'was …ed | was cleaned', not: 'cleaned the room', example: 'The room was cleaned by Tom last night.' }),
  voiceDisc('p3', { q: '“The data collected last year show a clear trend.” 里 collected 是谓语还是非谓语？为什么？', answer: '非谓语', must: '句子的谓语是 show；collected 是过去分词作后置定语，修饰 data（= which were collected last year）', pick: '一句话一个谓语：show 才是谓语，collected last year 修饰 data。', retry: ['p3a', 'p3b'] }),
  voiceDisc('p3a', { q: '“The man injured in the accident was taken to hospital.” 里 injured 是谓语还是非谓语？为什么？', answer: '非谓语', must: '句子的谓语是 was taken；injured 是过去分词作后置定语，修饰 man（= who was injured in the accident）', pick: '一句话一个谓语：was taken 才是谓语，injured in the accident 修饰 man。' }),
  voiceDisc('p3b', { q: '“The students collected the data last year.” 里 collected 是谓语还是非谓语？为什么？', answer: '谓语', must: '句中没有别的谓语，collected 是主语 students 的谓语（一般过去时）', pick: '句中没有别的谓语动词：collected 前面是主语 students、后面是宾语 the data，它就是谓语（一般过去时）。' }),
  voiceErr('p4', { text: 'He was know as the best teacher in the town.', word: 'know', fix: 'known | !knew=knew 是过去式，被动要过去分词', teach: 'know 的过去分词是 known，不是 knew。', retry: ['p4a', 'p4b'] }),
  voiceErr('p4a', { text: 'The letter was write in English.', word: 'write', fix: 'written | !wrote=wrote 是过去式，被动要过去分词', teach: 'write 的过去分词是 written，不是 wrote。' }),
  voiceErr('p4b', { text: 'The windows were break by the storm.', word: 'break', fix: 'broken | !broke=broke 是过去式，被动要过去分词', teach: 'break 的过去分词是 broken，不是 broke。' }),
].join('\n');
export const DEV_CHECK_EN = [`\`\`\`\`board ${DEV_CHECK_EN_HEAD}`, DEV_CHECK_EN_BODY, '````'].join('\n');

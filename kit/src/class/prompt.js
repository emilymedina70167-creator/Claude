// 课堂模式：每一轮发给课堂里的 Claude 的内容（纯函数，不碰 DOM）。
// sample 是无记忆的：每一轮都把完整的课堂说明放在第一条 user 消息里重新发一遍——
// 角色与红线 → 组件写法 + 黑板指令 → 资料包 → 黑板现状，后面才是这节课的对话。

// 文档里有大量反引号和 TeX 反斜杠：先用「ˋ」代替反引号，String.raw 保留反斜杠，最后换回来
const doc = (s, ...v) => String.raw(s, ...v).replace(/ˋ/g, '`').trim();

// —— 1. 角色与红线（需求 2.3 第 1 条；资料包的 rules 可以整段覆盖）——
export const DEFAULT_RULES = doc`
你是这节课的老师，在给一位学生上一对一的课。学生用 iPad（常配 Apple Pencil）看黑板、在黑板上作答；你一边在底部对话框里和学生说话，一边在黑板上写公式、出题、画能拖的图。你看不到学生本人，只看得到学生说的话和在黑板上的作答记录。对学生说话用「你」；提到学生时说「学生」，不用「他」「她」。

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
8. 话要短。对话框里一次一两句，主要内容写在黑板上；不在对话框里写长推导，也不把黑板上的内容再念一遍。
9. 能让学生拖、点、选、预测的，就不要让学生写长段文字。要学生说想法时，问得具体，一句话能答。

教法：

- 先让学生动手、猜，结论放在学生猜过、试过之后。
- 例子要挑：数字简单但不特殊（不要对称矩阵，不要全是 0 和 1），结果尽量是整数。
- 学生答错时，先弄清学生是怎么想的（看作答记录和手写转写），针对错的那一步说，不整题重讲。
- 术语第一次出现时附英文（学生的考试是英文的），比如「秩 rank」。
- 语气平实，像坐在旁边的家教；不用夸张的表扬。
`;

// —— 2. 黑板指令协议（需求 2.1 / 2.2）。写法要和 protocol.js 的解析一致 ——
export const PROTOCOL_DOC = doc`
你的每一轮输出是一段文本，页面一边收一边处理：

- **黑板指令以外的文字，都是对学生说的话**，显示在底部对话框里（支持 Markdown 和 $公式$）。
- **要写上黑板的内容，放在语言名为 ˋboardˋ 的围栏代码块里**。块的第一行是指令；块一结束（收到闭合围栏），页面马上执行。
- 一轮里可以有好几个指令，按出现的顺序执行。

**外层一律用 4 个反引号**：开头一行是 4 个反引号紧跟 board 和指令，结尾单独一行 4 个反引号（见下面的例子）。块里的组件照常用 3 个反引号，这样组件的结尾不会把外层提前关掉。

下面例子里的 id（b3、b4、fig-b3……）只是示范，不在黑板上；黑板上实际有什么，看「黑板现状」。

### add：在黑板末尾加一段

ˋˋˋˋboard add id=b3 title="Ax 落在哪"
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

- ˋid=ˋ 是这一段的编号，由你来起：b1、b2、b3……按顺序往下编，同一节课里不能重复，撤回过的也不再用。「黑板现状」里会写下一个可用的编号。
- ˋtitle="…"ˋ 可选，是这一段的小标题（12 个字以内）。标题写在这里，内容里不用再写 ˋ##ˋ 标题。引号用 "…" 或 “…” 都行。
- 块里的内容和课件里一节的写法完全一样：普通 Markdown、公式，加上前面组件说明里的任何组件。
- **课堂里每个组件都要写 ˋid:ˋ**，整节课不重复，只用英文字母、数字和 ˋ-ˋ，比如 ˋfig-b3ˋ、ˋq-b3ˋ、ˋex-2ˋ。作答记录、ˋlink:ˋ 和下面的 ˋfigureˋ 指令都靠这个 id 找到组件。
- 一段只放一件要学生动脑的事（一道 ˋstepsˋ、一个 ˋanswerˋ、一个 ˋpredictˋ……），可以配一张图。

### replace：改写一段

ˋˋˋˋboard replace id=b3 title="Ax 还在这条线上"
（b3 的完整新内容，写法同 add）
ˋˋˋˋ

整段换成新内容，ˋtitle=ˋ 不写就沿用原来的标题。学生在旧内容里的作答会被清掉，所以只用来修正写错的段，或者确实需要重画的段。

### hide：撤回一段

ˋˋˋˋboard hide id=b3
ˋˋˋˋ

### figure：让黑板上已有的图动起来

ˋtarget=ˋ 是图的 ˋid:ˋ（ˋsceneˋ、ˋgraphˋ、ˋspaceˋ、ˋpredictˋ 都行）。块里不写内容，下一行直接闭合。ˋpredictˋ 里学生拖的猜测点（ˋguessˋ）不能改；标了 ˋafterˋ 的东西要等学生点「确定」之后才出现，在那之前 highlight 不到。

ˋˋˋˋboard figure target=fig-b3 set x=[1, 1]
ˋˋˋˋ

- ˋset 名字=值ˋ：改变量的值，一次可以改好几个，用空格隔开，比如 ˋset x=[1, 1] k=2ˋ。等号两边不留空格。值是表达式（写法和组件里的表达式一样），可以用这张图里已有的变量，比如 ˋx=A*xˋ。能改的是 ˋletˋ 定义的变量、ˋsliderˋ 滑块和可以拖的点。

ˋˋˋˋboard figure target=fig-b3 play t
ˋˋˋˋ

- ˋplay 名字ˋ：让这个变量从 0 动到 1（约 1.2 秒）。也可以写起点、终点和时长：ˋplay t 0 1 2sˋ（时长写 ˋ2sˋ 或 ˋ1500msˋ，只写数字按秒算）。要播放的图里先准备好这个变量，比如上面 fig-b3 的 ˋslider t 0 1 = 1ˋ，再用它写过渡：ˋvector lerp(x, A*x, t)ˋ、ˋgrid lerp(I, A, t)ˋ。图里没有这个变量，指令就不会执行。写了 ˋlink:ˋ 绑定 ˋstepsˋ 的图自带 ˋtˋ。「黑板现状」里列出了每张图能改的变量。

ˋˋˋˋboard figure target=fig-b3 highlight 4
ˋˋˋˋ

- ˋhighlight 序号ˋ：让图里第几条命令画出来的东西闪一下，指给学生看。只数命令行（ˋletˋ、ˋsliderˋ、ˋvectorˋ、ˋpointˋ、ˋlineˋ、ˋgridˋ、ˋshowˋ……），不数 ˋid:ˋ、ˋtitle:ˋ、ˋq:ˋ 这类字段行，从 1 开始数。上面 fig-b3 里，第 4 条是 ˋline [0, 0] dir [1, 2]ˋ（那条黄色虚线）。ˋletˋ 这类不画东西的命令闪不了。

### 一轮输出的样子

先别算，猜一猜：$A$ 会把 $(1, 1)$ 送到哪里？

ˋˋˋˋboard add id=b4 title="先猜一猜"
ˋˋˋpredict
id: pred-b4
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

### 写的时候注意

- 先说一两句，再写黑板；写完黑板可以再补一句告诉学生做什么。然后就停下，等学生作答。
- 组件只能写在 ˋboard addˋ / ˋboard replaceˋ 里面，写在外面只会显示成一段代码。不要把 board 块套在别的代码块里，也不要在 board 块里再写 board 块。
- 围栏没闭合、指令看不懂的块，会原样当成普通文字显示给学生，黑板上什么也不会发生。
- 已经在黑板上的图，能用 ˋfigureˋ 改就不要整段重画。
- 学生在黑板上的作答，页面会自动发给你，不用让学生「做完告诉我」。

### 你会收到的消息

- 学生打的字，原样给你。四个快捷按钮会发：「没懂。」（退一步，换个更小的台阶重讲）、「想不出来。」（缺思路：给提示，不给答案）、「换个说法讲讲？」（换个角度：图、具体的数、另一种说法）、「继续。」（往下走；上一题还没作答就先请学生试试）。
- 以「[作答]」「[动作]」开头的行，是学生在黑板上的操作记录，页面自动生成，一行一条，比如：
  - [作答] b3 里的 answer q-b3「算一个」：填了 (4, 2)（错，第 1 次），用时 31 秒
  - [动作] b2 里的 steps ex-1 第 2 步：想不出来，直接揭开了
  - 「（对）」「（错）」是程序判的；没写对错的是自由作答，要你来看。注明「手写转写」「截图转写」的文字是从手写认出来的，可能有认错的字。
- 附了图片时，是学生的手写或截图（白底黑字），就在这一轮里。
- 以「[系统]」开头的是页面发的消息。收到「[系统] … 写法错误」，说明那一段的组件写错了，没有显示出来：只用 ˋboard replaceˋ（id 不变；或者 ˋboard addˋ 同一个 id）把那一段重新写对，不用再对学生说别的。同一段最多重写 2 次，还不对，页面就显示「这段没画出来」，课堂继续（已经在黑板上的旧内容不受影响）。ˋaddˋ 用了黑板上已经有的 id，那一段不会被覆盖，页面会请你换一个新 id 再 add。「[系统] 指令 … 没执行」多半是 ˋtarget=ˋ 或变量名写错了，对照「黑板现状」里的组件 id 和图的变量；「看不懂」「没闭合」的块已经原样当文字给学生看了，下一轮注意写法就行。
- 「【到目前为止的课堂摘要】」是更早的对话压缩成的摘要，摘要之前的原文已经不在了。
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

export const PACK_BUDGET = 120 * 1024;
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
const PACK_SKIP = /^(rules|updatedAt|createdAt|id|model|modelTier|effort)$/i;

export function packText(pack, budget = PACK_BUDGET) {
  const main = pack?.main && typeof pack.main === 'object' ? pack.main : {};
  const parts = [];
  const known = new Set(PACK_FIELDS.map(([k]) => k));
  for (const [k, label] of PACK_FIELDS) {
    const t = asText(main[k]);
    if (t) parts.push({ label, body: t });
  }
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
const ANSWERING = new Set(['answer', 'conjecture', 'quiz', 'predict', 'practice', 'steps', 'recognize', 'findbug', 'sortpass']);
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oneLine = (s, n = 200) => clip(String(s ?? '').replace(/\s*\n\s*/g, ' / ').replace(/\s+/g, ' ').trim(), n);
const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

// 下一个可用的段 id：b 后面的最大编号 + 1（撤回的也算，免得重复）
export function nextSegmentId(board) {
  let max = 0;
  for (const seg of board || []) {
    const m = /^b(\d+)$/i.exec(String(seg?.id ?? ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `b${max + 1}`;
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

export function boardStateText(board) {
  if (typeof board === 'string') return board.trim() || '黑板是空的。新的一段用 id b1。';
  const list = (Array.isArray(board) ? board : []).filter((s) => s && s.id !== undefined && s.id !== null);
  if (!list.length) return '黑板是空的。新的一段用 id b1。';
  const shown = list.filter((s) => !s.hidden).length;
  const hidden = list.length - shown;
  const lines = [shown
    ? `黑板上现在有 ${shown} 段（从上到下）${hidden ? `，另有 ${hidden} 段已撤回` : ''}：`
    : `黑板上现在没有显示的段（${hidden} 段都已撤回）：`];
  for (const seg of list) {
    const head = `- ${seg.id}${seg.title ? `「${oneLine(seg.title, 40)}」` : ''}`;
    if (seg.hidden) { lines.push(`${head}（已撤回，学生看不到）`); continue; }
    // 写错了还没显示的段（等重写）、重写也没成的段（学生看到「这段没画出来」）：学生都看不到内容
    if (seg.pending) { lines.push(`${head}（写法错误，还没显示，学生看不到；用 board replace id=${seg.id} 重写）`); continue; }
    if (seg.failed) { lines.push(`${head}（没画出来，学生只看到「这段没画出来」；可以用 board replace id=${seg.id} 重写）`); continue; }
    lines.push(seg.summary ? `${head}：${oneLine(seg.summary, 160)}` : head);
    for (const b of seg.blocks || []) {
      if (!b?.id) continue;
      // 图能用 figure set / play 改的变量（课堂说明被压缩成摘要后，Claude 看不到当初写的命令，靠这里知道）
      const vars = Array.isArray(b.vars) ? b.vars.filter(Boolean).join('、') : String(b.vars ?? '').trim();
      const name = `${b.kind || '组件'} ${b.id}${vars ? `（变量：${oneLine(vars, 160)}）` : ''}`;
      const res = (b.results || []).map((r) => resultLine(r, b.id)).filter(Boolean);
      if (res.length) {
        lines.push(`  - ${name} 的作答：`);
        res.forEach((r) => lines.push(`    - ${r}`));
      } else {
        lines.push(`  - ${name}${ANSWERING.has(b.kind) ? '：还没有作答' : ''}`);
      }
    }
  }
  lines.push(`新的一段用 id ${nextSegmentId(list)}（用过的 id，包括撤回的，都不要再用）。`);
  return lines.join('\n');
}

// —— 拼第一条 user 消息 ——

// packBudget：资料包的字节预算（默认 ≈120 KiB）；整轮超长（prompt_too_large）时页面会调小再试
export function buildSystem({ rules, componentDocs, pack, board, packBudget = PACK_BUDGET } = {}) {
  const custom = asText(rules) || asText(pack?.main?.rules);
  const docs = asText(componentDocs);
  const { text: packBody } = packText(pack, packBudget);
  return [
    '这是课堂模式的完整说明，每一轮都会重新发给你（资料包和黑板现状都是最新的）。说明后面是这节课的对话：学生说的话、学生在黑板上的作答记录（[作答] / [动作]）、页面的系统消息（[系统]），以及你之前的输出。',
    `# 一、你的角色和红线\n\n${custom || DEFAULT_RULES}`,
    `# 二、组件写法和黑板指令\n\n## 组件说明\n\n下面的组件说明原本是学生写给项目对话里的 Claude 的，文中的「我」指学生。说到 guided 课件的关卡、小节结构的地方，课堂里不适用；课堂里的段落由你用黑板指令一段一段写。\n\n${docs || '（组件说明没有打包进来。只用最常见的组件：answer、steps、scene、predict，写法要保守。）'}\n\n## 黑板指令\n\n${PROTOCOL_DOC}`,
    `# 三、这节课的资料包\n\n课前由项目对话里的 Claude 准备，课中也可能更新。\n\n${packBody}`,
    `# 四、黑板现状\n\n${boardStateText(board)}`,
    '（课堂说明到这里结束。下面是这节课的对话，回应最后一条消息。）',
  ].join('\n\n');
}

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
  else if (a.attempts !== undefined && a.attempts !== null) what = `填了 ${val(a.value)}${mark(a.ok, a.attempts)}${a.transcript ? `；手写过程（转写）：「${short(a.transcript)}」` : ''}`;
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
    what = `填了 ${val(shown) || '（空）'}${mark(a.ok, a.attempts)}`;
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
    case 'drag': return `[动作] ${where(a, '图', { title: false })}：把 ${get('name') ?? '点'} 拖到 ${val(get('value'))}`;
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
  const type = String(a.type ?? a.kind ?? '').replace(/-try$/, '');
  const isEvent = a.source === 'event';
  const out = isEvent ? eventText(a, type) : recordText(a, type) ?? eventText(a, type);
  return out ?? unknownText(a, type);
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
export function closingPrompt() {
  return doc`
下课了。请写这节课的小结，给项目对话里的 Claude 课后看：它会据此判断学生掌握得怎么样、下一节从哪里接。

中文，分下面四点，每点几条短句，具体到题目、步骤和学生的原话：

1. 这节课讲了什么：讲到哪里，用了哪些例题和图。
2. 学生哪里卡住：卡在哪一步、怎么错的、可能是什么误解。
3. 哪里看起来懂了但证据不够：比如答对了但没说理由、跟着提示才做出来、说过「没把握」、同类题只做过一道。
4. 建议下一节怎么接：从哪里开始，先补什么，用什么样的题检验。

不写黑板指令，不对学生说话，不要说学生「已经掌握」。提到学生时写「学生」，不用「他」「她」。
`;
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
//   'soon'  作答、拖动：等 1.5 秒，把这期间的动作合成一条
//   'later' 揭开下一步：只是往下翻，不单独打扰 Claude，跟着下一条一起说（揭开的是最后一步时按 'soon'，学生在等）
//   null    不告诉 Claude
export function actionTrigger(a, { lastStep = false } = {}) {
  const urgent = !!a?.giveup || (a?.source === 'event' && typeOf(a) === 'giveup');
  if (!reportable(a)) return urgent ? 'now' : null;
  if (urgent) return 'now';
  if (a.source === 'event' && typeOf(a) === 'reveal' && !lastStep) return 'later';
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

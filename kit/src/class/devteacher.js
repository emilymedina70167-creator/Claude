// ?dev 下的「模拟老师」：不调用 Claude，按写死的剧本回放课堂输出（说话 + board 指令），
// 用来测流式解析、草稿显示、写法自检和重写、figure 指令、Opus 5.5 退路作废、出错提示。
// 和 claude.use('sample') 返回的函数同形：teacher(input, opts) / teacher.json / teacher.limits。
//
// 剧本按最后一条 user 消息挑（输入里能看出的都从输入推，换一个 teacher 实例也接得上）。一屏一块板：
//   第一轮 → 打招呼 + new b1（steps ex-1 + 绑定它的 scene fig-1）+ pin k1（这节课的记号）
//   [作答] / [动作] 做对了 → new 一块新板（一个 answer）；第一次做对时 pin k2（刚得出的结论）
//   [作答] / [动作] 错了、想不出来 → 在当前板上改：当前板有图就 figure set / play / highlight，没图就 add 一段提示
//   只有 [动作]（拖了拖图、揭开一步）→ 说一句，不动黑板（测只换板顶那句话）
//   继续 / 普通文字（第一次）→ new 一块故意写错的板（自检应该拦下来）
//   [系统] … 写法错误 → 「我改一下」+ board replace 写对的版本
//   没懂 / 换个说法 → new 一块 key 提示框；想不出来 → 在当前板上 add 一段提示
//   下课 / 小结 → 四点小结（不写黑板）
//   其他 → new 一块 recognize 认方法小练
// 开发用的暗号（在对话框里打）：「测试:写错」再来一段写错的；「一直写错」连重写也错（测「这段没画出来」）；
// 「测试:rate_limited」这类让这一轮按那个错误码失败；
// 「测试:教具」秩一方阵：let 块 + matrix 的 product + board mark 逐行标倍数 + \calc 写出 A²；
// 「测试:幂」B 的幂：matrix 配滑块，figure play 让 1 往右上角退，mark 一个箭头；
// 「测试:指图」在图上标注：label= 圈住 Ax（拖动 x 时跟着走），at= 用箭头指一个点。

export const DEV_LIMITS = Object.freeze({ maxPromptBytes: 262144, images: Object.freeze({ maxCount: 4, maxInputBytes: 20000000, mediaTypes: Object.freeze(['image/png', 'image/jpeg']) }) });
const THINK_MS = 600; // 第一个字出来前的停顿（模拟思考）
const JSON_MS = 300;
const ERROR_CODES = ['rate_limited', 'refused', 'not_granted', 'sampling_disabled', 'session_expired', 'prompt_too_large', 'image_rejected'];

export function createDevTeacher({ fallback = false, pace = 1 } = {}) {
  // pace：所有停顿乘这个系数（测试用 0；页面用默认 1）
  const k = Number.isFinite(pace) && pace >= 0 ? pace : 1;
  const memo = { seq: 0, broken: 0 };

  async function teacher(input, opts = {}) {
    opts = opts || {};
    const reply = devReply(input, memo, { images: countImages(opts.images) });
    teacher.calls.push({ method: 'call', kind: reply.kind, input: copyInput(input), opts: cleanOpts(opts) });
    const signal = opts.signal;
    if (signal?.aborted) throw cancelled('');
    const tooBig = promptBytes(input) > DEV_LIMITS.maxPromptBytes;
    if (tooBig) throw fail('prompt_too_large', '这一轮的内容超过了 256 KiB');
    const bad = imageProblem(opts.images);
    if (bad) throw fail('image_rejected', bad);
    if (reply.kind === 'error') {
      await wait(THINK_MS * k / 2, signal);
      throw fail(reply.code, `模拟错误：${reply.code}`);
    }
    const text = await stream(reply.text, { onText: opts.onText, signal, pace: k });
    return {
      text,
      truncated: false,
      modelTierApplied: opts.modelTier || 'complex',
      // 模拟平台的退路：Opus 5.5 用不了时不报错，只是 modelApplied 不是指定的模型
      modelApplied: fallback ? undefined : opts.model,
    };
  }

  // 摘要、转写、批改这类要 JSON 的小活：按提示词里要的字段给一个看得出是模拟的结果
  teacher.json = async (input, opts = {}) => {
    opts = opts || {};
    teacher.calls.push({ method: 'json', kind: 'json', input: copyInput(input), opts: cleanOpts(opts) });
    const bad = imageProblem(opts.images);
    if (bad) throw fail('image_rejected', bad);
    await wait(JSON_MS * k, opts.signal);
    return jsonReply(lastUserText(input), countImages(opts.images));
  };

  teacher.limits = () => ({ maxPromptBytes: DEV_LIMITS.maxPromptBytes, images: { ...DEV_LIMITS.images, mediaTypes: [...DEV_LIMITS.images.mediaTypes] } });
  teacher.calls = [];
  teacher.reset = () => {
    teacher.calls.length = 0;
    memo.seq = 0;
    memo.broken = 0;
    memo.lastBroken = undefined;
  };
  Object.defineProperty(teacher, 'fallback', { get: () => !!fallback, enumerable: true });
  return teacher;
}

// —— 剧本 ——

/**
 * 按输入挑这一轮的回复。memo 记着已经用到的段号、写错过几次（同一个 teacher 里避免重复）。
 * 返回 { kind, text } 或 { kind: 'error', code }。导出给测试用。
 */
export function devReply(input, memo = { seq: 0, broken: 0 }, { images = 0 } = {}) {
  const turns = toTurns(input);
  // 第一条是课堂说明：里面的示例也有「写法错误」「（错）」「想不出来」，判断剧本时不能算进去
  const conv = turns.length > 1 && turns[0].role !== 'assistant' ? turns.slice(1) : turns;
  const last = lastUserText(input);
  const said = stripImageNote(last);
  const assistant = conv.filter((t) => t.role === 'assistant').map((t) => textOf(t.content));
  const pic = images > 0 || said !== last ? '（模拟老师：图收到了，但我不读图，按文字接着讲。）\n\n' : '';
  const isSystem = said.startsWith('[系统]');

  if (/请写「?到目前为止的课堂摘要/.test(last)) return { kind: 'compact', text: compactText() };

  const err = said.match(/测试\s*[:：]?\s*([a-z_]+)/);
  if (err && ERROR_CODES.includes(err[1]) && !isSystem) return { kind: 'error', code: err[1] };

  if (isSystem && /写法错误/.test(said)) {
    const ids = brokenIds(said, memo);
    // 「一直写错」：看触发那一段的学生消息；第几次重写就换第几种错法，直到页面放弃（显示「这段没画出来」）
    const { text: student, lint } = sinceStudent(conv);
    const stubborn = /一直写错/.test(student);
    // replace 不写 title=：沿用原来的标题
    const blocks = ids.map((id) => board(`replace id=${id}`, powerBody(suffixOf(id), stubborn ? lint % 2 : -1)));
    return { kind: stubborn ? 'fix-broken' : 'fix', text: join(stubborn ? '我再改一下。' : '我改一下。', ...blocks) };
  }

  if (/下课|小结/.test(said)) return { kind: 'closing', text: closingText(conv) };

  if (!assistant.length) {
    const n = nextSeq(turns, memo);
    return {
      kind: 'first',
      text: join(
        pic + String.raw`我们接着上次停下的地方：$A\mathbf x$ 本身也是一个向量，所以 $A$ 还能再作用一次。`,
        board(`new id=b${n} title="Ax 落在哪条线上"`, firstBody()),
        board('pin id=k1 title="这节课的记号"', NOTATION),
        String.raw`先拖一拖图里灰色的 $\mathbf x$，看黄色的 $A\mathbf x$ 停在哪，再回答第 1 步。`,
      ),
    };
  }

  if (/\[(作答|动作)\]/.test(said)) {
    const giveup = /想不出来|放弃/.test(said);
    const wrong = /（错|没做对|差得比较远|看了答案|没做出来/.test(said);
    if (giveup || wrong) {
      // 错了、想不出来：不换板，在当前板上指给学生看。当前板有图就让图动起来，没图就补一段提示
      const fig = currentFigure(assistant);
      const open = giveup
        ? String.raw`没关系，先不写。盯着黄色箭头：我把 $\mathbf x$ 换个位置，它会从 $\mathbf x$ 滑到 $A\mathbf x$。`
        : String.raw`这里容易想岔。看图：我把 $\mathbf x$ 换到左上方，黄色箭头还是落回那条虚线上。`;
      if (fig) {
        return {
          kind: 'actions',
          text: join(pic + open, board(`figure target=${fig} set x=${SET_X}`), board(`figure target=${fig} play t`), board(`figure target=${fig} highlight 3`),
            String.raw`不管 $\mathbf x$ 在哪，$A\mathbf x$ 都是 $\boldsymbol\alpha$ 的倍数。用这一点再试一次。`),
        };
      }
      const n = nextSeq(turns, memo);
      return { kind: 'actions', text: join(pic + '先别急，看一个提示：', board(`add id=b${n} title="提示"`, keyBody(n, 'hint')), '想通了再回到上面那题。') };
    }
    // 只是拖了拖图、揭开一步（平时跟着下一条消息一起到，这里是单独到的）：说一句，不动黑板
    if (!/\[作答\]/.test(said)) {
      return { kind: 'actions', text: join(pic + String.raw`嗯，看到了。不管 $\mathbf x$ 拖到哪，黄色的 $A\mathbf x$ 都停在那条虚线上：第 1 步问的就是为什么。`) };
    }
    const n = nextSeq(turns, memo);
    // 第一次做对：把刚得出的结论放进常驻栏
    const pinned = assistant.some((a) => /board\s+pin\s+id=k2\b/.test(a));
    return {
      kind: 'actions',
      text: join(
        pic + String.raw`对。换一块板，下面这题不写出 $A$，直接用 $\boldsymbol\alpha$、$\boldsymbol\beta$ 算：`,
        board(`new id=b${n} title="不写出 A 也能算"`, answerBody(n)),
        pinned ? '' : board('pin id=k2 title="刚得出的"', LINE_FACT),
      ),
    };
  }

  if (!isSystem && /没懂|不懂|没听懂|不明白|看不懂|换个说法|想不出来/.test(said)) {
    const n = nextSeq(turns, memo);
    const mode = /换个说法/.test(said) ? 'numbers' : /想不出来/.test(said) ? 'hint' : 'plain';
    const open = { plain: '那我退一步，只说一件事：', numbers: '换个说法，用具体的数看：', hint: '给你一个提示，不给答案：' }[mode];
    // 段标题和提示框自己的标题错开，免得黑板上同一句话出现两遍
    const title = { plain: '退一步', numbers: '换个说法', hint: '一个提示' }[mode];
    // 想不出来：提示加在当前板上（题还在眼前）；没懂、换个说法：换一块板重讲
    const cmd = mode === 'hint' ? `add id=b${n} title="${title}"` : `new id=b${n} title="${title}"`;
    const close = mode === 'hint' ? '看完再试一次上面那题；还卡就点「想不出来」。' : '看完翻回上一块板再试一次；还卡就点「想不出来」。';
    return { kind: 'confused', text: join(pic + open, board(cmd, keyBody(n, mode)), close) };
  }

  // 教具演示：板书标注、会动的矩阵、页面验算
  if (!isSystem && /测试\s*[:：]?\s*教具/.test(said)) {
    const n = nextSeq(turns, memo);
    return {
      kind: 'tools',
      text: join(
        pic + String.raw`看这个三阶矩阵：每一行都是同一行的倍数。`,
        board(`new id=b${n} title="三行成比例"`, rankOneBody(n)),
        board(`mark target=m-${n} of=A`, 'row 1 note="×(−1)"\nrow 2 note="×2" color=pink\nrow 3 note="×1"'),
        board(`mark target=b${n} term=mid note="1×1：一个数 $\\calc{b'*a}$"`),
        String.raw`中间圈出来的 $\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha$ 是一个数。点一点 $A$ 里的数，看它是怎么乘出来的。`,
      ),
    };
  }
  if (!isSystem && /测试\s*[:：]?\s*幂/.test(said)) {
    const n = nextSeq(turns, memo);
    return {
      kind: 'tools',
      text: join(
        pic + String.raw`看 $B$ 的幂：那几个 1 会往哪走？`,
        board(`new id=b${n} title="B 的幂"`, powersBody(n)),
        board(`figure target=m-${n} play k 1 3 3s`),
        board(`mark target=m-${n} entry=1,4 style=arrow note="$B^3$ 只剩这一个"`),
        String.raw`自己拖一拖 $k$，再看一遍。`,
      ),
    };
  }

  if (!isSystem && /测试\s*[:：]?\s*指图/.test(said)) {
    const n = nextSeq(turns, memo);
    return {
      kind: 'tools',
      text: join(
        pic + String.raw`拖一拖 $\mathbf x$，看圈住的 $A\mathbf x$ 往哪走。`,
        board(`new id=b${n} title="指着图讲"`, pointBody(n)),
        board(`mark target=fig-${n} label=Ax note="$A\\mathbf x$ 总在这条线上"`),
        board(`mark target=fig-${n} at=[1, 2] style=arrow note="方向 $\\boldsymbol\\alpha=(1,2)$" color=blue`),
      ),
    };
  }

  // 「继续」或普通文字：这节课第一次时故意写错一段；以后只有暗号「测试:写错」「一直写错」才再写错
  const again = /测试\s*[:：]?\s*(一直)?写错|一直写错/.test(said);
  const brokeBefore = memo.broken > 0
    || conv.some((t) => t.role !== 'assistant' && /写法错误/.test(textOf(t.content)))
    || assistant.some((a) => a.includes(BROKEN_LINE));
  if (said && !isSystem && (again || !brokeBefore)) {
    const n = nextSeq(turns, memo);
    const variant = memo.broken++ % 2; // 第一次是 scene 里写了不存在的命令，下一次是 answer 少了 answer:
    memo.lastBroken = `b${n}`;
    return {
      kind: 'broken',
      text: join(
        pic + String.raw`好，往下走。已经有 $A^2=3A$，再往下乘呢？先看 $A$ 把整个单位圆送到哪。`,
        board(`new id=b${n} title="${POWER_TITLE}"`, powerBody(String(n), variant)),
        '先看图，再填下面的空。',
      ),
    };
  }

  const n = nextSeq(turns, memo);
  return {
    kind: 'fallback',
    text: join(pic + '好。换个练法：只认方法，不用算。', board(`new id=b${n} title="只认方法"`, recognizeBody(n)), '每题点一个方法，再写一句你凭题目里的什么认出来的。'),
  };
}

// —— 板书内容（秩一方阵 A = αβᵀ，α = (1, 2)ᵀ，β = (1, 1)ᵀ，βᵀα = tr A = 3）——

const F3 = '```';
const F4 = '````';
const fence = (lang, body) => `${F3}${lang}\n${body.trim()}\n${F3}`;
// board 块外层一律 4 个反引号，里面组件的 3 个反引号不会把它提前关掉
const board = (cmd, body = '') => `${F4}board ${cmd}\n${body.trim() ? `${body.trim()}\n` : ''}${F4}`;
const join = (...parts) => `${parts.filter(Boolean).join('\n\n')}\n`;

export const SET_X = '[-1, 1.5]';
const POWER_TITLE = 'Aⁿ 怎么写';
// 常驻栏：这节课的记号、刚得出的结论
const NOTATION = String.raw`$A=\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$，$\boldsymbol\alpha=(1,2)^{\mathrm T}$，$\boldsymbol\beta=(1,1)^{\mathrm T}$，$A=\begin{bmatrix}1&1\\2&2\end{bmatrix}$`;
const LINE_FACT = String.raw`$A\mathbf x=\boldsymbol\alpha\,(\boldsymbol\beta^{\mathrm T}\mathbf x)$：不管 $\mathbf x$ 是谁，$A\mathbf x$ 都在 $\boldsymbol\alpha$ 那条线上。`;

// 当前板上的图：最后一块 new 的板里的第一张图（scene / graph / space 的 id:）；之后那块板上 add 的段里的图也算
export function currentFigure(assistantTexts) {
  let fig = null;
  for (const t of assistantTexts || []) {
    for (const m of String(t).matchAll(/^`{3,}board\s+(new|add)\b[^\n]*\n([\s\S]*?)^`{4}\s*$/gm)) {
      const id = m[2].match(/^`{3}(?:scene|graph|space)\n(?:[^\n]*\n)*?id:\s*(\S+)/m)?.[1] || null;
      if (m[1] === 'new') fig = id;
      else if (id && !fig) fig = id;
    }
  }
  return fig;
}
const BROKEN_LINE = 'circle [0, 0] 1'; // scene 没有 circle 命令：parseScene 会报「看不懂这一行」

// 记号在常驻栏（k1）里，这块板上不再写一遍：题和图正好一屏
function firstBody() {
  return [
    fence('steps', String.raw`
id: ex-1
title: A 再作用一次
q: $A=\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$。$A\mathbf x$ 落在哪？$A$ 再作用一次，又落在哪？

step: 先看 $A\mathbf x$
ask: $A\mathbf x=\boldsymbol\alpha\,(\boldsymbol\beta^{\mathrm T}\mathbf x)$。括号里的 $\boldsymbol\beta^{\mathrm T}\mathbf x$ 是什么？
choices: 一个数 | 一个向量 | 一个 2×2 矩阵
answer: 一个数
show: $\boldsymbol\beta^{\mathrm T}\mathbf x$ 是一个数，所以 $A\mathbf x$ 是 $\boldsymbol\alpha$ 的倍数：它总在 $\boldsymbol\alpha$ 那条线上（图里的黄色虚线）。

step: 再乘一次 $A$
ask: $A\mathbf x$ 已经在这条线上了。$A(A\mathbf x)$ 会离开这条线吗？
choices: 会离开 | 还在线上 | 说不准
answer: 还在线上
show: 设 $A\mathbf x=c\,\boldsymbol\alpha$，则 $A(c\,\boldsymbol\alpha)=c\,\boldsymbol\alpha\,(\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha)=3c\,\boldsymbol\alpha$：还在线上，只是变成原来的 3 倍。

step: 写出 $A^2$
do: true
ask: 上一步对所有 $\mathbf x$ 都成立：$A^2\mathbf x=k\,A\mathbf x$。$k$ 是多少？
answer: 3
show: $k=\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha=1\cdot1+1\cdot2=3$，所以 $A^2=3A$。
`),
    // 绑定 ex-1：揭开第 2 步后才出现 A²x；t 由绑定提供（每揭开一步从 0 动到 1），figure play t 也用它
    fence('scene', String.raw`
id: fig-1
title: 拖动 $\mathbf x$，看 $A\mathbf x$ 停在哪
link: ex-1
let A = [[1, 1], [2, 2]]
let x = [1.5, -1] drag
line [0, 0] dir [1, 2] color=yellow dashed
vector x color=gray label=x
vector lerp(x, A*x, t) color=yellow label=Ax
vector A*A*x color=orange label=A²x thin from=2
show $\mathbf x = {x}$，$A\mathbf x = {A*x}$
`),
  ].join('\n\n');
}

// [作答] 之后的小题：换着用几组 x，免得每次一样
const XS = [[3, -1], [4, -3], [-2, 5]];
const par = (v) => (v < 0 ? `(${v})` : String(v));

function answerBody(n) {
  const [a, b] = XS[(n + 1) % XS.length]; // b2 用第一组
  const c = a + b;
  const times = c === 1 ? '' : String(c); // 写成 α，不写 1α
  return fence('answer', String.raw`
id: q-${n}
title: 先算一个数
q: 还是 $\boldsymbol\alpha=(1,2)^{\mathrm T}$，$\boldsymbol\beta=(1,1)^{\mathrm T}$，$A=\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$。取 $\mathbf x=(${a},${b})^{\mathrm T}$，先算 $\boldsymbol\beta^{\mathrm T}\mathbf x$，再写出 $A\mathbf x$。
let a = [1, 2]
let b = [1, 1]
answer: dot(b, [${a}, ${b}]) * a
before: A\mathbf x =
hint: $\boldsymbol\beta^{\mathrm T}\mathbf x=1\cdot ${par(a)}+1\cdot ${par(b)}$ 是一个数，再用它乘 $\boldsymbol\alpha$。
explain: $\boldsymbol\beta^{\mathrm T}\mathbf x=${c}$，所以 $A\mathbf x=${times}\boldsymbol\alpha=(${c},${2 * c})^{\mathrm T}$，还在 $\boldsymbol\alpha$ 那条线上。
`);
}

// Aⁿ 这一段：variant -1 是写对的；0 = scene 里写了不存在的 circle 命令；1 = answer 少了 answer:
function powerBody(suffix, variant = -1) {
  const circle = variant === 0 ? BROKEN_LINE : 'curve [cos(s), sin(s)] color=gray dashed';
  const ans = variant === 1 ? '' : 'answer: 9\n';
  return [
    String.raw`单位圆上的点 $\mathbf x$ 经过 $A$，都被送到 $\boldsymbol\alpha$ 的某个倍数。`,
    fence('scene', String.raw`
id: fig-${suffix}
title: 单位圆被压成一条线段
let A = [[1, 1], [2, 2]]
${circle}
curve A*[cos(s), sin(s)] color=yellow
vector [1, 2] color=blue label=α
show 灰色的圆是所有 $|\mathbf x|=1$ 的点，黄色是它们的像 $A\mathbf x$
`),
    fence('answer', String.raw`
id: q-${suffix}
title: 推到 $n$ 次
q: 已知 $A^2=3A$，其中 $A=\begin{bmatrix}1&1\\2&2\end{bmatrix}$。$A^3$ 是 $A$ 的几倍？
${ans}before: A^3 =
after: A
hint: $A^3=A^2A=(3A)A=3A^2$。
explain: $A^3=3A^2=9A$。一般地 $A^n=3^{n-1}A$，这里的 $3=\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha=\operatorname{tr}A$。
`),
  ].join('\n\n');
}

// 教具演示：秩一方阵 A = αβᵀ（α = (−1, 2, 1)ᵀ，β = (1, 1, −2)ᵀ）。整节课的量放在 let 块里，
// matrix 组件画出 α·βᵀ 的乘积，公式里的 A² 用 \calc 让页面算
function rankOneBody(n) {
  return [
    fence('let', String.raw`
A = [[-1, -1, 2], [2, 2, -4], [1, 1, -2]]
a = [-1, 2, 1]
b = [1, 1, -2]
`),
    fence('matrix', String.raw`
id: m-${n}
product a b' name=A
`),
    String.raw`每一行都是 $\boldsymbol\beta^{\mathrm T}=(1,1,-2)$ 的倍数，倍数就是 $\boldsymbol\alpha$ 的分量。所以 $A^2=\boldsymbol\alpha\,\hl{mid}{\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha}\,\boldsymbol\beta^{\mathrm T}=\calc{b'*a}\,A$，$\operatorname{tr}A=\calc{tr(A)}$。`,
  ].join('\n\n');
}

// 幂零矩阵 B（4 阶）：k 从 1 拖到 4，那串 1 一格一格往右上角退，B³ 只剩右上角一个，B⁴ 是零矩阵
function powersBody(n) {
  return fence('matrix', String.raw`
id: m-${n}
let B = [[0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [0, 0, 0, 0]]
slider k 1 4 = 1 step=1 label="k" play
matrix B^k label="B^{\calc{k}} ="
`);
}

function pointBody(n) {
  return fence('scene', String.raw`
id: fig-${n}
let A = [[1, 1], [2, 2]]
let x = [2, -0.5] drag
line [0, 0] dir [1, 2] color=yellow dashed
vector x color=gray label=x
vector A*x color=yellow label=Ax
`);
}

function keyBody(n, mode) {
  const body = {
    plain: String.raw`
title: 一句话记住
$A\mathbf x=\boldsymbol\alpha\,(\boldsymbol\beta^{\mathrm T}\mathbf x)$：先用 $\boldsymbol\beta$ 把 $\mathbf x$ 变成**一个数**，再把 $\boldsymbol\alpha$ 拉长这么多倍。

所以不管 $\mathbf x$ 是谁，$A\mathbf x$ 都在 $\boldsymbol\alpha$ 那条线上；$A$ 再作用一次，只是再乘一个数 $\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha=3$。`,
    numbers: String.raw`
title: 换成具体的数
取 $\mathbf x=(2,1)^{\mathrm T}$：$\boldsymbol\beta^{\mathrm T}\mathbf x=2+1=3$，所以 $A\mathbf x=3\boldsymbol\alpha=(3,6)^{\mathrm T}$。

再取 $\mathbf x=(1,-1)^{\mathrm T}$：$\boldsymbol\beta^{\mathrm T}\mathbf x=0$，$A\mathbf x=\mathbf 0$。

$\mathbf x$ 只决定「乘几倍」，方向永远是 $\boldsymbol\alpha$。`,
    hint: String.raw`
title: 先看括号里
先别动矩阵，只看括号：$A\mathbf x=\boldsymbol\alpha\,(\boldsymbol\beta^{\mathrm T}\mathbf x)$。

$\boldsymbol\beta^{\mathrm T}$ 是 $1\times2$，$\mathbf x$ 是 $2\times1$，乘出来是什么形状？`,
  }[mode];
  return fence('key', `id: key-${n}\n${body.trim()}`);
}

function recognizeBody(n) {
  return fence('recognize', String.raw`
id: rec-${n}
title: 求 $A^n$，该用哪个方法？
methods: 秩一公式 | 试算低次幂 | 拆 kE+B 二项展开
reason: true
shuffle: true

item: $A=\begin{bmatrix}2&4\\1&2\end{bmatrix}$，求 $A^{5}$
answer: 秩一公式
why: 第一行是第二行的 2 倍，秩为 1：$A^n=(\operatorname{tr}A)^{n-1}A=4^{n-1}A$。

item: $A=\begin{bmatrix}3&1\\0&3\end{bmatrix}$，求 $A^{6}$
answer: 拆 kE+B 二项展开
why: $A=3E+N$，$N^2=O$，二项展开只剩前两项。

item: $A=\begin{bmatrix}0&1\\1&0\end{bmatrix}$，求 $A^{9}$
answer: 试算低次幂
why: $A^2=E$，两次一循环，所以 $A^9=A$。
`);
}

// conv：去掉课堂说明之后的对话
function closingText(conv) {
  const said = conv.filter((t) => t.role !== 'assistant').map((t) => textOf(t.content));
  const count = (re) => said.reduce((s, t) => s + (t.match(re) || []).length, 0);
  const wrong = count(/（错|没做对|差得比较远/g);
  const giveup = count(/想不出来/g);
  const confused = count(/没懂/g);
  const segs = new Set();
  const pages = new Set();
  for (const t of conv) {
    if (t.role !== 'assistant') continue;
    for (const m of textOf(t.content).matchAll(/board\s+(new|add)\s+id=(\S+)/g)) {
      segs.add(m[2]);
      if (m[1] === 'new') pages.add(m[2]);
    }
  }
  const right = count(/（对|做对了|猜得准/g);
  const stuck = wrong + giveup + confused
    ? `作答里答错 ${wrong} 次，点「想不出来」${giveup} 次，说「没懂」${confused} 次。主要卡在「$\\boldsymbol\\beta^{\\mathrm T}\\mathbf x$ 是一个数」这一步：没意识到它只决定倍数。`
    : '这节课的作答里没看到明显卡住的地方，但作答次数不多，不能说明问题。';
  return [
    String.raw`1. **这节课讲了什么**：从「$A\mathbf x$ 本身也是一个向量」接着讲。用 $A=\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$（$\boldsymbol\alpha=(1,2)^{\mathrm T}$，$\boldsymbol\beta=(1,1)^{\mathrm T}$）看 $A\mathbf x$、$A^2\mathbf x$ 都落在 $\boldsymbol\alpha$ 那条线上，推出 $A^2=3A$，再到 $A^n=3^{n-1}A$。` + (segs.size ? `黑板上一共用了 ${pages.size} 块板、写了 ${segs.size} 段。` : ''),
    `2. **学生哪里卡住**：${stuck}`,
    right
      ? String.raw`3. **哪里看起来懂了但证据不够**：有 ${right} 次作答是对的，但都是选择或填数，没让学生用自己的话说为什么 $A\mathbf x$ 在线上；$A^n=3^{n-1}A$ 只做过一道。`
      : String.raw`3. **哪里看起来懂了但证据不够**：还没有答对的作答，谈不上「看起来懂了」；跟着提示点头的地方都不能算数。`,
    String.raw`4. **建议下一节怎么接**：先请学生不看黑板说出 $A\mathbf x=\boldsymbol\alpha(\boldsymbol\beta^{\mathrm T}\mathbf x)$ 的意思；再给一个三阶、三行成比例的矩阵求 $A^{10}$，看学生能不能自己认出秩一、用 $\operatorname{tr}A$ 写出来。`,
    '（这是 ?dev 模拟老师写的小结，只用来测试流程。）',
  ].join('\n\n') + '\n';
}

function compactText() {
  return [
    String.raw`1. 已经讲到哪：用 $A=\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$（$\boldsymbol\alpha=(1,2)^{\mathrm T}$，$\boldsymbol\beta=(1,1)^{\mathrm T}$）讲了 $A\mathbf x$ 总在 $\boldsymbol\alpha$ 那条线上、$A^2=3A$。`,
    '2. 学生卡在哪：不确定（模拟摘要不分析作答）。',
    '3. 错过什么：不确定。',
    '4. 黑板上有哪些段：b1（steps ex-1，图 fig-1），之后的段见黑板现状。',
    String.raw`5. 接下来：接着讲 $A^n=3^{n-1}A$，再做认方法的小练。`,
    '（这是 ?dev 模拟老师写的摘要。）',
  ].join('\n');
}

function jsonReply(prompt, images) {
  if (/"verdict"/.test(prompt)) {
    return { verdict: 'partial', feedback: '（模拟批改）说到了一部分：方向对了，但还没说清楚为什么。', followup: '能用 $\\boldsymbol\\beta^{\\mathrm T}\\mathbf x$ 说说原因吗？' };
  }
  const transcript = '（模拟转写）$A\\mathbf x=\\boldsymbol\\alpha(\\boldsymbol\\beta^{\\mathrm T}\\mathbf x)$，括号里是一个数。';
  if (/"final"/.test(prompt)) return { transcript, final: finalFor(prompt) };
  if (/transcript|转写/.test(prompt) || images) return { transcript };
  if (/课堂摘要/.test(prompt)) return { text: compactText() };
  return { text: '（模拟老师）这是一段模拟的回复。' };
}

// 照 photo.js readFinal 里写的形状，给一组看得出是模拟的数（1, 2, 3…）
function finalFor(prompt) {
  const seq = (n) => Array.from({ length: n }, (_, i) => String(i + 1));
  let m = prompt.match(/(\d+)\s*个向量，每个\s*(\d+)\s*个分量/);
  if (m) return Array.from({ length: +m[1] }, (_, i) => seq(+m[2]).map((x) => String(+x + i * +m[2])));
  m = prompt.match(/(\d+)\s*×\s*(\d+)\s*的矩阵/);
  if (m) return Array.from({ length: +m[1] }, (_, i) => seq(+m[2]).map((x) => String(+x + i * +m[2])));
  m = prompt.match(/含\s*(\d+)\s*个分量的向量/) || prompt.match(/形状：\s*(\d+)\s*个数/);
  if (m) return seq(+m[1]);
  return '1';
}

// —— 段号：输入里能看到的（黑板现状里的「新的一段用 id bN」、之前输出里的 board add/replace）和本实例用过的，取最大往后编 ——

function nextSeq(turns, memo) {
  let n = memo.seq + 1;
  // 黑板现状在课堂说明的最后，取最后一处
  const sys = turns.length > 1 && turns[0].role !== 'assistant' ? textOf(turns[0].content) : '';
  const hint = [...sys.matchAll(/新的一段用 id b(\d+)/g)].at(-1);
  if (hint) n = Math.max(n, +hint[1]);
  for (const t of turns) {
    if (t.role !== 'assistant') continue;
    for (const m of textOf(t.content).matchAll(/board\s+(?:new|add|replace)\s+id=b(\d+)/g)) n = Math.max(n, +m[1] + 1);
  }
  memo.seq = n;
  return n;
}

// 系统消息里点名写错的段：「b3「…」有写法错误」；认不出来就用上次故意写错的那段
function brokenIds(text, memo) {
  const ids = [...text.matchAll(/([A-Za-z0-9_\-.~:@+]{1,64})(?:「[^」\n]*」)?\s*有写法错误/g)].map((m) => m[1]);
  const uniq = [...new Set(ids)];
  if (uniq.length) return uniq;
  return [memo.lastBroken || `b${Math.max(1, memo.seq)}`];
}

// 段 id 是 bN 时组件 id 用 N（fig-3、q-3），别的写法就整个拿来当后缀
const suffixOf = (id) => (/^b(\d+)$/.exec(id)?.[1] ?? id);

// —— 输入 ——

function toTurns(input) {
  if (Array.isArray(input)) return input.filter((t) => t && typeof t === 'object');
  if (input === null || input === undefined || input === '') return [];
  return [{ role: 'user', content: typeof input === 'string' ? input : textOf(input) }];
}

// content 可能是字符串，也可能是 [{type:'text', text}, {type:'image', …}] 这样的块
function textOf(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p && typeof p.text === 'string' ? p.text : '')).join('\n');
  if (c && typeof c === 'object' && typeof c.text === 'string') return c.text;
  return c === null || c === undefined ? '' : String(c);
}

export function lastUserText(input) {
  const turns = toTurns(input);
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role !== 'assistant') return textOf(turns[i].content).trim();
  return '';
}

// 往回找最后一条学生自己说的（不是 [系统] 消息），顺便数在那之后收到过几次「写法错误」
function sinceStudent(conv) {
  let lint = 0;
  for (let i = conv.length - 1; i >= 0; i--) {
    if (conv[i].role === 'assistant') continue;
    const t = textOf(conv[i].content).trim();
    if (!t.startsWith('[系统]')) return { text: t, lint };
    if (/写法错误/.test(t)) lint++;
  }
  return { text: '', lint };
}

// classroom 在附图时会加一句「（附了 N 张图：…）」或「（学生附了图）」
const stripImageNote = (s) => s.replace(/（附了\s*\d+\s*张图[^）]*）|（学生附了图）/g, '').trim();

const countImages = (imgs) => (Array.isArray(imgs) ? imgs.length : 0);

function imageProblem(imgs) {
  if (!Array.isArray(imgs) || !imgs.length) return '';
  const { maxCount, maxInputBytes, mediaTypes } = DEV_LIMITS.images;
  if (imgs.length > maxCount) return `一次最多 ${maxCount} 张图`;
  if (imgs.some((b) => b && b.type && !mediaTypes.includes(b.type))) return '只收 PNG 或 JPEG';
  const total = imgs.reduce((s, b) => s + (Number(b?.size) || 0), 0);
  if (total > maxInputBytes) return '图片太大';
  return '';
}

const enc = typeof TextEncoder === 'function' ? new TextEncoder() : null;
function promptBytes(input) {
  const s = toTurns(input).map((t) => textOf(t.content)).join('');
  return enc ? enc.encode(s).length : s.length * 3;
}

// calls 里只留数据：去掉函数和 signal；tools 只留名字和说明
function cleanOpts(opts) {
  const out = {};
  for (const [key, v] of Object.entries(opts || {})) {
    if (typeof v === 'function' || key === 'signal') continue;
    out[key] = key === 'tools' && Array.isArray(v) ? v.map((t) => ({ name: t?.name, description: t?.description, inputSchema: t?.inputSchema })) : v;
  }
  return out;
}

const copyInput = (input) => (Array.isArray(input) ? input.map((t) => (t && typeof t === 'object' ? { ...t } : t)) : input);

// —— 流式 ——

// 确定性的伪随机（同一段文字每次切法一样，测试可以复现）
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** 把文字切成 6–20 个字符一块（按码点切，不拆开 emoji 这类代理对）。导出给测试用 */
export function streamChunks(text, seed = hash(String(text ?? ''))) {
  const chars = Array.from(String(text ?? ''));
  const rnd = prng(seed);
  const out = [];
  for (let i = 0; i < chars.length;) {
    const size = 6 + Math.floor(rnd() * 15);
    out.push(chars.slice(i, i + size).join(''));
    i += size;
  }
  return out;
}

function stream(text, { onText, signal, pace }) {
  const parts = streamChunks(text);
  const rnd = prng(hash(text) ^ 0x5bd1e995);
  return new Promise((resolve, reject) => {
    let sofar = '', i = 0, timer = null, done = false;
    const finish = () => { done = true; clearTimeout(timer); signal?.removeEventListener?.('abort', abort); };
    const abort = () => { if (done) return; finish(); reject(cancelled(sofar)); };
    if (signal?.aborted) { reject(cancelled('')); return; }
    signal?.addEventListener?.('abort', abort, { once: true });
    const tick = () => {
      if (done) return;
      if (i < parts.length) {
        const delta = parts[i++];
        sofar += delta;
        if (typeof onText === 'function') {
          // 页面的回调出错不该打断这一轮（真的平台也不会因为它停下）
          try { onText({ text: sofar, delta }); } catch (e) { console.error('onText 出错', e); }
        }
        if (done) return; // 回调里中止了
      }
      if (i >= parts.length) { finish(); resolve(sofar); return; }
      timer = setTimeout(tick, (40 + Math.floor(rnd() * 41)) * pace);
    };
    timer = setTimeout(tick, THINK_MS * pace);
  });
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelled('')); return; }
    const timer = setTimeout(() => { signal?.removeEventListener?.('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(cancelled('')); };
    signal?.addEventListener?.('abort', abort, { once: true });
  });
}

const fail = (code, message) => Object.assign(new Error(message || code), { code });
const cancelled = (text) => Object.assign(fail('cancelled', '已停止'), { text });

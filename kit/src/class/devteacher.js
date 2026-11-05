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
// 「测试:指图」在图上标注：label= 圈住 Ax（拖动 x 时跟着走），at= 用箭头指一个点；
// 「测试:记忆」学习台里上课：真的调用 memory_read、lesson_note（提议）、slip_note 三个工具，写一段标了 point= 的题；
// 「测试:出题」自定义练习模板（practice type: custom，页面随机出题）；「测试:公式」写含 n 的式子（answer 的 formula: n）；
// 「测试:示意图」sketch 当场画的图 + highlight + label= 标注；「测试:推导」derive 分拍板书 + figure play step；
// 「测试:原图」image 贴讲义原图（本地用一张模拟的）；「测试:排序」演示组件 sort（快排一次划分，先猜枢轴落在哪）+ figure play step + mark；
// 「测试:预案」board react + add … hold（答对由页面接，不再调用；答错照常调用）；「测试:拍子」一轮分四拍（说一句、写一段、圈一下……）。
// 「测试:守卫」学习台里：memo 块写一条对得上的、一条编原话的、一条编证据编号的、一条重复的（守卫收下 / 挂提醒 / 拒收）。
// 一问一答的课里：「测试:写错」写一行看不懂的；「测试:写错带记」写一行算不出来的值（只有画出来才查得到）还带 memo（review R3 过），
// 重写时原样再带（只该升一档）；
// 「测试:除零」一个能拨到 0 的量（拨到 0 以后旧行算不出来，老师下一轮写对了不该被退回）。
// 系统发来的「[动作] … 没有动静」（察觉卡住）→ 轻轻问一句；只带「[板书]」的消息 → 说收到了。

export const DEV_LIMITS = Object.freeze({ maxPromptBytes: 262144, images: Object.freeze({ maxCount: 4, maxInputBytes: 20000000, mediaTypes: Object.freeze(['image/png', 'image/jpeg']) }) });
const THINK_MS = 600; // 第一个字出来前的停顿（模拟思考）
const JSON_MS = 300;
const ERROR_CODES = ['rate_limited', 'refused', 'not_granted', 'sampling_disabled', 'session_expired', 'prompt_too_large', 'image_rejected'];

export function createDevTeacher({ fallback = false, pace = 1, script = null } = {}) {
  // pace：所有停顿乘这个系数（测试用 0；页面用默认 1）
  const k = Number.isFinite(pace) && pace >= 0 ? pace : 1;
  const memo = { seq: 0, broken: 0, next: 0 };
  // script：验收用的剧本（tools/check-lesson.mjs 的 *.class.json）——按顺序原样回放别人写好的课堂输出，
  // 不按学生的话挑。页面发来的 [系统] 消息（写法错误要求重写、附图）不占剧本，记下来给验收脚本看
  const scripted = Array.isArray(script) ? script.map((t) => String(t ?? '')) : null;

  async function teacher(input, opts = {}) {
    opts = opts || {};
    const reply = scripted ? scriptReply(input, memo, scripted, teacher.log) : devReply(input, memo, { images: countImages(opts.images) });
    teacher.calls.push({ method: 'call', kind: reply.kind, input: copyInput(input), opts: cleanOpts(opts) });
    const signal = opts.signal;
    if (signal?.aborted) throw cancelled('');
    const tooBig = promptBytes(input) > DEV_LIMITS.maxPromptBytes;
    if (tooBig) throw fail('prompt_too_large', '这一轮的内容超过了 256 KiB');
    const bad = imageProblem(opts.images);
    if (bad) throw fail('image_rejected', bad);
    // 验证脚本（tools/canvas-sim.mjs）：剧本放完了就一直「在想」，不往板上写东西，页面停在上一轮的样子
    if (reply.kind === 'script-end' && globalThis.LAKitDevScriptWait) {
      await new Promise((_, rej) => signal?.addEventListener('abort', () => rej(cancelled(''))));
    }
    if (reply.kind === 'error') {
      await wait(THINK_MS * k / 2, signal);
      throw fail(reply.code, `模拟错误：${reply.code}`);
    }
    // 剧本里要调用的工具（「测试:记忆」）：照真的 Claude 那样调页面给的工具，结果记下来给开发面板、测试看
    if (reply.calls && Array.isArray(opts.tools)) {
      for (const c of reply.calls) {
        const tool = opts.tools.find((t) => t.name === c.name);
        let out;
        try { out = tool ? await tool.execute(c.input) : { error: `没给 ${c.name} 这个工具` }; } catch (e) { out = { error: e?.message || String(e) }; }
        teacher.toolResults.push({ name: c.name, input: c.input, out });
      }
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
  teacher.toolResults = []; // 剧本里调用过的工具和结果
  teacher.log = []; // 剧本模式：收到的 [系统] 消息
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
// 剧本模式的一轮：[系统] 消息不占剧本（只记下来，回一句不动黑板的话）；其余按顺序取下一段
export function scriptReply(input, memo, script, log = []) {
  const said = stripImageNote(lastUserText(input));
  if (said.startsWith('[系统]')) {
    log.push(said);
    return { kind: 'script-system', text: '（验收：这一轮不改写。）\n' };
  }
  const i = memo.next++;
  if (i >= script.length) return { kind: 'script-end', text: '（验收：剧本放完了。）\n' };
  return { kind: 'script', text: script[i] };
}

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

  // 学习台里下课：小结后面接着写整理单（memo 块），依据用课后报告里的第一道题
  if (/下课|小结/.test(said)) return { kind: 'closing', text: closingText(conv) + (/整理单/.test(said) ? `\n${closingMemo(said)}` : '') };

  // 一问一答的课（kind: talk，说明的开头写着）：写活板的行，一问一答
  if (turns.length && textOf(turns[0].content).includes(TALK_MARK)) return talkReply({ said, conv, isSystem });

  // 一轮写了两块新板、第一块还很长：页面把第二块并进第一块（一轮最多一块新板），长的那块上下滑着看，不切成几屏
  if (!isSystem && /测试\s*[:：]?\s*长板/.test(said)) {
    const n = nextSeq(turns, memo);
    const para = (i) => `第 ${i} 段：$A\\mathbf x=\\boldsymbol\\alpha(\\boldsymbol\\beta^{\\mathrm T}\\mathbf x)$，括号里是一个数，所以 $A\\mathbf x$ 总落在 $\\boldsymbol\\alpha$ 那条线上。`;
    return {
      kind: 'long',
      text: join('（模拟老师）这一轮故意写了两块新板，第一块还很长。',
        board(`new id=b${n} title="很长的一块板"`, Array.from({ length: 14 }, (_, i) => para(i + 1)).join('\n\n')),
        board(`new id=b${n + 1} title="第二块新板"`, '这一段本来想换新板，页面会并到上面那块板上。')),
    };
  }

  // 英语第 7 批（docs/english-plan.md）：要背的写进内容（==…==、remember 框）、讲着讲着框一大块（mark part=）、生词（gloss）、翻译按要点判（translate）
  if (!isSystem && /测试\s*[:：]?\s*要背/.test(said)) {
    const n = nextSeq(turns, memo);
    const body = [
      '**一般现在时里什么时候加 -s**：主语是第三人称单数时，谓语动词加 -s；==be 动词除外==。',
      fence('remember', ['title: 第三人称单数（完整清单，就这四类）', '1. he / she / it', '2. 不定代词：everyone、something、nobody', '3. 不可数名词', '4. 可数名词单数（单个的人名、地名也算）'].join('\n')),
      'Pearson also predicts a breakthrough in computer-human links, as well as in medicine. (2001, Translation)',
      fence('gloss', 'breakthrough = 突破\npredict = 预言\nas well as = 和……一样；也'),
      fence('translate', ['id: tr-dev', 'title: 翻译', 'src: By 1830 the former Spanish and Portuguese colonies had become independent nations.', 'points:', '- by 1830 = 到…为止 | 截至', '- had become = 已经 | 已', '- independent nations = 独立', '- !开始变成 = had become 是「已经成为」，不是「开始变成」', 'order: by 1830 < had become', 'answer: 到 1830 年为止，以前西班牙和葡萄牙的殖民地已经成为独立的国家。'].join('\n')),
    ].join('\n\n');
    return {
      kind: 'remember',
      text: join('（模拟老师）要背的用粉色：一个词句是荧光底，一整块是一个粉框。例句里不认识的词点一下看意思；最后翻一句。',
        board(`new id=b${n} title="什么时候加 -s"`, body),
        board(`mark target=b${n} part=1 color=pink note="先看这句"`, '')),
    };
  }

  // 预案（docs/board-plan.md）：出一道题，只预写答对了接什么（揭开藏着的下一题）；答错、想不出来照常叫老师当场写。
  // 答对时页面当场接，不再调用模拟老师（开发面板的调用记录不涨）；答错时调用记录涨一次
  if (!isSystem && /测试\s*[:：]?\s*预案/.test(said)) {
    const n = nextSeq(turns, memo);
    const q = (id, x, hint) => fence('answer', [`id: ${id}`, 'title: 算一个', String.raw`q: $A=\begin{bmatrix}1&1\\2&2\end{bmatrix}$，$\mathbf x=${x}$，$A\mathbf x$ 等于多少？`, 'let A = [[1, 1], [2, 2]]', `answer: A*${x.replace(/\\?[()]/g, (c) => (c.endsWith('(') ? '[' : ']'))}`, `hint: ${hint}`].join('\n'));
    return {
      kind: 'react',
      text: join(
        pic + '（模拟老师）先算一个。答对了页面按我预先写好的话接、揭开下一题，不再叫我；答错了照常叫我。',
        board(`new id=b${n} title="先算一个"`, q(`q-${n}`, '(3, -1)', '第一个分量是第一行和 $(3,-1)$ 的点积。')),
        board(`add id=b${n + 1} hold title="再来一个"`, q(`q-${n + 1}`, '(1, 0)', '乘 $(1,0)$ 就是取出第一列。')),
        board(`react target=q-${n}`, [
          `right show=b${n + 1}: 对，$(2, 4)$。再来一个：乘 $(1,0)$ 会得到什么？`,
        ].join('\n')),
        board(`react target=q-${n + 1}`, 'right: 对：乘 $(1,0)$ 就是取出 $A$ 的第一列。（模拟老师：再往下就要叫我了）'),
      ),
    };
  }

  // 拍子（docs/board-plan.md）：说一句、写一段、再说一句、圈一下……页面一拍一拍地播，学生点「下一拍」
  if (!isSystem && /测试\s*[:：]?\s*拍子/.test(said)) {
    const n = nextSeq(turns, memo);
    return {
      kind: 'beats',
      text: join(
        pic + '（模拟老师）这一轮分四拍讲。先看这个矩阵：两行成比例。',
        board(`new id=b${n} title="秩一矩阵"`, String.raw`$$A=\begin{bmatrix}\hl{r1}{1\;\;1}\\\hl{r2}{2\;\;2}\end{bmatrix}$$`),
        '第二行正好是第一行的 2 倍——圈出来看。',
        board(`mark target=b${n} term=r2 note="= 2 × 第一行"`),
        '所以它能拆成一列乘一行：',
        board(`add id=b${n + 1} title="拆开"`, String.raw`$$A=\begin{bmatrix}1\\2\end{bmatrix}\begin{bmatrix}1&1\end{bmatrix}=\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$$`),
        '最后，你来判断：',
        board(`add id=b${n + 2} title="判断"`, fence('quiz', [`id: q-${n + 2}`, String.raw`q: $\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha$ 是`, '- [x] 一个数', '- [ ] 2×2 矩阵'].join('\n'))),
      ),
    };
  }

  // 守卫（memory/guard.js）：一条引了学生刚说的原话（收下）、一条编了一句原话（挂提醒）、一条依据编了一个没有的证据（挂提醒）、
  // 一条和第一条几乎一样（拒收）
  if (!isSystem && /测试\s*[:：]?\s*守卫/.test(said)) {
    return {
      kind: 'memo',
      text: join(
        '（模拟老师）先记几条。',
        board('memo', [
          `note text="学生原话「${said.replace(/"/g, '')}」，想看守卫" basis=say`,
          'slip text="学生说「这一块我早就会了不用讲」，我没追问" lesson="先问一句再讲"',
          'note text="（模拟老师）形状判断下次换一种题再测" basis=ev-zzzz-fake',
          `note text="学生原话「${said.replace(/"/g, '')}」，想看守卫。" basis=say`,
        ].join('\n')),
      ),
    };
  }

  // 学习台里改记忆：每一档都写一条（直接写的、等确认的规则、待办），再故意写三条不对的（掌握不收、偏好没写依据、和 W19 一样的新弱点）
  if (!isSystem && /测试\s*[:：]?\s*整理/.test(said)) {
    const n = nextSeq(turns, memo);
    return {
      kind: 'memo',
      text: join(
        pic + '先记一下刚才看到的，然后做一道：',
        board(`new id=b${n} title="几行几列" point=tr`, [
          '```quiz',
          `id: q-org-${n}`,
          String.raw`q: $\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$（$\boldsymbol\alpha,\boldsymbol\beta$ 都是 3 维列向量）是`,
          '- [ ] 一个数',
          '- [x] 3×3 矩阵',
          '```',
        ].join('\n')),
        board('memo', [
          'pref topic=讲法 text="（模拟老师）先看图再推公式" basis=say',
          'slip text="（模拟老师）刚才一口气讲了三步才停" lesson="一步一停"',
          'lesson id=T-1 again="（模拟老师）这块板的题用到了没讲的外积"',
          'slip text="b3 又超出一屏（约 900）"',
          'note text="（模拟老师）问到形状时犹豫了很久" about=W19',
          'error q="（模拟）βᵀα 是几行几列" mine="3×3" step="判断形状" cause="（模拟老师）把内积当外积" weakness=W19 basis=say',
          'weakness id=W19 level=L0 basis=say',
          'todo text="（模拟老师）学生问了 βᵀα 为什么叫内积，资料包里没有"',
          'rule cat=讲解 text="（模拟老师）出一组题之前，先把要用到的规则都讲完" basis=say',
          'mastery id=L2.2.2 state=基础题过',
          'pref topic=习惯 text="（模拟老师）没写依据的偏好"',
          'weakness title="内积和外积分不清" scope=链条 level=L0 basis=say',
        ].join('\n')),
      ),
    };
  }

  if (!assistant.length) {
    const n = nextSeq(turns, memo);
    return {
      kind: 'first',
      text: join(
        pic + String.raw`我们接着上次停下的地方：$A\mathbf x$ 本身也是一个向量，所以 $A$ 还能再作用一次。`,
        board(`new id=b${n} title="Ax 落在哪条线上"`, firstBody()),
        board('pin id=k1 title="这节课的记号"', NOTATION),
        // 教学计划（学生看不到）：真的老师开课时写一份，下一轮页面放进说明（docs/learning-plan.md 第 5 节）
        board('plan', '目标：学生自己看出 Ax 总在 α 那条线上\n猜：（模拟）可能把 βᵀx 当成向量\n证实：第 1 步选什么'),
        String.raw`先拖一拖图里灰色的 $\mathbf x$，看黄色的 $A\mathbf x$ 停在哪，再回答第 1 步。`,
      ),
    };
  }

  // 察觉卡住：只轻轻问一句，不动黑板
  if (/没有动静/.test(said)) {
    return { kind: 'nudge', text: join(pic + '不急。卡在哪一步了吗？要提示就点「想不出来」，在纸上算的话算完再交。') };
  }
  // 学生在黑板上写了板书（附图）：模拟老师不读图，只回应收到
  if (/^\[板书\]/m.test(said) && !/\[(作答|动作)\]/.test(said)) {
    return { kind: 'ink', text: join(pic + '看到你在黑板上写的了（模拟老师不读图）。接着说说你是怎么想的？') };
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

  // 学习台里上课：读记忆、记提议和自己的失误、写一段标了知识点的题
  if (!isSystem && /测试\s*[:：]?\s*记忆/.test(said)) {
    const n = nextSeq(turns, memo);
    return {
      kind: 'tools',
      calls: [
        { name: 'memory_read', input: { collection: 'weaknesses' } },
        { name: 'lesson_note', input: { kind: 'proposal', text: '（模拟老师）这节课内积外积分得清了，W19 可以考虑降一级。', about: ['W19'] } },
        { name: 'slip_note', input: { text: '（模拟老师）一次出了两道题，没等学生答第一道。', lesson: '一块板一件事。' } },
      ],
      text: join(
        pic + '先看一道和上次错题同类的：',
        board(`new id=b${n} title="内积还是外积" point=tr`, [
          String.raw`$\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha$ 是几行几列？`,
          '',
          '```quiz',
          `id: q-mem-${n}`,
          String.raw`q: $\boldsymbol\alpha,\boldsymbol\beta$ 都是 3 维列向量，$\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha$ 是`,
          '- [x] 一个数（1×1）',
          '- [ ] 3×3 矩阵',
          '```',
        ].join('\n')),
      ),
    };
  }

  // 教具演示：板书标注、会动的矩阵、页面验算
  // 标注（docs/mark-plan.md）：照 2026-11-03 真课那块板（一般现在时什么时候加 -s）。「测试:标注旧」是那节课里 Claude 的标法
  // （把文字塞进公式起名字、一项一个圈），对照用；「测试:标注」是现在该怎么标
  if (!isSystem && /测试\s*[:：]?\s*标注/.test(said)) {
    const n = nextSeq(turns, memo);
    const old = /标注\s*旧/.test(said);
    // 「测试:标注圈」：一组要背的画一个大圈；「测试:标注全」：别的画法（✓ ✗、着重号、双下划线、划掉、箭头、跨行的圈）
    if (/标注\s*全/.test(said)) return { kind: 'marks', text: join(pic + '（模拟老师）先判断下面几句对不对。', board(`new id=b${n} title="判断对错"`, sJudgeBody()), ...sJudgeMarks(n)) };
    const ring = /标注\s*圈/.test(said);
    return { kind: 'marks', text: join(pic + '（模拟老师）粉色的是要背的。圈好以后，做最下面那道题。', board(`new id=b${n} title="什么时候加 -s"`, sRuleBody(old)), ...sRuleMarks(n, old, ring)) };
  }

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

  if (!isSystem && /测试\s*[:：]?\s*出题/.test(said)) {
    const n = nextSeq(turns, memo);
    return { kind: 'tools', text: join(pic + '练几道：每道题的数都是页面随机取的，做对 3 道就够。', board(`new id=b${n} title="秩一矩阵的幂：练几道"`, customPracticeBody(n))) };
  }
  if (!isSystem && /测试\s*[:：]?\s*公式/.test(said)) {
    const n = nextSeq(turns, memo);
    return { kind: 'tools', text: join(pic + String.raw`这次不填数，写式子：用 $n$ 和 $A$ 写出 $A^n$。`, board(`new id=b${n} title="写出 Aⁿ"`, formulaBody(n))) };
  }

  if (!isSystem && /测试\s*[:：]?\s*示意图/.test(said)) {
    const n = nextSeq(turns, memo);
    return {
      kind: 'tools',
      text: join(
        pic + String.raw`画个示意图：分块对角的矩阵，两块互不打扰。`,
        board(`new id=b${n} title="分块对角"`, sketchBody(n)),
        board(`figure target=sk-${n} highlight 3`),
        board(`mark target=sk-${n} label=A_2 note="各自乘方" color=pink`),
        String.raw`所以 $\begin{bmatrix}A_1&O\\O&A_2\end{bmatrix}^n=\begin{bmatrix}A_1^n&O\\O&A_2^n\end{bmatrix}$。`,
      ),
    };
  }
  if (!isSystem && /测试\s*[:：]?\s*推导/.test(said)) {
    const n = nextSeq(turns, memo);
    return {
      kind: 'tools',
      text: join(
        pic + String.raw`我一行一行写，你跟着看每一步为什么成立。`,
        board(`new id=b${n} title="推 A²"`, deriveBody(n)),
        board(`figure target=d-${n} play step 1 4 4s`),
        board(`mark target=d-${n} item=2 style=underline note="关键一步"`),
      ),
    };
  }
  if (!isSystem && /测试\s*[:：]?\s*原图/.test(said)) {
    const n = nextSeq(turns, memo);
    return {
      kind: 'tools',
      text: join(
        pic + '对照讲义原图看一下：书上就是这么写的。',
        board(`new id=b${n} title="讲义里的例 2.1"`, fence('image', `id: img-${n}\nname: 例2.1\ncaption: 讲义里例 2.1：和我们刚推的一样`)),
        board(`mark target=img-${n} note="点一下放大看"`),
      ),
    };
  }

  if (!isSystem && /测试\s*[:：]?\s*排序/.test(said)) {
    const n = nextSeq(turns, memo);
    return {
      kind: 'tools',
      text: join(
        pic + '看快排的一次划分：枢轴先拿出来，high 和 low 轮流往中间走、填坑。',
        board(`new id=b${n} title="快排：一次划分"`, fence('sort', `id: s-${n}\nalgo: quick\narray: 49 38 65 97 76 13 27 49'\nask: pivot`)),
        board(`figure target=s-${n} play step 0 1 1s`),
        board(`mark target=s-${n} item=1 note="空出来的坑" color=pink`),
        '接着点「下一步」往下走；走到最后会先问你枢轴 49 落在第几个。',
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
// 「测试:标注」那块板。old：照真课里 Claude 的写法，把要圈的文字塞进公式、起名字
function sRuleBody(old) {
  const t = (name, x) => (old ? `$\\hl{${name}}{\\text{${x}}}$` : x);
  return [
    '**这块板回答：一般现在时里，谓语什么时候写成 does（动词加 -s），什么时候用原形 do。**',
    '',
    old ? '标法：粉色圈 = 要背的；蓝字 = 要理解的关键说明。' : '标法：=={yellow}涂黄的== 是关键说明，==涂粉的== 和粉色括号里的要背。',
    '',
    `${F3}key`,
    '重点 1：规则 + 哪些主语算第三人称单数（书页 021）',
    '',
    `**规则**：主语是第三人称单数时，谓语动词加 -s；${t('ex', 'be 动词除外。')}`,
    '',
    old ? '**第三人称单数，书上列的是完整清单，只有这四类：**' : '**第三人称单数，书上列的是完整清单，=={pink}只有这四类==：**',
    '',
    `1. ${t('p1', 'he / she / it')}`,
    `2. ${t('p2', '不定代词')}：everyone、something、nobody 等`,
    `3. ${t('p3', '不可数名词')}`,
    `4. ${t('p4', '可数名词单数')}（单个的人名、地名也算）`,
    F3,
    '',
    `${F3}quiz`,
    'id: q-s1',
    'q: Everyone in my class ___ English every day.',
    '- [ ] study',
    '- [x] studies',
    F3,
  ].join('\n');
}
function sRuleMarks(n, old, ring = false) {
  if (old) return [board(`mark target=b${n} color=pink`, 'term=ex note="例外"\nterm=p1\nterm=p2\nterm=p3\nterm=p4')];
  return [
    board(`mark target=b${n} li=1-4 ${ring ? '' : 'style=brace '}color=pink note="要背：只有这四类"`),
    board(`mark target=b${n} text="be 动词除外" style=circle color=red note="例外"`),
    board(`mark target=b${n} text="谓语动词加 -s" style=highlight`),
    board(`mark target=b${n} text="everyone、something、nobody" style=wave color=blue`),
  ];
}

function sJudgeBody() {
  return [
    '下面四句，哪句的谓语写对了？',
    '',
    '1. He work in a bank.',
    '2. She works in a bank.',
    '3. Everyone like this song.',
    '4. The news are good.',
    '',
    '**判断的顺序**：先找主语，再看主语是不是第三人称单数，最后看谓语有没有加 -s。主语离谓语远的时候（中间夹着定语、从句），先把中间的部分划掉再判断，不然很容易被中间那个名词带跑。',
    '',
    'The boy with two dogs walks to school.',
  ].join('\n');
}
function sJudgeMarks(n) {
  return [
    board(`mark target=b${n}`, 'text="He work in a bank." cross\ntext="She works in a bank." tick\ntext="Everyone like this song." cross note="everyone 是单数"\ntext="The news are good." cross note="news 不可数"'),
    board(`mark target=b${n} text="哪句的谓语写对了" style=dots color=pink`),
    board(`mark target=b${n} text="主语离谓语远的时候…先把中间的部分划掉再判断" style=circle color=yellow`),
    board(`mark target=b${n} text="with two dogs" style=strike color=red`),
    board(`mark target=b${n} text="The boy" to="walks" color=green note="主语 → 谓语"`),
    board(`mark target=b${n} text="不然很容易被中间那个名词带跑" style=double color=blue`),
    board(`mark target=b${n} phrase="to school" color=purple`),
  ];
}

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

function customPracticeBody(n) {
  return fence('practice', String.raw`
id: pr-${n}
title: 秩一矩阵的幂
type: custom
count: 3
pick a = int(-3, 3) nonzero
pick c = int(1, 3)
let A = [[c, 1], [a*c, a]]
where tr(A) != 0
where abs(tr(A)) <= 4
q: 设 $A=\calc{A}$，求 $A^{3}$。
answer: A^3
before: A^3 =
hint: 两行成比例，$A$ 的秩是 1：$A^3=(\operatorname{tr}A)^2A$。
explain: $\operatorname{tr}A=\calc{tr(A)}$，所以 $A^3=\calc{tr(A)^2}\,A=\calc{A^3}$。
`);
}

function formulaBody(n) {
  return [
    fence('let', 'A = [[1, 1], [2, 2]]'),
    fence('answer', String.raw`
id: q-${n}
title: 用 n 写出 Aⁿ
q: $A=\calc{A}$，$\operatorname{tr}A=\calc{tr(A)}$。用 $n$ 和 $A$ 写出 $A^n$（$n\ge1$）。
answer: 3^(n-1)*A
formula: n
before: A^n =
hint: 先算 $A^2$，看它是 $A$ 的几倍。
explain: $A^2=\calc{A^2}=3A$，所以 $A^n=3^{n-1}A$。
`),
  ].join('\n\n');
}

function sketchBody(n) {
  return fence('sketch', String.raw`
id: sk-${n}
title: 分块对角矩阵
width: 340
height: 220
<path d="M 62 20 L 50 20 L 50 200 L 62 200" class="thick"/>
<path d="M 238 20 L 250 20 L 250 200 L 238 200" class="thick"/>
<rect x="64" y="28" width="80" height="76" rx="6" class="blue fill"/>
<rect x="156" y="116" width="80" height="76" rx="6" class="pink fill"/>
<line x1="150" y1="22" x2="150" y2="198" class="dashed faint"/>
<line x1="54" y1="110" x2="246" y2="110" class="dashed faint"/>
<tex x="104" y="66">A_1</tex>
<tex x="196" y="154">A_2</tex>
<tex x="196" y="66" color="gray">O</tex>
<tex x="104" y="154" color="gray">O</tex>
<path d="M 262 110 Q 290 80 318 110" class="arrow yellow"/>
<text x="290" y="140" text-anchor="middle" class="yellow small">n 次方</text>
`);
}

function deriveBody(n) {
  return [
    fence('let', 'A = [[1, 1], [2, 2]]'),
    fence('derive', String.raw`
id: d-${n}
title: 推 A²
A^2 = (\boldsymbol\alpha\boldsymbol\beta^{\mathrm T})(\boldsymbol\alpha\boldsymbol\beta^{\mathrm T})
    = \boldsymbol\alpha(\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha)\boldsymbol\beta^{\mathrm T}   // 结合律：中间先乘
    = (\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha)\,\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}   // $\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha$ 是一个数，提到前面
    = \calc{tr(A)}\,A   // $\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha=\operatorname{tr}A$
`),
  ].join('\n\n');
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

// 下课整理单（模拟）：依据用课后报告里列的第一道题，报告里没有题就用学生说的话。
// 提示词里有「顺带整理记忆」（每 5 节一次、或者到了上限）时，再把 R5 并进 R3、p-lang 并进 p-goal（示例记忆里的编号）
function closingMemo(said) {
  const comp = said.match(/^- ([A-Za-z][\w-]*)（/m)?.[1] || 'say';
  const tidy = /顺带整理记忆/.test(said) ? ['review id=R5 status=merged into=R3', 'pref id=p-lang status=merged into=p-goal'] : [];
  return board('memo', [
    `error q="（模拟）βᵀα 是几行几列" mine="3×3" step="判断 βᵀα 的形状" cause="（模拟老师）把 βᵀα 当成 3×3 矩阵" weakness=W19 basis=${comp}`,
    `weakness id=W19 level=L2 basis=${comp}`,
    `review id=R5 add="（模拟）βᵀα 是几行几列" basis=${comp}`,
    'position next="（模拟老师）先收形状判断的同类题，再推 Aⁿ" debts="形状判断的同类题"',
    'lesson text="（模拟老师）下课前留一道题让学生用自己的话说一遍" why="下课前没让学生口述，看不出懂没懂" topic=检验',
    'lesson id=T-1 text="（模拟老师）出一组练习之前，先把整组题读一遍，逐题列出要用到的规则，没讲过的先讲完；讲不了的那题不出" slips=S-1-1',
    ...tidy,
  ].join('\n')) + '\n';
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

// —— 一问一答（kind: talk，docs/talk-impl.md D.1）的剧本：不调用 Claude，写活板的行 ——
// 第一轮：一个页面置换的过程（能拨着看第几步）+ 一个空；学生答对以后 set 改页框数（上面的空跟着重新打开）+ 一个选择；
// 再一轮：自己拨页框数的目标（goal）。答错了给一句提示、不往前走；「测试:写错」故意写一行看不懂的（页面退回去、要它整轮重写）
const TALK_MARK = '这是一问一答的课的完整说明';
const TALK_REFS = 'refs=[1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]';
const TALK_STEPS = [
  { mark: '一共缺页几次', text: ['（模拟老师）我们从一个具体的例子开始。', '# FIFO 换页', 'let f = 3', `let r = paging(${TALK_REFS}, frames=f, algo=fifo)`, 'let k = 0 拨 0..12', 'draw r at k', '拨一拨，看每一步页框里是什么：现在在第 {k} 步。', '{f} 个页框、按 FIFO 换：这串引用一共缺页几次？{r.faults?}'] },
  { mark: 'set f = 4', text: ['对，9 次。现在给它多一个页框：', 'set f = 4', '页框从 3 个变成 4 个，缺页次数会怎样？{? 变少 | 一样 | *变多}'] },
  { mark: 'goal g', text: ['这就是 Belady 异常：FIFO 下页框多了，缺页反而可能更多。你自己找一找：', 'let g = 3 拨 1..6', `let r2 = paging(${TALK_REFS}, frames=g, algo=fifo)`, '页框数 {g}，缺页 {r2.faults} 次。', 'goal g > 3 and r2.faults > 9 => "页框比 3 个多，缺页反而更多了"'] },
];
function talkReply({ said, conv, isSystem }) {
  const mine = conv.filter((t) => t.role === 'assistant').map((t) => textOf(t.content));
  const lines = (a) => `${a.join('\n')}\n`;
  // 重写：老师常把整轮原样再写一遍，上一次带了 memo 块就照样再带（页面不该再执行一次）
  const memo = ['```board memo', 'review id=R3 result=过 basis=say', '```'];
  if (isSystem && /看不懂/.test(said)) return { kind: 'talk-fix', text: lines(['（模拟老师）我改一下这一轮。', '先算个简单的：$2 + 3 =$ {2 + 3?}', ...(mine.at(-1)?.includes('review id=R3') ? memo : [])]) };
  if (!isSystem && /测试\s*[:：]?\s*写错带记/.test(said)) return { kind: 'talk-broken', text: lines(['（模拟老师）这一轮写错一行，还带一个 memo 块。', '这一行的值算不出来（画出来才看得出）：{6/0}', ...memo]) };
  // 「测试:除零」：一个能拨到 0 的量；学生拨到 0 以后旧行算不出来，老师下一轮写对了不该被退回
  if (!isSystem && /测试\s*[:：]?\s*除零/.test(said)) return { kind: 'talk', text: lines(['（模拟老师）拨一拨这个数：', 'let d = 1 拨 0..3', '6 除以 {d} 是 {6/d}，再加 1 呢？{6/d + 1?}']) };
  if (!isSystem && /测试\s*[:：]?\s*写错/.test(said)) return { kind: 'talk-broken', text: lines(['（模拟老师）这一轮故意写错一行，页面应该退回去让我重写。', '这一行用了没定义的名字：{nosuch?}']) };
  if (/不对/.test(said) && !/，对/.test(said)) return { kind: 'talk-hint', text: lines(['（模拟老师）不急。拨一拨上面的步数，一步一步数缺页的那几下：哪几步是缺页？']) };
  const next = TALK_STEPS.find((s) => !mine.some((m) => m.includes(s.mark)));
  if (next) return { kind: 'talk', text: lines(next.text) };
  return { kind: 'talk-more', text: lines(['（模拟老师）收到。想清楚了就选一个往下走：{? *接着往下 | 先停一停}']) };
}

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

// 样子页里三个样板的试手感演示（docs/superpowers/plans/2026-11-06-stage-base.md 第 12 个任务）：平衡二叉树、消元、拆句子；
// 第二轮又各加一段（树：插、转、回到、摘；整张矩阵：比、合计、并；同一句上：拉、折、拖、连线）。
// 不调用 Claude：每一段就是老师的一轮镜头指令，照老师看的说明（kit/src/stage/doc.js、types/*.js 的 doc）写——这一页也在验「照说明写就能演」。
// 开好 open、给一个挑战、做到了 / 做完了演预写的一句（@g1、@t.done）。学生的每一下照真的裁判走（和课堂里一样：拦不拦、圈不圈、
// 判成什么都是页面照老师写的 wrong= 办的）；裁判的结论（对不对、像哪种错、正确的是什么、这一下以后的事实）写在画面角上一小块，
// 只在这一页有，给人看裁判判成什么，不进课堂、不进说明。走偏以后页面只做老师事先允许的（淡淡圈一下、拦下），不替老师讲。
// 纯的部分（三段指令、一下 → 角上那一块的几行）不碰 DOM，有测试（tests/stage-feel.test.js）；createPanel 碰 DOM。

/**
 * 三段：title 菜单上的名字；how 这一段手指能怎么动（页面的说明，不是讲课：手势是舞台的写法，学生看不出来）；script 老师的一轮。
 * 树：托盘的 47 插进去以后失衡，学生拎结点转平。说明里没有「托盘插完了」的判断式（t avl 写下时就成立，挑战不收），
 * 所以第一个挑战借「多了一层」（t height=4：这棵树 3 层，47 落在 45 下面是第 4 层），插进去以前转一下不让做（wrong=block）——
 * 不然转一下也可能多出一层、把第一个挑战凑成；插进去以后再开成 wrong=mark undo=on（同一项再开一次是换掉它）。
 * 预写的行一行一行演，话要等读完：换开法、新挑战写在话前面，学生读到一半就动手也照新的办
 */
export const FEELS = {
  avl: {
    title: '平衡二叉树',
    how: '托盘里的数拖进树 = 插入（页面从根比下去）；结点拖到它的父亲上 = 在父亲那里转',
    script: `tree t = 30 20 40 10 25 _ 45 tray="47"
bf t
say "结点角上的小字是平衡因子。按住托盘里的 47，拖进树里。"
open t insert
open t rotate wrong=block
goal g1 "把 47 拖进树" when="t height=4"
@g1 open t rotate wrong=mark undo=on
@g1 goal g2 "把树转平" when="t avl"
@g1 say "失衡了。按住一个结点拖到它的父亲上，就在父亲那里转一下。"
@t.done say "平了。每个结点的平衡因子又都在 -1 到 1 之间。"`,
  },
  elim: {
    title: '消元',
    how: '一行左边的把手拖到另一行上 = 倍加（弹出键盘写倍数）；拖到行号上 = 对调；点行号 = 倍乘',
    script: `matrix M = 1 2 0 | 2 / 2 2 -4 | 2 / 0 0 -2 | -2
say "把这个增广矩阵消成阶梯形：按住一行左边的把手，拖到另一行上。"
open M rowop wrong=mark undo=on
goal g1 "把 M 消成阶梯形" when="M stairs"
@M.done say "成了阶梯形：每一行第一个不是 0 的数，一行比一行靠右。"`,
  },
  parse: {
    title: '拆句子',
    how: '从一个词拉到另一个词（只要一个词就点它），松手再点成分',
    script: `sentence s = "The man who lives next door is a doctor." key="[S The man [RC who lives next door]] [V is] [P a doctor]."
say "拆这一句：按住一个词拉到另一个词，松手再点它是什么成分。"
open s mark wrong=mark undo=on
goal g1 "拉出主语、谓语、表语，再拉出主语里的从句" when="s parsed"
@s.right say "对。接着拉别的成分。"
@s.done fold s.3-6
@s.done say "拆完了。从句折起来，主干就是 The man is a doctor."`,
  },
  // —— 第二轮（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 13 节「在 iPad 上看」）：这一轮的手感 ——
  // 树：二叉排序树按中序排（插入只挪右边、旋转只上下移）。80 插进来 60 失衡（RR）；转错了点「回到插入后」（keep … after=insert 页面替老师存），
  // 转平以后换成摘叶子（open t pluck：点里面的结点只晃一下）。挑战一层套一层（@g1 → @g2 → @g3，最多三层），每层先换开法、出新挑战，话写在最后
  bst: {
    title: '树：插、转、回到、摘',
    how: '托盘里的数拖进树 = 插入；结点拖到父亲上 = 在父亲那里转；转错了点右上角「回到插入后」；转平以后点叶子 = 摘掉',
    script: `tree t = 40 20 60 10 30 _ 70 tray="80"
bf t
say "这棵树按中序排：从左往右读就是从小到大。按住托盘里的 80，拖进树里。"
keep t "插入后" after=insert
open t insert
goal g1 "把 80 拖进树" when="tray(t) = 0"
@g1 open t rotate wrong=mark
@g1 open t back="插入后"
@g1 goal g2 "把树转平" when="t avl"
@g1 say "失衡了。按住一个结点拖到它的父亲上转一下；转错了点「回到插入后」。"
@g2 close t rotate
@g2 open t pluck
@g2 goal g3 "摘一片叶子，树还是平的" when="count(t) = 6, t avl"
@g2 say "平了。再点一片叶子摘掉，看它还平不平。"
@g3 say "摘完还是平的：每个结点的平衡因子都在 -1 到 1 之间。"`,
  },
  // 矩阵：整张当把手（每张上面贴着名字）。AB 拖到 BA 上逐格比（两张都不变，不一样的格闪），再点出 BA 里不一样的格（ask pick，答对演 @ask.right，圈收掉）；
  // 换成放进合计（AB、BA 都拖进 Sum）；合计好了出 X = 2A、Y = −3A 并同类项（X 拿下舞台）。不收起 AB、BA：藏起来的地方空着（舞台不往上挪），竖屏中间一大块空
  whole: {
    title: '整张矩阵：比、合计、并',
    how: '按住一张矩阵的括号拖到另一张上：逐格比 / 放进合计 / 并同类项；点格子 = 点出来，再点「点好了」',
    script: `matrix A = 1 2 / 0 1
matrix B = 1 0 / 3 1 beside=A
matrix AB = {A B}
matrix BA = {B A} beside=AB
matrix Sum = collect
label na A "A" side=above tone=key
label nb B "B" side=above tone=key
label nab AB "AB" side=above tone=key
label nba BA "BA" side=above tone=key
label nsum Sum "合计" side=above tone=key
say "AB 和 BA 一样吗？按住 AB 的括号，拖到 BA 上逐格比。"
open AB compare
@ask.right unpick
@ask.right close AB compare
@ask.right open AB put
@ask.right open BA put
@ask.right goal g1 "把 AB 和 BA 都放进合计" when="Sum.1,1 = 8"
@ask.right say "对，换了先后就不一样。把 AB、BA 都拖进合计。"
@g1 matrix X = {2 A}
@g1 matrix Y = {-3 A} beside=X
@g1 label nx X "X" side=above tone=key
@g1 label ny Y "Y" side=above tone=key
@g1 open X merge
@g1 goal g2 "把 2A 和 −3A 并成一项" when="Y.1,1 = -1"
@g1 say "AB、BA 并不成一项。X、Y 是同一个 A 的倍数：把 X 拖到 Y 上。"
@g2 say "2A − 3A 并成了 −A：同一个矩阵的倍数才能并。"
ask pick BA "比完以后：BA 里哪几格和 AB 不一样？都点出来" button="点好了" expect="BA.1,1 BA.2,2"`,
  },
  // —— 三科铺开（一排格子懂排序，docs/superpowers/specs/2026-11-10-stage-rollout-rulings.md）：学生自己做希尔的三趟 ——
  // 老师写明在做哪种排序（sort a shell d=5），学生按住一张拖（open a move）：每一下页面照王道的代码判，换到别的组的那一下淡淡圈着。
  // 一趟做完（隔 d 的每条链都递增）出下一趟：隔 3 时每组下到自己的一排，在一排里拖到两张之间是沿这一组插进去；最后一趟隔 1 就是直接插入。
  // 贴的字里的 {moves(a)}、{inv(a)} 是页面数的量，学生每动一下跟着变
  shell: {
    title: '希尔排序：自己做三趟',
    how: '按住一张牌拖：放到另一张上 = 两张对调；放到两张之间 = 插进去（同组里中间的各让一格）',
    script: `array a = 49 38 65 97 76 13 27 49′ 55 04
group a stride=5
sort a shell d=5
label n a "让了 {moves(a)} 格，还有 {inv(a)} 对前大后小" side=below tone=note
say "同色的是一组（隔 5 格）。每组里小的要在前面：按住一张牌，拖到同组的另一张上。"
open a move wrong=mark undo=on
goal g1 "隔 5 的每一组都排好" when="a chains=5"
@g1 group a stride=3
@g1 sort a shell d=3
@g1 split a
@g1 goal g2 "隔 3 的每一组都排好" when="a chains=3"
@g1 say "再来一趟，隔 3：每组下到自己的一排。按住一张拖到同一排的两张之间，就是插进去。"
@g2 merge a
@g2 group a stride=1
@g2 sort a shell d=1
@g2 goal g3 "最后一趟：整排排好" when="a sorted"
@g2 say "最后一趟隔 1，就是直接插入：把不在位的牌拖到它该在的两张之间。"
@g3 say "排好了。三趟一共让了 {moves(a)} 格（直接插入要让 27 格）。"`,
  },
  // 句子：同一句上开着 mark、fold、move（拉括号是在词上滑、折是点、挪是按住 0.35 秒再拖，每一下只认成一种）；拉错了点括号上的 ✕ 收掉。
  // 定语从句被隔开了（who 离它修饰的 man 很远）：拆对了出 who 右上角的钩（open s.7 refer，照 links= 判），连对了按住从句的括号拖回 man 后面
  // （s span … = RC 判挪到了没有），再点括号折起来看主干
  hands: {
    title: '同一句上：拉、折、拖、连线',
    how: '在词上滑 = 拉括号（一个词就在它上面滑一下，松手点成分）；括号上的 ✕ = 收掉；点括号 = 折起来；按住括号一会儿再拖 = 整段挪；who 右上角的钩 = 拉线',
    script: `sentence s = "A man came into the room who was wearing a red hat." key="[S A man] [V came] into the room [RC who was wearing a red hat]." links="who -> s.2"
say "先拆这一句：从一个词滑到另一个词，松手点成分；拉错了点括号上的 ✕。"
open s mark wrong=mark
open s fold
open s move
goal g1 "拉出主语、谓语和从句" when="s parsed"
@g1 open s.7 refer
@g1 goal g2 "从 who 右上角的钩拉线，连到它指的词" when="s linked"
@g1 say "对。who 指的是谁？从它右上角的钩拉一条线过去。"
@g2 goal g3 "把从句挪回它修饰的词后面" when="s span s.3-8 = RC"
@g2 say "连对了。按住从句的括号，拖到 man 后面。"
@g3 say "从句回到 man 后面就好读了。点它的括号折起来，看主干。"`,
  },
};

// 老师在 open 那一行定的走偏怎么办（画面上看得到的那一下）
const POLICY = {
  block: '没让做，弹回去了（wrong=block）',
  mark: '照做了，那一处淡淡圈了一下（wrong=mark）',
  quiet: '照做了，只记下（wrong=quiet）',
};

/**
 * 学生的一下（舞台交给 onAct 的 act：src 那一行、verdict 裁判的结论、facts 这一下以后的事实、blocked / marked）→ 角上那一块的一条：
 * { tone: 'right' | 'wrong' | 'cant' | 'none' | 'undo', head（做了什么）, src（翻成的那一行）, verdict（一句结论）, lines: [[标签, 话]] }。
 * 只照裁判给的写，不加一句页面自己的判断
 */
export function refereeEntry(act) {
  if (!act) return null;
  if (act.type === 'undo') return { tone: 'undo', head: '撤回了上一下', src: act.src || '', verdict: '舞台退回去了', lines: [] };
  // ask pick：交上来的几样照页面和 expect 比的写（一样、多点了、漏了），没写 expect 页面不判
  if (act.type === 'pick') {
    const head = `点了 ${(act.refs || []).join('、')}`;
    const lines = [...(act.extra?.length ? [['多点了', act.extra.join('、')]] : []), ...(act.missing?.length ? [['漏了', act.missing.join('、')]] : [])];
    if (act.expected == null) return { tone: 'none', head, src: '', verdict: '页面不判这一下', lines };
    return { tone: act.same === true ? 'right' : act.same === false ? 'wrong' : 'none', head, src: '', verdict: act.same === true ? '和预期的一样' : act.same === false ? '和预期的不一样' : '页面比不了', lines };
  }
  const v = act.verdict;
  const src = act.src || '';
  const facts = (act.facts || []).filter(Boolean);
  const after = facts.length ? [['之后', facts.join('；')]] : [];
  if (!v) return { tone: 'none', head: src || '动了一下', src: '', verdict: '页面不判这一下', lines: after };
  if (act.failed) return { tone: 'none', head: v.why || src, src, verdict: '页面这一下没判成（照做了）', lines: after };
  if (v.legal === false) return { tone: 'cant', head: src, src: '', verdict: '做不到', lines: [['为什么', v.why || '这一下做不到'], ['画面', '没演，弹回去了']] };
  const head = v.why || src;
  if (v.right === true) return { tone: 'right', head, src, verdict: '是正确的下一步', lines: after };
  if (v.right !== false) return { tone: 'none', head, src, verdict: '页面不判对错', lines: after };
  const how = act.blocked ? POLICY.block : act.marked ? POLICY.mark : POLICY.quiet;
  return {
    tone: 'wrong', head, src, verdict: '不是正确的下一步',
    lines: [...(v.misread ? [['像是', v.misread]] : []), ...(v.next ? [['正确的', v.next]] : []), ['画面', how], ...(act.blocked ? [] : after)],
  };
}

/**
 * 挑战做到了、东西做完了（舞台的 onGoal / onDone）→ 角上那一块的一条。只占一行（演了几行预写跟在后面）：
 * 它们排在引出它们的那一下下面，一组要在竖屏那一条里放得下
 */
const reactedText = (n) => (n ? `马上演了老师预写的 ${n} 行` : '');
export function goalEntry(goals, { reacted = 0 } = {}) {
  return { tone: 'goal', head: `做到了挑战「${goals.map((g) => g.text).join('」「')}」`, src: '', verdict: reactedText(reacted), lines: [] };
}
export function doneEntry({ reacted = 0 } = {}) {
  return { tone: 'goal', head: '做完了：页面算出没有下一步了', src: '', verdict: reactedText(reacted), lines: [] };
}

/**
 * 演一段：开好舞台、接上角上那一块。stage：一块新舞台（main.js 的 fresh 造的）；key：FEELS 里的哪一段；panel：createPanel 的结果。
 * play 不替这一轮挂「给个提示」（这一页没有老师接）；挑战做到、做完了时预写的行舞台自己演
 */
export async function feelLesson(stage, key, { panel }) {
  const f = FEELS[key];
  if (!f) throw new Error(`没有「${key}」这一段`);
  panel.start(f);
  // 撤一步时舞台照 log 瞬间重放（instant），那时又「做到」一次的不算
  stage.onGoal = (ids, { by, instant, reacted }) => {
    if (instant || by !== 'student') return;
    panel.add(goalEntry(ids.map((id) => stage.scene.goals.get(id)).filter(Boolean), { reacted }));
  };
  stage.onDone = (ids, { by, instant, reacted }) => {
    if (instant || by !== 'student') return;
    panel.add(doneEntry({ reacted }));
  };
  const r = await stage.play(f.script);
  // 照说明写的应该一行不落；落了就写在角上（tests/stage-feel.test.js 守着，不该出现）。照演了、可写错了的（kept）另写一条
  const skipped = r.errors.filter((e) => !e.kept), kept = r.errors.filter((e) => e.kept);
  if (skipped.length) panel.add({ tone: 'cant', head: '有几行没演', src: '', verdict: '', lines: skipped.map((e) => [`第 ${e.line} 行`, `${e.src}：${e.error}`]) });
  if (kept.length) panel.add({ tone: 'cant', head: '有几行照演了、可写错了', src: '', verdict: '', lines: kept.map((e) => [`第 ${e.line} 行`, `${e.src}：${e.error}`]) });
  return r;
}

// —— 角上那一块（碰 DOM）——
const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };
const MARK = { right: '✓', wrong: '✗', cant: '✕', none: '·', undo: '↶', goal: '★' };
const KEEP = 12; // 最多留几条（新的在上面）

/** 角上那一块：root 是页面上的 <aside>；onRestart 点「重来」 */
export function createPanel(root, { onRestart } = {}) {
  root.replaceChildren();
  const head = el('header', 'f-head', root);
  const title = el('b', 'f-title', head);
  const again = el('button', 'f-again', head, '重来');
  again.type = 'button';
  again.addEventListener('click', () => onRestart?.());
  const how = el('p', 'f-how', root);
  const list = el('ol', 'f-log', root);
  const empty = () => { list.replaceChildren(); el('li', 'f-empty', list, '还没动。每动一下，这里写裁判判成什么。'); };
  // 一下和它引出的（做到挑战、做完了）排成一组：新的一下在最上面，同一组里照先后
  let group = null;
  return {
    start(f) {
      title.textContent = `裁判怎么判的 · ${f.title}`;
      how.textContent = `怎么动：${f.how}`;
      empty();
      root.hidden = false;
    },
    add(entry) {
      if (!entry) return;
      list.querySelector('.f-empty')?.remove();
      const follow = entry.tone === 'goal' && group?.isConnected;
      if (!follow) list.querySelectorAll('.is-new').forEach((n) => n.classList.remove('is-new'));
      const li = el('li', `f-item is-${entry.tone} is-new${follow ? ' is-follow' : ''}`, null);
      const top = el('div', 'f-top', li);
      el('span', 'f-mark', top, MARK[entry.tone] || '·');
      el('span', 'f-what', top, entry.head);
      if (entry.verdict) el('span', 'f-verdict', top, entry.verdict);
      if (entry.src && entry.src !== entry.head) el('code', 'f-src', li, entry.src);
      for (const [k, t] of entry.lines) {
        const row = el('div', 'f-line', li);
        el('span', 'f-k', row, k);
        el('span', 'f-t', row, t);
      }
      if (follow) {
        let last = group;
        while (last.nextElementSibling?.classList.contains('is-follow')) last = last.nextElementSibling;
        last.after(li);
      } else { list.prepend(li); group = li; }
      while (list.children.length > KEEP) list.lastChild.remove();
      list.scrollTop = 0;
    },
    hide() { root.hidden = true; },
  };
}

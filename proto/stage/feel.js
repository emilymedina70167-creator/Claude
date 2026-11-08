// 样子页里三个样板的试手感演示（docs/superpowers/plans/2026-11-06-stage-base.md 第 12 个任务）：平衡二叉树、消元、拆句子。
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
  // 照说明写的应该一行不落；落了就写在角上（tests/stage-feel.test.js 守着，不该出现）
  if (r.errors.length) panel.add({ tone: 'cant', head: '有几行没演', src: '', verdict: '', lines: r.errors.map((e) => [`第 ${e.line} 行`, `${e.src}：${e.error}`]) });
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

// 舞台课的模拟老师（?dev：本地、e2e 用，不调用 Claude）：照第几轮回一段镜头指令，学生点对点错都接得上；
// 第二轮带一个 memo 块（看记忆写进去）、故意写错一行（看页面跳过、下一轮告诉老师）、两句话（话留在画面上）；
// 第三轮是活的舞台：开放一排格子让学生拖（能撤一步）、一个挑战、做到了预写的一句和下一问（先不叫老师）；第四轮以「接着」结尾（提前想好下一轮）；
// 第五轮一棵树交给学生插、存一个「开始」（学生那边一个「回到开始」按钮）、先猜插了以后哪几个会变（ask pick），猜对了马上演 @ask.right 的一句
// （树还没插完，学生手上还有事，先不叫老师，页面替它挂「给个提示」）；第六轮和第四轮一样，之后一直重复它；下课回一段小结和整理单
const DONE = () => `say "（模拟老师讲完了，可以点右上角「下课」。）"
ask next "" button="好"`;
const TURNS = [
  () => `array a = 7 10 13 16 19 29 32 33 37 41 43
array k = 33
label kt k.1 "要找的" side=left tone=note
say "在这排里找 {k.1}。先翻正中间那一格。"
ptr mid a.6
compare k.1 a.6
ask tap a "{k.1} 还可能在哪一边？点那一边的一格。" expect=a.9`,
  (last) => `${/点对了/.test(last) ? 'say "对，在右边。"' : 'say "再看一眼：{k.1} 比 {a.6} 大。"'}
dim a.1-6
say "灰掉的这一半不用再看了。"
swap a.1
cover a.7-11
ask value "剩下几格？" answer=5

\`\`\`\`board memo
note text="折半查找：第一次就能说出往哪边找" basis=S1
\`\`\`\``,
  () => `say "好。翻开中间那一格。"
uncover a.9
ptr mid a.9
say "翻开是 {a.9}。先做一件小事：把下面这一排拖成从小到大。"
array b = 3 1 2
open b undo=on
goal g1 "把下面这一排拖成从小到大" when="b sorted"
@g1 say "排好了！"
@g1 ask say "回到上面：接下来往哪边找？为什么？"`,
  DONE,
  () => `tree t = 30 20 40 10 25 _ 45 tray="47"
keep t "开始"
open t insert
open t back="开始"
say "再看一棵平衡二叉树。先别插，猜一猜。"
@ask.right say "对，就是这三个。"
ask pick t "把 47 插进去以后，哪几个结点的平衡因子会变？点出来。" button="猜好了" expect="t.45 t.40 t.30"`,
  DONE,
];

// 学生说「测试:分幕」：开新的一幕（scene，主线第六轮；e2e 的 stage 段看幕条、回看、刷新、报告里的几幕）
const SCENE = `scene "第二段" keep=t
label k t "重点：插进去以后从下往上看平衡因子" side=below tone=key
say "新的一段：前面的放在幕条里了，点上面的①能翻回去看。"
ask next "看好了点这里" button="看好了"`;

// 学生说「测试:预览」：模拟老师先摆一幕再写 preview（第八轮：页面排好把字画的版面交回，马上再叫老师）；交回来的那一条里有 [预览]，接着讲
const PREVIEW = `array a = 5 3 8 1
place a main
say "先摆一下，看看排成什么样。"
preview`;
const AFTER_PREVIEW = `say "排好了，接着讲。"
ask next "看好了点这里" button="看好了"`;

const END = `say "那今天就到这里。"
ask end "今天先到这里？"`;

const CLOSING = `这节课学了折半查找：每次只翻剩下这一段的正中间，比一次就排除一半。
第一次就能说出往哪边找；数剩下几格时还要再练。

\`\`\`\`board memo
position next="折半查找的判定树和 ASL"
\`\`\`\``;

export function stageMock({ pace = 60 } = {}) {
  return async (messages, opts = {}) => {
    const last = String(messages.at(-1)?.content || '');
    const k = messages.filter((m) => m.role === 'assistant').length;
    // 学生说「测试:下课」：模拟老师照说明把「下课吗？」递给学生（ask end，e2e 的 stage 段）
    const text = /舞台课：小结写成几行字/.test(last) ? CLOSING : /学生说：「测试:下课」/.test(last) ? END : /学生说：「测试:分幕」/.test(last) ? SCENE : /学生说：「测试:预览」/.test(last) ? PREVIEW : /\[预览\]/.test(last) ? AFTER_PREVIEW : TURNS[Math.min(k, TURNS.length - 1)](last);
    // ?dev&think=4：模拟老师先想 4 秒再写（真课出第一个字前要等十几秒：看等的那一阵画面上是什么）
    const lag = typeof location !== 'undefined' && /[?&]think=(\d+)/.test(location.search) ? Number(location.search.match(/[?&]think=(\d+)/)[1]) * 1000 : 300;
    await new Promise((r) => setTimeout(r, lag));
    let out = '';
    for (const line of text.split('\n')) {
      out += `${line}\n`;
      opts.onText?.({ text: out });
      if (pace) await new Promise((r) => setTimeout(r, pace));
    }
    return { text, modelApplied: 'mock' };
  };
}

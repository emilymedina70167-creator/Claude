// 舞台课的模拟老师（?dev：本地、e2e 用，不调用 Claude）：照第几轮回一段镜头指令，学生点对点错都接得上；
// 第二轮带一个 memo 块（看记忆写进去）、故意写错一行（看页面跳过、下一轮告诉老师）、两句话（话留在画面上）；
// 第三轮是活的舞台：开放一排格子让学生拖、一个挑战、做到了预写的一句和下一问（先不叫老师）；第四轮以「接着」结尾（提前想好下一轮）；下课回一段小结和整理单
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
open b
goal g1 "把下面这一排拖成从小到大" when="b sorted"
@g1 say "排好了！"
@g1 ask say "回到上面：接下来往哪边找？为什么？"`,
  () => `say "（模拟老师讲完了，可以点右上角「下课」。）"
ask next "" button="好"`,
];

const CLOSING = `这节课学了折半查找：每次只翻剩下这一段的正中间，比一次就排除一半。
第一次就能说出往哪边找；数剩下几格时还要再练。

\`\`\`\`board memo
position next="折半查找的判定树和 ASL"
\`\`\`\``;

export function stageMock({ pace = 60 } = {}) {
  return async (messages, opts = {}) => {
    const last = String(messages.at(-1)?.content || '');
    const k = messages.filter((m) => m.role === 'assistant').length;
    const text = /舞台课：小结写成几行字/.test(last) ? CLOSING : TURNS[Math.min(k, TURNS.length - 1)](last);
    await new Promise((r) => setTimeout(r, 300));
    let out = '';
    for (const line of text.split('\n')) {
      out += `${line}\n`;
      opts.onText?.({ text: out });
      if (pace) await new Promise((r) => setTimeout(r, pace));
    }
    return { text, modelApplied: 'mock' };
  };
}

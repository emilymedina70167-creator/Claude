// 舞台的样子（A 段，docs/stage-plan.md）：希尔排序这一段按剧本演，不调用 Claude。
// 每一轮就是以后老师当场写的一轮镜头指令（kit/src/stage/script.js 的写法），学生点了什么决定下一轮演哪段——
// 剧本里「答错了怎么演」是这里替老师写好的，真上课时是老师看着学生的操作当场写（live.js）

/** 照剧本演一遍；alive() 变成假（换了一节、点了重来）就停 */
export async function scriptedLesson(stage, alive) {
  const play = async (src) => { if (!alive()) throw new Error('stop'); const r = await stage.play(src); if (r.errors.length) console.warn('没演的行', r.errors); return r.act; };

  // 第一轮：一排数，先不讲规则，只让人注意那两个 49
  await play(`
    array a = 49 38 65 97 76 13 27 49′ 55 04
    say "这一排数要排成从小到大。先留意这两个：{a.1} 和 {a.8}，一样大。"
    glow a.1 a.8
    wait 900
    unglow a.1 a.8
    say "我们先不整排比较，只看「隔开的」两个数。"
    lift a.1
    hop a.1 -> a.6 color=g1 label="隔 5 个"
    drop a.1
    paint a.1 a.6 g1
    say "从 {a.1} 往后数 5 个，落在 {a.6}。它俩算一组。"
    lift a.2
  `);
  const t1 = await play(`ask tap a "那 {a.2} 和谁一组？点一下。"`);

  // 第二轮：看点的是哪一格
  if (t1.slot === 7) {
    await play(`
      drop a.2
      link a.2 a.7 g2
      & paint a.2 a.7 g2
      say "对，隔 5 个就是 {a.7}。"
    `);
  } else {
    await play(`
      pulse a.${t1.slot}
      say "你点的是 {a.${t1.slot}}。我们一起数，从 {a.2} 往后跳 5 下——"
      drop a.2
      hop a.2 -> a.7 color=g2
      paint a.2 a.7 g2
      say "落在 {a.7}。所以 {a.2} 和 {a.7} 一组。"
    `);
  }

  // 第三轮：剩下的一口气配完，数一数几组；把「隔几个」交给学生拨
  await play(`
    unlabel hop:a1
    say "剩下的也这样配对。"
    link a.3 a.8 g3
    & paint a.3 a.8 g3
    link a.4 a.9 g4
    & paint a.4 a.9 g4
    link a.5 a.10 g5
    & paint a.5 a.10 g5
    say "隔 5 个配对，一共配出 5 组。这个「隔几个」，我们叫它 $d$。"
    dial d = 5 range=1-5 at=a
    label n dial:d "{d} 组" side=right tone=note
    group a stride=d
  `);
  await play(`ask next "拨一下 $d$，看看组怎么跟着变。看出规律了点下面。" button="看出来了"`);
  await play(`
    say "组数就等于 $d$。每一组的头一个数，就是第 1 到第 $d$ 位。"
    wait 400
    set d 5
    unlabel n
    unlabel dial:d
  `);

  // 第四轮：一趟只做一件事——每组在自己组里排好。排之前先让学生猜那两个 49
  await play(`
    say "希尔排序这一趟只做一件事：每一组在自己组里排好，别的组不管。"
    split a
    say "排之前先猜：五组都排好以后，{a#1} 和 {a#8} 谁在前面？"
    glow a#1 a#8
  `);
  const guess = await play(`ask tap a#1 a#8 "点你觉得会在前面的那个。"`);

  // 第五轮：学生排一组，页面排其余几组；49′ 越过 49 的那一下放慢
  await play(`
    unglow a#1 a#8
    label guess a#${guess.key} "你猜它在前" side=left tone=note
    say "好，先记着。蓝色这一组你来排：按住小的那个，拖到前面。"
  `);
  await play(`ask drag a#1 a#6`);
  await play(`
    unlabel guess
    say "蓝色排好了。剩下四组我来排。"
    swap a#2 a#7
    say "看绿色这一组。"
    glow a#8
    swap a#3 a#8
    unglow a#8
    swap a#4 a#9
    & swap a#5 a#10
    merge a
    unlink a
    glow a#1 a#8
    say "排完了。现在 {a#8} 在第 3 位，{a#1} 在第 6 位。"
  `);
  const now = await play(`ask tap a#1 a#8 "排之前是 {a#1} 在前。现在谁在前？"`);

  // 第六轮：学生说出「换了先后」，再给这个现象起名字
  const same = guess.key === 8;
  if (now.key === 8) {
    await play(`say "对。${same ? '和你猜的一样。' : '和你刚才猜的不一样。'}"`);
  } else {
    await play(`
      pulse a#8
      say "再看一眼位置号：{a#8} 在第 3 位，{a#1} 在第 6 位，3 在 6 前面。所以现在是 {a#8} 在前。"
    `);
  }
  await play(`
    label flip a#1 a#8 "一样大，先后却换了" side=below tone=note
    say "两个一样大的数，排完以后先后对调了。这样的排序，就叫 [不稳定]。"
    fly say.1 -> key a#8 a#1
    unglow a#1 a#8
  `);
  await play(`ask next "" button="再看一遍"`);
}

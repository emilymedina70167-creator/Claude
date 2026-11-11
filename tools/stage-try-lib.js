// 舞台试演工具（tools/stage-try.mjs）不碰浏览器的那一半：读一幕的文件、把学生的一行翻成手势的输入、把演的结果写成报告。
// 纯函数，有测试（tests/stage-try.test.js）。
//
// 一幕的文件：普通的行是老师的镜头指令（连着的几行是一段，照真上课那样一段一段交给舞台）；
// 「学生:」开头的一行是学生的一下：直接动画面（write / swap / move / vec / mul 走那种东西自己的画法；
// rotate / insert / rowop / mark / fold 走通用手势，undo 是「撤一步」，dial 是拨数器），
// 或者回答正在等的那一问（tap / drag / value / say / next，照真的手指和输入框）。
//
// 学生的行写成指令的样子（rotate t.30 left），手指做的却是手势（把 30 的右孩子拖到 30 上）：这里先翻成手势的输入，
// 页面那一半再按东西现在的样子找到手指按的把手、走规则文件里的手势表（gestures.js 的 gestureAct）和真的 openDone——
// 量出来的才是真的手指那一条路（裁判、弹回去、记事实、告诉课堂循环）。
//
// 第二轮的写法（pick、refer、unrefer、unmark、move、unfold、delete、compare、put、merge、back、按格的 value）是真的触摸：
// 同一处开着几种按法时手指怎么按才认成哪一种（点、滑、按住 0.35 秒再拖），只有 CDP 的触摸走得到 pointer.js 的 choosePress；
// 页面那一半只找手指按哪儿、松在哪儿（照 pointer.js 挑把手的办法核过手指真按得到），按、滑、按住、松手由外面照触摸做。

const DO = ['write', 'swap', 'move', 'vec', 'mul', 'rotate', 'insert', 'rowop', 'mark', 'fold', 'undo', 'dial',
  'refer', 'unrefer', 'unmark', 'unfold', 'delete', 'compare', 'put', 'merge', 'back'];
const ANSWER = ['tap', 'drag', 'value', 'pick', 'say', 'next'];
/** 走通用手势（或撤一步、拨数器）的那几种：parseTry 给它们带上 gesture */
const GESTURE = new Set(['rotate', 'insert', 'rowop', 'mark', 'fold', 'undo', 'dial']);
/**
 * 第二轮的写法：真的手指（tools/stage-try.mjs 照 CDP 的触摸点、滑、按住再拖），parseTry 也给它们带上 gesture（翻好的手势输入）。
 * move 两条路都有：开着 open s move 的照真的手指按住括号或词拖到两个词之间，只开了 open s（拖词）的照第一轮的画法
 */
export const HANDS = new Set(['pick', 'refer', 'unrefer', 'unmark', 'move', 'unfold', 'delete', 'compare', 'put', 'merge', 'back']);

/** 学生能写的（文件写错时报这一份；报告、说明里也照它） */
export const STUDENT_FORMS = [
  'write B.1,1 2（拨数器一格一格拨；open … input=keypad 时用键盘写）',
  'swap a#1 a#2', 'move s.7 after s.1', 'vec p u = 3 1', 'mul C.1,2',
  'rotate t.30 left（在 30 往左转 = 把 30 的右孩子拖到 30 上）',
  'insert t 47（托盘里的 47 拖进树）', 'insert t.45 right 47（拖到 45 右边的空位）',
  'rowop M r3 - 2r1（r1 的把手拖到 r3 上、倍数框写 -2）', 'rowop M r1 <-> r3（拖到行号上）', 'rowop M 3r2（点行号、写 3）',
  'mark s.2-4 V（从 s.2 拉到 s.4、点成分）', 'fold s.3-6（点这一段的括号）',
  'undo（撤一步）', 'dial k 3（拨数器拨到 3）',
  'refer s.23 -> s.15（从 s.23 的钩拉线松在 s.15 上；-> s.1-2 松在那道括号上，-> s 松在句子外框上）', 'unrefer s.23（点 s.23 连出去那条线上的 ✕）',
  'unmark s.21（点学生拉的那道括号上的 ✕）', 'move s.1-6 after s.11（open s move：按住这一段的括号 0.35 秒再拖到 s.11 后面；一个词就按住这个词；before s.1 是最前面）',
  'unfold s.5（点 s.5 所在的小方块）', 'delete t.7（open t pluck / delete：点 t.7）',
  'compare AB BA（按住 AB 的括号拖到 BA 上）', 'put AB Sum（拖进收集用的 Sum）', 'merge X Y（拖到 Y 上并同类项）', 'back t "插入后"（点「回到插入后」）',
  'tap a.7', 'drag a#1 a#6', 'value 4', 'value 1 n n(n-1)/2 / 0 1 n / 0 0 1（按格的那一问一格一格填，「 / 」分行）',
  'pick t.45 t.50（ask pick：照先后点这几个，再点「点好了」）', 'say 我不懂', 'next',
].join('、');

/** 一幕的文件 → 一步步：{ kind: 'teacher', src, line } | { kind: 'student', how, cmd, args, src, line, gesture? } */
export function parseTry(text) {
  const out = [];
  let cur = null; // 正在攒的老师段
  String(text ?? '').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = line.match(/^学生\s*[:：]\s*(\S+)\s*(.*)$/);
    if (!m) {
      if (cur) cur.lines.push(raw); else out.push(cur = { kind: 'teacher', lines: [raw], line: i + 1 });
      return;
    }
    cur = null;
    const cmd = m[1];
    const how = DO.includes(cmd) ? 'do' : ANSWER.includes(cmd) ? 'answer' : null;
    if (!how) throw new Error(`第 ${i + 1} 行「${line}」：学生能写的：${STUDENT_FORMS}`);
    const args = m[2].trim();
    // 翻不成手势的写法不让整个文件读不下去：错放在这一步上，试演到这一步报「没演上」
    out.push({ kind: 'student', how, cmd, args, src: line, line: i + 1, ...(GESTURE.has(cmd) || HANDS.has(cmd) ? { gesture: studentGesture(cmd, args) } : {}) });
  });
  return out.map((s) => (s.kind === 'teacher' ? { kind: 'teacher', src: s.lines.join('\n'), line: s.line } : s));
}

// —— 学生的一行 → 手势的输入（不看舞台：结点有没有那边的孩子、托盘里有没有这个数，页面那一半照现在的样子找）——

const objOf = (ref) => String(ref).match(/^[A-Za-z_]\w*/)?.[0] || null;
const isPart = (ref) => /^[A-Za-z_]\w*[.#]\S+$/.test(String(ref));
const DIRS = { left: 'left', right: 'right', 左: 'left', 右: 'right', 左旋: 'left', 右旋: 'right' };
const SIDES = { left: 'left', right: 'right', 左: 'left', 右: 'right' };
// 键盘上的减号、全角的斜线和括号：学生在倍数框里写的照普通的写法
const plain = (s) => String(s ?? '').replace(/[−–—]/g, '-').replace(/／/g, '/').replace(/（/g, '(').replace(/）/g, ')').trim();
// 一个倍数（3、-2、1/2、(1/2)、(-1/2)）规整成键盘上写的样子；不是倍数是 null
function coef(s) {
  const t = plain(s).replace(/[·*×]\s*$/, '').replace(/\s+/g, '');
  if (t === '') return '1';
  if (t === '-') return '-1';
  const m = t.match(/^(-?)\(?(-?\d+(?:\.\d+)?(?:\/\d+)?)\)?$/);
  if (!m) return null;
  let v = m[2];
  let neg = m[1] === '-';
  if (v.startsWith('-')) { neg = !neg; v = v.slice(1); }
  return `${neg ? '-' : ''}${v}`;
}
const bad = (error) => ({ error });

/**
 * 学生的一行（cmd + 后面的）→ 手势的输入：
 *   rotate { obj, action: 'rotate', at, dir }                      在 at 往 dir 转 = at 的另一边的孩子拖到 at 上
 *   insert { obj, action: 'insert', value } / { …, action: 'place', at, side, value }   托盘里的数拖进树 / 拖到某个空位
 *   rowop  { obj, action: 'rowop', op: 'add', from, to, value }     from 那一行的把手拖到 to 那一行上，倍数框写 value
 *          { …, op: 'swap', from, to }                             from 那一行的把手拖到 to 的行号上
 *          { …, op: 'scale', row, value }                          点 row 的行号，倍数框写 value
 *   mark   { obj, action: 'mark', span, role }                     从这一段的头一个词拉到最后一个词，点成分
 *   fold   { obj, action: 'fold', span }                           点这一段的括号（一个词：点这个词，折起它所在的最里层）
 *   undo   { undo: true }                                          点「撤一步」
 *   dial   { dial: 名字, value }                                    拨数器一格一格拨到 value
 * 写法本身翻不成一下手势的（一次转一型、一下做两步、列变换……）给 { error }，说清楚为什么
 */
export function studentGesture(cmd, args = '') {
  const a = plain(args);
  const w = a.split(/\s+/).filter(Boolean);
  if (cmd === 'undo') return a ? bad('undo 后面不写东西：学生点的是右上角「撤一步」') : { undo: true };
  if (cmd === 'dial') {
    const m = a.match(/^([A-Za-z_]\w*)\s*(?:=\s*)?(-?\d+(?:\.\d+)?)$/);
    return m ? { dial: m[1], value: Number(m[2]) } : bad('要写成 dial k 3（把拨数器 k 拨到 3）');
  }
  if (cmd === 'rotate') {
    if (!w.length || !isPart(w[0])) return bad('rotate 要写在哪个结点转：rotate t.30 left（在 30 往左转 = 把 30 的右孩子拖到 30 上）');
    const k = w[1];
    if (/^(LL|RR|LR|RL)$/i.test(k || '')) return bad(`手指一次转一下：写 left / right（${k.toUpperCase()} 型要转${/^(LR|RL)$/i.test(k) ? '两下：先在孩子那里转、再在根那里转，分两行写' : '一下：LL 是右旋、RR 是左旋'}）`);
    if (!DIRS[k] || w.length !== 2) return bad(`rotate 要写往哪边转：rotate ${w[0]} left（或 right）`);
    return { obj: objOf(w[0]), action: 'rotate', at: w[0], dir: DIRS[k] };
  }
  if (cmd === 'insert') {
    if (w.length === 2 && !isPart(w[0]) && objOf(w[0]) === w[0]) return { obj: w[0], action: 'insert', value: w[1] };
    if (w.length === 3 && isPart(w[0]) && SIDES[w[1]]) return { obj: objOf(w[0]), action: 'place', at: w[0], side: SIDES[w[1]], value: w[2] };
    return bad('要写成 insert t 47（托盘里的 47 拖进树）或 insert t.45 right 47（拖到 45 右边的空位）');
  }
  if (cmd === 'rowop') return rowopGesture(w[0], a.slice((w[0] || '').length).trim());
  if (cmd === 'mark') {
    const m = a.match(/^(\S+)\s+(.+)$/);
    if (!m || !isPart(m[1])) return bad('要写成 mark s.2-4 V（从 s.2 拉到 s.4，再点它是什么成分）');
    const role = m[2].trim().replace(/^["「“](.*)["」”]$/, '$1').trim();
    return role ? { obj: objOf(m[1]), action: 'mark', span: m[1], role } : bad('拉好一段还要点它是什么成分：mark s.2-4 V');
  }
  if (cmd === 'fold') {
    if (w.length !== 1 || !isPart(w[0])) return bad('要写成 fold s.3-6（点这一段的括号，折起来）');
    return { obj: objOf(w[0]), action: 'fold', span: w[0] };
  }
  return handsGesture(cmd, args, a, w);
}

// 第二轮的写法（真的手指）：一个部件、一段、两样东西的名字、一个存档点的名字
const one = (w, form) => (w.length === 1 && isPart(w[0]) ? null : bad(`要写成 ${form}`));
const NAME = /^[A-Za-z_]\w*$/;
/**
 * pick / refer / unrefer / unmark / move / unfold / delete / compare / put / merge / back → 手势的输入（页面那一半照它找手指按哪儿）：
 *   pick    { action: 'pick', refs }                       照先后点这几个部件，再点「点好了」（回答 ask pick）
 *   refer   { obj, action: 'refer', from, to }              从 from 的钩拉线，松在 to 上（一个词、一道括号的那一段、整句写东西的名字）
 *   unrefer { obj, action: 'unrefer', at }                  点 at 连出去那条线头上的 ✕
 *   unmark  { obj, action: 'unmark', span }                 点学生拉的那道括号上的 ✕
 *   move    { obj, action: 'move', span, where, at }        按住这一段的括号（一个词就按住它）0.35 秒再拖到 at 后面 / 前面（where: after / before；-> 是第一轮拖词的写法 to）
 *   unfold  { obj, action: 'unfold', at }                   点 at 所在的小方块
 *   delete  { obj, action: 'delete', at }                   点这个结点（open t pluck / delete）
 *   compare / put / merge { obj, action, to }               按住 obj 的括号拖到 to 上
 *   back    { obj, action: 'back', name }                   点「回到name」
 */
function handsGesture(cmd, raw, a, w) {
  if (cmd === 'pick') {
    if (!w.length || !w.every(isPart)) return bad('要写成 pick t.45 t.50（照先后点这几个部件，再点「点好了」）');
    return { action: 'pick', refs: w };
  }
  if (cmd === 'refer') {
    const m = a.match(/^(\S+)\s*(?:->|→)\s*(\S+)$/);
    if (!m || !isPart(m[1]) || !(isPart(m[2]) || NAME.test(m[2]))) return bad('要写成 refer s.23 -> s.15（从 s.23 的钩拉线松在 s.15 上；-> s.1-2 松在那道括号上，-> s 松在句子外框上）');
    if (objOf(m[2]) !== objOf(m[1])) return bad(`线只能连在同一句里：${m[1]} 和 ${m[2]} 不是同一句`);
    return { obj: objOf(m[1]), action: 'refer', from: m[1], to: m[2] };
  }
  if (cmd === 'unrefer') return one(w, 'unrefer s.23（点 s.23 连出去那条线上的 ✕）') || { obj: objOf(w[0]), action: 'unrefer', at: w[0] };
  if (cmd === 'unmark') return one(w, 'unmark s.21（点学生拉的那道括号上的 ✕）') || { obj: objOf(w[0]), action: 'unmark', span: w[0] };
  if (cmd === 'unfold') return one(w, 'unfold s.5（点 s.5 所在的小方块）') || { obj: objOf(w[0]), action: 'unfold', at: w[0] };
  if (cmd === 'delete') return one(w, 'delete t.7（点这个结点：open t pluck 摘叶子、open t delete 删哪个都行）') || { obj: objOf(w[0]), action: 'delete', at: w[0] };
  if (cmd === 'move') {
    const m = a.match(/^(\S+)\s+(?:(after|before)\s+(\S+)|(?:->|→)\s*(\S+))$/);
    if (!m || !isPart(m[1]) || !isPart(m[3] || m[4])) return bad('要写成 move s.1-6 after s.11（按住这一段的括号拖到 s.11 后面；before s.1 是最前面）');
    return { obj: objOf(m[1]), action: 'move', span: m[1], where: m[2] || 'to', at: m[3] || m[4] };
  }
  if (cmd === 'compare' || cmd === 'put' || cmd === 'merge') {
    const eg = { compare: 'compare AB BA（按住 AB 的括号拖到 BA 上逐格比）', put: 'put AB Sum（按住 AB 的括号拖进收集用的 Sum）', merge: 'merge X Y（按住 X 的括号拖到 Y 上并同类项）' }[cmd];
    if (w.length !== 2 || !w.every((x) => NAME.test(x))) return bad(`要写成 ${eg}：两样都写整张矩阵的名字`);
    if (w[0] === w[1]) return bad(`${w[0]} 拖不到自己身上`);
    return { obj: w[0], action: cmd, to: w[1] };
  }
  if (cmd === 'back') {
    // 存档点的名字照写的原样（不换全角括号、减号）
    const m = String(raw ?? '').trim().match(/^([A-Za-z_]\w*)\s+["「“](.+)["」”]$/);
    if (!m) return bad('要写成 back t "插入后"（学生点的是老师开的「回到插入后」按钮；不写名字的 back t 是老师的指令）');
    return { obj: m[1], action: 'back', name: m[2] };
  }
  return bad(`「${cmd}」不是手势`);
}

// rowop M r3 - 2r1 / r1 <-> r3 / 3r2：手指一下只做一步初等变换（拖一行的把手、点一个行号）
function rowopGesture(obj, op) {
  const form = 'rowop M r3 - 2r1（倍加）、rowop M r1 <-> r3（对调）、rowop M 3r2（倍乘）';
  if (!obj || objOf(obj) !== obj || !op) return bad(`要写成 ${form}`);
  if (op.includes(',')) return bad('手指一下只做一步：几步分成几行写（学生: rowop M r2 - 2r1，再一行 学生: rowop M r3 - r1）');
  if (/(^|[^a-z])c\d/i.test(op)) return bad('手指只拖得了行（行左边的把手、行号）：列变换学生做不了');
  const sw = op.match(/^r(\d+)\s*(?:<->|↔|<=>)\s*r(\d+)$/);
  if (sw) {
    const [i, j] = [Number(sw[1]), Number(sw[2])];
    return i === j ? bad(`r${i} 拖到自己的行号上什么也不换`) : { obj, action: 'rowop', op: 'swap', from: i, to: j };
  }
  // r2 = r2 - 3r1 → r2 - 3r1（左边是哪一行，右边就得从那一行起）
  let body = op;
  const eq = op.match(/^r(\d+)\s*=\s*(.+)$/);
  if (eq) body = eq[2].trim();
  // 倍乘：k r2、-r2、(1/2)r2、r2 / 3
  const div = body.match(/^r(\d+)\s*\/\s*(-?\d+)$/);
  if (div) {
    const d = div[2].startsWith('-') ? `-1/${div[2].slice(1)}` : `1/${div[2]}`;
    return sameRow(eq, Number(div[1])) || { obj, action: 'rowop', op: 'scale', row: Number(div[1]), value: d };
  }
  const sc = body.match(/^(.*?)\s*r(\d+)$/);
  if (sc && !/r/i.test(sc[1]) && coef(sc[1]) != null) {
    return sameRow(eq, Number(sc[2])) || { obj, action: 'rowop', op: 'scale', row: Number(sc[2]), value: coef(sc[1]) };
  }
  // 倍加：r3 - 2r1、r3 + (1/2)r1、r3 - 1/2 r1
  const ad = body.match(/^(.*?)r(\d+)\s*([+-])\s*(.*?)\s*r(\d+)$/);
  if (ad) {
    const [lead, to, sign, k, from] = [ad[1].trim(), Number(ad[2]), ad[3], ad[4], Number(ad[5])];
    if (lead) return bad(`手指一下做不了「${op}」：先点 r${to} 的行号乘 ${coef(lead) ?? lead}，再把 r${from} 的把手拖到 r${to} 上`);
    if (to === from) return bad(`r${from} 拖不到自己身上：倍加是把一行的把手拖到另一行上`);
    const c = coef(k);
    if (c == null) return bad(`倍数「${k}」不是数（写成 2、1/2、(1/2)）`);
    const neg = (sign === '-') !== c.startsWith('-');
    return sameRow(eq, to) || { obj, action: 'rowop', op: 'add', from, to, value: `${neg ? '-' : ''}${c.replace(/^-/, '')}` };
  }
  return bad(`读不懂「${op}」：要写成 ${form}`);
}
// r2 = r3 - r1 这种左右两边不是同一行的：手指做不出来
const sameRow = (eq, r) => (eq && Number(eq[1]) !== r ? bad(`「r${eq[1]} = …」右边要从 r${eq[1]} 起：手指只改被拖到的那一行`) : null);

const title = (s, k) => (s.kind === 'teacher' ? `第 ${k} 步：老师 第 ${s.line} 行起` : `第 ${k} 步：学生 第 ${s.line} 行 ${s.cmd}${s.args ? ` ${s.args}` : ''}`);
const block = (text) => String(text || '（空）').split('\n').map((l) => `    ${l}`).join('\n');

/** 演的结果 → 给助手看的报告（每个视口一节，每一步一小节） */
export function formatReport(r) {
  const out = [`# ${r.file}`];
  for (const v of r.views || []) {
    out.push('', `## ${v.tag}`);
    (v.steps || []).forEach((x, i) => {
      out.push('', `### ${title(x.step, i + 1)}`);
      if (x.step.kind === 'teacher') out.push(`演上了 ${x.played} 行`);
      if (x.did) out.push(`手指做的：${x.did}`);
      if (x.errors?.length) out.push('没演上的行：', ...x.errors.map((e) => `- 第 ${e.line} 行「${e.src}」${e.kept ? '（照演了）' : ''}：${e.error}`));
      if (x.blocked) out.push(`页面没让做（弹回去了）：${x.blocked}`);
      if (x.undone) out.push(`撤掉的那一下：${x.undone}`);
      out.push('舞台现在：', block(x.state));
      out.push('挑战：', ...(x.goals?.length ? x.goals.map((g) => `- ${g.id}「${g.text}」：${g.status}`) : ['- （没有）']));
      if (x.called) out.push(`页面叫了老师（${x.called.why}）：`, block(x.called.msg));
      else out.push('还没叫老师，攒着：', block(x.pending || '（没有攒着的）'));
      if (x.untouched) out.push(`没交给学生：${x.untouched}`);
      out.push('排版：', ...(x.issues?.length ? x.issues.map((p) => `- ${p.what}：${p.a}${p.b ? ` 和 ${p.b}` : ''}`) : ['- 没压着、没出屏幕']));
      if (x.shot) out.push(`截图：${x.shot}`);
    });
    if (v.stopped) out.push('', v.stopped);
  }
  return out.join('\n');
}

// —— 查「叫老师的那一条里必须有」（tools/stage-must.mjs，设计第 13 节的表）——
// 页面算出来的事实要真的到老师手上：查每一步叫老师时发过去的整条（called.msg），再查最后一步还攒着没发出去的那一段（pending）——
// 幕末尾学生最后几下没叫老师时，事实只在那里。前面某一步攒着过、后来没发出去又不在最后的，老师从没看到，不算

const plainRe = (re) => new RegExp(re.source, re.flags.replace(/[gy]/g, ''));
/** 一个视口的每一步里，哪几处有 re：[{ step（第几步，从 0 数）, where: 'called' | 'pending' }] */
export function mustHits(steps = [], re) {
  const r = plainRe(re);
  const out = [];
  steps.forEach((s, i) => { if (s?.called?.msg && r.test(s.called.msg)) out.push({ step: i, where: 'called' }); });
  const last = steps.at(-1);
  if (last?.pending && r.test(last.pending)) out.push({ step: steps.length - 1, where: 'pending' });
  return out;
}
/** 现状对得上 re 的那几步里，有挑战是「做到了」的（第几步）：做到过、现在不成立的不算 */
export function goalsMetWhere(steps = [], re) {
  const r = plainRe(re);
  return steps.flatMap((s, i) => (r.test(s?.state || '') && (s.goals || []).some((g) => g.status === '做到了') ? [i] : []));
}
// 同一行里两样都有（was 和「只圈了一半」写在同一下的那一行里，不是一个在上一下、一个在下一下）
const sameLine = (...parts) => new RegExp(`^${parts.map((p) => `(?=.*(?:${p}))`).join('')}.*$`, 'm');
const C = (re, what) => ({ re, what: what || String(re) });
const TREE = [C(/count\(\w+\) = \d+/), C(/tray\(\w+\) = \d+/), C(/height\(\w+\) = \d+/)];
const VERB = [C(sameLine('was', '只圈了一半'), '同一行里有 was 和「只圈了一半」'), C(sameLine('ensuring|help', '把非谓语当成了谓语'), '同一行里有 ensuring 或 help，和「把非谓语当成了谓语」')];
/**
 * 设计第 13 节的表：哪一幕（try 目录下的路径），叫老师的那一条里（或最后攒着的）必须有什么。一行写了一幕的，每一条那一幕都要有；
 * anyOf 的一组（E2 第 6 幕、分支 1，E3 第 8 幕：理想演法里 was initiated 在 E2 第 6 幕、to help 在 E3 第 8 幕、分支 1 两种都有），
 * 每一条这几幕里有一幕有就算（几幕都要在、都要跑完）。
 * noMetAt：现状对得上它的那几步，没有挑战是「做到了」（D2 第 5 幕：4 个结点时挑战不该打勾）
 */
export const MUST = [
  { files: ['L2/分支3.txt'], checks: [C(/rankA\(\w+\) = 1/), C(/rank\(\w+\) = 2/), C(/0 = −3/), C(/拨 \w+（/, '扫一遍拨数的那一行（拨 l（…）')] },
  { files: ['L2/幕5.txt'], checks: [C(/r\(A\) = \d/), C(/r\(A \| b\) = \d/), C(/无解/), C(/学生拨了 \S+：/, '拨数的路（学生拨了 …：）')] },
  { files: ['L2/幕4.txt'], checks: [C(/第 3 格该是 −4/)] },
  { files: ['D2/幕5.txt'], checks: TREE, noMetAt: { re: /树 \S+（4 个结点/, what: '现状是 4 个结点的那几步，没有挑战是「做到了」' } },
  { files: ['D2/幕6.txt'], checks: TREE },
  { files: ['E2/幕1.txt'], checks: [C(/里有 key 的谓语 \d 个/)] },
  { files: ['E2/幕6.txt', 'E2/分支1.txt', 'E3/幕8.txt'], anyOf: true, checks: VERB },
  { files: ['L1/幕3.txt'], checks: [C(/学生拨了 [^\n]*→[^\n]*做到了 g1/, '拨数的路，「做到了 g1」标在路上')] },
  { files: ['E3/幕1.txt'], checks: [C(/学生点了 \w+\.\d+（(laughs|laughing)/, '题卡那一行写的是 laughs 还是 laughing')] },
];

// —— fix1：一条页面毛病一份最小的试演（evals/stage-gaps/fix1/，舞台主线第一轮设计第 3 节）——
// 修好的毛病不许再回来：老师看得到的四处（叫老师的那一条、最后攒着的、舞台现状、没演上的行的报错）里必须有 / 不许有什么，
// 排版那一栏必须报 / 不许报什么。跑法：node tools/stage-must.mjs evals/stage-gaps/fix1 --table fix1

const errorsText = (s) => (s?.errors || []).map((e) => `${e.src || ''}：${e.error}`).join('\n');
const SEEN = [['called', (s) => s?.called?.msg], ['pending', (s) => s?.pending], ['state', (s) => s?.state], ['errors', errorsText]];
/** 不许出现的话在哪几处出现了：[{ step, where: 'called' | 'pending' | 'state' | 'errors' }]（每一步的四处都查） */
export function mustNotHits(steps = [], re) {
  const r = plainRe(re);
  const out = [];
  steps.forEach((s, i) => { for (const [where, get] of SEEN) { const t = get(s); if (t && r.test(t)) out.push({ step: i, where }); } });
  return out;
}
/** 必须出现的话在哪几步出现了（四处有一处有就算这一步有） */
export function seenHits(steps = [], re) {
  return [...new Set(mustNotHits(steps, re).map((h) => h.step))];
}
/** 排版那一栏（每一步的 issues 写成「压着：obj:a 和 obj:b」）对得上 re 的是哪几步 */
export function auditHits(steps = [], re) {
  const r = plainRe(re);
  return steps.flatMap((s, i) => ((s?.issues || []).some((p) => r.test(`${p.what}：${p.a}${p.b ? ` 和 ${p.b}` : ''}`)) ? [i] : []));
}
/** 学生屏幕上的字（每一步的 screen）对得上 re 的是哪几步；last：只看最后一步 */
export function screenHits(steps = [], re, { last = false } = {}) {
  const r = plainRe(re);
  return steps.flatMap((s, i) => ((!last || i === steps.length - 1) && r.test(s?.screen || '') ? [i] : []));
}
/**
 * fix1 的表。一行 { id: 'L3-3'（report3 里那张单子的编号）, files: ['L3-3.txt'], checks, nots, called, audit, noAudit }：
 *   checks  老师看得到的四处里必须有（每个视口至少一步）；nots  四处里每一步都不许有；
 *   called  真发给老师的那一条里（或最后攒着的）必须有（mustHits）；audit / noAudit  排版那一栏必须报 / 不许报
 *   screen / noScreen  最后一步学生屏幕上的字必须有 / 不许有
 */
export const FIX1 = [
  { id: 'D3-3', files: ['D3-3.txt'], checks: [C(/不能拖/, '写错的那一问照实报（图不能拖）')], called: [C(/学生点了 c\.1/, '后面那一问挂上了：学生点了 c.1')], nots: [C(/ask 之后的行不演/)] },
  { id: 'D3-1', files: ['D3-1.txt'], screen: [C(/43/, '边上写的是拨过以后的 43')], noScreen: [C(/57/, '边上不再是第一次造的 57')], checks: [C(/A–B 43|A-B:43|43/, '现状里是 43')] },
  { id: 'D4-5', files: ['D4-5.txt'], called: [C(/你上一轮的提问没演上/, '页面马上叫了老师：你上一轮的提问没演上'), C(/学生点了 2 个：A\.1、A\.2/, '学生点的是重写以后的那一问')] },
];

// —— 和基线比（tools/stage-try-diff.mjs）：原来演得上的，现在还演不演得上 ——

// 一条报错认哪一行：写了行号的认那一行（同一行换了说法不算新的错），页面报错、工具的话认整句
const errKey = (e) => (e.line ? `${e.line}|${e.src || ''}` : `0|${e.error}`);
const errText = (e) => `${e.line ? `第 ${e.line} 行「${e.src || ''}」` : ''}${e.line ? '：' : ''}${e.error}${e.kept ? '（照演了）' : ''}`;
const stepName = (s, k) => (s?.step?.kind === 'teacher' ? `第 ${k} 步（老师 第 ${s.step.line} 行起）` : `第 ${k} 步（学生 第 ${s?.step?.line} 行 ${s?.step?.cmd || ''}）`);
const keyOf = (r) => r.path || r.file;
/**
 * 两份 tools/stage-try.mjs --json 的结果比一比（基线、现在；同一个文件照 path 对，没有 path 的照文件名）。
 * 每个文件、每种朝向、每一步：基线里没错的行现在报错了（error）、老师那一段演上的行少了（played）、新多了没交给学生的（untouched）、
 * 基线跑到的步现在没跑到（missing）；基线有的文件、朝向现在没有（file、view），两份对不上同一个文件的步（changed）。
 * 改了说法的报错（同一行基线里也报了）、现在演得上了的、多跑了的步都不算。返回 [{ path, view, step（第几步，从 1 数）, kind, text }]
 */
export function tryDiff(base = [], now = []) {
  const out = [];
  const nowBy = new Map(now.map((r) => [keyOf(r), r]));
  for (const b of base) {
    const path = keyOf(b);
    const n = nowBy.get(path);
    if (!n) { out.push({ path, view: '', step: 0, kind: 'file', text: '现在的结果里没有这个文件' }); continue; }
    for (const bv of b.views || []) {
      const nv = (n.views || []).find((v) => v.tag === bv.tag);
      if (!nv) { out.push({ path, view: bv.tag, step: 0, kind: 'view', text: `现在没有${bv.tag}` }); continue; }
      const bs = bv.steps || [], ns = nv.steps || [];
      for (let i = 0; i < bs.length; i++) {
        const x = bs[i], y = ns[i], k = i + 1;
        if (!y) {
          const left = bs.slice(i).map((_, j) => i + j + 1);
          out.push({ path, view: bv.tag, step: k, kind: 'missing', text: `第 ${left.join('、')} 步没跑到${nv.stopped ? `（${nv.stopped}）` : ''}` });
          break;
        }
        if (x.step?.kind !== y.step?.kind || x.step?.line !== y.step?.line) {
          out.push({ path, view: bv.tag, step: k, kind: 'changed', text: `${stepName(x, k)}现在是${stepName(y, k)}：两份不是同一个文件，后面的不比` });
          break;
        }
        const had = new Set((x.errors || []).map(errKey));
        const fresh = (y.errors || []).filter((e) => !had.has(errKey(e)));
        if (fresh.length) out.push({ path, view: bv.tag, step: k, kind: 'error', text: `${stepName(y, k)}基线里没错、现在报错：${fresh.map(errText).join('；')}` });
        if (x.step?.kind === 'teacher' && (y.played ?? 0) < (x.played ?? 0)) out.push({ path, view: bv.tag, step: k, kind: 'played', text: `${stepName(y, k)}演上了 ${y.played ?? 0} 行（基线 ${x.played} 行）` });
        if (y.untouched && !x.untouched) out.push({ path, view: bv.tag, step: k, kind: 'untouched', text: `${stepName(y, k)}新多了没交给学生的：${y.untouched}` });
      }
    }
  }
  return out;
}
/** tryDiff 的结果写给人看：按文件分节 */
export function diffText(list = []) {
  if (!list.length) return '和基线比：没有不同（基线演得上的现在都演得上）';
  const out = [`和基线比：${list.length} 处不同`];
  let path = null;
  for (const d of list) {
    if (d.path !== path) { path = d.path; out.push('', `## ${path}`); }
    out.push(`- ${d.view ? `${d.view} ` : ''}${d.text}`);
  }
  return out.join('\n');
}

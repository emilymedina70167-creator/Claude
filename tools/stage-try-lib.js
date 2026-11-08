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

const DO = ['write', 'swap', 'move', 'vec', 'mul', 'rotate', 'insert', 'rowop', 'mark', 'fold', 'undo', 'dial'];
const ANSWER = ['tap', 'drag', 'value', 'say', 'next'];
/** 走通用手势（或撤一步、拨数器）的那几种：parseTry 给它们带上 gesture */
const GESTURE = new Set(['rotate', 'insert', 'rowop', 'mark', 'fold', 'undo', 'dial']);

/** 学生能写的（文件写错时报这一份；报告、说明里也照它） */
export const STUDENT_FORMS = [
  'write B.1,1 2（拨数器一格一格拨；open … input=keypad 时用键盘写）',
  'swap a#1 a#2', 'move s.7 after s.1', 'vec p u = 3 1', 'mul C.1,2',
  'rotate t.30 left（在 30 往左转 = 把 30 的右孩子拖到 30 上）',
  'insert t 47（托盘里的 47 拖进树）', 'insert t.45 right 47（拖到 45 右边的空位）',
  'rowop M r3 - 2r1（r1 的把手拖到 r3 上、倍数框写 -2）', 'rowop M r1 <-> r3（拖到行号上）', 'rowop M 3r2（点行号、写 3）',
  'mark s.2-4 V（从 s.2 拉到 s.4、点成分）', 'fold s.3-6（点这一段的括号）',
  'undo（撤一步）', 'dial k 3（拨数器拨到 3）',
  'tap a.7', 'drag a#1 a#6', 'value 4', 'say 我不懂', 'next',
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
    out.push({ kind: 'student', how, cmd, args, src: line, line: i + 1, ...(GESTURE.has(cmd) ? { gesture: studentGesture(cmd, args) } : {}) });
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
      if (x.errors?.length) out.push('没演上的行：', ...x.errors.map((e) => `- 第 ${e.line} 行「${e.src}」：${e.error}`));
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

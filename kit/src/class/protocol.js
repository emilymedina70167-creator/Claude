// 课堂模式：解析课堂里的 Claude 每一轮的输出。
// 普通文字是对学生说的话（写在当前这块板的最上面）；语言名为 board 的围栏代码块是黑板指令：
// new（擦掉黑板，换一块新板）/ add / replace / hide / figure（改当前这块板）/ pin / unpin（常驻栏）/
// mark / unmark（在板上圈、框、划、写旁注）。
// 页面在流式回调里拿到的是「到目前为止的全文」，每次整段重新解析，所以这里全是纯函数、不留状态、不碰 DOM。
import { parseCoach } from './ext.js';
import { parseClaude, parseClaudeOff } from './delegate.js';
import { parseQueue, parseEdits } from './extboard.js';
import { tokenize, unquote } from '../tokens.js';
import { parseNoteBlock } from '../project/notebook.js';
import { parseMarkHead, parseMarkBlock, parseUnmark } from '../markspec.js';
import { parseMemoLines } from '../memory/memo.js';
import { parseReact } from './react.js';
import { parseWhy } from './ask.js';
import { parseCols, parseCol } from './canvas.js';
import { parseAims, aimId } from './aims.js';

// ```board add id=b7 title="…"：行首最多 3 个空格，` 或 ~ 至少 3 个，可有空格，然后是 board 和指令
const OPEN_RE = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*board(?=\s|$)\s*(.*)$/i;
// 任意围栏行：围栏 + 信息串（可空）。缩进规则和 render.js 扫描组件时一致
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
// 流式时还没写完的最后一行，再多几个字就可能成为 board 开头或闭合围栏：先不显示，免得闪一下
const PREFIX_RE = /^[ \t]{0,3}(?:`+|~+)[ \t]*(?:b(?:o(?:a(?:r)?)?)?)?$/i;

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,64}$/;
// id 会当成数据库文档名（steps/{id}）：数据库不收只有 . 或 .. 的名字
const validId = (id) => ID_RE.test(id) && id !== '.' && id !== '..';
// 变量名和 expr.js 一致：字母、下划线、希腊字母开头
const NAME_RE = /^[A-Za-z_Ͱ-Ͽ][\wͰ-Ͽ]*$/;
const ASSIGN_RE = /^([A-Za-z_Ͱ-Ͽ][\wͰ-Ͽ]*)\s*=(?!=)/;
const ACTIONS = ['set', 'play', 'highlight'];
// 表达式里偶尔混进全角标点，expr.js 不认，先换成半角
const HALF = { '（': '(', '）': ')', '［': '[', '］': ']', '，': ',', '；': ';', '＝': '=' };
const ID_RULE = '只能用字母、数字和 _ - . ~ : @ +，1 到 64 个字符，不能只是 . 或 ..';

/**
 * 解析一轮输出（可以是流式中途的前缀）。
 * final=false：最后一个没闭合的 board 块作为 closed:false 的草稿片段；最后一行没写完时不当闭合围栏。
 * final=true：没闭合的 board 块整块（含开头那行）当普通文字。
 * 返回 { segments, ops, rejected, unclosed }：rejected 是已闭合但指令看不懂的块，unclosed 是 final 时没闭合的块
 * （两种都已当普通文字），页面可以据此提醒 Claude。
 */
export function parseOutput(text, { final = false } = {}) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const endsWithNewline = src.endsWith('\n');
  if (endsWithNewline) lines.pop();
  // 流式时最后一行可能只写了一半
  const partialAt = final || endsWithNewline ? -1 : lines.length - 1;

  const segments = [];
  const rejected = [];
  const unclosed = [];
  let words = []; // 正在积累的普通文字行；看不懂的块、没闭合的块也并进来，保持原文的样子
  const flush = () => {
    const t = tidy(words.join('\n'));
    if (t) segments.push({ type: 'speech', text: t });
    words = [];
  };

  for (let i = 0; i < lines.length;) {
    const open = lines[i].match(OPEN_RE);
    if (!open) {
      if (!(i === partialAt && PREFIX_RE.test(lines[i]))) words.push(lines[i]);
      i++;
      continue;
    }
    const blk = scanBlock(lines, i, open, partialAt);
    const raw = lines.slice(i, blk.end);
    if (blk.closed && !blk.op.error) {
      flush();
      segments.push({ type: 'board', header: blk.header, op: blk.op, body: blk.body, closed: true });
    } else if (blk.closed) {
      rejected.push({ header: blk.header, error: blk.op.error, body: blk.body });
      words.push(...raw);
    } else if (final || blk.cut) {
      // 围栏没闭合（或者下一块都开始了）：当普通文字，不报错
      unclosed.push({ header: blk.header, op: blk.op, body: blk.body });
      words.push(...raw);
    } else {
      flush();
      segments.push({ type: 'board', header: blk.header, op: blk.op, body: blk.body, closed: false });
    }
    i = blk.end;
  }
  flush();

  const ops = segments
    .filter((s) => s.type === 'board' && s.closed && s.op && !s.op.error)
    .map((s) => ({ ...s.op, body: s.body }));
  return { segments, ops, rejected, unclosed };
}

// 从开头那行往下找闭合围栏。块里是课件 Markdown，会有组件围栏（```scene … ```），要跳过它们。
// 内层围栏按 CommonMark：内层块里的行都是原文（不再嵌套），只认能闭合它的那一行。
function scanBlock(lines, start, open, partialAt) {
  const indent = open[1].length;
  const outer = { ch: open[2][0], len: open[2].length };
  // 开头那行有缩进时，块内各行去掉同样多的缩进（CommonMark 的做法）
  const lead = indent ? new RegExp(`^[ \\t]{0,${indent}}`) : null;
  const dedent = (s) => (lead ? s.replace(lead, '') : s);
  let header = open[3].trim();
  const body = [];
  const done = (end, closed, cut = false) => {
    const text = body.join('\n');
    // mark 块里每行一条标注：块闭合了才拼（流式草稿只看开头那行）
    const op = closed ? blockCommand(header, text) : parseCommand(header);
    return { header, op, body: text, closed, cut, end };
  };

  // 一行写完的短指令：```board hide id=b5```
  const tail = header.match(outer.ch === '`' ? /^(.*?)\s*(`+)$/ : /^(.*?)\s*(~+)$/);
  if (tail) {
    if (start === partialAt) header = tail[1]; // 正在写的结尾围栏先不算进指令
    else if (tail[2].length >= 3) { header = tail[1]; return done(start + 1, true); }
  }

  let inner = null; // 正在里面的组件围栏 { ch, len }
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j];
    // 又一个 board 开头：上一块忘了闭合。到此为止，免得把后面的块全吞掉
    if (OPEN_RE.test(line)) return done(j, false, true);
    if (j === partialAt) {
      if (!PREFIX_RE.test(line)) body.push(dedent(line));
      break;
    }
    let f = line.match(FENCE_RE);
    // 反引号围栏的信息串里不能再有反引号（CommonMark）：```a``` 这种是行内代码，不是围栏
    if (f && f[1][0] === '`' && f[2].includes('`')) f = null;
    if (f && !f[2].trim()) {
      const ch = f[1][0], len = f[1].length;
      const closesOuter = ch === outer.ch && len >= outer.len;
      const closesInner = inner && ch === inner.ch && len >= inner.len;
      // 内层围栏比外层「弱」（字符不同或更短）时，能闭合外层的行只可能是外层的结尾：
      // 推荐的 ````board 写法下，组件忘了闭合也不会把整块吞掉
      const weak = inner && (inner.ch !== outer.ch || inner.len < outer.len);
      if (closesOuter && (!inner || weak)) return done(j + 1, true);
      if (closesInner) inner = null;
    } else if (f && !inner) {
      inner = { ch: f[1][0], len: f[1].length };
    }
    body.push(dedent(line));
  }
  return done(lines.length, false);
}

// 去掉首尾空行（首行的缩进保留，Markdown 原样）
const tidy = (s) => s.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');

/* ---------------- 指令 ---------------- */

// 段指令：new / add / replace / pin 带内容（可以有标题）；hide / unpin 只要 id
// show：揭开预先写好、藏着的段（add … hold）
// move：版面模式里把一段挪到别的栏（col=），不重画
export const SEGMENT_OPS = ['new', 'add', 'replace', 'hide', 'show', 'move', 'pin', 'unpin'];
const NO_TITLE = new Set(['hide', 'show', 'move', 'unpin']);
const OP_LIST = 'new / add / replace / hide / show / move / layout / pin / unpin / figure / mark / unmark / react / why / memo / note / plan / aims / snap / close / coach / set / claude / claude-off / queue / edit';

/**
 * 解析 board 后面那一行：
 *   new id=b7 title="…"（换一块新板，这一段是新板的第一段）、add id=b8（在当前板上加一段）、
 *   replace id=b5、hide id=b5、pin id=k1 title="…"（常驻栏）、unpin id=k1、
 *   figure target=fig-b7 set x=[1, 2] k=2 / play t [from to 时长] / highlight 3、
 *   mark target=b5 term=mid note="…"（块里还可以一行一条）、unmark id=m3 / target=b5 / all
 * 看不懂时返回 { error: 原因 }。
 */
export function parseCommand(header) {
  const h = String(header ?? '').trim();
  if (!h) return { error: `缺少指令：board 后面要写 ${OP_LIST}` };
  const m = h.match(/^(\S+)\s*([\s\S]*)$/);
  const name = m[1].toLowerCase();
  if (SEGMENT_OPS.includes(name)) return segmentCommand(name, m[2]);
  if (name === 'figure') return figureCommand(m[2]);
  if (name === 'mark') {
    const r = parseMarkHead(m[2]);
    return r.error ? { error: r.error } : { op: 'mark', head: m[2].trim(), target: r.head.target };
  }
  if (name === 'unmark') {
    const r = parseUnmark(m[2]);
    return r.error ? { error: r.error } : { op: 'unmark', ...r };
  }
  // 版面：换当前板的分栏（board layout cols=6/6）
  if (name === 'layout') {
    const m2 = String(m[2]).match(/cols\s*[=＝]\s*(\S+)/);
    if (!m2) return { error: '要写分几栏：比如 board layout cols=6/6' };
    const c = parseCols(m2[1]);
    return c.error ? { error: c.error } : { op: 'layout', cols: c };
  }
  // 预写的「为什么」（ask.js）：学生点着问「为什么」时页面当场显示，一行一条写在块里
  if (name === 'why') {
    const r = parseWhy(m[2], 'all: x');
    return r.error ? { error: r.error } : { op: 'why', head: m[2].trim(), target: r.target };
  }
  // 预案（react.js）：学生作答以后页面当场接的话，一行一条写在块里
  if (name === 'react') {
    const r = parseReact(m[2]);
    return r.error ? { error: r.error } : { op: 'react', head: m[2].trim(), target: r.target };
  }
  // 学习台里改记忆（memory/memo.js）：一行一条，写在块里
  if (name === 'memo') return { op: 'memo' };
  // 项目 Claude 的笔记本（第十四轮，project/notebook.js 的 parseNoteBlock）：一行一个操作，正文写在块里
  if (name === 'note') return { op: 'note' };
  // 外部主 Claude 的课（第十五轮，ext.js）：snap 下一份 ext_out 带上这块板的截图；close 下课；coach 开这一题的板边助教
  if (name === 'snap') return { op: 'snap' };
  // 外部主讲叫页面里的 Claude 来接（需求 R1，delegate.js）：开头那行 + 块里的 see / can / <<<话>>>，块闭合了才读全
  if (name === 'claude') return { op: 'claude', head: m[2].trim() };
  // 外部的课：预备板（R7，块里是那块板第一段的内容）、改字不丢作答（R9，块里写 <<<旧 === 新>>>）
  if (name === 'queue') return parseQueue(m[2] || '');
  if (name === 'edit') {
    const t = tokenize(m[2] || '');
    const id = t.find((x) => x.key === 'id')?.value || t.find((x) => !x.key)?.value;
    if (!id) return { error: 'edit 缺少 id：board edit id=b3，块里写 <<<旧 === 新>>>' };
    if (!validId(id)) return { error: `id「${id}」不合法：${ID_RULE}` };
    return { op: 'edit', id };
  }
  if (name === 'claude-off') return parseClaudeOff(m[2] || '');
  // 整节课的设置（需求 R11）：board set upload=on|off（组件下面的截图入口）
  if (name === 'set') return setCommand(m[2] || '');
  if (name === 'close') return { op: 'close' };
  if (name === 'coach') { const r = parseCoach(m[2] || ''); return r.error ? { error: r.error } : { op: 'coach', target: r.target, upto: r.upto }; }
  // 老师自己的教学计划（学生看不到，docs/learning-plan.md 第 5 节）：块里是几行字
  if (name === 'plan') return { op: 'plan' };
  // 这节课要拿下的事（aims.js）：一行一件，写在块里；不上板，页面核过存进这节课
  if (name === 'aims') return { op: 'aims' };
  return { error: `看不懂的指令「${m[1]}」：只认 ${OP_LIST}` };
}

/**
 * 一整块指令：开头那行 + 块里的内容（课堂里闭合了的 board 块；实时黑板 ops 集合里的一条 { cmd, body }）。
 * mark 的块里一行一条标注，在这里拼成 marks；别的指令和 parseCommand 一样（内容由调用方当段的 Markdown 用）。
 */
export function blockCommand(header, body = '') {
  const op = parseCommand(header);
  if (op.op === 'memo') return memoOp(body);
  if (op.op === 'note') { const r = parseNoteBlock(body); return r.ops.length ? { op: 'note', ops: r.ops, ...(r.errors.length ? { errors: r.errors } : {}) } : { error: r.errors[0] || 'note 里一条也没写' }; }
  if (op.op === 'plan') return planOp(body);
  if (op.op === 'aims') return aimsOp(body);
  // 读得宽一点（外部的课里收 wrong / giveup / stuck）；页面里的老师写的那几条课堂执行时照旧不收（classroom.js）
  if (op.op === 'react') return parseReact(op.head, body, { lenient: true });
  if (op.op === 'claude') return parseClaude(op.head, body);
  if (op.op === 'edit') { const r = parseEdits(body); return r.error ? { error: r.error } : { ...op, edits: r.edits }; }
  if (op.op === 'why') return parseWhy(op.head, body);
  return op.op === 'mark' ? markOp(op, body) : op;
}

// board set 能改的整节课设置：名字 → 能取的值
export const SETTINGS = { upload: ['on', 'off'] };
function setCommand(rest) {
  const out = {};
  for (const t of tokenize(rest)) {
    if (!t.key) return { error: `看不懂「${t.value}」：set 后面写 名字=值，比如 board set upload=on` };
    const k = t.key.toLowerCase(), v = String(t.value).toLowerCase();
    if (!SETTINGS[k]) return { error: `set 没有「${t.key}」这一项：能改的是 ${Object.keys(SETTINGS).join('、')}` };
    if (!SETTINGS[k].includes(v)) return { error: `${k} 只能是 ${SETTINGS[k].join(' / ')}` };
    out[k] = v;
  }
  if (!Object.keys(out).length) return { error: 'set 后面要写 名字=值，比如 board set upload=on' };
  return { op: 'set', values: out };
}

// 教学计划最多多长：每一轮都放进说明，长了白费额度
export const PLAN_MAX = 200;
function planOp(body) {
  const t = String(body ?? '').trim();
  if (!t) return { error: 'plan 里没写内容：写这节课要到哪、你现在猜学生卡在哪、拿什么来证实、下一步' };
  return t.length > PLAN_MAX ? { op: 'plan', text: t.slice(0, PLAN_MAX), cut: t.length } : { op: 'plan', text: t };
}

// 闭合的 aims 块：一行一件（写法见 aims.js）。一件也没读出来时整块算看不懂；读懂的照收，读不懂的行放在 errors 里。
// 件数、重号、真题题号能不能用不在这里管（checkAims，课堂执行时核：要查考试资料）
function aimsOp(body) {
  const r = parseAims(body);
  if (!r.aims.length) return { error: r.errors[0] || 'aims 里一件也没写：一行一件，比如 a1 | 给一个引用串，手算 LRU 的缺页次数 | 独立做一道没见过的同类题' };
  return { op: 'aims', aims: r.aims, errors: r.errors };
}

// 闭合的 memo 块：一行一条（写法见 memory/memo.js）。一条也没读懂时整块算看不懂；读懂的照常记，读不懂的行放在 errors 里
function memoOp(body) {
  const r = parseMemoLines(body);
  if (!r.entries.length) return { error: r.errors[0] || 'memo 里一条也没写' };
  return { op: 'memo', entries: r.entries, ...(r.errors.length ? { errors: r.errors } : {}) };
}

// 闭合的 mark 块：开头那行 + 块里各行拼成 marks。一条也没写对时整块算看不懂；
// 写对了的照常执行，写错的行放在 errors 里，页面执行完提醒课堂 Claude
function markOp(op, body) {
  const r = parseMarkBlock(op.head, body);
  if (r.error) return { error: r.error };
  if (!r.marks.length) return { error: r.errors[0] || 'mark 没有写要标的地方' };
  const out = { op: 'mark', target: op.target, marks: r.marks };
  if (r.errors.length) out.errors = r.errors;
  return out;
}

function segmentCommand(op, rest) {
  const toks = tokenize(rest);
  let id, title, point, aim, col, cols, hold = false;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.key === 'id') id = t.value;
    // add id=b9 hold：先画好藏着，等预案（react 的 show=）或 board show 揭开
    else if (!t.key && !t.quoted && t.value === 'hold') hold = true;
    // 学习台里：这一段练的是哪个知识点（mastery 编号 # 后面那段），学生在这段的作答记成它的证据
    else if (t.key === 'point') point = t.value;
    // 这一段的题是给这节课要拿下的哪件事用的（aims.js）：学生在这段的作答挂到那件事上
    else if (t.key === 'aim') aim = t.value;
    // 版面（canvas.js）：放在第几栏（col=2 / col=all）；new 上写这块板分几栏（cols=7/5）
    else if (t.key === 'col') col = t.value;
    else if (t.key === 'cols') cols = t.value;
    else if (t.key === 'title') {
      title = t.value;
      if (!t.quoted) {
        // 标题没加引号又带空格：后面不是 key=… 的词都算标题
        let end = t.end;
        // 末尾单独一个 hold 不算标题（add id=b4 title=提示 hold）：不然藏着的段直接露出来
        while (toks[k + 1] && !toks[k + 1].key && !(op === 'add' && !toks[k + 1].quoted && toks[k + 1].value === 'hold' && !toks.slice(k + 2).some((x) => !x.key))) end = toks[++k].end;
        title = rest.slice(t.vstart, end);
      }
    } else if (!t.key) {
      // 也认 hide b5、add b7 "标题" 这种省掉 key 的写法
      if (t.quoted) { if (title === undefined) title = t.value; }
      else if (id === undefined) id = t.value;
    }
  }
  const eg = op === 'pin' || op === 'unpin' ? 'k1' : 'b1';
  if (!id) return { error: `${op} 缺少 id，比如 ${op} id=${eg}` };
  if (!validId(id)) return { error: `id「${id}」不合法：${ID_RULE}` };
  const out = { op, id };
  if (col !== undefined && op !== 'hide' && op !== 'show' && op !== 'unpin' && op !== 'pin') {
    const c = parseCol(col);
    if (c?.error) return { error: c.error };
    out.col = c;
  }
  if (cols !== undefined) {
    if (op !== 'new') return { error: 'cols= 写在 board new 上（这块板分几栏）；换当前板的分栏用 board layout cols=…' };
    const c = parseCols(cols);
    if (c.error) return { error: c.error };
    out.cols = c;
  }
  if (op === 'move' && out.col === undefined) return { error: 'move 要写挪到哪一栏：比如 move id=b3 col=2' };
  if (hold) {
    if (op !== 'add') return { error: `hold 只能写在 add 上（先画好藏着，等预案揭开），${op} 不能 hold` };
    out.hold = true;
  }
  if (!NO_TITLE.has(op) && title !== undefined) out.title = title.trim();
  if (point !== undefined && !NO_TITLE.has(op)) {
    // point 写错只丢掉 point，段照常写（2026-10-28 point=复现R19 让整块板当成普通文字写在了板顶）
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(point)) out.warn = `point「${point}」没用上：只能用字母、数字、- 和 _（写掌握状态编号 # 后面那段，比如 point=tr），这一段的作答没记成知识点的证据`;
    else out.point = point;
  }
  if (aim !== undefined && !NO_TITLE.has(op)) {
    // 和 point 一样：写错只丢掉 aim，段照常写。这件事这节课有没有，课堂执行时才知道
    const a = aimId(aim);
    if (a) out.aim = a;
    else out.warn = [out.warn, `aim「${aim}」没用上：写这节课要拿下的事的编号（board aims 里的 a1、a2），这一段的作答没挂到哪件事上`].filter(Boolean).join('；');
  }
  return out;
}

function figureCommand(rest) {
  const toks = tokenize(rest);
  // 动作词（set / play / highlight）前面是 target，后面是动作的参数
  let target, stray, k;
  for (k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.key === 'target' || t.key === 'id') target = t.value;
    else if (!t.key && !t.quoted && ACTIONS.includes(actionWord(t.value))) break;
    else if (!t.key && target === undefined) target = t.value;
    else if (!t.key && stray === undefined) stray = t.value;
  }
  const at = toks[k];
  const action = at ? actionWord(at.value) : null;
  const args = at ? rest.slice(at.end) : '';
  const res = action === 'set' ? parseSet(args)
    : action === 'play' ? parsePlay(args)
    : action === 'highlight' ? parseHighlight(args)
    : { error: stray ? `看不懂的 figure 动作「${stray}」：只认 set / play / highlight` : 'figure 缺少动作（set / play / highlight），比如 figure target=fig-1 play t' };
  // target 写在动作后面也认
  if (res.target !== undefined) target = res.target;
  if (!target) return { error: 'figure 缺少 target（图的 id），比如 figure target=fig-1 play t' };
  if (!validId(target)) return { error: `target「${target}」不合法：${ID_RULE}` };
  if (res.error) return { error: res.error };
  delete res.target;
  return { op: 'figure', target, action, ...res };
}

const actionWord = (v) => v.toLowerCase().replace(/[:：]$/, '');

// set x=[1, 2] A=[[1,2],[3,4]] k=2：值是表达式原文，里面可以有空格、逗号和嵌套括号，
// 所以按括号深度找「变量名=」的位置来切
function parseSet(src) {
  const s = src.replace(/[（）［］，；＝]/g, (c) => HALF[c]);
  const found = [];
  let depth = 0;
  for (let p = 0; p < s.length; p++) {
    const c = s[p];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (p === 0 || /[\s,;]/.test(s[p - 1]))) {
      const m = s.slice(p).match(ASSIGN_RE);
      if (m) {
        found.push({ at: p, name: m[1], from: p + m[0].length });
        p += m[0].length - 1;
      }
    }
  }
  const lead = (found.length ? s.slice(0, found[0].at) : s).replace(/[\s,;]+/g, '');
  if (lead) return { error: `看不懂「${lead}」：set 后面要写 变量=值，比如 set x=[1, 2]` };
  const assigns = {};
  let target;
  for (let k = 0; k < found.length; k++) {
    const f = found[k];
    const end = k + 1 < found.length ? found[k + 1].at : s.length;
    const v = unquote(s.slice(f.from, end).replace(/[\s,;]+$/, '').trim());
    if (!v) return { error: `set 的 ${f.name} 后面缺少值` };
    if (f.name === 'target') target = v;
    else assigns[f.name] = v;
  }
  if (!Object.keys(assigns).length) return { error: 'set 后面缺少 变量=值，比如 set x=[1, 2]', target };
  return { assigns, target };
}

// play t [from to 时长]，也认 from= to= ms= 的写法
function parsePlay(src) {
  const pos = [];
  const kv = {};
  let target;
  for (const t of tokenize(src)) {
    if (t.key === 'target') target = t.value;
    else if (t.key) kv[t.key] = t.value;
    else pos.push(t.value);
  }
  const name = kv.name ?? kv.var ?? pos[0];
  if (!name) return { error: 'play 缺少变量名，比如 play t', target };
  if (!NAME_RE.test(name)) return { error: `play 的变量名「${name}」不合法`, target };
  const from = toNumber(kv.from ?? pos[1], 0);
  const to = toNumber(kv.to ?? pos[2], 1);
  if (Number.isNaN(from) || Number.isNaN(to)) return { error: 'play 的起止值要写数字，比如 play t 0 1 2s', target };
  const ms = kv.ms !== undefined ? toMs(kv.ms, true) : toMs(kv.dur ?? kv.duration ?? kv.time ?? pos[3]);
  if (Number.isNaN(ms)) return { error: 'play 的时长写成 2s、1500ms 或 2（秒）', target };
  return { name, from, to, ms, target };
}

// highlight 3：图里第几条命令（从 1 数）
function parseHighlight(src) {
  let target, v;
  for (const t of tokenize(src)) {
    if (t.key === 'target') target = t.value;
    else if (t.key === 'index' || t.key === 'n') v = t.value;
    else if (!t.key && v === undefined) v = t.value;
  }
  const m = String(v ?? '').match(/^(?:#|第)?(\d+)(?:条|行|个)?$/);
  const index = m ? Number(m[1]) : NaN;
  if (!(index >= 1)) return { error: 'highlight 后面要写命令序号（从 1 数），比如 highlight 3', target };
  return { index, target };
}

function toNumber(v, fallback) {
  if (v === undefined || v === '') return fallback;
  const s = String(v).replace(/−/g, '-');
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
  const f = s.match(/^([-+]?(?:\d+\.?\d*|\.\d+))\/(\d+\.?\d*|\.\d+)$/);
  if (f && Number(f[2]) !== 0) return Number(f[1]) / Number(f[2]);
  return NaN;
}

// 时长：2s、1500ms、2 秒；不带单位时按秒算（但 ≥100 的显然是毫秒）。最长 1 分钟
function toMs(v, bareIsMs = false) {
  if (v === undefined || v === '') return 1200;
  const m = String(v).trim().match(/^(\d+\.?\d*|\.\d+)\s*(ms|毫秒|s|sec|秒)?$/i);
  if (!m) return NaN;
  const n = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  const ms = unit === 'ms' || unit === '毫秒' ? n : unit ? n * 1000 : bareIsMs || n >= 100 ? n : n * 1000;
  return Math.round(Math.min(ms, 60000));
}

/** 下课小结放在板上的那段：输出里有 board 块（memo、note……）就只留说的话；没有说的话照原文 */
export function closingSpeech(text) {
  const out = parseOutput(text, { final: true });
  if (!out.ops.length) return String(text ?? '');
  return out.segments.filter((x) => x.type === 'speech').map((x) => x.text).join('\n\n').trim() || String(text ?? '');
}

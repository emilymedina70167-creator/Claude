// 课堂模式：解析课堂里的 Claude 每一轮的输出。
// 普通文字是对学生说的话；语言名为 board 的围栏代码块是黑板指令（add / replace / hide / figure）。
// 页面在流式回调里拿到的是「到目前为止的全文」，每次整段重新解析，所以这里全是纯函数、不留状态、不碰 DOM。

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
// 引号：英文 "…" '…'、中文 “…” ‘…’、「…」『…』；左右写反了也认
const CLOSE = { '"': '"”“', '“': '”“"', '”': '”“"', "'": "'’‘", '‘': '’‘\'', '’': '’‘\'', '「': '」', '『': '』' };
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
  const done = (end, closed, cut = false) => ({ header, op: parseCommand(header), body: body.join('\n'), closed, cut, end });

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

/**
 * 解析 board 后面那一行：
 *   add id=b7 title="…"、replace id=b5、hide id=b5、
 *   figure target=fig-b7 set x=[1, 2] k=2 / play t [from to 时长] / highlight 3
 * 看不懂时返回 { error: 原因 }。
 */
export function parseCommand(header) {
  const h = String(header ?? '').trim();
  if (!h) return { error: '缺少指令：board 后面要写 add / replace / hide / figure' };
  const m = h.match(/^(\S+)\s*([\s\S]*)$/);
  const name = m[1].toLowerCase();
  if (name === 'add' || name === 'replace' || name === 'hide') return segmentCommand(name, m[2]);
  if (name === 'figure') return figureCommand(m[2]);
  return { error: `看不懂的指令「${m[1]}」：只认 add / replace / hide / figure` };
}

function segmentCommand(op, rest) {
  const toks = tokenize(rest);
  let id, title;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.key === 'id') id = t.value;
    else if (t.key === 'title') {
      title = t.value;
      if (!t.quoted) {
        // 标题没加引号又带空格：后面不是 key=… 的词都算标题
        let end = t.end;
        while (toks[k + 1] && !toks[k + 1].key) end = toks[++k].end;
        title = rest.slice(t.vstart, end);
      }
    } else if (!t.key) {
      // 也认 hide b5、add b7 "标题" 这种省掉 key 的写法
      if (t.quoted) { if (title === undefined) title = t.value; }
      else if (id === undefined) id = t.value;
    }
  }
  if (!id) return { error: `${op} 缺少 id，比如 ${op} id=b1` };
  if (!validId(id)) return { error: `id「${id}」不合法：${ID_RULE}` };
  const out = { op, id };
  if (op !== 'hide' && title !== undefined) out.title = title.trim();
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

/* ---------------- 分词 ---------------- */

// 指令行切成词：key=value（值可加引号）或单独的词。记下位置，方便取原文
function tokenize(s) {
  const out = [];
  let i = 0;
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) return out;
    const start = i;
    let key = null;
    const km = s.slice(i).match(/^([A-Za-z][\w-]*)[ \t]*[=＝][ \t]*/);
    if (km) {
      key = km[1].toLowerCase();
      i += km[0].length;
      // id= title="…"：等号后面空着，别把下一个 key=… 当成值
      if (/\s$/.test(km[0]) && /^[A-Za-z][\w-]*[ \t]*[=＝]/.test(s.slice(i))) {
        out.push({ key, value: '', quoted: false, start, vstart: i, end: i });
        continue;
      }
    }
    const v = readValue(s, i);
    out.push({ key, value: v.value, quoted: v.quoted, start, vstart: i, end: v.end });
    i = v.end;
  }
}

function readValue(s, i) {
  const closers = CLOSE[s[i]];
  if (closers) {
    // 收尾的引号后面应是空白或行尾：标题里夹着的引号（比如 说"对"了）不算收尾
    let first = -1;
    for (let j = i + 1; j < s.length; j++) {
      if (!closers.includes(s[j])) continue;
      if (first < 0) first = j;
      if (j + 1 === s.length || /\s/.test(s[j + 1])) return { value: s.slice(i + 1, j), quoted: true, end: j + 1 };
    }
    if (first >= 0) return { value: s.slice(i + 1, first), quoted: true, end: first + 1 };
    return { value: s.slice(i + 1), quoted: true, end: s.length }; // 引号还没写完（流式草稿）：取到行尾
  }
  let j = i;
  while (j < s.length && !/\s/.test(s[j])) j++;
  return { value: s.slice(i, j), quoted: false, end: j };
}

function unquote(v) {
  const closers = CLOSE[v[0]];
  return closers && v.length >= 2 && closers.includes(v[v.length - 1]) ? v.slice(1, -1).trim() : v;
}

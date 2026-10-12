// 指令行分词（课堂黑板指令、板书标注、matrix 组件共用）：切成 key=value 或单独的词，记下位置。
// 值可以加引号（英文 "…" '…'、中文 “…” ‘…’、「…」『…』，左右写反了也认）；
// 以 [ 或 ( 开头的值读到括号配平为止，中间可以有空格（at=[1, 2]）。纯函数。

// 引号：开头的字符 → 能当收尾的字符
export const CLOSE = { '"': '"”“', '“': '”“"', '”': '”“"', "'": "'’‘", '‘': '’‘\'', '’': '’‘\'', '「': '」', '『': '』' };

export function tokenize(s) {
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

export function readValue(s, i) {
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
  if (s[i] === '[' || s[i] === '(') {
    let depth = 0, j = i;
    for (; j < s.length; j++) {
      if ('[('.includes(s[j])) depth++;
      else if ('])'.includes(s[j]) && --depth === 0) { j++; break; }
    }
    // 括号后面紧跟的字（[1, 2]x 这种）也算进来，到空白为止
    while (j < s.length && !/\s/.test(s[j])) j++;
    return { value: s.slice(i, j), quoted: false, end: j };
  }
  let j = i;
  while (j < s.length && !/\s/.test(s[j])) j++;
  return { value: s.slice(i, j), quoted: false, end: j };
}

export function unquote(v) {
  const closers = CLOSE[v[0]];
  return closers && v.length >= 2 && closers.includes(v[v.length - 1]) ? v.slice(1, -1).trim() : v;
}

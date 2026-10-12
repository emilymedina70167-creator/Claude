// 命令行末尾的修饰（color=… label="…" drag 等）和按最外层逗号切分：scene、graph、space、matrix 共用。纯函数

const FLAGS = ['drag', 'dashed', 'faint', 'play', 'after', 'before', 'thin', 'drop'];

// 把一行末尾的修饰（color=… label="…" drag 等）拆出来
export function splitMods(line) {
  const mods = {};
  let s = line.trim();
  for (;;) {
    let m = s.match(/\s+([a-z]+)=("([^"]*)"|“([^”]*)”|[^\s"“]+)$/i);
    if (m) { mods[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[2]; s = s.slice(0, m.index).trimEnd(); continue; }
    m = s.match(new RegExp(`\\s+(${FLAGS.join('|')})$`, 'i'));
    if (m) { mods[m[1].toLowerCase()] = true; s = s.slice(0, m.index).trimEnd(); continue; }
    return { body: s, mods };
  }
}

// 只在最外层按分隔符切（不切括号里的逗号）
export function splitTop(s, sep = ',') {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

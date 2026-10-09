// 课堂里的 Claude 唯一的组件手册：构建时从 CLAUDE-PROJECT.md 第三节「组件参考」截出来，打包进 la-kit.js。
// 只做轻度精简：去掉连续空行、行尾空格、课堂里用不上的小节。代码示例和表格全部保留——
// 它看不到别的文档，示例就是它照着写的依据。
const START = /^##\s*三\s*[、.．]\s*组件参考/;
// 课堂里用不上的组件：context 是给 guided 课件里「问 Claude」的背景资料（课堂有资料包），
// summary 是 guided 单元结尾的统计（课堂由「下课」收尾），留着反而会让它照「必放」去写
export const DROP = ['context', 'summary'];

// 行首（最多 3 个空格）的围栏：``` 或 ~~~，长度 ≥ 3；info 是围栏后面的文字
function fenceOf(line) {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  const info = m[2].trim();
  if (m[1][0] === '`' && info.includes('`')) return null; // 反引号围栏的 info 里不能再有反引号（CommonMark）
  return { ch: m[1][0], len: m[1].length, info };
}

// 逐行标出每一行是不是在代码块里（围栏行本身也算在块里），截取和精简都要避开代码块里的内容
function markCode(lines) {
  const inCode = new Array(lines.length).fill(false);
  let open = null;
  lines.forEach((line, i) => {
    const f = fenceOf(line);
    if (open) {
      inCode[i] = true;
      if (f && !f.info && f.ch === open.ch && f.len >= open.len) open = null;
    } else if (f) {
      inCode[i] = true;
      open = f;
    }
  });
  return inCode;
}

export function componentDocs(markdown, { drop = DROP } = {}) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const inCode = markCode(lines);
  const start = lines.findIndex((l, i) => !inCode[i] && START.test(l));
  if (start < 0) throw new Error('CLAUDE-PROJECT.md 里找不到「## 三、组件参考」，没法生成课堂模式的组件说明');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (!inCode[i] && /^##\s/.test(lines[i])) { end = i; break; }
  }

  const dropSet = new Set(drop.map((d) => d.toLowerCase()));
  const out = [];
  let skipping = false;
  for (let i = start + 1; i < end; i++) {
    let line = lines[i];
    if (!inCode[i]) {
      const h3 = /^###\s+([A-Za-z][\w-]*)/.exec(line);
      if (h3) skipping = dropSet.has(h3[1].toLowerCase());
      else if (/^#{1,3}\s/.test(line)) skipping = false;
    }
    if (skipping) continue;
    if (!inCode[i]) {
      line = line.replace(/\s+$/, '');
      if (/^\s*(-{3,}|\*{3,}|_{3,})$/.test(line)) continue; // 分隔线：截出来以后没有意义
      if (!line && (!out.length || out[out.length - 1] === '')) continue; // 连续空行只留一个
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

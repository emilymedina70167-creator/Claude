// derive 组件的写法（纯函数，有测试 tests/sketch.test.js）：一段推导一行一行写出来，等号对齐，旁边可以写一句。
//
//   id: d-1
//   title: 推 A²
//   A^2 = (\alpha\beta^{\mathrm T})(\alpha\beta^{\mathrm T})
//       = \alpha(\beta^{\mathrm T}\alpha)\beta^{\mathrm T}     // 结合律：中间先乘
//       = \calc{tr(A)}\,A
//
// 每行是一段 TeX（不写 $），// 后面是旁注（Markdown）。行里第一个关系符（= ≤ ⇒ …）前后分两栏对齐。

const FIELD = /^\s*([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/;
const FIELDS = new Set(['id', 'title', 'q', 'note', 'auto', 'start', 'link']);
// 按长短排：先认长的（\Longrightarrow 不能被当成 \Rightarrow 后面剩一截）
const RELS = ['\\Longleftrightarrow', '\\Leftrightarrow', '\\Longrightarrow', '\\Rightarrow', '\\implies', '\\iff', '\\approx', '\\equiv', '\\neq', '\\leq', '\\geq', '\\ne', '\\le', '\\ge', '\\sim', '=', '<', '>'];

/**
 * 一行 TeX 在第一个最外层的关系符处切开：[左边, 关系符和右边]。没有关系符时左边是空的（整行放右栏）。
 * 大括号、\begin…\end 里面的不算（矩阵里的 & 和 = 不切）
 */
export function splitRelation(tex) {
  const s = String(tex ?? '');
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      if (s.startsWith('\\begin', i)) { depth++; i += 5; continue; }
      if (s.startsWith('\\end', i)) { depth--; i += 3; continue; }
      if (depth === 0) {
        const rel = RELS.find((r) => r.startsWith('\\') && s.startsWith(r, i) && !/[A-Za-z]/.test(s[i + r.length] || ''));
        if (rel) return [s.slice(0, i).trim(), s.slice(i).trim()];
      }
      i++; // 跳过 \{ \} 这类转义
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && (c === '=' || c === '<' || c === '>')) return [s.slice(0, i).trim(), s.slice(i).trim()];
  }
  return ['', s.trim()];
}

/** 解析整段。返回 { fields, lines: [{ tex, left, right, note }] }；写错了抛出中文原因 */
export function parseDerive(src) {
  const fields = {};
  const lines = [];
  for (const raw of String(src ?? '').split('\n')) {
    if (!raw.trim()) continue;
    const m = raw.match(FIELD);
    if (m && FIELDS.has(m[1].toLowerCase()) && !lines.length) { fields[m[1].toLowerCase()] = m[2].trim(); continue; }
    if (/^\s*\$/.test(raw)) throw new Error(`每行直接写 TeX，不用 $：${raw.trim().slice(0, 40)}`);
    // // 后面是旁注（前面要有空白，免得切到 TeX 里）
    const cut = raw.search(/\s\/\/\s?/);
    const tex = (cut >= 0 ? raw.slice(0, cut) : raw).trim();
    const note = cut >= 0 ? raw.slice(cut).replace(/^\s*\/\/\s?/, '').trim() : '';
    if (!tex) throw new Error(`这一行只有旁注、没有式子：${raw.trim().slice(0, 40)}`);
    const [left, right] = splitRelation(tex);
    lines.push({ tex, left, right, note });
  }
  if (!lines.length) throw new Error('derive 里至少写一行式子');
  if (lines.length > 30) throw new Error('一段推导最多 30 行，太长就拆成两段');
  const n = lines.length;
  const start = /^all$|^全部$/i.test(fields.start || '') ? n : fields.start ? Number(fields.start) : 1;
  if (!(Number.isInteger(start) && start >= 1 && start <= n)) throw new Error(`start: 写 1 到 ${n} 之间的数（一开始显示几行），或者 all`);
  let auto = 0;
  if (fields.auto && !/^(off|no|false|0|关)$/i.test(fields.auto)) {
    auto = /^(on|yes|true|开)$/i.test(fields.auto) ? 1.4 : Number(String(fields.auto).replace(/s$|秒$/, ''));
    if (!(auto >= 0.3 && auto <= 10)) throw new Error('auto: 写每行之间隔几秒（0.3 到 10），比如 auto: 1.5；或者 auto: on');
  }
  return { fields, lines, start, auto };
}

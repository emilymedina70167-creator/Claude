// 黑板组件 stage 不碰 DOM 的那一半（画面在 blocks/stagebox.js）：读开头的几行字段、把舞台没演上的行写成组件的写法错误、
// 舞台上的事写成给外部主讲看的一行。纯函数，有测试（tests/stagebox.test.js）。
//
// ```stage
// id: s1
// title: 把四项排好
// prewrite: all
// height: 420
// array a = …（往下全是舞台的镜头指令，写法见 stage/doc.js 的 stageManual）
// ```

export const HEIGHT = { min: 240, max: 900, def: 420, auto: 160 };
const FIELD = /^\s*(id|title|prewrite|height)\s*[:：]\s*(.*)$/i;

/**
 * 读一段 stage：开头连着的 id: / title: / prewrite: / height: 是字段，第一行不是字段的起往下都是镜头指令。
 * 返回 { id, title, prewrite（'all' 或 null）, height（像素）, script, offset（镜头指令的第 1 行是这一段的第几行，从 1 数）, problems }
 */
export function parseStageBox(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = { id: '', title: '', prewrite: null, height: HEIGHT.def, heightSet: false, script: '', offset: 1, problems: [] };
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const m = l.match(FIELD);
    if (!m) break;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'id') out.id = v;
    else if (k === 'title') out.title = v;
    else if (k === 'prewrite') {
      if (/^(all|on)$/i.test(v)) out.prewrite = 'all';
      else if (!/^(off|默认)?$/i.test(v)) out.problems.push(`prewrite: 只能写 all（预写也收 @名字.wrong / .miss、@ask.wrong）或 off，没有「${v}」`);
    } else if (k === 'height') {
      const n = Number(v.replace(/px$/i, ''));
      if (!Number.isFinite(n)) out.problems.push(`height: 写像素（比如 height: 420），没有「${v}」`);
      else { out.height = Math.round(Math.min(HEIGHT.max, Math.max(HEIGHT.min, n))); out.heightSet = true; }
    }
  }
  out.offset = i + 1;
  out.script = lines.slice(i).join('\n');
  if (!out.script.trim()) out.problems.push('stage 里还没有镜头指令（字段下面一行一个动作，比如 array a = 3 1 2）');
  return out;
}

/**
 * 舞台这一轮没演上的行（stage.js 的 errors：{ line, src, error, kept }）→ 组件的写法错误：[{ msg, soft }]。
 * line 是镜头指令里的第几行，加上 offset 换成这一段里的第几行（外部主讲照它找）；kept 的是照演了、只是写法有毛病（soft）
 */
export function problemsOf(errors = [], offset = 1) {
  const seen = new Set();
  const out = [];
  for (const e of errors || []) {
    const at = Number(e.line) > 0 ? `第 ${Number(e.line) + offset - 1} 行` : '';
    const src = String(e.src || '').trim();
    const msg = `${at}${src ? `「${src.length > 80 ? `${src.slice(0, 79)}…` : src}」` : ''}${at || src ? '：' : ''}${e.error}`;
    if (seen.has(msg)) continue;
    seen.add(msg);
    out.push({ msg, soft: !!e.kept });
  }
  return out;
}

/** 一次叫老师（舞台课那时会叫老师的那一刻）的理由 → 给外部主讲看的几个字 */
export const CALL_WHY = {
  answer: '学生答了那一问',
  goal: '学生做到了挑战',
  done: '学生做完了交给自己的东西',
  watch: '你盯着的条件成立了',
  wrong: '学生走偏了（open 那一行写了 call=wrong）',
  tries: '学生试了好多下还没做到',
  stuck: '学生很久没动，挑战还没做到',
  miss: '你预写的问没演上',
};
/** 叫老师的那一条写成一行：「[舞台 s1] 学生做到了挑战：……」 */
export function callLine(id, why, text) {
  const head = `[舞台${id ? ` ${id}` : ''}] ${CALL_WHY[why] || why}`;
  const body = String(text || '').trim();
  return body ? `${head}：\n${body}` : head;
}

/**
 * 没写 height: 时舞台多高（dr-ext-live-fixes 4：一行式子的舞台以前也占 420，分屏时一块板放不下）：
 * 演完以后东西实际占的高（box.h，镜头一倍时的像素）加上面让给挑战和话的、下面让给按钮的、四边的留白，夹在 [160, 900]
 */
export function autoHeight({ box = null, top = 0, bottom = 0, pad = 28 } = {}) {
  if (!box || !(box.h > 0)) return HEIGHT.def;
  return Math.round(Math.min(HEIGHT.max, Math.max(HEIGHT.auto, box.h + top + bottom + 2 * pad)));
}

// —— 刷新前的样子（dr-trail-fix 3）：board stage 的舞台 log 存一份，再画时照它放回 ——

/** 这一段镜头指令的指纹：段被改过（replace、edit 改了指令）就对不上，照旧从头演 */
export function scriptSig(id, script) {
  let h = 5381;
  const s = `${id}\n${String(script ?? '').trim()}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${s.length.toString(36)}-${h.toString(36)}`;
}

/** 舞台的 log → 存进数据库的那一份：{ sig, rows: [{ src, by, open?, pre? }], ask }；学生一下都没动过就不存（null） */
export function logDoc(log, { sig = '', ask = null } = {}) {
  const rows = (log || []).filter((r) => r && typeof r.src === 'string').map((r) => ({ src: r.src, by: r.by || 'teacher', ...(r.open ? { open: r.open } : {}), ...(r.pre ? { pre: true } : {}) }));
  if (!rows.some((r) => r.by === 'student')) return null;
  return { sig, rows, ask: ask || null };
}

/** 段 id → 文档 id（数据库的路径段只收字母数字和 _ - . ~） */
export const docId = (id) => String(id || '').replace(/[^A-Za-z0-9_\-.~]/g, '_').slice(0, 120) || '_';

// 舞台试演工具（tools/stage-try.mjs）不碰浏览器的那一半：读一幕的文件、把演的结果写成报告。纯函数，有测试（tests/stage-try.test.js）。
//
// 一幕的文件：普通的行是老师的镜头指令（连着的几行是一段，照真上课那样一段一段交给舞台）；
// 「学生:」开头的一行是学生的一下：直接动画面（write / swap / move / vec / mul，走交给学生的那一项），
// 或者回答正在等的那一问（tap / drag / value / say / next，照真的手指和输入框）。

const DO = ['write', 'swap', 'move', 'vec', 'mul'];
const ANSWER = ['tap', 'drag', 'value', 'say', 'next'];

/** 一幕的文件 → 一步步：{ kind: 'teacher', src, line } | { kind: 'student', how, cmd, args, src, line } */
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
    if (!how) throw new Error(`第 ${i + 1} 行「${line}」：学生能写的：${[...DO, ...ANSWER].join(' ')}`);
    out.push({ kind: 'student', how, cmd, args: m[2].trim(), src: line, line: i + 1 });
  });
  return out.map((s) => (s.kind === 'teacher' ? { kind: 'teacher', src: s.lines.join('\n'), line: s.line } : s));
}

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
      if (x.errors?.length) out.push('没演上的行：', ...x.errors.map((e) => `- 第 ${e.line} 行「${e.src}」：${e.error}`));
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

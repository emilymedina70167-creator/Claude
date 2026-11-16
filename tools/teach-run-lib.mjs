// 教学尺子（evals/teaching/）自动跑课的纯函数：命令行参数、扮学生 / 课后测验 / 评卷的说明、读模型的回复、一整套的表。
// 不碰子进程，tests/teach-run-lib.test.js 守着；调用命令行在 tools/teach-run.mjs，跑一整套在 tools/teach-suite.mjs。
// 发给模型的说明里提到学生不用「他」「她」（测试守着）。

// 命令行参数（2026-11-15/16 用 claude 2.1.325 探针定的，证据在 .superpowers/sdd/2026-11-15-root-0/task-2-report.md）：
// --tools "" 关掉全部内置工具、--strict-mcp-config 不带任何 MCP（stream-json 的 init 里 tools、mcp_servers 都是 []）、
// --setting-sources "" 不读用户和项目的设置、--disable-slash-commands 不挂技能；在仓库外的空目录里跑也就读不到 CLAUDE.md。
// --system-prompt-file 是整份替换：一行字的系统提示词用量约 550 token，不给它是三万多。
// 续会话一律 --resume <上一次成功的会话> --fork-session：每次调用都分叉出一个新会话，失败的那一次只留在它自己的分叉里，
// 重试从失败之前的那个点再分叉——作废的回复（模型不对、空的）不会进老师的上下文。续上时系统提示词还在，所以只在第一轮带文件。
// 不带 --fallback-model：讲课的老师只能是 claude-opus-5-5，换了模型就不是同一把尺子。
export function cliArgs({ model, effort, systemFile, resume }) {
  const a = ['-p', '--output-format', 'json', '--model', model];
  if (effort) a.push('--effort', effort);
  if (resume) a.push('--resume', resume, '--fork-session');
  else if (systemFile) a.push('--system-prompt-file', systemFile);
  a.push('--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands');
  return a;
}

// 子进程只拿这些环境变量：跑课的命令行如果继承了开发会话自己的变量（会话编号、上报地址、用户邮箱、提交署名的规矩……），
// 会把这些说明带进模型的上下文（实测多一千多 token），还可能往开发会话那边上报。登录用的是用户目录下存的凭据，不靠变量。
const ENV_KEEP = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NO_PROXY', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'ANTHROPIC_BASE_URL'];
export function cleanEnv(env) {
  const out = {};
  for (const k of ENV_KEEP) if (env[k] !== undefined) out[k] = env[k];
  return out;
}

/** 调用的报错是不是撞了用量上限（这时不重试、不算失败，停下等接着跑）。
 * 只认用量的措辞：「Context limit reached」这类上下文超限每次接着跑都会再撞、会把一整套挡住，
 * overloaded_error 是服务器临时过载、重试一次通常就好——这两种走普通的「重试一次，再不行算失败」。 */
export const isUsageLimit = (text) => /\b429\b|rate_limit_error|usage limit|hit your [^.\n]{0,40}limit|too many requests/i.test(String(text ?? ''));

/** 命令行把一个目录下的会话存在 ~/.claude/projects/<目录名里非字母数字都换成 -> 下（实测 /tmp/tmp.xA6J → -tmp-tmp-xA6J） */
export const projectDirOf = (cwd) => String(cwd).replace(/[^A-Za-z0-9]/g, '-');

/** 一整套重跑时这一节怎么办：跑完了的跳过，停下的、失败了的接着跑，别的从头。
 * 在 init 那一步失败的（场景校验不过）还没有 scenario.json、没有可接的东西：从头跑，场景改好了才跑得下去 */
export function resumeAction(run, code) {
  if (!run || run.phase === 'init') return 'fresh';
  if (run.ok === true && run.phase === 'done' && (code === undefined || code === 0)) return 'skip';
  if (run.paused || run.failed) return 'continue';
  return 'fresh';
}

/** 扮学生的说明：只拿人设和会什么；板面每一轮由页面给（view.md），答案它看不到 */
export function studentSystem(sc) {
  return `你在一节模拟课里扮演一个考研的学生。老师看不到你本人，只看得到你说的话和你在黑板上的作答。

## 你是谁

${sc.persona}

## 上这节课以前你会什么、不会什么

${sc.know}

## 规矩

- 只会上面写着会的。别的内容要等这节课老师真讲了、真让你做了才会；没教到的就是不会——宁可答错、说不懂、放弃，也不要拿你自己本来知道的知识去答。
- 设定里如果有误解，前后一致地照着它想、照着它答，不主动说出来；老师问到能暴露它的具体问题时，照着误解把你的想法说出来。老师讲清楚、你真被说服了，之后才改过来。
- 说话简短，像真的学生：不客套、不复述老师的话、不替老师总结。
- 每一轮你会收到黑板上现在写着什么。只回一个 JSON，前后不要别的字：
  {"say": "对老师说的话，可以是空字符串", "acts": [{"comp": "组件 id", "value": "答案或选项的文字"}], "sure": {"组件 id": true 或 false}, "note": "笔记"}
  - comp 是黑板上【…】里写的那个组件 id；没有要做的题时 acts 写 []。
  - 不会做的题写 {"comp": "组件 id", "giveup": true}。
  - sure：答了的题有没有把握，没把握写 false；可以不写。
- 老师明确说这节课到这里了、板上也没有留给你做的东西时，在 JSON 里加 "end": true（可以同时在 say 里说一句话），这节课就结束了。老师还在讲、还有题没做、你自己还有没弄懂想问的，都不要结束。
- note 是你的笔记本。下课后有一份课后测验，那时你只能看这本笔记，看不到黑板。note 只记这一轮老师真讲了的、真让你做了的，一两句；这一轮没有就写空字符串。不要记你本来就知道的，也不要记黑板上没出现过的。
`;
}

/** 课后测验的学生：一个新会话，只拿人设、原来会什么、这本笔记（误解、评分细则、上课的记录都不给） */
export function posttestSystem(sc, notebook) {
  const book = String(notebook ?? '').trim();
  return `你在做一份课后测验，扮演一个考研的学生。

## 你是谁

${sc.persona}

## 上课以前你会什么、不会什么

${sc.know}

## 你上课时记的笔记

${book || '（笔记本是空的）'}

## 规矩

- 只能用上面这三样里有的东西答题：你是谁、上课以前会的、这本笔记。笔记里没有、上课以前也不会的，就写「不会」；不许用你自己本来知道的任何别的知识，也不许凭感觉凑一个答案。
- 照题号一道一道答：先写一行「## 题号」，下面写答案；要过程的写过程。
`;
}

/** 从模型的回复里取出 JSON 对象：可能包在代码块里、前后有话；取不出返回 null */
export function extractJson(text) {
  const s = String(text ?? '');
  const tryParse = (x) => { try { const v = JSON.parse(x); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };
  for (const m of s.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n?```/g)) { const v = tryParse(m[1].trim()); if (v) return v; }
  // 从每个 { 起找配对的 }（跳过字符串里的括号），第一个读得通的就是
  for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { const v = tryParse(s.slice(i, j + 1)); if (v) return v; break; }
    }
  }
  return null;
}

/** 学生的回复 → teach-sim student 收的样子；读不出给原因（带着原因重问一次） */
export function studentReply(text) {
  const o = extractJson(text);
  if (!o) return { error: '回复里没有读得出的 JSON 对象' };
  if (o.acts !== undefined && !Array.isArray(o.acts)) return { error: 'acts 要是数组' };
  const acts = o.acts || [];
  const bad = acts.findIndex((a) => !a || typeof a !== 'object' || typeof a.comp !== 'string' || !a.comp);
  if (bad >= 0) return { error: `acts 的第 ${bad + 1} 项没有 comp（组件 id）` };
  const value = { say: typeof o.say === 'string' ? o.say : '', acts };
  if (o.sure && typeof o.sure === 'object' && !Array.isArray(o.sure)) value.sure = o.sure;
  if (typeof o.note === 'string' && o.note.trim()) value.note = o.note;
  if (o.end === true) value.end = true;
  return { value };
}

// run（目录名）、plan（计划块开没开）可能带着是哪一版规则，评卷人不该看到
const blindMetrics = (m) => { const { run, plan, ...rest } = m ?? {}; return rest; };

/** 评卷的说明（设计 6.8 的几项）。不说是哪一版规则，评卷人只看这节课本身 */
export function graderPrompt({ transcript, scenario, key, answers, metrics }) {
  const sc = scenario || {};
  const aims = (sc.aims || []).map((a) => `- ${a.id}：${a.can}（怎样算会：${a.proof}）`).join('\n');
  return `你是一节模拟课的评卷人。老师是一个模型，学生是另一个模型照设定演的；两边都经过一个「页面」，页面把老师的黑板指令画成板面、给学生作答判分。下面是这节课的全部材料，照最后的几项打分，只回一个 JSON。

# 场景

- 科目：${sc.subject || ''}
- 学生的设定：${sc.persona || ''}
- 上课以前会什么、不会什么：${sc.know || ''}
- 设定的断点（学生的误解或卡住的地方）：${sc.misconception || '（没有设定误解）'}
- 评分细则：${sc.rubric || '（没有）'}
- 这节课要拿下的事：
${aims || '（没有）'}

# 页面量出来的数

分钟按学生用掉的时间算（读每分钟 400 字、点一下 10 秒、写一行 30 秒、等老师每轮 8 秒）。clockByTurn 是每一轮结束时课上过了几分钟，seq 对应下面记录里的「第 N 轮」。

\`\`\`json
${JSON.stringify(blindMetrics(metrics), null, 1)}
\`\`\`

# 整节课的记录

${transcript}

# 课后测验的标准答案

${key}

# 学生的课后测验作答

课后测验是一个新的学生会话做的，只拿到了学生的设定、上课以前会的、上课时记的笔记。

${answers}

# 打这几项

- post：每道课后题一项 {"id": 题号, "score": 0 / 0.5 / 1}，照标准答案判：全对 1，对了一半或过程对结果错 0.5，错或写「不会」0。题号照标准答案。
- found：老师在第几分钟用一个具体的问题把设定的断点问出来、并且看出了学生是怎么想的（按 clockByTurn 换成分钟，一位小数）；一直没问出来写 null。没有设定误解时写学生第一次暴露出不会的地方的分钟，没有就 null。
- targeted：问出来以后是不是针对那一处讲：3 = 只讲错的那一步、用一个具体例子说服；2 = 针对了但讲得多；1 = 整段重讲定义。没问出来写 null。
- onlyGap：学生做错以后老师是不是只补了那一处（true / false），没问出来写 null。
- contentErrors：老师讲的内容里错了几处（概念、计算、口径），讲漏了要紧的也算一处；没有写 0。
- verdictAgree：老师自己判的开放作答（页面判不了、老师说学生对或错的）里，和你判得一致的占几成（0～1 的小数）；老师没判过开放作答写 null。
- skipped：评分细则里要看老师有没有跳过学生已经会的内容时，写 true（跳过了）或 false（又从头讲了）；细则里没有这一项写 null。
- overall：总体 1～5 的整数。
- why：一两句话说总体分的理由，举出轮次。

只回这一个 JSON，前后不要别的字：
{"post": [{"id": "p1", "score": 1}], "found": 6.5, "targeted": 3, "onlyGap": true, "contentErrors": 0, "verdictAgree": null, "skipped": null, "overall": 4, "why": "…"}
`;
}

// 和 teach-sim-lib.mjs 的 ENDED_BY 同一份（那边不能被这里 import：会把页面的依赖拉进来）
const ENDED_BY = { student: '学生说下课', idle: '空转停下', time: '到时间', rounds: '写满 40 轮' };

/** 这一次调用花了多少：命令行返回的 total_cost_usd 是这条会话（连同分叉出来的前身）到现在的累计数，减去上一次成功调用的累计数才是这一次的 */
export const callCost = (total, lastTotal) => Math.max(0, (Number(total) || 0) - (Number(lastTotal) || 0));

const nullable = (v, ok) => v === undefined || v === null || ok(v);

/** 读评卷的结果；字段不对返回 null（跑课的脚本带着「读不出」重问一次） */
export function parseGrade(text) {
  const o = extractJson(text);
  if (!o || !Array.isArray(o.post) || !o.post.length) return null;
  if (!o.post.every((p) => p && typeof p.id === 'string' && [0, 0.5, 1].includes(p.score))) return null;
  if (!Number.isInteger(o.overall) || o.overall < 1 || o.overall > 5 || typeof o.why !== 'string') return null;
  if (!Number.isInteger(o.contentErrors) || o.contentErrors < 0) return null;
  if (!nullable(o.found, (v) => typeof v === 'number' && v >= 0)) return null;
  if (!nullable(o.targeted, (v) => [1, 2, 3].includes(v))) return null;
  if (!nullable(o.onlyGap, (v) => typeof v === 'boolean')) return null;
  if (!nullable(o.verdictAgree, (v) => typeof v === 'number' && v >= 0 && v <= 1)) return null;
  if (!nullable(o.skipped, (v) => typeof v === 'boolean')) return null;
  const n = (v) => (v === undefined ? null : v);
  return { post: o.post.map((p) => ({ id: p.id, score: p.score })), found: n(o.found), targeted: n(o.targeted), onlyGap: n(o.onlyGap), contentErrors: o.contentErrors, verdictAgree: n(o.verdictAgree), skipped: n(o.skipped), overall: o.overall, why: o.why };
}

/** 一整套里的一节 → 表的一行；没跑完的只写停在哪 */
export function summaryRow({ scenario, run, metrics, grade }) {
  const id = scenario?.id || run?.scenario || '?';
  if (!run?.ok || !grade || !metrics) {
    const at = Number.isInteger(run?.stoppedAt) ? `停在第 ${run.stoppedAt} 轮${run.stoppedWhat ? `（${run.stoppedWhat}）` : ''}` : run?.stoppedWhat || (run ? '没写停在哪' : '没有 run.json');
    return { id, failed: `${run?.paused ? '暂停（用量上限）' : '没跑完'}：${at}`, costUsd: run?.costUsd ?? null };
  }
  const kind = new Map((scenario?.posttest || []).map((p) => [p.id, p.kind]));
  const sum = (k) => grade.post.filter((p) => kind.get(p.id) === k).reduce((a, p) => a + p.score, 0);
  const of = (k) => [...kind.values()].filter((v) => v === k).length;
  return {
    id, near: sum('near'), nearOf: of('near'), far: sum('far'), farOf: of('far'),
    minutes: metrics.minutes, wastedStops: metrics.wastedStops, firstProduceMin: metrics.firstProduceMin,
    longestPassiveMin: metrics.longestPassiveMin, produceMin: metrics.produceMin, endedBy: metrics.endedBy ?? null, overall: grade.overall,
    costUsd: run.costUsd ?? null,
  };
}

/** 一整套的表（summary.md）：行为的数和课后测验并排，不单独报行为的数（设计 6.8） */
export function summaryMd(rows, arm) {
  const v = (x) => (x === null || x === undefined ? '—' : x);
  const lines = [
    `# 教学尺子 · ${arm}`, '',
    '| 场景 | 同类 | 迁移 | 分钟 | 白停 | 第一次动笔（分） | 最长连讲（分） | 产出（分） | 怎么下课的 | 总体 |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    if (r.failed) lines.push(`| ${r.id} | ${r.failed} |||||||||`);
    else lines.push(`| ${r.id} | ${r.near} / ${r.nearOf} | ${r.far} / ${r.farOf} | ${v(r.minutes)} | ${v(r.wastedStops)} | ${v(r.firstProduceMin)} | ${v(r.longestPassiveMin)} | ${v(r.produceMin)} | ${v(ENDED_BY[r.endedBy])} | ${r.overall} |`);
  }
  const cost = rows.reduce((a, r) => a + (r.costUsd || 0), 0);
  lines.push('', `一共 ${rows.length} 节，跑完 ${rows.filter((r) => !r.failed).length} 节，花了约 $${cost.toFixed(2)}。`);
  return lines.join('\n') + '\n';
}

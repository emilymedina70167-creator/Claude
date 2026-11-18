// 外部主讲叫页面里的 Claude 来接（需求 R1，学习台 dev_requests/dr-ext-control）：
//
//   ````board claude id=cl1 on=wrong target=q1 to=board turns=2
//   see: target, board, evidence=last3
//   can: say, mark
//   <<<
//   （外部写给它的话，任意长）
//   >>>
//   ````
//
// 外部写好给它的话、它能看到什么、它能做什么、结果放哪；什么时候叫它也由外部写。页面只照着做：
// 到了那件事就调一次 Opus 5.5 high，按 can 执行它写的、越权的不执行，全文和用量进下一份 ext_out。
// 这里是不碰 DOM 的那一半：解析、触发、拼给它的那一条、按 can 过滤。tests/class-delegate.test.js
import { tokenize } from '../tokens.js';

// 学生在那一题上的事
export const DELEGATE_EVENTS = ['submit', 'wrong', 'right', 'giveup', 'stuck', 'say', 'draft'];
// 它这一次能做的：指令 → 归哪一种能力（不在表里的指令它一律不能写：pin、aims、close、claude……）
export const CAN = ['say', 'add', 'replace', 'hide', 'mark', 'figure', 'react', 'new', 'stage', 'widget', 'memo', 'note', 'judge'];
const OP_CAN = { add: 'add', show: 'add', move: 'add', replace: 'replace', edit: 'replace', hide: 'hide', mark: 'mark', unmark: 'mark', figure: 'figure', react: 'react', why: 'react', new: 'new', layout: 'new', stage: 'stage', widget: 'widget', memo: 'memo', note: 'note', judge: 'judge' };
export const SEE = ['target', 'board', 'evidence', 'books', 'memory', 'ext'];
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,64}$/;
export const HELPER_MAX = 20; // 同一个 id 一节课最多叫几次（turns 写得再大也到这里为止）

const msOf = (v) => {
  const m = String(v ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|秒|m|分钟?)?$/i);
  if (!m) return NaN;
  const n = Number(m[1]), u = (m[2] || 's').toLowerCase();
  return Math.round(u === 'ms' ? n : u === 'm' || u.startsWith('分') ? n * 60000 : n * 1000);
};
const list = (v) => String(v ?? '').split(/[|,，、\s]+/).map((x) => x.trim()).filter(Boolean);

/**
 * 读 board claude 的开头那行 + 块里的内容 → { op: 'claude', id, when: 'now' | 'on', on, target, stuck, to, turns, until, see, can, prompt }
 * 写错时 { error }
 */
export function parseClaude(head = '', body = '') {
  const kv = {};
  const loose = [];
  for (const t of tokenize(String(head))) { if (t.key) kv[t.key.toLowerCase()] = t.value; else loose.push(t.value); }
  const id = kv.id || loose.find((x) => ID_RE.test(x) && !DELEGATE_EVENTS.includes(x) && x !== 'now');
  if (!id) return { error: '要写 id：board claude id=cl1 …（收回时 board claude-off id=cl1）' };
  if (!ID_RE.test(id)) return { error: `id「${id}」不合法：只能用字母、数字和 _ - . ~ : @ +` };
  // 什么时候叫：when=now（执行这一轮时叫一次）；on=wrong|giveup（学生在 target 那题上出这件事时叫）；stuck=90s（那题这么久没动静）
  let on = list(kv.on || (kv.when && kv.when !== 'now' ? kv.when.replace(/^on[=:]/, '') : '')).map((x) => x.toLowerCase());
  const bad = on.filter((x) => !DELEGATE_EVENTS.includes(x));
  if (bad.length) return { error: `on= 只认 ${DELEGATE_EVENTS.join(' / ')}，看不懂「${bad.join('、')}」` };
  let stuck = 0;
  if (kv.stuck !== undefined) {
    stuck = msOf(kv.stuck);
    if (!(stuck >= 10000)) return { error: 'stuck= 写多久没动静，至少 10s：比如 stuck=90s' };
    if (!on.includes('stuck')) on = [...on, 'stuck'];
  }
  if (on.includes('stuck') && !stuck) stuck = 90000;
  const when = on.length ? 'on' : 'now';
  const target = kv.target || '';
  if (target && !ID_RE.test(target)) return { error: `target「${target}」不合法` };
  if (when === 'on' && !target && on.some((x) => x !== 'say')) return { error: '学生在哪一题上：on= 要配 target=题的 id（只有 on=say 不用）' };
  // 结果去哪：board（照 can 执行到板上）/ ext（不上板，只写进 ext_out）/ db=集合/文档（写成一条数据）
  let to = { kind: 'board' };
  const rawTo = kv.to || '';
  if (kv.db || /^db[:=]/i.test(rawTo)) {
    const path = String(kv.db || rawTo.replace(/^db[:=]/i, '')).replace(/^\/+|\/+$/g, '');
    if (path.split('/').length % 2 !== 0 || !path) return { error: 'to=db 要写文档的路径（集合/文档，段数是双数）：比如 to=db:drafts/cl1 或 db=drafts/cl1' };
    to = { kind: 'db', path };
  } else if (rawTo && rawTo !== 'board' && rawTo !== 'ext' && rawTo !== 'db') return { error: 'to= 只认 board / ext / db:集合/文档' };
  else if (rawTo === 'ext') to = { kind: 'ext' };
  else if (rawTo === 'db') return { error: 'to=db 要写文档的路径：to=db:集合/文档' };
  const turns = kv.turns !== undefined ? Number(kv.turns) : when === 'now' ? 1 : 3;
  if (!(Number.isInteger(turns) && turns >= 1)) return { error: 'turns= 写正整数：这一条最多被叫几次' };
  const until = (kv.until || 'turns').toLowerCase();
  if (!['right', 'turns', 'me'].includes(until)) return { error: 'until= 只认 right（学生答对为止）/ turns（次数用完）/ me（外部收回为止）' };
  // 块里：see: / can: 两行，然后 <<< 写给它的话 >>>（没写 <<< 时，其余的行都是写给它的话）
  const lines = String(body ?? '').replace(/\r/g, '').split('\n');
  let see = [], can = [], prompt = '';
  const rest = [];
  let inPrompt = false;
  const promptLines = [];
  for (const line of lines) {
    if (inPrompt) { if (/^\s*>>>\s*$/.test(line)) { inPrompt = false; continue; } promptLines.push(line); continue; }
    if (/^\s*<<<\s*$/.test(line)) { inPrompt = true; continue; }
    const m = line.match(/^\s*(see|can)\s*[:：]\s*(.*)$/i);
    if (m) { (m[1].toLowerCase() === 'see' ? see : can)
      .push(...m[2].split(/[,，、]|\s+/).map((x) => x.trim()).filter(Boolean)); continue; }
    rest.push(line);
  }
  if (inPrompt) return { error: '写给它的话以 <<< 开头，要以单独一行 >>> 结尾' };
  prompt = (promptLines.length ? promptLines : rest).join('\n').trim();
  if (!prompt) return { error: '要写给它的话：块里 <<< 和 >>> 之间' };
  const seeOut = {};
  for (const s of see.length ? see : ['target']) {
    const [k, ...v] = s.split('=');
    const key = k.toLowerCase();
    if (!SEE.includes(key)) return { error: `see: 只认 ${SEE.join(' / ')}（evidence=last3、books=条目范围、memory=类/编号 带参数），看不懂「${s}」` };
    seeOut[key] = v.join('=') || true;
  }
  const canOut = (can.length ? can : ['say']).map((x) => x.toLowerCase());
  const badCan = canOut.filter((x) => !CAN.includes(x));
  if (badCan.length) return { error: `can: 只认 ${CAN.join(' / ')}，看不懂「${badCan.join('、')}」` };
  return { op: 'claude', id, when, on, ...(target ? { target } : {}), ...(stuck ? { stuck } : {}), to, turns: Math.min(turns, HELPER_MAX), until, see: seeOut, can: [...new Set(canOut)], prompt };
}

/** board claude-off id=cl1 / board claude-off all */
export function parseClaudeOff(head = '') {
  const toks = tokenize(String(head));
  const id = toks.find((t) => t.key === 'id')?.value || toks.find((t) => !t.key)?.value || '';
  if (!id) return { error: '要写收回哪一条：board claude-off id=cl1，全收：board claude-off all' };
  return { op: 'claude-off', id };
}

/**
 * 这件事该不该叫这一条：rule（parseClaude 的结果 + fired 叫过几次 + off）、ev = { kind, target }。
 * 返回 true / false
 */
export function shouldFire(rule, ev, { stopped = false } = {}) {
  if (!rule || rule.off || stopped) return false;
  if ((rule.fired || 0) >= rule.turns) return false;
  if (rule.until === 'right' && rule.gotRight) return false;
  if (rule.when !== 'on') return false;
  if (!rule.on.includes(ev?.kind)) return false;
  if (ev.kind === 'say') return !rule.target || !ev.target || ev.target === rule.target;
  return !!rule.target && String(ev.target) === String(rule.target);
}

/** 学生一条动作（课堂的 a：source / type / ok / giveup / block）→ 这几件事（一条可以同时是 submit 和 wrong） */
export function eventsOf(a) {
  if (!a) return [];
  const target = String(a.block || '');
  if (a.source === 'record') {
    if (a.liveOnly) return [];
    const out = [{ kind: 'submit', target }];
    if (a.giveup || a.revealed) out.push({ kind: 'giveup', target });
    else if (a.ok === false) out.push({ kind: 'wrong', target });
    else if (a.ok === true) out.push({ kind: 'right', target });
    return out;
  }
  if (a.source === 'event' && (a.type === 'giveup' || a.type === 'reveal-answer')) return [{ kind: 'giveup', target }];
  return [];
}

/** 它写的指令按 can 分：能执行的、不能的（带原因）。说的话归 say */
export function filterOps(ops = [], can = []) {
  const allow = [], refused = [];
  for (const o of ops || []) {
    const need = OP_CAN[o.op];
    if (need && can.includes(need)) allow.push(o);
    else refused.push({ op: o.op, id: o.id || o.target || '', why: need ? `外部这一次没给它 ${need}` : `${o.op} 不归助手写` });
  }
  return { allow, refused };
}

/** 它回的最后有一行「[交回] 原因」：不回学生，交回给外部 */
export function handBack(text = '') {
  const m = String(text).match(/^\s*\[交回\]\s*(.*)$/m);
  return m ? (m[1].trim() || '（没写原因）') : '';
}

export const HELPER_HEAD = '你在学习台的黑板上给学生当助手。这节课的主讲是 claude.ai 对话里的另一个 Claude（下面叫「主讲」），它此刻不在场，把这一下交给你。下面是主讲写给你的话、页面给你的材料、学生刚才做的事。';

/**
 * 给它的那一条：主讲的话 → 这一次为什么叫你 → 它能做的写法 → 材料（see 点了名的那几样，页面现拼好传进来）
 * can：这一次能做的；doc：黑板指令的写法（页面传，发布时和页面里的老师同一份）
 */
export function helperPrompt({ rule, ev = null, materials = [], doc = '' } = {}) {
  const can = rule?.can || ['say'];
  const why = !ev || ev.kind === 'now' ? '主讲写这一条的时候让你马上来一次。'
    : ev.kind === 'stuck' ? `学生在 ${rule.target} 上 ${Math.round((rule.stuck || 0) / 1000)} 秒没动静。`
      : `学生在 ${ev.target || rule.target || '黑板'} 上：${{ submit: '交了作答', wrong: '答错了', right: '答对了', giveup: '想不出来 / 看了答案', say: '打了字', draft: '写着还没交' }[ev.kind] || ev.kind}。`;
  return [
    HELPER_HEAD,
    `主讲写给你的话：\n${String(rule?.prompt || '').trim()}`,
    `这一次：${why}${ev?.text ? `\n${ev.text}` : ''}`,
    `你这一次能做的：${can.join('、')}。${can.includes('say') ? '说的话直接写（写在板顶）。' : '这一次不说话（写了也不显示）。'}${can.some((c) => c !== 'say') ? '别的写成 board 块（写法在下面）；不在这几样里的指令页面不执行。' : ''}${rule?.to?.kind === 'ext' ? '\n这一次你写的不上板，原样交给主讲看。' : rule?.to?.kind === 'db' ? `\n这一次你写的全文存进 ${rule.to.path}，不上板。` : ''}`,
    '要是这一下超出了主讲给你的范围，不回学生，最后单独写一行：[交回] 原因。',
    ...materials.filter(Boolean),
    ...(doc && can.some((c) => c !== 'say') ? [`黑板指令的写法：\n${doc}`] : []),
  ].join('\n\n');
}

/** 写进 ext_out 的那几行：[助手 cl1] …（全文、执行了哪些、没执行的、用量） */
export function helperLines({ id, ev = null, text = '', done = [], refused = [], back = '', usage = null, error = '' } = {}) {
  const head = `[助手 ${id}]${ev && ev.kind !== 'now' ? `（${ev.kind}${ev.target ? ` ${ev.target}` : ''}）` : ''}`;
  if (error) return [`${head} 没叫成：${error}`];
  return [
    `${head} ${back ? `交回给主讲：${back}` : '回了：'}`,
    ...String(text || '').trim().split('\n').map((l) => `  ${l}`),
    ...(done.length ? [`${head} 执行了：${done.join('、')}`] : []),
    ...(refused.length ? [`${head} 没执行（越权）：${refused.map((r) => `${r.op}${r.id ? ` ${r.id}` : ''}（${r.why}）`).join('、')}`] : []),
    ...(usage ? [`${head} 用量：发出 ${Math.round((usage.bytes || 0) / 1024)} KiB，等了 ${Math.round((usage.ms || 0) / 100) / 10} 秒${usage.tools ? `，调了 ${usage.tools} 次工具` : ''}`] : []),
  ];
}

/** 刷新以后从课堂记录放回：每一条 board claude（最后写的为准）+ 叫过几次 + 收回过没有 */
export function rebuildHelpers(history = []) {
  const rules = new Map();
  for (const t of history || []) {
    if (!t || t.discarded) continue;
    for (const o of t.boardOps || []) {
      if (o?.op === 'claude' && o.ok && o.rule) rules.set(o.rule.id, { ...o.rule, fired: 0, off: false, gotRight: false });
      if (o?.op === 'claude-off' && o.ok) for (const r of rules.values()) if (o.id === 'all' || r.id === o.id) r.off = true;
    }
    if (t.kind === 'helper' && t.helper && rules.has(t.helper)) rules.get(t.helper).fired += 1;
  }
  return rules;
}

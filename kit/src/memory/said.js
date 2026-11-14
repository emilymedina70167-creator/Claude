// 话的账（第十一轮，docs/superpowers/specs/2026-11-14-round11-design.md 6.2）：我在课上打的每一句话都有去处——
// 记成「我的要求」（asks）的哪一条、关于我、只管这一节、或者不用记和为什么。理解交给 Claude，兜底交给这里的代码：
// 每句都要有去处、引的编号要真有、原话由页面从证据抄。纯函数，有测试（tests/memory-said.test.js、tests/memory-asks.test.js）。

/** 下一个要求的编号：A-1、A-2…（接着已有的最大号，作废了的也占号） */
export function nextAskId(asks = []) {
  const n = Math.max(0, ...asks.map((a) => Number(String(a?.id || '').match(/^A-(\d+)$/)?.[1] || 0)));
  return `A-${n + 1}`;
}

import { applyChange, toDate } from './schema.js';

export const SAID_VERSION = 1;
// 页面在我那句话后面加的尾巴（舞台 stage/evidence.js 的 actEvidence）：去掉以后才是我打的字
const TAIL = /\s*（(?:在画面上用 Pencil 写了字|附了 \d+ 张图)）\s*/g;
const TO = { 新要求: 'new', 又说了: 'again', 已记: 'known', 改了: 'change', 不用了: 'drop', 关于我: 'me', 这一次: 'once', 不用记: 'skip' };
const NEED_ASK = new Set(['again', 'known', 'change', 'drop']);
const SCOPES = new Set(['all', 'math', 'cs', 'en']);
const MEASURES = new Set(['overlap']);
const one = (s, n = 300) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const isTeacher = (t) => t && !t.discarded && t.role !== 'student' && t.role !== 'system';

/**
 * 这节课还没过账的话：src: say、at > upTo、不在 done（已经有去处的）里，按时间排。
 * 去掉页面加的尾巴以后没字的（只有 Pencil、只有图）进 photos：不调用，记「图，没读」
 */
export function saidItems(evidence = [], sid = '', upTo = 0, done = new Set()) {
  const items = [];
  const photos = [];
  const mine = evidence.filter((e) => e && e.src === 'say' && String(e.session || '') === String(sid) && Number(e.at || 0) > upTo && !done.has(String(e.id)))
    .sort((a, b) => (a.at || 0) - (b.at || 0));
  for (const e of mine) {
    const text = String(e.text || '').replace(TAIL, ' ').trim();
    if (!text) photos.push(String(e.id));
    else items.push({ ev: String(e.id), at: Number(e.at || 0), text, ...(e.turn != null ? { turn: e.turn } : {}) });
  }
  return { items, photos };
}

/** 我说这句之前老师最后说的、之后老师第一次接的（按时间找；截短） */
function around(turns, at) {
  const teach = turns.filter(isTeacher).sort((a, b) => (a.at || 0) - (b.at || 0));
  let before = null;
  let after = null;
  for (const t of teach) { if ((t.at || 0) <= at) before = t; else { after = t; break; } }
  return { before: before ? one(before.text) : '', after: after ? one(after.text) : '' };
}

/**
 * 给话的账那个 Claude 的提示词。items：saidItems 的；asks：现在的要求（只列在用的）；profile、lessons：只给标题免得重复记；
 * turns：这节课的 class_turns（找每句前后老师说了什么）；earlier：这节课前面已经过过的去处 { 证据编号: [去处] }
 */
// recent：最近几节课记成「这一次」的 [{ text, date }]：隔几节课又说同样的意思，就该记成要求（单看一节课看不出来）
export function saidPrompt({ items = [], asks = [], profile = [], lessons = [], turns = [], earlier = {}, recent = [] } = {}) {
  const live = asks.filter((a) => a.status === 'active');
  const lines = items.map((x) => {
    const c = around(turns, x.at);
    return [`### ${x.ev}（${new Date(x.at).toISOString().slice(0, 16).replace('T', ' ')}）`, `学生打的：${x.text}`,
      c.before ? `这之前老师说的：${c.before}` : '', c.after ? `这之后老师接的：${c.after}` : ''].filter(Boolean).join('\n');
  });
  const prev = Object.entries(earlier).map(([id, ls]) => `- ${id}：${(ls || []).map((l) => `${l.to}${l.ask ? ` ${l.ask}` : ''}`).join('、')}`);
  return [
    '你在给一位考研学生的学习台记账。学生在课上打的每一句话，你都要给出去处：要老师以后照做的要求、纠正、期望记成「学生的要求」；关于学生自己的事实记进「关于学生」；只管这一节课的单独记；别的写不用记和为什么。',
    '学生说过：「我说了什么，下一次都肯定会改」。漏掉一句要求，学生就得再说一遍——那是失败。也别把提问、作答、闲话记成要求，记多了老师读到的全是噪音。',
    '## 怎么判断',
    '- 新要求：学生要老师以后上课都这样做或别这样做（「例题能不能先给答案再讲啊，每次都猜半天」→ 例题先给答案再讲过程；「别每讲一步就问我懂没懂」；「字太小了我看不清」→ 字放大）。抱怨、反问里的要求也算。',
    '- 又说了：说的是已经有的一条要求。老师没照做所以学生又说，写 why=没照做；学生只是附和、重申、顺口提到，写 why=附和。',
    '- **写新要求之前，把「现在学生的要求」一条条对一遍**：是不是同一条，这样判断——假如老师一直照那一条做，学生这一句还会不会说出来？不会，就是同一条（写又说了，哪怕换了说法、说得更宽或更窄）；会，就不是同一条，哪怕两条都沾点边（都和「别浪费时间」「版面」有关）。同一件事分成好几条，老师看不出学生说了几遍；不同的事挤进一条，老师照做了也解决不了。',
    '- 已记：这一句说的那条，就是这节课刚记下的（老师或你前面记的）。',
    '- 改了：学生改口了已有的那一条（以前说放角落，现在说放中间）。text= 写改过以后的完整要求。',
    '- 不用了：学生说那一条不用再照做了。',
    '- 关于我：关于学生的事实，不是要老师照做的规矩（「下个月期末，只有周末有空」「我高中物理还行」）。',
    '- 这一次：只管这一节课、这一刻的安排（「今天先到这吧」「这题先跳过」「先讲第三节」「我这节是在测试，你接着走」）：说的是现在怎么办，不是以后每节课都要怎样。写这一次之前，先看下面「最近几节课记成这一次的」：同一个意思隔了一节课以上又出现，说明不只是这一次，记成新要求（或者又说了已有的那一条）。下课、结束、继续这类本来就是此刻的安排，不算。',
    '- 不用记：提问（「这个词什么意思」「定语从句是什么」）、作答（翻译、填空、选项）、报页面的毛病（「点了没反应」「这里卡住了」：开发会看，不是要老师照做的）、闲话、「继续」「好了」。why= 写一句为什么。',
    '- 一条消息里有几件事就写几行（一个要求加一句反问：一行新要求、一行不用记）。每条消息至少一行。',
    '- text= 用你自己的话把要求写清楚，让以后照做的老师一看就懂；不要照抄学生的原话（原话页面会自己附上）。',
    '- scope=：要求管全部科目写 all，只管一科写 math / cs / en。和画面重叠有关的要求加 measure=overlap（页面会自己量）。',
    `## 现在学生的要求（${live.length} 条）`,
    live.length ? live.map((a) => `- ${a.id}：${one(a.text, 200)}`).join('\n') : '（还没有）',
    profile.length ? `## 关于学生已经记着的事实（只列标题，别重复记成关于我；要求不记在这里）\n${profile.map((p) => `- ${p.id} ${one(p.topic, 20)}：${one(p.text, 60)}`).join('\n')}` : '',
    lessons.length ? `## 老师自己的守则（只列标题；学生说的要求就算守则里已经有，也照样记成学生的要求——守则是老师自己归纳的，要求是学生亲口说的）\n${lessons.map((l) => `- ${l.id}：${one(l.text, 60)}`).join('\n')}` : '',
    prev.length ? `## 这节课前面已经记过的去处\n${prev.join('\n')}` : '',
    recent.length ? `## 最近几节课记成「这一次」的（同样的意思又出现了，就不只是这一次：记成新要求）\n${recent.slice(-20).map((o) => `- ${o.date || ''} ${one(o.text, 100)}`).join('\n')}` : '',
    `## 这一次要记的 ${items.length} 条消息`,
    lines.join('\n\n'),
    '## 回答的格式（只写这些行，一行一个去处）',
    '编号｜新要求｜text=…｜scope=all|math|cs|en｜measure=overlap（可省）',
    '编号｜又说了｜A-…｜why=没照做|附和',
    '编号｜已记｜A-…（这一次里前面刚记成新要求的那一条还没有编号：写那一句的编号，比如 已记｜ev-…）',
    '编号｜改了｜A-…｜text=…',
    '编号｜不用了｜A-…｜why=…',
    '编号｜关于我｜topic=…｜text=…',
    '编号｜这一次｜text=…',
    '编号｜不用记｜why=…',
  ].filter(Boolean).join('\n\n');
}

/** 读回答：{ lines: { 证据编号: [{ to, ask?, text?, scope?, measure?, why?, topic? }] }, missing, problems }。只收 ids 里的编号、指着在用的要求 */
export function parseSaid(text = '', { ids = new Set(), asks = [] } = {}) {
  const live = new Set(asks.filter((a) => a.status === 'active').map((a) => String(a.id)));
  const lines = {};
  const problems = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*•]\s*/, '');
    if (!line || !/[｜|]/.test(line)) continue; // 回答里的别的话（标题、说明）不算
    const f = line.split(/\s*[｜|]\s*/);
    const [ev, kind, ...rest] = f;
    const to = TO[kind];
    if (!ids.has(ev)) { problems.push(`${ev} 不是这一次要记的消息`); continue; }
    if (!to) { problems.push(`${ev}：看不懂的去处「${kind}」`); continue; }
    const out = { to };
    for (const r of rest) {
      const m = r.match(/^([a-z]+)\s*=\s*([\s\S]*)$/);
      if (m) out[m[1]] = m[2].trim();
      else if (/^A-\w+$/.test(r)) out.ask = r;
      // 这一批里前面刚记成新要求的那句（还没有编号）：用那句的证据编号指它，读完整批再核
      else if (/^ev-/.test(r) && ids.has(r) && r !== ev) out.askEv = r;
    }
    if (NEED_ASK.has(to) && !out.askEv && !live.has(out.ask)) { problems.push(`${ev}：${kind}指着的 ${out.ask || '（没写编号）'} 不是在用的要求`); continue; }
    if ((to === 'new' || to === 'change' || to === 'me' || to === 'once') && !out.text) { problems.push(`${ev}：${kind}没写 text=`); continue; }
    if (to === 'me' && !out.topic) out.topic = '关于我';
    if (out.scope && !SCOPES.has(out.scope)) delete out.scope;
    if (out.measure && !MEASURES.has(out.measure)) delete out.measure;
    if (to === 'again' && out.why !== '没照做') out.why = '附和';
    (lines[ev] ||= []).push(out);
  }
  // 指着同一批里的一句的：那一句要真有一行新要求，不然不收
  for (const [ev, ls] of Object.entries(lines)) {
    lines[ev] = ls.filter((l) => {
      if (!l.askEv) return true;
      if ((lines[l.askEv] || []).some((x) => x.to === 'new')) return true;
      problems.push(`${ev}：指着的 ${l.askEv} 在这一批里没有记成新要求`);
      return false;
    });
    if (!lines[ev].length) delete lines[ev];
  }
  const missing = [...ids].filter((id) => !lines[id]);
  return { lines, missing, problems };
}

/**
 * 照读回的去处算出要写什么（不碰数据库）：asks 的新建 / 改动（状态类记 log）、关于我的、这一次的、没做到的（broken）。
 * 原话一律从 items 里抄；一条要求在这节课以前就有、我因为老师没照做又说了 → broken
 */
export function planSaid(parsed, { items = [], asks = [], sid = '', startedAt = 0, today = toDate(Date.now()), by = 'said' } = {}) {
  const text = new Map(items.map((x) => [x.ev, x]));
  const cur = new Map(asks.map((a) => [String(a.id), { ...a }]));
  const touched = new Map(); // id → op
  const fresh = new Set(); // 这一批里新建的
  const out = { asks: [], profile: [], once: [], broken: [], lines: parsed.lines };
  const quote = (ev) => { const x = text.get(ev); return { ev, at: x?.at || 0, session: sid, text: x?.text || '' }; };
  const meta = (ev, note = '') => ({ date: today, by, basis: [ev], note });
  const addQuote = (a, ev) => (a.quotes || []).some((q) => q.ev === ev) ? a : { ...a, quotes: [...(a.quotes || []), quote(ev)] };
  const nextId = () => nextAskId([...cur.values()]);
  const older = (a) => !fresh.has(String(a.id)) && ((a.quotes || [])[0]?.at || 0) < startedAt;
  const madeBy = new Map(); // 这一批里哪一句建了哪一条（同一批里指着那一句的，落到那一条上）
  for (const x of items) {
    for (const l0 of parsed.lines[x.ev] || []) {
      const l = l0.askEv ? { ...l0, ask: madeBy.get(l0.askEv) } : l0;
      if (l0.askEv && !l.ask) continue;
      if (l.to === 'new') {
        // 上次写了一半（要求写进去了、这节课那一份账没写成就刷新了）：已经有一条挂着这句原话，不再新建一条
        const had = [...cur.values()].find((a) => a.status === 'active' && (a.quotes || []).some((q) => q.ev === x.ev));
        if (had) { if (!madeBy.has(x.ev)) madeBy.set(x.ev, had.id); continue; }
        const id = nextId();
        cur.set(id, { id, text: l.text, quotes: [quote(x.ev)], scope: l.scope || 'all', ...(l.measure ? { measure: l.measure } : {}), status: 'active', since: today, by, checks: [], broken: 0, log: [] });
        fresh.add(id);
        touched.set(id, 'add');
        if (!madeBy.has(x.ev)) madeBy.set(x.ev, id);
      } else if (l.to === 'again' || l.to === 'known') {
        const a = cur.get(l.ask);
        const next = addQuote(a, x.ev);
        if (next === a) continue;
        cur.set(l.ask, next);
        if (!touched.has(l.ask)) touched.set(l.ask, 'update');
        if (l.to === 'again' && l.why === '没照做' && older(a)) out.broken.push({ ask: l.ask, ev: x.ev });
      } else if (l.to === 'change') {
        const a = cur.get(l.ask);
        const id = nextId();
        cur.set(id, { ...a, id, text: l.text, quotes: [...(a.quotes || []), quote(x.ev)], ...(l.scope ? { scope: l.scope } : {}), status: 'active', since: today, by, from: `asks/${a.id}`, log: [], checks: [], broken: 0 });
        delete cur.get(id).into;
        fresh.add(id);
        touched.set(id, 'add');
        cur.set(l.ask, applyChange(a, { status: 'replaced', into: id }, meta(x.ev, '学生改口了')));
        if (!touched.has(l.ask)) touched.set(l.ask, 'update');
      } else if (l.to === 'drop') {
        cur.set(l.ask, applyChange(cur.get(l.ask), { status: 'dropped', why: l.why || '' }, meta(x.ev, '学生说不用了')));
        if (!touched.has(l.ask)) touched.set(l.ask, 'update');
      } else if (l.to === 'me') out.profile.push({ topic: l.topic, text: l.text, ev: x.ev });
      else if (l.to === 'once') out.once.push({ text: l.text, ev: x.ev });
    }
  }
  for (const [id, op] of touched) { const { id: _id, ...doc } = cur.get(id); out.asks.push({ id, op, doc }); }
  return out;
}

/** 这节课的那一份账（sessions/{编号}/said/main）：合进上一份；水位线停在还缺的那句前面 */
export function saidRecord({ prev = null, items = [], photos = [], lines = {}, missing = [], once = [], at = Date.now() } = {}) {
  const all = { ...(prev?.lines || {}), ...lines };
  for (const p of photos) all[p] = [{ to: 'photo' }];
  const at0 = new Map(items.map((x) => [x.ev, x.at]));
  const missingAt = { ...(prev?.missingAt || {}) };
  for (const id of Object.keys(lines)) delete missingAt[id];
  for (const id of missing) missingAt[id] = at0.get(id) ?? missingAt[id] ?? 0;
  const left = Object.keys(missingAt);
  const covered = items.filter((x) => all[x.ev]).map((x) => x.at);
  const seen = Math.max(prev?.seen || 0, prev?.upTo || 0, ...covered);
  const stop = left.length ? Math.min(...left.map((id) => missingAt[id])) : Infinity;
  const upTo = left.length ? Math.max(prev?.upTo || 0, ...covered.filter((t) => t < stop)) : seen;
  const keep = [...(prev?.once || []), ...once.filter((o) => !(prev?.once || []).some((p) => p.ev === o.ev))];
  return { upTo, seen, lines: all, missing: left, missingAt, once: keep, photos: [...new Set([...(prev?.photos || []), ...photos])], at, v: SAID_VERSION };
}

/**
 * 课上什么时候过账：我打了一句就 poke()，隔 wait 毫秒没再打才跑一次（连着打几句一起过）；
 * 在跑的时候又打了的，跑完再跑一次；flush() 立刻跑（下课、回首页、开别的课之前）。课堂两处共用
 */
export function saidTimer({ run, wait = 20000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null;
  let running = null;
  let again = false;
  const go = async () => {
    timer = null;
    if (running) { again = true; return running; }
    running = (async () => { try { await run(); } catch { /* 过账自己记错，这里不让它冒出来 */ } })();
    await running;
    running = null;
    if (again) { again = false; return go(); }
    return undefined;
  };
  return {
    poke() { if (timer) clearTimer(timer); timer = setTimer(go, wait); timer?.unref?.(); },
    flush() { if (timer) { clearTimer(timer); timer = null; } return go(); },
  };
}

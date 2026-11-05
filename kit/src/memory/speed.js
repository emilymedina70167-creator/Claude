// 测速（docs/talk-plan.md 第 0 批）：同一个一问一答的回合，把说明加长、把对话拉长，各调一次 Opus 5.5 high，
// 看每多一点要多等几秒（出第一个字、写完）。在学习台「管理」里，结果写进 meta/speed，开发那边 ArtifactData get 读回来。
// 不进课、不碰记忆。一次只调一个（走 lane 的前台，不和后台的活挤），顺序打乱。
// 上半是纯函数（tests/memory-speed.test.js），下半是画面。
// 垫长用的组件手册由调用的地方给（desk.js 传 class/docs.js 的 COMPONENT_DOCS；它是构建时生成的，node 测试里没有）
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const SPEED_MODEL = 'claude-opus-5-5';
export const RUNS_KEPT = 6;

// 说明长短（KB）× 对话长短（轮）
export function benchConds(kind) {
  if (kind === 'full') return [4, 16, 40, 100, 160].flatMap((kb) => [2, 10, 30].map((t) => ({ kb, turns: t })));
  return [[4, 2], [40, 2], [160, 2], [4, 30], [40, 30], [160, 30]].map(([kb, turns]) => ({ kb, turns }));
}

// 打乱顺序（先跑的可能占便宜，比如平台的缓存还热着）
export function shuffled(list, seed) {
  const a = list.slice();
  let s = seed >>> 0 || 1;
  const r = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const DOC = `你是考研辅导老师，和学生面对面一问一答。每次只说一句话、只问一个问题，从学生的回答里看出是怎么想的，下一句就针对它。
学生看到的是一块「活板」：你写几行描述（let 定义量、draw 画、正文里 {表达式?} 是空、{? 甲 | *乙} 是选择、goal 是目标），页面负责画、动、判分。
每次输出 1 到 4 行，只输出这些行。`;

const HIST = [
  ['let refs = 1 2 3 4 1 2 5 1 2 3 4 5\nlet f = 3 拨 1..6\nlet r = paging(refs=refs, frames=f, algo=fifo)\ndraw r\nFIFO、3 个物理块。你数数一共缺页几次？{r.faults?}', '学生：\n- 填空（r.faults）：写了 8，不对（页面算的是 9）'],
  ['你少数了一次。第 7 次访问 5 的时候，块里有 5 吗？{? 有 | *没有}', '学生：\n- 选择：选了「没有」，对'],
  ['那这次被换出去的是哪一页？{r.victim.1?}', '学生：\n- 填空：写了 1，对'],
  ['为什么偏偏是它？', '学生：\n- 说：因为它最早进来'],
  ['对。那给它 4 块，缺页会变多还是变少？{? 变少 | 变多 | *说不准}', '学生：\n- 选择：选了「变少」，不对'],
  ['先别急着定，拨成 4 块看看：{f}', '学生：\n- 拨 f：3 → 4（r 的缺页：9 → 10）\n- 做到了目标'],
];

const utf8 = (s) => new TextEncoder().encode(s);
/** 用真的组件手册垫到 kb KB（不够就重复） */
export function padText(kb, source) {
  const want = Math.max(0, kb * 1024);
  if (!want || !source) return '';
  let bytes = utf8(source);
  while (bytes.length < want) { const b = new Uint8Array(bytes.length * 2); b.set(bytes); b.set(bytes, bytes.length); bytes = b; }
  // 切到半个汉字时末尾会解出替换字符：去掉（不写字面量，构建产物里不能有这个字符，学习台不收）
  let t = new TextDecoder().decode(bytes.slice(0, want));
  while (t.endsWith(String.fromCharCode(0xfffd))) t = t.slice(0, -1);
  return t;
}

/** 一次测速发出去的整段：说明（垫到 kb）+ turns 轮模拟的一问一答，最后一条是学生的 */
export function benchMessages({ kb, turns }, source) {
  const docKb = Math.round(utf8(DOC).length / 1024);
  const filler = padText(Math.max(0, kb - docKb), source);
  const head = `${DOC}\n\n${filler ? `下面是组件手册和资料（这一轮不一定用得着）：\n${filler}\n\n` : ''}这一次要学的：让我自己发现 FIFO 会出现「多给一块反而多缺页」。\n\n开始：写第一问。`;
  const msgs = [{ role: 'user', content: head }];
  for (let i = 0; i < Math.max(1, turns); i++) { const [a, u] = HIST[i % HIST.length]; msgs.push({ role: 'assistant', content: a }, { role: 'user', content: u }); }
  msgs.push({ role: 'assistant', content: '你觉得是 FIFO 的哪一点惹的祸？' }, { role: 'user', content: `学生：\n- 说：它只看谁先进来，不看最近用没用（第 ${turns} 轮）` });
  return msgs;
}
export const inputBytes = (msgs) => utf8(msgs.map((m) => m.content).join('\n')).length;

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
/** 按说明长短、对话长短各算出第一个字的平均（只算 Opus 5.5 回的） */
export function benchSummary(rows) {
  const ok = rows.filter((r) => !r.error && r.model === SPEED_MODEL && Number.isFinite(r.first));
  const group = (k) => [...new Set(ok.map((r) => r[k]))].sort((a, b) => a - b).map((v) => ({ [k]: v, first: avg(ok.filter((r) => r[k] === v).map((r) => r.first)), total: avg(ok.filter((r) => r[k] === v).map((r) => r.total)), n: ok.filter((r) => r[k] === v).length }));
  return { n: ok.length, notOpus: rows.filter((r) => !r.error && r.model && r.model !== SPEED_MODEL).length, failed: rows.filter((r) => r.error).length, byKb: group('kb'), byTurns: group('turns') };
}

const sec = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} 秒` : '—');
export function summaryText(s) {
  if (!s.n) return '';
  const kb = s.byKb.map((g) => `${g.kb} KB ${sec(g.first)}`).join('，');
  const tu = s.byTurns.map((g) => `${g.turns} 轮 ${sec(g.first)}`).join('，');
  return `出第一个字平均——说明 ${kb}；对话 ${tu}。${s.notOpus ? `有 ${s.notOpus} 次不是 Opus 5.5 回的。` : ''}${s.failed ? `${s.failed} 次没调成。` : ''}`;
}

// —— 画面：管理页的「测速」一段 ——
export function mountSpeed(box, { getAI, put, saved, padSource }) {
  box.innerHTML = `<p class="dk-sub muted">同一个一问一答的回合，把说明加长（4～160 KB，用组件手册垫）、对话拉长（2～30 轮），各调一次 Opus 5.5 high。一次只调一个，跑的时候别离开这一页。结果存进学习台，开发那边直接读。</p>
    <div class="dk-sp-btns"><button type="button" class="btn btn-primary dk-sp-quick">快速：6 次（约 3～5 分钟）</button><button type="button" class="btn dk-sp-full">完整：15 次（约 8～12 分钟）</button><button type="button" class="btn dk-sp-stop" hidden>停</button></div>
    <p class="dk-sp-now muted"></p><div class="dk-sp-table"></div><p class="dk-sp-sum"></p>`;
  const q = (s) => box.querySelector(s);
  let running = false, stop = false, ctl = null;
  const paintRows = (rows) => {
    q('.dk-sp-table').innerHTML = rows.length ? `<table class="dk-sp-t"><thead><tr><th>说明</th><th>对话</th><th>第一个字</th><th>写完</th><th>写了</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.kb} KB</td><td>${r.turns} 轮</td><td>${r.error ? `<span class="bad">${escapeHtml(r.error)}</span>` : sec(r.first)}</td><td>${sec(r.total)}</td><td>${r.out ?? '—'} 字${r.model && r.model !== SPEED_MODEL ? `（${escapeHtml(r.model)}）` : ''}</td></tr>`).join('')}</tbody></table>` : '';
    q('.dk-sp-sum').textContent = summaryText(benchSummary(rows));
  };
  const last = saved?.()?.runs?.[0];
  if (last) { paintRows(last.rows || []); q('.dk-sp-now').textContent = `上一次：${String(last.at || '').slice(0, 16).replace('T', ' ')}，${(last.rows || []).length} 次${last.done ? '' : '（没跑完）'}`; }

  async function run(kind) {
    if (running) return;
    const ai = await getAI();
    if (!ai || ai.legacy) { q('.dk-sp-now').textContent = '这里调不了 Claude（要在 claude.ai 里打开学习台）。'; return; }
    running = true; stop = false;
    q('.dk-sp-quick').disabled = q('.dk-sp-full').disabled = true; q('.dk-sp-stop').hidden = false;
    const at = new Date().toISOString();
    const runId = at.replace(/[-:.TZ]/g, '').slice(0, 14);
    const list = shuffled(benchConds(kind), Date.now());
    const rows = [];
    const save = async (done) => {
      const prev = (saved?.()?.runs || []).filter((r) => r.run !== runId);
      try { await put('meta', 'speed', { runs: [{ run: runId, at, kind, done, ua: navigator.userAgent.slice(0, 160), rows }, ...prev].slice(0, RUNS_KEPT) }); } catch { /* 存不进去也照样显示 */ }
    };
    for (let i = 0; i < list.length && !stop; i++) {
      const c = list[i];
      const msgs = benchMessages(c, padSource);
      const row = { i, kb: c.kb, turns: c.turns, inBytes: inputBytes(msgs), at: new Date().toISOString() };
      const t0 = performance.now();
      let first = null;
      const tick = setInterval(() => { q('.dk-sp-now').textContent = `第 ${i + 1} / ${list.length} 次：说明约 ${c.kb} KB、对话 ${c.turns} 轮 · ${first === null ? '想了' : '第一个字'} ${sec((first ?? performance.now()) - t0)}`; }, 250);
      ctl = new AbortController();
      try {
        const res = await ai.call(msgs, { model: SPEED_MODEL, effort: 'high', modelTier: 'complex', cache: false, signal: ctl.signal, onText: ({ text }) => { if (first === null && String(text).trim()) first = performance.now(); } });
        const end = performance.now();
        Object.assign(row, { first: Math.round((first ?? end) - t0), total: Math.round(end - t0), out: String(res.text || '').length, model: res.modelApplied || res.modelTierApplied || '', text: String(res.text || '').slice(0, 300) });
      } catch (e) {
        Object.assign(row, { error: e?.code || String(e?.message || e).slice(0, 80), total: Math.round(performance.now() - t0) });
        if (['rate_limited', 'not_granted', 'cancelled'].includes(e?.code)) stop = true;
      } finally { clearInterval(tick); }
      rows.push(row);
      paintRows(rows);
      await save(false);
    }
    await save(!stop);
    q('.dk-sp-now').textContent = stop ? '停了。跑完的几次存下来了。' : `跑完了，${rows.length} 次都存进了学习台。`;
    running = false;
    q('.dk-sp-quick').disabled = q('.dk-sp-full').disabled = false; q('.dk-sp-stop').hidden = true;
  }
  q('.dk-sp-quick').addEventListener('click', () => run('quick'));
  q('.dk-sp-full').addEventListener('click', () => run('full'));
  q('.dk-sp-stop').addEventListener('click', () => { stop = true; ctl?.abort(); });
}

// 英语的两种点选（从 english.js 抽出来，一类组件 parse / errfind 和检验里的 parse / errfind 共用一份，样子、手感一样）：
//   spanPicker：点一个词定起点、再点一个词定终点、再点成分，标成「[主语 … ]」；点板上的「[成分」去掉那一段；能套从句。
//   wordPicker：一排词，点一个（改错：点出用错的那个词）。
// 不判对错（entext.js、check/judge.js 判）；这里只画、收作答。下标和 entext.js 的 parseBrackets / tokenizeSentence 一样。
import { escapeHtml } from './common.js';

/** 一句话按成分画成「[主语 The man [定语从句 who lives next door]] [谓语 gave] …」：括号随着换行走，套几层都看得清 */
export function bracketHtml(tokens, spans, roles, { cls = () => '' } = {}) {
  const color = (k) => `pz-c${Math.max(0, roles.findIndex((r) => r.key === k)) % 6}`;
  const name = (k) => roles.find((r) => r.key === k)?.name || k;
  const out = [];
  tokens.forEach((t, i) => {
    for (const s of spans.filter((x) => x.from === i).sort((a, b) => b.to - a.to)) out.push(`<span class="pz-open ${color(s.role)} ${cls(s)}">[<small>${escapeHtml(name(s.role))}</small></span>`);
    // 标成 X（划掉）的那几个词当场画删除线、变淡
    const cut = spans.some((x) => x.role === 'X' && x.from <= i && i <= x.to) ? ' is-cut' : '';
    out.push(t.word ? `<button type="button" class="pz-w${cut}" data-i="${i}">${escapeHtml(t.w)}</button>` : `<span class="en-punct${cut}">${escapeHtml(t.w)}</span>`);
    for (const s of spans.filter((x) => x.to === i).sort((a, b) => a.from - b.from)) out.push(`<span class="pz-close ${color(s.role)} ${cls(s)}">]</span>`);
  });
  return out.join(' ');
}

export const SPAN_HELP = '点一个词定起点，再点一个词定终点，然后点成分；点板上的「[成分」能去掉那一段。从句里的成分可以再标一层。';

/**
 * 标成分。host 里画「说明、句子、成分按钮」三样。返回：
 *   spans() 标了的 [{ role, from, to }]（头尾的标点不算进去）；empty() 一段都没标；lock() 不能再改；
 *   clear() 清空；mark(cls) 每一段加什么样子（检查以后标对错，cls(段) → 类名）；show(spans) 换成画这几段（看答案）；el
 * onChange()：标的变了
 */
export function spanPicker(host, { tokens = [], roles = [], help = SPAN_HELP, onChange = () => {} } = {}) {
  const el = document.createElement('div');
  el.className = 'pz-pick';
  el.innerHTML = `${help ? `<div class="pz-help muted">${escapeHtml(help)}</div>` : ''}
    <div class="pz-sent en-words"></div>
    <div class="pz-roles">${roles.map((r, k) => `<button type="button" class="btn btn-sm pz-role pz-c${k % 6}" data-role="${escapeHtml(r.key)}" disabled>${escapeHtml(r.name)}</button>`).join('')}</div>`;
  host.appendChild(el);
  // 先取好（english.js 把这三样从 el 里搬回原来的位置，之后 el 是空的）
  const sent = el.querySelector('.pz-sent');
  const rolesEl = el.querySelector('.pz-roles');
  const roleBtns = [...rolesEl.querySelectorAll('.pz-role')];
  let mine = [], sel = null, closed = false, cls = () => '', shown = null;
  function draw() {
    sent.innerHTML = bracketHtml(tokens, shown || mine, roles, { cls: shown ? () => '' : cls });
    sent.querySelectorAll('.pz-w').forEach((b) => {
      const i = +b.dataset.i;
      b.classList.toggle('is-sel', !!sel && i >= sel.from && i <= (sel.to ?? sel.from));
    });
    roleBtns.forEach((b) => { b.disabled = closed || !sel || sel.to === undefined; });
  }
  const changed = () => { cls = () => ''; draw(); onChange(); };
  sent.addEventListener('click', (e) => {
    if (closed) return;
    const open = e.target.closest('.pz-open');
    if (open) {
      // 去掉这一段：按它在板上的位置找（同一个词前面可能开了几段）
      const opens = [...sent.querySelectorAll('.pz-open')];
      const k = opens.indexOf(open);
      const order = [...mine].sort((a, b) => a.from - b.from || b.to - a.to);
      mine = mine.filter((s) => s !== order[k]);
      changed();
      return;
    }
    const w = e.target.closest('.pz-w');
    if (!w) return;
    const i = +w.dataset.i;
    if (!sel || sel.to !== undefined) sel = { from: i };
    else sel = { from: Math.min(sel.from, i), to: Math.max(sel.from, i) };
    draw();
  });
  rolesEl.addEventListener('click', (e) => {
    const b = e.target.closest('.pz-role');
    if (!b || closed || !sel || sel.to === undefined) return;
    // 头尾的标点不算进去
    let { from, to } = sel;
    while (from < to && !tokens[from].word) from++;
    while (to > from && !tokens[to].word) to--;
    mine = [...mine.filter((s) => !(s.from === from && s.to === to)), { role: b.dataset.role, from, to }];
    sel = null;
    changed();
  });
  draw();
  return {
    el,
    spans: () => mine.map((s) => ({ ...s })),
    empty: () => !mine.length,
    clear() { if (closed) return; mine = []; sel = null; changed(); },
    mark(f) { cls = f || (() => ''); draw(); },
    show(spans) { shown = spans; draw(); },
    lock() { closed = true; sel = null; draw(); },
    /** 原来的那几段（mark 的 cls 比的是这几个对象） */
    raw: () => mine,
  };
}

/**
 * 一排词，点一个（改错）。tokens 是 tokenizeSentence 切的；标点画成字，不能点。返回：
 *   picked() 点的那个词的下标（没点是 -1）；lock()；toggle(cls, i → 是否)（标对错、看答案）；el
 * onPick(i)：点了一个词
 */
export function wordPicker(host, tokens = [], { onPick = () => {} } = {}) {
  const el = document.createElement('div');
  el.className = 'en-words';
  el.innerHTML = tokens.map((t) => (t.word ? `<button type="button" class="en-word" data-i="${t.i}">${escapeHtml(t.w)}</button>` : `<span class="en-punct">${escapeHtml(t.w)}</span>`)).join(' ');
  host.appendChild(el);
  let pick = -1, closed = false;
  el.querySelectorAll('.en-word').forEach((b) => b.addEventListener('click', () => {
    if (closed) return;
    pick = +b.dataset.i;
    el.querySelectorAll('.en-word').forEach((x) => x.classList.toggle('is-picked', x === b));
    onPick(pick);
  }));
  return {
    el,
    picked: () => pick,
    lock() { closed = true; },
    toggle(cls, f) { el.querySelectorAll('.en-word').forEach((x) => x.classList.toggle(cls, !!f(+x.dataset.i))); },
  };
}

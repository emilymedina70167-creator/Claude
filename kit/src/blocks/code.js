// code：408 的算法设计题。学生在框里写 C 函数，点「运行测试」，页面用 trace 的解释器真的跑老师给的测试，
// 逐个告诉哪个过了、哪个没过（期望什么、得到什么、哪一行出错），再估时间 / 空间复杂度。判题逻辑在 codejudge.js（纯函数）。
// 代码框照 iPad 做：等宽 16px、不自动大写不纠错、回车自动缩进、Tab 是四个空格、常用符号一排按钮（点了不收键盘）。
import { parseFields } from '../parse.js';
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import { markDraft } from '../drafts.js';
import { parseCodeSpec, runTests, estimate, refEstimate } from '../codejudge.js';

const KEYS = ['{', '}', '(', ')', '[', ']', ';', '=', '==', '!=', '<', '>', '<=', '>=', '+', '-', '*', '/', '%', '&&', '||', '!', '->', '&', "'", '"', ','];
const MAX_REC = 1600;

export function code(el, src) {
  const { fields } = parseFields(src);
  const spec = parseCodeSpec(fields);
  const title = fields.title || '写代码 Code';
  const body = widget(el, { title, cls: 'code-judge stepper-act' });
  body.innerHTML = `
    ${fields.q ? `<div class="w-q">${mdToHtml(fields.q)}</div>` : ''}
    ${spec.sig ? `<div class="cj-meta muted">写出函数 <code>${escapeHtml(spec.sig.text)}</code>，可以另写辅助函数。</div>` : ''}
    <div class="cj-editor"><div class="cj-gutter" aria-hidden="true"></div><textarea class="cj-code" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="代码"></textarea></div>
    <div class="cj-keys">${KEYS.map((k) => `<button type="button" class="btn btn-sm cj-key" data-k="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join('')}<button type="button" class="btn btn-sm cj-key" data-k="\t" aria-label="缩进">⇥</button></div>
    <div class="cj-ctrl"><button type="button" class="btn btn-primary cj-run">运行测试</button><button type="button" class="btn btn-sm cj-reset">恢复成开始的样子</button><span class="cj-count muted"></span></div>
    <ol class="cj-tests"></ol>
    <div class="cj-cx muted" hidden></div>
    ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}`;
  const ta = body.querySelector('.cj-code');
  const gutter = body.querySelector('.cj-gutter');
  const list = body.querySelector('.cj-tests');
  const cx = body.querySelector('.cj-cx');
  const count = body.querySelector('.cj-count');
  const gate = session.gate(el, title);
  let runs = 0, lastRun = null, passedOnce = false, errLine = 0;
  ta.value = spec.starter;

  // 测试先列出来（输入和期望），学生知道要过什么
  list.innerHTML = spec.tests.map((t, i) => `<li class="cj-t" data-i="${i}"><span class="cj-mark">·</span><span class="cj-case">${escapeHtml(t.line)}</span><div class="cj-why"></div></li>`).join('');

  function lines() {
    const n = ta.value.split('\n').length;
    gutter.innerHTML = Array.from({ length: n }, (_, i) => `<div class="${i + 1 === errLine ? 'is-err' : ''}">${i + 1}</div>`).join('');
    gutter.scrollTop = ta.scrollTop;
    ta.rows = Math.max(6, Math.min(24, n + 1));
  }

  // 在光标处插入（按符号键、Tab）：用 setRangeText，撤销栈还在；按钮按下时不让文本框失焦，iPad 的键盘就不会收起
  function insert(text) {
    const a = ta.selectionStart, b = ta.selectionEnd;
    ta.setRangeText(text, a, b, 'end');
    ta.dispatchEvent(new Event('input'));
  }
  body.querySelector('.cj-keys').addEventListener('pointerdown', (e) => { if (e.target.closest('.cj-key')) e.preventDefault(); });
  body.querySelector('.cj-keys').addEventListener('click', (e) => {
    const k = e.target.closest('.cj-key')?.dataset.k;
    if (k === undefined) return;
    ta.focus({ preventScroll: true });
    insert(k === '\t' ? '    ' : k);
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); insert('    '); return; }
    if (e.key === 'Enter' && !e.isComposing) {
      // 回车：照上一行的缩进；上一行以 { 结尾再多缩一层
      e.preventDefault();
      const before = ta.value.slice(0, ta.selectionStart);
      const cur = before.slice(before.lastIndexOf('\n') + 1);
      const ind = (/^\s*/.exec(cur) || [''])[0] + (/\{\s*$/.test(cur) ? '    ' : '');
      insert('\n' + ind);
      return;
    }
    if (e.key === '}') {
      // 只有空白的一行里打 }：先退一层
      const before = ta.value.slice(0, ta.selectionStart);
      const cur = before.slice(before.lastIndexOf('\n') + 1);
      if (/^ {4,}$/.test(cur)) { e.preventDefault(); ta.setRangeText('}', ta.selectionStart - 4, ta.selectionStart, 'end'); ta.dispatchEvent(new Event('input')); }
    }
  });
  ta.addEventListener('input', () => { errLine = 0; lines(); });
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });

  function run() {
    const codeText = ta.value;
    runs++;
    lastRun = codeText;
    const res = runTests(codeText, spec);
    const passed = res.filter((r) => r.ok).length;
    errLine = 0;
    res.forEach((r, i) => {
      const li = list.querySelector(`[data-i="${i}"]`);
      li.classList.toggle('is-ok', r.ok);
      li.classList.toggle('is-bad', !r.ok);
      li.querySelector('.cj-mark').textContent = r.ok ? '✓' : '✗';
      let why = '';
      if (!r.ok && r.error) {
        why = escapeHtml(r.error);
        if (r.errLine && !errLine) errLine = r.errLine;
      } else if (!r.ok) why = r.diff.map((d) => `${escapeHtml(d.what)}：应该是 <code>${escapeHtml(d.want)}</code>，你的是 <code>${escapeHtml(d.got)}</code>`).join('；');
      li.querySelector('.cj-why').innerHTML = why;
    });
    lines();
    count.textContent = `过了 ${passed} / ${res.length} 个`;
    // 都过了才估复杂度（没过时估出来的没有意义）
    let cxText = '';
    if (passed === res.length && spec.scale) {
      const mine = estimate(codeText, spec);
      const ref = refEstimate(spec);
      if (mine?.error) cxText = `估复杂度时：${mine.error}`;
      else if (mine) cxText = `时间大约 ${mine.time}（n = ${mine.ns.join('、')} 时执行了 ${mine.steps.join('、')} 行），额外空间大约 ${mine.space}${ref && !ref.error ? `；参考解法：时间 ${ref.time}，空间 ${ref.space}` : ''}。`;
      cx.hidden = !cxText;
      cx.textContent = cxText;
    } else cx.hidden = true;
    const first = res.find((r) => !r.ok);
    const failText = first ? `${first.line}：${first.error || first.diff.map((d) => `${d.what} 应该是 ${d.want}，得到 ${d.got}`).join('；')}` : '';
    session.record({ type: 'code', liveOnly: true, title, q: plain(fields.q), value: codeText.slice(0, MAX_REC), passed, total: res.length, fail: failText || undefined, cx: cxText || undefined, attempts: runs, ok: passed === res.length, el });
    if (passed === res.length && !passedOnce) {
      passedOnce = true;
      session.record({ type: 'code', final: true, title, q: plain(fields.q), value: codeText.slice(0, MAX_REC), passed, total: res.length, cx: cxText || undefined, attempts: runs, ok: true, el });
      gate();
    }
  }
  body.querySelector('.cj-run').addEventListener('click', run);
  // 恢复要点两下（artifact 里 confirm() 可能被拦掉，不能靠它）
  const reset = body.querySelector('.cj-reset');
  let armed = 0;
  reset.addEventListener('click', () => {
    if (ta.value !== spec.starter && Date.now() - armed > 3000) { armed = Date.now(); reset.textContent = '再点一下：写的会丢掉'; setTimeout(() => { reset.textContent = '恢复成开始的样子'; }, 3000); return; }
    armed = 0;
    reset.textContent = '恢复成开始的样子';
    ta.value = spec.starter;
    ta.dispatchEvent(new Event('input'));
  });
  markDraft(ta, () => (ta.value !== spec.starter && ta.value !== lastRun ? `代码改了还没运行：\n${ta.value.slice(0, 600)}` : ''));
  // 课堂刷新后：照最后一次运行的记录把代码放回框里
  el._replay = (recs) => {
    const last = [...recs].reverse().find((r) => r.type === 'code' && typeof r.value === 'string');
    if (last) { ta.value = last.value; lastRun = last.value; lines(); }
  };
  lines();
}

const plain = (s) => String(s ?? '').replace(/\$/g, '').replace(/\s+/g, ' ').slice(0, 200);

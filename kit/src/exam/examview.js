// 「管理 → 考试」那一张卡（docs/exam-plan.md 4.6）：填、改考试档案（目标院校、专业、科目、考试日期、目标分、留作模考的年份）。
// 我点「存」才写，只写改了的字段（targetPatch），按 applyChange 记 log（by: me）。下面一行写库里有几套卷、几道题、几个考点
// （读 meta/exam 的计数：收件箱每并一条照回执加，首页不为了计数去读整类）。
import { targetOf, targetPatch, goalOf, examDateOf, reserveText, targetWarn } from './target.js';
import { reserveYears } from './reserve.js';
import { applyChange, assertWrite, toDate } from '../memory/schema.js';
import { escapeHtml } from '../render.js';
import { UPLOAD_KINDS, guessKind, uploadProblem, uploadDoc, waitingLine } from './uploads.js';

const SPLIT = [['math', '数学一'], ['cs', '408'], ['en', '英语一'], ['pol', '政治']];

// assets：学习台的 assets（传考试资料的 PDF 用）
export function createExamCard(root, { db, getData, assets = null }) {
  // 两块：上面是档案的表单（会整块重画），下面是传资料（一直在，不跟着表单重画）
  root.innerHTML = '<div class="dk-exf"></div><div class="dk-exup"></div>';
  const host = root.querySelector('.dk-exf');
  const up = root.querySelector('.dk-exup');
  let counts = null;
  let dirty = false;
  let built = false;
  let msg = '';
  db.doc('meta/exam').onSnapshot((s) => { counts = s.exists ? s.data().counts || {} : {}; paintFoot(); }, () => {});

  const field = (name, label, value, attrs = '') => `<label class="mm-f"><span>${label}</span><input name="${name}" value="${escapeHtml(String(value ?? ''))}" ${attrs}></label>`;
  function build(t) {
    const today = toDate(Date.now());
    const def = reserveYears(null, today);
    host.innerHTML = `<form class="dk-exform" novalidate>
      ${field('school', '学校', t.school, 'autocomplete="off"')}
      ${field('dept', '院系', t.dept, 'autocomplete="off"')}
      ${field('major', '专业', t.major, 'autocomplete="off" placeholder="还没定可以空着"')}
      ${field('majorCode', '专业代码', t.majorCode, 'inputmode="numeric" autocomplete="off"')}
      <label class="mm-f"><span>学位</span><select name="degree"><option value="">还没定</option><option value="学硕">学硕</option><option value="专硕">专硕</option></select></label>
      ${field('date', '初试第一天', examDateOf(t), 'type="date"')}
      ${field('goal', '目标总分', goalOf(t).goal, 'inputmode="numeric"')}
      <div class="dk-exsplit">${SPLIT.map(([k, l]) => field(`split.${k}`, l, goalOf(t).split[k], 'inputmode="numeric"')).join('')}</div>
      ${field('reserve', '留作模考的卷（年份）', reserveText(t), `placeholder="空着就是最近三年：${def.join('、')}；一张都不留写「不留」"`)}
      <p class="dk-exalt muted"></p>
      <div class="dk-mrow"><span class="dk-exmsg muted" role="status"></span><button type="submit" class="btn btn-primary dk-exsave">存</button></div>
      <p class="dk-exfoot muted"></p>
    </form>`;
    host.querySelector('select[name=degree]').value = t.degree || '';
    host.querySelector('form').addEventListener('input', () => { dirty = true; paintMsg(); });
    host.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); save(); });
    built = true;
  }
  function readForm() {
    const f = host.querySelector('form');
    const v = (n) => f.querySelector(`[name="${n}"]`).value;
    return {
      school: v('school'), dept: v('dept'), major: v('major'), majorCode: v('majorCode'), degree: v('degree'), date: v('date'),
      goal: v('goal'), split: Object.fromEntries(SPLIT.map(([k]) => [k, v(`split.${k}`)])), reserve: v('reserve'),
    };
  }
  function paintMsg() {
    const el = host.querySelector('.dk-exmsg');
    if (!el) return;
    let t;
    try { t = { ...targetOf(getData()), ...targetPatch(targetOf(getData()), readForm()) }; } catch (err) { el.textContent = msg || err.message; return; }
    // 没改的时候提醒存着的那一份哪里不对（表单里显示的是照默认补过的样子，看不出来）
    el.textContent = msg || (dirty ? targetWarn(t) || '改了还没存' : targetWarn(getData().exam?.find((d) => d.id === 'target') || {}));
  }
  function paintFoot() {
    const el = host.querySelector('.dk-exfoot');
    if (!el) return;
    const c = counts || {};
    el.textContent = c.questions ? `库里有 ${c.papers || 0} 套真卷、${c.questions} 道真题、${c.syllabus || 0} 个考点。` : '库里还没有真题（开发那边入库以后这里会写有几套）。';
  }
  async function save() {
    const cur = getData().exam?.find((d) => d.id === 'target') || null;
    const base = targetOf(getData());
    let patch;
    try { patch = targetPatch(base, readForm()); } catch (err) { msg = err.message; paintMsg(); setTimeout(() => { msg = ''; paintMsg(); }, 4000); return; }
    if (!Object.keys(patch).length) { msg = '没有改动'; dirty = false; paintMsg(); return; }
    if (patch.date !== undefined && examDateOf({ date: patch.date }) !== patch.date) { msg = '日期要写成 年-月-日'; paintMsg(); return; }
    if (patch.goal !== undefined && !(patch.goal > 0)) { msg = '目标总分要写一个数'; paintMsg(); return; }
    const btn = host.querySelector('.dk-exsave');
    btn.disabled = true;
    try {
      assertWrite('me', 'exam');
      const doc = applyChange(cur || { ...base, log: [] }, patch, { by: 'me', note: '管理 → 考试' });
      const { id: _, ...data } = doc;
      await db.doc('exam/target').set({ ...data, by: 'me', at: Date.now() });
      dirty = false;
      msg = '存好了';
    } catch (err) {
      msg = `没存成：${err?.message || err}`;
    }
    btn.disabled = false;
    paintMsg();
    setTimeout(() => { msg = ''; paintMsg(); }, 2500);
  }
  function paint() {
    const t = targetOf(getData());
    // 我正在改的时候别把表单冲掉（别的设备、页面写了档案也一样）
    if (!built || !dirty) build(t);
    const alt = host.querySelector('.dk-exalt');
    if (alt) alt.textContent = t.alt?.length ? `也在考虑：${t.alt.join('、')}` : '';
    paintMsg();
    paintFoot();
  }
  // —— 传考试资料（exam/uploads.js）：PDF 存进 assets，记一条 exam_uploads 等开发那边入库 ——
  let uploads = [];
  let upMsg = '';
  db.collection('exam_uploads').onSnapshot((s) => { uploads = s.docs.map((d) => ({ id: d.id, ...d.data() })); paintUploads(); }, () => {});
  function paintUploads() {
    const live = uploads.filter((d) => d.status !== 'void').sort((a, b) => (b.at || 0) - (a.at || 0));
    const mb = (n) => `${(Number(n) / 1048576).toFixed(1)} MB`;
    up.innerHTML = `<h3 class="dk-sc-h">放考试资料</h3>
      <p class="dk-sub muted">真题卷、解析、考试大纲的 PDF 传到这里（每份 15 MB 以内，大的拆开传）。只存着等入库，不会当成教材带进课堂。${escapeHtml(waitingLine(live))}</p>
      <div class="dk-mrow dk-exup-row">
        <label class="mm-f"><span>是什么</span><select class="dk-exup-kind"><option value="">照文件名猜</option>${Object.entries(UPLOAD_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="mm-f"><span>补一句（科目、年份）</span><input class="dk-exup-note" placeholder="比如 408 2015–2024" autocomplete="off"></label>
        <label class="btn btn-primary dk-exup-pick">选 PDF<input type="file" accept="application/pdf,.pdf" multiple hidden></label>
      </div>
      <p class="dk-exup-msg muted" role="status">${escapeHtml(upMsg)}</p>
      ${live.length ? `<ul class="ex-list dk-exup-list">${live.slice(0, 12).map((d) => `<li><span>${escapeHtml(d.name)}</span><small class="muted">${UPLOAD_KINDS[d.kind] || ''} · ${mb(d.size)} · ${d.status === 'done' ? '入库了' : '等入库'}</small>${d.status === 'waiting' ? `<button type="button" class="btn btn-sm dk-exup-del" data-id="${escapeHtml(d.id)}">删掉</button>` : ''}</li>`).join('')}</ul>${live.length > 12 ? `<p class="muted">还有 ${live.length - 12} 份</p>` : ''}` : ''}`;
    up.querySelector('input[type=file]').addEventListener('change', (e) => { const fs = [...(e.currentTarget.files || [])]; e.currentTarget.value = ''; if (fs.length) send(fs); });
  }
  up.addEventListener('click', async (e) => {
    const b = e.target.closest('.dk-exup-del');
    if (!b) return;
    const d = uploads.find((x) => x.id === b.dataset.id);
    if (!d) return;
    b.disabled = true;
    assertWrite('me', 'exam_uploads');
    const { id, ...rest } = d;
    await db.doc(`exam_uploads/${id}`).set({ ...rest, status: 'void' }).catch(() => { b.disabled = false; });
  });
  async function send(files) {
    if (!assets) { upMsg = '这个页面拿不到 assets：传不了'; paintUploads(); return; }
    const kindSel = up.querySelector('.dk-exup-kind').value;
    const note = up.querySelector('.dk-exup-note').value.trim();
    let ok = 0;
    const bad = [];
    for (const [i, f] of files.entries()) {
      const why = uploadProblem(f);
      if (why) { bad.push(why); continue; }
      upMsg = `正在传 ${i + 1} / ${files.length}：${f.name}`;
      paintUploads();
      try {
        const r = await assets.upload(f, { type: 'application/pdf' });
        const d = uploadDoc({ name: f.name, size: f.size, asset: r.id, kind: kindSel || guessKind(f.name), note, now: Date.now(), seq: i + 1 });
        const { id, ...rest } = d;
        assertWrite('me', 'exam_uploads');
        await db.doc(`exam_uploads/${id}`).set(rest);
        ok++;
      } catch (err) {
        bad.push(`「${f.name}」没传上：${err?.message || err}`);
      }
    }
    upMsg = [ok ? `传好了 ${ok} 份，等入库。` : '', ...bad].filter(Boolean).join(' ');
    paintUploads();
  }
  paintUploads();

  return { paint };
}

// 「管理 → 考试」那一张卡（docs/exam-plan.md 4.6）：填、改考试档案（目标院校、专业、科目、考试日期、目标分、留作模考的年份）。
// 我点「存」才写，只写改了的字段（targetPatch），按 applyChange 记 log（by: me）。下面一行写库里有几套卷、几道题、几个考点
// （读 meta/exam 的计数：收件箱每并一条照回执加，首页不为了计数去读整类）。
import { targetOf, targetPatch, goalOf, examDateOf } from './target.js';
import { reserveYears } from './reserve.js';
import { applyChange, assertWrite, toDate } from '../memory/schema.js';
import { escapeHtml } from '../render.js';

const SPLIT = [['math', '数学一'], ['cs', '408'], ['en', '英语一'], ['pol', '政治']];

export function createExamCard(host, { db, getData }) {
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
      ${field('reserve', '留作模考的卷（年份）', Array.isArray(t.reserve) ? t.reserve.join(', ') : '', `placeholder="空着就是最近三年：${def.join('、')}"`)}
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
    const t = { ...targetOf(getData()), ...targetPatch(targetOf(getData()), readForm()) };
    el.textContent = msg || goalOf(t).warn || (dirty ? '改了还没存' : '');
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
    const patch = targetPatch(base, readForm());
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
  return { paint };
}

// 解答题 solve（dr-batch4 第 1 条）：学生在纸上写过程，打字或交照片交整道题；主讲（外部）或页面里的 Claude 照参考步骤
// 一步一步判，写 board judge，页面把逐步的结论画在题下面，记一条作答（steps: [{ id, ok: true | false | 'missing', why, tag }]）。
// 参考步骤判完以前不给学生看。写法和判定的读法在 solvespec.js（纯函数，tests/solve.test.js）。
// 交照片照截图入口的规矩（upload.js）：外部的课默认关，board set upload=on 或组件写 upload: on 才有。
import { parseSolve, parseJudge, allRight, judgedLine, submittedLine, STEP_KINDS } from '../solvespec.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import { session } from '../session.js';
import { markDraft } from '../drafts.js';
import { photoPicker } from '../photo.js';

const MARK = { true: '✓', false: '✗', missing: '缺', null: '·', unsure: '？' };

export function solve(el, src) {
  const spec = parseSolve(src, { ext: !!session.extPrewrite });
  for (const p of spec.problems) session.problem(el, 'solve', p);
  if (!spec.fields.q || !spec.steps.length) { el.innerHTML = `<div class="block-error">${escapeHtml(spec.problems.join('；'))}</div>`; return; }
  const { fields, steps, judge } = spec;
  const body = widget(el, { cls: 'solve', title: fields.title || '解答题' });
  el.classList.add('block-solve');
  body.innerHTML = `
    <div class="w-q">${mdToHtml(fields.q)}</div>
    <textarea class="sv-text tb-text" rows="6" placeholder="照纸上写的一步一步打出来；也可以交照片"></textarea>
    <div class="sv-photo-anchor"></div>
    <div class="ans-actions"><button type="button" class="btn btn-primary sv-send">交整道题</button><span class="sv-status muted" hidden></span></div>
    <div class="sv-judged" hidden></div>`;
  const ta = body.querySelector('.sv-text');
  const sendBtn = body.querySelector('.sv-send');
  const statusEl = body.querySelector('.sv-status');
  const judgedEl = body.querySelector('.sv-judged');
  const say = (t, cls = 'muted') => { statusEl.hidden = !t; statusEl.className = `sv-status ${cls}`; statusEl.textContent = t || ''; };
  const plainQ = String(fields.q).replace(/\s+/g, ' ').slice(0, 600);
  let blobs = [];
  let sentText = null;
  let submitted = 0;
  const gateDone = session.gate(el, fields.title || '解答题');
  // 草稿：打了字、附了照片还没交
  markDraft(body, () => { const t = ta.value.trim(); return t && t !== sentText ? t : blobs.length && sentText === null ? `附了 ${blobs.length} 张照片，还没交` : ''; });
  const photo = photoPicker(body.querySelector('.sv-photo-anchor'), {
    label: '交照片',
    root: body,
    async onPick(files, ui) {
      blobs = files.slice(0, 4);
      ui.status(`附了 ${blobs.length} 张，点「交整道题」一起交。`, 'is-ok');
    },
  });
  void photo;
  const waitText = { ext: '交了，等主讲一步一步判。', claude: '交了，等页面里的 Claude 一步一步判。', none: '交了。' };
  sendBtn.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text && !blobs.length) { say('先写过程或者附照片', 'is-bad'); return; }
    sendBtn.disabled = true;
    const shots = blobs;
    blobs = [];
    // 照片先传进 assets 拿编号（课堂给的 session.uploadImage）：外部从 ext_out 里拿编号用 read_asset 看；没有就照截图作答的老路存
    let photos = [];
    if (shots.length && session.uploadImage) {
      say('正在传照片…');
      photos = (await Promise.all(shots.map((b) => Promise.resolve(session.uploadImage(b)).catch(() => null)))).filter(Boolean);
    } else if (shots.length) session.keepImages(el, shots);
    submitted++;
    sentText = text;
    api.lastBlobs = shots;
    api.lastText = text;
    session.record({ type: 'solve', q: plainQ, value: text, ok: null, submitted, nImages: shots.length, ...(photos.length ? { photos } : {}), judge, el, text: submittedLine({ text, images: photos.length ? photos : shots.map((_, i) => `第 ${i + 1} 张`) }) });
    say(shots.length && photos.length < shots.length && session.uploadImage ? `交了；${shots.length - photos.length} 张照片没传上，再交一次` : waitText[judge] || waitText.none, shots.length && photos.length < shots.length && session.uploadImage ? 'is-bad' : 'muted');
    sendBtn.textContent = '改了再交';
    sendBtn.disabled = false;
  });

  function paintJudged(js, by) {
    judgedEl.hidden = false;
    judgedEl.innerHTML = `<div class="sv-jhead">${by === 'helper' ? '页面里的 Claude' : by === 'teacher' ? '老师' : '主讲'}一步一步判的：</div><ol class="sv-steps">${steps.map((s) => {
      const j = js.find((x) => x.id === s.id) || { ok: null };
      // 拿不准的步（unsure）：「？待外部核」
      return `<li class="sv-step is-${j.unsure ? 'unsure' : j.ok === true ? 'ok' : j.ok === false ? 'bad' : j.ok === 'missing' ? 'miss' : 'none'}"><span class="sv-mark">${MARK[j.unsure ? 'unsure' : String(j.ok)]}</span>${j.unsure ? '<span class="sv-unsure">待外部核</span> ' : ''} <span class="sv-ref">${mdToHtml(s.text, { inline: true })}</span><span class="muted"> · ${escapeHtml(STEP_KINDS[s.kind] || s.kind)}</span>${j.ok !== true && (j.tag || j.why) ? `<div class="sv-why">${escapeHtml([j.tag, j.why].filter(Boolean).join('：'))}</div>` : ''}</li>`;
    }).join('')}</ol>`;
  }

  // 课堂执行 board judge 时调：读判定、画出来、记一条作答。返回 { ok, steps, line, errors, notes }
  const api = {
    spec,
    lastBlobs: [],
    lastText: '',
    get submitted() { return submitted; },
    judge(bodyText, { by = 'ext' } = {}) {
      const r = parseJudge(bodyText, steps);
      if (r.errors.length && !r.steps.some((s) => s.ok !== null)) return { ok: false, errors: r.errors, notes: r.notes, steps: r.steps };
      const right = allRight(r.steps);
      const line = judgedLine(r.steps);
      paintJudged(r.steps, by);
      if (!submitted) r.notes.push('学生在板上还没交这道题（照你看到的判了）');
      session.record({ type: 'solve', q: plainQ, judged: true, by, ok: right, steps: r.steps, value: line, el });
      if (right) gateDone();
      say(right ? '每一步都对。' : '判好了，看下面每一步。', right ? 'is-ok' : '');
      return { ok: true, right, steps: r.steps, line, errors: r.errors, notes: r.notes };
    },
  };
  el.__solve = api;
  // 刷新以后：最后交的字放回框里，最后一次判定画回来（不再记）
  el._replay = (recs) => {
    const kindOf = (x) => x.type || x.kind;
    const sent = recs.filter((x) => kindOf(x) === 'solve' && !x.judged);
    const judged = recs.filter((x) => kindOf(x) === 'solve' && x.judged).at(-1);
    if (sent.length) { submitted = sent.length; sentText = String(sent.at(-1).value ?? sent.at(-1).text ?? ''); ta.value = sentText; sendBtn.textContent = '改了再交'; say(waitText[judge] || ''); }
    if (judged && Array.isArray(judged.steps)) { paintJudged(judged.steps, judged.by); say(judged.ok ? '每一步都对。' : '判好了，看下面每一步。', judged.ok ? 'is-ok' : ''); if (judged.ok) gateDone(); }
  };
}

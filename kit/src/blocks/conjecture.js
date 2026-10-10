// conjecture：用自己的话写下发现的规律，Claude 按要点批改并追问。
// 页面没有调用 Claude 的权限时，改为对照参考答案自评。
import { parseFields } from '../parse.js';
import { getAI, errorText, AI_PERMANENT } from '../ai.js';
import { createPad } from '../ink/pad.js';
import { session } from '../session.js';
import { widget, mdToHtml } from './common.js';
import { plain } from './answer.js';
import { photoPicker, transcribe, photoError, transcriptHtml } from '../photo.js';

export function conjecture(el, src) {
  const { fields } = parseFields(src);
  const q = fields.q || fields.question;
  if (!q) throw new Error('conjecture 需要 q:（问题）');
  const title = fields.title || '说出你的发现 Your conjecture';
  const body = widget(el, { title, cls: 'conjecture' });
  body.innerHTML = `
    <div class="w-q">${mdToHtml(q)}</div>
    <textarea class="cj-text" rows="3" placeholder="${fields.placeholder || '我发现……'}"></textarea>
    <div class="ans-actions">
      <button type="button" class="btn btn-primary cj-submit">提交</button>
      <button type="button" class="btn cj-ref" hidden>看参考答案</button>
    </div>
    <div class="cj-feedback" hidden></div>
    <div class="cj-reference" hidden></div>`;
  const ta = body.querySelector('.cj-text');
  // 手写：写在手写板上，Claude 转成文字放进输入框，你检查后再提交
  getAI().then((ai) => {
    if (!ai?.images) return;
    const pbtn = document.createElement('button');
    pbtn.type = 'button';
    pbtn.className = 'btn cj-pen';
    pbtn.textContent = '✎ 手写';
    body.querySelector('.ans-actions').appendChild(pbtn);
    const box = document.createElement('div');
    box.className = 'cj-padbox';
    box.hidden = true;
    ta.after(box);
    const status = document.createElement('div');
    status.className = 'pad-status muted';
    let pad = null;
    pbtn.addEventListener('click', () => {
      if (!pad) {
        pad = createPad(box, {
          height: 230,
          hint: '用 Apple Pencil 写下你的发现，可以写公式、画箭头',
          actions: [{
            label: '转成文字', primary: true, onClick: async (p) => {
              status.textContent = 'Claude 正在看你写的内容…';
              try {
                const blob = await p.toBlob();
                session.keepImages(body, blob);
                const text = await transcribe([blob], q);
                if (!text) { status.textContent = '没认出文字，写清楚一点再试一次，或者直接打字。'; return; }
                ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + text;
                ta.dispatchEvent(new Event('input'));
                via = '手写';
                status.textContent = '已转成文字，看看对不对，再点「提交」。';
                p.clear();
                box.hidden = true;
                body.classList.remove('pad-open');
                ta.focus();
              } catch (e) { status.textContent = photoError(e); }
            },
          }],
        });
        box.appendChild(status);
      }
      box.hidden = !box.hidden;
      body.classList.toggle('pad-open', !box.hidden);
    });
  });
  const btn = body.querySelector('.cj-submit');
  const btnRef = body.querySelector('.cj-ref');
  const fb = body.querySelector('.cj-feedback');
  const ref = body.querySelector('.cj-reference');
  const done = session.gate(el, title);
  let attempts = 0;
  let finished = false;
  let aiDown = false;
  let via = ''; // 回答来自截图 / 手写板转写（记录里注明）
  const grading = !/^(off|no|false|否|不)$/i.test(fields.grade || (session.live ? 'off' : 'on'));

  // 截图作答：转写到文本框里，学生核对、修改后再提交
  photoPicker(ta, {
    root: body,
    async onPick(files, ui) {
      ui.status('Claude 正在认你的手写…', 'is-wait');
      session.keepImages(body, files);
      try {
        const t = await transcribe(files, q);
        if (!t) { ui.status('没认出文字。换一张清楚点的截图，或者直接打字。', 'is-bad'); return; }
        ta.value = ta.value.trim() ? `${ta.value.trim()}\n${t}` : t;
        ta.dispatchEvent(new Event('input'));
        via = '截图';
        ui.status(`已经转写到上面的框里。对照下面渲染出来的公式核对有没有认错，改好再点「提交」。${transcriptHtml(t, true)}`, 'is-ok');
      } catch (e) {
        ui.status(photoError(e), 'is-bad');
      }
    },
  });

  const finish = (entry) => {
    if (!finished) { finished = true; done(); }
    session.record({ type: 'conjecture', title, q: plain(q), el, via: via || undefined, ...entry });
  };

  function showReference(selfCheck) {
    ref.hidden = false;
    btnRef.hidden = true;
    ref.innerHTML = `<div class="cj-ref-title">参考答案</div>${mdToHtml(fields.answer || fields.reference || fields.rubric || '（没有提供参考答案）')}${selfCheck ? `
      <div class="cj-self"><span>你的想法和参考答案比：</span>
        <button type="button" class="btn btn-sm" data-v="一致">基本一致</button>
        <button type="button" class="btn btn-sm" data-v="部分一致">部分一致</button>
        <button type="button" class="btn btn-sm" data-v="不一致">不一致</button></div>` : ''}`;
    ref.querySelectorAll('.cj-self button').forEach((b) => b.addEventListener('click', () => {
      ref.querySelector('.cj-self').innerHTML = `<span class="muted">已记录：${b.dataset.v}。${b.dataset.v === '一致' ? '' : '可以在对话里或用「问 Claude」继续问。'}</span>`;
      finish({ answer: ta.value.trim(), verdict: `自评：${b.dataset.v}` });
    }));
    if (!selfCheck) finish({ answer: ta.value.trim(), verdict: '看了参考答案' });
  }

  btnRef.addEventListener('click', () => showReference(false));

  btn.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (text.length < 4) { fb.hidden = false; fb.className = 'cj-feedback is-bad'; fb.textContent = '先写下你的想法，哪怕不确定也没关系。'; return; }
    attempts++;
    // grade: off（live 模式默认）：只交给对话里的 Claude 看，页面不批改
    if (!grading) {
      fb.hidden = false;
      fb.className = 'cj-feedback is-wait';
      fb.innerHTML = `已交${attempts > 1 ? `（第 ${attempts} 次）` : ''}。${session.mode === 'class' ? 'Claude 会看到，等它接着讲。' : '回对话说一声，等 Claude 看。'}`;
      if (!finished) { finished = true; done(); }
      session.record({ type: 'conjecture', title, q: plain(q), answer: text, attempts, verdict: '已交，等 Claude 看', el, via: via || undefined });
      btn.textContent = '改了再交';
      return;
    }
    const ai = aiDown ? null : await getAI();
    if (!ai) { fb.hidden = true; showReference(true); btn.disabled = true; return; }
    btn.disabled = true;
    fb.hidden = false;
    fb.className = 'cj-feedback is-wait';
    fb.textContent = 'Claude 正在看你的回答…';
    const prompt = `你是一位耐心的${session.subject}助教，正在批改学生在探究活动中写下的发现。学生在美国读大学，用中文交流，术语可以附英文。

课程：${session.title}
${session.context ? `背景资料：\n${session.context.slice(0, 3000)}\n` : ''}当前小节内容（供参考）：
${(session.stages[session.stageOf(el)]?.src || '').slice(0, 2500)}

问题：${q}
评分要点：${fields.rubric || fields.answer || '（根据问题判断）'}
学生的回答（第 ${attempts} 次）：${text}

请判断学生是否抓住了要点。反馈只给提示，不给完整答案；不要说学生已经掌握。只回复一个 JSON 对象：
{"verdict": "correct" | "partial" | "incorrect", "feedback": "给学生的反馈，1-3 句：先肯定说对的部分，再指出缺什么或哪里不准确；不完全正确时不要直接说出完整答案，而是给方向", "followup": "一个能推动学生多想一步的问题；没有就写空字符串"}
公式用 $...$ 包起来。`;
    try {
      const r = await ai.json(prompt, { modelTier: 'quick' });
      const verdict = ['correct', 'partial', 'incorrect'].includes(r?.verdict) ? r.verdict : 'partial';
      const label = { correct: '✓ 抓住要点了', partial: '◐ 部分正确', incorrect: '✗ 还没抓住' }[verdict];
      fb.className = `cj-feedback ${verdict === 'correct' ? 'is-ok' : verdict === 'partial' ? 'is-mid' : 'is-bad'}`;
      fb.innerHTML = `<div class="q-verdict">${label}</div>${mdToHtml(String(r?.feedback || ''))}${r?.followup ? `<div class="cj-follow"><strong>想一想：</strong>${mdToHtml(String(r.followup), { inline: true })}</div>` : ''}`;
      if (verdict === 'correct') {
        finish({ answer: text, verdict: 'Claude：正确', feedback: r.feedback });
        btnRef.hidden = !(fields.answer || fields.reference);
        btn.textContent = '改一改再提交';
      } else {
        btn.textContent = '修改后再提交';
        if (attempts >= 2) btnRef.hidden = false;
        session.record({ type: 'conjecture-try', title, q: plain(q), answer: text, via: via || undefined, verdict: `Claude：${verdict === 'partial' ? '部分正确' : '不正确'}`, feedback: r.feedback, el });
      }
    } catch (e) {
      if (AI_PERMANENT.has(e?.code)) { aiDown = true; fb.hidden = true; showReference(true); return; }
      fb.className = 'cj-feedback is-bad';
      fb.textContent = errorText(e);
      btnRef.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
}

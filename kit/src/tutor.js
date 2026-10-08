// 页面里的助教：带着当前小节的内容和你的作答记录去问 Claude；
// 它还能直接改图里的变量来演示。
import { getAI, errorText, AI_PERMANENT } from './ai.js';
import { session } from './session.js';
import { mdToHtml, escapeHtml } from './render.js';
import { recordText } from './record.js';

export async function initTutor() {
  const ai = await getAI();
  if (!ai) return;
  document.body.classList.add('ai-on');
  document.querySelectorAll('.stage-ask').forEach((b) => (b.hidden = false));

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'tutor-fab';
  fab.textContent = '问 Claude';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.className = 'tutor';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="tutor-head"><div><strong>问 Claude</strong><div class="tutor-ctx muted"></div></div><button type="button" class="btn btn-sm tutor-close">收起</button></div>
    <div class="tutor-msgs"><div class="tutor-empty muted">有哪里没懂就直接问。Claude 能看到你正在学的这一节和你的作答情况${ai.tools ? '，必要时还会直接改动图形给你演示' : ''}。</div></div>
    <form class="tutor-form"><textarea rows="2" placeholder="比如：为什么 A 乘 (1,0) 正好是第一列？"></textarea><button type="submit" class="btn btn-primary tutor-send">发送</button></form>`;
  document.body.appendChild(panel);
  const msgs = panel.querySelector('.tutor-msgs');
  const ta = panel.querySelector('textarea');
  const send = panel.querySelector('.tutor-send');
  const ctxEl = panel.querySelector('.tutor-ctx');
  const turns = [];
  let stage = currentStage();
  let ctl = null;

  const open = (i, prefill) => {
    stage = i ?? currentStage();
    ctxEl.textContent = `当前：${session.stages[stage]?.title || session.title}`;
    panel.hidden = false;
    fab.hidden = true;
    if (prefill && !ta.value) ta.value = prefill;
    setTimeout(() => ta.focus(), 50);
  };
  session.openTutor = (i) => open(i, `我对「${session.stages[i]?.title || '这一节'}」有疑问：`);
  fab.addEventListener('click', () => open());
  panel.querySelector('.tutor-close').addEventListener('click', () => { panel.hidden = true; fab.hidden = false; ctl?.abort(); });

  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); panel.querySelector('form').requestSubmit(); } });

  panel.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (ctl) { ctl.abort(); return; }
    const q = ta.value.trim();
    if (!q) return;
    ta.value = '';
    panel.querySelector('.tutor-empty')?.remove();
    msgs.insertAdjacentHTML('beforeend', `<div class="msg msg-user">${escapeHtml(q)}</div>`);
    const bubble = document.createElement('div');
    bubble.className = 'msg msg-ai';
    bubble.innerHTML = '<span class="muted">思考中…</span>';
    msgs.appendChild(bubble);
    msgs.scrollTop = msgs.scrollHeight;
    turns.push({ role: 'user', content: q });
    ctl = new AbortController();
    send.textContent = '停止';
    const opts = {
      signal: ctl.signal,
      cache: false,
      onText: ({ text }) => { bubble.innerHTML = mdToHtml(text); msgs.scrollTop = msgs.scrollHeight; },
    };
    if (ai.tools && [...session.scenes.values()].some((sc) => sc.stage <= stage)) opts.tools = sceneTools(stage);
    try {
      const text = await ai.ask([{ role: 'user', content: rules(stage, ai.tools) }, ...turns.slice(-12)], opts);
      bubble.innerHTML = mdToHtml(text);
      turns.push({ role: 'assistant', content: text });
      session.record({ type: 'ask', question: q.slice(0, 200), answer: text.replace(/\s+/g, ' ').slice(0, 160), stage });
    } catch (err) {
      const kept = err?.text ? mdToHtml(err.text) : '';
      bubble.innerHTML = `${kept}<div class="muted">${errorText(err)}</div>`;
      if (err?.text) turns.push({ role: 'assistant', content: err.text });
      session.record({ type: 'ask', question: q.slice(0, 200), stage });
      if (AI_PERMANENT.has(err?.code)) { fab.remove(); document.body.classList.remove('ai-on'); document.querySelectorAll('.stage-ask').forEach((b) => (b.hidden = true)); }
    } finally {
      ctl = null;
      send.textContent = '发送';
      msgs.scrollTop = msgs.scrollHeight;
    }
  });
}

function currentStage() {
  // 已解锁的最后一节
  const secs = [...document.querySelectorAll('.stage:not([hidden])')];
  return secs.length ? Number(secs[secs.length - 1].dataset.stage) : 0;
}

function rules(stage, tools) {
  const st = session.stages[stage] || { title: '', src: '' };
  const scenes = [...session.scenes.entries()].filter(([, s]) => s.stage <= stage);
  return `你是「线代学习台」里的助教，正在陪一位在美国读大学的学生学线性代数。用中文交流，术语第一次出现时附英文。

教学方式：
- 引导式：先弄清学生卡在哪里，用一个具体的小例子或一个提问帮他自己想明白，而不是直接灌输结论。
- 回答简短，一般不超过 150 字，一次只讲一个点。公式用 $...$ 包起来。
- 不要提前讲后面小节的内容；学生做练习时不要直接报出答案，先给提示。
${tools && scenes.length ? `- 需要演示时，可以调用 set_variable 改动页面上的图（例如换一个矩阵、移动向量），改完告诉学生看哪张图的哪里。` : ''}

课程：${session.title}
${session.context ? `\n老师提供的背景资料（来自学生的教材和学习档案，回答时以此为准）：\n${session.context.slice(0, 5000)}\n` : ''}
学生当前所在小节：${st.title || '开头'}
这一小节的内容（课件原文）：
${st.src.slice(0, 3500)}

学生到目前为止的学习记录：
${recordText().split('\n').slice(1, 25).join('\n')}
${tools && scenes.length ? `\n页面上的图（可以改其中的变量）：\n${scenes.map(([id, s]) => `- ${id}「${s.title}」当前变量：${JSON.stringify(s.api.snapshot())}`).join('\n')}` : ''}

下面是学生的问题。`;
}

function sceneTools(stage) {
  return [
    {
      name: 'set_variable',
      description: '修改页面上某张图里的一个变量（矩阵、向量或数），图会立刻重画并滚动到可见位置。返回这张图修改后的全部变量。',
      inputSchema: {
        type: 'object',
        properties: {
          scene: { type: 'string', description: '图的编号，如 "图1"' },
          name: { type: 'string', description: '变量名，如 "A" 或 "x"' },
          value: { description: '新的值：数，如 2；向量，如 [1, 2]；矩阵按行写，如 [[2, 1], [1, 1]]' },
        },
        required: ['scene', 'name', 'value'],
      },
      execute({ scene, name, value }) {
        const s = session.scenes.get(String(scene));
        if (!s || s.stage > stage) throw new Error(`没有 ${scene} 这张图`);
        const v = typeof value === 'string' ? JSON.parse(value) : value;
        s.api.set(String(name), v);
        s.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return s.api.snapshot();
      },
    },
  ];
}

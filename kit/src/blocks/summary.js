// summary：本单元小结 + 复制学习记录（给对话里的 Claude 看）
import { parseFields } from '../parse.js';
import { session } from '../session.js';
import { copyRecord, toast } from '../record.js';
import { widget, mdToHtml } from './common.js';

export function summary(el, src) {
  const { fields } = parseFields(src);
  const body = widget(el, { title: fields.title || '学完了 · 把记录交给 Claude', cls: 'summary' });
  body.innerHTML = `
    ${fields.text || fields.note ? `<div>${mdToHtml(fields.text || fields.note)}</div>` : ''}
    <div class="sum-stats"></div>
    <p class="muted">点下面的按钮复制学习记录，回到 Claude 对话里粘贴。它会看到你每道题的作答和你写下的猜想，据此追问或补讲。</p>
    <button type="button" class="btn btn-primary btn-lg sum-copy">复制学习记录</button>`;
  const stats = body.querySelector('.sum-stats');
  const render = () => {
    const L = session.log;
    const prac = L.filter((e) => e.type === 'practice' || e.type === 'answer');
    const first = prac.filter((e) => e.ok && e.attempts === 1).length;
    const asks = L.filter((e) => e.type === 'ask').length;
    stats.innerHTML = `<div class="stat"><b>${prac.length}</b><span>道计算题</span></div><div class="stat"><b>${first}</b><span>一次答对</span></div><div class="stat"><b>${L.filter((e) => e.type === 'conjecture').length}</b><span>条猜想</span></div><div class="stat"><b>${asks}</b><span>次提问</span></div>`;
  };
  session.on(render);
  render();
  body.querySelector('.sum-copy').addEventListener('click', () => copyRecord(toast));
}

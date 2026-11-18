// 探题单独写在板上（不在 board check 里）时：只画成预览（题面 + 一句说明），写法照样查（错了报，不静默）。
// 不收作答、不记证据：免得检验题当练习做了、记成练习（设计第四节）
import { parseProbe } from './spec.js';
import { widget, mdToHtml } from '../blocks/common.js';

export const previewBlock = (type) => (el, src) => {
  const r = parseProbe(type, src);
  if (r.error) throw new Error(r.error);
  const p = r.probe;
  const body = widget(el, { title: '检验题（预览）', cls: 'ck-preview' });
  body.innerHTML = `<div class="ck-q">${mdToHtml(p.type === 'claim' ? `**判断：**${p.claim}` : p.q)}</div><p class="ck-hint">这是检验题（${p.type}，打 ${p.target}，${p.level}）：放进 board check 才能作答。</p>`;
};

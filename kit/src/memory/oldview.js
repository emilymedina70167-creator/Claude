// 被迭代掉的几种课（舞台课、一问一答、实时黑板、自学单元，第十四轮搬进 archive/）：以前上过的在「以前的课」里照列，
// 点进去只出文字——课后报告和每一轮的话。画面的代码不在构建里了，数据一条没删，项目 Claude 也读得到。
// 上半是纯函数（tests/memory-oldview.test.js），下半画到页面上。
import { reportText } from './report.js';
import { transcriptText } from '../project/transcript.js';

const OLD_KINDS = ['stage', 'talk', 'live', 'unit'];
const NAMES = { stage: '舞台课', talk: '一问一答', live: '实时黑板', unit: '自学单元' };

/** 是不是搬走了画面的那几种课（带 aide 的是舞台那一批的黑板课以外的，也算） */
export const oldKind = (s) => !!s && (OLD_KINDS.includes(s.kind) || !!s.aide);

/** 这节课的文字：标题、写明画面停用了、课后报告、每一轮的话 */
export function oldText({ session = {}, report = null, turns = [] } = {}) {
  const name = NAMES[session.kind] || '这种课';
  let rep = '';
  try { rep = report ? reportText(report) : ''; } catch { rep = ''; }
  return [
    `${session.title || '这节课'}${session.date ? `（${session.date}）` : ''}`,
    `${name}的画面已经停用（第十四轮搬进了 archive/），下面是文字记录。`,
    report ? `## 课后报告\n\n${rep || '（报告读不出来）'}` : '',
    turns?.length ? `## 每一轮\n\n${transcriptText(turns)}` : '（这节课没有存下轮次）',
  ].filter(Boolean).join('\n\n');
}

/** 画到页面上：一段只读的文字，左上角回去 */
export function renderOldClass(root, { session, report, turns, onHome }) {
  root.classList.add('dk-oldclass');
  root.innerHTML = `<div class="dk-oldclass-bar"><button type="button" class="btn btn-sm dk-old-home">← 以前的课</button></div><pre class="dk-oldclass-text"></pre>`;
  root.querySelector('.dk-oldclass-text').textContent = oldText({ session, report, turns });
  root.querySelector('.dk-old-home').addEventListener('click', () => onHome?.());
}

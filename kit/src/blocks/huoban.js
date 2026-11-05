// ```huoban 围栏块：一块活板（kit/src/huoban/，docs/talk-plan.md）。课件、课堂、实时黑板里都能放；一问一答的课（kind: talk）也用同一个 HuobanBoard。
// 写法错误、教学检查里要改的报成 session.problem（课堂会让老师重写），提醒报成软提醒；学生的作答记进 session.record（type: huoban）。
import { session } from '../session.js';
import { HuobanBoard } from '../huoban/view.js';

export function huoban(el, src) {
  const box = document.createElement('div');
  el.appendChild(box);
  const board = new HuobanBoard(box, {
    onAction: (a) => {
      if (a.kind === 'info') return;
      // 在板上试（拨、拖、折）只写进数据库，跟着下一条一起给老师；作答进学习记录
      session.record({ type: 'huoban', liveOnly: a.kind === 'explore', text: a.text, ok: a.ok, value: a.value, misread: a.misread, q: a.q, explore: a.kind === 'explore' || undefined, el });
    },
    onSource: (_src, problems) => {
      for (const p of problems) if (p.level !== 'info') session.problem(el, 'huoban', p.msg, { soft: p.level !== 'error' });
    },
  });
  board.setSource(src);
  // 画面测量要等排好版：下一帧再量一次（比板宽的图报成软提醒）
  requestAnimationFrame(() => { for (const p of board.measure()) session.problem(el, 'huoban', p.msg, { soft: true }); });
  return board;
}

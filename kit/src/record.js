// 学习记录：整理成一段文字，复制给对话里的 Claude
import { session } from './session.js';

export function recordText() {
  const L = session.log;
  const lines = [`【学习记录】${session.title}`];
  const st = session.stages.length;
  if (st > 1 && !session.live) lines.push(`进度：已解锁 ${Math.min(st, session.progress + 1)} / ${st} 节`);
  const prac = L.filter((e) => e.type === 'practice');
  if (prac.length) {
    const byType = {};
    for (const e of prac) (byType[e.title] ||= []).push(e);
    for (const [t, es] of Object.entries(byType)) {
      const first = es.filter((e) => e.firstTry).length;
      lines.push(`练习「${t}」：做了 ${es.length} 道，一次答对 ${first} 道`);
      es.filter((e) => !e.firstTry).slice(-3).forEach((e) => lines.push(`  · 错题：${e.q}｜我第一次填 ${e.first}，正确是 ${e.expected}${e.ok ? '（后来改对了）' : ''}${work(e)}`));
    }
  }
  for (const e of L) {
    if (e.type === 'answer') lines.push(`作答「${e.title}」：${e.ok ? (e.attempts === 1 ? '一次答对' : `第 ${e.attempts} 次答对`) : '看了答案'}${e.ok && e.attempts === 1 ? '' : `｜第一次填 ${e.first}，正确是 ${e.expected}`}${work(e)}`);
    if (e.type === 'predict') lines.push(`预测「${e.title}」：猜 (${e.guess}) ，实际 (${e.answer.map((x) => Math.round(x * 100) / 100)})，${e.ok ? '猜得很准' : '偏差较大'}`);
    if (e.type === 'conjecture' || e.type === 'conjecture-try') lines.push(`猜想「${e.title}」：我写${e.via ? `（${e.via === '截图' ? '手写截图' : 'Pencil 手写'}转写）` : ''}「${e.answer}」→ ${e.verdict}`);
    if (e.type === 'quiz') lines.push(`选择题「${e.q}」：${e.ok ? (e.attempts === 1 ? '一次答对' : `第 ${e.attempts} 次答对`) : '看了解析'}${e.wrong?.length ? `｜选错过：${e.wrong.join('；')}` : ''}`);
    if (e.type === 'steps') lines.push(`例题「${e.title}」${e.detail}：${e.giveup ? '想不出来' : e.value !== undefined ? `选「${e.value}」${e.ok === true ? '（对）' : e.ok === false ? '（错）' : ''}` : `我写「${e.text || ''}」`}${e.via ? `（${e.via}转写）` : ''}${e.ms ? `，用时 ${Math.round(e.ms / 1000)} 秒` : ''}`);
    if (e.type === 'recognize') lines.push(`认方法「${e.q}」：选「${e.value}」${e.ok ? '✓' : `✗（应为 ${e.expected}）`}${e.text ? `，理由「${e.text}」` : ''}，${Math.round((e.ms || 0) / 1000)} 秒`);
    if (e.type === 'recognize-sum') lines.push(`认方法「${e.title}」小结：${e.value}，${e.detail}`);
    if (e.type === 'findbug') lines.push(`找错「${e.title}」：${e.value}${e.ok ? '（找对了）' : ''}，正确是${e.expected}${e.text ? `｜我说错在：「${e.text}」` : ''}`);
    if (e.type === 'ask') lines.push(`问了 Claude：「${e.question}」${e.answer ? `→ 它答：「${e.answer}${e.answer.length >= 160 ? '…' : ''}」` : ''}`);
  }
  if (lines.length === 1) lines.push('（还没有记录）');
  lines.push('请根据这些记录判断我哪里还没掌握，针对性地追问或补讲。');
  return lines.join('\n');
}

// 截图作答时 Claude 认出的解答过程
function work(e) {
  if (!e.work) return '';
  const w = e.work.replace(/\s*\n\s*/g, ' / ');
  return `\n  过程（手写转写）：${w.length > 400 ? `${w.slice(0, 400)}…` : w}`;
}

export async function copyRecord(toast) {
  const text = recordText();
  try {
    await navigator.clipboard.writeText(text);
    toast?.('已复制学习记录，去对话里粘贴给 Claude');
    return true;
  } catch {
    showFallback(text);
    return false;
  }
}

function showFallback(text) {
  let box = document.querySelector('.record-fallback');
  if (!box) {
    box = document.createElement('div');
    box.className = 'record-fallback';
    box.innerHTML = '<div class="rf-card"><div class="rf-head"><strong>学习记录</strong><button type="button" class="btn btn-sm rf-close">关闭</button></div><p class="muted">没能自动复制，请长按下面的文字全选后复制。</p><textarea readonly></textarea></div>';
    box.querySelector('.rf-close').onclick = () => box.remove();
    document.body.appendChild(box);
  }
  const ta = box.querySelector('textarea');
  ta.value = text;
  ta.focus();
  ta.select();
}

export function toast(msg) {
  let t = document.getElementById('la-toast');
  if (!t) { t = document.createElement('div'); t.id = 'la-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

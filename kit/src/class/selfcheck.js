// 段画出来以后的补充自检（课堂模式和实时黑板共用）：组件自己的写法检查管不到、但学生会看到问题的两种情况。
import { session } from '../session.js';

/** sec：画好的一段。返回 [{ kind, msg }] */
export function extraProblems(sec) {
  const out = [];
  // 图的 id: / title: / link: 只有一行。多出来的行是写错的命令被当成了续行（比如 title 下面一行写成 vectr …），
  // 组件自检不报，但那条命令就这样悄悄没了：当写法错误处理
  for (const el of sec.querySelectorAll('[data-scene]')) {
    const fields = session.scenes.get(el.dataset.scene)?.api?.fields || {};
    for (const k of ['id', 'title', 'link']) {
      const extra = String(fields[k] ?? '').split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
      if (extra.length) out.push({ kind: [...el.classList].find((c) => c.startsWith('block-'))?.slice(6) || '图', msg: `看不懂这一行：${extra[0].slice(0, 80)}（不是认得的命令，被当成了 ${k}: 的续行）` });
    }
  }
  // 公式写错了（KaTeX 画成红字）：组件自检不管这个，但学生会看到一串红色的源码
  const bad = [...sec.querySelectorAll('.katex-error, .tex-error')].slice(0, 3);
  for (const el of bad) {
    const why = String(el.getAttribute('title') || '').replace(/^ParseError:\s*/, '').slice(0, 160);
    out.push({ kind: '公式', msg: `$${el.textContent.trim().slice(0, 80)}$ 写不出来${why ? `（${why}）` : ''}` });
  }
  return out;
}

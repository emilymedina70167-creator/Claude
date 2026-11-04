// 本地试用（?dev）没有页面里的 Claude：教材入库、挂课程地图、备课用这个模拟的，把整条路走通（不调用 Claude）。
// 看图转写：照提示词里给的文字层拼出条目（「定义」「例」开头的段落当定义、例题），没有文字层就写一条「（模拟转写）」。
// 挂课程地图：所有条目挂到第一块；备课：照这一块的范围写一份资料包，挑头两条照着讲。
export function createDevAI() {
  const pagesOf = (prompt) => (prompt.match(/依次是 PDF 的第 ([\d、]+) 页/)?.[1] || '1').split('、').map(Number);
  const layerOf = (prompt, n) => prompt.match(new RegExp(`【第 ${n} 页的文字层】\\n([\\s\\S]*?)(?=\\n【第 \\d+ 页的文字层】|\\n\\n只输出)`))?.[1] || '';
  function transcribe(prompt) {
    const out = [];
    for (const n of pagesOf(prompt)) {
      out.push(`=== 第 ${n} 页`);
      const text = layerOf(prompt, n).trim();
      if (!text) { out.push('--- 说明 | 模拟转写', '（模拟转写：这一页没有文字层）'); continue; }
      for (const line of text.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
        if (/^第.+讲/.test(line)) out.push(`--- 标题1 | ${line}`);
        else if (/^§/.test(line)) out.push(`--- 标题2 | ${line}`);
        else if (/^(定义|例)/.test(line)) out.push(`--- ${line.startsWith('定义') ? '定义' : '例题'} | ${line.split(/[：:\s]/)[0]}`, line);
        else out.push(line);
      }
    }
    return out.join('\n');
  }
  function map(prompt) {
    const first = prompt.match(/现有的课程地图[^\n]*\n([\s\S]*?)\n\n要求/)?.[1].split('\n').map((l) => l.split(/\s/)[0]).find((id) => /\.\d+\.\d+$/.test(id));
    const ids = [...prompt.matchAll(/^(B\d+-[\d.]+)［/gm)].map((m) => m[1]);
    return JSON.stringify({ blocks: first ? [{ id: first, chunks: ids.length ? [`${ids[0]}~${ids[ids.length - 1]}`] : [] }] : [], notes: '（模拟）全挂到第一块' });
  }
  function prep(prompt) {
    const head = prompt.match(/## 这节课：(\S+) ([^\n（]*)/);
    const ids = [...prompt.matchAll(/^### (B\d+-[\d.]+)［/gm)].map((m) => m[1]).slice(0, 2);
    return JSON.stringify({
      unit: `${head?.[2] || '这一块'}（模拟备课）`, goal: '能说清这一块的核心结论，并做对一道基础题', scope: '照范围',
      plan: '1. 先收上一节的欠账\n2. 用 matrix 演示\n3. 出一道基础题', chunks: ids, components: ['matrix', 'answer'],
      problems: [{ q: '模拟的题：算 $2+3$', answer: '5', point: '加法', source: '自编' }], student: '',
    });
  }
  // 知识点归类（memory/skills.js）：每道题按题号单双归到这一科第一块的两个知识点，错了的挂第一个弱点
  function skills(prompt) {
    const block = prompt.match(/## 课程地图（这一科的块）\n(\S+)/)?.[1] || 'L1.1.1';
    const weak = prompt.match(/## 这一科还开着的弱点[^\n]*\n(W\d+)/)?.[1] || '';
    const rows = [...prompt.matchAll(/^(\d+)\. .*：(\S*) /gm)];
    const out = [`point ${block}#dev-a 模拟知识点甲`, `point ${block}#dev-b 模拟知识点乙`];
    for (const [, n, seq] of rows) out.push(`item ${n} ${block}#dev-${Number(n) % 2 ? 'a' : 'b'}${weak && seq.includes('✗') ? ` ${weak}` : ''}`);
    return out.join('\n');
  }
  // 下课后的复盘（memory/debrief.js）：按记录里学生的第一次作答写一条「还在」的误解、一条开场
  function debrief(prompt) {
    const act = prompt.match(/#(\d+) 【学生】(\[作答\][^\n]*)/);
    const what = act ? act[2].replace(/^\[作答\]\s*/, '').slice(0, 40) : '这节课的第一道题';
    return [
      `误解｜还在｜模拟的误解：${what}｜#${act?.[1] || 1} 学生这样作答`,
      '习惯｜模拟的习惯：先套规则再看题｜#2、#4',
      `开场｜${what.slice(0, 20)}｜模拟的一道题：再做一遍同类题，换一组数`,
      '建议｜先让学生凭自己的理解做一次，再讲规则',
    ].join('\n');
  }
  // 课前预演（rehearse.js）：讲解顺序的第一步写一条会卡、一道探题
  function rehearse(prompt) {
    const step = prompt.match(/### 讲解顺序\n(\d+)\. ([^\n]*)/);
    return [
      `步｜${step?.[1] || 1}｜模拟：学生按旧的想法理解「${(step?.[2] || '第一步').slice(0, 20)}」｜确认题按错的想法也能做对｜模拟的探题：换一组能分开两种想法的数`,
      '改｜模拟：第 1 步先让学生凭自己的理解做一次，再讲',
    ].join('\n');
  }
  return {
    tools: true,
    images: { maxCount: 4, maxInputBytes: 20000000, mediaTypes: ['image/png', 'image/jpeg'] },
    async call(prompt, opts = {}) {
      await new Promise((r) => setTimeout(r, 300));
      const p = String(prompt);
      const text = p.startsWith('你在把一本教材的扫描页') ? transcribe(p) : p.startsWith('你在帮学生整理学习台的课程地图') ? map(p) : p.startsWith('你是这个学生的老师，现在给下一节课备课') ? prep(p) : p.startsWith('你在给学生的一节课的题归类') ? skills(p) : p.startsWith('你在给一节刚上完的课做复盘') ? debrief(p) : p.startsWith('你在课前预演一份教案') ? rehearse(p) : '{}';
      opts.onText?.({ text, delta: text });
      return { text, truncated: false, modelApplied: opts.model || 'claude-opus-5-5', modelTierApplied: opts.modelTier || 'complex' };
    },
  };
}

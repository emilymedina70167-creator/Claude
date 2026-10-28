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
  return {
    tools: true,
    images: { maxCount: 4, maxInputBytes: 20000000, mediaTypes: ['image/png', 'image/jpeg'] },
    async call(prompt, opts = {}) {
      await new Promise((r) => setTimeout(r, 300));
      const p = String(prompt);
      const text = p.startsWith('你在把一本教材的扫描页') ? transcribe(p) : p.startsWith('你在帮学生整理学习台的课程地图') ? map(p) : p.startsWith('你是这个学生的老师，现在给下一节课备课') ? prep(p) : '{}';
      opts.onText?.({ text, delta: text });
      return { text, truncated: false, modelApplied: 'claude-opus-5-5', modelTierApplied: 'complex' };
    },
  };
}

// 本地试用（?dev）没有页面里的 Claude：教材入库、挂课程地图、备课用这个模拟的，把整条路走通（不调用 Claude）。
// 看图转写：照提示词里给的文字层拼出条目（「定义」「例」开头的段落当定义、例题），没有文字层就写一条「（模拟转写）」。
// 挂课程地图：所有条目挂到第一块；备课：照这一块的范围写一份资料包，挑头两条照着讲。
// 模拟班主任（项目 Claude）：边写边显示（分几下吐字）；我说的话里有「测试:笔记」就用笔记本工具建一个 pin 的文件
async function head(turns, opts) {
  const last = String(turns.at(-1)?.content || '');
  const n = turns.filter((t) => t.role === 'assistant').length;
  // 第十四轮：第一次整理、课后那一轮也是项目 Claude（同一份说明）。模拟的：整理时建一个 pin 的文件，课后那一轮读一下报告、记一行
  const nbTool = (opts.tools || []).find((t) => t.name === 'notebook');
  if (/^笔记本还是空的。学习台以前的记录在这些地方/.test(last)) {
    await nbTool?.execute({ op: 'create', path: '学生/底子.md', text: '模拟的第一次整理：读了以前的记录' }).catch(() => {});
    await nbTool?.execute({ op: 'set', path: '学生/底子.md', pin: true }).catch(() => {});
    return { text: '整理好了。', truncated: false, modelApplied: opts.model || 'claude-opus-5-5', modelTierApplied: opts.modelTier || 'complex' };
  }
  const endM = last.match(/^这节课（([^，）]+)[^）]*）结束了。课后报告在 sessions\/(c-[\d-]+)\/report\/main/);
  if (endM) {
    const rd = (opts.tools || []).find((t) => t.name === 'read');
    await rd?.execute({ path: `sessions/${endM[2]}/report/main` }).catch(() => {});
    const has = await nbTool?.execute({ op: 'view', path: '课/记录.md' }).then(() => true, () => false);
    await nbTool?.execute(has ? { op: 'insert', path: '课/记录.md', line: 0, text: `- ${endM[1]}（${endM[2]}）` } : { op: 'create', path: '课/记录.md', text: `- ${endM[1]}（${endM[2]}）` }).catch(() => {});
    return { text: '记下了。', truncated: false, modelApplied: opts.model || 'claude-opus-5-5', modelTierApplied: opts.modelTier || 'complex' };
  }
  // 第十四轮：班主任是项目 Claude，「测试:笔记」时用工具在笔记本里建一个 pin 的文件（真模型自己决定写不写）
  const note = /测试[:：]笔记/.test(last);
  if (note) {
    const nb = (opts.tools || []).find((t) => t.name === 'notebook');
    await nb?.execute({ op: 'create', path: '学生/模拟.md', text: '模拟班主任记的：学生说过「测试:笔记」' }).catch(() => {});
    await nb?.execute({ op: 'set', path: '学生/模拟.md', pin: true }).catch(() => {});
  }
  const text = note
    ? '好，我记在笔记本里了（学生/模拟.md）。'
    : `（模拟班主任，第 ${n + 1} 轮）你说的是：「${last.replace(/^\[页面\][\s\S]*?\n\n/, '').slice(0, 60)}」。\n\n照页面算的，**408** 现在最该补的是页式存储；要看依据可以问我「为什么」。`;
  let out = '';
  for (const part of text.match(/[\s\S]{1,12}/g) || []) {
    if (opts.signal?.aborted) throw { code: 'cancelled', message: '已停止', text: out };
    out += part;
    opts.onText?.({ text: out, delta: part });
    await new Promise((r) => setTimeout(r, 20));
  }
  return { text, truncated: false, modelApplied: opts.model || 'claude-opus-5-5', modelTierApplied: opts.modelTier || 'complex' };
}

export function createDevAI() {
  const pagesOf = (prompt) => (prompt.match(/依次是 PDF 的第 ([\d、]+) 页/)?.[1] || '1').split('、').map(Number);
  const layerOf = (prompt, n) => prompt.match(new RegExp(`【第 ${n} 页的文字层】\\n([\\s\\S]*?)(?=\\n【第 \\d+ 页的文字层】|\\n\\n只输出)`))?.[1] || '';
  // 留题也走真的读法和检查；两道用不同组件，避免模拟题彼此被判成照抄。
  function holds(prompt) {
    const aims = [...prompt.matchAll(/^(a\d+)：/gm)].map(m => m[1]);
    return `=== 题 1
类型：同类
针对：${aims[0] || 'a1'}
\`\`\`let
a = 2
b = 3
\`\`\`
\`\`\`answer
q: 模拟留题：算出 $2+3$。
answer: a+b
\`\`\`
=== 题 2
类型：迁移
针对：${aims[1] || aims[0] || 'a1'}
\`\`\`quiz
q: 一个过程遇到已排好的序列时仍逐对比较，这是否足以说明它不稳定？
- [ ] 是
- [x] 否
\`\`\``;
  }
  // 课后重写记忆摘要（memory/summary.js）：把现在的那一份原样留着，后面接一句这节课并进来的（新笔记、学生的话各带一条）
  function summary(prompt) {
    const cur = (head) => { const m = prompt.match(new RegExp(`## 现在的摘要：${head}[^\\n]*\\n\\n([\\s\\S]*?)(?=\\n\\n## |$)`)); const t = (m?.[1] || '').trim(); return t === '（还没有）' ? '' : t; };
    const note = prompt.match(/## 还没并进摘要的新笔记\n\n- (?:[\d-]+：)?([^\n（]+)/)?.[1] || '';
    const say = prompt.match(/学生打的每一句\n\n- (?:[\d-]+ )?「([^」\n]+)」/)?.[1] || '';
    const add = `（模拟）这节课并进来的：${[note && `新笔记「${note.trim()}」`, say && `学生说过「${say}」`].filter(Boolean).join('；') || '没有新的'}。`;
    const both = prompt.includes('<这一科>');
    return `<共用>\n${cur('共用') || '（模拟）学生在备考研究生入学考试。'}\n</共用>${both ? `\n<这一科>\n${[cur('这一科'), add].filter(Boolean).join('\n\n')}\n</这一科>` : ''}`;
  }
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
  // 课堂助手（aide/）：下课后的整理、补学生卡、课前档案。都写最简单的、守卫核得过的（不引原话、不写编号）
  function after(prompt) {
    const block = prompt.match(/（块 ((?:[A-Z]{2}-)?L\d+(?:\.\d+){2})）/)?.[1] || '';
    const n = [...prompt.matchAll(/^(\d+)\. ［/gm)].length;
    const cards = [...prompt.matchAll(/^### 卡 (\S+) 现在是：/gm)].map((m) => m[1]);
    return [
      '## 复盘', '开场｜模拟：先测上一节的那一步｜模拟的题：换一组数再做一次', '',
      '## 归类', ...(block && n ? [`point ${block}#mock 模拟的知识点`, ...Array.from({ length: n }, (_, i) => `item ${i + 1} ${block}#mock`)] : ['skip 0']), '',
      '## 事实', '````board memo', 'note text="模拟：这节课学生先自己试了几下才答"', '````', '',
      ...cards.flatMap((id) => [`## 卡 ${id}`, '概括｜模拟的学生卡：这一块上过课', '先测｜模拟：换一组数再测一次', '']),
    ].join('\n');
  }
  const card = () => '概括｜模拟的学生卡\n先测｜模拟：换一组数再测一次';
  const brief = () => '要点｜模拟：这节课开头先测上一节没过的那一步';
  // 话的账（memory/said.js，第十一轮）：带「测试:要求」的那句记成一条要求，别的都不用记
  function said(prompt) {
    const items = [...prompt.matchAll(/^### (ev-[^\s（]+)（[^）]*）\n学生打的：(.*)$/gm)];
    return items.map(([, id, text]) => (text.includes('测试:要求') ? `${id}｜新要求｜text=测试要求：页面在课上记下的一条｜scope=all` : `${id}｜不用记｜why=模拟`)).join('\n');
  }
  // 旁听（aide/watch.js，第 2 批）
  const watch = () => '以前｜模拟：这一步以前也停过很久';
  return {
    tools: true,
    images: { maxCount: 4, maxInputBytes: 20000000, mediaTypes: ['image/png', 'image/jpeg'] },
    async call(prompt, opts = {}) {
      // 自动测试要看「发给模型的字」（备课、班主任、补收尾里还有没有旧规矩）：最近 30 次调用的整份提示词留在这里。只有 ?dev 的模拟模型有
      const seen = (globalThis.LAKitDevAI ||= []);
      seen.push(Array.isArray(prompt) ? prompt.map((t) => String(t?.content ?? '')).join('\n\n') : String(prompt));
      if (seen.length > 30) seen.shift();
      await new Promise((r) => setTimeout(r, 300));
      // 项目 Claude（班主任；第十四轮 project/system.js）：传的是一轮一轮的 turns，第一条是说明
      if (Array.isArray(prompt) && String(prompt[0]?.content || '').startsWith('# 学习台\n\n你是学生学习台里的 Claude')) return head(prompt, opts);
      const p = String(prompt);
      const text = p.startsWith('你在替一个备考研究生入学考试的学生维护「记忆摘要」') ? summary(p) : p.startsWith('你在给一节刚上完的黑板课留隔天再做的题') ? holds(p) : p.startsWith('你在把一本教材的扫描页') ? transcribe(p) : p.startsWith('你在帮学生整理学习台的课程地图') ? map(p) : p.startsWith('你是这个学生的老师，现在给下一节课备课') ? prep(p) : p.startsWith('你在给学生的一节课的题归类') ? skills(p) : p.startsWith('你在给一节刚上完的课做复盘') ? debrief(p) : p.startsWith('你在课前预演一份教案') ? rehearse(p) : p.startsWith('你在给一节刚上完的舞台课做课后整理') ? after(p) : p.startsWith('你在给学生的学习台写一张学生卡') ? card(p) : p.startsWith('你在给下一节课的老师准备这节课要知道的事') ? brief(p) : p.startsWith('你在旁听一节舞台课') ? watch(p) : p.startsWith('你在给一位考研学生的学习台记账') ? said(p) : '{}';
      opts.onText?.({ text, delta: text });
      return { text, truncated: false, modelApplied: opts.model || 'claude-opus-5-5', modelTierApplied: opts.modelTier || 'complex' };
    },
  };
}

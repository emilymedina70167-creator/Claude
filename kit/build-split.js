// 说明书瘦身（docs/desk-plan.md 第 6 节）：外部的 Claude 每个新对话先读组件库里的 CLAUDE-PROJECT.md，
// 整份约 210 KB（约 7 万 token），其中约 150 KB 是第三节「组件参考」。发布组件库时拆开：
// - 主说明 CLAUDE-PROJECT.md：别的几节原样；第三节只留开头的说明、通用的表达式写法，加一张组件一览（一个组件一行，写着去哪读）
// - 每个组件一份写法 components/<名字>.md（精简版 + 完整写法），外部要用哪个读哪个
// 仓库里的 CLAUDE-PROJECT.md 还是整份（课堂里的组件手册也照旧从它截），拆出来的放在 kit/dist/docs/，纯函数，有测试（tests/split.test.js）。
import { docSections, sectionNames } from './src/subject.js';
import { ENGINES } from './src/engines/registry.js';

// 每节课都用得上的写法：主说明里也留着（精简版）
const INLINE = ['let', 'calc'];
const START = /^##\s*三\s*[、.．]\s*组件参考/;
const NEXT = /^##\s*四\s*[、.．]/;

/** 一个组件小节的文件名：标题里第一个组件名（「kmp / hash / bsearch」→ kmp） */
const fileOf = (sec) => `components/${sec.names[0]}.md`;
// 去掉科目标记、「完整写法」分隔行，和第三节末尾那条分隔线（---）
const strip = (lines) => lines.filter((l) => !/^\s*<!--\s*(科目|完整写法)\s*[:：-]?.*-->\s*$/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim().replace(/\n+-{3,}$/, '').trim();

/**
 * markdown：整份 CLAUDE-PROJECT.md；kitUrl：组件库地址（告诉外部去哪读组件文件）。
 * 返回 { main（主说明）, files: { 'components/answer.md': 内容, … }, index: [{ names, file, desc, tags }] }
 */
export function splitProject(markdown, { kitUrl = '' } = {}) {
  const lines = String(markdown ?? '').split('\n');
  const s = lines.findIndex((l) => START.test(l));
  const e = lines.findIndex((l, i) => i > s && NEXT.test(l));
  if (s < 0 || e < 0) throw new Error('CLAUDE-PROJECT.md 里找不到第三节「组件参考」或第四节');
  const sec3 = lines.slice(s + 1, e).join('\n');
  const keep = [];
  const files = {};
  const index = [];
  for (const sec of docSections(sec3)) {
    if (!sec.head) { keep.push(strip(sec.body)); continue; }
    // 没有组件名的小节（表达式、其他组件）是通用写法，留在主说明里
    if (!sec.names.length) { keep.push(strip([...sec.body, ...(sec.detail || [])])); continue; }
    // 组件名只看标题冒号前面那段（「conjecture：…（`grade: off` …）」后面的词不算）
    const names = sectionNames(sec.head.split(/[：:]/)[0]);
    if (names.length) sec.names = names;
    // let、公式里的 \calc / \hl / \chalk 每节课都用：主说明里也留一份
    if (sec.names.some((n) => INLINE.includes(n))) keep.push(strip(sec.body));
    const file = fileOf(sec);
    const text = strip([...sec.body, ...(sec.detail || [])]);
    files[file] = files[file] ? `${files[file]}\n\n${text}` : `${text}\n`;
    const desc = sec.head.replace(/^#+\s*/, '').replace(/^[^：:]*[：:]\s*/, '').trim();
    index.push({ names: sec.names, file, desc, tags: sec.tags });
  }
  const how = `每个组件的写法（字段、例子、常见错法）单独放在学习台里，**要用哪个先读哪个**：\`Artifact\` 工具 \`action: "read"\`，\`url\`${kitUrl ? ` 是 ${kitUrl}` : ' 是学习台的地址'}，\`path\` 写下表里的文件（比如 \`"components/answer.md"\`）；一次可以用 \`paths\` 读好几个。没读写法就写组件，页面会报写法错误。`;
  // 板书标注（圈、框、大括号、荧光笔……）不是组件，是教具指令 mark：外部的 Claude 照组件一览找「标注」找不到，
  // 就以为没有这个功能（2026-11-03）。一览里写一行指过去，写法也单独放一份 components/mark.md
  // 演示组件的共用写法（ask、mode: quiz / fill、vary、课堂的 figure step）在 stepper.md：只读 sort.md 看不到，每份末尾指过去
  if (files['components/stepper.md']) {
    for (const x of index) if (x.file !== 'components/stepper.md' && x.names.some((n) => ENGINES[n]) && !files[x.file].includes('components/stepper.md')) files[x.file] += '\n这是演示组件：先猜再揭晓（`ask`）、`mode: quiz` / `fill`、`vary:` 滑块、课堂里 `figure … set step=` 这些共用写法见 `components/stepper.md`。\n';
  }
  const markDoc = markSection(markdown);
  if (markDoc) files['components/mark.md'] = `${markDoc}\n`;
  const table = [
    ...index.map((x) => `- \`${x.names.join('` / `')}\`${x.tags ? `（${x.tags.join('、')}）` : ''}：${x.desc} → \`${x.file}\``),
    ...(markDoc ? ['- **板书标注**（圈、框、大括号、下划线、波浪线、着重号、荧光笔、✓ ✗、箭头；也叫 mark、tag、highlight、圈画）：不是组件，是教具指令 `mark`（课堂里写 board mark 块，实时黑板写进 `ops`），写法见第四节「教具指令：figure、mark / unmark」 → `components/mark.md`'] : []),
  ].join('\n');
  const sec3new = [lines[s], '', keep.filter(Boolean).join('\n\n'), '', '### 组件一览（写法要单独读）', '', how, '', table, ''].join('\n');
  const main = [...lines.slice(0, s), sec3new, ...lines.slice(e)].join('\n');
  return { main, files, index };
}

/** 第四节里 mark / unmark 那一段（「**mark：指着讲」到 unmark 那一段结束）；找不到就是空串 */
export function markSection(markdown) {
  const src = String(markdown ?? '');
  const a = src.indexOf('**mark：指着讲');
  const u = src.indexOf('**unmark：撤掉标注。**', a);
  if (a < 0 || u < 0) return '';
  const end = src.indexOf('\n\n', u);
  return `# 板书标注：mark / unmark（教具指令，不是组件）\n\n${src.slice(a, end < 0 ? undefined : end).trim()}`;
}

// 第十五轮：手册第四节「黑板指令」在仓库里只留一行标记，发布时填进课堂说明里的同一份写法（prompt.js 的 PROTOCOL_DOC、
// PROJECT_CLASS_DOC），外部和页面里的老师读到的是同一份，不会两处各改各的
export const PROTOCOL_MARK = '<!-- 黑板指令：构建时从 kit/src/class/prompt.js 的 PROTOCOL_DOC 填进学习台发布的手册（kit/build-split.js 的 injectProtocol）。页面里的老师和外部用的是同一份 -->';
export function injectProtocol(markdown, text) {
  return String(markdown ?? '').replace(PROTOCOL_MARK, () => String(text ?? '').trim());
}

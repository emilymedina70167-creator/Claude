// 说明书瘦身（docs/desk-plan.md 第 6 节）：外部的 Claude 每个新对话先读组件库里的 CLAUDE-PROJECT.md，
// 整份约 210 KB（约 7 万 token），其中约 150 KB 是第三节「组件参考」。发布组件库时拆开：
// - 主说明 CLAUDE-PROJECT.md：别的几节原样；第三节只留开头的说明、通用的表达式写法，加一张组件一览（一个组件一行，写着去哪读）
// - 每个组件一份写法 components/<名字>.md（精简版 + 完整写法），外部要用哪个读哪个
// 仓库里的 CLAUDE-PROJECT.md 还是整份（课堂里的组件手册也照旧从它截），拆出来的放在 kit/dist/docs/，纯函数，有测试（tests/split.test.js）。
import { docSections, sectionNames } from './src/subject.js';

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
  const how = `每个组件的写法（字段、例子、常见错法）单独放在组件库里，**要用哪个先读哪个**：\`Artifact\` 工具 \`action: "read"\`，\`url\`${kitUrl ? ` 是 ${kitUrl}` : ' 是组件库的地址'}，\`path\` 写下表里的文件（比如 \`"components/answer.md"\`）；一次可以用 \`paths\` 读好几个。没读写法就写组件，页面会报写法错误。`;
  const table = index.map((x) => `- \`${x.names.join('` / `')}\`${x.tags ? `（${x.tags.join('、')}）` : ''}：${x.desc} → \`${x.file}\``).join('\n');
  const sec3new = [lines[s], '', keep.filter(Boolean).join('\n\n'), '', '### 组件一览（写法要单独读）', '', how, '', table, ''].join('\n');
  const main = [...lines.slice(0, s), sec3new, ...lines.slice(e)].join('\n');
  return { main, files, index };
}

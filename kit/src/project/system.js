// 项目 Claude 每一轮的说明（第十四轮）：
// 事实一段 → 学生写的项目指令（原样）→ 你的笔记本（pin 的整份、目录、用量）→ 学习台里有什么 → 工具 → 调用的地方给的几段（课堂：组件写法、资料、黑板现状……）。
// 底线（学生 2026-11-17）：不替它做任何事。页面拼的那几段只写事实；学生的指令、它的笔记原样放，不加「以它为准」之类的包装。纯函数。
import { pinnedText, notebookDir } from './notebook.js';
import { neutral } from '../memory/digest.js';

export const FORBIDDEN = ['你应该', '必须', '根本规则', '以它为准', '照做'];
const enc = new TextEncoder();
const bytes = (s) => enc.encode(String(s ?? '')).length;
const kb = (b) => (Math.round(b / 102.4) / 10).toFixed(1).replace(/\.0$/, '');

/** 身份的事实：在哪、学生在准备什么、今天、版本 */
export function identityText({ today = '', version = '', examDays = null, target = '' } = {}) {
  return neutral([
    '你是学生学习台里的 Claude。学习台是学生自己做的：上课的黑板、记忆、教材、真题、每一次作答都在这里，你手边有读、搜、写的工具。',
    target ? `学生在准备考研：${target}${Number.isFinite(examDays) ? `，离初试还有 ${examDays} 天` : ''}。` : '',
    `今天 ${today || '（没给日期）'}${version ? `；学习台版本 ${version}` : ''}。`,
  ].filter(Boolean).join('\n'));
}

/**
 * facts：{ today, version, examDays, target }；instructions：学生写的项目指令；notes：笔记本（notebook 一类）；catalog：catalog.js 的文字；
 * toolsDoc：工具的说明；sections：[{ title, text }] 调用的地方另给的几段；max：整份的上限（字节）
 * 返回 { text, sizes: { total, instructions, pinned, rest }, skipped }
 */
export function projectSystem({ facts = {}, instructions = '', notes = [], catalog = '', toolsDoc = '', sections = [], max = 160 * 1024 } = {}) {
  const instr = String(instructions ?? '').trim();
  const live = (notes || []).filter((d) => d && !d.deleted && d.path);
  const head = `# 学习台\n\n${identityText(facts)}`;
  const instrSec = `# 学生写的项目指令\n\n${instr || '（学生还没写）'}`;
  const rest = [
    `# 学习台里有什么\n\n${neutral(catalog || '')}`,
    toolsDoc ? `# 工具\n\n${neutral(toolsDoc)}` : '',
    ...(sections || []).filter((s) => s?.text).map((s) => `# ${s.title}\n\n${s.text}`),
  ].filter(Boolean);
  // 用量那一行的字数先按最长的估（几个数），算出笔记能占多少
  const usageGuess = '这一轮说明一共 999.9 KB：项目指令 999.9 KB、笔记 999.9 KB、其余 999.9 KB；上限 999.9 KB。';
  const fixed = bytes([head, instrSec, ...rest].join('\n\n')) + bytes(usageGuess) + 400;
  const room = Math.max(0, max - fixed);
  const pin = live.length ? pinnedText(live, room) : { text: '', used: 0, skipped: [] };
  const notesBody = live.length
    ? [
      pin.text || '（没有标 pin 的文件：要每一轮都带着的，set pin=true）',
      pin.skipped.length ? `这几个 pin 了，这一轮没放下：${pin.skipped.map((s) => `${s.path}（${kb(s.bytes)} KB）`).join('、')}` : '',
      `目录：\n${notebookDir(live)}`,
    ].filter(Boolean).join('\n\n')
    : '笔记本还是空的。以前的记录在下面「学习台里有什么」里。';
  const build = (usage) => [head, instrSec, `# 你的笔记本\n\n${usage}\n\n${notesBody}`, ...rest].join('\n\n');
  const draft = build(usageGuess);
  const total = bytes(draft);
  const sizes = { total, instructions: bytes(instr), pinned: pin.used, rest: Math.max(0, total - bytes(instr) - pin.used) };
  const usage = `这一轮说明一共 ${kb(sizes.total)} KB：项目指令 ${kb(sizes.instructions)} KB、笔记 ${kb(sizes.pinned)} KB、其余 ${kb(sizes.rest)} KB；上限 ${kb(max)} KB。`;
  return { text: build(usage), sizes, skipped: pin.skipped };
}

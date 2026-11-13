// 课堂助手（第九轮，docs/superpowers/specs/2026-11-13-aide-design.md）的两类集合：学生卡、课前档案。
// 都是从原始记忆派生出来的一层（随时能照错题、弱点、证据……重写），不是事实的来源，所以不进记忆库的 COLLECTIONS
// （那边首页整类订阅、自检写指纹、恢复按规矩查……派生的东西不该进那一套）。照考试资料的做法另立、按需读（aide/load.js）。
// 纯函数，有测试（tests/aide-schema.test.js）。不 import memory/schema.js：那边的 canWrite 要 import 这边。

export const AIDE_SPACES = ['math', 'cs', 'en'];
// 课程地图块的编号（线代不带前缀：L2.1.4；别的门课 DS-L8.2.1）
const BLOCK = '(?:[A-Z]{2}-)?L\\d+(?:\\.\\d+)*';

export const AIDE_COLLECTIONS = {
  // 每块一张学生卡（cards/DS-L8.2.1），外加每科一张跨块的（cards/x-cs：通用弱点、思维习惯）
  cards: {
    label: '学生卡', writers: ['page', 'chat'],
    id: { re: new RegExp(`^(?:${BLOCK}|x-(?:math|cs|en))$`), eg: 'DS-L8.2.1、L2.1.4、x-cs' },
    required: ['text', 'at', 'src'],
    enums: { space: AIDE_SPACES },
  },
  // 每科一份课前档案（aide_briefs/cs）：给哪几块写的、依据的卡的指纹
  aide_briefs: {
    label: '课前档案', writers: ['page', 'chat'],
    id: { re: /^(?:math|cs|en)$/, eg: 'math、cs、en' },
    required: ['space', 'blocks', 'text', 'at', 'sig'],
    enums: { space: AIDE_SPACES },
  },
};

export const cardId = (block) => String(block || '');
export const crossId = (space) => `x-${space}`;

/** role 能不能写 coll；不是助手的集合返回 null（交给记忆库、考试资料那边判） */
export function canWriteAide(role, coll) {
  const c = AIDE_COLLECTIONS[coll];
  return c ? c.writers.includes(role) : null;
}

const empty = (v) => v === undefined || v === null || v === '';

/** 一次写守不守规矩：问题的列表；不是助手的集合返回空的。学生卡要么挂块（block）要么是跨块的（space） */
export function validateAide(coll, id, data) {
  const c = AIDE_COLLECTIONS[coll];
  if (!c || !data || typeof data !== 'object') return [];
  const key = String(id ?? '');
  const out = [];
  if (!c.id.re.test(key)) out.push(`编号「${key}」不对（${c.label}的编号像 ${c.id.eg}）`);
  for (const f of c.required) if (empty(data[f]) && !(f === 'blocks' && Array.isArray(data[f]))) out.push(`缺了必填的 ${f}`);
  if (coll === 'cards' && empty(data.block) && empty(data.space)) out.push('缺了 block（块的卡）或 space（跨块的卡）');
  for (const [f, vals] of Object.entries(c.enums)) if (!empty(data[f]) && !vals.includes(String(data[f]))) out.push(`${f} 是「${data[f]}」，只能是 ${vals.join(' / ')}`);
  return out.map((m) => `${c.label} ${key}：${m}`);
}

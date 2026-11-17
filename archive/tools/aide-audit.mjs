#!/usr/bin/env node
// 课堂助手的量法（第九轮，docs/superpowers/specs/2026-11-13-aide-design.md 第 7 节）：只读，拿 ArtifactData list 存下来的真数据量
//   node tools/aide-audit.mjs <存数据的目录> [--block DS-L8.2.1]
// 目录照 ArtifactData 的 out_dir：<目录>/<集合>/<编号>.json（cards、aide_briefs、sessions、errors……）。私人数据放 .superpowers/ 或 scratchpad，不进 git。
// 打印：卡几张、每张多大、出处对得上几成（只核编号和块，轮次和原话要每节课的记录，这里不读）；
// 给了 --block：照这一块开一节课时「你对学生的了解」那一节多大、带了几张卡、档案能不能用、原来只进目录的条目里有几条在卡或档案里提到了。
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { memoryDigest } from '../kit/src/memory/digest.js';
import { parseCard, checkCardLines, cardStale, CARD_MAX } from '../kit/src/aide/card.js';
import { aideForTurn } from '../kit/src/aide/brief.js';
import { spaceOfId } from '../kit/src/memory/space.js';
import { MEMORY_COLLECTIONS } from '../kit/src/memory/schema.js';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const block = args.includes('--block') ? args[args.indexOf('--block') + 1] : '';
if (!dir) { console.error('用法：node tools/aide-audit.mjs <存数据的目录> [--block 块编号]'); process.exit(2); }
const readColl = (p) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => { const j = JSON.parse(readFileSync(join(p, f), 'utf8')); const d = j.data || j; return { id: j.id || f.slice(0, -5), ...d }; }) : []);
const mem = Object.fromEntries(MEMORY_COLLECTIONS.map((c) => [c, readColl(join(dir, c))]));
const cards = readColl(join(dir, 'cards'));
const briefs = readColl(join(dir, 'aide_briefs'));
const bytes = (s) => new TextEncoder().encode(String(s ?? '')).length;

if (!cards.length) console.log('还没有学生卡。');
else {
  let lines = 0, ok = 0, stale = 0, over = 0;
  for (const c of cards) {
    const { lines: ls } = parseCard(c.text);
    const { keep } = checkCardLines(ls.filter((l) => !/#\d|「/.test(l.text)), { mem });
    lines += ls.filter((l) => !/#\d|「/.test(l.text)).length; ok += keep.length;
    if (c.block && cardStale(c, mem)) stale++;
    if (bytes(c.text) > CARD_MAX) over++;
  }
  const sizes = cards.map((c) => bytes(c.text)).sort((a, b) => a - b);
  console.log(`学生卡 ${cards.length} 张（跨块 ${cards.filter((c) => !c.block).length}）；大小中位 ${sizes[Math.floor(sizes.length / 2)]} 字节、最大 ${sizes.at(-1)}；超上限 ${over}；过时 ${stale}`);
  console.log(`出处（编号、块）对得上：${ok} / ${lines} 行${lines ? `（${Math.round((ok / lines) * 100)}%）` : ''}`);
  console.log(`课前档案 ${briefs.length} 份：${briefs.map((b) => `${b.id}→${(b.blocks || []).join('、')}`).join('；') || '没有'}`);
}

if (block) {
  const space = spaceOfId(block);
  const plain = memoryDigest(mem, { block, budget: 28 * 1024, tools: false });
  const aide = aideForTurn({ block, cards, brief: briefs.find((b) => b.id === space) || null, curriculum: mem.curriculum, space });
  const withAide = memoryDigest(mem, { block, budget: 28 * 1024, tools: false, aide });
  const cutIds = plain.cut.flatMap((c) => c.ids || []);
  const aideText = [aide.brief, ...aide.cards].join('\n');
  const surfaced = cutIds.filter((id) => aideText.includes(id));
  console.log(`\n开 ${block} 这一节：记忆那一节 ${plain.bytes} → ${withAide.bytes} 字节（上限 ${28 * 1024}）`);
  console.log(`带了 ${aide.cards.length} 张卡、档案${aide.brief ? '能用' : '不能用 / 没有'}`);
  console.log(`原来只进目录的 ${cutIds.length} 条里，卡或档案提到了 ${surfaced.length} 条${surfaced.length ? `：${surfaced.slice(0, 12).join('、')}` : ''}`);
}

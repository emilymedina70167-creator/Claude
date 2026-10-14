#!/usr/bin/env node
// 验收用：把课堂里的 Claude 每一轮拿到的整份说明（buildSystem，资料包留空）按科目写成文件，
// 给扮演课堂老师的子代理读。用法：node tools/eval-system.mjs 输出目录
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { componentDocs } from '../kit/build-docs.js';
import { buildSystem } from '../kit/src/class/prompt.js';
import { SUBJECTS } from '../kit/src/subject.js';

const out = process.argv[2];
if (!out) { console.error('用法：node tools/eval-system.mjs 输出目录'); process.exit(2); }
mkdirSync(out, { recursive: true });
const DOCS = componentDocs(readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8'));
for (const subject of SUBJECTS) {
  const text = buildSystem({ componentDocs: DOCS, pack: {}, board: [], subject });
  writeFileSync(join(out, `system-${subject}.md`), text);
  console.log(subject, Buffer.byteLength(text), 'bytes');
}

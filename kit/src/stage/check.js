// board stage / ```stage 段的写法检查（外部的预检 ext-check --lint 用）：在不画的场景里演一遍，每一行报的错拼成一句。
// 和 tests/stage-manual.test.js 的演法一样。纯函数（不碰 DOM）
import { Scene } from './scene.js';
import { parseScript } from './script.js';
import './types/index.js';
import { parseStageBox } from '../stageboxspec.js';

/** 一段 stage 组件的原文（id: / title: 字段加镜头指令）→ 问题的数组。prewrite：外部的课整节课开着 .wrong / .miss */
export function stageProblems(src = '', { prewrite = true } = {}) {
  const spec = parseStageBox(String(src ?? ''));
  const s = new Scene();
  s.prewriteAll = prewrite || spec.prewrite === 'all';
  const errs = [...spec.problems];
  if (!spec.script.trim()) return [...errs, 'stage 里没写镜头指令'];
  for (const c of parseScript(spec.script)) {
    try { s.apply(c); } catch (e) { errs.push(`第 ${c.line + spec.offset - 1} 行「${String(c.src).trim().slice(0, 60)}」：${e.message}`); }
  }
  return errs;
}

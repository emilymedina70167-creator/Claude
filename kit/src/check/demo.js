// 示例页（kit/examples/check-demo.html）：不进课堂，单独开一次检验看样子、走流程。判分用 ?dev 的模拟（devsample.js），不调用 Claude
import { parseCheck, baseType } from './spec.js';
import { parseVerdict, claudeIds, verdictPrompt } from './judge.js';
import { mountCheck } from './shell.js';
import { absorbOf } from './flow.js';
import { DEV_CHECK_HEAD, DEV_CHECK_BODY, DEV_CHECK_408_HEAD, DEV_CHECK_408_BODY, DEV_CHECK_EN_HEAD, DEV_CHECK_EN_BODY, devVerdict } from './devsample.js';

// ?sample=408 | en：换成计划 4 的两份样板（希尔排序、语态）；不写是数学那一份
const SAMPLES = { 408: [DEV_CHECK_408_HEAD, DEV_CHECK_408_BODY], en: [DEV_CHECK_EN_HEAD, DEV_CHECK_EN_BODY] };
const sampleOf = () => { try { const v = new URLSearchParams(location.search).get('sample') || ''; return SAMPLES[v] ? v : ''; } catch { return ''; } };

export function demoCheck(host, { delay = 600, sample = sampleOf() } = {}) {
  const [head, body] = SAMPLES[sample] || [DEV_CHECK_HEAD, DEV_CHECK_BODY];
  const { check } = parseCheck(head, body);
  const KEY = `la-check-demo${sample ? `-${sample}` : ''}`; // 每份样板各存各的进度
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
  const log = (window.LAKitCheckDemo = { evidence: [], ended: null });
  const judge = (probe, answer) => new Promise((res) => setTimeout(() => {
    const ids = claudeIds(probe);
    const text = devVerdict(verdictPrompt({ probe, answer, ids }));
    const r = parseVerdict(text, ids, { steps: baseType(probe) === 'solve' });
    res({ items: r.items, lines: r.lines, judgedBy: 'claude', text });
  }, delay));
  const api = mountCheck(host, {
    check, saved, judge,
    fallback: async () => (sample ? '模拟补讲：指出错在哪，只补缺的那一点。' : '模拟补讲：先把两个括号乘开，四项都写出来。'),
    save: (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 不存 */ } },
    record: (ids) => { log.evidence.push(...ids); },
    onEnd: ({ state }) => { log.ended = Object.fromEntries(check.blocks.map((b) => [b.block, absorbOf(state, b.block)])); try { localStorage.removeItem(KEY); } catch { /* 不存 */ } },
  });
  log.api = api;
  return api;
}

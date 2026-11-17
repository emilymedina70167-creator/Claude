// 连着重写的尺子（纯函数；命令行在 tools/summary-ruler.mjs，说明 evals/memory/README.md）。
// 量的是：记忆摘要一节课一节课地重写下去，会不会丢事实、长出规矩、越写越长、把学生的话改了字。
// 提示词、读回、核长度、核引号都用页面同一套函数（kit/src/memory/summary.js、summarydesk.js 的 classPrompt）——
// 尺子量的就是上线的那一份，不另写一套。
import { judgeRewrite, retryPrompt, nextDoc, quotesIn, utf8 } from '../kit/src/memory/summary.js';
import { classPrompt } from '../kit/src/memory/summarydesk.js';
import { spaceOfId } from '../kit/src/memory/space.js';

export const RULE_WORDS = ['必须', '每次都', '一律', '务必', '以后都'];
const IDS = ['shared', 'math', 'cs', 'en'];

/** 有证据的课，照开课的先后排：一节课是一步 */
export function stepsOf(data) {
  const has = new Set((data.evidence || []).map((e) => e.session).filter(Boolean));
  return (data.sessions || []).filter((s) => s && has.has(s.id))
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0) || String(a.id).localeCompare(String(b.id)))
    .map((s, i) => ({ n: i + 1, sid: s.id, space: s.space || spaceOfId(s.block || '') || 'math', title: s.title || '', date: s.date || '' }));
}

export const emptyState = () => ({ summary: { shared: null, math: null, cs: null, en: null }, steps: [] });

/** 第 n 步的提示词（从现在的 state 出发：前面几步照模型的回答算出来的摘要） */
export function stepPrompt(data, state, n) {
  const step = stepsOf(data).find((s) => s.n === n);
  if (!step) throw new Error(`没有第 ${n} 步`);
  const session = data.sessions.find((s) => s.id === step.sid);
  const evidence = (data.evidence || []).filter((e) => e.session === step.sid);
  const last = Math.max(0, ...evidence.map((e) => Number(e.at) || 0));
  const prompt = classPrompt({
    session, space: step.space, evidence, turns: data.turns?.[step.sid] || [], report: data.reports?.[step.sid] || null,
    shared: state.summary.shared, subject: state.summary[step.space],
    // 隔天验的结果只给这节课以前的课的（真的那一天还没有后来的）
    data: { ...data, sessions: (data.sessions || []).filter((s) => (s.startedAt || 0) < (session.startedAt || 0)) },
    today: last ? new Date(last).toISOString().slice(0, 10) : step.date,
  });
  return { n, sid: step.sid, space: step.space, prompt, at: last };
}

/**
 * 收一份回答（页面同一套核法）。同一步第一次有能改的毛病（写长了、引号对不上）→ 'retry'（带重来的提示词，state 里记着等重来）；
 * 重来以后还不行、或者毛病不是能改的 → 'fail'（摘要原样）；过了 → 'done'（两份各进一版）
 */
export function applyAnswer(state, { n, sid, space, prompt, text, at = 0 }) {
  const cur = state.steps.find((s) => s.n === n);
  if (cur && cur.status !== 'retry') throw new Error(`第 ${n} 步已经${cur.status === 'done' ? '收下' : '记成没收'}了`);
  const tries = (cur?.tries || 0) + 1;
  const shared = state.summary.shared;
  const subject = state.summary[space];
  const j = judgeRewrite({ text, prompt, space, shared, subject });
  const base = { n, sid, space, tries, over: [...(cur?.over || []), ...(j.over.length ? [tries] : [])], lost: j.lost, why: j.bad.join('；') };
  const put = (step, summary = state.summary) => ({ summary, steps: [...state.steps.filter((s) => s.n !== n), step].sort((a, b) => a.n - b.n) });
  const snap = (summary) => Object.fromEntries(IDS.map((id) => [id, summary[id]?.text || '']));
  const bytes = (g) => ({ shared: utf8(g.shared || ''), subject: utf8(g.subject || '') });
  if (j.bad.length && j.fixable && tries === 1) {
    return { status: 'retry', retryPrompt: retryPrompt({ prompt, text, over: j.over, lost: j.lost }), state: put({ ...base, status: 'retry', bytes: bytes(j.got), after: snap(state.summary) }) };
  }
  if (j.bad.length) return { status: 'fail', state: put({ ...base, status: 'fail', bytes: bytes(j.got), after: snap(state.summary) }) };
  const summary = {
    ...state.summary,
    shared: nextDoc(shared, { id: 'shared', text: j.got.shared, by: 'page', at, startedAt: at, src: `sessions/${sid}` }),
    [space]: nextDoc(subject, { id: space, text: j.got.subject, by: 'page', at, startedAt: at, src: `sessions/${sid}` }),
  };
  return { status: 'done', state: put({ ...base, status: 'done', why: '', bytes: bytes(j.got), after: snap(summary) }, summary) };
}

const QUOTED = [/「[^「」]*」/g, /“[^“”]*”/g];
/** 正文里的规矩词（引的原话里的不算）：[{ word, sentence }] */
export function ruleWords(text) {
  const out = [];
  for (const raw of String(text ?? '').split(/(?<=[。！？\n])/)) {
    const bare = QUOTED.reduce((s, re) => s.replace(re, '「」'), raw);
    const hits = RULE_WORDS.flatMap((w) => [...bare.matchAll(new RegExp(w, 'g'))].map((m) => ({ at: m.index, word: w }))).sort((a, b) => a.at - b.at);
    for (const h of hits) out.push({ word: h.word, sentence: raw.trim() });
  }
  return out;
}

/**
 * facts：[{ id, what, re, in: 'shared' | 'math' | 'cs' | 'en' | 'any', from: 课的编号 }]：从 from 那一步起每一步都该在。
 * 返回 rows（每一步）、facts（每条事实哪几步不在）、words（最后一版里的规矩词）、rejected、doubleOver、lostQuotes
 */
export function scoreState(state, facts = []) {
  const steps = [...state.steps].sort((a, b) => a.n - b.n);
  const all = (after) => IDS.map((id) => after?.[id] || '').join('\n');
  const rows = steps.map((s) => ({
    n: s.n, sid: s.sid, space: s.space, status: s.status, tries: s.tries, why: s.why || '',
    shared: utf8(s.after?.shared || ''), subject: utf8(s.after?.[s.space] || ''),
    over: (s.over || []).length, lost: (s.lost || []).length,
    words: ruleWords(all(s.after)).length, quotes: quotesIn(all(s.after)).length,
  }));
  const nOf = (sid) => steps.find((s) => s.sid === sid)?.n;
  const fs = facts.map((f) => {
    const from = typeof f.from === 'number' ? f.from : nOf(f.from);
    const re = new RegExp(f.re, f.flags ?? 'i');
    const lostAt = from === undefined ? [] : steps.filter((s) => s.n >= from && !re.test(f.in && f.in !== 'any' ? s.after?.[f.in] || '' : all(s.after))).map((s) => s.n);
    return { id: f.id, what: f.what, in: f.in || 'any', from: from ?? null, lostAt, private: !!f.private };
  });
  const last = steps.at(-1);
  return {
    rows, facts: fs,
    factsLost: fs.filter((f) => f.lostAt.length).length,
    factsUnseen: fs.filter((f) => f.from === null).length,
    words: last ? ruleWords(all(last.after)) : [],
    rejected: steps.filter((s) => s.status === 'fail').length,
    pending: steps.filter((s) => s.status === 'retry').length,
    // 同一步第一次、重来都超长
    doubleOver: steps.some((s) => (s.over || []).length >= 2),
    // 最后也没对上的引号（不收的那几步里的）
    lostQuotes: steps.filter((s) => s.status === 'fail').reduce((n, s) => n + (s.lost || []).length, 0),
    retried: steps.filter((s) => s.tries > 1).length,
  };
}

/** 一张给人看的表（markdown）。私有清单里的事实只写编号，不写内容 */
export function scoreTable(sc) {
  const head = '| 步 | 课 | 科 | 结果 | 试了几次 | 共用（字节） | 这一科（字节） | 引号几段 | 规矩词 | 说明 |\n|---|---|---|---|---|---|---|---|---|---|';
  const ST = { done: '收下', fail: '没收', retry: '等重来' };
  const rows = sc.rows.map((r) => `| ${r.n} | ${r.sid} | ${r.space} | ${ST[r.status] || r.status} | ${r.tries} | ${r.shared} | ${r.subject} | ${r.quotes} | ${r.words} | ${r.status === 'done' ? (r.tries > 1 ? `第一次${r.over ? '写长了' : '引号对不上'}，重来一次改好` : '') : r.why} |`);
  const facts = sc.facts.map((f) => `- ${f.id}${f.private ? '（私有清单）' : `：${f.what}`}——${f.from === null ? '该出现的那节课不在这一趟里' : f.lostAt.length ? `**丢了**：第 ${f.lostAt.join('、')} 步不在` : `从第 ${f.from} 步起每一步都在`}`);
  const words = sc.words.length ? sc.words.map((w) => `- 「${w.word}」：${w.sentence.slice(0, 80)}`).join('\n') : '（没有）';
  return [
    head, ...rows, '',
    `事实 ${sc.facts.length} 条，丢过的 ${sc.factsLost} 条；没收的 ${sc.rejected} 步；重来过的 ${sc.retried} 步；同一步连着两次超长：${sc.doubleOver ? '有' : '没有'}；最后也没对上的引号 ${sc.lostQuotes} 段。`, '',
    '事实清单：', ...facts, '',
    '最后一版里的规矩词（引的原话里的不算）：', words,
  ].join('\n');
}

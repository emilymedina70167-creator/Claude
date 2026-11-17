// 外部的预检工具（第十五轮，tools/ext-check.mjs）的纯函数：这节课已有的 ext_in / ext_out 加上这一轮要写的，
// 拼成 check-lesson.mjs 认的 .class.json（{ unit, subject, turns: [{ student, teacher }] }）。tests/ext-class.test.js
const num = (d) => Number(d?.seq) || Number(String(d?.id ?? '').replace(/\D/g, '')) || 0;
const START = '开始上课。';

export function extClass({ ins = [], outs = [], next = '', unit = '外部的课', subject = '' } = {}) {
  const outBy = new Map((outs || []).map((o) => [num(o), String(o.text || '')]));
  const sorted = [...(ins || [])].sort((a, b) => num(a) - num(b));
  const turns = sorted.map((d) => ({ student: outBy.get(Number(d.after)) || START, teacher: String(d.text || '') }));
  if (next) {
    const latest = [...outBy.keys()].sort((a, b) => b - a)[0];
    turns.push({ student: latest ? outBy.get(latest) : START, teacher: String(next) });
  }
  return { unit, ...(subject ? { subject } : {}), turns };
}

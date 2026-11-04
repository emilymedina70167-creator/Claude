import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rehearsePrompt, parseRehearsal, rehearsalText, REHEARSE_HEAD } from '../kit/src/books/rehearse.js';
import { lessonPlanText } from '../kit/src/books/plan.js';
import { packText } from '../kit/src/class/prompt.js';

const main = {
  unit: '非限制性定语从句', goal: '分清 that 和 which',
  methods: [{ id: 'm1', title: '逗号后不用 that', steps: '看到逗号先排除 that', teach: 2 }],
  sequence: [{ step: 1, point: '限制和非限制', check: '选一选' }, { step: 2, point: 'that 的限制', how: '先让学生填' }],
};
const problems = { items: [{ q: 'He has two sons, ___ are doctors.', answer: 'who', after: 2, needs: ['m1'], traps: '填 that' }] };

test('rehearsePrompt：带教案（顺序、规则、题）、上一节复盘、记忆；不称呼他她', () => {
  const p = rehearsePrompt({ main, problems, memoryText: '弱点 W1：that 万能', debrief: '- 误解（还在）：that 万能', subject: '英语' });
  assert.ok(p.startsWith(REHEARSE_HEAD));
  assert.match(p, /2\. that 的限制\n   怎么讲：先让学生填/);
  assert.match(p, /m1 逗号后不用 that（第 2 步讲）/);
  assert.match(p, /He has two sons/);
  assert.match(p, /放在第 2 步之后；用到 m1/);
  assert.match(p, /上一节下课后的复盘\n- 误解（还在）：that 万能/);
  assert.match(p, /步｜第几步（数字）｜/);
  assert.ok(!/[他她]/.test(p));
});

test('parseRehearsal：读「步」「改」两种行，探题写「无」的不要，按步排；看不懂的报出来', () => {
  const r = parseRehearsal([
    '好的：',
    '步｜2｜以为 that 什么都能引导｜确认题只问限制性从句，按错的想法也对｜He has two sons, ___ are doctors.',
    '步｜第1步｜分不清有没有逗号｜无问题｜无',
    '步｜x｜y',
    '改｜第 2 步先让学生凭感觉填一次再讲规则',
  ].join('\n'));
  assert.deepEqual(r.steps.map((s) => s.step), [1, 2]);
  assert.equal(r.steps[0].probe, undefined);
  assert.match(r.steps[1].probe, /two sons/);
  assert.equal(r.fixes.length, 1);
  assert.equal(r.problems.length, 1);
  assert.match(parseRehearsal('挺好的').problems[0], /回的不是预演/);
});

test('预演进资料包：课堂老师在「课前预演」一节看得到', () => {
  const rehearsal = parseRehearsal('步｜2｜以为 that 万能｜确认题暴露不出来｜He has two sons, ___ are doctors.\n改｜第 2 步先探');
  const t = rehearsalText(rehearsal);
  assert.match(t, /第 2 步：学生多半「以为 that 万能」；问题：确认题暴露不出来；探题：He has two sons/);
  assert.equal(lessonPlanText({ ...main, rehearsal }).rehearsal, t);
  const { text } = packText({ main: { ...main, rehearsal } });
  assert.match(text, /课前预演[^\n]*\n[\s\S]*第 2 步：学生多半/);
  assert.equal(rehearsalText(null), '');
});

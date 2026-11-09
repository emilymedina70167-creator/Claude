// 活的舞台：学生做的事哪些马上叫老师、攒下来的怎么写给老师（kit/src/stage/events.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eventOf, triggers, eventsText, tryCount, TRY_MAX, STUDENT_MAX } from '../kit/src/stage/events.js';

test('哪些马上叫老师：答了问的、点了提示；开放给学生直接动的、拨数是「试」，攒着', () => {
  const help = '给个提示';
  assert.equal(eventOf({ type: 'next', button: help }, { help }).kind, 'help');
  assert.equal(eventOf({ type: 'next', button: '接着' }, { help }).kind, 'answer');
  assert.equal(eventOf({ type: 'value', text: '5', answer: '5', right: true }).kind, 'answer');
  assert.equal(eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit' }).kind, 'try');
  assert.equal(eventOf({ type: 'drag', ref: 'p.u', text: 'x', open: 'drag' }).kind, 'try');
  assert.equal(triggers({ kind: 'try' }), false);
  for (const k of ['answer', 'goal', 'help', 'stuck', 'tries']) assert.equal(triggers({ kind: k }), true);
});

test('写给老师：同一格连着拨的并成一条路，点开看的并成一句，最后是叫老师的那件事', () => {
  const ev = [
    eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit' }),
    eventOf({ type: 'edit', ref: 'B.1,1', from: '2', to: '3', open: 'edit' }),
    eventOf({ type: 'explain', ref: 'C.1,1', open: 'explain' }),
    eventOf({ type: 'edit', ref: 'B.2,2', from: '1', to: '0', open: 'edit' }),
    eventOf({ type: 'explain', ref: 'C.2,1', open: 'explain' }),
    { kind: 'goal', ids: ['g1'], reacted: 2 },
  ];
  const t = eventsText(ev, { goals: new Map([['g1', { text: '让 AB 不再是 O' }]]), secs: 32 });
  assert.equal(t, ['学生拨了 B.1,1：1 → 2 → 3', '学生点开看了 C.1,1、C.2,1 怎么算出来', '学生拨了 B.2,2：1 → 0', '学生做到了挑战 g1「让 AB 不再是 O」（页面已经演了你预写的 2 行）', '（离你上一轮演完过了 32 秒）'].join('\n'));
  assert.equal(tryCount(ev), 5);
  assert.match(eventsText([{ kind: 'tries' }]), new RegExp(`试了 ${TRY_MAX} 下`));
  assert.match(eventsText([{ kind: 'goal', ids: ['g2'], reacted: 0 }]), /你没预写做到以后的行/);
  assert.match(eventsText([eventOf({ type: 'say', text: '为什么换了顺序就不一样' })]), /学生说：「为什么换了顺序就不一样」/);
  assert.doesNotMatch(eventsText([eventOf({ type: 'say', text: 'x' })], { secs: 2 }), /过了/);
});

test('老师做到的挑战：不叫老师，写给老师「不是学生做到的」', () => {
  assert.equal(triggers({ kind: 'goal-by-teacher', ids: ['g1'] }), false);
  const t = eventsText([{ kind: 'goal-by-teacher', ids: ['g1'] }], { goals: new Map([['g1', { text: '让 AB 是 O' }]]) });
  assert.equal(t, '你这一轮让挑战 g1「让 AB 是 O」成立了（不是学生做到的）');
});

// —— 裁判的结论、做完了、长度上限（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 5 节）——
const enc = new TextEncoder();
const rot = (k, verdict) => ({ kind: 'try', act: { type: 'rotate', open: 'rotate', src: `rotate t#${k} right`, verdict } });

test('每一下后面跟裁判的结论：不是正确的下一步、像哪种错、正确的是什么；判对的、做不到的、没让做的、没判成的', () => {
  const t = eventsText([rot(1, { legal: true, right: false, misread: '型从下往上读了', why: '50 右旋', next: '在 30 左旋' })]);
  assert.match(t, /不是正确的下一步，像是型从下往上读了；正确的是在 30 左旋/);
  assert.match(t, /rotate t#1 right（50 右旋）/);
  assert.match(eventsText([rot(2, { legal: true, right: true, misread: null, why: '30 左旋', next: null })]), /30 左旋）——是正确的下一步/);
  assert.match(eventsText([{ kind: 'try', act: { type: 'rotate', open: 'rotate', src: 'rotate t#5 right', blocked: true, verdict: { legal: false, right: false, misread: null, why: '35 没有左孩子，右旋转不了', next: null } } }]), /做不到：35 没有左孩子，右旋转不了/);
  assert.match(eventsText([{ kind: 'try', act: { type: 'rotate', open: 'rotate', src: 'rotate t#1 right', blocked: true, verdict: { legal: true, right: false, misread: null, why: '50 右旋', next: '在 30 左旋' } } }]), /wrong=block[^\n]*没让做/);
  assert.match(eventsText([{ kind: 'try', act: { type: 'rotate', open: 'rotate', src: 'rotate t#1 right', marked: true, verdict: { legal: true, right: false, misread: null, why: '50 右旋', next: '在 30 左旋' } } }]), /淡淡圈/);
  assert.match(eventsText([{ kind: 'try', act: { type: 'rotate', open: 'rotate', src: 'rotate t#1 right', failed: true, verdict: { legal: true, right: null, misread: null, why: null, next: null } } }]), /页面这一下没判成/);
  // 这一下以后的事实（规则交的）跟在后面
  assert.match(eventsText([{ kind: 'try', act: { type: 'rotate', open: 'rotate', src: 'rotate t#2 left', facts: ['现在每个结点都平衡了'], verdict: { legal: true, right: true, misread: null, why: '30 左旋', next: null } } }]), /现在每个结点都平衡了/);
  // 不判的（拨格子）照旧
  assert.equal(eventsText([eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit', verdict: { legal: true, right: null, misread: null, why: null, next: null } })]), '学生拨了 B.1,1：1 → 2');
});

test('call=wrong：走偏的那一下马上叫老师；做完了没预写就叫老师，预写了先不叫', () => {
  const e = eventOf({ type: 'rotate', open: 'rotate', src: 'rotate t#1 right', call: 'now', verdict: { legal: true, right: false, why: '50 右旋', next: '在 30 左旋' } });
  assert.equal(e.kind, 'try');
  assert.equal(triggers(e), true);
  assert.match(eventsText([e]), /call=wrong/);
  assert.equal(triggers({ kind: 'done', ids: ['t'], reacted: 0 }), true);
  assert.equal(triggers({ kind: 'done', ids: ['t'], reacted: 1, quiet: true }), false);
  assert.match(eventsText([{ kind: 'done', ids: ['t'], reacted: 0 }]), /学生把 t 做完了[^\n]*你没预写做完以后的行/);
  assert.match(eventsText([{ kind: 'done', ids: ['t'], reacted: 2 }]), /页面已经演了你预写的 2 行/);
  // call=done 的东西：试的那几下不算进「试了好多下」
  assert.equal(tryCount([{ kind: 'try', patient: true }, { kind: 'try' }]), 1);
});

test('长度上限：试了 30 下，[学生] 一块不超过 3 KB；没有错法的并成「之前又试了 N 下」，同一种错法并成「像是… ×N」', () => {
  const MIS = '型从下往上读了：从 50 往下看是 LR 型（先在 30 左旋，再在 50 右旋），像是读成了 RL';
  const ev = Array.from({ length: 30 }, (_, i) => rot(i + 1, { legal: true, right: i % 3 === 0, misread: i % 3 ? MIS : null, why: `第 ${i + 1} 个结点 右旋`, next: i % 3 ? '先在 30 左旋（最小不平衡子树的根是 50，LR 型）' : null }));
  ev.push({ kind: 'help', act: { type: 'next', button: '给个提示' } });
  const t = eventsText(ev);
  assert.equal(STUDENT_MAX, 3072);
  assert.ok(enc.encode(`[学生]\n${t}`).length <= 3072, `超了：${enc.encode(t).length}`);
  // 没有错法的那 10 下（都是正确的下一步）并成开头一行
  assert.match(t, /^之前又试了 10 下（页面判了 10 下：10 下是正确的下一步，0 下不是），细节省了$/m);
  // 那 20 下同一种错法并成一行：次数是 20，括号里 20 个部件一个不少（第 30 下的也在）
  const refs = Array.from({ length: 30 }, (_, i) => i + 1).filter((k) => (k - 1) % 3).map((k) => `t#${k}`);
  const merged = t.split('\n').filter((l) => l.startsWith(`像是${MIS} ×`));
  assert.equal(merged.length, 1, t);
  assert.equal(merged[0], `像是${MIS} ×20（${refs.join('、')}）`);
  assert.ok(refs.includes('t#30'));
  assert.match(t, /学生点了「给个提示」$/, '叫老师的那件事留着');
  // 不长的不并
  assert.doesNotMatch(eventsText(ev.slice(0, 3)), /之前又试了/);
  // 试的几下全是拨数、叫老师的那件事本身很长：不写「之前又试了 0 下」
  const dials = Array.from({ length: 5 }, () => eventOf({ type: 'dial', name: 'k', value: 2 }));
  assert.doesNotMatch(eventsText([...dials, eventOf({ type: 'say', text: '长'.repeat(1000) })]), /之前又试了 0 下/);
});

// —— 按要紧程度压（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 4 节）——
const bytes = (t) => enc.encode(t).length;
const SAMPLES = JSON.parse(readFileSync(new URL('./fixtures/stage-tries-e2.json', import.meta.url), 'utf8'));
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('错法那几下一定在：真的试演取下来的几段（原样、重复三遍），压完不超过 3 KB，每一种错法都在，并成 ×N 的次数、部件都对', () => {
  for (const [name, evs] of Object.entries(SAMPLES)) {
    // 重复十遍：一定压到第 5 条（同一种错法并成 ×N），真的错法文字也照样认得出
    for (const [tag, ev] of [['原样', evs], ['重复三遍', [...evs, ...evs, ...evs]], ['重复十遍', Array.from({ length: 10 }, () => evs).flat()]]) {
      const what = `${name}（${tag}）`;
      const t = eventsText(ev);
      assert.ok(bytes(`[学生]\n${t}`) <= 3072, `${what} 超了：${bytes(t)}`);
      // 样本里每一种错法：哪几下（部件）
      const kinds = new Map();
      for (const e of ev) {
        const v = e.act?.verdict;
        if (e.kind !== 'try' || v?.right !== false || !v.misread || e.act.error) continue;
        if (!kinds.has(v.misread)) kinds.set(v.misread, []);
        kinds.get(v.misread).push(e.act.src.split(' ')[1]);
      }
      assert.ok(kinds.size, `${what}：样本里要有错法`);
      for (const [m, refs] of kinds) {
        assert.ok(t.includes(m), `${what}：错法「${m}」不见了\n${t}`);
        const lines = t.split('\n');
        const merged = lines.map((l) => l.match(new RegExp(`^像是${esc(m)} ×(\\d+)（(.*)）$`))).filter(Boolean);
        if (merged.length) {
          assert.equal(merged.length, 1, `${what}：同一种只并成一行`);
          assert.equal(Number(merged[0][1]), refs.length, `${what}：×N 的 N`);
          assert.deepEqual(merged[0][2].split('、'), refs, `${what}：括号里的部件`);
        } else {
          assert.equal(lines.filter((l) => l.includes(`像是${m}`)).length, refs.length, `${what}：没并的每一下一行`);
        }
      }
    }
  }
});

test('长事实只留最后一下；连着的正确的下一步并成「接着 N 下」；错法那几下要么都在、要么并成一行', () => {
  const long = (k) => `这一段对了：s.${k} 标成V；${'还差几段没拉对'.repeat(8)}`;
  const why = (k) => `s.${k} 标成V（${'word '.repeat(5).trim()}）`;
  const right = (k) => ({ kind: 'try', act: { type: 'mark', open: 'mark', src: `mark s.${k} V`, verdict: { legal: true, right: true, misread: null, why: why(k), next: null }, facts: [long(k)] } });
  const wrong = (k) => ({ kind: 'try', act: { type: 'mark', open: 'mark', src: `mark s.${k} V`, verdict: { legal: true, right: false, misread: '谓语只圈了一半', why: why(k), next: `谓语是 s.${k}-${k + 1}` }, facts: [long(k)] } });
  const none = (k) => ({ kind: 'try', act: { type: 'mark', open: 'mark', src: `mark s.${k} Cl`, verdict: { legal: true, right: null, misread: null, why: `s.${k} 标成Cl（${'word '.repeat(5).trim()}）`, next: null }, facts: [long(k)] } });
  const ev = [];
  for (let k = 1; k <= 30; k++) {
    ev.push(right(k));
    if ([8, 12, 19, 21, 23].includes(k)) ev.push(wrong(k));
    if ([5, 15, 27, 29].includes(k)) ev.push(none(k));
  }
  ev.push(wrong(25));
  assert.equal(ev.length, 40);
  for (const e of ev) assert.ok(bytes(`。${e.act.facts[0]}`) >= 190, '每下的事实约 200 字节');
  const t = eventsText(ev);
  assert.ok(bytes(`[学生]\n${t}`) <= 3072, `超了：${bytes(t)}`);
  const lines = t.split('\n');
  const mis = lines.filter((l) => l.includes('谓语只圈了一半'));
  assert.ok(mis.length === 6 || (mis.length === 1 && mis[0] === '像是谓语只圈了一半 ×6（s.8、s.12、s.19、s.21、s.23、s.25）'), t);
  assert.match(t, /接着 \d+ 下都是正确的下一步（mark s\.\d+ V、/);
  // 「正确的是」和长事实只在最后一下
  const withNext = lines.filter((l) => l.includes('正确的是'));
  assert.ok(withNext.every((l) => l === lines.at(-1)), t);
  assert.ok(lines.slice(0, -1).every((l) => !l.includes('还差几段没拉对')), t);
});
test('放得下就原样：和改之前一字不差', () => {
  const ev = [
    eventOf({ type: 'rotate', open: 'rotate', src: 'rotate t#1 right', blocked: true, verdict: { legal: true, right: false, misread: '型从下往上读了', why: '50 右旋', next: '先在 30 左旋' } }),
    eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit' }),
    eventOf({ type: 'edit', ref: 'B.1,1', from: '2', to: '3', open: 'edit' }),
    eventOf({ type: 'rotate', open: 'rotate', src: 'rotate t#2 left', facts: ['30 转上来了', '现在 50 的左子树高 2、右子树高 0'], verdict: { legal: true, right: true, misread: null, why: '30 左旋', next: null } }),
    { kind: 'help', act: { type: 'next', button: '给个提示' } },
  ];
  // 改之前跑出来的（kit/src/stage/events.js 在 82d0973）
  assert.equal(eventsText(ev), '学生 rotate t#1 right（50 右旋）——不是正确的下一步，像是型从下往上读了；正确的是先在 30 左旋；照你写的 wrong=block 没让做，弹回去了\n学生拨了 B.1,1：1 → 2 → 3\n学生 rotate t#2 left（30 左旋）——是正确的下一步。30 转上来了；现在 50 的左子树高 2、右子树高 0\n学生点了「给个提示」');
});

test('去掉的只有「正确的是」：照你写的 wrong=block 那一句结论还在', () => {
  const ev = [
    { kind: 'try', act: { type: 'rotate', open: 'rotate', src: 'rotate t#1 right', blocked: true, verdict: { legal: true, right: false, misread: null, why: '50 右旋', next: `先在 30 左旋，${'最小不平衡子树的根是 50'.repeat(10)}` } } },
    { kind: 'try', act: { type: 'rotate', open: 'rotate', src: 'rotate t#2 left', facts: ['现在 '.repeat(395)], verdict: { legal: true, right: true, misread: null, why: '30 左旋', next: null } } },
  ];
  assert.match(eventsText(ev.slice(0, 1)), /；正确的是先在 30 左旋[^；]*；照你写的 wrong=block 没让做/, '放得下时照旧');
  assert.ok(bytes(`[学生]\n${ev.map((e) => eventsText([e])).join('\n')}`) > 3072, '原样放不下');
  const t = eventsText(ev);
  assert.ok(bytes(`[学生]\n${t}`) <= 3072, `超了：${bytes(t)}`);
  const [first] = t.split('\n');
  assert.equal(first, '学生 rotate t#1 right（50 右旋）——不是正确的下一步；照你写的 wrong=block 没让做，弹回去了');
  assert.match(t, /现在 现在/, '最后一下的事实留着');
});

test('拨数的路留最后一下的事实：前几下的去掉', () => {
  const ev = [
    eventOf({ type: 'edit', ref: 'M1.2,1', from: '2', to: '1', open: 'edit', facts: ['M1 第 2 行变了，像 r2 − (1/2)r1；第 2 格该是 1，写的是 4'] }),
    eventOf({ type: 'edit', ref: 'M1.2,1', from: '1', to: '0', open: 'edit', facts: ['M1 第 2 行变了，像 r2 − r1；第 2 格该是 2，写的是 4'] }),
    eventOf({ type: 'edit', ref: 'M1.2,1', from: '0', to: '-1', open: 'edit', facts: ['M1 第 2 行变了，像 r2 − r1；和 M0 同解：否'] }),
  ];
  const t = eventsText(ev);
  assert.equal(t, '学生拨了 M1.2,1：2 → 1 → 0 → −1。M1 第 2 行变了，像 r2 − r1；和 M0 同解：否');
});

test('拨数的路：一下一下并成一条，停在哪、拨到哪做到了挑战', () => {
  const ev = [
    eventOf({ type: 'dial', name: 't', value: 0, from: 1 }),
    eventOf({ type: 'dial', name: 't', value: -1, from: 0, met: ['g1'] }),
  ];
  const t = eventsText(ev);
  assert.match(t, /学生拨了 t：1 → 0 → −1（停在 −1；拨到 −1 时做到了 g1）/);
  assert.equal(eventsText([eventOf({ type: 'dial', name: 'k', value: 3, from: 2 })]), '学生拨了 k：2 → 3（停在 3）');
});

test('拨格子的路：每停一次挑战的每一句成不成立（✓ ✗）', () => {
  const m = (ok) => [{ goal: 'g1', clause: 'Dd = O', ok }];
  const ev = [
    eventOf({ type: 'edit', ref: 'B.2,2', from: '-1', to: '0', open: 'edit', marks0: m(false), marks: m(false) }),
    eventOf({ type: 'edit', ref: 'B.2,2', from: '0', to: '1', open: 'edit', marks: m(false) }),
    eventOf({ type: 'edit', ref: 'B.2,2', from: '1', to: '2', open: 'edit', marks: m(true), met: ['g1'] }),
  ];
  const t = eventsText(ev);
  assert.match(t, /−1 → 0 → 1 → 2/);
  assert.match(t, /Dd = O：✗ ✗ ✗ ✓/);
  assert.equal(t, '学生拨了 B.2,2：−1 → 0 → 1 → 2（拨到 2 时做到了 g1；Dd = O：✗ ✗ ✗ ✓）');
  // 判不了的写 ?，两句各一串
  const two = (a, b) => [{ goal: 'g1', clause: 'Dd = O', ok: a }, { goal: 'g1', clause: 'rank(B) = 1', ok: b }];
  const u = eventsText([eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit', marks0: two(false, null), marks: two(true, false) })]);
  assert.equal(u, '学生拨了 B.1,1：1 → 2（Dd = O：✗ ✓；rank(B) = 1：? ✗）');
});

test('拨数只写一次：拨数事件写一条路，回答那一下不再带', () => {
  const t = eventsText([eventOf({ type: 'dial', name: 't', value: 0, from: 1 }), eventOf({ type: 'next', button: '看出来了' })]);
  assert.equal((t.match(/学生拨了 t/g) || []).length, 1, t);
  assert.match(t, /学生点了「看出来了」$/);
});

// —— 复核修正（task-4-review 的 Minor 1～3）——
test('拨数没写从几拨起（旧的事件没有 from）：✓ ✗ 一个停下的值一个，不错开', () => {
  const m = (ok) => [{ goal: 'g1', clause: 'k = 3', ok }];
  const ev = [
    eventOf({ type: 'dial', name: 'k', value: 1, marks0: m(false), marks: m(false) }),
    eventOf({ type: 'dial', name: 'k', value: 2, marks: m(false) }),
    eventOf({ type: 'dial', name: 'k', value: 3, marks: m(true), met: ['g1'] }),
  ];
  assert.equal(eventsText(ev), '学生拨了 k：1 → 2 → 3（停在 3；拨到 3 时做到了 g1；k = 3：✗ ✗ ✓）');
});

test('拨数也过了裁判、判了对错的一下：不并进路，单独一行写出错法', () => {
  const ev = [
    eventOf({ type: 'dial', name: 't', value: 0, from: 1 }),
    eventOf({ type: 'dial', name: 't', value: -1, from: 0, verdict: { legal: true, right: false, misread: '把正负弄反了', why: 't 拨到 −1', next: '拨到 1' } }),
    eventOf({ type: 'dial', name: 't', value: -2, from: -1 }),
  ];
  const t = eventsText(ev);
  assert.match(t, /像是把正负弄反了/);
  assert.match(t, /学生拨了 t：1 → 0（停在 0）/);
  assert.match(t, /学生把 t 从 0 拨到 −1——不是正确的下一步，像是把正负弄反了/);
  assert.doesNotMatch(t, /1 → 0 → −1/, '判了错的一下不在路上');
  // 那一下以后接着拨：从 −1 拨起，和前面那条路接不上，另起一条（不写成假的「1 → 0 → −2」）
  assert.equal(t, '学生拨了 t：1 → 0（停在 0）\n学生把 t 从 0 拨到 −1——不是正确的下一步，像是把正负弄反了；正确的是拨到 1\n学生拨了 t：−1 → −2（停在 −2）');
  // 拨格子也一样：中间被别的动过（from 对不上），另起一条
  const u = eventsText([
    eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit' }),
    eventOf({ type: 'rowop', open: 'rowop', src: 'rowop B 2r1', verdict: { legal: true, right: null, misread: null, why: '倍乘第 1 行', next: null } }),
    eventOf({ type: 'edit', ref: 'B.1,1', from: '4', to: '5', open: 'edit' }),
  ]);
  assert.equal(u, '学生拨了 B.1,1：1 → 2\n学生 rowop B 2r1（倍乘第 1 行）\n学生拨了 B.1,1：4 → 5');
});

test('页面照 wrong=block 拦下、照 wrong=mark 圈了的那几下：不并进「之前又试了」，同一种只并成 ×N 一行', () => {
  const blk = (k) => ({ kind: 'try', act: { type: 'rotate', open: 'rotate', src: `rotate t#${k} right`, blocked: true, verdict: { legal: true, right: false, misread: null, why: `第 ${k} 个结点 右旋，${'转错了方向'.repeat(6)}`, next: '先在 30 左旋' } } });
  const mrk = (k) => ({ kind: 'try', act: { type: 'rotate', open: 'rotate', src: `rotate t#${k} left`, marked: true, verdict: { legal: true, right: false, misread: null, why: `第 ${k} 个结点 左旋，${'转错了方向'.repeat(6)}`, next: '先在 30 左旋' } } });
  const ok = (k) => ({ kind: 'try', act: { type: 'rotate', open: 'rotate', src: `rotate t#${k} left`, verdict: { legal: true, right: true, misread: null, why: `第 ${k} 个结点 左旋，${'转对了'.repeat(8)}`, next: null } } });
  const plain = (k) => ({ kind: 'try', act: { type: 'rotate', open: 'rotate', src: `rotate t#${k} right`, verdict: { legal: true, right: false, misread: null, why: `第 ${k} 个结点 右旋，${'转错了方向'.repeat(6)}`, next: '先在 30 左旋' } } });
  const ev = [];
  for (let k = 1; k <= 12; k++) ev.push(ok(k), plain(k), k % 2 ? blk(k) : mrk(k));
  const t = eventsText(ev);
  assert.ok(bytes(`[学生]\n${t}`) <= 3072, `超了：${bytes(t)}`);
  const lines = t.split('\n');
  // 拦下的 6 下、圈了的 6 下：要么每下一行，要么各并成一行，下数、部件一个不少
  const count = (re, merged) => lines.reduce((n, l) => n + (l.startsWith('不是正确的下一步 ×') && merged.test(l) ? Number(l.match(/×(\d+)/)[1]) : re.test(l) && !l.startsWith('不是正确的下一步 ×') ? 1 : 0), 0);
  assert.equal(count(/wrong=block 没让做/, /wrong=block 没让做/), 6, t);
  assert.equal(count(/wrong=mark/, /wrong=mark/), 6, t);
  const mb = lines.find((l) => l.startsWith('不是正确的下一步 ×') && /wrong=block/.test(l));
  if (mb) assert.equal(mb, '不是正确的下一步 ×6（t#1、t#3、t#5、t#7、t#9、t#11）；照你写的 wrong=block 没让做，弹回去了');
  // 只说「不是」的那几下照旧并进开头一行
  assert.match(t, /^之前又试了 \d+ 下（页面判了/);
});

// 随机造几百段（固定的种子）：压完不超过 3 KB；每一种错法、拦下的、圈了的一下不少；总下数、对的、错的和造的一样
test('压缩的保证：随机几百段，错法、拦下、圈了的都在，下数一下不差', () => {
  let seed = 20261109;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const MIS = ['谓语只圈了一半', '把非谓语当成了谓语：ensuring 在非谓语里', '型从下往上读了：从 50 往下看是 LR 型'];
  const pad = (n) => '要点'.repeat(Math.floor(rnd() * n));
  for (let round = 0; round < 400; round++) {
    const len = 1 + Math.floor(rnd() * 120);
    const ev = [];
    const want = { n: 0, right: 0, wrong: 0, mis: new Map(), blocked: 0, marked: 0 };
    for (let k = 1; k <= len; k++) {
      const kind = pick(['right', 'right', 'mis', 'plain', 'block', 'mark', 'none']);
      const v = { legal: true, right: kind === 'right' ? true : kind === 'none' ? null : false, misread: kind === 'mis' ? pick(MIS) : null, why: `s.${k} ${pad(10)}`, next: kind === 'right' || kind === 'none' ? null : `谓语是 s.${k}${pad(30)}` };
      const act = { type: 'mark', open: 'mark', src: `mark s.${k} V`, verdict: v, facts: rnd() < 0.5 ? [`这一下以后 ${pad(80)}`] : [] };
      if (kind === 'block') act.blocked = true;
      if (kind === 'mark') act.marked = true;
      ev.push({ kind: 'try', act });
      want.n++;
      if (v.right === true) want.right++;
      if (v.right === false) want.wrong++;
      if (v.misread) want.mis.set(v.misread, (want.mis.get(v.misread) || 0) + 1);
      if (kind === 'block') want.blocked++;
      if (kind === 'mark') want.marked++;
    }
    const t = eventsText(ev);
    const what = `第 ${round} 段（${len} 下）`;
    assert.ok(bytes(`[学生]\n${t}`) <= 3072, `${what} 超了`);
    const got = { n: 0, right: 0, wrong: 0, mis: new Map(), blocked: 0, marked: 0 };
    for (const l of t.split('\n')) {
      let m;
      if ((m = l.match(/^之前又试了 (\d+) 下(?:（页面判了 \d+ 下：(\d+) 下是正确的下一步，(\d+) 下不是）)?，细节省了$/))) { got.n += +m[1]; got.right += +(m[2] || 0); got.wrong += +(m[3] || 0); continue; }
      if ((m = l.match(/^接着 (\d+) 下都是正确的下一步/))) { got.n += +m[1]; got.right += +m[1]; continue; }
      const x = l.match(/^(?:像是(.+)|不是正确的下一步) ×(\d+)（/);
      const k = x ? +x[2] : 1;
      const mis = x ? x[1] : l.match(/，像是(.+?)(?:；|$)/)?.[1];
      got.n += k;
      if (x || /——不是正确的下一步/.test(l)) got.wrong += k;
      else if (/——是正确的下一步/.test(l)) got.right += k;
      if (mis) got.mis.set(mis, (got.mis.get(mis) || 0) + k);
      if (/wrong=block 没让做/.test(l)) got.blocked += k;
      if (/wrong=mark/.test(l)) got.marked += k;
    }
    assert.deepEqual([got.n, got.right, got.wrong, got.blocked, got.marked], [want.n, want.right, want.wrong, want.blocked, want.marked], `${what}\n${t}`);
    assert.deepEqual([...got.mis].sort(), [...want.mis].sort(), `${what} 错法`);
  }
});

// —— 整条分支的最终审查（M4）——
test('M4 学生的一下过了裁判、场景却演不了：写给老师「没演上」和原因，不说「舞台已经照做了」', () => {
  const act = { type: 'drag', open: 'drag', a: { value: '3', key: 1 }, b: { value: '?', key: 9 }, line: 'swap a.1 a.9', error: 'a 只有 3 格，没有第 9 格' };
  const t = eventsText([eventOf(act, { at: 1 })]);
  assert.match(t, /没演上：a 只有 3 格，没有第 9 格/);
  assert.doesNotMatch(t, /舞台已经照做了/);
  const judged = { type: 'rotate', open: 'rotate', src: 'rotate t#1 right', verdict: { legal: true, right: true, misread: null, why: '50 右旋', next: null }, error: '树最多 8 层' };
  const u = eventsText([eventOf(judged, { at: 1 })]);
  assert.match(u, /没演上：树最多 8 层/);
  assert.doesNotMatch(u, /是正确的下一步/);
});

test('页面的一句话（{ kind: note }：老师演的那一下改了学生先点的几样）：不叫老师、不算「试」，照写那句话', () => {
  const note = { kind: 'note', text: 'x', at: 1 };
  assert.equal(triggers(note), false);
  assert.equal(tryCount([note, note]), 0);
  assert.match(eventsText([note]), /x/);
  // 和学生答的一起发：照先后写
  const ans = eventOf({ type: 'pick', refs: ['t.45', 't.40'], expected: 't.45 t.40', same: true, extra: [], missing: [] }, { at: 2 });
  assert.equal(ans.kind, 'answer');
  assert.equal(eventsText([note, ans]), 'x\n学生点了 2 个：t.45、t.40——你预期的是 t.45 t.40：一样');
});

test('拨数的路：学生先点的几样以后第一次变的那一句落在路的前几下也留着（只写一次）', () => {
  const diff = '学生先点的 2 个里，这一下以后变了的：C.1,1；没变的：C.2,2；变了却没点的：没有';
  const ev = (from, value, extra = {}) => ({ kind: 'try', act: { type: 'dial', name: 'k', from, value, ...extra }, at: 0 });
  const t = eventsText([ev(1, 2, { facts: [diff], pickDiff: diff }), ev(2, 3), ev(3, 4)]);
  assert.equal(t.split(diff).length - 1, 1, t);
  assert.match(t, /学生拨了 k：1 → 2 → 3 → 4（停在 4）。学生先点的 2 个里/);
});

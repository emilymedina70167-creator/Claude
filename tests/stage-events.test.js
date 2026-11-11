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
  assert.equal(tryCount(ev), 4, 'B.1,1 连着拨的两下是一下（第三次量以后）');
  assert.match(eventsText([{ kind: 'tries' }]), new RegExp(`试了 ${TRY_MAX} 下`));
  assert.match(eventsText([{ kind: 'goal', ids: ['g2'], reacted: 0 }]), /你没预写做到以后的行/);
  assert.match(eventsText([eventOf({ type: 'say', text: '为什么换了顺序就不一样' })]), /学生说：「为什么换了顺序就不一样」/);
  assert.doesNotMatch(eventsText([eventOf({ type: 'say', text: 'x' })], { secs: 2 }), /过了/);
});

test('最后一审 M2：做完了、预写的行上一次做完时演过 / 老师那一轮拿掉了：照实写，不说「你没预写做完以后的行」', () => {
  const t = eventsText([{ kind: 'done', ids: ['t'], reacted: 0, before: { t: 'played' } }]);
  // 复审 N8：不说「演过了」——拿出来的行可能当时没演上（指着的部件没了），说拿出来用过了、一组只用一次
  assert.match(t, /学生把 t 做完了（页面算出来没有下一步了）（你预写的行上一次做完时已经拿出来用过了：一组只用一次）/);
  assert.doesNotMatch(t, /没预写|演过/);
  assert.match(eventsText([{ kind: 'done', ids: ['t'], reacted: 0, before: { t: 'dropped' } }]), /（你预写的行在你那一轮让它做完时拿掉了，没演）/);
  assert.match(eventsText([{ kind: 'done', ids: ['t'], reacted: 0 }]), /你没预写做完以后的行/);
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

test('学生按「回到……」（open … back=）：攒着写给老师，和撤一步一样不算进「试了好多下」', () => {
  const e = eventOf({ type: 'back', obj: 't', name: '插入后', open: 'back', line: 'back t "插入后"', summary: '层序 30 20 40' });
  assert.equal(e.kind, 'try');
  assert.equal(e.patient, true);
  assert.equal(triggers(e), false);
  assert.equal(tryCount([e, e, e]), 0);
  assert.equal(eventsText([e]), '学生点了「回到插入后」：t 回到了插入后的样子（层序 30 20 40）');
});

test('复核：键盘一格一格写满一张矩阵是在填，不算「试」（同一格再写一次才算一下）；做到挑战、收了一张、做完了的那一下和之前试的不再算', () => {
  const w = (ref, v) => eventOf({ type: 'write', r: 1, c: 1, value: String(v), gesture: 'write', open: 'edit', src: `write ${ref} ${v}`, line: `write ${ref} ${v}` });
  // 3×4 的一张从空格子写满：12 下都是在填，不是试了 12 下没做到（以前写到第 8 格就叫老师「试了 8 下还没做到」）
  const fill = ['1,1', '1,2', '1,3', '1,4', '2,1', '2,2', '2,3', '2,4', '3,1', '3,2', '3,3', '3,4'].map((rc, i) => w(`M.${rc}`, i + 1));
  assert.equal(tryCount(fill), 0);
  assert.equal(tryCount([...fill, w('M.2,3', 9), w('M.2,3', 7)]), 2, '同一格改了两次：算两下');
  assert.equal(tryCount([w('M.1,1', 1), w('N.1,1', 1)]), 0, '两张矩阵的同一格是两格');
  // 做到挑战（收集型收了一张、做完了）的那一下：之前试的几下不再算「还没做到」，它自己也不算
  const drag = (extra = {}) => eventOf({ type: 'drag', open: 'drag', src: 'swap q.1 q.2', ...extra });
  const seven = Array.from({ length: 7 }, () => drag());
  assert.equal(tryCount([...seven, drag()]), 8);
  assert.equal(tryCount([...seven, drag({ reached: ['g1'] })]), 0);
  assert.equal(tryCount([...seven, drag({ reached: ['g1'] }), drag(), drag()]), 2);
  // 填过的格做到挑战以后从头算：下一个挑战再填它是在填
  assert.equal(tryCount([w('M.1,1', 1), drag({ reached: ['g1'] }), w('M.1,1', 2)]), 0);
});

test('复核（第三次量）：同一个拨数、同一格连着 ± 拨的几下算一下「试」（拨 0→8 不是「试了 8 下」）；中间动过别的、换了一格另算', () => {
  const dial = (from, to, name = 'k') => eventOf({ type: 'dial', name, value: to, from });
  const edit = (ref, from, to) => eventOf({ type: 'edit', ref, from: String(from), to: String(to), open: 'edit' });
  assert.equal(tryCount(Array.from({ length: 8 }, (_, i) => dial(i, i + 1))), 1, '拨数 0 → 8 是一下');
  assert.equal(tryCount([edit('B.1,1', 0, 1), edit('B.1,1', 1, 2), edit('B.1,1', 2, 3)]), 1, '同一格 ± 拨三下是一下');
  // 两格交替：每换一格另起一下
  assert.equal(tryCount([edit('B.1,1', 0, 1), edit('B.2,2', 0, 1), edit('B.1,1', 1, 2)]), 3);
  // 中间动过别的（拖一下、点开看一格、撤一步）：另算
  const drag = eventOf({ type: 'drag', open: 'drag', src: 'swap q.1 q.2' });
  assert.equal(tryCount([dial(0, 1), dial(1, 2), drag, dial(2, 3)]), 3);
  assert.equal(tryCount([dial(0, 1), eventOf({ type: 'undo', src: 'set k 1', open: 'edit' }), dial(0, 1)]), 2);
  // 从几拨起对不上（中间这个数被别的动过）：另起
  assert.equal(tryCount([dial(0, 1), dial(5, 6)]), 2);
  // 页面判了对错的一下不并进路（错法单独写），也单算一下
  const judged = eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit', verdict: { legal: true, right: false } });
  assert.equal(tryCount([edit('B.1,1', 0, 1), judged, edit('B.1,1', 2, 3)]), 3);
  // 中间夹着学生答了一问（攒着没叫老师的）：断了；页面记下的一句不断
  assert.equal(tryCount([dial(0, 1), { kind: 'answer', quiet: true, act: { type: 'tap' } }, dial(1, 2)]), 2);
  assert.equal(tryCount([dial(0, 1), { kind: 'note', text: 'x' }, dial(1, 2)]), 1);
  // 拨数和拨格子各拨一条：两下
  assert.equal(tryCount([dial(0, 1), dial(1, 2), edit('B.1,1', 0, 1), edit('B.1,1', 1, 2)]), 2);
  // 做到挑战的那一下以后从头数：接着拨同一个数是新的一下
  assert.equal(tryCount([dial(0, 1), eventOf({ type: 'dial', name: 'k', value: 2, from: 1, reached: ['g1'] }), dial(2, 3), dial(3, 4)]), 1);
});

test('最后一审 I3、复审 N11：来回拨同一个拨数、同一格，换了方向算新的一下（一直来回拨会数到「试了好多下」）；单调拨过去照旧一下；拨回停过的值不另算', () => {
  const dial = (from, to, name = 'k') => eventOf({ type: 'dial', name, value: to, from });
  const edit = (ref, from, to) => eventOf({ type: 'edit', ref, from: String(from), to: String(to), open: 'edit' });
  const path = (...stops) => stops.slice(1).flatMap((to, i) => { const out = []; let v = stops[i]; while (v !== to) { const n = v + Math.sign(to - v); out.push(dial(v, n)); v = n; } return out; });
  // 0 拨到 8：一下（A 批的裁定照旧）
  assert.equal(tryCount(path(0, 8)), 1);
  // 上去再下来一趟（0 → 8 → 0、0 → 5 → 0）：两下——以前拨回停过的值每一下都算，一趟 9 下、6 下，学生只是扫了一遍就叫老师「试了好多下」
  assert.equal(tryCount(path(0, 8, 0)), 2);
  assert.equal(tryCount(path(0, 5, 0)), 2);
  // 1 → 2 → 3 → 2 → 1 → 0：3 → 2 换了方向（一下），接着往下拨不另算
  assert.equal(tryCount(path(1, 3, 0)), 2);
  // 来回扫（0 → 3 → 0 → 3）：每换一次方向一下
  assert.equal(tryCount(path(0, 3, 0, 3)), 3);
  // 1 和 2 之间来回拨 8 下：到 TRY_MAX（一直来回拨照样有人管）
  const flip = Array.from({ length: TRY_MAX }, (_, i) => (i % 2 ? dial(2, 1) : dial(1, 2)));
  assert.equal(tryCount(flip), TRY_MAX);
  // 拨格子一样：± 来回是新的一下；跳着写回去也是换了方向
  assert.equal(tryCount([edit('B.1,1', 0, 1), edit('B.1,1', 1, 2), edit('B.1,1', 2, 1)]), 2);
  assert.equal(tryCount([edit('B.1,1', 0, 2), edit('B.1,1', 2, 5), edit('B.1,1', 5, 2)]), 2);
  // 拨回这条路一开始的值（0 → 1 → 0）：换了方向，两下
  assert.equal(tryCount([dial(0, 1), dial(1, 0)]), 2);
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

// —— 学生手上没事了才叫老师（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 6.2）——
test('hasWork：还挂着要答的一问、没做到的挑战、交给了学生还没做完的东西；ask next（连「给个提示」）不算', async () => {
  const { hasWork } = await import('../kit/src/stage/events.js');
  const { Scene } = await import('../kit/src/stage/scene.js');
  const { parseScript } = await import('../kit/src/stage/script.js');
  const at = (src) => { const s = new Scene(); for (const c of parseScript(src)) s.apply(c); return s; };
  assert.deepEqual(hasWork(at('array a = 3 1 2\nask tap a "点一个" expect=a.1')), ['还有一问没答（ask tap）']);
  assert.deepEqual(hasWork(at('tree t = 30 20 40\nask pick t "哪几个"')), ['还有一问没答（ask pick）']);
  assert.deepEqual(hasWork(at('array a = 3 1 2\nask drag a#1 a#2 "拖过去"')), ['还有一问没答（ask drag）']);
  assert.deepEqual(hasWork(at('array a = 3 1 2\nask value "几格" answer=3')), ['还有一问没答（ask value）']);
  assert.deepEqual(hasWork(at('array a = 3 1 2\nask say "为什么"')), ['还有一问没答（ask say）']);
  assert.deepEqual(hasWork(at('array a = 3 1 2\nopen a\ngoal g2 "排好" when="a sorted"')), ['挑战 g2「排好」还没做到']);
  assert.deepEqual(hasWork(at('tree t = 30 20 _ 10\nopen t rotate')), ['t 还没做完']);
  assert.deepEqual(hasWork(at('tree t = 30 20 _ 10\nopen t rotate\nmatrix M = 1 2 / 2 5\nopen M rowop')), ['t、M 还没做完']);
  assert.deepEqual(hasWork(at('array a = 3 1 2\nask next "好"')), []);
  assert.deepEqual(hasWork(at('array a = 3 1 2\nask next button="给个提示"')), []);
  // 页面判不了的（没写 key 的句子永远等不到做完）不挡着
  assert.deepEqual(hasWork(at('sentence s = "He is running."\nopen s mark')), []);
  assert.deepEqual(hasWork(at('tree t = 20 10 30\nopen t rotate')), [], '已经做完了');
  assert.deepEqual(hasWork(new Scene()), []);
  // 复核：学生做不了的不算（不然页面一直攒着、学生干等）：平衡了、托盘还有数，可只开了 rotate（插不进去）；藏起来的东西
  assert.deepEqual(hasWork(at('tree t = 20 10 30 tray="40"\nopen t rotate')), []);
  assert.deepEqual(hasWork(at('tree t = 20 10 30 tray="40"\nopen t insert')), ['t 还没做完']);
  assert.deepEqual(hasWork(at('tree t = 20 10 30 tray="40"\nopen t place')), ['t 还没做完'], 'place 拖到空位上就是插');
  assert.deepEqual(hasWork(at('tree t = 30 20 _ 10\nopen t rotate\nhide t')), []);
  // 挑战：学生手上什么都动不了（没有 open、没有拨数）就不算；开着别的、有拨数、等着按的按钮在都算
  assert.deepEqual(hasWork(at('array a = 3 1 2\ngoal g2 "排好" when="a sorted"')), []);
  assert.deepEqual(hasWork(at('array a = 3 1 2\ndial k = 1 range=1..3\ngoal g2 "排好" when="a sorted"')), ['挑战 g2「排好」还没做到']);
  assert.deepEqual(hasWork(at('array a = 3 1 2\narray b = 1 2\nopen b\nhide b\ngoal g2 "排好" when="a sorted"')), [], '开着的只有藏起来的 b');
  assert.deepEqual(hasWork(at('array a = 1 2 3\ngoal g2 "排好" when="a sorted" on="就这样"\nask next "好了点下面" button="就这样"')), ['挑战 g2「排好」还没做到']);
});

test('攒着没叫老师的那一句：做完、做到挑战、答对一问后面写「那时 …，没叫你」；收齐了写收了哪几张', async () => {
  const { collectText } = await import('../kit/src/stage/events.js');
  assert.equal(eventsText([{ kind: 'done', ids: ['d'], reacted: 1, quiet: true, held: ['a、b、c 还没做完'] }]), '学生把 d 做完了（页面已经演了你预写的 1 行）；那时 a、b、c 还没做完，没叫你');
  assert.equal(eventsText([{ kind: 'goal', ids: ['g1'], reacted: 2, quiet: true, held: ['还有一问没答（ask tap）', '挑战 g2「再来」还没做到'] }], { goals: new Map([['g1', { text: '排好' }]]) }),
    '学生做到了挑战 g1「排好」（页面已经演了你预写的 2 行）；那时 还有一问没答（ask tap），挑战 g2「再来」还没做到，没叫你');
  assert.equal(eventsText([eventOf({ type: 'tap', ref: 'a.3', value: '7', key: 3, slot: 3, expected: 'a.3', right: true, reacted: 1 })].map((e) => ({ ...e, reacted: 1 }))),
    '学生点了 a.3（7）——你预期的是 a.3，点对了\n学生答对了（页面已经演了你预写的 1 行）');
  const c = { obj: 'B', n: 3, got: ['(1 0; 0 1)', '(2 1; 0 2)', '(0 1; 0 0)'], dup: 2 };
  assert.equal(collectText('g1', c), '学生收齐了 g1 的 3 张：B = (1 0; 0 1)、(2 1; 0 2)、(0 1; 0 0)（另有 2 下和收过的一样，没收）');
  assert.match(eventsText([{ kind: 'goal', ids: ['g1'], reacted: 1, collected: { g1: c } }]), /^学生收齐了 g1 的 3 张：B = \(1 0; 0 1\)、\(2 1; 0 2\)、\(0 1; 0 0\)（另有 2 下和收过的一样，没收）/);
  // 收的时候是 measure（挑战上的 collect）也写得出来
  assert.equal(collectText('g1', { obj: 'B', got: [{ kind: 'matrix', rows: [['1', '0'], ['0', '-1']] }], dup: 0 }), '学生收齐了 g1 的 1 张：B = (1 0; 0 −1)');
});

test('中间被别的动过、另起的一条路：舞台照同一条规矩另起（pathGoesOn），开头那一下带着 marks0，✓ ✗ 照样写', async () => {
  const { pathKey, pathEnd, pathGoesOn } = await import('../kit/src/stage/stage.js');
  // 同一条规矩：从几拨起对得上就接着；没写从几拨起的照旧接着；路的开头（还没有停在哪）总是接得上
  assert.equal(pathGoesOn('2', { from: '2' }), true);
  assert.equal(pathGoesOn('2', { from: 2 }), true);
  assert.equal(pathGoesOn('2', { from: '4' }), false);
  assert.equal(pathGoesOn('2', {}), true);
  assert.equal(pathGoesOn(null, { from: '4' }), true);
  assert.equal(pathEnd({ type: 'dial', value: -1 }), '-1');
  assert.equal(pathEnd({ type: 'edit', to: '5' }), '5');
  assert.equal(pathKey({ type: 'edit', ref: 'B.1,1' }), 'edit:B.1,1');
  assert.equal(pathKey({ type: 'edit', ref: 'B.1,1', blocked: true }), null);
  const m = (ok) => [{ goal: 'g1', clause: 'B = O', ok }];
  const u = eventsText([
    eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit', marks0: m(false), marks: m(false) }),
    eventOf({ type: 'rowop', open: 'rowop', src: 'rowop B 2r1', verdict: { legal: true, right: null, misread: null, why: '倍乘第 1 行', next: null } }),
    eventOf({ type: 'edit', ref: 'B.1,1', from: '4', to: '0', open: 'edit', marks0: m(false), marks: m(true), met: ['g1'] }),
  ]);
  assert.equal(u, '学生拨了 B.1,1：1 → 2（B = O：✗ ✗）\n学生 rowop B 2r1（倍乘第 1 行）\n学生拨了 B.1,1：4 → 0（拨到 0 时做到了 g1；B = O：✗ ✓）');
});

test('点开看怎么算碰到扣着的格：写给老师照实说是几、扣着（学生那边演成 ?）', () => {
  const t = eventsText([
    eventOf({ type: 'explain', ref: 'C.1,1', open: 'explain', hidden: [{ ref: 'C.1,1', value: '19' }, { ref: 'A.1,2', value: '2' }] }),
    eventOf({ type: 'explain', ref: 'C.1,2', open: 'explain' }),
  ]);
  assert.equal(t, '学生点开看了 C.1,1、C.1,2 怎么算出来（扣着的演成了 ?：C.1,1（19，扣着）、A.1,2（2，扣着））');
  // 一下的写法（actText）也一样
  assert.match(eventsText([{ kind: 'answer', act: { type: 'explain', ref: 'C.1,1', hidden: [{ ref: 'C.1,1', value: '-3/2' }] } }]), /C\.1,1（-3\/2，扣着）/);
});

test('复核（第三次量）：键盘填空格子（open M edit input=keypad，M 里有 _）——最后一格填上算做完了；还有空格子算学生手上的事；本来就没有空格子的不算', async () => {
  const { hasWork } = await import('../kit/src/stage/events.js');
  const { Scene } = await import('../kit/src/stage/scene.js');
  const { parseScript } = await import('../kit/src/stage/script.js');
  const at = (src) => { const s = new Scene(); for (const c of parseScript(src)) s.apply(c); return s; };
  const stu = (s, line) => s.apply(parseScript(line)[0], { by: 'student', open: 'edit' });
  const s = at('matrix M = _ _ / _ 4\nopen M edit input=keypad');
  assert.deepEqual(hasWork(s), ['M 还没做完']);
  assert.equal(stu(s, 'write M.1,1 1').done, undefined);
  assert.equal(stu(s, 'write M.1,2 2').done, undefined);
  const fx = stu(s, 'write M.2,1 3');
  assert.deepEqual(fx.done, ['M']);
  assert.deepEqual(fx.filled, ['M'], '是空格子写满了，不是规则算出来没有下一步');
  assert.deepEqual(hasWork(s), []);
  // 写满以后再改一格：不再算一次做完
  assert.equal(stu(s, 'write M.2,1 5').done, undefined);
  // 本来就写满的、± 拨数器（不是键盘）的、藏起来的：不算
  assert.deepEqual(hasWork(at('matrix M = 1 2 / 3 4\nopen M edit input=keypad')), []);
  assert.deepEqual(hasWork(at('matrix M = _ _ / _ _\nopen M edit')), []);
  assert.deepEqual(hasWork(at('matrix M = _ _ / _ _\nopen M edit input=keypad\nhide M')), []);
  // 写给老师：写满了，不说「页面算出来没有下一步了」
  assert.equal(eventsText([{ kind: 'done', ids: ['M'], filled: ['M'], reacted: 0 }]), '学生把 M 的空格子都写满了（页面不判写得对不对）');
});

test('复核（第三次量）：同一张矩阵的几格轮流拨、几个拨数轮流拨，写成一条照先后的路（哪一停是哪张 B 拼得出来）', () => {
  const m = (ok) => [{ goal: 'g1', clause: 'Df = O', ok }];
  const ev = [
    eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit', marks0: m(false), marks: m(false) }),
    eventOf({ type: 'edit', ref: 'B.1,1', from: '2', to: '3', open: 'edit', marks: m(false) }),
    eventOf({ type: 'edit', ref: 'B.1,2', from: '0', to: '1', open: 'edit', marks0: m(false), marks: m(false) }),
    eventOf({ type: 'explain', ref: 'C.1,1', open: 'explain' }),
    eventOf({ type: 'edit', ref: 'B.1,1', from: '3', to: '2', open: 'edit', marks0: m(false), marks: m(true), met: ['g1'], facts: ['Df = O'] }),
  ];
  // 以前：B.1,1 一行（1 → 2 → 3 → 2）、B.1,2 一行，哪一停时 B.1,2 是几拼不出来
  assert.equal(eventsText(ev), '学生拨了 B 的几格：B.1,1 1 → 2 → 3，B.1,2 0 → 1，B.1,1 3 → 2（拨到 B.1,1 = 2 时做到了 g1；Df = O：✗ ✗ ✗ ✗ ✓）。Df = O\n学生点开看了 C.1,1 怎么算出来');
  // 两个拨数轮流拨（第 3 幕的 t、s）：一条路，停在哪各写一个
  const k = (ok) => [{ goal: 'g1', clause: 'Bld = Dir', ok }];
  const d = [
    eventOf({ type: 'dial', name: 't', value: 0, from: 1, marks0: k(false), marks: k(false) }),
    eventOf({ type: 'dial', name: 't', value: -1, from: 0, marks: k(false) }),
    eventOf({ type: 'dial', name: 's', value: 0, from: 1, marks0: k(false), marks: k(false) }),
    eventOf({ type: 'dial', name: 't', value: 0, from: -1, marks0: k(false), marks: k(true), met: ['g1'] }),
  ];
  assert.equal(eventsText(d), '学生拨了 t、s：t 1 → 0 → −1，s 1 → 0，t −1 → 0（停在 t = 0、s = 0；拨到 t = 0 时做到了 g1；Bld = Dir：✗ ✗ ✗ ✗ ✓）');
  // 不是轮流拨的（一格拨完再拨另一格）照旧一格一行；不同的两张矩阵不并
  const one = [
    eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit' }),
    eventOf({ type: 'edit', ref: 'B.2,2', from: '1', to: '0', open: 'edit' }),
    eventOf({ type: 'edit', ref: 'C.1,1', from: '5', to: '6', open: 'edit' }),
    eventOf({ type: 'edit', ref: 'B.2,2', from: '0', to: '-1', open: 'edit' }),
  ];
  assert.equal(eventsText(one), '学生拨了 B.1,1：1 → 2\n学生拨了 B.2,2：1 → 0 → −1\n学生拨了 C.1,1：5 → 6');
  // 中间被别的动过、另起的一段（from 接不上）在一条里也另起一段，从它真正的起点写；交错以前就拨完的那一段照旧单独一行
  const brk = eventsText([
    eventOf({ type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit' }),
    eventOf({ type: 'edit', ref: 'B.1,2', from: '0', to: '1', open: 'edit' }),
    eventOf({ type: 'edit', ref: 'B.1,1', from: '7', to: '8', open: 'edit' }),
    eventOf({ type: 'edit', ref: 'B.1,2', from: '1', to: '2', open: 'edit' }),
  ]);
  assert.equal(brk, '学生拨了 B.1,1：1 → 2\n学生拨了 B 的几格：B.1,2 0 → 1，B.1,1 7 → 8，B.1,2 1 → 2');
  assert.equal(tryCount(ev), 4, '数「试」照旧（一格连着拨的一段算一下）');
});

// —— 舞台主线第一轮 D3-3 / D4-5：老师这一轮的提问没演上，学生手上没事可做——页面马上叫老师重写 ——
test('D3-3：这一轮的提问没演上是一件马上叫老师的事，写给老师说清楚', () => {
  const e = { kind: 'askfail', at: 1 };
  assert.equal(triggers(e), true);
  assert.equal(eventsText([e]), '你上一轮的提问没演上（看下面没演的行）：学生手上只有页面替你挂的打字框，还什么都没做。把那一问重写一遍');
});

// —— 舞台主线第一轮 D4-11：叫老师的那一条里，试的几下以前一律排在最前面，先后乱了 ——
test('D4-11：写给老师照发生的先后——中间做到的挑战、点对的一问不再排到后来试的几下后面', () => {
  const ev = [
    { kind: 'try', act: { type: 'edit', ref: 'B.1,1', from: '1', to: '2', open: 'edit', line: 'write B.1,1 2' } },
    { kind: 'goal', ids: ['g2'], reacted: 1, quiet: true },
    { kind: 'answer', act: { type: 'tap', ref: 'a.3', value: '65' }, held: ['挑战 g3 还没做到'], quiet: true },
    { kind: 'try', act: { type: 'edit', ref: 'B.2,2', from: '0', to: '5', open: 'edit', line: 'write B.2,2 5' } },
    { kind: 'answer', act: { type: 'say', text: '好了' } },
  ];
  assert.equal(eventsText(ev, { goals: new Map([['g2', { text: '第 2 条' }]]) }), [
    '学生拨了 B.1,1：1 → 2',
    '学生做到了挑战 g2「第 2 条」（页面已经演了你预写的 1 行）',
    '学生点了 a.3（65）',
    '（挑战 g3 还没做到，没叫你）',
    '学生拨了 B.2,2：0 → 5',
    '学生说：「好了」',
  ].join('\n'));
});
test('D4-11：同一格连着拨的还是并成一条路，放在这条路开头的地方；最后那两句说明照旧在最后', () => {
  const dial = (from, value) => ({ kind: 'try', act: { type: 'dial', name: 'k', from, value } });
  const ev = [dial(1, 2), { kind: 'note', text: '页面记下的一句', quiet: true }, dial(2, 3), { kind: 'answer', act: { type: 'say', text: '嗯' } }];
  const lines = eventsText(ev, { secs: 9 }).split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^学生拨了 k：1 → 2 → 3/);
  assert.equal(lines[1], '页面记下的一句');
  assert.equal(lines[2], '学生说：「嗯」');
  assert.equal(lines[3], '（离你上一轮演完过了 9 秒）');
});

// 试演工具的自检（npm run check:stage 里跑）：tools/stage-try-examples/ 的几个例子，核输出里该有的东西。
// 这个工具是量舞台用的，它自己说错了，量出来的缺口就错了，所以几种容易出岔子的情况在这里守着。
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'stage-try-examples');
const run = (f) => {
  try { return { code: 0, out: JSON.parse(execFileSync('node', [join(DIR, '..', 'stage-try.mjs'), join(DIR, f), '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 })) }; }
  catch (err) { return { code: err.status ?? 1, out: (() => { try { return JSON.parse(err.stdout); } catch { return null; } })(), err: String(err.stderr || err.message).slice(0, 400) }; }
};
const bad = [];
const expect = (what, ok) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) bad.push(what); };
const stepsOf = (r, cmdArgs) => (r?.out?.[0]?.views?.[0]?.steps || []).filter((s) => s.step.kind === 'student' && `${s.step.cmd} ${s.step.args}`.trim() === cmdArgs);
const stepOf = (r, cmdArgs, n = 0) => stepsOf(r, cmdArgs)[n];
// 某一步的前一步（比「撤一步以后和那一下之前一样」用）
const before = (r, s) => { const all = r?.out?.[0]?.views?.[0]?.steps || []; return all[all.indexOf(s) - 1]; };
// 舞台上的东西（比撤一步前后用）：「最后说的话」不比——有挑战时页面替老师挂的「给个提示」那一问把它清空了，
// 撤一步重放时不重演页面的行，它又回来了（舞台那边的事，记在 task-11 的报告里）
const shape = (st) => String(st || '').split('\n').filter((l) => !/^\s*最后说的话：/.test(l)).join('\n');
const said = (s) => [s?.pending, s?.called?.msg].filter(Boolean).join('\n');
const errs = (s) => (s?.errors || []).map((e) => e.error).join(' / ');

// 1. 学生直接拨矩阵
const m = run('student.txt');
expect('student.txt：写错部件也不崩（退出码 0）', m.code === 0);
expect('写错的部件 B.3,1：记成没演上', /B\.3,1|没有第 3 行|第 3 行/.test(errs(stepOf(m, 'write B.3,1 2'))));
expect('B.2,2 没交给学生：记成没交给学生', /没有交给学生/.test(stepOf(m, 'write B.2,2 2')?.untouched || ''));
expect('拨到 99 越出 range：记成拨不到', /拨不到|range|-3～3|−3～3/.test(errs(stepOf(m, 'write B.1,1 99'))));
expect('拨不到的那一下不交给课堂循环（攒着里没有 99）', !/99/.test(said(stepOf(m, 'write B.1,1 99'))));
const w3 = stepOf(m, 'write B.1,1 3');
expect('一次 write 照真页面一格一格拨：1 → 2 → 3', /1 → 2 → 3/.test(said(w3)));
expect('拨到 3 以后 g1 做到了', (w3?.goals || []).some((g) => g.id === 'g1' && g.status === '做到了'));

// 2. 平面上拖点
const p = run('plane.txt');
expect('plane.txt：退出码 0', p.code === 0);
const pp = stepOf(p, 'vec p P = 2 2');
expect('拖点照真页面写成「点」，演上了', !errs(pp) && /学生把点 p\.P ?拖到了 \(2, 2\)/.test(said(pp)));
const pz = stepOf(p, 'vec p zz = 1 1');
expect('没有的 zz 拖不了：记成没演上，攒着里没有 zz', !!errs(pz) && !/zz/.test(said(pz)));

// 3. 句子里拖词
const s = run('sentence.txt');
expect('sentence.txt：退出码 0', s.code === 0);
expect('拖词那句话照真页面写：拖到了「He」后面', /学生把「ago」拖到了「He」后面/.test(said(stepOf(s, 'move s.7 after s.1'))));

// 4. 原来的两个例子照旧
const e = run('edge.txt');
const eSteps = e.out?.[0]?.views?.[0]?.steps || [];
expect('edge.txt：写错的老师行照常往下演', eSteps[0]?.errors?.some((x) => /第 9 格/.test(x.error)));
expect('edge.txt：抢跑的那一段只演一次', eSteps.filter((x) => x.step.kind === 'teacher').every((x) => x.played > 0));
expect('edge.txt：最后叫了老师，正常结束', e.code === 0 && /做到了挑战/.test(eSteps.at(-1)?.called?.why || ''));

// 5. 键盘写一格（open … input=keypad）走通用手势：一下写成，不是拨数器一格一格拨
const kw = stepOf(m, 'write K.1,2 -3/2');
expect('键盘写一格：照真页面交「学生 write K.1,2 -3/2」，不是拨了好几下', !errs(kw) && /学生 write K\.1,2 -3\/2/.test(said(kw)) && !/拨了 K/.test(said(kw)));

// 6. 平衡二叉树：学生自己插、自己转（手势表的 toAct 那条路）
const a = run('avl.txt');
expect('avl.txt：退出码 0', a.code === 0);
const a99 = stepOf(a, 'insert t 99');
expect('托盘里没有 99：记成没演上，不交给课堂循环', /托盘里没有 99/.test(errs(a99)) && !/99/.test(said(a99)));
expect('insert t 45 照手势翻成 insert t 45，演上了', /insert t 45/.test(stepOf(a, 'insert t 45')?.did || '') && /45/.test(stepOf(a, 'insert t 45')?.state || ''));
expect('插入的那一下没写 undo=on：撤不了', /这一下不能撤/.test(errs(stepOf(a, 'undo', 0))));
const a50 = stepOf(a, 'rotate t.50 left');
expect('在 50 左旋：攒着里有「从下往上读」', /从下往上读/.test(said(a50)));
expect('wrong=block：学生错的那一下没演上（弹回去了，树没变）', !!a50?.blocked && a50.state === before(a, a50)?.state && /没让做/.test(said(a50)));
expect('在 50 左旋照手势是把 60 拖到 50 上', /t\.60.*t\.50.*rotate t#1 left/.test(a50?.did || ''));
const a20 = stepOf(a, 'rotate t.20 right');
expect('20 没有左孩子：翻不成手势，记成没演上', /20 没有左孩子/.test(errs(a20)) && !/t#4 right/.test(said(a20)));
const r30 = stepOf(a, 'rotate t.30 left', 0);
const u2 = stepOf(a, 'undo', 1);
expect('学生: undo 以后那一下没了（树回到在 30 转之前）', /rotate t#2 left/.test(u2?.undone || '') && u2?.state === before(a, r30)?.state && /撤回了自己的上一下/.test(said(u2)));
const last = stepOf(a, 'rotate t.50 right');
expect('转平以后预写的 @t.done 演了、没叫老师', !last?.called && /页面已经演了你预写的 2 行/.test(said(last)) && /45 现在挂在谁下面/.test(last?.state || ''));

// 7. 消元：倍加、对调、倍乘照手势；做不到的照样交给课堂循环；拨数
const el = run('elim.txt');
expect('elim.txt：退出码 0', el.code === 0);
const z = stepOf(el, 'rowop A 0r2');
expect('一行乘 0 做不到：弹回去，照样交给课堂循环（不是工具自己拦下）', !!z?.blocked && !errs(z) && /做不到/.test(said(z)));
expect('对调照手势是把 r1 的把手拖到 r2 的行号上', /rowop A r1 <-> r2/.test(stepOf(el, 'rowop A r1 <-> r2')?.did || ''));
const w1 = stepOf(el, 'rowop A r3 - r1');
expect('倍数不对：wrong=mark 照做，攒着里写像哪种错', !w1?.blocked && /倍数不对/.test(said(w1)) && /淡淡圈/.test(said(w1)));
const eu = stepOf(el, 'undo');
expect('撤一步：r3 - r1 那一下没了', /r3 - r1/.test(eu?.undone || '') && shape(eu?.state) === shape(before(el, w1)?.state));
expect('一下做两步：翻不成手势，记成没演上', /一下只做一步/.test(errs(stepOf(el, 'rowop A r3 - 2r1, r3 - r2'))));
expect('消成阶梯形叫了老师', /做到了挑战/.test(stepOf(el, 'rowop A r3 - r2')?.called?.why || ''));
const k3 = stepOf(el, 'dial k 3');
expect('dial k 3 之后「[跟着变的]」里有 M 的那一格', /\[跟着变的\][\s\S]*M\.2,2/.test(said(k3)) && /k = 3/.test(k3?.state || ''));
expect('拨到 9 越出 range：拨不到', /拨不到/.test(errs(stepOf(el, 'dial k 9'))));
expect('拨到 4 秩掉下来：做到 g2，叫了老师', /做到了挑战/.test(stepOf(el, 'dial k 4')?.called?.why || ''));

// 8. 句子：拉括号、点成分、折起来
const pa = run('parse.txt');
expect('parse.txt：退出码 0', pa.code === 0);
const half = stepOf(pa, 'mark s.2-2 V');
// 成分那一排交的是中文：写 V 照 roleName 点「谓语」，交出去的是 mark s.2 谓语
expect('学生: mark s.2-2 V：点的是「谓语」，有「只圈了一半」', /只圈了一半/.test(said(half)) && /点「谓语」 → mark s\.2 谓语/.test(half?.did || ''));
const pu = stepOf(pa, 'undo');
expect('撤一步：那道括号没了', /mark s\.2 谓语/.test(pu?.undone || '') && pu?.state === before(pa, half)?.state);
expect('学生点的成分画中文：舞台现在里那道括号写两种名字', /s\.2-4 谓语（V）/.test(stepOf(pa, 'mark s.2-4 V')?.state || ''));
expect('成分那一排没有「宾补」：点不了，记成没演上', /宾补/.test(errs(stepOf(pa, 'mark s.5-10 宾补'))));
expect('拉完了：做完了，叫了老师', /做完|答了|做到/.test(stepOf(pa, 'mark s.5-10 宾语')?.called?.why || '') && /做完了/.test(stepOf(pa, 'mark s.5-10 宾语')?.called?.msg || ''));
expect('收起 mark 以后再拉：老师没有 open 这个动作', /老师没有 open 这个动作/.test(errs(stepOf(pa, 'mark s.1 S', 1))));
expect('没有括号的一段折不起来：记成没演上', /没有括号/.test(errs(stepOf(pa, 'fold s.1-3'))));
const fo = stepOf(pa, 'fold s.7-10');
expect('点从句的括号折起来', !errs(fo) && /fold s\.7-10/.test(fo?.did || '') && /学生 fold s\.7-10/.test(said(fo)));

// 话里光秃秃的名字：同一轮后面造的不报；拼错的一轮演完才报（照演了，kept），不算没演上
const lo = run('loose.txt');
const loT = lo.out?.[0]?.views?.[0]?.steps?.[0];
expect('loose.txt：退出码 0', lo.code === 0);
expect('同一轮后面才造的 {Xi} 不报；拼错的 {kk} 一轮演完报，那一行照演了', (loT?.errors || []).length === 1 && loT.errors[0].kept === true && /「\{kk\}」不是拨数/.test(loT.errors[0].error) && loT.played === 4);

// 9. 第二轮的学生写法：真的触摸（点、滑、按住 0.4 秒再拖、点 ✕、一格一格填），每种一条（hands.txt）
const h = run('hands.txt');
// 没跑完时写出为什么（工具的报错、停下来的那一句），不然下面一串 ✗ 看不出原因
const why = (r) => [r.err, ...(r.out?.[0]?.views || []).map((v) => v.stopped)].filter(Boolean).join('；').slice(0, 600);
expect(`hands.txt：退出码 0${h.code ? `（${why(h)}）` : ''}`, h.code === 0);
expect('hands.txt：竖屏、横屏每一步都演上了（没有没演上的行、没有页面报错）', (h.out?.[0]?.views || []).length === 2 && h.out[0].views.every((v) => !v.stopped && v.steps.every((s) => !s.errors?.length)));
const did = (s) => s?.did || '';
// 一样东西在舞台现在里的那一块（「树 t…」「矩阵 AB…」那一行和下面缩进的几行）
const blockOf = (st, head) => (String(st || '').split('\n').reduce((acc, l) => {
  if (acc.on && !/^ {2}\S/.test(l)) acc.on = false;
  if (l.startsWith(head)) acc.on = true;
  if (acc.on) acc.out.push(l);
  return acc;
}, { on: false, out: [] }).out.join('\n'));
const mv = stepOf(h, 'move s.1-6 after s.11');
expect('同一句上开着 mark、fold、move：那一步之前三种都开着', /s 开着：mark（滑）、fold（点）、move（按住再拖）/.test(before(h, mv)?.state || ''));
expect('学生: move s.1-6 after s.11：按住括号 0.4 秒再拖，只交了一行 move、演上了', !errs(mv) && /^按住 s\.1-6 的括号 0\.4 秒，拖到 s\.11（doctor,?）后面 → move s\.1-6 after s\.11$/.test(did(mv)) && /句子 s[^\n]*：is a famous heart doctor, The man who lives next door and/.test(mv?.state || ''));
const um = stepOf(h, 'unmark s.21');
expect('学生: unmark s.21 点 ✕：攒着里有「收掉了自己拉的」', !errs(um) && /点 s\.21 那道括号上的 ✕ → unmark s\.21/.test(did(um)) && /收掉了自己拉的 s\.21/.test(said(um)));
const rf = stepOf(h, 'refer s.13 -> s.2');
expect('学生: refer s.13 -> s.2 从钩上滑出一条线：照 links= 判对', /从 s\.13（his）的钩拉线，松在s\.2（man）上 → refer s\.13 -> s\.2/.test(did(rf)) && /links= 的每一条都连对了/.test(said(rf)));
expect('学生: unrefer s.13 点线上的 ✕：攒着里有「收掉了自己连的」', /→ unrefer s\.13/.test(did(stepOf(h, 'unrefer s.13'))) && /收掉了自己连的 s\.13/.test(said(stepOf(h, 'unrefer s.13'))));
expect('学生: unfold s.5 点小方块：展开那一段', /所在的小方块 → unfold s\.3/.test(did(stepOf(h, 'unfold s.5'))));
const ins = stepOf(h, 'insert t 47'), del = stepOf(h, 'delete t.7'), bk = stepOf(h, 'back t "插入后"');
expect('学生: delete t.7 点叶子摘掉（open t pluck）', !errs(del) && /^点 t\.7（7） → delete t#\d+$/.test(did(del)) && !/ 7 /.test(blockOf(del?.state, '树 t').split('\n')[0] + ' '));
expect('学生: back t "插入后" 点按钮：现状和存的时候一样', /点「回到插入后」 → back t "插入后"/.test(did(bk)) && !!blockOf(bk?.state, '树 t') && blockOf(bk?.state, '树 t') === blockOf(ins?.state, '树 t') && blockOf(del?.state, '树 t') !== blockOf(ins?.state, '树 t'));
const pk = stepOf(h, 'pick t.45 t.50');
expect('学生: pick t.45 t.50：攒着里有「学生点了 2 个」', !errs(pk) && /点 t\.45、t\.50，再点「点好了」/.test(did(pk)) && /学生点了 2 个：t\.45、t\.50/.test(said(pk)));
const cp = stepOf(h, 'compare AB BA');
expect('学生: compare AB BA 按住括号拖过去：攒着里有「格里」「不一样」', !errs(cp) && /格里/.test(said(cp)) && /不一样/.test(said(cp)));
expect('compare 以后 AB、BA 没变', ['矩阵 AB', '矩阵 BA'].every((m) => !!blockOf(cp?.state, m) && blockOf(cp?.state, m) === blockOf(before(h, cp)?.state, m)));
expect('学生: put AB Sum 放进合计', /学生把 AB 放进了 Sum/.test(said(stepOf(h, 'put AB Sum'))));
expect('学生: merge X Y 并同类项', /并成了 −3A/.test(said(stepOf(h, 'merge X Y'))));
const gv = stepOf(h, 'value 1 n n(n-1)/2 / 0 1 n / 0 0 1');
expect('学生: value 1 n n(n-1)/2 / 0 1 n / 0 0 1 一格一格填：判成对', /^一格一格写 /.test(did(gv)) && /填对了/.test(said(gv)));
// 回归（第二轮重放旧课找到的）：式子框底下也能说一句；预写出的 ask next 要学生按；第 8 下做到挑战、键盘写满一张都不是「试了好多下」
const sy = stepOf(h, 'say 写在哪？');
expect('写式子的那一问底下也能说一句：交上去是「学生说」', !errs(sy) && /学生说：「写在哪？」/.test(sy?.called?.msg || ''));
const ga = stepOf(h, 'swap a.1 a.2');
expect('做到挑战、预写出了 ask next：不叫老师，按钮留着，写明「看到了」还没按', !ga?.called && /做到了挑战 g1/.test(said(ga)) && /你预写的「看到了」还没按，没叫你/.test(said(ga)) && /在等学生：点按钮/.test(ga?.state || ''));
expect('学生按了「看到了」才叫老师', /学生点了「看到了」/.test(stepsOf(h, 'next').at(-1)?.called?.msg || ''));
const k8 = stepOf(h, 'swap q.1 q.4');
expect('第 8 下做到 k1（k2 还没做到）：攒着，不说「试了 8 下还没做到」', !k8?.called && /做到了挑战 k1/.test(said(k8)) && !/试了 8 下/.test(said(k8)));
const m8 = stepOf(h, 'write M.3,2 8'), m9 = stepOf(h, 'write M.3,3 9');
expect('键盘一格一格写到第 8 格：不叫老师', !m8?.called && !/试了/.test(said(m8)));
expect('写满第 9 格做到 h1：叫老师，不说「试了好多下」', /做到了挑战/.test(m9?.called?.why || '') && !/试了 8 下/.test(m9?.called?.msg || ''));

console.log(bad.length ? `\n${bad.length} 项没过` : '\n都过了');
process.exit(bad.length ? 1 : 0);

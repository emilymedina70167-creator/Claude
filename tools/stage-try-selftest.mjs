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

console.log(bad.length ? `\n${bad.length} 项没过` : '\n都过了');
process.exit(bad.length ? 1 : 0);

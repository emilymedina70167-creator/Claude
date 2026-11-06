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
const stepOf = (r, cmdArgs) => r?.out?.[0]?.views?.[0]?.steps?.find((s) => s.step.kind === 'student' && `${s.step.cmd} ${s.step.args}` === cmdArgs);
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

console.log(bad.length ? `\n${bad.length} 项没过` : '\n都过了');
process.exit(bad.length ? 1 : 0);

# 视觉交互第 1 批：坐标图 graph 做成一元微积分和一维概率的底座 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `graph` 把设计第三节里它该盖住的 24 行（高数 16、概率 8）全部做到 A：画对、页面自己算、学生能动手、当场判、几行写完。

**Architecture:** 表达式层加「特殊形式」（求和、定积分、求根）和概率的特殊函数；`graph` 的解析拆成纯函数的 `graphspec.js`（函数定义、撇号求导、新命令），曲线的采样和断开在纯函数的 `fx/curve.js`，`graph.js` 只管画和交互；学生的 `goal`、`pick` 照 `scene` 的关卡和作答记录接进 `blocks/figures.js`。

**Tech Stack:** 原生 ES 模块、SVG、`node --test`、esbuild（`npm run build`）、Playwright（`tools/check-lesson.mjs`）。不加依赖。

**Spec:** `docs/superpowers/specs/2026-11-20-visual-design.md`（第一节的五条标准、第三节的表、第四节第 1 批、第五节的线）

## Global Constraints

- 注释、界面文字、提交说明用中文；注释写「为什么」。
- 纯函数放在不碰 DOM 的模块里，`node --test` 测；DOM 行为在 iPad 竖屏 820×1180、横屏 1180×820，紫藤白天 `theme: ink`、晚上 `theme: inknight` 看截图。
- 颜色只写变量（`var(--yellow)`、`rgb(var(--chalk-rgb) / .4)`），不写死 rgba（`tests/theme.test.js`）。触控目标至少 44px，输入框 16px。不用 `window.confirm / alert / prompt`。
- `graph` 里的表达式一律弧度（`tests/expr-rad.test.js` 的 `RAD`）；新加调用 `compile` / `evaluate` 的文件要在那张表里归类。
- 现有课件的写法全部照旧能用：`plot` `shade` `bars` `vline` `hline` `point` `segment` `text` `let … drag` `slider` `show`，`figure set / play / highlight`、`board mark` 的行为不变；`kit/examples/figures.html`、`answer-demo.html` 里的 graph 画出来和以前一样（除了修掉的毛病）。
- 判错要比判对更有把握：`pick` 和 `goal` 只在页面算得出目标时判；算不出（函数没定义、求根失败）在页面上报写法错误，不判学生错。
- 手册（`CLAUDE-PROJECT.md` 第三节）只写能做什么、写法、页面会怎么做；不出现「你应该」「必须先」「最重要」「推荐」「照做」（`tests/manual-words.test.js`）。手册里的例子照抄就能画。
- 改了 `kit/src/` 或 `CLAUDE-PROJECT.md` 都要 `npm run build` 并提交 `kit/dist/`。
- 一次调用 Claude 都不加：这一批全是页面上的计算。

## Review Focus

1. **函数在窗口里有没定义的一段**（`ln(x)` 在 x ≤ 0、`sqrt(1-x^2)` 在 |x| > 1）：曲线只画有定义的那几段，不连过去、不报错；`pick`、`tangent` 落在没定义的点上时不画切线、不判。（Task 4、6）
2. **学生的 `pick` 点得不准、点多了、点少了**：按容差配对，一个目标只配一个点；多点的、漏的分别说，不把「多点了一个」说成「全错」。（Task 7）
3. **主讲用 `figure set` 把可拖的点摆到 `goal` 上**：不算学生做到（和 `scene` 一样，学生挪开再放回才算）。（Task 7）
4. **滑块把 `n` 拖到很大**（`sum(k, 1, n, …)` 的 n = 2000、`riemann` 的 n = 500）：画一帧不超过 16 ms 量级，求和上限超过 20000 时报写法错误而不是卡住页面。（Task 2、6）
5. **分位点的边界**（`chi2inv(0, n)`、`tinv(1, n)`、`norminv(0.5)`、自由度不是正数）：回 0 / ∞ / 精确的 0 或报「自由度要是正数」，不回 NaN 画出一条莫名其妙的线。（Task 1）

---

### Task 1: 概率的特殊函数

**Files:**
- Create: `kit/src/fx/special.js`
- Modify: `kit/src/expr.js`（`FUNCS` 里接上）、`kit/src/exact.js:484`（`FLOAT_ONLY` 加上新名字）
- Test: `tests/fx-special.test.js`

**Interfaces:**
- Produces（`special.js` 导出，全是数 → 数）：`lgamma(x)`、`gamma(x)`、`beta(a, b)`、`gammaP(a, x)`（正则化的下不完全 Γ）、`betaI(x, a, b)`（正则化的不完全 B）、`DIST`（一个对象，键就是表达式里的函数名）：`gamma` `beta` `chi2pdf(x, n)` `chi2cdf(x, n)` `chi2inv(p, n)` `tpdf(x, n)` `tcdf(x, n)` `tinv(p, n)` `fpdf(x, m, n)` `fcdf(x, m, n)` `finv(p, m, n)` `norminv(p, mu = 0, s = 1)` `binomcdf(k, n, p)` `poissoncdf(k, lam)` `geompmf(k, p)`（k = 1, 2, …）`hyperpmf(k, N, M, n)` `expcdf(x, lam = 1)` `unifcdf(x, a = 0, b = 1)`。
- `expr.js`：`FUNCS` 展开 `DIST`；`exact.js` 的 `FLOAT_ONLY` 加同一批名字（`\calc{chi2inv(0.95, 10)}` 写出小数）。

- [ ] **Step 1: 写失败的测试** `tests/fx-special.test.js`，断言（容差 5e-4，除非另写）：
  - `gamma(5) = 24`、`gamma(0.5) = √π`（1e-10）、`beta(2, 3) = 1/12`。
  - 教材附表的值：`chi2inv(0.95, 10) = 18.307`、`chi2inv(0.05, 10) = 3.940`、`tinv(0.975, 10) = 2.2281`、`finv(0.95, 3, 10) = 3.708`、`norminv(0.975) = 1.95996`、`norminv(0.95) = 1.64485`。
  - 互逆：n ∈ {1, 2, 3, 7, 30}、p ∈ {0.01, 0.5, 0.99}，`chi2cdf(chi2inv(p, n), n) = p`（1e-8）；`tcdf(tinv(p, n), n) = p`；`fcdf(finv(p, 3, n), 3, n) = p`。
  - 密度积分为 1：`numIntegral(chi2pdf(·, 3), 0, 60)`、`tpdf(·, 2)` 在 ±200、`fpdf(·, 4, 6)` 在 0～400，各 ≥ 0.995。
  - `tcdf(0, n) = 0.5`（精确）、`tpdf(x, 1) = 1/(π(1+x²))`。
  - `binomcdf(3, 10, 0.3) = Σ binompmf`、`poissoncdf(2, 2) = 5e⁻²`、`geompmf(3, 0.5) = 0.125`、`geompmf(0, 0.5) = 0`、`hyperpmf(1, 10, 3, 4) = C(3,1)C(7,3)/C(10,4)`。
  - 边界（Review Focus 5）：`chi2inv(0, 5) = 0`、`chi2inv(1, 5) = Infinity`、`tinv(0.5, 7) = 0`、`norminv(0) = -Infinity`、`chi2pdf(-1, 3) = 0`、`chi2pdf(1, 0)` 抛「自由度要是正数」、`norminv(1.2)` 抛「概率要在 0 和 1 之间」。
  - 表达式里能用：`evaluate('chi2inv(0.95, 10)')`、`calcValue('tinv(0.975, 10)').float`。
- [ ] **Step 2:** `node --test tests/fx-special.test.js`，看到失败（模块不存在）。
- [ ] **Step 3: 实现 `special.js`。** `lgamma` 用 Lanczos（g = 7，9 项）；`gammaP`：x < a + 1 用级数，否则用连分式（Lentz）；`betaI`：连分式（Lentz），x > (a+1)/(a+b+2) 时用对称式；分位点用二分 + 牛顿修正到 1e-12（上界先倍增找到）；`norminv` 用 Acklam 的有理逼近再牛顿一步。`chi2cdf = gammaP(n/2, x/2)`，`tcdf` 用 `betaI(n/(n+x²), n/2, 1/2)`，`fcdf = betaI(mx/(mx+n), m/2, n/2)`。
- [ ] **Step 4:** 在 `expr.js` 的 `FUNCS` 里 `...DIST`（`import { DIST } from './fx/special.js'`；`special.js` 不 import `expr.js`），`exact.js` 的 `FLOAT_ONLY` 加名字。
- [ ] **Step 5:** `node --test tests/fx-special.test.js tests/expr-rad.test.js tests/cs-expr.test.js` 全过。
- [ ] **Step 6: 提交** `git commit -m "表达式：Γ、B 函数，χ² / t / F 的密度、分布函数、分位点，几何、超几何（视觉第 1 批）"`

### Task 2: 表达式的特殊形式（求和、最值、定积分、求根）

**Files:**
- Modify: `kit/src/expr.js`（`run` 的 `call` 分支前查特殊形式）
- Test: `tests/expr-forms.test.js`

**Interfaces:**
- Produces（表达式里的新写法，只在浮点求值 `expr.js` 里有；`exact.js` 的 `\calc` 不认，照旧报「没有函数」）：
  - `sum(k, a, b, 式子)`、`prod(k, a, b, 式子)`：k 取 a 到 b 的整数（a、b 先算、四舍五入到整数前要和整数差不到 1e-9，否则抛「求和的上下限要是整数」；b < a 时和是 0、积是 1）。项数超过 `FORM_MAX_TERMS = 20000` 抛「求和的项太多（N 项），最多 20000」。
  - `maxof(k, a, b, 式子)`、`minof(k, a, b, 式子)`：整数 k 上的最大、最小。
  - `int(式子, t, a, b)`：数值定积分（`fx/integral.js` 的 `numIntegral`，上下限能写 `inf` / `-inf`）；不收敛、算不出抛「这个积分页面算不出来」。
  - `maxon(式子, x, a, b)`、`minon(式子, x, a, b)`：区间上取 400 个点再对最好的那一段做黄金分割，没定义的点跳过。
  - `roots(式子, x, a, b)`：区间上的全部实根（800 个点找变号再二分到 1e-10；两边都很大、变号是因为极点的不算：|f| 在根的近旁要小于 1e-6·max(1, 区间上 |f| 的中位数)），从小到大排成向量；一个都没有是空的 `[]`。
  - 第一个（`int`、`maxon`、`roots` 是第二个）参数必须是一个变量名，否则抛「sum 的第一个参数是求和用的字母，如 sum(k, 1, n, 1/k^2)」。
  - 只有参数个数是 4 而且那个位置是变量名时才当特殊形式：`max(a, b)`、`min(…)`、已有的 1 个参数的 `sum(v)`（如果以后有）不受影响。
- 导出常量 `FORM_MAX_TERMS`。

- [ ] **Step 1: 写失败的测试**：`evaluate('sum(k, 1, 100, k)') = 5050`；`sum(k, 1, n, 1/k^2)` 在 `{n: 2000}` 和 π²/6 差 < 1e-3；`prod(k, 1, 5, k) = 120`；`sum(k, 3, 2, k) = 0`；`sum(k, 1, 2.5, k)` 抛；`sum(k, 1, 30000, k)` 抛「最多 20000」；外面的 k 不被改：`evaluate('k + sum(k, 1, 3, k)', {k: 10}) = 16`；套着用 `sum(i, 1, 3, sum(j, 1, i, 1)) = 6`；`maxof(k, 1, 5, (k-3)^2) = 4`；`int(cos(t), t, 0, pi/2) = 1`（1e-9）；`int(exp(-t), t, 0, inf) = 1`（1e-6）；`int(1/t, t, 0, 1)` 抛；`maxon(x - x^2, x, 0, 1) = 0.25`（1e-8）；`roots(x^3 - 3x, x, -3, 3)` 是 `[-√3, 0, √3]`（1e-8）；`roots(1/x, x, -1, 1)` 是 `[]`；`roots(x^2 + 1, x, -2, 2)` 是 `[]`；`max(1, 5) = 5` 照旧；`compile('sum(k, 1, n, x^k)')({n: 3, x: 2}) = 14`。计时：`sum(k, 1, 2000, sin(k*x)/k)` 求值 200 次 < 200 ms。
- [ ] **Step 2:** 运行，失败。
- [ ] **Step 3: 实现**：`run` 的 `case 'call'` 开头 `const sp = SPECIAL[n.name]; if (sp && sp.match(n)) return sp.run(n, vars, fns);`，绑定变量用 `Object.create(vars)` 派生一层再写 k（不拷贝整个对象：求和的内圈要快）。
- [ ] **Step 4:** `node --test tests/expr-forms.test.js tests/expr-rad.test.js` 过；`npm test` 里和表达式有关的（`tests/cs-expr.test.js`、`tests/fx-*.test.js`、`tests/exact*.test.js`）照旧过。
- [ ] **Step 5: 提交** `git commit -m "表达式：sum / prod / maxof / minof / int / maxon / minon / roots（视觉第 1 批）"`

### Task 3: 图里的函数定义和撇号求导

**Files:**
- Create: `kit/src/fx/defs.js`
- Test: `tests/fx-defs.test.js`

**Interfaces:**
- Consumes: `parse`（`expr.js`）、`diffAst`、`substitute`（`fx/diff.js`）。
- Produces:
  - `parseDef(line) → { name, params: string[], src } | null`：认 `f(x) = x^3 - 3x`、`g(x, y) = x^2 + y^2`、`F(t) = int(cos(s), s, 0, t)`；名字 1～8 个字母数字、字母开头，不能是保留的函数名（`expr.js` 的函数、`sum` 这些特殊形式、`x`）；左边不是「名字(字母, …)」的回 `null`（那是别的行）。参数重名抛。
  - `makeDefs() → defs`，`addDef(defs, def)`：把 `def.src` 里用到的前面定义的函数先展开再存（所以后面的定义能用前面的，自己不能用自己：抛「f 的定义里用到了它自己」）。
  - `expandSrc(src, defs) → ast`：先把原文里的 `名字'(`、`名字''(`、`名字'''(` 读成对第一个参数的 1、2、3 阶导，再把对定义过的函数的调用换成它的式子（参数代进去）；参数个数不对抛「f 要 1 个参数」。没有定义、没有撇号时就是 `parse(src)`。
  - `compileWith(src, defs, opts) → (vars) => 值`：`expandSrc` 以后求值（`evaluate(ast, vars, opts)`）。
  - 求不了导的（定义里有 `abs` 以外页面不会导的函数、`sum`）抛「f′ 页面求不了导：…」，带上 `diffAst` 的原因。

- [ ] **Step 1: 写失败的测试**：`parseDef('f(x) = x^2')` 的三个字段；`parseDef('plot x^2')`、`parseDef('let a = 1')`、`parseDef('x: -3 3')` 是 `null`；`parseDef('sin(x) = 1')` 抛「sin 是页面自带的函数」。定义 `f(x) = x^3 - 3x`：`compileWith('f(2)', defs)({}) = 2`；`f'(2) = 9`；`f''(a)` 在 `{a: 1}` 是 6；`f'(x+1)` 在 `{x: 1}` 是 9（先求导再代 x+1）；`g(x) = f(x)^2` 后 `g'(1) = 2·f(1)·f'(1) = 0`；二元 `h(x, y) = x^2*y`：`h(2, 3) = 12`，`h'(2, 3)`（对第一个参数）= 12；`f(1, 2)` 抛「f 要 1 个参数」；`f(x) = f(x) + 1` 抛；定义里用外面的量 `p(x) = a*x`，`compileWith('p(3)', defs)({a: 2}) = 6`；`F(t) = int(cos(s), s, 0, t)`，`F(pi/2) = 1`、`F'(0) = 1`（莱布尼茨）；`q(x) = sum(k, 1, 3, x^k)`，`q(2) = 14`，`q'(2)` 抛「求不了导」。
- [ ] **Step 2:** 运行，失败。
- [ ] **Step 3: 实现。** 撇号在分词之前用正则换成内部名字（`f''(` → `__d2_f(`），展开调用时认 `__dN_名字`。
- [ ] **Step 4:** `node --test tests/fx-defs.test.js` 过。在 `tests/expr-rad.test.js` 的 `RAD` 里加 `fx/defs.js`（如果那张表按文件扫到了它）。
- [ ] **Step 5: 提交** `git commit -m "函数图：f(x) = … 定义函数，f′、f″ 符号求导（视觉第 1 批）"`

### Task 4: 曲线的采样、断开、跳跃点

**Files:**
- Create: `kit/src/fx/curve.js`
- Test: `tests/fx-curve.test.js`

**Interfaces:**
- Produces:
  - `sampleCurve(f, a, b, { ySpan, n = 240 }) → { segs, jumps, holes }`：`f` 是 `(x) => 数`（抛错、NaN、±∞ 都当没定义）；`ySpan` 是窗口的高（判「跳得大不大」用，默认按取到的值的范围）。
    - `segs: Array<Array<[x, y]>>`：每一段是连续的一条折线；没定义的一段、跳跃、极点都把曲线断开。
    - `jumps: Array<{ x, left, right, solid: 'left' | 'right' | 'none' }>`：有限的跳跃（左右极限都有限、差超过 `ySpan` 的 2%）；`solid` 是函数在那一点的值等于哪一边（都不等、没定义是 `none`）。
    - `holes: Array<{ x, y }>`：可去间断点（那一点没定义、左右极限相等）。只查采到的点和窗口里的「整点」：步长 1、1/2 的点，以及 π/2 的整数倍，最多 400 个。
    - 极点（一边或两边趋于无穷）只断开，不记进 `jumps`。
  - 做法定死的三条：① 先均匀取 n + 1 个点；② 相邻两点的差超过 `ySpan` 的 8%、或者一边没定义时，在这两点之间二分 40 次找断点，看两边的值是越来越近（陡但连续：把二分时算过的点加进折线）还是差不缩小（跳跃）还是越来越大（极点）；③ 中点偏离两端连线超过 `ySpan` 的 0.4% 时再插点，最多 6 层，总点数不超过 `CURVE_MAX_POINTS = 6000`。
  - `labelSpot(segs, frac, box) → [x, y] | null`：曲线在横向 `frac` 处的点；那里没定义就往两边找最近的有定义的点。

- [ ] **Step 1: 写失败的测试**：
  - `x^2`（−2, 2）：一段、没有跳跃。
  - `(x<0)*(x+1) + (x>=0)*(x^2-1)`（−3, 3）：两段，`jumps` 一个：`x ≈ 0`（1e-6）、`left ≈ 1`、`right ≈ −1`、`solid: 'right'`。
  - `1/(x-1)`（−3, 4）：两段，`jumps` 空（极点），每段里 |y| 的最大值大于 20 而且两段不相连（第一段最后一点 x < 1 < 第二段第一点 x）。
  - `sin(x)/x`（−8, 8）：`holes` 一个 `{x: 0, y ≈ 1}`；`segs` 两段。
  - `ln(x)`（−2, 3）：一段，第一点 x > 0。
  - `sqrt(1 - x^2)`（−2, 2）：一段，x 都在 [−1, 1]。
  - `tan(x)`（−5, 5）：四段（极点在 ±π/2、±3π/2），`jumps` 空。
  - `floor(x)`（0, 4）：`jumps` 三个，都是 `solid: 'right'`。
  - 右连续的分布函数 `0.2*(x>=0) + 0.5*(x>=1) + 0.3*(x>=2)`：三个跳，`solid: 'right'`。
  - 很陡但连续：`arctan(50x)`（−1, 1）一段、没有跳跃。
  - `sin(1/x)`（−0.5, 0.5）：点数 > 1500、≤ 6000；`holes` 里没有 0（左右极限不存在）。
  - 抛错的函数（`() => { throw … }`）：`segs` 空，不抛。
- [ ] **Step 2:** 运行，失败。
- [ ] **Step 3: 实现。**
- [ ] **Step 4:** `node --test tests/fx-curve.test.js` 过；`sampleCurve` 对 `x^3 - 3x` 跑 1000 次 < 400 ms。
- [ ] **Step 5: 提交** `git commit -m "函数图：曲线的采样——间断点断开、跳跃点、可去间断点（视觉第 1 批）"`

### Task 5: graph 的解析拆出来，认新命令

**Files:**
- Create: `kit/src/graphspec.js`（纯函数：从 `graph.js` 搬出 `parseGraph`、`parseCmd`，加新命令）
- Modify: `kit/src/graph.js`（改成 `import { parseGraph } from './graphspec.js'` 并原样再导出）、`kit/src/scene.js`（`fillValues(text, v, errors, compileFn)` 多一个可选的编译函数，不传照旧）
- Test: `tests/graphspec.test.js`

**Interfaces:**
- Consumes: `parseDef` `makeDefs` `addDef` `compileWith`（Task 3）、`splitMods`（`mods.js`）。
- Produces: `parseGraph(src) → { fields, cmds, defs, xr, yr }`。所有表达式用 `compileWith(src, defs)`（弧度），定义行写在前面的后面的命令才认。每条命令 `{ kind, mods, srcLine, … }`：

| 写法 | kind 和字段 |
|---|---|
| `f(x) = 式子` | 不进 `cmds`，进 `defs` |
| `plot 式子 [for x a b]` | `plot`：`f`（`(vars) => 数`，自变量在 `vars.x`）、`lo` `hi`（可选，`(vars) => 数`） |
| `shade 式子 a b`（已有） | 不变 |
| `area 式子1, 式子2 from a to b` | `area`：`f` `g` `a` `b`；可在前面起名 `area S = …`，`name` |
| `riemann 式子 from a to b n=表达式 [left｜right｜mid]` | `riemann`：`f` `a` `b` `n`（`mods.n` 编译）、`rule`（默认 `left`）、`name`（`riemann S = …`） |
| `tangent 式子 at a` | `tangent`：`f`、`df`（对 x 的导数，`diffAst` 得到；求不了导时解析就抛）、`at` |
| `secant 式子 at a, b` | `secant`：`f` `a` `b` |
| `dots 式子 for n a b` | `dots`：`f` `param` `from` `to`；`mods.join` 连成折线；`mods.highlight` 条件 |
| `bars …`（已有） | 不变 |
| `point [x, y] [hollow]` | `point`：`mods.hollow` |
| `let a = 1 drag [on=式子]` | `let`：`mods.on` 编译成 `onF`（把手骑在这条曲线上） |
| `goal 左 = 右 [tol=] [msg=]`、`goal 条件 [msg=]` | `goal`：有单独的 `=`（不是 `<=` `>=` `==` `!=`）时 `lhs` `rhs`；否则 `cond` |
| `pick "题目" [on 式子｜on x] at 表达式, … [tol=] [msg=]` | `pick`：`q`、`on`（`curve` / `axis` / `free`）、`onF`、`targets`（每个 `(vars) => 数 或 向量`：`on` 是 `curve`、`axis` 时目标是 x 的值，一个表达式回向量就摊开，如 `roots(f'(x), x, -3, 3)`；`free` 时是 `[x, y]`）、`tol` |
| 修饰 `after` / `before` | 留在 `mods`（Task 7 用） |

- `area`、`riemann` 起了名字的，名字在后面的 `show`、`goal` 里是一个数（面积 ∫|f − g|、黎曼和）；`graph.js` 的 `env()` 负责算（Task 6）。
- 写错的报法（都抛中文的 `Error`，带例子）：`riemann 的写法：riemann x^2 from 0 to 1 n=8`、`tangent 的写法：tangent f(x) at a`、`pick 的写法：pick "点出极值点" on f(x) at -1, 1`、`goal 的写法：goal 表达式 = 目标，或者 goal 条件`。
- `CMDS`（导出）：全部命令名。

- [ ] **Step 1: 写失败的测试**（Node 里没有 DOM：`graphspec.js` 不能 import `render.js`）：
  - 老写法逐条：`parseGraph` 读 `kit/examples/figures.html` 里两个 graph 块，`cmds` 的 `kind` 序列和以前一样（`slider slider let shade plot plot show`、`slider bars vline show`）。
  - `f(x) = x^2/2` 加 `plot f(x)`：`cmds[0].f({x: 2}) = 2`；`plot f'(x)`：`f({x: 3}) = 3`。
  - `plot sqrt(x) for x 0 4`：`lo({}) = 0`、`hi({}) = 4`。
  - `tangent f(x) at a`：`at({a: 1}) = 1`、`df({x: 1}) = 1`；`tangent sum(k,1,3,x^k) at 1` 抛（求不了导）。
  - `riemann S = x^2 from 0 to 1 n=n mid`：`name: 'S'`、`rule: 'mid'`、`n({n: 8}) = 8`。
  - `area A = x, x^2 from 0 to 1`：`name: 'A'`，`f` `g` 各自求值。
  - `dots 1 + (-1)^n/n for n 1 30 join`：`param: 'n'`、`mods.join`。
  - `goal f'(a) = 0 tol=0.05 msg="到了"`：`lhs` `rhs`；`goal maxon(abs(x^2 - 4), x, 2 - d, 2 + d) < eps`：`cond`，在 `{d: 0.1, eps: 1}` 是 1、`{d: 1, eps: 1}` 是 0。
  - `pick "点出极值点" on f(x) at roots(f'(x), x, -3, 3) tol=0.2`（f = x³ − 3x）：`on: 'curve'`，`targets` 摊开算出来是 `[-1, 1]`。`pick "间断点" on x at 0, 1`：`on: 'axis'`。`pick "交点" at [1, 1], [0, 0]`：`on: 'free'`。
  - `let a = 1 drag on=f(x)`：`mods.drag`、`onF({x: 2}) = 2`。
  - `point [0, 1] hollow`：`mods.hollow`。
  - 看不懂的行照旧抛「看不懂这一行：…」。
  - `fillValues('{sin(pi/2)}', {}, [], (s) => compile(s))` 是 `$1$`；不传第四个参数时 `{sin(90)}` 是 `$1$`（scene 照旧角度）。
- [ ] **Step 2:** 运行，失败。
- [ ] **Step 3: 实现**；`graph.js` 先只改 import，行为不变。
- [ ] **Step 4:** `node --test tests/graphspec.test.js tests/expr-rad.test.js`（`RAD` 加 `graphspec.js`）过；`npm run build && node tools/check-lesson.mjs --quiet kit/examples/figures.html kit/examples/answer-demo.html` 没有新的错。
- [ ] **Step 5: 提交** `git commit -m "函数图：解析拆成 graphspec.js，认函数定义和 tangent / secant / riemann / area / dots / goal / pick（视觉第 1 批）"`

### Task 6: graph 画对、画新命令

**Files:**
- Modify: `kit/src/graph.js`、`kit/src/styles.css`（`.plane.graph` 那一段）、`kit/src/themes.css`（只在要新变量时）
- Create: `kit/src/fx/graphgeom.js`（纯函数：矩形、两线之间的多边形、标签让位）
- Test: `tests/fx-graphgeom.test.js`

**Interfaces:**
- Consumes: `sampleCurve` `labelSpot`（Task 4）、`parseGraph`（Task 5）。
- Produces（`graphgeom.js`）：
  - `riemannRects(f, a, b, n, rule) → { rects: Array<{ x0, x1, y }>, sum }`（n 取整、限制在 1～500；`rule` 是 `left` / `right` / `mid`；某个取样点没定义时那一块不画、`sum` 是 `NaN`）。
  - `betweenArea(f, g, a, b, n = 200) → { poly: Array<[x, y]>, area }`（`area` 是 ∫|f − g|，梯形法；`poly` 先沿 f 去、再沿 g 回）。
  - `placeLabels(items, box) → Array<[x, y]>`：`items: Array<{ x, y, w, h }>`（想放的位置和大小），重叠的按先后往上、往下挪到不压为止，不出 `box`。
- `graph.js` 的行为：
  - 画图区加 `clipPath`：曲线、涂色、矩形都裁在坐标框里，不再用 `clampY` 压平（参考线、把手照旧）。
  - `plot`、`shade`、`area` 用 `sampleCurve` 的 `segs` 一段一条 `polyline`；`jumps` 画点（`solid` 那边实心 `.g-dot`、另一边空心 `.g-dot.is-hollow`，`none` 时两边都空心）；`holes` 画空心点。`plot … dots=off` 不画这些点。
  - `tangent`：过 (a, f(a))、斜率 `df(a)` 的直线画满窗口、裁在框里，切点一个实心点；f 或 f′ 在 a 没定义时不画（不报错）。`secant`：过两点的直线，两点各一个点；a = b 时不画。
  - `riemann`：矩形 `.g-rect`（描边 + 淡填充；函数值是负的往下画），取样点上一个小点；`area`：两线之间涂色。
  - `dots`：一个个点（`highlight=` 条件成立的更亮），`join` 加细折线。
  - `bars`：同一张图里有两条以上 `bars` 时并排（每组的宽度平分），不再叠着。
  - 标签：全部 `plot` / `tangent` / `vline` / `hline` / `point` 的标签先算想放的位置，再用 `placeLabels` 让开。
  - `show` 用弧度（`fillValues` 传 `(s) => compileWith(s, defs)`）；`text` 的字用板书的颜色（`fill: var(--chalk)`，可 `color=`）。
  - `env()`：`area`、`riemann` 起了名字的，把值算进变量（按命令的先后；后面的命令、`show`、`goal` 用得到）。
  - y 的范围没写时：按 `segs` 里的值取第 2～98 百分位再留 15% 的边（极点不把窗口撑到几万）。
  - 求值预算：一帧里 `sampleCurve` 的总点数超过 30000 时，后面的曲线退回 n = 120、不加密（Review Focus 4）。

- [ ] **Step 1: 写失败的测试** `tests/fx-graphgeom.test.js`：`riemannRects(x => x*x, 0, 1, 4, 'left').sum = 0.21875`、`'right'` 是 0.46875、`'mid'` 是 0.328125，`rects.length = 4`；n = 0 当 1、n = 9999 当 500；`betweenArea(x => x, x => x*x, 0, 1).area ≈ 1/6`（1e-4），`poly` 的头尾 x 相同；交叉的两条 `betweenArea(sin, cos, 0, π).area ≈ 2√2`（1e-3）；`placeLabels` 给两个完全重叠的 → 两个不相交的框，都在 `box` 里。
- [ ] **Step 2:** 运行，失败；实现 `graphgeom.js`，过。
- [ ] **Step 3: 改 `graph.js`、`styles.css`。**
- [ ] **Step 4: 渲染核对。** 写 `.superpowers/audit-visual/hm/v1-draw.md`（探针 01～04 用新写法重写：跳跃、无穷、振荡、可去间断点、斜渐近线、割线到切线、|x| 的左右导数、f 和 f′、黎曼和三种、两线之间的面积、变限积分 `F(x) = int(cos(t), t, 0, x)`、泰勒 `sum`、傅里叶 `sum`、数列的 `dots`、分布函数的阶梯、χ² / t / F 的密度和 `chi2inv`），`npm run build && node tools/check-lesson.mjs --shots .superpowers/audit-visual/hm/v1 .superpowers/audit-visual/hm/v1-draw.md`，加 `theme: ink`、`theme: inknight` 各一遍。逐张看截图，对着设计第三节的「差在哪」一条条确认没了：竖线不连、不压平、空心实心点对、标签不叠、读数是弧度的。`kit/examples/figures.html` 的两张 graph 和以前一样。
- [ ] **Step 5:** `npm test` 全过。
- [ ] **Step 6: 提交** `git commit -m "函数图：间断点断开、裁在框里、空心实心点；切线、割线、黎曼和、两线之间的面积、点列；show 改弧度（视觉第 1 批）"`

### Task 7: 学生动手——骑在曲线上的点、goal、pick、after

**Files:**
- Create: `kit/src/graphpick.js`（纯函数）
- Modify: `kit/src/graph.js`、`kit/src/blocks/figures.js`、`kit/src/styles.css`
- Test: `tests/graphpick.test.js`

**Interfaces:**
- Produces（`graphpick.js`）：
  - `judgePicks(picked, targets, tol) → { ok, hits, extra, missed }`：`picked`、`targets` 是数的数组（`curve` / `axis`）或 `[x, y]` 的数组（`free`）；贪心按距离从近到远配对，一个目标只配一个点，距离 ≤ `tol` 才算；`hits` 是配上的 `picked` 下标，`extra` 是没配上的 `picked` 下标，`missed` 是没配上的 `targets` 的个数；`ok = extra 空 && missed 为 0`。
  - `pickFeedback(r) → string`：`全对`；`还差 2 个`；`有 1 个不在这里`；`有 1 个不在这里，还差 1 个`（不说漏的在哪）。
  - `snapPick(x, y, { on, f, xr }) → 数 | [x, y]`：`curve` 时回 x（点落在曲线上；那里没定义回 `null`）、`axis` 回 x、`free` 回 `[x, y]`。
- `graph.js`：
  - `let a = 1 drag on=f(x)`：把手画在 (a, f(a))（曲线上的一个圆点，44px 的触控区），底下的竖线换成一条到 x 轴的细虚线；f(a) 没定义时把手退回 x 轴。拖动只改 a。
  - `goal`：每次重画以后查（`figure set / play` 的 quiet 重画不算，学生挪开再回来才算——照 `scene.js` 的 `checkGoals`）；做到了在侧栏写 `msg`（默认「做到了！」）、发 `goal` 事件。`api.goals` 是 `goal` 的条数。
  - `pick`：图下面一条 `.g-pick`（题目、已点的几个小标签（点一下去掉）、「检查」按钮）。学生点图 → `snapPick` → 加一个紫色的点（`--lav`，「你的猜测」的颜色）；离已有的点很近（屏幕上 22px 内）的那一下是去掉它。「检查」→ `judgePicks`：配上的变绿、多的变红，写 `pickFeedback`；全对以后锁住，画出目标（实心黄点），发 `pick` 事件 `{ i, ok: true, tries, picked }`；没全对发 `{ i, ok: false, tries, picked, extra, missed }`。点了三次还不对出现「看答案」（发 `{ ok: false, giveup: true }`，画出目标、锁住）。目标算不出来（表达式抛错）在图下面报写法错误，「检查」不能点。`api.picks` 是 `pick` 的条数。
  - 修饰 `after`：有 `goal` 或 `pick` 时，全部做到（或看了答案）以后才显示；`before` 相反。图里既没有 `goal` 也没有 `pick` 时两个修饰都不管用（一直显示），自检报「after 要配 goal 或 pick」。
  - `api.snapshot()` 多带 `picks`（每条已经点了哪些、判了没有）和 `goals`（做到了几条）：课堂的黑板现状、板边助教读它。
- `blocks/figures.js`（只对 graph）：有 `goal` 或 `pick` 就是关卡（`session.gate`，全部做到才过；看答案也过）。作答记录：
  - `goal` 全做到：`session.record({ type: 'graph', title, ok: true, el })`。
  - 每次点「检查」：`session.record({ type: 'graph', title, q: 题目, ok, value: 点的值（两位小数，逗号隔开）, detail: 反馈那句, el })`；看答案 `ok: false, giveup: true`。
  - 把手拖完照旧记 `drag` 事件。
  - 有把手时侧栏写「拖动圆点可以移动它。」；有 `pick` 时写「在图上点出来；点错了再点一下去掉。」

- [ ] **Step 1: 写失败的测试** `tests/graphpick.test.js`：`judgePicks([-1.05, 0.96], [-1, 1], 0.2)` 全对；`[-1.05]` 对 `[-1, 1]` → `missed: 1`、`extra: []`、反馈「还差 1 个」；`[-1, 1, 2.5]` → `extra: [2]`、「有 1 个不在这里」；`[0.9, 1.1]` 对 `[1]` → 一个配上、`extra` 一个（Review Focus 2）；`[]` 对 `[]` → `ok: true`；`free`：`[[1.02, 0.98]]` 对 `[[1, 1]]` 在 0.1 内全对；`snapPick(2, 9, { on: 'curve', f: x => x*x }) = 2`；`f` 抛错 → `null`；`axis` 回 x；`free` 回 `[2, 9]`。
- [ ] **Step 2:** 运行，失败；实现 `graphpick.js`，过。
- [ ] **Step 3: 改 `graph.js`、`figures.js`、`styles.css`。**
- [ ] **Step 4: 真手指核对。** 写 `.superpowers/audit-visual/hm/v1-hands.md`（四张图：① 罗尔 / 拉格朗日：`let c = 0.5 drag on=f(x)`、`tangent f(x) at c`、`goal f'(c) = (f(3) - f(0))/3 tol=0.05`；② 极值点：`pick "点出全部极值点" on f(x) at roots(f'(x), x, -3, 3)`、`plot f'(x) after`；③ ε-δ：两个滑块、`goal maxon(abs(f(x) - 3), x, 2 - d, 2 + d) < eps`；④ 上 α 分位点：`let u = 1 drag`、`goal 1 - normcdf(u) = 0.05 tol=0.002`）和 `.superpowers/audit-visual/hm/v1-hands.mjs`（Playwright，`hasTouch` 的 iPad 竖屏：拖把手到目标看 `.goal-msg` 出现；点两个极值点再点「检查」看「全对」和 after 的曲线出现；故意点错一个看红点和「有 1 个不在这里」；点三次错看「看答案」；`window.LAKit` 的记录里有对应的几条）。跑通，截图看一遍。再验 Review Focus 3：脚本里调 `api.set` 把 c 摆到目标上，`.goal-msg` 不出现；手拖开再拖回才出现。
- [ ] **Step 5:** `npm test` 全过；`npm run build`。
- [ ] **Step 6: 提交** `git commit -m "函数图：点骑在曲线上拖、goal 关卡、pick 在图上点出来当场判、after（视觉第 1 批）"`

### Task 8: 示例页、手册、科目

**Files:**
- Create: `kit/examples/graph-demo.html`
- Modify: `CLAUDE-PROJECT.md`（第三节「表达式」一节、「graph：函数图」一节；版本号）、`kit/src/subject.js`（认 `高数`、`概率` 两门课）、`package.json`（`check:pages` 加 `graph-demo.html`）、`tests/subject.test.js`（如果它列了科目的清单）
- Test: `tests/graph-docs.test.js`

**Interfaces:**
- `subject.js` 的 `NAMES` 加 `高数: ['高数', '高等数学', '微积分', 'calculus', 'hm']`、`概率: ['概率', '概率论', '概率统计', '概率论与数理统计', 'ps', 'probability']`；`CS`、`isEN` 不变。`graph` 那一节的标记改成 `<!-- 科目：线代 高数 概率 计网 -->`。先读 `subject.js` 剩下的部分和 `class/prompt.js` 的 `defaultRules`、`docsForSubject`：新科目没有专门教法时走线代那一套（数学），这一条用测试钉住：`docsForSubject(docs, '高数')` 里有 graph 一节和「answer 的高数写法」一节、没有 `elim` 一节。
- 手册「graph」一节的精简版（`<!-- 完整写法 -->` 之前）≤ 3 KiB：一个带 `f(x) =`、`tangent`、`let … drag on=`、`goal` 的例子，一张命令表（每条一行），一句「`pick`、`riemann`、`area`、`dots`、求和、概率的函数见完整写法」；完整写法里每条命令一个能照抄的例子、`pick` 和 `goal` 的记录长什么样、算不出来时页面怎么做。「表达式」一节加一段：特殊形式和概率的函数（标明只在图和读数里能用，`\calc` 里只有概率的函数）。
- `kit/examples/graph-demo.html`：`<!doctype html>`、`<meta charset="utf-8">` 开头；按设计第三节的行排，每行一张图（高数 16 张、概率 8 张），每张图的标题就是那一行的考点。

- [ ] **Step 1: 写失败的测试** `tests/graph-docs.test.js`：从 `CLAUDE-PROJECT.md` 的 graph 一节和 `kit/examples/graph-demo.html` 里取出全部 ```` ```graph ```` 块，`parseGraph` 都不抛，每个 `pick` 的目标都算得出来、每个 `goal` 在初始值上求值不抛；示例页的 graph 块 ≥ 24 个；`subjectKey('高等数学') === '高数'`、`subjectKey('概率论') === '概率'`；`docsForSubject` 那一条。
- [ ] **Step 2:** 运行，失败。写示例页、手册、`subject.js`。
- [ ] **Step 3:** `npm run build`；`node --test tests/graph-docs.test.js tests/subject.test.js tests/manual-words.test.js tests/engines-common.test.js` 过；`npm run docs:size` 每门课离 40 KiB 的上限还有余量（线代最紧：graph 的精简版比原来长出来的要从别处让，放不下就把例子挪到完整写法后面）。
- [ ] **Step 4:** `node tools/check-lesson.mjs --shots .superpowers/audit-visual/hm/demo kit/examples/graph-demo.html`，两种尺寸、`ink` / `inknight` 两种风格（临时在示例页的课件开头加 front matter 试，试完去掉）逐张看；`npm run check:pages` 0 错。
- [ ] **Step 5: 提交** `git commit -m "函数图：示例页 graph-demo、手册、认高数和概率两门课（视觉第 1 批）"`

### Task 9: 逐行验收、发布

**Files:**
- Modify: `docs/superpowers/specs/2026-11-20-visual-design.md`（第三节：这一批盖住的行改评级，写上示例页里是哪一张）、`CLAUDE.md`（记一条）、`CLAUDE-PROJECT.md`（版本号）、`kit/dist/`

- [ ] **Step 1: 逐行验收。** 设计第三节高数表里这一批的 16 行、概率表里的 8 行，一行一行对着 `graph-demo.html` 的截图和五条标准评：哪条不满足就回去改到满足；确实要等第 2、3、4 批的（比如要二维的拖点）在表里写明「第 N 批」。把评级和依据写回设计文档。
- [ ] **Step 2:** `npm test`、`npm run build`（之后 `git status` 干净）、`npm run check:pages`、`npm run e2e` 全过。
- [ ] **Step 3:** 版本号改成当天的（同一天接着加字母）；`CLAUDE.md` 加一条「视觉交互组件第 1 批」（做了什么、文件在哪、怎么验的）；提交。
- [ ] **Step 4:** 合进 `main`、推上去；照 `CLAUDE.md`「发布」重新发布学习台（页面 `kit/desk.html`，`la-kit.js`、`CLAUDE-PROJECT.md`、`components/*.md` 来自 `kit/dist/`）。
- [ ] **Step 5:** 写第 2 批的执行计划 `docs/superpowers/plans/2026-11-20-visual-2-plane.md`，接着做。

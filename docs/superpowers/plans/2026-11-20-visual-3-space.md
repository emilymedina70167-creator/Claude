# 视觉交互第 3 批：三维图 `space` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task（主控自己一件一件做，不并行）. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `space` 把设计第三节里要「三维」的行做到 A：高数的空间解析几何（平面写方程、交线和夹角页面算）、二次曲面 / 旋转曲面 / 柱面（任意方程，含抛物面）、多元函数的曲面（截痕、偏导数的几何意义、切平面、全微分）、旋转体（圆盘、柱壳，体积页面算）、三重积分的区域（先一后二的柱、截面法、柱面 / 球面坐标的区域）、曲面积分和高斯公式（空间向量场、通量页面算）；线代的三个平面的位置关系（哪种情形页面说）、三阶的特征方向。

**Architecture:** 三维的几何全是纯函数，放 `kit/src/fx/solid.js`（曲面的网格、任意方程的曲面按三族截痕画线框（复用 `fx/plane.js` 的 `contourLines`）、平面和平面的交线、三个平面的情形、多边形被平面切开、旋转体、两张曲面之间的区域和截面）。`space.js` 的解析拆成纯函数的 `kit/src/spacespec.js`（照 `graphspec.js`）；表达式换成 `fx/defs.js` 的 `compileWith`（认 `f(x, y) = …`、偏导）。`space.js` 只管投影、按远近画、手势；几何按「变量变了才重算、转视角只重新投影」缓存。学生动手：地面上能拖的点（射线和 z = 0 的交点）、`goal`、地面上的 `pick`、`after` / `before`，记作答走 `blocks/figures.js` 现成的 `tasks`。

**Tech Stack:** 同前两批（原生 ES 模块、SVG、`node --test`、Playwright）。不加依赖、不用 WebGL。

**Spec:** `docs/superpowers/specs/2026-11-20-visual-design.md`（第一节标准、第三节的表、第四节第 3 批、第五节的线）

## Global Constraints

- 前两批的全部约束照旧；`graph` 的写法和画面不动（`tests/graph-docs.test.js`、`v1-hands.mjs`、`v2-hands.mjs`、`v2-demo-hands.mjs` 照旧全过）。
- **老的三维图一张不变**：现有写法（`vector` `point` `segment` `line` `span` `plane normal … at …` `box` `grid` `quadric 矩阵 = c` `text` `show`、`view:` `range:` `spin:`）照旧按角度算三角函数、画出来和现在一样（`kit/examples/` 里用到 space 的页、手册里 space 的例子、`tests/` 里 space 有关的测试照旧过）。
- **角度还是弧度**：图里写了微积分的东西（`f(x, y) = …` 的定义、`surface` `curve` `revolve` `solid` `field` 任何一条）就整张图按弧度；别的图照旧按角度；`angle: rad` / `angle: deg` 能明着定。`tests/expr-rad.test.js` 把 `spacespec.js` 的调用点归类（两种都有，写明哪条路是哪种）。
- 一帧的预算：转视角时只重新投影缓存的点，不重算几何；一张图里的面片（四边形）一共最多 2400 个，超了自动把网格减稀；拖滑块、拖点的那几帧用粗网格（一半的格数），手停 0.2 秒补细的（和 `graph` 同一个办法）。
- 手册：`space` 一节的精简版只许加一行指路（线代只剩 0.2 KiB——动手之前先从线代专用的小节里压出至少 1.5 KiB，压法写进 ledger）；新写法放「完整写法」后面；只写「能做什么、写法、页面会怎么做」。
- 判对错：页面拿不准的不判错（`goal` 的式子是 NaN 不算做到也不报错，除非式子本身写错）。

## Review Focus

1. **角度 / 弧度的切换**：老图（线代的 `rot`、`cos(t)` 按角度）有没有被改成弧度；新图里 `slider th 0 360` 这种老习惯有没有被静默地当成弧度画出一团乱线而不报。（Task 1）
2. **远近**：半透明的面互相穿过时（三个平面、曲面和切平面、曲面和截面）前后有没有画反到让人看错哪个在前；切开以后的多边形有没有缝、有没有丢。（Task 2、4）
3. **任意方程的曲面**按截痕画：有没有漏掉整支（双叶双曲面的两叶、锥面的顶点）、有没有在窗口边上画出不存在的线。（Task 2）
4. **地面上的拖点**：视线快和地面平行时（pitch 接近 0）射线和地面的交点飞到很远——点不能飞走；拖点和转视角两种手势不能串（按在把手上是拖点，别处是转）。（Task 5）
5. **数值积分的读数**（`int3`、`flux`、体积）：带指示函数、区域的边界有没定义的地方时，不收敛要说「页面算不出来」，不给错的数。（Task 7）
6. **三个平面的情形**：系数接近退化（差 1e-9）时页面说的情形和画的交线是不是一致；学生把滑块拖到两个平面重合时不崩。（Task 6）

---

### Task 1: 表达式的底座、解析拆出去

**Files:** Create `kit/src/spacespec.js`、`tests/spacespec.test.js`；Modify `kit/src/space.js`（改用它）、`tests/expr-rad.test.js`

**行为：**
- `parseSpace(src) → { fields, cmds, defs, rad }`：和现在同样的命令、同样的求值结果；多认 `名字(参数…) = 式子` 的定义（`fx/defs.js`：`f_x`、`f_grad`、`f'`）。`rad`：见 Global Constraints。老命令在 `rad: false` 的图里和现在逐字一样（`compile(src, { deg: true })`）。
- 新图里写了 `slider th 0 360`（上限 ≥ 30 而且名字像角：`th` `theta` `phi` `t` `a` `b` 都不管，只看「在三角函数里直接用到、范围超过 4π」）：自检软提醒「这张图按弧度算，th 的范围是 0 到 360」。
- `goal 左 = 右 tol= msg=` / `goal 条件`、命令和 `show` 末尾的 `after` / `before`：解析照 `graphspec.js`（抽成两边共用的小函数，放 `kit/src/figtasks.js`，`graphspec.js` 改成用它，行为不变）。

- [ ] **Step 1: 失败的测试**（`tests/spacespec.test.js`）：老写法每种一条，求值和现在的 `parseSpace` 一样（先在改之前把现在的结果抄成期望）；`f(x, y) = x^2 - y^2` 以后 `f_x(1, 2) = 2`；只有 `vector [cos(60), sin(60), 0]` 的图 `rad === false`、第一个分量是 0.5；加一条 `surface z = sin(x)` 以后 `rad === true`；`angle: deg` 压过；`goal`、`after` 解析对。`tests/expr-rad.test.js` 归类。
- [ ] **Step 2:** 实现；`npm test` 里 space 有关的照旧过；`node tools/check-lesson.mjs` 查用到 space 的示例页，截图和改之前逐张比（像素差不多：把改之前的截图先存在 `.superpowers/audit-visual/sp/before/`）。
- [ ] **Step 3: 提交** `三维图：解析拆成 spacespec、认函数定义和偏导、微积分的图按弧度（视觉第 3 批）`

### Task 2: 三维的几何 `fx/solid.js`

**Files:** Create `kit/src/fx/solid.js`、`tests/fx-solid.test.js`

**Interfaces（Produces）：**
- `meshGrid(P, [u0, u1], [v0, v1], { nu, nv }) → { pts: [[x,y,z]…]（(nu+1)(nv+1) 个，没定义的是 null）, quads: [[i0,i1,i2,i3]…]（四个角都有定义的）, nu, nv }`：参数曲面 P(u, v) → 点。显式曲面 z = f(x, y) 是 P = (u, v) ↦ [u, v, f(u, v)]。
- `meshOver(kind, f, base)`：在一个区域上的显式曲面——`base` 是 `{ shape: 'y'|'x'|'r', lo, hi, a, b }`（和 `fx/plane.js` 的 `typedRegion` 一样的描述）或矩形；网格贴着区域的边（参数是 (s, t)，s 沿 a..b，t 从 0 到 1 在 lo..hi 之间插）。
- `sliceLines(F, box, { n = 9, grid = 48 }) → { x: [[polyline3…]…], y: […], z: […] }`：任意方程 F(x, y, z) = 0 的曲面按三族平面的截痕画线框，每族 n 张等距的平面（用 `contourLines`）；回的折线是三维点。
- `planeFrom(a, b, c, d) → { n, p0 } | null`（ax + by + cz = d；法向量是零回 null）；`planeMeet2(P1, P2) → { p, d } | null`（平行回 null，重合回 `{ same: true }`）；`planes3(P1, P2, P3) → { rankA, rankAb, kind: 'point'|'line'|'plane'|'none-parallel'|'none-prism'|'none-two-parallel'|…, point?, line?, text }`（`text` 是给学生看的一句：「r(A) = 2，r(A, b) = 3：无解（三条交线互相平行，围成三棱柱）」）。秩按 1e-9 的相对容差。
- `splitPolygon(poly, plane) → [前面的多边形 | null, 后面的 | null]`（凸多边形被平面切成两块）；`splitAll(polys, planes)`：每块被别的平面都切一遍。
- `revolveMesh(f, [a, b], axis: 'x'|'y', { n, m, upTo = 2π })`、`revolveVolume(f, a, b, axis)`（圆盘法 π∫f²、柱壳法 2π∫x|f|）、`revolveArea(f, df, a, b)`（绕 x 轴的侧面积）。
- `solidBounds(lo, hi, base, { n })`：z 从 lo(x, y) 到 hi(x, y)、(x, y) 在 base 里——底、顶两张网格和侧面的竖线；`columnOf(lo, hi, x, y) → { z0, z1 } | null`；`crossSection(lo, hi, base, z0, { grid }) → 折线们`（平面 z = z0 截出来的那一块的边界，用 `contourLines` 画 `min(hi − z0, z0 − lo, 在不在 base 里)` 的 0 等值线）。
- `fieldArrows3(P, Q, R, box, n) → [{ p, d }]`：空间向量场的箭头（长度按大小开平方缩放，照 `fieldArrows`）。
- 上限：`SOLID_MAX_QUADS = 2400`。

- [ ] **Step 1: 失败的测试**（每条给判据）：`meshGrid` 的点数、没定义的点不进 quad（`sqrt(1 − x² − y²)` 在圆外）；`meshOver` 极坐标的底：最外一圈的点 r 正好是边界；`sliceLines` 球 x² + y² + z² = 4：每族 9 条里中间那条是半径 2 的圆（点到原点 2，误差 < 0.02）、最外两张（±2.5 以外）没有线；双叶双曲面两叶都有线；锥面 z² = x² + y² 的 z = 0 截痕不画成一大片；`planeMeet2` x + y + z = 1 和 x − y = 0 的交线方向平行于 [1, 1, −2]、点在两个平面上；`planes3` 的七种情形各一组系数（唯一解、交于一线、三面重合、三面平行、两面平行一面相交、三棱柱、两面重合一面相交）`kind` 和秩对；`splitPolygon` 正方形被过中心的平面切成两个面积各一半的多边形、不相交时一边是 null；`revolveVolume(x => sqrt(x), 0, 4, 'x') = 8π`、绕 y 轴 `x²` 在 0..1 是 π/2；`columnOf`、`crossSection` 球被 z = 1 截出半径 √3 的圆。
- [ ] **Step 2:** 实现 → 通过。
- [ ] **Step 3: 提交** `三维图：几何——曲面的网格、任意方程的截痕线框、平面的交线和三个平面的情形、旋转体、区域和截面（视觉第 3 批）`

### Task 3: spacespec 认新命令

**Files:** Modify `kit/src/spacespec.js`、`tests/spacespec.test.js`

**写法：**

```
plane p1 = 2x + y - z = 3 color=blue        # 平面写方程（老写法 plane normal … at … 照旧）；能起名字
meet p1, p2 color=yellow label=l            # 两个平面的交线；三个平面的公共点 / 公共线，情形写在左上角
angle p1, p2                                # 夹角的弧（两个平面、两条直线、线和面）——读数用 angleof(p1, p2)（弧度；angledeg(…) 是度）
foot A on p1                                # 点到平面 / 直线的垂足和垂线段；距离 dist(A, p1) 进读数
line l1 = [1, 0, 0] dir [1, 1, 1]           # 直线能起名字（给 angle、foot、meet 用）
surface z = f(x, y)                         # 显式曲面（for x a b, y c d；不写按 range）；over D 贴着一个区域
surface z = f(x, y) for r 0 2, t 0 2pi      # 极坐标的底
surface [x(u, v), y(u, v), z(u, v)] for u a b, v c d   # 参数曲面
surface x^2 + y^2 - z^2 = 1                 # 任意方程（按截痕画线框；柱面、锥面、抛物面都行）
curve [cos(t), sin(t), t/3] for t 0 4pi     # 空间曲线
section x = a of S                          # 曲面 S 被平面 x = a（或 y = b、z = c）截出来的曲线（S 是起了名字的 surface）
tangent S at [a, b]                         # 显式曲面在 (a, b) 的切平面和法线；空间曲线写 tangent C at t0 是切线
revolve f(x) for x a b about x              # 旋转体的面（upto=角 转到哪）；起名 revolve V = … 以后 V 是体积
disk V at x0 / shell V at x0                # 旋转体里的一片圆盘 / 一层柱壳
region D = y from … to … for x a b          # 地面上的区域（写法和 graph 一样），画在 z = 0 上
solid T = z from g(x, y) to h(x, y) over D  # 两张曲面之间、底是 D 的区域（柱面坐标写 over 的 D 是极坐标的区域）
solid T = rho from 0 to 2 for phi 0 pi/4, t 0 2pi      # 球面坐标的区域
column T at P lo=z1 hi=z2                   # 区域里竖着的一根（先一后二），上下限页面读
slice T at z0                               # 截面法：平面 z = z0 截出来的那一块，面积进名字 area=A
field [P, Q, R] n=4                         # 空间向量场
normals S n=5                               # 曲面上的法向量
eigen A                                     # 3×3 矩阵的实特征方向（直线）、特征值标在上面
let P = [1, 1] drag                         # 地面上能拖的点（二维）；drag on=S 时显示它在曲面上的像
goal … / pick "题目" at [x, y], … / after / before
```

表达式多的特殊形式（Task 7）：`int3(式子, x, a, b, y, c, d, z, e, f)`、`flux(P, Q, R, x(u,v), y(u,v), z(u,v), u, a, b, v, c, d)`、`lineint3(P, Q, R, x(t), y(t), z(t), t, a, b)`。函数：`angleof` `angledeg` `dist` 由图自己提供（对着起了名字的东西）。

- [ ] **Step 1: 失败的测试**：每种命令一条（字段求值对）；写错的每种一条（报的话里带正确的写法）；名字没定义（`meet p1, p9`）报「没有叫 p9 的平面」。
- [ ] **Step 2:** 实现 → 通过。
- [ ] **Step 3: 提交** `三维图：认 surface / curve / section / tangent / revolve / solid / column / slice / field / meet / angle / foot / eigen、平面写方程、地面上的拖点（视觉第 3 批）`

### Task 4: 画出来

**Files:** Modify `kit/src/space.js`、`kit/src/styles.css`；探针 `.superpowers/audit-visual/sp/v3-draw.md`

**行为：**
- 几何缓存：`geom(v)` 按变量的指纹存（滑块、拖点的值），转视角不重算。
- 面片：每个四边形一个 `polygon`，按中心的远近排；颜色按法向量和视线的夹角明暗两档（朝着看的亮一点），带网格线；半透明（`--sp-surf-a`）。任意方程的曲面是三族线（z 族实一点，x、y 族淡）。
- 几张平面：先 `splitAll` 切开再按远近画；每张平面默认不同的颜色（没写 `color=` 时 v1…v5 轮着来）；`meet` 的交线粗、盖在面上；三个平面的情形写在左上角（和 quadric 的名字同一处，几条的话竖着排，不叠）。
- 截痕（`section`）、切线、法线、垂线画在面的上面一层；`slice` 的那一块实一点。
- 标签：现有的 `placeLabels` 照旧，多一条「不盖在把手上」。
- 画布：`SIZE` 480 不变；`height:` 不加。

- [ ] **Step 1:** 探针一种命令至少一张（20 张以上）；改之前的老图截图已在 Task 1 存好。
- [ ] **Step 2:** 实现；`npm run build`；默认 / `ink` / `inknight` 三种风格、竖屏横屏看截图；转一圈的每一帧耗时在 Playwright 里量（`performance.now()`，2400 个面片时一帧不超过 16 ms 的 3 倍，超了减稀）。
- [ ] **Step 3: 提交** `三维图：曲面、截痕、切平面、旋转体、区域、向量场画出来；几张平面切开按远近画（视觉第 3 批）`

### Task 5: 学生动手

**Files:** Modify `kit/src/space.js`、`kit/src/blocks/figures.js`（`tasks` 已经通用，确认 space 的 api 给 `goals` `picks` `lonelyAfter` `tasks()`）、`kit/src/class/prompt.js`（`case 'graph'` 的那句话对 space 也说得通：`type` 记 `'graph'` 还是 `'space'` 在 ledger 里定）；真手指 `.superpowers/audit-visual/sp/v3-hands.mjs`

**行为：**
- 地面上的拖点：把手是地面上的一个圆点（44px 触控区）+ 一根竖线连到它在曲面上的像（`drag on=S`）。按在把手上拖：屏幕上的点 → 过它的视线和 z = 0 的交点（视线和地面的夹角小于 8° 时不动，免得飞走）；`snap=`；出不了 `range`。别处按下是转视角。
- `goal`：照 graph（主讲摆上去的、一画出来就成立的不算）。`pick … at [x, y]`：学生点地面上的位置（同样的射线求交），页面按地面上的距离配。
- 转视角不算作答、不发事件；拖点松手发 `dragend`。

- [ ] **Step 1:** 真手指脚本：拖点到目标、pitch 调到 3° 时拖点不飞、按在空白处拖是转视角（点不动）、`pick` 点对点错、`goal` 做到后 `after` 的东西出来、记了作答。
- [ ] **Step 2:** 实现到全过。
- [ ] **Step 3: 提交** `三维图：地面上能拖的点、goal、pick、after（视觉第 3 批）`

### Task 6: 平面、直线、特征方向

**Files:** Modify `kit/src/space.js`（`meet` `angle` `foot` `eigen` 的画法和 `angleof` `dist` 两个图里的函数）、`kit/src/fx/solid.js`（3×3 实特征值：特征多项式的实根 + 零空间）、测试

- [ ] **Step 1: 失败的测试**：`eig3([[2,0,0],[0,3,4],[0,4,9]])` 的特征值 1、2、11 和方向；有复特征值的矩阵（旋转）只回实的那一个；重根回一个平面（两个方向）。`angleof`、`dist` 的几个值。
- [ ] **Step 2:** 实现；探针加四张（两平面的交线和夹角、点到平面的距离、三个平面七种情形用滑块切换、三阶特征方向）；截图。
- [ ] **Step 3: 提交** `三维图：平面的交线、夹角、垂足、三个平面的情形、三阶的特征方向（视觉第 3 批）`

### Task 7: 三重积分、通量

**Files:** Modify `kit/src/expr.js`（`int3` `flux` `lineint3`）、`kit/src/fx/integral.js`、`tests/expr-forms.test.js`

- [ ] **Step 1: 失败的测试**：`int3(1, x, 0, 1, y, 0, 1 - x, z, 0, 1 - x - y) = 1/6`；球的体积用球面坐标 `int3(rho^2*sin(phi), t, 0, 2pi, phi, 0, pi, rho, 0, 1) = 4π/3`（1e-6）；`flux(x, y, z, sin(u)cos(v), sin(u)sin(v), cos(u), u, 0, pi, v, 0, 2pi) = 4π`（单位球面朝外）；`lineint3(-y, x, 0, cos(t), sin(t), t, t, 0, 2pi) = 2π`；被积函数发散的抛「页面算不出来」。
- [ ] **Step 2:** 实现 → 通过；`tests/finite-scan.test.js` 过。
- [ ] **Step 3: 提交** `表达式：int3、flux、lineint3（视觉第 3 批）`

### Task 8: 示例页、手册

**Files:** Create `kit/examples/space-demo.html`（按设计第三节这一批的行，一行至少一张，20 张以上，学生能动手的占多数）；Modify `CLAUDE-PROJECT.md`（space 一节）、`tests/space-docs.test.js`（新建：照 `graph-docs`）、`package.json` 的 `check:pages`

- [ ] **Step 1:** 先压线代的组件说明（至少 1.5 KiB）；改测试 → 失败 → 写示例页和手册 → 通过；`npm run docs:size`。
- [ ] **Step 2:** 真手指 `v3-demo-hands.mjs`：示例页每张的目标 / 点一点做得到。
- [ ] **Step 3: 提交** `三维图：示例页和手册（视觉第 3 批）`

### Task 9: 逐行验收、发布

- [ ] **Step 1:** 设计第三节这一批盖住的行逐行对着示例页和五条标准评，不到 A 的回去改；评级写回设计文档。
- [ ] **Step 2:** 独立复查一次（一个）；Critical / Important 一次修完，每条先有失败的测试。
- [ ] **Step 3:** `npm test`、`npm run build`、`npm run check:pages`、`npm run e2e` 全过；版本号、`CLAUDE.md`、合进 `main`（先看 `origin/main` 动没动）、发布学习台。
- [ ] **Step 4:** 写第 4 批（概率：抽样模拟、文氏图、概率树、联合分布表）的执行计划，接着做。

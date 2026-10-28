// 组件库的版本：构建时从 CLAUDE-PROJECT.md 开头的「版本：…」写进来（kit/build.js 的 define）。
// node 测试里直接 import 源码时没有这个常量，就是 'dev'
/* global __LAKIT_VERSION__ */
export const VERSION = typeof __LAKIT_VERSION__ !== 'undefined' ? __LAKIT_VERSION__ : 'dev';
// 学习台的地址：唯一的 artifact（docs/hub-plan.md），说明书 CLAUDE-PROJECT.md、组件写法 components/*.md、la-kit.js 都发布在它里面。
// 启动语、瘦身说明书里「去哪读」都用它
export const DESK_URL = 'https://claude.ai/artifact/BCAMUUkMWc2rt5hSS1ULHo';
// 以前组件库单独是一个 artifact；现在就是学习台（旧名字留着，别处 import 不用改）
export const KIT_URL = DESK_URL;
// 以前的组件库地址：不再更新，它的说明书只剩一句「搬到学习台了」（kit/moved/）
export const OLD_KIT_URL = 'https://claude.ai/artifact/5ZUhFR5T5i1wMysQmthoAF';

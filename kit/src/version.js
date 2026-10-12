// 组件库的版本：构建时从 CLAUDE-PROJECT.md 开头的「版本：…」写进来（kit/build.js 的 define）。
// node 测试里直接 import 源码时没有这个常量，就是 'dev'
/* global __LAKIT_VERSION__ */
export const VERSION = typeof __LAKIT_VERSION__ !== 'undefined' ? __LAKIT_VERSION__ : 'dev';

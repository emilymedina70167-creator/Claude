// 课堂里的 Claude 用的组件说明：构建时由 kit/build.js 的插件从 CLAUDE-PROJECT.md 第三节生成（精简规则见 kit/build-docs.js），
// 和组件库一起打包，所以课件页面不用再去别处读文档。
import raw from 'virtual:component-docs';

export const COMPONENT_DOCS = raw;

// 舞台画面的量法（tools/stage-audit.mjs 排版检查、tools/stage-try.mjs 试演共用）：在页面里量每一样东西实际占的地方。
// 量法本身在组件库里（kit/src/stage/sight.js，课堂交给学生之前也用它量）：这里只在页面里调它，尺子只有一把。
// 函数要整个塞进页面跑（page.evaluate / toString），所以不能用外面的变量。
export function measure(visual = false) {
  return window.LAStage.sight({ visual });
}

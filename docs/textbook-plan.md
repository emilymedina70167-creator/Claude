# 教材板块和学习台自己备课（2026-10-29）

## 我要的

学习台完全自给自足：教材、记忆、备课、上课都在里面，不用对话里的 Claude 先读项目知识库、再塞进资料包。教材不能一上来全塞给 Claude，要按需读，而且读得准、取得快。我的 PDF 没有文字层（扫描版），在 claude.ai 的项目知识库里读得很慢。

## 事实

- 页面里的 Claude（`sample`）只收文字和图片，不收 PDF、Word。所以由页面把文件变成它能读的：Word / PowerPoint 页面自己解压取字（不花额度）；PDF 用 pdf.js 一页画成一张图，交给 Opus 5.5 看图转写。
- 扫描版没有文字层，只能看图转写。看图的成本主要在**一次**：每页一张图（约一两千 token）加上转出来的字。转一次存起来，以后每节课按编号取几条，不用再看图。claude.ai 项目知识库里的扫描 PDF 是每次用到都要重新处理，慢、也贵。
- 一次最多附几张图由平台定（`limits().images.maxCount`），一次转 3 页（`PAGES_PER_CALL`），两批同时转。

## 做了什么

**存放**（学习台数据库，不进记忆库的 13 类）：

- `books/{B1}`：一本资料：`title`、`kind`（textbook 教材 / transcript 视频文稿 / slides 讲义 / notes 笔记）、`space`、`subject`、`status`（importing / partial / ready）、`toc`（章、节、小节，指向后面第一条）、`chunks` 条数、`pagesDone` / `pagesLeft`、`cost.calls`。
- `books/{B1}/pages/{页码}`：每页的原页图（assets 的 id，1200 像素宽 JPEG）、PDF 的文字层、转写结果 `items`、`status`（todo / done / error）。停了、关了页面，下次从没转的页接着转（不用再选文件）。
- `books/{B1}/chunks/{B1-23.1}`：一条：`kind`（定义、定理、性质、推论、公式、例题、习题、方法、说明、图表、文稿、讲义）、`title`（书上的编号和名字）、`chapter`、`section`、`page`–`pageEnd`、`text`（Markdown + LaTeX，忠实原文）、`img`（原页图）、`checked`（我核对过）、`fixed`（我改过字，重拼时保留）。编号按「从第几页开始的第几条」，重转别的页编号不变，课程地图挂的不会错位。

**入库**（`books/importer.js`，学习台「教材」页）：

- PDF：每 12 页「画图存原页 → 转写」一轮，边存边转；选页码范围（先转这一讲要用的），选文件时就算出要调用几次。有文字层的 PDF 把文字层也给 Claude 对照汉字、数字，公式以图为准。
- 截图、照片：每张一页，可以加到已有的书里（写起始页码）。
- Word 文稿：页面自己切成一千多字一条，不调用 Claude。
- PowerPoint 讲义：只有字的页直接成一条；带图的页（板书截图）交给 Claude 看图转写。
- 转写的规矩（`ingest.js` 的 `transcribePrompt`）：忠实、看不清写【看不清】、公式 LaTeX、例题连解答、定理连证明、跨页标 `cont`、标题带层级。拼条目（`assembleChunks`）：跨页接上、碎的说明并起来、太长的按空行切开。

**核对**：教材页一条条展开，左边转出来的字（KaTeX 渲染），右边原页图；「核对过了」「改字」「重新转写这几页」。

**课堂里按需读**（`books/textbook.js`）：

- 资料包点名的条目（备课时挑的 `chunks`）全文并进资料包的「教材原文」；没点名就用这一块挂着的。
- 资料包里多一节「教材目录（按需取）」：这一讲的条目，一条一行。
- 工具：`textbook_read`（按编号，一次几条）、`textbook_search`（按词找，中文两个字一组比，标题命中算得多）、`textbook_page`（把原页图附给它看）。`image` 组件写条目编号就能把原页贴上黑板。

**学习台自己备课**（`books/plan.js`、`planview.js`）：

- 挂课程地图：教材页「挂到课程地图」：Claude 看这本的目录和现有的课程地图，提出每块挂哪些条目（可以写范围 `B1-23.1~B1-25.2`）、缺的块怎么加；我勾了才写（课程地图的写入方加了 `me`）。
- 备课：首页「上课」卡选一块 →「让 Claude 备课」：带这一块的范围、要点、挂着的原文、文稿、全部规则（包括备课和资料包的规矩）、和课堂里同一份记忆、最近几节课 → 写这一科的 `pack/main`、`pack/problems`（`by: "desk"`），我看过推进计划再开课。

**备份**：导出备份带上 `books` 和每本的 `chunks`（转写花了额度，丢了不划算）；原页图在 assets 里不进备份。

**pdf.js 不进 la-kit.js**：一百多万字节，平时上课用不着。构建时拷到 `kit/dist/pdf/`（pdf.js、worker、扫描版要的 JBIG2 / JPEG2000 解码器和不支持 wasm 时的 js 版、GB 的 cmap），作为学习台的附带文件 `pdf/…` 发布，导入 PDF 时才取。

## 本地试用

`desk-demo.html?dev`：「填入示例记忆」→ 顶上「教材」→ 选一个 PDF（有文字层的话，模拟的 Claude 照文字层拼条目）、Word 文稿 → 「挂到课程地图」→ 首页「让 Claude 备课」→「开新课」。模拟的 Claude 在 `books/devmock.js`。

// 打包成单个文件 kit/dist/la-kit.js：组件 + markdown-it + KaTeX（样式和字体都内嵌）
// artifact 只允许极少数外部脚本、不允许外部样式和字体，所以全部打进一个文件
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { componentDocs, docVersion } from './build-docs.js';

const require = createRequire(import.meta.url);
const katexDist = path.dirname(require.resolve('katex/dist/katex.min.css'));

// KaTeX 样式：字体改成 woff2 的 data URI
function katexCss() {
  const css = readFileSync(path.join(katexDist, 'katex.min.css'), 'utf8');
  return css.replace(/src:url\(fonts\/([\w-]+)\.woff2\)[^;}]*/g, (_, name) => {
    const b64 = readFileSync(path.join(katexDist, 'fonts', `${name}.woff2`)).toString('base64');
    return `src:url(data:font/woff2;base64,${b64}) format("woff2")`;
  });
}

const katexCssPlugin = {
  name: 'katex-css',
  setup(b) {
    b.onResolve({ filter: /^virtual:katex-css$/ }, () => ({ path: 'katex-css', namespace: 'virtual' }));
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: katexCss(), loader: 'text' }));
  },
};

// 课堂模式的组件手册：从 CLAUDE-PROJECT.md 第三节截出来（见 build-docs.js），以文本打包。
// 用单独的 namespace：上面 katex 插件的 onLoad 会接管 'virtual' namespace 里的所有路径
const projectDoc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'CLAUDE-PROJECT.md');
const componentDocsPlugin = {
  name: 'component-docs',
  setup(b) {
    b.onResolve({ filter: /^virtual:component-docs$/ }, () => ({ path: projectDoc, namespace: 'component-docs' }));
    b.onLoad({ filter: /.*/, namespace: 'component-docs' }, () => ({
      contents: componentDocs(readFileSync(projectDoc, 'utf8')),
      loader: 'text',
      watchFiles: [projectDoc],
    }));
  },
};

const version = docVersion(readFileSync(projectDoc, 'utf8'));
const banner = `/*! 学习台 la-kit ${version} | https://github.com/emilymedina70167-creator/Claude
 *  bundles markdown-it (MIT) and KaTeX (MIT, fonts SIL OFL) */`;

await build({
  entryPoints: ['kit/src/main.js'],
  bundle: true,
  minify: !process.env.DEBUG,
  format: 'iife',
  target: ['safari16', 'chrome110', 'firefox110'],
  loader: { '.css': 'text' },
  define: { __LAKIT_VERSION__: JSON.stringify(version) },
  plugins: [katexCssPlugin, componentDocsPlugin],
  banner: { js: banner },
  outfile: 'kit/dist/la-kit.js',
  logLevel: 'info',
});

// 说明书不再发布（2026-11-22 去限制设计第 5 步）：主讲读学习台数据库里的接口卡 meta/interface（project/iface.js，页面写），
// 写错了报错里自己说清楚（组件认的字段和例子：subject.js 的 fieldHint）。以前拆出来发布的 kit/dist/docs/ 不再生成。
// 仓库里的 CLAUDE-PROJECT.md 照旧是页面里的 Claude 用的组件手册的来源（virtual:component-docs），build-split.js 的拆法留给测试核手册
{
  const { rmSync } = await import('node:fs');
  rmSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dist', 'docs'), { recursive: true, force: true });
}

// 读 PDF 用的 pdf.js（教材入库，docs/textbook-plan.md）：不打进 la-kit.js（一百多万字节，平时上课用不着），
// 作为学习台的附带文件发布在 pdf/ 下，导入 PDF 时页面才去取（同一个 artifact 里的文件，不是外部脚本）。
// 扫描版的书常用 JBIG2 / CCITT / JPEG2000 压图，解码器（wasm，和不支持 wasm 时的 js 版）也要带上；中文字体的 cmap 只带 GB 的
{
  const { mkdirSync, copyFileSync, rmSync, readdirSync, writeFileSync } = await import('node:fs');
  const { escapeControls } = await import('./src/books/jsescape.js');
  const pdfDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dist', 'pdf');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // worker 的内嵌数据（模板字符串里）有原样的控制字符，学习台发布时不收：换成等价的 \xNN 写法。
  // 这些字符前面都没有反斜杠、也没有 String.raw，换了值不变（tests/books.test.js 守着）
  for (const f of ['build/pdf.min.mjs', 'build/pdf.worker.min.mjs']) {
    writeFileSync(path.join(out, path.basename(f)), escapeControls(readFileSync(path.join(pdfDir, f), 'utf8')));
  }
  for (const f of ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm', 'jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']) copyFileSync(path.join(pdfDir, 'wasm', f), path.join(out, f));
  // cmap 是二进制的 .bcmap，学习台发布不收这种文件：拼成一个 JSON（名字 → base64），books/pdf.js 的 DeskData 从里面取
  const cmaps = readdirSync(path.join(pdfDir, 'cmaps')).filter((f) => /GB|UCS2|UTF16|Identity/.test(f));
  const packed = Object.fromEntries(cmaps.map((f) => [f, readFileSync(path.join(pdfDir, 'cmaps', f)).toString('base64')]));
  writeFileSync(path.join(out, 'cmaps.json'), JSON.stringify(packed));
  console.log(`  kit/dist/pdf/  pdf.js ${JSON.parse(readFileSync(path.join(pdfDir, 'package.json'), 'utf8')).version}，cmap ${cmaps.length} 个`);
}

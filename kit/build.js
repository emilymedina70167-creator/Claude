// 打包成单个文件 kit/dist/la-kit.js：组件 + markdown-it + KaTeX（样式和字体都内嵌）
// artifact 只允许极少数外部脚本、不允许外部样式和字体，所以全部打进一个文件
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { componentDocs } from './build-docs.js';

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

const banner = `/*! 线代学习台 la-kit | https://github.com/emilymedina70167-creator/Claude
 *  bundles markdown-it (MIT) and KaTeX (MIT, fonts SIL OFL) */`;

await build({
  entryPoints: ['kit/src/main.js'],
  bundle: true,
  minify: !process.env.DEBUG,
  format: 'iife',
  target: ['safari16', 'chrome110', 'firefox110'],
  loader: { '.css': 'text' },
  plugins: [katexCssPlugin, componentDocsPlugin],
  banner: { js: banner },
  outfile: 'kit/dist/la-kit.js',
  logLevel: 'info',
});

// 读 zip（.docx、.pptx 都是 zip）：只认「存储」和 deflate 两种压缩，够 Office 文件用。
// 解压用浏览器自带的 DecompressionStream('deflate-raw')（iPadOS 16.4 起有，node 18 起也有），不打包解压库。
// 纯函数（除了解压要的流），有测试。

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const utf8 = new TextDecoder('utf-8');

/** 列出 zip 里的文件：[{ name, method, size, compSize, offset }]（offset 是本地文件头的位置） */
export function zipEntries(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // 中央目录结尾：从文件末尾往前找签名 0x06054b50（后面可能有最多 64 KB 的注释）
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是 zip 文件（.docx / .pptx 应该是 zip）');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('zip 的目录坏了');
    const method = u16(b, p + 10);
    const compSize = u32(b, p + 20);
    const size = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const offset = u32(b, p + 42);
    const name = utf8.decode(b.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, size, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * 解出 zip 里的文件。want(name) 返回 true 的才解（Office 文件里图片很多，只要文字时不解图）。
 * 返回 Map(name → Uint8Array)
 */
export async function unzip(bytes, want = () => true) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const files = new Map();
  for (const e of zipEntries(b)) {
    if (e.name.endsWith('/') || !want(e.name)) continue;
    if (u32(b, e.offset) !== 0x04034b50) throw new Error(`zip 里 ${e.name} 的文件头坏了`);
    const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
    const raw = b.subarray(start, start + e.compSize);
    if (e.method === 0) files.set(e.name, raw.slice());
    else if (e.method === 8) files.set(e.name, await inflateRaw(raw));
    else throw new Error(`zip 里 ${e.name} 用了不认识的压缩方式 ${e.method}`);
  }
  return files;
}

export const textOf = (bytes) => utf8.decode(bytes);

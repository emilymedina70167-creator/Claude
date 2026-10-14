// 一串二进制位按字段画出来（地址的页号 | 页内偏移、cache 的标记 | 组号 | 块内地址、浮点数的符号 | 阶码 | 尾数……）。
// 纯函数，返回 HTML。位从左（高位）到右（低位）；每个字段上面写名字，下面写它的值。
import { esc } from './arrayview.js';

/** 大小写法：1K、4KB、2M、2^12、4096 → 字节数（BigInt 也行） */
export function parseSize(src, what = '大小') {
  const s = String(src ?? '').trim().replace(/\s+/g, '').toUpperCase();
  let m = /^2\^(\d+)(B)?$/.exec(s);
  if (m) return 2 ** Number(m[1]);
  m = /^(\d+)([KMG]?)I?B?$/.exec(s);
  if (!m) throw new Error(`${what}写成 1KB、4K、2^12 或 4096（现在是「${src}」）`);
  return Number(m[1]) * { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2]];
}
export const log2int = (n) => { const k = Math.log2(n); return Number.isInteger(k) ? k : null; };

/** 地址、数：0x2A3C、0b1010、10 进制都认 → BigInt */
export function parseNum(src, what = '数') {
  const s = String(src ?? '').trim().replace(/_/g, '').replace(/\s+/g, '');
  if (/^0x[0-9a-f]+$/i.test(s)) return BigInt(s);
  if (/^[0-9a-f]+H$/i.test(s)) return BigInt(`0x${s.slice(0, -1)}`);
  if (/^0b[01]+$/i.test(s)) return BigInt(s);
  if (/^\d+$/.test(s)) return BigInt(s);
  throw new Error(`${what}写成 0x2A3C、2A3CH 或十进制数（现在是「${src}」）`);
}
export const hex = (v, bits) => `${v.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')}H`;
export const bin = (v, bits) => v.toString(2).padStart(bits, '0');

/**
 * fields：[{ name, bits, cls?, value? }]，从高位到低位，位数加起来是总宽度。
 * opts：hi（要强调的字段名）、note（字段下面除了十进制再写点什么：{ 名字: 文字 }）
 */
export function bitFields(v, fields, { hi = [], note = {}, pick = false } = {}) {
  const width = fields.reduce((a, f) => a + f.bits, 0);
  const b = bin(BigInt(v), width);
  let pos = 0, cell = 0;
  let h = '<div class="bv">';
  for (const f of fields) {
    const part = b.slice(pos, pos + f.bits);
    pos += f.bits;
    const val = f.bits ? BigInt(`0b${part}`) : 0n;
    const cls = ['bv-f', f.cls || '', hi.includes(f.name) ? 'bv-hi' : ''].filter(Boolean).join(' ');
    // 四位一组按整个位串从低位往高位分（每组正好是一位十六进制），不按字段分
    const startBit = pos - f.bits;
    const bitsHtml = [...part].map((c, i) => { const fromRight = width - 1 - (startBit + i); return `<span data-cmd="${++cell}"${i > 0 && fromRight % 4 === 3 ? ' class="bv-gap"' : ''}>${c}</span>`; }).join('');
    h += `<div class="${cls}"${pick ? ` data-pick="${esc(f.name)}"` : ''} data-label="${esc(f.name)}"><div class="bv-name">${esc(f.name)}<small>${f.bits} 位</small></div><div class="bv-bits">${bitsHtml}</div><div class="bv-val">${f.bits ? `${val}${note[f.name] ? `<small>${esc(note[f.name])}</small>` : ''}` : ''}</div></div>`;
  }
  return h + '</div>';
}

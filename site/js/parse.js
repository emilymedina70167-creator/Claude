// 组件参数解析：每行 `key: value`，没有 key 的行接到上一个 key 后面
export function parseFields(src) {
  const fields = {};
  const lines = [];
  let last = null;
  for (const raw of src.split('\n')) {
    const m = raw.match(/^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/);
    if (m) {
      last = m[1].toLowerCase();
      fields[last] = m[2];
    } else if (last && !/^\s*-\s*\[[ xX]\]/.test(raw)) {
      fields[last] += '\n' + raw;
    } else {
      lines.push(raw);
    }
  }
  for (const k in fields) fields[k] = fields[k].trim();
  return { fields, lines };
}

export const list = (s) => (s || '').split(/[,，\s]+/).filter(Boolean).map((x) => x.toLowerCase());

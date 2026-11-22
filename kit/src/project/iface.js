// 接口卡 meta/interface（去限制设计第三节）：说明书不再发布，主讲第一次只读这一份——开一节、一轮写在哪、自由段、lab 桥、
// 作答从哪读回来、下课，6 条事实。字段、取值、函数名都从代码里取（schema.js、htmlseg.js 的 LAB_API），代码一改它跟着变。
// 只写事实，不写做法（tests/project-iface.test.js 守着）。纯函数
import { COLLECTIONS } from '../memory/schema.js';
import { LAB_API, HTML_HEAD_FIELDS } from '../htmlseg.js';

/** 接口卡的内容：{ v, facts: [{ what, … }], text }。version：组件库版本 */
export function interfaceDoc({ version = '' } = {}) {
  const S = COLLECTIONS.sessions;
  const spaces = S.enums.space.join(' | ');
  const facts = [
    {
      what: '开一节',
      path: 'sessions/{编号}',
      id: S.id.eg,
      doc: { kind: 'ext', status: 'open', date: 'YYYY-MM-DD', title: '这节课的名字', space: spaces },
      optional: { block: '课程地图的块编号（curriculum 里的 id）', upload: 'on | off（学生交截图的入口，默认 off）', wake: "comments（学生打字、交作答、点叫主讲时，页面在学习台上发一条「发给 Claude」的评论，叫醒正 watch 学习台的 Claude 会话；评论只写课号和一行指路；要学生在浏览器里打开学习台，Claude App 里嵌着的视图发不了，发不了时下一份 ext_out 最前面写原因）" },
    },
    {
      what: '一轮写在哪',
      path: 'sessions/{编号}/ext_in/{三位序号}',
      doc: { seq: 1, text: '对学生说的话 + board 块' },
      optional: { after: '写这一轮时读过的 ext_out 序号', said: '学生在对话里说的原话（字符串，或 [{ text, at }]）' },
      board: '```` 包起来的块，第一行是指令：board new id=… title=…（新开一块板）、board add id=…（接在当前板上）；块里是段的内容（Markdown、公式、组件围栏、html 围栏）。外层的反引号比里面的围栏多',
      once: '同一条只执行一次：执行完页面在这一条上写 done 和 result',
    },
    {
      what: '自由段',
      fence: '```html',
      where: 'board new / board add 的块里',
      head: HTML_HEAD_FIELDS,
      runs: '板上一个 iframe（sandbox="allow-scripts"）：任意 HTML / CSS / SVG / JS，能从 cdnjs 等 CDN 载脚本；碰不到学习台的数据库，只经 lab 桥',
      errors: '框里的报错、内容比框宽，写进下一份 ext_out；画出来的部分照样显示',
      state: 'sessions/{编号}/html_state/{段的 id}',
    },
    { what: 'lab 桥', fns: LAB_API },
    {
      what: '作答从哪读回来',
      result: 'sessions/{编号}/ext_in/{序号} 的 result：执行了哪些指令、哪一处写错、写错的组件认哪些字段',
      out: 'sessions/{编号}/ext_out/{序号}：学生每一批作答、说的话、草稿、板书',
      since: 'sessions/{编号}/meta/since：上一条 ext_in 执行完以后的全部 ext_out 拼成一份',
      now: 'sessions/{编号}/meta/now：板现在什么样',
      evidence: 'evidence：每一条作答（session 是这节课的编号；judgedBy: author 是你的代码判的，page 是页面判的）',
    },
    { what: '下课', cmd: 'board close', report: 'sessions/{编号}/report/main：页面算的课后报告' },
  ];
  return { v: version, facts, text: interfaceText(facts, version) };
}

const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('；');

/** 6 条写成一段字（ArtifactData get 一次读完） */
export function interfaceText(facts, version = '') {
  const out = [`学习台的接口${version ? `（组件库 ${version}）` : ''}`];
  facts.forEach((f, i) => {
    const { what, fns, ...rest } = f;
    out.push('', `${i + 1}. ${what}`);
    for (const [k, v] of Object.entries(rest)) out.push(`   ${k}: ${typeof v === 'string' ? v : Array.isArray(v) ? v.join('、') : fmt(v)}`);
    if (fns) for (const x of fns) out.push(`   lab.${x.call}：${x.does}`);
  });
  return out.join('\n');
}

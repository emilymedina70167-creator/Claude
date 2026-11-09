// 裁判：学生（或老师）在一样东西上做一下，页面怎么走。纯函数，不认识任何具体的东西，只问 rules.js。
// 页面不做教学决定：合不合这个世界的规则（legal）是物理，永远不做；
// 做得对不对（right）怎么处理全看老师写在 open 那一行的 wrong= / call=，默认 quiet（照做、只记下）。
// 老师自己的一步永远照演不拦（可能是故意演错），错了只在事实里提醒（规则此刻要的也是这一种动作时才核）。
import { rulesOf, done } from './rules.js';

const text = (x) => (typeof x === 'string' ? x : x?.why || '');
/** 规则此刻的下一步里有没有和这一下同一种的动作（老师的一步只在这时核）；next 抛错、做完了（null）都算没有 */
function sameKind(rules, o, act, scene) {
  try { return !!rules.next(o, scene)?.acts?.some((a) => a.type === act.type); } catch { return false; }
}

/**
 * judge(scene, objId, act, policy, { by }) → { verdict, apply, call, facts, mark }
 *   policy = { wrong: 'quiet' | 'mark' | 'block', call: 'wrong' | 'done' | null }
 *   check 返回的 why 是「这一下做了什么」（如「50 右旋」），next 是「现在正确的是什么」（字符串或带 why 的对象）
 *   apply 要不要真的演；call 是 'now' 或 null；mark 要不要淡淡圈一下；facts 写给老师的话
 */
export function judge(scene, objId, act, policy = {}, { by = 'student' } = {}) {
  const o = scene?.objects?.get(objId);
  const rules = rulesOf(o);
  const out = { verdict: null, apply: true, call: null, facts: [], mark: false };
  if (!rules) return out; // 没有规则：照旧能用，只是不判

  const v = rules.check(o, act, scene) || {};
  const verdict = { legal: v.legal !== false, right: v.right ?? null, misread: v.misread ?? null, why: v.why ?? null, next: v.next ?? null };
  out.verdict = verdict;
  const wrong = verdict.right === false;

  if (by === 'teacher') {
    // 老师的照演、不叫自己；不是正确的下一步就在事实里说一声。只在规则此刻要的也是这一种动作时核：
    // 二叉排序树的插入课上老师示范旋转（规则要的是插数），拿平衡二叉树的转法核它，会说出「已经平衡了，不用再动」这种不相干的话。
    // next 出错也不写（宁可不说，不说假话）
    if (wrong && sameKind(rules, o, act, scene)) out.facts.push(`你在 ${verdict.why || '上一步'}，现在正确的是${text(verdict.next) || '（页面算不出）'}`);
    return out;
  }

  const wrongPolicy = policy.wrong || 'quiet';
  if (!verdict.legal) {
    out.apply = false; // 这个世界的物理：永远不做，记一笔
    out.facts.push(verdict.why || '这一下做不到');
    return out;
  }
  if (wrong) {
    out.mark = wrongPolicy === 'mark';
    out.apply = wrongPolicy !== 'block';
    const line = `这一下不是正确的下一步${verdict.misread ? `，${verdict.misread}` : ''}${verdict.why ? `（做的是 ${verdict.why}）` : ''}`;
    out.facts.push(out.apply ? line : `${line}，没让做`);
    if (policy.call === 'wrong') out.call = 'now';
  }
  return out;
}

export { done };

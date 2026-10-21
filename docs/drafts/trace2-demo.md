# 示例草稿：trace 二期（单链表就地逆置）

能直接放进示例页（`kit/examples/408-demo.html` 的「1. 数据结构」里，`tr-ins` 后面），也可以当 `CLAUDE-PROJECT.md` 里 `### trace` 的第二个例子。`kit/examples/ds-trace2-demo.html` 里有这一个和别的几个（头插法建表、删除值为 x 的结点、两个有序表合并、二叉链表先序遍历、顺序表插入、一段会空指针出错的代码）。

要点：`let L = list [头, …]` 直接给一个带头结点的单链表，`call:` 从 `Reverse(L)` 开始；`predict:` 问指针（`->` 两边留空格），学生写那个结点的 data，或者 NULL。

```trace
id: tr-rev
title: 带头结点的单链表就地逆置（头插法）
call: Reverse(L)
let L = list [头, 1, 2, 3, 4]
predict: 11 if p->data == 3 -> p->next; 13 if r == NULL -> p
code:
typedef struct LNode {
    ElemType data;
    struct LNode *next;
} LNode, *LinkList;
void Reverse(LinkList L){
    LNode *p, *r;
    p = L->next;
    L->next = NULL;
    while (p != NULL) {
        r = p->next;
        p->next = L->next;
        L->next = p;
        p = r;
    }
}
```

走一遍的样子：一开始 L → 头结点① → ②(1) → ③(2) → ④(3) → ⑤(4) → ∧。第 8 行 `L->next = NULL` 以后断成两条链（L 那条只剩头结点，p 那条是剩下的），之后每一轮把 p 指着的结点摘下来插到头结点后面：结点从下面那行滑到上面那行，改了的 next 箭头是黄的。两个先猜：第 11 行（p 指着 data 为 3 的结点那一次）之后 `p->next` 指向 data 为 2 的结点（答 2）；最后一轮第 13 行之后 p 是 NULL（答 NULL）。

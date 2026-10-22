# 控制端右侧「播放控制」面板重设计方案

**状态：设计已通过，待实施**

**调查日期：2026-10-22**

**代码基线：`bbebee9`**

**需求跟踪：[Issue #4](https://github.com/billzhuang6569/zhuang-prompter/issues/4)**

**设计稿：[Claude design 画板「提案 · 右侧播放控制面板重设计」](https://claude.ai/artifact/WRurTmYMYKNRTtJirmyGKn)**（私有链接，需产品负责人分享后才能打开）

本文只涉及控制端右侧面板的信息架构、视觉与无障碍，不改播放协议、不改 `RoomClient` 的回调逻辑。与 M6（Issue #2）的关系：字号卡的数值输入框依赖 M6 D 节放开 200% 上限；本方案先落 UI，上限数值由 M6 决定。两者可以独立合并，顺序不限。

## 现状与问题

当前 [`control-console.tsx`](https://github.com/billzhuang6569/zhuang-prompter/blob/bbebee9/src/app/room/%5BroomCode%5D/_components/control-console.tsx#L1113) 右侧第一个 `nike-psec` 把以下内容堆在一起：

| 行 | 内容 | 问题 |
| --- | --- | --- |
| `nike-pb` | `\|<` `‹` 播放 `›` `>\|` | 纯符号，无文字；`‹ ›` 是 ±160px |
| `nike-spdr` | 「速度」滑块 + `68px/s` | 标签字号 10px，和下面的字号滑块长得一样 |
| `nike-sadj` | `-10` `+10` | 没说明是速度 |
| `nike-srow` | `← 160px` `160px →` | 与 `‹ ›` 功能完全重复 |
| `nike-control-label` | 「播放端显示」 | 分组标题 10px 大写，视觉上和控件标签无区分 |
| `nike-spdr` | 「字号」滑块 + `100%` | 与速度滑块同形，用户分不清 |
| `nike-sadj` | `A-` `A+` | 位置离滑块远，不知道属于谁 |
| `nike-srow` | 水平镜像 / 垂直镜像 | 混在同一 section |
| `nike-control-label` + `nike-srow` | 语音辅助 | 混在同一 section |

用户反馈（原话）：「我会费解这些哪个控制速度，哪个控制位置」「我会费解怎么调整字号」。

## 设计方案

右侧面板拆成四张独立卡片，每张卡片有图标标题 + 一句说明，控件按「读数 / 步进 / 滑块」固定结构排列。语音辅助从播放控制区移出，单独成 section 放在镜像卡之后，位置和样式沿用现有 `nike-psec`。

### 卡 1：播放位置

- 标题「播放位置」，副标题「控制播放端现在停在稿子的哪里」。
- 一排五个走带按钮，水平等分，图标在上、文字在下：开头 / 后退一段 / **播放**（大圆钮，64px，白底黑三角）/ 前进一段 / 结尾。
- 图标：开头和结尾用「竖线 + 三角」，前进后退用双箭头 `‹‹` `››` 的线性 SVG；去掉现有的 `|<` `‹` 文本。
- 删除 `← 160px` / `160px →` 整行。「一段」仍是 160px，由 `onNudge(±160)` 驱动，不在 UI 上写出像素数。
- 播放中时大圆钮换暂停图标，文字换「暂停」。

### 卡 2：播放速度

- 标题「播放速度」，副标题「稿子向上滚动的快慢」。
- 右上角大号读数：`68` + 小字单位 `px/s`，`font-variant-numeric: tabular-nums`。
- 控件行：`−` 圆钮（44px）| 滑块 | `+` 圆钮。圆钮 = `onSpeedChange(speed ∓ 10)`。
- 滑块下方两端标注「慢 10」「快 150」，滑块已填充部分用 `--nike-info` 蓝色。

### 卡 3：播放端字号

- 标题「播放端字号」，副标题「只影响播放端屏幕，不影响这里」。
- 右上角：可编辑数值输入框（74px 宽，右对齐）+ `%`。回车或失焦时调用 `onPlayerFontScaleChange(value / 100)`；空值或非数字不触发回调，恢复显示当前值。
- 控件行：`A−` 圆钮 | 滑块 | `A+` 圆钮。圆钮 = `onPlayerFontScaleChange(scale ∓ 0.1)`。
- 滑块范围 75–500，两端标注「小 75%」「大 500%+」。超过 500% 时滑块停在最右，数值框显示真实值。在 M6 放开上限前，`RoomClient` 仍会 clamp 到 200%，此时滑块 max 先设 200，M6 合并后改 500。
- 下方一行样例：大号「字」+ 灰字说明，强调只影响播放端。

### 卡 4：镜像

- 标题「镜像」，副标题「配合分光镜提词器时打开」。
- 两个等宽 toggle：左右镜像 / 上下镜像，带线性图标，`aria-pressed` 为 true 时蓝色描边 + 浅蓝底。文案从「水平 / 垂直」改为「左右 / 上下」。

### 通用规则

- 卡片：`border: 1px solid var(--nike-hl)`，`border-radius: 14px`，`background: var(--nike-s1)`，`padding: 16px`，卡片间距 14px。
- 标题 13px/600，副标题 12px `--nike-ink2`。放弃现有 10px 大写字母标签。
- 所有可点元素是 `<button>`，图标按钮带 `aria-label`；触控目标 ≥ 44px。
- 所有图标为内联 `stroke` SVG，`aria-hidden="true"`；不用 emoji、不用文字符号。
- 颜色与字体全部沿用 `.nike-control` 已定义的 CSS 变量，不引入新 token。

## 实施范围

主要修改：

- `src/app/room/[roomCode]/_components/control-console.tsx`：右侧 `nike-rp` 中第一个 `nike-psec` 的 JSX 重写为四张卡 + 语音辅助 section；新增字号数值输入的本地 state 与提交逻辑；新增若干内联 SVG 图标组件。props 接口不变。
- `src/app/globals.css`：新增卡片、走带按钮、步进圆钮、滑块填充、toggle 样式；删除不再使用的 `.nike-pb`、`.nike-stpb`、`.nike-sadj`、`.nike-sadjb`、`.nike-srow`、`.nike-srowb`、`.nike-spdr`、`.nike-spd-l`、`.nike-spd-v`、`.nike-control-label`（先确认无其他引用再删）。
- 不改：`room-client.tsx`、协议、服务端、播放端。

不做：

- 不改标记跳转、历史版本、播放端入口三个 section。
- 不改左侧稿件区和顶栏。
- 不新增依赖。

## 验收标准

- [ ] 右侧面板从上到下依次为：播放位置、播放速度、播放端字号、镜像、语音辅助、标记跳转、历史版本、播放端入口。
- [ ] 走带五个按钮都有可见文字；播放/暂停随状态切换图标和文字；`← 160px / 160px →` 行不再出现。
- [ ] 速度：− / + 每次 ±10，滑块与读数同步，范围 10–150 不变。
- [ ] 字号：A− / A+ 每次 ±10%，滑块、数值框、读数三者同步；数值框输入非法值不改变房间设置；输入合法值回车后播放端字号变化。
- [ ] 镜像 toggle 的开关态可见，播放端镜像效果与改前一致。
- [ ] 所有回调仍走现有 props，`room-client.tsx` 无 diff。
- [ ] 1280×800 与 960px 以下响应式断点（`@media (max-width: 960px)`）下面板不溢出、不横向滚动。
- [ ] 键盘 Tab 可遍历所有按钮和滑块，屏幕阅读器能读到每个按钮的用途。
- [ ] 类型检查、lint、现有测试通过。

## 完成定义

代码与上述验收完成后关闭 Issue #4。设计稿画板上若有新评论，以画板为准更新本文。

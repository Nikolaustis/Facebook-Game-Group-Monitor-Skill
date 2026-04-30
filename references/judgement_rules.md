# 判定与过滤规则（V3.4 严格版）

## A. 第一轮（搜索与深翻页）
1. 每个游戏仅使用原始搜索词，不扩展变体。
2. 深翻页停止条件（满足任一）：
- 页面提示无更多结果
- 连续 3 次下滑无新增群组
- 列表不再增长
3. 达到停止条件后必须先人工确认“可以停止，继续”。

## B. 第二轮（详情采集）
1. 候选处理顺序：
- 先看搜索卡片成员数
- `<100`：不进入 `/about`，不输出
- `>=100`：进入 `/about` 采集
2. `/about` 最多尝试 2 次，失败不输出。

## C. 相关性规则（修正版）
1. `exact_phrase_in_group_name` 视为强正样本，可继续进入最终筛选。
2. 若 `group_name` 明确命中兄弟游戏完整标题，则 `is_relevant = no`。
3. about/snippet 中的正向命中，不得覆盖 `group_name` 中的兄弟游戏负向命中。
4. `exact_phrase_in_full_text` 降级为人工复核候选，默认不直接进入最终输出。
5. 只有 `group_name` 未命中任何兄弟标题时，`exact_phrase_in_full_text` 才可保留进 `manual_review_queue.csv`。
6. `group_name` 命中 IP 大词根但未命中目标完整标题时，进入 `manual_review_queue.csv`。
7. 禁止以下宽松规则：
- 3 个 token 命中 2 个就算相关
- 2 个 token 命中 1 个就算相关
8. 同一 IP 下的近似标题（如 New World / Time Reversed / Awakening World）必须依赖完整标题、兄弟排斥或人工复核隔离。

## D. 输出门槛（全部满足）
- `group_size >= 100`
- `is_relevant = yes`
- 若配置了 `allowed_language_signals`，则 `language_signal` 必须命中允许列表
- 若配置了 `allowed_regions`，则 `region` 必须命中允许列表
- `language_signal` 必须参考群组名称 + 关于这个小组的非 UI 文本 + 讨论区前五条可见玩家发言；不得使用 about 整页 UI 文本、Facebook 账号界面语言、导航、按钮、固定提示文案作为语言判断证据
- `language_signal` 必须采用多语言证据评分：非拉丁字符脚本、群名强信号、语言关键词、常见功能词共同判断；英文字符数量只能作为弱兜底，不能覆盖法语/西语/葡语等明确语言证据
- `region` 优先且主要由 `group_name` 中的明确地区语义识别，例如 `VN` / `Vietnam` / `Việt Nam` -> `VN`，`Mexico` / `México` -> `MX`
- 未命中群名地区语义时，仅允许 Thai/Vietnamese/Indonesian/Malay/Filipino 等高确定性语言做辅助映射；English/Spanish/Chinese/Arabic 不得直接映射到国家地区
- 且满足其一：
  - `today_posts >= 10`
  - `week_new_fans >= 10`

## E. 不输出规则
- 成员数 < 100
- 明确不相关
- `group_name` 命中兄弟游戏标题
- `match_type = exact_phrase_in_full_text`
- 不满足 `allowed_language_signals`（仅当配置了限制时）
- 不满足 `allowed_regions`（仅当配置了限制时）
- `/about` 失败且无法获取核心指标
- 同一 `group_url` 归属冲突且最高分并列

## J. 人工复核队列
以下记录进入 `manual_review_queue.csv`，且不得混入最终 CSV：
- 仅 `full_text` 命中目标完整标题
- `group_name` 命中 IP 大词根但未命中目标完整标题
- `group_name` 命中兄弟游戏标题
- `match_type = exact_phrase_in_full_text`

## F. 跨游戏去重归属
1. 同一 `group_url` 只允许输出一条。
2. 如果同一群被多个游戏同时命中：
- 分数最高者保留
- 最高分并列：全部丢弃，并写入 `collision_report.json`

## G. action 判定
- `existed_last_month=yes -> update`
- `existed_last_month=no -> add`
- 留空 -> `action` 留空

## H. action_reason 规则
- 输出记录必须填写，示例：
  - `today_posts达到阈值；existed_last_month=yes`
  - `week_new_fans达到阈值；existed_last_month=no`
  - `today_posts达到阈值；existed_last_month缺失`

## I. risk_level 规则
- `low`：完整标题命中于群名，且关键字段完整
- `medium`：完整标题命中于 about/snippet，或字段部分缺失但结论明确
- `high`：仅靠弱信号命中、或存在冲突边界（高风险记录建议直接丢弃）

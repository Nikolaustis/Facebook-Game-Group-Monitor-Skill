# CSV字段规范（固定顺序）

输出字段仅允许以下 15 列，顺序不可变：

```text
snapshot_date,region,game_name,group_name,group_url,group_id,group_size,today_posts,week_new_fans,existed_last_month,is_relevant,language_signal,action,action_reason,risk_level
```

## 字段定义
- `snapshot_date`: `YYYY-MM-DD`
- `region`: 优先由 `region_keywords` 从群组名称中的明确地区语义得到；未命中时仅可由高确定性语言辅助映射，例如 `TH` / `VN` / `PH` / `ID` / 留空
- `game_name`: 用户输入的游戏名
- `group_name`: 群组名称
- `group_url`: 群组链接
- `group_id`: 从 `group_url` 提取（无法明确提取则留空）
- `group_size`: 仅成员数
- `today_posts`: 今日新帖
- `week_new_fans`: 上周新增粉丝/成员
- `existed_last_month`: `yes` / `no` / 留空
- `is_relevant`: `yes` / `no`
- `language_signal`: 基于群组名称 + 关于这个小组的非 UI 文本 + 讨论区前五条可见玩家发言识别；不得使用 about 整页 UI 文本或 Facebook 界面语言作为证据。常见值包括 `Thai` / `Vietnamese` / `Chinese` / `Spanish` / `Portuguese` / `French` / `German` / `Italian` / `Dutch` / `Polish` / `Turkish` / `English` / `Mixed` / `Unknown`
- `action`: `add` / `update` / 留空
- `action_reason`: 必填（输出记录中）
- `risk_level`: `low` / `medium` / `high`

## 映射规则
- 优先使用 `region_keywords` 只从群组名称中识别地区
- `language_signal` 使用语言专用文本流：群组名称 + 关于这个小组的非 UI 文本 + 讨论区前五条可见玩家发言，并过滤导航、按钮、固定 UI 文案
- 拉丁语系语言使用语言画像评分，不能仅因文本包含大量英文字母或英文游戏名就判为 `English`
- 若未命中地区关键词，再按 `language_to_region` 从高确定性 `language_signal` 映射；English / Spanish / Chinese / Arabic 不得直接映射地区
- 若两者都无法明确，则 `region` 留空

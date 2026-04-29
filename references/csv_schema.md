# CSV字段规范（固定顺序）

输出字段仅允许以下 15 列，顺序不可变：

```text
snapshot_date,region,game_name,group_name,group_url,group_id,group_size,today_posts,week_new_fans,existed_last_month,is_relevant,language_signal,action,action_reason,risk_level
```

## 字段定义
- `snapshot_date`: `YYYY-MM-DD`
- `region`: 由 `region_keywords` 或 `language_to_region` 映射得到，例如 `TH` / `VN` / `PH` / `ID` / `GLOBAL` / 留空
- `game_name`: 用户输入的游戏名
- `group_name`: 群组名称
- `group_url`: 群组链接
- `group_id`: 从 `group_url` 提取（无法明确提取则留空）
- `group_size`: 仅成员数
- `today_posts`: 今日新帖
- `week_new_fans`: 上周新增粉丝/成员
- `existed_last_month`: `yes` / `no` / 留空
- `is_relevant`: `yes` / `no`
- `language_signal`: `Thai` / `Vietnamese` / `Chinese` / `Spanish` / `Portuguese` / `English` / `Mixed` / `Unknown`
- `action`: `add` / `update` / 留空
- `action_reason`: 必填（输出记录中）
- `risk_level`: `low` / `medium` / `high`

## 映射规则
- 优先使用 `region_keywords` 从群名、简介、about 中识别地区
- 若未命中地区关键词，再按 `language_to_region` 从 `language_signal` 映射
- 若两者都无法明确，则 `region` 留空

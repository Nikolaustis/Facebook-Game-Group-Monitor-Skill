# Excel 字段规范（V3.6.1）

V3.6.1 起不再读写或保存 CSV。第二轮只输出 `fb_monitoring_filtered.xlsx`，并在同一个工作簿中包含：

- `detail`：严格通过样本。
- `manual_review`：人工复核队列。

同时输出 `debug_rows.json`，用于保存 detail 中隐藏的审计字段。

## detail 固定列顺序

```text
snapshot_date,region,language,game_name,group_name,group_url,group_id,group_size,today_posts,week_new_fans,活跃指数=当日新帖/社群规模,规模增速=上周新增/(社群规模-上周新增）,existed_last_month,is_relevant,action,action_reason,risk_level,__region_source,__region_keyword_hits
```

## detail 字段说明

- `snapshot_date`：文本格式，示例 `2026-05-07`，不得保存为 Excel 日期序列号。
- `region`：优先由群组名称中的明确国家/地区/属地/大区语义得到，再按业务区域规则归并输出；若多个命中项属于同一业务大区，输出该大区；跨业务大区冲突或无法确定时留空。
- `language`：以讨论区前五条可见玩家发言为主，先逐条识别再汇总；若前五条出现两个以上可信语言，标记为 `Mixed`。群名辅助，用户手写 about 非 UI 文本最低优先级兜底。
- `game_name`：用户输入的目标游戏名。
- `group_name`：Facebook 群组名称。seed URL 候选若第一轮无群名，第二轮应从页面补取。
- `group_url`：群组链接。
- `group_id`：文本格式，避免长数字被 Excel 转为科学计数法。
- `group_size`：成员数。
- `today_posts`：当日新帖。
- `week_new_fans`：上周新增成员或粉丝。
- `活跃指数=当日新帖/社群规模`：Excel 公式 `=IFERROR(Ix/Hx,"")`，百分比格式，保留 2 位小数。
- `规模增速=上周新增/(社群规模-上周新增）`：Excel 公式 `=IFERROR(Jx/(Hx-Jx),"")`，百分比格式，保留 2 位小数。
- `existed_last_month`：`yes` / `no` / 留空。
- `is_relevant`：`yes` / `no`。
- `action`：`add` / `update` / 留空。
- `action_reason`：输出记录必须填写，并体现实际阈值，例如 `today_posts>=20; existed_last_month=yes`。
- `risk_level`：`low` / `medium` / `high`。
- `__region_source`：地区来源，例如 `country_keyword` / `region_keyword` / `country_keyword_same_business_region` / `region_keyword_same_business_region` / `language_map` / `keyword_conflict` / 留空。
- `__region_keyword_hits`：地区关键词命中详情。

## manual_review 固定列顺序

```text
snapshot_date,game_name,group_name,group_url,language_signal,region,match_type,matched_phrase,negative_hit,review_reason,source_query,query_variant_type,source_is_seed_url,variant_threshold_applied
```

## debug_rows.json 字段

`debug_rows.json` 保存最终 detail 行对应的完整审计字段，至少包含：

```text
__match_score,__match_type,__matched_phrase,__source_query,__source_queries,__query_variant_type,__query_variant_types,__source_is_seed_url,__variant_threshold_applied,__review_reason
```

## 编码要求

- 不通过 CSV 中转生成最终表格。
- 不保存独立 CSV 明细或人工复核队列文件。
- 非 ASCII 群名必须在 XLSX 中保持可读，包括泰语、越南语、老挝语、缅甸语、柬埔寨语等。
- 如需修复已有结果，应从第一轮原始 JSON 或内存对象重建 Excel，不要读取已导出的 CSV 再重写。

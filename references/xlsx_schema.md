# Excel 字段规范（V5.3.0）

V3.6.1 起不再读写或保存 CSV。第二轮只输出 `fb_monitoring_filtered.xlsx`，并在同一个工作簿中包含：

- `detail`：严格通过样本。
- `manual_review`：人工复核队列。

同时输出 `debug_rows.json`，用于保存 detail 中隐藏的审计字段。

## detail 固定列顺序

```text
snapshot_date,region,language,game_name,group_name,group_url,group_id,group_size,today_posts,week_new_fans,活跃指数=当日新帖/社群规模,规模增速=上周新增/(社群规模-上周新增）,existed_last_month,is_relevant,action,action_reason,risk_level,__region_source,__region_keyword_hits,__region_location
```

## detail 字段说明

- `snapshot_date`：文本格式，示例 `2026-05-07`，不得保存为 Excel 日期序列号。
- `region`：优先由群组名称中的明确国家/地区/属地/大区语义、受控别名或国旗 emoji 得到，再按业务区域规则归并输出；未命中时可使用允许的高确定性语言映射；若上述链路仍无法确定，才从 About 页明确标注的“所在地 / Location”字段中识别国家/地区或高确定性城市。若多个命中项属于同一业务大区，输出该大区；跨业务大区冲突且 About 所在地也无法解决时留空。
- `language`：以讨论区前五条可见玩家发言为主，先逐条识别再汇总；若前五条出现两个以上可信语言，标记为 `Mixed`。群名辅助，用户手写 about 非 UI 文本最低优先级兜底。所有语言证据在识别前先剔除当前游戏正式名称、别名和受控变体。
- `Mongolian` / `Russian` 区分：`Ө/ө`、`Ү/ү` 或高确定性蒙古语词组优先输出 `Mongolian`；没有蒙古语证据的通用西里尔文本才输出 `Russian`。`Mongolia` / `Mongolian` 等地理词不单独决定语言。
- `game_name`：用户输入的目标游戏名。
- `group_name`：Facebook 群组名称。seed URL 候选若第一轮无群名，第二轮应从页面补取。
- `group_url`：群组链接。
- `group_id`：文本格式，避免长数字被 Excel 转为科学计数法。
- `group_size`：成员数。
- `today_posts`：当日新帖。
- `week_new_fans`：上周新增成员或粉丝。
- `活跃指数=当日新帖/社群规模`：Excel 公式 `=IFERROR(Ix/Hx,"")`，K 列数字格式必须为 `0.00%`。
- `规模增速=上周新增/(社群规模-上周新增）`：Excel 公式 `=IFERROR(Jx/(Hx-Jx),"")`，L 列数字格式必须为 `0.00%`。
- `existed_last_month`：`yes` / `no` / 留空。
- `is_relevant`：`yes` / `no`。
- `action`：`add` / `update` / 留空。
- `action_reason`：输出记录必须填写，并体现实际阈值，例如 `today_posts>=20; existed_last_month=yes`。
- `risk_level`：`low` / `medium` / `high`。
- `__region_source`：地区来源，例如 `country_keyword` / `country_flag` / `country_keyword_and_flag` / `region_keyword` / `country_keyword_same_business_region` / `language_map` / `about_location_country_keyword` / `about_location_city_keyword` / `about_location_adjudicated_group_name_conflict` / `external_geocoder_about_location_adjudicated_group_name_conflict` / `keyword_conflict` / 留空。
- `__region_keyword_hits`：地区关键词命中详情；当 About 所在地兜底介入时，会以 `group_name:` 与 `about_location:` 前缀标记证据来源。
- `__region_location`：从 About 页明确“所在地 / Location”字段提取的原始位置文本，仅用于地区判断审计；它不会覆盖已由群名或允许语言映射得到的 `region`。

## manual_review 固定列顺序

```text
snapshot_date,game_name,group_name,group_url,group_size,today_posts,week_new_fans,language_signal,region,about_location,match_type,matched_phrase,negative_hit,review_reason,source_query,query_variant_type,source_is_seed_url,variant_threshold_applied
```

`manual_review` 仅保留已经通过 `group_size >= 100` 且满足 `today_posts >= threshold` 或 `week_new_fans >= threshold` 的弱相关候选。

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


## V5.2 GeoNames 审计补充

- `__geocoder_status=unsafe_query`：候选被泛词、短代码、句子或非地点安全规则拦截，未发起外部请求。
- `__geocoder_attempted_queries`：保留实际尝试的安全地点短语；多词地点应优先出现完整短语。
- `external_geocoder_filtered_queries`（位于 `audit_stats.json`）：被 GeoNames 安全过滤器拦截的候选数量。
- V5.2 缓存使用版本化 key，旧版 accepted 假阳性不会被新版本复用。


## V5.3 GeoNames 与语言屏蔽补充

- GeoNames query 生成前必须删除当前游戏标题、aliases、受控变体和高确定性 IP 根词。
- 游戏标题屏蔽不得影响原始 `group_name` 输出或相关性判定。
- K/L 百分比格式必须存在于 partial、正常 final 和 recovery final 三类工作簿。

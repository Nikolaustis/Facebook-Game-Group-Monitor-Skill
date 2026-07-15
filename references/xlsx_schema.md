# Excel 字段规范（V5.5.0）

V3.6.1 起不再读写或保存 CSV。第二轮只输出 `fb_monitoring_filtered.xlsx`，并在同一个工作簿中包含：

- `detail`：严格通过样本。
- `manual_review`：人工复核队列。

同时输出 `debug_rows.json`，用于保存 detail 中隐藏的审计字段。

## detail 固定列顺序

```text
snapshot_date,region,language,game_name,group_name,group_url,group_id,group_size,today_posts,week_new_fans,活跃指数=当日新帖/社群规模,规模增速=上周新增/(社群规模-上周新增）,existed_last_month,is_relevant,action,action_reason,risk_level,__region_source,__region_keyword_hits,__region_location,__geocoder_provider,__geocoder_status,__geocoder_source,__geocoder_query,__geocoder_attempted_queries,__geocoder_endpoint,__geocoder_error_reason,__geocoder_country_code,__geocoder_place_name,__geocoder_admin1,__geocoder_confidence
```

## detail 字段说明

- `snapshot_date`：文本格式，示例 `2026-05-07`，不得保存为 Excel 日期序列号。
- `region`：群名明确国家/地区/属地/大区或本地城市优先；未命中时先解析 About 页明确的“所在地 / Location”（本地规则后接 GeoNames），再使用允许的高确定性语言映射，最后才调用群名 GeoNames。群名 GeoNames 只接受精确地名匹配。若多个群名命中项属于同一业务大区且 About 无法裁决，可输出该大区；跨业务大区冲突留空。
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
- `__region_location`：从 About 页明确“所在地 / Location”字段提取的原始位置文本，仅用于地区判断和审计；它不会覆盖群名中的明确地区，但在群名无明确地区时优先于语言映射和群名模糊 GeoNames。

## manual_review 固定列顺序

`manual_review` 的前 31 列必须与当前实际 `detail` 完全相同；人工复核专属字段依次追加在最后：

```text
snapshot_date,region,language,game_name,group_name,group_url,group_id,group_size,today_posts,week_new_fans,活跃指数=当日新帖/社群规模,规模增速=上周新增/(社群规模-上周新增）,existed_last_month,is_relevant,action,action_reason,risk_level,__region_source,__region_keyword_hits,__region_location,__geocoder_provider,__geocoder_status,__geocoder_source,__geocoder_query,__geocoder_attempted_queries,__geocoder_endpoint,__geocoder_error_reason,__geocoder_country_code,__geocoder_place_name,__geocoder_admin1,__geocoder_confidence,language_signal,about_location,match_type,matched_phrase,negative_hit,review_reason,source_query,query_variant_type,source_is_seed_url,variant_threshold_applied
```

- A:AE 可以直接批量复制到 `detail`。
- K/L 必须为与 detail 相同的 Excel 公式和 `0.00%` 格式。
- AF:AO 仅保存人工复核专属证据。
- `manual_review` 仍只保留已经通过 `group_size >= 100`，且满足 `today_posts >= threshold` 或 `week_new_fans >= threshold` 的弱相关候选。

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


## V5.5 GeoNames 上下文补充

- 群名 query 的包含式/前缀式 GeoNames 结果不得写入 `region`，状态为 `rejected_context_mismatch`。
- `audit_stats.json.external_geocoder_rejected_context` 记录此类上下文拒绝。
- V5.5 不新增 XLSX 列，detail 与 manual_review 列结构继续沿用 V5.4.0。

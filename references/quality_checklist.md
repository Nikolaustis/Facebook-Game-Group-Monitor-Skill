# 质量检查清单 V5.3.0

## 运行前

- [ ] 已完成 Facebook 手动登录。
- [ ] 游戏名列表确认无误，尤其是多游戏批量任务中的相近标题。
- [ ] 如需启用 `connector_x` 或 seed URL，已在 `title_variant_overrides` 中按游戏单独配置。
- [ ] 未把某个游戏的特殊变体写成全局规则。
- [ ] threshold 已确认，默认 `10`。

## 第一轮后

- [ ] 每个游戏都生成了 `phase1_*_candidates.json`。
- [ ] 每个游戏都生成了 `phase1_*_stats.json`。
- [ ] `phase1_index.json` 中每个游戏都有 `search_plan` 和 `query_runs`。
- [ ] 候选中保留 `source_query`、`query_variant_type`、`source_is_seed_url` 等字段。
- [ ] 到达深翻停止条件后，已向用户确认“可以停止，继续 / 继续深翻”。

## 第二轮后

- [ ] 成功生成 `fb_monitoring_filtered.xlsx`。
- [ ] `fb_monitoring_filtered.xlsx` 包含 `detail` sheet。
- [ ] `fb_monitoring_filtered.xlsx` 包含 `manual_review` sheet。
- [ ] 成功生成 `fb_monitoring_filtered_summary.json`、`collision_report.json`、`audit_stats.json`、`debug_rows.json`。
- [ ] 未生成或依赖 CSV 输出文件。
- [ ] `collision_report.json` 没有异常大量并列冲突。
- [ ] `audit_stats.json` 中 `dropped_collision`、`dropped_lang_region` 没有异常偏高。

## Excel 格式

- [ ] `snapshot_date` 为文本日期，不是 Excel 序列号。
- [ ] `group_id` 为文本，不是科学计数法。
- [ ] `活跃指数=当日新帖/社群规模` 为公式列，百分比格式，2 位小数。
- [ ] `规模增速=上周新增/(社群规模-上周新增）` 为公式列，百分比格式，2 位小数。
- [ ] 非 ASCII 群名正常显示，例如泰语、越南语、老挝语、日文、韩文等不乱码。

## 语言与地区

- [ ] 语言优先级符合规则：讨论区前五条玩家发言优先，群名辅助，about 仅在存在用户手写非 UI 内容时低优先级兜底。
- [ ] 非公开小组、about 无手写描述、讨论区无正文/极短正文时，不得把 Facebook 中文结构文案、按钮、时间、互动统计、评论入口识别成 `Chinese`。
- [ ] 拉丁语系群组不应因为英文游戏词被误判为 `English`。
- [ ] 地区优先来自群组名称中的明确国家/地区/属地/大区语义。
- [ ] `region` 已按业务规则归并：Middle East、Central Asia、South Asia、North America、LATAM、Africa、EUR、Oceania 等不再拆成过多国家。
- [ ] 东亚与东南亚单一国家/地区仍按自身输出；同一业务大区内多国家/地区同时命中时，输出对应大区，例如 `MY + SG` -> `SEA`、`HK + TW` -> `EA`。
- [ ] Brazil 单独输出 `BR`；Turkey、Netherlands、Germany、France、Italy、Poland、Russia 单一命中时分别输出 `TR`、`NL`、`DE`、`FR`、`IT`、`PL`、`RU`；多个欧洲命中同属欧洲业务大区时可折叠为 `EUR`。
- [ ] 明确非洲国家优先输出 `Africa`；Arabic / Persian 只在国家未知时辅助输出 `Middle East`。
- [ ] English / Spanish / Chinese / French / Portuguese / Mixed 只作为语言展示，不得单独映射成国家地区。

## 相关性

- [ ] 同一个 `group_url` 在 `detail` 中只出现一次。
- [ ] 多游戏批量检索时，同批次其他游戏已自动作为兄弟标题排斥。
- [ ] `Anime Rangers X`、`Ragnarok X: Next Generation` 中的 `X` 未被删除或当作可选连接符。
- [ ] `LINE Rangers` 不应大面积吸入 `LINE Idle Rangers`。
- [ ] `Soul Land` 各子标题之间不应互相串群。
- [ ] `Ragnarok` 各子标题不应仅靠词根互相命中。
- [ ] `group_name` 命中兄弟游戏标题的记录，不应进入 `detail`。
- [ ] `exact_phrase_in_full_text` 记录应进入 `manual_review`，而不是 `detail`。
- [ ] `manual_review` 中每条记录均满足 `group_size >= 100`，且 `today_posts >= threshold` 或 `week_new_fans >= threshold`。
- [ ] `manual_review` 包含 `group_size`、`today_posts`、`week_new_fans` 三列。
- [ ] `audit_stats.json` 中 `manual_review_dropped_group_size` 与 `manual_review_dropped_activity` 统计合理。
- [ ] `compact_title_in_group_name` 可以进入 `detail`，但应能在 `debug_rows.json` 查到命中来源。
- [ ] `connector_x_title_in_group_name` 只有通过更高活跃门槛后才可进入 `detail`。

- [ ] 临时任务配置未含 `external_geocoder` 时，只要本地用户名存在，`audit_stats.json` 中 `external_geocoder_enabled=1` 且 `external_geocoder_enable_source` 合理。
- [ ] 已抽查 `大马`、`Belgique`、`CZ/SK`、`🇫🇷`、`HK朋友交換群組` 等高确定性写法。


## V5.2 地区误判专项检查

- [ ] `™`、`®`、`©`、`℠` 未触发国家代码。
- [ ] 小写 `de`、普通单词前缀 `tr` 等未触发 `DE/TR`。
- [ ] `Québec`、`台中`、`台南`、`Trójmiasto`、`Danmark` 等样例输出正确。
- [ ] `Come`、`Gift`、`Compra`、`trades`、`Bay`、`Only`、`Daily` 等未作为 GeoNames accepted 查询。
- [ ] `audit_stats.json` 中 `external_geocoder_filtered_queries` 有合理统计，且 `external_geocoder_accepted` 抽样无泛词假阳性。


## V5.2.2 ID 与 About 裁决专项检查

- [ ] `... ID Thailand` 只输出 `TH`，账号 ID 未命中印度尼西亚。
- [ ] 旧 task_config 中即使存在 `region_keywords.ID=["id", ...]`，运行时仍会移除 `id`。
- [ ] 群名多个不同地区命中时已检查 About 所在地。
- [ ] About 的具体地区与群名证据相容时，输出 About 的更具体地区。
- [ ] About 无法裁决时，同业务大区才回退大区；跨业务大区保持空值。


## V5.3.0 游戏名与 XLSX 专项检查

- [ ] `Cookie Run: Kingdom Buy and Sell International` 不产生 `cookie / run / kingdom` GeoNames query。
- [ ] `Cookie Run Kingdom Paris` 删除游戏标题后仍能保留 `Paris` 地点候选。
- [ ] `Cookie Run Kingdom ESPAÑOL` 群名去除游戏标题后识别为 `Spanish`。
- [ ] 帖子正文中反复出现游戏标题时，标题不计入 English 证据。
- [ ] `partial_verified_rows.xlsx` 的 K/L 数据单元格显示为 `0.00%`。
- [ ] 正常最终和恢复最终 XLSX 的 K/L 数据单元格同样显示为 `0.00%`。
